CREATE TABLE "node_metrics" (
	"bucket" timestamp with time zone NOT NULL,
	"node_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"cpu_percent" double precision,
	"memory_used_mb" integer,
	"battery_percent" integer,
	"charging" boolean,
	"temperature_c" double precision,
	"in_flight" integer DEFAULT 0 NOT NULL,
	"tokens_per_sec" double precision,
	CONSTRAINT "node_metrics_bucket_node_id_pk" PRIMARY KEY("bucket","node_id")
);
--> statement-breakpoint
CREATE TABLE "pool_metrics" (
	"bucket" timestamp with time zone NOT NULL,
	"org_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"rate_limited" bigint DEFAULT 0 NOT NULL,
	"unavailable" bigint DEFAULT 0 NOT NULL,
	"peak_in_flight" integer DEFAULT 0 NOT NULL,
	"latency_hist" integer[] NOT NULL,
	"ttft_hist" integer[] NOT NULL,
	CONSTRAINT "pool_metrics_bucket_org_id_pool_id_pk" PRIMARY KEY("bucket","org_id","pool_id")
);
--> statement-breakpoint
ALTER TABLE "node_metrics" ADD CONSTRAINT "node_metrics_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_metrics" ADD CONSTRAINT "pool_metrics_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "node_metrics_org_bucket_idx" ON "node_metrics" USING btree ("org_id","bucket");--> statement-breakpoint
CREATE INDEX "node_metrics_bucket_idx" ON "node_metrics" USING btree ("bucket");--> statement-breakpoint
CREATE INDEX "pool_metrics_org_bucket_idx" ON "pool_metrics" USING btree ("org_id","bucket");--> statement-breakpoint
CREATE INDEX "pool_metrics_bucket_idx" ON "pool_metrics" USING btree ("bucket");