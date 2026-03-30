const SYSTEM_PROMPT = `너는 인스타그램 릴스 분류기야.
각 친구의 취향 설명을 보고, 이 릴스가 어떤 친구에게 맞는지 판단해.
맞는 친구가 없으면 matches를 빈 배열로 반환해.
하나의 릴스가 여러 친구에게 매칭될 수 있어.

반드시 아래 JSON 형식으로만 응답해:
{
  "matches": ["친구이름"],
  "reason": "매칭 이유 한 줄",
  "confidence": 0.0~1.0
}`

function buildMessages(friends, reelData, includeImage) {
    const friendList = friends
        .map((f) => `- ${f.name}: ${f.preference}`)
        .join('\n')
    
    const text = `친구 목록:
${friendList}

릴스 정보:
- 캡션: ${reelData.caption || '(없음)'}
- 해시태그: ${reelData.hashtags.length > 0 ? reelData.hashtags.join(', ') : '(없음)'}
- 댓글: ${reelData.comments.length > 0 ? reelData.comments.join(' / ') : '(없음)'}
- 오디오: ${reelData.audioTitle || '(없음)'}`
    
    const userContent = [{ type: 'text', text }]
    
    if (includeImage && reelData.thumbnailBase64) {
        userContent.push({
            type: 'image',
            source: {
                type: 'base64',
                media_type: reelData.thumbnailBase64.mediaType,
                data: reelData.thumbnailBase64.base64,
            }
        })
    }
    
    return { system: SYSTEM_PROMPT, userContent }
}

async function classifyReel(apiKey, model, friends, reelData) {
    const attempts = reelData.thumbnailBase64 ? [true, false] : [false]
    
    for (const includeImage of attempts) {
        const { system, userContent } = buildMessages(friends, reelData, includeImage)
        
        let response
        try {
            response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': apiKey,
                    'anthropic-version': '2023-06-01',
                    'anthropic-dangerous-direct-browser-access': 'true'
                },
                body: JSON.stringify({
                    model,
                    max_tokens: 200,
                    system,
                    messages: [{ role: 'user', content: userContent }]
                })
            })
        } catch (err) {
            return { matches: [], reason: '', confidence: 0, error: err.message }
        }
        
        if (!response.ok) {
            if (response.status === 400 && includeImage) continue
            let errorDetail = `API ${response.status}`
            try {
                const errBody = await response.json()
                errorDetail += `: ${errBody.error?.message || JSON.stringify(errBody)}`
            } catch {
            }
            return { matches: [], reason: '', confidence: 0, error: errorDetail }
        }
        
        const data = await response.json()
        const raw = data.content?.[0]?.text || ''
        
        try {
            const jsonMatch = raw.match(/\{[\s\S]*\}/)
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw)
            return {
                matches: parsed.matches || [],
                reason: parsed.reason || '',
                confidence: parsed.confidence || 0
            }
        } catch {
            return { matches: [], reason: '', confidence: 0, error: `Failed to parse: ${raw}` }
        }
    }
    
    return { matches: [], reason: '', confidence: 0, error: 'Classification failed' }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { classifyReel, buildMessages, SYSTEM_PROMPT }
}
