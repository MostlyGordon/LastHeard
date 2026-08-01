// LastHeard API — Cloudflare Worker
// Scrapes the D-STAR "last heard" HTML table from dsm.dstarusers.org and proxies
// HamDB callsign lookups, returning JSON for the LastHeard PWA.

const SRC_URL = "http://dsm.dstarusers.org/lastheard.php?refresh=1";
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
    if (url.pathname === "/api/lookup") return handleLookup(request, ctx);
    if (url.pathname === "/api/debug") return handleDebug(request, ctx);
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