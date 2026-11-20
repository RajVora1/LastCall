/* On-duty pantry operations: recipient selection, needs board editing, pickups list.
   Background refreshes never replace an input that is focused or has unsaved edits. */
import { h, api } from "./dom.js";
import { T, t, tx, ta, fmtNum, fmtTime, needLabel, onLang } from "./i18n.js";

const RKEY = "lastcall.pantryRecipient";
const SUGGEST = ["bread", "vegetables", "fruit", "protein", "meals", "packaged", "dairy", "produce", "baby food"];

export function createPantryOps({ onRecipient }) {
  let recipients = [], selId = (() => { try { return localStorage.getItem(RKEY) || ""; } catch { return ""; } })();
  let needs = [], dirty = false, saving = false, alive = false, refT = null, donations = [], pickSig = "", busy = new Set(), localPicked = new Set();
  let recSig = "";

  const sel = h("select", { class: "in dark", id: "pp-rec", onchange: () => choose(sel.value) });
  const info = h("div", { class: "ops-info" });
  const chips = h("ul", { class: "needs", "aria-live": "polite" });
  const add = h("input", { type: "text", class: "in dark", id: "pp-need", maxlength: 40, autocomplete: "off", onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); addNeed(add.value); } } });
  ta(add, "placeholder", "ops.needs.ph");
  const addBtn = T("ops.add", null, "button", { type: "button", class: "tel-sm", onclick: () => addNeed(add.value) });
  const sugg = h("div", { class: "sugg" });
  const saveBtn = T("ops.save", null, "button", { type: "button", class: "tel-sm", disabled: true, onclick: save });
  const discardBtn = T("ops.discard", null, "button", { type: "button", class: "tel-sm ghost", disabled: true, onclick: () => { dirty = false; syncFromServer(true); } });
  const needMsg = h("p", { class: "ops-msg", role: "status" });
  const pickList = h("ul", { class: "picks" });
  const pickMsg = h("p", { class: "ops-msg", role: "status" });
  const el = h("section", { class: "ops" },
    h("div", { class: "ops-block" }, T("ops.pantry", null, "label", { for: "pp-rec", class: "ops-l" }), sel, info),
    h("div", { class: "ops-block" },
      h("div", { class: "ops-h" }, T("ops.needs", null, "h3"), T("ops.needs.sub", null, "small")),
      chips,
      h("div", { class: "ops-add" }, h("label", { for: "pp-need", class: "sr" }, T("ops.needs.ph")), add, addBtn),
      sugg,
      h("div", { class: "pp-row left" }, saveBtn, discardBtn), needMsg),
    h("div", { class: "ops-block" },
      h("div", { class: "ops-h" }, T("ops.pickups", null, "h3"), T("ops.pickups.sub", null, "small")),
      pickList, pickMsg));

  const current = () => recipients.find((r) => String(r.id) === String(selId)) || null;
  function choose(id) {
    if (dirty && !confirm(t("ops.unsaved"))) { sel.value = selId; return; }
    selId = String(id); dirty = false;
    try { localStorage.setItem(RKEY, selId); } catch { /* ignore */ }
    renderInfo(); syncFromServer(true); pickSig = ""; renderPicks();
    onRecipient && onRecipient(current());
  }
  function setDirty(v) { dirty = v; saveBtn.disabled = !v || saving; discardBtn.disabled = !v || saving; if (v) tx(needMsg, "ops.unsavedmsg"); }
  function addNeed(v) {
    v = String(v || "").trim().toLowerCase().slice(0, 40);
    if (!v) return;
    if (needs.length >= 12) { tx(needMsg, "ops.toomany"); return; }
    if (!needs.includes(v)) { needs = [...needs, v]; setDirty(true); }
    add.value = ""; renderChips(); add.focus();
  }
  function renderChips() {
    chips.replaceChildren(...(needs.length ? needs.map((n) => {
      const x = h("button", { type: "button", class: "nx", onclick: () => { needs = needs.filter((m) => m !== n); setDirty(true); renderChips(); add.focus(); } }, "×");
      ta(x, "aria-label", "ops.remove", { need: needLabel(n) });
      return h("li", { class: "need" }, h("span", {}, needLabel(n)), x);
    }) : [T("ops.needs.empty", null, "li", { class: "need empty" })]));
    sugg.replaceChildren(...SUGGEST.filter((s) => !needs.includes(s)).slice(0, 5).map((s) => h("button", { type: "button", class: "sg", onclick: () => addNeed(s) }, "+ " + needLabel(s))));
  }
  onLang(() => renderChips());
  function syncFromServer(force) {
    const r = current();
    if (!r) { needs = []; renderChips(); return; }
    if (dirty && !force) return;
    if (!force && (document.activeElement === add)) return;
    needs = Array.isArray(r.current_needs) ? [...r.current_needs] : [];
    setDirty(false); needMsg.textContent = ""; delete needMsg.dataset.i18n;
    renderChips();
  }
  async function save() {
    const r = current(); if (!r || saving) return;
    saving = true; saveBtn.disabled = discardBtn.disabled = true; tx(needMsg, "ops.saving");
    try {
      const upd = await api("/recipients/" + r.id + "/needs", { method: "PATCH", body: { current_needs: needs } });
      const i = recipients.findIndex((x) => x.id === r.id);
      if (i >= 0 && upd) recipients[i] = { ...recipients[i], ...upd };
      saving = false; dirty = false; syncFromServer(true); tx(needMsg, "ops.saved");
    } catch (e) {
      saving = false; setDirty(true); tx(needMsg, "ops.savefail", { code: e.status || "network" });
    }
  }
  function renderInfo() {
    const r = current();
    if (!r) { info.replaceChildren(); return; }
    const cap = Number(r.capacity_lbs) || 0, left = Number(r.capacity_left_lbs);
    const pct = cap ? Math.max(0, Math.min(100, ((cap - (isFinite(left) ? left : cap)) / cap) * 100)) : 0;
    info.replaceChildren(
      h("div", { class: "ops-facts" },
        (r.open_from || r.open_until) ? h("span", {}, T("ops.hours", { from: r.open_from || "—", until: r.open_until || "—" })) : null,
        h("span", {}, T(r.has_refrigeration ? "ops.fridge.yes" : "ops.fridge.no"))),
      cap ? h("div", { class: "cap" }, h("div", { class: "cap-l" }, T("ops.capacity", { left: fmtNum(isFinite(left) ? left : cap), cap: fmtNum(cap) })), h("div", { class: "cap-bar", "aria-hidden": "true" }, h("span", { style: `transform:scaleX(${pct / 100})` }))) : null);
  }
  function renderSelect() {
    const s = recipients.map((r) => r.id + r.name).join("|");
    if (s === recSig || document.activeElement === sel) return;
    recSig = s;
    sel.replaceChildren(...recipients.map((r) => h("option", { value: String(r.id) }, r.name)));
    if (!current()) {
      const bfn = recipients.find((r) => /berkeley food network/i.test(r.name)) || recipients[0];
      selId = bfn ? String(bfn.id) : "";
    }
    sel.value = selId;
  }
  async function loadRecipients() {
    try {
      const v = await api("/recipients");
      if (!alive) return;
      recipients = Array.isArray(v) ? v : [];
      renderSelect(); renderInfo(); syncFromServer(false);
      onRecipient && onRecipient(current());
      if (!recipients.length) { info.replaceChildren(T("ops.norec", null, "p", { class: "ops-msg" })); }
    } catch {
      if (!recipients.length) info.replaceChildren(h("div", { class: "ops-msg" }, T("ops.recfail"), " ", T("ops.retry", null, "button", { type: "button", class: "linkbtn light", onclick: loadRecipients })));
    }
  }
  function renderPicks() {
    const r = current();
    const mine = r ? donations.filter((d) => String(d.recipient_id) === String(r.id) && (d.status === "confirmed" || d.status === "picked_up"))
      .map((d) => (localPicked.has(d.id) ? { ...d, status: "picked_up" } : d))
      .sort((a, b) => (a.status === "confirmed" ? 0 : 1) - (b.status === "confirmed" ? 0 : 1) || Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 12) : [];
    const s = mine.map((d) => d.id + d.status).join(",") + "|" + (r && r.id);
    if (s === pickSig || busy.size) return;
    if (el.contains(document.activeElement) && pickList.contains(document.activeElement)) { /* keep focus target stable */ }
    pickSig = s;
    if (!mine.length) { pickList.replaceChildren(T("ops.picks.empty", null, "li", { class: "pick-empty" })); return; }
    pickList.replaceChildren(...mine.map((d) => {
      const done = d.status === "picked_up";
      const btn = done ? h("span", { class: "picked" }, "✓ ", T("ops.picked")) : T("ops.markpicked", null, "button", { type: "button", class: "tel-sm", onclick: (e) => markPicked(d, e.currentTarget) });
      return h("li", { class: "pk" + (done ? " done" : "") },
        h("div", {}, h("b", {}, d.business_name || "—"), h("p", {}, [d.items_description, d.estimated_pounds != null ? "~" + fmtNum(d.estimated_pounds, 1) + " lb" : ""].filter(Boolean).join(" · ")),
          h("small", {}, done && d.picked_up_at ? t("ops.pickedat", { time: fmtTime(d.picked_up_at) }) : d.pickup_eta ? t("ops.eta", { eta: d.pickup_eta }) : d.pickup_deadline ? t("ops.by", { time: /T/.test(d.pickup_deadline) ? fmtTime(d.pickup_deadline) : d.pickup_deadline }) : ""),
          d.is_demo ? T("tag.demo", null, "span", { class: "tag demo" }) : null),
        btn);
    }));
  }
  async function markPicked(d, btn) {
    const r = current(); if (!r || busy.has(d.id)) return;
    busy.add(d.id); btn.disabled = true; tx(btn, "ops.marking");
    try {
      await api("/donations/" + d.id + "/picked-up", { method: "POST", body: { recipient_id: Number(r.id) } });
      localPicked.add(d.id); tx(pickMsg, "ops.marked", { name: d.business_name || "" });
    } catch (e) {
      tx(pickMsg, e.status === 409 ? "ops.markconflict" : "ops.markfail", { code: e.status || "network" });
    }
    busy.delete(d.id); pickSig = ""; renderPicks();
  }
  return {
    el, current,
    start() { if (alive) return; alive = true; loadRecipients(); clearInterval(refT); refT = setInterval(() => { if (!saving) loadRecipients(); }, 15000); },
    stop() { alive = false; clearInterval(refT); },
    setDonations(list) {
      donations = list || [];
      donations.forEach((d) => { if (d.status === "picked_up") localPicked.delete(d.id); });
      renderPicks();
    },
  };
}
