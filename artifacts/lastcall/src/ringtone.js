/* Classic two-tone ringer (440 Hz + 480 Hz, 2s on / 2s off) synthesized with Web Audio. */
export function createRingtone() {
  let ctx = null, timer = null, live = [];

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { ctx = null; }
    return ctx;
  }
  /** Must be called from a user gesture. Resolves true if audio can play. */
  async function unlock() {
    const c = ensure();
    if (!c) return false;
    try {
      // a silent blip primes iOS Safari
      const b = c.createBuffer(1, 1, 22050), s = c.createBufferSource();
      s.buffer = b; s.connect(c.destination); s.start(0);
      if (c.state !== "running") await c.resume();
    } catch { /* ignore */ }
    return c.state === "running";
  }
  function burst() {
    if (navigator.vibrate) { try { navigator.vibrate([700, 250, 700]); } catch { /* ignore */ } }
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime + 0.02;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.14, t + 0.03);
    g.gain.setValueAtTime(0.14, t + 1.95);
    g.gain.linearRampToValueAtTime(0, t + 2);
    g.connect(ctx.destination);
    const oscs = [440, 480].map((f) => {
      const o = ctx.createOscillator();
      o.type = "sine"; o.frequency.value = f; o.connect(g); o.start(t); o.stop(t + 2.05);
      return o;
    });
    const rec = { g, oscs };
    live.push(rec);
    oscs[0].onended = () => { live = live.filter((x) => x !== rec); try { g.disconnect(); } catch { /* ignore */ } };
  }
  function start() {
    stop();
    burst();
    timer = setInterval(burst, 4000);
    return isAudible();
  }
  function stop() {
    clearInterval(timer); timer = null;
    live.forEach(({ g, oscs }) => { oscs.forEach((o) => { try { o.stop(); } catch { /* ignore */ } }); try { g.disconnect(); } catch { /* ignore */ } });
    live = [];
    if (navigator.vibrate) { try { navigator.vibrate(0); } catch { /* ignore */ } }
  }
  function isAudible() { return !!ctx && ctx.state === "running"; }
  function close() { stop(); if (ctx) { ctx.close().catch(() => {}); ctx = null; } }
  return { unlock, start, stop, isAudible, close, get ringing() { return !!timer; } };
}
