// Brandmeister DMR live stream.
//
// Brandmeister has no REST lastheard endpoint; its dashboard feeds a Socket.IO
// stream at wss://api.brandmeister.network (path /lh/socket.io). We connect the
// browser directly (tested: cross-origin websocket is accepted), join the
// "everything" feed, and turn Session-Start voice events into DMR records that
// flow into the same store as the D-STAR scrape. BM payloads include SourceName,
// so DMR names need no HamDB lookup.

import { io } from "socket.io-client";
import { merge } from "./store.js";
import { setName } from "./ui/list.js";

const BUFFER_MS = 1000; // batch events into one merge/render per second

export function startBrandmeister({ onStatus } = {}) {
  const sio = io("https://api.brandmeister.network", {
    path: "/lh/socket.io",
    transports: ["websocket"],
    reconnection: true,
    reconnectionDelay: 2000,
  });

  let buffer = [];
  let flushTimer = null;

  const flush = () => {
    flushTimer = null;
    if (buffer.length) {
      const batch = buffer;
      buffer = [];
      merge(batch, { suppressNew: false });
    }
  };
  const scheduleFlush = () => {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, BUFFER_MS);
  };

  sio.on("connect", () => {
    sio.emit("join", "everything");
    onStatus?.("connected");
  });
  sio.on("disconnect", () => onStatus?.("disconnect"));
  sio.on("connect_error", () => onStatus?.("connect_error"));

  sio.on("mqtt", (msg) => {
    const rec = parseBm(msg);
    if (!rec) return;
    if (rec.name) setName(rec.callsign, { name: rec.name, status: "OK" });
    buffer.push(rec);
    scheduleFlush();
  });

  return () => {
    sio.removeAllListeners();
    sio.disconnect();
    if (flushTimer) {
      clearTimeout(flushTimer);
      flush();
    }
  };
}

// Map a BM "mqtt" LH event to a store record.
function parseBm(msg) {
  if (!msg || msg.topic !== "LH") return null;
  let p;
  try {
    p = typeof msg.payload === "string" ? JSON.parse(msg.payload) : msg.payload;
  } catch {
    return null;
  }

  // Only voice session starts = a station keying up.
  if (p.Event && p.Event !== "Session-Start") return null;
  const types = p.CallTypes || [];
  if (types.length && !types.includes("Voice")) return null;

  const call = (p.SourceCall || "").toUpperCase().trim();
  if (!call) return null;

  const time = p.Start ? new Date(p.Start * 1000).toISOString() : new Date().toISOString();
  const tg = p.DestinationName
    ? `${p.DestinationName} (TG ${p.DestinationID})`
    : `TG ${p.DestinationID || ""}`;
  const nodeLabel = [p.LinkTypeName, tg].filter(Boolean).join(" ");

  return {
    callsign: call,
    name: p.SourceName || "",
    module: p.Slot != null ? `S${p.Slot}` : "", // DMR timeslot 1/2
    time,
    system: p.LinkCall || "", // repeater/link callsign
    nodeLabel,
    location: "", // BM LH stream has no geographic location
    mode: "DMR",
    source: "Brandmeister",
  };
}