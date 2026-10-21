import { BlackjackAction, BlackjackState, legalActions } from './blackjack';
import { cardValue, handValue } from './hand';

/**
 * Basic strategy for 4-8 decks, dealer stands on soft 17, double after split,
 * no surrender. Codes: H hit, S stand, D double (else hit), Ds double (else
 * stand), P split. Columns are the dealer up card 2..10, A.
 */
type Code = 'H' | 'S' | 'D' | 'Ds' | 'P';
const UP = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11] as const;

const row = (spec: string): Code[] => spec.split(' ') as Code[];

const HARD: Record<number, Code[]> = {
  8: row('H H H H H H H H H H'),
  9: row('H D D D D H H H H H'),
  10: row('D D D D D D D D H H'),
  11: row('D D D D D D D D D H'),
  12: row('H H S S S H H H H H'),
  13: row('S S S S S H H H H H'),
  14: row('S S S S S H H H H H'),
  15: row('S S S S S H H H H H'),
  16: row('S S S S S H H H H H'),
  17: row('S S S S S S S S S S'),
};

const SOFT: Record<number, Code[]> = {
  13: row('H H H D D H H H H H'),
  14: row('H H H D D H H H H H'),
  15: row('H H D D D H H H H H'),
  16: row('H H D D D H H H H H'),
  17: row('H D D D D H H H H H'),
  18: row('S Ds Ds Ds Ds S S H H H'),
  19: row('S S S S S S S S S S'),
  20: row('S S S S S S S S S S'),
};

/** Keyed by the value of one card of the pair (11 = aces). */
const PAIRS: Record<number, Code[]> = {
  2: row('P P P P P P H H H H'),
  3: row('P P P P P P H H H H'),
  4: row('H H H P P H H H H H'),
  6: row('P P P P P H H H H H'),
  7: row('P P P P P P H H H H'),
  8: row('P P P P P P P P P P'),
  9: row('P P P P P S P P S S'),
  11: row('P P P P P P P P P P'),
};

export type StrategyHint = Exclude<BlackjackAction, 'insurance'>;

/** The basic-strategy move for the active hand, restricted to legal actions. */
export function strategyHint(state: BlackjackState): StrategyHint | null {
  const legal = legalActions(state);
  if (state.phase === 'insurance') return 'no-insurance'; // insurance is a losing bet
  if (legal.length === 0) return null;

  const hand = state.hands[state.active];
  const col = UP.indexOf(cardValue(state.dealer[0]) as (typeof UP)[number]);
  const { total, soft } = handValue(hand.cards);

  let code: Code;
  const pairValue =
    hand.cards.length === 2 &&
    cardValue(hand.cards[0]) === cardValue(hand.cards[1])
      ? cardValue(hand.cards[0])
      : null;
  if (pairValue !== null && PAIRS[pairValue] && legal.includes('split')) {
    code = PAIRS[pairValue][col];
    if (code !== 'P') code = lookupTotal(total, soft, col);
  } else {
    code = lookupTotal(total, soft, col);
  }

  switch (code) {
    case 'P':
      return 'split';
    case 'D':
      return legal.includes('double') ? 'double' : 'hit';
    case 'Ds':
      return legal.includes('double') ? 'double' : 'stand';
    case 'H':
      return 'hit';
    case 'S':
      return 'stand';
  }
}

function lookupTotal(total: number, soft: boolean, col: number): Code {
  if (soft && total <= 20) return SOFT[Math.max(13, total)][col];
  if (soft) return 'S';
  if (total <= 8) return 'H';
  if (total >= 17) return 'S';
  return HARD[total][col];
}
