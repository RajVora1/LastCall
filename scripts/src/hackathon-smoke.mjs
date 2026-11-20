// Development regression fixtures only. Never resets/deletes existing records.
// node scripts/src/hackathon-smoke.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = "http://localhost:80/api";
const key = process.env.WEBHOOK_SECRET;
assert.ok(key, "Webhook secret is required but will never be logged.");
async function request(path, data, options = {}) {
  const r = await fetch(base + path, { method: options.method || (data ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(options.auth ? { "x-api-key": key } : {}) }, body: data ? JSON.stringify(data) : undefined });
  return { status: r.status, body: await r.json() };
}
const businesses = (await request("/businesses")).body;
const payload = { business_id: businesses[0].id, category: "bakery", allergens: "wheat; milk",
  pickup_deadline: new Date(Date.now() + 45 * 60000).toISOString(), safety_confirmed: true, is_sample: true,
  idempotency_key: randomUUID(), items: [{ name: "Smoke test loaves", quantity: 2, unit: "loaves", est_pounds: 3 },
    { name: "Blocked test item", quantity: 1, unit: "tray", est_pounds: 20, unsafe: true }] };
assert.equal((await request("/donations/intake", { ...payload, safety_confirmed: false })).status, 400);
assert.equal((await request("/donations/intake", { ...payload, items: [payload.items[1]] })).status, 400);
assert.equal((await request("/donations/intake", { ...payload, pickup_deadline: new Date(Date.now() - 60000).toISOString() })).status, 400);
const created = await request("/donations/intake", payload);
assert.equal(created.status, 200, JSON.stringify(created.body));
const id = created.body.donation_id;
const duplicate = await Promise.all([request("/donations/intake", payload), request("/donations/intake", payload)]);
for (const r of duplicate) { assert.equal(r.status, 200); assert.equal(r.body.donation_id, id); }
assert.equal((await request("/donations/intake", { ...payload, allergens: "different" })).status, 409);
let d = (await request(`/donations/${id}`)).body;
assert.equal(d.status, "calling");
assert.equal(d.items.length, 1);
assert.equal(d.estimated_pounds, 3);
assert.ok(d.match_reason.includes("capacity left"));
assert.deepEqual(d.events.map(e => e.type), ["logged", "matched", "calling"]);
assert.equal((await request(`/donations/${id}/picked-up`, {})).status, 409);
const original = d.recipient_id;
assert.equal((await request("/pantry/decline", { donation_id: String(id), recipient_id: original })).status, 200);
d = (await request(`/donations/${id}`)).body;
assert.equal(d.status, "calling");
assert.notEqual(d.recipient_id, original);
assert.ok(d.events.some(e => e.type === "declined"));
const confirm = await request("/confirm_pickup", { donation_id: String(id), accepted: "true", notes: "", pickup_eta: "7:30pm" }, { auth: true });
assert.equal(confirm.status, 200);
const before = (await request("/stats")).body.pounds_saved;
assert.equal((await request(`/donations/${id}/picked-up`, { recipient_id: original })).status, 409);
assert.equal((await request(`/donations/${id}/picked-up`, { recipient_id: d.recipient_id })).status, 200);
assert.equal((await request(`/donations/${id}/picked-up`, { recipient_id: d.recipient_id })).status, 200);
d = (await request(`/donations/${id}`)).body;
assert.equal(d.status, "picked_up"); assert.ok(d.picked_up_at);
assert.equal(d.events.filter(e => e.type === "picked_up").length, 1);
assert.equal((await request("/stats")).body.pounds_saved, before);
assert.equal(d.receipt.value_usd, 12); assert.equal(d.receipt.price_per_lb, 4);
const recipients = (await request("/recipients")).body;
assert.ok(recipients.every(r => r.capacity_left_lbs >= 0 && typeof r.has_refrigeration === "boolean"));
const r = recipients.find(r => r.id === d.recipient_id);
// Saving unchanged needs tests persistence without overwriting user preferences.
assert.equal((await request(`/recipients/${r.id}/needs`, { current_needs: r.current_needs }, { method: "PATCH" })).status, 200);
const leader = (await request("/leaderboard")).body;
assert.ok(leader.length >= 3 && leader.every((b, i) => !i || leader[i - 1].weekly_pounds >= b.weekly_pounds));
const impact = (await request("/businesses")).body.find(b => b.id === payload.business_id);
assert.ok(impact.monthly_pounds >= 3 && impact.monthly_meals > 0 && impact.monthly_co2e_kg > 0 && impact.streak_days >= 0);
const total = (await request("/stats")).body.donations_count;
assert.equal((await request("/demo/reset", {})).status, 401);
assert.equal((await request("/stats")).body.donations_count, total);
console.log("PASS: safety and past-deadline rejection; unsafe-item exclusion; concurrent idempotency; scored matching; decline/reroute; string webhook confirmation; picked-up timestamp/idempotency; unchanged impact; timeline, receipt, needs and leaderboard. Existing data was not reset.");
