import type {
  LinesRoundResult,
  LinesSlotConfig,
  SlotConfig,
  SlotRoundResult,
  WaysRoundResult,
  WaysSlotConfig,
} from '@casino/game-engine';
import { formatCredits } from '@casino/ui';

/** How big a celebration a win gets, relative to the stake. */
export type WinTier = 'none' | 'small' | 'medium' | 'big' | 'mega';

export function winTier(win: number, bet: number): WinTier {
  if (win <= 0) return 'none';
  const x = win / bet;
  if (x < 2) return 'small';
  if (x < 10) return 'medium';
  if (x < 50) return 'big';
  return 'mega';
}

/** Count-up duration for the win banner, scaled by tier (0 = show instantly). */
export function countUpMs(
  tier: WinTier,
  reducedMotion: boolean,
  turbo: boolean,
): number {
  if (reducedMotion) return 0;
  const base = { none: 0, small: 0, medium: 900, big: 2200, mega: 4000 }[tier];
  return turbo ? base / 3 : base;
}

const symbolName = (config: SlotConfig, id: string) =>
  config.symbols.find((s) => s.id === id)?.name ?? id;

/** Screen-reader text for what the reels show: row by row for fixed grids, reel by reel for ways games. */
export function describeGrid(
  config: SlotConfig,
  grid: readonly (readonly string[])[],
): string {
  if (config.kind === 'ways') {
    return grid
      .map((column, reel) => {
        const names = column.map((id) => symbolName(config, id)).join(', ');
        return $localize`:@@slot.describe.reel:Reel ${reel + 1}:reel:: ${names}:names:`;
      })
      .join('. ');
  }
  const rows: string[] = [];
  for (let row = 0; row < config.rows; row++) {
    const names = grid
      .map((column) => symbolName(config, column[row]))
      .join(', ');
    rows.push(
      $localize`:@@slot.describe.row:Row ${row + 1}:row:: ${names}:names:`,
    );
  }
  return rows.join('. ');
}

/** Outcome of a cascading ways round for the live region. */
export function describeWaysOutcome(
  config: WaysSlotConfig,
  result: WaysRoundResult,
  locale = 'en-US',
): string {
  if (result.totalWin === 0) return $localize`:@@slot.describe.noWin:No win.`;
  const winning = result.cascades.filter((c) => c.wins.length > 0);
  const symbols = [
    ...new Set(
      winning.flatMap((c) => c.wins.map((w) => symbolName(config, w.symbol))),
    ),
  ].join(', ');
  const amount = formatCredits(result.totalWin, locale);
  const cascades = winning.length;
  return $localize`:@@slot.describe.ways:You won ${amount}:amount: credits over ${cascades}:cascades: cascades with ${symbols}:symbols:.`;
}

/** One-sentence summary of a round's outcome for the live region. */
export function describeOutcome(
  config: LinesSlotConfig,
  result: LinesRoundResult,
  locale = 'en-US',
): string {
  if (result.totalWin === 0) return $localize`:@@slot.describe.noWin:No win.`;
  const parts = result.base.lineWins.map((w) => {
    const count = w.count;
    const symbol = symbolName(config, w.symbol);
    const line = w.line + 1;
    return $localize`:@@slot.describe.line:${count}:count: ${symbol}:symbol: on line ${line}:line:`;
  });
  if (result.base.scatterWin) {
    const count = result.base.scatterWin.count;
    parts.push($localize`:@@slot.describe.scatter:${count}:count: scatters`);
  }
  if (result.freeSpins) {
    const spins = result.freeSpins.awarded;
    parts.push(
      $localize`:@@slot.describe.freeSpins:${spins}:spins: free spins`,
    );
  }
  if (result.bonus)
    parts.push($localize`:@@slot.describe.bonus:the bonus game`);
  const amount = formatCredits(result.totalWin, locale);
  const details = parts.join(', ');
  return $localize`:@@slot.describe.win:You won ${amount}:amount: credits: ${details}:details:.`;
}

export interface AutoplaySettings {
  /** Total spins to play (10-100). */
  spins: number;
  /** Stop once net losses since starting reach this many minor units. */
  lossLimit: number;
  /** Stop after any single win of at least this many minor units (null = never). */
  singleWinLimit: number | null;
  /** Stop when free spins or a bonus is triggered. */
  stopOnFeature: boolean;
}

export interface AutoplayProgress {
  readonly settings: AutoplaySettings;
  readonly played: number;
  readonly startBalance: number;
}

export type AutoplayStop =
  'done' | 'loss-limit' | 'single-win' | 'feature' | 'balance' | null;

/** Decides, after each settled spin, whether autoplay must stop (and why). */
export function autoplayStopReason(
  progress: AutoplayProgress,
  result: SlotRoundResult,
  balance: number,
  nextBet: number,
): AutoplayStop {
  const { settings, played, startBalance } = progress;
  if (
    settings.singleWinLimit !== null &&
    result.totalWin >= settings.singleWinLimit
  )
    return 'single-win';
  if (
    settings.stopOnFeature &&
    result.kind === 'lines' &&
    (result.freeSpins || result.bonus)
  )
    return 'feature';
  if (startBalance - balance >= settings.lossLimit) return 'loss-limit';
  if (balance < nextBet) return 'balance';
  if (played >= settings.spins) return 'done';
  return null;
}
