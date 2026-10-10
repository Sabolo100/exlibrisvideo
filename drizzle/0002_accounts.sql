CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_sub" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"picture" text,
	"locale" varchar(5) DEFAULT 'hu' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_sub_unique" UNIQUE("google_sub")
);
--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "copies" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "duplicate_of_id" uuid;--> statement-breakpoint
ALTER TABLE "collections" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_duplicate_of_id_books_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collections" ADD CONSTRAINT "collections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collections_user_uq" ON "collections" USING btree ("user_id");