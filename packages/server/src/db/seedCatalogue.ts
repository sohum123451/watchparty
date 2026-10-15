import postgres from "postgres";
import { FREE_FILMS } from "@watchparty/shared";

/**
 * Idempotently seeds the films table with real CC-licensed and public-domain films.
 */
export async function seedCatalogue(sql: postgres.Sql): Promise<number> {
  // Ensure table exists
  await sql`
    CREATE TABLE IF NOT EXISTS films (
      id VARCHAR(64) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      year INT NOT NULL,
      genre VARCHAR(64) NOT NULL,
      genres JSONB NOT NULL DEFAULT '[]'::jsonb,
      poster_url TEXT NOT NULL,
      video_url TEXT NOT NULL,
      license VARCHAR(128) NOT NULL,
      attribution TEXT NOT NULL,
      runtime INT NOT NULL,
      description TEXT NOT NULL,
      is_free BOOLEAN NOT NULL DEFAULT TRUE,
      accent_color VARCHAR(32),
      text_color VARCHAR(32),
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_films_is_free ON films(is_free);
  `;

  let count = 0;
  for (const film of FREE_FILMS) {
    await sql`
      INSERT INTO films (
        id, title, year, genre, genres, poster_url, video_url,
        license, attribution, runtime, description, is_free, accent_color, text_color
      ) VALUES (
        ${film.id},
        ${film.title},
        ${film.year},
        ${film.genre || film.genres[0] || "Classic"},
        ${JSON.stringify(film.genres)},
        ${film.posterUrl},
        ${film.videoUrl},
        ${film.license || "Public Domain"},
        ${film.attribution || ""},
        ${film.runtime},
        ${film.description},
        ${film.isFree !== false},
        ${film.accentColor || "#FF9F1C"},
        ${film.textColor || "#0E0B09"}
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        year = EXCLUDED.year,
        genre = EXCLUDED.genre,
        genres = EXCLUDED.genres,
        poster_url = EXCLUDED.poster_url,
        video_url = EXCLUDED.video_url,
        license = EXCLUDED.license,
        attribution = EXCLUDED.attribution,
        runtime = EXCLUDED.runtime,
        description = EXCLUDED.description,
        is_free = EXCLUDED.is_free,
        accent_color = EXCLUDED.accent_color,
        text_color = EXCLUDED.text_color;
    `;
    count++;
  }

  console.log(`[Seed] ✓ Idempotently seeded ${count} films into database.`);
  return count;
}

if (process.argv[1] && process.argv[1].endsWith("seedCatalogue.js")) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("[Seed] No DATABASE_URL provided. Skipping seed.");
    process.exit(0);
  }
  const sql = postgres(url, { max: 1 });
  seedCatalogue(sql)
    .then(async () => {
      await sql.end();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error("[Seed] Error seeding catalogue:", err);
      await sql.end();
      process.exit(1);
    });
}
