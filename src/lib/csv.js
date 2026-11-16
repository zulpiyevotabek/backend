// CSV yaratish (Excel uchun UTF-8 BOM bilan). Formula inyeksiyasidan himoya: =, +, -, @ bilan
// boshlangan matn oldiga ' qo'yiladi.
const cell = (v) => {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(columns, rows) {
  const head = columns.join(',');
  const body = rows.map((r) => columns.map((c) => cell(r[c])).join(','));
  return '﻿' + [head, ...body].join('\r\n');
}

export function sendCsv(res, filename, columns, rows) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(toCsv(columns, rows));
}
