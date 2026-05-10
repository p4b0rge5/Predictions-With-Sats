import { sql, eq } from "drizzle-orm";
import { db, pool } from "./db";
import { seedMigrations } from "./schema/seed-migrations";

/**
 * Seed migration tracking table.
 *
 * This table records which seed scripts have been applied so that each seed
 * runs at most once. Created by Drizzle schema (seed-migrations.ts).
 */
export interface SeedRecord {
  name: string;
  applied_at: Date;
}

/**
 * No-op — table is created by Drizzle push automatically.
 */
export async function ensureSeedTable(): Promise<void> {
  // Table is part of the Drizzle schema. No action needed.
}

/**
 * Check whether a named seed has already been applied.
 */
export async function seedApplied(name: string): Promise<boolean> {
  const result = await db.select({ count: sql`COUNT(*)` })
    .from(seedMigrations)
    .where(eq(seedMigrations.name, name));
  return Number(result[0]?.count ?? 0) > 0;
}

/**
 * Record that a named seed has been applied.
 */
export async function markSeedApplied(name: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO seed_migrations (name, applied_at)
    VALUES (${name}, NOW())
    ON CONFLICT (name) DO NOTHING
  `);
}

/**
 * Run all registered seed functions. Each seed runs at most once — if its
 * name has already been recorded in seed_migrations, it is skipped.
 *
 * This function is designed to be called from the API server bootstrap.
 */
export async function runAllSeeds(): Promise<void> {
  await ensureSeedTable();

  const seeds = getRegisteredSeeds();
  let ran = 0;

  for (const { name, fn } of seeds) {
    if (await seedApplied(name)) {
      continue;
    }

    // Wrap each seed in its own transaction so one failure doesn't rollback others
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await fn(db);
      await markSeedApplied(name);
      await client.query("COMMIT");
      console.log(`[seed] ✅ ${name}`);
      ran++;
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`[seed] ❌ ${name}:`, err);
    } finally {
      client.release();
    }
  }

  if (ran > 0) {
    console.log(`[seed] Applied ${ran} seed(s)`);
  } else {
    console.log(`[seed] All seeds already applied (${seeds.length} registered)`);
  }
}

// ============================================================================
// Seed registry — add new seeds here
// ============================================================================

type SeedFn = (database: typeof db) => Promise<void>;

interface RegisteredSeed {
  name: string;
  fn: SeedFn;
}

const SEEDS: RegisteredSeed[] = [];

/**
 * Register a seed function. Called from lib/db/src/seed/scripts/*.ts files
 * which are imported by the registry at the bottom of this file.
 */
export function registerSeed(name: string, fn: SeedFn): void {
  SEEDS.push({ name, fn });
}

function getRegisteredSeeds(): RegisteredSeed[] {
  return SEEDS;
}

// Import all seed scripts to register them
// Each file in seed/scripts/ calls registerSeed() on import
import "./seed/scripts";
