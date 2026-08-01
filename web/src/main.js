import "./styles.css";
import { startPolling } from "./api.js";
import { merge, prune, store } from "./store.js";
import { initList } from "./ui/list.js";
import { initFilter } from "./ui/filter.js";
import { initAlarm, requestNotifyPermission } from "./ui/alarm.js";

const $ = (id) => document.getElementById(id);

const status = $("status");
function setStatus(state) {
  status.className = `status ${state}`;
  status.title =
    state === "ok" ? "Up to date" : state === "loading" ? "Polling…" : "Poll failed — retrying";
}

// Wire UI.
initList($("list"), $("empty"));
initFilter($("filter"));
initAlarm({
  toggle: $("alarm-toggle"),
  form: $("watch-form"),
  input: $("watch-input"),
});

// Ask for notification permission on the first user interaction.
window.addEventListener(
  "click",
  () => requestNotifyPermission(),
  { once: true, passive: true }
);

// Prune sticky-window entries every 5s; re-render if anything dropped.
setInterval(() => {
  if (prune()) store.emit("change");
}, 5000);

// Poll the worker.
setStatus("loading");
const stop = startPolling(
  (records) => {
    merge(records);
    setStatus("ok");
  },
  () => setStatus("error"),
  30000
);

// Service worker update prompt (vite-plugin-pwa, autoUpdate).
import { registerSW } from "virtual:pwa-register";
registerSW({
  onNeedRefresh() {
    if (confirm("A new version of LastHeard is available. Reload?")) location.reload();
  },
});