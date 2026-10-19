CREATE TABLE `request_rate_limits` (
	`rate_key` text PRIMARY KEY NOT NULL,
	`request_count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `request_rate_limits_expires_at_idx` ON `request_rate_limits` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `booking_slot_locks` (
	`slot_start_local` text PRIMARY KEY NOT NULL,
	`booking_id` text NOT NULL
);
--> statement-breakpoint
WITH RECURSIVE `active_slots` (`booking_id`, `slot_start_local`, `end_local`) AS (
	SELECT `id`, `start_local`, `end_local` FROM `bookings` WHERE `status` = 'active'
	UNION ALL
	SELECT `booking_id`, strftime('%Y-%m-%dT%H:%M:%S', datetime(`slot_start_local`, '+30 minutes')), `end_local`
	FROM `active_slots`
	WHERE datetime(`slot_start_local`, '+30 minutes') < datetime(`end_local`)
)
INSERT OR IGNORE INTO `booking_slot_locks` (`slot_start_local`, `booking_id`)
SELECT `slot_start_local`, `booking_id` FROM `active_slots`;
--> statement-breakpoint
CREATE TABLE `booking_mutation_locks` (
	`booking_id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL
);
