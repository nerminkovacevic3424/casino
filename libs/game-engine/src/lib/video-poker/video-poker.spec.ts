import { cardCode, parseCard, parseCards } from '../cards/cards';
import { SeededRng } from '../rng/rng';
import {
  JACKS_OR_BETTER_9_6,
  PokerHandRank,
  VideoPokerState,
  dealVideoPoker,
  drawVideoPoker,
  evaluatePokerHand,
  videoPokerPublicView,
} from './video-poker';

describe('evaluatePokerHand', () => {
  it.each<[string, PokerHandRank]>([
    ['TS JS QS KS AS', 'royal-flush'],
    ['9H TH JH QH KH', 'straight-flush'],
    ['AD 2D 3D 4D 5D', 'straight-flush'],
    ['7C 7D 7H 7S 2C', 'four-of-a-kind'],
    ['3C 3D 3H 9S 9C', 'full-house'],
    ['2H 7H 9H JH KH', 'flush'],
    ['5C 6D 7H 8S 9C', 'straight'],
    ['TC JD QH KS AC', 'straight'],
    ['AC 2D 3H 4S 5C', 'straight'],
    ['QC QD QH 4S 9C', 'three-of-a-kind'],
    ['4C 4D 9H 9S KC', 'two-pair'],
    ['JC JD 2H 5S 9C', 'jacks-or-better'],
    ['AC AD 2H 5S 9C', 'jacks-or-better'],
    ['TC TD 2H 5S 9C', 'nothing'],
    ['2C 5D 9H JS KC', 'nothing'],
    ['QC KD AH 2S 3C', 'nothing'], // no wrap-around straights
  ])('%s is %s', (codes, rank) => {
    expect(evaluatePokerHand(parseCards(codes))).toBe(rank);
  });

  it('requires five cards', () => {
    expect(() => evaluatePokerHand(parseCards('AS KS'))).toThrow('five cards');
  });
});

describe('paytable', () => {
  it('is the 9/6 full-pay table with the max-coin royal bonus', () => {
    expect(JACKS_OR_BETTER_9_6['full-house'][0]).toBe(9);
    expect(JACKS_OR_BETTER_9_6.flush[0]).toBe(6);
    expect(JACKS_OR_BETTER_9_6['royal-flush']).toEqual([
      250, 500, 750, 1000, 4000,
    ]);
    for (const [rank, pays] of Object.entries(JACKS_OR_BETTER_9_6)) {
      if (rank === 'royal-flush') continue;
      pays.forEach((p, i) => expect(p).toBe(pays[0] * (i + 1)));
    }
  });
});

describe('deal and draw', () => {
  const fixed = (
    codes: string,
    coins: VideoPokerState['coins'] = 5,
  ): VideoPokerState => {
    const deck = parseCards(codes);
    return {
      phase: 'dealt',
      deck,
      coins,
      coinValue: 100,
      bet: 100 * coins,
      hand: deck.slice(0, 5),
      held: null,
      rank: evaluatePokerHand(deck.slice(0, 5)),
      payout: 0,
    };
  };

  it('replaces non-held cards left to right from the deck', () => {
    const s = fixed('TS JS QS KS 2D AS 3C 4C 5C 6C');
    const done = drawVideoPoker(s, [true, true, true, true, false]);
    expect(done.hand.map(cardCode)).toEqual(['TS', 'JS', 'QS', 'KS', 'AS']);
    expect(done).toMatchObject({
      phase: 'settled',
      rank: 'royal-flush',
      payout: 400_000,
    });
  });

  it('pays per coin', () => {
    const s = fixed('JC JD 2H 5S 9C 3D 4D 6D 7D 8D', 3);
    expect(drawVideoPoker(s, [true, true, true, true, true])).toMatchObject({
      rank: 'jacks-or-better',
      payout: 300,
    });
    const s2 = fixed('JC 2D 2H 5S 9C 3D 4D 6D 7D 8D', 1);
    expect(
      drawVideoPoker(s2, [false, false, false, false, false]).hand.map(
        cardCode,
      ),
    ).toEqual(['3D', '4D', '6D', '7D', '8D']);
  });

  it('rejects invalid holds and double draws', () => {
    const s = fixed('JC JD 2H 5S 9C 3D 4D 6D 7D 8D');
    expect(() => drawVideoPoker(s, [true])).toThrow('5 booleans');
    const done = drawVideoPoker(s, [true, true, false, false, false]);
    expect(() => drawVideoPoker(done, [true, true, true, true, true])).toThrow(
      'already drawn',
    );
  });

  it('deals five unique cards from a shuffled deck', () => {
    const s = dealVideoPoker(5, 25, new SeededRng(3));
    expect(s.deck).toHaveLength(52);
    expect(new Set(s.deck.map(cardCode)).size).toBe(52);
    expect(s.hand).toEqual(s.deck.slice(0, 5));
    expect(s.bet).toBe(125);
    expect(s.rank).toBe(evaluatePokerHand(s.hand));
  });

  it.each([
    [0, 25],
    [6, 25],
    [2.5, 25],
    [1, 7],
    [1, 0],
  ])('rejects coins=%p coinValue=%p', (coins, coinValue) => {
    expect(() => dealVideoPoker(coins, coinValue, new SeededRng(1))).toThrow();
  });

  it('hides the deck in the public view', () => {
    const view = videoPokerPublicView(dealVideoPoker(1, 5, new SeededRng(1)));
    expect(view).not.toHaveProperty('deck');
    expect(view.hand).toHaveLength(5);
  });
});

describe('cards', () => {
  it('parses and formats card codes', () => {
    expect(parseCard('TH')).toEqual({ rank: 10, suit: 'H' });
    expect(cardCode(parseCard('AS'))).toBe('AS');
    expect(() => parseCard('1S')).toThrow('Invalid card code');
  });
});
