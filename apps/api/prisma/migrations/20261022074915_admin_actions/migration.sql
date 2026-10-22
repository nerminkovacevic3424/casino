-- CreateTable
CREATE TABLE "admin_actions" (
    "id" BIGSERIAL NOT NULL,
    "admin_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "target_user" UUID,
    "target_game" TEXT,
    "details" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_actions_created_at_idx" ON "admin_actions"("created_at" DESC);

-- CreateIndex
CREATE INDEX "admin_actions_target_user_idx" ON "admin_actions"("target_user");

-- The audit trail is append-only, like the ledger.
CREATE FUNCTION "append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "admin_actions_no_update_delete"
  BEFORE UPDATE OR DELETE ON "admin_actions"
  FOR EACH ROW EXECUTE FUNCTION "append_only"();

CREATE TRIGGER "admin_actions_no_truncate"
  BEFORE TRUNCATE ON "admin_actions"
  FOR EACH STATEMENT EXECUTE FUNCTION "append_only"();
