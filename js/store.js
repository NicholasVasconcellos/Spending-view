// localStorage persistence for user settings (category overrides, labels,
// excluded merchants, custom categories, theme) and the loaded dataset.
// Everything is wrapped in try/catch: storage can be unavailable or full,
// and the app must keep working without it.
(function (SV) {
  'use strict';

  const KEYS = {
    settings: 'spendingview.settings.v1',
    dataset: 'spendingview.dataset.v1',
    theme: 'spendingview.theme.v1',
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }
  function remove(key) { try { localStorage.removeItem(key); } catch { /* noop */ } }

  SV.store = {
    loadSettings() {
      const s = read(KEYS.settings, {}) || {};
      return {
        categoryOverrides: s.categoryOverrides || {},   // merchantKey -> category
        labels: s.labels || {},                         // merchantKey -> [label, ...]
        excluded: s.excluded || [],                     // [merchantKey, ...]
        customCategories: s.customCategories || [],     // [name, ...]
      };
    },
    saveSettings(settings) {
      return write(KEYS.settings, {
        categoryOverrides: settings.categoryOverrides,
        labels: settings.labels,
        excluded: [...settings.excluded],
        customCategories: settings.customCategories,
      });
    },

    // dataset is stored as the raw file texts so a refresh re-parses with the
    // current parser; the bundled sample is stored as a flag, not a copy.
    loadDataset() { return read(KEYS.dataset, null); },
    saveDataset(files, includesSample) {
      const payload = {
        includesSample: !!includesSample,
        files: files.filter((f) => !f.sample).map((f) => ({ name: f.name, hash: f.hash, text: f.text })),
      };
      return write(KEYS.dataset, payload);
    },
    clearDataset() { remove(KEYS.dataset); },

    loadTheme() { return read(KEYS.theme, 'auto'); },
    saveTheme(t) { write(KEYS.theme, t); },
  };
})(window.SV);
