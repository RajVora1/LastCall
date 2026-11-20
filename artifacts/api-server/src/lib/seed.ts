import { db, businesses, recipients, pool } from "@workspace/db";
import { logger } from "./logger";
import { pacificNow } from "./food-time";

export async function seedNetwork() {
  await db.insert(businesses).values([
    { name: "Sunrise Bakery", address: "2000 University Ave, Berkeley, CA", lat: 37.8721, lng: -122.2705 },
    { name: "Golden Wok", address: "2320 Shattuck Ave, Berkeley, CA", lat: 37.8664, lng: -122.2677 },
    { name: "Telegraph Bagels", address: "2500 Telegraph Ave, Berkeley, CA", lat: 37.864, lng: -122.2585 },
  ]).onConflictDoNothing();
  const phone = "";
  const locations = [
    { name: "UC Berkeley Basic Needs Food Pantry", type: "pantry", address: "2495 Bancroft Way, Berkeley, CA", lat: 37.8692, lng: -122.2595, accepts: ["bakery", "produce", "prepared"], openUntil: "20:00" },
    { name: "Berkeley Food Network", type: "pantry", address: "1925 Ninth St, Berkeley, CA", lat: 37.8694, lng: -122.2942, accepts: ["bakery", "produce", "prepared"], openUntil: "19:00" },
    { name: "Dorothy Day House", type: "shelter", address: "1931 Center St, Berkeley, CA", lat: 37.8698, lng: -122.2722, accepts: ["bakery", "produce", "prepared"], openUntil: "23:00" },
    { name: "Berkeley Student Food Collective", type: "student_club", address: "2440 Bancroft Way, Berkeley, CA", lat: 37.8685, lng: -122.2601, accepts: ["bakery", "produce"], openUntil: "21:00" },
    { name: "Alameda County Community Food Bank", type: "pantry", address: "7900 Edgewater Dr, Oakland, CA", lat: 37.7424, lng: -122.2003, accepts: ["bakery", "produce"], openUntil: "18:00" },
    { name: "St. Vincent de Paul Community Center", type: "shelter", address: "2272 San Pablo Ave, Oakland, CA", lat: 37.8144, lng: -122.2767, accepts: ["bakery", "produce", "prepared"], openUntil: "22:00" },
    { name: "Berkeley Community Night Kitchen (demo)", type: "outreach", address: "2100 Martin Luther King Jr Way, Berkeley, CA", lat: 37.8704, lng: -122.2731, accepts: ["bakery", "produce", "prepared", "packaged", "dairy"], openUntil: "08:00" },
  ];
  for (const location of locations) {
    await db.insert(recipients).values({ ...location, phone }).onConflictDoNothing();
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(817235)");
    const { rows: current } = await client.query("SELECT * FROM recipients ORDER BY id");
    const firstUpgrade = current.every(r => !r.needs_initialized);
    const needSets = [["bread", "fruit"], ["bread", "vegetables"], ["protein", "meals"],
      ["bread", "packaged"], ["produce", "packaged"], ["protein", "vegetables"], ["meals", "protein"]];
    for (const [i, r] of current.entries()) {
      if (r.needs_initialized) continue; // Never overwrite volunteer edits on restart.
      const night = r.name.includes("Night Kitchen");
      await client.query(`UPDATE recipients SET current_needs=$1,capacity_lbs=$2,has_refrigeration=$3,
        open_from=$4,needs_initialized=true,accepts=$5 WHERE id=$6`,
      [needSets[i % needSets.length], night ? 180 : 300 + i * 40, !r.name.includes("Student"),
        night ? "18:00" : "08:00", r.name.includes("Student") ? ["bakery", "produce", "packaged"] : [...new Set([...r.accepts, "packaged", "dairy"])], r.id]);
    }
    // Once per network initialization; reset preserves recipient flags so history
    // does not reappear after a later restart. Existing donations are untouched.
    if (firstUpgrade) {
      const { rows: shops } = await client.query("SELECT * FROM businesses ORDER BY id");
      for (const [bIndex, b] of shops.entries()) {
        for (let day = 0; day < 8 - bIndex; day++) {
          const created = pacificNow().minus({ days: day, minutes: 40 });
          const pounds = 8 + (day * 3 + bIndex * 7) % 18;
          const category = b.name === "Golden Wok" ? "prepared" : "bakery";
          const item = category === "prepared" ? "Tofu, vegetable rice and greens" : b.name === "Telegraph Bagels" ? "Bagels and sourdough rounds" : "Sourdough loaves and croissants";
          const r = current.find(r => r.name === (category === "prepared" ? "Dorothy Day House" : "Berkeley Food Network"))!;
          const picked = day % 3 !== 0;
          const { rows: [d] } = await client.query(`INSERT INTO donations
            (business_id,items_description,estimated_pounds,category,allergens,pickup_deadline,pickup_deadline_at,status,
             recipient_id,is_demo,items,source,created_at,updated_at,matched_at,confirmed_at,picked_up_at,match_reason,idempotency_key)
            VALUES($1,$2,$3,$4,$5,'Illustrative historical pickup',$6,$7,$8,true,$9,'seed',$10,$11,$12,$13,$14,
              'Illustrative demo history — not a live matching decision',$15) RETURNING id`,
          [b.id, item, pounds, category, category === "prepared" ? "soy" : "wheat, milk", created.plus({ minutes: 45 }).toJSDate(),
            picked ? "picked_up" : "confirmed", r.id, JSON.stringify([{ name: item, quantity: 1, unit: "batch", est_pounds: pounds }]),
            created.toJSDate(), created.plus({ minutes: 20 }).toJSDate(), created.plus({ minutes: 1 }).toJSDate(),
            created.plus({ minutes: 5 }).toJSDate(), picked ? created.plus({ minutes: 20 }).toJSDate() : null,
            `seed:history:${b.id}:${day}`]);
          for (const [type, minutes] of [["logged", 0], ["matched", 1], ["calling", 2], ["confirmed", 5], ...(picked ? [["picked_up", 20]] : [])] as [string, number][]) {
            await client.query("INSERT INTO donation_events(donation_id,type,description,recipient_id,created_at) VALUES($1,$2,$3,$4,$5)",
              [d.id, type, "Illustrative demo history", r.id, created.plus({ minutes }).toJSDate()]);
          }
        }
      }
    }
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
  logger.info("Berkeley demonstration network ready; recipient eligibility and hours are illustrative");
}
