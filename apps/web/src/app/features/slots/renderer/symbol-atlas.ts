import {
  Container,
  Rectangle,
  RenderTexture,
  Renderer,
  Texture,
} from 'pixi.js';
import { paintSymbol } from './symbol-art';

/**
 * Draws every symbol once into a single RenderTexture and slices it into
 * frames: one GPU texture and one bind for the whole reel set (a texture
 * atlas built at runtime instead of shipped as a PNG).
 */
export class SymbolAtlas {
  private constructor(
    private readonly texture: RenderTexture,
    private readonly frames: ReadonlyMap<string, Texture>,
  ) {}

  static build(
    renderer: Renderer,
    symbolIds: readonly string[],
    cellSize = 160,
  ): SymbolAtlas {
    const columns = Math.ceil(Math.sqrt(symbolIds.length));
    const rows = Math.ceil(symbolIds.length / columns);
    const sheet = new Container();
    symbolIds.forEach((id, i) => {
      const art = paintSymbol(id, cellSize);
      art.position.set(
        (i % columns) * cellSize,
        Math.floor(i / columns) * cellSize,
      );
      sheet.addChild(art);
    });

    const texture = RenderTexture.create({
      width: columns * cellSize,
      height: rows * cellSize,
      resolution: 1,
      antialias: true,
    });
    renderer.render({ container: sheet, target: texture, clear: true });
    sheet.destroy({ children: true });

    const frames = new Map<string, Texture>();
    symbolIds.forEach((id, i) => {
      const frame = new Rectangle(
        (i % columns) * cellSize,
        Math.floor(i / columns) * cellSize,
        cellSize,
        cellSize,
      );
      frames.set(id, new Texture({ source: texture.source, frame }));
    });
    return new SymbolAtlas(texture, frames);
  }

  get(id: string): Texture {
    const texture = this.frames.get(id);
    if (!texture) throw new Error(`No texture for symbol ${id}`);
    return texture;
  }

  destroy(): void {
    for (const frame of this.frames.values()) frame.destroy(false);
    this.texture.destroy(true);
  }
}
