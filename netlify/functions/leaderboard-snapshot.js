'use strict';

// Scheduled function — runs every 15 minutes via netlify.toml cron
// Computes current standings and appends a snapshot to Netlify Blobs
// for use by leaderboard.js to power daily movement & sparkline features.

const { getStore, connectLambda } = require('@netlify/blobs');
const { fetchLiveScores, fetchPoolEntries,
        buildEarningsMap, computeStandings } = require('./lib/pool-calc');

exports.handler = async (event) => {
  if (event.blobs) connectLambda(event);
  try {
    const [scoreData, entries] = await Promise.all([
      fetchLiveScores(),
      fetchPoolEntries(),
    ]);

    if (!scoreData.players.length) {
      console.log('No active tournament — snapshot skipped.');
      return { statusCode: 200, body: 'no_tournament' };
    }

    const earningsMap = buildEarningsMap(scoreData.players);
    const standings   = computeStandings(entries, scoreData.players, earningsMap);

    const snapshot = {
      time: new Date().toISOString(),
      standings: standings.map(e => ({
        name:          e.name,
        rank:          e.rank,
        totalEarnings: e.totalEarnings,
      })),
    };

    const store = getStore('leaderboard-history');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const key   = `snapshots_${today}`;

    const existing  = await store.get(key);
    const snapshots = existing ? JSON.parse(existing) : [];
    snapshots.push(snapshot);

    // Keep max 200 entries per day (15-min × 14 hours ≈ 56 snapshots)
    await store.set(key, JSON.stringify(snapshots.slice(-200)));

    console.log(`Snapshot saved: ${snapshot.time}, ${standings.length} teams`);
    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('Snapshot error:', err.message);
    return { statusCode: 500, body: err.message };
  }
};
