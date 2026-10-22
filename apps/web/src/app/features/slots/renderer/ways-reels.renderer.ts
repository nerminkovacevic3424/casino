import type { Cascade, Grid, WaysSlotConfig } from '@casino/game-engine';
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js';
import { SymbolAtlas } from './symbol-atlas';
import { Tweener, easeInQuad, easeOutBounce, easeOutCubic } from './tweens';

export interface WaysRendererOptions {
  reducedMotion: boolean;
  turbo: boolean;
  onReelStop?: (reel: number) => void;
  onCascade?: (index: number) => void;
}

interface Cell {
  sprite: Sprite;
  symbol: string;
}

/**
 * Megaways-style renderer: every reel has its own row count (2-7), wins
 * tumble — winning symbols burst, survivors fall and new symbols drop in —
 * and the multiplier climbs with each cascade. It only replays the cascade
 * sequence the server computed.
 */
export class WaysReelsRenderer {
  private readonly app = new Application();
  private readonly board = new Container();
  private readonly frames = new Graphics();
  private atlas!: SymbolAtlas;
  private tweens!: Tweener;
  private columns: Cell[][] = [];
  private reelContainers: Container[] = [];
  private multiplierText!: Text;
  private width = 0;
  private height = 0;
  private spinning = false;
  private destroyed = false;

  private constructor(
    private readonly host: HTMLElement,
    private readonly config: WaysSlotConfig,
    private options: WaysRendererOptions,
  ) {}

  static async create(
    host: HTMLElement,
    config: WaysSlotConfig,
    options: WaysRendererOptions,
  ): Promise<WaysReelsRenderer> {
    const renderer = new WaysReelsRenderer(host, config, options);
    await renderer.init();
    return renderer;
  }

  private async init(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, globalThis.devicePixelRatio || 1),
      autoStart: false,
      preference: 'webgl',
    });
    this.app.canvas.setAttribute('aria-hidden', 'true');
    this.app.canvas.style.display = 'block';
    this.host.appendChild(this.app.canvas);
    this.atlas = SymbolAtlas.build(
      this.app.renderer,
      this.config.symbols.map((s) => s.id),
    );
    this.tweens = new Tweener(this.app.ticker);
    this.app.ticker.add(this.idleCheck);

    this.app.stage.addChild(this.board);
    for (let r = 0; r < this.config.reels.length; r++) {
      const reel = new Container();
      const mask = new Graphics();
      reel.mask = mask;
      reel.addChild(mask);
      this.reelContainers.push(reel);
      this.board.addChild(reel);
      this.columns.push([]);
    }
    this.board.addChild(this.frames);
    this.multiplierText = new Text({
      text: '',
      style: {
        fontFamily: 'Impact, "Arial Black", sans-serif',
        fontSize: 28,
        fill: 0xf5c542,
        stroke: { color: 0x000000, width: 5 },
      },
    });
    this.multiplierText.anchor.set(1, 0);
    this.app.stage.addChild(this.multiplierText);
    this.app.renderer.on('resize', () => this.layout());
    this.layout();
  }

  setOptions(options: Partial<WaysRendererOptions>): void {
    this.options = { ...this.options, ...options };
  }

  setGrid(grid: Grid): void {
    grid.forEach((column, r) => this.setColumn(r, column));
    this.layout();
  }

  /** Reels blur out while the server resolves the round. */
  spin(): void {
    this.frames.clear();
    this.multiplierText.text = '';
    this.spinning = true;
    const duration = this.options.reducedMotion ? 0 : 160;
    this.columns.forEach((column, r) =>
      column.forEach(
        (cell) =>
          void this.tweens.to(cell.sprite, { alpha: 0.25 }, duration, {
            delay: r * 20,
          }),
      ),
    );
    if (!this.options.reducedMotion) this.app.ticker.start();
    else this.render();
  }

  /** Abandons a spin and restores `grid`. */
  abort(grid: Grid): void {
    this.spinning = false;
    this.setGrid(grid);
  }

  /** Drops the first grid in reel by reel, then plays every cascade. */
  async play(cascades: readonly Cascade[]): Promise<void> {
    const motion = !this.options.reducedMotion;
    const speed = this.options.turbo ? 0.4 : 1;
    const first = cascades[0];
    // New board: every column drops in from above, left to right.
    await Promise.all(
      first.grid.map(async (column, r) => {
        await this.tweens.wait(motion ? r * 140 * speed : 0);
        this.setColumn(r, column);
        this.layoutColumn(r);
        if (motion) {
          const cells = this.columns[r];
          await Promise.all(
            cells.map((cell, i) => {
              const target = cell.sprite.y;
              cell.sprite.y = target - this.height;
              return this.tweens.to(cell.sprite, { y: target }, 420 * speed, {
                ease: easeOutBounce,
                delay: (cells.length - i) * 25,
              });
            }),
          );
        }
        this.options.onReelStop?.(r);
      }),
    );
    this.spinning = false;
    this.render();

    for (let i = 0; i < cascades.length; i++) {
      const cascade = cascades[i];
      if (cascade.wins.length === 0) break;
      this.options.onCascade?.(i);
      this.showMultiplier(cascade.multiplier);
      this.highlight(cascade);
      await this.tweens.wait(motion ? 650 * speed : 250);
      const next = cascades[i + 1];
      if (!next) break;
      await this.tumble(cascade, next.grid, motion, speed);
    }
    this.frames.clear();
    this.render();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.tweens?.destroy();
    this.app.ticker.remove(this.idleCheck);
    this.atlas?.destroy();
    this.app.destroy({ removeView: true }, { children: true });
  }

  // ------------------------------------------------------------------ internals

  private async tumble(
    cascade: Cascade,
    nextGrid: Grid,
    motion: boolean,
    speed: number,
  ): Promise<void> {
    const removed = new Set(
      cascade.wins.flatMap((w) =>
        w.cells.map(([reel, row]) => `${reel}:${row}`),
      ),
    );
    this.frames.clear();
    // Winning symbols burst.
    const bursts: Promise<void>[] = [];
    this.columns.forEach((column, r) =>
      column.forEach((cell, row) => {
        if (removed.has(`${r}:${row}`)) {
          bursts.push(
            this.tweens.to(
              cell.sprite,
              { alpha: 0 },
              motion ? 220 * speed : 0,
              { ease: easeInQuad },
            ),
          );
          bursts.push(
            this.tweens.to(
              cell.sprite.scale,
              { x: cell.sprite.scale.x * 1.3, y: cell.sprite.scale.y * 1.3 },
              motion ? 220 * speed : 0,
            ),
          );
        }
      }),
    );
    await Promise.all(bursts);

    // Survivors fall, new symbols drop in from above (matching the engine's tumble).
    const falls: Promise<void>[] = [];
    nextGrid.forEach((column, r) => {
      const old = this.columns[r];
      const survivors = old.filter((_, row) => !removed.has(`${r}:${row}`));
      const missing = column.length - survivors.length;
      for (const cell of old)
        if (!survivors.includes(cell)) cell.sprite.destroy();
      const incoming: Cell[] = column
        .slice(0, missing)
        .map((symbol) => this.makeCell(r, symbol));
      this.columns[r] = [...incoming, ...survivors];
      const cellH = this.cellHeight(r);
      this.columns[r].forEach((cell, row) => {
        this.fit(cell.sprite, r);
        const targetY = row * cellH + cellH / 2;
        const startY =
          row < missing ? targetY - missing * cellH : cell.sprite.y;
        cell.sprite.y = startY;
        cell.sprite.alpha = 1;
        falls.push(
          this.tweens.to(
            cell.sprite,
            { y: targetY },
            motion ? 320 * speed : 0,
            { ease: easeOutCubic },
          ),
        );
      });
    });
    await Promise.all(falls);
  }

  private highlight(cascade: Cascade): void {
    this.frames.clear();
    const colours = [0xf5c542, 0x3ddc97, 0x6cc4ff, 0xff6b7a, 0x8b7bff];
    cascade.wins.forEach((win, i) => {
      for (const [reel, row] of win.cells) {
        const { x, y, w, h } = this.cellRect(reel, row);
        this.frames
          .roundRect(x + 2, y + 2, w - 4, h - 4, Math.min(w, h) * 0.14)
          .stroke({ color: colours[i % colours.length], width: 3 });
      }
    });
    this.render();
  }

  private showMultiplier(multiplier: number): void {
    this.multiplierText.text = multiplier > 1 ? `×${multiplier}` : '';
    this.render();
  }

  private setColumn(r: number, symbols: readonly string[]): void {
    for (const cell of this.columns[r]) cell.sprite.destroy();
    this.columns[r] = symbols.map((s) => this.makeCell(r, s));
  }

  private makeCell(r: number, symbol: string): Cell {
    const sprite = new Sprite(this.atlas.get(symbol));
    sprite.anchor.set(0.5);
    this.reelContainers[r].addChild(sprite);
    return { sprite, symbol };
  }

  private reelWidth(): number {
    return this.width / this.config.reels.length;
  }

  private cellHeight(r: number): number {
    return this.height / Math.max(1, this.columns[r].length);
  }

  private cellRect(reel: number, row: number) {
    const w = this.reelWidth();
    const h = this.cellHeight(reel);
    return { x: reel * w, y: row * h, w, h };
  }

  private fit(sprite: Sprite, r: number): void {
    const size = Math.min(this.reelWidth(), this.cellHeight(r)) * 0.94;
    sprite.scale.set(size / sprite.texture.width);
    sprite.x = this.reelWidth() / 2;
  }

  private layoutColumn(r: number): void {
    const h = this.cellHeight(r);
    this.columns[r].forEach((cell, row) => {
      this.fit(cell.sprite, r);
      cell.sprite.y = row * h + h / 2;
    });
  }

  private layout(): void {
    const { width, height } = this.app.screen;
    // Keep reels roughly as tall as wide at 7 rows: fit a 6 x 7 board.
    const size = Math.min(
      width / this.config.reels.length,
      height / this.config.maxRows,
    );
    this.width = size * this.config.reels.length;
    this.height = size * this.config.maxRows;
    this.board.position.set(
      (width - this.width) / 2,
      (height - this.height) / 2,
    );
    this.reelContainers.forEach((reel, r) => {
      reel.x = r * this.reelWidth();
      (reel.mask as Graphics)
        .clear()
        .rect(0, 0, this.reelWidth(), this.height)
        .fill({ color: 0xffffff });
      this.layoutColumn(r);
    });
    this.multiplierText.style.fontSize = Math.max(18, size * 0.45);
    this.multiplierText.position.set(
      this.board.x + this.width - 6,
      this.board.y + 4,
    );
    this.render();
  }

  /** Stops the ticker when nothing animates. */
  private readonly idleCheck = (): void => {
    if (!this.tweens.active && !this.spinning) {
      this.app.ticker.stop();
      this.render();
    }
  };

  private render(): void {
    if (!this.destroyed) this.app.render();
  }
}
