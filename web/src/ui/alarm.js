// Alarm engine: watchlist editor + beep/flash on new transmissions.
import { store, addWatch, removeWatch } from "../store.js";
import { arm, disarm, beep } from "../audio.js";

const CALL_RE = /^[A-Z0-9]{1,3}[0-9][A-Z0-9]{0,3}$/;

let flashing = false;
let flashTimer = null;
let titleTimer = null;
const origTitle = document.title;

export function initAlarm({ toggle, form, input }) {
  // The sound toggle enables/disables the beep. The click is also the user
  // gesture that unlocks the Web Audio context. The watchlist + flash run
  // regardless of this toggle.
  toggle.addEventListener("click", () => {
    if (toggle.classList.contains("off")) {
      arm();
      toggle.classList.remove("off");
      toggle.textContent = "🔊 Sound on";
    } else {
      disarm();
      toggle.classList.add("off");
      toggle.textContent = "🔇 Sound off";
    }
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const val = input.value.toUpperCase().trim();
    if (!CALL_RE.test(val)) {
      input.setCustomValidity("Enter a valid callsign, e.g. M0LTP");
      input.reportValidity();
      return;
    }
    input.setCustomValidity("");
    addWatch(val);
    input.value = "";
  });

  store.on("watchlist", renderList);
  store.on("alarm", onAlarm);
  renderList();

  // Any user interaction cancels an active flash.
  document.addEventListener("click", stopFlash, { passive: true });
  document.addEventListener("keydown", stopFlash);
}

function renderList() {
  const listEl = document.getElementById("watch-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  if (store.watchlist.size === 0) {
    listEl.innerHTML = `<li class="hint">No callsigns watched. Add one above to be alerted when it comes on air.</li>`;
    return;
  }
  for (const call of store.watchlist) {
    const li = document.createElement("li");
    li.innerHTML = `<span class="wc">${escapeHtml(call)}</span>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "rm";
    btn.textContent = "✕";
    btn.title = "Remove";
    btn.addEventListener("click", () => removeWatch(call));
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

function onAlarm({ call }) {
  beep();
  flash(call);
  notify(call);
}

function flash(call) {
  document.body.classList.add("alarmed");
  document.title = `🔔 ${call} on air!`;
  flashing = true;
  // Flash the title between alert and normal.
  clearInterval(titleTimer);
  titleTimer = setInterval(() => {
    if (!flashing) return;
    document.title = document.title === origTitle ? `🔔 ${call} on air!` : origTitle;
  }, 1000);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(stopFlash, 15000);
}

function stopFlash() {
  if (!flashing) return;
  flashing = false;
  document.body.classList.remove("alarmed");
  clearInterval(titleTimer);
  clearTimeout(flashTimer);
  document.title = origTitle;
}

function notify(call) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    try {
      new Notification("LastHeard alarm", { body: `${call} is on air.`, icon: "/icon-192.png" });
    } catch {
      /* ignore */
    }
  }
}

export function requestNotifyPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}