CREATE TYPE "public"."model_kind" AS ENUM('chat', 'embedding');--> statement-breakpoint
CREATE TABLE "node_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"command" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "models" ADD COLUMN "kind" "model_kind" DEFAULT 'chat' NOT NULL;--> statement-breakpoint
ALTER TABLE "node_commands" ADD CONSTRAINT "node_commands_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_commands" ADD CONSTRAINT "node_commands_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_commands_node_idx" ON "node_commands" USING btree ("node_id");