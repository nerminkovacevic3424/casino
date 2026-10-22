import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CreditsPipe } from '@casino/ui';
import type { AutoplaySettings } from './slot-presentation';

/**
 * Autoplay setup. A loss limit is mandatory (responsible-play safeguard) and
 * autoplay can be stopped at any time from the spin button.
 */
@Component({
  selector: 'cas-autoplay-dialog',
  imports: [ReactiveFormsModule, CreditsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form [formGroup]="form" (ngSubmit)="submit()" novalidate>
      <fieldset class="field spins">
        <legend i18n="@@autoplay.spins">Number of spins</legend>
        @for (n of spinOptions; track n) {
          <label class="pill">
            <input type="radio" formControlName="spins" [value]="n" />
            <span>{{ n }}</span>
          </label>
        }
      </fieldset>

      <div class="field">
        <label for="ap-loss" i18n="@@autoplay.loss"
          >Stop if losses reach (credits)</label
        >
        <input
          id="ap-loss"
          type="number"
          inputmode="decimal"
          min="0.01"
          step="0.01"
          formControlName="lossLimit"
          [attr.aria-invalid]="
            form.controls.lossLimit.invalid && form.controls.lossLimit.touched
          "
          aria-describedby="ap-loss-hint"
        />
        <span id="ap-loss-hint" class="hint" i18n="@@autoplay.lossHint"
          >Required. At least one bet ({{ totalBet() | credits }}).</span
        >
      </div>

      <div class="field">
        <label for="ap-win" i18n="@@autoplay.win"
          >Stop on a single win of at least (credits, optional)</label
        >
        <input
          id="ap-win"
          type="number"
          inputmode="decimal"
          min="0"
          step="0.01"
          formControlName="singleWinLimit"
        />
      </div>

      <div class="checkbox">
        <input
          id="ap-feature"
          type="checkbox"
          formControlName="stopOnFeature"
        />
        <label for="ap-feature" i18n="@@autoplay.feature"
          >Stop when free spins or a bonus is triggered</label
        >
      </div>

      <div class="actions">
        <button
          type="button"
          class="btn"
          (click)="cancelled.emit()"
          i18n="@@autoplay.cancel"
        >
          Cancel
        </button>
        <button type="submit" class="btn btn--primary" i18n="@@autoplay.start">
          Start autoplay
        </button>
      </div>
    </form>
  `,
  styles: `
    .spins {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      border: 0;
      padding: 0;
    }
    .spins legend {
      font-weight: var(--font-weight-semibold);
      font-size: var(--font-size-sm);
      margin-bottom: var(--space-2);
    }
    .pill input {
      position: absolute;
      opacity: 0;
    }
    .pill span {
      display: inline-grid;
      place-items: center;
      min-width: var(--tap-target);
      min-height: var(--tap-target);
      padding: 0 var(--space-3);
      border-radius: var(--radius-pill);
      border: 1px solid var(--color-border-strong);
      cursor: pointer;
    }
    .pill input:checked + span {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border-color: var(--color-primary);
    }
    .pill input:focus-visible + span {
      outline: 3px solid var(--color-focus);
      outline-offset: 2px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--space-2);
    }
  `,
})
export class AutoplayDialogComponent {
  readonly totalBet = input.required<number>();
  readonly start = output<AutoplaySettings>();
  readonly cancelled = output<void>();

  protected readonly spinOptions = [10, 25, 50, 100];
  private readonly minLoss = computed(() => this.totalBet() / 100);

  protected readonly form = inject(FormBuilder).group({
    spins: [25, Validators.required],
    lossLimit: [
      null as number | null,
      [Validators.required, Validators.min(0.01)],
    ],
    singleWinLimit: [null as number | null, Validators.min(0)],
    stopOnFeature: [true],
  });

  protected submit(): void {
    this.form.markAllAsTouched();
    const v = this.form.getRawValue();
    if (
      this.form.invalid ||
      v.lossLimit === null ||
      v.lossLimit < this.minLoss()
    ) {
      this.form.controls.lossLimit.setErrors({ min: true });
      return;
    }
    this.start.emit({
      spins: v.spins ?? 25,
      // Credits typed by the player → integer minor units.
      lossLimit: Math.round(v.lossLimit * 100),
      singleWinLimit: v.singleWinLimit
        ? Math.round(v.singleWinLimit * 100)
        : null,
      stopOnFeature: v.stopOnFeature ?? true,
    });
  }
}
