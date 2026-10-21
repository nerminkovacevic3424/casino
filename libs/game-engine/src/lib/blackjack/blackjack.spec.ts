import { createDeck, parseCards } from '../cards/cards';
import { SeededRng } from '../rng/rng';
import {
  BlackjackAction,
  BlackjackState,
  DEFAULT_BLACKJACK_RULES,
  IllegalActionError,
  applyBlackjackAction,
  assertBlackjackBet,
  dealBlackjack,
  legalActions,
  startRound,
  toPublicView,
} from './blackjack';
import { handValue, isBlackjack, isBust } from './hand';
import { strategyHint } from './strategy';

/** Deal order is P1, D1, P2, D2(hole), then hits in sequence; a full deck follows as filler. */
const shoe = (codes: string) => [...parseCards(codes), ...createDeck(1)];
const deal = (codes: string, rules = DEFAULT_BLACKJACK_RULES) =>
  startRound(shoe(codes), 100, rules);

function play(
  state: BlackjackState,
  ...actions: BlackjackAction[]
): { state: BlackjackState; debits: number[] } {
  const debits: number[] = [];
  let s = state;
  for (const a of actions) {
    const t = applyBlackjackAction(s, a);
    debits.push(t.debit);
    s = t.state;
  }
  return { state: s, debits };
}

describe('hand values', () => {
  it.each([
    ['AS KD', 21, true],
    ['AS AD', 12, true],
    ['AS AD 9C', 21, true],
    ['AS 6D TC', 17, false],
    ['TS QD', 20, false],
    ['TS QD 5C', 25, false],
  ])('%s = %i (soft: %s)', (codes, total, soft) => {
    expect(handValue(parseCards(codes))).toEqual({ total, soft });
  });

  it('detects blackjack and bust', () => {
    expect(isBlackjack(parseCards('AS JD'))).toBe(true);
    expect(isBlackjack(parseCards('7S 7D 7C'))).toBe(false);
    expect(isBust(parseCards('TS QD 2C'))).toBe(true);
  });
});

describe('naturals and the dealer peek', () => {
  it('pays a player blackjack 3:2 immediately', () => {
    const s = deal('AS 9D KH 7C');
    expect(s.phase).toBe('settled');
    expect(s.hands[0]).toMatchObject({ outcome: 'blackjack', payout: 250 });
    expect(s.dealer).toHaveLength(2);
    expect(s.totalPayout).toBe(250);
  });

  it('pushes blackjack against dealer blackjack', () => {
    const s = deal('AS KD KH AC');
    expect(s.phase).toBe('settled');
    expect(s.hands[0]).toMatchObject({ outcome: 'push', payout: 100 });
  });

  it('loses to a dealer blackjack found on the peek (ten up, no insurance offered)', () => {
    const s = deal('9S KD 9H AC');
    expect(s.insurance.offered).toBe(false);
    expect(s.phase).toBe('settled');
    expect(s.hands[0]).toMatchObject({ outcome: 'lose', payout: 0 });
  });
});

describe('insurance', () => {
  it('is offered when the dealer shows an ace', () => {
    const s = deal('TS AD 9H KC');
    expect(s.phase).toBe('insurance');
    expect(legalActions(s)).toEqual(['insurance', 'no-insurance']);
    expect(() => applyBlackjackAction(s, 'hit')).toThrow(IllegalActionError);
  });

  it('pays 2:1 when the dealer has blackjack, making the round break even', () => {
    const { state, debits } = play(deal('TS AD 9H KC'), 'insurance');
    expect(debits).toEqual([50]);
    expect(state.phase).toBe('settled');
    expect(state.insurance).toEqual({
      offered: true,
      taken: true,
      bet: 50,
      payout: 150,
    });
    expect(state.totalStaked).toBe(150);
    expect(state.totalPayout).toBe(150);
  });

  it('is lost when the dealer has no blackjack and play continues', () => {
    const { state } = play(deal('TS AD 9H 7C'), 'insurance', 'stand');
    expect(state.insurance.payout).toBe(0);
    expect(state.hands[0]).toMatchObject({ outcome: 'win', payout: 200 });
    expect(state.totalStaked).toBe(150);
    expect(state.totalPayout).toBe(200);
  });

  it('declined: dealer blackjack beats the player', () => {
    const { state, debits } = play(deal('TS AD 9H KC'), 'no-insurance');
    expect(debits).toEqual([0]);
    expect(state.hands[0].outcome).toBe('lose');
  });

  it('declined with a player blackjack and no dealer blackjack pays 3:2', () => {
    const { state } = play(deal('AS AD KH 7C'), 'no-insurance');
    expect(state.hands[0]).toMatchObject({ outcome: 'blackjack', payout: 250 });
  });
});

describe('hitting, standing and the dealer', () => {
  it('busts the player without the dealer drawing', () => {
    const { state } = play(deal('TS 9D 6H 7C 9S'), 'hit');
    expect(state.phase).toBe('settled');
    expect(state.hands[0]).toMatchObject({ outcome: 'lose', payout: 0 });
    expect(state.dealer).toHaveLength(2);
  });

  it('stands automatically on 21', () => {
    const { state } = play(deal('TS 9D 6H 7C 5S 2D'), 'hit');
    expect(state.phase).toBe('settled');
    expect(handValue(state.dealer).total).toBe(18);
    expect(state.hands[0]).toMatchObject({ outcome: 'win', payout: 200 });
  });

  it('dealer stands on soft 17 by default', () => {
    const { state } = play(deal('TS 6D 8H AC 2S'), 'stand');
    expect(state.dealer).toHaveLength(2);
    expect(state.hands[0].outcome).toBe('win');
  });

  it('dealer hits soft 17 when the rule says so', () => {
    const { state } = play(
      deal('TS 6D 8H AC 2S', {
        ...DEFAULT_BLACKJACK_RULES,
        dealerHitsSoft17: true,
      }),
      'stand',
    );
    expect(state.dealer.map((c) => c.rank)).toEqual([6, 14, 2]);
    expect(state.hands[0].outcome).toBe('lose');
  });

  it.each([
    ['push', 'TS 9D 9H TC', 'push', 100],
    ['dealer bust', 'TS 6D 7H TC 9S', 'win', 200],
    ['lower total', 'TS 9D 7H TC', 'lose', 0],
  ])('%s', (_, codes, outcome, payout) => {
    const { state } = play(deal(codes), 'stand');
    expect(state.hands[0]).toMatchObject({ outcome, payout });
  });
});

describe('doubling', () => {
  it('doubles the stake, draws exactly one card and stands', () => {
    const { state, debits } = play(deal('5S 9D 6H 7C TH 4D'), 'double');
    expect(debits).toEqual([100]);
    expect(state.hands[0]).toMatchObject({
      bet: 200,
      doubled: true,
      outcome: 'win',
      payout: 400,
    });
    expect(state.hands[0].cards).toHaveLength(3);
    expect(state.totalStaked).toBe(200);
  });

  it('is only allowed on the first two cards', () => {
    const { state } = play(deal('2S 9D 3H 7C 2D'), 'hit');
    expect(legalActions(state)).toEqual(['hit', 'stand']);
    expect(() => applyBlackjackAction(state, 'double')).toThrow(
      IllegalActionError,
    );
  });
});

describe('splitting', () => {
  it('splits a pair, allows double after split and settles each hand', () => {
    const start = deal('8S 9D 8H 7C 3D TC 9H TD');
    expect(legalActions(start)).toContain('split');
    const split = play(start, 'split');
    expect(split.debits).toEqual([100]);
    expect(split.state.hands.map((h) => h.cards.length)).toEqual([2, 1]);
    expect(legalActions(split.state)).toContain('double');

    const { state, debits } = play(split.state, 'double', 'stand');
    expect(debits).toEqual([100, 0]);
    expect(state.phase).toBe('settled');
    expect(state.hands.map((h) => handValue(h.cards).total)).toEqual([21, 17]);
    expect(state.hands.map((h) => [h.outcome, h.payout])).toEqual([
      ['win', 400],
      ['win', 200],
    ]);
    expect(state.totalStaked).toBe(300);
    expect(state.totalPayout).toBe(600);
  });

  it('gives split aces one card each, and 21 there is not a blackjack', () => {
    const { state } = play(deal('AS 9D AH 7C KD 5C 2S'), 'split');
    expect(state.phase).toBe('settled');
    expect(state.hands.map((h) => h.cards.length)).toEqual([2, 2]);
    expect(state.hands[0]).toMatchObject({
      splitAces: true,
      outcome: 'win',
      payout: 200,
    });
    expect(state.hands[1].outcome).toBe('lose');
  });

  it('allows re-splitting up to four hands', () => {
    const { state } = play(
      deal('8S 9D 8H 7C 8D 8C 8S 2D'),
      'split',
      'split',
      'split',
    );
    expect(state.hands).toHaveLength(4);
    expect(legalActions(state)).not.toContain('split');
    expect(state.totalStaked).toBe(400);
  });

  it('stands a split hand that reaches 21 and moves to the next hand', () => {
    const { state } = play(deal('TS 9D TH 7C AD 9C'), 'split');
    expect(state.active).toBe(1);
    expect(state.hands[0].done).toBe(true);
    expect(handValue(state.hands[1].cards).total).toBe(19);
  });

  it('does not double after split when the rule forbids it', () => {
    const s = deal('8S 9D 8H 7C 3D', {
      ...DEFAULT_BLACKJACK_RULES,
      doubleAfterSplit: false,
    });
    expect(legalActions(play(s, 'split').state)).not.toContain('double');
  });
});

describe('validation and views', () => {
  it.each([101, 50, 200_000, 0, -2, 10.5])('rejects bet %p', (bet) => {
    expect(() => assertBlackjackBet(bet)).toThrow();
  });

  it('rejects any action once settled', () => {
    const s = deal('AS 9D KH 7C');
    expect(legalActions(s)).toEqual([]);
    expect(() => applyBlackjackAction(s, 'stand')).toThrow(IllegalActionError);
  });

  it('hides the hole card and shoe until settled', () => {
    const s = deal('TS 9D 7H TC');
    const view = toPublicView(s);
    expect(view.dealer).toEqual([s.dealer[0], null]);
    expect(view.dealerTotal).toBeNull();
    expect(view).not.toHaveProperty('shoe');
    expect(view.hands[0]).toMatchObject({ total: 17, soft: false });
    expect(view.legalActions).toEqual(['hit', 'stand', 'double']);

    const settled = toPublicView(play(s, 'stand').state);
    expect(settled.dealer).toHaveLength(2);
    expect(settled.dealerTotal).toBe(19);
  });

  it('fails loudly if the shoe runs out', () => {
    const s = startRound(parseCards('TS 6D 7H TC'), 100);
    expect(() => applyBlackjackAction(s, 'hit')).toThrow('Shoe exhausted');
  });

  it('deals from a freshly shuffled six-deck shoe', () => {
    const s = dealBlackjack(100, new SeededRng(1));
    expect(s.shoe).toHaveLength(312);
    expect(s.totalStaked).toBe(100);
    expect(dealBlackjack(100, new SeededRng(1))).toEqual(s);
  });
});

describe('strategy hints', () => {
  it.each([
    ['hard 16 vs 10', 'TS TD 6H 7C', [], 'hit'],
    ['hard 12 vs 4', 'TS 4D 2H 7C', [], 'stand'],
    ['hard 8 vs 5', '3S 5D 5H 7C', [], 'hit'],
    ['hard 17 vs 2', 'TS 2D 7H 7C', [], 'stand'],
    ['11 vs 6', '5S 6D 6H 7C', [], 'double'],
    ['three-card 11 cannot double', '2S 6D 4H 7C 5D', ['hit'], 'hit'],
    ['soft 18 vs 3 doubles', 'AS 3D 7H 7C', [], 'double'],
    ['three-card soft 18 vs 3 stands', 'AS 3D 2H 7C 5D', ['hit'], 'stand'],
    ['soft 20', 'AS 5D 9H 7C', [], 'stand'],
    ['soft 21 after hits', 'AS 5D 2H 7C 8D', ['hit'], null],
    ['8s vs 10 split', '8S TD 8H 7C', [], 'split'],
    ['9s vs 7 stand', '9S 7D 9H 7C', [], 'stand'],
    ['5s vs 6 double as hard 10', '5S 6D 5H 7C', [], 'double'],
    ['4s vs 2 hit (no split)', '4S 2D 4H 7C', [], 'hit'],
    ['insurance declined', 'TS AD 9H 7C', [], 'no-insurance'],
    ['settled round', 'AS 9D KH 7C', [], null],
  ] as const)('%s → %s', (_, codes, actions, hint) => {
    const { state } = play(
      deal(codes),
      ...(actions as readonly BlackjackAction[]),
    );
    expect(strategyHint(state)).toBe(hint);
  });
});
