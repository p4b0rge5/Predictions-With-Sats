import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  timestamp,
} from "drizzle-orm/pg-core";

export const sportMarketsTable = pgTable("sport_markets", {
  id: serial("id").primaryKey(),
  eventId: text("event_id").notNull().unique(),
  eventName: text("event_name").notNull(),
  homeTeam: text("home_team").notNull(),
  awayTeam: text("away_team").notNull(),
  homeBadge: text("home_badge"),
  awayBadge: text("away_badge"),
  league: text("league").notNull(),
  sport: text("sport").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("open"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
  outcome: text("outcome"),
  totalHomeSats: bigint("total_home_sats", { mode: "number" }).notNull().default(0),
  totalDrawSats: bigint("total_draw_sats", { mode: "number" }).notNull().default(0),
  totalAwaySats: bigint("total_away_sats", { mode: "number" }).notNull().default(0),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SportMarket = typeof sportMarketsTable.$inferSelect;
