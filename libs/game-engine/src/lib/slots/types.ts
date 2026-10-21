import { Minor } from '../money';

export type SymbolId = string;
export type SymbolKind = 'regular' | 'wild' | 'scatter' | 'bonus';

export interface SymbolDef {
  readonly id: SymbolId;
  readonly name: string;
  readonly kind: SymbolKind;
}

/** Pay multipliers keyed by number of matching symbols, e.g. `{ 3: 5, 4: 20, 5: 100 }`. */
export type PayEntry = Readonly<Partial<Record<number, number>>>;

interface SlotConfigBase {
  readonly id: string;
  readonly name: string;
  /** Documented design RTP, e.g. 0.96. Verified by the simulation CI check. */
  readonly targetRtp: number;
  readonly symbols: readonly SymbolDef[];
  /** Allowed total bets in minor units; each must be divisible by `betDivisor`. */
  readonly betOptions: readonly Minor[];
  /** Total bet is split into this many units (paylines, or the ways bet divisor). */
  readonly betDivisor: number;
  /** Total win per round is capped at `maxWinMultiplier * totalBet`. */
  readonly maxWinMultiplier: number;
}

export interface ScatterFeature {
  readonly symbol: SymbolId;
  /** Scatter pays, as multiples of the *total* bet, keyed by count. */
  readonly pays: PayEntry;
  readonly freeSpins?: {
    readonly minCount: number;
    readonly spins: number;
    readonly multiplier: number;
    /** Spins awarded when the trigger lands again during free spins. */
    readonly retriggerSpins: number;
    readonly maxTotalSpins: number;
  };
}

export interface PickBonusFeature {
  readonly symbol: SymbolId;
  /** Bonus symbol must land on all of these reels (0-based) to trigger. */
  readonly triggerReels: readonly number[];
  /** Number of boxes shown to the player. */
  readonly boxes: number;
  /** Each pick draws from this table; `collect` ends the bonus. Prize is a multiple of total bet. */
  readonly prizes: readonly {
    readonly weight: number;
    readonly prize: number | 'collect';
  }[];
  /** The first N picks can never be `collect`, so a trigger always pays something. */
  readonly guaranteedPicks: number;
}

/** Fixed grid, left-to-right payline evaluation. */
export interface LinesSlotConfig extends SlotConfigBase {
  readonly kind: 'lines';
  readonly rows: number;
  readonly reels: readonly (readonly SymbolId[])[];
  /** Each payline lists the row index (0 = top) used on each reel. */
  readonly paylines: readonly (readonly number[])[];
  /** Line pays as multiples of the *line* bet (`totalBet / betDivisor`). */
  readonly paytable: Readonly<Record<SymbolId, PayEntry>>;
  readonly scatter?: ScatterFeature;
  readonly pickBonus?: PickBonusFeature;
}

/** Variable rows per reel, ways-to-win, cascading wins with growing multiplier. */
export interface WaysSlotConfig extends SlotConfigBase {
  readonly kind: 'ways';
  readonly reels: readonly (readonly SymbolId[])[];
  readonly minRows: number;
  readonly maxRows: number;
  /** Weights for row counts `minRows..maxRows` (index 0 = minRows). */
  readonly rowWeights: readonly number[];
  /** Way pays as multiples of the bet unit (`totalBet / betDivisor`) per way. */
  readonly paytable: Readonly<Record<SymbolId, PayEntry>>;
  /** Multiplier added after every cascade (1 → 1+step → 1+2·step ...). */
  readonly multiplierStep: number;
  readonly maxCascades: number;
}

export type SlotConfig = LinesSlotConfig | WaysSlotConfig;

/** `grid[reel][row]` */
export type Grid = SymbolId[][];

export interface LineWin {
  readonly line: number;
  readonly symbol: SymbolId;
  readonly count: number;
  /** Cells as `[reel, row]` pairs, for highlighting. */
  readonly cells: readonly (readonly [number, number])[];
  readonly win: Minor;
}

export interface ScatterWin {
  readonly symbol: SymbolId;
  readonly count: number;
  readonly cells: readonly (readonly [number, number])[];
  readonly win: Minor;
}

export interface LinesSpin {
  readonly stops: number[];
  readonly grid: Grid;
  readonly lineWins: LineWin[];
  readonly scatterWin: ScatterWin | null;
  /** Win including the active multiplier. */
  readonly win: Minor;
  readonly multiplier: number;
}

export interface BonusPick {
  readonly prize: number | 'collect';
  readonly win: Minor;
}

export interface LinesRoundResult {
  readonly kind: 'lines';
  readonly gameId: string;
  readonly totalBet: Minor;
  readonly base: LinesSpin;
  readonly freeSpins: {
    readonly awarded: number;
    readonly spins: LinesSpin[];
    readonly win: Minor;
  } | null;
  readonly bonus: {
    readonly picks: BonusPick[];
    readonly boxes: number;
    readonly win: Minor;
  } | null;
  readonly totalWin: Minor;
  readonly capped: boolean;
}

export interface WaysWin {
  readonly symbol: SymbolId;
  /** Number of consecutive reels from the left. */
  readonly reels: number;
  readonly ways: number;
  readonly cells: readonly (readonly [number, number])[];
  readonly win: Minor;
}

export interface Cascade {
  readonly grid: Grid;
  readonly multiplier: number;
  readonly wins: WaysWin[];
  readonly win: Minor;
}

export interface WaysRoundResult {
  readonly kind: 'ways';
  readonly gameId: string;
  readonly totalBet: Minor;
  readonly rows: number[];
  readonly stops: number[];
  readonly cascades: Cascade[];
  readonly totalWin: Minor;
  readonly capped: boolean;
}

export type SlotRoundResult = LinesRoundResult | WaysRoundResult;
