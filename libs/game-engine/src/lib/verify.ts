import {
  BlackjackAction,
  BlackjackPublicView,
  applyBlackjackAction,
  dealBlackjack,
  toPublicView,
} from './blackjack/blackjack';
import { Minor } from './money';
import {
  RouletteBet,
  RouletteRoundResult,
  playRoulette,
} from './roulette/roulette';
import { FairSeedInput, createFairRng } from './rng/provably-fair';
import { HmacFn } from './rng/sha256';
import { getSlotConfig } from './slots/configs';
import { playSlot } from './slots/slot-engine';
import { SlotRoundResult } from './slots/types';
import {
  VideoPokerState,
  dealVideoPoker,
  drawVideoPoker,
  videoPokerPublicView,
} from './video-poker/video-poker';

/** Everything the player chose for a round — together with the seeds this fully determines the outcome. */
export type RoundInput =
  | { readonly game: 'slot'; readonly gameId: string; readonly totalBet: Minor }
  | { readonly game: 'roulette'; readonly bets: readonly RouletteBet[] }
  | {
      readonly game: 'blackjack';
      readonly bet: Minor;
      readonly actions: readonly BlackjackAction[];
    }
  | {
      readonly game: 'video-poker';
      readonly coins: number;
      readonly coinValue: Minor;
      readonly held: readonly boolean[];
    };

export type RoundReplay =
  | {
      readonly game: 'slot';
      readonly totalBet: Minor;
      readonly totalPayout: Minor;
      readonly result: SlotRoundResult;
    }
  | {
      readonly game: 'roulette';
      readonly totalBet: Minor;
      readonly totalPayout: Minor;
      readonly result: RouletteRoundResult;
    }
  | {
      readonly game: 'blackjack';
      readonly totalBet: Minor;
      readonly totalPayout: Minor;
      readonly result: BlackjackPublicView;
    }
  | {
      readonly game: 'video-poker';
      readonly totalBet: Minor;
      readonly totalPayout: Minor;
      readonly result: Omit<VideoPokerState, 'deck'>;
    };

/**
 * Deterministically recomputes a round from its revealed seeds and inputs.
 * Used by the "Verify bet" page (browser) and by server-side audits.
 */
export function replayRound(
  seed: FairSeedInput,
  input: RoundInput,
  hmac?: HmacFn,
): RoundReplay {
  const rng = createFairRng(seed, hmac);
  switch (input.game) {
    case 'slot': {
      const result = playSlot(getSlotConfig(input.gameId), input.totalBet, rng);
      return {
        game: 'slot',
        totalBet: result.totalBet,
        totalPayout: result.totalWin,
        result,
      };
    }
    case 'roulette': {
      const result = playRoulette(input.bets, rng);
      return {
        game: 'roulette',
        totalBet: result.totalBet,
        totalPayout: result.totalPayout,
        result,
      };
    }
    case 'blackjack': {
      let state = dealBlackjack(input.bet, rng);
      for (const action of input.actions)
        state = applyBlackjackAction(state, action).state;
      return {
        game: 'blackjack',
        totalBet: state.totalStaked,
        totalPayout: state.totalPayout,
        result: toPublicView(state),
      };
    }
    case 'video-poker': {
      const dealt = dealVideoPoker(input.coins, input.coinValue, rng);
      const state = drawVideoPoker(dealt, input.held);
      return {
        game: 'video-poker',
        totalBet: state.bet,
        totalPayout: state.payout,
        result: videoPokerPublicView(state),
      };
    }
  }
}
