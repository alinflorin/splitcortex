-- One model per pool: keep only the most recently assigned model of each pool, then enforce it.
DELETE FROM "pool_models" a USING "pool_models" b
  WHERE a."pool_id" = b."pool_id"
    AND (a."created_at", a."model_id") < (b."created_at", b."model_id");--> statement-breakpoint
ALTER TABLE "pool_models" ADD CONSTRAINT "pool_models_pool_id_unique" UNIQUE("pool_id");
