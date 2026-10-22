import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  BlackjackAction,
  BlackjackPublicView,
  DEFAULT_BLACKJACK_RULES,
  basicStrategy,
} from '@casino/game-engine';
import type { RoundResponse } from '@casino/shared-types';
import { CreditsPipe, formatCredits } from '@casino/ui';
import { errorMessage } from '../../core/api-error';
import { Announcer } from '../../core/announcer.service';
import { GameApi } from '../../core/game-api.service';
import { SoundService } from '../../core/sound.service';
import { ToastService } from '../../core/toast.service';
import { WalletStore } from '../../core/wallet.store';
import {
  PlayingCardComponent,
  cardName,
} from '../cards/playing-card.component';

type Round = RoundResponse<BlackjackPublicView>;

const BET_OPTIONS = [100, 200, 500, 1_000, 2_500, 5_000, 10_000];

@Component({
  selector: 'cas-blackjack-page',
  imports: [CreditsPipe, PlayingCardComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './blackjack.page.html',
  styleUrl: './blackjack.page.scss',
})
export class BlackjackPage {
  protected readonly wallet = inject(WalletStore);
  private readonly api = inject(GameApi);
  private readonly sound = inject(SoundService);
  private readonly announcer = inject(Announcer);
  private readonly toasts = inject(ToastService);

  protected readonly rules = DEFAULT_BLACKJACK_RULES;
  protected readonly betOptions = BET_OPTIONS;
  protected readonly bet = signal(BET_OPTIONS[0]);
  protected readonly round = signal<Round | null>(null);
  protected readonly busy = signal(false);
  protected readonly showHint = signal(false);
  /** Number of decisions applied to the current hand (sent with every action). */
  private seq = 0;

  protected readonly view = computed(() => this.round()?.result ?? null);
  protected readonly inPlay = computed(() => {
    const phase = this.view()?.phase;
    return phase === 'player' || phase === 'insurance';
  });
  protected readonly hint = computed(() => {
    const v = this.view();
    if (!v || !this.showHint()) return null;
    if (v.phase === 'insurance') return 'no-insurance' as const;
    const hand = v.hands[v.active];
    const up = v.dealer[0];
    return v.phase === 'player' && hand && up
      ? basicStrategy(hand.cards, up, v.legalActions)
      : null;
  });
  protected readonly canDeal = computed(
    () =>
      !this.busy() &&
      !this.inPlay() &&
      (this.wallet.balance() ?? 0) >= this.bet(),
  );

  constructor() {
    void this.resume();
    inject(DestroyRef).onDestroy(() => this.wallet.release());
  }

  protected setBet(amount: number): void {
    if (!this.inPlay()) this.bet.set(amount);
  }

  protected async deal(): Promise<void> {
    if (!this.canDeal()) return;
    this.busy.set(true);
    try {
      const res = await this.api.bet<Round>('/api/games/blackjack/deal', {
        bet: this.bet(),
      });
      this.seq = 0;
      this.apply(res);
      this.sound.play('stop');
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async act(action: BlackjackAction): Promise<void> {
    const round = this.round();
    if (!round || this.busy() || !round.result.legalActions.includes(action))
      return;
    this.busy.set(true);
    try {
      const res = await this.api.act<Round>(
        `/api/games/blackjack/rounds/${round.roundId}/action`,
        {
          action,
          seq: this.seq,
        },
      );
      this.seq++;
      this.apply(res);
      this.sound.play(
        action === 'hit' || action === 'double' ? 'stop' : 'click',
      );
    } catch (err) {
      this.fail(err);
      // The server is the source of truth: re-sync after a rejected action.
      await this.resume();
    } finally {
      this.busy.set(false);
    }
  }

  protected actionLabel(action: BlackjackAction): string {
    switch (action) {
      case 'hit':
        return $localize`:@@bj.hit:Hit`;
      case 'stand':
        return $localize`:@@bj.stand:Stand`;
      case 'double':
        return $localize`:@@bj.double:Double`;
      case 'split':
        return $localize`:@@bj.split:Split`;
      case 'insurance':
        return $localize`:@@bj.insurance:Take insurance`;
      case 'no-insurance':
        return $localize`:@@bj.noInsurance:No insurance`;
    }
  }

  /** Extra stake an action costs, shown on the button. */
  protected actionCost(action: BlackjackAction): number {
    const v = this.view();
    if (!v) return 0;
    if (action === 'double' || action === 'split')
      return v.hands[v.active]?.bet ?? 0;
    if (action === 'insurance') return v.baseBet / 2;
    return 0;
  }

  protected outcomeLabel(outcome: string | null): string {
    switch (outcome) {
      case 'blackjack':
        return $localize`:@@bj.outcome.blackjack:Blackjack!`;
      case 'win':
        return $localize`:@@bj.outcome.win:Win`;
      case 'push':
        return $localize`:@@bj.outcome.push:Push`;
      case 'lose':
        return $localize`:@@bj.outcome.lose:Lose`;
      default:
        return '';
    }
  }

  private apply(res: Round): void {
    this.round.set(res);
    this.wallet.setBalance(res.balance);
    this.announce(res.result, res.payout);
  }

  private announce(v: BlackjackPublicView, payout: number): void {
    const up = v.dealer[0];
    const hand = v.hands[v.active];
    if (v.phase === 'insurance' && up) {
      this.announcer.announce(
        $localize`:@@bj.say.insurance:Dealer shows ${cardName(up)}:card:. Insurance?`,
      );
    } else if (v.phase === 'player' && hand && up) {
      const cards = hand.cards.map(cardName).join(', ');
      this.announcer.announce(
        $localize`:@@bj.say.turn:Your hand: ${cards}:cards:, total ${hand.total}:total:. Dealer shows ${cardName(up)}:up:.`,
      );
    } else if (v.phase === 'settled') {
      const results = v.hands
        .map((h) => this.outcomeLabel(h.outcome))
        .join(', ');
      const dealer = v.dealerTotal ?? 0;
      this.announcer.announce(
        payout > 0
          ? $localize`:@@bj.say.won:Dealer has ${dealer}:dealer:. ${results}:results:. You receive ${formatCredits(payout)}:amount: credits.`
          : $localize`:@@bj.say.lost:Dealer has ${dealer}:dealer:. ${results}:results:.`,
      );
      if (payout > 0)
        this.sound.play(payout >= v.totalStaked * 2 ? 'bigwin' : 'win');
    }
  }

  private async resume(): Promise<void> {
    try {
      const open = await this.api.get<Round | null>(
        '/api/games/blackjack/open',
      );
      if (open && open.roundId) {
        this.round.set(open);
        // Decisions already recorded server-side; continue numbering from there.
        this.seq = await this.recordedDecisions(open.roundId);
      }
    } catch {
      // Not signed in or offline: the table still renders.
    }
  }

  private async recordedDecisions(roundId: string): Promise<number> {
    const detail = await this.api.get<{ input: { actions?: string[] } }>(
      `/api/rounds/${roundId}`,
    );
    return detail.input.actions?.length ?? 0;
  }

  private fail(err: unknown): void {
    const message = errorMessage(err);
    this.toasts.error(message);
    this.announcer.announce(message, 'assertive');
  }
}
