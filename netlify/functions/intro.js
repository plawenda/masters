const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
          content: `Search the web for one interesting or surprising fact about the Masters Tournament at Augusta National right now. Today's date is ${today}. Write exactly 1-2 plain sentences — no markdown, no bold, no bullet points, no asterisks. Just a single punchy update a golf fan would find compelling.`
        }
      ]
    });

    const update = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ')
      .trim() || '';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=43200, stale-while-revalidate=86400'
      },
      body: JSON.stringify({ intro: update })
    };
  } catch (err) {
    console.error('Intro function error:', err.message);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intro: 'Welcome to the Masters Pool! Follow along as the drama unfolds at Augusta National.' })
    };
  }
};
