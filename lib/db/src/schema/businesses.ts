import { pgTable, serial, text, doublePrecision } from "drizzle-orm/pg-core";
export const businesses = pgTable("businesses", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  address: text("address").notNull(),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  phone: text("phone").notNull().default(""),
});
