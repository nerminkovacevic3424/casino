import {
  BlackjackAction,
  BlackjackPublicView,
  BlackjackState,
  Rng,
  VideoPokerState,
  applyBlackjackAction,
  dealBlackjack,
  dealVideoPoker,
  drawVideoPoker,
  toPublicView,
  videoPokerPublicView,
} from '@casino/game-engine';
import type { GameId } from '@casino/shared-types';

/**
 * A game played over several requests. Its state is never stored: it is
 * rebuilt on every request from the round's seeds and the player's recorded
 * inputs — exactly what the Verify page does — so the server state and the
 * verifiable state cannot diverge.
 */
export interface StepGame<S, V, I extends object> {
  readonly gameId: GameId;
  /** Deterministically rebuilds the state; throws on illegal inputs. */
  replay(rng: Rng, input: I): S;
  view(state: S): V;
  settled(state: S): boolean;
  /** Everything staked so far (base bet plus doubles, splits, insurance...). */
  stake(state: S): number;
  payout(state: S): number;
  /** Number of player decisions recorded so far (for the action sequence check). */
  steps(input: I): number;
  /** The input as it was after the first `steps` decisions. */
  truncate(input: I, steps: number): I;
}

export interface BlackjackInput {
  bet: number;
  actions: BlackjackAction[];
}

export const BLACKJACK: StepGame<
  BlackjackState,
  BlackjackPublicView,
  BlackjackInput
> = {
  gameId: 'blackjack',
  replay(rng, input) {
    let state = dealBlackjack(input.bet, rng);
    for (const action of input.actions)
      state = applyBlackjackAction(state, action).state;
    return state;
  },
  view: toPublicView,
  settled: (s) => s.phase === 'settled',
  stake: (s) => s.totalStaked,
  payout: (s) => s.totalPayout,
  steps: (input) => input.actions.length,
  truncate: (input, steps) => ({
    ...input,
    actions: input.actions.slice(0, steps),
  }),
};

export interface VideoPokerInput {
  coins: number;
  coinValue: number;
  /** Absent until the player draws. */
  held?: boolean[];
}

export type VideoPokerView = Omit<VideoPokerState, 'deck'>;

export const VIDEO_POKER: StepGame<
  VideoPokerState,
  VideoPokerView,
  VideoPokerInput
> = {
  gameId: 'video-poker',
  replay(rng, input) {
    const dealt = dealVideoPoker(input.coins, input.coinValue, rng);
    return input.held ? drawVideoPoker(dealt, input.held) : dealt;
  },
  view: videoPokerPublicView,
  settled: (s) => s.phase === 'settled',
  stake: (s) => s.bet,
  payout: (s) => s.payout,
  steps: (input) => (input.held ? 1 : 0),
  truncate: (input, steps) =>
    steps >= 1 ? input : { coins: input.coins, coinValue: input.coinValue },
};
