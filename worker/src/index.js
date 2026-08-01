// LastHeard API — Cloudflare Worker
// Scrapes the D-STAR "last heard" HTML table from dsm.dstarusers.org and proxies
// HamDB callsign lookups, returning JSON for the LastHeard PWA.

const SRC_URL = "http://dsm.dstarusers.org/lastheard.php?refresh=1";
const VK_URL = "https://ipsc3.vkdmr.com/dashboard/radios";
const PEANUT_URL = "https://peanut.pa7lim.nl/api/lastheard.json";
const HAMDB_URL = (call) => `http://api.hamdb.org/v1/${call}/json/lastheard`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/api/lastheard") return handleLastHeard(request, ctx);
    if (url.pathname === "/api/vk-lastheard") return handleVkLastHeard(request, ctx);
    if (url.pathname === "/api/peanut-lastheard") return handlePeanutLastHeard(request, ctx);
    if (url.pathname === "/api/lookup") return handleLookup(request, ctx);
    if (url.pathname === "/api/debug") return handleDebug(request, ctx);
    if (url.pathname === "/api/vk-debug") return handleVkDebug(request, ctx);
    if (url.pathname === "/api/peanut-debug") return handlePeanutDebug(request, ctx);
    if (url.pathname === "/" || url.pathname === "/health") return json({ ok: true, service: "lastheard-api" });

    return json({ error: "not found", path: url.pathname }, 404);
  },
};

// ---------------------------------------------------------------------------
// /api/lastheard
// ---------------------------------------------------------------------------

async function handleLastHeard(request, ctx) {
  try {
    const res = await fetch(SRC_URL, {
      headers: { "User-Agent": "LastHeard-PWA/1.0 (+https://github.com/lastheard)" },
      cf: { cacheTtl: 20 },
    });
    if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);

    const records = await parseLastHeard(res);
    return json(records, 200, { "Cache-Control": "public, max-age=20" });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 502);
  }
}

// Parse the 4-column HTML table using the Workers-native HTMLRewriter.
// Columns: Callsign | Time Heard | Reporting Node | Location
// Data rows carry class="rowres1" or "rowres2"; the header row is "rowreshdr".
async function parseLastHeard(response) {
  const records = [];
  let inRow = false;
  let pendingRow = null; // array of cells for the current data row
  let pendingCell = null; // active cell accumulator: { text, href }

  // HTMLRewriter gives no end-tag callbacks, so we finalize a row/cell when the
  // next start tag arrives (or when the stream ends for the final row).
  const finalizeRow = () => {
    if (pendingRow && pendingRow.length >= 4) {
      const rec = buildRecord(pendingRow);
      if (rec) records.push(rec);
    }
  };

  const rewriter = new HTMLRewriter()
    .on("tr", {
      element(el) {
        const cls = el.getAttribute("class") || "";
        if (/rowres[12]/.test(cls)) {
          finalizeRow(); // close out the previous data row
          pendingRow = [];
          pendingCell = null;
          inRow = true;
        } else if (inRow) {
          // A non-data row marks the end of the data block.
          finalizeRow();
          inRow = false;
          pendingRow = null;
          pendingCell = null;
        }
      },
    })
    .on("td", {
      element() {
        if (!inRow) return;
        pendingCell = { text: "", href: "" };
        pendingRow.push(pendingCell);
      },
      // The text handler fires for ALL descendant text of the <td>, so a single
      // handler captures callsign (in <b>), node label (in <a>), time, and
      // location without needing separate <a>/<b> text handlers.
      text(t) {
        if (inRow && pendingCell) pendingCell.text += t.text;
      },
    })
    .on("a", {
      element(el) {
        if (inRow && pendingCell) {
          const href = el.getAttribute("href") || "";
          if (href && !pendingCell.href) pendingCell.href = href;
        }
      },
    });

  // Drive the rewriter by draining the transformed body.
  await rewriter.transform(response).text();
  finalizeRow(); // the last data row has no following start tag
  return records;
}

function buildRecord(cells) {
  const callText = norm(cells[0].text);
  const qrzHref = cells[0].href || "";
  const base =
    (qrzHref.split("/db/")[1] || callText.split(/\s+/)[0] || "").trim().toUpperCase();
  const module = (callText.replace(base, "").trim().split(/\s+/)[0] || "").toUpperCase();

  const timeStr = norm(cells[1].text);
  const time = parseTime(timeStr);

  const nodeHref = cells[2].href || "";
  const system = decodeURIComponent(
    (nodeHref.split("system=")[1] || "").split(/["&]/)[0]
  ).toUpperCase();
  const nodeLabel = norm(cells[2].text);

  const location = norm(cells[3].text);

  if (!base || !time) return null;
  return {
    callsign: base,
    module,
    time,
    system,
    nodeLabel,
    location,
    mode: "D-STAR",
    source: "D-STAR",
  };
}

// "08/01/26 08:31:08 UTC" -> "2026-08-01T08:31:08Z"
function parseTime(s) {
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, mm, dd, yy, hh, mi, ss] = m;
  const year = 2000 + Number(yy);
  const iso = `${year}-${mm}-${dd}T${hh}:${mi}:${ss}Z`;
  return isNaN(new Date(iso)) ? null : iso;
}

function norm(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// /api/vk-lastheard  (VK DMR / ipsc3.vkdmr.com scrape)
// ---------------------------------------------------------------------------

// ipsc3.vkdmr.com is a Next.js app. The "Last Heard Radios" table is rendered
// server-side, but the "Last Seen" timestamp is hydrated client-side from an
// epoch embedded in the RSC flight payload (self.__next_f.push([1,"..."])).
// We parse the flight payload directly — each data row is a node
//   ["$","tr","<RadioId>-<SeenVia>-<DestID>-<TS>-<epoch>",{"children":[ ...8 td cells... ]}]
// — which gives us every field plus the epoch (for correct sticky/alarm timing)
// in one pass, without depending on the hydrated HTML.

async function handleVkLastHeard(request, ctx) {
  try {
    const res = await fetch(VK_URL, {
      headers: { "User-Agent": "LastHeard-PWA/1.0 (+https://github.com/lastheard)" },
      cf: { cacheTtl: 20 },
    });
    if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);
    const html = await res.text();
    const records = parseVkRadios(html);
    return json(records, 200, { "Cache-Control": "public, max-age=20" });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 502);
  }
}

// Reconstruct the RSC flight stream from the inline <script> pushes, then slice
// out the data rows and read their cells.
function parseVkRadios(html) {
  const pushRe = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m, raw = "";
  while ((m = pushRe.exec(html))) {
    raw += m[1].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  if (!raw) return [];

  // Data rows are the only ["$","tr","<string>" nodes — the header row uses a
  // null key, so splitting on this delimiter skips it cleanly.
  const segments = raw.split('["$","tr","').slice(1);

  // Per cell, "children" is a quoted string, a bare number, or the epoch node
  // ["$","$Lxx",null,{"epochSeconds":N}]. Cells are in fixed order:
  // RadioId, Callsign, Name, SeenVia, Destination, Type, Duration, LastSeen.
  const cellRe = /"children":(?:"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)|\["\$","\$L[a-f0-9]+",null,\{"epochSeconds":(-?\d+)\}])/g;

  const records = [];
  for (const seg of segments) {
    const cells = [];
    cellRe.lastIndex = 0;
    let c;
    while ((c = cellRe.exec(seg)) && cells.length < 8) {
      cells.push(c[1] != null ? c[1] : c[2] != null ? c[2] : c[3] != null ? c[3] : null);
    }
    if (cells.length < 8) continue;
    const call = (cells[1] || "").toUpperCase().trim();
    const name = cells[2] || "";
    const seenVia = cells[3] || "";
    const dest = cells[4] || "";
    const epoch = Number(cells[7]);
    if (!call || !Number.isFinite(epoch)) continue;

    const tsMatch = dest.match(/TS([12])/);
    records.push({
      callsign: call,
      name,
      module: tsMatch ? `S${tsMatch[1]}` : "", // DMR timeslot 1/2
      time: new Date(epoch * 1000).toISOString(),
      system: seenVia, // repeater / peer / network that heard the radio
      nodeLabel: dest, // talkgroup, e.g. "TG 32453 TS1 Kansas City Wide"
      location: "", // the dashboard exposes no geographic location
      mode: "DMR",
      source: "VK DMR",
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// /api/peanut-lastheard  (Peanut / peanut.pa7lim.nl scrape)
// ---------------------------------------------------------------------------

// Peanut (David PA7LIM) is a YSF/Fusion platform that also bridges XLX
// reflectors. It exposes a clean JSON lastheard list at /api/lastheard.json
// (no CORS headers, so the browser can't fetch it directly — hence this proxy).
// Each row is { call, lastseen, options, room }. lastseen is an RFC-2822 string
// ("Sat, 01 Aug 2026 09:37:53 UTC"); room is the reflector/room, e.g. "YSF-EURO"
// or "XLX775M". Peanut exposes no names, so they're resolved via HamDB in the PWA.

async function handlePeanutLastHeard(request, ctx) {
  try {
    const res = await fetch(PEANUT_URL, {
      headers: { "User-Agent": "LastHeard-PWA/1.0 (+https://github.com/lastheard)" },
      cf: { cacheTtl: 20 },
    });
    if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);
    const data = await res.json();
    const records = parsePeanut(Array.isArray(data) ? data : []);
    return json(records, 200, { "Cache-Control": "public, max-age=20" });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 502);
  }
}

function parsePeanut(rows) {
  const records = [];
  for (const r of rows) {
    const call = (r && r.call || "").toUpperCase().trim();
    if (!call) continue;
    const t = new Date(r.lastseen);
    const time = isNaN(t.getTime()) ? null : t.toISOString();
    if (!time) continue;
    const room = (r.room || "").trim();
    const isXlx = /^XLX/.test(room);
    // XLX room "XLX775M" -> module letter "M"; YSF rooms have no module.
    const mod = (room.match(/XLX\d+([A-Z])$/) || [])[1] || "";
    records.push({
      callsign: call,
      name: "", // resolved via HamDB in the PWA (Peanut exposes no names)
      module: mod,
      time,
      system: room, // reflector / room, e.g. "YSF-EURO" or "XLX775M"
      nodeLabel: "",
      location: "",
      mode: isXlx ? "D-STAR" : "YSF",
      source: "Peanut",
    });
  }
  return records;
}

// ---------------------------------------------------------------------------
// /api/lookup?call=CALLSIGN  (HamDB proxy + cache)
// ---------------------------------------------------------------------------

async function handleLookup(request, ctx) {
  const call = (new URL(request.url).searchParams.get("call") || "")
    .toUpperCase()
    .trim();
  if (!call) return json({ error: "missing 'call' parameter" }, 400);

  const cache = caches.default;
  const cacheKey = new Request(`https://lastheard.internal/lookup?call=${call}`, {
    method: "GET",
  });

  let cached;
  try {
    cached = await cache.match(cacheKey);
  } catch {
    cached = null;
  }
  if (cached) return cached;

  let out;
  let status = 200;
  let maxAge = 86400;
  try {
    const res = await fetch(HAMDB_URL(call), {
      headers: { "User-Agent": "LastHeard-PWA/1.0" },
    });
    if (!res.ok) throw new Error(`hamdb ${res.status}`);
    const data = await res.json();
    const c = (data.hamdb && data.hamdb.callsign) || {};
    const st = (data.hamdb && data.hamdb.messages && data.hamdb.messages.status) || "ERROR";
    const nf = (v) => v && v !== "NOT_FOUND" ? v : "";

    out = {
      callsign: nf(c.call) || call,
      name: [nf(c.fname), nf(c.name)].filter(Boolean).join(" ").trim(),
      qth: [nf(c.addr2), nf(c.state), nf(c.zip)].filter(Boolean).join(", ").trim(),
      country: nf(c.country),
      grid: nf(c.grid),
      lat: nf(c.lat),
      lon: nf(c.lon),
      status: st,
    };
    // Cache NOT_FOUND / ERROR briefly so we don't hammer HamDB on every poll.
    if (st !== "OK") maxAge = 3600;
  } catch (err) {
    out = { callsign: call, name: "", status: "ERROR", error: String(err && err.message || err) };
    status = 502;
    maxAge = 300;
  }

  const resp = json(out, status, { "Cache-Control": `public, max-age=${maxAge}` });
  try {
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
  } catch {
    /* caching unavailable (e.g. wrangler dev); ignore */
  }
  return resp;
}

// ---------------------------------------------------------------------------
// /api/debug  (temporary diagnostics)
// ---------------------------------------------------------------------------

async function handleDebug(request, ctx) {
  try {
    const res = await fetch(SRC_URL, {
      headers: { "User-Agent": "LastHeard-PWA/1.0" },
      cf: { cacheTtl: 20 },
    });
    const recs = await parseLastHeard(res);
    return json({ count: recs.length, firstRecords: recs.slice(0, 5) });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 502);
  }
}

async function handleVkDebug(request, ctx) {
  try {
    const res = await fetch(VK_URL, {
      headers: { "User-Agent": "LastHeard-PWA/1.0" },
      cf: { cacheTtl: 20 },
    });
    if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);
    const html = await res.text();
    const recs = parseVkRadios(html);
    return json({ count: recs.length, firstRecords: recs.slice(0, 5) });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 502);
  }
}

async function handlePeanutDebug(request, ctx) {
  try {
    const res = await fetch(PEANUT_URL, {
      headers: { "User-Agent": "LastHeard-PWA/1.0" },
      cf: { cacheTtl: 20 },
    });
    if (!res.ok) return json({ error: `upstream ${res.status}` }, 502);
    const data = await res.json();
    const recs = parsePeanut(Array.isArray(data) ? data : []);
    return json({ count: recs.length, firstRecords: recs.slice(0, 5) });
  } catch (err) {
    return json({ error: String(err && err.message || err) }, 502);
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS,
      ...extra,
    },
  });
}