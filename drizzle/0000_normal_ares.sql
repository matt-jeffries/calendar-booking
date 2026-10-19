CREATE TABLE `booking_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`booking_id` text NOT NULL,
	`action` text NOT NULL,
	`previous_start_local` text,
	`new_start_local` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bookings` (
	`id` text PRIMARY KEY NOT NULL,
	`manage_token_hash` text NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`start_local` text NOT NULL,
	`end_local` text NOT NULL,
	`timezone` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`calendar_provider` text DEFAULT 'google' NOT NULL,
	`calendar_event_id` text,
	`meeting_url` text,
	`integration_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`cancelled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bookings_manage_token_hash_unique` ON `bookings` (`manage_token_hash`);