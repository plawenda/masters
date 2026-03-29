const ALLOWED_BASE = 'https://docs.google.com/spreadsheets/';

exports.handler = async (event) => {
  const url = event.queryStringParameters?.url;

  if (!url || !url.startsWith(ALLOWED_BASE)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Invalid or missing url parameter' })
    };
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Google Sheets returned ${response.status}`);
    }
    const text = await response.text();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'public, s-maxage=60'
      },
      body: text
    };
  } catch (err) {
    console.error('Sheet proxy error:', err.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Failed to fetch sheet data' })
    };
  }
};
