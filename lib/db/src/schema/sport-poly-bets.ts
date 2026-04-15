import {
  pgTable,
  serial,
  text,
  bigint,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const sportPolyBetsTable = pgTable("sport_poly_bets", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").notNull(),
  direction: text("direction").notNull(),
  outcomeLabel: text("outcome_label"),
  amountSats: bigint("amount_sats", { mode: "number" }).notNull(),
  paymentHash: text("payment_hash").notNull().unique(),
  paymentRequest: text("payment_request").notNull(),
  verifyUrl: text("verify_url"),
  status: text("status").notNull().default("pending"),
  payoutSats: bigint("payout_sats", { mode: "number" }),
  withdrawToken: text("withdraw_token").unique(),
  withdrawStatus: text("withdraw_status"),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export type SportPolyBet = typeof sportPolyBetsTable.$inferSelect;
