/**
 * ElevenLabs tool arguments can contain numeric/boolean strings.
 * Normalize only known fields, never null, arrays, blank numbers, or boolean 0/1.
 * Generated request schemas still enforce integer/positive/range constraints.
 */
export function normalizeWebhookInput(body: unknown, numericField: "donation_id" | "estimated_pounds") {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const normalized = { ...body } as Record<string, unknown>;
  const value = normalized[numericField];
  if (typeof value === "string") {
    // Convert malformed/blank strings to NaN, not zero; the numeric schema rejects it.
    normalized[numericField] = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())
      ? Number(value) : Number.NaN;
  }
  if (typeof normalized.accepted === "string") {
    const accepted = normalized.accepted.trim();
    if (accepted === "true") normalized.accepted = true;
    if (accepted === "false") normalized.accepted = false;
  }
  return normalized;
}

type Issue = { path: (string | number)[]; message: string };
const hints: Record<string, string> = {
  donation_id: "must be a positive integer ID, supplied as a number or numeric string",
  accepted: 'must be a boolean or the string "true" or "false"',
  estimated_pounds: "must be a positive number no greater than 100000, supplied as a number or numeric string",
  pickup_eta: "must be a string of at most 200 characters, or omitted; an empty string is allowed",
  notes: "must be a string of at most 2000 characters, or omitted; an empty string is allowed",
};

export function webhookValidationError(issues: Issue[]) {
  const details = issues.map(issue => {
    const field = issue.path.join(".") || "body";
    return { field, message: hints[field] ?? issue.message };
  });
  return {
    error: `Invalid webhook details: ${details.map(issue => `${issue.field} ${issue.message}`).join("; ")}`,
    details,
  };
}
