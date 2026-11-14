CREATE TABLE "usage_flushes" (
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"bucket" timestamp with time zone NOT NULL,
	"org_id" uuid NOT NULL,
	"pool_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"model" text NOT NULL,
	"tokens_in" bigint DEFAULT 0 NOT NULL,
	"tokens_out" bigint DEFAULT 0 NOT NULL,
	"requests" bigint DEFAULT 0 NOT NULL,
	"errors" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_records_bucket_org_id_pool_id_key_id_model_pk" PRIMARY KEY("bucket","org_id","pool_id","key_id","model")
);
--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_org_id_organisations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_records_org_bucket_idx" ON "usage_records" USING btree ("org_id","bucket");