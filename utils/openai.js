const SYSTEM_PROMPT = `너는 인스타그램 릴스 분류기야.
각 친구의 취향 설명을 보고, 이 릴스가 어떤 친구에게 맞는지 판단해.
맞는 친구가 없으면 matches를 빈 배열로 반환해.
하나의 릴스가 여러 친구에게 매칭될 수 있어.

반드시 아래 JSON 형식으로만 응답해:
{
  "matches": ["친구이름"],
  "reason": "매칭 이유 한 줄",
  "confidence": 0.0~1.0
}`;

function buildMessages(friends, reelData, includeImage) {
  const friendList = friends
    .map((f) => `- ${f.name}: ${f.preference}`)
    .join('\n');

  const text = `친구 목록:
${friendList}

릴스 정보:
- 캡션: ${reelData.caption || '(없음)'}
- 해시태그: ${reelData.hashtags.length > 0 ? reelData.hashtags.join(', ') : '(없음)'}
- 댓글: ${reelData.comments.length > 0 ? reelData.comments.join(' / ') : '(없음)'}
- 오디오: ${reelData.audioTitle || '(없음)'}`;

  const userContent = [{ type: 'text', text }];

  if (includeImage && reelData.thumbnailUrl) {
    userContent.push({
      type: 'image',
      source: { type: 'url', url: reelData.thumbnailUrl },
    });
  }

  return { system: SYSTEM_PROMPT, userContent };
}

async function callClaude(apiKey, model, system, userContent) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
}

async function callOpenAI(apiKey, model, system, userContent) {
  return fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: 200,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent.map((c) =>
          c.type === 'image'
            ? { type: 'image_url', image_url: { url: c.source.url, detail: 'low' } }
            : c
        )},
      ],
    }),
  });
}

async function classifyReel(apiKey, model, friends, reelData) {
  const isClaude = model.startsWith('claude');
  const callApi = isClaude ? callClaude : callOpenAI;

  // Try with image first, fall back to text-only on 400
  const attempts = reelData.thumbnailUrl ? [true, false] : [false];
  for (const includeImage of attempts) {
    const { system, userContent } = buildMessages(friends, reelData, includeImage);

    let response;
    try {
      response = await callApi(apiKey, model, system, userContent);
    } catch (err) {
      return { matches: [], reason: '', confidence: 0, error: err.message };
    }

    if (!response.ok) {
      // If 400 and we had an image, retry without image
      if (response.status === 400 && includeImage && reelData.thumbnailUrl) {
        continue;
      }
      let errorDetail = `API ${response.status}`;
      try {
        const errBody = await response.json();
        errorDetail += `: ${errBody.error?.message || JSON.stringify(errBody)}`;
      } catch {}
      return { matches: [], reason: '', confidence: 0, error: errorDetail };
    }

    const data = await response.json();

    let raw;
    if (isClaude) {
      raw = data.content?.[0]?.text || '';
    } else {
      raw = data.choices?.[0]?.message?.content || '';
    }

    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
      return {
        matches: parsed.matches || [],
        reason: parsed.reason || '',
        confidence: parsed.confidence || 0,
      };
    } catch {
      return {
        matches: [],
        reason: '',
        confidence: 0,
        error: `Failed to parse: ${raw}`,
      };
    }
  }

  // Should not reach here, but just in case
  return { matches: [], reason: '', confidence: 0, error: 'Classification failed' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyReel, buildMessages, SYSTEM_PROMPT };
}
