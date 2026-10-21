-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('OPEN', 'SETTLED');

-- CreateTable
CREATE TABLE "seed_pairs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "server_seed" TEXT NOT NULL,
    "server_seed_hash" TEXT NOT NULL,
    "client_seed" TEXT NOT NULL,
    "next_nonce" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealed_at" TIMESTAMP(3),

    CONSTRAINT "seed_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_rounds" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "game_id" TEXT NOT NULL,
    "seed_pair_id" UUID NOT NULL,
    "nonce" INTEGER NOT NULL,
    "status" "RoundStatus" NOT NULL,
    "stake" BIGINT NOT NULL,
    "payout" BIGINT NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "result" JSONB,
    "state" JSONB,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settled_at" TIMESTAMP(3),

    CONSTRAINT "game_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_settings" (
    "game_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "game_settings_pkey" PRIMARY KEY ("game_id")
);

-- CreateIndex
CREATE INDEX "seed_pairs_user_id_created_at_idx" ON "seed_pairs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "game_rounds_user_id_created_at_idx" ON "game_rounds"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "game_rounds_game_id_created_at_idx" ON "game_rounds"("game_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "game_rounds_user_id_idempotency_key_key" ON "game_rounds"("user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "game_rounds_seed_pair_id_nonce_key" ON "game_rounds"("seed_pair_id", "nonce");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_round_id_fkey" FOREIGN KEY ("round_id") REFERENCES "game_rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seed_pairs" ADD CONSTRAINT "seed_pairs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_seed_pair_id_fkey" FOREIGN KEY ("seed_pair_id") REFERENCES "seed_pairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written rules
-- ---------------------------------------------------------------------------

-- At most one active seed pair per user.
CREATE UNIQUE INDEX "seed_pairs_one_active_per_user" ON "seed_pairs" ("user_id") WHERE "active";

-- A revealed pair is never active again, and nonces never go negative.
ALTER TABLE "seed_pairs" ADD CONSTRAINT "seed_pairs_revealed_inactive" CHECK (NOT ("active" AND "revealed_at" IS NOT NULL));
ALTER TABLE "seed_pairs" ADD CONSTRAINT "seed_pairs_nonce_non_negative" CHECK ("next_nonce" >= 0);

ALTER TABLE "game_rounds" ADD CONSTRAINT "game_rounds_amounts_non_negative" CHECK ("stake" > 0 AND "payout" >= 0);

-- Every game starts enabled.
INSERT INTO "game_settings" ("game_id", "enabled", "updated_at") VALUES
  ('classic-3-reel', true, now()),
  ('video-5-reel', true, now()),
  ('megaways', true, now()),
  ('roulette', true, now()),
  ('blackjack', true, now()),
  ('video-poker', true, now());
