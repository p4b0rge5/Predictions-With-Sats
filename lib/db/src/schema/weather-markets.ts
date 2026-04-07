import {
  pgTable,
  serial,
  text,
  numeric,
  bigint,
  timestamp,
} from "drizzle-orm/pg-core";

export const weatherMarketsTable = pgTable("weather_markets", {
  id: serial("id").primaryKey(),
  city: text("city").notNull(),
  country: text("country").notNull(),
  latitude: numeric("latitude", { precision: 8, scale: 4 }).notNull(),
  longitude: numeric("longitude", { precision: 8, scale: 4 }).notNull(),
  date: text("date").notNull(),
  threshold: numeric("threshold", { precision: 5, scale: 1 }).notNull(),
  status: text("status").notNull().default("open"),
  outcome: text("outcome"),
  actualTemp: numeric("actual_temp", { precision: 5, scale: 1 }),
  totalYesSats: bigint("total_yes_sats", { mode: "number" }).notNull().default(0),
  totalNoSats: bigint("total_no_sats", { mode: "number" }).notNull().default(0),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WeatherMarket = typeof weatherMarketsTable.$inferSelect;
