import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const priceSnapshotsTable = pgTable("price_snapshots", {
  id: serial("id").primaryKey(),
  windowId: integer("window_id"),
  source: text("source").notNull(),
  priceUsd: numeric("price_usd", { precision: 18, scale: 2 }).notNull(),
  isClose: boolean("is_close").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPriceSnapshotSchema = createInsertSchema(
  priceSnapshotsTable,
).omit({ id: true, createdAt: true });

export type InsertPriceSnapshot = z.infer<typeof insertPriceSnapshotSchema>;
export type PriceSnapshot = typeof priceSnapshotsTable.$inferSelect;
