export interface MobileStickState {
  active: boolean;
  /** Horizontal deflection in [-1, 1] (right = +1, left = -1). */
  x: number;
  /** Vertical deflection in [-1, 1] (screen up = +1, screen down = -1). */
  y: number;
  /** Deflection magnitude in [0, 1]. */
  magnitude: number;
}

export function detectInitialMobileDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const uaMobile =
    typeof navigator !== 'undefined' &&
    /Android|iPhone|iPad|iPod|Mobile|CriOS|FxiOS/i.test(navigator.userAgent);
  if (uaMobile) return true;
  const coarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const hasTouch = typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  if (coarse && hasTouch) return true;
  if (hasTouch && Math.min(window.innerWidth, window.innerHeight) <= 900) return true;
  return false;
}

/**
 * Touch input controller + faint minimalist floating joystick overlay for mobile devices.
 * - Completely hidden (`opacity: 0`) whenever no finger is touching/holding the screen.
 * - Single tap anywhere -> jump/hop (`onTapJump`), double-tap -> launch into flight, tap in flight -> wing-flap climb.
 * - Tap & drag anywhere -> analog movement stick (`x, y` in `[-1, 1]`), with a 2nd-finger tap still able to jump/flap while dragging.
 * - Simultaneous 2-finger quick tap -> drops/tosses a carried prop (`onTwoFingerTap`).
 */
export class MobileTouchControls {
  private static readonly MAX_RADIUS = 46;
  private static readonly DEADZONE_PX = 7;
  private static readonly TAP_MAX_MOVE_PX = 14;
  private static readonly TAP_MAX_MS = 260;
  private static readonly CHORD_WINDOW_MS = 85;

  private readonly joystickRoot: HTMLDivElement;
  private readonly joystickNub: HTMLDivElement;

  private mobileActive: boolean;
  private primaryId: number | null = null;
  private originX = 0;
  private originY = 0;
  private curX = 0;
  private curY = 0;
  private primaryStartMs = 0;
  private primaryPeakDist = 0;

  private secondaryId: number | null = null;
  private secondaryStartX = 0;
  private secondaryStartY = 0;
  private secondaryStartMs = 0;
  private secondaryPeakDist = 0;
  private chordCandidate = false;
  private chordFired = false;

  public readonly stick: MobileStickState = {
    active: false,
    x: 0,
    y: 0,
    magnitude: 0,
  };

  public onTapJump?: () => void;
  public onTwoFingerTap?: () => boolean;
  public onFirstInteract?: () => void;
  public onMobileModeChange?: (isMobile: boolean) => void;

  constructor(parent: HTMLElement) {
    this.mobileActive = detectInitialMobileDevice();

    this.joystickRoot = document.createElement('div');
    this.joystickRoot.className = 'mobile-joystick';
    this.joystickRoot.setAttribute('aria-hidden', 'true');

    const ring = document.createElement('div');
    ring.className = 'mobile-joystick-ring';

    this.joystickNub = document.createElement('div');
    this.joystickNub.className = 'mobile-joystick-nub';

    this.joystickRoot.appendChild(ring);
    this.joystickRoot.appendChild(this.joystickNub);
    parent.appendChild(this.joystickRoot);

    this.bindTouchEvents();
  }

  public isMobile(): boolean {
    return this.mobileActive;
  }

  public setMobileOverride(enabled: boolean): void {
    if (this.mobileActive === enabled) return;
    this.mobileActive = enabled;
    if (!enabled) {
      this.resetAllTouches();
    }
    this.onMobileModeChange?.(enabled);
  }

  private activateMobileFromTouch(): void {
    if (!this.mobileActive) {
      this.mobileActive = true;
      this.onMobileModeChange?.(true);
    }
  }

  private isInteractiveUiTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest('.journal-top-bar, .journal-card, .press-start-btn, .loading-screen:not(.is-loaded)')
    );
  }

  private bindTouchEvents(): void {
    window.addEventListener(
      'touchstart',
      (e: TouchEvent) => {
        this.activateMobileFromTouch();
        this.onFirstInteract?.();

        if (this.isInteractiveUiTarget(e.target)) {
          return;
        }
        if (e.cancelable) {
          e.preventDefault();
        }

        const now = performance.now();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (this.primaryId === null) {
            this.primaryId = t.identifier;
            this.originX = t.clientX;
            this.originY = t.clientY;
            this.curX = t.clientX;
            this.curY = t.clientY;
            this.primaryStartMs = now;
            this.primaryPeakDist = 0;
            this.chordCandidate = false;
            this.chordFired = false;
            this.stick.active = true;
            this.stick.x = 0;
            this.stick.y = 0;
            this.stick.magnitude = 0;
            this.syncJoystickVisual();
          } else if (this.secondaryId === null && t.identifier !== this.primaryId) {
            this.secondaryId = t.identifier;
            this.secondaryStartX = t.clientX;
            this.secondaryStartY = t.clientY;
            this.secondaryStartMs = now;
            this.secondaryPeakDist = 0;
            if (
              now - this.primaryStartMs <= MobileTouchControls.CHORD_WINDOW_MS &&
              this.primaryPeakDist <= MobileTouchControls.TAP_MAX_MOVE_PX
            ) {
              this.chordCandidate = true;
            }
          }
        }
      },
      { passive: false }
    );

    window.addEventListener(
      'touchmove',
      (e: TouchEvent) => {
        if (this.primaryId === null && this.secondaryId === null) return;
        if (e.cancelable) {
          e.preventDefault();
        }

        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          if (t.identifier === this.primaryId) {
            this.curX = t.clientX;
            this.curY = t.clientY;
            const rawDx = this.curX - this.originX;
            const rawDy = this.curY - this.originY;
            const rawDist = Math.hypot(rawDx, rawDy);
            if (rawDist > this.primaryPeakDist) {
              this.primaryPeakDist = rawDist;
            }
            if (rawDist > MobileTouchControls.TAP_MAX_MOVE_PX + 4) {
              this.chordCandidate = false;
            }

            // Gentle floating tether so sweeping wide across the screen stays responsive
            const maxTether = MobileTouchControls.MAX_RADIUS * 1.45;
            if (rawDist > maxTether && rawDist > 1e-4) {
              const pull = rawDist - maxTether;
              this.originX += (rawDx / rawDist) * pull;
              this.originY += (rawDy / rawDist) * pull;
            }

            this.updateStickFromDelta(this.curX - this.originX, this.curY - this.originY);
            this.syncJoystickVisual();
          } else if (t.identifier === this.secondaryId) {
            const sDist = Math.hypot(
              t.clientX - this.secondaryStartX,
              t.clientY - this.secondaryStartY
            );
            if (sDist > this.secondaryPeakDist) {
              this.secondaryPeakDist = sDist;
            }
            if (sDist > MobileTouchControls.TAP_MAX_MOVE_PX + 4) {
              this.chordCandidate = false;
            }
          }
        }
      },
      { passive: false }
    );

    const handleTouchEnd = (e: TouchEvent, cancelled: boolean) => {
      const now = performance.now();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];

        if (t.identifier === this.secondaryId) {
          const dur = now - this.secondaryStartMs;
          const isCleanTap =
            !cancelled &&
            dur <= MobileTouchControls.TAP_MAX_MS &&
            this.secondaryPeakDist <= MobileTouchControls.TAP_MAX_MOVE_PX + 4;

          if (isCleanTap) {
            if (this.chordCandidate && !this.chordFired) {
              this.chordFired = true;
              const consumedDrop = this.onTwoFingerTap?.() ?? false;
              if (!consumedDrop) {
                this.onTapJump?.();
              }
            } else {
              // 2nd-thumb tap while steering with 1st thumb triggers jump / takeoff / flap!
              this.onTapJump?.();
            }
          }
          this.secondaryId = null;
        } else if (t.identifier === this.primaryId) {
          const dur = now - this.primaryStartMs;
          const isCleanTap =
            !cancelled &&
            !this.chordFired &&
            dur <= MobileTouchControls.TAP_MAX_MS &&
            this.primaryPeakDist <= MobileTouchControls.TAP_MAX_MOVE_PX;

          if (isCleanTap) {
            if (this.chordCandidate && this.secondaryId !== null) {
              this.chordFired = true;
              const consumedDrop = this.onTwoFingerTap?.() ?? false;
              if (!consumedDrop) {
                this.onTapJump?.();
              }
            } else {
              this.onTapJump?.();
            }
          }

          this.primaryId = null;
          this.stick.active = false;
          this.stick.x = 0;
          this.stick.y = 0;
          this.stick.magnitude = 0;
          this.syncJoystickVisual();
        }
      }
    };

    window.addEventListener('touchend', (e) => handleTouchEnd(e, false), { passive: false });
    window.addEventListener('touchcancel', (e) => handleTouchEnd(e, true), { passive: false });
    window.addEventListener('blur', () => this.resetAllTouches());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.resetAllTouches();
    });
  }

  private updateStickFromDelta(dx: number, dy: number): void {
    const dist = Math.hypot(dx, dy);
    if (dist <= MobileTouchControls.DEADZONE_PX) {
      this.stick.x = 0;
      this.stick.y = 0;
      this.stick.magnitude = 0;
      return;
    }
    const maxR = MobileTouchControls.MAX_RADIUS;
    const effective = Math.min(
      1,
      (dist - MobileTouchControls.DEADZONE_PX) / Math.max(1, maxR - MobileTouchControls.DEADZONE_PX)
    );
    const ux = dx / dist;
    const uy = -dy / dist; // Screen up (-dy) -> +1 forward/climb
    this.stick.x = ux * effective;
    this.stick.y = uy * effective;
    this.stick.magnitude = effective;
  }

  private syncJoystickVisual(): void {
    if (!this.stick.active || this.primaryId === null) {
      this.joystickRoot.classList.remove('is-active');
      this.joystickNub.style.transform = 'translate(-50%, -50%)';
      return;
    }
    this.joystickRoot.classList.add('is-active');
    this.joystickRoot.style.transform = `translate3d(${this.originX.toFixed(1)}px, ${this.originY.toFixed(1)}px, 0)`;

    const rawDx = this.curX - this.originX;
    const rawDy = this.curY - this.originY;
    const dist = Math.hypot(rawDx, rawDy);
    const clampedR = Math.min(MobileTouchControls.MAX_RADIUS, dist);
    const nx = dist > 1e-4 ? (rawDx / dist) * clampedR : 0;
    const ny = dist > 1e-4 ? (rawDy / dist) * clampedR : 0;
    this.joystickNub.style.transform = `translate(calc(-50% + ${nx.toFixed(1)}px), calc(-50% + ${ny.toFixed(1)}px))`;
  }

  public resetAllTouches(): void {
    this.primaryId = null;
    this.secondaryId = null;
    this.chordCandidate = false;
    this.chordFired = false;
    this.stick.active = false;
    this.stick.x = 0;
    this.stick.y = 0;
    this.stick.magnitude = 0;
    this.syncJoystickVisual();
  }
}
