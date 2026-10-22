import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import {
  SLOT_CONFIGS,
  type LinesRoundResult,
  type RoundInput,
  type RoundReplay,
  hashServerSeed,
  replayRound,
  verifyServerSeed,
} from '@casino/game-engine';
import type {
  FairnessState,
  RevealedSeed,
  RoundDetail,
} from '@casino/shared-types';
import { CreditsPipe } from '@casino/ui';
import { firstValueFrom } from 'rxjs';
import { errorMessage } from '../../core/api-error';
import { AuthStore } from '../../core/auth.store';
import { ToastService } from '../../core/toast.service';

interface Verification {
  replay: RoundReplay;
  commitmentOk: boolean | null;
  matchesRecord: boolean | null;
}

/**
 * Recomputes a round entirely in the browser with the same engine and the
 * revealed seeds, so the player does not have to trust the server's word.
 */
@Component({
  selector: 'cas-verify-page',
  imports: [ReactiveFormsModule, CreditsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './verify.page.html',
  styleUrl: './verify.page.scss',
})
export class VerifyPage implements OnInit {
  /** Optional `?round=<id>` to prefill from history. */
  readonly round = input<string>();
  protected readonly auth = inject(AuthStore);
  private readonly http = inject(HttpClient);
  private readonly toasts = inject(ToastService);

  protected readonly slotIds = Object.keys(SLOT_CONFIGS);
  protected readonly active = signal<FairnessState | null>(null);
  protected readonly record = signal<RoundDetail | null>(null);
  protected readonly result = signal<Verification | null>(null);
  protected readonly error = signal('');
  protected readonly rotating = signal(false);
  protected readonly lastRevealed = signal<RevealedSeed | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    serverSeed: [
      '',
      [Validators.required, Validators.pattern(/^[0-9a-f]{64}$/)],
    ],
    serverSeedHash: ['', Validators.pattern(/^[0-9a-f]{64}$/)],
    clientSeed: ['', [Validators.required, Validators.maxLength(64)]],
    nonce: [0, [Validators.required, Validators.min(0)]],
    gameId: [this.slotIds[0], Validators.required],
    totalBet: [100, [Validators.required, Validators.min(1)]],
  });
  protected readonly rotateForm = inject(FormBuilder).nonNullable.group({
    clientSeed: [
      '',
      [Validators.maxLength(64), Validators.pattern(/^[\x21-\x7e]*$/)],
    ],
  });

  protected readonly grid = computed(() => {
    const replay = this.result()?.replay;
    return replay?.game === 'slot' && replay.result.kind === 'lines'
      ? (replay.result as LinesRoundResult).base.grid
      : null;
  });

  async ngOnInit(): Promise<void> {
    if (this.auth.status() !== 'anonymous') {
      await this.loadActive();
    }
    const id = this.round();
    if (id) await this.loadRound(id);
  }

  protected async loadRound(id: string): Promise<void> {
    try {
      const detail = await firstValueFrom(
        this.http.get<RoundDetail>(`/api/rounds/${encodeURIComponent(id)}`),
      );
      this.record.set(detail);
      const input = detail.input as { totalBet?: number };
      this.form.patchValue({
        serverSeed: detail.fairness.serverSeed ?? '',
        serverSeedHash: detail.fairness.serverSeedHash,
        clientSeed: detail.fairness.clientSeed,
        nonce: detail.fairness.nonce,
        gameId: detail.gameId,
        totalBet: input.totalBet ?? 0,
      });
      if (detail.fairness.serverSeed) this.verify();
    } catch (err) {
      this.error.set(errorMessage(err));
    }
  }

  protected verify(): void {
    this.form.markAllAsTouched();
    this.error.set('');
    this.result.set(null);
    if (this.form.invalid) return;
    const v = this.form.getRawValue();
    const roundInput: RoundInput = {
      game: 'slot',
      gameId: v.gameId,
      totalBet: Number(v.totalBet),
    };
    try {
      const replay = replayRound(
        {
          serverSeed: v.serverSeed,
          clientSeed: v.clientSeed,
          nonce: Number(v.nonce),
        },
        roundInput,
      );
      const record = this.record();
      this.result.set({
        replay,
        commitmentOk: v.serverSeedHash
          ? verifyServerSeed(v.serverSeed, v.serverSeedHash)
          : null,
        matchesRecord:
          record && record.fairness.nonce === Number(v.nonce)
            ? record.payout === replay.totalPayout
            : null,
      });
    } catch (err) {
      this.error.set((err as Error).message);
    }
  }

  protected computedHash(): string {
    const seed = this.form.controls.serverSeed.value;
    return /^[0-9a-f]{64}$/.test(seed) ? hashServerSeed(seed) : '';
  }

  protected async rotate(): Promise<void> {
    this.rotating.set(true);
    try {
      const clientSeed = this.rotateForm.getRawValue().clientSeed.trim();
      const res = await firstValueFrom(
        this.http.post<{ revealed: RevealedSeed; active: FairnessState }>(
          '/api/fairness/rotate',
          clientSeed ? { clientSeed } : {},
        ),
      );
      this.active.set(res.active);
      this.lastRevealed.set(res.revealed);
      this.rotateForm.reset();
      this.toasts.success(
        $localize`:@@verify.rotated:Seeds rotated. The previous server seed is now revealed.`,
      );
      const id = this.round();
      if (id) await this.loadRound(id);
    } catch (err) {
      this.toasts.error(errorMessage(err));
    } finally {
      this.rotating.set(false);
    }
  }

  private async loadActive(): Promise<void> {
    try {
      this.active.set(
        await firstValueFrom(this.http.get<FairnessState>('/api/fairness')),
      );
    } catch {
      // Signed out: the manual verifier still works.
    }
  }
}
