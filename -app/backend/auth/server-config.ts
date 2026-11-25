export function productionAuthOrigin() {
  if (process.env.NODE_ENV !== 'production') return undefined;
  const url = new URL(process.env.NEXTAUTH_URL ?? '');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (process.env.NEXTAUTH_SECRET?.trim().length ?? 0) < 32) {
    throw new Error('Production requires a canonical HTTPS NEXTAUTH_URL and a strong NEXTAUTH_SECRET.');
  }
  return url.origin;
}
