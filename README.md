# CBSE Result Portals Monitor

An **independent student utility** that checks how quickly seven result-related portals respond, ranks them,
and links to step-by-step "How to Use" guides. **It is not an official CBSE website and is not affiliated with
CBSE or the Government of India.** It does not issue results or replace the official examination websites.

## Features
- **Live monitoring** of 7 portals: response time (ms), status (Fastest / Excellent / Good / Slow / Checking / Offline),
  last-checked time and the real failure reason (timed out, connection refused, DNS, certificate, HTTP 503, unexpected redirect).
- **Ranking and tools:** Fastest First / Slowest First / Online First / Offline First / A–Z sorting, search by name or domain,
  *Run Check Now*, *Find Fastest Portal*, live Quick Stats, list/compact view.
- **7 How to Use guides**, one per portal: original infographic with zoom viewer, full written steps, troubleshooting,
  safety tips and official links.
- **Two-stage link verification:** every *Visit Portal* address is checked against an allowlist of official hostnames
  (HTTPS, exact host/path, `gov.in` / `nic.in`), re-checked at click time, and unexpected redirects are never followed.
- **Contact Support / Send Feedback** by e-mail (`mailto:`), with a copy-to-clipboard fallback and a guard against
  sending OTPs, passwords or long ID numbers.
- Responsive (phone, tablet, desktop), keyboard accessible, no login or tracking.

## Run locally
Requires [Node.js](https://nodejs.org) 18 or newer. No dependencies to install.

```bash
npm start            # then open http://localhost:3000
npm test             # 15 automated tests
```

## Put it on GitHub
```bash
cd cbse-result-portals-monitor
git init
git add .
git commit -m "CBSE Result Portals Monitor"
git branch -M main
git remote add origin https://github.com/<your-username>/cbse-result-portals-monitor.git
git push -u origin main
```
Create the empty repository on github.com first (no README/licence). GitHub Actions (`.github/workflows/ci.yml`)
will run the tests on every push.

## Which host? (free, and as close to 24/7 as possible)
Facts below were checked against each provider's own documentation; free plans change, so re-check before relying on them.

| Option | Stays on 24/7? | Server-side checks (HTTP status, redirects)? | Catch |
|---|---|---|---|
| **Render free + free pinger** | Yes, while pinged | Yes | Not an officially supported fix; may restart any time; the 750 free hours cover one always-on service; Render's servers are outside India. |
| **Static host** (Vercel, Netlify, Cloudflare Pages, GitHub Pages) | Yes (no server to sleep) | No: each visitor's browser measures | Free, never sleeps, measures from the student's own network. Vercel's free plan cannot run `server.js` (cron jobs run at most once a day). |
| **Oracle Cloud "Always Free" VM** (e.g. Mumbai) | Yes, a real server | Yes | Needs a credit/debit card (RuPay and prepaid are rejected), the home region is permanent, free capacity can be unavailable, and Oracle may reclaim a VM idle for 7 days. |
| Render paid instance | Yes | Yes | Costs money, but it never sleeps. |

**Suggested path:** deploy to Render first and look at the dashboard. If the portals show real response times, server mode
works from Render, so add the free pinger below. If every portal shows *Offline* (government sites often block foreign or
data-centre addresses), switch to the static-host row (or set `MONITOR_MODE=browser`).

### Keep Render awake for free
Two free layers work together:

1. **Built in (nothing to do).** On Render the server learns its own public address automatically
   (`RENDER_EXTERNAL_URL`) and visits its own `/healthz` page every 10 minutes, so Render never sees 15 quiet minutes.
   Turn it off with `KEEP_ALIVE=off`.
2. **Outside backup (recommended, 3 minutes).** If Render restarts or sleeps the app anyway, a visit from outside wakes it up.
   1. In the Render dashboard open your service and copy its address from the top of the page. It is usually
      `https://cbse-result-portals-monitor.onrender.com`; Render adds extra letters if that name is already taken.
   2. Make a free account at [uptimerobot.com](https://uptimerobot.com) (free plan: 50 monitors, 5-minute checks, no card).
   3. **Add New Monitor** → type *HTTP(s)* → in **URL to monitor** paste `<your address>/healthz` → interval 5 minutes → save.

Both are unofficial tricks (Render's own docs only promise that paid instances never sleep), and Render may restart a free
service at any time. One service running all month uses about 720-744 of the 750 free hours, so keep it to a single free
service per Render workspace.

### Oracle VM outline (untested here)
Create an Always Free Ubuntu VM, open port 3000 in its network rules, install Node 20, `git clone` your repo, then
`npm i -g pm2 && pm2 start server.js --name cbse-monitor && pm2 save && pm2 startup`. Put Caddy or Cloudflare in front
for HTTPS. The monitor is very light, so keep an eye on Oracle's idle-reclaim emails (upgrading the account to
pay-as-you-go avoids reclaim while you stay within the free limits).

## Deploy on Render (full features)
**Option A — Blueprint (one click):** Render dashboard → **New → Blueprint** → pick your GitHub repo.
Render reads `render.yaml` and creates the web service.

**Option B — manual:** **New → Web Service** → connect the repo, then set
Runtime `Node`, Build Command `npm install`, Start Command `npm start`, Health Check Path `/healthz`.

No environment variables are required. Render sets `PORT` automatically and the app listens on it.

### Where do the checks run? (important)
| `MONITOR_MODE` | Who measures the portals | Notes |
|---|---|---|
| `server` (default) | This Node server | Shared results for all visitors, real HTTP status, redirect checks. |
| `browser` | Each visitor's browser | Server only serves the page. Use if the host cannot reach the portals. |

Some Indian government sites **only answer Indian networks** or block data-centre addresses. If, on Render, every portal
shows *Offline* with *Timed out*, *Connection refused* or *HTTP 403* while the sites open fine on your phone, set
`MONITOR_MODE=browser` in Render → Environment. The page then measures from each student's own connection instead.
(Render's Singapore region is the closest to India; `render.yaml` already uses it.)

### Free-plan notes
Render's free web service **sleeps after 15 minutes without incoming traffic** (not 5), and the first visit after that takes
about a minute to wake it. It also gets 750 free instance hours per month per workspace, and Render may restart it at any
time. See "Which host?" above for how to keep it awake for free.

## Static hosting (Vercel / Netlify / GitHub Pages)
These cannot run `server.js`. You can still publish the `public/` folder (`vercel.json` points Vercel at it); the page
detects that there is no API and automatically uses **browser** checks. You lose server-side HTTP status and redirect checks.

## Configuration
Everything is in `config.js`; these environment variables override it:

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port to listen on (set by the host). |
| `HOST` | `127.0.0.1` locally, `0.0.0.0` when `PORT` is set | Interface to bind. |
| `MONITOR_MODE` | `server` | `server` or `browser` (see above). |
| `MONITOR_USER_AGENT` | identifying UA | User-Agent sent with checks. |
| `MONITOR_INSECURE_TLS` | off | `1` skips certificate validation (troubleshooting only). |
| `KEEP_ALIVE` | on | `off` stops the server visiting its own `/healthz` page (see above). |
| `KEEP_ALIVE_MINUTES` | `10` | How often it visits itself. Keep it under the host's idle limit (15 on Render). |
| `KEEP_ALIVE_URL` | `RENDER_EXTERNAL_URL` | Public address to visit. Set it yourself on hosts other than Render. |

In `config.js` you can also change the latency thresholds (Excellent ≤ 600 ms, Good ≤ 1500 ms), timeout (10 s),
check interval (120 s), manual-check cooldown (15 s), the hostname allowlist and the approved redirect hosts.
If a portal shows *Certificate problem* but opens in your browser, try `node --use-system-ca server.js` (Node 22.15+).

## Project structure
```
server.js          web server + API (/api/portals, /api/check, /healthz)
monitor.js         checking engine, redirect handling, verification
config.js          settings, the 7 portals, allowlist
public/index.html  the website (single file, images embedded)
test/              automated tests (node:test)
render.yaml        Render blueprint        vercel.json  optional static hosting
.github/workflows  CI (runs the tests on Node 18/20/22)
```

## Accuracy notice
Response times are measured by the monitoring checks and may differ from what a student experiences, depending on server
load, network and location. A fast response does not guarantee a result has been released.
