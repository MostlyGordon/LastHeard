# LastHeard

A Progressive Web App that shows a live **"last heard"** list of stations heard on
amateur-radio digital voice modes — starting with **D-STAR**. Installable on PC,
tablet, and phone; works offline-first as a PWA.

## Features

- **Live last-heard list** scraped from [dsm.dstarusers.org](http://dsm.dstarusers.org/lastheard.php),
  polled every 30s.
- Each station shows **callsign, name, digital mode, and repeater/reflector**.
- **Sticky for 10 minutes** — a station stays on screen for 10 min after its last
  transmission, even if it drops out of the live feed. A new transmission resets the window.
- **Area filter** — a search box that matches location, callsign, repeater/reflector, or node label.
- **On-air alarms** — keep a watchlist of callsigns; when one comes on air the app
  beeps (Web Audio) and flashes (row highlight + title flash). Sound is gated behind
  an "Arm alarms" click to satisfy browser autoplay policies. A mute toggle gives
  flash-only alerts. System notifications are used when permission is granted.
- Names resolved via the free [HamDB](https://hamdb.org/api) API and cached locally.
- Responsive: table on wide screens, stacked cards on phones; dark/light themes.

## Architecture

```
[ dsm.dstarusers.org ] --fetch+parse--> [ Cloudflare Worker ] --JSON--> [ Vite PWA ]
[ api.hamdb.org       ] --proxy+cache--/        (CORS)                  (poll, render, alarm)
```

A browser PWA cannot fetch `dstarusers.org` cross-origin (CORS), so a Cloudflare
Worker acts as the scraping proxy and JSON API. It also proxies HamDB name lookups
with edge caching.

### Worker (`worker/`) — `lastheard-api`

| Endpoint | Description |
| --- | --- |
| `GET /api/lastheard` | Scrapes the D-STAR HTML table and returns a JSON array of records. |
| `GET /api/lookup?call=CALL` | Proxies HamDB and returns normalized name/QTH info, edge-cached. |
| `GET /api/debug` | Diagnostics: upstream fetch + parsed record count. |
| `GET /health` | Liveness check. |

Record shape:
```json
{ "callsign":"M0LTP", "module":"D", "time":"2026-08-01T08:35:01Z",
  "system":"REF032", "nodeLabel":"REF032 Dongle User DVD",
  "location":"Radom, Poland", "mode":"D-STAR" }
```

The HTML table is parsed with the Workers-native **`HTMLRewriter`** (no
dependencies). Data rows carry `class="rowres1|rowres2"` with four cells:
Callsign (QRZ link + optional band/module suffix), Time Heard (UTC), Reporting
Node (reflector/repeater link + label), and Location.

### PWA (`web/`) — Vanilla JS + Vite

- `src/api.js` — fetch helpers + 30s polling loop.
- `src/store.js` — heard-station map, 10-minute sticky prune, watchlist, filter, alarm detection, event emitter.
- `src/db.js` — localStorage callsign→name cache with in-flight dedup.
- `src/audio.js` — Web Audio beep, armed on user gesture.
- `src/ui/list.js` — responsive table/card rendering + name resolution.
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
- More digital modes (DMR, YSF, etc.) can be added by extending the worker with
  additional sources and tagging `mode` accordingly.