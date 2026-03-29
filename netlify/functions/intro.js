const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ALLOWED_ORIGIN = process.env.URL || 'https://masters-pool.org';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET',
};

exports.handler = async () => {
  try {
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Today's date is ${today}. Search the web for what's happening at the Masters Tournament at Augusta National right now.

If there is genuinely major breaking news — a stunning upset, a record-breaking score, a dramatic collapse, a historic milestone — lead with that urgently and clearly in 1-2 sentences.

Otherwise, write something fun, witty, and a little quirky: a charming detail about Augusta, an amusing player stat or moment, a playful observation about the week's action, or a clever hook that makes golf fans smile. Think of it as the voice of a witty caddie who has seen it all and loves the game.

Rules: plain text only, no markdown, no asterisks, no bullet points. 1-2 sentences max. Make it feel like it was written by a person, not a press release.`
        }
      ]
    });

    const preamble = /^(I'll|I will|I'm going to|Let me|Searching|Looking up)/i;
    const update = response.content
      .filter(b => b.type === 'text' && !preamble.test(b.text.trim()))
      .map(b => b.text)
      .join('')
      .trim();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=86400',
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
