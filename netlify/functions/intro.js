const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ALLOWED_ORIGIN = process.env.URL || 'https://masters-pool.org';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET',
};

// Build a compact pool summary string to inject into the Claude prompt
function buildPoolSummary(lb) {
  const pool = (lb.poolLeaderboard || []).slice(0, 5);
  const masters = (lb.mastersLeaderboard || []).slice(0, 3);
  const totalTeams = (lb.poolLeaderboard || []).length;

  const lines = pool.map(t => {
    const move = t.dailyMove > 0 ? `up ${t.dailyMove}` : t.dailyMove < 0 ? `down ${Math.abs(t.dailyMove)}` : 'no change';
    return `  ${t.rank}. ${t.name} (${move} today)`;
  });

  // Find the tournament leader and how many pool teams picked them
  const leader = masters[0];
  let hotPickLine = '';
  if (leader) {
    const leaderName = leader.name;
    const pickedBy = (lb.poolLeaderboard || []).filter(t =>
      t.golfers && t.golfers.some(g => g.name === leaderName)
    ).length;
    hotPickLine = `\nTournament leader: ${leaderName} (${leader.score || 'E'} through ${leader.thru || '?'} holes) — picked by ${pickedBy} of ${totalTeams} pool teams`;
  }

  return lines.join('\n') + hotPickLine;
}

exports.handler = async () => {
  try {
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    // Fetch leaderboard — serves as both tournament detection and pool data source
    const lb = await fetch('https://masters-pool.org/api/leaderboard')
      .then(r => r.json())
      .catch(() => null);

    const isTournamentLive = lb
      && lb.status !== 'no_tournament'
      && (lb.eventName || '').toLowerCase().includes('masters')
      && (lb.mastersLeaderboard || []).length > 0;

    let prompt;
    let cacheMaxAge;

    if (isTournamentLive) {
      const poolSummary = buildPoolSummary(lb);
      cacheMaxAge = 1800; // 30 min during tournament
      prompt = `Today is ${today}. The Masters Tournament is underway at Augusta National.

Here is the current pool standings (top 5 of ${(lb.poolLeaderboard || []).length} teams):
${poolSummary}

Search the web for the latest Masters leaderboard update. Then write 2-3 sentences that blend what's happening on the course with something interesting about the pool — a team surging, a popular pick who's hot or cold, or how many teams picked the current leader.

Rules: plain text only, no markdown, no asterisks, no bullet points. Don't mention dollar amounts — say "leading the pool" not specific dollar figures. Conversational, like a witty caddie who knows everyone in the pool.`;
    } else {
      cacheMaxAge = 43200; // 12h off-season
      prompt = `Today's date is ${today}. Search the web for what's happening at the Masters Tournament at Augusta National right now.

If there is genuinely major breaking news — a stunning upset, a record-breaking score, a dramatic collapse, a historic milestone — lead with that urgently and clearly in 1-2 sentences.

Otherwise, write something fun, witty, and a little quirky: a charming detail about Augusta, an amusing player stat or moment, a playful observation about the week's action, or a clever hook that makes golf fans smile. Think of it as the voice of a witty caddie who has seen it all and loves the game.

Rules: plain text only, no markdown, no asterisks, no bullet points. 1-2 sentences max. Make it feel like it was written by a person, not a press release.`;
    }

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      tool_choice: { type: 'any' },
      messages: [{ role: 'user', content: prompt }]
    });

    const update = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
      .replace(/^[,;–—\s]+/, '');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, s-maxage=${cacheMaxAge}, stale-while-revalidate=${cacheMaxAge * 2}`,
        ...CORS_HEADERS
      },
      body: JSON.stringify({ intro: update })
    };
  } catch (err) {
    console.error('Intro function error:', err.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ intro: 'Welcome to the Masters Pool! Follow along as the drama unfolds at Augusta National.' })
    };
  }
};
