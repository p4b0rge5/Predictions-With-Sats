import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Internal table used by the seed system to track which seed scripts
 * have been applied. Managed by lib/db/src/seed.ts — do not modify.
 */
export const seedMigrations = pgTable("seed_migrations", {
  name: text("name").primaryKey().notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});
