import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import {
  LEDGER_TYPES,
  type AdminActionRow,
  type AdminLedgerRow,
  type CursorPage,
} from '@casino/shared-types';
import { CreditsPipe } from '@casino/ui';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api-error';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only audit of every balance movement, newest first. */
@Component({
  selector: 'cas-admin-ledger',
  imports: [CreditsPipe, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin.scss',
  template: `
    <form class="toolbar" (submit)="$event.preventDefault(); load(true)">
      <div class="field">
        <label for="led-user" i18n="@@admin.userIdFilter">Player ID</label>
        <input
          id="led-user"
          #user
          size="38"
          (change)="userId.set(user.value.trim())"
        />
      </div>
      <div class="field">
        <label for="led-round" i18n="@@admin.roundIdFilter">Round ID</label>
        <input
          id="led-round"
          #round
          size="38"
          (change)="roundId.set(round.value.trim())"
        />
      </div>
      <div class="field">
        <label for="led-type" i18n="@@admin.type">Type</label>
        <select id="led-type" (change)="type.set($any($event.target).value)">
          <option value="" i18n="@@admin.all">All</option>
          @for (t of types; track t) {
            <option [value]="t">{{ t }}</option>
          }
        </select>
      </div>
      <button
        type="submit"
        class="btn btn--small"
        (click)="userId.set(user.value.trim()); roundId.set(round.value.trim())"
        i18n="@@admin.filter"
      >
        Filter
      </button>
    </form>

    @if (error()) {
      <div class="alert alert--error" role="alert">{{ error() }}</div>
    }

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col" i18n="@@admin.entry">#</th>
            <th scope="col" i18n="@@admin.when">When</th>
            <th scope="col" i18n="@@admin.user">Player</th>
            <th scope="col" i18n="@@admin.type">Type</th>
            <th scope="col" class="num" i18n="@@admin.amountCol">Amount</th>
            <th scope="col" class="num" i18n="@@admin.after">Balance</th>
            <th scope="col" i18n="@@admin.round">Round</th>
            <th scope="col" i18n="@@admin.note">Note</th>
          </tr>
        </thead>
        <tbody>
          @for (e of rows(); track e.id) {
            <tr>
              <td class="mono">{{ e.id }}</td>
              <td>{{ e.createdAt | date: 'short' }}</td>
              <td>
                <button
                  type="button"
                  class="link"
                  (click)="filterUser(e.userId)"
                >
                  {{ e.email }}
                </button>
              </td>
              <td>{{ e.type }}</td>
              <td
                class="num"
                [class.pos]="e.amount > 0"
                [class.neg]="e.amount < 0"
              >
                {{ e.amount | credits }}
              </td>
              <td class="num">{{ e.balanceAfter | credits }}</td>
              <td class="mono">
                @if (e.roundId) {
                  <button
                    type="button"
                    class="link"
                    (click)="filterRound(e.roundId)"
                  >
                    {{ e.roundId.slice(0, 8) }}
                  </button>
                }
              </td>
              <td class="muted">{{ e.description }}</td>
            </tr>
          } @empty {
            @if (!loading()) {
              <tr>
                <td colspan="8" class="muted" i18n="@@admin.noEntries">
                  No entries.
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
    <div class="pager">
      @if (cursor()) {
        <button
          type="button"
          class="btn btn--small"
          [disabled]="loading()"
          (click)="load(false)"
          i18n="@@admin.more"
        >
          Load older
        </button>
      }
    </div>
  `,
})
export class AdminLedgerComponent {
  private readonly http = inject(HttpClient);

  protected readonly types = LEDGER_TYPES;
  protected readonly userId = signal('');
  protected readonly roundId = signal('');
  protected readonly type = signal('');
  protected readonly rows = signal<AdminLedgerRow[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load(true);
  }

  protected filterUser(id: string): void {
    this.userId.set(id);
    (document.getElementById('led-user') as HTMLInputElement).value = id;
    void this.load(true);
  }

  protected filterRound(id: string): void {
    this.roundId.set(id);
    (document.getElementById('led-round') as HTMLInputElement).value = id;
    void this.load(true);
  }

  protected async load(reset: boolean): Promise<void> {
    for (const id of [this.userId(), this.roundId()]) {
      if (id && !UUID.test(id)) {
        this.error.set(
          $localize`:@@admin.badId:IDs look like 3f2a…-…; check the value.`,
        );
        return;
      }
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const params: Record<string, string> = {};
      if (this.userId()) params['userId'] = this.userId();
      if (this.roundId()) params['roundId'] = this.roundId();
      if (this.type()) params['type'] = this.type();
      if (!reset && this.cursor()) params['before'] = this.cursor() as string;
      const res = await firstValueFrom(
        this.http.get<CursorPage<AdminLedgerRow>>('/api/admin/ledger', {
          params,
        }),
      );
      this.rows.update((rows) =>
        reset ? [...res.items] : [...rows, ...res.items],
      );
      this.cursor.set(res.nextCursor);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}

/** Every admin action, newest first. */
@Component({
  selector: 'cas-admin-audit',
  imports: [DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin.scss',
  template: `
    @if (error()) {
      <div class="alert alert--error" role="alert">{{ error() }}</div>
    }
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col" i18n="@@admin.when">When</th>
            <th scope="col" i18n="@@admin.by">By</th>
            <th scope="col" i18n="@@admin.action">Action</th>
            <th scope="col" i18n="@@admin.target">Target</th>
            <th scope="col" i18n="@@admin.details">Details</th>
          </tr>
        </thead>
        <tbody>
          @for (a of rows(); track a.id) {
            <tr>
              <td>{{ a.createdAt | date: 'short' }}</td>
              <td>{{ a.adminEmail ?? a.adminId }}</td>
              <td>
                <strong>{{ a.action }}</strong>
              </td>
              <td class="mono">{{ a.targetGame ?? a.targetUser }}</td>
              <td class="mono">{{ json(a.details) }}</td>
            </tr>
          } @empty {
            @if (!loading()) {
              <tr>
                <td colspan="5" class="muted" i18n="@@admin.noActions">
                  No admin actions yet.
                </td>
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
    <div class="pager">
      @if (cursor()) {
        <button
          type="button"
          class="btn btn--small"
          [disabled]="loading()"
          (click)="load()"
          i18n="@@admin.more"
        >
          Load older
        </button>
      }
    </div>
  `,
})
export class AdminAuditComponent {
  private readonly http = inject(HttpClient);

  protected readonly rows = signal<AdminActionRow[]>([]);
  protected readonly cursor = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  protected json(details: Record<string, unknown>): string {
    return JSON.stringify(details);
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      const before = this.cursor();
      const res = await firstValueFrom(
        this.http.get<CursorPage<AdminActionRow>>('/api/admin/audit', {
          params: before ? { before } : {},
        }),
      );
      this.rows.update((rows) => [...rows, ...res.items]);
      this.cursor.set(res.nextCursor);
    } catch (err) {
      this.error.set(errorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
