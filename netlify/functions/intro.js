const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

exports.handler = async () => {
  try {
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Search the web for the latest news on the Masters Tournament at Augusta National. Today's date is ${today}. If the tournament has not yet started, preview the field and storylines to watch. If the tournament is currently underway, give the latest leaderboard update and key moments. If the tournament has recently concluded, summarize the champion and how it unfolded. Write your response in the style of a 1930s sports journalist — colorful, dramatic, authoritative. About 150 words. Address the reader directly as visitors to a golf pool website tracking the action. Write in plain prose only — no markdown, no bold, no bullet points, no headers, no asterisks, no dashes. Just flowing sentences and paragraphs.`
        }
      ]
    });

    const introText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ')
      .trim() || 'Welcome to the Masters Pool! Follow along as the drama unfolds at Augusta National.';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, s-maxage=60'
      },
      body: JSON.stringify({ intro: introText })
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
