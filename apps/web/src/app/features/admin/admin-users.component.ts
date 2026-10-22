import { HttpClient, httpResource } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  MAX_ADJUSTMENT,
  type AdminUserDetail,
  type AdminUserRow,
  type Paginated,
} from '@casino/shared-types';
import { CreditsPipe, ModalComponent } from '@casino/ui';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/toast.service';

const PAGE_SIZE = 25;

@Component({
  selector: 'cas-admin-users',
  imports: [CreditsPipe, DatePipe, ModalComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './admin.scss',
  template: `
    <form class="toolbar" (submit)="search($event)" role="search">
      <div class="field">
        <label for="adm-q" i18n="@@admin.search">Email or name</label>
        <input id="adm-q" #q type="search" [value]="query()" />
      </div>
      <div class="field">
        <label for="adm-status" i18n="@@admin.statusFilter">Status</label>
        <select
          id="adm-status"
          [value]="status()"
          (change)="setStatus($any($event.target).value)"
        >
          <option value="" i18n="@@admin.all">All</option>
          <option value="ACTIVE" i18n="@@admin.active">Active</option>
          <option value="SUSPENDED" i18n="@@admin.suspended">Suspended</option>
        </select>
      </div>
      <button
        type="submit"
        class="btn btn--small"
        (click)="query.set(q.value.trim()); page.set(1)"
        i18n="@@admin.searchBtn"
      >
        Search
      </button>
    </form>

    @if (list.error()) {
      <div class="alert alert--error" role="alert">
        {{ errorText(list.error()) }}
      </div>
    }

    @if (list.value(); as res) {
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" i18n="@@admin.user">Player</th>
              <th scope="col" i18n="@@admin.email">Email</th>
              <th scope="col" class="num" i18n="@@admin.balance">Balance</th>
              <th scope="col" i18n="@@admin.statusCol">Status</th>
              <th scope="col" i18n="@@admin.joined">Joined</th>
            </tr>
          </thead>
          <tbody>
            @for (u of res.items; track u.id) {
              <tr>
                <th scope="row">
                  <button type="button" class="link" (click)="open(u)">
                    {{ u.displayName }}
                  </button>
                  @if (u.role === 'ADMIN') {
                    <span class="pill" i18n="@@admin.adminRole">admin</span>
                  }
                </th>
                <td>{{ u.email }}</td>
                <td class="num">{{ u.balance | credits }}</td>
                <td>
                  <span
                    class="pill"
                    [class.pill--ok]="u.status === 'ACTIVE'"
                    [class.pill--bad]="u.status !== 'ACTIVE'"
                    >{{ statusLabel(u) }}</span
                  >
                  @if (u.selfExcludedUntil) {
                    <span class="pill pill--warn" i18n="@@admin.excluded"
                      >self-excluded</span
                    >
                  } @else if (u.coolOffUntil) {
                    <span class="pill pill--warn" i18n="@@admin.onBreak"
                      >on a break</span
                    >
                  }
                </td>
                <td>{{ u.createdAt | date: 'mediumDate' }}</td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="muted" i18n="@@admin.noUsers">
                  No players match.
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <div class="pager">
        <span class="muted" i18n="@@admin.pageOf"
          >Page {{ res.page }} of {{ pages() }} · {{ res.total }} players</span
        >
        <button
          type="button"
          class="btn btn--small"
          [disabled]="page() <= 1"
          (click)="page.set(page() - 1)"
          i18n="@@admin.prev"
        >
          Previous
        </button>
        <button
          type="button"
          class="btn btn--small"
          [disabled]="page() >= pages()"
          (click)="page.set(page() + 1)"
          i18n="@@admin.next"
        >
          Next
        </button>
      </div>
    }

    <cas-ui-modal
      [heading]="detail()?.displayName ?? ''"
      [open]="selectedId() !== null"
      (closed)="selectedId.set(null)"
    >
      @if (detail(); as d) {
        <dl class="facts">
          <dt i18n="@@admin.email">Email</dt>
          <dd>
            {{ d.email }}
            @if (d.emailVerified) {
              <span class="pos" i18n="@@admin.verified">✓ verified</span>
            }
          </dd>
          <dt i18n="@@admin.balance">Balance</dt>
          <dd>
            <strong>{{ d.balance | credits }}</strong>
          </dd>
          <dt i18n="@@admin.statusCol">Status</dt>
          <dd>
            {{ statusLabel(d) }}
            @if (d.selfExcludedUntil) {
              ·
              <ng-container i18n="@@admin.excludedUntil"
                >self-excluded until
                {{ d.selfExcludedUntil | date: 'medium' }}</ng-container
              >
            }
            @if (d.coolOffUntil) {
              ·
              <ng-container i18n="@@admin.breakUntil"
                >on a break until
                {{ d.coolOffUntil | date: 'medium' }}</ng-container
              >
            }
            @if (d.lockedUntil) {
              ·
              <ng-container i18n="@@admin.lockedUntil"
                >sign-in locked until
                {{ d.lockedUntil | date: 'shortTime' }}</ng-container
              >
            }
          </dd>
          <dt i18n="@@admin.twoFactor">Two-factor</dt>
          <dd>
            @if (d.twoFactorEnabled) {
              <ng-container i18n="@@admin.on">On</ng-container>
            } @else {
              <ng-container i18n="@@admin.offLower">Off</ng-container>
            }
          </dd>
          <dt i18n="@@admin.play">Play</dt>
          <dd i18n="@@admin.playSummary">
            {{ d.stats.rounds }} rounds · staked
            {{ d.stats.staked | credits }} · won {{ d.stats.paid | credits }}
          </dd>
          <dt i18n="@@admin.limits">Limits</dt>
          <dd>{{ limitsText(d) }}</dd>
          <dt i18n="@@admin.userId">ID</dt>
          <dd class="mono">{{ d.id }}</dd>
        </dl>

        @if (d.id !== auth.user()?.id && d.role !== 'ADMIN') {
          <h3 i18n="@@admin.adjustTitle">Adjust balance</h3>
          <form
            class="toolbar"
            [formGroup]="adjustForm"
            (ngSubmit)="adjust(d)"
            novalidate
          >
            <div class="field">
              <label for="adm-amount" i18n="@@admin.amount"
                >Amount (credits, negative to debit)</label
              >
              <input
                id="adm-amount"
                type="number"
                step="0.01"
                formControlName="amount"
              />
            </div>
            <div class="field">
              <label for="adm-reason" i18n="@@admin.reason">Reason</label>
              <input id="adm-reason" formControlName="reason" maxlength="200" />
            </div>
            <button
              type="submit"
              class="btn btn--primary btn--small"
              [disabled]="busy()"
              i18n="@@admin.apply"
            >
              Apply
            </button>
          </form>

          <h3 i18n="@@admin.accessTitle">Account access</h3>
          <form
            class="toolbar"
            [formGroup]="statusForm"
            (ngSubmit)="toggleStatus(d)"
            novalidate
          >
            <div class="field">
              <label for="adm-status-reason" i18n="@@admin.reason"
                >Reason</label
              >
              <input
                id="adm-status-reason"
                formControlName="reason"
                maxlength="500"
              />
            </div>
            @if (d.status === 'ACTIVE') {
              <button
                type="submit"
                class="btn btn--danger btn--small"
                [disabled]="busy()"
                i18n="@@admin.suspend"
              >
                Suspend
              </button>
            } @else {
              <button
                type="submit"
                class="btn btn--small"
                [disabled]="busy()"
                i18n="@@admin.reactivate"
              >
                Reactivate
              </button>
            }
          </form>
          <p class="muted" i18n="@@admin.suspendNote">
            Suspending signs the player out everywhere and blocks bets at once.
          </p>
        }

        <h3 i18n="@@admin.recentLedger">Recent ledger</h3>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col" i18n="@@admin.when">When</th>
                <th scope="col" i18n="@@admin.type">Type</th>
                <th scope="col" class="num" i18n="@@admin.amountCol">Amount</th>
                <th scope="col" class="num" i18n="@@admin.after">Balance</th>
                <th scope="col" i18n="@@admin.note">Note</th>
              </tr>
            </thead>
            <tbody>
              @for (e of d.recentLedger; track e.id) {
                <tr>
                  <td>{{ e.createdAt | date: 'short' }}</td>
                  <td>{{ e.type }}</td>
                  <td
                    class="num"
                    [class.pos]="e.amount > 0"
                    [class.neg]="e.amount < 0"
                  >
                    {{ e.amount | credits }}
                  </td>
                  <td class="num">{{ e.balanceAfter | credits }}</td>
                  <td class="muted">{{ e.description }}</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        @if (d.actions.length) {
          <h3 i18n="@@admin.history">Admin history</h3>
          <ul class="history">
            @for (a of d.actions; track a.id) {
              <li>
                <span class="muted">{{ a.createdAt | date: 'short' }}</span>
                <strong>{{ a.action }}</strong>
                <span class="mono">{{ json(a.details) }}</span>
                <span class="muted">— {{ a.adminEmail }}</span>
              </li>
            }
          </ul>
        }
      } @else {
        <p class="muted" i18n="@@admin.loading">Loading…</p>
      }
    </cas-ui-modal>
  `,
  styles: `
    .facts {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: var(--space-2) var(--space-4);
      margin: 0 0 var(--space-4);
    }
    .facts dt {
      color: var(--color-text-muted);
    }
    .facts dd {
      margin: 0;
    }
    h3 {
      font-size: var(--font-size-md, 1rem);
      margin: var(--space-4) 0 var(--space-2);
    }
    .history {
      list-style: none;
      padding: 0;
      display: grid;
      gap: var(--space-2);
      font-size: var(--font-size-sm);
    }
    .history li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
    }
  `,
})
export class AdminUsersComponent {
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly auth = inject(AuthStore);

  protected readonly query = signal('');
  protected readonly status = signal<'' | 'ACTIVE' | 'SUSPENDED'>('');
  protected readonly page = signal(1);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly list = httpResource<Paginated<AdminUserRow>>(() => ({
    url: '/api/admin/users',
    params: {
      page: this.page(),
      pageSize: PAGE_SIZE,
      ...(this.query() ? { q: this.query() } : {}),
      ...(this.status() ? { status: this.status() } : {}),
    },
  }));
  private readonly detailRes = httpResource<AdminUserDetail>(() => {
    const id = this.selectedId();
    return id ? `/api/admin/users/${id}` : undefined;
  });
  protected readonly detail = computed(() =>
    this.selectedId() ? (this.detailRes.value() ?? null) : null,
  );
  protected readonly pages = computed(() =>
    Math.max(1, Math.ceil((this.list.value()?.total ?? 0) / PAGE_SIZE)),
  );

  protected readonly adjustForm = this.fb.group({
    amount: [0, [Validators.required]],
    reason: ['', [Validators.required, Validators.minLength(3)]],
  });
  protected readonly statusForm = this.fb.group({
    reason: ['', [Validators.required, Validators.minLength(3)]],
  });

  protected search(event: Event): void {
    event.preventDefault();
  }

  protected setStatus(value: '' | 'ACTIVE' | 'SUSPENDED'): void {
    this.status.set(value);
    this.page.set(1);
  }

  protected open(u: AdminUserRow): void {
    this.adjustForm.reset();
    this.statusForm.reset();
    this.selectedId.set(u.id);
  }

  protected statusLabel(u: AdminUserRow): string {
    return u.status === 'ACTIVE'
      ? $localize`:@@admin.statusActive:Active`
      : $localize`:@@admin.statusSuspended:Suspended`;
  }

  protected limitsText(d: AdminUserDetail): string {
    const set = Object.entries(d.limits).filter(([, v]) => v !== null);
    return set.length
      ? set.map(([k, v]) => `${k}: ${v}`).join(', ')
      : $localize`:@@admin.noLimits:None set`;
  }

  protected json(details: Record<string, unknown>): string {
    return JSON.stringify(details);
  }

  protected errorText(err: unknown): string {
    return errorMessage(err);
  }

  protected async adjust(d: AdminUserDetail): Promise<void> {
    if (this.adjustForm.invalid) return this.adjustForm.markAllAsTouched();
    const { amount, reason } = this.adjustForm.getRawValue();
    const minor = Math.round(Number(amount) * 100);
    if (!minor || Math.abs(minor) > MAX_ADJUSTMENT) {
      this.toasts.error(
        $localize`:@@admin.badAmount:Enter a non-zero amount up to 100,000 credits.`,
      );
      return;
    }
    await this.run(async () => {
      await firstValueFrom(
        this.http.post(`/api/admin/users/${d.id}/adjust`, {
          amount: minor,
          reason: reason.trim(),
        }),
      );
      this.adjustForm.reset();
      this.toasts.success($localize`:@@admin.adjusted:Balance adjusted.`);
    });
  }

  protected async toggleStatus(d: AdminUserDetail): Promise<void> {
    if (this.statusForm.invalid) return this.statusForm.markAllAsTouched();
    await this.run(async () => {
      await firstValueFrom(
        this.http.patch(`/api/admin/users/${d.id}/status`, {
          status: d.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE',
          reason: this.statusForm.getRawValue().reason.trim(),
        }),
      );
      this.statusForm.reset();
      this.toasts.success($localize`:@@admin.statusChanged:Status updated.`);
    });
  }

  private async run(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    try {
      await action();
      this.detailRes.reload();
      this.list.reload();
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
