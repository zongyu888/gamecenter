export type SparrowDeedId =
  | 'croissant_heist'
  | 'coffee_bowling'
  | 'sleepy_sugar'
  | 'pigeon_scatter'
  | 'picnic_raid'
  | 'busker_coins'
  | 'canal_prank'
  | 'painter_muse'
  | 'apple_avalanche'
  | 'music_box'
  | 'belfry_bell'
  | 'sky_sanctuary';

export interface SparrowDeedDef {
  id: SparrowDeedId;
  label: string;
}

export const SPARROW_DEEDS: readonly SparrowDeedDef[] = [
  {
    id: 'croissant_heist',
    label: 'Snatch a warm croissant from the boulangerie',
  },
  {
    id: 'coffee_bowling',
    label: 'Bowl a giant to-go coffee cup off a bistro table',
  },
  {
    id: 'sleepy_sugar',
    label: "Drop a sugar cube into the drowsy commuter's mug",
  },
  {
    id: 'pigeon_scatter',
    label: 'Swoop or chirp to scatter the fountain pigeon flock',
  },
  {
    id: 'picnic_raid',
    label: 'Peck open the wicker picnic basket in the gazebo',
  },
  {
    id: 'busker_coins',
    label: "Toss 3 shiny coins into the busker's guitar case",
  },
  {
    id: 'canal_prank',
    label: 'Ring a vintage bicycle bell or topple a gelato cone',
  },
  {
    id: 'painter_muse',
    label: 'Bring glasses & 2 blossoms to the balcony painter',
  },
  {
    id: 'apple_avalanche',
    label: "Topple the fruit vendor's stacked apple pyramid",
  },
  {
    id: 'music_box',
    label: 'Wind the bookshop music box with the brass key',
  },
  {
    id: 'belfry_bell',
    label: 'Peck the great bronze bell atop the clocktower',
  },
  {
    id: 'sky_sanctuary',
    label: 'Weave 4 treasures into the Clocktower Sky Nest',
  },
];

interface CachedDeedRow {
  li: HTMLLIElement;
  check: HTMLSpanElement;
}

/**
 * Compact French-postcard Mischief & Deeds HUD.
 * Hidden during the indoor tutorial so onboarding shows only key prompts.
 * Built with safe DOM APIs (createElement, textContent; no innerHTML).
 * Toggled with the `J` key or an accessible `<button>` (`Tab` stays free for focus navigation).
 */
export class SparrowJournalHUD {
  private readonly root: HTMLDivElement;
  private readonly pillBtn: HTMLButtonElement;
  private readonly seedCountEl: HTMLSpanElement;
  private readonly deedCountEl: HTMLSpanElement;
  private readonly keyCapEl: HTMLElement;
  private readonly cardEl: HTMLDivElement;
  private readonly toastHost: HTMLDivElement;

  private readonly rowElements = new Map<SparrowDeedId, CachedDeedRow>();
  private readonly completed = new Set<SparrowDeedId>();
  private expanded = false;
  private visible = false;
  private mobileMode = false;
  public onToggleMute?: () => boolean;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'journal-hud is-hidden';
    this.root.setAttribute('aria-hidden', 'true');

    const topBar = document.createElement('div');
    topBar.className = 'journal-top-bar';

    // Top-left compact interactive button pill
    this.pillBtn = document.createElement('button');
    this.pillBtn.type = 'button';
    this.pillBtn.className = 'journal-pill';
    this.pillBtn.setAttribute('aria-expanded', 'false');
    this.pillBtn.setAttribute('aria-label', 'Toggle Deeds List (Key J)');

    const seedWrap = document.createElement('span');
    seedWrap.className = 'journal-stat';
    const seedDot = document.createElement('span');
    seedDot.className = 'journal-seed-dot';
    seedDot.setAttribute('aria-hidden', 'true');
    this.seedCountEl = document.createElement('span');
    this.seedCountEl.textContent = '0';
    seedWrap.appendChild(seedDot);
    seedWrap.appendChild(this.seedCountEl);

    const divider = document.createElement('span');
    divider.className = 'journal-sep';
    divider.setAttribute('aria-hidden', 'true');
    divider.textContent = '·';

    this.deedCountEl = document.createElement('span');
    this.deedCountEl.className = 'journal-stat';
    this.deedCountEl.textContent = `0 / ${SPARROW_DEEDS.length}`;

    this.keyCapEl = document.createElement('kbd');
    this.keyCapEl.className = 'journal-tab-key';
    this.keyCapEl.textContent = 'J';

    this.pillBtn.appendChild(seedWrap);
    this.pillBtn.appendChild(divider);
    this.pillBtn.appendChild(this.deedCountEl);
    this.pillBtn.appendChild(this.keyCapEl);

    let lastPillTouchToggleMs = 0;
    this.pillBtn.addEventListener(
      'touchend',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        lastPillTouchToggleMs = performance.now();
        this.setExpanded(!this.expanded);
      },
      { passive: false }
    );
    this.pillBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (performance.now() - lastPillTouchToggleMs < 450) return;
      this.setExpanded(!this.expanded);
    });

    topBar.appendChild(this.pillBtn);

    // Expandable Postcard Checklist (one row per deed)
    this.cardEl = document.createElement('div');
    this.cardEl.className = 'journal-card';
    this.cardEl.setAttribute('aria-hidden', 'true');
    this.cardEl.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
    this.cardEl.addEventListener('click', (e) => e.stopPropagation());

    const list = document.createElement('ul');
    list.className = 'journal-list';

    for (const deed of SPARROW_DEEDS) {
      const li = document.createElement('li');
      li.className = 'journal-item';

      const check = document.createElement('span');
      check.className = 'journal-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '';

      const text = document.createElement('span');
      text.className = 'journal-label';
      text.textContent = deed.label;

      li.appendChild(check);
      li.appendChild(text);
      list.appendChild(li);
      this.rowElements.set(deed.id, { li, check });
    }

    this.cardEl.appendChild(list);
    this.root.appendChild(topBar);
    this.root.appendChild(this.cardEl);
    parent.appendChild(this.root);

    // Celebratory completion toast container (top-right, screen-reader polite live region)
    this.toastHost = document.createElement('div');
    this.toastHost.className = 'journal-toast-host';
    this.toastHost.setAttribute('role', 'status');
    this.toastHost.setAttribute('aria-live', 'polite');
    parent.appendChild(this.toastHost);

    window.addEventListener('pointerdown', (e) => {
      if (!this.expanded) return;
      if (e.target instanceof Element && e.target.closest('.journal-hud')) return;
      this.setExpanded(false);
    });

    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'KeyJ' && this.visible) {
        e.preventDefault();
        this.setExpanded(!this.expanded);
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        this.onToggleMute?.();
      }
    });
  }

  public setMobileMode(isMobile: boolean): void {
    this.mobileMode = isMobile;
    this.root.classList.toggle('is-mobile', isMobile);
    this.keyCapEl.style.display = isMobile ? 'none' : '';
    this.pillBtn.setAttribute(
      'aria-label',
      isMobile ? 'Toggle Deeds List' : 'Toggle Deeds List (Key J)'
    );
  }

  public isMobileMode(): boolean {
    return this.mobileMode;
  }

  public setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.root.classList.toggle('is-hidden', !visible);
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (!visible && this.expanded) {
      this.setExpanded(false);
    }
  }

  public setExpanded(expanded: boolean): void {
    this.expanded = expanded;
    this.root.classList.toggle('is-expanded', expanded);
    this.pillBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    this.cardEl.setAttribute('aria-hidden', expanded ? 'false' : 'true');
  }

  public setSeedsCount(count: number): void {
    this.seedCountEl.textContent = String(count);
  }

  public getCompletedCount(): number {
    return this.completed.size;
  }

  public getTotalCount(): number {
    return SPARROW_DEEDS.length;
  }

  public isDeedCompleted(id: SparrowDeedId): boolean {
    return this.completed.has(id);
  }

  public completeDeed(id: SparrowDeedId): boolean {
    if (this.completed.has(id)) return false;
    this.completed.add(id);

    const row = this.rowElements.get(id);
    if (row) {
      row.li.classList.add('is-done');
      row.check.textContent = '✓';
    }

    this.deedCountEl.textContent = `${this.completed.size} / ${SPARROW_DEEDS.length}`;

    const def = SPARROW_DEEDS.find((d) => d.id === id);
    if (def && this.visible) {
      this.spawnStampToast(def);
    }
    return true;
  }

  public spawnCoronationToast(): void {
    if (!this.visible) return;
    const toast = document.createElement('div');
    toast.className = 'journal-toast is-royal';

    const stamp = document.createElement('span');
    stamp.className = 'journal-toast-stamp';
    stamp.setAttribute('aria-hidden', 'true');
    stamp.textContent = '♛';

    const title = document.createElement('span');
    title.className = 'journal-toast-label';
    title.textContent = 'Crown of the Neighborhood!';

    toast.appendChild(stamp);
    toast.appendChild(title);
    this.toastHost.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => {
        toast.remove();
      }, 420);
    }, 3800);
  }

  private spawnStampToast(def: SparrowDeedDef): void {
    const toast = document.createElement('div');
    toast.className = 'journal-toast';

    const stamp = document.createElement('span');
    stamp.className = 'journal-toast-stamp';
    stamp.setAttribute('aria-hidden', 'true');
    stamp.textContent = '✓';

    const title = document.createElement('span');
    title.className = 'journal-toast-label';
    title.textContent = def.label;

    toast.appendChild(stamp);
    toast.appendChild(title);
    this.toastHost.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.add('is-leaving');
      window.setTimeout(() => {
        toast.remove();
      }, 420);
    }, 3100);
  }
}
