const { getFriends, saveFriends, getSettings, saveSettings, getLastResult, saveLastResult } = require('../../utils/storage');

// chrome.storage.local mock
const mockStorage = {};
global.chrome = {
  storage: {
    local: {
      get: jest.fn((keys) => {
        return Promise.resolve(
          keys.reduce((acc, key) => {
            if (mockStorage[key] !== undefined) acc[key] = mockStorage[key];
            return acc;
          }, {})
        );
      }),
      set: jest.fn((obj) => {
        Object.assign(mockStorage, obj);
        return Promise.resolve();
      }),
    },
  },
};

beforeEach(() => {
  Object.keys(mockStorage).forEach((k) => delete mockStorage[k]);
  jest.clearAllMocks();
});

test('getFriends returns empty array when no friends saved', async () => {
  const friends = await getFriends();
  expect(friends).toEqual([]);
});

test('saveFriends and getFriends round-trip', async () => {
  const friends = [
    { name: '민수', preference: '힐링되는 고양이 릴스', username: 'minsu_cat' },
  ];
  await saveFriends(friends);
  const result = await getFriends();
  expect(result).toEqual(friends);
});

test('getSettings returns defaults when nothing saved', async () => {
  const settings = await getSettings();
  expect(settings).toEqual({
    apiKey: '',
    model: 'gpt-4o',
    confidenceThreshold: 0.5,
    dmDelayMin: 2000,
    dmDelayMax: 5000,
  });
});

test('saveSettings merges with defaults', async () => {
  await saveSettings({ apiKey: 'sk-test123' });
  const settings = await getSettings();
  expect(settings.apiKey).toBe('sk-test123');
  expect(settings.model).toBe('gpt-4o');
});

test('saveLastResult and getLastResult round-trip', async () => {
  const result = {
    totalReels: 10,
    matched: 3,
    skipped: 7,
    sent: [{ friend: '민수', reels: ['reel1'] }],
    failed: [],
  };
  await saveLastResult(result);
  const loaded = await getLastResult();
  expect(loaded).toEqual(result);
});
