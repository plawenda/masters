'use strict';

// ---------- Constants ----------

const WORKER_URL        = 'https://long-block-f301.patrick-lawenda.workers.dev/';
const WORKER_BACKUP_URL = 'https://datagolf-v2.patrick-lawenda.workers.dev/';

// RawTeamData tab (gid=0) — must be published via File → Share → Publish to web
const TEAMS_TSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT_htvNiJZPFTNohWOu_fT0VjKlQQWfMFEi08SU1tlN3HHauBbe-I5O3KPbwc-WPkBR8Hdh5yEMssOl/pub?gid=0&single=true&output=tsv';

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

function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

// ---------- Fetch helpers ----------

async function fetchLiveScores() {
  let json;
  try {
    const r = await fetch(WORKER_URL, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Worker ${r.status}`);
    json = await r.json();
    // Primary worker shape: { live_stats, course_name, event_name, last_updated }
    return {
      players:     json.live_stats || [],
      eventName:   json.event_name || 'Masters Tournament',
      lastUpdated: json.last_updated || new Date().toISOString(),
    };
  } catch (e) {
    console.warn('Primary worker failed, trying backup:', e.message);
    const r = await fetch(WORKER_BACKUP_URL, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`Backup worker ${r.status}`);
    json = await r.json();
    // Backup shape: { data, info: { event_name, last_update } }
    return {
      players:     json.data || [],
      eventName:   json.info?.event_name || 'Masters Tournament',
      lastUpdated: json.info?.last_update || new Date().toISOString(),
    };
  }
}

async function fetchPoolEntries() {
  const r = await fetch(TEAMS_TSV_URL, { signal: AbortSignal.timeout(8000) });
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
      // Parse "Golfer Name ($X.XX), ..." → ["Golfer Name", ...]
      const golfers = picksRaw
        .split(',')
        .map(s => s.replace(/\s*\(\$[\d.]+\)\s*$/, '').trim())
        .filter(Boolean);
      return { name, golfers };
    })
    .filter(e => e.name && e.golfers.length);
}

// ---------- Calculation ----------

// Builds a map of normalizedName → expected earnings, handling ties via purse averaging
function buildEarningsMap(players) {
  const byPos = {};
  for (const p of players) {
    const pos = parsePosition(p.position ?? p.current_pos);
    if (pos === null) continue;
    if (!byPos[pos]) byPos[pos] = [];
    byPos[pos].push(p);
  }

  const earningsMap = {};
  for (const [posStr, tied] of Object.entries(byPos)) {
    const startPos = parseInt(posStr, 10);
    let total = 0;
    for (let i = startPos; i < startPos + tied.length; i++) {
      total += PURSE[i] || 0;
    }
    const each = Math.round(total / tied.length);
    for (const p of tied) {
      earningsMap[normalizeName(p.player_name)] = each;
    }
  }
  return earningsMap;
}

// Compute pool standings from entries + live players
function computeStandings(entries, players, earningsMap) {
  // Build quick lookup for player data
  const playerMap = {};
  for (const p of players) {
    playerMap[normalizeName(p.player_name)] = p;
  }

  const teams = entries.map(entry => {
    let totalEarnings = 0;
    const golferDetails = entry.golfers.map(name => {
      const key      = normalizeName(name);
      const player   = playerMap[key];
      const earnings = earningsMap[key] ?? 0;
      const posStr   = (player?.position ?? player?.current_pos ?? '').toString().toUpperCase().trim();
      const inactive = isInactive(posStr);
      totalEarnings += earnings;
      return {
        name,
        position: player ? (player.position ?? player.current_pos ?? '-') : '?',
        score:    player ? fmtScore(player.total ?? player.total_score) : '-',
        today:    player ? fmtScore(player.today ?? player.today_score) : '-',
        thru:     player ? (inactive ? posStr : fmtThru(player.thru)) : '-',
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
    const posStr   = (p.position ?? p.current_pos ?? '').toString().toUpperCase().trim();
    const inactive = isInactive(posStr);
    return {
      name:     p.player_name,
      position: p.position ?? p.current_pos ?? '-',
      score:    fmtScore(p.total ?? p.total_score),
      today:    fmtScore(p.today ?? p.today_score),
      thru:     inactive ? posStr : fmtThru(p.thru),
      status:   inactive ? posStr.toLowerCase() : 'active',
      earnings: earningsMap[normalizeName(p.player_name)] ?? 0,
    };
  });
}

module.exports = {
  WORKER_URL,
  WORKER_BACKUP_URL,
  TEAMS_TSV_URL,
  PURSE,
  normalizeName,
  parsePosition,
  fmtScore,
  fmtThru,
  fetchLiveScores,
  fetchPoolEntries,
  buildEarningsMap,
  computeStandings,
  buildMastersLeaderboard,
};
