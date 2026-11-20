import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { donations } from "./donations";
import { recipients } from "./recipients";

export const donationEvents = pgTable("donation_events", {
  id: serial("id").primaryKey(),
  donationId: integer("donation_id").notNull().references(() => donations.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  description: text("description").notNull(),
  recipientId: integer("recipient_id").references(() => recipients.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("donation_events_timeline_idx").on(t.donationId, t.createdAt)]);
