// storage.js — versioned localStorage scenario persistence
const STORAGE_KEY = 'panaslah_scenarios_v1';

export const storage = {
  loadScenarios() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveScenario(scenario) {
    try {
      const existing = this.loadScenarios();
      const idx = existing.findIndex(s => s.id === scenario.id);
      if (idx >= 0) existing[idx] = scenario;
      else existing.unshift(scenario);
      // Keep last 20
      const trimmed = existing.slice(0, 20);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
      return trimmed;
    } catch {
      return this.loadScenarios();
    }
  },

  deleteScenario(id) {
    try {
      const existing = this.loadScenarios().filter(s => s.id !== id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
      return existing;
    } catch {
      return [];
    }
  },

  clearAll() {
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith('panaslah_'))
        .forEach(k => localStorage.removeItem(k));
    } catch { /* unavailable */ }
  },

  isAvailable() {
    try {
      localStorage.setItem('panaslah_test', '1');
      localStorage.removeItem('panaslah_test');
      return true;
    } catch { return false; }
  }
};
