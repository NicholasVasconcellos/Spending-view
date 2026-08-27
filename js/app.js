// App controller: state, filter row, KPI tiles, charts, merchant + transaction
// tables, metadata panel, import/export of CSV files, theme.
(function (SV) {
  'use strict';
  const { el, fmt } = SV;
  const D = SV.date;
  const $ = (id) => document.getElementById(id);

  const ROLLING_OPTIONS = { week: [4, 8, 13, 26], month: [3, 6, 12], year: [2, 3] };
  const PERIOD_NOUN = { week: 'week', month: 'month', year: 'year' };

  const state = {
    files: [],          // {name, hash, text, sample?}
    transactions: [],
    settings: SV.store.loadSettings(),
    slots: new Map(),
    filters: defaultFilters(),
    granularity: 'month',
    rolling: { week: 4, month: 3, year: 2 },
    tableView: { trend: false, category: false, merchants: false },
    merchant: { search: '', sortCol: 'total', sortDir: -1, shown: 100 },
    tx: { page: 0, sortCol: 'date', sortDir: -1 },
  };

  function defaultFilters() {
    return {
      preset: 'all', from: null, to: null,
      types: new Set(SV.DEFAULT_SPEND_TYPES),
      categories: null, cards: null, sources: null, labels: null,
      search: '', showExcluded: false,
    };
  }

  // ---------------------------------------------------------------- dataset
  function addFiles(entries) {
    const notes = [];
    for (const entry of entries) {
      const hash = SV.hashString(entry.text);
      if (state.files.some((f) => f.hash === hash)) {
        notes.push(`Skipped ${entry.name}: identical file already loaded.`);
        continue;
      }
      try {
        const parsed = SV.parseTransactionsCSV(entry.text, entry.name);
        state.files.push({ name: entry.name, hash, text: entry.text, sample: !!entry.sample, source: parsed.source, rows: parsed.transactions.length, skipped: parsed.skipped, header: parsed.header });
        state.transactions.push(...parsed.transactions);
        notes.push(`Loaded ${entry.name}: ${parsed.transactions.length} transactions (${SV.SOURCES[parsed.source].label}).`);
      } catch (err) {
        notes.push(String(err.message || err));
      }
    }
    state.transactions.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    persistDataset();
    recompute();
    if (notes.length) toast(notes.join('\n'));
  }

  function loadSample() {
    const entries = Object.entries(SV.MOCK_DATA || {}).map(([name, text]) => ({ name, text, sample: true }));
    addFiles(entries);
  }

  function clearData() {
    state.files = [];
    state.transactions = [];
    state.filters = defaultFilters();
    SV.store.clearDataset();
    recompute();
    toast('Dataset cleared. Your category overrides, labels and exclusions are kept.');
  }

  function persistDataset() {
    const includesSample = state.files.some((f) => f.sample);
    if (!SV.store.saveDataset(state.files, includesSample)) {
      toast('Note: this dataset is too large for browser storage, so it will not survive a page refresh.');
    }
  }

  function restoreDataset() {
    const saved = SV.store.loadDataset();
    if (!saved) return false;
    const entries = [];
    if (saved.includesSample) for (const [name, text] of Object.entries(SV.MOCK_DATA || {})) entries.push({ name, text, sample: true });
    for (const f of saved.files || []) entries.push({ name: f.name, text: f.text });
    if (!entries.length) return false;
    addFiles(entries);
    return true;
  }

  function recompute() {
    state.slots = SV.assignCategorySlots(state.transactions, state.settings, 5);
    renderAll();
  }

  function saveSettings() { SV.store.saveSettings(state.settings); }

  // ---------------------------------------------------------------- filters
  function filtered() { return SV.filterTransactions(state.transactions, state.filters, state.settings); }
  function filteredForMerchants() {
    return SV.filterTransactions(state.transactions, { ...state.filters, showExcluded: true }, state.settings);
  }

  function dataMaxDate() {
    let max = null;
    for (const t of state.transactions) if (!max || t.date > max) max = t.date;
    return max || D.today();
  }

  function applyPreset(preset) {
    const f = state.filters;
    f.preset = preset;
    const anchor = dataMaxDate();
    if (preset === 'all') { f.from = null; f.to = null; }
    else if (preset === '30d') { f.from = D.addDays(anchor, -29); f.to = anchor; }
    else if (preset === '90d') { f.from = D.addDays(anchor, -89); f.to = anchor; }
    else if (preset === '12m') { f.from = D.addDays(anchor, -364); f.to = anchor; }
    else if (preset === 'ytd') { f.from = `${anchor.slice(0, 4)}-01-01`; f.to = anchor; }
    else if (preset === 'month') { f.from = `${anchor.slice(0, 7)}-01`; f.to = anchor; }
    // 'custom' keeps whatever from/to are set
  }

  // generic checkbox-dropdown; selected === null means "all"
  function multiSelect({ label, options, selected, onChange }) {
    const wrap = el('div', { class: 'sv-multi' });
    const btn = el('button', { class: 'sv-btn sv-multi-btn', type: 'button' });
    const panel = el('div', { class: 'sv-multi-panel', hidden: '' });
    const summary = () => {
      const total = options.length;
      const n = selected === null ? total : [...selected].filter((v) => options.some((o) => o.value === v)).length;
      btn.textContent = '';
      btn.appendChild(el('span', { text: `${label}: ` }));
      btn.appendChild(el('strong', { text: n === total ? 'all' : `${n} of ${total}` }));
      btn.appendChild(el('span', { class: 'sv-caret', text: '▾' }));
    };
    const isChecked = (v) => selected === null || selected.has(v);
    const commit = () => {
      const checked = options.filter((o) => o._cb.checked).map((o) => o.value);
      selected = checked.length === options.length ? null : new Set(checked);
      summary();
      onChange(selected === null ? null : new Set(selected));
    };
    const controls = el('div', { class: 'sv-multi-actions' }, [
      el('button', { class: 'sv-linklike', type: 'button', text: 'All', onclick: () => { options.forEach((o) => { o._cb.checked = true; }); commit(); } }),
      el('button', { class: 'sv-linklike', type: 'button', text: 'None', onclick: () => { options.forEach((o) => { o._cb.checked = false; }); commit(); } }),
    ]);
    panel.appendChild(controls);
    const list = el('div', { class: 'sv-multi-list' });
    for (const o of options) {
      const cb = el('input', { type: 'checkbox' });
      cb.checked = isChecked(o.value);
      cb.addEventListener('change', commit);
      o._cb = cb;
      list.appendChild(el('label', { class: 'sv-multi-item' }, [cb, el('span', { text: o.label })]));
    }
    panel.appendChild(list);
    btn.addEventListener('click', () => {
      const open = panel.hasAttribute('hidden');
      closeAllPanels();
      if (open) panel.removeAttribute('hidden');
    });
    wrap.appendChild(btn); wrap.appendChild(panel);
    summary();
    return wrap;
  }
  function closeAllPanels() {
    document.querySelectorAll('.sv-multi-panel').forEach((p) => p.setAttribute('hidden', ''));
  }
  document.addEventListener('click', (e) => { if (!e.target.closest('.sv-multi')) closeAllPanels(); });

  function renderFilterRow() {
    const row = $('filter-row');
    row.textContent = '';
    if (!state.transactions.length) { row.hidden = true; return; }
    row.hidden = false;
    const f = state.filters;

    // date preset + custom range
    const presets = [
      ['all', 'All time'], ['month', 'This month'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'],
      ['ytd', 'Year to date'], ['12m', 'Last 12 months'], ['custom', 'Custom range'],
    ];
    const sel = el('select', { class: 'sv-select', 'aria-label': 'Date range' },
      presets.map(([v, l]) => el('option', { value: v, text: l })));
    sel.value = f.preset;
    const customWrap = el('span', { class: 'sv-custom-range' });
    const fromIn = el('input', { type: 'date', class: 'sv-date', 'aria-label': 'From date' });
    const toIn = el('input', { type: 'date', class: 'sv-date', 'aria-label': 'To date' });
    if (f.from) fromIn.value = f.from;
    if (f.to) toIn.value = f.to;
    const syncCustom = () => { customWrap.style.display = f.preset === 'custom' ? '' : 'none'; };
    sel.addEventListener('change', () => { applyPreset(sel.value); syncCustom(); renderData(); });
    fromIn.addEventListener('change', () => { f.from = fromIn.value || null; renderData(); });
    toIn.addEventListener('change', () => { f.to = toIn.value || null; renderData(); });
    customWrap.appendChild(fromIn); customWrap.appendChild(el('span', { text: '–', class: 'sv-dash' })); customWrap.appendChild(toIn);
    syncCustom();
    row.appendChild(el('div', { class: 'sv-filter-group' }, [sel, customWrap]));

    // granularity segmented control (shared by both time charts)
    const seg = el('div', { class: 'sv-seg', role: 'group', 'aria-label': 'Granularity' });
    for (const g of ['week', 'month', 'year']) {
      const b = el('button', { class: 'sv-seg-btn' + (state.granularity === g ? ' is-active' : ''), type: 'button', text: g[0].toUpperCase() + g.slice(1) });
      b.addEventListener('click', () => { state.granularity = g; renderFilterRow(); renderData(); });
      seg.appendChild(b);
    }
    row.appendChild(seg);

    // types
    const typesPresent = SV.TYPES.filter((t) => state.transactions.some((x) => x.type === t));
    row.appendChild(multiSelect({
      label: 'Types',
      options: typesPresent.map((t) => ({ value: t, label: t })),
      selected: f.types ? new Set([...f.types].filter((t) => typesPresent.includes(t))) : null,
      onChange: (s) => { f.types = s === null ? new Set(typesPresent) : s; renderData(); },
    }));

    // categories
    const cats = SV.categoriesInUse(state.transactions, state.settings);
    row.appendChild(multiSelect({
      label: 'Categories',
      options: cats.map((c) => ({ value: c, label: c })),
      selected: f.categories,
      onChange: (s) => { f.categories = s; renderData(); },
    }));

    // cards
    const cards = [...new Set(state.transactions.map((t) => t.card || '(none)'))].sort();
    if (cards.length > 1) {
      row.appendChild(multiSelect({
        label: 'Cards',
        options: cards.map((c) => ({ value: c, label: c === '(none)' ? 'No card (account rows)' : `•• ${c}` })),
        selected: f.cards,
        onChange: (s) => { f.cards = s; renderData(); },
      }));
    }

    // sources
    const sources = [...new Set(state.transactions.map((t) => t.source))];
    if (sources.length > 1) {
      row.appendChild(multiSelect({
        label: 'Sources',
        options: sources.map((s) => ({ value: s, label: SV.SOURCES[s].label })),
        selected: f.sources,
        onChange: (s) => { f.sources = s; renderData(); },
      }));
    }

    // labels
    const labels = SV.allLabels(state.settings);
    if (labels.length) {
      row.appendChild(multiSelect({
        label: 'Labels',
        options: labels.map((l) => ({ value: l, label: l })),
        selected: f.labels,
        onChange: (s) => { f.labels = s; renderData(); },
      }));
    }

    // search
    const search = el('input', { type: 'search', class: 'sv-search', placeholder: 'Search merchant or description…', 'aria-label': 'Search transactions' });
    search.value = f.search;
    search.addEventListener('input', SV.debounce(() => { f.search = search.value.trim(); renderData(); }, 200));
    row.appendChild(search);

    // excluded merchants toggle
    const nExcluded = state.settings.excluded.length;
    if (nExcluded) {
      const b = el('button', { class: 'sv-chip' + (f.showExcluded ? ' is-active' : ''), type: 'button', text: f.showExcluded ? `Showing ${nExcluded} excluded` : `${nExcluded} excluded hidden` });
      b.addEventListener('click', () => { f.showExcluded = !f.showExcluded; renderFilterRow(); renderData(); });
      row.appendChild(b);
    }

    const reset = el('button', { class: 'sv-linklike', type: 'button', text: 'Reset filters' });
    reset.addEventListener('click', () => { state.filters = defaultFilters(); renderFilterRow(); renderData(); });
    row.appendChild(reset);
  }

  // ---------------------------------------------------------------- KPIs
  function renderKPIs(txs) {
    const wrap = $('kpi-row');
    wrap.textContent = '';
    const avg = SV.spanAverages(txs);
    if (!avg) return;
    const monthly = SV.aggregateByPeriod(txs, 'month').slice(-12).map((p) => p.total);

    const tile = (label, value, sub, spark) => {
      const t = el('div', { class: 'sv-tile' });
      t.appendChild(el('div', { class: 'sv-tile-label', text: label }));
      t.appendChild(el('div', { class: 'sv-tile-value', text: value }));
      if (sub) t.appendChild(el('div', { class: 'sv-tile-sub', text: sub }));
      wrap.appendChild(t);
      if (spark) { const s = el('div', { class: 'sv-tile-spark' }); t.appendChild(s); SV.charts.sparkline(s, spark); }
    };
    tile('Total spend', fmt.usd(avg.total), `${D.dayLabel(avg.from)} – ${D.dayLabel(avg.to)}`, monthly.length > 1 ? monthly : null);
    tile('Transactions', fmt.int(avg.count), `across ${avg.days} days`);
    tile('Avg per month', fmt.usd(avg.perMonth), 'over the covered span');
    tile('Avg per week', fmt.usd(avg.perWeek), 'over the covered span');
    tile('Avg per year', fmt.usd(avg.perYear), avg.days < 365 ? 'annualized rate' : 'over the covered span');
  }

  // ---------------------------------------------------------------- charts
  function chartCard(id, title, subtitle, controls) {
    const card = $(id);
    card.textContent = '';
    const head = el('div', { class: 'sv-card-head' });
    const titles = el('div', {}, [
      el('h2', { class: 'sv-card-title', text: title }),
      subtitle ? el('p', { class: 'sv-card-sub', text: subtitle }) : null,
    ]);
    head.appendChild(titles);
    if (controls) head.appendChild(controls);
    card.appendChild(head);
    const body = el('div', { class: 'sv-card-body' });
    card.appendChild(body);
    return body;
  }

  function tableToggle(key) {
    const b = el('button', { class: 'sv-btn sv-btn-small' + (state.tableView[key] ? ' is-active' : ''), type: 'button', text: state.tableView[key] ? 'Chart' : 'Table' });
    b.addEventListener('click', () => { state.tableView[key] = !state.tableView[key]; renderData(); });
    return b;
  }

  function dataTable(columns, rows) {
    const t = el('table', { class: 'sv-table' });
    t.appendChild(el('thead', {}, el('tr', {}, columns.map((c) => el('th', { text: c.label, class: c.num ? 'num' : null })))));
    t.appendChild(el('tbody', {}, rows.map((r) => el('tr', {}, columns.map((c) => el('td', { text: c.get(r), class: c.num ? 'num' : null }))))));
    return el('div', { class: 'sv-table-scroll' }, t);
  }

  function renderTrend(txs) {
    const g = state.granularity;
    const windows = ROLLING_OPTIONS[g];
    if (!windows.includes(state.rolling[g])) state.rolling[g] = windows[0];
    const rollSel = el('select', { class: 'sv-select sv-select-small', 'aria-label': 'Rolling average window' },
      windows.map((w) => el('option', { value: String(w), text: `${w}-${PERIOD_NOUN[g]} rolling avg` })));
    rollSel.value = String(state.rolling[g]);
    rollSel.addEventListener('change', () => { state.rolling[g] = +rollSel.value; renderData(); });
    const controls = el('div', { class: 'sv-card-controls' }, [rollSel, tableToggle('trend')]);

    const body = chartCard('card-trend', 'Spending over time', 'Net of refunds and credits; payments excluded by default.', controls);
    const periods = SV.aggregateByPeriod(txs, g);
    const rolling = SV.rollingAverage(periods, state.rolling[g]);
    const rollingLabel = `${state.rolling[g]}-${PERIOD_NOUN[g]} rolling avg`;

    if (state.tableView.trend) {
      body.appendChild(dataTable([
        { label: PERIOD_NOUN[g][0].toUpperCase() + PERIOD_NOUN[g].slice(1), get: (r) => r.p.label },
        { label: 'Spend', num: true, get: (r) => fmt.usd(r.p.total) },
        { label: 'Transactions', num: true, get: (r) => String(r.p.count) },
        { label: rollingLabel, num: true, get: (r) => r.roll == null ? '—' : fmt.usd(r.roll) },
      ], periods.map((p, i) => ({ p, roll: rolling[i].value })).reverse()));
    } else {
      const c = el('div', { class: 'sv-chart' });
      body.appendChild(c);
      SV.charts.timeChart(c, { periods, rolling, rollingLabel });
    }
  }

  function renderCategoryChart(txs) {
    const body = chartCard('card-category', 'Spending by category', 'Top 5 categories keep their own color; the rest fold into gray.', el('div', { class: 'sv-card-controls' }, [tableToggle('category')]));
    const { periods, series } = SV.categorySeries(txs, state.granularity, state.slots, state.settings);
    if (state.tableView.category) {
      const cols = [{ label: 'Period', get: (r) => r.label }];
      series.forEach((s, si) => cols.push({ label: s.name, num: true, get: (r) => fmt.usd(r.vals[si]) }));
      cols.push({ label: 'Total', num: true, get: (r) => fmt.usd(r.vals.reduce((a, b) => a + b, 0)) });
      const rows = periods.map((p, i) => ({ label: p.label, vals: series.map((s) => s.values[i]) })).reverse();
      body.appendChild(dataTable(cols, rows));
    } else {
      const c = el('div', { class: 'sv-chart' });
      body.appendChild(c);
      SV.charts.stackedChart(c, { periods, series });
    }
  }

  function renderTopMerchants(txs) {
    const stats = SV.merchantStats(txs, state.settings)
      .filter((m) => !m.excluded || state.filters.showExcluded)
      .sort((a, b) => b.total - a.total);
    const top = stats.slice(0, 10).filter((m) => m.total > 0);
    const body = chartCard('card-top-merchants', 'Top merchants', `By net spend under the current filters (${fmt.int(stats.length)} merchants total).`, el('div', { class: 'sv-card-controls' }, [tableToggle('merchants')]));
    if (state.tableView.merchants) {
      body.appendChild(dataTable([
        { label: 'Merchant', get: (r) => r.name },
        { label: 'Category', get: (r) => r.category },
        { label: 'Transactions', num: true, get: (r) => String(r.count) },
        { label: 'Total', num: true, get: (r) => fmt.usd(r.total) },
        { label: 'Avg', num: true, get: (r) => fmt.usd(r.avg) },
      ], stats.slice(0, 25)));
    } else {
      const c = el('div', { class: 'sv-chart' });
      body.appendChild(c);
      SV.charts.hbarChart(c, {
        items: top.map((m) => ({ label: m.name, value: m.total, m })),
        onHoverRows: (d) => [
          { key: null, label: 'total', value: fmt.usd(d.m.total) },
          { key: null, label: `${d.m.count} transactions, avg`, value: fmt.usd(d.m.avg) },
          { key: null, label: d.m.category, value: '' },
        ],
      });
    }
  }

  function renderAverages(txs) {
    const body = chartCard('card-averages', 'Averages by calendar year', 'Partial years are averaged over the days they actually cover.');
    const years = SV.yearlyBreakdown(txs);
    if (!years.length) { body.appendChild(el('p', { class: 'sv-muted', text: 'No data under the current filters.' })); return; }
    body.appendChild(dataTable([
      { label: 'Year', get: (r) => r.year },
      { label: 'Total', num: true, get: (r) => fmt.usd(r.total) },
      { label: 'Transactions', num: true, get: (r) => fmt.int(r.count) },
      { label: 'Avg / month', num: true, get: (r) => fmt.usd(r.perMonth) },
      { label: 'Avg / week', num: true, get: (r) => fmt.usd(r.perWeek) },
      { label: 'Days covered', num: true, get: (r) => String(r.days) },
    ], years));
    const g = state.granularity;
    const rolling = SV.rollingAverage(SV.aggregateByPeriod(txs, g), state.rolling[g]);
    const latest = [...rolling].reverse().find((r) => r.value != null);
    if (latest) body.appendChild(el('p', { class: 'sv-muted sv-note', text: `Latest ${state.rolling[g]}-${PERIOD_NOUN[g]} rolling average: ${fmt.usd(latest.value)} per ${PERIOD_NOUN[g]}.` }));
  }

  // ---------------------------------------------------------------- merchants
  function renderMerchants() {
    const card = $('card-merchants-table');
    card.textContent = '';
    if (!state.transactions.length) return;
    const head = el('div', { class: 'sv-card-head' }, [
      el('div', {}, [
        el('h2', { class: 'sv-card-title', text: 'Merchants' }),
        el('p', { class: 'sv-card-sub', text: 'Override categories, add labels, or exclude a merchant from every chart and total. Changes are saved in this browser.' }),
      ]),
    ]);
    card.appendChild(head);

    // toolbar: merchant search + custom category manager
    const toolbar = el('div', { class: 'sv-toolbar' });
    const search = el('input', { type: 'search', class: 'sv-search', placeholder: 'Find a merchant…', 'aria-label': 'Find a merchant' });
    search.value = state.merchant.search;
    search.addEventListener('input', SV.debounce(() => { state.merchant.search = search.value.trim().toLowerCase(); state.merchant.shown = 100; renderMerchants(); }, 150));
    toolbar.appendChild(search);

    const catWrap = el('div', { class: 'sv-cat-manager' });
    const catIn = el('input', { type: 'text', class: 'sv-input', placeholder: 'New category name…', 'aria-label': 'New category name' });
    const addBtn = el('button', { class: 'sv-btn sv-btn-small', type: 'button', text: 'Add category' });
    addBtn.addEventListener('click', () => {
      const name = catIn.value.trim();
      if (!name) return;
      if (!state.settings.customCategories.includes(name)) {
        state.settings.customCategories.push(name);
        saveSettings();
      }
      catIn.value = '';
      renderAll();
    });
    catIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
    catWrap.appendChild(catIn); catWrap.appendChild(addBtn);
    for (const c of state.settings.customCategories) {
      const chip = el('span', { class: 'sv-chip' }, [
        el('span', { text: c }),
        el('button', { class: 'sv-chip-x', type: 'button', text: '×', title: `Remove category "${c}"`, 'aria-label': `Remove category ${c}` }),
      ]);
      chip.querySelector('button').addEventListener('click', () => {
        const used = Object.values(state.settings.categoryOverrides).includes(c);
        if (used) { toast(`"${c}" is still assigned to a merchant. Reassign those merchants first.`); return; }
        state.settings.customCategories = state.settings.customCategories.filter((x) => x !== c);
        saveSettings(); renderAll();
      });
      catWrap.appendChild(chip);
    }
    toolbar.appendChild(catWrap);
    card.appendChild(toolbar);

    // rows
    let rows = SV.merchantStats(filteredForMerchants(), state.settings);
    if (state.merchant.search) rows = rows.filter((m) => m.name.toLowerCase().includes(state.merchant.search));
    const { sortCol, sortDir } = state.merchant;
    const getters = { name: (m) => m.name.toLowerCase(), category: (m) => m.category, count: (m) => m.count, total: (m) => m.total, avg: (m) => m.avg, first: (m) => m.first, last: (m) => m.last };
    rows.sort((a, b) => {
      const x = getters[sortCol](a), y = getters[sortCol](b);
      return (x < y ? -1 : x > y ? 1 : 0) * sortDir;
    });

    const choices = SV.allCategoryChoices(state.transactions, state.settings);
    const table = el('table', { class: 'sv-table sv-merchant-table' });
    const th = (label, col, num) => {
      const cell = el('th', { class: (num ? 'num ' : '') + 'sortable' + (sortCol === col ? ' sorted' : '') });
      const b = el('button', { type: 'button', class: 'sv-th-btn', text: label + (sortCol === col ? (sortDir === 1 ? ' ↑' : ' ↓') : '') });
      b.addEventListener('click', () => {
        if (state.merchant.sortCol === col) state.merchant.sortDir *= -1;
        else { state.merchant.sortCol = col; state.merchant.sortDir = col === 'name' ? 1 : -1; }
        renderMerchants();
      });
      cell.appendChild(b);
      return cell;
    };
    table.appendChild(el('thead', {}, el('tr', {}, [
      th('Merchant', 'name'), th('Category', 'category'), el('th', { text: 'Labels' }),
      th('Tx', 'count', true), th('Total', 'total', true), th('Avg', 'avg', true),
      th('First', 'first'), th('Last', 'last'), el('th', { text: 'Exclude', class: 'center' }),
    ])));

    const tbody = el('tbody');
    for (const m of rows.slice(0, state.merchant.shown)) {
      const tr = el('tr', { class: m.excluded ? 'is-excluded' : null });
      tr.appendChild(el('td', { class: 'sv-merchant-name' }, [
        el('span', { text: m.name, title: m.name }),
      ]));

      // category select + origin note
      const catTd = el('td');
      const sel = el('select', { class: 'sv-select sv-select-small', 'aria-label': `Category for ${m.name}` });
      sel.appendChild(el('option', { value: ' auto', text: '(source / auto)' }));
      for (const c of choices) sel.appendChild(el('option', { value: c, text: c }));
      if (!choices.includes(m.category) && state.settings.categoryOverrides[m.key]) sel.appendChild(el('option', { value: m.category, text: m.category }));
      sel.value = state.settings.categoryOverrides[m.key] ? m.category : ' auto';
      sel.addEventListener('change', () => {
        if (sel.value === ' auto') delete state.settings.categoryOverrides[m.key];
        else state.settings.categoryOverrides[m.key] = sel.value;
        saveSettings(); recompute();
      });
      catTd.appendChild(sel);
      const originText = state.settings.categoryOverrides[m.key] ? 'override' : (m.categoryFrom === 'source' ? `source: ${m.category}` : m.categoryFrom === 'auto' ? `auto: ${m.category}` : 'uncategorized');
      catTd.appendChild(el('div', { class: 'sv-cat-origin', text: originText }));
      tr.appendChild(catTd);

      // labels
      const labTd = el('td');
      const labIn = el('input', { type: 'text', class: 'sv-input sv-input-small', placeholder: 'add labels…', 'aria-label': `Labels for ${m.name}`, title: 'Comma-separated labels, e.g. "travel, work"' });
      labIn.value = m.labels.join(', ');
      const commitLabels = () => {
        const tags = labIn.value.split(',').map((s) => s.trim()).filter(Boolean);
        if (tags.length) state.settings.labels[m.key] = tags;
        else delete state.settings.labels[m.key];
        saveSettings(); renderFilterRow(); renderData();
      };
      labIn.addEventListener('change', commitLabels);
      labIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { commitLabels(); labIn.blur(); } });
      labTd.appendChild(labIn);
      tr.appendChild(labTd);

      tr.appendChild(el('td', { class: 'num', text: String(m.count) }));
      tr.appendChild(el('td', { class: 'num', text: fmt.usd(m.total) }));
      tr.appendChild(el('td', { class: 'num', text: fmt.usd(m.avg) }));
      tr.appendChild(el('td', { text: m.first }));
      tr.appendChild(el('td', { text: m.last }));

      const exTd = el('td', { class: 'center' });
      const cb = el('input', { type: 'checkbox', 'aria-label': `Exclude ${m.name}` });
      cb.checked = m.excluded;
      cb.addEventListener('change', () => {
        if (cb.checked) state.settings.excluded.push(m.key);
        else state.settings.excluded = state.settings.excluded.filter((k) => k !== m.key);
        saveSettings(); renderFilterRow(); renderData(); renderMerchants();
      });
      exTd.appendChild(cb);
      tr.appendChild(exTd);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(el('div', { class: 'sv-table-scroll' }, table));

    if (rows.length > state.merchant.shown) {
      const more = el('button', { class: 'sv-btn', type: 'button', text: `Show all ${fmt.int(rows.length)} merchants` });
      more.addEventListener('click', () => { state.merchant.shown = rows.length; renderMerchants(); });
      card.appendChild(el('div', { class: 'sv-more' }, more));
    }
  }

  // ---------------------------------------------------------------- transactions
  const TX_PAGE = 50;
  function renderTransactions(txs) {
    const card = $('card-transactions');
    card.textContent = '';
    if (!state.transactions.length) return;
    card.appendChild(el('div', { class: 'sv-card-head' }, el('div', {}, [
      el('h2', { class: 'sv-card-title', text: 'Transactions' }),
      el('p', { class: 'sv-card-sub', text: `${fmt.int(txs.length)} transactions under the current filters, with every column the CSVs provide.` }),
    ])));

    const { sortCol, sortDir } = state.tx;
    const getters = {
      date: (t) => t.date, posted: (t) => t.postedDate || '', merchant: (t) => t.merchant.toLowerCase(),
      amount: (t) => t.amount, type: (t) => t.type, category: (t) => SV.effectiveCategory(t, state.settings).category,
    };
    const sorted = [...txs].sort((a, b) => {
      const x = getters[sortCol](a), y = getters[sortCol](b);
      return (x < y ? -1 : x > y ? 1 : 0) * sortDir || b.id - a.id;
    });
    const pages = Math.max(1, Math.ceil(sorted.length / TX_PAGE));
    if (state.tx.page >= pages) state.tx.page = pages - 1;
    const pageRows = sorted.slice(state.tx.page * TX_PAGE, (state.tx.page + 1) * TX_PAGE);

    const th = (label, col, num) => {
      const cell = el('th', { class: (num ? 'num ' : '') + (col ? 'sortable' : '') });
      if (!col) { cell.textContent = label; return cell; }
      const b = el('button', { type: 'button', class: 'sv-th-btn', text: label + (sortCol === col ? (sortDir === 1 ? ' ↑' : ' ↓') : '') });
      b.addEventListener('click', () => {
        if (state.tx.sortCol === col) state.tx.sortDir *= -1;
        else { state.tx.sortCol = col; state.tx.sortDir = -1; }
        state.tx.page = 0;
        renderTransactions(filtered());
      });
      cell.appendChild(b);
      return cell;
    };

    const table = el('table', { class: 'sv-table' });
    table.appendChild(el('thead', {}, el('tr', {}, [
      th('Date', 'date'), th('Posted', 'posted'), th('Merchant', 'merchant'), th('Category', 'category'),
      th('Type', 'type'), th('Amount', 'amount', true), el('th', { text: 'Card' }), el('th', { text: 'Location' }),
      el('th', { text: 'Labels' }), el('th', { text: 'Source' }),
    ])));
    const tbody = el('tbody');
    for (const t of pageRows) {
      const eff = SV.effectiveCategory(t, state.settings);
      const labels = (state.settings.labels[t.merchantKey] || []).join(', ');
      const loc = [t.city, t.state].filter(Boolean).join(', ');
      const tr = el('tr');
      tr.appendChild(el('td', { text: t.date }));
      tr.appendChild(el('td', { text: t.postedDate || '—' }));
      tr.appendChild(el('td', { class: 'sv-merchant-name', title: `${t.description}${t.rawMerchant && t.rawMerchant !== t.description ? '\nRaw: ' + t.rawMerchant : ''}`, text: t.merchant }));
      tr.appendChild(el('td', { text: eff.category, title: `category from ${eff.from}` }));
      tr.appendChild(el('td', { text: t.type }));
      tr.appendChild(el('td', { class: 'num', text: fmt.usd(t.amount) }));
      tr.appendChild(el('td', { text: t.card ? `•• ${t.card}` : '—' }));
      tr.appendChild(el('td', { text: loc || '—' }));
      tr.appendChild(el('td', { text: labels || '—' }));
      tr.appendChild(el('td', { class: 'sv-muted-cell', text: t.sourceFile }));
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    card.appendChild(el('div', { class: 'sv-table-scroll' }, table));

    if (pages > 1) {
      const nav = el('div', { class: 'sv-pager' });
      const btn = (label, disabled, go) => {
        const b = el('button', { class: 'sv-btn sv-btn-small', type: 'button', text: label });
        if (disabled) b.setAttribute('disabled', '');
        b.addEventListener('click', () => { state.tx.page = go; renderTransactions(filtered()); });
        return b;
      };
      nav.appendChild(btn('‹ Prev', state.tx.page === 0, state.tx.page - 1));
      nav.appendChild(el('span', { class: 'sv-muted', text: `Page ${state.tx.page + 1} of ${pages}` }));
      nav.appendChild(btn('Next ›', state.tx.page === pages - 1, state.tx.page + 1));
      card.appendChild(nav);
    }
  }

  // ---------------------------------------------------------------- metadata
  function renderMetadata() {
    const card = $('card-metadata');
    card.textContent = '';
    if (!state.transactions.length) return;
    card.appendChild(el('div', { class: 'sv-card-head' }, el('div', {}, [
      el('h2', { class: 'sv-card-title', text: 'Dataset metadata' }),
      el('p', { class: 'sv-card-sub', text: 'Everything else the CSV files carry beyond date, merchant and amount.' }),
    ])));
    const grid = el('div', { class: 'sv-meta-grid' });

    for (const f of state.files) {
      const txs = state.transactions.filter((t) => t.sourceFile === f.name);
      if (!txs.length) continue;
      const dates = txs.map((t) => t.date).sort();
      const box = el('div', { class: 'sv-meta-box' });
      box.appendChild(el('h3', { text: f.name }));
      const dl = el('dl');
      const add = (k, v) => { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); };
      add('Format', SV.SOURCES[f.source].label + (f.sample ? ' · sample data' : ''));
      add('Columns', f.header.join(', '));
      add('Rows', `${fmt.int(f.rows)} parsed${f.skipped ? `, ${f.skipped} skipped` : ''}`);
      add('Date range', `${dates[0]} → ${dates[dates.length - 1]}`);
      const lags = txs.filter((t) => t.postedDate).map((t) => D.daysBetween(t.date, t.postedDate));
      if (lags.length) {
        const avgLag = lags.reduce((a, b) => a + b, 0) / lags.length;
        add('Posting lag', `avg ${avgLag.toFixed(1)} days, max ${Math.max(...lags)} days (transaction → posted/clearing date)`);
      }
      const people = [...new Set(txs.map((t) => t.person).filter(Boolean))];
      if (people.length) add(f.source === 'apple-card' ? 'Purchased by' : 'Name on card', people.join(', '));
      const cards = [...new Set(txs.map((t) => t.card).filter(Boolean))];
      if (cards.length) {
        const perCard = cards.map((c) => {
          const sub = txs.filter((t) => t.card === c && t.amount > 0);
          return `•• ${c}: ${fmt.int(sub.length)} charges, ${fmt.usd(sub.reduce((a, t) => a + t.amount, 0))}`;
        });
        add('Cards', perCard.join(' · '));
      }
      const types = [...new Set(txs.map((t) => t.type))];
      add('Transaction types', types.join(', '));
      if (f.source === 'apple-card') {
        const cats = [...new Set(txs.map((t) => t.sourceCategory).filter(Boolean))];
        add('Source categories', cats.sort().join(', '));
        const byState = new Map();
        for (const t of txs) if (t.state && t.amount > 0) byState.set(t.state, (byState.get(t.state) || 0) + t.amount);
        if (byState.size) {
          const topStates = [...byState.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
            .map(([s, v]) => `${s} ${fmt.usdCompact(v)}`);
          add('Locations (parsed from descriptions)', `${byState.size} states · top: ${topStates.join(', ')}`);
        }
      }
      box.appendChild(dl);
      grid.appendChild(box);
    }

    // dataset-wide summary
    const box = el('div', { class: 'sv-meta-box' });
    box.appendChild(el('h3', { text: 'Combined dataset' }));
    const dl = el('dl');
    const add = (k, v) => { dl.appendChild(el('dt', { text: k })); dl.appendChild(el('dd', { text: v })); };
    add('Files', String(state.files.length));
    add('Transactions', fmt.int(state.transactions.length));
    const origins = { source: 0, auto: 0, override: 0, none: 0 };
    for (const t of state.transactions) origins[SV.effectiveCategory(t, state.settings).from]++;
    add('Category origin', `${fmt.int(origins.source)} from the CSV, ${fmt.int(origins.auto)} auto-detected, ${fmt.int(origins.override)} overridden by you, ${fmt.int(origins.none)} uncategorized`);
    add('Customization', `${Object.keys(state.settings.categoryOverrides).length} category overrides · ${Object.keys(state.settings.labels).length} labeled merchants · ${state.settings.excluded.length} excluded merchants · ${state.settings.customCategories.length} custom categories`);
    box.appendChild(dl);
    grid.appendChild(box);
    card.appendChild(grid);
  }

  // ---------------------------------------------------------------- shell
  function renderHeaderButtons() {
    const hasData = state.transactions.length > 0;
    $('btn-clear').hidden = !hasData;
    $('empty-state').hidden = hasData;
    $('dashboard').hidden = !hasData;
  }

  function renderData() {
    SV.charts.hideTooltip();
    const txs = filtered();
    renderKPIs(txs);
    renderTrend(txs);
    renderCategoryChart(txs);
    renderTopMerchants(txs);
    renderAverages(txs);
    renderTransactions(txs);
  }

  function renderAll() {
    renderHeaderButtons();
    renderFilterRow();
    if (!state.transactions.length) return;
    renderData();
    renderMerchants();
    renderMetadata();
  }

  // ---------------------------------------------------------------- misc UI
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
  }

  function readFiles(fileList) {
    const files = [...fileList].filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv');
    if (!files.length) { toast('No .csv files found in that selection.'); return; }
    Promise.all(files.map((f) => f.text().then((text) => ({ name: f.name, text }))))
      .then(addFiles)
      .catch((err) => toast(`Could not read files: ${err.message || err}`));
  }

  function setupTheme() {
    let theme = SV.store.loadTheme();
    const apply = () => {
      if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', theme);
      $('btn-theme').textContent = theme === 'auto' ? '◐ Auto' : theme === 'light' ? '☀ Light' : '☾ Dark';
      if (state.transactions.length) renderData();
    };
    $('btn-theme').addEventListener('click', () => {
      theme = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto';
      SV.store.saveTheme(theme);
      apply();
    });
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => { if (theme === 'auto' && state.transactions.length) renderData(); });
    apply();
  }

  function boot() {
    $('btn-load').addEventListener('click', () => $('file-input').click());
    $('btn-load-empty').addEventListener('click', () => $('file-input').click());
    $('file-input').addEventListener('change', (e) => { readFiles(e.target.files); e.target.value = ''; });
    $('btn-sample').addEventListener('click', loadSample);
    $('btn-sample-empty').addEventListener('click', loadSample);
    $('btn-clear').addEventListener('click', () => {
      if (window.confirm('Remove all loaded transaction data from this browser?')) clearData();
    });

    // drag & drop
    let dragDepth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('dropzone').hidden = false; });
    window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('dropzone').hidden = true; });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => {
      e.preventDefault(); dragDepth = 0; $('dropzone').hidden = true;
      if (e.dataTransfer?.files?.length) readFiles(e.dataTransfer.files);
    });

    window.addEventListener('resize', SV.debounce(() => { if (state.transactions.length) renderData(); }, 150));

    setupTheme();
    if (!restoreDataset()) renderAll();
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window.SV);
