import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";

export interface SportPolyOutcomeRecord {
  key: string;
  label: string;
  price: number | null;
  poolSats: number;
  isWinner: boolean | null;
  sourceMarketId?: string;
  sortOrder?: number;
}

export const sportPolyMarketsTable = pgTable("sport_poly_markets", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("polymarket"),
  externalMarketId: text("external_market_id").notNull().unique(),
  eventName: text("event_name").notNull(),
  homeTeam: text("home_team"),
  awayTeam: text("away_team"),
  homeTeamId: text("home_team_id"),
  awayTeamId: text("away_team_id"),
  league: text("league").notNull().default("Polymarket Sports"),
  sport: text("sport").notNull().default("Sports"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  question: text("question").notNull(),
  subtitle: text("subtitle"),
  sourceUrl: text("source_url"),
  outcomes: jsonb("outcomes").$type<SportPolyOutcomeRecord[]>().notNull().default([]),
  winningOutcome: text("winning_outcome"),
  resolvedValue: text("resolved_value"),
  status: text("status").notNull().default("open"),
  settledAt: timestamp("settled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  homeBadgeUrl: text("home_badge_url"),
  awayBadgeUrl: text("away_badge_url"),
  leagueLogoUrl: text("league_logo_url"),
  enrichedAt: timestamp("enriched_at", { withTimezone: true }),
});

export type SportPolyMarket = typeof sportPolyMarketsTable.$inferSelect;
