// export.js — CSV serialization
export function buildScenarioCSV(scenario) {
  const lines = [];
  lines.push(['# Panaslah Digital Twin — Scenario Export']);
  lines.push(['# Exported at', new Date().toISOString()]);
  lines.push(['# Geometry version', scenario.geometryVersion]);
  lines.push(['# Model version', scenario.modelVersion]);
  lines.push(['# Note: Illustrative exposure score only. Not a calibrated thermal model.']);
  lines.push(['# Shaded area change uses percentage points. Temperature uses °C only where measured.']);
  lines.push([]);
  lines.push(['Scenario name', scenario.name]);
  lines.push(['Date', scenario.selectedDateTime]);
  lines.push(['Tree preset count', scenario.treePresetCount]);
  lines.push(['Canopy coverage (%)', scenario.canopyCoveragePct]);
  lines.push([]);
  lines.push(['Metric', 'Baseline', 'Proposal', 'Unit', 'Source']);

  const b = scenario.baselineResult;
  const p = scenario.proposalResult;

  lines.push(['Shaded pedestrian area', b.shadedPct.toFixed(1), p.shadedPct.toFixed(1), '%', 'Modelled (illustrative)']);
  lines.push(['Shaded area change', '', (p.shadedPct - b.shadedPct).toFixed(1), 'percentage points', 'Modelled']);
  lines.push(['Direct sun area', b.directSunAreaM2.toFixed(0), p.directSunAreaM2.toFixed(0), 'm²', 'Modelled']);
  if (b.exposureScore != null) {
    lines.push(['Illustrative exposure score', b.exposureScore, p.exposureScore, '0–100', 'Modelled (see methodology)']);
  }
  lines.push([]);
  lines.push(['# Assumptions: simplified geometric shadow projection; tree crowns are opaque circles;']);
  lines.push(['# no wind, radiant heat, or thermal mass modelled. See docs/model-assumptions.md.']);

  return lines.map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function downloadCSV(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
}
