import { Card } from '../cards/cards';

/** Blackjack value of a single card: 2-9 face value, T/J/Q/K = 10, A = 11 (soft). */
export const cardValue = (card: Card): number =>
  card.rank === 14 ? 11 : Math.min(card.rank, 10);

export interface HandValue {
  readonly total: number;
  /** True when an ace is currently counted as 11. */
  readonly soft: boolean;
}

export function handValue(cards: readonly Card[]): HandValue {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 14) {
      aces++;
      total += 1;
    } else {
      total += Math.min(c.rank, 10);
    }
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

export const isBlackjack = (cards: readonly Card[]): boolean =>
  cards.length === 2 && handValue(cards).total === 21;

export const isBust = (cards: readonly Card[]): boolean =>
  handValue(cards).total > 21;
