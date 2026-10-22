import { Minor } from './money';
import { Rng, randomInt } from './rng/rng';

/**
 * Community jackpot. After every slot round one more value is drawn from the
 * same provably fair stream; the round hits the jackpot when it falls below
 * the stake, so the chance is proportional to the bet:
 *   P(hit) = totalBet / JACKPOT_ODDS_DIVISOR  (1.00 credit → 1 in 200,000).
 * The draw happens after the slot outcome, so it never changes the reels.
 */
export const JACKPOT_ODDS_DIVISOR = 20_000_000;

/** Pool the jackpot restarts from after a win (500.00 credits). */
export const JACKPOT_SEED: Minor = 50_000;

/** House-funded contribution added to the pool per slot stake (1%). */
export const jackpotContribution = (stake: Minor): Minor =>
  Math.floor(stake / 100);

export function rollJackpot(rng: Rng, totalBet: Minor): boolean {
  return (
    randomInt(rng, JACKPOT_ODDS_DIVISOR) <
    Math.min(totalBet, JACKPOT_ODDS_DIVISOR)
  );
}
