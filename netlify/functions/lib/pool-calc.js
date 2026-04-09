'use strict';

// ---------- Constants ----------

const WORKER_URL        = 'https://long-block-f301.patrick-lawenda.workers.dev/';
const WORKER_BACKUP_URL = 'https://datagolf-v2.patrick-lawenda.workers.dev/';

// RawTeamData tab (gid=0) — must be published via File → Share → Publish to web
const TEAMS_TSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT_htvNiJZPFTNohWOu_fT0VjKlQQWfMFEi08SU1tlN3HHauBbe-I5O3KPbwc-WPkBR8Hdh5yEMssOl/pub?gid=0&single=true&output=tsv';

// Payouts tab (gid=206557939) — position → prize money, positions 1-70
const PAYOUTS_TSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT_htvNiJZPFTNohWOu_fT0VjKlQQWfMFEi08SU1tlN3HHauBbe-I5O3KPbwc-WPkBR8Hdh5yEMssOl/pub?gid=206557939&single=true&output=tsv';

// 2025 Masters purse ($20M total) — verify and update before 2026 if purse changes
const PURSE = {
   1: 3600000,  2: 2160000,  3: 1360000,  4:  960000,  5:  800000,
   6:  720000,  7:  670000,  8:  620000,  9:  580000, 10:  540000,
  11:  500000, 12:  460000, 13:  420000, 14:  390000, 15:  360000,
  16:  330000, 17:  310000, 18:  290000, 19:  270000, 20:  255000,
  21:  240000, 22:  225000, 23:  210000, 24:  197000, 25:  184000,
  26:  172000, 27:  160000, 28:  150000, 29:  140000, 30:  132000,
  31:  124000, 32:  116000, 33:  108000, 34:  102000, 35:   96000,
  36:   91000, 37:   86000, 38:   81000, 39:   77000, 40:   73000,
  41:   70000, 42:   67000, 43:   64000, 44:   62000, 45:   60000,
  46:   58000, 47:   56000, 48:   54000, 49:   52000, 50:   50000,
};

const INACTIVE_STATUSES = new Set(['CUT', 'WD', 'DQ', 'MDF', 'W/D']);

// ---------- Helpers ----------

async function fetchWithRetry(url, opts = {}, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), ...opts });
    if (r.status === 429 && i < retries) {
      await new Promise(ok => setTimeout(ok, 1000 * (i + 1)));
      continue;
    }
    return r;
  }
}

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a')
    .replace(/ð/g, 'd').replace(/þ/g, 'th').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// DataGolf returns names as "Last, First" — convert to "First Last" then normalize
// Pool entries (from Tally) are already "First Last", so normalizeName() is correct for those
function canonicalizeName(name) {
  const s = name.trim();
  if (s.includes(',')) {
    const comma = s.indexOf(',');
    const last  = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    return normalizeName(`${first} ${last}`);
  }
  return normalizeName(s);
}

// Return display name in "First Last" order regardless of source format
function displayName(name) {
  const s = name.trim();
  if (s.includes(',')) {
    const comma = s.indexOf(',');
    const last  = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    return `${first} ${last}`;
  }
  return s;
}

function parsePosition(pos) {
  if (!pos) return null;
  const s = pos.toString().toUpperCase().trim();
  if (INACTIVE_STATUSES.has(s)) return null;
  const n = parseInt(s.replace(/^T/, ''), 10);
  return isNaN(n) ? null : n;
}

function isInactive(pos) {
  if (!pos) return false;
  return INACTIVE_STATUSES.has(pos.toString().toUpperCase().trim());
}

function fmtScore(n) {
  if (n == null || n === '') return '-';
  const i = parseInt(n, 10);
  if (isNaN(i)) return n.toString();
  if (i === 0) return 'E';
  return i > 0 ? `+${i}` : `${i}`;
}

function fmtThru(thru) {
  if (thru == null || thru === '') return '-';
  const n = parseInt(thru, 10);
  if (isNaN(n)) return thru.toString();
  return n >= 18 ? 'F' : `${n}`;
}

// ---------- Flexible field extraction ----------
// We don't know the exact field names DataGolf returns, so try multiple candidates.

function playerName(p) {
  return (p.player_name || p.name || p.full_name || p.player || '').toString().trim();
}

function playerPosition(p) {
  // Try all known DataGolf field names for position
  const raw = p.position ?? p.current_pos ?? p.pos ?? p.fin_text ?? p.finish ?? p.finish_pos ?? null;
  return raw != null ? raw.toString().trim() : null;
}

function playerTotal(p) {
  return p.total ?? p.total_score ?? p.total_strokes ?? p.score ?? null;
}

function playerToday(p) {
  return p.today ?? p.today_score ?? p.round ?? p.round_score ?? p.current_round_score ?? null;
}

function playerThru(p) {
  return p.thru ?? p.thru_hole ?? p.holes_played ?? p.hole ?? null;
}

// ---------- Fetch helpers ----------

async function fetchLiveScores() {
  let json;
  try {
    const r = await fetch(WORKER_URL, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Worker ${r.status}`);
    json = await r.json();
    const players = json.live_stats || [];
    // Log first player's fields so we can verify field names in Netlify logs
    if (players.length > 0) {
      console.log('[leaderboard] Worker response keys on first player:', Object.keys(players[0]).join(', '));
      console.log('[leaderboard] First player sample:', JSON.stringify(players[0]).slice(0, 300));
    } else {
      console.log('[leaderboard] Worker returned empty live_stats. Full response keys:', Object.keys(json).join(', '));
    }
    // Primary worker shape: { live_stats, course_name, event_name, last_updated }
    return {
      players,
      eventName:   json.event_name || 'Masters Tournament',
      lastUpdated: json.last_updated || new Date().toISOString(),
    };
  } catch (e) {
    console.warn('Primary worker failed, trying backup:', e.message);
    const r = await fetch(WORKER_BACKUP_URL, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Backup worker ${r.status}`);
    json = await r.json();
    const players = json.data || [];
    if (players.length > 0) {
      console.log('[leaderboard] Backup worker keys on first player:', Object.keys(players[0]).join(', '));
    }
    // Backup shape: { data, info: { event_name, last_update } }
    return {
      players,
      eventName:   json.info?.event_name || 'Masters Tournament',
      lastUpdated: json.info?.last_update || new Date().toISOString(),
    };
  }
}

async function fetchPoolEntries() {
  // Add timestamp to bypass Google's published-sheet cache (~5-15 min otherwise)
  const url = TEAMS_TSV_URL + '&_t=' + Date.now();
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Sheets ${r.status}`);
  const text = await r.text();
  const rows = text.trim().split('\n').map(r => r.split('\t'));
  if (rows.length < 2) return [];

  // Row 0 = headers; skip it
  return rows.slice(1)
    .filter(r => (r[4] || r[3] || '').trim())
    .map(row => {
      const name    = (row[4] || row[3] || '').trim(); // Teamname (col E) else Name (col D)
      const picksRaw = row[6] || '';
      // Parse "Golfer Name ($X.XX), ..." → [{ name, cost }, ...]
      const golfers = picksRaw
        .split(',')
        .map(s => {
          const costMatch = s.match(/\(\$?([\d.]+)\)\s*$/);
          const cost = costMatch ? parseFloat(costMatch[1]) : 0;
          const golferName = s.replace(/\s*\(\$?[\d.]+\)\s*$/, '').trim();
          return golferName ? { name: golferName, cost } : null;
        })
        .filter(Boolean);
      return { name, golfers };
    })
    .filter(e => e.name && e.golfers.length);
}

async function fetchPayoutTable() {
  const url = PAYOUTS_TSV_URL + '&_t=' + Date.now();
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`Payouts sheet ${r.status}`);
  const text = await r.text();
  const rows = text.trim().split('\n').map(r => r.split('\t'));
  if (rows.length < 2) return {};

  // Skip header row; expect col 0 = position number, col 1 = dollar amount
  // Amount parser strips $, commas, spaces so both "50000" and "$50,000" work
  const map = {};
  for (const row of rows.slice(1)) {
    const pos    = parseInt(row[0], 10);
    const amount = parseFloat((row[1] || '').replace(/[^0-9.]/g, ''));
    if (!isNaN(pos) && !isNaN(amount)) map[pos] = Math.round(amount);
  }
  return map;
}

// ---------- Budget compliance ----------

const BUDGET = 30;

// Marks the cheapest golfers as dropped until the team cost is within budget.
// Mutates each entry's golfers array in place (adds dropped: true).
function applyBudgetCompliance(entries) {
  for (const entry of entries) {
    const totalCost = entry.golfers.reduce((sum, g) => sum + (g.cost || 0), 0);
    if (totalCost <= BUDGET) continue;

    // Sort ascending by cost so we drop cheapest first; keep original order intact via index
    const sorted = [...entry.golfers].sort((a, b) => a.cost - b.cost);
    let remaining = totalCost;
    for (const g of sorted) {
      if (remaining <= BUDGET) break;
      g.dropped = true;
      remaining -= g.cost || 0;
    }
  }
  return entries;
}

// ---------- Calculation ----------

// Builds a map of normalizedName → expected earnings, handling ties via purse averaging
// payoutMap: live table from Google Sheets; falls back to hardcoded PURSE if empty
function buildEarningsMap(players, payoutMap) {
  const payout = (payoutMap && Object.keys(payoutMap).length) ? payoutMap : PURSE;

  const byPos = {};
  for (const p of players) {
    const pos = parsePosition(playerPosition(p));
    if (pos === null) continue;
    if (!byPos[pos]) byPos[pos] = [];
    byPos[pos].push(p);
  }

  const earningsMap = {};
  for (const [posStr, tied] of Object.entries(byPos)) {
    const startPos = parseInt(posStr, 10);
    let total = 0;
    for (let i = startPos; i < startPos + tied.length; i++) {
      total += payout[i] || 0;
    }
    const each = Math.round(total / tied.length);
    for (const p of tied) {
      const name = playerName(p);
      if (name) earningsMap[canonicalizeName(name)] = each;
    }
  }
  return earningsMap;
}

// Compute pool standings from entries + live players
function computeStandings(entries, players, earningsMap) {
  // Build quick lookup for player data using flexible name extraction
  const playerMap = {};
  for (const p of players) {
    const name = playerName(p);
    if (name) playerMap[canonicalizeName(name)] = p;
  }

  const teams = entries.map(entry => {
    let totalEarnings = 0;
    const golferDetails = entry.golfers.map(g => {
      const name     = g.name;
      const dropped  = !!g.dropped;
      const key      = normalizeName(name);
      const player   = playerMap[key];
      const earnings = dropped ? 0 : (earningsMap[key] ?? 0);
      const posRaw   = player ? playerPosition(player) : null;
      const posStr   = posRaw ? posRaw.toString().toUpperCase().trim() : '';
      const inactive = isInactive(posStr);
      totalEarnings += earnings;
      return {
        name,
        dropped,
        position: player ? (posRaw ?? '-') : '?',
        score:    player ? fmtScore(playerTotal(player)) : '-',
        today:    player ? fmtScore(playerToday(player)) : '-',
        thru:     player ? (inactive ? posStr : fmtThru(playerThru(player))) : '-',
        status:   inactive ? posStr.toLowerCase() : 'active',
        earnings,
      };
    });
    return { name: entry.name, totalEarnings, golfers: golferDetails };
  });

  // Sort by earnings desc, then assign ranks (ties share rank)
  teams.sort((a, b) => b.totalEarnings - a.totalEarnings);
  let rank = 1;
  for (let i = 0; i < teams.length; i++) {
    if (i > 0 && teams[i].totalEarnings === teams[i - 1].totalEarnings) {
      teams[i].rank = teams[i - 1].rank;
    } else {
      teams[i].rank = rank;
    }
    rank++;
  }

  return teams;
}

// Build Masters leaderboard array from raw players
function buildMastersLeaderboard(players, earningsMap) {
  return players.map(p => {
    const rawName  = playerName(p);
    const posRaw   = playerPosition(p);
    const posStr   = posRaw ? posRaw.toString().toUpperCase().trim() : '';
    const inactive = isInactive(posStr);
    return {
      name:     displayName(rawName),
      position: posRaw ?? '-',
      score:    fmtScore(playerTotal(p)),
      today:    fmtScore(playerToday(p)),
      thru:     inactive ? posStr : fmtThru(playerThru(p)),
      status:   inactive ? posStr.toLowerCase() : 'active',
      earnings: rawName ? (earningsMap[canonicalizeName(rawName)] ?? 0) : 0,
    };
  });
}

// ---------- In-Play Predictions (win %, top 5, make cut) ----------

async function fetchInPlayPreds() {
  const key = process.env.DATAGOLF_API_KEY;
  if (!key) return {};

  const url = 'https://feeds.datagolf.com/preds/in-play' +
    '?tour=pga&dead_heat=no&odds_format=percent&key=' + key;

  const r = await fetchWithRetry(url);
  if (!r.ok) throw new Error(`In-play preds ${r.status}`);
  const json = await r.json();

  const map = {};
  for (const p of (json.players || json.data || [])) {
    const rawName = p.player_name || '';
    if (!rawName) continue;
    map[canonicalizeName(rawName)] = {
      win:      p.win      ?? null,
      top_5:    p.top_5    ?? null,
      make_cut: p.make_cut ?? null,
    };
  }
  return map;
}

// ---------- Strokes Gained ----------

async function fetchSGStats() {
  const key = process.env.DATAGOLF_API_KEY;
  if (!key) return {};

  const url = 'https://feeds.datagolf.com/preds/live-tournament-stats' +
    '?stats=sg_putt,sg_arg,sg_app,sg_ott,sg_t2g,sg_total' +
    '&round=event_cumulative&display=value&file_format=json&key=' + key;

  const r = await fetchWithRetry(url);
  if (!r.ok) throw new Error(`SG stats ${r.status}`);
  const json = await r.json();

  // Build canonicalized name → SG object map
  const map = {};
  for (const p of (json.players || json.live_stats || [])) {
    const rawName = p.player_name || p.name || '';
    if (!rawName) continue;
    map[canonicalizeName(rawName)] = {
      sg_putt:  p.sg_putt  ?? null,
      sg_arg:   p.sg_arg   ?? null,
      sg_app:   p.sg_app   ?? null,
      sg_ott:   p.sg_ott   ?? null,
      sg_t2g:   p.sg_t2g   ?? null,
      sg_total: p.sg_total ?? null,
    };
  }
  return map;
}

// ---------- DG World Rankings (OWGR + DG rank) ----------

async function fetchDGRankings() {
  const key = process.env.DATAGOLF_API_KEY;
  if (!key) return {};

  const url = 'https://feeds.datagolf.com/preds/get-dg-rankings?file_format=json&key=' + key;
  const r = await fetchWithRetry(url);
  if (!r.ok) throw new Error(`DG rankings ${r.status}`);
  const json = await r.json();

  const map = {};
  for (const p of (json.rankings || json.players || json.data || [])) {
    const rawName = p.player_name || p.name || '';
    if (!rawName) continue;
    map[canonicalizeName(rawName)] = {
      dgRank:   p.datagolf_rank ?? p.dg_rank ?? p.rank ?? null,
      owgrRank: p.owgr_rank ?? p.world_ranking ?? null,
    };
  }
  return map;
}

// ---------- Pre-Tournament Odds ----------

async function fetchPreTournamentOdds() {
  const key = process.env.DATAGOLF_API_KEY;
  if (!key) return {};

  const url = 'https://feeds.datagolf.com/preds/pre-tournament' +
    '?tour=pga&dead_heat=no&odds_format=percent&file_format=json&key=' + key;
  const r = await fetchWithRetry(url);
  if (!r.ok) throw new Error(`Pre-tournament odds ${r.status}`);
  const json = await r.json();

  const map = {};
  for (const p of (json.players || json.data || [])) {
    const rawName = p.player_name || p.name || '';
    if (!rawName) continue;
    map[canonicalizeName(rawName)] = {
      win:    p.win    ?? null,
      top_5:  p.top_5  ?? null,
      top_10: p.top_10 ?? null,
      make_cut: p.make_cut ?? null,
    };
  }
  return map;
}

module.exports = {
  WORKER_URL,
  WORKER_BACKUP_URL,
  TEAMS_TSV_URL,
  PURSE,
  BUDGET,
  normalizeName,
  canonicalizeName,
  displayName,
  parsePosition,
  fmtScore,
  fmtThru,
  fetchLiveScores,
  fetchPoolEntries,
  fetchPayoutTable,
  fetchSGStats,
  fetchInPlayPreds,
  fetchDGRankings,
  fetchPreTournamentOdds,
  applyBudgetCompliance,
  buildEarningsMap,
  computeStandings,
  buildMastersLeaderboard,
};
