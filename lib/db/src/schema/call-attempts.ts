import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { donations } from "./donations";
import { recipients } from "./recipients";
export const callAttempts = pgTable("call_attempts", {
  id: serial("id").primaryKey(),
  donationId: integer("donation_id").notNull().references(() => donations.id),
  recipientId: integer("recipient_id").notNull().references(() => recipients.id),
  result: text("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
