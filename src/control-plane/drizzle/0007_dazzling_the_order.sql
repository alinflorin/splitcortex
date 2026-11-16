CREATE TABLE "benchmark_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"node_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error" text,
	"ttft_ms" integer,
	"total_ms" integer,
	"tokens" integer,
	"tokens_per_sec" double precision,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benchmark_results_unique" UNIQUE("benchmark_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "benchmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "limit_requests_per_minute" integer;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "limit_tokens_per_minute" integer;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "limit_tokens_per_day" bigint;--> statement-breakpoint
ALTER TABLE "node_status" ADD COLUMN "gateway_id" text;--> statement-breakpoint
ALTER TABLE "node_status" ADD COLUMN "gateway_keys" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "limit_requests_per_minute" integer;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "limit_tokens_per_minute" integer;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "limit_tokens_per_day" bigint;--> statement-breakpoint
ALTER TABLE "benchmark_results" ADD CONSTRAINT "benchmark_results_benchmark_id_benchmarks_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."benchmarks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_results" ADD CONSTRAINT "benchmark_results_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmarks" ADD CONSTRAINT "benchmarks_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "benchmarks_pool_idx" ON "benchmarks" USING btree ("pool_id","created_at");