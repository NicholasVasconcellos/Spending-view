// SVG chart renderers. Design rules baked in:
//  - columns <= 24px wide, 4px rounded data-end, square at the baseline
//  - 2px surface gaps between stacked segments; 2px surface ring on markers
//  - 2px lines, round joins; hairline solid gridlines; recessive axes
//  - text wears text tokens (never series colors); tabular-nums on ticks
//  - crosshair + one tooltip listing every series at that X; keyboard focus
//    (arrow keys) shows the same readout
//  - every chart has a table-view twin rendered by the caller
(function (SV) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';

  function svg(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
    return n;
  }
  function colors(el) {
    const cs = getComputedStyle(el);
    const v = (name) => cs.getPropertyValue(name).trim();
    return {
      surface: v('--surface-1'), text: v('--text-primary'), text2: v('--text-secondary'),
      muted: v('--text-muted'), grid: v('--grid'), baseline: v('--axis'),
      series: [v('--series-1'), v('--series-2'), v('--series-3'), v('--series-4'), v('--series-5')],
      other: v('--series-other'), deemph: v('--deemph'), wash: v('--ghost-wash'),
    };
  }

  // nice tick step: 1/2/2.5/5 x 10^k
  function niceTicks(min, max, target) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const rough = span / target;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    let step = pow;
    for (const m of [1, 2, 2.5, 5, 10]) { if (rough <= m * pow) { step = m * pow; break; } }
    const ticks = [];
    const start = Math.ceil(min / step) * step;
    for (let t = start; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 100) / 100);
    return ticks;
  }

  // rounded-top column path (rounded at the data end, square at the baseline)
  function columnPath(x, y0, y1, w, r) {
    // y0 = baseline y, y1 = data-end y; works for values above or below zero
    const up = y1 < y0;
    r = Math.min(r, w / 2, Math.abs(y0 - y1));
    if (r <= 0.5) return `M${x},${y0} L${x},${y1} L${x + w},${y1} L${x + w},${y0} Z`;
    if (up) {
      return `M${x},${y0} L${x},${y1 + r} Q${x},${y1} ${x + r},${y1} L${x + w - r},${y1} Q${x + w},${y1} ${x + w},${y1 + r} L${x + w},${y0} Z`;
    }
    return `M${x},${y0} L${x},${y1 - r} Q${x},${y1} ${x + r},${y1} L${x + w - r},${y1} Q${x + w},${y1} ${x + w},${y1 - r} L${x + w},${y0} Z`;
  }
  function hbarPath(x0, x1, y, h, r) {
    r = Math.min(r, h / 2, Math.abs(x1 - x0));
    if (r <= 0.5) return `M${x0},${y} L${x1},${y} L${x1},${y + h} L${x0},${y + h} Z`;
    return `M${x0},${y} L${x1 - r},${y} Q${x1},${y} ${x1},${y + r} L${x1},${y + h - r} Q${x1},${y + h} ${x1 - r},${y + h} L${x0},${y + h} Z`;
  }

  // ---- shared tooltip -------------------------------------------------------
  const tip = {
    node: null,
    ensure() {
      if (!this.node) {
        this.node = document.createElement('div');
        this.node.className = 'sv-tooltip';
        this.node.setAttribute('role', 'status');
        document.body.appendChild(this.node);
      }
      return this.node;
    },
    // rows: [{key:'line'|'rect'|null, color, label, value, strong}]
    show(clientX, clientY, title, rows) {
      const n = this.ensure();
      n.textContent = '';
      const h = document.createElement('div');
      h.className = 'sv-tooltip-title';
      h.textContent = title;
      n.appendChild(h);
      for (const r of rows) {
        const row = document.createElement('div');
        row.className = 'sv-tooltip-row';
        if (r.key) {
          const k = document.createElement('span');
          k.className = r.key === 'line' ? 'sv-key-line' : 'sv-key-rect';
          k.style.backgroundColor = r.color;
          row.appendChild(k);
        }
        const val = document.createElement('span');
        val.className = 'sv-tooltip-value';
        val.textContent = r.value;
        const lab = document.createElement('span');
        lab.className = 'sv-tooltip-label';
        lab.textContent = r.label;
        row.appendChild(val);
        row.appendChild(lab);
        n.appendChild(row);
      }
      n.style.display = 'block';
      const pad = 14;
      const rect = n.getBoundingClientRect();
      let x = clientX + pad, y = clientY + pad;
      if (x + rect.width > window.innerWidth - 8) x = clientX - rect.width - pad;
      if (y + rect.height > window.innerHeight - 8) y = clientY - rect.height - pad;
      n.style.left = `${Math.max(4, x)}px`;
      n.style.top = `${Math.max(4, y)}px`;
    },
    hide() { if (this.node) this.node.style.display = 'none'; },
  };

  function legend(entries) {
    const box = document.createElement('div');
    box.className = 'sv-legend';
    for (const e of entries) {
      const item = document.createElement('span');
      item.className = 'sv-legend-item';
      const k = document.createElement('span');
      k.className = e.key === 'line' ? 'sv-key-line' : 'sv-key-rect';
      k.style.backgroundColor = e.color;
      const t = document.createElement('span');
      t.textContent = e.label;
      item.appendChild(k); item.appendChild(t);
      box.appendChild(item);
    }
    return box;
  }

  function xLabelStep(n, plotW) {
    const per = plotW / Math.max(1, n);
    return Math.max(1, Math.ceil(52 / per));
  }

  function axisAndGrid(root, C, M, plotW, plotH, ticks, yOf) {
    for (const t of ticks) {
      const y = yOf(t);
      if (t !== 0) root.appendChild(svg('line', { x1: M.l, x2: M.l + plotW, y1: y, y2: y, stroke: C.grid, 'stroke-width': 1 }));
      const lab = svg('text', { x: M.l - 8, y: y + 3.5, 'text-anchor': 'end', class: 'sv-tick' });
      lab.textContent = SV.fmt.usdCompact(t);
      root.appendChild(lab);
    }
    const zy = yOf(0);
    root.appendChild(svg('line', { x1: M.l, x2: M.l + plotW, y1: zy, y2: zy, stroke: C.baseline, 'stroke-width': 1 }));
  }

  // ---- 1) time chart: columns + rolling-average line ------------------------
  SV.charts = SV.charts || {};

  SV.charts.timeChart = function (container, { periods, rolling, rollingLabel }) {
    container.textContent = '';
    if (!periods.length) { container.appendChild(emptyNote()); return; }
    const C = colors(container);
    const W = Math.max(320, container.clientWidth);
    const H = 272;
    const M = { l: 56, r: 18, t: 26, b: 30 };
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;

    let vMin = 0, vMax = 0;
    for (const p of periods) { vMin = Math.min(vMin, p.total); vMax = Math.max(vMax, p.total); }
    for (const r of rolling) if (r.value != null) { vMin = Math.min(vMin, r.value); vMax = Math.max(vMax, r.value); }
    if (vMax === 0 && vMin === 0) vMax = 1;
    vMax *= 1.06; if (vMin < 0) vMin *= 1.08;
    const yOf = (v) => M.t + plotH - ((v - vMin) / (vMax - vMin)) * plotH;

    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'sv-svg', tabindex: 0, role: 'img' });
    root.setAttribute('aria-label', `Spending by period, ${periods.length} periods`);
    axisAndGrid(root, C, M, plotW, plotH, niceTicks(Math.min(0, vMin), vMax, 4), yOf);

    const n = periods.length;
    const band = plotW / n;
    const barW = Math.max(2, Math.min(24, band - Math.max(2, band * 0.25)));
    const centers = [];
    const zy = yOf(0);

    const barsG = svg('g');
    periods.forEach((p, i) => {
      const cx = M.l + band * i + band / 2;
      centers.push(cx);
      const x = cx - barW / 2;
      const y1 = yOf(p.total);
      const path = svg('path', { d: columnPath(x, zy, y1, barW, 4), fill: C.series[0] });
      barsG.appendChild(path);
    });
    root.appendChild(barsG);

    // rolling average line (slot 2)
    const linePts = [];
    rolling.forEach((r, i) => { if (r.value != null) linePts.push([centers[i], yOf(r.value), i]); });
    if (linePts.length > 1) {
      const d = linePts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      root.appendChild(svg('path', { d, fill: 'none', stroke: C.series[1], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      const end = linePts[linePts.length - 1];
      root.appendChild(svg('circle', { cx: end[0], cy: end[1], r: 6, fill: C.surface }));
      root.appendChild(svg('circle', { cx: end[0], cy: end[1], r: 4, fill: C.series[1] }));
    }

    // selective direct label: value on the last period's column
    const last = periods[n - 1];
    const lastLabel = svg('text', { x: centers[n - 1], y: yOf(Math.max(0, last.total)) - 7, 'text-anchor': n > 3 ? 'middle' : 'start', class: 'sv-value-label' });
    lastLabel.textContent = SV.fmt.usdCompact(last.total);
    root.appendChild(lastLabel);
    keepInPlot(lastLabel, M.l, W - M.r);

    // x labels
    const step = xLabelStep(n, plotW);
    periods.forEach((p, i) => {
      if ((n - 1 - i) % step !== 0) return;
      const t = svg('text', { x: centers[i], y: H - 9, 'text-anchor': 'middle', class: 'sv-tick' });
      t.textContent = p.label;
      root.appendChild(t);
    });

    // crosshair + tooltip + keyboard
    const cross = svg('line', { y1: M.t, y2: M.t + plotH, stroke: C.baseline, 'stroke-width': 1, visibility: 'hidden' });
    root.appendChild(cross);
    const readout = (i, cx, cy) => {
      const rows = [{ key: 'rect', color: C.series[0], label: 'Spending', value: SV.fmt.usd(periods[i].total) }];
      if (rolling[i] && rolling[i].value != null) rows.push({ key: 'line', color: C.series[1], label: rollingLabel, value: SV.fmt.usd(rolling[i].value) });
      rows.push({ key: null, label: 'transactions', value: String(periods[i].count) });
      tip.show(cx, cy, periods[i].label, rows);
      cross.setAttribute('x1', centers[i]); cross.setAttribute('x2', centers[i]);
      cross.setAttribute('visibility', 'visible');
    };
    attachCrosshair(root, centers, M, plotW, plotH, readout, () => { cross.setAttribute('visibility', 'hidden'); tip.hide(); });

    container.appendChild(root);
    container.appendChild(legend([
      { key: 'rect', color: C.series[0], label: 'Spending' },
      { key: 'line', color: C.series[1], label: rollingLabel },
    ]));
  };

  // ---- 2) stacked category columns -----------------------------------------
  // stack order from the baseline: Other (gray) first, then slots 1..5 -
  // gray sits next to slot-1 blue only (validated CVD-safe adjacency).
  SV.charts.stackedChart = function (container, { periods, series }) {
    container.textContent = '';
    if (!periods.length || !series.length) { container.appendChild(emptyNote()); return; }
    const C = colors(container);
    const W = Math.max(320, container.clientWidth);
    const H = 292;
    const M = { l: 56, r: 18, t: 16, b: 30 };
    const plotW = W - M.l - M.r, plotH = H - M.t - M.b;

    const colorOf = (s) => (s.slot === 0 ? C.other : C.series[s.slot - 1]);
    // baseline-first stack order: Other, then slot 1..5
    const stackOrder = [...series].sort((a, b) => (a.slot === 0 ? -1 : b.slot === 0 ? 1 : a.slot - b.slot));

    // negative nets (refund-heavy periods) can't stack; clamp to >= 0 in the
    // picture - the tooltip and table view carry the true signed values.
    const posVal = (s, i) => Math.max(0, s.values[i]);
    let vMax = 0;
    periods.forEach((p, i) => {
      let sum = 0;
      for (const s of stackOrder) sum += posVal(s, i);
      vMax = Math.max(vMax, sum);
    });
    if (vMax === 0) vMax = 1;
    vMax *= 1.06;
    const yOf = (v) => M.t + plotH - (v / vMax) * plotH;

    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'sv-svg', tabindex: 0, role: 'img' });
    root.setAttribute('aria-label', `Spending by category, ${periods.length} periods`);
    axisAndGrid(root, C, M, plotW, plotH, niceTicks(0, vMax, 4), yOf);

    const n = periods.length;
    const band = plotW / n;
    const barW = Math.max(2, Math.min(24, band - Math.max(2, band * 0.25)));
    const centers = [];
    const GAP = 2; // surface gap between segments

    const highlight = svg('rect', { y: M.t, height: plotH, fill: C.wash, visibility: 'hidden' });
    root.appendChild(highlight);

    periods.forEach((p, i) => {
      const cx = M.l + band * i + band / 2;
      centers.push(cx);
      const x = cx - barW / 2;
      let acc = 0;
      const segs = stackOrder.map((s) => ({ s, v: posVal(s, i) })).filter((e) => e.v > 0);
      segs.forEach((e, si) => {
        const y0 = yOf(acc), y1 = yOf(acc + e.v);
        const isTop = si === segs.length - 1;
        const yTop = isTop ? y1 : y1 + GAP / 2; // top segment keeps rounded end
        const yBot = si === 0 ? y0 : y0 - GAP / 2;
        if (yBot - yTop > 0.6) {
          const d = isTop
            ? columnPath(x, yBot, yTop, barW, 4)
            : `M${x},${yBot} L${x},${yTop} L${x + barW},${yTop} L${x + barW},${yBot} Z`;
          root.appendChild(svg('path', { d, fill: colorOf(e.s) }));
        }
        acc += e.v;
      });
    });

    const step = xLabelStep(n, plotW);
    periods.forEach((p, i) => {
      if ((n - 1 - i) % step !== 0) return;
      const t = svg('text', { x: centers[i], y: H - 9, 'text-anchor': 'middle', class: 'sv-tick' });
      t.textContent = p.label;
      root.appendChild(t);
    });

    // legend order mirrors the visual stack, top -> bottom
    const legendEntries = [...stackOrder].reverse().map((s) => ({ key: 'rect', color: colorOf(s), label: s.name }));

    const readout = (i, cx, cy) => {
      const rows = [];
      let total = 0;
      for (const s of [...stackOrder].reverse()) {
        const v = s.values[i]; total += v;
        if (Math.abs(v) < 0.005) continue;
        rows.push({ key: 'rect', color: colorOf(s), label: s.name, value: SV.fmt.usd(v) });
      }
      rows.push({ key: null, label: 'total', value: SV.fmt.usd(total) });
      tip.show(cx, cy, periods[i].label, rows);
      highlight.setAttribute('x', M.l + band * i);
      highlight.setAttribute('width', band);
      highlight.setAttribute('visibility', 'visible');
    };
    attachCrosshair(root, centers, M, plotW, plotH, readout, () => { highlight.setAttribute('visibility', 'hidden'); tip.hide(); });

    container.appendChild(root);
    container.appendChild(legend(legendEntries));
  };

  // ---- 3) horizontal bars (top merchants) ----------------------------------
  SV.charts.hbarChart = function (container, { items, onHoverRows }) {
    container.textContent = '';
    if (!items.length) { container.appendChild(emptyNote()); return; }
    const C = colors(container);
    const W = Math.max(320, container.clientWidth);
    const rowH = 32, barH = 18;
    const M = { l: 8, r: 70, t: 4, b: 4 };
    const labelW = Math.min(210, Math.max(120, W * 0.28));
    const H = M.t + M.b + items.length * rowH;
    const plotX = M.l + labelW;
    const plotW = W - plotX - M.r;
    const vMax = Math.max(...items.map((d) => Math.max(0, d.value)), 1) * 1.02;

    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'sv-svg', role: 'img' });
    root.setAttribute('aria-label', `Top ${items.length} merchants by spend`);

    items.forEach((d, i) => {
      const y = M.t + i * rowH + (rowH - barH) / 2;
      const w = Math.max(0, (Math.max(0, d.value) / vMax) * plotW);
      const name = svg('text', { x: plotX - 10, y: y + barH / 2 + 4, 'text-anchor': 'end', class: 'sv-bar-name' });
      name.textContent = d.label.length > 28 ? d.label.slice(0, 27) + '…' : d.label;
      root.appendChild(name);
      const g = svg('g', { tabindex: 0, class: 'sv-hbar-row' });
      // transparent full-row hit target (>= the mark)
      g.appendChild(svg('rect', { x: 0, y: M.t + i * rowH, width: W, height: rowH, fill: 'transparent' }));
      g.appendChild(svg('path', { d: hbarPath(plotX, plotX + Math.max(w, 1.5), y, barH, 4), fill: C.series[0] }));
      const val = svg('text', { x: plotX + Math.max(w, 1.5) + 8, y: y + barH / 2 + 4, class: 'sv-value-label' });
      val.textContent = SV.fmt.usdCompact(d.value);
      g.appendChild(val);
      const show = (cx, cy) => tip.show(cx, cy, d.label, onHoverRows ? onHoverRows(d) : [{ key: null, label: 'total', value: SV.fmt.usd(d.value) }]);
      g.addEventListener('pointermove', (e) => show(e.clientX, e.clientY));
      g.addEventListener('pointerleave', () => tip.hide());
      g.addEventListener('focus', () => { const r = g.getBoundingClientRect(); show(r.right - 80, r.top); });
      g.addEventListener('blur', () => tip.hide());
      root.appendChild(g);
    });
    container.appendChild(root);
  };

  // ---- 4) sparkline for stat tiles -----------------------------------------
  SV.charts.sparkline = function (container, values) {
    container.textContent = '';
    if (values.length < 2) return;
    const C = colors(container);
    const W = 120, H = 34, P = 4;
    const vMax = Math.max(...values, 1e-9), vMin = Math.min(...values, 0);
    const x = (i) => P + (i / (values.length - 1)) * (W - 2 * P);
    const y = (v) => H - P - ((v - vMin) / (vMax - vMin || 1)) * (H - 2 * P);
    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, class: 'sv-spark', 'aria-hidden': 'true' });
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    root.appendChild(svg('path', { d, fill: 'none', stroke: C.deemph, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const lastI = values.length - 1;
    root.appendChild(svg('circle', { cx: x(lastI), cy: y(values[lastI]), r: 5, fill: C.surface }));
    root.appendChild(svg('circle', { cx: x(lastI), cy: y(values[lastI]), r: 3.5, fill: C.series[0] }));
    container.appendChild(root);
  };

  // ---- shared interaction plumbing -----------------------------------------
  function attachCrosshair(root, centers, M, plotW, plotH, onIndex, onLeave) {
    let focusIdx = -1;
    const nearest = (px) => {
      let best = 0, bestD = Infinity;
      centers.forEach((c, i) => { const d = Math.abs(c - px); if (d < bestD) { bestD = d; best = i; } });
      return best;
    };
    root.addEventListener('pointermove', (e) => {
      const rect = root.getBoundingClientRect();
      const px = e.clientX - rect.left;
      if (px < M.l - 8 || px > M.l + plotW + 8) { onLeave(); return; }
      onIndex(nearest(px), e.clientX, e.clientY);
    });
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      if (focusIdx < 0) focusIdx = centers.length - 1;
      else focusIdx = Math.max(0, Math.min(centers.length - 1, focusIdx + (e.key === 'ArrowRight' ? 1 : -1)));
      const rect = root.getBoundingClientRect();
      onIndex(focusIdx, rect.left + centers[focusIdx], rect.top + M.t + plotH / 3);
    });
    root.addEventListener('blur', () => { focusIdx = -1; onLeave(); });
  }

  function keepInPlot(textEl, minX, maxX) {
    // nudge a direct label back inside the plot if it overflows the edge
    requestAnimationFrame(() => {
      try {
        const b = textEl.getBBox();
        if (b.x + b.width > maxX) textEl.setAttribute('x', Math.max(minX, maxX - b.width));
        if (b.x < minX) textEl.setAttribute('x', minX);
      } catch { /* detached */ }
    });
  }

  function emptyNote() {
    const d = document.createElement('div');
    d.className = 'sv-empty-chart';
    d.textContent = 'No transactions match the current filters.';
    return d;
  }

  SV.charts.hideTooltip = () => tip.hide();
})(window.SV);
