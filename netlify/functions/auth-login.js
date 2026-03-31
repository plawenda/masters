'use strict';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': process.env.URL || 'https://masters-pool.org',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: CORS_HEADERS };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: CORS_HEADERS, body: 'Method Not Allowed' };
  }

  let password;
  try {
    ({ password } = JSON.parse(event.body || '{}'));
  } catch {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  const correctPassword = process.env.SITE_PASSWORD;
  const token           = process.env.AUTH_TOKEN;

  if (!password || !correctPassword || password !== correctPassword) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      body: JSON.stringify({ error: 'Incorrect password' }),
    };
  }

  // 7-day session cookie
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': `masters_auth=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800`,
      ...CORS_HEADERS,
    },
    body: JSON.stringify({ ok: true }),
  };
};
