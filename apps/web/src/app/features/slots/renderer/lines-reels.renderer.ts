import type {
  Grid,
  LineWin,
  LinesSlotConfig,
  ScatterWin,
} from '@casino/game-engine';
import { Application, Container, Graphics, Sprite, Ticker } from 'pixi.js';
// Pixi compiles shaders with new Function() unless this is loaded; needed under the site's CSP.
import 'pixi.js/unsafe-eval';
import { ReelModel } from './reel-model';
import { SymbolAtlas } from './symbol-atlas';

export interface RendererOptions {
  reducedMotion: boolean;
  turbo: boolean;
  /** Called when a reel lands (for sound). */
  onReelStop?: (reel: number) => void;
}

/** Spin speed in cells per millisecond, and timing for each mode. */
const TIMING = {
  normal: { speed: 0.02, minSpinMs: 650, staggerMs: 230 },
  turbo: { speed: 0.032, minSpinMs: 220, staggerMs: 80 },
};

const LINE_COLOURS = [
  0xf5c542, 0x3ddc97, 0x6cc4ff, 0xff6b7a, 0x8b7bff, 0xffb547,
];

/**
 * WebGL renderer for fixed-grid line slots (Classic 3-Reel, Gem Vault).
 * The reels only ever show outcomes handed to `stop()`; nothing here decides
 * a result. The ticker runs only while something moves, to save battery.
 */
export class LinesReelsRenderer {
  private readonly app = new Application();
  private readonly stage = new Container();
  private readonly highlight = new Graphics();
  private atlas!: SymbolAtlas;
  private models: ReelModel[] = [];
  private sprites: Sprite[][] = [];
  private reelContainers: Container[] = [];
  private cell = 100;
  private gap = 8;
  private pulse = 0;
  private pulsing: Set<string> = new Set();
  private pendingStops: { reel: number; at: number; column: string[] }[] = [];
  private spinStartedAt = 0;
  private landed: (() => void) | null = null;
  /** Wins currently on show, redrawn whenever the layout changes. */
  private shownWins: {
    lines: readonly LineWin[];
    scatter: ScatterWin | null;
  } | null = null;
  private destroyed = false;

  private constructor(
    private readonly host: HTMLElement,
    private readonly config: LinesSlotConfig,
    private options: RendererOptions,
  ) {}

  static async create(
    host: HTMLElement,
    config: LinesSlotConfig,
    options: RendererOptions,
  ): Promise<LinesReelsRenderer> {
    const renderer = new LinesReelsRenderer(host, config, options);
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
    const canvas = this.app.canvas;
    canvas.setAttribute('aria-hidden', 'true'); // described by the DOM, not the pixels
    canvas.style.display = 'block';
    this.host.appendChild(canvas);

    this.atlas = SymbolAtlas.build(
      this.app.renderer,
      this.config.symbols.map((s) => s.id),
    );
    this.app.stage.addChild(this.stage);

    this.models = this.config.reels.map(
      (strip, r) =>
        new ReelModel(strip, this.config.rows, (r * 7) % strip.length),
    );
    for (let r = 0; r < this.models.length; r++) {
      const reel = new Container();
      const mask = new Graphics();
      reel.mask = mask;
      reel.addChild(mask);
      const column: Sprite[] = [];
      for (let i = 0; i <= this.config.rows; i++) {
        const sprite = new Sprite(this.atlas.get(this.models[r].cells[i]));
        sprite.anchor.set(0.5);
        reel.addChild(sprite);
        column.push(sprite);
      }
      this.sprites.push(column);
      this.reelContainers.push(reel);
      this.stage.addChild(reel);
    }
    this.stage.addChild(this.highlight);

    this.app.ticker.add(this.tick);
    this.app.renderer.on('resize', () => this.layout());
    this.layout();
  }

  setOptions(options: Partial<RendererOptions>): void {
    this.options = { ...this.options, ...options };
  }

  /** Shows a grid immediately. */
  setGrid(grid: Grid): void {
    grid.forEach((column, r) => this.models[r].setColumn(column));
    this.sync();
    this.render();
  }

  /** Starts spinning; resolves nothing — call `stop()` with the server's outcome. */
  spin(): void {
    this.clearWins();
    this.pendingStops = [];
    this.spinStartedAt = performance.now();
    if (this.options.reducedMotion) {
      this.stage.alpha = 0.45;
      this.render();
      return;
    }
    for (const model of this.models) model.start();
    this.app.ticker.start();
  }

  /** Lands the reels on `grid`, staggered left to right. Resolves when every reel is still. */
  stop(grid: Grid): Promise<void> {
    if (this.options.reducedMotion) {
      this.stage.alpha = 1;
      this.setGrid(grid);
      grid.forEach((_, r) => this.options.onReelStop?.(r));
      return Promise.resolve();
    }
    const timing = this.options.turbo ? TIMING.turbo : TIMING.normal;
    const earliest = Math.max(
      performance.now(),
      this.spinStartedAt + timing.minSpinMs,
    );
    this.pendingStops = grid.map((column, reel) => ({
      reel,
      at: earliest + reel * timing.staggerMs,
      column: [...column],
    }));
    return new Promise((resolve) => (this.landed = resolve));
  }

  /** Abandons a spin (e.g. the bet failed) and shows `grid` (normally the previous one). */
  abort(grid: Grid): void {
    this.pendingStops = [];
    this.stage.alpha = 1;
    this.setGrid(grid);
    this.landed?.();
    this.landed = null;
  }

  /** Draws winning paylines and frames the winning cells. */
  showWins(lineWins: readonly LineWin[], scatter: ScatterWin | null): void {
    this.clearWins();
    this.shownWins = { lines: lineWins, scatter };
    const g = this.highlight;
    const step = this.cell + this.gap;
    const centre = (reel: number, row: number) => ({
      x: reel * step + this.cell / 2,
      y: row * this.cell + this.cell / 2,
    });

    lineWins.forEach((win, i) => {
      const colour = LINE_COLOURS[i % LINE_COLOURS.length];
      const line = this.config.paylines[win.line];
      const points = line.map((row, reel) => centre(reel, row));
      g.moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({
        color: colour,
        width: Math.max(3, this.cell * 0.05),
        alpha: 0.85,
        cap: 'round',
        join: 'round',
      });
      for (const [reel, row] of win.cells) this.frameCell(reel, row, colour);
    });
    if (scatter)
      for (const [reel, row] of scatter.cells)
        this.frameCell(reel, row, 0xffffff);

    if (!this.options.reducedMotion && this.pulsing.size > 0)
      this.app.ticker.start();
    else this.render();
  }

  clearWins(): void {
    this.shownWins = null;
    this.highlight.clear();
    this.pulsing.clear();
    this.pulse = 0;
    for (const column of this.sprites)
      for (const s of column) s.scale.set(this.cell / s.texture.width);
    this.layoutSprites();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.app.ticker.remove(this.tick);
    this.atlas?.destroy();
    this.app.destroy({ removeView: true }, { children: true });
  }

  // ------------------------------------------------------------------ internals

  private frameCell(reel: number, row: number, colour: number): void {
    const step = this.cell + this.gap;
    this.highlight
      .roundRect(
        reel * step + 2,
        row * this.cell + 2,
        this.cell - 4,
        this.cell - 4,
        this.cell * 0.14,
      )
      .stroke({ color: colour, width: Math.max(3, this.cell * 0.045) });
    this.pulsing.add(`${reel}:${row}`);
  }

  private readonly tick = (ticker: Ticker): void => {
    const dt = Math.min(ticker.deltaMS, 50); // clamp after tab switches
    const timing = this.options.turbo ? TIMING.turbo : TIMING.normal;
    const now = performance.now();

    for (const stop of this.pendingStops.filter((s) => s.at <= now)) {
      this.models[stop.reel].stopOn(stop.column);
    }
    this.pendingStops = this.pendingStops.filter((s) => s.at > now);

    let moving = false;
    this.models.forEach((model, r) => {
      if (model.advance(timing.speed * dt, dt)) this.options.onReelStop?.(r);
      if (model.phase !== 'idle') moving = true;
    });
    this.sync();

    if (!moving && this.pendingStops.length === 0 && this.landed) {
      const done = this.landed;
      this.landed = null;
      done();
    }

    // Gentle pulse on winning symbols.
    if (this.pulsing.size > 0) {
      this.pulse += dt / 1000;
      const factor = 1 + 0.06 * Math.sin(this.pulse * 6);
      for (const key of this.pulsing) {
        const [reel, row] = key.split(':').map(Number);
        const sprite = this.sprites[reel][row + 1];
        sprite.scale.set((this.cell / sprite.texture.width) * factor);
      }
    }

    if (!moving && this.pulsing.size === 0 && this.pendingStops.length === 0) {
      this.app.ticker.stop();
      this.render();
    }
  };

  /** Copies model state (symbols + offsets) onto the sprites. */
  private sync(): void {
    this.models.forEach((model, r) => {
      this.sprites[r].forEach((sprite, i) => {
        const texture = this.atlas.get(model.cells[i]);
        if (sprite.texture !== texture) sprite.texture = texture;
      });
    });
    this.layoutSprites();
  }

  private layoutSprites(): void {
    this.models.forEach((model, r) => {
      this.sprites[r].forEach((sprite, i) => {
        if (!this.pulsing.has(`${r}:${i - 1}`))
          sprite.scale.set(this.cell / sprite.texture.width);
        sprite.position.set(
          this.cell / 2,
          (i - 1 + model.offset) * this.cell + this.cell / 2,
        );
      });
    });
  }

  /** Fits the grid into the host, centred, keeping square cells. */
  private layout(): void {
    const { width, height } = this.app.screen;
    const reels = this.config.reels.length;
    const rows = this.config.rows;
    this.gap = Math.max(4, Math.min(width, height) * 0.015);
    this.cell = Math.floor(
      Math.min((width - this.gap * (reels - 1)) / reels, height / rows),
    );
    const gridWidth = reels * this.cell + (reels - 1) * this.gap;
    this.stage.position.set(
      (width - gridWidth) / 2,
      (height - rows * this.cell) / 2,
    );

    this.reelContainers.forEach((reel, r) => {
      reel.x = r * (this.cell + this.gap);
      const mask = reel.mask as Graphics;
      mask
        .clear()
        .rect(0, 0, this.cell, rows * this.cell)
        .fill({ color: 0xffffff });
    });
    this.layoutSprites();
    if (this.shownWins)
      this.showWins(this.shownWins.lines, this.shownWins.scatter);
    this.render();
  }

  private render(): void {
    if (!this.destroyed) this.app.render();
  }
}
