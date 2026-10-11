import path from 'node:path';
import fs from 'node:fs';

export const BROWSERS = new Set(['brave', 'chrome', 'edge', 'firefox', 'chromium', 'opera', 'vivaldi']);
export function isYouTube(url) {
  const host = new URL(url).hostname.toLowerCase();
  return host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com');
}
export function canonicalSource(url) {
  const u = new URL(url);
  if (!isYouTube(url)) { u.hash = ''; return u.toString(); }
  const parts = u.pathname.split('/').filter(Boolean);
  const id = u.hostname === 'youtu.be' ? parts[0] : u.searchParams.get('v') || (['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : '');
  return /^[a-zA-Z0-9_-]{11}$/.test(id || '') ? `https://www.youtube.com/watch?v=${id}` : u.toString();
}
export function normalizeAuth(value = {}) {
  const method = value.method || 'none';
  if (!['none', 'browser', 'file'].includes(method)) throw new Error('Forma de autenticação inválida.');
  const browser = value.browser || 'brave';
  if (!BROWSERS.has(browser)) throw new Error('Navegador não suportado.');
  const profile = String(value.profile || '').trim();
  if (profile.length > 500 || /[\r\n\0]/.test(profile)) throw new Error('Perfil do navegador inválido.');
  return {method, browser, profile};
}
export function cookiePath(dataRoot) { return path.join(dataRoot, 'private', 'youtube-cookies.txt'); }
export function authArgs(url, settings, dataRoot) {
  if (!isYouTube(url)) return [];
  const auth = normalizeAuth(settings.authentication);
  if (auth.method === 'browser') return ['--cookies-from-browser', auth.browser + (auth.profile ? ':' + auth.profile : '')];
  if (auth.method === 'file') {
    const file = cookiePath(dataRoot);
    if (!fs.existsSync(file)) throw new Error('Importe um arquivo de cookies do YouTube nas configurações.');
    return ['--cookies', file];
  }
  return [];
}
// Only YouTube cookies are retained; cookies from other sites are discarded.
export function filterYouTubeCookies(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 2_000_000) throw new Error('Arquivo de cookies inválido ou muito grande.');
  if (!/^# (?:Netscape HTTP Cookie File|HTTP Cookie File)/m.test(text)) throw new Error('Use um arquivo cookies.txt no formato Netscape.');
  const lines = [];
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!raw || (raw.startsWith('#') && !raw.startsWith('#HttpOnly_'))) continue;
    const fields = raw.split('\t');
    if (fields.length !== 7 || fields.some(f => /[\r\n\0]/.test(f))) continue;
    const host = fields[0].replace(/^#HttpOnly_/, '').replace(/^\./, '').toLowerCase();
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) lines.push(fields.join('\t'));
  }
  if (!lines.length) throw new Error('O arquivo não contém cookies válidos do YouTube.');
  return {text: '# Netscape HTTP Cookie File\n' + lines.join('\n') + '\n', count: lines.length};
}
