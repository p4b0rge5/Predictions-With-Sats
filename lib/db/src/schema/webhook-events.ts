import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const webhookEventsTable = pgTable("webhook_events", {
  id: serial("id").primaryKey(),
  paymentHash: text("payment_hash").notNull(),
  payload: text("payload").notNull(),
  processed: boolean("processed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertWebhookEventSchema = createInsertSchema(
  webhookEventsTable,
).omit({ id: true, createdAt: true });

export type InsertWebhookEvent = z.infer<typeof insertWebhookEventSchema>;
export type WebhookEvent = typeof webhookEventsTable.$inferSelect;
