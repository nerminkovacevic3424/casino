import { Rng, shuffle } from '../rng/rng';

export const SUITS = ['S', 'H', 'D', 'C'] as const;
export type Suit = (typeof SUITS)[number];

/** 2..10, J=11, Q=12, K=13, A=14 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;
export const RANKS: readonly Rank[] = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
];

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

const RANK_LABELS: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: 'T',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

/** Compact code such as "AS", "TD", "9H". */
export const cardCode = (card: Card): string =>
  `${RANK_LABELS[card.rank]}${card.suit}`;

export function parseCard(code: string): Card {
  const match = /^([2-9TJQKA])([SHDC])$/.exec(code);
  if (!match) throw new Error(`Invalid card code: ${code}`);
  const rank = (
    Object.entries(RANK_LABELS).find(([, label]) => label === match[1]) as [
      string,
      string,
    ]
  )[0];
  return { rank: Number(rank) as Rank, suit: match[2] as Suit };
}

export const parseCards = (codes: string): Card[] =>
  codes.trim().split(/\s+/).map(parseCard);

export function createDeck(decks = 1): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS)
      for (const rank of RANKS) cards.push({ rank, suit });
  }
  return cards;
}

export const shuffledDeck = (rng: Rng, decks = 1): Card[] =>
  shuffle(rng, createDeck(decks));
