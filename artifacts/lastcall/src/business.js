/* /business — shared business selector, voice intake (unchanged agent), Snap & Donate, impact. */
import { h, svg } from "./dom.js";
import { createVoiceCall } from "./voice-session.js";
import { T, tx, fmtNum, fmtMonth, onLang } from "./i18n.js";
import { createSnap } from "./snap.js";

const BUSINESS_AGENT = "agent_1301m7xama1dewkt14pz2cmz2av7";
const BKEY = "lastcall.business";

export function createBusiness({ state, BASE, EMPTY_ART, PHONE_ART }) {
  let selected = (() => { try { return localStorage.getItem(BKEY) || ""; } catch { return ""; } })();
  let vc = null, listSig = "";

  const list = () => state.businesses || [];
  const getBiz = () => list().find((b) => String(b.id) === String(selected)) || null;
  function setBiz(id) {
    selected = String(id);
    try { localStorage.setItem(BKEY, selected); } catch { /* ignore */ }
    sel.value = selected;
    renderImpact(); snap.businessChanged();
  }

  /* selector */
  const sel = h("select", { id: "bizsel", class: "bsel", onchange: () => setBiz(sel.value) }, T("biz.loading", null, "option", { value: "" }));
  const selWrap = h("div", { class: "bselwrap" }, T("biz.you", null, "label", { for: "bizsel" }), sel);
  function renderSelect() {
    const l = list();
    const sig = l.map((b) => b.id + ":" + b.name).join("|");
    if (sig === listSig) return;
    listSig = sig;
    if (document.activeElement === sel) return;
    sel.replaceChildren(...l.map((b) => h("option", { value: String(b.id) }, b.name)));
    if (!l.some((b) => String(b.id) === String(selected)) && l.length) { selected = String(l[0].id); try { localStorage.setItem(BKEY, selected); } catch { /* */ } }
    sel.value = selected;
    snap.businessChanged();
  }

  /* voice call (existing flow) */
  const call = h("div", { class: "bizcall" });
  const startBtn = h("button", { type: "button", class: "opt opt-call", onclick: () => begin() },
    h("span", { class: "opt-ic", "aria-hidden": "true" }, "📞"), h("span", { class: "opt-t" }, T("biz.call")), T("biz.call.sub", null, "small"));
  const snapBtn = h("button", { type: "button", class: "opt opt-snap", onclick: () => snap.open() },
    h("span", { class: "opt-ic", "aria-hidden": "true" }, "📸"), h("span", { class: "opt-t" }, T("biz.snap")), T("biz.snap.sub", null, "small"), T("biz.new", null, "span", { class: "opt-new" }));
  const options = h("div", { class: "opts" }, call, snapBtn);
  function idle() { call.replaceChildren(startBtn); }
  function begin() {
    if (vc && (vc.phase === "requesting" || vc.phase === "connecting" || vc.phase === "connected")) return;
    if (vc) vc.destroy();
    const cancel = T("biz.cancel", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => { vc && vc.destroy(); vc = null; idle(); startBtn.focus(); } });
    vc = createVoiceCall({
      agentId: BUSINESS_AGENT, name: "LastCall", subtitleKey: "biz.line",
      extraErrorActions: [cancel],
      onEnded: () => {
        vc = null;
        const head = T("biz.thanks", null, "h3", { tabindex: "-1" });
        call.replaceChildren(h("div", { class: "thanks" }, head,
          T("biz.thanks.sub", null, "p"),
          h("a", { href: BASE + "/", "data-link": "", class: "tel-sm" }, T("biz.watch")),
          T("biz.callagain", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => { idle(); startBtn.focus(); } })));
        head.focus({ preventScroll: true });
      },
    });
    call.replaceChildren(vc.el);
    vc.start();
  }
  idle();
  const isCallActive = () => !!(vc && (vc.phase === "requesting" || vc.phase === "connecting" || vc.phase === "connected"));
  const snap = createSnap({ business: { get: getBiz, list, set: setBiz }, isCallActive, BASE });

  /* impact cards */
  const cards = {
    lbs: impactCard("imp.lbs", "lb"), meals: impactCard("imp.meals"), co2: impactCard("imp.co2", "kg"), streak: impactCard("imp.streak"),
  };
  const impName = h("span", { class: "imp-name" });
  const impSub = h("p", { class: "imp-sub" });
  const impact = h("section", { class: "impact", "aria-labelledby": "imph" },
    h("div", { class: "imp-head" }, h("div", {}, T("imp.eyebrow", null, "p", { class: "eyebrow dark" }), h("h2", { id: "imph" }, impName)), impSub),
    h("div", { class: "imp-grid" }, Object.values(cards).map((c) => c.el)));
  function impactCard(key, unit) {
    const n = h("span", { class: "imp-n" }, "—");
    const u = unit ? h("span", { class: "imp-u" }, unit) : null;
    const extra = h("small", { class: "imp-x" });
    const el = h("div", { class: "imp" }, T(key, null, "p", { class: "imp-l" }), h("p", { class: "imp-v" }, n, u), extra);
    let cur = null;
    return { el, extra, set(v, d = 0) { const s = fmtNum(v, d); if (cur !== null && cur !== s) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); } cur = s; n.textContent = s; } };
  }
  function renderImpact() {
    const b = getBiz();
    if (!b) { impName.textContent = "—"; return; }
    impName.textContent = b.name;
    tx(impSub, "imp.sub", { month: fmtMonth(), n: b.monthly_donations || 0 });
    cards.lbs.set(b.monthly_pounds, 1);
    cards.meals.set(b.monthly_meals);
    cards.co2.set(b.monthly_co2e_kg, 1);
    const sd = Number(b.streak_days) || 0;
    cards.streak.set(sd);
    tx(cards.streak.extra, sd ? (sd === 1 ? "imp.streak.one" : "imp.streak.many") : "imp.streak.zero", { n: sd });
    cards.streak.el.classList.toggle("hot", sd >= 3);
    tx(cards.meals.extra, "imp.meals.x");
    tx(cards.co2.extra, "imp.co2.x");
    tx(cards.lbs.extra, "imp.lbs.x");
  }

  /* monthly table */
  const tbody = h("tbody", {}, h("tr", {}, h("td", { colspan: 3 }, h("div", { class: "skel" }))));
  const monthChip = h("span", { class: "chip" });
  const illus = svg(PHONE_ART); illus.setAttribute("class", "illus");
  const voiceNote = h("p", { class: "voicenote" }, h("span", { class: "vn-ic", "aria-hidden": "true" }, "EN · ES · 中文"), T("biz.voicenote"));
  const root = h("div", { class: "bizpage" },
    h("section", { class: "intake", "aria-labelledby": "callh" }, illus,
      h("div", { class: "intake-top" },
        h("div", {}, T("biz.eyebrow", null, "p", { class: "eyebrow dark" }), T("biz.title", null, "h2", { id: "callh" })),
        selWrap),
      options,
      h("ol", { class: "how" }, T("biz.how1", null, "li"), T("biz.how2", null, "li"), T("biz.how3", null, "li")),
      voiceNote),
    snap.root,
    impact,
    h("section", { class: "panel", "aria-labelledby": "bh", style: "margin-top:20px" },
      h("div", { class: "phead" }, T("biz.table.title", null, "h2", { id: "bh" }), monthChip),
      h("div", { style: "overflow-x:auto" },
        h("table", { class: "btable" },
          h("thead", {}, h("tr", {}, T("biz.th.business", null, "th", { scope: "col" }), T("biz.th.pounds", null, "th", { scope: "col", class: "n" }), T("biz.th.donations", null, "th", { scope: "col", class: "n" }))),
          tbody))),
    T("biz.colophon", null, "p", { class: "colophon" }));

  function renderTable() {
    const l = list();
    monthChip.textContent = fmtMonth();
    if (!l.length) {
      tbody.replaceChildren(h("tr", {}, h("td", { colspan: 3 }, h("div", { class: "empty" }, svg(EMPTY_ART), T("biz.none", null, "h3"), T("biz.none.sub", null, "p")))));
      return;
    }
    const max = Math.max(1, ...l.map((b) => Number(b.monthly_pounds) || 0));
    const sorted = [...l].sort((a, b) => (b.monthly_pounds || 0) - (a.monthly_pounds || 0));
    tbody.replaceChildren(...sorted.map((b) => h("tr", { class: String(b.id) === String(selected) ? "me" : "" },
      h("td", {}, h("div", { class: "bname" }, b.name), h("div", { class: "baddr" }, b.address),
        h("div", { class: "bar", "aria-hidden": "true" }, h("span", { style: `width:${((Number(b.monthly_pounds) || 0) / max) * 100}%` }))),
      h("td", { class: "n" }, fmtNum(b.monthly_pounds, 1), h("span", { class: "sr" }, " lb")),
      h("td", { class: "n" }, fmtNum(b.monthly_donations)))));
  }
  onLang(() => { if (state.businesses) { renderImpact(); renderTable(); } });

  return {
    root, title: "For businesses — LastCall",
    mount() { snap.resume(); },
    unmount() { if (vc) { vc.destroy(); vc = null; } idle(); snap.teardown(); },
    teardown() { if (vc) vc.destroy(); snap.teardown(); },
    update() {
      if (!state.businesses) return;
      renderSelect(); renderImpact(); renderTable();
    },
  };
}
