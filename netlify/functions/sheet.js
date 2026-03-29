const ALLOWED_BASE = 'https://docs.google.com/spreadsheets/';
const ALLOWED_ORIGIN = process.env.URL || 'https://masters-pool.org';
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET',
};

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
        'Cache-Control': 'public, s-maxage=60',
        ...CORS_HEADERS
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
