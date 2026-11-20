import { pool } from "@workspace/db";
import { matchRecipient, queueCall } from "./matching";
import { event } from "./donation-records";

type PickupInput = {
  donation_id: number | string;
  accepted: boolean;
  pickup_eta?: string;
  notes?: string;
  recipient_id?: number;
};

/** Shared by the authenticated ElevenLabs callback and the public demo decline UI. */
export async function updatePickup(data: PickupInput): Promise<{ status: number; body: { ok: true } | { error: string } }> {
  const client = await pool.connect();
  let donation, business, recipient;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(817235)");
    const { rows: [found] } = await client.query("SELECT * FROM donations WHERE id=$1 FOR UPDATE", [data.donation_id]);
    if (!found) {
      await client.query("ROLLBACK");
      return { status: 404, body: { error: "Donation not found" } };
    }
    donation = found;
    if (found.status !== "calling") {
      await client.query("COMMIT");
      return { status: 200, body: { ok: true } };
    }
    if (data.recipient_id !== undefined && data.recipient_id !== found.recipient_id) {
      await client.query("ROLLBACK");
      return { status: 409, body: { error: "This donation has already moved to another recipient. Refresh the volunteer line." } };
    }
    await client.query("INSERT INTO call_attempts(donation_id,recipient_id,result) VALUES($1,$2,$3)",
      [found.id, found.recipient_id, data.accepted ? "accepted" : "declined"]);
    if (data.accepted) {
      await client.query("UPDATE donations SET status='confirmed',confirmed_at=now(),pickup_eta=$1,notes=$2,updated_at=now() WHERE id=$3",
        [data.pickup_eta ?? "", data.notes ?? "", found.id]);
      await event(client, found.id, "confirmed", `Pickup accepted${data.pickup_eta ? ` · ETA ${data.pickup_eta}` : ""}`, found.recipient_id);
    } else {
      await event(client, found.id, "declined", data.notes ? `Declined · ${data.notes}` : "Volunteer declined; looking for another recipient", found.recipient_id);
      await client.query("UPDATE donations SET notes=$1 WHERE id=$2", [data.notes ?? "", found.id]);
      const { rows: [b] } = await client.query("SELECT * FROM businesses WHERE id=$1", [found.business_id]);
      business = b;
      recipient = await matchRecipient(found, b, client);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  if (recipient && business) queueCall(donation, recipient, business);
  return { status: 200, body: { ok: true } };
}
