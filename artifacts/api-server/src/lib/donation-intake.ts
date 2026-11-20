import { pool } from "@workspace/db";
import { resolveDeadline, InputError } from "./food-time";
import { event, type Row } from "./donation-records";
import { matchRecipient, queueCall } from "./matching";

export async function createDonation(data: Row) {
  const deadline = resolveDeadline(data.pickup_deadline);
  const canonicalItems = (list: Row[]) => JSON.stringify(list.map(i => ({
    name: i.name, quantity: Number(i.quantity), unit: i.unit, est_pounds: Number(i.est_pounds),
  })));
  const items = JSON.parse(canonicalItems(data.items ?? []));
  const client = await pool.connect();
  let donation: Row, business: Row, recipient: Row | undefined;
  try {
    await client.query("BEGIN");
    // All lifecycle writers use the same lock order: matching lock, then row locks.
    await client.query("SELECT pg_advisory_xact_lock(817235)");
    const { rows: all } = await client.query("SELECT * FROM businesses ORDER BY id");
    const name = String(data.business_name ?? "").trim().toLowerCase();
    business = data.business_id ? all.find(b => b.id === data.business_id)
      : all.find(b => b.name.toLowerCase() === name) ??
        all.find(b => name && (b.name.toLowerCase().includes(name) || name.includes(b.name.toLowerCase()))) ?? all[0];
    if (!business) throw new InputError("business_id must identify an existing business.");
    if (data.idempotency_key) {
      const { rows: [previous] } = await client.query("SELECT * FROM donations WHERE idempotency_key=$1", [data.idempotency_key]);
      if (previous) {
        if (previous.business_id !== business.id || canonicalItems(previous.items) !== canonicalItems(items)
          || previous.category !== data.category || previous.allergens !== data.allergens
          || new Date(previous.pickup_deadline_at).getTime() !== deadline.getTime()
          || previous.is_demo !== !!data.is_demo) throw new InputError("idempotency_key was already used for a different donation. Start a new draft.", 409);
        const { rows: [r] } = await client.query("SELECT name FROM recipients WHERE id=$1", [previous.recipient_id]);
        await client.query("COMMIT");
        return { donation_id: previous.id, recipient_name: r?.name ?? null, distance_miles: previous.distance_miles,
          match_reason: previous.match_reason, message: "This donation was already received." };
      }
    }
    const { rows: [created] } = await client.query(`INSERT INTO donations
      (business_id,items_description,estimated_pounds,category,allergens,pickup_deadline,pickup_deadline_at,
       items,source,safety_confirmed,idempotency_key,is_demo)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [business.id, data.items_description, data.estimated_pounds, data.category.trim().toLowerCase(), data.allergens ?? "",
      data.pickup_deadline, deadline, JSON.stringify(items), data.source ?? "voice", !!data.safety_confirmed,
      data.idempotency_key ?? null, !!data.is_demo]);
    donation = created;
    await event(client, donation.id, "logged", data.is_demo
      ? data.source === "photo" ? "Sample-photo intake logged (demo)" : "Illustrative demo donation logged"
      : "Surplus donation logged");
    recipient = await matchRecipient(donation, business, client);
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
  queueCall(donation!, recipient, business!);
  return { donation_id: donation!.id, recipient_name: recipient?.name ?? null, distance_miles: recipient?.distance_miles ?? null,
    match_reason: recipient?.match_reason ?? null,
    message: recipient ? `Calling ${recipient.name} now…` : "No matching recipient is available before this deadline." };
}
