import { Router, type IRouter, type RequestHandler } from "express";
import { ScanFoodBody, IntakeDonationBody, IntakeDonationResponse } from "@workspace/api-zod";
import { analyzeImage, sampleFallback } from "../lib/vision";
import { InputError } from "../lib/food-time";
import { createDonation } from "../lib/donation-intake";
import { webhookValidationError } from "../lib/webhook-input";

const router: IRouter = Router();
let activeScans = 0;
const limits = new Map<string, { reset: number; count: number }>();
const intakeLimit: RequestHandler = (req, res, next) => {
  const now = Date.now();
  for (const [key, value] of limits) if (value.reset <= now) limits.delete(key);
  const key = `${req.ip}:${req.path}`;
  const entry = limits.get(key) ?? { reset: now + 600000, count: 0 };
  if (entry.count >= 30) {
    if (req.path === "/scan" && ["bakery", "prepared"].includes(req.body?.sample_id)) {
      res.json(sampleFallback(req.body.sample_id, "scan_rate_limited")); return;
    }
    res.status(429).json({ error: "Please pause a moment before starting another intake." }); return;
  }
  entry.count++;
  limits.set(key, entry);
  next();
};
router.post("/scan", intakeLimit, async (req, res): Promise<void> => {
  const parsed = ScanFoodBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(webhookValidationError(parsed.error.issues)); return; }
  if (activeScans >= 2) {
    if (parsed.data.sample_id) res.json(sampleFallback(parsed.data.sample_id, "scan_busy"));
    else res.status(429).json({ error: "Two photos are already scanning. Please try again in a few seconds." });
    return;
  }
  activeScans++;
  try { res.json(await analyzeImage(parsed.data.image, parsed.data.sample_id)); }
  catch (err) {
    if (!(err instanceof InputError)) throw err;
    res.status(err.status).json({ error: err.message });
  } finally { activeScans--; }
});
router.post("/donations/intake", intakeLimit, async (req, res): Promise<void> => {
  const parsed = IntakeDonationBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json(webhookValidationError(parsed.error.issues)); return; }
  const data = parsed.data;
  if (!data.allergens.trim()) { res.status(400).json({ error: "allergens must be confirmed. Enter 'none' only if you have checked the ingredients." }); return; }
  const items = data.items.filter(i => !i.unsafe).map(i => ({
    name: i.name.trim(), quantity: i.quantity, unit: i.unit.trim(), est_pounds: i.est_pounds,
  }));
  if (!items.length || items.some(i => !i.name || !i.unit)) {
    res.status(400).json({ error: "items must include at least one eligible food item with a name and unit. Items held at room temperature over two hours cannot be donated in this flow." }); return;
  }
  const pounds = Math.round(items.reduce((sum, i) => sum + i.est_pounds, 0) * 100) / 100;
  if (pounds <= 0 || pounds > 100000) { res.status(400).json({ error: "items total estimated pounds must be greater than 0 and no more than 100000." }); return; }
  try {
    res.json(IntakeDonationResponse.parse(await createDonation({ ...data, items, source: "photo", is_demo: !!data.is_sample,
      estimated_pounds: pounds, items_description: items.map(i => `${i.quantity} ${i.unit} ${i.name}`).join("; ") })));
  } catch (err) {
    if (!(err instanceof InputError)) throw err;
    res.status(err.status).json({ error: err.message });
  }
});
export default router;
