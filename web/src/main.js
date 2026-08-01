import "./styles.css";
import { startPolling } from "./api.js";
import { merge, prune, store } from "./store.js";
import { startBrandmeister } from "./bm.js";
import { startVkPolling } from "./vk.js";
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

// Poll the worker for D-STAR. Suppress alarms for stations already on air on
// the very first poll; after that, every new transmission can alarm.
setStatus("loading");
let firstDstar = true;
const stop = startPolling(
  (records) => {
    merge(records, { suppressNew: firstDstar });
    firstDstar = false;
    setStatus("ok");
  },
  () => setStatus("error"),
  30000
);

// Brandmeister DMR live stream (Socket.IO). Toggleable + persisted.
const bmToggle = $("bm-toggle");
let stopBm = null;

function bmButton(state) {
  bmToggle.classList.toggle("on", state === "connected");
  bmToggle.classList.toggle("err", state === "error");
  bmToggle.textContent = {
    connected: "DMR ●",
    connecting: "DMR ◌",
    error: "DMR ✕",
    off: "DMR ○",
  }[state] || "DMR";
}

function bmStart() {
  if (stopBm) return;
  bmButton("connecting");
  stopBm = startBrandmeister({
    onStatus: (s) => bmButton(s === "connect_error" ? "error" : s === "connected" ? "connected" : "connecting"),
  });
}

function bmStop() {
  if (stopBm) {
    stopBm();
    stopBm = null;
  }
  bmButton("off");
}

let bmEnabled = localStorage.getItem("lastheard:bm") !== "0";
bmToggle.addEventListener("click", () => {
  bmEnabled = !bmEnabled;
  localStorage.setItem("lastheard:bm", bmEnabled ? "1" : "0");
  if (bmEnabled) bmStart();
  else bmStop();
});
if (bmEnabled) bmStart();
else bmButton("off");

// VK DMR (ipsc3.vkdmr.com) — polled via the worker, toggleable + persisted.
const vkToggle = $("vk-toggle");
let stopVk = null;

function vkButton(state) {
  vkToggle.classList.toggle("on", state === "connected");
  vkToggle.classList.toggle("err", state === "error");
  vkToggle.textContent = {
    connected: "VK ●",
    connecting: "VK ◌",
    error: "VK ✕",
    off: "VK ○",
  }[state] || "VK";
}

function vkStart() {
  if (stopVk) return;
  vkButton("connecting");
  stopVk = startVkPolling({
    onStatus: (s) => vkButton(s === "error" ? "error" : s === "ok" ? "connected" : "connecting"),
  });
}

function vkStop() {
  if (stopVk) {
    stopVk();
    stopVk = null;
  }
  vkButton("off");
}

let vkEnabled = localStorage.getItem("lastheard:vk") !== "0";
vkToggle.addEventListener("click", () => {
  vkEnabled = !vkEnabled;
  localStorage.setItem("lastheard:vk", vkEnabled ? "1" : "0");
  if (vkEnabled) vkStart();
  else vkStop();
});
if (vkEnabled) vkStart();
else vkButton("off");

// Service worker update prompt (vite-plugin-pwa, autoUpdate).
import { registerSW } from "virtual:pwa-register";
registerSW({
  onNeedRefresh() {
    if (confirm("A new version of LastHeard is available. Reload?")) location.reload();
  },
});