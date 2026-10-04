// Pure-ish converters for the free web tools (DOMParser is the only browser API used).
import { toMarkdown as rowsToMarkdown } from './formats.js';

const parse = html => new DOMParser().parseFromString(html, 'text/html');
const clean = s => s.replace(/\s+/g, ' ').trim();
const absUrl = (u, base) => { if (!base) return u; try { return new URL(u, base).href; } catch { return u; } };

// ---- HTML tables -> rows (colspan/rowspan expanded; spanned cells repeat the value)
export function tableRows(t) {
  const grid = []; const trs = [...t.rows];
  trs.forEach((tr, r) => {
    grid[r] = grid[r] || []; let c = 0;
    for (const cell of tr.cells) {
      while (grid[r][c] !== undefined) c++;
      // a rowspan ends with its row group (thead/tbody/tfoot), per the HTML spec; rowspan="0" = to the end of the group
      let end = r; while (end + 1 < trs.length && trs[end + 1].parentNode === tr.parentNode) end++;
      const cs = Math.min(Math.max(1, cell.colSpan || 1), 100), rs = cell.rowSpan === 0 ? end - r + 1 : Math.min(Math.max(1, cell.rowSpan || 1), end - r + 1);
      const k = cell.cloneNode(true); k.querySelectorAll('br').forEach(b => b.replaceWith(' ')); // "1<br>2" -> "1 2", not "12"
      const txt = clean(k.textContent);
      for (let i = 0; i < rs; i++) { const row = grid[r + i] = grid[r + i] || []; for (let j = 0; j < cs; j++) row[c + j] = txt; }
      c += cs;
    }
  });
  const w = Math.max(0, ...grid.map(r => r.length));
  return grid.slice(0, trs.length).map(r => Array.from({ length: w }, (_, i) => r[i] ?? ''));
}
export function extractTables(html) {
  return [...parse(html).querySelectorAll('table')].map(tableRows).filter(r => r.length);
}

// ---- HTML -> Markdown
const BLOCK = new Set(['address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul']);
const SKIP = new Set(['script', 'style', 'noscript', 'template', 'head', 'iframe', 'svg', 'button', 'input', 'select', 'textarea']);
const escMd = s => s.replace(/([\\`*_[\]])/g, '\\$1');

// '(' must be encoded along with ')': an unbalanced '(' ends the link destination (x(1%29 broke the link).
const mdUrl = u => u.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
// Text that would start a block when it begins a line: "1. ", "2024) ", "# ", "- ", "+ ", "> ", or a setext "---" / "===" line.
const escBlockStart = l => l.replace(/^(\d{1,9})([.)])(?=\s|$)/, '$1\\$2').replace(/^([#>+-])(?=\s|$)/, '\\$1').replace(/^([=-])(?=\1*\s*$)/, '\\$1');
function inline(n, base) {
  if (n.nodeType === 3) return escMd(n.nodeValue.replace(/\s+/g, ' '));
  if (n.nodeType !== 1) return '';
  const t = n.tagName.toLowerCase();
  if (SKIP.has(t)) return '';
  const kids = () => [...n.childNodes].map(c => inline(c, base)).join('');
  const wrap = (m, s) => { const k = s.trim(); return k ? `${m}${k}${m}` : ''; };
  switch (t) {
    case 'br': return '  \n';
    case 'strong': case 'b': return wrap('**', kids());
    case 'em': case 'i': return wrap('*', kids());
    case 'del': case 's': return wrap('~~', kids());
    case 'code': case 'kbd': case 'samp': {
      const s = n.textContent; const tick = s.includes('`') ? '``' : '`';
      return s ? `${tick}${tick === '``' ? ' ' + s + ' ' : s}${tick}` : '';
    }
    case 'a': {
      const k = kids().trim(); const h = n.getAttribute('href');
      if (!h || /^javascript:/i.test(h)) return k;
      const title = n.getAttribute('title');
      return `[${k || escMd(h)}](${mdUrl(absUrl(h, base))}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    }
    case 'img': {
      const src = n.getAttribute('src'); if (!src) return '';
      return `![${escMd(n.getAttribute('alt') || '')}](${mdUrl(absUrl(src, base))})`;
    }
    default: return kids();
  }
}

function blocks(n, base) {
  const out = []; let run = '';
  const flush = () => {
    const ls = run.split('\n'); const s = ls.map((l, i) => escBlockStart(l.trim()) + (i < ls.length - 1 ? '  ' : '')).join('\n').replace(/ {2,}(?!\n)/g, ' ').trim();
    if (s) out.push(s); run = '';
  };
  for (const c of n.childNodes) {
    if (c.nodeType === 1 && BLOCK.has(c.tagName.toLowerCase())) { flush(); const b = block(c, base); if (b && b.trim()) out.push(b); }
    else run += inline(c, base);
  }
  flush();
  return out;
}

function list(n, base, ordered) {
  let i = parseInt(n.getAttribute('start') || '1', 10) || 1;
  const items = [];
  for (const li of n.children) {
    if (li.tagName.toLowerCase() !== 'li') continue;
    const marker = ordered ? `${i++}. ` : '- ';
    // two or more paragraphs in one item need a blank line between them, or they merge into one ("p1p2")
    const body = blocks(li, base).join(li.querySelectorAll(':scope > p').length > 1 ? '\n\n' : '\n').split('\n');
    items.push(marker + body[0] + body.slice(1).map(l => '\n' + (l ? ' '.repeat(marker.length) + l : '')).join(''));
  }
  return items.join('\n');
}

function block(n, base) {
  const t = n.tagName.toLowerCase();
  if (/^h[1-6]$/.test(t)) { const s = clean(inline(n, base)); return s ? '#'.repeat(+t[1]) + ' ' + s : ''; }
  switch (t) {
    case 'hr': return '---';
    case 'ul': return list(n, base, false);
    case 'ol': return list(n, base, true);
    case 'pre': {
      const code = n.querySelector('code') || n;
      const m = /(?:language|lang)-([\w+#-]+)/.exec((code.className || '') + ' ' + (n.className || ''));
      const text = code.textContent.replace(/\n$/, '');
      const fence = text.includes('```') ? '~~~' : '```';
      return `${fence}${m ? m[1] : ''}\n${text}\n${fence}`;
    }
    case 'blockquote': return blocks(n, base).join('\n\n').split('\n').map(l => l ? '> ' + l : '>').join('\n');
    case 'table': {
      const rows = tableRows(n).map(r => r.map(c => c)); if (!rows.length) return '';
      return rowsToMarkdown(rows);
    }
    default: return blocks(n, base).join('\n\n');
  }
}

export function htmlToMarkdown(html, base = '') {
  const doc = parse(html);
  return blocks(doc.body, base).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---- links
export function extractLinks(html, base = '') {
  const doc = parse(html); let host = '';
  // a <base href> in the pasted HTML decides how its relative links resolve (as in the browser), on top of the page URL field
  const docBase = doc.querySelector('base[href]')?.getAttribute('href')?.trim();
  if (docBase) { try { base = new URL(docBase, base || undefined).href; } catch { /* relative base without a page URL: ignore */ } }
  if (base) { try { host = new URL(base).host; } catch { base = ''; } }
  const links = [];
  for (const a of doc.querySelectorAll('a[href], area[href]')) {
    const raw = a.getAttribute('href').trim();
    if (!raw || /^javascript:/i.test(raw)) continue;
    const url = absUrl(raw, base);
    let internal = false;
    if (host) { try { internal = new URL(url).host === host; } catch { /* keep false */ } }
    else internal = !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('//');
    // image-only links (logos, icons): fall back to aria-label / title / the img alt
    links.push({ url, text: clean(a.textContent || a.getAttribute('aria-label') || a.getAttribute('title') || a.getAttribute('alt') || a.querySelector('img[alt]')?.getAttribute('alt') || ''), rel: a.getAttribute('rel') || '', newTab: a.getAttribute('target') === '_blank', internal });
  }
  return links;
}

// ---- HTTP headers
export function parseHeaders(input) {
  const s = input.trim(); const pairs = []; const skipped = [];
  if (!s) return { pairs, skipped };
  if (s.startsWith('{')) {
    const o = JSON.parse(s);
    for (const [k, v] of Object.entries(o)) pairs.push([k, Array.isArray(v) ? v.join(', ') : String(v)]);
    return { pairs, skipped };
  }
  if (/(^|\s)(-H|--header)\s/.test(s)) {
    const re = /(?:-H|--header)\s+(?:'((?:[^']|'\\'')*)'|"((?:[^"\\]|\\.)*)"|(\S+))/g; let m;
    while ((m = re.exec(s))) {
      const h = m[1] !== undefined ? m[1].replace(/'\\''/g, "'") : m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : m[3];
      const i = h.indexOf(':'); if (i > 0) pairs.push([h.slice(0, i).trim(), h.slice(i + 1).trim()]);
    }
    return { pairs, skipped };
  }
  for (const line of s.split(/\r?\n/)) {
    const l = line.trim(); if (!l) continue;
    if (/^[A-Z]+ \S+ HTTP\/[\d.]+$/.test(l) || /^HTTP\/[\d.]+ \d{3}/.test(l)) { skipped.push(l); continue; }
    if (l.startsWith(':')) { skipped.push(l); continue; }
    const i = l.indexOf(':');
    if (i <= 0) { skipped.push(l); continue; }
    pairs.push([l.slice(0, i).trim(), l.slice(i + 1).trim()]);
  }
  return { pairs, skipped };
}
const FETCH_FORBIDDEN = new Set(['accept-charset', 'accept-encoding', 'access-control-request-headers', 'access-control-request-method', 'connection', 'content-length', 'cookie', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin', 'referer', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'via']);
export function formatHeaders(pairs, fmt = 'json', { lower = false } = {}) {
  // duplicate headers merge with ', ' (RFC 9110), except Cookie: its pairs are separated by '; ' (RFC 6265)
  const ps = pairs.map(([k, v]) => [lower ? k.toLowerCase() : k, v]);
  const merged = () => { const o = {}; const keyOf = {}; for (const [k, v] of ps) { const lk = k.toLowerCase(); if (lk in keyOf) o[keyOf[lk]] += (lk === 'cookie' ? '; ' : ', ') + v; else { keyOf[lk] = k; o[k] = v; } } return o; };
  const sq = v => `'${v.replace(/'/g, "'\\''")}'`;
  if (fmt === 'curl') return ps.map(([k, v]) => `-H ${sq(`${k}: ${v}`)}`).join(' \\\n') + '\n';
  if (fmt === 'raw') return ps.map(([k, v]) => `${k}: ${v}`).join('\n') + '\n';
  if (fmt === 'python') return 'headers = {\n' + Object.entries(merged()).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n') + '\n}\n';
  if (fmt === 'fetch') {
    const o = merged(); const ok = {}; const bad = [];
    for (const [k, v] of Object.entries(o)) (FETCH_FORBIDDEN.has(k.toLowerCase()) || /^(proxy|sec)-/i.test(k) ? bad.push(k) : ok[k] = v);
    return (bad.length ? `// Set by the browser, not allowed in fetch(): ${bad.join(', ')}\n` : '') +
      `fetch(url, {\n  headers: ${JSON.stringify(ok, null, 2).replace(/\n/g, '\n  ')}\n});\n`;
  }
  return JSON.stringify(merged(), null, 2) + '\n';
}

// ---- color palette
const hex2 = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
export function normColor(c) {
  c = c.trim().toLowerCase();
  let m = /^#?([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    if (h.length === 8 && h.endsWith('ff')) h = h.slice(0, 6);
    return '#' + h;
  }
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)[\s,]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+)(%)?)?\s*\)$/.exec(c);
  if (m) {
    let a = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[5] ? 100 : 1);
    return '#' + hex2(+m[1]) + hex2(+m[2]) + hex2(+m[3]) + (a < 1 ? hex2(a * 255) : '');
  }
  return null;
}
// accents are transliterated (Été -> ete, not 't'); diacritics are dropped after NFKD
const slug = s => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/^[-$@]+/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const COLOR_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|(?<![\w#-])[0-9a-f]{6}(?![\w-])/gi;
export function parsePalette(text, prefix = 'color') {
  const out = []; const seen = new Set(); const names = new Set(); let n = 0;
  const pre = slug(prefix) || 'color';
  for (const line of text.split(/\r?\n/)) {
    const found = [...line.matchAll(COLOR_RE)];
    if (!found.length) continue;
    let label = found.length === 1 ? slug(line.slice(0, found[0].index).replace(/[:=]\s*$/, '').replace(/["']/g, '')) : '';
    if (/^\d/.test(label)) label = `${pre}-${label}`; // Sass/JS-style names can't start with a digit ($1st-brand is a Sass error)
    for (const f of found) {
      const hex = normColor(f[0]); if (!hex || seen.has(hex)) continue; seen.add(hex);
      let name = label || `${pre}-${++n}`;
      while (names.has(name)) name = `${label || pre}-${++n}`;
      names.add(name); out.push({ name, hex });
    }
  }
  return out;
}
export function formatPalette(colors, fmt = 'css') {
  if (fmt === 'scss') return colors.map(c => `$${c.name}: ${c.hex};`).join('\n') + '\n';
  if (fmt === 'tw4') return `@theme {\n${colors.map(c => `  --color-${c.name}: ${c.hex};`).join('\n')}\n}\n`;
  const obj = Object.fromEntries(colors.map(c => [c.name, c.hex]));
  if (fmt === 'tw3') return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: ${JSON.stringify(obj, null, 2).replace(/\n/g, '\n      ')}\n    }\n  }\n};\n`;
  if (fmt === 'json') return JSON.stringify(obj, null, 2) + '\n';
  return `:root {\n${colors.map(c => `  --${c.name}: ${c.hex};`).join('\n')}\n}\n`;
}

// CSV/TSV text -> rows. RFC 4180 quotes (incl. newlines in quotes); delimiter auto-detected from the first line.
export function parseCSV(text, delim = '') {
  text = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (!delim) {
    // count delimiters outside quotes in the first line; any tab wins (Excel/Sheets pastes are TSV and their cells often
    // contain commas: 'Product, USD<TAB>Qty' was split on commas)
    const first = text.split('\n')[0].replace(/"(?:[^"]|"")*"/g, '');
    delim = first.includes('\t') ? '\t' : [',', ';', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  }
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (text) { row.push(cell); rows.push(row); }
  const w = Math.max(0, ...rows.map(r => r.length));
  return rows.map(r => r.concat(Array(w - r.length).fill('')));
}
export function rowsToHTML(rows) {
  const e = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const [head, ...body] = rows;
  return '<table>\n  <thead>\n    <tr>' + head.map(c => `<th>${e(c)}</th>`).join('') + '</tr>\n  </thead>\n  <tbody>\n' +
    body.map(r => '    <tr>' + r.map(c => `<td>${e(c)}</td>`).join('') + '</tr>\n').join('') + '  </tbody>\n</table>';
}

// JSON -> rows: array of objects (or {key: [...]} wrapper / single object). Nested objects flatten to dot keys; arrays of
// scalars join with "; ", other arrays stay JSON. Columns = union of keys in first-seen order.
export function jsonToRows(text) {
  let data = JSON.parse(text);
  if (!Array.isArray(data) && data && typeof data === 'object') {
    const arr = Object.values(data).find(v => Array.isArray(v) && v.some(x => x && typeof x === 'object'));
    data = arr || [data];
  }
  if (!Array.isArray(data)) data = [data];
  const flat = (o, pre = '', out = {}) => {
    if (o === null || typeof o !== 'object') { out[pre || 'value'] = o; return out; }
    if (Array.isArray(o)) { out[pre || 'value'] = o.every(x => x === null || typeof x !== 'object') ? o.join('; ') : JSON.stringify(o); return out; }
    for (const [k, v] of Object.entries(o)) {
      flat(v, pre ? `${pre}.${k}` : k, out);
    }
    return out;
  };
  const recs = data.map(r => flat(r)), cols = [];
  for (const r of recs) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  return [cols, ...recs.map(r => cols.map(c => r[c] === undefined || r[c] === null ? '' : String(r[c])))];
}

// curl command -> { method, url, headers: [[k, v]], data }. Shell-style tokenizing ('..', "..", \ line continuations).
export function parseCurl(cmd) {
  const toks = []; let cur = null, q = '';
  cmd = cmd.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (q === '$') { // bash ANSI-C quoting $'...' (Chrome "Copy as cURL" uses it for bodies with quotes)
      if (c === "'") q = '';
      else if (c === '\\') { const n = cmd[++i]; cur += ({ n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' })[n] ?? '\\' + n; }
      else cur += c;
      continue;
    }
    if (q) { if (c === q) q = ''; else if (c === '\\' && q === '"' && /["\\$`]/.test(cmd[i + 1])) cur += cmd[++i]; else cur += c; continue; }
    if (c === '$' && cmd[i + 1] === "'") { q = '$'; i++; cur ??= ''; continue; }
    if (c === "'" || c === '"') { q = c; cur ??= ''; continue; }
    if (/\s/.test(c)) { if (cur !== null) toks.push(cur); cur = null; continue; }
    if (c === '\\' && i + 1 < cmd.length) { cur = (cur ?? '') + cmd[++i]; continue; }
    cur = (cur ?? '') + c;
  }
  if (q) throw new Error('unclosed quote');
  if (cur !== null) toks.push(cur);
  if (toks[0] !== 'curl') throw new Error('command must start with curl');
  const r = { method: '', url: '', headers: [], data: null, form: [] };
  let get = false;
  // curl --data-urlencode: "content", "=content" or "name=content"; spaces become '+', lowercase hex, like curl
  const urlenc = v => [...new TextEncoder().encode(v)].map(b => /[A-Za-z0-9\-._~]/.test(String.fromCharCode(b)) ? String.fromCharCode(b) : b === 32 ? '+' : '%' + b.toString(16).padStart(2, '0')).join('');
  const addData = d => { r.data = r.data === null ? d : r.data + '&' + d; };
  const val = i => { if (i >= toks.length) throw new Error(`${toks[i - 1]} needs a value`); return toks[i]; };
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    if (t === '-X' || t === '--request') r.method = val(++i).toUpperCase();
    else if (t === '-H' || t === '--header') { const h = val(++i), k = h.indexOf(':'); if (k > 0) r.headers.push([h.slice(0, k).trim(), h.slice(k + 1).trim()]); }
    else if (/^(-d|--data|--data-raw|--data-binary|--data-ascii)$/.test(t)) addData(val(++i));
    else if (t === '--data-urlencode') { const v = val(++i), k = v.indexOf('='); addData(k < 0 ? urlenc(v) : v.slice(0, k + 1) + urlenc(v.slice(k + 1))); }
    else if (t === '-F' || t === '--form' || t === '--form-string') { const v = val(++i), k = v.indexOf('='); if (k > 0) r.form.push([v.slice(0, k), v.slice(k + 1), t !== '--form-string' && v[k + 1] === '@']); }
    else if (t === '-G' || t === '--get') get = true;
    else if (t === '-I' || t === '--head') r.method = 'HEAD';
    else if (t === '--json') { r.data = val(++i); r.headers.push(['Content-Type', 'application/json'], ['Accept', 'application/json']); }
    else if (t === '-A' || t === '--user-agent') r.headers.push(['User-Agent', val(++i)]);
    else if (t === '-b' || t === '--cookie') r.headers.push(['Cookie', val(++i)]);
    else if (t === '-u' || t === '--user') r.headers.push(['Authorization', 'Basic ' + btoa(val(++i))]);
    else if (t === '-e' || t === '--referer') r.headers.push(['Referer', val(++i)]);
    else if (t === '--url') r.url = val(++i);
    else if (/^(-o|--output|-m|--max-time|--connect-timeout|-w|--write-out|-x|--proxy|-U|--proxy-user|--retry|--retry-delay|--retry-max-time|-r|--range|-c|--cookie-jar|-D|--dump-header|--cacert|--cert|-E|--key|--resolve|--limit-rate|--max-redirs|--max-filesize|-y|--speed-time|-Y|--speed-limit|--interface|--dns-servers)$/.test(t)) i++;
    else if (!t.startsWith('-') && !r.url) r.url = t;
  }
  if (!r.url) throw new Error('no URL found');
  if (get && r.data !== null) { r.url += (r.url.includes('?') ? '&' : '?') + r.data; r.data = null; }
  const hasCT = () => r.headers.some(([k]) => k.toLowerCase() === 'content-type');
  if (r.form.length) { r.headers = r.headers.filter(([k]) => k.toLowerCase() !== 'content-type'); r.data = null; } // the client sets the multipart boundary
  else if (r.data !== null && !hasCT()) r.headers.push(['Content-Type', 'application/x-www-form-urlencoded']); // what curl sends for -d
  r.method ||= r.data !== null || r.form.length ? 'POST' : 'GET';
  return r;
}
export function curlToCode(r, lang = 'fetch') {
  const J = v => JSON.stringify(v), hs = Object.fromEntries(r.headers);
  const isJson = r.data !== null && /json/i.test(hs['Content-Type'] || hs['content-type'] || '') && (() => { try { JSON.parse(r.data); return true; } catch { return false; } })();
  const ind = (o, n) => JSON.stringify(o, null, 2).replace(/\n/g, '\n' + ' '.repeat(n));
  if (lang === 'python') {
    const pad = n => ' '.repeat(n);
    const py = (v, n = 0) => v === null ? 'None' : v === true ? 'True' : v === false ? 'False' : typeof v !== 'object' ? J(v)
      : Array.isArray(v) ? (v.length ? `[\n${v.map(x => pad(n + 2) + py(x, n + 2)).join(',\n')}\n${pad(n)}]` : '[]')
      : Object.keys(v).length ? `{\n${Object.entries(v).map(([k, x]) => `${pad(n + 2)}${J(k)}: ${py(x, n + 2)}`).join(',\n')}\n${pad(n)}}` : '{}';
    const args = [J(r.url)]; if (r.headers.length) args.push('headers=headers');
    if (r.data !== null) args.push(isJson ? 'json=payload' : 'data=payload');
    if (r.form.length) args.push('files=files');
    const files = r.form.length ? `files = [\n${r.form.map(([k, v, f]) => `  (${J(k)}, ${f ? `open(${J(v.slice(1))}, "rb")` : `(None, ${J(v)})`})`).join(',\n')}\n]\n` : '';
    return 'import requests\n\n' + (r.headers.length ? `headers = ${ind(hs, 0)}\n` : '') +
      (r.data !== null ? `payload = ${isJson ? py(JSON.parse(r.data)) : J(r.data)}\n` : '') + files +
      `\nresponse = requests.${['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(r.method) ? r.method.toLowerCase() + '(' : `request(${J(r.method)}, `}${args.join(', ')})\nprint(response.status_code)\nprint(response.text)`;
  }
  // -F fields -> FormData (files: pick them from an <input type=file> or fs.openAsBlob in Node 20+)
  const fd = r.form.length ? 'const form = new FormData();\n' + r.form.map(([k, v, f]) => f ? `form.append(${J(k)}, fileBlob, ${J(v.slice(1).split('/').pop())}); // fileBlob = the file ${J(v.slice(1))}\n` : `form.append(${J(k)}, ${J(v)});\n`).join('') + '\n' : '';
  if (lang === 'axios') {
    const cfg = { method: r.method.toLowerCase(), url: r.url }; if (r.headers.length) cfg.headers = hs;
    if (r.data !== null) cfg.data = isJson ? JSON.parse(r.data) : r.data;
    let c = ind(cfg, 0); if (r.form.length) c = c.replace(/\n}$/, ',\n  "data": form\n}');
    return `import axios from 'axios';\n\n${fd}const response = await axios(${c});\nconsole.log(response.status, response.data);`;
  }
  const opt = { method: r.method }; if (r.headers.length) opt.headers = hs;
  let o = ind(opt, 0);
  if (r.data !== null) o = o.replace(/\n}$/, `,\n  "body": ${isJson ? `JSON.stringify(${ind(JSON.parse(r.data), 2)})` : J(r.data)}\n}`);
  if (r.form.length) o = o.replace(/\n}$/, ',\n  "body": form\n}');
  return `${fd}const response = await fetch(${J(r.url)}, ${o});\nconsole.log(response.status, await response.text());`;
}

// Security headers builder. cspLines: "directive source source" per line (added to a strict 'self' baseline).
const CSP_DIRECTIVES = ['default-src', 'script-src', 'style-src', 'img-src', 'connect-src', 'font-src', 'media-src', 'frame-src', 'worker-src',
  'manifest-src', 'object-src', 'base-uri', 'form-action', 'frame-ancestors', 'script-src-elem', 'style-src-elem'];
export function buildSecurityHeaders(cspLines = '', o = {}) {
  const { reportOnly = false, hsts = true, preload = false, frame = 'DENY', referrer = 'strict-origin-when-cross-origin', perms = true } = o;
  const csp = new Map([['default-src', ["'self'"]], ['object-src', ["'none'"]], ['base-uri', ["'self'"]],
    ['frame-ancestors', [frame === 'DENY' ? "'none'" : "'self'"]], ['form-action', ["'self'"]]]);
  for (const raw of cspLines.split('\n')) {
    const line = raw.replace(/;+\s*$/, '').trim(); if (!line || line.startsWith('#')) continue;
    const [d, ...src] = line.split(/\s+/), dir = d.toLowerCase();
    if (!CSP_DIRECTIVES.includes(dir)) throw new Error(`unknown CSP directive "${d}"`);
    const cur = csp.get(dir) || ["'self'"];
    const add = src.map(x => /^(self|none|unsafe-inline|unsafe-eval|strict-dynamic|wasm-unsafe-eval)$/i.test(x) ? `'${x.toLowerCase()}'` : x);
    csp.set(dir, [...new Set(add.includes("'none'") ? ["'none'"] : [...cur.filter(x => x !== "'none'"), ...add])]);
  }
  const policy = [...csp].map(([d, v]) => `${d} ${v.join(' ')}`).join('; ') + '; upgrade-insecure-requests';
  const h = [[reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', policy]];
  if (hsts) h.push(['Strict-Transport-Security', 'max-age=63072000; includeSubDomains' + (preload ? '; preload' : '')]);
  h.push(['X-Content-Type-Options', 'nosniff'], ['X-Frame-Options', frame], ['Referrer-Policy', referrer]);
  if (perms) h.push(['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()']);
  return h;
}
export function formatServerHeaders(h, fmt = 'raw') {
  const dq = v => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  if (fmt === 'nginx') return h.map(([k, v]) => `add_header ${k} "${dq(v)}" always;`).join('\n');
  if (fmt === 'apache') return '<IfModule mod_headers.c>\n' + h.map(([k, v]) => `  Header always set ${k} "${dq(v)}"`).join('\n') + '\n</IfModule>';
  if (fmt === 'netlify') return '/*\n' + h.map(([k, v]) => `  ${k}: ${v}`).join('\n');
  if (fmt === 'express') return 'app.use((req, res, next) => {\n' + h.map(([k, v]) => `  res.setHeader(${JSON.stringify(k)}, ${JSON.stringify(v)});`).join('\n') + '\n  next();\n});';
  if (fmt === 'meta') {
    const c = h.find(([k]) => k === 'Content-Security-Policy'); if (!c) return '<!-- Report-Only CSP cannot be set with a meta tag -->';
    const v = c[1].split('; ').filter(x => !/^frame-ancestors /.test(x)).join('; ');
    return `<meta http-equiv="Content-Security-Policy" content="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">\n<!-- frame-ancestors and the other headers only work as real HTTP headers -->`;
  }
  return h.map(([k, v]) => `${k}: ${v}`).join('\n');
}

// ---- Markdown table formatter. Re-pads GFM tables in place (other lines pass through); if the input has no
// delimiter row, all non-blank lines are treated as one table (pipes, or tabs if there are no pipes; first row = header).
const WIDE = [[0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3],
  [0xf900, 0xfaff], [0xfe30, 0xfe4f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x1f300, 0x1f64f], [0x1f680, 0x1f6ff], [0x1f900, 0x1f9ff], [0x20000, 0x3fffd]];
// Display width in a monospace editor: East Asian wide chars and common emoji count 2, combining marks / ZWJ / variation selectors 0.
export function strWidth(s) {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if ((cp >= 0x300 && cp <= 0x36f) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) continue;
    w += WIDE.some(([a, b]) => cp >= a && cp <= b) ? 2 : 1;
  }
  return w;
}
// One table line -> trimmed cells. \| stays escaped; an unescaped | inside `code` is kept in the cell and escaped as \|.
export function splitRow(line) {
  const s = line.trim(); const cells = []; let cell = '', tick = 0, endPipe = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]; endPipe = false;
    if (c === '\\' && i + 1 < s.length) { cell += c + s[++i]; continue; }
    if (c === '`') {
      let n = 1; while (s[i + n] === '`') n++;
      const run = '`'.repeat(n);
      if (!tick) { if (new RegExp(`(^|[^\`])${run}(?!\`)`).test(s.slice(i + n))) tick = n; } else if (n === tick) tick = 0;
      cell += run; i += n - 1; continue;
    }
    if (c === '|') { if (tick) cell += '\\|'; else { cells.push(cell); cell = ''; endPipe = true; } continue; }
    cell += c;
  }
  if (!endPipe) cells.push(cell);
  if (s.startsWith('|') && cells.length > 1) cells.shift();
  return cells.map(c => c.trim());
}
const DELIM_CELL = /^:?-+:?$/;
const isDelimLine = l => l.includes('|') || /^\s*:?-+:?\s*$/.test(l) ? splitRow(l).every(c => DELIM_CELL.test(c)) && /-/.test(l) : false;
const alignOf = c => /^:-+:$/.test(c) ? 'center' : c.startsWith(':') ? 'left' : c.endsWith(':') ? 'right' : '';
export function formatTable(rows, aligns = [], { pad = true, align = 'keep' } = {}) {
  const n = Math.max(1, aligns.length, ...rows.map(r => r.length));
  rows = rows.map(r => Array.from({ length: n }, (_, i) => (r[i] ?? '').trim()));
  const al = Array.from({ length: n }, (_, i) => align === 'keep' ? aligns[i] || '' : align === 'none' ? '' : align);
  const line = cells => '| ' + cells.join(' | ') + ' |';
  const dash = (w, a) => a === 'center' ? ':' + '-'.repeat(w - 2) + ':' : a === 'left' ? ':' + '-'.repeat(w - 1) : a === 'right' ? '-'.repeat(w - 1) + ':' : '-'.repeat(w);
  if (!pad) return [line(rows[0]), line(al.map(a => dash(a === 'center' ? 5 : a ? 4 : 3, a))), ...rows.slice(1).map(line)].join('\n');
  const w = al.map((_, i) => Math.max(3, ...rows.map(r => strWidth(r[i]))));
  const cell = (c, i) => {
    const d = w[i] - strWidth(c);
    if (al[i] === 'right') return ' '.repeat(d) + c;
    if (al[i] === 'center') return ' '.repeat(d >> 1) + c + ' '.repeat(d - (d >> 1));
    return c + ' '.repeat(d);
  };
  return [line(rows[0].map(cell)), line(al.map((a, i) => dash(w[i], a))), ...rows.slice(1).map(r => line(r.map(cell)))].join('\n');
}
export function formatMarkdownTables(text, opts = {}) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const out = []; let tables = 0, fence = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (f && (!fence || f[1][0] === fence[0] && f[1].length >= fence.length)) fence = fence ? '' : f[1];
    if (!fence && l.includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && isDelimLine(lines[i + 1])) {
      const rows = [splitRow(l)], aligns = splitRow(lines[i + 1]).map(alignOf);
      i += 2;
      while (i < lines.length && lines[i].trim()) rows.push(splitRow(lines[i++]));
      i--; out.push(formatTable(rows, aligns, opts)); tables++;
    } else out.push(l);
  }
  if (tables) return { text: out.join('\n'), tables };
  const body = lines.filter(l => l.trim());
  if (!body.length) return { text: '', tables: 0 };
  const pipes = body.some(l => l.includes('|'));
  if (!pipes && !body.some(l => l.includes('\t'))) return { text: '', tables: 0 };
  const rows = body.map(l => pipes ? splitRow(l) : l.split('\t'));
  return { text: formatTable(rows, [], opts), tables: 1 };
}

// Markdown table(s) -> rows for CSV/TSV/XLSX. Cells: \| -> |, <br> -> newline; unless keep=true also
// **bold** / *em* / `code` / [text](url) / ~~strike~~ markers removed. Short rows are padded; long rows keep their cells.
function mdPlain(c) {
  // Escapes and code spans are set aside first so emphasis/link stripping cannot touch them.
  const keep = [], hold = t => `${keep.push(t) - 1}`;
  c = c.replace(/(`+)(.+?)\1/g, (_, t, x) => hold(x.trim().replace(/\\\|/g, '|'))).replace(/\\([\\`*_{}\[\]()#+\-.!|~<>])/g, (_, x) => hold(x));
  c = c.replace(/!?\[([^\]]*)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2').replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1(?![A-Za-z0-9])/g, '$2')
    .replace(/~~(.+?)~~/g, '$1');
  return c.replace(/(\d+)/g, (_, n) => keep[n]);
}
export function markdownTablesToRows(text, { keep = false } = {}) {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const tables = []; let fence = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], f = /^\s*(`{3,}|~{3,})/.exec(l);
    if (f && (!fence || f[1][0] === fence[0] && f[1].length >= fence.length)) { fence = fence ? '' : f[1]; continue; }
    if (fence || !l.includes('|') || i + 1 >= lines.length || !lines[i + 1].includes('|') || !isDelimLine(lines[i + 1])) continue;
    const rows = [splitRow(l)];
    for (i += 2; i < lines.length && lines[i].trim(); i++) rows.push(splitRow(lines[i]));
    i--;
    const n = Math.max(...rows.map(r => r.length));
    tables.push(rows.map(r => Array.from({ length: n }, (_, k) => {
      const c = (r[k] ?? '').replace(/<br\s*\/?>/gi, '\n');
      return keep ? c.replace(/\\\|/g, '|') : mdPlain(c);
    })));
  }
  return tables;
}

// Spreadsheet rows (first row = header) -> JSON. types: plain numbers (no thousands separators, currency or leading
// zeros, so ids/zip codes stay text), TRUE/FALSE -> booleans, empty -> null. nest: 'address.city' headers -> nested objects.
const JSON_NUM = /^-?(0|[1-9]\d*)(\.\d+)?([eE][-+]?\d+)?$/;
function jsonCell(c, types) {
  if (!types) return c;
  const t = c.trim();
  if (t === '') return null;
  if (JSON_NUM.test(t) && t.replace(/^-|\.|e.*$/gi, '').length <= 15) return Number(t);
  if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true';
  return c;
}
export function rowsToJson(rows, { types = true, nest = false, shape = 'objects' } = {}) {
  if (!rows.length) return '[]';
  if (shape === 'arrays') return JSON.stringify([rows[0], ...rows.slice(1).map(r => r.map(c => jsonCell(c, types)))], null, 2);
  const seen = new Map();
  const keys = rows[0].map((h, i) => {
    let k = h.trim() || `column_${i + 1}`;
    const n = (seen.get(k) || 0) + 1; seen.set(k, n);
    return n > 1 ? `${k}_${n}` : k;
  });
  const objs = rows.slice(1).filter(r => r.some(c => c.trim())).map(r => {
    const o = {};
    keys.forEach((k, i) => {
      const v = jsonCell(r[i] ?? '', types);
      if (!nest || !k.includes('.')) { o[k] = v; return; }
      const path = k.split('.'); let t = o;
      for (let j = 0; j < path.length - 1; j++) {
        if (t[path[j]] === null || typeof t[path[j]] !== 'object') t[path[j]] = /^\d+$/.test(path[j + 1]) ? [] : {};
        t = t[path[j]];
      }
      t[path.at(-1)] = v;
    });
    return o;
  });
  return JSON.stringify(objs, null, 2);
}

// ---- robots.txt (RFC 9309, as Google applies it): groups by user-agent, longest matching rule wins, Allow wins ties,
// '*' wildcard and '$' end anchor, /robots.txt itself always allowed, no matching group = everything allowed.
export function parseRobots(text) {
  const groups = [], sitemaps = [], warnings = [];
  let cur = null, lastWasAgent = false;
  text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) return;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) { warnings.push(`Line ${i + 1}: not a "field: value" line, ignored.`); return; }
    const key = m[1].toLowerCase(), val = m[2].trim();
    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) groups.push(cur = { agents: [], rules: [], line: i + 1 });
      // 'Mediapartners-Google*' or 'Googlebot/2.1' name the product token before the first other character
      cur.agents.push(val.startsWith('*') ? '*' : (val.match(/^[A-Za-z_-]+/) || [''])[0].toLowerCase()); lastWasAgent = true; return;
    }
    lastWasAgent = false;
    if (key === 'allow' || key === 'disallow') {
      if (!cur) { warnings.push(`Line ${i + 1}: ${m[1]} before any User-agent line, ignored.`); return; }
      if (val) cur.rules.push({ allow: key === 'allow', path: val, line: i + 1 });
    } else if (key === 'sitemap') sitemaps.push(val);
    else if (key === 'crawl-delay') warnings.push(`Line ${i + 1}: Crawl-delay is ignored by Google (Bing and Yandex read it).`);
    else if (key !== 'host' && key !== 'clean-param') warnings.push(`Line ${i + 1}: unknown field "${m[1]}", ignored.`);
  });
  return { groups, sitemaps, warnings };
}
// Normalize %-escapes so /caf%c3%a9 and /café compare equal; leave reserved characters encoded.
const robotsNorm = s => { try { return encodeURI(decodeURI(s)); } catch { return s; } };
function robotsMatch(pattern, path) {
  const end = pattern.endsWith('$'), parts = robotsNorm(end ? pattern.slice(0, -1) : pattern).split('*');
  let pos = 0;
  if (!path.startsWith(parts[0])) return false;
  pos = parts[0].length;
  for (let k = 1; k < parts.length; k++) {
    const last = k === parts.length - 1;
    if (last && end) return path.length - parts[k].length >= pos && path.endsWith(parts[k]);
    const j = path.indexOf(parts[k], pos); if (j < 0) return false; pos = j + parts[k].length;
  }
  return !end || pos === path.length;
}
export function robotsGroupFor(robots, agent) {
  const token = (agent.trim().match(/^[A-Za-z_-]+/) || [''])[0].toLowerCase();
  const pick = a => robots.groups.filter(g => g.agents.includes(a));
  let gs = token ? pick(token) : [], used = token;
  // Google's documented fallback: Googlebot-Image / -Video / -News follow the Googlebot group when they have none
  if (!gs.length && token.startsWith('googlebot-')) gs = pick(used = 'googlebot');
  if (!gs.length) { gs = pick('*'); used = '*'; }
  return { agent: gs.length ? used : '', rules: gs.flatMap(g => g.rules), lines: gs.map(g => g.line) };
}
export function checkRobots(robots, agent, url) {
  let path;
  // Raw path + query as written (new URL() would drop a bare '?', which rules like 'Disallow: /?' match)
  const t = url.trim().replace(/#.*/, ''), m = /^[a-z][a-z0-9+.-]*:\/\/[^/?]*/i.exec(t);
  path = m ? t.slice(m[0].length) : t;
  if (!path.startsWith('/')) path = '/' + path;
  if (/\s/.test(path)) return { error: 'not a URL' };
  path = robotsNorm(path);
  if (path === '/robots.txt') return { allowed: true, rule: null, why: '/robots.txt is always allowed' };
  const g = robotsGroupFor(robots, agent);
  if (!g.agent) return { allowed: true, rule: null, why: 'no group for this user agent and no User-agent: * group' };
  let best = null;
  for (const r of g.rules) {
    if (!robotsMatch(r.path, path)) continue;
    const len = robotsNorm(r.path).length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.r.allow)) best = { r, len };
  }
  return best ? { allowed: best.r.allow, rule: best.r, group: g.agent } : { allowed: true, rule: null, group: g.agent, why: 'no rule matches' };
}

// ---- hreflang: <link rel="alternate" hreflang> tags (HTML head) or <xhtml:link> entries (sitemap) checked the way
// Google documents: ISO 639-1 language, optional ISO 15924 script, optional ISO 3166-1 alpha-2 region, or x-default;
// absolute URLs; the page must list itself; one URL per code.
const HL_LANGS = new Set('aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'.split(' '));
const HL_REGIONS = new Set('AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' '));
const HL_FIX = { uk: 'gb' };
const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[1] ?? m[2] ?? m[3]).trim() : null; };
export function parseHreflang(text) {
  const out = [];
  for (const m of text.matchAll(/<(?:xhtml:)?link\b[^>]*>/gi)) {
    const t = m[0], hl = attr(t, 'hreflang');
    if (hl === null || !/(^|\s)alternate(\s|$)/i.test(attr(t, 'rel') || '')) continue;
    out.push({ hreflang: hl, href: (attr(t, 'href') || '').replace(/&amp;/g, '&') });
  }
  return out;
}
export function hreflangCode(code) {
  if (/^x-default$/i.test(code)) return { ok: true };
  if (code.includes('_')) return { ok: false, msg: `use a hyphen, not an underscore (${code.replace(/_/g, '-')})` };
  const p = code.split('-');
  const lang = p[0].toLowerCase(), script = p.length === 3 || (p.length === 2 && p[1].length === 4) ? p[1] : null, region = p.length > 1 && p.at(-1).length !== 4 ? p.at(-1) : null;
  if (p.length > 3 || !p.every(x => x)) return { ok: false, msg: 'not a language[-Script][-REGION] code' };
  if (!HL_LANGS.has(lang)) return { ok: false, msg: HL_REGIONS.has(lang.toUpperCase()) && p.length === 1 ? `"${code}" is a country code; hreflang must start with a language (e.g. ${p[0] === 'gb' || p[0] === 'us' ? 'en-' + p[0].toUpperCase() : 'xx-' + p[0].toUpperCase()})` : `"${p[0]}" is not an ISO 639-1 language code` };
  if (script && !/^[A-Za-z]{4}$/.test(script)) return { ok: false, msg: `"${script}" is not a 4-letter script code` };
  if (region && !HL_REGIONS.has(region.toUpperCase())) return { ok: false, msg: HL_FIX[region.toLowerCase()] ? `"${region}" is not a country code: use ${lang}-${HL_FIX[region.toLowerCase()].toUpperCase()}` : (/^\d{3}$/.test(region) ? `"${region}" is a UN M.49 region; Google supports only ISO 3166-1 alpha-2 countries (e.g. ${lang}-MX)` : `"${region}" is not an ISO 3166-1 alpha-2 country code`) };
  return { ok: true };
}
export function checkHreflang(entries, pageUrl = '') {
  const res = [], byCode = new Map(), byHref = new Map();
  for (const e of entries) {
    const c = hreflangCode(e.hreflang);
    if (!c.ok) res.push(['fail', `hreflang="${e.hreflang}"`, c.msg]);
    if (!/^https?:\/\/[^/\s]+/i.test(e.href)) res.push(['fail', `hreflang="${e.hreflang}"`, `href must be an absolute URL with https:// (got "${e.href || '(empty)'}")`]);
    const k = e.hreflang.toLowerCase();
    if (byCode.has(k) && byCode.get(k) !== e.href) res.push(['fail', `hreflang="${e.hreflang}"`, `listed twice with different URLs (${byCode.get(k)} and ${e.href})`]);
    byCode.set(k, e.href);
    byHref.set(e.href, [...(byHref.get(e.href) || []), e.hreflang]);
  }
  if (!entries.length) return res;
  if (!byCode.has('x-default')) res.push(['warn', 'x-default', 'missing: recommended for visitors whose language matches none of the codes']);
  for (const [h, codes] of byHref) if (codes.length > 1 && !codes.some(c => /^x-default$/i.test(c))) res.push(['warn', h, `used for ${codes.join(', ')}: fine if intended (one page for several regions)`]);
  const langs = new Set([...byCode.keys()].map(k => k.split('-')[0]));
  for (const l of langs) if (l !== 'x' && ![...byCode.keys()].includes(l) && [...byCode.keys()].filter(k => k.startsWith(l + '-')).length > 1) res.push(['warn', l, `only regional versions (${[...byCode.keys()].filter(k => k.startsWith(l + '-')).join(', ')}): consider a plain "${l}" entry for other regions`]);
  if (pageUrl) {
    const norm = u => u.replace(/#.*/, '').replace(/^http:/i, 'https:');
    if (![...byHref.keys()].some(h => norm(h) === norm(pageUrl))) res.push(['fail', 'self-reference', `${pageUrl} is not in the list: each page must include itself`]);
    else res.push(['pass', 'self-reference', 'the page lists itself']);
  }
  if (!res.some(r => r[0] === 'fail')) res.unshift(['pass', 'codes and URLs', `${entries.length} entries, all valid`]);
  return res;
}

// CSV rows (first row = header) -> CREATE TABLE + INSERT statements. Column types are inferred from all values:
// integers, decimals, else text (leading-zero ids stay text). Empty cells -> NULL. MySQL also escapes backslashes.
export function rowsToSql(rows, { table = 'my_table', dialect = 'postgres', create = true, batch = 500 } = {}) {
  if (!rows.length) return '';
  const qi = n => dialect === 'mysql' ? '`' + n.replace(/`/g, '``') + '`' : '"' + n.replace(/"/g, '""') + '"';
  const seen = new Map();
  const cols = rows[0].map((h, i) => { let k = h.trim() || `column_${i + 1}`; const n = (seen.get(k.toLowerCase()) || 0) + 1; seen.set(k.toLowerCase(), n); return n > 1 ? `${k}_${n}` : k; });
  const data = rows.slice(1).filter(r => r.some(c => c.trim()));
  const INT = /^-?(0|[1-9]\d{0,17})$/, DEC = /^-?(0|[1-9]\d*)\.\d+$|^-?(0|[1-9]\d*)(\.\d+)?[eE][-+]?\d+$/;
  const types = cols.map((_, i) => {
    const vals = data.map(r => (r[i] ?? '').trim()).filter(Boolean);
    if (vals.length && vals.every(v => INT.test(v))) return 'INTEGER';
    if (vals.length && vals.every(v => INT.test(v) || DEC.test(v))) return { postgres: 'DOUBLE PRECISION', mysql: 'DOUBLE', sqlite: 'REAL', sqlserver: 'FLOAT' }[dialect] || 'REAL';
    return dialect === 'mysql' ? 'TEXT' : dialect === 'sqlserver' ? 'NVARCHAR(MAX)' : 'TEXT';
  });
  const lit = (v, t) => {
    if (v.trim() === '') return 'NULL';
    if (t !== 'TEXT' && t !== 'NVARCHAR(MAX)') return v.trim();
    let x = v.replace(/'/g, "''");
    if (dialect === 'mysql') x = x.replace(/\\/g, '\\\\');
    return (dialect === 'sqlserver' ? 'N' : '') + "'" + x + "'";
  };
  const out = [];
  if (create) out.push(`CREATE TABLE ${qi(table)} (\n${cols.map((c, i) => `  ${qi(c)} ${types[i]}`).join(',\n')}\n);`);
  for (let i = 0; i < data.length; i += batch) {
    const chunk = data.slice(i, i + batch).map(r => `(${cols.map((_, j) => lit(r[j] ?? '', types[j])).join(', ')})`);
    out.push(`INSERT INTO ${qi(table)} (${cols.map(qi).join(', ')}) VALUES\n${chunk.join(',\n')};`);
  }
  return out.join('\n\n') + '\n';
}

// ---- XML -> rows. Record candidates = element names that repeat under one parent (RSS <item>, sitemap <url>, …),
// most frequent first. A record becomes one row: its attributes as record@name, leaf children by name, nested ones as a/b,
// repeated children as name, name_2, … Namespace prefixes are kept (image:loc). Needs DOMParser (browser).
export function xmlRecordCandidates(doc) {
  const counts = new Map();
  for (const el of doc.getElementsByTagName('*')) {
    if (!el.parentElement) continue;
    const key = el.tagName, sib = [...el.parentElement.children].filter(c => c.tagName === key).length;
    if (sib < 2) continue;
    const c = counts.get(key) || { name: key, count: 0, depth: 0 };
    c.count++; let d = 0; for (let p = el; p.parentElement; p = p.parentElement) d++; c.depth = c.depth || d;
    counts.set(key, c);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.depth - b.depth);
}
function xmlFlatten(el, prefix, out) {
  for (const a of el.attributes) out[`${prefix || el.tagName}@${a.name}`] = a.value; // '@id' alone would trip the CSV formula guard
  const kids = [...el.children];
  if (!kids.length) { const t = el.textContent.trim(); if (t || !el.attributes.length) out[prefix ? prefix.slice(0, -1) : '#text'] = t; return; }
  const seen = new Map();
  for (const k of kids) {
    const n = (seen.get(k.tagName) || 0) + 1; seen.set(k.tagName, n);
    const name = prefix + k.tagName + (n > 1 ? `_${n}` : '');
    if (!k.children.length) {
      for (const a of k.attributes) out[`${name}@${a.name}`] = a.value;
      const t = k.textContent.trim();
      if (t || !k.attributes.length) out[name] = t;
    } else xmlFlatten(k, name + '/', out);
  }
}
export function xmlToRows(text, record = '') {
  const doc = new DOMParser().parseFromString(text.replace(/^﻿/, ''), 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) return { error: 'Not well-formed XML: ' + err.textContent.split('\n').filter(Boolean).slice(0, 2).join(' ') };
  const candidates = xmlRecordCandidates(doc);
  const name = record || candidates[0]?.name;
  if (!name) return { error: 'No repeating element found: the XML needs at least two sibling elements with the same name.', candidates };
  const objs = [...doc.getElementsByTagName(name)].map(el => { const o = {}; xmlFlatten(el, '', o); return o; });
  const cols = [...new Set(objs.flatMap(o => Object.keys(o)))];
  return { record: name, candidates, rows: [cols, ...objs.map(o => cols.map(c => o[c] ?? ''))] };
}

// Two pasted lists -> only in A, only in B, in both (first spelling kept, first-seen order, duplicates collapsed).
export function compareLists(a, b, { ignoreCase = true, trim = true } = {}) {
  const key = s => { let k = trim ? s.trim() : s; return ignoreCase ? k.toLocaleLowerCase() : k; };
  const uniq = text => { const m = new Map(); for (const l of text.replace(/\r\n?/g, '\n').split('\n')) { const k = key(l); if (k !== '' && !m.has(k)) m.set(k, trim ? l.trim() : l); } return m; };
  const A = uniq(a), B = uniq(b);
  return { onlyA: [...A].filter(([k]) => !B.has(k)).map(e => e[1]), onlyB: [...B].filter(([k]) => !A.has(k)).map(e => e[1]),
    both: [...A].filter(([k]) => B.has(k)).map(e => e[1]), countA: A.size, countB: B.size };
}

// Several CSV files -> one table: header union in first-seen order, columns matched by name (trimmed, case-insensitive),
// optional source column. Returns rows (first = header).
export function mergeCsvs(files, { source = true } = {}) {
  const cols = [], idx = new Map(), out = [];
  for (const f of files) {
    const rows = parseCSV(f.text); if (!rows.length) continue;
    const map = rows[0].map(h => { const k = h.trim().toLowerCase(); if (!idx.has(k)) { idx.set(k, cols.length); cols.push(h.trim()); } return idx.get(k); });
    for (const r of rows.slice(1)) { if (!r.some(c => c.trim())) continue; const o = []; r.forEach((c, i) => { o[map[i]] = c; }); out.push({ o, name: f.name }); }
  }
  const head = source ? ['source_file', ...cols] : cols;
  return [head, ...out.map(({ o, name }) => { const r = cols.map((_, i) => o[i] ?? ''); return source ? [name, ...r] : r; })];
}

// One CSV -> several: every `size` data rows, or one part per distinct value of column `by` (first-seen order).
// Each part keeps the header. Returns [{name, rows}] (rows[0] = header).
export function splitCsv(text, { size = 0, by = -1 } = {}) {
  const rows = parseCSV(text); if (rows.length < 2) return [];
  const [head, ...body] = rows, data = body.filter(r => r.some(c => c.trim())), parts = [];
  if (by >= 0) {
    const g = new Map();
    for (const r of data) { const v = (r[by] ?? '').trim(); if (!g.has(v)) g.set(v, []); g.get(v).push(r); }
    const used = new Set();
    for (const [v, rs] of g) {
      let base = (v.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 60)) || 'blank', name = base, i = 2;
      while (used.has(name.toLowerCase())) name = `${base}_${i++}`;
      used.add(name.toLowerCase()); parts.push({ name: name + '.csv', rows: [head, ...rs] });
    }
  } else {
    const n = Math.max(1, Math.floor(size) || 1), w = String(Math.ceil(data.length / n)).length;
    for (let i = 0; i < data.length; i += n) parts.push({ name: `part-${String(i / n + 1).padStart(w, '0')}.csv`, rows: [head, ...data.slice(i, i + n)] });
  }
  return parts;
}

// Rows <-> columns. Ragged rows are padded with '' so no cell is lost; fully blank input rows are dropped.
export function transposeRows(rows) {
  rows = rows.filter(r => r.some(c => c !== ''));
  const w = Math.max(0, ...rows.map(r => r.length));
  return Array.from({ length: w }, (_, j) => rows.map(r => r[j] ?? ''));
}

// Decode (not verify) a JWT: header + payload JSON, registered time claims as UTC dates. Accepts 'Bearer ' prefix.
export function decodeJwt(input, now = Date.now() / 1000) {
  const t = input.trim().replace(/^(authorization:\s*)?bearer\s+/i, '').replace(/\s+/g, '');
  const parts = t.split('.');
  if (parts.length === 5) throw new Error('This is an encrypted JWT (JWE, 5 parts): its payload cannot be read without the key.');
  if (parts.length !== 3) throw new Error(`A JWT has 3 parts separated by dots; this has ${parts.length}.`);
  const part = (s, what) => {
    if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error(`The ${what} is not base64url (only A-Z a-z 0-9 - _ allowed).`);
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(b, c => c.charCodeAt(0)))); }
    catch { throw new Error(`The ${what} is not valid JSON.`); }
  };
  const header = part(parts[0], 'header'), payload = part(parts[1], 'payload');
  const times = {};
  for (const k of ['iat', 'nbf', 'exp']) if (typeof payload[k] === 'number') times[k] = new Date(payload[k] * 1000).toISOString().replace('.000Z', 'Z');
  const notes = [];
  if (typeof payload.exp === 'number') notes.push(payload.exp < now ? 'Expired.' : `Not expired (expires in ${Math.round((payload.exp - now) / 60)} min).`);
  if (typeof payload.nbf === 'number' && payload.nbf > now) notes.push('Not valid yet (nbf is in the future).');
  if (String(header.alg).toLowerCase() === 'none') notes.push('alg is "none": the token is unsigned.');
  return { header, payload, times, notes, signed: parts[2] !== '' };
}

// ---- WCAG 2.x color contrast. Colors are {r, g, b, a} with r/g/b 0-255 and a 0-1.
// All 148 CSS named colors (CSS Color 4) + transparent.
const NAMED = {
  aliceblue:'f0f8ff', antiquewhite:'faebd7', aqua:'00ffff', aquamarine:'7fffd4', azure:'f0ffff', beige:'f5f5dc',
  bisque:'ffe4c4', black:'000000', blanchedalmond:'ffebcd', blue:'0000ff', blueviolet:'8a2be2', brown:'a52a2a',
  burlywood:'deb887', cadetblue:'5f9ea0', chartreuse:'7fff00', chocolate:'d2691e', coral:'ff7f50', cornflowerblue:'6495ed',
  cornsilk:'fff8dc', crimson:'dc143c', cyan:'00ffff', darkblue:'00008b', darkcyan:'008b8b', darkgoldenrod:'b8860b',
  darkgray:'a9a9a9', darkgreen:'006400', darkgrey:'a9a9a9', darkkhaki:'bdb76b', darkmagenta:'8b008b',
  darkolivegreen:'556b2f', darkorange:'ff8c00', darkorchid:'9932cc', darkred:'8b0000', darksalmon:'e9967a',
  darkseagreen:'8fbc8f', darkslateblue:'483d8b', darkslategray:'2f4f4f', darkslategrey:'2f4f4f', darkturquoise:'00ced1',
  darkviolet:'9400d3', deeppink:'ff1493', deepskyblue:'00bfff', dimgray:'696969', dimgrey:'696969', dodgerblue:'1e90ff',
  firebrick:'b22222', floralwhite:'fffaf0', forestgreen:'228b22', fuchsia:'ff00ff', gainsboro:'dcdcdc',
  ghostwhite:'f8f8ff', gold:'ffd700', goldenrod:'daa520', gray:'808080', green:'008000', greenyellow:'adff2f',
  grey:'808080', honeydew:'f0fff0', hotpink:'ff69b4', indianred:'cd5c5c', indigo:'4b0082', ivory:'fffff0', khaki:'f0e68c',
  lavender:'e6e6fa', lavenderblush:'fff0f5', lawngreen:'7cfc00', lemonchiffon:'fffacd', lightblue:'add8e6',
  lightcoral:'f08080', lightcyan:'e0ffff', lightgoldenrodyellow:'fafad2', lightgray:'d3d3d3', lightgreen:'90ee90',
  lightgrey:'d3d3d3', lightpink:'ffb6c1', lightsalmon:'ffa07a', lightseagreen:'20b2aa', lightskyblue:'87cefa',
  lightslategray:'778899', lightslategrey:'778899', lightsteelblue:'b0c4de', lightyellow:'ffffe0', lime:'00ff00',
  limegreen:'32cd32', linen:'faf0e6', magenta:'ff00ff', maroon:'800000', mediumaquamarine:'66cdaa', mediumblue:'0000cd',
  mediumorchid:'ba55d3', mediumpurple:'9370db', mediumseagreen:'3cb371', mediumslateblue:'7b68ee',
  mediumspringgreen:'00fa9a', mediumturquoise:'48d1cc', mediumvioletred:'c71585', midnightblue:'191970',
  mintcream:'f5fffa', mistyrose:'ffe4e1', moccasin:'ffe4b5', navajowhite:'ffdead', navy:'000080', oldlace:'fdf5e6',
  olive:'808000', olivedrab:'6b8e23', orange:'ffa500', orangered:'ff4500', orchid:'da70d6', palegoldenrod:'eee8aa',
  palegreen:'98fb98', paleturquoise:'afeeee', palevioletred:'db7093', papayawhip:'ffefd5', peachpuff:'ffdab9',
  peru:'cd853f', pink:'ffc0cb', plum:'dda0dd', powderblue:'b0e0e6', purple:'800080', rebeccapurple:'663399', red:'ff0000',
  rosybrown:'bc8f8f', royalblue:'4169e1', saddlebrown:'8b4513', salmon:'fa8072', sandybrown:'f4a460', seagreen:'2e8b57',
  seashell:'fff5ee', sienna:'a0522d', silver:'c0c0c0', skyblue:'87ceeb', slateblue:'6a5acd', slategray:'708090',
  slategrey:'708090', snow:'fffafa', springgreen:'00ff7f', steelblue:'4682b4', tan:'d2b48c', teal:'008080',
  thistle:'d8bfd8', tomato:'ff6347', turquoise:'40e0d0', violet:'ee82ee', wheat:'f5deb3', white:'ffffff',
  whitesmoke:'f5f5f5', yellow:'ffff00', yellowgreen:'9acd32',
  transparent: '00000000' };
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
  return { r: f(0), g: f(8), b: f(4) };
}
export function rgbToHsl({ r, g, b }) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  if (!d) return { h: 0, s: 0, l: l * 100 };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: s * 100, l: l * 100 };
}
export function parseColor(str) {
  const c = str.trim().toLowerCase().replace(/;$/, '');
  if (NAMED[c]) return parseColor('#' + NAMED[c]);
  let m = /^#?([0-9a-f]{3,8})$/.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = [...h].map(x => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = i => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(c);
  if (!m) return null;
  const parts = m[2].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const num = p => /^[-+]?(\d+\.?\d*|\.\d+)(%|deg)?$/.test(p) ? parseFloat(p) : NaN;
  const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? num(parts[3]) / 100 : num(parts[3]);
  let rgb;
  if (m[1].startsWith('rgb')) {
    const ch = p => p.endsWith('%') ? num(p) * 2.55 : num(p);
    rgb = { r: ch(parts[0]), g: ch(parts[1]), b: ch(parts[2]) };
  } else rgb = hslToRgb(num(parts[0]), num(parts[1]), num(parts[2]));
  const out = { ...rgb, a: alpha };
  if (Object.values(out).some(Number.isNaN)) return null;
  for (const k of 'rgb') out[k] = Math.max(0, Math.min(255, out[k]));
  out.a = Math.max(0, Math.min(1, out.a));
  return out;
}
// Semi-transparent colors are composited over the color beneath (background over white).
export const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
export function luminance({ r, g, b }) {
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
export function contrastRatio(fg, bg) {
  const WHITE = { r: 255, g: 255, b: 255, a: 1 };
  const b = bg.a < 1 ? blend(bg, WHITE) : bg, f = fg.a < 1 ? blend(fg, b) : fg;
  const [hi, lo] = [luminance(f), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const THRESHOLDS = [3, 4.5, 7];
// 2 decimals, but never rounded up across a pass threshold (WCAG ratios must not be rounded: 4.499 is a fail, shown 4.49).
export function formatRatio(r) {
  let s = Math.round(r * 100) / 100;
  if (THRESHOLDS.some(t => r < t && s >= t)) s = Math.floor(r * 100) / 100;
  return s.toFixed(2);
}
export function wcagChecks(ratio) {
  return [['AA normal text', 4.5], ['AA large text', 3], ['AAA normal text', 7], ['AAA large text', 4.5], ['UI components & graphics (AA)', 3]]
    .map(([name, min]) => ({ name, min, pass: ratio >= min }));
}
export const toHex = ({ r, g, b, a = 1 }) => '#' + [r, g, b].map(hex2).join('') + (a < 1 ? hex2(a * 255) : '');
const n1 = v => String(Math.round(v * 10) / 10);
export const toRgbString = ({ r, g, b, a = 1 }) => a < 1 ? `rgba(${[r, g, b].map(Math.round).join(', ')}, ${n1(a * 100) / 100})` : `rgb(${[r, g, b].map(Math.round).join(', ')})`;
export function toHslString(c) {
  const { h, s, l } = rgbToHsl(c);
  return c.a < 1 ? `hsla(${n1(h)}, ${n1(s)}%, ${n1(l)}%, ${n1(c.a * 100) / 100})` : `hsl(${n1(h)}, ${n1(s)}%, ${n1(l)}%)`;
}
// Nearest foreground (same hue & saturation, HSL lightness moved in 0.1% steps, darker or lighter) whose rounded hex
// reaches `target` against bg. Returns the hex with the smallest lightness change, or null if neither direction can.
export function suggestForeground(fg, bg, target = 4.5) {
  const { h, s, l } = rgbToHsl(fg); let best = null;
  for (const dir of [-1, 1]) {
    for (let k = 1; k <= 1000; k++) {
      const L = l + dir * k / 10; if (L < 0 || L > 100) break;
      const c = parseColor(toHex({ ...hslToRgb(h, s, L), a: fg.a }));
      const ratio = contrastRatio(c, bg);
      if (ratio >= target) { if (!best || k < best.delta) best = { hex: toHex(c), ratio, delta: k }; break; }
    }
  }
  return best && { hex: best.hex, ratio: best.ratio, lightnessChange: best.delta / 10 };
}

// ---- Markdown -> HTML (CommonMark-ish block/inline parser + GFM tables & ~~strikethrough~~).
// Raw HTML in the Markdown is escaped unless allowHtml; javascript:/vbscript:/data: link targets are always neutralised.
const escAttr = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escText = s => s.replace(/&(?![a-zA-Z][a-zA-Z0-9]{1,31};|#\d{1,7};|#[xX][0-9a-fA-F]{1,6};)/g, '&amp;')
  .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const PUNCT = '!-\\/:-@\\[-`{-~';
const unBackslash = s => s.replace(new RegExp(`\\\\([${PUNCT}])`, 'g'), '$1');
const normLabel = s => s.trim().replace(/\s+/g, ' ').toLowerCase();
export function safeUrl(u, img = false) {
  const t = u.replace(/[\u0000- \u007f]/g, '').toLowerCase();
  if (/^(javascript|vbscript|file):/.test(t)) return '#';
  if (/^data:/.test(t) && !(img && /^data:image\/(png|gif|jpe?g|webp|avif);/.test(t))) return '#';
  return u.replace(/ /g, '%20');
}
const indentOf = l => { let c = 0; for (const ch of l) { if (ch === ' ') c++; else if (ch === '\t') c += 4 - c % 4; else break; } return c; };
function dedent(l, n) {
  let c = 0, i = 0;
  while (i < l.length && c < n) {
    if (l[i] === ' ') c++;
    else if (l[i] === '\t') { const w = 4 - c % 4; if (c + w > n) return ' '.repeat(c + w - n) + l.slice(i + 1); c += w; }
    else break;
    i++;
  }
  return l.slice(i);
}
const MD = {
  blank: /^[ \t]*$/,
  atx: /^ {0,3}(#{1,6})(?:[ \t]+(.*?))??(?:[ \t]+#+)?[ \t]*$/,
  hr: /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/,
  fence: /^( {0,3})(`{3,}|~{3,})[ \t]*(.*?)[ \t]*$/,
  quote: /^ {0,3}> ?/,
  list: /^( {0,3})([-*+]|(\d{1,9})([.)]))(?=[ \t]|$)/,
  setext: /^ {0,3}(=+|-+)[ \t]*$/,
  delim: /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/,
  // HTML block starts (CommonMark types 1-6: block-level tag names, comments, <? <! ) and type 7 (a lone complete tag; can't interrupt a paragraph)
  html: /^ {0,3}(?:<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|ul|script|style|pre)(?=[\s/>]|$)|<!--|<\?|<![A-Za-z]|<!\[CDATA\[)/i,
  html7: /^ {0,3}<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>[ \t]*$/,
  ref: /^ {0,3}\[((?:[^\]\\]|\\.){1,999})\]:[ \t]*(<[^>\n]*>|\S+)(?:[ \t]+("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^)\\]|\\.)*\)))?[ \t]*$/,
};
const isFence = l => { const m = MD.fence.exec(l); return m && !(m[2][0] === '`' && m[3].includes('`')) ? m : null; };
const mdSplitRow = l => {
  let s = l.trim(); if (s.startsWith('|')) s = s.slice(1); if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
};
function parseBlocks(lines, ctx) {
  const out = [], n = lines.length; let i = 0, sawBlank = false;
  const push = b => { b.gap = sawBlank && out.length > 0; sawBlank = false; out.push(b); };
  // may this line interrupt a paragraph?
  const interrupts = l => {
    if (MD.atx.test(l) && /^ {0,3}#{1,6}(?:[ \t]|$)/.test(l)) return true;
    if (MD.hr.test(l) || isFence(l) || MD.quote.test(l)) return true;
    const m = MD.list.exec(l);
    if (m && !MD.blank.test(l.slice(m[0].length)) && (!m[3] || m[3] === '1')) return true;
    return ctx.allowHtml && MD.html.test(l);
  };
  const tableAt = j => j + 1 < n && lines[j].includes('|') && MD.delim.test(lines[j + 1]) && lines[j + 1].includes('-') &&
    mdSplitRow(lines[j]).length === mdSplitRow(lines[j + 1]).length;
  while (i < n) {
    const l = lines[i];
    if (MD.blank.test(l)) { i++; sawBlank = true; continue; }
    if (indentOf(l) >= 4) {                                      // indented code
      const buf = [];
      while (i < n && (indentOf(lines[i]) >= 4 || MD.blank.test(lines[i]))) buf.push(dedent(lines[i++], 4));
      let tb = 0; while (buf.length && MD.blank.test(buf[buf.length - 1])) { buf.pop(); tb++; }
      push({ t: 'code', lang: '', text: buf.join('\n') + '\n' }); sawBlank = tb > 0; continue;
    }
    let m;
    if ((m = isFence(l))) {                                       // fenced code
      const ind = m[1].length, fch = m[2][0], flen = m[2].length, buf = []; i++;
      const close = new RegExp(`^ {0,3}${fch === '`' ? '`' : '~'}{${flen},}[ \\t]*$`);
      while (i < n && !close.test(lines[i])) buf.push(dedent(lines[i++], ind));
      if (i >= n) while (buf.length && MD.blank.test(buf[buf.length - 1])) buf.pop();   // unclosed fence runs to the end
      i++;
      push({ t: 'code', lang: unBackslash(m[3].split(/\s+/)[0] || ''), text: buf.length ? buf.join('\n') + '\n' : '' }); continue;
    }
    if (/^ {0,3}#{1,6}(?:[ \t]|$)/.test(l)) {                     // ATX heading
      m = MD.atx.exec(l); push({ t: 'h', level: m[1].length, text: (m[2] || '').trim() }); i++; continue;
    }
    if (MD.hr.test(l)) { push({ t: 'hr' }); i++; continue; }
    if (MD.quote.test(l)) {                                       // blockquote (with lazy continuation)
      const buf = [];
      while (i < n) {
        if (MD.quote.test(lines[i])) buf.push(lines[i++].replace(MD.quote, ''));
        else if (!MD.blank.test(lines[i]) && buf.length && !MD.blank.test(buf[buf.length - 1]) && !interrupts(lines[i])) buf.push(lines[i++]);
        else break;
      }
      push({ t: 'quote', children: parseBlocks(buf, ctx) }); continue;
    }
    if ((m = MD.list.exec(l))) {                                  // list
      const ordered = !!m[3], key = ordered ? m[4] : m[2], start = ordered ? parseInt(m[3], 10) : 1, items = [];
      let loose = false;
      while (i < n) {
        const lm = MD.list.exec(lines[i]);
        if (!lm || MD.hr.test(lines[i]) || (lm[3] ? lm[4] : lm[2]) !== key) break;
        const rest = lines[i].slice(lm[0].length), sp = indentOf(rest);
        const blankFirst = MD.blank.test(rest);
        const w = lm[0].length + (blankFirst || sp > 4 ? 1 : sp);
        const buf = [blankFirst ? '' : sp > 4 ? dedent(rest, 1) : rest.replace(/^[ \t]+/, '')];
        i++;
        while (i < n) {
          const x = lines[i];
          if (MD.blank.test(x)) { if (blankFirst && buf.length === 1 && buf[0] === '') break; buf.push(''); i++; continue; }
          if (indentOf(x) >= w) { buf.push(dedent(x, w)); i++; continue; }
          if (buf[buf.length - 1] !== '' && !MD.list.test(x) && !interrupts(x) && !tableAt(i)) { buf.push(x); i++; continue; }
          break;
        }
        let trailing = 0; while (buf.length && MD.blank.test(buf[buf.length - 1])) { buf.pop(); trailing++; }
        const children = parseBlocks(buf, ctx);
        if (children.some(c => c.gap)) loose = true;
        items.push(children);
        if (trailing && i < n) { const nm = MD.list.exec(lines[i]); if (nm && (nm[3] ? nm[4] : nm[2]) === key && !MD.hr.test(lines[i])) loose = true; }
      }
      push({ t: 'list', ordered, start, loose, items }); continue;
    }
    if (ctx.allowHtml && (MD.html.test(l) || MD.html7.test(l))) {                        // raw HTML block (only when allowed)
      const buf = []; while (i < n && !MD.blank.test(lines[i])) buf.push(lines[i++]);
      push({ t: 'html', text: buf.join('\n') }); continue;
    }
    if (tableAt(i)) {                                             // GFM table
      const head = mdSplitRow(l), align = mdSplitRow(lines[i + 1]).map(c => c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : '');
      const rows = []; i += 2;
      while (i < n && !MD.blank.test(lines[i]) && !interrupts(lines[i])) {
        const r = mdSplitRow(lines[i++]); rows.push(head.map((_, k) => r[k] ?? ''));
      }
      push({ t: 'table', head, align, rows }); continue;
    }
    // link reference definitions, then paragraph (setext heading if underlined)
    if ((m = MD.ref.exec(l))) {
      const label = normLabel(m[1]);
      if (label && !ctx.refs.has(label)) ctx.refs.set(label, { url: m[2].replace(/^<|>$/g, ''), title: m[3] ? m[3].slice(1, -1) : '' });
      i++; continue;
    }
    const buf = [l.replace(/^[ \t]+/, '')]; i++;
    let setext = 0;
    while (i < n) {
      const x = lines[i];
      if (MD.blank.test(x)) break;
      if ((m = MD.setext.exec(x))) { setext = m[1][0] === '=' ? 1 : 2; i++; break; }
      if (interrupts(x) || tableAt(i)) break;
      buf.push(x.replace(/^[ \t]+/, '')); i++;
    }
    const text = buf.join('\n').replace(/[ \t]+$/, '');
    push(setext ? { t: 'h', level: setext, text } : { t: 'p', text });
  }
  return out;
}
function mdInline(src, ctx) {
  const toks = [], put = h => `\u0000${toks.push(h) - 1}\u0000`;
  let out = '', i = 0;
  const codeEnd = (s, at) => {   // index after the closing backtick run for the run at `at`, or -1
    const run = /^`+/.exec(s.slice(at))[0], re = new RegExp(`(?<!\`)${run}(?!\`)`, 'g');
    re.lastIndex = at + run.length; const m = re.exec(s);
    return m ? { len: run.length, close: m.index } : { len: run.length, close: -1 };
  };
  const tryLink = (at, img) => {
    const s0 = at + (img ? 2 : 1); let depth = 1, j = s0;
    while (j < src.length) {
      const ch = src[j];
      if (ch === '\\') { j += 2; continue; }
      if (ch === '`') { const c = codeEnd(src, j); j = c.close < 0 ? j + c.len : c.close + c.len; continue; }
      if (ch === '[') depth++; else if (ch === ']' && --depth === 0) break;
      j++;
    }
    if (j >= src.length) return null;
    const text = src.slice(s0, j); let url, title = '', end;
    if (src[j + 1] === '(') {
      let p = j + 2; while (/[ \t\n]/.test(src[p] || '')) p++;
      if (src[p] === '<') { const e = src.indexOf('>', p); if (e < 0 || src.slice(p, e).includes('\n')) return null; url = src.slice(p + 1, e); p = e + 1; }
      else {
        let d = 0, q = p;
        while (q < src.length) { const ch = src[q]; if (ch === '\\') { q += 2; continue; } if (/\s/.test(ch)) break; if (ch === '(') d++; else if (ch === ')') { if (!d) break; d--; } q++; }
        url = src.slice(p, q); p = q;
      }
      while (/[ \t\n]/.test(src[p] || '')) p++;
      if (/["'(]/.test(src[p] || '') && p > 0 && /\s/.test(src[p - 1])) {
        const cl = src[p] === '(' ? ')' : src[p]; let q = p + 1;
        while (q < src.length && src[q] !== cl) q += src[q] === '\\' ? 2 : 1;
        if (q >= src.length) return null;
        title = src.slice(p + 1, q); p = q + 1; while (/[ \t\n]/.test(src[p] || '')) p++;
      }
      if (src[p] !== ')') return null;
      end = p + 1;
    } else {
      let label = text; end = j + 1;
      const m = /^\[((?:[^\]\\]|\\.)*)\]/.exec(src.slice(j + 1));
      if (m) { if (m[1].trim()) label = m[1]; end = j + 1 + m[0].length; }
      const ref = ctx.refs.get(normLabel(label)); if (!ref) return null;
      ({ url, title } = ref);
    }
    const inner = mdInline(text, ctx), t = title ? ` title="${escAttr(unBackslash(title))}"` : '';
    const href = escAttr(safeUrl(unBackslash(url), img));
    return { end, html: img ? `<img src="${href}" alt="${inner.replace(/<[^>]*>/g, '')}"${t}>` : `<a href="${href}"${t}>${inner}</a>` };
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const nx = src[i + 1];
      if (nx === '\n') { out += put('<br>\n'); i += 2; continue; }
      if (nx && new RegExp(`[${PUNCT}]`).test(nx)) { out += put(escAttr(nx)); i += 2; continue; }
    } else if (c === '`') {
      const { len, close } = codeEnd(src, i);
      if (close < 0) { out += '`'.repeat(len); i += len; continue; }
      let code = src.slice(i + len, close).replace(/\n/g, ' ');
      if (/^ .*[^ ].* $/.test(code) || /^ [^ ] $/.test(code)) code = code.slice(1, -1);
      out += put(`<code>${escAttr(code)}</code>`); i = close + len; continue;
    } else if (c === '<') {
      const rest = src.slice(i); let m;
      if ((m = /^<([a-zA-Z][a-zA-Z0-9+.-]{1,31}:[^\s<>]*)>/.exec(rest))) { out += put(`<a href="${escAttr(safeUrl(m[1]))}">${escAttr(m[1])}</a>`); i += m[0].length; continue; }
      if ((m = /^<([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/.exec(rest))) { out += put(`<a href="mailto:${escAttr(m[1])}">${escAttr(m[1])}</a>`); i += m[0].length; continue; }
      if (ctx.allowHtml && (m = /^(?:<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s+[a-zA-Z_:][\w.:-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>|<!--[\s\S]*?-->)/.exec(rest))) { out += put(m[0]); i += m[0].length; continue; }
    } else if (c === '[' || (c === '!' && src[i + 1] === '[')) {
      const r = tryLink(i, c === '!');
      if (r) { out += put(r.html); i = r.end; continue; }
      if (c === '!') { out += '!['; i += 2; continue; }
    } else if (c === ' ') {
      const m = /^ {2,}\n/.exec(src.slice(i, i + 64));
      if (m) { out += put('<br>\n'); i += m[0].length; continue; }
    }
    out += c; i++;
  }
  let s = escText(out.replace(/ +\n/g, '\n'));
  s = emphasis(s).replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, k) => toks[k]);
}
// CommonMark "process emphasis": delimiter runs of * and _ with left/right-flanking rules (Unicode whitespace and
// punctuation), the rule of 3, and strong-before-em matching. Runs on escaped text (entities count as punctuation,
// \u0000k\u0000 tokens as letters).
const isWs = c => c === '' || /\s/u.test(c), isPunct = c => /[\p{P}\p{S}]/u.test(c);
function emphasis(s) {
  const nodes = []; let last = 0;
  for (const m of s.matchAll(/\*+|_+/g)) {
    if (m.index > last) nodes.push({ text: s.slice(last, m.index) });
    const prev = [...s.slice(Math.max(0, m.index - 2), m.index)].pop() || '', next = [...s.slice(m.index + m[0].length, m.index + m[0].length + 2)][0] || '';
    const left = !isWs(next) && (!isPunct(next) || isWs(prev) || isPunct(prev));
    const right = !isWs(prev) && (!isPunct(prev) || isWs(next) || isPunct(next));
    const star = m[0][0] === '*';
    nodes.push({ ch: m[0][0], n: m[0].length, orig: m[0].length, open: [], close: [],
      canOpen: star ? left : left && (!right || isPunct(prev)), canClose: star ? right : right && (!left || isPunct(next)) });
    last = m.index + m[0].length;
  }
  if (last < s.length) nodes.push({ text: s.slice(last) });
  const stack = [];
  for (let i = 0; i < nodes.length; i++) {
    const c = nodes[i]; if (!c.ch) continue;
    while (c.canClose && c.n) {
      let o = stack.length - 1;
      for (; o >= 0; o--) {
        const d = stack[o];
        if (d.ch !== c.ch || !d.n) continue;
        if ((d.canClose || c.canOpen) && (d.orig + c.orig) % 3 === 0 && !(d.orig % 3 === 0 && c.orig % 3 === 0)) continue;
        break;
      }
      if (o < 0) break;
      const d = stack[o], use = d.n >= 2 && c.n >= 2 ? 2 : 1, tag = use === 2 ? 'strong' : 'em';
      d.n -= use; c.n -= use; d.open.unshift(`<${tag}>`); c.close.push(`</${tag}>`);
      stack.splice(o + 1);  // delimiters between opener and closer become literal text
      if (!d.n) stack.pop();
    }
    if (c.n && c.canOpen) stack.push(c);
  }
  return nodes.map(x => x.ch ? x.close.join('') + x.ch.repeat(x.n) + x.open.join('') : x.text).join('');
}
function renderBlocks(blocks, ctx, tight = false) {
  const I = s => mdInline(s, ctx);
  return blocks.map(b => {
    switch (b.t) {
      case 'p': return tight ? I(b.text) : `<p>${I(b.text)}</p>`;
      case 'h': return `<h${b.level}>${I(b.text)}</h${b.level}>`;
      case 'hr': return '<hr>';
      case 'html': return b.text;
      case 'code': return `<pre><code${b.lang ? ` class="language-${escAttr(b.lang)}"` : ''}>${escAttr(b.text)}</code></pre>`;
      case 'quote': return b.children.length ? `<blockquote>\n${renderBlocks(b.children, ctx)}\n</blockquote>` : '<blockquote>\n</blockquote>';
      case 'table': {
        const al = k => b.align[k] ? ` align="${b.align[k]}"` : '';
        const tr = (cells, tag) => `<tr>${cells.map((c, k) => `<${tag}${al(k)}>${I(c)}</${tag}>`).join('')}</tr>`;
        return `<table>\n<thead>\n${tr(b.head, 'th')}\n</thead>\n` + (b.rows.length ? `<tbody>\n${b.rows.map(r => tr(r, 'td')).join('\n')}\n</tbody>\n` : '') + '</table>';
      }
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul', st = b.ordered && b.start !== 1 ? ` start="${b.start}"` : '';
        const li = ch => {
          if (!ch.length) return '<li></li>';
          const parts = ch.map(c => renderBlocks([c], ctx, !b.loose));
          if (!b.loose && ch[0].t === 'p') return `<li>${parts[0]}${parts.length > 1 ? '\n' + parts.slice(1).join('\n') + '\n' : ''}</li>`;
          return `<li>\n${parts.join('\n')}\n</li>`;
        };
        return `<${tag}${st}>\n${b.items.map(li).join('\n')}\n</${tag}>`;
      }
    }
    return '';
  }).join('\n');
}
export function markdownToHtml(md, { allowHtml = false } = {}) {
  const ctx = { allowHtml, refs: new Map() };
  const lines = String(md).replace(/\u0000/g, '�').replace(/\r\n?/g, '\n').split('\n');
  const html = renderBlocks(parseBlocks(lines, ctx), ctx);
  return html ? html + '\n' : '';
}
export function htmlDocument(body, title = '') {
  const h1 = /<h1>([\s\S]*?)<\/h1>/.exec(body);
  const t = title || (h1 ? h1[1].replace(/<[^>]*>/g, '').trim() : '') || 'Document';
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${t}</title>\n</head>\n<body>\n${body}</body>\n</html>\n`;
}

// ---- UTM link builder. Works on the raw URL string so existing query encoding and the #fragment are kept as typed.
export const UTM_KEYS = ['source', 'medium', 'campaign', 'term', 'content', 'id'];
export function tagUrl(input, params = {}, { lowercase = false } = {}) {
  let s = String(input).trim(), fixed = false;
  if (!s) return { error: 'empty line' };
  if (/^\/\//.test(s)) { s = 'https:' + s; fixed = true; }
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]|$)/.test(s)) { s = 'https://' + s; fixed = true; }
  let u; try { u = new URL(s); } catch { return { error: 'not a valid URL' }; }
  if (!/^https?:$/.test(u.protocol)) return { error: `only http(s) links can be tagged (got ${u.protocol})` };
  if (/\s/.test(s)) return { error: 'URL contains spaces' };
  const hashAt = s.indexOf('#'), hash = hashAt >= 0 ? s.slice(hashAt) : '', noHash = hashAt >= 0 ? s.slice(0, hashAt) : s;
  const qAt = noHash.indexOf('?'), base = qAt >= 0 ? noHash.slice(0, qAt) : noHash, query = qAt >= 0 ? noHash.slice(qAt + 1) : '';
  const set = UTM_KEYS.map(k => [`utm_${k}`, String(params[k] ?? '').trim()]).filter(([, v]) => v).map(([k, v]) => [k, lowercase ? v.toLowerCase() : v]);
  const keys = new Set(set.map(([k]) => k));
  const keyOf = pair => { const k = pair.split('=')[0]; try { return decodeURIComponent(k.replace(/\+/g, ' ')).toLowerCase(); } catch { return k.toLowerCase(); } };
  const all = query.split('&').filter(Boolean), kept = all.filter(p => !keys.has(keyOf(p)));
  const q = [...kept, ...set.map(([k, v]) => `${k}=${encodeURIComponent(v)}`)].join('&');
  return { url: base + (q ? '?' + q : '') + hash, fixed, replaced: all.length - kept.length };
}
export function utmIssues(params = {}, { lowercase = false } = {}) {
  const errors = [], warnings = [], v = k => String(params[k] ?? '').trim();
  if (!v('source')) errors.push('utm_source is required (e.g. newsletter, google, linkedin).');
  for (const k of ['medium', 'campaign']) if (!v(k)) warnings.push(`utm_${k} is empty — recommended.`);
  if (!lowercase && UTM_KEYS.some(k => /[A-Z]/.test(v(k)))) warnings.push('Values are case-sensitive in analytics ("Email" ≠ "email"); consider lowercase.');
  if (UTM_KEYS.some(k => / /.test(v(k)))) warnings.push('Spaces are encoded as %20; many teams use - or _ instead.');
  return { errors, warnings };
}
export function tagUrls(text, params = {}, opts = {}) {
  const rows = [], errors = [];
  String(text).split(/\r?\n/).forEach((line, n) => {
    if (!line.trim()) return;
    const r = tagUrl(line, params, opts);
    if (r.error) errors.push({ line: n + 1, input: line.trim(), error: r.error }); else rows.push([line.trim(), r.url]);
  });
  return { rows, errors };
}

// ---- URL list -> sitemap.xml (sitemaps.org 0.9)
const XML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' };
export const xmlEscape = s => String(s).replace(/[&<>'"]/g, c => XML_ESC[c]);
export const SITEMAP_MAX = 50000;
export const CHANGEFREQS = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never'];
const W3C_DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d))?$/;
// the regex alone let 2024-02-30 / 2023-02-29 through (no such day: invalid xsd:date, ignored by search engines)
export const isW3CDate = s => { if (!W3C_DATE.test(s)) return false; const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDate() === d; };
export function buildSitemap(text, { lastmod = '', changefreq = '', priority = '', max = SITEMAP_MAX } = {}) {
  lastmod = String(lastmod).trim(); priority = String(priority).trim();
  if (lastmod && !isW3CDate(lastmod)) throw new Error(`lastmod "${lastmod}" is not a W3C date (use YYYY-MM-DD or YYYY-MM-DDThh:mm:ss+00:00).`);
  if (changefreq && !CHANGEFREQS.includes(changefreq)) throw new Error(`changefreq must be one of ${CHANGEFREQS.join(', ')}.`);
  if (priority && !(/^\d(\.\d+)?$/.test(priority) && +priority <= 1)) throw new Error('priority must be between 0.0 and 1.0.');
  const urls = [], seen = new Set(), invalid = [], hosts = new Map(); let duplicates = 0, fragments = 0;
  String(text).split(/\r?\n/).forEach((raw, n) => {
    const line = raw.trim(); if (!line || line.startsWith('#')) return;
    const bad = reason => invalid.push({ line: n + 1, input: line, reason });
    const dm = /^(.*?)[\s,;]+(\d{4}-\d\d-\d\d\S*)$/.exec(line);
    const loc = dm ? dm[1] : line, date = dm ? dm[2] : '';
    if (!/^https?:\/\//i.test(loc)) return bad('not an absolute http(s) URL');
    if (/\s/.test(loc)) return bad('contains spaces (encode them as %20)');
    let u; try { u = new URL(loc); } catch { return bad('not a valid URL'); }
    if (!u.hostname) return bad('no host name');
    if (date && !isW3CDate(date)) return bad(`lastmod "${date}" is not a valid date`);
    if (u.hash) { fragments++; u.hash = ''; }
    const href = u.href;
    if (href.length > 2048) return bad('longer than 2,048 characters');
    if (seen.has(href)) { duplicates++; return; }
    seen.add(href); hosts.set(u.origin, (hosts.get(u.origin) || 0) + 1);
    urls.push({ loc: href, lastmod: date || lastmod });
  });
  const pr = priority ? (+priority).toFixed(1) : '';
  const entry = u => `  <url>\n    <loc>${xmlEscape(u.loc)}</loc>\n` + (u.lastmod ? `    <lastmod>${xmlEscape(u.lastmod)}</lastmod>\n` : '') +
    (changefreq ? `    <changefreq>${changefreq}</changefreq>\n` : '') + (pr ? `    <priority>${pr}</priority>\n` : '') + '  </url>\n';
  const parts = [];
  for (let k = 0; k < urls.length; k += max)
    parts.push(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.slice(k, k + max).map(entry).join('')}</urlset>\n`);
  const hostList = [...hosts].sort((a, b) => b[1] - a[1]).map(([origin, count]) => ({ origin, count }));
  const warnings = [];
  if (hostList.length > 1) warnings.push(`URLs span ${hostList.length} hosts/protocols (${hostList.map(h => `${h.origin} ×${h.count}`).join(', ')}). A sitemap may only list URLs on the same host and protocol as the sitemap file itself.`);
  if (parts.length > 1) warnings.push(`${urls.length.toLocaleString('en-US')} URLs is over the ${max.toLocaleString('en-US')}-URL limit per sitemap: split into ${parts.length} files (sitemap-1.xml … sitemap-${parts.length}.xml) plus a sitemap index.`);
  if (parts.some(p => p.length > 50 * 1024 * 1024)) warnings.push('A file is larger than 50 MB uncompressed (the sitemap size limit) — split the list further.');
  const origin = hostList[0]?.origin || '';
  const index = parts.length > 1 ? `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts.map((_, k) =>
    `  <sitemap>\n    <loc>${xmlEscape(`${origin}/sitemap-${k + 1}.xml`)}</loc>\n` + (lastmod ? `    <lastmod>${xmlEscape(lastmod)}</lastmod>\n` : '') + '  </sitemap>\n').join('')}</sitemapindex>\n` : '';
  return { xml: parts[0] || '', parts, index, count: urls.length, invalid, duplicates, fragments, hosts: hostList, warnings };
}

// ---- URL parser / encoder / decoder. Query parsing works on the raw string so duplicates, empty values and bad escapes are visible.
export const ENCODE_MODES = ['component', 'uri', 'form'];
// Strict percent-decoding with a readable error. plus=true treats '+' as a space (application/x-www-form-urlencoded).
export function percentDecode(s, { plus = false, keepReserved = false } = {}) {
  s = String(s); if (plus) s = s.replace(/\+/g, ' ');
  const bad = /%(?![0-9a-f]{2})/i.exec(s);
  if (bad) throw new Error(`Malformed percent-escape "${s.slice(bad.index, bad.index + 3)}" at position ${bad.index + 1}: % must be followed by two hex digits (write a literal % as %25).`);
  try { return keepReserved ? decodeURI(s) : decodeURIComponent(s); }
  catch {
    // locate the first escape run that is not valid UTF-8
    const re = /(?:%[0-9a-f]{2})+/gi; let m;
    while ((m = re.exec(s))) { try { decodeURIComponent(m[0]); } catch { return badUtf8(m, s); } }
    throw new Error('Percent-escapes do not form valid UTF-8.');
  }
}
function badUtf8(m) { throw new Error(`Percent-escapes "${m[0]}" at position ${m.index + 1} are not valid UTF-8 (incomplete or invalid byte sequence).`); }
export function encodeText(s, mode = 'component') {
  s = String(s);
  if (mode === 'uri') return encodeURI(s);
  const c = encodeURIComponent(s);
  return mode === 'form' ? c.replace(/[!'()~]/g, ch => '%' + ch.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, '+') : c;
}
export function decodeText(s, mode = 'component') {
  return percentDecode(s, { plus: mode === 'form', keepReserved: mode === 'uri' });
}
const safeDecode = (s, plus) => { try { return { value: percentDecode(s, { plus }) }; } catch (e) { return { value: s, error: e.message }; } };
// RFC 3492 punycode label decoder (the URL API only gives the ASCII form of IDN hosts).
function punyDecodeLabel(input) {
  const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
  const out = []; let n = 128, i = 0, bias = 72;
  const b = input.lastIndexOf('-');
  for (let j = 0; j < Math.max(b, 0); j++) { if (input.charCodeAt(j) >= 128) throw new Error('bad'); out.push(input.charCodeAt(j)); }
  const digit = c => c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : base;
  const adapt = (delta, num, first) => { let k = 0; delta = first ? Math.floor(delta / damp) : delta >> 1; delta += Math.floor(delta / num);
    for (; delta > ((base - tMin) * tMax) >> 1; k += base) delta = Math.floor(delta / (base - tMin)); return Math.floor(k + (base - tMin + 1) * delta / (delta + skew)); };
  for (let idx = b > 0 ? b + 1 : 0; idx < input.length;) {
    const oldi = i;
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) throw new Error('bad');
      const d = digit(input.charCodeAt(idx++)); if (d >= base) throw new Error('bad');
      i += d * w; const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (d < t) break; w *= base - t;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0); n += Math.floor(i / (out.length + 1)); i %= out.length + 1;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}
export function hostToUnicode(host) {
  return String(host).split('.').map(l => { if (!/^xn--/i.test(l)) return l; try { return punyDecodeLabel(l.slice(4).toLowerCase()); } catch { return l; } }).join('.');
}
export function parseQuery(query) {
  const q = String(query).replace(/^\?/, '');
  if (!q) return [];
  return q.split('&').filter(p => p !== '').map(raw => {
    const eq = raw.indexOf('='), k = eq >= 0 ? raw.slice(0, eq) : raw, v = eq >= 0 ? raw.slice(eq + 1) : '';
    const dk = safeDecode(k, true), dv = safeDecode(v, true);
    return { key: dk.value, value: dv.value, raw, hasEquals: eq >= 0, ...(dk.error || dv.error ? { error: dk.error || dv.error } : {}) };
  });
}
export function queryToJson(params) {
  const o = Object.create(null);
  for (const { key, value } of params) {
    if (!Object.prototype.hasOwnProperty.call(o, key)) o[key] = value;
    else if (Array.isArray(o[key])) o[key].push(value); else o[key] = [o[key], value];
  }
  return o;
}
export function parseUrl(input) {
  let s = String(input).trim(), fixed = false;
  if (!s) return { error: 'Enter a URL.' };
  if (/^\/\//.test(s)) { s = 'https:' + s; fixed = true; }
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(s) && /^[^\s/?#:@]+\.[^\s/?#:@.]+(:\d+)?([/?#]|$)/.test(s)) { s = 'https://' + s; fixed = true; }
  let u; try { u = new URL(s); } catch { return { error: 'Not a valid absolute URL (include the scheme, e.g. https://).' }; }
  const hashAt = s.indexOf('#'), noHash = hashAt >= 0 ? s.slice(0, hashAt) : s, qAt = noHash.indexOf('?');
  const rawQuery = qAt >= 0 ? noHash.slice(qAt + 1) : '', rawFragment = hashAt >= 0 ? s.slice(hashAt + 1) : '';
  const params = parseQuery(rawQuery), dec = x => safeDecode(x, false);
  const host = u.hostname, hostUnicode = hostToUnicode(host), path = dec(u.pathname), frag = dec(rawFragment);
  return {
    href: u.href, fixed, protocol: u.protocol, username: dec(u.username).value, password: dec(u.password).value,
    host, hostUnicode, port: u.port, defaultPort: u.port ? '' : ({ 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443', 'ftp:': '21' }[u.protocol] || ''),
    origin: u.origin, pathname: u.pathname, path: path.value, query: rawQuery, params, fragment: rawFragment, fragmentDecoded: frag.value,
    errors: [...(path.error ? ['Path: ' + path.error] : []), ...params.filter(p => p.error).map(p => `Parameter "${p.raw}": ${p.error}`), ...(frag.error ? ['Fragment: ' + frag.error] : [])],
  };
}

// ---- DNS lookup + email authentication checks (#130). Network I/O lives in tools.js; these are pure.
export const DNS_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'CAA', 'SOA'];
export function parseDomainInput(input) {
  let s = String(input).trim().toLowerCase();
  if (!s) return { error: 'Enter a domain, URL or email address.' };
  const email = /^[^\s@]+@([^\s@]+)$/.exec(s);
  if (email) s = email[1];
  else { s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^[^/?#@]*@/, '').split(/[/?#]/)[0].replace(/:\d+$/, ''); }
  s = s.replace(/\.$/, '');
  let host; try { host = new URL('http://' + s).hostname; } catch { return { error: `"${input}" is not a valid domain.` }; }
  if (!/^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host)) return { error: `"${input}" is not a valid domain.` };
  return { domain: host, fromEmail: !!email };
}
// DoH JSON TXT data is quoted, long records split into several strings: "v=spf1 ..." "-all"
export function txtValue(data) {
  const parts = [...String(data).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map(m => m[1].replace(/\\(.)/g, '$1'));
  return parts.length ? parts.join('') : String(data);
}
// recs: { TYPE: [data strings] } (TXT already unquoted), dmarc: [TXT strings at _dmarc.<domain>]
export const sortMx = mx => [...mx].sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
export function emailChecks(recs, dmarc) {
  const out = [], mx = sortMx(recs.MX || []), txt = recs.TXT || [];
  const nullMx = mx.length === 1 && /^0\s+\.?$/.test(mx[0].trim());
  if (nullMx) out.push(['fail', 'MX', 'Null MX (RFC 7505): this domain declares it accepts no email.']);
  else if (mx.length) out.push(['pass', 'MX', `${mx.length} mail server${mx.length > 1 ? 's' : ''}: ${mx.map(m => (m.split(/\s+/)[1] || m).replace(/\.$/, '')).join(', ')}`]);
  else if ((recs.A || []).length || (recs.AAAA || []).length) out.push(['warn', 'MX', 'No MX record. Senders fall back to the A/AAAA address, which rarely runs a mail server.']);
  else out.push(['fail', 'MX', 'No MX and no A/AAAA record: email to this domain will bounce.']);
  const spf = txt.filter(t => /^v=spf1(\s|$)/i.test(t.trim()));
  if (!spf.length) out.push(['warn', 'SPF', 'No SPF record. Receivers cannot tell which servers may send for this domain.']);
  else if (spf.length > 1) out.push(['fail', 'SPF', `${spf.length} SPF records: receivers treat this as a permanent error (only one is allowed).`]);
  else {
    const all = /(?:^|\s)([+~?-]?)all(?:\s|$)/i.exec(spf[0]), q = all ? all[1] || '+' : null;
    const lookups = (spf[0].match(/(?:^|\s)[+~?-]?(include:|a\b|mx\b|ptr\b|exists:|redirect=)/gi) || []).length;
    const msg = `${spf[0]}`;
    if (q === '-') out.push(['pass', 'SPF', msg + '  (-all: unlisted senders fail)']);
    else if (q === '~') out.push(['pass', 'SPF', msg + '  (~all: unlisted senders soft-fail)']);
    else if (q === '+') out.push(['fail', 'SPF', msg + '  (+all lets any server send as this domain)']);
    else if (q === '?') out.push(['warn', 'SPF', msg + '  (?all: neutral, gives no protection)']);
    else if (/(?:^|\s)redirect=/i.test(spf[0])) out.push(['pass', 'SPF', msg + '  (policy comes from the redirect target)']);
    else out.push(['warn', 'SPF', msg + '  (no "all" term: defaults to neutral)']);
    if (lookups > 10) out.push(['fail', 'SPF', `${lookups} DNS-lookup terms at the top level alone; SPF allows 10 in total.`]);
  }
  const d = dmarc.filter(t => /^v=DMARC1(\s*;|\s*$)/i.test(t.trim()));
  if (!d.length) out.push(['warn', 'DMARC', 'No DMARC record at _dmarc. Gmail and Yahoo require one for bulk senders.']);
  else if (d.length > 1) out.push(['fail', 'DMARC', `${d.length} DMARC records: receivers ignore all of them.`]);
  else {
    // split on the FIRST '=' only: rua=mailto:x@y.com?subject=dmarc must not drop the tag
    const tags = Object.fromEntries(d[0].split(';').map(x => x.trim()).filter(x => x.includes('=')).map(x => [x.slice(0, x.indexOf('=')).trim().toLowerCase(), x.slice(x.indexOf('=') + 1).trim()]));
    const p = (tags.p || '').toLowerCase();
    const rua = tags.rua ? ` · reports to ${tags.rua}` : ' · no rua reporting address';
    if (p === 'reject' || p === 'quarantine') out.push(['pass', 'DMARC', `p=${p}${tags.pct && tags.pct !== '100' ? ` (pct=${tags.pct})` : ''}${rua}`]);
    else if (p === 'none') out.push(['warn', 'DMARC', `p=none: monitoring only, spoofed mail is still delivered${rua}`]);
    else out.push(['fail', 'DMARC', `Missing or invalid p= tag: ${d[0]}`]);
  }
  return out;
}
export function formatDnsReport(domain, recs, dmarc, checks) {
  const lines = [`DNS records for ${domain}`, ''];
  for (const t of DNS_TYPES) for (const v of t === 'MX' ? sortMx(recs[t] || []) : recs[t] || []) lines.push(`${t.padEnd(6)} ${v}`);
  for (const v of dmarc) lines.push(`TXT    _dmarc.${domain}  ${v}`);
  if (lines.length === 2) lines.push('(no records found)');
  lines.push('', 'Email checks');
  for (const [s, k, m] of checks) lines.push(`${s.toUpperCase().padEnd(5)} ${k.padEnd(6)} ${m}`);
  return lines.join('\n') + '\n';
}
