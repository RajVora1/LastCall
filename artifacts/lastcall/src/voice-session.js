import { Conversation } from "@elevenlabs/client";
import { h, svg, HANGUP_ICON } from "./dom.js";
import { T, tx } from "./i18n.js";

const CONNECT_TIMEOUT = 20000;

/** Returns an i18n key for a friendly error. */
function friendly(e) {
  const n = e && e.name;
  if (n === "NotAllowedError" || n === "SecurityError" || n === "PermissionDeniedError") return "vc.err.blocked";
  if (n === "NotFoundError" || n === "DevicesNotFoundError") return "vc.err.nomic";
  if (n === "NotReadableError") return "vc.err.busy";
  if (e && e.code === "nomedia") return "vc.err.nomedia";
  if (e && e.code === "timeout") return "vc.err.timeout";
  return "vc.err.generic";
}
const pad = (n) => String(n).padStart(2, "0");

/**
 * Shared in-call controller + UI. Text is bound to i18n keys, so switching
 * language relabels the live call without touching the session.
 * opts: { agentId, name, subtitle?, subtitleKey?, extraErrorActions?: Node[], onConnected?, onEnded?(info), onFailed?(key) }
 */
export function createVoiceCall(opts) {
  let gen = 0, session = null, tick = null, t0 = 0, phase = "idle", lastVars = null;

  const avatar = h("div", { class: "vc-avatar", "aria-hidden": "true" }, h("span", {}, "LC"));
  const title = h("h2", { class: "vc-title", tabindex: "-1" }, opts.name || "LastCall");
  const sub = opts.subtitleKey ? T(opts.subtitleKey, null, "p", { class: "vc-sub" }) : h("p", { class: "vc-sub" }, opts.subtitle || "");
  const status = h("p", { class: "vc-status", role: "status", "aria-live": "polite" }, "");
  const timer = h("p", { class: "vc-timer" }, T("vc.calltime", null, "span", { class: "sr" }), h("span", {}, "00:00"));
  const errText = h("p", {}, "");
  const retry = T("vc.retry", null, "button", { type: "button", class: "tel-sm", onclick: () => start(lastVars) });
  const err = h("div", { class: "vc-err", role: "alert", hidden: true }, errText, h("div", { class: "vc-erow" }, retry, ...(opts.extraErrorActions || [])));
  const endBtn = h("button", { type: "button", class: "tel end", onclick: () => end() }, svg(HANGUP_ICON), T("vc.end"));
  const el = h("section", { class: "vc", "data-phase": "idle" }, avatar, title, sub, status, timer, err, endBtn);
  el.setAttribute("aria-label", "LastCall");

  function setStatus(key) { if (key) tx(status, key); else { delete status.dataset.i18n; status.textContent = ""; } }
  function setPhase(p, key) {
    phase = p; el.dataset.phase = p;
    if (key !== undefined) setStatus(key);
    endBtn.hidden = !(p === "requesting" || p === "connecting" || p === "connected");
    timer.hidden = p !== "connected";
  }
  setPhase("idle", null);
  function startTimer() {
    clearInterval(tick); t0 = Date.now();
    const out = timer.lastChild;
    const upd = () => { const s = Math.floor((Date.now() - t0) / 1000); out.textContent = pad(Math.floor(s / 60)) + ":" + pad(s % 60); };
    upd(); tick = setInterval(upd, 1000);
  }
  function stopTimer() { clearInterval(tick); tick = null; return t0 ? Math.floor((Date.now() - t0) / 1000) : 0; }

  function connected() {
    if (phase === "connected") return;
    setPhase("connected", "vc.listening");
    el.dataset.mode = "listening";
    startTimer();
    endBtn.focus({ preventScroll: true });
    opts.onConnected && opts.onConnected();
  }
  function fail(key) {
    stopTimer(); t0 = 0;
    setPhase("error", "vc.didnt");
    tx(errText, key); err.hidden = false;
    retry.focus({ preventScroll: true });
    opts.onFailed && opts.onFailed(key);
  }
  function finished(details) {
    const wasConnected = phase === "connected";
    gen++; session = null;
    const dur = stopTimer(); t0 = 0;
    if (!wasConnected && details && details.reason === "error") { fail(friendly(null)); return; }
    setPhase("ended", "vc.ended");
    opts.onEnded && opts.onEnded({ duration: dur, reason: (details && details.reason) || "user" });
  }

  async function start(dynamicVariables) {
    if (phase === "requesting" || phase === "connecting" || phase === "connected") return false;
    const my = ++gen;
    lastVars = dynamicVariables || null;
    err.hidden = true;
    setPhase("requesting", "vc.asking");
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw Object.assign(new Error("nomedia"), { code: "nomedia" });
      const test = await navigator.mediaDevices.getUserMedia({ audio: true });
      test.getTracks().forEach((t) => t.stop()); // release the permission probe immediately
    } catch (e) {
      if (my === gen) fail(friendly(e));
      return false;
    }
    if (my !== gen) return false;
    setPhase("connecting", "vc.connecting");
    const cfg = {
      agentId: opts.agentId,
      connectionType: "webrtc",
      onConnect: () => { if (my === gen) connected(); },
      onDisconnect: (d) => { if (my === gen) finished(d); },
      onError: () => {
        if (my !== gen) return;
        gen++;
        const active = session; session = null;
        if (active) active.endSession().catch(() => {});
        fail("vc.err.interrupted");
      },
      onModeChange: ({ mode }) => {
        if (my !== gen || phase !== "connected") return;
        el.dataset.mode = mode;
        setStatus(mode === "speaking" ? "vc.speaking" : "vc.listening");
      },
    };
    if (lastVars) cfg.dynamicVariables = lastVars;
    let to;
    const timeout = new Promise((_, rej) => { to = setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), CONNECT_TIMEOUT); });
    const p = Conversation.startSession(cfg);
    // a session that resolves after we gave up (timeout / end / unmount) is closed immediately
    p.then((s) => { if (my !== gen) s.endSession().catch(() => {}); }, () => {});
    try {
      const s = await Promise.race([p, timeout]);
      clearTimeout(to);
      if (my !== gen) return false;
      session = s;
      connected();
      return true;
    } catch (e) {
      clearTimeout(to);
      if (my !== gen) return false;
      gen++;
      fail(friendly(e));
      return false;
    }
  }

  /** User-initiated hang-up. */
  function end() {
    if (!(phase === "requesting" || phase === "connecting" || phase === "connected")) return;
    gen++;
    const s = session; session = null;
    if (s) s.endSession().catch(() => {});
    const dur = stopTimer(); t0 = 0;
    setPhase("ended", "vc.ended");
    opts.onEnded && opts.onEnded({ duration: dur, reason: "user" });
  }
  /** Silent teardown (navigation / unload). */
  function destroy() {
    gen++;
    const s = session; session = null;
    if (s) s.endSession().catch(() => {});
    stopTimer(); t0 = 0;
    setPhase("idle", null);
  }
  return { el, start, end, destroy, focus: () => title.focus({ preventScroll: true }), get phase() { return phase; } };
}
