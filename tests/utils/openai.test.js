const { classifyReel, buildMessages } = require('../../utils/openai');

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
    thumbnailBase64: { base64: 'abc123', mediaType: 'image/jpeg' },
  };

  const { system, userContent } = buildMessages(friends, reelData, true);

  expect(system).toContain('릴스 분류기');
  const imagePart = userContent.find((p) => p.type === 'image');
  expect(imagePart.source.type).toBe('base64');
  expect(imagePart.source.data).toBe('abc123');
  const textPart = userContent.find((p) => p.type === 'text');
  expect(textPart.text).toContain('민수');
  expect(textPart.text).toContain('cat');
});

test('buildMessages works without thumbnail', () => {
  const { userContent } = buildMessages(
    [{ name: '민수', preference: '고양이' }],
    { caption: '고양이', hashtags: [], comments: [], audioTitle: '', thumbnailUrl: null },
    true
  );
  expect(userContent.find((p) => p.type === 'image')).toBeUndefined();
});

test('classifyReel parses Claude response correctly', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      content: [{ text: '{"matches":["민수"],"reason":"고양이가 등장","confidence":0.9}' }],
    }),
  });

  const result = await classifyReel('sk-ant-test', 'claude-sonnet-4-6', [], {
    caption: '고양이', hashtags: [], comments: [], audioTitle: '', thumbnailUrl: null,
  });

  expect(result.matches).toEqual(['민수']);
  expect(result.confidence).toBe(0.9);
  expect(global.fetch).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.anything());
});

test('classifyReel returns error on API failure', async () => {
  global.fetch.mockResolvedValueOnce({ ok: false, status: 429, json: () => Promise.resolve({ error: { message: 'rate limited' } }) });

  const result = await classifyReel('sk-ant-test', 'claude-sonnet-4-6', [], {
    caption: '', hashtags: [], comments: [], audioTitle: '', thumbnailUrl: null,
  });

  expect(result.matches).toEqual([]);
  expect(result.error).toContain('429');
});

test('classifyReel handles markdown code block', async () => {
  global.fetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve({
      content: [{ text: '```json\n{"matches":["민수"],"reason":"고양이","confidence":0.7}\n```' }],
    }),
  });

  const result = await classifyReel('sk-ant-test', 'claude-sonnet-4-6', [], {
    caption: '고양이', hashtags: [], comments: [], audioTitle: '', thumbnailUrl: null,
  });

  expect(result.matches).toEqual(['민수']);
  expect(result.confidence).toBe(0.7);
});

test('classifyReel retries without image on 400', async () => {
  global.fetch
    .mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({}) })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: '{"matches":["지은"],"reason":"애니","confidence":0.8}' }],
      }),
    });

  const result = await classifyReel('sk-ant-test', 'claude-sonnet-4-6', [], {
    caption: '애니', hashtags: [], comments: [], audioTitle: '', thumbnailBase64: { base64: 'xyz', mediaType: 'image/jpeg' },
  });

  expect(result.matches).toEqual(['지은']);
  expect(global.fetch).toHaveBeenCalledTimes(2);
});
