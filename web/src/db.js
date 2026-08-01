// Persistent callsign -> name/info cache backed by localStorage.
// Names rarely change, so lookups are cached indefinitely.

const PREFIX = "lastheard:name:";

export function getCached(call) {
  try {
    const raw = localStorage.getItem(PREFIX + call);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setCached(call, info) {
  try {
    localStorage.setItem(PREFIX + call, JSON.stringify({ ...info, ts: Date.now() }));
  } catch {
    /* storage full / unavailable; ignore */
  }
}

// In-flight lookups so we don't fire duplicate requests across polls.
const pending = new Map();

export function lookup(call, fetchLookup) {
  const cached = getCached(call);
  if (cached) return Promise.resolve(cached);

  if (pending.has(call)) return pending.get(call);

  const p = fetchLookup(call)
    .then((info) => {
      setCached(call, info);
      return info;
    })
    .finally(() => pending.delete(call));

  pending.set(call, p);
  return p;
}