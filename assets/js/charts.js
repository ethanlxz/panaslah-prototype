// charts.js — inline SVG chart renderer
/**
 * Render a small SVG line chart for temperature trends.
 * @param {HTMLElement} container
 * @param {Array<{label:string, value:number|null}>} points
 * @param {object} opts
 */
export function renderLineChart(container, points, opts = {}) {
  const {
    width = 400,
    height = 130,
    unit = '°C',
    color = '#EA580C',
    yLabel = 'Temp (°C)',
    showDots = true,
  } = opts;

  const PAD = { top: 12, right: 16, bottom: 32, left: 44 };
  const cw = width - PAD.left - PAD.right;
  const ch = height - PAD.top - PAD.bottom;

  const validPoints = points.filter(p => p.value != null);
  if (!validPoints.length) {
    container.innerHTML = `<div style="height:${height}px;display:flex;align-items:center;justify-content:center;color:#71717a;font-size:13px;">No data available</div>`;
    return;
  }

  const minY = Math.min(...validPoints.map(p => p.value)) - 1;
  const maxY = Math.max(...validPoints.map(p => p.value)) + 1;
  const rangeY = maxY - minY || 1;

  const xScale = (i) => (i / (points.length - 1)) * cw;
  const yScale = (v) => ch - ((v - minY) / rangeY) * ch;

  // Build polyline path (skip nulls)
  const segments = [];
  let current = [];
  for (let i = 0; i < points.length; i++) {
    if (points[i].value != null) {
      current.push(`${xScale(i).toFixed(1)},${yScale(points[i].value).toFixed(1)}`);
    } else {
      if (current.length) segments.push(current);
      current = [];
    }
  }
  if (current.length) segments.push(current);

  // Y axis ticks
  const ticks = 4;
  const tickLines = [];
  for (let i = 0; i <= ticks; i++) {
    const v = minY + (rangeY * i) / ticks;
    const y = yScale(v).toFixed(1);
    tickLines.push(`
      <line x1="0" y1="${y}" x2="${cw}" y2="${y}" stroke="#e4e4e7" stroke-width="1"/>
      <text x="-6" y="${y}" text-anchor="end" dominant-baseline="middle" font-size="10" fill="#71717a">${v.toFixed(0)}</text>
    `);
  }

  // X axis labels
  const xLabels = points.map((p, i) => {
    if (points.length <= 8 || i % Math.ceil(points.length / 6) === 0) {
      return `<text x="${xScale(i).toFixed(1)}" y="${ch + 18}" text-anchor="middle" font-size="10" fill="#71717a">${p.label}</text>`;
    }
    return '';
  }).join('');

  const polylines = segments.map(seg =>
    `<polyline points="${seg.join(' ')}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`
  ).join('');

  const dots = showDots ? validPoints.map((p, _i) => {
    const idx = points.indexOf(p);
    return `<circle cx="${xScale(idx).toFixed(1)}" cy="${yScale(p.value).toFixed(1)}" r="3" fill="${color}" stroke="white" stroke-width="1.5"/>`;
  }).join('') : '';

  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" style="overflow:visible" role="img" aria-label="${yLabel} trend chart">
      <g transform="translate(${PAD.left},${PAD.top})">
        ${tickLines.join('')}
        ${polylines}
        ${dots}
        ${xLabels}
        <text x="${-ch / 2}" y="-32" transform="rotate(-90)" text-anchor="middle" font-size="10" fill="#71717a">${yLabel}</text>
      </g>
    </svg>
  `;
}

/**
 * Render a mini sparkline (no axes).
 */
export function renderSparkline(container, values, opts = {}) {
  const { width = 80, height = 30, color = '#EA580C' } = opts;
  const valid = values.filter(v => v != null);
  if (!valid.length) { container.innerHTML = ''; return; }
  const minY = Math.min(...valid), maxY = Math.max(...valid);
  const rangeY = maxY - minY || 1;
  const xScale = (i) => (i / (values.length - 1)) * width;
  const yScale = (v) => height - ((v - minY) / rangeY) * height;
  const pts = values.map((v, i) => v != null ? `${xScale(i).toFixed(1)},${yScale(v).toFixed(1)}` : null).filter(Boolean).join(' ');
  container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5"/>
  </svg>`;
}
