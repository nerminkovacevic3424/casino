import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MotionPreference,
  PreferencesStore,
} from '../../core/preferences.store';
import { SoundService } from '../../core/sound.service';

@Component({
  selector: 'cas-preferences-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="checkbox">
      <input
        id="pref-sound"
        type="checkbox"
        [checked]="!prefs.muted()"
        (change)="prefs.toggleMute()"
      />
      <label for="pref-sound" i18n="@@prefs.sound">Sound effects</label>
    </div>

    <div class="field">
      <label for="pref-volume" i18n="@@prefs.volume">Volume</label>
      <input
        id="pref-volume"
        type="range"
        min="0"
        max="100"
        step="5"
        [value]="prefs.volume() * 100"
        [disabled]="prefs.muted()"
        (change)="setVolume($any($event.target).value)"
        [attr.aria-valuetext]="(prefs.volume() * 100).toFixed(0) + '%'"
      />
    </div>

    <fieldset class="field">
      <legend i18n="@@prefs.motion">Animations</legend>
      @for (option of motions; track option.value) {
        <label class="radio">
          <input
            type="radio"
            name="motion"
            [value]="option.value"
            [checked]="prefs.motion() === option.value"
            (change)="prefs.setMotion(option.value)"
          />
          <span>{{ option.label }}</span>
        </label>
      }
      <span class="hint" i18n="@@prefs.motionHint"
        >Reduced motion stops spinning reels, wheel animation and count-ups;
        results appear instantly.</span
      >
    </fieldset>

    <div class="checkbox">
      <input
        id="pref-turbo"
        type="checkbox"
        [checked]="prefs.turbo()"
        (change)="prefs.setTurbo(!prefs.turbo())"
      />
      <label for="pref-turbo" i18n="@@prefs.turbo"
        >Turbo mode (faster spins)</label
      >
    </div>

    <div class="checkbox">
      <input
        id="pref-hotkey"
        type="checkbox"
        [checked]="prefs.spinHotkey()"
        (change)="prefs.setSpinHotkey(!prefs.spinHotkey())"
      />
      <label for="pref-hotkey" i18n="@@prefs.hotkey"
        >Spin with Space or Enter anywhere on a game page</label
      >
    </div>
    <p class="hint" i18n="@@prefs.saved">
      Preferences are saved on this device.
    </p>
  `,
  styles: `
    fieldset {
      border: 0;
      padding: 0;
    }
    legend {
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
      margin-bottom: var(--space-2);
    }
    .radio {
      display: flex;
      gap: var(--space-2);
      align-items: center;
      min-height: 32px;
    }
    .radio input {
      accent-color: var(--color-primary);
      width: 18px;
      height: 18px;
    }
    input[type='range'] {
      accent-color: var(--color-primary);
      width: min(320px, 100%);
    }
    .hint {
      color: var(--color-text-muted);
      font-size: var(--font-size-sm);
    }
  `,
})
export class PreferencesPanelComponent {
  protected readonly prefs = inject(PreferencesStore);
  private readonly sound = inject(SoundService);
  protected readonly motions: readonly {
    value: MotionPreference;
    label: string;
  }[] = [
    {
      value: 'system',
      label: $localize`:@@prefs.motionSystem:Follow my device setting`,
    },
    {
      value: 'reduced',
      label: $localize`:@@prefs.motionReduced:Reduce motion`,
    },
    { value: 'full', label: $localize`:@@prefs.motionFull:Full animations` },
  ];

  protected setVolume(value: string): void {
    this.prefs.setVolume(Number(value) / 100);
    this.sound.play('click');
  }
}
