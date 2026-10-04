// Pure helpers (unit-tested): dedupe + filter links.
export function dedupe(links, { ignoreHash = true } = {}) {
  const seen = new Set(); const out = [];
  for (const l of links) {
    const k = ignoreHash ? l.url.replace(/#.*$/, '') : l.url;
    if (seen.has(k)) continue; seen.add(k); out.push(l);
  }
  return out;
}
// File-type groups by URL path extension (query string/hash ignored).
export const KINDS = {
  docs: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt', 'epub'],
  images: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'bmp', 'tif', 'tiff', 'ico', 'heic'],
  media: ['mp3', 'mp4', 'm4a', 'm4v', 'wav', 'ogg', 'oga', 'webm', 'mov', 'avi', 'mkv', 'flac', 'aac'],
  archives: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'dmg', 'iso', 'exe', 'msi', 'apk', 'deb', 'rpm'],
};
export function extOf(url) {
  let p; try { p = new URL(url).pathname; } catch { p = url.replace(/[?#].*$/, ''); }
  const m = /\.([a-z0-9]{1,5})$/i.exec(p); return m ? m[1].toLowerCase() : '';
}
// opts: {scope: 'all'|'internal'|'external', query: string (substring or /regex/i), kind: 'any'|'pages'|keyof KINDS}
export function filterLinks(links, { scope = 'all', query = '', kind = 'any' } = {}) {
  const all = Object.values(KINDS).flat();
  const kindOk = kind === 'any' ? () => true : kind === 'pages' ? l => /^https?:/i.test(l.url) && !all.includes(extOf(l.url)) : l => (KINDS[kind] || []).includes(extOf(l.url));
  let test = () => true; const q = query.trim();
  if (q) {
    const m = /^\/(.+)\/([gimsuy]*)$/.exec(q);
    if (m) { let re; try { re = new RegExp(m[1], m[2].replace('g', '')); } catch { return { links: [], error: 'Invalid regex' }; } test = l => re.test(l.url) || re.test(l.text); }
    else { const s = q.toLowerCase(); test = l => l.url.toLowerCase().includes(s) || l.text.toLowerCase().includes(s); }
  }
  const out = links.filter(l => (scope === 'all' || (scope === 'internal') === l.internal) && kindOk(l) && test(l));
  return { links: out, error: null };
}
export const toRows = links => [['URL', 'Anchor text', 'rel', 'New tab', 'Internal'],
  ...links.map(l => [l.url, l.text, l.rel, l.newTab ? 'yes' : 'no', l.internal ? 'yes' : 'no'])];
