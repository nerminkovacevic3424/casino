import { createHmac } from 'node:crypto';
import {
  BlackjackAction,
  applyBlackjackAction,
  dealBlackjack,
  toPublicView,
} from './blackjack/blackjack';
import { playRoulette } from './roulette/roulette';
import { createFairRng } from './rng/provably-fair';
import { VIDEO_5_REEL } from './slots/configs';
import { playSlot } from './slots/slot-engine';
import { replayRound } from './verify';
import { dealVideoPoker, drawVideoPoker } from './video-poker/video-poker';

const seed = {
  serverSeed: '0f'.repeat(32),
  clientSeed: 'verify-me',
  nonce: 42,
};
const nodeHmac = (k: Uint8Array, m: Uint8Array) =>
  new Uint8Array(createHmac('sha256', k).update(m).digest());

describe('replayRound', () => {
  it('replays slot rounds exactly', () => {
    const direct = playSlot(VIDEO_5_REEL, 200, createFairRng(seed));
    const replay = replayRound(seed, {
      game: 'slot',
      gameId: VIDEO_5_REEL.id,
      totalBet: 200,
    });
    expect(replay).toEqual({
      game: 'slot',
      totalBet: 200,
      totalPayout: direct.totalWin,
      result: direct,
      jackpotHit: expect.any(Boolean),
    });
  });

  it('replays roulette rounds exactly', () => {
    const bets = [{ type: 'red' as const, amount: 100 }];
    const direct = playRoulette(bets, createFairRng(seed));
    expect(replayRound(seed, { game: 'roulette', bets })).toMatchObject({
      totalBet: 100,
      totalPayout: direct.totalPayout,
      result: { number: direct.number },
    });
  });

  it('replays blackjack including the player actions', () => {
    let state = dealBlackjack(100, createFairRng(seed));
    const actions: BlackjackAction[] = [];
    while (state.phase !== 'settled') {
      const action: BlackjackAction =
        state.phase === 'insurance' ? 'no-insurance' : 'hit';
      actions.push(action);
      state = applyBlackjackAction(state, action).state;
    }
    const replay = replayRound(seed, { game: 'blackjack', bet: 100, actions });
    expect(replay.result).toEqual(toPublicView(state));
    expect(replay.totalPayout).toBe(state.totalPayout);
  });

  it('replays video poker deal and draw', () => {
    const held = [true, false, true, false, false];
    const direct = drawVideoPoker(
      dealVideoPoker(5, 25, createFairRng(seed)),
      held,
    );
    const replay = replayRound(seed, {
      game: 'video-poker',
      coins: 5,
      coinValue: 25,
      held,
    });
    expect(replay).toMatchObject({
      totalBet: 125,
      totalPayout: direct.payout,
      result: { hand: direct.hand },
    });
  });

  it('gives identical results with an injected native HMAC', () => {
    const input = { game: 'slot' as const, gameId: 'megaways', totalBet: 500 };
    expect(replayRound(seed, input, nodeHmac)).toEqual(
      replayRound(seed, input),
    );
  });
});
