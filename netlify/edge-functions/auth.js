export default async function (request, context) {
  const url = new URL(request.url);

  // Allow the login page, the login POST endpoint, and static assets through unauthenticated
  const staticExtensions = /\.(png|jpg|jpeg|gif|svg|ico|webp|css|js|woff2?|ttf|otf)$/i;
  if (
    url.pathname === '/login.html' ||
    url.pathname === '/api/auth-login' ||
    url.pathname.startsWith('/.netlify/functions/auth-login') ||
    staticExtensions.test(url.pathname)
  ) {
    return context.next();
  }

  const cookie = request.headers.get('cookie') || '';
  const token  = Netlify.env.get('AUTH_TOKEN');

  if (token && cookie.includes(`masters_auth=${token}`)) {
    return context.next(); // authenticated
  }

  return Response.redirect(new URL('/login.html', request.url), 302);
}

export const config = { path: '/*' };
