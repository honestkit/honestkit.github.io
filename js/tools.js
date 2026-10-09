// UI wiring for the free tools. Each tool page has <article data-tool="...">.
import { toCSV, toTSV, toMarkdown, toXLSX, zip } from './formats.js';
import { dedupe, filterLinks, toRows } from './filter.js';
import { buildSecurityHeaders, formatServerHeaders, parseCurl, curlToCode, jsonToRows, parseCSV, rowsToHTML, extractTables, htmlToMarkdown, extractLinks, parseHeaders, formatHeaders, parsePalette, formatPalette,
  formatMarkdownTables, markdownTablesToRows, rowsToJson, parseRobots, checkRobots, robotsGroupFor, parseHreflang, checkHreflang, rowsToSql, xmlToRows, compareLists, mergeCsvs, splitCsv, transposeRows, decodeJwt, parseColor, contrastRatio, formatRatio, wcagChecks, toHex, toRgbString, toHslString, suggestForeground,
  markdownToHtml, htmlDocument, UTM_KEYS, tagUrl, tagUrls, utmIssues, buildSitemap,
  parseUrl, queryToJson, encodeText, decodeText, DNS_TYPES, parseDomainInput, txtValue, emailChecks, formatDnsReport } from './convert.js';

const $ = id => document.getElementById(id);
const tool = document.querySelector('[data-tool]').dataset.tool;
const status = (msg, err = false) => { $('status').textContent = msg; $('status').classList.toggle('err', err); };
const noBOM = s => s.replace(/^\ufeff/, '');
function download(data, name, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('out').value); status('Copied to clipboard.'); }
  catch { $('out').select(); document.execCommand('copy'); status('Copied.'); }
});

const SAMPLES = {
  'dns-lookup': 'name@example.com',
  'markdown-to-html': `# Release notes

Version **2.0** adds *faster* exports and ~~removes~~ deprecates the old API.
See the [changelog](https://example.com/changelog "Full changelog") or [docs][d].

## Install

\`\`\`bash
npm install example-tool
\`\`\`

- Works offline
- Supports:
  1. CSV
  2. Markdown tables

> Tip: use \`--dry-run\` first.

| Format | Speed |
| :----- | ----: |
| CSV    | fast  |

Raw <b>HTML</b> is escaped unless allowed.

[d]: https://example.com/docs`,
  'utm-builder': `https://example.com/pricing?plan=pro#compare
https://example.com/blog/launch
example.com/signup`,
  'url-parser': 'https://user:p%40ss@m\u00fcnchen.example:8080/docs/a%20b?q=caf%C3%A9&tag=a&tag=b&empty=&flag&sp=a+b#top?x=1',
  'sitemap-generator': `https://example.com/
https://example.com/about 2026-09-01
https://example.com/search?q=shoes&color=red
https://example.com/about#team
/relative-page
https://example.com/`,
  'markdown-table-formatter': `Messy table from a README:

Tool|Price|Notes
:--|--:|:-:
PlainTables|free|tables → CSV \\| XLSX
Formatter | 0 | keeps \`a|b\` code
Short row|1`,
  'color-contrast-checker': 'rgb(14, 124, 102)',
  'security-headers': `script-src https://cdn.jsdelivr.net\nstyle-src 'unsafe-inline' https://fonts.googleapis.com\nfont-src https://fonts.gstatic.com\nimg-src data: https:\nconnect-src https://api.example.com`,
  'json-to-markdown-table': `[
  {"endpoint": "/users", "method": "GET", "auth": {"required": true}},
  {"endpoint": "/users/{id}", "method": "DELETE", "auth": {"required": true, "scope": "admin"}}
]`,
  'excel-to-markdown-table': 'Product\tQty\tPrice\nWidget\t3\t$4.50\nGadget | Pro\t1\t$19.00',
  'curl-converter': `curl 'https://api.example.com/v1/items?page=2' \\
  -H 'Authorization: Bearer YOUR_TOKEN' \\
  -H 'Content-Type: application/json' \\
  --data-raw '{"name":"Widget","tags":["a","b"],"active":true}'`,
  'json-to-csv': `[
  {"id": 1, "name": "Ada", "address": {"city": "London"}, "tags": ["math", "code"]},
  {"id": 2, "name": "Grace", "address": {"city": "New York"}, "active": true}
]`,
  'csv-to-markdown-table': `name,role,notes
Ada,Engineer,"Likes | pipes"
Grace,Admiral,"Multi
line, with comma"`,
  'markdown-table-to-excel': `## Prices

| Product | SKU | Price (USD) | Notes |
|:--------|-----|------------:|-------|
| **Pen** | \`P-01\` | 1.20 | blue, 0.5 mm |
| Notebook | N-77 | 4.50 | [specs](https://example.com/n77) |
| Stapler | S-9 | =12 | jams \\| sometimes<br>see FAQ |
`,
  'excel-to-json': 'id\tname\taddress.city\tprice\tin_stock\tsku\n1\tPen\tLondon\t1.20\tTRUE\t00731\n2\tNotebook, A5\tParis\t4.5\tFALSE\t\n',
  'robots-txt-tester': `# Example: crawl everything except admin and search, keep one public admin page
User-agent: *
Disallow: /admin/
Allow: /admin/help
Disallow: /*?q=
Disallow: /*.pdf$

User-agent: GPTBot
Disallow: /

Sitemap: https://example.com/sitemap.xml
`,
  'hreflang-checker': `<link rel="alternate" hreflang="en-us" href="https://example.com/us/">
<link rel="alternate" hreflang="en-uk" href="https://example.com/uk/">
<link rel="alternate" hreflang="de" href="/de/">
<link rel="alternate" hreflang="x-default" href="https://example.com/">`,
  'csv-to-sql': `id,name,zip,price,in_stock,notes
1,O'Brien Pens,02134,1.20,yes,"blue, 0.5 mm"
2,Notebook A5,,4.5,no,
3,"Stapler ""Pro"" XL",10001,12,yes,jams sometimes
`,
  'xml-to-csv': `<?xml version="1.0" encoding="UTF-8"?>
<catalog>
  <book id="b1" lang="en">
    <title>XML Basics</title>
    <author>Ada Lovelace</author>
    <author>Grace Hopper</author>
    <price currency="USD">29.99</price>
    <publisher><name>Acme</name><city>London</city></publisher>
  </book>
  <book id="b2">
    <title>Data, "Quoted" &amp; Escaped</title>
    <author>Alan Turing</author>
    <price currency="EUR">15</price>
  </book>
</catalog>`,
  'compare-two-lists': 'apple\nBanana\ncherry\napple\ndate',
  'jwt-decoder': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  'transpose-csv': 'metric,Jan,Feb,Mar\nVisitors,1200,1350,1610\nSignups,48,52,"1,070"\n',
  'split-csv-file': 'region,name,sales\nNorth,Ada,120\nSouth,Grace,95\nNorth,Alan,80\nEast,Edsger,60\nSouth,Barbara,70\n',
  'merge-csv-files': 'id,name,price\n1,Pen,1.20\n2,Pad,4.50\n---\nname,id,stock\nInk,3,12\n',
  'html-table-to-csv': `<table>
  <thead><tr><th>Country</th><th>Capital</th><th>Population</th></tr></thead>
  <tbody>
    <tr><td>France</td><td>Paris</td><td>68,000,000</td></tr>
    <tr><td rowspan="2">Multi, "quoted"</td><td>A</td><td>=1+1</td></tr>
    <tr><td colspan="2">Merged | cell</td></tr>
  </tbody>
</table>`,
  'html-to-markdown': `<h1>Release notes</h1>
<p>This is <strong>bold</strong>, <em>italic</em> and <a href="/docs">a relative link</a>.</p>
<ul><li>First item</li><li>Second item<ul><li>Nested</li></ul></li></ul>
<ol><li>One</li><li>Two</li></ol>
<pre><code class="language-js">const x = 1;</code></pre>
<p>Inline <code>npm test</code>.</p>
<table><tr><th>Key</th><th>Value</th></tr><tr><td>a</td><td>1</td></tr></table>
<blockquote><p>Quoted text</p></blockquote>`,
  'extract-links': `<nav><a href="/">Home</a> <a href="/about">About</a> <a href="/about#team">Team</a></nav>
<p>Read the <a href="https://example.org/report.pdf" rel="nofollow" target="_blank">annual report</a>
or <a href="javascript:void(0)">this</a> and <a href="mailto:hi@example.com">email us</a>.</p>`,
  'http-headers': `GET /api/items?page=2 HTTP/1.1
Host: api.example.com
Accept: application/json
Authorization: Bearer abc123
Accept-Language: en-GB
Accept-Language: en;q=0.8
Cookie: session=xyz
X-Request-Id: it's-42`,
  'color-palette-to-css': `brand: #0e7c66
--accent: #F5A623
#333, #ffffff
rgb(18, 52, 86)`,
};
$('sample').addEventListener('click', () => { $('in').value = SAMPLES[tool]; run(); });

let run;
if (tool === 'html-table-to-csv') {
  let tables = [];
  const render = () => {
    const rows = tables[+$('table').value] || [];
    const f = $('fmt').value;
    $('out').value = !rows.length ? '' : f === 'tsv' ? toTSV(rows) : f === 'md' ? toMarkdown(rows) : noBOM(toCSV(rows));
  };
  run = () => {
    tables = extractTables($('in').value);
    $('table').replaceChildren(...tables.map((r, i) => new Option(`Table ${i + 1} (${r.length}×${r[0]?.length || 0})`, i)));
    if (!tables.length) { $('out').value = ''; return status('No <table> found in the pasted HTML.', true); }
    status(`Found ${tables.length} table${tables.length > 1 ? 's' : ''}.`); render();
  };
  $('table').addEventListener('change', render); $('fmt').addEventListener('change', render);
  $('dl').addEventListener('click', () => {
    const rows = tables[+$('table').value]; if (!rows) return;
    const f = $('fmt').value;
    if (f === 'csv') download(toCSV(rows), 'table.csv', 'text/csv');
    else download($('out').value, f === 'md' ? 'table.md' : 'table.tsv', 'text/plain');
  });
  $('xlsx').addEventListener('click', () => { const rows = tables[+$('table').value]; if (rows) download(toXLSX(rows), 'table.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
} else if (tool === 'markdown-table-to-excel') {
  let tables = [];
  const cur = () => tables[+$('table').value] || [];
  const render = () => { const rows = cur(); $('out').value = !rows.length ? '' : $('fmt').value === 'csv' ? noBOM(toCSV(rows)) : toTSV(rows); };
  run = () => {
    const sel = +$('table').value || 0;
    tables = markdownTablesToRows($('in').value, { keep: $('cells').value === 'keep' });
    $('table').replaceChildren(...tables.map((r, i) => new Option(`Table ${i + 1} (${r.length}×${r[0]?.length || 0})`, i)));
    if (!tables.length) { $('out').value = ''; return status('No Markdown table found. A table needs a header row and a --- row below it, with | between cells.', true); }
    if (sel < tables.length) $('table').value = sel;
    status(`Found ${tables.length} table${tables.length > 1 ? 's' : ''}.`); render();
  };
  $('table').addEventListener('change', render); $('fmt').addEventListener('change', render); $('cells').addEventListener('change', run);
  $('in').addEventListener('input', run);
  $('dl').addEventListener('click', () => {
    const rows = cur(); if (!rows.length) return;
    if ($('fmt').value === 'csv') download(toCSV(rows), 'table.csv', 'text/csv'); else download($('out').value, 'table.tsv', 'text/tab-separated-values');
  });
  $('xlsx').addEventListener('click', () => { const rows = cur(); if (rows.length) download(toXLSX(rows), 'table.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
} else if (tool === 'excel-to-json') {
  run = () => {
    const d = $('delim').value, rows = parseCSV($('in').value, d === 'auto' ? '' : d === 'tab' ? '\t' : d);
    if (!rows.length) { $('out').value = ''; return status('Paste some cells first (include the header row).', true); }
    $('out').value = rowsToJson(rows, { types: $('types').checked, nest: $('nest').checked, shape: $('shape').value });
    const n = rows.slice(1).filter(r => r.some(c => c.trim())).length;
    status(`${n} row${n === 1 ? '' : 's'} × ${rows[0].length} column${rows[0].length === 1 ? '' : 's'} (first row = keys).`);
  };
  for (const id of ['delim', 'shape', 'types', 'nest']) $(id).addEventListener('change', run);
  $('in').addEventListener('input', run);
  $('dl').addEventListener('click', () => { if ($('out').value) download($('out').value, 'data.json', 'application/json'); });
} else if (tool === 'robots-txt-tester') {
  const SAMPLE_URLS = '/\n/admin/settings\n/admin/help\n/search?q=shoes\n/files/report.pdf\n/files/report.pdf?v=2';
  let tsv = '';
  run = () => {
    const robots = parseRobots($('in').value), agent = $('agent').value.trim() || '*';
    const urls = $('urls').value.split('\n').map(u => u.trim()).filter(Boolean);
    const g = robotsGroupFor(robots, agent);
    const head = [`User agent: ${agent} → ${g.agent ? (g.agent === '*' ? 'no specific group, using User-agent: *' : `group User-agent: ${g.agent}`) + ` (line ${g.lines.join(', ')}), ${g.rules.length} rule${g.rules.length === 1 ? '' : 's'}` : 'no matching group: everything allowed'}`];
    if (robots.sitemaps.length) head.push(`Sitemaps: ${robots.sitemaps.join(', ')}`);
    head.push(...robots.warnings);
    const rows = urls.map(u => {
      const r = checkRobots(robots, agent, u);
      if (r.error) return ['ERROR', u, r.error];
      return [r.allowed ? 'ALLOWED' : 'BLOCKED', u, r.rule ? `${r.rule.allow ? 'Allow' : 'Disallow'}: ${r.rule.path} (line ${r.rule.line})` : r.why];
    });
    tsv = ['result\turl\trule', ...rows.map(r => r.join('\t'))].join('\n');
    $('out').value = head.join('\n') + (rows.length ? '\n\n' + rows.map(r => `${r[0].padEnd(8)} ${r[1]}  ← ${r[2]}`).join('\n') : '');
    const blocked = rows.filter(r => r[0] === 'BLOCKED').length;
    if (!$('in').value.trim()) return status('Paste a robots.txt first (an empty robots.txt allows everything).', true);
    status(urls.length ? `${blocked} of ${urls.length} URL${urls.length === 1 ? '' : 's'} blocked for ${agent}.` : 'Add URLs or paths to test.');
  };
  $('sample').addEventListener('click', () => { if (!$('urls').value.trim()) $('urls').value = SAMPLE_URLS; run(); });
  for (const id of ['in', 'urls', 'agent']) $(id).addEventListener('input', run);
  $('dl').addEventListener('click', () => { if (tsv) download(tsv, 'robots-test.tsv', 'text/tab-separated-values'); });
} else if (tool === 'hreflang-checker') {
  let rows = [];
  run = () => {
    const entries = parseHreflang($('in').value);
    rows = entries.map(e => [e.hreflang, e.href]);
    $('out').value = rows.map(r => `${r[0].padEnd(12)} ${r[1]}`).join('\n');
    const res = checkHreflang(entries, $('page').value.trim());
    $('checks').replaceChildren(...res.map(([s, k, m]) => {
      const li = document.createElement('li'); li.className = s;
      const b = document.createElement('b'); b.textContent = `${s === 'pass' ? '✓' : s === 'warn' ? '!' : '✗'} ${k}`;
      li.append(b, ' ' + m); return li;
    }));
    if (!entries.length) return status('No <link rel="alternate" hreflang="…"> tags found.', true);
    const f = res.filter(r => r[0] === 'fail').length;
    status(`${entries.length} hreflang entr${entries.length === 1 ? 'y' : 'ies'}: ${f ? f + ' error' + (f > 1 ? 's' : '') : 'no errors'}.`, f > 0);
  };
  $('sample').addEventListener('click', () => { $('page').value = 'https://example.com/us/'; run(); });
  for (const id of ['in', 'page']) $(id).addEventListener('input', run);
  $('dl').addEventListener('click', () => { if (rows.length) download(['hreflang\thref', ...rows.map(r => r.join('\t'))].join('\n'), 'hreflang.tsv', 'text/tab-separated-values'); });
} else if (tool === 'csv-to-sql') {
  run = () => {
    const rows = parseCSV($('in').value);
    if (!rows.length) { $('out').value = ''; return status('Paste some CSV first (include the header row).', true); }
    const table = $('table').value.trim() || 'my_table', batch = Math.max(1, Math.min(10000, +$('batch').value || 500));
    $('out').value = rowsToSql(rows, { table, dialect: $('dialect').value, create: $('create').checked, batch });
    const n = rows.slice(1).filter(r => r.some(c => c.trim())).length, k = Math.ceil(n / batch);
    status(`${n} row${n === 1 ? '' : 's'} × ${rows[0].length} column${rows[0].length === 1 ? '' : 's'} → ${k} INSERT statement${k === 1 ? '' : 's'}.`);
  };
  for (const id of ['dialect', 'create']) $(id).addEventListener('change', run);
  for (const id of ['in', 'table', 'batch']) $(id).addEventListener('input', run);
  $('dl').addEventListener('click', () => { if ($('out').value) download($('out').value, ($('table').value.trim() || 'my_table') + '.sql', 'application/sql'); });
} else if (tool === 'xml-to-csv') {
  let rows = [];
  const render = () => { const f = $('fmt').value; $('out').value = rows.length < 2 ? '' : f === 'tsv' ? toTSV(rows) : f === 'md' ? toMarkdown(rows) : noBOM(toCSV(rows)); };
  const convert = (record = '') => {
    const r = xmlToRows($('in').value, record);
    $('record').replaceChildren(...(r.candidates || []).map(c => new Option(`<${c.name}> (${c.count})`, c.name)));
    if (r.error) { rows = []; $('out').value = ''; return status(r.error, true); }
    $('record').value = r.record; rows = r.rows;
    status(`${rows.length - 1} <${r.record}> rows × ${rows[0].length} columns.`); render();
  };
  run = () => convert();
  $('record').addEventListener('change', () => convert($('record').value)); $('fmt').addEventListener('change', render);
  $('dl').addEventListener('click', () => {
    if (rows.length < 2) return; const f = $('fmt').value;
    if (f === 'csv') download(toCSV(rows), 'data.csv', 'text/csv'); else download($('out').value, f === 'md' ? 'data.md' : 'data.tsv', 'text/plain');
  });
  $('xlsx').addEventListener('click', () => { if (rows.length > 1) download(toXLSX(rows), 'data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
} else if (tool === 'compare-two-lists') {
  run = () => {
    const r = compareLists($('in').value, $('b').value, { ignoreCase: $('icase').checked, trim: $('trim').checked });
    $('out').value = r[$('show').value].join('\n');
    status(`A: ${r.countA} distinct · B: ${r.countB} distinct · only in A: ${r.onlyA.length} · only in B: ${r.onlyB.length} · in both: ${r.both.length}`);
  };
  $('sample').addEventListener('click', () => { $('b').value = 'banana\nCherry \nelderberry\nfig'; run(); });
  for (const id of ['show', 'icase', 'trim']) $(id).addEventListener('change', run);
  for (const id of ['in', 'b']) $(id).addEventListener('input', run);
  $('dl').addEventListener('click', () => { if ($('out').value) download($('out').value, $('show').value + '.txt', 'text/plain'); });
} else if (tool === 'jwt-decoder') {
  run = () => {
    if (!$('in').value.trim()) { $('out').value = ''; return status('Paste a JWT first.', true); }
    try {
      const d = decodeJwt($('in').value);
      const t = Object.entries(d.times).map(([k, v]) => `// ${k}: ${v}`).join('\n');
      $('out').value = `// header\n${JSON.stringify(d.header, null, 2)}\n\n// payload\n${JSON.stringify(d.payload, null, 2)}\n${t ? '\n' + t + '\n' : ''}`;
      status([...d.notes, d.signed ? 'Signature present but NOT verified.' : 'No signature.'].join(' '));
    } catch (e) { $('out').value = ''; status(e.message, true); }
  };
  $('in').addEventListener('input', run);
  $('dl').addEventListener('click', () => { if ($('out').value) download($('out').value, 'jwt.txt', 'text/plain'); });
} else if (tool === 'transpose-csv') {
  let rows = [];
  run = () => {
    if (!$('in').value.trim()) { rows = []; $('out').value = ''; return status('Paste a CSV or choose a file first.', true); }
    const src = parseCSV($('in').value); rows = transposeRows(src);
    $('out').value = $('fmt').value === 'tsv' ? toTSV(rows) : noBOM(toCSV(rows));
    status(`${src.length} rows × ${Math.max(0, ...src.map(r => r.length))} columns → ${rows.length} rows × ${rows[0]?.length || 0} columns.`);
  };
  $('file').addEventListener('change', async () => { const f = $('file').files[0]; if (f) { $('in').value = noBOM(await f.text()); run(); } });
  $('fmt').addEventListener('change', run); $('in').addEventListener('input', run);
  $('dl').addEventListener('click', () => { if (rows.length) download(toCSV(rows), 'transposed.csv', 'text/csv'); });
  $('xlsx').addEventListener('click', () => { if (rows.length) download(toXLSX(rows), 'transposed.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
} else if (tool === 'split-csv-file') {
  let parts = [], fname = 'data';
  const fillCols = () => { const h = parseCSV($('in').value.split(/\r?\n/)[0] || '')[0] || []; const cur = $('by').value;
    $('by').innerHTML = h.map((c, i) => `<option value="${i}">${c.replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[m]) || 'column ' + (i + 1)}</option>`).join('');
    if (cur && +cur < h.length) $('by').value = cur; };
  run = () => {
    fillCols();
    const byCol = $('mode').value === 'column';
    $('size').disabled = byCol; $('by').disabled = !byCol;
    if (!$('in').value.trim()) { parts = []; $('out').value = ''; return status('Paste a CSV or choose a file first.', true); }
    parts = splitCsv($('in').value, byCol ? { by: +$('by').value } : { size: +$('size').value });
    if (!parts.length) { $('out').value = ''; return status('Need a header row and at least one data row.', true); }
    $('out').value = parts.map(p => `${p.name}: ${p.rows.length - 1} rows`).join('\n');
    status(`${parts.reduce((s, p) => s + p.rows.length - 1, 0)} rows → ${parts.length} file${parts.length === 1 ? '' : 's'}, each with the header row.`);
  };
  $('file').addEventListener('change', async () => { const f = $('file').files[0]; if (!f) return; fname = f.name.replace(/\.[^.]+$/, '') || 'data'; $('in').value = noBOM(await f.text()); run(); });
  for (const id of ['mode', 'size', 'by']) $(id).addEventListener('change', run);
  $('in').addEventListener('input', run);
  $('dl').addEventListener('click', () => { if (parts.length) download(zip(parts.map(p => [p.name, toCSV(p.rows)])), fname + '-split.zip', 'application/zip'); });
} else if (tool === 'merge-csv-files') {
  let files = [], rows = [];
  run = () => {
    const pasted = $('in').value.trim() ? $('in').value.split(/^---\s*$/m).map((t, i) => ({ name: `pasted-${i + 1}`, text: t.replace(/^\n+/, '') })).filter(f => f.text.trim()) : [];
    const all = [...files, ...pasted];
    if (!all.length) { rows = []; $('out').value = ''; return status('Choose CSV files or paste CSVs first.', true); }
    rows = mergeCsvs(all, { source: $('source').checked });
    $('out').value = noBOM(toCSV(rows));
    status(`${all.length} file${all.length === 1 ? '' : 's'} → ${rows.length - 1} rows × ${rows[0].length} columns.`);
  };
  $('files').addEventListener('change', async () => { files = await Promise.all([...$('files').files].map(async f => ({ name: f.name, text: await f.text() }))); run(); });
  $('source').addEventListener('change', run); $('in').addEventListener('input', run);
  $('dl').addEventListener('click', () => { if (rows.length > 1) download(toCSV(rows), 'merged.csv', 'text/csv'); });
  $('xlsx').addEventListener('click', () => { if (rows.length > 1) download(toXLSX(rows), 'merged.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
} else if (tool === 'dns-lookup') {
  const DOH = 'https://cloudflare-dns.com/dns-query';
  const NUM = { 1: 'A', 28: 'AAAA', 5: 'CNAME', 15: 'MX', 2: 'NS', 16: 'TXT', 257: 'CAA', 6: 'SOA' };
  const query = async (name, type) => {
    const r = await fetch(`${DOH}?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } });
    if (!r.ok) throw new Error(`resolver returned HTTP ${r.status}`);
    const j = await r.json();
    // Answer also carries the CNAME chain for other types: keep only rows of the asked type.
    return { status: j.Status, data: (j.Answer || []).filter(a => NUM[a.type] === type).map(a => type === 'TXT' ? txtValue(a.data) : a.data) };
  };
  let seq = 0;
  run = async () => {
    const d = parseDomainInput($('in').value), my = ++seq;
    $('checks').replaceChildren();
    if (d.error) { $('out').value = ''; return status(d.error, true); }
    status(`Looking up ${d.domain}…`); $('run').disabled = true;
    try {
      const res = await Promise.all([...DNS_TYPES.map(t => query(d.domain, t)), query('_dmarc.' + d.domain, 'TXT')]);
      if (my !== seq) return;
      const recs = Object.fromEntries(DNS_TYPES.map((t, i) => [t, res[i].data])), dmarc = res[DNS_TYPES.length].data;
      if (res[0].status === 3) { $('out').value = ''; return status(`${d.domain} does not exist (NXDOMAIN): no DNS records, email to it will bounce.`, true); }
      const checks = emailChecks(recs, dmarc);
      $('checks').replaceChildren(...checks.map(([s, k, m]) => {
        const li = document.createElement('li'); li.className = s;
        const b = document.createElement('b'); b.textContent = `${s === 'pass' ? '✓' : s === 'warn' ? '!' : '✗'} ${k}`;
        li.append(b, ' ' + m); return li;
      }));
      $('out').value = formatDnsReport(d.domain, recs, dmarc, checks);
      const n = Object.values(recs).reduce((a, v) => a + v.length, 0) + dmarc.length;
      status(`${n} record${n === 1 ? '' : 's'} for ${d.domain}${d.fromEmail ? ' (domain of the email address)' : ''}.`);
    } catch (e) { if (my === seq) { $('out').value = ''; status('Lookup failed: ' + e.message, true); } }
    finally { if (my === seq) $('run').disabled = false; }
  };
  $('in').addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
} else if (tool === 'security-headers') {
  run = () => {
    let h;
    try { h = buildSecurityHeaders($('in').value, { reportOnly: $('ro').checked, hsts: $('hsts').checked, preload: $('preload').checked,
      frame: $('frame').value, referrer: $('ref').value, perms: $('perms').checked }); }
    catch (e) { $('out').value = ''; return status(e.message, true); }
    $('out').value = formatServerHeaders(h, $('fmt').value); status(`${h.length} headers.`);
  };
  for (const id of ['ro', 'hsts', 'preload', 'frame', 'ref', 'perms', 'fmt']) $(id).addEventListener('change', run);
  $('in').addEventListener('input', run); run();
} else if (tool === 'curl-converter') {
  let req = null;
  const render = () => { $('out').value = req ? curlToCode(req, $('fmt').value) : ''; };
  run = () => {
    try { req = parseCurl($('in').value.trim()); } catch (e) { req = null; $('out').value = ''; return status('Could not parse: ' + e.message, true); }
    status(`${req.method} ${req.url} · ${req.headers.length} header${req.headers.length === 1 ? '' : 's'}${req.data !== null ? ' · body' : ''}`); render();
  };
  $('fmt').addEventListener('change', render);
} else if (tool === 'json-to-csv' || tool === 'json-to-markdown-table') {
  let rows = [];
  const render = () => { const f = $('fmt').value; $('out').value = !rows.length ? '' : f === 'tsv' ? toTSV(rows) : f === 'md' ? toMarkdown(rows) : noBOM(toCSV(rows)); };
  run = () => {
    try { rows = jsonToRows($('in').value); } catch (e) { rows = []; $('out').value = ''; return status('Invalid JSON: ' + e.message, true); }
    status(`${rows.length - 1} row${rows.length === 2 ? '' : 's'} × ${rows[0].length} columns.`); render();
  };
  $('fmt').addEventListener('change', render);
  $('dl').addEventListener('click', () => { if (rows.length) download(toCSV(rows), 'data.csv', 'text/csv'); });
  $('xlsx').addEventListener('click', () => { if (rows.length) download(toXLSX(rows), 'data.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); });
} else if (tool === 'csv-to-markdown-table' || tool === 'excel-to-markdown-table') {
  let rows = [];
  const render = () => { $('out').value = !rows.length ? '' : $('fmt').value === 'html' ? rowsToHTML(rows) : toMarkdown(rows); };
  run = () => {
    rows = parseCSV($('in').value, $('delim').value === 'auto' ? '' : $('delim').value === 'tab' ? '\t' : $('delim').value);
    if (!rows.length) { $('out').value = ''; return status('Paste some CSV first.', true); }
    status(`${rows.length - 1} data row${rows.length === 2 ? '' : 's'} × ${rows[0].length} columns (first row = header).`); render();
  };
  $('fmt').addEventListener('change', render);
  $('dl').addEventListener('click', () => { if ($('out').value) download($('out').value, $('fmt').value === 'html' ? 'table.html' : 'table.md', 'text/plain'); });
} else if (tool === 'html-to-markdown') {
  run = () => {
    const html = $('in').value;
    if (!html.trim()) { $('out').value = ''; return status('Paste some HTML first.', true); }
    $('out').value = htmlToMarkdown(html, $('base').value.trim()); status(`Converted ${html.length.toLocaleString()} characters of HTML.`);
  };
  $('dl').addEventListener('click', () => download($('out').value, 'page.md', 'text/markdown'));
} else if (tool === 'extract-links') {
  run = () => {
    const all = dedupe(extractLinks($('in').value, $('base').value.trim()), { ignoreHash: $('hash').checked });
    const { links, error } = filterLinks(all, { scope: $('scope').value, query: $('q').value });
    if (error) return status(error, true);
    const f = $('fmt').value;
    $('out').value = f === 'csv' ? noBOM(toCSV(toRows(links))) : f === 'md' ? links.map(l => `- [${(l.text || l.url).replace(/[[\]]/g, '\\$&')}](${l.url})`).join('\n') : links.map(l => l.url).join('\n');
    status(`${links.length} link${links.length === 1 ? '' : 's'} shown (${all.length} unique).`);
  };
  for (const id of ['hash', 'scope', 'fmt']) $(id).addEventListener('change', run);
  $('q').addEventListener('input', run);
  $('dl').addEventListener('click', () => { const csv = $('fmt').value === 'csv'; download(csv ? '\ufeff' + $('out').value : $('out').value, csv ? 'links.csv' : 'links.txt', csv ? 'text/csv' : 'text/plain'); });
} else if (tool === 'http-headers') {
  run = () => {
    let r; try { r = parseHeaders($('in').value); } catch (e) { return status('Could not parse JSON: ' + e.message, true); }
    if (!r.pairs.length) { $('out').value = ''; return status('No headers found. Use one "Name: value" per line.', true); }
    $('out').value = formatHeaders(r.pairs, $('fmt').value, { lower: $('lower').checked });
    status(`${r.pairs.length} header${r.pairs.length > 1 ? 's' : ''} parsed${r.skipped.length ? `, ${r.skipped.length} line(s) skipped (request/status line or pseudo-headers)` : ''}.`);
  };
  for (const id of ['fmt', 'lower']) $(id).addEventListener('change', run);
} else if (tool === 'color-palette-to-css') {
  run = () => {
    const colors = parsePalette($('in').value, $('prefix').value);
    $('swatches').replaceChildren(...colors.map(c => { const s = document.createElement('span'); s.style.background = c.hex; s.title = c.name; const b = document.createElement('b'); b.textContent = c.hex; s.append(b); return s; }));
    if (!colors.length) { $('out').value = ''; return status('No colors found. Use #hex or rgb() values.', true); }
    $('out').value = formatPalette(colors, $('fmt').value); status(`${colors.length} color${colors.length > 1 ? 's' : ''}.`);
  };
  $('fmt').addEventListener('change', run); $('prefix').addEventListener('input', run);
} else if (tool === 'markdown-to-html') {
  const PREVIEW = '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">' +
    '<style>body{font:16px/1.55 system-ui,sans-serif;margin:1rem;color:#1d1f21;background:#fff}pre{background:#f1f3f4;padding:.6rem;overflow:auto}code{background:#f1f3f4;padding:0 .2em}' +
    'table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:.25rem .6rem}blockquote{border-left:3px solid #ccc;margin-left:0;padding-left:1rem;color:#555}img{max-width:100%}</style>';
  run = () => {
    const md = $('in').value, html = markdownToHtml(md, { allowHtml: $('raw').checked });
    $('out').value = $('doc').checked && html ? htmlDocument(html) : html;
    $('render').srcdoc = PREVIEW + html;
    if (!md.trim()) return status('Paste some Markdown first.', true);
    status(`Converted ${md.length.toLocaleString()} characters of Markdown${$('raw').checked ? ' (raw HTML allowed)' : ''}.`);
  };
  for (const id of ['raw', 'doc']) $(id).addEventListener('change', run);
  $('in').addEventListener('input', run);
  $('dl').addEventListener('click', () => { if ($('out').value) download($('out').value, 'document.html', 'text/html'); });
} else if (tool === 'utm-builder') {
  const fields = UTM_KEYS;
  const issues = (errs, warns) => $('issues').replaceChildren(...[...errs.map(t => [t, 'err']), ...warns.map(t => [t, ''])].map(([t, c]) => { const li = document.createElement('li'); li.textContent = t; if (c) li.className = c; return li; }));
  let bulk = false;
  run = () => {
    const params = Object.fromEntries(fields.map(k => [k, $(k).value])), opts = { lowercase: $('lower').checked };
    const lines = $('in').value.split(/\r?\n/).filter(l => l.trim()); bulk = lines.length > 1;
    const { errors, warnings } = utmIssues(params, opts);
    if (!lines.length) { $('out').value = ''; issues([], []); return status('Enter a URL to tag.', true); }
    if (errors.length) { $('out').value = ''; issues(errors, warnings); return status('Fill in utm_source.', true); }
    if (!bulk) {
      const r = tagUrl(lines[0], params, opts);
      if (r.error) { $('out').value = ''; issues([`${r.error}: ${lines[0].trim()}`], warnings); return status('Could not tag this URL.', true); }
      $('out').value = r.url; issues([], [...(r.fixed ? ['No scheme given — https:// was added.'] : []), ...warnings]);
      return status(`Tagged link ready${r.replaced ? ` (${r.replaced} existing utm_ parameter${r.replaced > 1 ? 's' : ''} replaced)` : ''}.`);
    }
    const { rows, errors: bad } = tagUrls($('in').value, params, opts);
    $('out').value = !rows.length ? '' : $('fmt').value === 'csv' ? noBOM(toCSV([['url', 'tagged_url'], ...rows])) : rows.map(r => r[1]).join('\n');
    issues(bad.slice(0, 20).map(e => `Line ${e.line}: ${e.error} — ${e.input}`).concat(bad.length > 20 ? [`…and ${bad.length - 20} more invalid lines`] : []), warnings);
    status(`${rows.length} link${rows.length === 1 ? '' : 's'} tagged${bad.length ? `, ${bad.length} line${bad.length > 1 ? 's' : ''} skipped` : ''}.`, !rows.length);
  };
  for (const id of ['in', ...fields]) $(id).addEventListener('input', run);
  for (const id of ['lower', 'fmt']) $(id).addEventListener('change', run);
  $('sample').addEventListener('click', () => { $('source').value = 'newsletter'; $('medium').value = 'email'; $('campaign').value = 'fall_sale'; run(); });
  $('dl').addEventListener('click', () => {
    if (!$('out').value) return;
    const csv = bulk && $('fmt').value === 'csv';
    download(csv ? '﻿' + $('out').value : $('out').value, csv ? 'utm-links.csv' : 'utm-links.txt', csv ? 'text/csv' : 'text/plain');
  });
} else if (tool === 'url-parser') {
  const el = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
  const copyBtn = v => { const b = el('button', 'Copy', 'ghost'); b.type = 'button'; b.dataset.copy = v; return b; };
  const row = (cells, copy) => { const tr = el('tr'); cells.forEach((c, k) => { const td = el(k === 0 && cells.length === 2 ? 'th' : 'td'); if (c instanceof Node) td.append(c); else td.textContent = c; tr.append(td); }); const td = el('td'); if (copy !== null) td.append(copyBtn(copy)); tr.append(td); return tr; };
  const issues = (errs, warns = []) => $('issues').replaceChildren(...errs.map(t => el('li', t, 'err')), ...warns.map(t => el('li', t)));
  const clear = () => { $('parts').hidden = true; $('partsbody').replaceChildren(); $('params').replaceChildren(); };
  run = () => {
    const mode = $('mode').value, enc = $('enc').value, text = $('in').value;
    $('enc').disabled = mode === 'parse';
    $('outlabel').textContent = mode === 'parse' ? 'Query parameters as JSON' : mode === 'encode' ? 'Encoded' : 'Decoded';
    if (mode !== 'parse') {
      clear(); issues([]);
      if (!text) { $('out').value = ''; return status('Enter text to ' + mode + '.', true); }
      try { $('out').value = mode === 'encode' ? encodeText(text, enc) : decodeText(text, enc); }
      catch (e) { $('out').value = ''; return status(e.message, true); }
      return status(`${mode === 'encode' ? 'Encoded' : 'Decoded'} with ${$('enc').selectedOptions[0].textContent}.`);
    }
    const r = parseUrl(text.split(/\r?\n/).find(l => l.trim()) || '');
    if (r.error) { clear(); issues([]); $('out').value = ''; return status(r.error, true); }
    const parts = [['Full URL (normalized)', r.href], ['Protocol', r.protocol], ['Username', r.username], ['Password', r.password],
      ['Host', r.host], ...(r.hostUnicode !== r.host ? [['Host (Unicode)', r.hostUnicode]] : []), ['Port', r.port || (r.defaultPort ? `(default ${r.defaultPort})` : '')],
      ['Origin', r.origin], ['Path', r.pathname], ...(r.path !== r.pathname ? [['Path (decoded)', r.path]] : []), ['Query string', r.query ? '?' + r.query : ''],
      ['Fragment', r.fragment ? '#' + r.fragment : ''], ...(r.fragmentDecoded !== r.fragment ? [['Fragment (decoded)', '#' + r.fragmentDecoded]] : [])]
      .filter(([k, v]) => v || ['Protocol', 'Host', 'Path'].includes(k));
    $('partsbody').replaceChildren(...parts.map(([k, v]) => row([k, v], v)));
    const counts = {}; for (const p of r.params) counts[p.key] = (counts[p.key] || 0) + 1;
    $('params').replaceChildren(...r.params.map((p, k) => { const tr = row([String(k + 1), p.key + (counts[p.key] > 1 ? ' (duplicate)' : ''), p.value, p.raw], p.value); if (p.error) tr.classList.add('err'); return tr; }));
    $('ptitle').textContent = `Query parameters (${r.params.length})`;
    $('parts').hidden = false;
    $('out').value = JSON.stringify(queryToJson(r.params), null, 2);
    const dups = Object.values(counts).filter(n => n > 1).length;
    issues(r.errors, [...(r.fixed ? ['No scheme given — https:// was assumed.'] : []), ...(r.host !== r.hostUnicode ? ['Internationalized host: browsers use the punycode (xn--) form.'] : [])]);
    status(`${r.params.length} query parameter${r.params.length === 1 ? '' : 's'}${dups ? ` · ${dups} repeated key${dups > 1 ? 's' : ''}` : ''}${r.fragment ? ' · has #fragment' : ''}.`, r.errors.length > 0);
  };
  $('parts').addEventListener('click', async e => {
    const b = e.target.closest('button[data-copy]'); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); status('Copied to clipboard.'); } catch { status('Copy failed — select the text instead.', true); }
  });
  for (const id of ['mode', 'enc']) $(id).addEventListener('change', run);
  $('in').addEventListener('input', run);
} else if (tool === 'sitemap-generator') {
  let res = null;
  const show = () => { const k = $('part').value; $('out').value = !res ? '' : k === 'index' ? res.index : res.parts[+k] || ''; };
  run = () => {
    try { res = buildSitemap($('in').value, { lastmod: $('lastmod').value, changefreq: $('freq').value, priority: $('prio').value }); }
    catch (e) { res = null; $('out').value = ''; $('issues').replaceChildren(); $('partrow').hidden = true; return status(e.message, true); }
    const items = [...res.invalid.slice(0, 20).map(x => [`Line ${x.line}: ${x.reason} — ${x.input}`, 'err']),
      ...(res.invalid.length > 20 ? [[`…and ${res.invalid.length - 20} more invalid lines`, 'err']] : []), ...res.warnings.map(w => [w, ''])];
    $('issues').replaceChildren(...items.map(([t, c]) => { const li = document.createElement('li'); li.textContent = t; if (c) li.className = c; return li; }));
    const multi = res.parts.length > 1; $('partrow').hidden = !multi;
    $('part').replaceChildren(...res.parts.map((_, k) => new Option(`sitemap-${k + 1}.xml`, k)), ...(multi ? [new Option('Sitemap index (sitemap.xml)', 'index')] : []));
    show();
    if (!res.count) return status('No valid URLs found. Paste absolute http(s) URLs, one per line.', true);
    const extra = [res.duplicates && `${res.duplicates} duplicate${res.duplicates > 1 ? 's' : ''} removed`, res.fragments && `${res.fragments} #fragment${res.fragments > 1 ? 's' : ''} dropped`,
      res.invalid.length && `${res.invalid.length} invalid line${res.invalid.length > 1 ? 's' : ''} skipped`].filter(Boolean);
    status(`${res.count.toLocaleString('en-US')} URL${res.count === 1 ? '' : 's'} in the sitemap${extra.length ? ' · ' + extra.join(' · ') : ''}.`);
  };
  $('part').addEventListener('change', show);
  $('today').addEventListener('click', () => { const d = new Date(); $('lastmod').value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; run(); });
  for (const id of ['freq', 'prio']) $(id).addEventListener('change', run);
  for (const id of ['in', 'lastmod']) $(id).addEventListener('input', run);
  $('dl').addEventListener('click', () => {
    if (!$('out').value) return;
    const k = $('part').value, name = res.parts.length > 1 ? (k === 'index' ? 'sitemap.xml' : `sitemap-${+k + 1}.xml`) : 'sitemap.xml';
    download($('out').value, name, 'application/xml');
  });
} else if (tool === 'markdown-table-formatter') {
  run = () => {
    const r = formatMarkdownTables($('in').value, { pad: $('mode').value === 'pad', align: $('align').value });
    $('out').value = r.text;
    if (!r.tables) return status('No table found. Use | between cells (or tabs), one row per line.', true);
    status(`Formatted ${r.tables} table${r.tables > 1 ? 's' : ''}.`);
  };
  for (const id of ['mode', 'align']) $(id).addEventListener('change', run);
  $('in').addEventListener('input', run);
  $('dl').addEventListener('click', () => { if ($('out').value) download($('out').value, 'table.md', 'text/markdown'); });
} else if (tool === 'color-contrast-checker') {
  let fg, bg;
  run = () => {
    fg = parseColor($('in').value); bg = parseColor($('bg').value);
    const bad = !fg ? 'text' : !bg ? 'background' : '';
    if (bad) { $('ratio').textContent = '–'; $('checks').replaceChildren(); $('out').value = ''; return status(`Unrecognised ${bad} color. Use #hex, rgb(), hsl() or a CSS color name.`, true); }
    const ratio = contrastRatio(fg, bg);
    $('ratio').textContent = formatRatio(ratio) + ':1';
    $('preview').style.color = toRgbString(fg); $('preview').style.background = toRgbString(bg);
    if (fg.a === 1) $('fgpick').value = toHex(fg); if (bg.a === 1) $('bgpick').value = toHex(bg);
    const checks = wcagChecks(ratio);
    $('checks').replaceChildren(...checks.map(c => { const li = document.createElement('li'); li.className = c.pass ? 'pass' : 'fail'; const b = document.createElement('b'); b.textContent = c.pass ? '✓ Pass' : '✗ Fail'; li.append(b, ` ${c.name} (${c.min}:1)`); return li; }));
    const fmt = c => `${toHex(c)} · ${toRgbString(c)} · ${toHslString(c)}`;
    $('out').value = `Text:       ${fmt(fg)}\nBackground: ${fmt(bg)}\nContrast:   ${formatRatio(ratio)}:1\n` + checks.map(c => `${c.pass ? 'PASS' : 'FAIL'}  ${c.name} (${c.min}:1)`).join('\n');
    status(fg.a < 1 || bg.a < 1 ? 'Semi-transparent color blended over the color beneath (background over white).' : '');
  };
  $('suggest').addEventListener('click', () => {
    run(); if (!fg || !bg) return;
    const t = +$('target').value, s = suggestForeground(fg, bg, t);
    if (contrastRatio(fg, bg) >= t) return status(`Already passes ${t}:1.`);
    if (!s) return status(`No lightness of this hue reaches ${t}:1 on this background — change the background instead.`, true);
    $('in').value = s.hex; run(); status(`Suggested ${s.hex}: ${formatRatio(s.ratio)}:1 (lightness changed by ${s.lightnessChange}%).`);
  });
  $('fgpick').addEventListener('input', () => { $('in').value = $('fgpick').value; run(); });
  $('bgpick').addEventListener('input', () => { $('bg').value = $('bgpick').value; run(); });
  $('swap').addEventListener('click', () => { [$('in').value, $('bg').value] = [$('bg').value, $('in').value]; run(); });
  for (const id of ['in', 'bg']) $(id).addEventListener('input', run);
  run();
}
$('run').addEventListener('click', run);
