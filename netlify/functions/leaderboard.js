'use strict';

const { getStore, connectLambda } = require('@netlify/blobs');
const { fetchLiveScores, fetchPoolEntries, fetchPayoutTable, fetchSGStats, fetchInPlayPreds,
        fetchDGRankings, fetchPreTournamentOdds,
        applyBudgetCompliance, buildEarningsMap, computeStandings, buildMastersLeaderboard, normalizeName } = require('./lib/pool-calc');

const ALLOWED_ORIGIN = process.env.URL || 'https://masters-pool.org';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET',
};

// ---------- Blob helpers ----------

async function getTodaySnapshots() {
  try {
    const store = getStore('leaderboard-history');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
    const raw   = await store.get(`snapshots_${today}`);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Blob read skipped:', e.message);
    return [];
  }
}

// Write a snapshot on this request if the last stored one is >15 min old.
// This ensures history builds even if the scheduled cron is unreliable.
async function maybeWriteSnapshot(standings, existingSnapshots) {
  try {
    const fifteenMinAgo = Date.now() - 15 * 60 * 1000;
    const lastTime = existingSnapshots.length
      ? new Date(existingSnapshots[existingSnapshots.length - 1].time).getTime()
      : 0;
    if (lastTime > fifteenMinAgo) return; // recent snapshot exists, skip

    const store = getStore('leaderboard-history');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const key   = `snapshots_${today}`;

    const snapshot = {
      time: new Date().toISOString(),
      standings: standings.map(e => ({ name: e.name, rank: e.rank, totalEarnings: e.totalEarnings })),
    };
    existingSnapshots.push(snapshot);
    const updated = existingSnapshots.slice(-200);
    await store.set(key, JSON.stringify(updated));
    console.log(`[leaderboard] On-demand snapshot saved: ${snapshot.time}, ${standings.length} teams`);
  } catch (e) {
    console.warn('[leaderboard] Snapshot write skipped:', e.message);
  }
}

// ---------- Movement stats ----------

function computeMovement(entryName, currentRank, snapshots) {
  if (!snapshots.length) {
    return { dailyMove: 0, peakRank: currentRank, recentMove: 0, history: [] };
  }

  const history = snapshots
    .map(s => {
      const found = s.standings.find(x => x.name === entryName);
      return found ? { time: s.time, rank: found.rank } : null;
    })
    .filter(Boolean);

  if (!history.length) {
    return { dailyMove: 0, peakRank: currentRank, recentMove: 0, history: [] };
  }

  const startRank  = history[0].rank;
  const dailyMove  = startRank - currentRank; // positive = improved (moved up)
  const peakRank   = Math.min(currentRank, ...history.map(h => h.rank));

  const oneHourAgo  = Date.now() - 60 * 60 * 1000;
  const hourEntry   = [...history].reverse().find(h => new Date(h.time).getTime() <= oneHourAgo);
  const recentMove  = hourEntry ? hourEntry.rank - currentRank : 0;

  return { dailyMove, peakRank, recentMove, history };
}

// ---------- Handler ----------

exports.handler = async (event) => {
  if (event.blobs) connectLambda(event);
  try {
    // Core data (parallel — different services)
    const [scoreData, entries, snapshots, payoutMap] = await Promise.all([
      fetchLiveScores(),
      fetchPoolEntries(),
      getTodaySnapshots(),
      fetchPayoutTable().catch(e => { console.warn('Payout table failed, using hardcoded PURSE:', e.message); return {}; }),
    ]);

    // DataGolf calls (sequential — same API key, avoids 429 rate limits)
    const sgMap       = await fetchSGStats().catch(e =>       { console.warn('SG fetch failed:', e.message); return {}; });
    const predMap     = await fetchInPlayPreds().catch(e =>    { console.warn('In-play preds failed:', e.message); return {}; });
    const rankingsMap = await fetchDGRankings().catch(e =>     { console.warn('DG rankings failed:', e.message); return {}; });
    const preTournMap = await fetchPreTournamentOdds().catch(e => { console.warn('Pre-tourney odds failed:', e.message); return {}; });

    // Apply budget compliance — marks over-budget teams' cheapest golfers as dropped
    applyBudgetCompliance(entries);

    // Golfer ownership: how many pool teams selected each player (dropped still count for ownership)
    const ownershipMap = {};
    for (const entry of entries) {
      for (const g of entry.golfers) {
        const key = normalizeName(g.name);
        ownershipMap[key] = (ownershipMap[key] || 0) + 1;
      }
    }
    const totalTeams = entries.length;

    if (!scoreData.players.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ status: 'no_tournament', lastUpdated: scoreData.lastUpdated }),
      };
    }

    const earningsMap        = buildEarningsMap(scoreData.players, payoutMap);
    const standings          = computeStandings(entries, scoreData.players, earningsMap);
    const mastersLeaderboard = buildMastersLeaderboard(scoreData.players, earningsMap).map(p => {
      const nameKey  = normalizeName(p.name);
      const preds    = predMap[nameKey]    ?? {};
      const rankings = rankingsMap[nameKey] ?? {};
      const preTn    = preTournMap[nameKey] ?? {};
      return {
        ...p,
        sg:              sgMap[nameKey]    ?? null,
        winPct:          preds.win         ?? null,
        top5Pct:         preds.top_5       ?? null,
        makeCutPct:      preds.make_cut    ?? null,
        dgRank:          rankings.dgRank   ?? null,
        owgrRank:        rankings.owgrRank ?? null,
        preTournWin:     preTn.win         ?? null,
        preTournTop5:    preTn.top_5       ?? null,
        preTournTop10:   preTn.top_10      ?? null,
        preTournMakeCut: preTn.make_cut    ?? null,
        ownership:       totalTeams > 0 ? Math.round((ownershipMap[nameKey] || 0) / totalTeams * 100) : 0,
        ownershipCount:  ownershipMap[nameKey] || 0,
      };
    });

    // Write a snapshot if none exists recently (fallback for unreliable cron)
    await maybeWriteSnapshot(standings, snapshots);

    // Attach movement stats to each team
    const poolLeaderboard = standings.map(entry => ({
      ...entry,
      ...computeMovement(entry.name, entry.rank, snapshots),
    }));

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
        ...CORS_HEADERS,
      },
      body: JSON.stringify({
        status:           'active',
        eventName:        scoreData.eventName,
        lastUpdated:      scoreData.lastUpdated,
        poolLeaderboard,
        mastersLeaderboard,
      }),
    };
  } catch (err) {
    console.error('Leaderboard error:', err.message);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ error: 'Failed to load leaderboard', detail: err.message }),
    };
  }
};
