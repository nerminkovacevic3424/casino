import type { SymbolId } from '@casino/game-engine';

export type ReelPhase = 'idle' | 'spinning' | 'stopping' | 'settling';

/**
 * Pure motion model for one reel, independent of PixiJS so it can be unit
 * tested. `cells[0]` sits just above the window; `cells[1..rows]` are visible.
 * `offset` is how far (in cell units, 0..1) the column has slid downwards.
 */
export class ReelModel {
  cells: SymbolId[];
  offset = 0;
  phase: ReelPhase = 'idle';
  private queue: SymbolId[] = [];
  private stripIndex: number;
  private settleFrom = 0;
  private settleElapsed = 0;

  constructor(
    private readonly strip: readonly SymbolId[],
    readonly rows: number,
    start = 0,
  ) {
    this.stripIndex = start;
    this.cells = Array.from(
      { length: rows + 1 },
      (_, i) => strip[(start + i - 1 + strip.length) % strip.length],
    );
  }

  /** Visible symbols, top to bottom. */
  get visible(): SymbolId[] {
    return this.cells.slice(1);
  }

  /** Places a grid column immediately (initial render, reduced motion). */
  setColumn(column: readonly SymbolId[]): void {
    this.cells = [this.nextFiller(), ...column];
    this.offset = 0;
    this.queue = [];
    this.phase = 'idle';
  }

  start(): void {
    this.phase = 'spinning';
    this.queue = [];
  }

  /**
   * Queues the final column so it scrolls into place: the bottom symbol enters
   * first, then the rest, then one filler for the slot above the window.
   */
  stopOn(column: readonly SymbolId[]): void {
    if (this.phase !== 'spinning') return;
    this.queue = [...column].reverse();
    this.queue.push(this.nextFiller());
    this.phase = 'stopping';
  }

  /**
   * Advances by `cellsMoved` cell heights (speed × time). Returns true on the
   * frame the reel lands, so the caller can play a sound.
   */
  advance(cellsMoved: number, deltaMs: number, settleMs = 140): boolean {
    if (this.phase === 'settling') {
      this.settleElapsed += deltaMs;
      const t = Math.min(1, this.settleElapsed / settleMs);
      // Ease back from the overshoot to perfect alignment.
      this.offset = this.settleFrom * (1 - easeOutBack(t));
      if (t >= 1) {
        this.offset = 0;
        this.phase = 'idle';
      }
      return false;
    }
    if (this.phase !== 'spinning' && this.phase !== 'stopping') return false;

    this.offset += cellsMoved;
    while (this.offset >= 1) {
      this.offset -= 1;
      this.cells.pop();
      if (this.phase === 'stopping') {
        const next = this.queue.shift();
        this.cells.unshift(next ?? this.nextFiller());
        if (this.queue.length === 0) {
          // Final column is in place (overshot by `offset`): settle back with a bounce.
          this.phase = 'settling';
          this.settleFrom = Math.min(this.offset, 0.35);
          this.settleElapsed = 0;
          return true;
        }
      } else {
        this.cells.unshift(this.nextFiller());
      }
    }
    return false;
  }

  /** Real reels scroll their strip downwards, so new symbols come from earlier strip positions. */
  private nextFiller(): SymbolId {
    this.stripIndex =
      (this.stripIndex - 1 + this.strip.length) % this.strip.length;
    return this.strip[this.stripIndex];
  }
}

/** Overshoot easing (CSS "back"). */
export function easeOutBack(t: number, overshoot = 1.4): number {
  const c3 = overshoot + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
}
