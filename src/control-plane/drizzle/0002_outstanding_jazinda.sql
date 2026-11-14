CREATE TYPE "public"."balancing_type" AS ENUM('weighted_p2c', 'least_in_flight', 'round_robin', 'random');--> statement-breakpoint
CREATE TYPE "public"."model_source" AS ENUM('huggingface', 'upload');--> statement-breakpoint
CREATE TYPE "public"."model_status" AS ENUM('pending', 'downloading', 'uploading', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."serving_type" AS ENUM('replicated');--> statement-breakpoint
CREATE TABLE "models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" "model_source" NOT NULL,
	"source_url" text,
	"file_name" text NOT NULL,
	"status" "model_status" NOT NULL,
	"error" text,
	"storage_key" text NOT NULL,
	"upload_id" text,
	"size_bytes" bigint,
	"progress_bytes" bigint DEFAULT 0 NOT NULL,
	"sha256" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "models_org_id_name_unique" UNIQUE("org_id","name")
);
--> statement-breakpoint
CREATE TABLE "node_status" (
	"node_id" uuid PRIMARY KEY NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"connected_since" timestamp with time zone,
	"cpu_percent" double precision,
	"memory_used_mb" integer,
	"battery_percent" integer,
	"charging" boolean,
	"temperature_c" double precision,
	"in_flight" integer DEFAULT 0 NOT NULL,
	"tokens_per_sec" double precision,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"platform" text,
	"device_model" text,
	"os_version" text,
	"app_version" text,
	"cpu_cores" integer,
	"memory_total_mb" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "nodes_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
CREATE TABLE "pool_models" (
	"pool_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pool_models_pool_id_model_id_pk" PRIMARY KEY("pool_id","model_id")
);
--> statement-breakpoint
ALTER TABLE "pools" ADD COLUMN "serving_type" "serving_type" DEFAULT 'replicated' NOT NULL;--> statement-breakpoint
ALTER TABLE "pools" ADD COLUMN "balancing_type" "balancing_type" DEFAULT 'weighted_p2c' NOT NULL;--> statement-breakpoint
ALTER TABLE "models" ADD CONSTRAINT "models_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_status" ADD CONSTRAINT "node_status_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_models" ADD CONSTRAINT "pool_models_pool_id_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."pools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pool_models" ADD CONSTRAINT "pool_models_model_id_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "models_status_idx" ON "models" USING btree ("status");--> statement-breakpoint
CREATE INDEX "nodes_pool_idx" ON "nodes" USING btree ("pool_id");