/* /donation/:id — localized timeline + printable receipt. */
import { h, api } from "./dom.js";
import { translateReason } from "./i18n.js";
import { T, t, tx, fmtNum, fmtMoney, fmtDateTime, fmtTime, onLang } from "./i18n.js";

const TERMINAL = new Set(["picked_up", "no_match"]);
export const FOOTER = "For your records. Consult a tax professional about deductibility.";

export function createDetail({ BASE }) {
  let id = null, gen = 0, timer = null, data = null, sig = "";
  const body = h("div", { class: "dt-body" });
  const root = h("div", { class: "detail" },
    h("div", { class: "dt-nav no-print" }, h("a", { href: BASE + "/", "data-link": "", class: "linkbtn ink back" }, "← ", T("dt.back"))),
    body);

  function loading() {
    body.replaceChildren(h("div", { class: "dt-grid" },
      h("div", { class: "panel dt-skel" }, h("div", { class: "skel", style: "height:40px" }), h("div", { class: "skel" }), h("div", { class: "skel" }), h("div", { class: "skel" })),
      h("div", { class: "panel dt-skel" }, h("div", { class: "skel", style: "height:240px" }))));
  }
  function notFound() {
    body.replaceChildren(h("div", { class: "panel dt-empty" }, h("div", { class: "dt-404", "aria-hidden": "true" }, "404"),
      T("dt.nf.title", null, "h2", { tabindex: "-1" }), T("dt.nf.sub", null, "p"),
      h("a", { href: BASE + "/", "data-link": "", class: "tel-sm" }, T("dt.back"))));
    body.querySelector("h2").focus({ preventScroll: true });
  }
  function errorState() {
    body.replaceChildren(h("div", { class: "panel dt-empty" }, T("dt.err.title", null, "h2", { tabindex: "-1" }), T("dt.err.sub", null, "p"),
      T("dt.retry", null, "button", { type: "button", class: "tel-sm", onclick: () => { loading(); load(); } })));
  }

  function evLabel(ev) {
    const k = "ev." + ev.type;
    return t(k) === k ? (ev.description || ev.type) : t(k, { name: ev.recipient_name || "—" });
  }
  function render(dn) {
    const items = Array.isArray(dn.items) && dn.items.length ? dn.items : [{ name: dn.items_description || "—", quantity: "", unit: "", est_pounds: dn.estimated_pounds }];
    const rc = dn.receipt || {};
    const ppl = Number(rc.price_per_lb) || 0;
    const events = Array.isArray(dn.events) ? [...dn.events].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)) : [];
    const seeded = dn.is_demo || dn.source === "seed" || dn.source === "demo";
    const allergens = Array.isArray(dn.allergens) ? dn.allergens.join(", ") : dn.allergens;
    const tl = h("ol", { class: "tl" }, events.length ? events.map((ev, i) => h("li", { class: "tl-i ev-" + ev.type + (i === events.length - 1 ? " last" : "") },
      h("span", { class: "tl-dot", "aria-hidden": "true" }),
      h("div", {},
        h("p", { class: "tl-t" }, evLabel(ev)),
        h("time", { datetime: ev.created_at, class: "tl-time" }, fmtDateTime(ev.created_at)),
        ev.description && t("ev." + ev.type) !== "ev." + ev.type ? h("p", { class: "tl-d" }, ev.description) : null)))
      : h("li", { class: "tl-i" }, h("span", { class: "tl-dot", "aria-hidden": "true" }), h("div", {}, T("dt.noevents", null, "p", { class: "tl-t" }), h("time", { class: "tl-time" }, fmtDateTime(dn.created_at)))));

    const receipt = h("article", { class: "receipt", "aria-labelledby": "rch" },
      h("header", { class: "rc-head" },
        h("div", {}, h("p", { class: "rc-brand" }, "LastCall"), T("dt.rc.title", null, "h2", { id: "rch" })),
        h("div", { class: "rc-no" }, h("span", {}, "#" + dn.id), h("span", {}, fmtTime(dn.created_at, { year: "numeric", month: "long", day: "numeric" })))),
      seeded ? T("dt.rc.demo", null, "p", { class: "rc-demo" }) : null,
      h("dl", { class: "rc-meta" },
        h("div", {}, T("dt.rc.donor", null, "dt"), h("dd", {}, dn.business_name || "—", dn.business_address ? h("small", {}, dn.business_address) : null)),
        h("div", {}, T("dt.rc.recipient", null, "dt"), h("dd", {}, dn.recipient_name && (dn.status === "confirmed" || dn.status === "picked_up") ? dn.recipient_name : t("dt.rc.norecipient"))),
        h("div", {}, T("dt.rc.date", null, "dt"), h("dd", {}, fmtDateTime(dn.picked_up_at || dn.confirmed_at || dn.created_at))),
        h("div", {}, T("dt.rc.category", null, "dt"), h("dd", {}, dn.category ? t("cat." + dn.category) : "—", allergens ? h("small", {}, t("dt.rc.allergens") + ": " + allergens) : null))),
      h("table", { class: "rc-table" },
        h("thead", {}, h("tr", {}, T("dt.rc.item", null, "th", { scope: "col" }), T("dt.rc.qty", null, "th", { scope: "col" }), T("dt.rc.lb", null, "th", { scope: "col", class: "n" }), T("dt.rc.value", null, "th", { scope: "col", class: "n" }))),
        h("tbody", {}, items.map((it) => h("tr", {}, h("td", {}, it.name), h("td", {}, [it.quantity, it.unit].filter((x) => x !== "" && x != null).join(" ")), h("td", { class: "n" }, fmtNum(it.est_pounds, 1)), h("td", { class: "n" }, ppl ? fmtMoney((Number(it.est_pounds) || 0) * ppl) : "—")))),
        h("tfoot", {}, h("tr", {}, T("dt.rc.total", null, "th", { scope: "row", colspan: 2 }), h("td", { class: "n" }, fmtNum(dn.estimated_pounds, 1)), h("td", { class: "n" }, rc.value_usd != null ? fmtMoney(rc.value_usd) : "—")))),
      h("div", { class: "rc-facts" },
        h("div", {}, T("dt.rc.rate", null, "span"), h("b", {}, ppl ? fmtMoney(ppl) + " / lb" : "—"), h("small", {}, dn.category ? t("cat." + dn.category) : "")),
        h("div", {}, T("dt.rc.co2", null, "span"), h("b", {}, rc.co2e_kg != null ? fmtNum(rc.co2e_kg, 1) + " kg" : "—")),
        h("div", {}, T("dt.rc.meals", null, "span"), h("b", {}, rc.meals != null ? fmtNum(rc.meals) : "—"))),
      T("dt.rc.method", null, "p", { class: "rc-method" }),
      h("footer", { class: "rc-foot" }, h("p", { lang: "en" }, FOOTER), t("dt.rc.footer.tr") !== FOOTER ? T("dt.rc.footer.tr", null, "p", { class: "rc-tr" }) : null));

    body.replaceChildren(
      h("header", { class: "dt-head" },
        h("div", {}, T("dt.eyebrow", { id: dn.id }, "p", { class: "eyebrow dark" }), h("h1", { tabindex: "-1" }, dn.business_name || "—"),
          h("div", { class: "meta" }, h("span", { class: "status s-" + dn.status }, t("st." + dn.status)),
            dn.estimated_pounds != null ? h("span", { class: "tag" }, "~" + fmtNum(dn.estimated_pounds, 1) + " lb") : null,
            dn.is_demo ? T("tag.demo", null, "span", { class: "tag demo" }) : null,
            dn.source ? h("span", { class: "tag" }, t("src." + dn.source) === "src." + dn.source ? dn.source : t("src." + dn.source)) : null)),
        h("button", { type: "button", class: "tel-sm no-print", onclick: () => window.print() }, T("dt.print"))),
      dn.match_reason ? h("p", { class: "why big" }, T("why.label", null, "b"), " ", translateReason(dn.match_reason), dn.distance_miles != null ? " · " + fmtNum(dn.distance_miles, 1) + " mi" : "") : null,
      h("div", { class: "dt-grid" },
        h("section", { class: "panel dt-tl no-print", "aria-labelledby": "tlh" }, h("div", { class: "phead" }, T("dt.timeline", null, "h2", { id: "tlh" }), !TERMINAL.has(dn.status) && dn.status !== "confirmed" ? T("dt.live", null, "span", { class: "chip" }) : null), tl,
          seeded ? T("dt.seeded", null, "p", { class: "tl-note" }) : null),
        receipt));
  }
  async function load() {
    const my = gen;
    try {
      const dn = await api("/donations/" + encodeURIComponent(id));
      if (my !== gen) return;
      data = dn;
      const s = JSON.stringify([dn.status, dn.recipient_name, (dn.events || []).length, dn.picked_up_at, dn.receipt]);
      if (s !== sig) { const first = !sig; sig = s; render(dn); if (first) { const h1 = body.querySelector("h1"); h1 && h1.focus({ preventScroll: true }); } }
      document.title = "#" + dn.id + " · " + (dn.business_name || "") + " — LastCall";
    } catch (e) {
      if (my !== gen) return;
      if (e.status === 404 || e.status === 400) { notFound(); return; }
      if (!data) { errorState(); return; }
    }
    if (my === gen && data && !TERMINAL.has(data.status)) timer = setTimeout(load, 4000);
  }
  onLang(() => { if (data && root.isConnected) render(data); });
  return {
    root, title: "Donation — LastCall",
    show(newId) {
      if (String(newId) === String(id) && data) return;
      gen++; clearTimeout(timer); id = newId; data = null; sig = "";
      if (!/^\d+$/.test(String(id))) { notFound(); return; }
      loading(); load();
    },
    mount() {},
    unmount() { gen++; clearTimeout(timer); id = null; data = null; },
    update() {},
  };
}
