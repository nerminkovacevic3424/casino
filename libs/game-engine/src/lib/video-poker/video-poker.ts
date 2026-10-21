import { Card, shuffledDeck } from '../cards/cards';
import { Minor, assertPositiveMinor, mulMinor } from '../money';
import { Rng } from '../rng/rng';

export type PokerHandRank =
  | 'royal-flush'
  | 'straight-flush'
  | 'four-of-a-kind'
  | 'full-house'
  | 'flush'
  | 'straight'
  | 'three-of-a-kind'
  | 'two-pair'
  | 'jacks-or-better'
  | 'nothing';

/**
 * 9/6 Jacks or Better: pays per coin for 1..5 coins. The royal flush jumps to
 * 800 per coin at max bet. Theoretical RTP with optimal play: 99.54%.
 */
export const JACKS_OR_BETTER_9_6: Readonly<
  Record<PokerHandRank, readonly [number, number, number, number, number]>
> = {
  'royal-flush': [250, 500, 750, 1000, 4000],
  'straight-flush': [50, 100, 150, 200, 250],
  'four-of-a-kind': [25, 50, 75, 100, 125],
  'full-house': [9, 18, 27, 36, 45],
  flush: [6, 12, 18, 24, 30],
  straight: [4, 8, 12, 16, 20],
  'three-of-a-kind': [3, 6, 9, 12, 15],
  'two-pair': [2, 4, 6, 8, 10],
  'jacks-or-better': [1, 2, 3, 4, 5],
  nothing: [0, 0, 0, 0, 0],
};

export const VIDEO_POKER_COIN_VALUES: readonly Minor[] = [
  5, 10, 25, 50, 100, 500,
];

export function evaluatePokerHand(cards: readonly Card[]): PokerHandRank {
  if (cards.length !== 5)
    throw new Error('A poker hand has exactly five cards');
  const ranks = cards.map((c) => c.rank).sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.values()].sort((a, b) => b - a);

  const flush = cards.every((c) => c.suit === cards[0].suit);
  const unique = counts.size === 5;
  const wheel = unique && ranks.join(',') === '2,3,4,5,14';
  const straight = unique && (ranks[4] - ranks[0] === 4 || wheel);

  if (straight && flush)
    return ranks[0] === 10 ? 'royal-flush' : 'straight-flush';
  if (groups[0] === 4) return 'four-of-a-kind';
  if (groups[0] === 3 && groups[1] === 2) return 'full-house';
  if (flush) return 'flush';
  if (straight) return 'straight';
  if (groups[0] === 3) return 'three-of-a-kind';
  if (groups[0] === 2 && groups[1] === 2) return 'two-pair';
  if (groups[0] === 2) {
    const pairRank = [...counts.entries()].find(([, n]) => n === 2)?.[0] ?? 0;
    return pairRank >= 11 ? 'jacks-or-better' : 'nothing';
  }
  return 'nothing';
}

export interface VideoPokerState {
  readonly phase: 'dealt' | 'settled';
  /** Shuffled deck; cards 0-4 are the deal, 5-9 the replacements in order. Server-only. */
  readonly deck: readonly Card[];
  readonly coins: 1 | 2 | 3 | 4 | 5;
  readonly coinValue: Minor;
  readonly bet: Minor;
  readonly hand: readonly Card[];
  readonly held: readonly boolean[] | null;
  readonly rank: PokerHandRank | null;
  readonly payout: Minor;
}

export function assertVideoPokerBet(
  coins: number,
  coinValue: Minor,
): asserts coins is VideoPokerState['coins'] {
  if (!Number.isInteger(coins) || coins < 1 || coins > 5)
    throw new RangeError('coins must be 1-5');
  assertPositiveMinor(coinValue, 'coinValue');
  if (!VIDEO_POKER_COIN_VALUES.includes(coinValue))
    throw new RangeError('Unsupported coin value');
}

export function dealVideoPoker(
  coins: number,
  coinValue: Minor,
  rng: Rng,
): VideoPokerState {
  assertVideoPokerBet(coins, coinValue);
  const deck = shuffledDeck(rng);
  return {
    phase: 'dealt',
    deck,
    coins,
    coinValue,
    bet: mulMinor(coinValue, coins),
    hand: deck.slice(0, 5),
    held: null,
    rank: evaluatePokerHand(deck.slice(0, 5)),
    payout: 0,
  };
}

/** Replaces non-held cards left to right with the next cards of the deck, then pays. */
export function drawVideoPoker(
  state: VideoPokerState,
  held: readonly boolean[],
): VideoPokerState {
  if (state.phase !== 'dealt') throw new Error('Hand already drawn');
  if (held.length !== 5 || held.some((h) => typeof h !== 'boolean'))
    throw new Error('held must be 5 booleans');
  let next = 5;
  const hand = state.hand.map((card, i) =>
    held[i] ? card : state.deck[next++],
  );
  const rank = evaluatePokerHand(hand);
  const payout = mulMinor(
    state.coinValue,
    JACKS_OR_BETTER_9_6[rank][state.coins - 1],
  );
  return { ...state, phase: 'settled', hand, held: [...held], rank, payout };
}

/** Client-safe view (no deck). */
export const videoPokerPublicView = (
  state: VideoPokerState,
): Omit<VideoPokerState, 'deck'> => {
  const { deck: _deck, ...rest } = state;
  void _deck;
  return rest;
};
