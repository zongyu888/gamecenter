/**
 * Safe DOM controller for the minimalist translucent Sparrow Silhouette Loading Screen
 * and post-load "Press Start" gate.
 * Uses safe DOM property/attribute/class manipulation (no innerHTML/outerHTML).
 */
export class LoadingScreen {
  private static readonly FILL_SPAN_W = 186;

  private readonly root: HTMLElement | null;
  private readonly progressRoot: HTMLElement | null;
  private readonly fillRect: SVGRectElement | null;
  private readonly statusEl: HTMLElement | null;
  private readonly startBtn: HTMLButtonElement | null;

  private targetProgress = 0;
  private visualProgress = 0;
  private started = false;
  private hasError = false;
  private rafId = 0;
  private lastTickMs = 0;

  constructor() {
    this.root = document.getElementById('loading-screen');
    this.progressRoot = document.getElementById('sparrow-progress');
    this.fillRect = document.getElementById('sparrow-fill-rect') as SVGRectElement | null;
    this.statusEl = document.getElementById('loading-status');
    this.startBtn = document.getElementById('press-start-btn') as HTMLButtonElement | null;
    document.body.dataset.state = 'title';
    this.applyVisualFill(0);
  }

  private applyVisualFill(pct: number): void {
    const clamped = Math.max(0, Math.min(100, pct));
    const width = (clamped / 100) * LoadingScreen.FILL_SPAN_W;
    if (this.fillRect) {
      this.fillRect.setAttribute('width', width.toFixed(2));
    }
    if (this.progressRoot) {
      this.progressRoot.setAttribute('aria-valuenow', String(Math.round(clamped)));
    }
  }

  private ensureSmoothTick(): void {
    if (this.rafId !== 0 || this.hasError) return;
    this.lastTickMs = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.004, (now - this.lastTickMs) * 0.001));
      this.lastTickMs = now;
      const diff = this.targetProgress - this.visualProgress;
      if (Math.abs(diff) <= 0.25) {
        this.visualProgress = this.targetProgress;
        this.applyVisualFill(this.visualProgress);
        this.rafId = 0;
        return;
      }
      // Smooth continuous fill rate so the silhouette steadily fills up
      const maxRate = this.targetProgress >= 100 ? 220 : 145;
      const delta = Math.min(diff, Math.max(diff * Math.min(1, dt * 9.5), maxRate * dt * 0.35));
      this.visualProgress = Math.min(this.targetProgress, this.visualProgress + delta);
      this.applyVisualFill(this.visualProgress);
      this.rafId = window.requestAnimationFrame(step);
    };
    this.rafId = window.requestAnimationFrame(step);
  }

  public setProgress(percent: number): void {
    if (this.started || this.hasError) return;
    const clamped = Math.max(this.targetProgress, Math.min(100, Math.round(percent)));
    this.targetProgress = clamped;
    this.ensureSmoothTick();
  }

  /**
   * Advances loading progress and yields a single animation frame so the sparrow
   * silhouette fill visibly paints between world build stages.
   */
  public async advance(percent: number): Promise<void> {
    this.setProgress(percent);
    await new Promise<void>((resolve) => {
      let resolved = false;
      const done = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      const fallback = window.setTimeout(done, 22);
      window.requestAnimationFrame(() => {
        window.clearTimeout(fallback);
        done();
      });
    });
  }

  public showError(message: string): void {
    this.hasError = true;
    if (this.rafId !== 0) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.statusEl) {
      this.statusEl.textContent = message;
      this.statusEl.classList.remove('is-hidden');
      this.statusEl.classList.add('is-error');
    }
    if (this.startBtn) {
      this.startBtn.classList.add('is-hidden');
    }
  }

  /**
   * Finishes filling the sparrow silhouette to 100%, replaces "Loading" with "Press Start",
   * and resolves once the user clicks Press Start (or presses Enter/Space).
   */
  public async waitForStart(): Promise<void> {
    if (this.started) return;
    this.setProgress(100);

    if (new URLSearchParams(window.location.search).get('autostart') === '1') {
      this.dismiss();
      return;
    }

    // Wait briefly until visual fill reaches 100%
    await new Promise<void>((resolve) => {
      const startWait = performance.now();
      const poll = () => {
        if (this.visualProgress >= 99.8 || performance.now() - startWait > 420) {
          this.visualProgress = 100;
          this.applyVisualFill(100);
          resolve();
          return;
        }
        window.requestAnimationFrame(poll);
      };
      window.requestAnimationFrame(poll);
    });

    if (this.statusEl) {
      this.statusEl.classList.add('is-hidden');
    }
    if (this.startBtn) {
      this.startBtn.classList.remove('is-hidden');
      this.startBtn.focus({ preventScroll: true });
    }

    await new Promise<void>((resolve) => {
      const triggerStart = (e?: Event) => {
        if (this.started) return;
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        cleanup();
        this.dismiss();
        resolve();
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Enter' || e.code === 'Space') {
          triggerStart(e);
        }
      };

      const onRootClick = (e: MouseEvent) => {
        if (e.button === 0) {
          triggerStart(e);
        }
      };

      const onRootTouchEnd = (e: TouchEvent) => {
        triggerStart(e);
      };

      const cleanup = () => {
        this.startBtn?.removeEventListener('click', triggerStart);
        this.startBtn?.removeEventListener('touchend', onRootTouchEnd);
        this.root?.removeEventListener('click', onRootClick);
        this.root?.removeEventListener('touchend', onRootTouchEnd);
        window.removeEventListener('keydown', onKeyDown, true);
      };

      this.startBtn?.addEventListener('click', triggerStart);
      this.startBtn?.addEventListener('touchend', onRootTouchEnd, { passive: false });
      this.root?.addEventListener('click', onRootClick);
      this.root?.addEventListener('touchend', onRootTouchEnd, { passive: false });
      window.addEventListener('keydown', onKeyDown, true);
    });
  }

  public dismiss(): void {
    if (this.started) return;
    this.started = true;
    document.body.dataset.state = 'playing';
    this.targetProgress = 100;
    this.visualProgress = 100;
    this.applyVisualFill(100);
    if (this.rafId !== 0) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    if (this.root) {
      this.root.classList.add('is-loaded');
      window.setTimeout(() => {
        if (this.root && this.root.parentElement) {
          this.root.style.display = 'none';
        }
      }, 620);
    }
  }
}
