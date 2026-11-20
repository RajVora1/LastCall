/* Live tracking of one donation after submission: polls /donations/:id every 2s. */
import { h, api } from "./dom.js";
import { T, tx, fmtNum, translateReason } from "./i18n.js";

const POLL = 2000;
const STAGES = ["logged", "matched", "calling", "confirmed"];

export function createTracker({ id, initial, BASE, onAgain, onNew }) {
  let timer = null, gen = 0, last = null, prevRecipient = initial && initial.recipient_name || null, done = false, fails = 0;
  const reroutes = [];
  const stepEls = STAGES.map((s) => h("li", {}, h("span", { class: "tk-dot", "aria-hidden": "true" }), T("tk.stage." + s)));
  const steps = h("ol", { class: "tk-steps" }, stepEls);
  const headline = h("h3", { class: "tk-head", tabindex: "-1" });
  const sub = h("p", { class: "tk-sub", role: "status", "aria-live": "polite" });
  const card = h("div", { class: "tk-rec" });
  const rerouteEl = h("ul", { class: "tk-reroutes" });
  const conn = h("p", { class: "tk-conn", role: "status" });
  const actions = h("div", { class: "pp-row left tk-actions" });
  const stage = h("div", { class: "tk-stage" });
  const el = h("div", { class: "track" }, stage, headline, sub, steps, card, rerouteEl, conn, actions);
  const detailLink = () => h("a", { href: BASE + "/donation/" + id, "data-link": "", class: "tel-sm" }, T("tk.viewdetail"));

  function setStage(n) { stepEls.forEach((li, i) => { li.classList.toggle("done", i < n); li.classList.toggle("on", i === n); }); }
  function recCard(dn) {
    const name = dn.recipient_name;
    if (!name) { card.replaceChildren(); return; }
    card.replaceChildren(
      h("div", { class: "tk-rname" }, h("b", {}, name), dn.distance_miles != null ? h("span", { class: "chip" }, fmtNum(dn.distance_miles, 1) + " mi") : null),
      dn.match_reason ? h("p", { class: "why" }, T("why.label", null, "b"), " ", translateReason(dn.match_reason)) : null,
      dn.pickup_eta ? h("p", { class: "tk-eta" }, T("tk.eta", { eta: dn.pickup_eta })) : null);
  }
  function render(dn) {
    const st = dn.status;
    if (prevRecipient && dn.recipient_name && dn.recipient_name !== prevRecipient && !reroutes.includes(prevRecipient)) {
      reroutes.push(prevRecipient);
      rerouteEl.append(h("li", {}, T("tk.rerouted", { from: prevRecipient, to: dn.recipient_name })));
    }
    if (dn.recipient_name) prevRecipient = dn.recipient_name;
    recCard(dn);
    stage.className = "tk-stage s-" + st;
    if (st === "confirmed" || st === "picked_up") {
      done = true; setStage(4);
      stepEls.forEach((li) => li.classList.add("done"));
      tx(headline, st === "picked_up" ? "tk.pickedup.title" : "tk.confirmed.title");
      tx(sub, "tk.confirmed.sub", { name: dn.recipient_name || "—" });
      stage.replaceChildren(confetti(), h("div", { class: "tk-check", "aria-hidden": "true" }, checkSvg()));
      actions.replaceChildren(detailLink(), T("tk.another", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => { stop(); onNew(); } }));
      headline.focus({ preventScroll: true });
    } else if (st === "no_match") {
      done = true; setStage(1);
      tx(headline, "tk.nomatch.title");
      tx(sub, dn.match_reason ? "tk.nomatch.sub.reason" : "tk.nomatch.sub", { reason: translateReason(dn.match_reason || "") });
      stage.replaceChildren(h("div", { class: "tk-ic no", "aria-hidden": "true" }, "—"));
      card.replaceChildren(T("tk.nomatch.tips", null, "p", { class: "why" }));
      actions.replaceChildren(T("tk.tryagain", null, "button", { type: "button", class: "tel-sm", onclick: () => { stop(); onAgain(); } }), detailLink(), T("tk.another", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => { stop(); onNew(); } }));
      headline.focus({ preventScroll: true });
    } else if (st === "calling" && dn.recipient_name) {
      setStage(2);
      tx(headline, "tk.calling", { name: dn.recipient_name });
      tx(sub, reroutes.length ? "tk.calling.sub.re" : "tk.calling.sub");
      stage.replaceChildren(h("div", { class: "tk-ring", "aria-hidden": "true" }, h("span"), h("span"), h("b", {}, "LC")));
      actions.replaceChildren(detailLink());
    } else if (st === "declined") {
      setStage(2);
      tx(headline, "tk.declined.title");
      tx(sub, "tk.declined.sub");
      stage.replaceChildren(h("div", { class: "tk-ring slow", "aria-hidden": "true" }, h("span"), h("b", {}, "LC")));
    } else {
      setStage(dn.recipient_name ? 1 : 0);
      tx(headline, "tk.finding");
      tx(sub, "tk.finding.sub");
      stage.replaceChildren(h("div", { class: "tk-ring", "aria-hidden": "true" }, h("span"), h("b", {}, "LC")));
    }
  }
  async function poll() {
    const my = gen;
    try {
      const dn = await api("/donations/" + encodeURIComponent(id));
      if (my !== gen) return;
      fails = 0; conn.textContent = ""; delete conn.dataset.i18n;
      const sig = [dn.status, dn.recipient_name, dn.match_reason, dn.pickup_eta, document.documentElement.lang].join("|");
      if (sig !== last) { last = sig; render(dn); }
    } catch (e) {
      if (my !== gen) return;
      fails++;
      if (fails > 1) tx(conn, "tk.offline");
    }
    if (my === gen && !done) timer = setTimeout(poll, POLL);
  }
  function start() { stop(); if (done) return; gen++; poll(); }
  function stop() { gen++; clearTimeout(timer); timer = null; }

  // initial paint from intake response
  tx(headline, initial && initial.recipient_name ? "tk.calling" : "tk.finding", { name: initial && initial.recipient_name });
  tx(sub, initial && initial.recipient_name ? "tk.calling.sub" : "tk.finding.sub");
  setStage(initial && initial.recipient_name ? 2 : 0);
  if (initial) recCard(initial);
  stage.replaceChildren(h("div", { class: "tk-ring", "aria-hidden": "true" }, h("span"), h("span"), h("b", {}, "LC")));
  actions.replaceChildren(detailLink());
  start();
  return { el, start, stop };
}

function confetti() {
  const wrap = h("div", { class: "confetti", "aria-hidden": "true" });
  const colors = ["#e2672b", "#9cc7a6", "#f6d2b8", "#3f8a5f", "#f6efdf"];
  for (let i = 0; i < 28; i++) {
    const s = h("i");
    s.style.setProperty("--x", (Math.random() * 2 - 1) * 180 + "px");
    s.style.setProperty("--y", -(60 + Math.random() * 140) + "px");
    s.style.setProperty("--r", Math.round(Math.random() * 720 - 360) + "deg");
    s.style.setProperty("--d", (Math.random() * 0.25).toFixed(2) + "s");
    s.style.background = colors[i % colors.length];
    wrap.append(s);
  }
  return wrap;
}
function checkSvg() {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("viewBox", "0 0 52 52");
  s.innerHTML = '<circle cx="26" cy="26" r="24" fill="#2f8a52"/><path d="M15 27l7 7 15-16" fill="none" stroke="#f6efdf" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
}
