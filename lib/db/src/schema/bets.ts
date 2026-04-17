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
  /** LUD-21 verify URL for polling payment status (optional) */
  verifyUrl: text("verify_url"),
  status: text("status").notNull().default("pending"),
  payoutSats: integer("payout_sats"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  /**
   * LNURL-Withdraw token for winner payout.
   * Generated when a bet is marked "won".
   * Acts as both the URL token and the LUD-03 k1 parameter.
   */
  withdrawToken: text("withdraw_token").unique(),
  /** "unclaimed" | "claimed" — only present when status="won" */
  withdrawStatus: text("withdraw_status"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
});

export const insertBetSchema = createInsertSchema(betsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertBet = z.infer<typeof insertBetSchema>;
export type Bet = typeof betsTable.$inferSelect;
