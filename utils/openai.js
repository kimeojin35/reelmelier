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

function buildMessages(friends, reelData) {
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

  if (reelData.thumbnailUrl) {
    userContent.push({
      type: 'image_url',
      image_url: { url: reelData.thumbnailUrl, detail: 'low' },
    });
  }

  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userContent },
  ];
}

async function classifyReel(apiKey, model, friends, reelData) {
  const messages = buildMessages(friends, reelData);

  let response;
  try {
    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: 200 }),
    });
  } catch (err) {
    return { matches: [], reason: '', confidence: 0, error: err.message };
  }

  if (!response.ok) {
    return {
      matches: [],
      reason: '',
      confidence: 0,
      error: `API ${response.status}: ${response.statusText}`,
    };
  }

  const data = await response.json();
  const raw = data.choices[0].message.content;

  try {
    const parsed = JSON.parse(raw);
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyReel, buildMessages, SYSTEM_PROMPT };
}
