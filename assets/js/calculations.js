// calculations.js — sun, shade, and illustrative exposure
// All geometry in SVG coordinate space (pixels mapping to site metres)

/**
 * Calculate sun azimuth & elevation for Kuala Lumpur (lat 3.1°) on a given date/hour.
 * This is a simplified model for demo purposes.
 * Returns { azimuthDeg, elevationDeg }
 */
export function calcSunPosition(dateStr, hourLocal) {
  const lat = 3.1;
  const dayOfYear = getDayOfYear(dateStr);
  const declination = 23.45 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81));
  const hourAngle = (hourLocal - 12) * 15; // degrees

  const latR = (lat * Math.PI) / 180;
  const decR = (declination * Math.PI) / 180;
  const haR = (hourAngle * Math.PI) / 180;

  const sinElev =
    Math.sin(latR) * Math.sin(decR) +
    Math.cos(latR) * Math.cos(decR) * Math.cos(haR);
  const elevationDeg = (Math.asin(sinElev) * 180) / Math.PI;

  const cosAz =
    (Math.sin(decR) - Math.sin(latR) * sinElev) /
    (Math.cos(latR) * Math.cos(Math.asin(sinElev)));
  let azimuthDeg = (Math.acos(Math.max(-1, Math.min(1, cosAz))) * 180) / Math.PI;
  if (hourAngle > 0) azimuthDeg = 360 - azimuthDeg;

  return { azimuthDeg, elevationDeg };
}

function getDayOfYear(dateStr) {
  const d = new Date(dateStr);
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d - start) / 86400000);
}

/**
 * Project a building/occluder shadow polygon in SVG space.
 * footprint: array of [x,y] SVG points (polygon vertices)
 * heightPx: height of occluder in SVG units (proportional to metres)
 * sun: { azimuthDeg, elevationDeg }
 * Returns array of [x,y] shadow polygon points.
 */
export function projectShadow(footprint, heightPx, sun) {
  if (sun.elevationDeg <= 0) return null; // nighttime / below horizon
  const elevR = (sun.elevationDeg * Math.PI) / 180;
  const azR = (sun.azimuthDeg * Math.PI) / 180;
  const shadowLength = heightPx / Math.tan(elevR);
  // Shadow offset direction: opposite to sun azimuth
  const dx = shadowLength * Math.sin(azR + Math.PI);
  const dy = -shadowLength * Math.cos(azR + Math.PI); // SVG y is inverted

  // Combine footprint with its offset to form the shadow polygon (convex hull-ish)
  const offsetPts = footprint.map(([x, y]) => [x + dx, y + dy]);
  return [...footprint, ...offsetPts];
}

/**
 * Project a circular tree crown shadow.
 * Returns { cx, cy, rx, ry } of an ellipse, or null at night.
 */
export function projectTreeShadow(treeCx, treeCy, crownRadiusPx, heightPx, sun) {
  if (sun.elevationDeg <= 0) return null;
  const elevR = (sun.elevationDeg * Math.PI) / 180;
  const azR = (sun.azimuthDeg * Math.PI) / 180;
  const shadowLength = heightPx / Math.tan(elevR);
  const dx = shadowLength * Math.sin(azR + Math.PI);
  const dy = -shadowLength * Math.cos(azR + Math.PI);
  return {
    cx: treeCx + dx * 0.7,
    cy: treeCy + dy * 0.7,
    rx: crownRadiusPx * 1.2,
    ry: crownRadiusPx * 0.7,
  };
}

/**
 * Point-in-polygon test (ray casting).
 */
function pointInPolygon(px, py, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Parse an SVG path "M x,y L x,y ..." into array of [x,y] points.
 */
function parseSVGPath(d) {
  const pts = [];
  const re = /[ML]\s*([\d.]+)[,\s]+([\d.]+)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    pts.push([parseFloat(m[1]), parseFloat(m[2])]);
  }
  return pts;
}

/**
 * Sample a grid over pedestrian zones and calculate shaded fraction.
 * Returns { shadedPct, directSunAreaM2, totalAreaM2, sampleCount, shadedCount }
 */
export function calcShadeMetrics(site, treePresets, canopyActive, sun) {
  const STEP = 15; // grid step in SVG px
  const svgW = site.svgWidth;
  const svgH = site.svgHeight;
  const scaleM = site.widthM / svgW; // metres per SVG px

  if (sun.elevationDeg <= 0) {
    const totalM2 = site.zones
      .filter(z => site.pedestrianMask.includes(z.id))
      .reduce((a, z) => a + z.areaM2, 0);
    return { shadedPct: 100, directSunAreaM2: 0, totalAreaM2: totalM2, sampleCount: 1, shadedCount: 1, nighttime: true };
  }

  // Build pedestrian zone polygons
  const pedPolygons = site.zones
    .filter(z => site.pedestrianMask.includes(z.id))
    .map(z => parseSVGPath(z.svgPath));

  // Build shade polygons from buildings
  const shadePolygons = [];

  site.buildings.forEach(b => {
    const fp = parseSVGPath(b.svgPath);
    const heightPx = (b.heightM / site.widthM) * svgW * 1.5;
    const poly = projectShadow(fp, heightPx, sun);
    if (poly) shadePolygons.push(poly);
  });

  // Existing trees
  site.trees.forEach(t => {
    const s = projectTreeShadow(t.cx, t.cy, t.r, t.r * 2.5, sun);
    if (s) {
      // Approximate ellipse as polygon
      const poly = ellipseToPolygon(s.cx, s.cy, s.rx, s.ry, 12);
      shadePolygons.push(poly);
    }
  });

  // Preset interventions
  if (treePresets > 0) {
    // Trees along north walkway
    const presetTrees = [
      { cx: 180, cy: 167, r: 18 },
      { cx: 240, cy: 167, r: 18 },
      { cx: 300, cy: 167, r: 18 },
      { cx: 360, cy: 167, r: 18 },
      { cx: 420, cy: 167, r: 18 },
    ].slice(0, treePresets);
    presetTrees.forEach(t => {
      const s = projectTreeShadow(t.cx, t.cy, t.r, t.r * 3, sun);
      if (s) shadePolygons.push(ellipseToPolygon(s.cx, s.cy, s.rx, s.ry, 12));
    });
  }

  if (canopyActive) {
    // Canopy over playground
    const canopyPoly = [[325, 225], [455, 225], [455, 315], [325, 315]];
    shadePolygons.push(canopyPoly);
  }

  // Sample grid
  let total = 0, shaded = 0;
  for (let x = 0; x < svgW; x += STEP) {
    for (let y = 0; y < svgH; y += STEP) {
      const inPed = pedPolygons.some(p => pointInPolygon(x, y, p));
      if (!inPed) continue;
      total++;
      const inShade = shadePolygons.some(p => pointInPolygon(x, y, p));
      if (inShade) shaded++;
    }
  }

  if (total === 0) return { shadedPct: 0, directSunAreaM2: 0, totalAreaM2: 0, sampleCount: 0, shadedCount: 0 };

  const cellM2 = STEP * scaleM * STEP * scaleM;
  const totalAreaM2 = total * cellM2;
  const directSunAreaM2 = (total - shaded) * cellM2;
  const shadedPct = (shaded / total) * 100;

  return { shadedPct, directSunAreaM2, totalAreaM2, sampleCount: total, shadedCount: shaded };
}

function ellipseToPolygon(cx, cy, rx, ry, n = 16) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/**
 * Illustrative exposure score (0–100).
 * temperature_factor = clamp((T - 25) / 15, 0, 1)
 * direct_sun_fraction = 1 - shadedPct / 100
 * score = round(100 * (0.4 * temp + 0.6 * sun))
 */
export function calcExposureScore(tempC, shadedPct) {
  if (tempC == null) return null;
  const tempFactor = Math.max(0, Math.min(1, (tempC - 25) / 15));
  const sunFraction = 1 - shadedPct / 100;
  return Math.round(100 * (0.4 * tempFactor + 0.6 * sunFraction));
}

export function scoreLabel(score) {
  if (score == null) return 'N/A';
  if (score < 30) return 'Low';
  if (score < 60) return 'Moderate';
  return 'High';
}

export function scoreColor(score) {
  if (score == null) return '#94a3b8';
  if (score < 30) return '#15803d';
  if (score < 60) return '#d97706';
  return '#b91c1c';
}
