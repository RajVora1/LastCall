// All data/policy changes below are rolled back. Existing volunteer edits survive.
// pnpm --filter @workspace/scripts exec tsx src/matching-regression.mjs
import assert from "node:assert/strict";
import { pool } from "../../lib/db/src/index.ts";
import { matchRecipient } from "../../artifacts/api-server/src/lib/matching.ts";
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(817235)");
  const { rows: [business] } = await client.query("SELECT * FROM businesses ORDER BY id LIMIT 1");
  await client.query("UPDATE recipients SET accepts='{}'"); // Transaction-local isolation of test candidates.
  const add = async (name, lng, needs) => (await client.query(`INSERT INTO recipients
    (name,type,address,lat,lng,accepts,open_from,open_until,capacity_lbs,current_needs,has_refrigeration,needs_initialized)
    VALUES($1,'demo','Regression fixture',$2,$3,ARRAY['bakery','prepared','dairy'],'00:00','00:00',100,$4,true,true) RETURNING *`,
  [name, business.lat, lng, needs])).rows[0];
  const a = await add(`Regression nearby ${Date.now()}`, business.lng, []);
  const b = await add(`Regression needs ${Date.now()}`, business.lng + 0.005, ["bread"]);
  let donation = (await client.query(`INSERT INTO donations(business_id,items_description,estimated_pounds,category,pickup_deadline,pickup_deadline_at,is_demo)
    VALUES($1,'Sourdough bread',5,'bakery','Within 45 minutes',now()+interval '45 minutes',true) RETURNING *`, [business.id])).rows[0];
  let match = await matchRecipient(donation, business, client);
  assert.equal(match.id, b.id, "Needs bonus should justify a small extra distance.");
  await client.query("UPDATE recipients SET current_needs='{}' WHERE id=$1", [b.id]);
  match = await matchRecipient(donation, business, client);
  assert.equal(match.id, a.id, "Without a needs bonus, nearest compatible candidate should win.");
  await client.query("UPDATE recipients SET capacity_lbs=4 WHERE id=$1", [a.id]);
  match = await matchRecipient(donation, business, client);
  assert.equal(match.id, b.id, "Insufficient remaining capacity must exclude a candidate.");
  const { rows: [reservation] } = await client.query(`INSERT INTO donations
    (business_id,items_description,estimated_pounds,category,pickup_deadline,pickup_deadline_at,is_demo,recipient_id,status)
    VALUES($1,'Reserved capacity',99,'bakery','Within 45 minutes',now()+interval '45 minutes',true,$2,'calling') RETURNING id`, [business.id, b.id]);
  assert.equal(await matchRecipient(donation, business, client), undefined, "Calling donations must reserve capacity.");
  await client.query("UPDATE donations SET status='no_match' WHERE id=$1", [reservation.id]);
  assert.equal((await matchRecipient(donation, business, client)).id, b.id, "Released capacity becomes available.");
  donation.category = "prepared"; donation.items_description = "Chicken protein meal";
  await client.query("UPDATE recipients SET has_refrigeration=false");
  assert.equal(await matchRecipient(donation, business, client), undefined, "Prepared food requires refrigeration.");
  await client.query("UPDATE recipients SET has_refrigeration=true WHERE id=$1", [b.id]);
  assert.equal((await matchRecipient(donation, business, client)).id, b.id);
  await client.query("INSERT INTO call_attempts(donation_id,recipient_id,result) VALUES($1,$2,'declined')", [donation.id, b.id]);
  assert.equal(await matchRecipient(donation, business, client), undefined, "A declined recipient cannot be retried.");
  console.log("PASS: needs-vs-distance scoring, capacity rejection and reservation release, prepared-food refrigeration, and declined-recipient exclusion (all fixture changes rolled back).");
} finally {
  await client.query("ROLLBACK");
  client.release();
  await pool.end();
}
