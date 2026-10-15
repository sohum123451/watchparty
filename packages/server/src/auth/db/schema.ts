import { pgTable, uuid, text, varchar, timestamp, boolean, integer, serial, bigint } from "drizzle-orm/pg-core";

/**
 * PostgreSQL Schema definition for WatchParty Authentication
 */

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: varchar("display_name", { length: 64 }).notNull(),
  username: varchar("username", { length: 32 }).unique(),
  friendCode: varchar("friend_code", { length: 32 }).unique().notNull(),
  presencePrivacy: varchar("presence_privacy", { length: 16 }).default("friends").notNull(), // 'everyone' | 'friends' | 'nobody'
  whoCanFriendMe: varchar("who_can_friend_me", { length: 24 }).default("everyone").notNull(), // 'everyone' | 'friends_of_friends' | 'nobody'
  whoCanInviteMe: varchar("who_can_invite_me", { length: 24 }).default("everyone").notNull(), // 'everyone' | 'friends_only' | 'nobody'
  bio: text("bio"),
  avatar: text("avatar"),
  notificationPreferences: text("notification_preferences"),
  pendingEmail: varchar("pending_email", { length: 255 }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  googleId: varchar("google_id", { length: 128 }),
  role: varchar("role", { length: 32 }).default("user").notNull(), // 'user' | 'admin' | 'moderator'
  isBanned: boolean("is_banned").default(false).notNull(),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  bannedReason: text("banned_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const refreshTokensTable = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  familyId: uuid("family_id").notNull(),
  deviceInfo: text("device_info"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const emailTokensTable = pgTable("email_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 32 }).notNull(), // 'verify' | 'reset' | 'change_email'
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const friendshipsTable = pgTable("friendships", {
  id: uuid("id").primaryKey().defaultRandom(),
  user1Id: uuid("user1_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  user2Id: uuid("user2_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  requesterId: uuid("requester_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  addresseeId: uuid("addressee_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  status: varchar("status", { length: 16 }).notNull(), // 'pending' | 'accepted' | 'blocked'
  blockedBy: uuid("blocked_by").references(() => usersTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const notificationsTable = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  type: varchar("type", { length: 64 }).notNull(), // 'friend_request_received' | 'friend_request_accepted' | 'room_invite' | 'system'
  actorId: uuid("actor_id").references(() => usersTable.id, { onDelete: "cascade" }),
  actorName: varchar("actor_name", { length: 64 }),
  payload: text("payload"),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const watchHistoryTable = pgTable("watch_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  videoId: varchar("video_id", { length: 128 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  durationMs: varchar("duration_ms", { length: 32 }).default("0").notNull(),
  durationWatchedMs: varchar("duration_watched_ms", { length: 32 }).default("0").notNull(),
  completed: boolean("completed").default(false).notNull(),
  thumbnailUrl: text("thumbnail_url"),
  roomId: varchar("room_id", { length: 64 }),
  watchedAt: timestamp("watched_at", { withTimezone: true }).defaultNow().notNull(),
});

export const favouritesTable = pgTable("favourites", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  videoId: varchar("video_id", { length: 128 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  thumbnailUrl: text("thumbnail_url"),
  durationMs: varchar("duration_ms", { length: 32 }),
  addedAt: timestamp("added_at", { withTimezone: true }).defaultNow().notNull(),
});

export const coWatchSessionsTable = pgTable("co_watch_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  friendUserId: uuid("friend_user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  friendDisplayName: varchar("friend_display_name", { length: 64 }).notNull(),
  videoId: varchar("video_id", { length: 128 }).notNull(),
  videoTitle: varchar("video_title", { length: 255 }).notNull(),
  durationWatchedMs: varchar("duration_watched_ms", { length: 32 }).default("0").notNull(),
  roomId: varchar("room_id", { length: 64 }),
  watchedAt: timestamp("watched_at", { withTimezone: true }).defaultNow().notNull(),
});

export const personalPlaylistsTable = pgTable("personal_playlists", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 100 }).notNull(),
  description: text("description"),
  isPublic: boolean("is_public").default(false).notNull(),
  items: text("items").notNull(), // JSON stringified PlaylistItem[]
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const roomsTable = pgTable("rooms", {
  id: varchar("id", { length: 64 }).primaryKey(),
  code: varchar("code", { length: 16 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  hostId: varchar("host_id", { length: 64 }).notNull(),
  controlMode: varchar("control_mode", { length: 32 }).default("public").notNull(),
  roomType: varchar("room_type", { length: 32 }).default("public").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type UserRow = typeof usersTable.$inferSelect;
export type InsertUserRow = typeof usersTable.$inferInsert;

export type RefreshTokenRow = typeof refreshTokensTable.$inferSelect;
export type InsertRefreshTokenRow = typeof refreshTokensTable.$inferInsert;

export type EmailTokenRow = typeof emailTokensTable.$inferSelect;
export type InsertEmailTokenRow = typeof emailTokensTable.$inferInsert;

export type FriendshipRow = typeof friendshipsTable.$inferSelect;
export type InsertFriendshipRow = typeof friendshipsTable.$inferInsert;

export type NotificationRow = typeof notificationsTable.$inferSelect;
export type InsertNotificationRow = typeof notificationsTable.$inferInsert;

export type WatchHistoryRow = typeof watchHistoryTable.$inferSelect;
export type InsertWatchHistoryRow = typeof watchHistoryTable.$inferInsert;

export type FavouriteRow = typeof favouritesTable.$inferSelect;
export type InsertFavouriteRow = typeof favouritesTable.$inferInsert;

export type CoWatchSessionRow = typeof coWatchSessionsTable.$inferSelect;
export type InsertCoWatchSessionRow = typeof coWatchSessionsTable.$inferInsert;

export type PersonalPlaylistRow = typeof personalPlaylistsTable.$inferSelect;
export type InsertPersonalPlaylistRow = typeof personalPlaylistsTable.$inferInsert;

export type RoomRow = typeof roomsTable.$inferSelect;
export type InsertRoomRow = typeof roomsTable.$inferInsert;

export const registrationInvitesTable = pgTable("registration_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 64 }).notNull().unique(),
  createdByUserId: uuid("created_by_user_id"),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").default(0).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  isRevoked: boolean("is_revoked").default(false).notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const systemSettingsTable = pgTable("system_settings", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const usageRecordsTable = pgTable("usage_records", {
  id: serial("id").primaryKey(),
  date: varchar("date", { length: 10 }).notNull().unique(), // YYYY-MM-DD
  emailsSent: integer("emails_sent").default(0).notNull(),
  bandwidthInboundBytes: bigint("bandwidth_inbound_bytes", { mode: "number" }).default(0).notNull(),
  bandwidthOutboundBytes: bigint("bandwidth_outbound_bytes", { mode: "number" }).default(0).notNull(),
  storageBytes: bigint("storage_bytes", { mode: "number" }).default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RegistrationInviteRow = typeof registrationInvitesTable.$inferSelect;
export type InsertRegistrationInviteRow = typeof registrationInvitesTable.$inferInsert;

export type SystemSettingRow = typeof systemSettingsTable.$inferSelect;
export type InsertSystemSettingRow = typeof systemSettingsTable.$inferInsert;

export type UsageRecordRow = typeof usageRecordsTable.$inferSelect;
export type InsertUsageRecordRow = typeof usageRecordsTable.$inferInsert;


