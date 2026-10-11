// state.js — shared application state
export const state = {
  currentView: 'dashboard',
  dataMode: 'demo',   // 'demo' | 'api'
  site: null,
  sensors: [],
  readings: [],
  selectedZoneId: null,
  selectedSensorId: null,

  // Twin controls
  twinDate: '2025-11-10',
  twinHour: 14,
  activeLayers: { buildings: true, vegetation: true, shadows: true, exposure: true, sensors: true },

  // Scenario state
  scenario: {
    treePresetCount: 0,
    treeCanopySizeM: 6,
    canopyCoveragePct: 0,
  },

  savedScenarios: [],

  listeners: {},

  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  },

  emit(event, data) {
    (this.listeners[event] || []).forEach(fn => fn(data));
  },

  set(key, value) {
    this[key] = value;
    this.emit('change', { key, value });
    this.emit(`change:${key}`, value);
  }
};
