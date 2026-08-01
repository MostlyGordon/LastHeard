// Renders the heard-stations list.
import { visibleList, store, clearFresh, addWatch, removeWatch } from "../store.js";
import { lookup } from "../db.js";
import { fetchLookup } from "../api.js";

// callsign -> { name, qth, country, status } | { loading: true }
const names = new Map();

function relTime(iso) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 5) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ${mins % 60}m ago`;
}

function nameLabel(call) {
  const n = names.get(call);
  if (!n) return "…";
  if (n.loading) return "…";
  if (n.status === "NOT_FOUND" || n.status === "ERROR") return "(unknown)";
  return n.name || call;
}

function resolveName(call) {
  if (names.has(call)) return;
  names.set(call, { loading: true });
  lookup(call, fetchLookup)
    .then((info) => names.set(call, info))
    .catch(() => names.set(call, { status: "ERROR" }))
    .finally(() => render());
}

let container, empty;

export function initList(listEl, emptyEl) {
  container = listEl;
  empty = emptyEl;
  store.on("change", render);
  // Re-render periodically so relative times and prune stay current.
  setInterval(render, 5000);

  // Delegated click handler: toggle a station's callsign in the alarm watchlist.
  container.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".watch-btn");
    if (!btn) return;
    const call = btn.dataset.call;
    if (store.watchlist.has(call)) removeWatch(call);
    else addWatch(call);
  });

  render();
}

export function render() {
  if (!container) return;
  const items = visibleList();

  // Kick off name lookups for any visible callsign we haven't resolved.
  for (const e of items) resolveName(e.callsign);

  container.innerHTML = "";

  if (items.length === 0) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  const table = document.createElement("table");
  table.className = "lh-table";
  table.innerHTML = `<thead><tr>
    <th>Callsign</th><th>Name</th><th>Mode</th><th>Repeater / Reflector</th><th>Heard</th>
  </tr></thead>`;
  const body = document.createElement("tbody");
  table.appendChild(body);

  for (const e of items) {
    const watched = store.watchlist.has(e.callsign);
    const tr = document.createElement("tr");
    if (watched) tr.classList.add("watched");
    if (e.fresh) tr.classList.add("fresh");
    tr.innerHTML = `
      <td class="cs">
        <button class="watch-btn ${watched ? "on" : ""}" data-call="${escapeHtml(e.callsign)}" title="${watched ? "Remove from alarms" : "Add to alarms"}" aria-label="${watched ? "Remove " : "Add "}${escapeHtml(e.callsign)} to alarms">${watched ? "★" : "☆"}</button>
        <span class="call">${escapeHtml(e.callsign)}</span>
        ${e.module ? `<span class="module" title="Band/module">${escapeHtml(e.module)}</span>` : ""}
      </td>
      <td class="name">${escapeHtml(nameLabel(e.callsign))}</td>
      <td class="mode">${escapeHtml(e.mode)}</td>
      <td class="node">
        <span class="sys">${escapeHtml(e.system)}</span>
        <span class="nodelabel">${escapeHtml(e.nodeLabel)}</span>
        <span class="loc">${escapeHtml(e.location)}</span>
      </td>
      <td class="heard" title="${escapeHtml(e.lastHeardAt)}">${escapeHtml(relTime(e.lastHeardAt))}</td>
    `;
    body.appendChild(tr);
  }

  container.appendChild(table);

  // Clear one-shot "fresh" highlight flags after painting.
  if (clearFresh()) {
    // nothing to re-render now; flags cleared for next poll
  }
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}