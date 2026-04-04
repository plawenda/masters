# Masters Pool — Project Context

## What This Is
A password-protected golf tournament pool website for the Masters. Live leaderboard, pool standings, movement tracking, and AI-generated dispatch commentary. Deployed on Netlify at `masters-pool.org`.

## Tech Stack
- **Frontend:** Vanilla JS, HTML5, CSS custom properties. No build step — files are served directly from root.
- **Backend:** Netlify Functions (serverless Node.js) + Netlify Edge Functions (auth middleware)
- **Storage:** Netlify Blobs (time-series snapshots, `leaderboard-history` store)
- **Data Sources:**
  - Cloudflare Workers — live golf scores (we don't control these workers, they're external)
  - Google Sheets (published TSV) — pool entries + payout table
  - DataGolf API — optional strokes gained stats
  - Anthropic Claude API — AI dispatch commentary
- **Auth:** Edge function cookie-based session (`masters_auth` cookie, 7-day TTL)
- **Local dev:** `node server.js` (Express, port 3000), with `.env` file for secrets

## Key Files
| File | Purpose |
|------|---------|
| `netlify/functions/lib/pool-calc.js` | Core library — all data fetching, name normalization, standings computation |
| `netlify/functions/leaderboard.js` | Main API endpoint (`/api/leaderboard`) — orchestrates all data sources |
| `netlify/functions/leaderboard-snapshot.js` | Cron job (every 15 min) — saves standings to Blobs for trend tracking |
| `netlify/functions/intro.js` | AI dispatch endpoint — Claude with web search, witty caddie voice |
| `netlify/functions/sheet.js` | Google Sheets CORS proxy |
| `netlify/functions/auth-login.js` | Password login, issues session cookie |
| `netlify/edge-functions/auth.js` | Auth middleware — protects all routes except login page + static assets |
| `index.html` | Main live leaderboard page |
| `detailed.html` | Detailed team view with expandable golfer sub-rows |
| `netlify.toml` | Netlify config — redirects, cron schedule, edge function bindings |

## Data Flow
```
Browser (60s auto-refresh)
  → Edge Function auth check
  → /api/leaderboard (Netlify Function)
      ├── Cloudflare Worker (live scores)  ← primary + backup worker URLs
      ├── Google Sheets TSV (pool entries, payouts)
      ├── DataGolf API (strokes gained, optional)
      └── Netlify Blobs (snapshot history for sparklines/movement)
```

## Cloudflare Workers
- Primary: `https://long-block-f301.patrick-lawenda.workers.dev/`
- Backup: `https://datagolf-v2.patrick-lawenda.workers.dev/`
- Returns: `{ live_stats: [...], event_name, last_updated }`
- **We do not modify these workers in this repo.** They're defined elsewhere.

## Google Sheets
- Teams sheet (gid=0) — pool entries, format: `TeamName → "Golfer Name ($price), ..."`
- Payouts sheet (gid=206557939) — positions 1-70 mapped to prize money
- Cache-busted with `&_t=Date.now()` to bypass Google's 5-15 min cache delay
- Both are "published to web" (no API key needed)

## Pool Logic (pool-calc.js)
- `normalizeName` / `canonicalizeName` — critical for matching player names across sources (DataGolf uses "Last, First"; pool entries use "First Last")
- `buildEarningsMap` — ties are split (e.g., T2 with 3 players averages positions 2/3/4)
- `computeStandings` — sorts teams by total expected earnings, assigns ranks
- Hardcoded purse fallback if payout sheet unavailable

## Environment Variables
| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Claude API for dispatch commentary |
| `SITE_PASSWORD` | Pool login password |
| `AUTH_TOKEN` | Cookie validation token |
| `DATAGOLF_API_KEY` | Optional strokes gained stats |
| `URL` | Origin URL (default: `https://masters-pool.org`) |
| `NETLIFY_BLOBS_CONTEXT` | Auto-set by Netlify for Blobs access |

## Snapshot / Trend System
- `leaderboard-snapshot.js` runs every 15 min via Netlify cron
- Stores up to 200 snapshots/day in Blobs under key `snapshots_YYYY-MM-DD`
- Each snapshot: `{ time: ISO, standings: [{name, rank, totalEarnings}] }`
- Used to generate sparklines, daily movement badges (`▲3`/`▼1`), and peak rank badges

## Frontend Patterns
- **No framework** — plain DOM manipulation
- Shared visual language: Masters green `#006747`, gold `#c8952a`, cream backgrounds
- Sparklines are inline SVGs rendered by `renderSparkline()`
- `Choices.js` for multi-select team picker (state persisted in `localStorage`)
- `scoreClass()` colors scores (red = over par, green = under par)
- AI dispatch strip at top of every page — fetches from `/api/intro`

## Auth Flow
1. All routes → `auth.js` edge function checks cookie
2. No cookie → redirect to `/login.html`
3. User submits password → POST `/api/auth-login`
4. Server checks `SITE_PASSWORD` → sets HttpOnly cookie → redirect back

## Deployment
- `git push` to `main` → auto-deploys to Netlify
- No build command needed (static HTML served from root)
- Functions live in `netlify/functions/`, edge functions in `netlify/edge-functions/`

## Coding Standards for This Project
- Keep functions resilient — data source failures should degrade gracefully, not crash
- Name normalization is critical; use the utilities in `pool-calc.js` rather than ad hoc string manipulation
- AI dispatch tone: witty caddie, not press release — max 300 tokens, plain text
- Keep auto-refresh at 60s (set via `<meta http-equiv="refresh" content="60">`)
- No build tooling — keep it deployable with zero config
