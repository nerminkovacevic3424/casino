import { Minor, mulMinor } from '../money';
import { Rng, randomInt, weightedIndex } from '../rng/rng';
import {
  BonusPick,
  Grid,
  LineWin,
  LinesRoundResult,
  LinesSlotConfig,
  LinesSpin,
  PickBonusFeature,
  ScatterWin,
  SymbolId,
  SymbolKind,
} from './types';

/** Precomputed lookups so the hot evaluation loop avoids repeated searches. */
export interface LinesContext {
  readonly config: LinesSlotConfig;
  readonly kinds: ReadonlyMap<SymbolId, SymbolKind>;
  readonly wild: SymbolId | undefined;
}

export function createLinesContext(config: LinesSlotConfig): LinesContext {
  const kinds = new Map(config.symbols.map((s) => [s.id, s.kind] as const));
  return {
    config,
    kinds,
    wild: config.symbols.find((s) => s.kind === 'wild')?.id,
  };
}

export function spinGrid(
  config: LinesSlotConfig,
  rng: Rng,
): { stops: number[]; grid: Grid } {
  const stops = config.reels.map((strip) => randomInt(rng, strip.length));
  return { stops, grid: gridFromStops(config, stops) };
}

export function gridFromStops(
  config: LinesSlotConfig,
  stops: readonly number[],
): Grid {
  return config.reels.map((strip, reel) => {
    const column: SymbolId[] = [];
    for (let row = 0; row < config.rows; row++)
      column.push(strip[(stops[reel] + row) % strip.length]);
    return column;
  });
}

/** Pays the better of the substituted-symbol run and the pure-wild run, left to right. */
export function evaluateLine(
  ctx: LinesContext,
  grid: Grid,
  lineIndex: number,
  lineBet: Minor,
  multiplier: number,
): LineWin | null {
  const { config, kinds, wild } = ctx;
  const line = config.paylines[lineIndex];
  const symbols = line.map((row, reel) => grid[reel][row]);

  let wildRun = 0;
  while (wildRun < symbols.length && symbols[wildRun] === wild) wildRun++;

  const target = symbols[wildRun];
  let symbolRun = 0;
  let symbolPay = 0;
  if (target !== undefined && kinds.get(target) === 'regular') {
    symbolRun = wildRun;
    while (
      symbolRun < symbols.length &&
      (symbols[symbolRun] === target || symbols[symbolRun] === wild)
    )
      symbolRun++;
    symbolPay = config.paytable[target]?.[symbolRun] ?? 0;
  }
  const wildPay =
    wild !== undefined && wildRun > 0
      ? (config.paytable[wild]?.[wildRun] ?? 0)
      : 0;

  if (symbolPay === 0 && wildPay === 0) return null;
  const useWild = wildPay > symbolPay;
  const count = useWild ? wildRun : symbolRun;
  const pay = useWild ? wildPay : symbolPay;
  return {
    line: lineIndex,
    symbol: useWild ? (wild as SymbolId) : target,
    count,
    cells: line.slice(0, count).map((row, reel) => [reel, row] as const),
    win: mulMinor(lineBet, pay * multiplier),
  };
}

export function findSymbolCells(
  grid: Grid,
  symbol: SymbolId,
): [number, number][] {
  const cells: [number, number][] = [];
  grid.forEach((column, reel) =>
    column.forEach((s, row) => {
      if (s === symbol) cells.push([reel, row]);
    }),
  );
  return cells;
}

export function evaluateSpin(
  ctx: LinesContext,
  stops: number[],
  grid: Grid,
  totalBet: Minor,
  multiplier: number,
): LinesSpin {
  const { config } = ctx;
  const lineBet = totalBet / config.betDivisor;
  const lineWins: LineWin[] = [];
  for (let i = 0; i < config.paylines.length; i++) {
    const w = evaluateLine(ctx, grid, i, lineBet, multiplier);
    if (w) lineWins.push(w);
  }

  let scatterWin: ScatterWin | null = null;
  if (config.scatter) {
    const cells = findSymbolCells(grid, config.scatter.symbol);
    const pay = config.scatter.pays[cells.length] ?? 0;
    if (pay > 0) {
      scatterWin = {
        symbol: config.scatter.symbol,
        count: cells.length,
        cells,
        win: mulMinor(totalBet, pay * multiplier),
      };
    }
  }

  const win =
    lineWins.reduce((sum, w) => sum + w.win, 0) + (scatterWin?.win ?? 0);
  return { stops, grid, lineWins, scatterWin, win, multiplier };
}

export function isBonusTriggered(grid: Grid, bonus: PickBonusFeature): boolean {
  return bonus.triggerReels.every((reel) => grid[reel].includes(bonus.symbol));
}

export function playPickBonus(
  bonus: PickBonusFeature,
  totalBet: Minor,
  rng: Rng,
): BonusPick[] {
  const cashPrizes = bonus.prizes.filter((p) => p.prize !== 'collect');
  const picks: BonusPick[] = [];
  while (picks.length < bonus.boxes) {
    const table =
      picks.length < bonus.guaranteedPicks ? cashPrizes : bonus.prizes;
    const { prize } =
      table[
        weightedIndex(
          rng,
          table.map((p) => p.weight),
        )
      ];
    if (prize === 'collect') {
      picks.push({ prize, win: 0 });
      break;
    }
    picks.push({ prize, win: mulMinor(totalBet, prize) });
  }
  return picks;
}

export function playLinesRound(
  ctx: LinesContext,
  totalBet: Minor,
  rng: Rng,
): LinesRoundResult {
  const { config } = ctx;
  const first = spinGrid(config, rng);
  const base = evaluateSpin(ctx, first.stops, first.grid, totalBet, 1);

  let freeSpins: LinesRoundResult['freeSpins'] = null;
  const fs = config.scatter?.freeSpins;
  const scatter = config.scatter?.symbol;
  if (
    fs &&
    scatter &&
    findSymbolCells(base.grid, scatter).length >= fs.minCount
  ) {
    const spins: LinesSpin[] = [];
    let remaining = fs.spins;
    let awarded = fs.spins;
    while (remaining > 0) {
      remaining--;
      const s = spinGrid(config, rng);
      const spin = evaluateSpin(ctx, s.stops, s.grid, totalBet, fs.multiplier);
      spins.push(spin);
      if (findSymbolCells(s.grid, scatter).length >= fs.minCount) {
        const extra = Math.min(fs.retriggerSpins, fs.maxTotalSpins - awarded);
        awarded += extra;
        remaining += extra;
      }
    }
    freeSpins = {
      awarded,
      spins,
      win: spins.reduce((sum, s) => sum + s.win, 0),
    };
  }

  let bonus: LinesRoundResult['bonus'] = null;
  if (config.pickBonus && isBonusTriggered(base.grid, config.pickBonus)) {
    const picks = playPickBonus(config.pickBonus, totalBet, rng);
    bonus = {
      picks,
      boxes: config.pickBonus.boxes,
      win: picks.reduce((sum, p) => sum + p.win, 0),
    };
  }

  const raw = base.win + (freeSpins?.win ?? 0) + (bonus?.win ?? 0);
  const cap = mulMinor(totalBet, config.maxWinMultiplier);
  return {
    kind: 'lines',
    gameId: config.id,
    totalBet,
    base,
    freeSpins,
    bonus,
    totalWin: Math.min(raw, cap),
    capped: raw > cap,
  };
}
