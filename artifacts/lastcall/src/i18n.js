/* Tiny i18n layer. Translated nodes carry data-i18n keys, so switching
   language rewrites text in place — nothing is remounted, so active calls,
   ringing and drafts survive. */
import { h } from "./dom.js";
import { DICT } from "./i18n-dict.js";

const KEY = "lastcall.lang";
export const LANGS = [["en", "EN", "English"], ["es", "ES", "Español"], ["zh", "中文", "中文"]];
const LOCALE = { en: "en-US", es: "es-US", zh: "zh-CN" };
const HTML_LANG = { en: "en", es: "es", zh: "zh-Hans" };

let lang = (() => { try { const v = localStorage.getItem(KEY); return DICT[v] ? v : "en"; } catch { return "en"; } })();
const subs = new Set();

export const getLang = () => lang;
export const locale = () => LOCALE[lang];
export const speechLang = () => LOCALE[lang];

export function t(key, vars) {
  const s = (DICT[lang] && DICT[lang][key]) ?? DICT.en[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)) : s;
}
/** Bind an element's text to a key (+ optional vars). */
export function tx(el, key, vars) {
  el.dataset.i18n = key;
  if (vars) el.dataset.i18nVars = JSON.stringify(vars); else delete el.dataset.i18nVars;
  el.textContent = t(key, vars);
  return el;
}
/** Create a translated element. */
export function T(key, vars, tag = "span", attrs) { return tx(h(tag, attrs || {}), key, vars); }
/** Bind an attribute (placeholder, aria-label, title) to a key. */
export function ta(el, attr, key, vars) {
  const map = el.dataset.i18nAttr ? JSON.parse(el.dataset.i18nAttr) : {};
  map[attr] = [key, vars || null];
  el.dataset.i18nAttr = JSON.stringify(map);
  el.setAttribute(attr, t(key, vars));
  return el;
}
export function apply(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    let vars = null;
    try { vars = el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : null; } catch { /* ignore */ }
    el.textContent = t(el.dataset.i18n, vars);
  });
  root.querySelectorAll("[data-i18n-attr]").forEach((el) => {
    try { Object.entries(JSON.parse(el.dataset.i18nAttr)).forEach(([a, [k, v]]) => el.setAttribute(a, t(k, v))); } catch { /* ignore */ }
  });
}
export function setLang(l) {
  if (!DICT[l] || l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  document.documentElement.lang = HTML_LANG[l];
  apply();
  subs.forEach((f) => { try { f(l); } catch { /* ignore */ } });
}
export function onLang(f) { subs.add(f); return () => subs.delete(f); }

export const fmtNum = (v, d = 0) => Number(v || 0).toLocaleString(LOCALE[lang], { maximumFractionDigits: d, minimumFractionDigits: d });
export const fmtMoney = (v) => Number(v || 0).toLocaleString(LOCALE[lang], { style: "currency", currency: "USD" });
export function fmtTime(s, opts = { hour: "numeric", minute: "2-digit" }) {
  const d = new Date(s); if (isNaN(d)) return String(s || "");
  return d.toLocaleString(LOCALE[lang], { timeZone: TZ, ...opts });
}
export const fmtDateTime = (s) => fmtTime(s, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Segmented EN / ES / 中文 switch. */
export function langSwitch() {
  const btns = LANGS.map(([code, label, full]) => h("button", {
    type: "button", lang: code, "aria-pressed": String(code === lang), title: full,
    onclick: () => setLang(code),
  }, label));
  const el = h("div", { class: "langsw", role: "group" }, btns);
  ta(el, "aria-label", "lang.label");
  onLang((l) => btns.forEach((b) => b.setAttribute("aria-pressed", String(b.getAttribute("lang") === l))));
  return el;
}
document.documentElement.lang = HTML_LANG[lang];

/* ---------- Pacific time helpers (all app dates/deadlines use America/Los_Angeles) ---------- */
export const TZ = "America/Los_Angeles";
const PF = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** Wall-clock parts of an instant in Pacific time. */
export function pacificParts(date = new Date()) {
  const o = {}; PF.formatToParts(date).forEach((p) => { if (p.type !== "literal") o[p.type] = Number(p.value); });
  if (o.hour === 24) o.hour = 0;
  return o;
}
/** Convert a Pacific wall-clock time to a Date (two-pass offset, DST safe). */
export function pacificToDate(y, mo, d, hh = 0, mi = 0) {
  const guess = Date.UTC(y, mo - 1, d, hh, mi);
  const off = (t) => { const p = pacificParts(new Date(t)); return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - t; };
  let t = guess - off(guess);
  t = guess - off(t);
  return new Date(t);
}
/** Today (Pacific) at the given hour. Never rolls to tomorrow. */
export function pacificTodayAt(hour, minute = 0) {
  const p = pacificParts(); return pacificToDate(p.year, p.month, p.day, hour, minute);
}
const pad2 = (n) => String(n).padStart(2, "0");
/** Date -> "YYYY-MM-DDTHH:mm" in Pacific, for datetime-local inputs. */
export function toPacificInput(date) {
  const p = pacificParts(date); return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`;
}
/** "YYYY-MM-DDTHH:mm" interpreted as Pacific -> Date (or null). */
export function fromPacificInput(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || ""); if (!m) return null;
  return pacificToDate(+m[1], +m[2], +m[3], +m[4], +m[5]);
}
export const fmtMonth = (date = new Date()) => date.toLocaleDateString(LOCALE[lang], { timeZone: TZ, month: "long", year: "numeric" });

/* ---------- canonical needs + templated match reasons ---------- */
const NEEDS = {
  bread: ["bread", "pan", "面包"], protein: ["protein", "proteína", "蛋白质"], vegetables: ["vegetables", "verduras", "蔬菜"],
  fruit: ["fruit", "fruta", "水果"], meals: ["meals", "comidas", "餐食"], packaged: ["packaged food", "alimentos empacados", "包装食品"],
  dairy: ["dairy", "lácteos", "乳制品"], produce: ["produce", "frutas y verduras", "果蔬"], "prepared meals": ["prepared meals", "comidas preparadas", "熟食"],
  rice: ["rice", "arroz", "大米"], snacks: ["snacks", "botanas", "零食"], "baby food": ["baby food", "comida para bebé", "婴儿食品"],
  bakery: ["bakery", "panadería", "烘焙"], prepared: ["prepared food", "comida preparada", "熟食"],
};
const LI = () => ({ en: 0, es: 1, zh: 2 })[lang] ?? 0;
/** Display label for a need; canonical values translate, custom text stays as entered. */
export function needLabel(n) {
  const k = String(n || "").trim().toLowerCase();
  return NEEDS[k] ? NEEDS[k][LI()] : String(n || "");
}
const R = {
  open: ["open till {t}", "abierto hasta {t}", "营业至 {t}"],
  needs: ["needs {n}", "necesita {n}", "需要{n}"],
  cap: ["{n} lb capacity left", "quedan {n} lb de capacidad", "剩余容量 {n} 磅"],
  fridge: ["refrigerated", "refrigerado", "有冷藏"],
  none: ["No eligible recipient before this deadline with the required category, capacity and refrigeration. All recipients that declined are excluded.",
    "Ningún destino elegible antes de este plazo con la categoría, capacidad y refrigeración necesarias. Se excluyen los que rechazaron.",
    "在截止时间前没有符合类别、容量和冷藏要求的接收方。已拒绝的接收方均已排除。"],
};
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]);
/** Translate templated server match_reason fragments; unknown fragments pass through unchanged. */
export function translateReason(s) {
  if (!s) return "";
  const i = LI(); if (i === 0) return String(s);
  if (String(s).trim() === R.none[0]) return R.none[i];
  return String(s).split(" · ").map((f) => {
    let m;
    if ((m = /^open till (.+)$/i.exec(f))) {
      const tm = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(m[1]);
      let t = m[1];
      if (tm) { const hh = (+tm[1] % 12) + (/pm/i.test(tm[3]) ? 12 : 0); t = new Date(2000, 0, 1, hh, +tm[2]).toLocaleTimeString(LOCALE[lang], { hour: "numeric", minute: "2-digit" }); }
      return fill(R.open[i], { t });
    }
    if ((m = /^needs (.+)$/i.exec(f))) return fill(R.needs[i], { n: needLabel(m[1]) });
    if ((m = /^([\d.,]+) lb capacity left$/i.exec(f))) return fill(R.cap[i], { n: m[1] });
    if (/^refrigerated$/i.test(f)) return R.fridge[i];
    return f;
  }).join(" · ");
}
