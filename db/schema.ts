import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const bookings = sqliteTable("bookings", {
  id: text("id").primaryKey(),
  manageTokenHash: text("manage_token_hash").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  context: text("context").notNull().default(""),
  startLocal: text("start_local").notNull(),
  endLocal: text("end_local").notNull(),
  timezone: text("timezone").notNull(),
  durationMinutes: integer("duration_minutes").notNull(),
  status: text("status").notNull().default("active"),
  calendarProvider: text("calendar_provider").notNull().default("google"),
  calendarEventId: text("calendar_event_id"),
  videoEventId: text("video_event_id"),
  meetingUrl: text("meeting_url"),
  integrationStatus: text("integration_status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  cancelledAt: text("cancelled_at"),
});

export const bookingChanges = sqliteTable("booking_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  bookingId: text("booking_id").notNull(),
  action: text("action").notNull(),
  previousStartLocal: text("previous_start_local"),
  newStartLocal: text("new_start_local"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const calendarConnections = sqliteTable("calendar_connections", {
  provider: text("provider").primaryKey(),
  accountEmail: text("account_email"),
  encryptedRefreshToken: text("encrypted_refresh_token").notNull(),
  tokenIv: text("token_iv").notNull(),
  scope: text("scope"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const requestRateLimits = sqliteTable("request_rate_limits", {
  rateKey: text("rate_key").primaryKey(),
  requestCount: integer("request_count").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const bookingSlotLocks = sqliteTable("booking_slot_locks", {
  slotStartLocal: text("slot_start_local").primaryKey(),
  bookingId: text("booking_id").notNull(),
});

export const bookingMutationLocks = sqliteTable("booking_mutation_locks", {
  bookingId: text("booking_id").primaryKey(),
  expiresAt: integer("expires_at").notNull(),
});
