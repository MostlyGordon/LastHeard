// Peanut (peanut.pa7lim.nl, David PA7LIM) YSF/Fusion last-heard poller.
//
// Peanut exposes a clean JSON lastheard list but sends no CORS headers, so the
// browser can't fetch it directly — we poll the Cloudflare Worker proxy every
// 30s. Each row is a transmission with a real RFC-2822 timestamp, so alarm and
// sticky-window timing are correct. Peanut exposes no names, so they're resolved
// via HamDB in the UI (like D-STAR).

import { fetchPeanutLastHeard } from "./api.js";
import { merge } from "./store.js";

const POLL_MS = 30000;

export function startPeanutPolling({ onStatus } = {}) {
  let timer = null;
  let stopped = false;
  let first = true;

  async function tick() {
    if (stopped) return;
    try {
      const records = await fetchPeanutLastHeard();
      merge(records, { suppressNew: first });
      first = false;
      onStatus?.("ok");
    } catch (err) {
      onStatus?.("error");
    } finally {
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    }
  }

  onStatus?.("loading");
  tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}