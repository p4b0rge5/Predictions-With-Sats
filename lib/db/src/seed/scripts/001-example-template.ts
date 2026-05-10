// ============================================================================
// Seed: 001 — Example Template
// ============================================================================
// This is a template seed. Delete this file and create new ones as needed.
//
// Naming convention: NNN-short-name.ts
//   001-first-seed.ts
//   002-another-seed.ts
//
// Each seed is idempotent by design — it checks if data already exists
// before inserting. The seed_migrations table tracks what ran.
// ============================================================================

import { registerSeed } from "../../seed";

registerSeed("001-example-template", async (_db) => {
  // Example: seed a reference table
  //
  // await db.execute(sql`
  //   INSERT INTO config_types (id, name, description) VALUES
  //     (1, 'bitcoin', 'Bitcoin price prediction markets'),
  //     (2, 'sports',  'Sports betting markets'),
  //     (3, 'weather', 'Weather prediction markets')
  //   ON CONFLICT (id) DO NOTHING
  // `);

  // This template seed is intentionally empty — remove this file when you
  // create real seeds.
});
