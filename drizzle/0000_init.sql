CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" varchar(12) NOT NULL,
	"title" text NOT NULL,
	"subtitle" text,
	"author" text,
	"spine_author" text,
	"spine_title" text,
	"author_sort" text,
	"title_sort" text,
	"original_title" text,
	"series" text,
	"publisher" text,
	"language" varchar(8),
	"original_language" varchar(8),
	"author_country" varchar(2),
	"first_published_year" integer,
	"edition_year" integer,
	"isbn" text,
	"page_count" integer,
	"category" varchar(40),
	"topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"description_hu" text,
	"description_en" text,
	"cover_url" text,
	"cover_path" text,
	"enrichment" jsonb,
	"enriched_at" timestamp with time zone,
	"source" varchar(8) DEFAULT 'video' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"spine_path" text,
	"spine_color" varchar(9),
	"best_frame_id" uuid,
	"best_bbox" jsonb,
	"first_video_id" uuid,
	"first_time_sec" real,
	"shelf_position" double precision DEFAULT 0 NOT NULL,
	"detection_count" integer DEFAULT 1 NOT NULL,
	"reading_status" varchar(16) DEFAULT 'unknown' NOT NULL,
	"rating" smallint,
	"favorite" boolean DEFAULT false NOT NULL,
	"notes" text,
	"lent_to" text,
	"lent_at" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" varchar(12) PRIMARY KEY NOT NULL,
	"owner_token_hash" text NOT NULL,
	"title" text,
	"description" text,
	"owner_name" text,
	"email" text,
	"locale" varchar(5) DEFAULT 'hu' NOT NULL,
	"visibility" varchar(16) DEFAULT 'link' NOT NULL,
	"pin_hash" text,
	"status" varchar(16) DEFAULT 'draft' NOT NULL,
	"usage" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"email_sent_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "detections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" varchar(12) NOT NULL,
	"video_id" uuid NOT NULL,
	"frame_id" uuid,
	"book_id" uuid,
	"raw_author" text,
	"raw_title" text NOT NULL,
	"publisher" text,
	"confidence" real NOT NULL,
	"bbox" jsonb,
	"order_in_frame" integer,
	"provider" varchar(16) NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" varchar(12),
	"to_address" text NOT NULL,
	"kind" varchar(24) NOT NULL,
	"status" varchar(16) NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "frames" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"video_id" uuid NOT NULL,
	"collection_id" varchar(12) NOT NULL,
	"idx" integer NOT NULL,
	"time_sec" real NOT NULL,
	"sharpness" real,
	"storage_path" text NOT NULL,
	"thumb_path" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"analyzed" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" varchar(32) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(16) DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" varchar(12) NOT NULL,
	"kind" varchar(8) DEFAULT 'video' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"bytes_received" bigint DEFAULT 0 NOT NULL,
	"upload_status" varchar(16) DEFAULT 'uploading' NOT NULL,
	"storage_path" text,
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"stage" varchar(16),
	"progress" smallint DEFAULT 0 NOT NULL,
	"duration_sec" real,
	"width" integer,
	"height" integer,
	"frames_total" integer DEFAULT 0 NOT NULL,
	"frames_analyzed" integer DEFAULT 0 NOT NULL,
	"books_found" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"source_deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_best_frame_id_frames_id_fk" FOREIGN KEY ("best_frame_id") REFERENCES "public"."frames"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_first_video_id_videos_id_fk" FOREIGN KEY ("first_video_id") REFERENCES "public"."videos"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detections" ADD CONSTRAINT "detections_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detections" ADD CONSTRAINT "detections_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detections" ADD CONSTRAINT "detections_frame_id_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."frames"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "detections" ADD CONSTRAINT "detections_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frames" ADD CONSTRAINT "frames_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frames" ADD CONSTRAINT "frames_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "videos" ADD CONSTRAINT "videos_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "books_collection_idx" ON "books" USING btree ("collection_id","shelf_position");--> statement-breakpoint
CREATE INDEX "books_collection_author_idx" ON "books" USING btree ("collection_id","author_sort");--> statement-breakpoint
CREATE INDEX "collections_email_idx" ON "collections" USING btree ("email");--> statement-breakpoint
CREATE INDEX "collections_created_idx" ON "collections" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "detections_video_idx" ON "detections" USING btree ("video_id");--> statement-breakpoint
CREATE INDEX "detections_book_idx" ON "detections" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "email_log_to_idx" ON "email_log" USING btree ("to_address","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "frames_video_idx_uq" ON "frames" USING btree ("video_id","idx");--> statement-breakpoint
CREATE INDEX "jobs_pick_idx" ON "jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "videos_collection_idx" ON "videos" USING btree ("collection_id","sort_order");