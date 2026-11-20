// Development-only API regression check. Creates demo donations, never resets existing data.
// Run: node scripts/src/browser-voice-smoke.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const base = "http://localhost:80/api";
function curl(path, body, key) {
  // Supply sensitive headers over stdin so they are not printed or placed in argv.
  const config = key ? `header = ${JSON.stringify(`x-api-key: ${key}`)}\n` : "";
  const args = ["--config", "-", "--silent", "--show-error", "--max-time", "20", "--write-out", "\n%{http_code}", base + path];
  if (body !== undefined) args.push("--header", "Content-Type: application/json", "--data", JSON.stringify(body));
  const response = spawnSync("curl", args, { input: config, encoding: "utf8" });
  assert.equal(response.status, 0, "curl failed");
  const split = response.stdout.lastIndexOf("\n");
  return { status: Number(response.stdout.slice(split + 1)), body: JSON.parse(response.stdout.slice(0, split)) };
}
function donation(id) {
  const response = curl("/donations");
  assert.equal(response.status, 200);
  return response.body.find(d => d.id === id);
}
const simulated = curl("/demo/simulate", {});
assert.equal(simulated.status, 200, "Wait five seconds after any earlier simulation before running");
const id = simulated.body.donation_id;
const initial = donation(id);
assert.equal(initial.status, "calling");
await delay(6200);
assert.equal(donation(id).status, "calling", "Simulation must NOT auto-confirm after five seconds");
console.log("PASS: simulation stays calling beyond the old auto-confirm window");

const seen = new Set();
const recipientCount = curl("/network").body.recipients.length;
let current = donation(id);
while (current.status === "calling") {
  assert.ok(!seen.has(current.recipient_id), "A declined recipient must never be selected again");
  const previous = current.recipient_id;
  seen.add(previous);
  const declined = curl("/pantry/decline", { donation_id: String(id), recipient_id: previous });
  assert.equal(declined.status, 200);
  assert.deepEqual(declined.body, { ok: true });
  current = donation(id);
  if (current.status === "calling") {
    assert.notEqual(current.recipient_id, previous);
    const stale = curl("/pantry/decline", { donation_id: id, recipient_id: previous });
    assert.equal(stale.status, 409, "A stale volunteer screen must not skip another recipient");
  }
  assert.ok(seen.size <= recipientCount);
}
assert.equal(current.status, "no_match");
console.log(`PASS: public decline reroutes without a secret, rejects stale requests, and exhausts ${seen.size} eligible recipients`);

const key = process.env.WEBHOOK_SECRET;
assert.ok(key, "WEBHOOK_SECRET required for callback regression check");
const second = curl("/demo/simulate", {});
assert.equal(second.status, 200);
const confirmed = curl("/confirm_pickup", { donation_id: String(second.body.donation_id), accepted: "true", pickup_eta: "7:30pm", notes: "" }, key);
assert.equal(confirmed.status, 200);
assert.equal(donation(second.body.donation_id).status, "confirmed");
console.log("PASS: authenticated agent callback still accepts string IDs / boolean strings and confirms a browser demo");

for (const body of [{ donation_id: "" }, { donation_id: null }, { donation_id: "1.5" }, { donation_id: "nope" }]) {
  assert.equal(curl("/pantry/decline", body).status, 400);
}
const before = curl("/stats").body.donations_count;
assert.equal(curl("/demo/reset", {}).status, 401);
assert.equal(curl("/demo/reset", {}, "invalid-test-key").status, 401);
assert.equal(curl("/stats").body.donations_count, before);
console.log("PASS: invalid decline inputs rejected; reset requires the key and unauthorized attempts preserve all donations");
const network = curl("/network");
assert.equal(network.body.calling_mode, "browser");
assert.equal(network.body.calls_configured, true);
console.log("All browser-voice API smoke checks passed. Existing donations were not reset.");
