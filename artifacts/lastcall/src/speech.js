/* Browser SpeechRecognition — recognition only (no synthesis). One listener at a time. */
import { speechLang } from "./i18n.js";

const SR = typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const speechSupported = () => !!SR;
let active = null;

/** opts: { onResult(text, final), onState(state, errKey?) } — states: listening | idle | error */
export function listen(opts) {
  stopListening();
  if (!SR) { opts.onState && opts.onState("error", "mic.unsupported"); return null; }
  let rec;
  try { rec = new SR(); } catch { opts.onState && opts.onState("error", "mic.unsupported"); return null; }
  rec.lang = speechLang();
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  let done = false, errored = false;
  const me = { rec, stop: () => { try { rec.stop(); } catch { /* ignore */ } } };
  active = me;
  rec.onresult = (e) => {
    let txt = "", fin = false;
    for (let i = e.resultIndex; i < e.results.length; i++) { txt += e.results[i][0].transcript; if (e.results[i].isFinal) fin = true; }
    if (active === me) opts.onResult && opts.onResult(txt.trim(), fin);
  };
  rec.onerror = (e) => {
    errored = true;
    if (active !== me) return;
    const key = e.error === "not-allowed" || e.error === "service-not-allowed" ? "mic.denied"
      : e.error === "no-speech" ? "mic.nospeech" : e.error === "aborted" ? null : "mic.error";
    if (key) opts.onState && opts.onState("error", key);
  };
  rec.onend = () => {
    if (done) return; done = true;
    if (active === me) { active = null; if (!errored) opts.onState && opts.onState("idle"); }
  };
  try { rec.start(); opts.onState && opts.onState("listening"); }
  catch { active = null; opts.onState && opts.onState("error", "mic.error"); return null; }
  return me;
}
export function stopListening() {
  if (!active) return;
  const a = active; active = null;
  try { a.rec.abort(); } catch { /* ignore */ }
}
