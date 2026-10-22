import { Container, Graphics, Text } from 'pixi.js';

/**
 * Procedural symbol artwork, drawn once into the texture atlas. Each painter
 * fills a `size`×`size` square. Emoji render through the browser's colour
 * font; everything else is vector shapes, so there are no image assets.
 */
type Painter = (size: number) => Container;

const plate = (
  size: number,
  top: number,
  bottom: number,
  border = 0xffffff,
): Graphics => {
  const r = size * 0.16;
  const inset = size * 0.05;
  return new Graphics()
    .roundRect(inset, inset, size - 2 * inset, size - 2 * inset, r)
    .fill({ color: bottom })
    .roundRect(inset, inset, size - 2 * inset, (size - 2 * inset) * 0.55, r)
    .fill({ color: top, alpha: 0.55 })
    .roundRect(inset, inset, size - 2 * inset, size - 2 * inset, r)
    .stroke({ color: border, alpha: 0.35, width: size * 0.025 });
};

const centred = (text: Text, size: number, dy = 0): Text => {
  text.anchor.set(0.5);
  text.position.set(size / 2, size / 2 + dy);
  return text;
};

const emoji =
  (glyph: string, top: number, bottom: number): Painter =>
  (size) => {
    const c = new Container();
    c.addChild(plate(size, top, bottom));
    c.addChild(
      centred(
        new Text({ text: glyph, style: { fontSize: size * 0.56 } }),
        size,
        size * 0.02,
      ),
    );
    return c;
  };

const label =
  (
    text: string,
    color: number,
    top: number,
    bottom: number,
    scale = 0.5,
    stroke = 0x000000,
  ): Painter =>
  (size) => {
    const c = new Container();
    c.addChild(plate(size, top, bottom));
    c.addChild(
      centred(
        new Text({
          text,
          style: {
            fontFamily: 'Georgia, "Times New Roman", serif',
            fontWeight: '900',
            fontSize: size * scale,
            fill: color,
            stroke: { color: stroke, width: size * 0.04 },
          },
        }),
        size,
      ),
    );
    return c;
  };

const gem =
  (color: number, highlight: number): Painter =>
  (size) => {
    const c = new Container();
    c.addChild(plate(size, 0x2b3566, 0x151a33));
    const s = size;
    c.addChild(
      new Graphics()
        .poly([
          s * 0.3,
          s * 0.25,
          s * 0.7,
          s * 0.25,
          s * 0.85,
          s * 0.42,
          s * 0.5,
          s * 0.82,
          s * 0.15,
          s * 0.42,
        ])
        .fill({ color })
        .stroke({ color: 0xffffff, alpha: 0.6, width: s * 0.02 })
        .poly([s * 0.3, s * 0.25, s * 0.5, s * 0.42, s * 0.15, s * 0.42])
        .fill({ color: highlight, alpha: 0.7 })
        .poly([s * 0.7, s * 0.25, s * 0.85, s * 0.42, s * 0.5, s * 0.42])
        .fill({ color: highlight, alpha: 0.35 }),
    );
    return c;
  };

const plum: Painter = (size) => {
  const c = new Container();
  c.addChild(plate(size, 0x4a2a6b, 0x2a1840));
  c.addChild(
    new Graphics()
      .ellipse(size * 0.5, size * 0.56, size * 0.25, size * 0.27)
      .fill({ color: 0x7b3fb5 })
      .ellipse(size * 0.42, size * 0.48, size * 0.07, size * 0.1)
      .fill({ color: 0xffffff, alpha: 0.25 })
      .ellipse(size * 0.6, size * 0.27, size * 0.11, size * 0.05)
      .fill({ color: 0x3ddc97 }),
  );
  return c;
};

const chest: Painter = (size) => {
  const c = new Container();
  c.addChild(plate(size, 0x5c3a1a, 0x2e1c0b, 0xf5c542));
  const s = size;
  c.addChild(
    new Graphics()
      .roundRect(s * 0.2, s * 0.32, s * 0.6, s * 0.42, s * 0.05)
      .fill({ color: 0x8a5a2b })
      .rect(s * 0.2, s * 0.44, s * 0.6, s * 0.06)
      .fill({ color: 0xf5c542 })
      .roundRect(s * 0.45, s * 0.42, s * 0.1, s * 0.14, s * 0.02)
      .fill({ color: 0xf5c542 })
      .stroke({ color: 0x1a1300, width: s * 0.015 }),
  );
  return c;
};

const wild: Painter = (size) => {
  const c = new Container();
  c.addChild(plate(size, 0xffe08a, 0xc48a12, 0xffffff));
  const star = new Graphics()
    .star(size / 2, size * 0.43, 5, size * 0.27, size * 0.12)
    .fill({ color: 0xfff6d6 });
  c.addChild(star);
  c.addChild(
    centred(
      new Text({
        text: 'WILD',
        style: {
          fontFamily: 'Impact, "Arial Black", sans-serif',
          fontSize: size * 0.2,
          fill: 0x5a1d00,
        },
      }),
      size,
      size * 0.3,
    ),
  );
  return c;
};

/** Symbol id → painter. Unknown ids fall back to their name on a plate. */
const PAINTERS: Record<string, Painter> = {
  // Classic 3-Reel
  CHERRY: emoji('🍒', 0x7a1f2b, 0x3d0f15),
  LEMON: emoji('🍋', 0x7a6a1f, 0x3d350f),
  ORANGE: emoji('🍊', 0x7a4a1f, 0x3d250f),
  PLUM: plum,
  BELL: emoji('🔔', 0x6b5a1f, 0x352d0f),
  BAR: label('BAR', 0xffffff, 0x3a3a3a, 0x0e0e0e, 0.32),
  SEVEN: label('7', 0xff3b4e, 0x4a1820, 0x1c080c, 0.72, 0xffffff),
  WILD: wild,
  // Gem Vault
  TEN: label('10', 0x9fd3ff, 0x24305a, 0x111830, 0.42),
  JACK: label('J', 0x8ef0c0, 0x24305a, 0x111830),
  QUEEN: label('Q', 0xffa6d1, 0x24305a, 0x111830),
  KING: label('K', 0xffd27a, 0x24305a, 0x111830),
  ACE: label('A', 0xff8a8a, 0x24305a, 0x111830),
  RUBY: gem(0xe0244a, 0xff8fa5),
  EMERALD: gem(0x14b86a, 0x8af5c0),
  SAPPHIRE: gem(0x2f6ff0, 0x9cc0ff),
  DIAMOND: gem(0xcfefff, 0xffffff),
  STAR: emoji('⭐', 0x3a2f6b, 0x1a1540),
  CHEST: chest,
  // Temple Tumble
  NINE: label('9', 0xb7c4ff, 0x3a2e1a, 0x1d170d),
  SCARAB: emoji('🪲', 0x1f5a4a, 0x0d2a22),
  ANKH: label('☥', 0xf5c542, 0x4a3a12, 0x241c08, 0.62),
  EYE: emoji('👁️', 0x1f3a6b, 0x0d1a33),
  FALCON: emoji('🦅', 0x6b4a1f, 0x33230f),
  MASK: emoji('🎭', 0x7a5a12, 0x3d2d09),
};

export function paintSymbol(id: string, size: number): Container {
  const painter =
    PAINTERS[id] ?? label(id.slice(0, 3), 0xffffff, 0x333a55, 0x1a1f33, 0.28);
  return painter(size);
}
