import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  CHIP_DENOMINATIONS,
  DEFAULT_ROULETTE_LIMITS,
  RacetrackBet,
  RouletteRoundResult,
  expandRacetrack,
  hotColdStats,
  pocketColor,
  validateRouletteBets,
} from '@casino/game-engine';
import type { RoundResponse } from '@casino/shared-types';
import { CreditsPipe, formatCredits } from '@casino/ui';
import { errorMessage } from '../../core/api-error';
import { Announcer } from '../../core/announcer.service';
import { GameApi } from '../../core/game-api.service';
import { PreferencesStore } from '../../core/preferences.store';
import { SoundService } from '../../core/sound.service';
import { ToastService } from '../../core/toast.service';
import { WalletStore } from '../../core/wallet.store';
import {
  BetSpec,
  betKey,
  outsideSpots,
  tableSpots,
  withAmount,
} from './table-layout';
import { WheelRenderer } from './wheel.renderer';

interface Placed {
  spec: BetSpec;
  amount: number;
}

type Slip = ReadonlyMap<string, Placed>;

@Component({
  selector: 'cas-roulette-page',
  imports: [CreditsPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './roulette.page.html',
  styleUrl: './roulette.page.scss',
})
export class RoulettePage {
  protected readonly wallet = inject(WalletStore);
  private readonly api = inject(GameApi);
  private readonly prefs = inject(PreferencesStore);
  private readonly sound = inject(SoundService);
  private readonly announcer = inject(Announcer);
  private readonly toasts = inject(ToastService);

  private readonly wheelHost = viewChild<ElementRef<HTMLElement>>('wheel');
  private wheel: WheelRenderer | null = null;
  private destroyed = false;

  protected readonly spots = tableSpots();
  protected readonly outside = outsideSpots();
  protected readonly chips = CHIP_DENOMINATIONS;
  protected readonly limits = DEFAULT_ROULETTE_LIMITS;

  protected readonly chip = signal<number>(CHIP_DENOMINATIONS[1]);
  protected readonly slip = signal<Slip>(new Map());
  private readonly undoStack = signal<Slip[]>([]);
  private readonly lastSlip = signal<Slip | null>(null);
  protected readonly spinning = signal(false);
  protected readonly hover = signal<readonly number[]>([]);
  protected readonly result = signal<RouletteRoundResult | null>(null);
  protected readonly lastPayout = signal(0);
  protected readonly history = signal<number[]>([]);
  protected readonly racetrack: readonly {
    name: RacetrackBet;
    label: string;
  }[] = [
    {
      name: 'voisins',
      label: $localize`:@@roulette.voisins:Voisins du zéro (9 chips)`,
    },
    {
      name: 'tiers',
      label: $localize`:@@roulette.tiers:Tiers du cylindre (6 chips)`,
    },
    {
      name: 'orphelins',
      label: $localize`:@@roulette.orphelins:Orphelins (5 chips)`,
    },
  ];

  protected readonly total = computed(() =>
    [...this.slip().values()].reduce((s, b) => s + b.amount, 0),
  );
  protected readonly canUndo = computed(
    () => this.undoStack().length > 0 && !this.spinning(),
  );
  protected readonly canRebet = computed(
    () =>
      this.lastSlip() !== null && this.slip().size === 0 && !this.spinning(),
  );
  protected readonly canSpin = computed(
    () =>
      this.slip().size > 0 &&
      !this.spinning() &&
      (this.wallet.balance() ?? 0) >= this.total(),
  );
  protected readonly stats = computed(() => hotColdStats(this.history(), 5));
  protected readonly colourOf = pocketColor;

  constructor() {
    afterNextRender(async () => {
      const host = this.wheelHost()?.nativeElement;
      if (!host) return;
      const wheel = await WheelRenderer.create(host);
      if (this.destroyed) wheel.destroy();
      else this.wheel = wheel;
    });
    void this.loadHistory();
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.wheel?.destroy();
      this.wallet.release();
    });
  }

  /** Short chip face: 0.1, 0.5, 1, 5, 10, 50. */
  protected chipLabel(minor: number): string {
    return minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(1);
  }

  amountOn(key: string): number {
    return this.slip().get(key)?.amount ?? 0;
  }

  protected place(spec: BetSpec, label: string): void {
    if (this.spinning()) return;
    this.result.set(null);
    const key = betKey(spec);
    const next = new Map(this.slip());
    const current = next.get(key)?.amount ?? 0;
    next.set(key, { spec, amount: current + this.chip() });
    if (!this.commit(next)) return;
    this.sound.play('click');
    this.announcer.announce(
      $localize`:@@roulette.placed:${formatCredits(current + this.chip())}:amount: on ${label}:label:. Total bet ${formatCredits(this.total())}:total:.`,
    );
  }

  protected placeRacetrack(name: RacetrackBet): void {
    if (this.spinning()) return;
    const next = new Map(this.slip());
    for (const bet of expandRacetrack(name, this.chip())) {
      const { amount, ...spec } = bet;
      const key = betKey(spec as BetSpec);
      next.set(key, {
        spec: spec as BetSpec,
        amount: (next.get(key)?.amount ?? 0) + amount,
      });
    }
    if (this.commit(next)) this.sound.play('click');
  }

  protected undo(): void {
    const stack = this.undoStack();
    if (!stack.length) return;
    this.slip.set(stack[stack.length - 1]);
    this.undoStack.set(stack.slice(0, -1));
  }

  protected clear(): void {
    if (this.slip().size === 0) return;
    this.undoStack.update((s) => [...s, this.slip()]);
    this.slip.set(new Map());
  }

  protected rebet(): void {
    const last = this.lastSlip();
    if (last) this.commit(new Map(last));
  }

  protected double(): void {
    const doubled = new Map(
      [...this.slip()].map(([k, b]) => [k, { ...b, amount: b.amount * 2 }]),
    );
    this.commit(doubled);
  }

  /** Applies a new slip if it respects the table limits and the balance. */
  private commit(next: Slip): boolean {
    const bets = [...next.values()].map((b) => withAmount(b.spec, b.amount));
    try {
      if (bets.length) validateRouletteBets(bets, this.limits);
    } catch (err) {
      this.toasts.error((err as Error).message);
      return false;
    }
    const total = bets.reduce((s, b) => s + b.amount, 0);
    if (total > (this.wallet.balance() ?? 0)) {
      this.toasts.error(
        $localize`:@@roulette.tooMuch:That would exceed your balance.`,
      );
      return false;
    }
    this.undoStack.update((s) => [...s.slice(-49), this.slip()]);
    this.slip.set(next);
    return true;
  }

  protected async spin(): Promise<void> {
    if (!this.canSpin()) return;
    const slip = this.slip();
    const bets = [...slip.values()].map((b) => withAmount(b.spec, b.amount));
    const before = this.wallet.balance() ?? 0;
    this.spinning.set(true);
    this.result.set(null);
    this.wallet.hold();
    this.wallet.setBalance(before - this.total());
    this.announcer.announce(
      $localize`:@@roulette.noMoreBets:No more bets. The ball is spinning.`,
    );
    this.sound.play('spin');

    let res: RoundResponse<RouletteRoundResult>;
    try {
      res = await this.api.bet<RoundResponse<RouletteRoundResult>>(
        '/api/games/roulette/spin',
        { bets },
      );
    } catch (err) {
      this.wallet.setBalance(before);
      this.wallet.release();
      this.spinning.set(false);
      const message = errorMessage(err);
      this.toasts.error(message);
      this.announcer.announce(message, 'assertive');
      return;
    }

    try {
      await this.wheel?.spinTo(res.result.number, {
        reducedMotion: this.prefs.reducedMotion(),
        turbo: this.prefs.turbo(),
      });
    } finally {
      this.sound.stop('spin');
      this.sound.play(res.payout > 0 ? 'win' : 'stop');
      this.result.set(res.result);
      this.lastPayout.set(res.payout);
      this.history.update((h) => [res.result.number, ...h].slice(0, 20));
      this.lastSlip.set(slip);
      this.slip.set(new Map());
      this.undoStack.set([]);
      this.wallet.setBalance(res.balance);
      this.wallet.release();
      this.spinning.set(false);
      const colour = colourName(res.result.color);
      this.announcer.announce(
        res.payout > 0
          ? $localize`:@@roulette.resultWin:${res.result.number}:n: ${colour}:colour:. You won ${formatCredits(res.payout)}:amount: credits.`
          : $localize`:@@roulette.resultLose:${res.result.number}:n: ${colour}:colour:. No win this time.`,
      );
    }
  }

  private async loadHistory(): Promise<void> {
    try {
      this.history.set(
        await this.api.get<number[]>('/api/games/roulette/history'),
      );
    } catch {
      // History is cosmetic; the table works without it.
    }
  }
}

function colourName(colour: 'red' | 'black' | 'green'): string {
  return colour === 'red'
    ? $localize`:@@roulette.red:red`
    : colour === 'black'
      ? $localize`:@@roulette.black:black`
      : $localize`:@@roulette.green:green`;
}
