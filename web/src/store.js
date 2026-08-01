// Central state store with a tiny event emitter.

const STICKY_MS = 10 * 60 * 1000; // keep stations for 10 minutes after last heard

class Emitter {
  constructor() {
    this._h = new Map();
  }
  on(event, fn) {
    if (!this._h.has(event)) this._h.set(event, new Set());
    this._h.get(event).add(fn);
    return () => this._h.get(event)?.delete(fn);
  }
  emit(event, payload) {
    this._h.get(event)?.forEach((fn) => fn(payload));
  }
}

export const store = Object.assign(new Emitter(), {
  // callsign -> { callsign, module, lastHeardAt, system, nodeLabel, location, mode, fresh }
  heard: new Map(),
  // callsign -> last seen transmission ISO (for detecting new transmissions)
  previousTimes: new Map(),
  watchlist: new Set(loadWatchlist()),
  filter: localStorage.getItem("lastheard:filter") || "",
  firstPoll: true,
});

function loadWatchlist() {
  try {
    return JSON.parse(localStorage.getItem("lastheard:watchlist") || "[]");
  } catch {
    return [];
  }
}

function saveWatchlist() {
  localStorage.setItem("lastheard:watchlist", JSON.stringify([...store.watchlist]));
}

export function setFilter(text) {
  store.filter = (text || "").toLowerCase();
  localStorage.setItem("lastheard:filter", text || "");
  store.emit("change");
}

export function addWatch(call) {
  call = call.toUpperCase().trim();
  if (!call || store.watchlist.has(call)) return;
  store.watchlist.add(call);
  saveWatchlist();
  store.emit("watchlist");
  store.emit("change");
}

export function removeWatch(call) {
  if (!store.watchlist.delete(call)) return;
  saveWatchlist();
  store.emit("watchlist");
  store.emit("change");
}

// Merge a fresh batch of records from the worker. Emits "alarm" for watched
// callsigns whose transmission time advanced (skipped on the first poll so we
// don't alarm for stations already on air at load time).
export function merge(records) {
  const now = Date.now();
  const alarms = [];

  for (const r of records) {
    const call = r.callsign;
    if (!call) continue;
    const prev = store.previousTimes.get(call);
    const isNew = !prev;
    const advanced = prev && r.time > prev;

    store.previousTimes.set(call, r.time);

    const entry = store.heard.get(call);
    const fresh = (isNew && !store.firstPoll) || advanced;
    store.heard.set(call, {
      callsign: call,
      module: r.module || "",
      lastHeardAt: r.time,
      system: r.system || "",
      nodeLabel: r.nodeLabel || "",
      location: r.location || "",
      mode: r.mode || "D-STAR",
      fresh,
    });

    if (fresh && store.watchlist.has(call)) {
      alarms.push({ call, time: r.time });
    }
  }

  store.firstPoll = false;
  prune(now);

  for (const a of alarms) store.emit("alarm", a);
  store.emit("change");
}

// Drop entries older than the sticky window.
export function prune(now = Date.now()) {
  let changed = false;
  for (const [call, entry] of store.heard) {
    if (now - new Date(entry.lastHeardAt).getTime() > STICKY_MS) {
      store.heard.delete(call);
      changed = true;
    }
  }
  return changed;
}

// Clear "fresh" flags after rendering so a flash only shows once.
export function clearFresh() {
  let changed = false;
  for (const entry of store.heard.values()) {
    if (entry.fresh) {
      entry.fresh = false;
      changed = true;
    }
  }
  return changed;
}

// Visible, filtered, newest-first list.
export function visibleList() {
  const f = store.filter.trim();
  const all = [...store.heard.values()];
  const filtered = f
    ? all.filter((e) =>
        `${e.callsign} ${e.location} ${e.system} ${e.nodeLabel}`.toLowerCase().includes(f)
      )
    : all;
  filtered.sort((a, b) => (a.lastHeardAt < b.lastHeardAt ? 1 : a.lastHeardAt > b.lastHeardAt ? -1 : 0));
  return filtered;
}