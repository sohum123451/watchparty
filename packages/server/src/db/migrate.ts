import postgres from "postgres";

export interface Migration {
  version: string;
  name: string;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  {
    version: "0001_initial_core_schema",
    name: "Create users, auth, social, and rooms tables",
    sql: `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name VARCHAR(64) NOT NULL,
        username VARCHAR(32) UNIQUE,
        friend_code VARCHAR(32) NOT NULL UNIQUE,
        presence_privacy VARCHAR(16) DEFAULT 'friends' NOT NULL,
        who_can_friend_me VARCHAR(24) DEFAULT 'everyone' NOT NULL,
        who_can_invite_me VARCHAR(24) DEFAULT 'everyone' NOT NULL,
        bio TEXT,
        avatar TEXT,
        notification_preferences TEXT,
        pending_email VARCHAR(255),
        email_verified_at TIMESTAMP WITH TIME ZONE,
        google_id VARCHAR(128),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        family_id UUID NOT NULL,
        device_info TEXT,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        revoked_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS email_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(32) NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS friendships (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user1_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user2_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        requester_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        addressee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(16) NOT NULL,
        blocked_by UUID REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(64) NOT NULL,
        actor_id UUID REFERENCES users(id) ON DELETE CASCADE,
        actor_name VARCHAR(64),
        payload TEXT,
        read BOOLEAN DEFAULT FALSE NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS watch_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_id VARCHAR(128) NOT NULL,
        title VARCHAR(255) NOT NULL,
        duration_ms VARCHAR(32) DEFAULT '0' NOT NULL,
        duration_watched_ms VARCHAR(32) DEFAULT '0' NOT NULL,
        completed BOOLEAN DEFAULT FALSE NOT NULL,
        thumbnail_url TEXT,
        room_id VARCHAR(64),
        watched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS favourites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        video_id VARCHAR(128) NOT NULL,
        title VARCHAR(255) NOT NULL,
        thumbnail_url TEXT,
        duration_ms VARCHAR(32),
        added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS co_watch_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        friend_display_name VARCHAR(64) NOT NULL,
        videoId VARCHAR(128) NOT NULL,
        video_title VARCHAR(255) NOT NULL,
        duration_watched_ms VARCHAR(32) DEFAULT '0' NOT NULL,
        room_id VARCHAR(64),
        watched_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS personal_playlists (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(100) NOT NULL,
        description TEXT,
        is_public BOOLEAN DEFAULT FALSE NOT NULL,
        items TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rooms (
        id VARCHAR(64) PRIMARY KEY,
        code VARCHAR(16) NOT NULL UNIQUE,
        name VARCHAR(128) NOT NULL,
        host_id VARCHAR(64) NOT NULL,
        control_mode VARCHAR(32) DEFAULT 'public' NOT NULL,
        room_type VARCHAR(32) DEFAULT 'public' NOT NULL,
        snapshot_json TEXT NOT NULL,
        is_active BOOLEAN DEFAULT TRUE NOT NULL,
        is_home_room BOOLEAN DEFAULT FALSE NOT NULL,
        home_group_name VARCHAR(128),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_friendships_users ON friendships(user1_id, user2_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash ON refresh_tokens(token_hash);
      CREATE INDEX IF NOT EXISTS idx_rooms_code ON rooms(code);
    `,
  },
  {
    version: "0002_daily_delight_parties_and_push",
    name: "Create scheduled_parties, push_subscriptions, and preferences tables",
    sql: `
      CREATE TABLE IF NOT EXISTS scheduled_parties (
        id VARCHAR(64) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        creator_user_id VARCHAR(64) NOT NULL,
        creator_display_name VARCHAR(64) NOT NULL,
        scheduled_start_time_ms BIGINT NOT NULL,
        scheduled_end_time_ms BIGINT NOT NULL,
        source_url TEXT,
        source_title VARCHAR(255),
        room_id VARCHAR(64),
        room_code VARCHAR(16),
        is_home_room BOOLEAN DEFAULT FALSE NOT NULL,
        invited_user_ids JSONB DEFAULT '[]'::jsonb NOT NULL,
        rsvps JSONB DEFAULT '{}'::jsonb NOT NULL,
        reminded_10m BOOLEAN DEFAULT FALSE NOT NULL,
        room_opened BOOLEAN DEFAULT FALSE NOT NULL,
        created_at BIGINT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(64) NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_push_preferences (
        user_id VARCHAR(64) PRIMARY KEY,
        enabled BOOLEAN DEFAULT TRUE NOT NULL,
        party_started BOOLEAN DEFAULT TRUE NOT NULL,
        party_invite BOOLEAN DEFAULT TRUE NOT NULL,
        friend_request BOOLEAN DEFAULT TRUE NOT NULL,
        party_10m_reminder BOOLEAN DEFAULT TRUE NOT NULL,
        quiet_hours_enabled BOOLEAN DEFAULT FALSE NOT NULL,
        quiet_hours_start VARCHAR(10) DEFAULT '22:00' NOT NULL,
        quiet_hours_end VARCHAR(10) DEFAULT '08:00' NOT NULL,
        timezone_offset_minutes INT DEFAULT 0 NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scheduled_parties_time ON scheduled_parties(scheduled_start_time_ms);
      CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);
    `,
  },
  {
    version: "0003_observability_and_admin",
    name: "Add user roles, ban tracking, registration invites, system settings, and usage records",
    sql: `
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) DEFAULT 'user' NOT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE NOT NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT;

      CREATE TABLE IF NOT EXISTS registration_invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(64) NOT NULL UNIQUE,
        created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        max_uses INT,
        use_count INT DEFAULT 0 NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE,
        is_revoked BOOLEAN DEFAULT FALSE NOT NULL,
        note TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(64) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS usage_records (
        id SERIAL PRIMARY KEY,
        date VARCHAR(10) NOT NULL UNIQUE,
        emails_sent INT DEFAULT 0 NOT NULL,
        bandwidth_inbound_bytes BIGINT DEFAULT 0 NOT NULL,
        bandwidth_outbound_bytes BIGINT DEFAULT 0 NOT NULL,
        storage_bytes BIGINT DEFAULT 0 NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_reg_invites_code ON registration_invites(code);
      CREATE INDEX IF NOT EXISTS idx_usage_records_date ON usage_records(date);
    `,
  },
];

/**
 * Executes pending database migrations idempotently against PostgreSQL.
 */
export async function runMigrations(databaseUrl?: string): Promise<{ applied: number; total: number }> {
  const url = databaseUrl || process.env.DATABASE_URL;

  if (!url) {
    console.log("[Migrations] No DATABASE_URL provided. Skipping PostgreSQL migrations (In-Memory / Zero-Ops mode active).");
    return { applied: 0, total: MIGRATIONS.length };
  }

  console.log("[Migrations] Connecting to PostgreSQL to inspect database schema...");
  const sql = postgres(url, { max: 1, onnotice: () => {} });

  try {
    // 1. Ensure migrations table exists
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        version VARCHAR(64) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
    `;

    // 2. Fetch already applied versions
    const appliedRows = await sql<{ version: string }[]>`
      SELECT version FROM schema_migrations ORDER BY id ASC;
    `;
    const appliedVersions = new Set(appliedRows.map((r) => r.version));

    let appliedCount = 0;

    // 3. Run pending migrations in transaction
    for (const migration of MIGRATIONS) {
      if (!appliedVersions.has(migration.version)) {
        console.log(`[Migrations] Applying migration: ${migration.version} - ${migration.name}...`);
        await sql.begin(async (tx) => {
          await tx.unsafe(migration.sql);
          await tx`
            INSERT INTO schema_migrations (version, name)
            VALUES (${migration.version}, ${migration.name});
          `;
        });
        appliedCount++;
        console.log(`[Migrations] ✓ Successfully applied ${migration.version}`);
      }
    }

    if (appliedCount === 0) {
      console.log(`[Migrations] Database is up to date (all ${MIGRATIONS.length} migrations applied).`);
    } else {
      console.log(`[Migrations] Migration run complete. Applied ${appliedCount} new migration(s).`);
    }

    return { applied: appliedCount, total: MIGRATIONS.length };
  } finally {
    await sql.end();
  }
}

// Direct CLI Execution: node dist/db/migrate.js or npm run db:migrate
if (process.argv[1] && process.argv[1].endsWith("migrate.js")) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[Migrations] Fatal error running migrations:", err);
      process.exit(1);
    });
}
