/* Snap & Donate — photo → structured items → one-question-at-a-time → match → live tracking. */
import { h, api } from "./dom.js";
import { T, t, tx, ta, fmtNum, fmtTime, onLang, pacificTodayAt, toPacificInput, fromPacificInput } from "./i18n.js";
import { listen, stopListening, speechSupported } from "./speech.js";
import { createTracker } from "./track.js";

const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_RAW = 3 * 1024 * 1024;
const MAX_DIM = 1600;
const CLIENT_TIMEOUT = 15000;
export const CATEGORIES = ["bakery", "produce", "prepared", "packaged", "dairy"];
export const ALLERGENS = ["gluten", "dairy", "eggs", "tree_nuts", "peanuts", "soy", "fish", "shellfish", "sesame"];
const ALG_WORDS = {
  gluten: ["gluten", "wheat", "trigo", "flour", "bread", "麸质", "小麦", "面筋"],
  dairy: ["dairy", "milk", "lácteo", "lacteo", "leche", "butter", "cheese", "queso", "乳", "奶", "牛奶"],
  eggs: ["egg", "huevo", "蛋", "鸡蛋"],
  tree_nuts: ["tree nut", "almond", "walnut", "pecan", "nuez", "nueces", "almendra", "坚果", "杏仁", "核桃"],
  peanuts: ["peanut", "cacahuate", "maní", "mani", "花生"],
  soy: ["soy", "soya", "soja", "大豆", "黄豆", "豆"],
  fish: ["fish", "pescado", "鱼"],
  shellfish: ["shellfish", "shrimp", "marisco", "camarón", "camaron", "虾", "贝", "甲壳"],
  sesame: ["sesame", "sésamo", "sesamo", "ajonjolí", "ajonjoli", "芝麻"],
};
const NONE_WORDS = /\b(none|nothing|no allergens|ninguno|ninguna|nada)\b|没有|无/i;
const YES = /\b(yes|yeah|yep|sí|si|correcto)\b|是的|是|有/i;
const NO = /\b(no|nope|never|nunca)\b|没有|不是|否|不/i;
const SAMPLES = [
  { id: "bakery", file: "bakery.jpg", key: "snap.sample.bakery" },
  { id: "prepared", file: "prepared.jpg", key: "snap.sample.prepared" },
];
// Used only if the server itself is unreachable during a SAMPLE scan. Clearly labeled.
const LOCAL_SAMPLE = {
  bakery: { items: [{ name: "Croissants", quantity: 18, unit: "pieces", est_pounds: 3.4 }, { name: "Sourdough loaves", quantity: 6, unit: "loaves", est_pounds: 9 }, { name: "Bagels", quantity: 14, unit: "pieces", est_pounds: 3.9 }, { name: "Blueberry muffins", quantity: 9, unit: "pieces", est_pounds: 2.2 }], category: "bakery", likely_allergens: ["gluten", "dairy", "eggs"], confidence: 0.62, missing_info: [] },
  prepared: { items: [{ name: "Steamed rice", quantity: 1, unit: "hotel pan", est_pounds: 7.5 }, { name: "Roasted vegetables", quantity: 1, unit: "hotel pan", est_pounds: 5.2 }, { name: "Grilled chicken portions", quantity: 12, unit: "portions", est_pounds: 6.3 }], category: "prepared", likely_allergens: ["soy"], confidence: 0.58, missing_info: [] },
};
const uuid = () => (crypto && crypto.randomUUID ? crypto.randomUUID() : "k-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12));
let uidN = 0;
const mkItem = (it = {}) => ({ uid: ++uidN, name: String(it.name || ""), quantity: it.quantity != null ? String(it.quantity) : "", unit: String(it.unit || ""), est_pounds: it.est_pounds != null ? String(Math.round(Number(it.est_pounds) * 10) / 10) : "" });
const num = (v) => { const n = Number(String(v).replace(",", ".")); return isFinite(n) ? n : NaN; };

function mapAllergen(s) {
  const low = String(s || "").toLowerCase();
  return ALLERGENS.find((id) => id === low || ALG_WORDS[id].some((w) => low.includes(w)));
}
function deadlineAt(hour) { return pacificTodayAt(hour); }

/* ---------- image helpers ---------- */
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(Object.assign(new Error("decode"), { code: "decode" })); i.src = src; });
}
async function blobToDataURL(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    let scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    for (let pass = 0; pass < 6; pass++) {
      c.width = Math.max(1, Math.round(img.naturalWidth * scale));
      c.height = Math.max(1, Math.round(img.naturalHeight * scale));
      const g = c.getContext("2d");
      g.fillStyle = "#fbf7ec"; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.85, 0.72, 0.6]) {
        const data = c.toDataURL("image/jpeg", q);
        const raw = Math.floor((data.length - data.indexOf(",") - 1) * 3 / 4);
        if (raw <= MAX_RAW) return data;
      }
      scale *= 0.75;
    }
    throw Object.assign(new Error("big"), { code: "toolarge" });
  } finally { URL.revokeObjectURL(url); }
}
function validScan(r) {
  if (!r || !Array.isArray(r.items) || !r.items.length) return false;
  if (!CATEGORIES.includes(r.category)) return false;
  return r.items.every((i) => i && typeof i.name === "string" && isFinite(Number(i.est_pounds)));
}

/**
 * business: { get(): {id,name}|null, list(): Business[], set(id) }
 * isCallActive(): boolean — mic answers pause while an ElevenLabs call is live.
 */
export function createSnap({ business, isCallActive, BASE }) {
  let d = null, scanGen = 0, scanAbort = null, tracker = null;
  const root = h("section", { class: "snap", hidden: true, "aria-labelledby": "snaph" });
  const head = h("div", { class: "snap-head" },
    h("div", {}, T("snap.eyebrow", null, "p", { class: "eyebrow" }), T("snap.title", null, "h2", { id: "snaph", tabindex: "-1" })),
    T("snap.close", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => close() }));
  const stepper = h("ol", { class: "snap-steps", "aria-hidden": "true" },
    ["snap.step.photo", "snap.step.review", "snap.step.confirm", "snap.step.match"].map((k) => T(k, null, "li")));
  const body = h("div", { class: "snap-body" });
  const live = h("p", { class: "sr", role: "status", "aria-live": "polite" });
  root.append(head, stepper, body, live);

  function setStep(n) { [...stepper.children].forEach((li, i) => { li.classList.toggle("on", i === n); li.classList.toggle("done", i < n); }); }
  function say(key, vars) { tx(live, key, vars); }
  function view(node, step) {
    stopListening();
    setStep(step);
    body.replaceChildren(node);
    body.classList.remove("in"); void body.offsetWidth; body.classList.add("in");
    const f = body.querySelector("[data-autofocus]");
    if (f) f.focus({ preventScroll: true });
  }
  function newDraft() {
    return { key: uuid(), photo: null, source: null, sampleId: null, isSample: false, items: [], category: "", suggest: [], allergens: null, pickup: null, pickupKind: null, hot: null, unsafe: new Set(), unsafePicked: false, ack: false, confidence: null, missing: [], fallbackReason: "", submitting: false, donationId: null, result: null };
  }

  /* ---------- 1. choose ---------- */
  function chooseView(errKey) {
    d = newDraft();
    const cam = h("input", { type: "file", accept: "image/*", capture: "environment", class: "sr", id: "snapcam", onchange: (e) => onFile(e.target.files[0]) });
    const up = h("input", { type: "file", accept: "image/jpeg,image/png,image/webp,image/gif", class: "sr", id: "snapup", onchange: (e) => onFile(e.target.files[0]) });
    const samples = SAMPLES.map((s) => h("button", { type: "button", class: "sample", onclick: () => useSample(s) },
      h("img", { src: BASE + "/samples/" + s.file, alt: "", loading: "lazy", width: 160, height: 160 }),
      h("span", { class: "sample-l" }, T(s.key, null, "b"), T("snap.usesample", null, "small"))));
    view(h("div", { class: "snap-choose" },
      errKey && T(errKey, null, "p", { class: "snap-alert", role: "alert" }),
      h("div", { class: "drop" },
        h("label", { for: "snapcam", class: "pick cam", tabindex: "0", "data-autofocus": "", onkeydown: kbClick }, h("span", { class: "pick-ic", "aria-hidden": "true" }, camIcon()), T("snap.takephoto", null, "b"), T("snap.takephoto.sub", null, "small")),
        h("label", { for: "snapup", class: "pick", tabindex: "0", onkeydown: kbClick }, h("span", { class: "pick-ic", "aria-hidden": "true" }, upIcon()), T("snap.upload", null, "b"), T("snap.upload.sub", null, "small")),
        cam, up),
      h("div", { class: "samples" }, T("snap.nocam", null, "p", { class: "eyebrow dark" }), h("div", { class: "sample-row" }, samples)),
      h("p", { class: "snap-fine" }, T("snap.privacy"), " ",
        T("snap.manual", null, "button", { type: "button", class: "linkbtn ink", onclick: () => manual() }))), 0);
  }
  function kbClick(e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.currentTarget.click(); } }

  async function onFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type || "")) return chooseView("snap.err.type");
    if (file.size > MAX_INPUT_BYTES) return chooseView("snap.err.size");
    const my = ++scanGen;
    let data;
    try { data = await blobToDataURL(file); }
    catch (e) { if (my === scanGen) chooseView(e.code === "toolarge" ? "snap.err.size" : "snap.err.decode"); return; }
    if (my !== scanGen) return;
    d.isSample = false; d.sampleId = null;
    scan(data, null, my);
  }
  async function useSample(s) {
    const my = ++scanGen;
    let data;
    try {
      const r = await fetch(BASE + "/samples/" + s.file);
      if (!r.ok) throw new Error("sample");
      data = await blobToDataURL(await r.blob());
    } catch { if (my === scanGen) chooseView("snap.err.sample"); return; }
    if (my !== scanGen) return;
    d.isSample = true; d.sampleId = s.id;
    scan(data, s.id, my);
  }

  /* ---------- 2. scanning ---------- */
  function scan(data, sampleId, my) {
    d.photo = data;
    if (scanAbort) scanAbort.abort();
    const ctrl = new AbortController(); scanAbort = ctrl;
    const draft = d;
    const elapsed = h("span", { class: "scan-sec" }, "0s");
    const t0 = Date.now();
    const timer = setInterval(() => { elapsed.textContent = Math.floor((Date.now() - t0) / 1000) + "s"; }, 500);
    const msg = T("snap.scan.1", null, "p", { class: "scan-msg", role: "status", "aria-live": "polite" });
    const steps = ["snap.scan.1", "snap.scan.2", "snap.scan.3"]; let si = 0;
    const rot = setInterval(() => { si = (si + 1) % steps.length; tx(msg, steps[si]); }, 2600);
    view(h("div", { class: "scanning" },
      h("div", { class: "scan-frame" }, h("img", { src: data, alt: "" }), h("span", { class: "scan-line", "aria-hidden": "true" }), h("span", { class: "scan-corners", "aria-hidden": "true" })),
      h("div", { class: "scan-side" },
        T("snap.scanning", null, "h3", { tabindex: "-1", "data-autofocus": "" }), msg,
        h("p", { class: "scan-meta" }, T("snap.scan.elapsed"), " ", elapsed),
        sampleId && T("snap.scan.samplenote", null, "p", { class: "scan-note" }),
        h("div", { class: "pp-row left" },
          T("snap.cancel", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => { cleanup(); ++scanGen; ctrl.abort(); chooseView(); } }),
          T("snap.replace", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => { cleanup(); ++scanGen; ctrl.abort(); chooseView(); } })))), 0);
    function cleanup() { clearInterval(timer); clearInterval(rot); }
    const to = setTimeout(() => ctrl.abort(), CLIENT_TIMEOUT);
    const body = { image: data }; if (sampleId) body.sample_id = sampleId;
    fetch("/api/scan", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: ctrl.signal })
      .then(async (r) => { let j = null; try { j = await r.json(); } catch { /* */ } if (!r.ok) throw Object.assign(new Error("scan"), { status: r.status, data: j }); return j; })
      .then((r) => {
        if (my !== scanGen || d !== draft) return; // replaced / cancelled / late
        if (!validScan(r)) throw Object.assign(new Error("invalid"), { code: "invalid" });
        applyScan(r);
      })
      .catch((e) => {
        if (my !== scanGen || d !== draft) return;
        if (sampleId && LOCAL_SAMPLE[sampleId]) {
          applyScan({ ...LOCAL_SAMPLE[sampleId], total_est_pounds: 0, source: "sample_fallback", fallback_reason: "server_unreachable" });
        } else scanError(e);
      })
      .finally(() => { clearTimeout(to); cleanup(); if (scanAbort === ctrl) scanAbort = null; });
  }
  function applyScan(r) {
    d.source = r.source === "sample_fallback" ? "sample_fallback" : "ai";
    d.fallbackReason = r.fallback_reason || "";
    d.items = r.items.map(mkItem);
    d.category = r.category;
    d.suggest = [...new Set((r.likely_allergens || []).map(mapAllergen).filter(Boolean))];
    d.confidence = typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : null;
    d.missing = Array.isArray(r.missing_info) ? r.missing_info.filter((x) => typeof x === "string").slice(0, 5) : [];
    say("snap.scan.done");
    reviewView();
  }
  function scanError(e) {
    const key = e.name === "AbortError" ? "snap.err.timeout" : e.status === 413 ? "snap.err.size" : e.status === 429 ? "snap.err.rate" : e.code === "invalid" || e.status === 422 ? "snap.err.unreadable" : e.status ? "snap.err.scan" : "snap.err.network";
    const photo = d.photo;
    view(h("div", { class: "scan-error" },
      h("div", { class: "scan-frame dim" }, photo && h("img", { src: photo, alt: "" })),
      h("div", { class: "scan-side" },
        T("snap.err.title", null, "h3", { tabindex: "-1", "data-autofocus": "" }),
        T(key, null, "p", { role: "alert" }),
        T("snap.err.nomock", null, "p", { class: "scan-note" }),
        h("div", { class: "pp-row left" },
          T("snap.retry", null, "button", { type: "button", class: "tel-sm", onclick: () => { const my = ++scanGen; scan(photo, null, my); } }),
          T("snap.manual.btn", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => manual(photo) }),
          T("snap.another", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => chooseView() })))), 0);
  }
  function manual(photo) {
    ++scanGen; if (scanAbort) scanAbort.abort();
    if (!d) d = newDraft();
    d.photo = photo || d.photo; d.source = "manual"; d.isSample = false; d.sampleId = null;
    d.items = [mkItem()]; d.category = ""; d.suggest = []; d.confidence = null; d.missing = [];
    reviewView();
  }

  /* ---------- 3. review + questions ---------- */
  let itemsBody, totalsEl, chatEl, catSel;
  function eligible() { return d.items.filter((i) => !d.unsafe.has(i.uid)); }
  function total(list = eligible()) { return list.reduce((s, i) => s + (num(i.est_pounds) > 0 ? num(i.est_pounds) : 0), 0); }
  function renderTotals() {
    if (!totalsEl) return;
    const el = eligible();
    totalsEl.replaceChildren(
      h("div", {}, T("snap.total"), h("strong", {}, "~" + fmtNum(total(), 1) + " lb")),
      h("div", {}, T("snap.items.count", { n: el.length }), d.unsafe.size ? T("snap.items.blocked", { n: d.unsafe.size }, "em") : null));
  }
  function itemRow(it) {
    const blocked = d.unsafe.has(it.uid);
    const f = (key, field, attrs) => {
      const inp = h("input", { ...attrs, value: it[field], oninput: (e) => {
        const old = num(it[field]);
        it[field] = e.target.value;
        if (field === "quantity") {
          const nq = num(it.quantity), lb = num(it.est_pounds);
          if (old > 0 && nq > 0 && lb > 0) { it.est_pounds = String(Math.round((lb * nq / old) * 10) / 10); lbI.value = it.est_pounds; }
        }
        validateRow(); renderTotals();
      } });
      ta(inp, "aria-label", key, { n: d.items.indexOf(it) + 1 });
      return inp;
    };
    const nameI = f("snap.f.name.n", "name", { type: "text", class: "in name", maxlength: 120, autocomplete: "off" });
    const qtyI = f("snap.f.qty.n", "quantity", { type: "number", class: "in qty", min: "0", step: "any", inputmode: "decimal" });
    const unitI = f("snap.f.unit.n", "unit", { type: "text", class: "in unit", list: "snap-units", maxlength: 30 });
    const lbI = f("snap.f.lb.n", "est_pounds", { type: "number", class: "in lb", min: "0", step: "0.1", inputmode: "decimal" });
    const row = h("div", { class: "irow2" + (blocked ? " blocked" : ""), role: "group" },
      nameI, qtyI, unitI, h("div", { class: "lbwrap" }, lbI, h("span", { "aria-hidden": "true" }, "lb")),
      blocked ? T("snap.blocked.badge", null, "span", { class: "blockbadge" }) : null,
      h("button", { type: "button", class: "xbtn", onclick: () => { d.items = d.items.filter((x) => x !== it); d.unsafe.delete(it.uid); renderItems(); renderTotals(); renderChat(); say("snap.item.removed"); } }, "×"));
    ta(row.lastChild, "aria-label", "snap.item.remove", { name: it.name || "#" + (d.items.indexOf(it) + 1) });
    function validateRow() {
      nameI.classList.toggle("bad", !it.name.trim());
      lbI.classList.toggle("bad", !(num(it.est_pounds) > 0));
      qtyI.classList.toggle("bad", it.quantity !== "" && !(num(it.quantity) > 0));
    }
    row._validate = validateRow;
    return row;
  }
  function renderItems() {
    itemsBody.replaceChildren(...d.items.map(itemRow));
    if (!d.items.length) itemsBody.append(T("snap.items.empty", null, "p", { class: "items-empty" }));
  }
  function addItem() {
    if (d.items.length >= 30) return; // API limit
    const it = mkItem(); d.items.push(it);
    // A new item must be covered by the hot-food and safety questions.
    if (d.hot !== null || d.ack) { d.hot = null; d.unsafePicked = false; d.ack = false; }
    renderItems(); renderTotals(); renderChat(false);
    const rows = itemsBody.querySelectorAll(".irow2"); rows[rows.length - 1].querySelector("input").focus();
  }

  function reviewView() {
    const src = d.source === "sample_fallback"
      ? h("div", { class: "srcbadge fb" }, T("snap.src.fallback", null, "b"), T(d.fallbackReason === "server_unreachable" ? "snap.src.fallback.offline" : "snap.src.fallback.sub", null, "span"))
      : d.source === "ai" ? h("div", { class: "srcbadge ai" }, T("snap.src.ai", null, "b"), T("snap.src.ai.sub", { pct: d.confidence != null ? Math.round(d.confidence * 100) : "—" }, "span"))
      : h("div", { class: "srcbadge man" }, T("snap.src.manual", null, "b"));
    catSel = h("select", { class: "in", id: "snapcat", onchange: (e) => { d.category = e.target.value; } },
      T("snap.cat.pick", null, "option", { value: "" }), CATEGORIES.map((c) => T("cat." + c, null, "option", { value: c })));
    catSel.value = d.category;
    itemsBody = h("div", { class: "items" });
    totalsEl = h("div", { class: "totals", "aria-live": "polite" });
    chatEl = h("div", { class: "chat", "aria-live": "polite" });
    view(h("div", { class: "review" },
      h("div", { class: "rev-left" },
        h("div", { class: "rev-photo" }, d.photo ? h("img", { src: d.photo, alt: "" }) : h("div", { class: "nophoto" }, T("snap.nophoto")), d.isSample && T("snap.sampletag", null, "span", { class: "tag demo on-img" })),
        src,
        d.missing.length ? h("div", { class: "missing" }, T("snap.missing", null, "b"), h("ul", {}, d.missing.map((m) => h("li", {}, m)))) : null,
        h("div", { class: "field" }, T("snap.category", null, "label", { for: "snapcat" }), catSel),
        h("div", { class: "items-head" }, T("snap.items", null, "h3", { tabindex: "-1", "data-autofocus": "" }), T("snap.estimates", null, "span", { class: "chip" })),
        h("div", { class: "irow2 hdr", "aria-hidden": "true" }, T("snap.f.name"), T("snap.f.qty"), T("snap.f.unit"), T("snap.f.lb"), h("span")),
        itemsBody,
        h("datalist", { id: "snap-units" }, ["pieces", "loaves", "dozen", "trays", "hotel pan", "portions", "boxes", "lb", "bags"].map((u) => h("option", { value: u }))),
        h("button", { type: "button", class: "addbtn", onclick: addItem }, "+ ", T("snap.additem")),
        totalsEl,
        T("snap.estimate.note", null, "p", { class: "snap-fine" })),
      h("div", { class: "rev-right" }, h("div", { class: "chat-head" }, h("span", { class: "chat-av", "aria-hidden": "true" }, "LC"), h("div", {}, h("b", {}, "LastCall"), T("snap.chat.sub", null, "small"))), chatEl)), 1);
    renderItems(); renderTotals(); renderChat(false);
  }

  /* questions — only those still unanswered, one at a time */
  function pending() {
    if (!business.get()) return "business";
    if (!d.pickup || Date.parse(d.pickup) <= Date.now()) return "pickup";
    if (d.allergens === null) return "allergens";
    if (d.hot === null) return "hot";
    if (d.hot && !d.unsafePicked) return "which";
    if (!d.ack) return "ack";
    return null;
  }
  function bubble(who, ...kids) { return h("div", { class: "bub " + who }, ...kids); }
  function answered(qKey, aNode, reset) {
    return h("div", { class: "qa" }, bubble("bot", T(qKey)), bubble("me", aNode, h("button", { type: "button", class: "chg", onclick: () => { reset(); renderChat(); } }, T("snap.change"))));
  }
  function renderChat(focus = true) {
    if (!chatEl) return;
    stopListening();
    const log = [];
    const b = business.get();
    if (b) log.push(h("div", { class: "qa" }, bubble("bot", T("snap.q.business.known")), bubble("me", h("span", {}, b.name), h("small", { class: "hint" }, T("snap.q.business.hint")))));
    const pickupOk = d.pickup && Date.parse(d.pickup) > Date.now();
    if (pickupOk) log.push(answered("snap.q.pickup", h("span", {}, d.pickupKind ? T("pick." + d.pickupKind) : "", " · ", fmtTime(d.pickup)), () => { d.pickup = null; d.pickupKind = null; }));
    if (pickupOk && d.allergens !== null) log.push(answered("snap.q.allergens", d.allergens.length ? h("span", {}, d.allergens.map((a) => t("alg." + a)).join(", ")) : T("alg.none"), () => { d.allergens = null; }));
    if (pickupOk && d.allergens !== null && d.hot !== null) log.push(answered("snap.q.hot", T(d.hot ? "snap.yes" : "snap.no"), () => { d.hot = null; d.unsafe.clear(); d.unsafePicked = false; d.ack = false; renderItems(); renderTotals(); }));
    if (d.hot && d.unsafePicked) log.push(answered("snap.q.which", h("span", {}, d.items.filter((i) => d.unsafe.has(i.uid)).map((i) => i.name || "—").join(", ") || t("snap.none")), () => { d.unsafePicked = false; d.ack = false; }));
    const p = pending();
    let q;
    if (p === "business") q = qBusiness();
    else if (p === "pickup") q = qPickup();
    else if (p === "allergens") q = qAllergens();
    else if (p === "hot") q = qHot();
    else if (p === "which") q = qWhich();
    else if (p === "ack") q = qAck();
    else q = qDone();
    chatEl.replaceChildren(...log, q);
    if (focus) { const f = q.querySelector("[data-qfocus]"); if (f) f.focus({ preventScroll: false }); }
  }
  function next() { renderChat(); }
  function micBtn(onText) {
    const status = h("p", { class: "mic-st", role: "status" });
    if (!speechSupported()) return h("div", { class: "mic" }, h("button", { type: "button", class: "micbtn", disabled: true }, micIcon(), T("mic.btn")), T("mic.unsupported", null, "p", { class: "mic-st" }));
    const btn = h("button", { type: "button", class: "micbtn", "aria-pressed": "false" }, micIcon(), T("mic.btn"));
    btn.addEventListener("click", () => {
      if (btn.getAttribute("aria-pressed") === "true") { stopListening(); btn.setAttribute("aria-pressed", "false"); tx(status, "mic.stopped"); return; }
      if (isCallActive && isCallActive()) { tx(status, "mic.oncall"); return; }
      listen({
        onState: (s, key) => {
          btn.setAttribute("aria-pressed", String(s === "listening"));
          btn.classList.toggle("on", s === "listening");
          if (s === "listening") tx(status, "mic.listening"); else if (s === "error") tx(status, key); else if (status.dataset.i18n === "mic.listening") tx(status, "mic.stopped");
        },
        onResult: (txt, fin) => { tx(status, "mic.heard", { text: txt }); if (fin) { btn.classList.remove("on"); btn.setAttribute("aria-pressed", "false"); onText(txt, status); } },
      });
    });
    return h("div", { class: "mic" }, btn, status);
  }
  function qWrap(key, vars, ...kids) { return h("div", { class: "q" }, bubble("bot", T(key, vars)), h("div", { class: "q-ctl" }, ...kids)); }
  function qBusiness() {
    const list = business.list() || [];
    const sel = h("select", { class: "in", "data-qfocus": "", id: "qbiz" }, T("snap.q.business.pick", null, "option", { value: "" }), list.map((b) => h("option", { value: String(b.id) }, b.name)));
    return qWrap("snap.q.business", null, h("div", { class: "row" }, sel, T("snap.ok", null, "button", { type: "button", class: "tel-sm", onclick: () => { if (sel.value) { business.set(sel.value); next(); } } })));
  }
  function setPickup(kind, date) { d.pickup = date.toISOString(); d.pickupKind = kind; next(); }
  function qPickup() {
    const now = Date.now();
    const in30 = new Date(now + 30 * 60000), b8 = deadlineAt(20), b9 = deadlineAt(21);
    const chip = (kind, date, focus) => {
      const past = date.getTime() - now < 10 * 60000;
      return h("button", { type: "button", class: "qchip", disabled: past, "data-qfocus": focus && !past ? "" : null, onclick: () => setPickup(kind, date) }, T("pick." + kind), h("small", {}, past ? t("pick.past") : fmtTime(date)));
    };
    const custom = h("input", { type: "datetime-local", class: "in", id: "qcustom" });
    custom.min = toPacificInput(new Date(now + 5 * 60000)); custom.value = toPacificInput(new Date(now + 90 * 60000));
    const err = h("p", { class: "q-err", role: "alert" });
    const past = (now > b9.getTime() - 10 * 60000);
    return qWrap("snap.q.pickup", null,
      h("div", { class: "chips" }, chip("in30", in30, true), chip("by8", b8), chip("by9", b9)),
      past ? T("pick.late", null, "p", { class: "hint" }) : null,
      h("div", { class: "row" }, T("pick.custom", null, "label", { for: "qcustom", class: "lbl" }), custom,
        T("snap.set", null, "button", { type: "button", class: "tel-sm", onclick: () => {
          const v = fromPacificInput(custom.value);
          if (!v || isNaN(v) || v.getTime() <= Date.now() + 60000) { tx(err, "pick.err.past"); custom.focus(); return; }
          setPickup("custom", v);
        } })),
      err,
      micBtn((txt, st) => {
        const s = txt.toLowerCase();
        if (/30|treinta|三十|半/.test(s)) return setPickup("in30", new Date(Date.now() + 30 * 60000));
        if (/\b9\b|nine|nueve|九/.test(s) && b9.getTime() - Date.now() > 10 * 60000) return setPickup("by9", b9);
        if (/\b8\b|eight|ocho|八/.test(s) && b8.getTime() - Date.now() > 10 * 60000) return setPickup("by8", b8);
        tx(st, "mic.pickup.miss", { text: txt });
      }));
  }
  function qAllergens() {
    const chosen = new Set(d.suggest);
    let none = false;
    const chips = ALLERGENS.map((a) => {
      const b = h("button", { type: "button", class: "qchip tog" + (d.suggest.includes(a) ? " sug" : ""), "aria-pressed": String(chosen.has(a)), onclick: () => { chosen.has(a) ? chosen.delete(a) : chosen.add(a); none = false; sync(); } }, T("alg." + a));
      b.dataset.a = a; return b;
    });
    const noneB = h("button", { type: "button", class: "qchip tog none", "aria-pressed": "false", onclick: () => { none = !none; if (none) chosen.clear(); sync(); } }, T("alg.none"));
    const err = h("p", { class: "q-err", role: "alert" });
    function sync() { chips.forEach((b) => b.setAttribute("aria-pressed", String(chosen.has(b.dataset.a)))); noneB.setAttribute("aria-pressed", String(none)); }
    const confirm = T("snap.allergens.confirm", null, "button", { type: "button", class: "tel-sm", "data-qfocus": "", onclick: () => {
      if (!chosen.size && !none) { tx(err, "snap.allergens.err"); return; }
      d.allergens = [...chosen]; next();
    } });
    return qWrap("snap.q.allergens", null,
      d.suggest.length ? T("snap.allergens.sug", null, "p", { class: "hint" }) : T("snap.allergens.nosug", null, "p", { class: "hint" }),
      h("div", { class: "chips" }, chips, noneB), err, h("div", { class: "row" }, confirm),
      micBtn((txt, st) => {
        if (NONE_WORDS.test(txt)) { none = true; chosen.clear(); sync(); tx(st, "mic.allergens.tapconfirm"); return; }
        const low = txt.toLowerCase(); let hit = false;
        ALLERGENS.forEach((a) => { if (ALG_WORDS[a].some((w) => low.includes(w))) { chosen.add(a); hit = true; } });
        none = false; sync(); tx(st, hit ? "mic.allergens.tapconfirm" : "mic.miss", { text: txt });
      }));
  }
  function setHot(v) {
    d.hot = v;
    if (!v) { d.unsafe.clear(); d.unsafePicked = false; }
    renderItems(); renderTotals(); next();
  }
  function qHot() {
    return qWrap("snap.q.hot", null, T("snap.q.hot.why", null, "p", { class: "hint" }),
      h("div", { class: "chips" },
        h("button", { type: "button", class: "qchip big", "data-qfocus": "", onclick: () => setHot(false) }, T("snap.no.hot")),
        h("button", { type: "button", class: "qchip big warn", onclick: () => setHot(true) }, T("snap.yes.hot"))),
      micBtn((txt, st) => { if (NO.test(txt)) setHot(false); else if (YES.test(txt)) setHot(true); else tx(st, "mic.miss", { text: txt }); }));
  }
  function qWhich() {
    const picks = new Set(d.unsafe);
    const boxes = d.items.map((it) => {
      const id = "uns" + it.uid;
      const cb = h("input", { type: "checkbox", id, checked: picks.has(it.uid), onchange: (e) => { e.target.checked ? picks.add(it.uid) : picks.delete(it.uid); } });
      return h("label", { class: "chk", for: id }, cb, h("span", {}, it.name || "—", h("small", {}, " ~" + fmtNum(num(it.est_pounds) || 0, 1) + " lb")));
    });
    const err = h("p", { class: "q-err", role: "alert" });
    if (boxes[0]) boxes[0].querySelector("input").setAttribute("data-qfocus", "");
    return qWrap("snap.q.which", null, T("snap.q.which.why", null, "p", { class: "hint" }), h("div", { class: "chks" }, boxes), err,
      h("div", { class: "row" },
        T("snap.block.confirm", null, "button", { type: "button", class: "tel-sm", onclick: () => {
          if (!picks.size) { tx(err, "snap.block.err"); return; }
          d.unsafe = picks; d.unsafePicked = true; renderItems(); renderTotals();
          say("snap.blocked.live", { n: picks.size }); next();
        } }),
        T("snap.block.all", null, "button", { type: "button", class: "tel-sm ghost", onclick: () => { d.unsafe = new Set(d.items.map((i) => i.uid)); d.unsafePicked = true; renderItems(); renderTotals(); next(); } })));
  }
  function qAck() {
    if (!eligible().length) {
      return h("div", { class: "q blockedall" }, bubble("bot", T("snap.allblocked.title", null, "b"), T("snap.allblocked.body", null, "p")),
        h("div", { class: "q-ctl" }, h("div", { class: "row" },
          T("snap.allblocked.redo", null, "button", { type: "button", class: "tel-sm ghost", "data-qfocus": "", onclick: () => { d.hot = null; d.unsafe.clear(); d.unsafePicked = false; renderItems(); renderTotals(); next(); } }),
          T("snap.startover", null, "button", { type: "button", class: "tel-sm", onclick: () => chooseView() }))));
    }
    const cb = h("input", { type: "checkbox", id: "qack", "data-qfocus": "" });
    const err = h("p", { class: "q-err", role: "alert" });
    return qWrap("snap.q.ack", null,
      d.unsafe.size ? h("p", { class: "blocknote" }, T("snap.blocked.note", { n: d.unsafe.size })) : null,
      h("label", { class: "chk ack", for: "qack" }, cb, T("snap.ack.text")),
      err,
      h("div", { class: "row" }, T("snap.ok", null, "button", { type: "button", class: "tel-sm", onclick: () => { if (!cb.checked) { tx(err, "snap.ack.err"); cb.focus(); return; } d.ack = true; next(); } })));
  }
  function problems() {
    const out = [];
    if (!d.items.length) out.push("snap.v.noitems");
    if (d.items.some((i) => !i.name.trim())) out.push("snap.v.names");
    if (d.items.some((i) => !(num(i.est_pounds) > 0))) out.push("snap.v.pounds");
    if (d.items.some((i) => i.quantity !== "" && !(num(i.quantity) > 0))) out.push("snap.v.qty");
    if (!d.category) out.push("snap.v.category");
    if (!eligible().length) out.push("snap.v.allblocked");
    return out;
  }
  function qDone() {
    const probs = problems();
    const err = h("ul", { class: "q-err list", role: "alert" }, probs.map((k) => T(k, null, "li")));
    return h("div", { class: "q" }, bubble("bot", T("snap.q.done")), h("div", { class: "q-ctl" }, probs.length ? err : null,
      h("button", { type: "button", class: "tel big go", "data-qfocus": "", onclick: () => {
        const p = problems();
        if (p.length) { renderChat(); itemsBody.querySelectorAll(".irow2").forEach((r) => r._validate && r._validate()); if (!d.category) catSel.focus(); return; }
        summaryView();
      } }, T("snap.review.btn"), h("span", { "aria-hidden": "true" }, " →"))));
  }

  /* ---------- 4. summary ---------- */
  function summaryView(errKey, errText) {
    const b = business.get();
    if (!b || pending()) { reviewView(); return; }
    const el = eligible();
    const blocked = d.items.filter((i) => d.unsafe.has(i.uid));
    const editBtn = () => T("snap.edit", null, "button", { type: "button", class: "linkbtn ink", onclick: () => reviewView() });
    const row = (k, v) => h("div", { class: "sum-row" }, T(k, null, "dt"), h("dd", {}, v, editBtn()));
    const go = h("button", { type: "button", class: "tel big go", "data-autofocus": "", onclick: () => submit(go) }, T("snap.find"), h("span", { "aria-hidden": "true" }, " →"));
    const msg = h("div", { class: "sub-msg", role: "alert" }, errKey ? T(errKey, null, "p") : null, errText ? h("p", { class: "srvmsg" }, errText) : null);
    view(h("div", { class: "summary" },
      h("div", { class: "sum-card" },
        h("div", { class: "sum-top" }, T("snap.summary", null, "h3", { tabindex: "-1" }), d.isSample ? T("snap.sampletag", null, "span", { class: "tag demo" }) : null, d.source === "sample_fallback" ? T("snap.src.fallback", null, "span", { class: "tag demo" }) : null),
        h("dl", {},
          h("div", { class: "sum-row" }, T("snap.sum.business", null, "dt"), h("dd", {}, b.name)),
          row("snap.sum.items", h("ul", { class: "sum-items" }, el.map((i) => h("li", {}, h("span", {}, i.name), h("span", { class: "mono" }, [i.quantity, i.unit].filter(Boolean).join(" ") + " · ~" + fmtNum(num(i.est_pounds), 1) + " lb"))))),
          blocked.length ? h("div", { class: "sum-row warn" }, T("snap.sum.blocked", null, "dt"), h("dd", {}, blocked.map((i) => i.name).join(", "))) : null,
          row("snap.sum.total", h("strong", {}, "~" + fmtNum(total(), 1) + " lb")),
          row("snap.sum.category", T("cat." + d.category)),
          row("snap.sum.allergens", d.allergens.length ? d.allergens.map((a) => t("alg." + a)).join(", ") : T("alg.none")),
          row("snap.sum.pickup", fmtTime(d.pickup, { weekday: "short", hour: "numeric", minute: "2-digit" })),
          h("div", { class: "sum-row" }, T("snap.sum.safety", null, "dt"), h("dd", {}, T("snap.sum.safety.ok"))))),
      msg,
      h("div", { class: "sum-actions" },
        h("button", { type: "button", class: "tel-sm ghost", onclick: () => reviewView() }, "← ", T("snap.back")),
        go),
      T("snap.sum.fine", null, "p", { class: "snap-fine" })), 2);
  }
  async function submit(btn) {
    if (d.submitting || d.donationId) return;
    if (Date.parse(d.pickup) <= Date.now() + 60000) { d.pickup = null; reviewView(); say("pick.err.past"); return; }
    const b = business.get(); if (!b) return reviewView();
    d.submitting = true; btn.disabled = true; btn.classList.add("busy");
    tx(btn.firstChild, "snap.finding");
    const body = {
      business_id: Number(b.id),
      items: d.items.map((i) => ({ name: i.name.trim() || "item", quantity: num(i.quantity) > 0 ? num(i.quantity) : 1, unit: i.unit.trim() || "pieces", est_pounds: Math.max(0.1, Math.round((num(i.est_pounds) || 0) * 10) / 10), ...(d.unsafe.has(i.uid) ? { unsafe: true } : {}) })),
      category: d.category,
      allergens: d.allergens.length ? d.allergens.join(", ") : "none",
      pickup_deadline: new Date(d.pickup).toISOString(),
      safety_confirmed: true,
      idempotency_key: d.key, // stable across retries of this draft
      is_sample: !!d.isSample,
    };
    try {
      const r = await api("/donations/intake", { method: "POST", body });
      d.submitting = false;
      d.donationId = r.donation_id; d.result = r;
      trackView(r);
    } catch (e) {
      d.submitting = false;
      summaryView(e.status === 400 || e.status === 422 ? "snap.sub.err.invalid" : e.status === 409 ? "snap.sub.err.conflict" : e.status ? "snap.sub.err.server" : "snap.sub.err.network", e.status ? e.message : "");
    }
  }

  /* ---------- 5. tracking ---------- */
  function trackView(r) {
    if (tracker) tracker.stop();
    tracker = createTracker({
      id: r.donation_id, initial: r, BASE,
      onAgain: () => { const old = d; d = newDraft(); Object.assign(d, { photo: old.photo, source: old.source, isSample: old.isSample, sampleId: old.sampleId, items: old.items.filter((i) => !old.unsafe.has(i.uid)).map((i) => mkItem(i)), category: old.category, suggest: old.allergens || [], confidence: old.confidence }); reviewView(); },
      onNew: () => chooseView(),
    });
    view(tracker.el, 3);
  }

  onLang(() => { if (d && d.pickup && chatEl && chatEl.isConnected) { /* times re-format on next render; keep focus */ } });

  function open() {
    root.hidden = false;
    if (!d || (!d.items.length && !d.photo && !d.donationId)) chooseView();
    root.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    root.querySelector("#snaph").focus({ preventScroll: true });
  }
  function close() { ++scanGen; if (scanAbort) scanAbort.abort(); stopListening(); root.hidden = true; }
  return {
    root, open, close,
    businessChanged() { if (!root.hidden && chatEl && chatEl.isConnected) renderChat(false); },
    teardown() { ++scanGen; if (scanAbort) scanAbort.abort(); stopListening(); if (tracker) tracker.stop(); },
    resume() { if (tracker && d && d.donationId) tracker.start(); },
  };
}

function ic(path) { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("aria-hidden", "true"); s.innerHTML = path; return s; }
const camIcon = () => ic('<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.6" fill="none" stroke="currentColor" stroke-width="1.8"/>');
const upIcon = () => ic('<path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4"/>');
const micIcon = () => ic('<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');
