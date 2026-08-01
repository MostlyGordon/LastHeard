// VK DMR (ipsc3.vkdmr.com / "IPSC3") last-heard poller.
//
// The VK dashboard is a server-rendered Next.js page with no public stream, so
// (like D-STAR) we poll the Cloudflare Worker that scrapes it. The worker
// returns up to ~30 recent radios with their real transmission epoch, so alarm
// and sticky-window timing are correct. VK records carry a Name, so we pre-fill
// the name cache and skip HamDB lookups for them.

import { fetchVkLastHeard } from "./api.js";
import { merge } from "./store.js";
import { setName } from "./ui/list.js";

const POLL_MS = 30000;

export function startVkPolling({ onStatus } = {}) {
  let timer = null;
  let stopped = false;
  let first = true;

  async function tick() {
    if (stopped) return;
    try {
      const records = await fetchVkLastHeard();
      for (const r of records) {
        if (r.name) setName(r.callsign, { name: r.name, status: "OK" });
      }
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