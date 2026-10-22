import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  AdminAuditComponent,
  AdminLedgerComponent,
} from './admin-ledger.component';
import { AdminOverviewComponent } from './admin-overview.component';
import { AdminUsersComponent } from './admin-users.component';

type Tab = 'overview' | 'users' | 'ledger' | 'audit';

/** Back office: game switches and RTP monitoring, players, ledger and audit log. */
@Component({
  selector: 'cas-admin-page',
  imports: [
    AdminOverviewComponent,
    AdminUsersComponent,
    AdminLedgerComponent,
    AdminAuditComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="page admin">
      <h1 i18n="@@admin.title">Admin</h1>
      <div
        class="tabs"
        role="tablist"
        i18n-aria-label="@@admin.sections"
        aria-label="Admin sections"
      >
        @for (t of tabs; track t.id) {
          <button
            type="button"
            role="tab"
            [id]="'adm-tab-' + t.id"
            [attr.aria-selected]="tab() === t.id"
            [attr.aria-controls]="'adm-panel-' + t.id"
            [tabIndex]="tab() === t.id ? 0 : -1"
            [class.is-active]="tab() === t.id"
            (click)="tab.set(t.id)"
            (keydown)="onKey($event)"
          >
            {{ t.label }}
          </button>
        }
      </div>

      <section
        class="card"
        role="tabpanel"
        [id]="'adm-panel-' + tab()"
        [attr.aria-labelledby]="'adm-tab-' + tab()"
      >
        @switch (tab()) {
          @case ('overview') {
            <cas-admin-overview />
          }
          @case ('users') {
            <cas-admin-users />
          }
          @case ('ledger') {
            <cas-admin-ledger />
          }
          @case ('audit') {
            <cas-admin-audit />
          }
        }
      </section>
    </div>
  `,
  styles: `
    .admin {
      display: grid;
      gap: var(--space-4);
    }
    .admin h1 {
      margin: 0;
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
    .tabs button {
      padding: var(--space-2) var(--space-4);
      border-radius: var(--radius-pill);
      background: var(--color-surface-2);
      border: 1px solid var(--color-border);
      color: var(--color-text);
      font: inherit;
      font-size: var(--font-size-sm);
      cursor: pointer;
    }
    .tabs button.is-active {
      background: var(--color-primary);
      border-color: var(--color-primary);
      color: var(--color-on-primary, #111);
      font-weight: var(--font-weight-semibold);
    }
  `,
})
export class AdminPage {
  protected readonly tabs: readonly { id: Tab; label: string }[] = [
    { id: 'overview', label: $localize`:@@admin.tabOverview:Games & RTP` },
    { id: 'users', label: $localize`:@@admin.tabUsers:Players` },
    { id: 'ledger', label: $localize`:@@admin.tabLedger:Ledger` },
    { id: 'audit', label: $localize`:@@admin.tabAudit:Audit log` },
  ];
  protected readonly tab = signal<Tab>('overview');

  /** Arrow keys move between tabs (WAI-ARIA tabs pattern). */
  protected onKey(event: KeyboardEvent): void {
    const step =
      event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const i = this.tabs.findIndex((t) => t.id === this.tab());
    const next = this.tabs[(i + step + this.tabs.length) % this.tabs.length];
    this.tab.set(next.id);
    document.getElementById(`adm-tab-${next.id}`)?.focus();
  }
}
