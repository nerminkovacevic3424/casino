import { ReelModel, easeOutBack } from './reel-model';

const STRIP = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Runs the model until idle, returning how many times it reported landing. */
function runToIdle(model: ReelModel, stepCells = 0.3, stepMs = 16): number {
  let landings = 0;
  for (let i = 0; i < 10_000 && model.phase !== 'idle'; i++) {
    if (model.advance(stepCells, stepMs)) landings++;
  }
  return landings;
}

describe('ReelModel', () => {
  it('starts aligned with rows + 1 cells', () => {
    const model = new ReelModel(STRIP, 3, 2);
    expect(model.cells).toHaveLength(4);
    expect(model.visible).toEqual(['C', 'D', 'E']);
    expect(model.offset).toBe(0);
  });

  it('places a column immediately', () => {
    const model = new ReelModel(STRIP, 3);
    model.setColumn(['X', 'Y', 'Z']);
    expect(model.visible).toEqual(['X', 'Y', 'Z']);
    expect(model.phase).toBe('idle');
  });

  it('does nothing until started', () => {
    const model = new ReelModel(STRIP, 3);
    const before = [...model.cells];
    expect(model.advance(5, 16)).toBe(false);
    expect(model.cells).toEqual(before);
  });

  it('scrolls through filler symbols while spinning', () => {
    const model = new ReelModel(STRIP, 3);
    model.start();
    model.advance(2.5, 16);
    expect(model.offset).toBeCloseTo(0.5);
    expect(model.cells).toHaveLength(4);
    expect(model.phase).toBe('spinning');
  });

  it.each([0.07, 0.3, 0.99, 2.7])(
    'always lands exactly on the requested column (step %p cells)',
    (step) => {
      const model = new ReelModel(STRIP, 3);
      model.start();
      model.advance(1.3, 16);
      model.stopOn(['X', 'Y', 'Z']);
      const landings = runToIdle(model, step);
      expect(landings).toBe(1);
      expect(model.visible).toEqual(['X', 'Y', 'Z']);
      expect(model.offset).toBe(0);
    },
  );

  it('ignores stop requests when not spinning', () => {
    const model = new ReelModel(STRIP, 3);
    model.stopOn(['X', 'Y', 'Z']);
    expect(model.phase).toBe('idle');
  });

  it('overshoots and settles back (bounce)', () => {
    const model = new ReelModel(STRIP, 2);
    model.start();
    model.stopOn(['X', 'Y']);
    while (model.phase === 'stopping') model.advance(0.45, 16);
    expect(model.phase).toBe('settling');
    const offsets: number[] = [];
    while (model.phase === 'settling') {
      model.advance(0, 10);
      offsets.push(model.offset);
    }
    expect(Math.min(...offsets)).toBeLessThan(0); // swung past alignment
    expect(model.offset).toBe(0);
  });
});

describe('easeOutBack', () => {
  it('starts at 0, ends at 1 and overshoots in between', () => {
    expect(easeOutBack(0)).toBeCloseTo(0);
    expect(easeOutBack(1)).toBeCloseTo(1);
    expect(
      Math.max(...[0.5, 0.6, 0.7, 0.8].map((t) => easeOutBack(t))),
    ).toBeGreaterThan(1);
  });
});
