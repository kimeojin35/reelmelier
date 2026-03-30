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

  const { system, userContent } = buildMessages(friends, reelData);

  expect(system).toContain('릴스 분류기');
  expect(Array.isArray(userContent)).toBe(true);
  const imagePart = userContent.find((p) => p.type === 'image');
  expect(imagePart.source.url).toBe('https://example.com/thumb.jpg');
  const textPart = userContent.find((p) => p.type === 'text');
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

  const { userContent } = buildMessages(friends, reelData);
  const imagePart = userContent.find((p) => p.type === 'image');
  expect(imagePart).toBeUndefined();
});

test('classifyReel with Claude parses response correctly', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        content: [
          {
            text: JSON.stringify({
              matches: ['민수'],
              reason: '고양이가 등장',
              confidence: 0.9,
            }),
          },
        ],
      }),
  });

  const result = await classifyReel('sk-ant-test', 'claude-sonnet-4-6', [], {
    caption: '',
    hashtags: [],
    comments: [],
    audioTitle: '',
    thumbnailUrl: null,
  });

  expect(result.matches).toEqual(['민수']);
  expect(result.confidence).toBe(0.9);
  // Verify it called Anthropic API
  expect(global.fetch).toHaveBeenCalledWith(
    'https://api.anthropic.com/v1/messages',
    expect.anything()
  );
});

test('classifyReel with GPT parses response correctly', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        choices: [
          {
            message: {
              content: JSON.stringify({
                matches: ['지은'],
                reason: '애니메이션 관련',
                confidence: 0.8,
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

  expect(result.matches).toEqual(['지은']);
  // Verify it called OpenAI API
  expect(global.fetch).toHaveBeenCalledWith(
    'https://api.openai.com/v1/chat/completions',
    expect.anything()
  );
});

test('classifyReel returns empty matches on API error', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
  });

  const result = await classifyReel('sk-test', 'claude-sonnet-4-6', [], {
    caption: '',
    hashtags: [],
    comments: [],
    audioTitle: '',
    thumbnailUrl: null,
  });

  expect(result.matches).toEqual([]);
  expect(result.error).toBeTruthy();
});

test('classifyReel handles markdown code block in response', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: () =>
      Promise.resolve({
        content: [
          {
            text: '```json\n{"matches": ["민수"], "reason": "고양이", "confidence": 0.7}\n```',
          },
        ],
      }),
  });

  const result = await classifyReel('sk-test', 'claude-sonnet-4-6', [], {
    caption: '',
    hashtags: [],
    comments: [],
    audioTitle: '',
    thumbnailUrl: null,
  });

  expect(result.matches).toEqual(['민수']);
  expect(result.confidence).toBe(0.7);
});
