# LastCall

LastCall connects closing-time food surplus from Berkeley businesses with nearby community recipients.

## Product requirements

- Plain HTML/CSS/JavaScript frontend, not React. Vite is build tooling only.
- Express API and Replit PostgreSQL persistence.
- Leaflet with OpenStreetMap tiles; poll donations and impact every two seconds.
- Twilio and telephone numbers are retired entirely. Use public ElevenLabs browser voice agents; never embed provider keys or `WEBHOOK_SECRET` in shipped JavaScript.
- Seed businesses and recipient locations are illustrative demo data, not verified partnerships, acceptance policies, or operating hours.
- Demo simulations are labeled and stay `calling` until a volunteer or agent responds; no automatic confirmations. Their confirmed impact is included in totals.

## Run

- API: `pnpm --filter @workspace/api-server run dev`
- Frontend: `pnpm --filter @workspace/lastcall run dev`
- Database schema (development): `pnpm --filter @workspace/db run push`
- API contracts: `lib/api-spec/openapi.yaml`; regenerate with `pnpm --filter @workspace/api-spec run codegen`.
- Run services using their managed workflows; `PORT` and `BASE_PATH` are injected.
- Publish applies development database schema changes to production. No startup DDL.

## Browser voice setup

- `/business` starts the public business agent through the bundled `@elevenlabs/client` SDK.
- `/pantry` is the mobile-first Berkeley Food Network volunteer demo line. Tap to go on duty to unlock ringtone audio, then keep this tab open and foregrounded.
- Both browser sessions require HTTPS/localhost and microphone permission. Agent IDs are public identifiers, not credentials.
- Business agent: `agent_1301m7xama1dewkt14pz2cmz2av7`.
- Pantry agent: `agent_9001m7xbmxa4ep6sjtp928cw85tb`.
- Configure the business agent's server tool to call `POST /api/log_surplus`, and the pantry agent's tool to call `POST /api/confirm_pickup`.
- Those tools retain the server-only `x-api-key` / `WEBHOOK_SECRET` protection. Use the published HTTPS origin, not a private development URL, for agent server tools.
- Public agents must allow the published domain in ElevenLabs if an origin allowlist is enabled, and the ElevenLabs account must have available conversation usage.
- No ElevenLabs API key, imported phone number, Twilio account, or public phone number is needed for browser voice.
- Legacy phone variables, if present, are ignored; no code dials telephone numbers.
- `/api/pantry/decline` is intentionally public for this demo and shares the authenticated callback's row-locked rerouting logic. The optional recipient ID prevents stale double-declines.
- `/api/demo/reset` requires the webhook key and deletes ALL donations and call attempts, preserving network locations and ID sequences. The dashboard asks for confirmation and a transient key; it must not store the key.

## Data and calculations

Schemas: `lib/db/src/schema/`. Network seed: `artifacts/api-server/src/lib/seed.ts`.
Matching filters category, available opening window, remaining nightly capacity and refrigeration for prepared/dairy, then scores distance, needs fit and spare capacity. Declined recipients are excluded. All lifecycle writers acquire the same advisory transaction lock before row locks, so calling donations reserve capacity without oversubscription.
Business names use case-insensitive exact/partial matching, defaulting to the first business.
Confirmed and picked-up donations count once: pounds / 1.2 estimates meals. CO2e = pounds × 0.4536 × 2.5.
The CO2e factor is an unsourced demo assumption and must be replaced with an appropriate EPA WARM/ReFED figure for verified reporting.
Monthly summaries and daily streaks use America/Los_Angeles calendar boundaries. Weekly donor rankings start Monday at midnight Pacific. A streak can end today or yesterday and counts distinct consecutive donation dates.
Public simulations have a shared database cooldown. Browser-session handled donation IDs must not be reused after a reset.

## Photo intake and demo operations

- Photo scans use server-side Replit AI Integrations for OpenAI vision. No personal provider key is required; requests use Replit credits. Keep integration configuration server-side.
- Camera/upload photos are resized, validated, analyzed transiently and discarded; store only reviewed structured item information, not raw image bytes or base64.
- Two bundled sample images have explicitly labeled deterministic fallback data if analysis fails or reaches the 15-second deadline. Never substitute sample guesses for real-photo failures.
- Photo estimates cannot establish food safety or absence of allergens. Donors must confirm allergens and handling; items reported over two hours at room temperature are blocked from this intake.
- Structured photo intake and protected voice webhooks share donation creation and matching. Photo submissions have stable idempotency keys, and their safety validation is server-side.
- Pickup deadlines must resolve to a future time in the next 24 hours. Conversational clock times are Pacific; passed clock times must not silently become tomorrow.
- Nightly capacity is allocated by the pickup deadline's Pacific date; calling, confirmed and picked-up donations consume capacity, while declines/reroutes release the old allocation.
- Needs editing and marking pickups are public demo operations, like the existing volunteer decline route. They are not a substitute for authorization in a real deployment.
- Retail values use illustrative USD/lb estimates: bakery 4, produce 2, prepared 7, packaged 3, dairy 3.5. These are not appraisals or tax advice.
- Timeline events are recorded with state changes. Legacy donations show only known timestamps; seeded histories are explicitly illustrative.
- Demo history initializes only with the new recipient policies and does not reappear on restart after Reset demo. Startup does not overwrite initialized volunteer needs.
- Reset demo also removes donation timeline events through cascading deletion, preserving network policies and ID sequences.
