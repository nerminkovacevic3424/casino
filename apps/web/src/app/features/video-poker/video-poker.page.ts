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
  JACKS_OR_BETTER_9_6,
  PokerHandRank,
  VIDEO_POKER_COIN_VALUES,
  VideoPokerState,
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

type View = Omit<VideoPokerState, 'deck'>;
type Round = RoundResponse<View>;

const RANK_ORDER: readonly PokerHandRank[] = [
  'royal-flush',
  'straight-flush',
  'four-of-a-kind',
  'full-house',
  'flush',
  'straight',
  'three-of-a-kind',
  'two-pair',
  'jacks-or-better',
];

export function rankName(rank: PokerHandRank): string {
  switch (rank) {
    case 'royal-flush':
      return $localize`:@@vp.royal:Royal flush`;
    case 'straight-flush':
      return $localize`:@@vp.straightFlush:Straight flush`;
    case 'four-of-a-kind':
      return $localize`:@@vp.four:Four of a kind`;
    case 'full-house':
      return $localize`:@@vp.fullHouse:Full house`;
    case 'flush':
      return $localize`:@@vp.flush:Flush`;
    case 'straight':
      return $localize`:@@vp.straight:Straight`;
    case 'three-of-a-kind':
      return $localize`:@@vp.three:Three of a kind`;
    case 'two-pair':
      return $localize`:@@vp.twoPair:Two pair`;
    case 'jacks-or-better':
      return $localize`:@@vp.jacks:Jacks or better`;
    case 'nothing':
      return $localize`:@@vp.nothing:No win`;
  }
}

@Component({
  selector: 'cas-video-poker-page',
  imports: [CreditsPipe, PlayingCardComponent, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './video-poker.page.html',
  styleUrl: './video-poker.page.scss',
})
export class VideoPokerPage {
  protected readonly wallet = inject(WalletStore);
  private readonly api = inject(GameApi);
  private readonly sound = inject(SoundService);
  private readonly announcer = inject(Announcer);
  private readonly toasts = inject(ToastService);

  protected readonly ranks = RANK_ORDER;
  protected readonly paytable = JACKS_OR_BETTER_9_6;
  protected readonly coinValues = VIDEO_POKER_COIN_VALUES;
  protected readonly coinCounts = [1, 2, 3, 4, 5] as const;
  protected readonly rankName = rankName;

  protected readonly coins = signal<1 | 2 | 3 | 4 | 5>(5);
  protected readonly coinValue = signal<number>(VIDEO_POKER_COIN_VALUES[2]);
  protected readonly round = signal<Round | null>(null);
  protected readonly held = signal<boolean[]>([
    false,
    false,
    false,
    false,
    false,
  ]);
  protected readonly busy = signal(false);

  protected readonly view = computed(() => this.round()?.result ?? null);
  protected readonly dealt = computed(() => this.view()?.phase === 'dealt');
  protected readonly bet = computed(() => this.coins() * this.coinValue());
  protected readonly canDeal = computed(
    () =>
      !this.busy() &&
      !this.dealt() &&
      (this.wallet.balance() ?? 0) >= this.bet(),
  );

  constructor() {
    void this.resume();
    inject(DestroyRef).onDestroy(() => this.wallet.release());
  }

  protected toggleHold(index: number): void {
    if (!this.dealt() || this.busy()) return;
    this.held.update((h) => h.map((v, i) => (i === index ? !v : v)));
    this.sound.play('click');
  }

  /** Keys 1-5 toggle holds while the hand has focus (WCAG 2.1.4: only when focused). */
  protected onHandKey(event: KeyboardEvent): void {
    const index = Number(event.key) - 1;
    if (index >= 0 && index < 5) {
      event.preventDefault();
      this.toggleHold(index);
    }
  }

  protected async deal(): Promise<void> {
    if (!this.canDeal()) return;
    this.busy.set(true);
    try {
      const res = await this.api.bet<Round>('/api/games/video-poker/deal', {
        coins: this.coins(),
        coinValue: this.coinValue(),
      });
      this.held.set([false, false, false, false, false]);
      this.apply(res);
      this.sound.play('stop');
    } catch (err) {
      this.fail(err);
    } finally {
      this.busy.set(false);
    }
  }

  protected async draw(): Promise<void> {
    const round = this.round();
    if (!round || !this.dealt() || this.busy()) return;
    this.busy.set(true);
    try {
      const res = await this.api.act<Round>(
        `/api/games/video-poker/rounds/${round.roundId}/draw`,
        {
          held: this.held(),
        },
      );
      this.apply(res);
      this.sound.play(
        res.payout > 0
          ? res.payout >= res.stake * 25
            ? 'bigwin'
            : 'win'
          : 'stop',
      );
    } catch (err) {
      this.fail(err);
      await this.resume();
    } finally {
      this.busy.set(false);
    }
  }

  private apply(res: Round): void {
    this.round.set(res);
    this.wallet.setBalance(res.balance);
    const v = res.result;
    const cards = v.hand.map(cardName).join(', ');
    if (v.phase === 'dealt') {
      this.announcer.announce(
        $localize`:@@vp.say.dealt:Dealt: ${cards}:cards:. Choose cards to hold, then draw.`,
      );
    } else if (v.rank) {
      const rank = rankName(v.rank);
      this.announcer.announce(
        res.payout > 0
          ? $localize`:@@vp.say.won:${cards}:cards:. ${rank}:rank:! You win ${formatCredits(res.payout)}:amount: credits.`
          : $localize`:@@vp.say.lost:${cards}:cards:. ${rank}:rank:.`,
      );
    }
  }

  private async resume(): Promise<void> {
    try {
      const open = await this.api.get<Round | null>(
        '/api/games/video-poker/open',
      );
      if (open && open.roundId) {
        this.round.set(open);
        this.coins.set(open.result.coins);
        this.coinValue.set(open.result.coinValue);
      }
    } catch {
      // Signed out or offline.
    }
  }

  private fail(err: unknown): void {
    const message = errorMessage(err);
    this.toasts.error(message);
    this.announcer.announce(message, 'assertive');
  }
}
