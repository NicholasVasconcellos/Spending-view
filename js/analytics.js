// Aggregation + filtering. Pure functions over the canonical transaction
// model; no DOM access here.
(function (SV) {
  'use strict';
  const D = SV.date;

  // canonical transaction types, in display order
  SV.TYPES = ['Purchase', 'Credit', 'Installment', 'Debit', 'Interest', 'Fee', 'Balance Transfer', 'Payment', 'Other'];
  // types that count as "spending" by default (Payment / Balance Transfer are
  // money movement, not spend, so they start unchecked)
  SV.DEFAULT_SPEND_TYPES = ['Purchase', 'Credit', 'Installment', 'Debit', 'Interest', 'Fee', 'Other'];

  SV.BASE_CATEGORIES = ['Restaurants', 'Grocery', 'Shopping', 'Gas', 'Transportation', 'Entertainment', 'Hotels', 'Airlines', 'Car-rentals', 'Medical', 'Alcohol', 'Insurance', 'Tolls', 'Govt-services-parking', 'Fees & interest', 'Other', 'Uncategorized'];

  // effective category: user override > source column > keyword auto > fallback
  SV.effectiveCategory = function (t, settings) {
    const o = settings.categoryOverrides[t.merchantKey];
    if (o) return { category: o, from: 'override' };
    if (t.sourceCategory) return { category: t.sourceCategory, from: 'source' };
    if (t.autoCategory) return { category: t.autoCategory, from: 'auto' };
    return { category: 'Uncategorized', from: 'none' };
  };

  SV.categoriesInUse = function (transactions, settings) {
    const set = new Set();
    for (const t of transactions) set.add(SV.effectiveCategory(t, settings).category);
    for (const c of settings.customCategories) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  };

  SV.allCategoryChoices = function (transactions, settings) {
    const set = new Set(SV.BASE_CATEGORIES);
    for (const t of transactions) { if (t.sourceCategory) set.add(t.sourceCategory); }
    for (const c of settings.customCategories) set.add(c);
    return [...set].sort((a, b) => a.localeCompare(b));
  };

  SV.filterTransactions = function (transactions, filters, settings) {
    const excluded = filters.showExcluded ? null : new Set(settings.excluded);
    return transactions.filter((t) => {
      if (filters.from && t.date < filters.from) return false;
      if (filters.to && t.date > filters.to) return false;
      if (filters.types && !filters.types.has(t.type)) return false;
      if (excluded && excluded.has(t.merchantKey)) return false;
      if (filters.categories && !filters.categories.has(SV.effectiveCategory(t, settings).category)) return false;
      if (filters.cards && !filters.cards.has(t.card || '(none)')) return false;
      if (filters.sources && !filters.sources.has(t.source)) return false;
      if (filters.labels) {
        const tags = settings.labels[t.merchantKey] || [];
        if (!tags.some((tag) => filters.labels.has(tag))) return false;
      }
      if (filters.search) {
        const q = filters.search.toLowerCase();
        const hay = `${t.merchant} ${t.description} ${t.rawMerchant || ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  };

  function periodKeyOf(date, granularity) {
    if (granularity === 'week') return D.weekStart(date);
    if (granularity === 'year') return D.yearKey(date);
    return D.monthKey(date);
  }
  function nextPeriodKey(key, granularity) {
    if (granularity === 'week') return D.addDays(key, 7);
    if (granularity === 'year') return String(+key + 1);
    let [y, m] = key.split('-').map(Number);
    m++; if (m > 12) { m = 1; y++; }
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  function periodLabel(key, granularity) {
    if (granularity === 'week') return D.weekLabel(key);
    if (granularity === 'year') return key;
    return D.monthLabel(key);
  }

  // contiguous list of periods covering [min date, max date], zero-filled
  SV.aggregateByPeriod = function (transactions, granularity) {
    if (!transactions.length) return [];
    const totals = new Map();
    let min = transactions[0].date, max = transactions[0].date;
    for (const t of transactions) {
      if (t.date < min) min = t.date;
      if (t.date > max) max = t.date;
      const k = periodKeyOf(t.date, granularity);
      const cur = totals.get(k) || { total: 0, count: 0 };
      cur.total += t.amount; cur.count++;
      totals.set(k, cur);
    }
    const periods = [];
    let k = periodKeyOf(min, granularity);
    const last = periodKeyOf(max, granularity);
    let guard = 0;
    while (k <= last && guard++ < 4000) {
      const cur = totals.get(k) || { total: 0, count: 0 };
      periods.push({ key: k, label: periodLabel(k, granularity), total: cur.total, count: cur.count });
      if (k === last) break;
      k = nextPeriodKey(k, granularity);
    }
    return periods;
  };

  // trailing rolling mean over period totals (window includes current period);
  // undefined until a full window exists.
  SV.rollingAverage = function (periods, window) {
    return periods.map((p, i) => {
      if (i < window - 1) return { key: p.key, value: null };
      let s = 0;
      for (let j = i - window + 1; j <= i; j++) s += periods[j].total;
      return { key: p.key, value: s / window };
    });
  };

  // span-based averages: total divided by the calendar time covered, so
  // sparse data doesn't overstate the rate.
  SV.spanAverages = function (transactions) {
    if (!transactions.length) return null;
    let min = transactions[0].date, max = transactions[0].date, total = 0;
    for (const t of transactions) {
      if (t.date < min) min = t.date;
      if (t.date > max) max = t.date;
      total += t.amount;
    }
    const days = D.daysBetween(min, max) + 1;
    return {
      total, count: transactions.length, from: min, to: max, days,
      perDay: total / days,
      perWeek: total / (days / 7),
      perMonth: total / (days / 30.437),
      perYear: total / (days / 365.25),
    };
  };

  // per-calendar-year rows (partial years use the days actually covered)
  SV.yearlyBreakdown = function (transactions) {
    if (!transactions.length) return [];
    const byYear = new Map();
    for (const t of transactions) {
      const y = D.yearKey(t.date);
      const cur = byYear.get(y) || { total: 0, count: 0, min: t.date, max: t.date };
      cur.total += t.amount; cur.count++;
      if (t.date < cur.min) cur.min = t.date;
      if (t.date > cur.max) cur.max = t.date;
      byYear.set(y, cur);
    }
    return [...byYear.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([year, v]) => {
      const days = D.daysBetween(v.min, v.max) + 1;
      return {
        year, total: v.total, count: v.count, days,
        perMonth: v.total / (days / 30.437),
        perWeek: v.total / (days / 7),
      };
    });
  };

  // merchant aggregation (pass a set already filtered by date/type/etc. but
  // NOT by exclusion, so excluded merchants stay visible in the table)
  SV.merchantStats = function (transactions, settings) {
    const map = new Map();
    for (const t of transactions) {
      let m = map.get(t.merchantKey);
      if (!m) {
        m = { key: t.merchantKey, name: t.merchant, count: 0, total: 0, first: t.date, last: t.date, cards: new Set(), sources: new Set() };
        map.set(t.merchantKey, m);
      }
      m.count++; m.total += t.amount;
      if (t.date < m.first) m.first = t.date;
      if (t.date > m.last) m.last = t.date;
      if (t.card) m.cards.add(t.card);
      m.sources.add(t.source);
      // category = the merchant's most frequent effective category, so a lone
      // refund row (source category "Credit") can't mislabel the merchant
      const eff = SV.effectiveCategory(t, settings);
      m._cats = m._cats || new Map();
      const cur = m._cats.get(eff.category) || { n: 0, from: eff.from };
      cur.n++; m._cats.set(eff.category, cur);
    }
    const rows = [...map.values()];
    for (const m of rows) {
      m.avg = m.total / m.count;
      const best = [...m._cats.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      m.category = best[0]; m.categoryFrom = best[1].from;
      delete m._cats;
      m.labels = settings.labels[m.key] || [];
      m.excluded = settings.excluded.includes(m.key);
    }
    return rows;
  };

  // stable category -> color-slot assignment: ranked once per dataset by
  // positive spend (default spend types), so filters never repaint survivors.
  SV.assignCategorySlots = function (allTransactions, settings, slotCount) {
    const spendTypes = new Set(SV.DEFAULT_SPEND_TYPES);
    const totals = new Map();
    for (const t of allTransactions) {
      if (!spendTypes.has(t.type) || t.amount <= 0) continue;
      const c = SV.effectiveCategory(t, settings).category;
      totals.set(c, (totals.get(c) || 0) + t.amount);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const slots = new Map();
    ranked.slice(0, slotCount).forEach(([cat], i) => slots.set(cat, i + 1));
    return slots;
  };

  // per-period net totals for each slotted category + 'Other' fold
  SV.categorySeries = function (transactions, granularity, slots, settings) {
    const periods = SV.aggregateByPeriod(transactions, granularity);
    const index = new Map(periods.map((p, i) => [p.key, i]));
    const named = [...slots.entries()].sort((a, b) => a[1] - b[1]); // by slot
    const series = named.map(([cat, slot]) => ({ name: cat, slot, values: periods.map(() => 0) }));
    const other = { name: 'Other categories', slot: 0, values: periods.map(() => 0) };
    const byCat = new Map(named.map(([cat], i) => [cat, series[i]]));
    for (const t of transactions) {
      const i = index.get(periodKeyOf(t.date, granularity));
      if (i == null) continue;
      const c = SV.effectiveCategory(t, settings).category;
      (byCat.get(c) || other).values[i] += t.amount;
    }
    const out = series.filter((s) => s.values.some((v) => Math.abs(v) > 0.005));
    if (other.values.some((v) => Math.abs(v) > 0.005)) out.push(other);
    return { periods, series: out };
  };

  SV.allLabels = function (settings) {
    const set = new Set();
    for (const tags of Object.values(settings.labels)) for (const t of tags) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  };
})(window.SV);
