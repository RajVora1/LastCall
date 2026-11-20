import { pgTable, serial, text, doublePrecision, time, boolean } from "drizzle-orm/pg-core";
export const recipients = pgTable("recipients", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  type: text("type").notNull(),
  address: text("address").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  phone: text("phone").notNull().default(""),
  accepts: text("accepts").array().notNull(),
  openUntil: time("open_until").notNull(),
  openFrom: time("open_from").notNull().default("08:00"),
  capacityLbs: doublePrecision("capacity_lbs").notNull().default(250),
  currentNeeds: text("current_needs").array().notNull().default([]),
  hasRefrigeration: boolean("has_refrigeration").notNull().default(true),
  needsInitialized: boolean("needs_initialized").notNull().default(false),
});
