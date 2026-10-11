// app.js — navigation, initialization, and view wiring
import { state } from './state.js';
import { dataService } from './data-service.js';
import { calcSunPosition, calcShadeMetrics, calcExposureScore, scoreLabel, scoreColor } from './calculations.js';
import { renderLineChart } from './charts.js';
import { storage } from './storage.js';
import { buildScenarioCSV, downloadCSV } from './export.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v, dec = 1) { return v != null ? v.toFixed(dec) : '—'; }
function fmtTime(iso) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false });
}
function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
}
function uid() { return 'sc-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

function statusBadge(status) {
  const dot = '<svg width="7" height="7" viewBox="0 0 7 7" aria-hidden="true"><circle cx="3.5" cy="3.5" r="3.5" fill="currentColor"/></svg>';
  const labels = { online: 'Online', stale: 'Stale', offline: 'Offline' };
  const cls = { online: 'status-online', stale: 'status-stale', offline: 'status-offline' };
  return `<span class="${cls[status] || 'status-offline'}" title="${labels[status] || status}">${dot} ${labels[status] || status}</span>`;
}

function sourceBadge(source) {
  return `<span style="background:#FFF7ED;color:#C2410C;font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;border:1px solid #FED7AA;">${source === 'measured' ? 'Measured' : 'Demo'}</span>`;
}

// ─── Navigation ───────────────────────────────────────────────────────────────

const VIEWS = ['dashboard', 'twin', 'scenarios', 'sensors'];

function navigate(view) {
  if (!VIEWS.includes(view)) view = 'dashboard';
  VIEWS.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.style.display = v === view ? 'block' : 'none';
  });
  document.querySelectorAll('.nav-link').forEach(a => {
    const isActive = a.dataset.view === view;
    a.classList.toggle('nav-active', isActive);
    a.setAttribute('aria-current', isActive ? 'page' : 'false');
  });
  state.set('currentView', view);
  // Lazy-init each view on first visit
  if (view === 'twin' && !window.panaslah._twinInit) {
    window.panaslah._twinInit = true;
    twin.render();
  }
  if (view === 'scenarios' && !window.panaslah._scenariosInit) {
    window.panaslah._scenariosInit = true;
    scenarios.init();
  }
  if (view === 'sensors') {
    sensors.render();
  }
  window.location.hash = view;
}

window.addEventListener('hashchange', () => {
  const view = window.location.hash.replace('#', '') || 'dashboard';
  navigate(view);
});

// ─── SVG Township renderer ────────────────────────────────────────────────────

function renderTownshipSVG(containerId, opts = {}) {
  const {
    mini = false,
    showShadows = true,
    showExposure = true,
    showSensors = true,
    treePresets = 0,
    canopyActive = false,
    selectedZoneId = null,
    selectedSensorId = null,
    hour = 14,
    date = '2025-11-10',
    onZoneClick = null,
    onSensorClick = null,
  } = opts;

  const site = state.site;
  if (!site) return;

  const VW = site.svgWidth;   // 800
  const VH = site.svgHeight;  // 640
  const sun = calcSunPosition(date, hour);
  const isNight = sun.elevationDeg <= 0;

  // Calculate shade metrics for exposure overlay
  const metrics = calcShadeMetrics(site, treePresets, canopyActive, sun);

  // Sky background
  let skyColor = isNight ? '#1e293b' : '#EFF6FF';
  if (hour >= 8 && hour < 10) skyColor = '#FFF7ED';
  if (hour >= 10 && hour < 14) skyColor = '#EFF6FF';
  if (hour >= 14 && hour < 17) skyColor = '#FFFBEB';
  if (hour >= 17) skyColor = '#FFF3E0';

  let svg = `<svg viewBox="0 0 ${VW} ${VH}" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;display:block;" role="img" aria-label="Panaslah Demo Township site map" class="township-svg">
  <rect width="${VW}" height="${VH}" fill="${skyColor}"/>`;

  // Ground
  svg += `<rect x="80" y="90" width="640" height="430" rx="8" fill="#E2E8F0"/>`;

  // Roads
  svg += `<rect x="80" y="150" width="640" height="40" fill="#CBD5E1" opacity=".7"/>`;  // north road
  svg += `<rect x="80" y="370" width="640" height="30" fill="#CBD5E1" opacity=".7"/>`;  // south road
  svg += `<rect x="285" y="90" width="30" height="430" fill="#CBD5E1" opacity=".7"/>`;  // west road
  svg += `<rect x="645" y="90" width="30" height="430" fill="#CBD5E1" opacity=".7"/>`;  // east road

  // Shadow polygons (from buildings)
  if (showShadows && !isNight) {
    svg += `<g id="shadow-layer" opacity=".35">`;
    site.buildings.forEach(b => {
      const fp = parseSVGPath(b.svgPath);
      const heightPx = (b.heightM / site.widthM) * VW * 1.5;
      const poly = projectShadowSVG(fp, heightPx, sun);
      if (poly) {
        const pts = poly.map(p => p.join(',')).join(' ');
        svg += `<polygon points="${pts}" fill="#64748b"/>`;
      }
    });
    svg += `</g>`;

    // Tree shadows
    svg += `<g id="tree-shadow-layer" opacity=".3">`;
    site.trees.forEach(t => {
      const s = projectTreeEllipse(t.cx, t.cy, t.r, t.r * 2.5, sun);
      if (s) svg += `<ellipse cx="${s.cx.toFixed(1)}" cy="${s.cy.toFixed(1)}" rx="${s.rx.toFixed(1)}" ry="${s.ry.toFixed(1)}" fill="#475569"/>`;
    });
    if (treePresets > 0) {
      const presetTrees = [
        { cx: 180, cy: 167, r: 18 }, { cx: 240, cy: 167, r: 18 }, { cx: 300, cy: 167, r: 18 },
        { cx: 360, cy: 167, r: 18 }, { cx: 420, cy: 167, r: 18 }
      ].slice(0, treePresets);
      presetTrees.forEach(t => {
        const s = projectTreeEllipse(t.cx, t.cy, t.r, t.r * 3, sun);
        if (s) svg += `<ellipse cx="${s.cx.toFixed(1)}" cy="${s.cy.toFixed(1)}" rx="${s.rx.toFixed(1)}" ry="${s.ry.toFixed(1)}" fill="#475569"/>`;
      });
    }
    svg += `</g>`;
  }

  // Zone overlays (heat / pedestrian)
  if (showExposure) {
    const heatData = getZoneHeatData(site, sun, treePresets, canopyActive);
    site.zones.forEach(z => {
      const heat = heatData[z.id] || 0;
      let heatFill = 'none';
      if (z.type === 'pedestrian') {
        if (heat > 0.66) heatFill = 'rgba(185,28,28,0.4)';
        else if (heat > 0.33) heatFill = 'rgba(251,146,60,0.4)';
        else heatFill = 'rgba(254,240,138,0.4)';
      }
      const isSelected = z.id === selectedZoneId;
      const stroke = isSelected ? '#EA580C' : (z.type === 'pedestrian' ? '#F97316' : '#94a3b8');
      const strokeW = isSelected ? 3 : 1;
      const strokeDash = isSelected ? '' : 'stroke-dasharray="4,3"';
      const clickHandler = onZoneClick ? `class="zone-overlay ${isSelected ? 'selected' : ''}" style="cursor:pointer;" tabindex="0" role="button" aria-label="${z.label} zone"` : '';
      svg += `<path d="${z.svgPath}" fill="${heatFill}" stroke="${stroke}" stroke-width="${strokeW}" ${strokeDash} ${clickHandler} data-zone-id="${z.id}"/>`;
    });
  } else {
    site.zones.forEach(z => {
      const isSelected = z.id === selectedZoneId;
      svg += `<path d="${z.svgPath}" fill="none" stroke="${isSelected ? '#EA580C' : '#94a3b8'}" stroke-width="${isSelected ? 3 : 1}" stroke-dasharray="${isSelected ? '' : '4,3'}" data-zone-id="${z.id}" style="cursor:pointer;" class="zone-overlay ${isSelected ? 'selected' : ''}" tabindex="0" role="button" aria-label="${z.label} zone"/>`;
    });
  }

  // Buildings
  site.buildings.forEach(b => {
    svg += `<path d="${b.svgPath}" fill="${b.fill}" stroke="#475569" stroke-width="1.5" opacity=".9"/>`;
    // Label
    const pts = parseSVGPath(b.svgPath);
    if (pts.length) {
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      if (!mini) svg += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-size="10" fill="#334155" font-weight="500">${b.label}</text>`;
    }
  });

  // Canopy overlay
  if (canopyActive) {
    svg += `<rect x="325" y="225" width="130" height="90" rx="6" fill="rgba(34,197,94,0.25)" stroke="#16a34a" stroke-width="2" stroke-dasharray="6,3"/>`;
    if (!mini) svg += `<text x="390" y="275" text-anchor="middle" font-size="10" fill="#15803d" font-weight="600">Canopy</text>`;
  }

  // Trees (existing)
  svg += `<g id="tree-layer">`;
  site.trees.forEach(t => {
    svg += `<circle cx="${t.cx}" cy="${t.cy}" r="${t.r}" fill="#4ade80" stroke="#16a34a" stroke-width="1.5" opacity=".9"/>`;
    svg += `<circle cx="${t.cx}" cy="${t.cy}" r="${t.r * 0.45}" fill="#15803d" opacity=".6"/>`;
  });
  // Preset trees
  if (treePresets > 0) {
    const presetTrees = [
      { cx: 180, cy: 167, r: 18 }, { cx: 240, cy: 167, r: 18 }, { cx: 300, cy: 167, r: 18 },
      { cx: 360, cy: 167, r: 18 }, { cx: 420, cy: 167, r: 18 }
    ].slice(0, treePresets);
    presetTrees.forEach(t => {
      svg += `<circle cx="${t.cx}" cy="${t.cy}" r="${t.r}" fill="#86efac" stroke="#16a34a" stroke-width="2" stroke-dasharray="4,2"/>`;
      if (!mini) svg += `<text x="${t.cx}" y="${t.cy + t.r + 10}" text-anchor="middle" font-size="9" fill="#166534">New tree</text>`;
    });
  }
  svg += `</g>`;

  // Zone labels
  if (!mini) {
    site.zones.forEach(z => {
      svg += `<text x="${z.cx}" y="${z.cy}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#334155" font-weight="600" pointer-events="none">${z.label}</text>`;
    });
  }

  // Sensor markers
  if (showSensors) {
    state.sensors.forEach(s => {
      const [px, py] = s.position;
      const latest = dataService.getLatestReadingBySensor(s.id);
      const temp = latest ? latest.temperatureC : null;
      const isSelected = s.id === selectedSensorId;
      const statusColor = s.status === 'online' ? '#15803d' : s.status === 'stale' ? '#d97706' : '#dc2626';
      const ringColor = isSelected ? '#EA580C' : statusColor;
      const clickAttr = onSensorClick ? `class="sensor-marker ${isSelected ? 'selected' : ''}" style="cursor:pointer;" tabindex="0" role="button" aria-label="Sensor ${s.label}"` : '';
      svg += `<g data-sensor-id="${s.id}" ${clickAttr}>
        <circle class="sensor-circle" cx="${px}" cy="${py}" r="14" fill="white" stroke="${ringColor}" stroke-width="2" opacity=".95"/>
        <text x="${px}" y="${py - 1}" text-anchor="middle" dominant-baseline="middle" font-size="${temp != null ? '9' : '10'}" fill="${ringColor}" font-weight="700">${temp != null ? temp.toFixed(1) : '?'}</text>
        ${temp != null ? `<text x="${px}" y="${py + 7}" text-anchor="middle" font-size="7" fill="${ringColor}">°C</text>` : ''}
        <circle cx="${px + 10}" cy="${py - 10}" r="4" fill="${statusColor}" stroke="white" stroke-width="1.5"/>
      </g>`;
    });
  }

  // Heat legend
  if (showExposure && !mini) {
    svg += `<g transform="translate(90, 520)">
      <rect width="180" height="28" rx="6" fill="white" opacity=".9" stroke="#E4E4E7"/>
      <text x="8" y="11" font-size="9" fill="#52525B" font-weight="600">HEAT EXPOSURE (illustrative)</text>
      <rect x="8" y="15" width="18" height="8" rx="2" fill="rgba(254,240,138,0.7)"/>
      <text x="29" y="21" font-size="8" fill="#52525B">Lower</text>
      <rect x="70" y="15" width="18" height="8" rx="2" fill="rgba(251,146,60,0.7)"/>
      <text x="91" y="21" font-size="8" fill="#52525B">Mid</text>
      <rect x="120" y="15" width="18" height="8" rx="2" fill="rgba(185,28,28,0.7)"/>
      <text x="141" y="21" font-size="8" fill="#52525B">Higher</text>
    </g>`;
  }

  // Sun indicator
  if (!mini && !isNight) {
    const azR = (sun.azimuthDeg * Math.PI) / 180;
    const r = 50;
    const cx = 745, cy = 120;
    const sx = cx + r * Math.sin(azR);
    const sy = cy - r * Math.cos(azR);
    svg += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#E4E4E7" stroke-width="1"/>`;
    svg += `<circle cx="${sx.toFixed(1)}" cy="${sy.toFixed(1)}" r="10" fill="#FBBF24" stroke="#F59E0B" stroke-width="1.5"/>`;
    svg += `<text x="${cx}" y="${cy + r + 12}" text-anchor="middle" font-size="9" fill="#71717a">Sun direction</text>`;
  }

  svg += `</svg>`;
  return svg;
}

// Helper: parse SVG path to array of [x,y]
function parseSVGPath(d) {
  const pts = [];
  const re = /[ML]\s*([\d.]+)[,\s]+([\d.]+)/g;
  let m;
  while ((m = re.exec(d)) !== null) pts.push([parseFloat(m[1]), parseFloat(m[2])]);
  return pts;
}

function projectShadowSVG(footprint, heightPx, sun) {
  if (sun.elevationDeg <= 0) return null;
  const elevR = (sun.elevationDeg * Math.PI) / 180;
  const azR = (sun.azimuthDeg * Math.PI) / 180;
  const shadowLen = heightPx / Math.tan(elevR);
  const dx = shadowLen * Math.sin(azR + Math.PI);
  const dy = -shadowLen * Math.cos(azR + Math.PI);
  const offset = footprint.map(([x, y]) => [x + dx, y + dy]);
  return [...footprint, ...offset];
}

function projectTreeEllipse(cx, cy, crownR, heightPx, sun) {
  if (sun.elevationDeg <= 0) return null;
  const elevR = (sun.elevationDeg * Math.PI) / 180;
  const azR = (sun.azimuthDeg * Math.PI) / 180;
  const shadowLen = heightPx / Math.tan(elevR);
  const dx = shadowLen * Math.sin(azR + Math.PI);
  const dy = -shadowLen * Math.cos(azR + Math.PI);
  return { cx: cx + dx * 0.7, cy: cy + dy * 0.7, rx: crownR * 1.2, ry: crownR * 0.7 };
}

function getZoneHeatData(site, sun, treePresets, canopyActive) {
  // Simplified per-zone exposure: 0=fully shaded, 1=fully exposed
  // We do a coarse single-point sample for each zone centroid
  const data = {};
  const isNight = sun.elevationDeg <= 0;
  if (isNight) {
    site.zones.forEach(z => { data[z.id] = 0; });
    return data;
  }

  // Build shade polygons
  const elevR = (sun.elevationDeg * Math.PI) / 180;
  const azR = (sun.azimuthDeg * Math.PI) / 180;
  const shadePolys = [];

  site.buildings.forEach(b => {
    const fp = parseSVGPath(b.svgPath);
    const hp = (b.heightM / site.widthM) * site.svgWidth * 1.5;
    const poly = projectShadowSVG(fp, hp, sun);
    if (poly) shadePolys.push(poly);
  });

  site.trees.forEach(t => {
    const s = projectTreeEllipse(t.cx, t.cy, t.r, t.r * 2.5, sun);
    if (s) shadePolys.push(ellipseToApproxPolygon(s.cx, s.cy, s.rx, s.ry, 12));
  });

  if (treePresets > 0) {
    [{ cx:180,cy:167,r:18 }, {cx:240,cy:167,r:18}, {cx:300,cy:167,r:18}, {cx:360,cy:167,r:18}, {cx:420,cy:167,r:18}]
      .slice(0, treePresets).forEach(t => {
        const s = projectTreeEllipse(t.cx, t.cy, t.r, t.r * 3, sun);
        if (s) shadePolys.push(ellipseToApproxPolygon(s.cx, s.cy, s.rx, s.ry, 12));
      });
  }

  if (canopyActive) {
    shadePolys.push([[325,225],[455,225],[455,315],[325,315]]);
  }

  site.zones.forEach(z => {
    const inShade = shadePolys.some(p => pointInPolygon(z.cx, z.cy, p));
    const hourFactor = Math.min(1, Math.abs(hour - 12) < 3 ? 1 : 0.6);
    data[z.id] = inShade ? 0.1 : 0.5 + hourFactor * 0.5;
  });

  return data;
}

function ellipseToApproxPolygon(cx, cy, rx, ry, n = 12) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let hour = 14;

// ─── Dashboard ────────────────────────────────────────────────────────────────
const dashboard = {
  render() {
    const avgTemp = dataService.getSiteAverageTemp();
    const avgHum = dataService.getSiteAverageHumidity();
    const activeCount = dataService.getActiveSensorCount();
    const total = state.sensors.length;

    // Last update
    const lastReadings = state.sensors
      .map(s => dataService.getLatestReadingBySensor(s.id))
      .filter(Boolean)
      .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
    if (lastReadings.length) {
      document.getElementById('last-update-label').textContent = `Last update: ${fmtTime(lastReadings[0].receivedAt)} (demo)`;
    }

    // Metrics
    document.getElementById('metric-temp').textContent = avgTemp != null ? avgTemp.toFixed(1) : '—';
    document.getElementById('metric-humidity').textContent = avgHum != null ? avgHum.toFixed(0) : '—';
    document.getElementById('metric-sensors').textContent = activeCount;
    document.getElementById('metric-sensors-total').textContent = total;

    // Shade metrics at 14:00
    const sun = calcSunPosition('2025-11-10', 14);
    const shade = calcShadeMetrics(state.site, 0, false, sun);
    document.getElementById('metric-shaded').textContent = shade.shadedPct.toFixed(0);

    // Dashboard mini map
    const mapEl = document.getElementById('dashboard-map');
    mapEl.innerHTML = renderTownshipSVG('dashboard-map', { mini: true, showSensors: true, showShadows: true, showExposure: true, hour: 14 });

    // Hotspot list
    const hotspots = state.site.zones.filter(z => z.type === 'pedestrian').map(z => {
      const sunZ = calcSunPosition('2025-11-10', 14);
      const shadeZ = calcShadeMetrics(state.site, 0, false, sunZ);
      return { z, score: calcExposureScore(avgTemp, shadeZ.shadedPct) };
    }).sort((a, b) => (b.score || 0) - (a.score || 0));

    const hotspotEl = document.getElementById('hotspot-list');
    hotspotEl.innerHTML = hotspots.map(({ z, score }) => `
      <div class="hotspot-item">
        <span style="font-weight:500;">${z.label}</span>
        <a href="#twin" onclick="window.panaslah.navigate('twin');window.panaslah.twin.selectZone('${z.id}')" style="font-size:12px;color:${scoreColor(score)};font-weight:600;text-decoration:none;cursor:pointer;">${scoreLabel(score)} exposure →</a>
      </div>`).join('');

    // Sensor status mini
    const sensorMiniEl = document.getElementById('sensor-status-mini');
    sensorMiniEl.innerHTML = state.sensors.map(s => {
      const r = dataService.getLatestReadingBySensor(s.id);
      return `<div class="hotspot-item" style="gap:8px;">
        <span style="font-size:13px;font-weight:500;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.label}</span>
        ${r ? `<span style="font-size:12px;color:#52525B;">${r.temperatureC.toFixed(1)}°C</span>` : ''}
        ${statusBadge(s.status)}
      </div>`;
    }).join('');

    // Trend chart
    const trendData = dataService.getHourlyReadings('sensor-01').map(r => ({
      label: fmtTime(r.recordedAt),
      value: r.temperatureC,
    }));
    const trendEl = document.getElementById('trend-chart');
    renderLineChart(trendEl, trendData, { width: 700, height: 140, yLabel: 'Temp (°C)', unit: '°C' });

    // Trend table
    const trendTableEl = document.getElementById('trend-table');
    trendTableEl.innerHTML = `<table style="width:100%;font-size:12px;">
      <thead><tr><th style="padding:6px 10px;text-align:left;border-bottom:1px solid #E4E4E7;">Time (UTC)</th><th style="padding:6px 10px;text-align:right;border-bottom:1px solid #E4E4E7;">Temp (°C)</th><th style="padding:6px 10px;text-align:right;border-bottom:1px solid #E4E4E7;">Source</th></tr></thead>
      <tbody>${trendData.map(p => `<tr><td style="padding:5px 10px;">${p.label}</td><td style="padding:5px 10px;text-align:right;font-variant-numeric:tabular-nums;">${p.value != null ? p.value.toFixed(1) : '—'}</td><td style="padding:5px 10px;text-align:right;">Demo</td></tr>`).join('')}</tbody>
    </table>`;
  }
};

// ─── Digital Twin ─────────────────────────────────────────────────────────────
const twin = {
  selectedZone: null,
  selectedSensor: null,

  render() {
    this._updateMap();
    this._bindControls();
  },

  _updateMap() {
    const el = document.getElementById('twin-map');
    if (!el) return;
    const date = document.getElementById('twin-date')?.value || '2025-11-10';
    const hourVal = parseInt(document.getElementById('twin-hour')?.value || '14');
    const showShadows = document.getElementById('layer-shadows')?.checked !== false;
    const showExposure = document.getElementById('layer-exposure')?.checked !== false;
    const showSensors = document.getElementById('layer-sensors')?.checked !== false;
    hour = hourVal;

    el.innerHTML = renderTownshipSVG('twin-map', {
      mini: false, showShadows, showExposure, showSensors,
      hour: hourVal, date,
      treePresets: state.scenario.treePresetCount,
      canopyActive: state.scenario.canopyCoveragePct > 0,
      selectedZoneId: this.selectedZone,
      selectedSensorId: this.selectedSensor,
      onZoneClick: true, onSensorClick: true,
    });

    // Bind click events
    el.querySelectorAll('[data-zone-id]').forEach(el => {
      el.addEventListener('click', () => this.selectZone(el.dataset.zoneId));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') this.selectZone(el.dataset.zoneId); });
    });
    el.querySelectorAll('[data-sensor-id]').forEach(el => {
      el.addEventListener('click', () => this.selectSensor(el.dataset.sensorId));
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') this.selectSensor(el.dataset.sensorId); });
    });

    // Sun info
    const sun = calcSunPosition(date, hourVal);
    const sunInfoEl = document.getElementById('sun-info');
    if (sunInfoEl) {
      if (sun.elevationDeg <= 0) {
        sunInfoEl.textContent = `Night — No direct sun. Time: ${hourVal}:00 MYT`;
      } else {
        sunInfoEl.textContent = `Sun: Azimuth ${sun.azimuthDeg.toFixed(0)}° · Elevation ${sun.elevationDeg.toFixed(0)}° · ${hourVal}:00 MYT (illustrative model)`;
      }
    }

    this._updateTextAlt(date, hourVal);
  },

  _updateTextAlt(date, hourVal) {
    const el = document.getElementById('twin-text-alt');
    if (!el) return;
    const sun = calcSunPosition(date, hourVal);
    const rows = state.site.zones.map(z => {
      const shade = calcShadeMetrics(state.site, state.scenario.treePresetCount, state.scenario.canopyCoveragePct > 0, sun);
      const sensor = state.sensors.find(s => s.zoneId === z.id);
      const reading = sensor ? dataService.getLatestReadingBySensor(sensor.id) : null;
      return `<tr>
        <td style="padding:6px 10px;">${z.label}</td>
        <td style="padding:6px 10px;">${z.type}</td>
        <td style="padding:6px 10px;">${z.areaM2} m²</td>
        <td style="padding:6px 10px;">${reading ? reading.temperatureC.toFixed(1) + ' °C' : '—'}</td>
        <td style="padding:6px 10px;">${state.site.pedestrianMask.includes(z.id) ? shade.shadedPct.toFixed(0) + '%' : '—'}</td>
      </tr>`;
    }).join('');
    el.innerHTML = `<table style="width:100%;font-size:12px;border-collapse:collapse;">
      <thead><tr style="background:#F9FAFB;">
        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #E4E4E7;">Zone</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #E4E4E7;">Type</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #E4E4E7;">Area (m²)</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #E4E4E7;">Latest Temp</th>
        <th style="padding:6px 10px;text-align:left;border-bottom:1px solid #E4E4E7;">Shaded (ped. zones)</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  },

  _bindControls() {
    const dateEl = document.getElementById('twin-date');
    const hourEl = document.getElementById('twin-hour');
    const hourLabel = document.getElementById('twin-hour-label');
    const layers = ['layer-shadows', 'layer-exposure', 'layer-sensors'];

    if (dateEl) dateEl.addEventListener('change', () => this._updateMap());
    if (hourEl) {
      hourEl.addEventListener('input', () => {
        if (hourLabel) hourLabel.textContent = `${hourEl.value}:00`;
        this._updateMap();
      });
    }
    layers.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => this._updateMap());
    });
  },

  selectZone(zoneId) {
    this.selectedZone = zoneId;
    this.selectedSensor = null;
    this._updateMap();
    const zone = state.site.zones.find(z => z.id === zoneId);
    if (!zone) return;

    const date = document.getElementById('twin-date')?.value || '2025-11-10';
    const hourVal = parseInt(document.getElementById('twin-hour')?.value || '14');
    const sun = calcSunPosition(date, hourVal);
    const shade = calcShadeMetrics(state.site, state.scenario.treePresetCount, state.scenario.canopyCoveragePct > 0, sun);
    const sensor = state.sensors.find(s => s.zoneId === zoneId);
    const reading = sensor ? dataService.getLatestReadingBySensor(sensor.id) : null;
    const score = calcExposureScore(reading?.temperatureC ?? null, shade.shadedPct);

    const panel = document.getElementById('zone-detail');
    const pedMask = state.site.pedestrianMask.includes(zoneId);
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <h3 style="font-size:15px;font-weight:600;margin:0;">${zone.label}</h3>
        <span style="font-size:11px;padding:2px 8px;border-radius:12px;background:#F1F5F9;color:#52525B;font-weight:500;">${zone.type}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
        <div class="metric-mini">
          <div class="metric-mini-label">Area</div>
          <div class="metric-mini-value" style="font-size:16px;">${zone.areaM2}</div>
          <div class="metric-mini-unit">m²</div>
        </div>
        ${pedMask && !shade.nighttime ? `<div class="metric-mini">
          <div class="metric-mini-label">Shaded</div>
          <div class="metric-mini-value" style="font-size:16px;">${shade.shadedPct.toFixed(0)}</div>
          <div class="metric-mini-unit">%</div>
        </div>` : `<div class="metric-mini">
          <div class="metric-mini-label">Shaded</div>
          <div class="metric-mini-value" style="font-size:16px;">${shade.nighttime ? '100' : '—'}</div>
          <div class="metric-mini-unit">${shade.nighttime ? '% (night)' : '%'}</div>
        </div>`}
      </div>
      ${reading ? `<div style="background:#F9FAFB;border-radius:8px;padding:10px 12px;font-size:13px;margin-bottom:10px;">
        <div style="font-size:11px;color:#71717a;margin-bottom:4px;">Nearest sensor — ${sensor?.label}</div>
        <div style="display:flex;gap:16px;">
          <span><b>${reading.temperatureC.toFixed(1)}°C</b> Temp</span>
          <span><b>${reading.humidityPct}%</b> Humidity</span>
        </div>
        <div style="font-size:11px;color:#71717a;margin-top:4px;">${sourceBadge(reading.source)} at ${fmtTime(reading.recordedAt)}</div>
      </div>` : '<div style="font-size:12px;color:#71717a;margin-bottom:10px;">No sensor in this zone</div>'}
      ${score != null ? `<div style="padding:8px 12px;border-radius:8px;background:${scoreColor(score)}18;border:1px solid ${scoreColor(score)}44;font-size:12px;">
        <span style="color:${scoreColor(score)};font-weight:700;">Illustrative exposure: ${score}/100 — ${scoreLabel(score)}</span>
        <br><span style="color:#71717a;font-size:11px;">Formula: 0.4 × temp_factor + 0.6 × direct_sun_fraction. Not a scientific model.</span>
      </div>` : ''}
    `;

    // Show intervention panel for pedestrian zones
    const intPanel = document.getElementById('intervention-panel');
    if (intPanel) {
      intPanel.style.display = pedMask ? 'block' : 'none';
      if (pedMask) {
        document.getElementById('intervention-content').innerHTML = `
          <div style="font-size:13px;color:#52525B;margin-bottom:10px;">Apply interventions in <a href="#scenarios" onclick="window.panaslah.navigate('scenarios')" style="color:#C2410C;">Scenarios view</a> to compare shade impact.</div>
          <a href="#scenarios" onclick="window.panaslah.navigate('scenarios')" class="btn-primary" style="text-decoration:none;display:inline-block;font-size:13px;padding:7px 14px;">Open Scenario Comparison</a>`;
      }
    }
  },

  selectSensor(sensorId) {
    this.selectedSensor = sensorId;
    this.selectedZone = null;
    this._updateMap();
    const sensor = state.sensors.find(s => s.id === sensorId);
    if (!sensor) return;
    const reading = dataService.getLatestReadingBySensor(sensorId);
    const panel = document.getElementById('zone-detail');
    panel.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
        <h3 style="font-size:15px;font-weight:600;margin:0;">${sensor.label}</h3>
        ${statusBadge(sensor.status)}
      </div>
      <div style="font-size:12px;color:#71717a;margin-bottom:10px;">Zone: ${state.site.zones.find(z => z.id === sensor.zoneId)?.label || sensor.zoneId} &nbsp;·&nbsp; ${sourceBadge(sensor.source)}</div>
      ${reading ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <div class="metric-mini">
          <div class="metric-mini-label">Temperature</div>
          <div class="metric-mini-value">${reading.temperatureC.toFixed(1)}</div>
          <div class="metric-mini-unit">°C</div>
        </div>
        <div class="metric-mini">
          <div class="metric-mini-label">Humidity</div>
          <div class="metric-mini-value">${reading.humidityPct}</div>
          <div class="metric-mini-unit">%</div>
        </div>
        ${reading.batteryVoltage ? `<div class="metric-mini">
          <div class="metric-mini-label">Battery</div>
          <div class="metric-mini-value">${reading.batteryVoltage.toFixed(2)}</div>
          <div class="metric-mini-unit">V</div>
        </div>` : ''}
      </div>
      <div style="font-size:11px;color:#71717a;">Last reading: ${fmtDateTime(reading.recordedAt)} UTC · quality: ${reading.quality}</div>` : '<div style="font-size:13px;color:#71717a;">No readings available.</div>'}
      <div style="font-size:11px;color:#71717a;margin-top:8px;">Sampling interval: ${sensor.samplingIntervalSec}s · Firmware: ${sensor.firmwareVersion}</div>
    `;
  },

  resetView() {
    this.selectedZone = null;
    this.selectedSensor = null;
    this._updateMap();
    const panel = document.getElementById('zone-detail');
    if (panel) panel.innerHTML = `<h3 style="font-size:14px;font-weight:600;margin:0 0 12px;color:#52525B;">Select a zone or sensor</h3><p style="font-size:13px;color:#71717a;margin:0;">Click on the map to inspect a zone's heat exposure or a sensor's latest reading.</p>`;
    const intPanel = document.getElementById('intervention-panel');
    if (intPanel) intPanel.style.display = 'none';
  }
};

// ─── Scenarios ────────────────────────────────────────────────────────────────
const scenarios = {
  init() {
    this._bindControls();
    this._update();
  },

  _bindControls() {
    const scDate = document.getElementById('sc-date');
    const scHour = document.getElementById('sc-hour');
    const scHourLabel = document.getElementById('sc-hour-label');
    const treeCount = document.getElementById('tree-count');
    const treeLabel = document.getElementById('tree-count-label');
    const canopyToggle = document.getElementById('canopy-toggle');
    const canopyLabel = document.getElementById('canopy-label');

    if (scDate) scDate.addEventListener('change', () => this._update());
    if (scHour) {
      scHour.addEventListener('input', () => {
        if (scHourLabel) scHourLabel.textContent = `${scHour.value}:00`;
        this._update();
      });
    }
    if (treeCount) {
      treeCount.addEventListener('input', () => {
        if (treeLabel) treeLabel.textContent = treeCount.value;
        state.scenario.treePresetCount = parseInt(treeCount.value);
        this._update();
      });
    }
    if (canopyToggle) {
      canopyToggle.addEventListener('change', () => {
        if (canopyLabel) canopyLabel.textContent = canopyToggle.checked ? 'On' : 'Off';
        state.scenario.canopyCoveragePct = canopyToggle.checked ? 80 : 0;
        this._update();
      });
    }
  },

  _getInputs() {
    const date = document.getElementById('sc-date')?.value || '2025-11-10';
    const hourVal = parseInt(document.getElementById('sc-hour')?.value || '14');
    const trees = state.scenario.treePresetCount;
    const canopy = state.scenario.canopyCoveragePct > 0;
    return { date, hourVal, trees, canopy };
  },

  _calcResults(date, hourVal, trees, canopy) {
    const sun = calcSunPosition(date, hourVal);
    const avgTemp = dataService.getSiteAverageTemp();
    const shade = calcShadeMetrics(state.site, trees, canopy, sun);
    const score = calcExposureScore(avgTemp, shade.shadedPct);
    return { ...shade, score, avgTemp, sun };
  },

  _miniMapSVG(trees, canopy, date, hourVal) {
    return renderTownshipSVG('mini', {
      mini: true, showShadows: true, showExposure: true, showSensors: false,
      hour: hourVal, date, treePresets: trees, canopyActive: canopy,
    });
  },

  _metricsHTML(results, accent = false) {
    const c = accent ? '#EA580C' : '#52525B';
    return `
      <div class="metric-mini">
        <div class="metric-mini-label">Shaded area</div>
        <div class="metric-mini-value" style="color:${c};">${results.shadedPct.toFixed(1)}</div>
        <div class="metric-mini-unit">% of pedestrian zones</div>
      </div>
      <div class="metric-mini">
        <div class="metric-mini-label">Direct sun area</div>
        <div class="metric-mini-value" style="color:${c};">${results.directSunAreaM2.toFixed(0)}</div>
        <div class="metric-mini-unit">m² exposed</div>
      </div>
      <div class="metric-mini">
        <div class="metric-mini-label">Illus. exposure score</div>
        <div class="metric-mini-value" style="color:${scoreColor(results.score)};">${results.score ?? '—'}</div>
        <div class="metric-mini-unit">/ 100 (illustrative)</div>
      </div>
      ${results.avgTemp != null ? `<div class="metric-mini">
        <div class="metric-mini-label">Avg air temp</div>
        <div class="metric-mini-value">${results.avgTemp.toFixed(1)}</div>
        <div class="metric-mini-unit">°C (measured/demo)</div>
      </div>` : ''}`;
  },

  _update() {
    const { date, hourVal, trees, canopy } = this._getInputs();
    const baseline = this._calcResults(date, hourVal, 0, false);
    const proposal = this._calcResults(date, hourVal, trees, canopy);

    // Mini maps
    const bMapEl = document.getElementById('baseline-map');
    if (bMapEl) bMapEl.innerHTML = this._miniMapSVG(0, false, date, hourVal);
    const pMapEl = document.getElementById('proposal-map');
    if (pMapEl) pMapEl.innerHTML = this._miniMapSVG(trees, canopy, date, hourVal);

    // Metrics
    const bMetrics = document.getElementById('baseline-metrics');
    if (bMetrics) bMetrics.innerHTML = this._metricsHTML(baseline, false);
    const pMetrics = document.getElementById('proposal-metrics');
    if (pMetrics) pMetrics.innerHTML = this._metricsHTML(proposal, true);

    // Comparison table
    const diff_shaded = proposal.shadedPct - baseline.shadedPct;
    const diff_exposed = proposal.directSunAreaM2 - baseline.directSunAreaM2;
    const diff_score = (proposal.score != null && baseline.score != null) ? proposal.score - baseline.score : null;

    const tableEl = document.getElementById('comparison-table');
    if (tableEl) {
      tableEl.innerHTML = `<table style="width:100%;font-size:13px;">
        <thead><tr style="background:#F9FAFB;"><th style="padding:8px 12px;text-align:left;border-bottom:1px solid #E4E4E7;">Metric</th><th style="padding:8px 12px;text-align:right;border-bottom:1px solid #E4E4E7;">Baseline</th><th style="padding:8px 12px;text-align:right;border-bottom:1px solid #E4E4E7;">Proposal</th><th style="padding:8px 12px;text-align:right;border-bottom:1px solid #E4E4E7;">Change</th><th style="padding:8px 12px;text-align:left;border-bottom:1px solid #E4E4E7;">Unit</th></tr></thead>
        <tbody>
          <tr><td style="padding:8px 12px;">Shaded pedestrian area</td><td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${baseline.shadedPct.toFixed(1)}</td><td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${proposal.shadedPct.toFixed(1)}</td><td style="padding:8px 12px;text-align:right;" class="${diff_shaded >= 0 ? 'diff-positive' : 'diff-negative'}">${diff_shaded >= 0 ? '+' : ''}${diff_shaded.toFixed(1)}</td><td style="padding:8px 12px;color:#71717a;">%</td></tr>
          <tr><td style="padding:8px 12px;">Direct sun area</td><td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${baseline.directSunAreaM2.toFixed(0)}</td><td style="padding:8px 12px;text-align:right;font-variant-numeric:tabular-nums;">${proposal.directSunAreaM2.toFixed(0)}</td><td style="padding:8px 12px;text-align:right;" class="${diff_exposed <= 0 ? 'diff-positive' : 'diff-negative'}">${diff_exposed >= 0 ? '+' : ''}${diff_exposed.toFixed(0)}</td><td style="padding:8px 12px;color:#71717a;">m²</td></tr>
          ${diff_score != null ? `<tr><td style="padding:8px 12px;">Illustrative exposure score</td><td style="padding:8px 12px;text-align:right;">${baseline.score}</td><td style="padding:8px 12px;text-align:right;">${proposal.score}</td><td style="padding:8px 12px;text-align:right;" class="${diff_score <= 0 ? 'diff-positive' : 'diff-negative'}">${diff_score >= 0 ? '+' : ''}${diff_score}</td><td style="padding:8px 12px;color:#71717a;">/100</td></tr>` : ''}
        </tbody>
      </table>`;
    }

    // Narrative
    const narrEl = document.getElementById('comparison-narrative');
    if (narrEl) {
      const parts = [];
      if (trees > 0) parts.push(`${trees} tree${trees > 1 ? 's' : ''} along the north walkway`);
      if (canopy) parts.push('a shade canopy over the playground');
      if (!parts.length) {
        narrEl.textContent = 'Add interventions (trees or canopy) to see a difference.';
        narrEl.style.background = '#F9FAFB';
        narrEl.style.borderColor = '#E4E4E7';
        narrEl.style.color = '#52525B';
      } else {
        narrEl.style.background = '#F0FDF4';
        narrEl.style.borderColor = '#BBF7D0';
        narrEl.style.color = '#166534';
        narrEl.innerHTML = `The proposed layout (${parts.join(' and ')}) increases shaded pedestrian area by <b>${diff_shaded.toFixed(1)} percentage points</b> at ${hourVal}:00 on ${date}. <span style="font-size:11px;opacity:.75;">Illustrative model — simplified geometric projection. Not a calibrated thermal simulation.</span>`;
      }
    }

    // Store latest result for save
    this._lastBaseline = baseline;
    this._lastProposal = proposal;

    // Saved list
    this._renderSavedList();
  },

  save() {
    const name = document.getElementById('scenario-name')?.value.trim() || `Scenario ${new Date().toLocaleTimeString()}`;
    const { date, hourVal, trees, canopy } = this._getInputs();
    const scenario = {
      id: uid(),
      name,
      geometryVersion: '1.0',
      modelVersion: '1.0',
      selectedDateTime: `${date}T${String(hourVal).padStart(2,'0')}:00:00+08:00`,
      siteTimezone: 'Asia/Kuala_Lumpur',
      treePresetCount: trees,
      treeCanopySizeM: state.scenario.treeCanopySizeM,
      canopyCoveragePct: state.scenario.canopyCoveragePct,
      baselineResult: this._lastBaseline,
      proposalResult: this._lastProposal,
      createdAt: new Date().toISOString(),
    };
    const saved = storage.saveScenario(scenario);
    state.savedScenarios = saved;
    this._renderSavedList();
    const btn = document.getElementById('save-scenario-btn');
    if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = 'Save scenario'; }, 2000); }
  },

  reset() {
    const treeEl = document.getElementById('tree-count');
    const canopyEl = document.getElementById('canopy-toggle');
    const canopyLabel = document.getElementById('canopy-label');
    const treeLabel = document.getElementById('tree-count-label');
    if (treeEl) { treeEl.value = '0'; if (treeLabel) treeLabel.textContent = '0'; }
    if (canopyEl) { canopyEl.checked = false; if (canopyLabel) canopyLabel.textContent = 'Off'; }
    state.scenario.treePresetCount = 0;
    state.scenario.canopyCoveragePct = 0;
    this._update();
  },

  exportCSV() {
    const { date, hourVal } = this._getInputs();
    const name = document.getElementById('scenario-name')?.value.trim() || 'Scenario';
    const csv = buildScenarioCSV({
      name,
      geometryVersion: '1.0',
      modelVersion: '1.0',
      selectedDateTime: `${date}T${String(hourVal).padStart(2,'0')}:00`,
      treePresetCount: state.scenario.treePresetCount,
      canopyCoveragePct: state.scenario.canopyCoveragePct,
      baselineResult: this._lastBaseline,
      proposalResult: this._lastProposal,
    });
    downloadCSV(`panaslah-scenario-${Date.now()}.csv`, csv);
  },

  _renderSavedList() {
    const list = storage.loadScenarios();
    const el = document.getElementById('saved-scenarios-list');
    if (!el) return;
    if (!list.length) {
      el.innerHTML = `<div style="padding:20px;text-align:center;font-size:13px;color:#71717a;background:white;border:1px solid #E4E4E7;border-radius:12px;">No saved scenarios. Save a comparison above to store it locally.</div>`;
      return;
    }
    el.innerHTML = list.map(s => `
      <div class="card" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 18px;margin-bottom:10px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:600;">${s.name}</div>
          <div style="font-size:12px;color:#71717a;margin-top:2px;">${fmtDateTime(s.createdAt)} · Trees: ${s.treePresetCount} · Canopy: ${s.canopyCoveragePct > 0 ? 'Yes' : 'No'}</div>
        </div>
        <div style="font-size:13px;color:#52525B;">
          Shaded: ${s.proposalResult?.shadedPct.toFixed(1)}% (was ${s.baselineResult?.shadedPct.toFixed(1)}%)
        </div>
        <button onclick="window.panaslah.scenarios.deleteScenario('${s.id}')" style="font-size:12px;color:#B91C1C;background:none;border:1px solid #FECACA;padding:4px 10px;border-radius:8px;cursor:pointer;">Delete</button>
      </div>`).join('');
  },

  deleteScenario(id) {
    storage.deleteScenario(id);
    this._renderSavedList();
  },
};

// ─── Sensors ──────────────────────────────────────────────────────────────────
const sensors = {
  render() {
    const filterSource = document.getElementById('filter-source')?.value || '';
    const filterStatus = document.getElementById('filter-status')?.value || '';

    let list = state.sensors;
    if (filterSource) list = list.filter(s => s.source === filterSource);
    if (filterStatus) list = list.filter(s => s.status === filterStatus);

    const tbody = document.getElementById('sensors-tbody');
    if (!tbody) return;

    if (!list.length) {
      tbody.innerHTML = `<tr><td colspan="9" style="padding:28px;text-align:center;color:#71717a;font-size:13px;">No sensors match the current filter.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map(s => {
      const reading = dataService.getLatestReadingBySensor(s.id);
      const zone = state.site.zones.find(z => z.id === s.zoneId);
      return `<tr>
        <td style="padding:12px 16px;font-size:13px;font-weight:500;">${s.label}<br><span style="font-size:11px;color:#71717a;font-weight:400;">${s.id}</span></td>
        <td style="padding:12px 16px;font-size:13px;">${zone?.label || s.zoneId}</td>
        <td style="padding:12px 16px;">${sourceBadge(s.source)}</td>
        <td style="padding:12px 16px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums;">${reading ? reading.temperatureC.toFixed(1) : '—'}</td>
        <td style="padding:12px 16px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums;">${reading ? reading.humidityPct : '—'}</td>
        <td style="padding:12px 16px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums;">${s.batteryVoltage != null ? s.batteryVoltage.toFixed(2) : '—'}</td>
        <td style="padding:12px 16px;font-size:12px;color:#52525B;">${fmtDateTime(s.lastSeenAt)}</td>
        <td style="padding:12px 16px;">${statusBadge(s.status)}</td>
        <td style="padding:12px 16px;"><button onclick="window.panaslah.sensors.openDrawer('${s.id}')" style="font-size:12px;color:#C2410C;background:none;border:1px solid #FED7AA;padding:4px 10px;border-radius:8px;cursor:pointer;">Details</button></td>
      </tr>`;
    }).join('');

    // Bind filter changes
    document.getElementById('filter-source')?.addEventListener('change', () => this.render());
    document.getElementById('filter-status')?.addEventListener('change', () => this.render());
  },

  openDrawer(sensorId) {
    const sensor = state.sensors.find(s => s.id === sensorId);
    if (!sensor) return;
    const readings = dataService.getReadingsForSensor(sensorId);
    const latest = dataService.getLatestReadingBySensor(sensorId);
    const zone = state.site.zones.find(z => z.id === sensor.zoneId);

    const titleEl = document.getElementById('drawer-title');
    if (titleEl) titleEl.textContent = sensor.label;

    const contentEl = document.getElementById('drawer-content');
    if (contentEl) {
      contentEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:14px;">
          <div class="metric-mini"><div class="metric-mini-label">Status</div><div style="margin-top:4px;">${statusBadge(sensor.status)}</div></div>
          <div class="metric-mini"><div class="metric-mini-label">Source</div><div style="margin-top:4px;">${sourceBadge(sensor.source)}</div></div>
          <div class="metric-mini"><div class="metric-mini-label">Zone</div><div style="font-size:14px;font-weight:600;margin-top:2px;">${zone?.label || '—'}</div></div>
          <div class="metric-mini"><div class="metric-mini-label">Sampling</div><div style="font-size:14px;font-weight:600;margin-top:2px;">${sensor.samplingIntervalSec}s</div></div>
          ${latest ? `<div class="metric-mini"><div class="metric-mini-label">Latest Temp</div><div class="metric-mini-value">${latest.temperatureC.toFixed(1)}</div><div class="metric-mini-unit">°C</div></div>` : ''}
          ${latest ? `<div class="metric-mini"><div class="metric-mini-label">Latest Humidity</div><div class="metric-mini-value">${latest.humidityPct}</div><div class="metric-mini-unit">%</div></div>` : ''}
          ${sensor.batteryVoltage != null ? `<div class="metric-mini"><div class="metric-mini-label">Battery</div><div class="metric-mini-value" style="${sensor.batteryVoltage < 3.5 ? 'color:#B91C1C;' : ''}">${sensor.batteryVoltage.toFixed(2)}</div><div class="metric-mini-unit">V ${sensor.batteryVoltage < 3.5 ? '⚠ Low' : ''}</div></div>` : ''}
          <div class="metric-mini"><div class="metric-mini-label">Firmware</div><div style="font-size:14px;font-weight:600;margin-top:2px;">${sensor.firmwareVersion}</div></div>
        </div>
        <div style="font-size:12px;color:#71717a;">Last seen: ${fmtDateTime(sensor.lastSeenAt)} UTC</div>
      `;
    }

    const chartEl = document.getElementById('drawer-chart');
    if (chartEl) {
      const { renderLineChart } = window._charts || {};
      const points = readings.map(r => ({ label: fmtTime(r.recordedAt), value: r.temperatureC }));
      import('./charts.js').then(({ renderLineChart }) => {
        renderLineChart(chartEl, points, { width: 500, height: 130, yLabel: 'Temp (°C)' });
      });
    }

    const drawer = document.getElementById('sensor-drawer');
    if (drawer) drawer.style.display = 'block';
    drawer?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  closeDrawer() {
    const drawer = document.getElementById('sensor-drawer');
    if (drawer) drawer.style.display = 'none';
  },

  replayDemo() {
    // Simulate a stale reading coming back online (demo effect)
    const s03 = state.sensors.find(s => s.id === 'sensor-03');
    if (s03) {
      s03.status = 'online';
      s03.lastSeenAt = new Date().toISOString();
    }
    this.render();
    const btn = document.querySelector('[onclick*="replayDemo"]');
    if (btn) { btn.textContent = 'Replaying… ✓'; setTimeout(() => { btn.textContent = 'Replay demo readings'; }, 3000); }
  },
};

// ─── Reset demo ───────────────────────────────────────────────────────────────
function resetDemo() {
  dataService.resetDemo();
  // Re-load data and re-render
  dataService.init().then(() => {
    dashboard.render();
    if (window.panaslah._twinInit) twin.render();
    if (window.panaslah._scenariosInit) scenarios._update();
    sensors.render();
    const btn = document.getElementById('reset-demo-btn');
    if (btn) { btn.textContent = 'Reset ✓'; setTimeout(() => { btn.textContent = 'Reset Demo'; }, 2000); }
  });
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────
async function init() {
  await dataService.init();

  // Expose public API
  window.panaslah = { navigate, twin, scenarios, sensors, resetDemo, _twinInit: false, _scenariosInit: false };

  // Render dashboard (always first)
  dashboard.render();

  // Navigate to current hash or dashboard
  const hash = window.location.hash.replace('#', '') || 'dashboard';
  navigate(hash);
}

init().catch(err => {
  document.body.innerHTML = `<div style="padding:40px;font-family:system-ui;color:#B91C1C;"><h2>Failed to load prototype data</h2><p>${err.message}</p><p>Serve this over HTTP (not file://) so JSON fixtures can be fetched.</p></div>`;
});
