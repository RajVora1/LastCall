import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./index.css";
import { h, svg, SVGNS, api } from "./dom.js";
import { createPantry } from "./pantry.js";
import { createBusiness } from "./business.js";
import { createDetail } from "./detail.js";
import { langSwitch, apply as applyI18n, t as tr } from "./i18n.js";

const BASE = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
const app = document.getElementById("app");

const LOGO = `<svg xmlns="${SVGNS}" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="19" fill="#e2672b"/><path d="M12 22c0-5 3.6-9 8-9s8 4 8 9" fill="none" stroke="#f6efdf" stroke-width="2.6" stroke-linecap="round"/><path d="M9 23h22" stroke="#f6efdf" stroke-width="2.6" stroke-linecap="round"/><path d="M14.5 27.5c1.6 1.4 3.4 2 5.5 2s3.9-.6 5.5-2" fill="none" stroke="#14321f" stroke-width="2.4" stroke-linecap="round"/><circle cx="20" cy="11" r="1.6" fill="#f6efdf"/></svg>`;
const EMPTY_ART = `<svg xmlns="${SVGNS}" viewBox="0 0 200 130" aria-hidden="true"><ellipse cx="100" cy="118" rx="78" ry="7" fill="#e4d6b5"/><rect x="38" y="58" width="76" height="52" rx="6" fill="#efe5cd" stroke="#1d4530" stroke-width="2.5"/><path d="M38 70h76" stroke="#1d4530" stroke-width="2.5"/><path d="M52 58c0-12 8-20 24-20s24 8 24 20" fill="#f6d2b8" stroke="#1d4530" stroke-width="2.5"/><circle cx="62" cy="50" r="3" fill="#e2672b"/><circle cx="80" cy="45" r="3" fill="#e2672b"/><circle cx="92" cy="52" r="3" fill="#e2672b"/><rect x="126" y="64" width="34" height="46" rx="8" fill="#14321f"/><rect x="131" y="70" width="24" height="26" rx="3" fill="#9cc7a6"/><circle cx="143" cy="103" r="3" fill="#f6efdf"/><path d="M166 54c6 4 6 14 0 18M172 48c10 7 10 23 0 30" fill="none" stroke="#e2672b" stroke-width="2.5" stroke-linecap="round"/></svg>`;
const PHONE_ART = `<svg xmlns="${SVGNS}" viewBox="0 0 100 100" aria-hidden="true"><path d="M30 14c4-2 9 0 11 4l6 13c2 4 0 8-3 10l-6 4c4 9 11 16 20 20l4-6c2-3 6-5 10-3l13 6c4 2 6 7 4 11l-4 9c-2 4-6 6-10 6C43 88 12 57 12 21c0-4 2-8 6-10z" fill="#14321f"/></svg>`;

/* ---------- api ---------- */
const get = (path) => api(path);
const state = { online: true, network: null, stats: null, donations: null, businesses: null, leaderboard: null, lbError: false };

/* ---------- shell ---------- */
const liveEl = h("span", { class: "live", role: "status", "aria-live": "polite" }, h("span", { class: "dot" }), h("span", {}, "Connecting"));
const banner = h("div", { class: "banner", role: "alert" },
  h("span", {}, "Can't reach the LastCall server — showing the last data we had. Retrying every 2 seconds."),
  h("button", { type: "button", onclick: () => tick() }, "Retry now"));
const navLinks = {
  "/": h("a", { href: BASE + "/", "data-link": "" }, "Dashboard"),
  "/business": h("a", { href: BASE + "/business", "data-link": "" }, "For businesses"),
  "/pantry": h("a", { href: BASE + "/pantry", "data-link": "" }, "Volunteer line"),
};
const heroPhone = h("div", { class: "phonecard" });
const heroEl = h("section", { class: "hero" },
  h("div", {},
    h("h1", {}, "LastCall"),
    h("p", { class: "tagline" }, "Closing-time surplus ", h("span", { class: "arr" }, "→"), " community tables, in one phone call.")),
  heroPhone);
const header = h("header", { class: "top" },
  h("nav", { class: "nav", "aria-label": "Main" },
    h("a", { class: "brand", href: BASE + "/", "data-link": "", "aria-label": "LastCall home" }, svg(LOGO), "LastCall"),
    liveEl,
    h("div", { class: "links" }, Object.values(navLinks)),
    h("div", { class: "navlang" }, langSwitch())),
  heroEl);
const mainEl = h("main", { id: "main", tabindex: "-1" });
app.append(header, banner, mainEl);

function setOnline(ok) {
  state.online = ok;
  // The volunteer page owns its polling and reports connection failures locally.
  const volunteer = current === pantry;
  banner.classList.toggle("show", !ok && !volunteer);
  liveEl.classList.toggle("off", !ok && !volunteer);
  liveEl.lastChild.textContent = volunteer ? tr("pp.live") : ok ? "Live · updates every 2s" : "Offline";
}

function renderPhone(target) {
  const n = state.network;
  const sig = n ? (n.calling_mode || "") + "|" + !!n.calls_configured : "none";
  if (target.dataset.sig === sig) return;
  target.dataset.sig = sig;
  target.replaceChildren(h("p", { class: "eyebrow" }, "Browser calling mode"));
  if (!n) { target.append(h("div", { class: "skel", style: "height:40px;margin:0" })); return; }
  target.append(
    h("p", { class: "note" }, n.calls_configured
      ? "No phone number needed — both sides of the call happen right in the browser with a microphone."
      : "Voice calling isn't configured on the server yet. The simulator below still shows the flow."),
    h("div", { class: "herolinks" },
      h("a", { class: "hl biz", href: BASE + "/business", "data-link": "" }, h("small", {}, "Business"), "Report surplus", h("span", { "aria-hidden": "true" }, "→")),
      h("a", { class: "hl pan", href: BASE + "/pantry", "data-link": "" }, h("small", {}, "Pantry"), "Volunteer line", h("span", { "aria-hidden": "true" }, "→"))));
}

/* ---------- counters ---------- */
const fmt = (v, d = 0) => Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
function counter(label) {
  const num = h("div", { class: "num" }, "0");
  const el = h("div", { class: "stat" }, h("div", { class: "label" }, h("i"), label), num);
  let cur = 0, raf;
  return {
    el,
    set(v, dec = 0) {
      v = Number(v) || 0;
      if (v === cur && num.textContent !== "0") { num.textContent = fmt(v, dec); return; }
      const from = cur, start = performance.now(), dur = 1100;
      cancelAnimationFrame(raf);
      if (from !== v && from !== 0) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
      const step = (t) => {
        const p = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - p, 3);
        num.textContent = fmt(from + (v - from) * e, dec);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
      cur = v;
    },
  };
}

/* ---------- dashboard ---------- */
const dash = (() => {
  const c = { lbs: counter("Pounds Saved"), meals: counter("Meals Provided"), co2: counter("kg CO2e Avoided"), don: counter("Donations") };
  const stats = h("section", { class: "stats", "aria-label": "Impact totals" }, Object.values(c).map((x) => x.el));
  const netChip = h("span", { class: "chip" }, "Loading network…");
  const mapDiv = h("div", { id: "map", role: "region", "aria-label": "Map of Berkeley businesses and recipients" });
  const mapMsg = h("div", { class: "mapmsg" }, "Loading map…");
  const legend = h("div", { class: "legend", "aria-label": "Map legend" },
    h("div", {}, h("span", { class: "pb" }), "Food business"),
    h("div", {}, h("span", { class: "pr" }), "Community recipient"),
    h("div", {}, h("span", { class: "ln" }), "Confirmed pickup"));
  const feedCount = h("span", { class: "chip" }, "—");
  const feed = h("ul", { class: "feed", "aria-live": "polite", "aria-label": "Donation feed" }, h("li", { class: "skel" }), h("li", { class: "skel" }), h("li", { class: "skel" }));
  const simBtn = h("button", { class: "btn", type: "button" }, "Simulate donation", h("span", { "aria-hidden": "true" }, "→"));
  const simMsg = h("div", { class: "fmsg", role: "status" });
  const lbList = h("ol", { class: "lb-list", "aria-live": "polite" }, h("li", { class: "skel" }), h("li", { class: "skel" }));
  let lbSig = "";
  const lbWarn = h("p", { class: "lb-warn", role: "status" }); lbWarn.hidden = true;
  function drawLbError() {
    if (state.leaderboard) {
      lbWarn.hidden = false;
      lbWarn.replaceChildren(h("span", {}, "Couldn't refresh the leaderboard — showing the last data we had."), " ", h("button", { type: "button", class: "linkbtn ink", onclick: () => tick() }, "Retry now"));
      return;
    }
    lbWarn.hidden = true; lbSig = "";
    lbList.replaceChildren(h("li", { class: "lb-empty", role: "alert" }, h("b", {}, "Couldn't load the leaderboard"), h("span", {}, "We'll keep retrying every 2 seconds."), h("button", { type: "button", class: "tel-sm ghost", style: "justify-self:center;margin-top:8px", onclick: () => tick() }, "Retry now")));
  }
  function drawLeaderboard(rows) {
    const sorted = [...rows].sort((a, b) => (b.weekly_pounds || 0) - (a.weekly_pounds || 0) || (b.weekly_donations || 0) - (a.weekly_donations || 0) || String(a.name).localeCompare(String(b.name)));
    const sig = JSON.stringify(sorted.map((r) => [r.id, r.weekly_pounds, r.weekly_donations]));
    if (sig === lbSig) return; lbSig = sig;
    const active = sorted.filter((r) => Number(r.weekly_pounds) > 0);
    if (!active.length) { lbList.replaceChildren(h("li", { class: "lb-empty" }, h("b", {}, "No saved food yet this week"), h("span", {}, "The board fills as pickups are confirmed. Weeks start Monday, Pacific time."))); return; }
    const max = Math.max(...active.map((r) => Number(r.weekly_pounds) || 0), 1);
    let rank = 0, prev = null;
    lbList.replaceChildren(...active.slice(0, 8).map((r, i) => {
      if (r.weekly_pounds !== prev) { rank = i + 1; prev = r.weekly_pounds; }
      return h("li", { class: "lb-row" + (rank === 1 ? " top" : "") },
        h("span", { class: "lb-rank" }, String(rank)),
        h("div", { class: "lb-main" }, h("span", { class: "lb-name" }, r.name), h("div", { class: "bar", "aria-hidden": "true" }, h("span", { style: `width:${(Number(r.weekly_pounds) / max) * 100}%` }))),
        h("span", { class: "lb-n" }, fmt(r.weekly_pounds, 1), h("small", {}, " lb")),
        h("span", { class: "lb-d" }, fmt(r.weekly_donations) + (Number(r.weekly_donations) === 1 ? " donation" : " donations")));
    }));
  }
  const resetLink = h("p", { class: "resetline" }, h("button", { type: "button", class: "linkbtn", onclick: () => openReset() }, "Reset demo"));
  const root = h("div", {},
    stats,
    h("div", { class: "board" },
      h("section", { class: "panel", "aria-labelledby": "maph" },
        h("div", { class: "phead" }, h("h2", { id: "maph" }, "The Berkeley network"), netChip),
        h("div", { class: "mapwrap" }, mapDiv, mapMsg, legend)),
      h("section", { class: "panel", "aria-labelledby": "feedh" },
        h("div", { class: "phead" }, h("h2", { id: "feedh" }, "Live donations"), feedCount),
        feed)),
    h("section", { class: "panel lb", "aria-labelledby": "lbh" },
      h("div", { class: "phead" }, h("h2", { id: "lbh" }, "Top donors this week"), h("span", { class: "chip" }, "Mon–Sun · Pacific time")),
      lbWarn, lbList),
    h("footer", { class: "foot" },
      h("div", {}, h("strong", {}, "Try the flow without a phone"),
        h("p", {}, "Creates a labeled sample donation that starts calling. It stays in “calling” until a volunteer answers or declines on the Volunteer line.")),
      simBtn, simMsg),
    resetLink,
    h("p", { class: "colophon" }, "Demo network · Totals include simulated donations · Meals and CO2e are estimates (2.5 kg CO2e/kg food, illustrative). Map data © OpenStreetMap contributors."));

  simBtn.addEventListener("click", async () => {
    simBtn.disabled = true; simMsg.className = "fmsg"; simMsg.textContent = "Placing a demo donation…";
    try {
      const r = await api("/demo/simulate", { method: "POST", body: {} });
      simMsg.textContent = (r && r.message) || "Demo donation created. Open the Volunteer line to answer it.";
      tick();
    } catch (e) {
      simMsg.className = "fmsg err"; simMsg.textContent = "Couldn't simulate right now (" + e.message + "). Try again.";
    } finally { setTimeout(() => (simBtn.disabled = false), 1200); }
  });

  let map, layerNet, layerRoutes, recMarkers = new Map(), netSig = "", prevStatus = new Map(), routeSig = "";
  function ensureMap() {
    if (map) { setTimeout(() => map.invalidateSize(), 0); return; }
    map = L.map(mapDiv, { scrollWheelZoom: false, zoomControl: true }).setView([37.8715, -122.273], 14);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(map);
    layerRoutes = L.layerGroup().addTo(map);
    layerNet = L.layerGroup().addTo(map);
  }
  const icon = (cls) => L.divIcon({ className: "", html: `<div class="pin ${cls}"></div>`, iconSize: [18, 18], iconAnchor: [9, 9] });
  function popup(title, ...lines) {
    return h("div", {}, h("b", {}, title), ...lines.filter(Boolean).map((l) => h("div", { style: "font-size:13px;color:#5f6b5f;margin-top:2px" }, l)));
  }
  function drawNetwork(n) {
    const sig = JSON.stringify([n.businesses.map((b) => b.id), n.recipients.map((r) => r.id)]);
    netChip.textContent = `${n.businesses.length} businesses · ${n.recipients.length} recipients`;
    if (sig === netSig) return;
    netSig = sig; mapMsg.remove();
    layerNet.clearLayers(); recMarkers.clear();
    const pts = [];
    n.businesses.forEach((b) => {
      if (b.lat == null) return;
      pts.push([b.lat, b.lng]);
      L.marker([b.lat, b.lng], { icon: icon("biz"), title: b.name, keyboard: true }).bindPopup(popup(b.name, b.address)).addTo(layerNet);
    });
    n.recipients.forEach((r) => {
      if (r.lat == null) return;
      pts.push([r.lat, r.lng]);
      const accepts = Array.isArray(r.accepts) ? r.accepts.join(", ") : r.accepts;
      const m = L.marker([r.lat, r.lng], { icon: icon("rec"), title: r.name, keyboard: true })
        .bindPopup(popup(r.name, r.address, r.type, accepts && "Accepts: " + accepts, r.open_until && "Open until " + r.open_until)).addTo(layerNet);
      recMarkers.set(r.id, m);
    });
    if (pts.length) map.fitBounds(pts, { padding: [36, 36], maxZoom: 15 });
  }
  function pulse(id) {
    const m = recMarkers.get(id); const el = m && m.getElement() && m.getElement().querySelector(".pin");
    if (!el) return;
    el.classList.remove("pulse"); void el.offsetWidth; el.classList.add("pulse");
  }
  function drawRoutes(list) {
    const SAVED = (st) => st === "confirmed" || st === "picked_up";
    const conf = list.filter((d) => SAVED(d.status) && d.recipient_lat != null && d.business_lat != null);
    const sig = conf.map((d) => d.id).join(",");
    const fresh = new Set();
    list.forEach((d) => {
      const p = prevStatus.get(d.id);
      if (SAVED(d.status) && p && !SAVED(p)) fresh.add(d.id);
      prevStatus.set(d.id, d.status);
    });
    if (sig === routeSig && !fresh.size) return;
    routeSig = sig;
    layerRoutes.clearLayers();
    conf.forEach((d) => {
      const isNew = fresh.has(d.id);
      L.polyline([[d.business_lat, d.business_lng], [d.recipient_lat, d.recipient_lng]],
        { color: "#1d4530", weight: 3, opacity: .85, className: isNew ? "route draw" : "route" })
        .bindTooltip(`${d.business_name} → ${d.recipient_name || "recipient"}`).addTo(layerRoutes);
      if (isNew) setTimeout(() => pulse(d.recipient_id), 300);
    });
    return fresh;
  }
  const STATUS = { pending: "Pending", calling: "Calling", confirmed: "Confirmed", picked_up: "Picked up", declined: "Declined", no_match: "No match" };
  function ago(s) {
    const t = Date.parse(s); if (!t) return "";
    const d = Math.max(0, (Date.now() - t) / 1000);
    if (d < 60) return "just now"; if (d < 3600) return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    return new Date(t).toLocaleDateString();
  }
  function drawFeed(list, fresh) {
    feedCount.textContent = `${list.length} ${list.length === 1 ? "donation" : "donations"}`;
    if (!list.length) {
      feed.replaceChildren(h("li", { class: "empty" }, svg(EMPTY_ART),
        h("h3", {}, "Quiet kitchen, for now"),
        h("p", {}, "When a shop calls in its closing-time surplus, it appears here and LastCall starts dialing nearby recipients."),
        h("p", {}, "Hit “Simulate donation” below to see one run.")));
      return;
    }
    const sorted = [...list].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    feed.replaceChildren(...sorted.map((d) => {
      const st = STATUS[d.status] || d.status;
      const allergens = Array.isArray(d.allergens) ? d.allergens : d.allergens ? String(d.allergens).split(/,\s*/) : [];
      return h("li", { class: "item" + (fresh && fresh.has(d.id) ? " flash" : "") },
        h("div", { class: "irow" }, h("span", { class: "iname" }, d.business_name || "Unknown business"), h("span", { class: "time" }, ago(d.created_at))),
        d.items_description && h("div", { class: "desc" }, d.items_description),
        h("div", { class: "meta" },
          h("span", { class: "status s-" + d.status }, st),
          d.estimated_pounds != null && h("span", { class: "tag" }, fmt(d.estimated_pounds, 1) + " lb"),
          d.category && h("span", { class: "tag" }, d.category),
          allergens.filter(Boolean).map((a) => h("span", { class: "tag allergen" }, "Contains " + a)),
          d.is_demo && h("span", { class: "tag demo" }, "Demo"),
          d.source === "photo" && h("span", { class: "tag" }, "Snap & Donate")),
        d.recipient_name && h("div", { class: "toward" }, (d.status === "confirmed" || d.status === "picked_up" ? "→ " : "Trying ") + d.recipient_name + (d.distance_miles != null ? ` · ${fmt(d.distance_miles, 1)} mi` : "") + (d.pickup_eta ? ` · pickup ${d.pickup_eta}` : "")),
        !d.recipient_name && d.pickup_deadline && h("div", { class: "time" }, "Pickup by " + (/T\d/.test(d.pickup_deadline) ? new Date(d.pickup_deadline).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : d.pickup_deadline)),
        d.match_reason && h("div", { class: "why" }, h("b", {}, "Why this match:"), " " + d.match_reason),
        h("a", { class: "ilink", href: BASE + "/donation/" + d.id, "data-link": "" }, "Timeline & receipt ", h("span", { "aria-hidden": "true" }, "→")));
    }));
  }
  return {
    root, title: "LastCall — Live rescue dashboard",
    mount() { ensureMap(); },
    update() {
      const s = state.stats;
      if (s) { c.lbs.set(s.pounds_saved, 0); c.meals.set(s.meals); c.co2.set(s.co2e_kg, 1); c.don.set(s.donations_count); }
      if (state.network && map) drawNetwork(state.network);
      if (state.lbError) drawLbError();
      else { lbWarn.hidden = true; if (state.leaderboard) drawLeaderboard(state.leaderboard); }
      if (state.donations) { const fresh = map ? drawRoutes(state.donations) : null; drawFeed(state.donations, fresh); }
    },
  };
})();

/* ---------- business page ---------- */
const biz = createBusiness({ state, BASE, EMPTY_ART, PHONE_ART });
const detail = createDetail({ BASE });
const pantry = createPantry();

/* ---------- reset demo (secret typed per use, sent only to /demo/reset, never stored) ---------- */
let resetDlg = null;
function openReset() {
  if (!resetDlg) {
    const pw = h("input", { type: "password", name: "secret", id: "rsecret", autocomplete: "off", required: true, spellcheck: "false" });
    const msg = h("p", { class: "rmsg", role: "alert" }, "");
    const go = h("button", { type: "submit", class: "tel-sm danger" }, "Delete everything");
    const form = h("form", { method: "dialog" },
      h("h2", { id: "rh" }, "Reset the demo?"),
      h("p", {}, "This permanently deletes ALL donations and ALL call attempts, including real ones. Businesses and recipients stay. This can't be undone."),
      h("label", { for: "rsecret" }, "Webhook secret"), pw, msg,
      h("div", { class: "rrow" }, h("button", { type: "button", class: "tel-sm ghost", onclick: () => resetDlg.close() }, "Cancel"), go));
    resetDlg = h("dialog", { class: "rdlg", "aria-labelledby": "rh" }, form);
    resetDlg.addEventListener("close", () => { pw.value = ""; msg.textContent = ""; go.disabled = false; });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const secret = pw.value; if (!secret) return;
      go.disabled = true; msg.textContent = "Resetting…";
      try {
        await api("/demo/reset", { method: "POST", body: {}, headers: { "x-api-key": secret } });
        pw.value = "";
        resetDlg.close();
        state.stats = null; state.donations = null;
        tick();
      } catch (err) {
        pw.value = "";
        msg.textContent = err.status === 401 || err.status === 403 ? "That secret wasn't accepted. Nothing was deleted." : "Reset failed (" + (err.status || "network") + "). Nothing may have changed — try again.";
        go.disabled = false; pw.focus();
      }
    });
    document.body.append(resetDlg);
  }
  resetDlg.showModal();
}

/* ---------- router ---------- */
let current = null;
function route() {
  let p = location.pathname;
  if (BASE && p.startsWith(BASE)) p = p.slice(BASE.length) || "/";
  p = p.replace(/\/$/, "") || "/";
  const dm = p.match(/^\/donation\/([^/]+)$/);
  const view = p === "/business" ? biz : p === "/pantry" ? pantry : dm ? detail : dash;
  const key = view === biz ? "/business" : view === pantry ? "/pantry" : view === dash ? "/" : "";
  Object.entries(navLinks).forEach(([k, a]) => (k === key ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  heroEl.style.display = view === dash ? "" : "none";
  document.body.classList.toggle("on-pantry", view === pantry);
  document.body.classList.toggle("show-lang", view !== dash);
  if (current !== view) {
    if (current && current.unmount) current.unmount();
    document.title = view.title;
    mainEl.replaceChildren(view.root); current = view; view.mount();
    applyI18n(view.root);
  }
  if (view === detail) detail.show(decodeURIComponent(dm[1]));
  view.update();
  setOnline(state.online);
}
document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  if (a.getAttribute("href") !== location.pathname + location.search) history.pushState({}, "", a.getAttribute("href"));
  route(); window.scrollTo(0, 0); mainEl.focus({ preventScroll: true });
});
window.addEventListener("popstate", route);

/* ---------- polling ---------- */
let busy = false, netAt = 0;
async function tick() {
  if (busy || current === pantry) return; busy = true;
  const jobs = [get("/stats").then((v) => (state.stats = v)), get("/donations").then((v) => (state.donations = Array.isArray(v) ? v : []))];
  if (!state.network || Date.now() - netAt > 30000) jobs.push(get("/network").then((v) => { state.network = v; netAt = Date.now(); }));
  if (current === dash) jobs.push(get("/leaderboard").then((v) => { state.leaderboard = Array.isArray(v) ? v : []; state.lbError = false; }).catch(() => { state.lbError = true; }));
  if (current === biz || !state.businesses) jobs.push(get("/businesses").then((v) => (state.businesses = Array.isArray(v) ? v : [])));
  const res = await Promise.allSettled(jobs);
  setOnline(res.every((r) => r.status === "fulfilled"));
  renderPhone(heroPhone);
  current && current.update();
  busy = false;
}
window.addEventListener("pagehide", () => { biz.teardown(); pantry.teardown(); });
route();
renderPhone(heroPhone);
tick();
setInterval(tick, 2000);
