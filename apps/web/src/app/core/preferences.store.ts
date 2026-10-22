import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, signal } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withHooks,
  withMethods,
  withState,
} from '@ngrx/signals';

export type MotionPreference = 'system' | 'reduced' | 'full';

export interface Preferences {
  muted: boolean;
  volume: number;
  motion: MotionPreference;
  turbo: boolean;
  /** Space / Enter anywhere on a game page spins or deals (WCAG 2.1.4: can be switched off). */
  spinHotkey: boolean;
}

const STORAGE_KEY = 'casino.preferences.v1';
const DEFAULTS: Preferences = {
  muted: false,
  volume: 0.6,
  motion: 'system',
  turbo: false,
  spinHotkey: true,
};

function load(): Preferences {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULTS.muted,
      volume:
        typeof parsed.volume === 'number'
          ? Math.min(1, Math.max(0, parsed.volume))
          : DEFAULTS.volume,
      motion:
        parsed.motion === 'reduced' || parsed.motion === 'full'
          ? parsed.motion
          : 'system',
      turbo: typeof parsed.turbo === 'boolean' ? parsed.turbo : DEFAULTS.turbo,
      spinHotkey:
        typeof parsed.spinHotkey === 'boolean'
          ? parsed.spinHotkey
          : DEFAULTS.spinHotkey,
    };
  } catch {
    return DEFAULTS;
  }
}

/** Player preferences, persisted locally and applied to <html data-motion>. */
export const PreferencesStore = signalStore(
  { providedIn: 'root' },
  withState<Preferences>(load()),
  withComputed((store) => {
    const media = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
    const systemReduced = signal(media?.matches ?? false);
    media?.addEventListener('change', (e) => systemReduced.set(e.matches));
    return {
      /** What animations should actually do right now. */
      reducedMotion: computed(() =>
        store.motion() === 'system'
          ? systemReduced()
          : store.motion() === 'reduced',
      ),
    };
  }),
  withMethods((store) => ({
    toggleMute(): void {
      patchState(store, { muted: !store.muted() });
    },
    setVolume(volume: number): void {
      patchState(store, { volume: Math.min(1, Math.max(0, volume)) });
    },
    setMotion(motion: MotionPreference): void {
      patchState(store, { motion });
    },
    setTurbo(turbo: boolean): void {
      patchState(store, { turbo });
    },
    setSpinHotkey(spinHotkey: boolean): void {
      patchState(store, { spinHotkey });
    },
  })),
  withHooks({
    onInit(store) {
      const document = inject(DOCUMENT);
      effect(() => {
        const prefs: Preferences = {
          muted: store.muted(),
          volume: store.volume(),
          motion: store.motion(),
          turbo: store.turbo(),
          spinHotkey: store.spinHotkey(),
        };
        try {
          globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(prefs));
        } catch {
          // Private mode or storage disabled: preferences just won't persist.
        }
        document.documentElement.dataset['motion'] = prefs.motion;
      });
    },
  }),
);
