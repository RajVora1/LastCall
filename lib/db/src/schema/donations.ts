import { pgTable, serial, text, integer, numeric, timestamp, boolean, index, uniqueIndex, jsonb, doublePrecision } from "drizzle-orm/pg-core";
import { businesses } from "./businesses";
import { recipients } from "./recipients";
export const donations = pgTable("donations", {
  id: serial("id").primaryKey(),
  businessId: integer("business_id").notNull().references(() => businesses.id),
  itemsDescription: text("items_description").notNull(),
  estimatedPounds: numeric("estimated_pounds").notNull(),
  category: text("category").notNull(),
  allergens: text("allergens"),
  pickupDeadline: text("pickup_deadline").notNull(),
  status: text("status", { enum: ["pending", "calling", "confirmed", "picked_up", "declined", "no_match"] }).notNull().default("pending"),
  recipientId: integer("recipient_id").references(() => recipients.id),
  pickupEta: text("pickup_eta"),
  notes: text("notes"),
  isDemo: boolean("is_demo").notNull().default(false),
  items: jsonb("items").notNull().default([]),
  source: text("source").notNull().default("voice"),
  safetyConfirmed: boolean("safety_confirmed").notNull().default(false),
  pickupDeadlineAt: timestamp("pickup_deadline_at", { withTimezone: true }),
  matchReason: text("match_reason"),
  distanceMiles: doublePrecision("distance_miles"),
  matchedAt: timestamp("matched_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("donations_created_idx").on(table.createdAt), uniqueIndex("donations_idempotency_key_idx").on(table.idempotencyKey)]);
