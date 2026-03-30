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
      type: 'image',
      source: { type: 'url', url: reelData.thumbnailUrl },
    });
  }

  return { system: SYSTEM_PROMPT, userContent };
}

async function classifyReel(apiKey, model, friends, reelData) {
  const { system, userContent } = buildMessages(friends, reelData);

  // Determine provider from model name
  const isClaude = model.startsWith('claude');

  let response;
  try {
    if (isClaude) {
      // Anthropic Claude API
      response = await fetch('https://api.anthropic.com/v1/messages', {
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
    } else {
      // OpenAI API (backward compatible)
      response = await fetch('https://api.openai.com/v1/chat/completions', {
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

  // Extract text from response (different format per provider)
  let raw;
  if (isClaude) {
    raw = data.content?.[0]?.text || '';
  } else {
    raw = data.choices?.[0]?.message?.content || '';
  }

  try {
    // Extract JSON from response (handle markdown code blocks)
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyReel, buildMessages, SYSTEM_PROMPT };
}
