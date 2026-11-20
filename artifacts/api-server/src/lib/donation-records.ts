import { pool } from "@workspace/db";
import { CO2E_KG_PER_KG_FOOD } from "./matching";

export type Queryable = Pick<typeof pool, "query">;
export type Row = Record<string, any>;
export const SAVED_STATUSES = ["confirmed", "picked_up"];
// Illustrative USD retail estimates, not appraisals or deductible amounts.
export const RETAIL_PER_LB: Record<string, number> = { bakery: 4, produce: 2, prepared: 7, packaged: 3, dairy: 3.5 };

export async function event(client: Queryable, id: number, type: string, description: string, recipientId: number | null = null) {
  await client.query("INSERT INTO donation_events(donation_id,type,description,recipient_id) VALUES($1,$2,$3,$4)",
    [id, type, description, recipientId]);
}

export const donationSelect = `SELECT d.*,d.estimated_pounds::float8,b.name AS business_name,b.address AS business_address,
  b.lat AS business_lat,b.lng AS business_lng,r.name AS recipient_name,r.lat AS recipient_lat,r.lng AS recipient_lng
  FROM donations d JOIN businesses b ON d.business_id=b.id LEFT JOIN recipients r ON d.recipient_id=r.id`;

export function serializeDonation(row: Row) {
  const result = { ...row };
  for (const key of ["created_at", "updated_at", "matched_at", "confirmed_at", "picked_up_at", "pickup_deadline_at"])
    if (result[key] instanceof Date) result[key] = result[key].toISOString();
  // Keys and safety acknowledgments are internal, not part of public read models.
  delete result.idempotency_key;
  delete result.safety_confirmed;
  return result;
}

export function receipt(row: Row) {
  const pounds = Number(row.estimated_pounds);
  const price = RETAIL_PER_LB[row.category] ?? 3;
  return { value_usd: Math.round(pounds * price * 100) / 100, price_per_lb: price,
    co2e_kg: pounds * 0.4536 * CO2E_KG_PER_KG_FOOD, meals: pounds / 1.2 };
}

export async function recipientsWithCapacity(client: Queryable = pool, day?: string) {
  const { rows } = await client.query(`SELECT r.*,
    greatest(0,r.capacity_lbs-coalesce(used.lbs,0))::float8 AS capacity_left_lbs
    FROM recipients r LEFT JOIN LATERAL (
      SELECT sum(d.estimated_pounds) AS lbs FROM donations d
      WHERE d.recipient_id=r.id AND d.status IN ('calling','confirmed','picked_up')
      AND (coalesce(d.pickup_deadline_at,d.created_at) AT TIME ZONE 'America/Los_Angeles')::date =
        coalesce($1::date,(now() AT TIME ZONE 'America/Los_Angeles')::date)
    ) used ON true ORDER BY r.id`, [day ?? null]);
  return rows as Row[];
}
