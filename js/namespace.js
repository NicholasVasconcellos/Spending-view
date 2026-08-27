// Global namespace + shared utilities. Plain scripts (no modules) so the app
// also works when index.html is opened directly from disk (file://).
window.SV = window.SV || {};

(function (SV) {
  'use strict';

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  SV.fmt = {
    usd: (n) => usd.format(n),
    usdWhole: (n) => usdWhole.format(n),
    // compact money for axis ticks / tiles: $1.2K, $34K, $1.1M
    usdCompact(n) {
      const abs = Math.abs(n);
      const sign = n < 0 ? '-' : '';
      if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
      if (abs >= 1e4) return `${sign}$${Math.round(abs / 1e3)}K`;
      if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
      return `${sign}$${abs.toFixed(0)}`;
    },
    int: (n) => new Intl.NumberFormat('en-US').format(n),
  };

  // --- date helpers (all on ISO 'YYYY-MM-DD' strings, UTC math) -------------
  const D = SV.date = {
    parseISO(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
    toISO(dt) {
      const p = (n) => String(n).padStart(2, '0');
      return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
    },
    addDays(isoStr, n) { const dt = D.parseISO(isoStr); return D.toISO(new Date(dt.getTime() + n * 86400000)); },
    daysBetween(a, b) { return Math.round((D.parseISO(b) - D.parseISO(a)) / 86400000); },
    today() { return D.toISO(new Date(Date.now())); },
    // Monday-based week start
    weekStart(isoStr) {
      const dt = D.parseISO(isoStr);
      const shift = (dt.getUTCDay() + 6) % 7;
      return D.toISO(new Date(dt.getTime() - shift * 86400000));
    },
    monthKey: (isoStr) => isoStr.slice(0, 7),
    yearKey: (isoStr) => isoStr.slice(0, 4),
    monthLabel(key) { // '2026-08' -> "Aug '26"
      const [y, m] = key.split('-');
      return `${D.MONTHS[+m - 1]} '${y.slice(2)}`;
    },
    weekLabel(key) { // '2026-08-24' -> "Aug 24 '26"
      const [y, m, d] = key.split('-');
      return `${D.MONTHS[+m - 1]} ${+d} '${y.slice(2)}`;
    },
    dayLabel(isoStr) {
      const [y, m, d] = isoStr.split('-');
      return `${D.MONTHS[+m - 1]} ${+d}, ${y}`;
    },
    MONTHS: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  };

  SV.el = function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null) continue;
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v);
    }
    if (children) for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return node;
  };

  SV.debounce = function (fn, ms) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  };

  // small non-crypto content hash, used to skip re-importing an identical file
  SV.hashString = function (s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(36) + '-' + s.length.toString(36);
  };
})(window.SV);
