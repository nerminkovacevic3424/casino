import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { Card } from '@casino/game-engine';

const RANKS: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUITS: Record<Card['suit'], string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export const rankLabel = (card: Card): string =>
  RANKS[card.rank] ?? String(card.rank);

/** Spoken name, e.g. "Queen of hearts". */
export function cardName(card: Card): string {
  const ranks: Record<number, string> = {
    11: $localize`:@@card.jack:Jack`,
    12: $localize`:@@card.queen:Queen`,
    13: $localize`:@@card.king:King`,
    14: $localize`:@@card.ace:Ace`,
  };
  const suits: Record<Card['suit'], string> = {
    S: $localize`:@@card.spades:spades`,
    H: $localize`:@@card.hearts:hearts`,
    D: $localize`:@@card.diamonds:diamonds`,
    C: $localize`:@@card.clubs:clubs`,
  };
  const rank = ranks[card.rank] ?? String(card.rank);
  const suit = suits[card.suit];
  return $localize`:@@card.name:${rank}:rank: of ${suit}:suit:`;
}

@Component({
  selector: 'cas-playing-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'label()',
    '[class.red]': 'red()',
    '[class.back]': '!card()',
  },
  template: `
    @if (card()) {
      <span class="corner" aria-hidden="true"
        >{{ rank() }}<br />{{ suit() }}</span
      >
      <span class="pip" aria-hidden="true">{{ suit() }}</span>
      <span class="corner corner--bottom" aria-hidden="true"
        >{{ rank() }}<br />{{ suit() }}</span
      >
    }
  `,
  styles: `
    :host {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: var(--card-width, 84px);
      aspect-ratio: 5 / 7;
      border-radius: 8px;
      background: #fdfdfb;
      color: #14161f;
      box-shadow: 0 4px 10px rgb(0 0 0 / 40%);
      font-family: Georgia, 'Times New Roman', serif;
      user-select: none;
    }
    :host(.red) {
      color: #c8273a;
    }
    :host(.back) {
      background: repeating-linear-gradient(
        45deg,
        #24305a 0 6px,
        #1b2447 6px 12px
      );
      border: 4px solid #fdfdfb;
    }
    .corner {
      position: absolute;
      top: 6%;
      left: 9%;
      font-size: calc(var(--card-width, 84px) * 0.2);
      line-height: 1;
      text-align: center;
      font-weight: 700;
    }
    .corner--bottom {
      top: auto;
      left: auto;
      bottom: 6%;
      right: 9%;
      rotate: 180deg;
    }
    .pip {
      font-size: calc(var(--card-width, 84px) * 0.48);
    }
    :host(.deal-in) {
      animation: deal var(--duration-slow) var(--ease-out);
    }
    @keyframes deal {
      from {
        opacity: 0;
        transform: translate(40px, -60px) rotate(-12deg);
      }
    }
  `,
})
export class PlayingCardComponent {
  /** `null` renders the card face down. */
  readonly card = input<Card | null>(null);

  protected readonly rank = computed(() => {
    const c = this.card();
    return c ? rankLabel(c) : '';
  });
  protected readonly suit = computed(() => {
    const c = this.card();
    return c ? SUITS[c.suit] : '';
  });
  protected readonly red = computed(() => {
    const s = this.card()?.suit;
    return s === 'H' || s === 'D';
  });
  protected readonly label = computed(() => {
    const c = this.card();
    return c ? cardName(c) : $localize`:@@card.faceDown:Face-down card`;
  });
}
