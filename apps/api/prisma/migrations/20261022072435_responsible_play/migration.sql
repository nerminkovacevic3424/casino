-- AlterEnum
ALTER TYPE "LedgerType" ADD VALUE 'JACKPOT';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cool_off_until" TIMESTAMP(3),
ADD COLUMN     "self_excluded_until" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "player_limits" (
    "user_id" UUID NOT NULL,
    "daily_loss_limit" BIGINT,
    "weekly_loss_limit" BIGINT,
    "monthly_loss_limit" BIGINT,
    "daily_wager_limit" BIGINT,
    "session_limit_minutes" INTEGER,
    "reality_check_minutes" INTEGER,
    "pending" JSONB,
    "pending_effective_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "player_limits_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "favourites" (
    "user_id" UUID NOT NULL,
    "game_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favourites_pkey" PRIMARY KEY ("user_id","game_id")
);

-- AddForeignKey
ALTER TABLE "player_limits" ADD CONSTRAINT "player_limits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Limits are positive when set.
ALTER TABLE "player_limits" ADD CONSTRAINT "player_limits_positive" CHECK (
  ("daily_loss_limit" IS NULL OR "daily_loss_limit" > 0) AND
  ("weekly_loss_limit" IS NULL OR "weekly_loss_limit" > 0) AND
  ("monthly_loss_limit" IS NULL OR "monthly_loss_limit" > 0) AND
  ("daily_wager_limit" IS NULL OR "daily_wager_limit" > 0) AND
  ("session_limit_minutes" IS NULL OR "session_limit_minutes" > 0) AND
  ("reality_check_minutes" IS NULL OR "reality_check_minutes" > 0)
);
