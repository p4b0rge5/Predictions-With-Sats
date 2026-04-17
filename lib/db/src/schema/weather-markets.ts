import {
  pgTable,
  serial,
  text,
  numeric,
  bigint,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export interface WeatherOutcomeRecord {
  key: string;
  label: string;
  price: number | null;
  poolSats: number;
  isWinner: boolean | null;
  sourceMarketId?: string;
  sortOrder?: number;
}

export const weatherMarketsTable = pgTable("weather_markets", {
  id: serial("id").primaryKey(),
  city: text("city").notNull(),
  country: text("country").notNull(),
  latitude: numeric("latitude", { precision: 8, scale: 4 }).notNull(),
  longitude: numeric("longitude", { precision: 8, scale: 4 }).notNull(),
  date: text("date").notNull(),
  threshold: numeric("threshold", { precision: 5, scale: 1 }).notNull(),
  provider: text("provider").notNull().default("local"),
  externalMarketId: text("external_market_id").unique(),
  question: text("question"),
  subtitle: text("subtitle"),
  sourceUrl: text("source_url"),
  outcomes: jsonb("outcomes").$type<WeatherOutcomeRecord[]>().notNull().default([]),
  winningOutcome: text("winning_outcome"),
  resolvedValue: text("resolved_value"),
  status: text("status").notNull().default("open"),
  outcome: text("outcome"),
  actualTemp: numeric("actual_temp", { precision: 5, scale: 1 }),
  totalYesSats: bigint("total_yes_sats", { mode: "number" }).notNull().default(0),
  totalNoSats: bigint("total_no_sats", { mode: "number" }).notNull().default(0),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WeatherMarket = typeof weatherMarketsTable.$inferSelect;
