require('dotenv').config();
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const PORT = process.env.PORT || 3000;

// 60-second cache for the intro
let introCache = { text: null, expiresAt: 0 };

app.get('/api/intro', async (req, res) => {
  try {
    const now = Date.now();
    if (introCache.text && now < introCache.expiresAt) {
      return res.json({ intro: introCache.text });
    }

    // Call Claude with web search to get a live Masters update
    const messages = [
      {
        role: 'user',
        content: `Search the web for the latest news on the Masters Tournament at Augusta National. Today's date is ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}. If the tournament has not yet started, preview the field and storylines to watch. If the tournament is currently underway, give the latest leaderboard update and key moments. If the tournament has recently concluded, summarize the champion and how it unfolded. Write your response in the style of a 1930s sports journalist — colorful, dramatic, authoritative. About 150 words. Address the reader directly as visitors to a golf pool website tracking the action. Write in plain prose only — no markdown, no bold, no bullet points, no headers, no asterisks, no dashes. Just flowing sentences and paragraphs.`
      }
    ];

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages
    });

    // Concatenate all text blocks from the response
    const introText = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ')
      .trim() || 'Welcome to the Masters Pool! Check the leaderboards to follow the action from Augusta.';

    introCache = { text: introText, expiresAt: now + 60_000 };
    res.json({ intro: introText });
  } catch (err) {
    console.error('Intro API error:', err.message);
    res.json({ intro: 'Welcome to the Masters Pool! Follow along as the drama unfolds at Augusta National.' });
  }
});

// Serve static files
app.use(express.static(path.join(__dirname)));

app.listen(PORT, () => {
  console.log(`Masters Pool running at http://localhost:${PORT}`);
});
