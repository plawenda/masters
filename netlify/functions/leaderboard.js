'use strict';

const { getStore }           = require('@netlify/blobs');
const { fetchLiveScores, fetchPoolEntries, buildEarningsMap,
        computeStandings, buildMastersLeaderboard } = require('./lib/pool-calc');

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

exports.handler = async () => {
  try {
    const [scoreData, entries, snapshots] = await Promise.all([
      fetchLiveScores(),
      fetchPoolEntries(),
      getTodaySnapshots(),
    ]);

    if (!scoreData.players.length) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        body: JSON.stringify({ status: 'no_tournament', lastUpdated: scoreData.lastUpdated }),
      };
    }

    const earningsMap       = buildEarningsMap(scoreData.players);
    const standings         = computeStandings(entries, scoreData.players, earningsMap);
    const mastersLeaderboard = buildMastersLeaderboard(scoreData.players, earningsMap);

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
