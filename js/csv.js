// Minimal RFC-4180-style CSV parser: quoted fields, escaped quotes, CR/LF.
(function (SV) {
  'use strict';

  SV.parseCSV = function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        row.push(field); field = '';
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    // drop fully-empty trailing rows
    return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
  };

  // rows -> array of objects keyed by the header row (headers trimmed)
  SV.csvToObjects = function (rows) {
    if (!rows.length) return { header: [], records: [] };
    const header = rows[0].map((h) => h.trim());
    const records = rows.slice(1).map((r) => {
      const o = {};
      header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
      return o;
    });
    return { header, records };
  };
})(window.SV);
