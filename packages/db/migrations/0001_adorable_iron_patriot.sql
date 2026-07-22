ALTER TABLE "profiles" ADD COLUMN "stripe_account_id" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "stripe_charges_enabled" boolean DEFAULT false NOT NULL;