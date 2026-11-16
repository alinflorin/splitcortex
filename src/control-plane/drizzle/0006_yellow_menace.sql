ALTER TABLE "node_status" ADD COLUMN "backend" text;--> statement-breakpoint
ALTER TABLE "node_status" ADD COLUMN "max_context_tokens" integer;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "compute_backend" text;--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "max_context_tokens" integer;