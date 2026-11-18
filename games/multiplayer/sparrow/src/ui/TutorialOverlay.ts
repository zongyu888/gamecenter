export type TutorialPromptKey =
  | 'WASD'
  | 'Q'
  | 'CLICK'
  | 'SPACE'
  | 'MOBILE_DOOR'
  | 'MOBILE_WINDOW'
  | null;

interface SingleKeySpec {
  label: string;
  codes: string[];
  wide?: boolean;
  medium?: boolean;
}

interface MobileChipSpec {
  gesture: string;
  hint: string;
  codes: string[];
}

const WASD_KEYS: ReadonlyArray<{ label: string; slotClass: string; codes: string[] }> = [
  { label: 'W', slotClass: 'wasd-w', codes: ['KeyW', 'ArrowUp'] },
  { label: 'A', slotClass: 'wasd-a', codes: ['KeyA', 'ArrowLeft'] },
  { label: 'S', slotClass: 'wasd-s', codes: ['KeyS', 'ArrowDown'] },
  { label: 'D', slotClass: 'wasd-d', codes: ['KeyD', 'ArrowRight'] },
];

const SINGLE_PROMPT_SPECS: Record<'Q' | 'CLICK' | 'SPACE', SingleKeySpec> = {
  Q: {
    label: 'Q',
    codes: ['KeyQ', 'KeyC', 'KeyR'],
  },
  CLICK: {
    label: 'CLICK',
    codes: ['MouseLeft'],
    medium: true,
  },
  SPACE: {
    label: 'SPACE',
    codes: ['Space'],
    wide: true,
  },
};

function resolveMobileChips(prompt: TutorialPromptKey): MobileChipSpec[] | null {
  switch (prompt) {
    case 'WASD':
      return [
        { gesture: 'DRAG', hint: 'Move', codes: ['TouchMove'] },
        { gesture: 'TAP', hint: 'Hop', codes: ['TouchTap'] },
      ];
    case 'MOBILE_DOOR':
      return [{ gesture: 'DRAG', hint: 'To Cage Door', codes: ['TouchMove'] }];
    case 'SPACE':
      return [
        { gesture: 'DOUBLE-TAP', hint: 'Fly', codes: ['TouchTap'] },
        { gesture: 'DRAG', hint: 'Steer', codes: ['TouchMove'] },
      ];
    case 'MOBILE_WINDOW':
    case 'CLICK':
      return [{ gesture: 'FLY', hint: 'To Window', codes: ['TouchTap', 'TouchMove'] }];
    case 'Q':
    case null:
    default:
      return null;
  }
}

/**
 * Contextual indie tutorial overlay:
 * - Desktop: physical 4-square inverted-T cluster for WASD and single <kbd> keycaps for action prompts
 * - Mobile: clean tactile touch gesture pills (Drag to Move · Tap to Hop, Double-Tap to Fly, etc.)
 * Built with safe DOM APIs (createElement, textContent, replaceChildren; no innerHTML).
 */
export class TutorialOverlay {
  private readonly root: HTMLDivElement;
  private readonly keyRow: HTMLDivElement;

  private requestedPrompt: TutorialPromptKey = null;
  private renderedSignature = '';
  private finished = false;
  private mobileMode = false;
  private activeKeyEls: Array<{ el: HTMLElement; codes: string[] }> = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'tutorial-overlay is-idle';
    this.root.setAttribute('aria-hidden', 'true');

    this.keyRow = document.createElement('div');
    this.keyRow.className = 'tutorial-keys';

    this.root.appendChild(this.keyRow);
    parent.appendChild(this.root);

    window.addEventListener('keydown', (e) => this.handleKeyState(e.code, true));
    window.addEventListener('keyup', (e) => this.handleKeyState(e.code, false));
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.handleKeyState('MouseLeft', true);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.handleKeyState('MouseLeft', false);
    });
    window.addEventListener(
      'touchstart',
      () => {
        this.handleKeyState('TouchTap', true);
      },
      { passive: true }
    );
    window.addEventListener(
      'touchmove',
      () => {
        this.handleKeyState('TouchMove', true);
      },
      { passive: true }
    );
    const clearTouch = () => {
      this.handleKeyState('TouchTap', false);
      this.handleKeyState('TouchMove', false);
    };
    window.addEventListener('touchend', clearTouch, { passive: true });
    window.addEventListener('touchcancel', clearTouch, { passive: true });

    const clearPressed = () => {
      for (let i = 0; i < this.activeKeyEls.length; i++) {
        this.activeKeyEls[i].el.classList.remove('is-pressed');
      }
    };
    window.addEventListener('blur', clearPressed);
    document.addEventListener('visibilitychange', clearPressed);
  }

  private handleKeyState(code: string, down: boolean): void {
    for (let i = 0; i < this.activeKeyEls.length; i++) {
      const entry = this.activeKeyEls[i];
      if (entry.codes.includes(code)) {
        entry.el.classList.toggle('is-pressed', down);
      }
    }
  }

  public setMobileMode(isMobile: boolean): void {
    if (this.mobileMode === isMobile) return;
    this.mobileMode = isMobile;
    this.root.classList.toggle('is-mobile', isMobile);
    if (!this.finished) {
      this.renderCurrentPrompt();
    }
  }

  public setPrompt(prompt: TutorialPromptKey): void {
    if (this.finished) return;
    this.requestedPrompt = prompt;
    this.renderCurrentPrompt();
  }

  private renderCurrentPrompt(): void {
    if (this.finished) return;
    const prompt = this.requestedPrompt;
    const sig = `${this.mobileMode ? 'M' : 'D'}:${prompt ?? 'NONE'}`;
    if (sig === this.renderedSignature) return;
    this.renderedSignature = sig;

    if (this.mobileMode) {
      const chips = resolveMobileChips(prompt);
      if (!chips || chips.length === 0) {
        this.activeKeyEls = [];
        this.root.classList.add('is-idle');
        this.root.setAttribute('aria-hidden', 'true');
        return;
      }

      this.keyRow.replaceChildren();
      this.activeKeyEls = [];
      const wrap = document.createElement('div');
      wrap.className = 'mobile-tutorial-row';
      for (let i = 0; i < chips.length; i++) {
        const chip = chips[i];
        const pill = document.createElement('div');
        pill.className = 'mobile-touch-pill';

        const gestureEl = document.createElement('span');
        gestureEl.className = 'mobile-touch-gesture';
        gestureEl.textContent = chip.gesture;

        const hintEl = document.createElement('span');
        hintEl.className = 'mobile-touch-hint';
        hintEl.textContent = chip.hint;

        pill.appendChild(gestureEl);
        pill.appendChild(hintEl);
        this.activeKeyEls.push({ el: pill, codes: chip.codes });
        wrap.appendChild(pill);
      }
      this.keyRow.appendChild(wrap);
    } else {
      if (prompt === null || prompt === 'MOBILE_DOOR' || prompt === 'MOBILE_WINDOW') {
        this.activeKeyEls = [];
        this.root.classList.add('is-idle');
        this.root.setAttribute('aria-hidden', 'true');
        return;
      }

      this.keyRow.replaceChildren();
      this.activeKeyEls = [];

      if (prompt === 'WASD') {
        const cluster = document.createElement('div');
        cluster.className = 'wasd-cluster';
        for (let i = 0; i < WASD_KEYS.length; i++) {
          const keySpec = WASD_KEYS[i];
          const kbd = document.createElement('kbd');
          kbd.className = `indie-key is-square ${keySpec.slotClass}`;
          kbd.textContent = keySpec.label;
          this.activeKeyEls.push({ el: kbd, codes: keySpec.codes });
          cluster.appendChild(kbd);
        }
        this.keyRow.appendChild(cluster);
      } else {
        const spec = SINGLE_PROMPT_SPECS[prompt];
        const kbd = document.createElement('kbd');
        kbd.className = spec.wide
          ? 'indie-key is-wide'
          : spec.medium
            ? 'indie-key is-medium'
            : 'indie-key';
        kbd.textContent = spec.label;
        this.activeKeyEls.push({ el: kbd, codes: spec.codes });
        this.keyRow.appendChild(kbd);
      }
    }

    this.root.classList.remove('is-idle', 'is-complete');
    this.root.setAttribute('aria-hidden', 'false');
    this.keyRow.classList.remove('step-pop');
    void this.keyRow.offsetWidth;
    this.keyRow.classList.add('step-pop');
  }

  public complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.requestedPrompt = null;
    this.renderedSignature = 'DONE';
    this.root.classList.remove('is-idle');
    this.root.classList.add('is-complete');
    this.root.setAttribute('aria-hidden', 'true');
  }
}
