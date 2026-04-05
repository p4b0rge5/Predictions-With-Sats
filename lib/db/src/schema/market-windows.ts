import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketWindowsTable = pgTable("market_windows", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("open"),
  openPrice: numeric("open_price", { precision: 18, scale: 2 }),
  closePrice: numeric("close_price", { precision: 18, scale: 2 }),
  outcome: text("outcome"),
  totalUpSats: integer("total_up_sats").notNull().default(0),
  totalDownSats: integer("total_down_sats").notNull().default(0),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

export const insertMarketWindowSchema = createInsertSchema(
  marketWindowsTable,
).omit({ id: true });

export type InsertMarketWindow = z.infer<typeof insertMarketWindowSchema>;
export type MarketWindow = typeof marketWindowsTable.$inferSelect;
