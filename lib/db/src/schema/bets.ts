import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const betsTable = pgTable("bets", {
  id: serial("id").primaryKey(),
  windowId: integer("window_id").notNull(),
  direction: text("direction").notNull(),
  amountSats: integer("amount_sats").notNull(),
  paymentHash: text("payment_hash").notNull().unique(),
  paymentRequest: text("payment_request").notNull(),
  status: text("status").notNull().default("pending"),
  payoutSats: integer("payout_sats"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const insertBetSchema = createInsertSchema(betsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertBet = z.infer<typeof insertBetSchema>;
export type Bet = typeof betsTable.$inferSelect;
