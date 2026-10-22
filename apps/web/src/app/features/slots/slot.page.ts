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
  Grid,
  LinesRoundResult,
  LinesSlotConfig,
  LinesSpin,
  SLOT_CONFIGS,
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
import { PaytableComponent } from './paytable.component';
import { LinesReelsRenderer } from './renderer/lines-reels.renderer';
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
  winTier,
} from './slot-presentation';

interface Banner {
  readonly tier: WinTier;
  readonly amount: number;
  readonly label: string;
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
  private renderer: LinesReelsRenderer | null = null;
  private destroyed = false;

  protected readonly config = computed<LinesSlotConfig | null>(() => {
    const config = Object.hasOwn(SLOT_CONFIGS, this.gameId())
      ? SLOT_CONFIGS[this.gameId()]
      : undefined;
    return config?.kind === 'lines' ? config : null;
  });

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
  protected readonly autoplay = signal<AutoplayProgress | null>(null);
  protected readonly paytableOpen = signal(false);
  protected readonly autoplayOpen = signal(false);
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
    return c ? `${c.reels.length * 1.06} / ${c.rows}` : '1';
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
      untracked(() => this.renderer?.setOptions(options));
    });

    afterNextRender(() => void this.initRenderer());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.autoplay.set(null);
      this.renderer?.destroy();
      this.sound.stop('spin');
      this.wallet.release();
    });
  }

  private async initRenderer(): Promise<void> {
    const config = this.config();
    const host = this.stageRef()?.nativeElement;
    if (!config || !host) return;
    const renderer = await LinesReelsRenderer.create(host, config, {
      reducedMotion: this.prefs.reducedMotion(),
      turbo: this.prefs.turbo(),
      onReelStop: () => this.sound.play('stop'),
    });
    if (this.destroyed) {
      renderer.destroy();
      return;
    }
    this.renderer = renderer;
    const initial = gridFromStops(
      config,
      config.reels.map((strip, r) => (r * 11) % strip.length),
    );
    renderer.setGrid(initial);
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

  // ------------------------------------------------------------------ round flow

  private async runAutoplay(): Promise<void> {
    while (!this.destroyed) {
      const progress = this.autoplay();
      if (!progress) return;
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
    const renderer = this.renderer;
    if (!config || !renderer) return null;
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
    renderer.spin();

    let res: SlotSpinResponse;
    try {
      res = await this.api.spin(config.id, bet);
    } catch (err) {
      renderer.abort(this.grid());
      this.sound.stop('spin');
      this.wallet.setBalance(before);
      this.wallet.release();
      const message = errorMessage(err);
      this.toasts.error(message);
      this.announcer.announce(message, 'assertive');
      this.phase.set('idle');
      return null;
    }

    const result = res.result as LinesRoundResult;
    try {
      await this.reveal(renderer, result.base, bet);
      if (result.freeSpins) await this.playFreeSpins(renderer, result, bet);
      if (result.bonus) await this.showBonus(result);
      if (result.freeSpins || result.bonus)
        await this.celebrate(result.totalWin, bet);
    } finally {
      this.sound.stop('spin');
      this.freeSpinsLeft.set(null);
      this.wallet.setBalance(res.balance);
      this.wallet.release();
      this.lastWin.set(res.payout);
      this.lastFairness.set(res.fairness);
      this.lastRoundId.set(res.roundId);
      this.announcer.announce(describeOutcome(config, result));
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

  private async showBonus(result: LinesRoundResult): Promise<void> {
    if (!result.bonus) return;
    this.sound.play('feature');
    const amount = formatCredits(result.bonus.win);
    this.announcer.announce(
      $localize`:@@slot.bonusWon:Bonus game: you picked ${result.bonus.picks.length}:picks: boxes and won ${amount}:amount: credits.`,
    );
    await sleep(this.prefs.reducedMotion() ? 300 : 1500);
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
