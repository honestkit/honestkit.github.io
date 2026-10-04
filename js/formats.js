// Pure converters: rows (string[][]) -> TSV / CSV / Markdown / XLSX bytes. Unit-tested in node.
export function toTSV(rows) { return rows.map(r => r.map(c => c.replace(/[\t\n\r]+/g, ' ')).join('\t')).join('\n'); }
export function toCSV(rows) {
  // Formula-injection guard: prefix ' to cells starting with = + - @, but not plain numbers (-3, +1.5e3, -12%): a number
  // can't carry a formula, and Excel would show the ' literally (corrupting every negative value).
  const risky = c => /^[=+\-@]/.test(c) && !/^[+-]?(\d[\d,]*(\.\d+)?|\.\d+)(e[+-]?\d+)?%?$/i.test(c);
  const q = c => /[",\n\r]/.test(c) || risky(c) ? '"' + (risky(c) ? "'" : '') + c.replace(/"/g, '""') + '"' : c;
  return '﻿' + rows.map(r => r.map(q).join(',')).join('\r\n');
}
export function toMarkdown(rows) {
  if (!rows.length) return '';
  const e = c => c.replace(/\|/g, '\\|').replace(/\n/g, '<br>');
  const [h, ...b] = rows;
  return ['| ' + h.map(e).join(' | ') + ' |', '|' + h.map(() => ' --- ').join('|') + '|', ...b.map(r => '| ' + r.map(e).join(' | ') + ' |')].join('\n');
}

// Minimal XLSX (store-only zip, inline strings; numbers stored as numbers).
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function zip(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let off = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name); const d = enc.encode(text); const crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    parts.push(new Uint8Array(h.buffer), n, d);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, n.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), n); off += 30 + n.length + d.length;
  }
  const csize = central.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)]; const out = new Uint8Array(all.reduce((s, x) => s + x.length, 0));
  let p = 0; for (const x of all) { out.set(x, p); p += x.length; } return out;
}
const xe = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = i => { let s = ''; for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
// "1,234.5", "$9", "-3", "12%", "(40)" -> numbers; ambiguous things ("1.234,5", "007", dates, "12-34") stay text.
export function parseNumber(c) {
  const m = /^\s*(\()?([-+])?\s*[$€£¥]?\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(%)?\s*(\))?\s*$/.exec(c);
  if (!m || (m[1] && !m[6]) || (!m[1] && m[6])) return null;
  if (/^0\d/.test(m[3])) return null; // leading zeros = identifiers (zip codes, ids)
  let v = Number(m[3].replace(/,/g, '') + (m[4] || ''));
  if (!Number.isFinite(v) || m[3].replace(/,/g, '').length > 15) return null;
  if (m[2] === '-' || m[1]) v = -v; if (m[5]) v /= 100;
  return v;
}
function sheetXML(rows) {
  const data = rows.map((r, i) => `<row r="${i + 1}">` + r.map((c, j) => {
    const ref = colName(j) + (i + 1); const n = parseNumber(c);
    return n !== null ? `<c r="${ref}"><v>${n}</v></c>` : c ? `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xe(c)}</t></is></c>` : '';
  }).join('') + '</row>').join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${data}</sheetData></worksheet>`;
}
const sheetName = (n, used) => {
  let base = (n || 'Table').replace(/[\\\/?*\[\]:]/g, ' ').trim().slice(0, 28) || 'Table'; let s = base; let k = 2;
  while (used.has(s.toLowerCase())) s = `${base.slice(0, 26)} ${k++}`;
  used.add(s.toLowerCase()); return s;
};
export function toXLSX(rows, sheet = 'Table') { return toXLSXBook([{ name: sheet, rows }]); }
// sheets: [{name, rows}] -> one workbook, one worksheet per table.
export function toXLSXBook(sheets) {
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'; const used = new Set();
  const names = sheets.map(s => sheetName(s.name, used));
  return zip([
    ['[Content_Types].xml', X + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>'],
    ['_rels/.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', X + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
      names.map((n, i) => `<sheet name="${xe(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', X + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') + '</Relationships>'],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXML(s.rows)]),
  ]);
}
