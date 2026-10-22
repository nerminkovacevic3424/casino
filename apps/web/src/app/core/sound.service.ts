import { Injectable, effect, inject } from '@angular/core';
import { Howl, Howler } from 'howler';
import { PreferencesStore } from './preferences.store';

export type SoundName =
  'click' | 'spin' | 'stop' | 'win' | 'bigwin' | 'feature';
const NAMES: readonly SoundName[] = [
  'click',
  'spin',
  'stop',
  'win',
  'bigwin',
  'feature',
];

/** Howler-backed effects. Loaded lazily on first use; muting is persisted in preferences. */
@Injectable({ providedIn: 'root' })
export class SoundService {
  private readonly prefs = inject(PreferencesStore);
  private sounds: Map<SoundName, Howl> | null = null;

  constructor() {
    effect(() => {
      Howler.mute(this.prefs.muted());
      Howler.volume(this.prefs.volume());
    });
  }

  play(name: SoundName): void {
    if (this.prefs.muted()) return;
    this.load().get(name)?.play();
  }

  stop(name: SoundName): void {
    this.sounds?.get(name)?.stop();
  }

  private load(): Map<SoundName, Howl> {
    this.sounds ??= new Map(
      NAMES.map((name) => [
        name,
        new Howl({
          src: [`sounds/${name}.wav`],
          preload: true,
          volume: name === 'spin' ? 0.5 : 1,
        }),
      ]),
    );
    return this.sounds;
  }
}
