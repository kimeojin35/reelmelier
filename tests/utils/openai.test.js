const { classifyReel, buildMessages } = require('../../utils/openai');

// Mock global fetch
global.fetch = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
});

test('buildMessages creates correct message structure with image', () => {
  const friends = [
    { name: '민수', preference: '힐링되는 고양이 릴스' },
    { name: '지은', preference: '오타쿠 릴스' },
  ];
  const reelData = {
    caption: '우리 냥이 너무 귀엽다 #cat #healing',
    hashtags: ['cat', 'healing'],
    comments: ['귀여워!', '힐링된다'],
    audioTitle: 'Peaceful Piano',
    thumbnailUrl: 'https://example.com/thumb.jpg',
  };

  const messages = buildMessages(friends, reelData);

  expect(messages[0].role).toBe('system');
  expect(messages[0].content).toContain('릴스 분류기');
  expect(messages[1].role).toBe('user');
  const contentParts = messages[1].content;
  expect(Array.isArray(contentParts)).toBe(true);
  const imagePart = contentParts.find((p) => p.type === 'image_url');
  expect(imagePart.image_url.url).toBe('https://example.com/thumb.jpg');
  const textPart = contentParts.find((p) => p.type === 'text');
  expect(textPart.text).toContain('민수');
  expect(textPart.text).toContain('cat');
});

test('buildMessages works without thumbnail', () => {
  const friends = [{ name: '민수', preference: '고양이' }];
  const reelData = {
    caption: '고양이',
    hashtags: [],
    comments: [],
    audioTitle: '',
    thumbnailUrl: null,
  };

  const messages = buildMessages(friends, reelData);
  const contentParts = messages[1].content;
  const imagePart = contentParts.find((p) => p.type === 'image_url');
  expect(imagePart).toBeUndefined();
});

test('classifyReel parses API response correctly', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        choices: [
          {
            message: {
              content: JSON.stringify({
                matches: ['민수'],
                reason: '고양이가 등장',
                confidence: 0.9,
              }),
            },
          },
        ],
      }),
  });

  const result = await classifyReel('sk-test', 'gpt-4o', [], {
    caption: '',
    hashtags: [],
    comments: [],
    audioTitle: '',
    thumbnailUrl: null,
  });

  expect(result.matches).toEqual(['민수']);
  expect(result.confidence).toBe(0.9);
});

test('classifyReel returns empty matches on API error', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
  });

  const result = await classifyReel('sk-test', 'gpt-4o', [], {
    caption: '',
    hashtags: [],
    comments: [],
    audioTitle: '',
    thumbnailUrl: null,
  });

  expect(result.matches).toEqual([]);
  expect(result.error).toBeTruthy();
});

test('classifyReel returns empty matches on malformed JSON', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        choices: [{ message: { content: 'not json' } }],
      }),
  });

  const result = await classifyReel('sk-test', 'gpt-4o', [], {
    caption: '',
    hashtags: [],
    comments: [],
    audioTitle: '',
    thumbnailUrl: null,
  });

  expect(result.matches).toEqual([]);
  expect(result.error).toBeTruthy();
});
