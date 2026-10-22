import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';

let nextId = 0;

/**
 * Accessible modal on top of the native <dialog>: focus is trapped and
 * restored by the browser, Escape closes it and the page behind is inert.
 */
@Component({
  selector: 'cas-ui-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Backdrop click is a pointer shortcut; keyboard users close with Escape (native <dialog>). -->
    <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events, @angular-eslint/template/interactive-supports-focus -->
    <dialog
      #dialog
      class="modal"
      [attr.aria-labelledby]="titleId"
      (close)="closed.emit()"
      (click)="onBackdrop($event)"
    >
      <div class="modal__panel">
        <header class="modal__header">
          <h2 [id]="titleId">{{ heading() }}</h2>
          <button
            type="button"
            class="btn btn--ghost btn--small"
            (click)="dialog.close()"
            i18n-aria-label="@@modal.close"
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div class="modal__body"><ng-content /></div>
      </div>
    </dialog>
  `,
  styles: `
    .modal {
      padding: 0;
      border: 1px solid var(--color-border-strong);
      border-radius: var(--radius-lg);
      background: var(--color-surface);
      color: var(--color-text);
      width: min(100% - 2rem, 720px);
      max-height: min(90dvh, 900px);
      box-shadow: var(--shadow-2);
    }
    .modal::backdrop {
      background: rgb(5 8 16 / 70%);
      backdrop-filter: blur(2px);
    }
    .modal__panel {
      display: grid;
      grid-template-rows: auto 1fr;
      max-height: inherit;
    }
    .modal__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-3);
      padding: var(--space-4) var(--space-5);
      border-bottom: 1px solid var(--color-border);
      position: sticky;
      top: 0;
      background: inherit;
    }
    .modal__header h2 {
      margin: 0;
      font-size: var(--font-size-lg);
    }
    .modal__body {
      padding: var(--space-5);
      overflow: auto;
    }
  `,
})
export class ModalComponent {
  readonly heading = input.required<string>();
  readonly open = input(false);
  readonly closed = output<void>();
  protected readonly titleId = `cas-modal-title-${nextId++}`;
  private readonly dialog =
    viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const el = this.dialog().nativeElement;
      if (this.open() && !el.open) el.showModal();
      if (!this.open() && el.open) el.close();
    });
  }

  /** Clicking the backdrop (the dialog element itself) closes it. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement)
      this.dialog().nativeElement.close();
  }
}
