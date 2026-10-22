import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import {
  BonusPick,
  Grid,
  LinesRoundResult,
  LinesSpin,
  SLOT_CONFIGS,
  SlotConfig,
  WaysRoundResult,
  gridFromStops,
} from '@casino/game-engine';
import type { SlotSpinResponse } from '@casino/shared-types';
import { CreditsPipe, ModalComponent, formatCredits } from '@casino/ui';
import { errorMessage } from '../../core/api-error';
import { Announcer } from '../../core/announcer.service';
import { PreferencesStore } from '../../core/preferences.store';
import { SoundService } from '../../core/sound.service';
import { ToastService } from '../../core/toast.service';
import { WalletStore } from '../../core/wallet.store';
import { AutoplayDialogComponent } from './autoplay-dialog.component';
import { BonusPickComponent } from './bonus-pick.component';
import { PaytableComponent } from './paytable.component';
import { LinesReelsRenderer } from './renderer/lines-reels.renderer';
import { WaysReelsRenderer } from './renderer/ways-reels.renderer';
import { SlotApi } from './slot-api.service';
import {
  AutoplayProgress,
  AutoplaySettings,
  AutoplayStop,
  WinTier,
  autoplayStopReason,
  countUpMs,
  describeGrid,
  describeOutcome,
  describeWaysOutcome,
  winTier,
} from './slot-presentation';

interface Banner {
  readonly tier: WinTier;
  readonly amount: number;
  readonly label: string;
}

interface PendingBonus {
  readonly picks: readonly BonusPick[];
  readonly boxes: number;
  readonly resolve: () => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Component({
  selector: 'cas-slot-page',
  imports: [
    RouterLink,
    CreditsPipe,
    ModalComponent,
    PaytableComponent,
    AutoplayDialogComponent,
    BonusPickComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './slot.page.html',
  styleUrl: './slot.page.scss',
})
export class SlotPage {
  /** Route parameter. */
  readonly gameId = input.required<string>();

  protected readonly wallet = inject(WalletStore);
  protected readonly prefs = inject(PreferencesStore);
  private readonly api = inject(SlotApi);
  private readonly sound = inject(SoundService);
  private readonly announcer = inject(Announcer);
  private readonly toasts = inject(ToastService);
  private readonly title = inject(Title);

  private readonly stageRef = viewChild<ElementRef<HTMLElement>>('stage');
  private lines: LinesReelsRenderer | null = null;
  private ways: WaysReelsRenderer | null = null;
  private destroyed = false;

  protected readonly config = computed<SlotConfig | null>(() =>
    Object.hasOwn(SLOT_CONFIGS, this.gameId())
      ? SLOT_CONFIGS[this.gameId()]
      : null,
  );

  protected readonly betIndex = signal(1);
  protected readonly totalBet = computed(() => {
    const options = this.config()?.betOptions ?? [0];
    return options[Math.min(this.betIndex(), options.length - 1)];
  });
  protected readonly phase = signal<'loading' | 'idle' | 'spinning'>('loading');
  protected readonly grid = signal<Grid>([]);
  protected readonly banner = signal<Banner | null>(null);
  protected readonly bannerValue = signal(0);
  protected readonly lastWin = signal(0);
  protected readonly freeSpinsLeft = signal<number | null>(null);
  protected readonly cascadeMultiplier = signal<number | null>(null);
  protected readonly autoplay = signal<AutoplayProgress | null>(null);
  protected readonly paytableOpen = signal(false);
  protected readonly autoplayOpen = signal(false);
  protected readonly bonus = signal<PendingBonus | null>(null);
  protected readonly lastFairness = signal<SlotSpinResponse['fairness'] | null>(
    null,
  );
  protected readonly lastRoundId = signal<string | null>(null);

  protected readonly canAfford = computed(
    () => (this.wallet.balance() ?? 0) >= this.totalBet(),
  );
  protected readonly canSpin = computed(
    () =>
      this.phase() === 'idle' && this.canAfford() && this.autoplay() === null,
  );
  protected readonly gridDescription = computed(() => {
    const config = this.config();
    return config && this.grid().length
      ? describeGrid(config, this.grid())
      : '';
  });
  protected readonly aspectRatio = computed(() => {
    const c = this.config();
    if (!c) return '1';
    return c.kind === 'lines'
      ? `${c.reels.length * 1.06} / ${c.rows}`
      : `${c.reels.length} / ${c.maxRows}`;
  });

  constructor() {
    effect(() => {
      const name = this.config()?.name;
      if (name) this.title.setTitle(`${name} · Casino`);
    });
    effect(() => {
      const options = {
        reducedMotion: this.prefs.reducedMotion(),
        turbo: this.prefs.turbo(),
      };
      untracked(() => {
        this.lines?.setOptions(options);
        this.ways?.setOptions(options);
      });
    });

    afterNextRender(() => void this.initRenderer());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.autoplay.set(null);
      this.bonus()?.resolve();
      this.lines?.destroy();
      this.ways?.destroy();
      this.sound.stop('spin');
      this.wallet.release();
    });
  }

  private async initRenderer(): Promise<void> {
    const config = this.config();
    const host = this.stageRef()?.nativeElement;
    if (!config || !host) return;
    const options = {
      reducedMotion: this.prefs.reducedMotion(),
      turbo: this.prefs.turbo(),
      onReelStop: () => this.sound.play('stop'),
    };
    let initial: Grid;
    if (config.kind === 'lines') {
      const renderer = await LinesReelsRenderer.create(host, config, options);
      if (this.destroyed) return renderer.destroy();
      initial = gridFromStops(
        config,
        config.reels.map((strip, r) => (r * 11) % strip.length),
      );
      renderer.setGrid(initial);
      this.lines = renderer;
    } else {
      const renderer = await WaysReelsRenderer.create(host, config, {
        ...options,
        onCascade: (i) => {
          if (i > 0) this.sound.play('win');
        },
      });
      if (this.destroyed) return renderer.destroy();
      const rows = [4, 5, 6, 6, 5, 4];
      initial = config.reels.map((strip, r) =>
        Array.from(
          { length: rows[r] ?? 4 },
          (_, i) => strip[(r * 9 + i) % strip.length],
        ),
      );
      renderer.setGrid(initial);
      this.ways = renderer;
    }
    this.grid.set(initial);
    this.phase.set('idle');
  }

  // ------------------------------------------------------------------ controls

  protected changeBet(delta: number): void {
    const options = this.config()?.betOptions.length ?? 1;
    this.betIndex.update((i) => Math.max(0, Math.min(options - 1, i + delta)));
    this.sound.play('click');
    this.announcer.announce(
      $localize`:@@slot.betChanged:Bet ${formatCredits(this.totalBet())}:bet: credits`,
    );
  }

  protected onStageKey(event: Event): void {
    event.preventDefault(); // Space would otherwise scroll the page
    if (this.canSpin()) void this.spin();
  }

  protected async spin(): Promise<void> {
    if (!this.canSpin()) return;
    await this.spinOnce();
  }

  protected startAutoplay(settings: AutoplaySettings): void {
    this.autoplayOpen.set(false);
    if (this.phase() !== 'idle') return;
    this.autoplay.set({
      settings,
      played: 0,
      startBalance: this.wallet.balance() ?? 0,
    });
    this.announcer.announce(
      $localize`:@@slot.autoplayStarted:Autoplay started for ${settings.spins}:spins: spins.`,
    );
    void this.runAutoplay();
  }

  protected stopAutoplay(reason: AutoplayStop = null): void {
    if (!this.autoplay()) return;
    this.autoplay.set(null);
    this.announcer.announce(stopMessage(reason));
  }

  protected toggleTurbo(): void {
    this.prefs.setTurbo(!this.prefs.turbo());
  }

  protected finishBonus(): void {
    const pending = this.bonus();
    this.bonus.set(null);
    pending?.resolve();
  }

  // ------------------------------------------------------------------ round flow

  private async runAutoplay(): Promise<void> {
    while (!this.destroyed) {
      if (!this.autoplay()) return;
      const res = await this.spinOnce();
      const current = this.autoplay();
      if (!res || !current) return this.stopAutoplay(res ? null : 'balance');
      const next: AutoplayProgress = { ...current, played: current.played + 1 };
      this.autoplay.set(next);
      const reason = autoplayStopReason(
        next,
        res.result,
        res.balance,
        this.totalBet(),
      );
      if (reason) return this.stopAutoplay(reason);
      await sleep(this.prefs.turbo() ? 150 : 650);
    }
  }

  /** One paid round: animate while the server resolves it, then reveal exactly what it returned. */
  private async spinOnce(): Promise<SlotSpinResponse | null> {
    const config = this.config();
    if (!config || (!this.lines && !this.ways)) return null;
    const bet = this.totalBet();
    const before = this.wallet.balance() ?? 0;
    if (before < bet) {
      this.toasts.error(
        $localize`:@@slot.insufficient:Not enough credits for this bet.`,
      );
      return null;
    }

    this.phase.set('spinning');
    this.banner.set(null);
    this.lastWin.set(0);
    this.wallet.hold();
    this.wallet.setBalance(before - bet);
    this.sound.play('spin');
    this.lines?.spin();
    this.ways?.spin();

    let res: SlotSpinResponse;
    try {
      res = await this.api.spin(config.id, bet);
    } catch (err) {
      this.lines?.abort(this.grid());
      this.ways?.abort(this.grid());
      this.sound.stop('spin');
      this.wallet.setBalance(before);
      this.wallet.release();
      const message = errorMessage(err);
      this.toasts.error(message);
      this.announcer.announce(message, 'assertive');
      this.phase.set('idle');
      return null;
    }

    let outcome = '';
    try {
      if (
        res.result.kind === 'lines' &&
        this.lines &&
        config.kind === 'lines'
      ) {
        const result = res.result;
        await this.reveal(this.lines, result.base, bet);
        if (result.freeSpins) await this.playFreeSpins(this.lines, result, bet);
        if (result.bonus) await this.playBonus(result);
        if (result.freeSpins || result.bonus)
          await this.celebrate(result.totalWin, bet);
        outcome = describeOutcome(config, result);
      } else if (
        res.result.kind === 'ways' &&
        this.ways &&
        config.kind === 'ways'
      ) {
        await this.playCascades(this.ways, res.result, bet);
        outcome = describeWaysOutcome(config, res.result);
      }
    } finally {
      this.sound.stop('spin');
      this.freeSpinsLeft.set(null);
      this.cascadeMultiplier.set(null);
      this.wallet.setBalance(res.balance);
      this.wallet.release();
      this.lastWin.set(res.payout);
      this.lastFairness.set(res.fairness);
      this.lastRoundId.set(res.roundId);
      if (outcome) this.announcer.announce(outcome);
      this.phase.set('idle');
    }
    return res;
  }

  private async reveal(
    renderer: LinesReelsRenderer,
    spin: LinesSpin,
    bet: number,
  ): Promise<void> {
    await renderer.stop(spin.grid);
    this.sound.stop('spin');
    this.grid.set(spin.grid);
    if (spin.win > 0) {
      renderer.showWins(spin.lineWins, spin.scatterWin);
      await this.celebrate(spin.win, bet);
    } else if (spin.scatterWin) {
      renderer.showWins([], spin.scatterWin);
    }
  }

  private async playCascades(
    renderer: WaysReelsRenderer,
    result: WaysRoundResult,
    bet: number,
  ): Promise<void> {
    const steps = result.cascades.filter((c) => c.wins.length > 0).length;
    if (steps > 1) this.cascadeMultiplier.set(1);
    await renderer.play(result.cascades);
    this.sound.stop('spin');
    this.grid.set(result.cascades[result.cascades.length - 1].grid);
    if (steps > 0)
      this.cascadeMultiplier.set(result.cascades[steps - 1].multiplier);
    await this.celebrate(result.totalWin, bet);
  }

  private async playFreeSpins(
    renderer: LinesReelsRenderer,
    result: LinesRoundResult,
    bet: number,
  ): Promise<void> {
    const fs = result.freeSpins;
    if (!fs) return;
    this.sound.play('feature');
    this.announcer.announce(
      $localize`:@@slot.freeSpins:${fs.awarded}:count: free spins awarded!`,
    );
    await sleep(this.prefs.reducedMotion() ? 300 : 1200);
    for (let i = 0; i < fs.spins.length && !this.destroyed; i++) {
      this.freeSpinsLeft.set(fs.spins.length - i);
      this.sound.play('spin');
      renderer.spin();
      await this.reveal(renderer, fs.spins[i], bet);
      await sleep(this.prefs.turbo() ? 120 : 450);
    }
  }

  /** Opens the pick-me bonus and waits until the player has opened their chests. */
  private async playBonus(result: LinesRoundResult): Promise<void> {
    const bonus = result.bonus;
    if (!bonus) return;
    this.sound.play('feature');
    this.announcer.announce(
      $localize`:@@slot.bonusStart:Bonus game! Pick treasure chests.`,
    );
    // Autoplay cannot pick for the player: reveal everything automatically instead.
    if (this.autoplay()) {
      const amount = formatCredits(bonus.win);
      this.announcer.announce(
        $localize`:@@slot.bonusWon:Bonus game: you picked ${bonus.picks.length}:picks: boxes and won ${amount}:amount: credits.`,
      );
      await sleep(this.prefs.reducedMotion() ? 300 : 1500);
      return;
    }
    await new Promise<void>((resolve) =>
      this.bonus.set({ picks: bonus.picks, boxes: bonus.boxes, resolve }),
    );
  }

  /** Win banner and sound, scaled by the size of the win relative to the stake. */
  private async celebrate(amount: number, bet: number): Promise<void> {
    const tier = winTier(amount, bet);
    if (tier === 'none') return;
    this.sound.play(tier === 'big' || tier === 'mega' ? 'bigwin' : 'win');
    this.banner.set({ tier, amount, label: tierLabel(tier) });
    const duration = countUpMs(
      tier,
      this.prefs.reducedMotion(),
      this.prefs.turbo(),
    );
    if (duration === 0) {
      this.bannerValue.set(amount);
      return;
    }
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        const t = Math.min(1, (now - start) / duration);
        this.bannerValue.set(Math.round(amount * (1 - Math.pow(1 - t, 3))));
        if (t < 1 && !this.destroyed) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }
}

function tierLabel(tier: WinTier): string {
  switch (tier) {
    case 'mega':
      return $localize`:@@slot.tier.mega:Mega win!`;
    case 'big':
      return $localize`:@@slot.tier.big:Big win!`;
    case 'medium':
      return $localize`:@@slot.tier.medium:Nice win!`;
    default:
      return $localize`:@@slot.tier.small:Win`;
  }
}

function stopMessage(reason: AutoplayStop): string {
  switch (reason) {
    case 'loss-limit':
      return $localize`:@@slot.stop.loss:Autoplay stopped: loss limit reached.`;
    case 'single-win':
      return $localize`:@@slot.stop.win:Autoplay stopped: win limit reached.`;
    case 'feature':
      return $localize`:@@slot.stop.feature:Autoplay stopped: feature triggered.`;
    case 'balance':
      return $localize`:@@slot.stop.balance:Autoplay stopped: not enough credits.`;
    case 'done':
      return $localize`:@@slot.stop.done:Autoplay finished.`;
    default:
      return $localize`:@@slot.stop.manual:Autoplay stopped.`;
  }
}
