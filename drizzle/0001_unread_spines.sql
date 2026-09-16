CREATE TABLE "unread_spines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" varchar(12) NOT NULL,
	"video_id" uuid NOT NULL,
	"frame_id" uuid,
	"bbox" jsonb,
	"spine_path" text,
	"spine_color" varchar(9),
	"reason" varchar(16) DEFAULT 'illegible' NOT NULL,
	"guess_author" text,
	"guess_title" text,
	"shelf_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "unread_spines" ADD CONSTRAINT "unread_spines_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unread_spines" ADD CONSTRAINT "unread_spines_video_id_videos_id_fk" FOREIGN KEY ("video_id") REFERENCES "public"."videos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unread_spines" ADD CONSTRAINT "unread_spines_frame_id_frames_id_fk" FOREIGN KEY ("frame_id") REFERENCES "public"."frames"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unread_spines_collection_idx" ON "unread_spines" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "unread_spines_video_idx" ON "unread_spines" USING btree ("video_id","shelf_order");