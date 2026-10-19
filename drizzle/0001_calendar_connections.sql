CREATE TABLE `calendar_connections` (
	`provider` text PRIMARY KEY NOT NULL,
	`account_email` text,
	`encrypted_refresh_token` text NOT NULL,
	`token_iv` text NOT NULL,
	`scope` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
