import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";

export const weatherBetsTable = pgTable("weather_bets", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").notNull(),
  direction: text("direction").notNull(),
  outcomeLabel: text("outcome_label"),
  amountSats: integer("amount_sats").notNull(),
  paymentHash: text("payment_hash").notNull().unique(),
  paymentRequest: text("payment_request").notNull(),
  verifyUrl: text("verify_url"),
  status: text("status").notNull().default("pending"),
  payoutSats: integer("payout_sats"),
  withdrawToken: text("withdraw_token").unique(),
  withdrawStatus: text("withdraw_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
});

export type WeatherBet = typeof weatherBetsTable.$inferSelect;
