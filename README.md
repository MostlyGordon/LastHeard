# LastHeard

A Progressive Web App that shows a live **"last heard"** list of stations heard on
amateur-radio digital voice modes — **D-STAR**, **DMR (Brandmeister)**, and **VK DMR**
(ipsc3.vkdmr.com). Installable on PC, tablet, and phone; works offline-first as a PWA.

## Features

- **D-STAR last-heard list** scraped from [dsm.dstarusers.org](http://dsm.dstarusers.org/lastheard.php),
  polled every 30s via the Cloudflare Worker.
- **Brandmeister DMR** streamed live from [Brandmeister](https://brandmeister.network/#/lh)
  via its Socket.IO feed (real-time, no polling).
- **VK DMR** (the Australian IPSC3 network) scraped from
  [ipsc3.vkdmr.com](https://ipsc3.vkdmr.com/dashboard), polled every 30s via the
  Cloudflare Worker. Real transmission timestamps are recovered from the page's
  Next.js flight payload so alarm/sticky timing is correct.
- Each station shows **callsign, name, digital mode, network, and repeater/reflector/talk group**.
- **Sticky for 10 minutes** — a station stays on screen for 10 min after its last
  transmission, even if it drops out of the feed. A new transmission resets the window.
- **Area/source filter** — a search box that matches location, callsign,
  repeater/reflector, talk group, mode, or network (e.g. `VK`, `Brandmeister`, `DMR`).
- **On-air alarms** — keep a watchlist of callsigns (per-row ★/☆ toggle or the alarm
  panel); when one comes on air on any network the app beeps (Web Audio) and
  flashes (row highlight + title flash). Sound is gated behind a "Sound" click to
  satisfy browser autoplay policies. System notifications are used when permission is granted.
- Names resolved via the free [HamDB](https://hamdb.org/api) API for D-STAR (cached
  locally); Brandmeister and VK DMR names come straight from their feeds.
- Responsive: table on wide screens, stacked cards on phones; dark/light themes.

## Architecture

```
[ dsm.dstarusers.org  ] --fetch+parse--> [ Cloudflare Worker ] --JSON--> [ Vite PWA ]
[ ipsc3.vkdmr.com     ] --fetch+parse---/        (CORS)                  (poll, render, alarm)
[ api.hamdb.org       ] --proxy+cache--/
[ api.brandmeister.net] --Socket.IO /lh-------(direct websocket)------/ (DMR stream)
```

D-STAR and VK DMR need the Cloudflare Worker (the browser can't scrape those sites
cross-origin) and the Worker also proxies HamDB name lookups. **Brandmeister has no
REST lastheard endpoint**, so the PWA connects directly to its Socket.IO stream at
`wss://api.brandmeister.network` (path `/lh/socket.io`), joins the `"everything"`
feed, and renders `Session-Start` voice events as DMR records. This was tested to
work cross-origin from the PWA.

### Worker (`worker/`) — `lastheard-api`

| Endpoint | Description |
| --- | --- |
| `GET /api/lastheard` | Scrapes the D-STAR HTML table and returns a JSON array of records. |
| `GET /api/vk-lastheard` | Scrapes the VK DMR dashboard (Next.js flight payload) and returns a JSON array of records. |
| `GET /api/lookup?call=CALL` | Proxies HamDB and returns normalized name/QTH info, edge-cached. |
| `GET /api/debug` | Diagnostics: D-STAR upstream fetch + parsed record count. |
| `GET /api/vk-debug` | Diagnostics: VK upstream fetch + parsed record count. |
| `GET /health` | Liveness check. |

Record shape:
```json
{ "callsign":"M0LTP", "module":"D", "time":"2026-08-01T08:35:01Z",
  "system":"REF032", "nodeLabel":"REF032 Dongle User DVD",
  "location":"Radom, Poland", "mode":"D-STAR", "source":"D-STAR" }
```

The D-STAR HTML table is parsed with the Workers-native **`HTMLRewriter`** (no
dependencies). Data rows carry `class="rowres1|rowres2"` with four cells:
Callsign (QRZ link + optional band/module suffix), Time Heard (UTC), Reporting
Node (reflector/repeater link + label), and Location.

The VK DMR dashboard is a Next.js app whose "Last Seen" timestamp is hydrated
client-side from an epoch embedded in the RSC flight payload
(`self.__next_f.push([1,"…"])`). Rather than scrape the (incomplete) HTML, the
worker reconstructs the flight stream and parses each data row directly — each
row is a node `["$","tr","<RadioId>-<SeenVia>-<DestID>-<TS>-<epoch>"]` whose eight
cells give radio id, callsign, name, "seen via" (repeater/peer/network),
destination talkgroup, type, duration, and the `epochSeconds` timestamp. This
yields every field plus the real transmission time in one pass.

### PWA (`web/`) — Vanilla JS + Vite

- `src/api.js` — D-STAR + VK DMR fetch helpers and the D-STAR 30s polling loop.
- `src/bm.js` — Brandmeister DMR Socket.IO stream client (connect, join, parse, batch into the store).
- `src/vk.js` — VK DMR 30s polling client (fetch via worker, pre-fill names, merge into the store).
- `src/store.js` — heard-station map, 10-minute sticky prune, entry cap, watchlist, filter, alarm detection, event emitter.
- `src/db.js` — localStorage callsign→name cache with in-flight dedup.
- `src/audio.js` — Web Audio beep, armed on user gesture.
- `src/ui/list.js` — responsive table/card rendering + name resolution (DMR names pre-filled by `bm.js`).
- `src/ui/filter.js` — area/text filter.
- `src/ui/alarm.js` — watchlist editor + beep/flash/notification engine.
- `vite-plugin-pwa` — manifest, icons, auto-updating service worker.

## Development

### 1. Run the Worker API

```bash
cd worker
npm install
npm run dev      # wrangler dev -> http://localhost:8787
```

Verify:
```bash
curl -s http://localhost:8787/api/lastheard | jq length
curl -s 'http://localhost:8787/api/lookup?call=W1AW' | jq
```

### 2. Run the PWA

```bash
cd web
npm install
cp .env.example .env      # adjust VITE_API_BASE if needed
npm run dev               # -> http://localhost:5174
```

Open http://localhost:5174, click **🔕 Alarms off** to arm alerts (this also
unlocks audio), add a callsign to the watchlist, and watch for on-air alerts.

## Deploy

### Worker → Cloudflare

```bash
cd worker
npx wrangler deploy
```
Note the deployed URL (e.g. `https://lastheard-api.<you>.workers.dev`) and set it
as `VITE_API_BASE` for the web build.

### PWA → Cloudflare Pages (or any static host)

```bash
cd web
VITE_API_BASE=https://lastheard-api.<you>.workers.dev npm run build
# deploy the web/dist directory (e.g. `npx wrangler pages deploy dist`)
```

## Limitations & notes

- **Names are US-centric.** HamDB is built primarily from FCC data, so non-US
  callsigns (e.g. `M0LTP`) often return `(unknown)`. A fallback to HamQTH (global,
  free account) is a natural future addition.
- **Volunteer feed.** `dstarusers.org` only reports repeaters whose sysops install
  DStarMonitor, so not all D-STAR activity is visible.
- **Poll cadence.** Alarms depend on the 30s poll interval; a transmission shorter
  than the interval may be missed.
- **Scrape fragility.** A redesign of the source page will break parsing; the
  worker degrades gracefully (empty array / debug endpoint helps diagnose).
- **DMR is the global firehose.** The Brandmeister `"everything"` feed is high
  volume, so the store is capped at 400 entries and the list renders the 250 most
  recent (narrow the filter to see more). DMR records carry no geographic location
  (the BM stream doesn't provide one), so the area filter matches callsign /
  repeater / talk group for them.
- **DMR depends on the BM Socket.IO service** accepting the PWA's origin. This was
  verified cross-origin, but if Brandmeister restricts origins in future, DMR would
  need to be proxied through the Worker instead.
- **DMR names** come from the BM stream and may be missing for some callsigns.
- **VK DMR** shows only the ~30 most recent radios the dashboard exposes, and the
  page's flight-payload shape is coupled to its Next.js build — a dashboard
  redesign or framework upgrade can break parsing (the `/api/vk-debug` endpoint
  helps diagnose). VK records carry no geographic location.
- More digital modes (YSF, etc.) can be added by extending the worker or adding
  another stream client and tagging `mode`/`source` accordingly.