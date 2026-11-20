ALTER TABLE "node_metrics" ADD COLUMN "requests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "node_metrics" ADD COLUMN "failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "node_metrics" ADD COLUMN "gen_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "node_metrics" ADD COLUMN "gen_ms" bigint DEFAULT 0 NOT NULL;