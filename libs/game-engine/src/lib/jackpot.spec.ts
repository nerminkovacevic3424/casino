import {
  JACKPOT_ODDS_DIVISOR,
  jackpotContribution,
  rollJackpot,
} from './jackpot';
import { ScriptedRng, SeededRng } from './rng/rng';
import { replayRound } from './verify';

describe('jackpot', () => {
  it('hits when the draw falls below the stake', () => {
    expect(rollJackpot(new ScriptedRng([99]), 100)).toBe(true);
    expect(rollJackpot(new ScriptedRng([100]), 100)).toBe(false);
  });

  it('has a hit rate proportional to the bet', () => {
    const rng = new SeededRng(9);
    const bet = JACKPOT_ODDS_DIVISOR / 100; // 1% chance
    let hits = 0;
    for (let i = 0; i < 50_000; i++) if (rollJackpot(rng, bet)) hits++;
    expect(hits / 50_000).toBeGreaterThan(0.008);
    expect(hits / 50_000).toBeLessThan(0.012);
  });

  it('contributes 1% of the stake, rounded down', () => {
    expect(jackpotContribution(100)).toBe(1);
    expect(jackpotContribution(99)).toBe(0);
    expect(jackpotContribution(5000)).toBe(50);
  });

  it('is part of the verifiable slot replay and drawn after the slot outcome', () => {
    const seed = {
      serverSeed: 'ab'.repeat(32),
      clientSeed: 'jackpot',
      nonce: 3,
    };
    const replay = replayRound(seed, {
      game: 'slot',
      gameId: 'classic-3-reel',
      totalBet: 100,
    });
    expect(replay.game === 'slot' && typeof replay.jackpotHit).toBe('boolean');
    const again = replayRound(seed, {
      game: 'slot',
      gameId: 'classic-3-reel',
      totalBet: 100,
    });
    expect(again).toEqual(replay);
  });
});
