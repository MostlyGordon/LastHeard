// API + polling layer.

const BASE = import.meta.env.VITE_API_BASE || "http://localhost:8787";

export async function fetchLastHeard() {
  const res = await fetch(`${BASE}/api/lastheard`, { cache: "no-store" });
  if (!res.ok) throw new Error(`lastheard ${res.status}`);
  return res.json();
}

export async function fetchVkLastHeard() {
  const res = await fetch(`${BASE}/api/vk-lastheard`, { cache: "no-store" });
  if (!res.ok) throw new Error(`vk-lastheard ${res.status}`);
  return res.json();
}

export async function fetchPeanutLastHeard() {
  const res = await fetch(`${BASE}/api/peanut-lastheard`, { cache: "no-store" });
  if (!res.ok) throw new Error(`peanut-lastheard ${res.status}`);
  return res.json();
}

export async function fetchLookup(call) {
  const res = await fetch(`${BASE}/api/lookup?call=${encodeURIComponent(call)}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`lookup ${res.status}`);
  return res.json();
}

// Poll every `intervalMs`, calling onRecords with each batch. Returns stop().
export function startPolling(onRecords, onError, intervalMs = 30000) {
  let timer = null;
  let stopped = false;

  async function tick() {
    if (stopped) return;
    try {
      const records = await fetchLastHeard();
      onRecords(records);
    } catch (err) {
      onError(err);
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  }

  tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}