import { h, svg, api, PHONE_ICON, HANGUP_ICON } from "./dom.js";
import { createRingtone } from "./ringtone.js";
import { createVoiceCall } from "./voice-session.js";
import { T, t, tx, fmtNum, fmtTime, translateReason } from "./i18n.js";
import { createPantryOps } from "./pantry-ops.js";

const PANTRY_AGENT = "agent_9001m7xbmxa4ep6sjtp928cw85tb";
const KEY = "lastcall.handled";
const POLL = 2000;

const loadHandled = () => { try { return new Set(JSON.parse(sessionStorage.getItem(KEY) || "[]").map(String)); } catch { return new Set(); } };
const str = (v, d = "") => (v == null || v === "" ? d : String(v));
const lb = (v) => (v == null || v === "" ? "" : "~" + fmtNum(v, 1) + " lb");
const when = (v) => (v && /T\d/.test(v) && !isNaN(Date.parse(v)) ? fmtTime(v) : v);

export function createPantry() {
  const handled = loadHandled();
  const ring = createRingtone();
  let mode = "off", pollT = null, polling = false, alive = false, list = [], netErr = false;
  let cur = null, answeredRecipient = null, call = null, waitStart = 0, declineBusy = false;

  const markHandled = (id) => { handled.add(String(id)); try { sessionStorage.setItem(KEY, JSON.stringify([...handled])); } catch { /* ignore */ } };
  const eligible = () => list.filter((d) => d.status === "calling" && !handled.has(String(d.id)))
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));

  const pantryName = h("span", {}, "Berkeley Food Network");
  const ops = createPantryOps({ onRecipient: (r) => { if (r) pantryName.textContent = r.name; } });
  const screen = h("div", { class: "pp-screen" });
  const conn = h("p", { class: "pp-conn", role: "status", "aria-live": "polite" }, "");
  const root = h("div", { class: "pantry" },
    h("div", { class: "pp-lang" }, T("pp.voicenote", null, "p", { class: "pp-vnote" })),
    h("div", { class: "pp-phone" },
      h("header", { class: "pp-head" },
        T("pp.eyebrow", null, "p", { class: "eyebrow" }),
        h("h1", {}, pantryName, " — ", T("pp.line"))),
      screen, conn),
    T("pp.honest", null, "p", { class: "pp-honest" }));

  function show(...nodes) {
    screen.replaceChildren(...nodes);
    screen.classList.remove("in"); void screen.offsetWidth; screen.classList.add("in");
    const f = screen.querySelector("[data-autofocus]");
    if (f) f.focus({ preventScroll: true });
  }
  function setConn(key) { if (key) tx(conn, key); else { delete conn.dataset.i18n; conn.textContent = ""; } }

  /* ---------- screens ---------- */
  function offScreen() {
    mode = "off";
    ops.stop();
    show(h("div", { class: "pp-off" },
      h("button", { type: "button", class: "pp-duty", "data-autofocus": "", onclick: goOnDuty },
        h("span", { class: "pp-ring", "aria-hidden": "true" }), svg(PHONE_ICON), T("pp.duty")),
      T("pp.lead", null, "p", { class: "pp-lead" })));
  }
  const queueEl = h("p", { class: "pp-queue" }, "");
  const soundHint = h("div", { class: "pp-hint", hidden: true },
    T("pp.sound.blocked", null, "p"),
    T("pp.sound.enable", null, "button", { type: "button", class: "tel-sm", onclick: async () => { const ok = await ring.unlock(); soundHint.hidden = ok; } }));
  function idleScreen(noteKey) {
    mode = "idle"; cur = null;
    show(h("div", { class: "pp-idle" },
      h("div", { class: "pp-onduty" }, h("span", { class: "dot", "aria-hidden": "true" }), T("pp.onduty")),
      T("pp.waiting", null, "h2", { tabindex: "-1", "data-autofocus": "" }),
      noteKey && T(noteKey, null, "p", { class: "pp-note", role: "status" }),
      queueEl, soundHint,
      T("pp.offduty", null, "button", { type: "button", class: "tel-sm ghost", onclick: goOffDuty })),
      ops.el);
    soundHint.hidden = ring.isAudible();
    renderQueue();
  }
  function renderQueue() {
    const n = eligible().length;
    if (netErr) tx(queueEl, "pp.q.err"); else if (n) tx(queueEl, n > 1 ? "pp.q.many" : "pp.q.one", { n }); else tx(queueEl, "pp.q.none");
  }

  const declineMsg = h("p", { class: "pp-err", role: "alert", hidden: true }, "");
  function ringScreen(d) {
    mode = "ring"; cur = d;
    declineMsg.hidden = true;
    const audible = ring.start();
    const ans = h("button", { type: "button", class: "tel answer", "data-autofocus": "", onclick: answer }, svg(PHONE_ICON), T("pp.answer"));
    const dec = h("button", { type: "button", class: "tel end", onclick: decline }, svg(HANGUP_ICON), T("pp.decline"));
    const allergens = Array.isArray(d.allergens) ? d.allergens.filter(Boolean).join(", ") : str(d.allergens);
    show(h("div", { class: "pp-incoming", role: "dialog", "aria-modal": "true", "aria-labelledby": "inh", "aria-describedby": "insub" },
      h("div", { class: "vc-avatar ringing", "aria-hidden": "true" }, h("span", {}, "LC")),
      T("pp.incoming", null, "h2", { id: "inh" }),
      d.recipient_name && h("p", { class: "pp-for" }, T("pp.for", { name: d.recipient_name })),
      h("p", { id: "insub", class: "pp-sub" }, [str(d.business_name, t("pp.abiz")), str(d.items_description, t("pp.surplus")), lb(d.estimated_pounds)].filter(Boolean).join(" · ")),
      allergens && allergens !== "none" && h("p", { class: "pp-dead" }, T("pp.allergens", { list: allergens })),
      d.pickup_deadline && h("p", { class: "pp-dead" }, T("pp.pickupby", { time: when(d.pickup_deadline) })),
      d.match_reason && h("p", { class: "pp-why" }, T("why.label", null, "b"), " ", translateReason(d.match_reason)),
      d.is_demo && T("tag.demo", null, "span", { class: "tag demo light" }),
      !audible && h("div", { class: "pp-hint" }, T("pp.silent", null, "p"),
        T("pp.sound.enable", null, "button", { type: "button", class: "tel-sm", onclick: async (e) => { const b = e.currentTarget; if (await ring.unlock()) { ring.start(); b.parentElement.remove(); } } })),
      declineMsg,
      h("div", { class: "pp-actions" }, dec, ans),
      T("pp.offduty", null, "button", { type: "button", class: "tel-sm ghost", onclick: goOffDuty })));
    document.title = t("pp.incoming");
  }
  function setActionsDisabled(v) { screen.querySelectorAll(".pp-actions button").forEach((b) => (b.disabled = v)); }

  async function decline() {
    if (!cur || declineBusy) return;
    const d = cur;
    declineBusy = true; ring.stop(); setActionsDisabled(true);
    declineMsg.hidden = false; declineMsg.className = "pp-note"; tx(declineMsg, "pp.declining");
    try {
      await api("/pantry/decline", { method: "POST", body: { donation_id: d.id, recipient_id: d.recipient_id ?? undefined } });
      markHandled(d.id);
      if (call) { call.destroy(); call = null; }
      idleScreen("pp.declined.note");
    } catch (e) {
      if (e.status === 409) {
        if (call) { call.destroy(); call = null; }
        idleScreen("pp.moved");
        poll(true);
      } else {
        declineMsg.className = "pp-err";
        tx(declineMsg, "pp.declinefail", { code: e.status || "network" });
        setActionsDisabled(false);
      }
    } finally { declineBusy = false; restoreTitle(); }
  }

  function answer() {
    if (!cur) return;
    const d = cur;
    ring.stop(); mode = "call"; restoreTitle();
    answeredRecipient = d.recipient_id ?? null;
    const declineBtn = T("pp.declineinstead", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => { cur = d; decline(); } });
    call = createVoiceCall({
      agentId: PANTRY_AGENT,
      name: "LastCall",
      subtitle: [str(d.business_name), str(d.items_description), lb(d.estimated_pounds)].filter(Boolean).join(" · "),
      extraErrorActions: [declineBtn],
      onConnected: () => markHandled(d.id),
      onEnded: () => { call = null; afterScreen(); poll(true); },
    });
    show(call.el, declineMsg);
    declineMsg.hidden = true;
    call.start({
      donation_id: str(d.id),
      business_name: str(d.business_name, "a local business"),
      business_address: str(d.business_address, "address not provided"),
      items: str(d.items_description, "surplus food"),
      pounds: str(d.estimated_pounds, "unknown"),
      allergens: Array.isArray(d.allergens) ? (d.allergens.filter(Boolean).join(", ") || "none") : str(d.allergens, "none"),
      pickup_deadline: str(d.pickup_deadline, "as soon as possible"),
      recipient_name: str(d.recipient_name, "our pantry"),
    });
  }

  const waitNote = h("p", { class: "pp-note" }, "");
  function afterScreen() {
    mode = "after"; waitStart = Date.now();
    show(h("div", { class: "pp-result wait" },
      h("div", { class: "pp-spin", "aria-hidden": "true" }),
      T("pp.recording", null, "h2", { tabindex: "-1", "data-autofocus": "" }),
      T("pp.recording.sub", null, "p", { role: "status" }),
      waitNote,
      h("div", { class: "pp-row" },
        T("pp.keepwaiting", null, "button", { type: "button", class: "tel-sm", onclick: () => { waitStart = Date.now(); tx(waitNote, "pp.stillchecking"); poll(true); } }),
        T("pp.backonduty", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => idleScreen() }))));
    waitNote.textContent = ""; delete waitNote.dataset.i18n;
  }
  function resultScreen(ok, d) {
    mode = "result";
    show(h("div", { class: "pp-result " + (ok ? "ok" : "no") },
      ok ? h("div", { class: "pp-okmark", "aria-hidden": "true" }, "✓") : null,
      T(ok ? "pp.confirmed" : "pp.declined", null, "h2", { tabindex: "-1", "data-autofocus": "" }),
      ok ? T(d.pickup_eta ? "pp.confirmed.sub.eta" : "pp.confirmed.sub", { biz: str(d.business_name, t("pp.thebiz")), name: str(d.recipient_name, "—"), eta: str(d.pickup_eta) }, "p")
        : T("pp.declined.sub", null, "p"),
      h("div", { class: "pp-row" },
        T("pp.backonduty", null, "button", { type: "button", class: "tel-sm", onclick: () => idleScreen() }),
        T("pp.offduty", null, "button", { type: "button", class: "tel-sm ghost", onclick: goOffDuty }))));
  }

  /* ---------- polling ---------- */
  function schedule() { clearTimeout(pollT); if (alive && mode !== "off") pollT = setTimeout(() => poll(), POLL); }
  async function poll(now) {
    if (now) clearTimeout(pollT);
    if (polling || !alive || mode === "off") return;
    polling = true;
    try {
      const v = await api("/donations");
      list = Array.isArray(v) ? v : [];
      netErr = false; setConn(null);
    } catch {
      netErr = true; setConn("pp.conn.err");
    }
    polling = false;
    if (!alive || mode === "off") return;
    if (!netErr) { react(); ops.setDonations(list); }
    if (mode === "idle") renderQueue();
    schedule();
  }
  function react() {
    if (mode === "idle") {
      const next = eligible()[0];
      if (next) ringScreen(next);
    } else if (mode === "ring" && cur && !declineBusy) {
      const d = list.find((x) => String(x.id) === String(cur.id));
      if (!d || d.status !== "calling" || String(d.recipient_id) !== String(cur.recipient_id)) {
        ring.stop();
        markHandled(cur.id);
        restoreTitle();
        idleScreen("pp.missed");
      }
    } else if (mode === "after" && cur) {
      const d = list.find((x) => String(x.id) === String(cur.id));
      if (!d) { resultScreen(false, { ...cur, status: "no_match" }); return; }
      const sameRecipient = answeredRecipient == null || String(d.recipient_id) === String(answeredRecipient);
      const ok = d.status === "confirmed" || d.status === "picked_up";
      if (ok && sameRecipient) resultScreen(true, d);
      else if (d.status === "declined" || d.status === "no_match" || !sameRecipient || ok) resultScreen(false, d);
      else if (Date.now() - waitStart > 45000) tx(waitNote, "pp.slow");
    }
  }

  /* ---------- duty ---------- */
  async function goOnDuty() {
    const ok = await ring.unlock(); // user gesture
    if (!alive) return;
    ops.start();
    idleScreen();
    soundHint.hidden = ok;
    poll(true);
  }
  function goOffDuty() {
    ring.stop(); clearTimeout(pollT);
    if (call) { call.destroy(); call = null; }
    restoreTitle();
    offScreen();
    setConn(null);
  }
  const TITLE = "Volunteer line — LastCall";
  function restoreTitle() { if (alive) document.title = TITLE; }

  return {
    root, title: TITLE,
    mount() { alive = true; offScreen(); },
    unmount() { goOffDuty(); alive = false; },
    teardown() { ring.stop(); if (call) call.destroy(); },
    update() {},
  };
}
