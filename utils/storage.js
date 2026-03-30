const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'claude-sonnet-4-6',
  confidenceThreshold: 0.5,
  dmDelayMin: 2000,
  dmDelayMax: 5000,
};

async function getFriends() {
  const { friends } = await chrome.storage.local.get(['friends']);
  return friends || [];
}

async function saveFriends(friends) {
  await chrome.storage.local.set({ friends });
}

async function getSettings() {
  const { settings } = await chrome.storage.local.get(['settings']);
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function saveSettings(partial) {
  const current = await getSettings();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ settings: merged });
}

async function getLastResult() {
  const { lastResult } = await chrome.storage.local.get(['lastResult']);
  return lastResult || null;
}

async function saveLastResult(result) {
  await chrome.storage.local.set({ lastResult: result });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getFriends, saveFriends, getSettings, saveSettings, getLastResult, saveLastResult, DEFAULT_SETTINGS };
}
