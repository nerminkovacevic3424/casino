import { Minor, assertPositiveMinor } from '../money';
import { Rng } from '../rng/rng';
import { LinesContext, createLinesContext, playLinesRound } from './lines';
import { SlotConfig, SlotRoundResult } from './types';
import { WaysContext, createWaysContext, playWaysRound } from './ways';

export class InvalidBetError extends Error {
  override readonly name = 'InvalidBetError';
}

/** Structural checks run at startup, in tests and before an admin config change. */
export function validateSlotConfig(config: SlotConfig): string[] {
  const errors: string[] = [];
  const ids = new Set(config.symbols.map((s) => s.id));
  if (ids.size !== config.symbols.length) errors.push('duplicate symbol ids');
  if (config.symbols.filter((s) => s.kind === 'wild').length > 1)
    errors.push('at most one wild symbol');
  if (!(config.targetRtp > 0.8 && config.targetRtp < 1))
    errors.push('targetRtp must be in (0.8, 1)');
  if (config.betOptions.length === 0)
    errors.push('betOptions must not be empty');
  for (const bet of config.betOptions) {
    if (
      !Number.isSafeInteger(bet) ||
      bet <= 0 ||
      bet % config.betDivisor !== 0
    ) {
      errors.push(
        `bet option ${bet} must be a positive multiple of ${config.betDivisor}`,
      );
    }
  }
  config.reels.forEach((strip, reel) => {
    if (strip.length === 0) errors.push(`reel ${reel} is empty`);
    for (const s of strip)
      if (!ids.has(s))
        errors.push(`reel ${reel} references unknown symbol ${s}`);
  });
  for (const symbol of Object.keys(config.paytable)) {
    if (!ids.has(symbol))
      errors.push(`paytable references unknown symbol ${symbol}`);
    for (const pay of Object.values(config.paytable[symbol])) {
      if (!Number.isInteger(pay) || (pay as number) < 0)
        errors.push(`pay for ${symbol} must be a non-negative integer`);
    }
  }

  if (config.kind === 'lines') {
    if (config.betDivisor !== config.paylines.length)
      errors.push('betDivisor must equal the number of paylines');
    config.paylines.forEach((line, i) => {
      if (line.length !== config.reels.length)
        errors.push(`payline ${i} must cover every reel`);
      if (
        line.some(
          (row) => !Number.isInteger(row) || row < 0 || row >= config.rows,
        )
      ) {
        errors.push(`payline ${i} has an out-of-range row`);
      }
    });
    if (config.scatter && !ids.has(config.scatter.symbol))
      errors.push('unknown scatter symbol');
    if (config.pickBonus) {
      const b = config.pickBonus;
      if (!ids.has(b.symbol)) errors.push('unknown bonus symbol');
      if (!b.prizes.some((p) => p.prize === 'collect'))
        errors.push('pick bonus needs a collect outcome');
      if (b.guaranteedPicks >= b.boxes)
        errors.push('guaranteedPicks must be less than boxes');
      if (b.triggerReels.some((r) => r < 0 || r >= config.reels.length))
        errors.push('bonus trigger reel out of range');
    }
  } else {
    if (config.rowWeights.length !== config.maxRows - config.minRows + 1) {
      errors.push('rowWeights must have one entry per row count');
    }
    config.reels.forEach((strip, reel) => {
      if (strip.length < config.maxRows)
        errors.push(`reel ${reel} is shorter than maxRows`);
    });
  }
  return errors;
}

type Context = LinesContext | WaysContext;
const contexts = new WeakMap<SlotConfig, Context>();

function contextFor(config: SlotConfig): Context {
  let ctx = contexts.get(config);
  if (!ctx) {
    const errors = validateSlotConfig(config);
    if (errors.length > 0)
      throw new Error(`Invalid slot config ${config.id}: ${errors.join('; ')}`);
    ctx =
      config.kind === 'lines'
        ? createLinesContext(config)
        : createWaysContext(config);
    contexts.set(config, ctx);
  }
  return ctx;
}

export function assertSlotBet(config: SlotConfig, totalBet: Minor): void {
  assertPositiveMinor(totalBet, 'totalBet');
  if (!config.betOptions.includes(totalBet)) {
    throw new InvalidBetError(
      `Bet ${totalBet} is not an allowed bet for ${config.id}`,
    );
  }
}

/** Resolves one complete paid round, including any free spins / bonus it triggers. */
export function playSlot(
  config: SlotConfig,
  totalBet: Minor,
  rng: Rng,
): SlotRoundResult {
  assertSlotBet(config, totalBet);
  const ctx = contextFor(config);
  return config.kind === 'lines'
    ? playLinesRound(ctx as LinesContext, totalBet, rng)
    : playWaysRound(ctx as WaysContext, totalBet, rng);
}
