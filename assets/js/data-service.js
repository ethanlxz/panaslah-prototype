// data-service.js — demo adapter (no network in demo mode)
import { state } from './state.js';

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

export const dataService = {
  async init() {
    const [site, sensors, readings] = await Promise.all([
      loadJSON('./assets/data/site.json'),
      loadJSON('./assets/data/sensors.json'),
      loadJSON('./assets/data/readings.json'),
    ]);
    state.site = site;
    state.sensors = sensors;
    state.readings = readings;
    return { site, sensors, readings };
  },

  getSensors() { return state.sensors; },
  getReadings() { return state.readings; },

  getLatestReadingBySensor(sensorId) {
    return state.readings
      .filter(r => r.sensorId === sensorId && r.quality === 'valid')
      .sort((a, b) => new Date(b.recordedAt) - new Date(a.recordedAt))[0] || null;
  },

  getReadingsForSensor(sensorId, limit = 20) {
    return state.readings
      .filter(r => r.sensorId === sensorId && r.quality === 'valid')
      .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt))
      .slice(-limit);
  },

  getHourlyReadings(sensorId) {
    // Return hourly trend readings (r-020 onwards for sensor-01)
    return state.readings
      .filter(r => r.sensorId === sensorId && r.quality === 'valid')
      .filter(r => {
        const h = new Date(r.recordedAt).getUTCMinutes();
        return h === 0;
      })
      .sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  },

  getSiteAverageTemp() {
    const onlineSensors = state.sensors.filter(s => s.status === 'online');
    const temps = onlineSensors
      .map(s => this.getLatestReadingBySensor(s.id))
      .filter(Boolean)
      .map(r => r.temperatureC);
    if (!temps.length) return null;
    return temps.reduce((a, b) => a + b, 0) / temps.length;
  },

  getSiteAverageHumidity() {
    const onlineSensors = state.sensors.filter(s => s.status === 'online');
    const hums = onlineSensors
      .map(s => this.getLatestReadingBySensor(s.id))
      .filter(Boolean)
      .map(r => r.humidityPct);
    if (!hums.length) return null;
    return hums.reduce((a, b) => a + b, 0) / hums.length;
  },

  getActiveSensorCount() {
    return state.sensors.filter(s => s.status === 'online').length;
  },

  resetDemo() {
    // Clear only panaslah-prefixed localStorage keys
    Object.keys(localStorage)
      .filter(k => k.startsWith('panaslah_'))
      .forEach(k => localStorage.removeItem(k));
    state.savedScenarios = [];
    state.emit('change:savedScenarios', []);
  }
};
