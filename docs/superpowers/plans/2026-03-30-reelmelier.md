# Reelmelier Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instagram 릴스를 OpenAI로 자동 분류하여 친구에게 DM으로 공유하는 Chrome 확장 프로그램

**Architecture:** Manifest V3 Chrome Extension. Background Service Worker가 전체 흐름을 조율하고, Content Script가 Instagram 페이지에서 API 인터셉트(main world injection)로 릴스 데이터를 수집하며, DOM 조작으로 DM을 전송한다. OpenAI GPT-4o가 텍스트+비전으로 릴스를 분류한다.

**Tech Stack:** Chrome Extension Manifest V3, Vanilla JS, OpenAI API (gpt-4o), chrome.storage.local, Jest (unit tests)

---

## File Map

| 파일 | 역할 | Task |
|------|------|------|
| `manifest.json` | 확장 프로그램 매니페스트 | 1 |
| `utils/storage.js` | chrome.storage.local CRUD 헬퍼 | 2 |
| `utils/openai.js` | OpenAI API 호출 래퍼 | 3 |
| `options/options.html` | 설정 페이지 HTML | 4 |
| `options/options.js` | 설정 저장/로드 로직 | 4 |
| `popup/popup.html` | 팝업 UI HTML | 5 |
| `popup/popup.css` | 팝업 스타일 | 5 |
| `popup/popup.js` | 친구 관리, 실행 제어, 결과 표시 | 5, 6 |
| `content/injector.js` | main world API 인터셉트 스크립트 | 7 |
| `content/content-script.js` | Content Script 진입점, 메시지 라우팅 | 7 |
| `content/dm-sender.js` | DM 전송 DOM 조작 | 8 |
| `background/service-worker.js` | 오케스트레이터 | 9 |
| `tests/utils/storage.test.js` | storage 유닛 테스트 | 2 |
| `tests/utils/openai.test.js` | openai 유닛 테스트 | 3 |
| `icons/icon16.png`, `icon48.png`, `icon128.png` | 확장 프로그램 아이콘 | 1 |

---

### Task 1: 프로젝트 스캐폴드

**Files:**
- Create: `manifest.json`
- Create: `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`
- Create: `package.json`
- Create: `jest.config.js`

- [ ] **Step 1: package.json 생성**

```json
{
  "name": "reelmelier",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "jest"
  }
}
```

- [ ] **Step 2: Jest 설치**

Run: `cd /Users/yugene/Documents/reelmelier && npm install --save-dev jest`

- [ ] **Step 3: jest.config.js 생성**

```js
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
};
```

- [ ] **Step 4: manifest.json 생성**

```json
{
  "manifest_version": 3,
  "name": "Reelmelier",
  "description": "AI가 릴스를 감별하여 친구에게 자동 공유",
  "version": "1.0.0",
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": ["https://www.instagram.com/*"],
  "background": {
    "service_worker": "background/service-worker.js"
  },
  "content_scripts": [
    {
      "matches": ["https://www.instagram.com/*"],
      "js": ["content/content-script.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup/popup.html",
    "default_icon": {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "options_ui": {
    "page": "options/options.html",
    "open_in_tab": true
  },
  "web_accessible_resources": [
    {
      "resources": ["content/injector.js"],
      "matches": ["https://www.instagram.com/*"]
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 5: placeholder 아이콘 생성**

1x1 투명 PNG를 3개 사이즈로 생성 (개발용 placeholder):

Run:
```bash
cd /Users/yugene/Documents/reelmelier
mkdir -p icons
# 16x16 purple square PNG
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x10\x00\x00\x00\x10\x08\x02\x00\x00\x00\x90\x91h6\x00\x00\x00\x1dIDATx\x9cc\xfc\xcf\x80\x1c0\xa1\xc8\x30\x12\x84\xc5\xa0\x89!\xa0h4\x89\x00\x00\xdb\x01\x06\x01J\xf0\xa3~\x00\x00\x00\x00IEND\xaeB`\x82' > icons/icon16.png
cp icons/icon16.png icons/icon48.png
cp icons/icon16.png icons/icon128.png
```

- [ ] **Step 6: 빈 엔트리 파일 생성**

```bash
mkdir -p background content options popup utils tests/utils
touch background/service-worker.js
touch content/content-script.js content/injector.js content/dm-sender.js
touch options/options.html options/options.js
touch popup/popup.html popup/popup.css popup/popup.js
touch utils/storage.js utils/openai.js
```

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: scaffold reelmelier chrome extension project"
```

---

### Task 2: Storage 유틸리티

**Files:**
- Create: `utils/storage.js`
- Create: `tests/utils/storage.test.js`

- [ ] **Step 1: 테스트 작성**

`tests/utils/storage.test.js`:

```js
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
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd /Users/yugene/Documents/reelmelier && npx jest tests/utils/storage.test.js`
Expected: FAIL — 모든 함수가 비어있으므로 import 에러 또는 undefined

- [ ] **Step 3: 구현**

`utils/storage.js`:

```js
const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'gpt-4o',
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
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd /Users/yugene/Documents/reelmelier && npx jest tests/utils/storage.test.js`
Expected: 5 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add utils/storage.js tests/utils/storage.test.js
git commit -m "feat: add chrome.storage utility with tests"
```

---

### Task 3: OpenAI API 래퍼

**Files:**
- Create: `utils/openai.js`
- Create: `tests/utils/openai.test.js`

- [ ] **Step 1: 테스트 작성**

`tests/utils/openai.test.js`:

```js
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
  // user message should contain image_url content part
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
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `cd /Users/yugene/Documents/reelmelier && npx jest tests/utils/openai.test.js`
Expected: FAIL

- [ ] **Step 3: 구현**

`utils/openai.js`:

```js
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
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `cd /Users/yugene/Documents/reelmelier && npx jest tests/utils/openai.test.js`
Expected: 5 tests PASS

- [ ] **Step 5: 커밋**

```bash
git add utils/openai.js tests/utils/openai.test.js
git commit -m "feat: add OpenAI API wrapper with classification logic and tests"
```

---

### Task 4: Options Page

**Files:**
- Create: `options/options.html`
- Create: `options/options.js`

- [ ] **Step 1: options.html 작성**

`options/options.html`:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>Reelmelier 설정</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f0f1a;
      color: #e0e0e0;
      padding: 40px;
      max-width: 480px;
      margin: 0 auto;
    }
    h1 { font-size: 20px; margin-bottom: 24px; }
    .field { margin-bottom: 20px; }
    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      margin-bottom: 6px;
      color: #aaa;
    }
    input, select {
      width: 100%;
      padding: 10px 12px;
      background: #1a1a2e;
      border: 1px solid #333;
      border-radius: 6px;
      color: #e0e0e0;
      font-size: 14px;
    }
    input:focus, select:focus { border-color: #6a0dad; outline: none; }
    .row { display: flex; gap: 12px; }
    .row .field { flex: 1; }
    button {
      background: linear-gradient(135deg, #6a0dad, #e91e63);
      border: none;
      color: white;
      padding: 10px 24px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 8px;
    }
    .saved {
      color: #4caf50;
      font-size: 13px;
      margin-left: 12px;
      opacity: 0;
      transition: opacity 0.3s;
    }
    .saved.show { opacity: 1; }
  </style>
</head>
<body>
  <h1>Reelmelier 설정</h1>

  <div class="field">
    <label>OpenAI API Key</label>
    <input type="password" id="apiKey" placeholder="sk-...">
  </div>

  <div class="field">
    <label>AI 모델</label>
    <select id="model">
      <option value="gpt-4o">gpt-4o (추천)</option>
      <option value="gpt-4o-mini">gpt-4o-mini (저렴)</option>
    </select>
  </div>

  <div class="field">
    <label>Confidence 임계값 (0.0 ~ 1.0)</label>
    <input type="number" id="confidenceThreshold" min="0" max="1" step="0.1" value="0.5">
  </div>

  <div class="row">
    <div class="field">
      <label>DM 최소 딜레이 (ms)</label>
      <input type="number" id="dmDelayMin" min="1000" step="500" value="2000">
    </div>
    <div class="field">
      <label>DM 최대 딜레이 (ms)</label>
      <input type="number" id="dmDelayMax" min="1000" step="500" value="5000">
    </div>
  </div>

  <button id="saveBtn">저장</button>
  <span class="saved" id="savedMsg">저장됨!</span>

  <script src="../utils/storage.js"></script>
  <script src="options.js"></script>
</body>
</html>
```

- [ ] **Step 2: options.js 작성**

`options/options.js`:

```js
const fields = ['apiKey', 'model', 'confidenceThreshold', 'dmDelayMin', 'dmDelayMax'];

async function loadSettings() {
  const settings = await getSettings();
  document.getElementById('apiKey').value = settings.apiKey;
  document.getElementById('model').value = settings.model;
  document.getElementById('confidenceThreshold').value = settings.confidenceThreshold;
  document.getElementById('dmDelayMin').value = settings.dmDelayMin;
  document.getElementById('dmDelayMax').value = settings.dmDelayMax;
}

async function save() {
  const partial = {
    apiKey: document.getElementById('apiKey').value.trim(),
    model: document.getElementById('model').value,
    confidenceThreshold: parseFloat(document.getElementById('confidenceThreshold').value),
    dmDelayMin: parseInt(document.getElementById('dmDelayMin').value, 10),
    dmDelayMax: parseInt(document.getElementById('dmDelayMax').value, 10),
  };
  await saveSettings(partial);
  const msg = document.getElementById('savedMsg');
  msg.classList.add('show');
  setTimeout(() => msg.classList.remove('show'), 1500);
}

document.addEventListener('DOMContentLoaded', loadSettings);
document.getElementById('saveBtn').addEventListener('click', save);
```

- [ ] **Step 3: Chrome에 로드하여 수동 테스트**

Run: Chrome → `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 → `/Users/yugene/Documents/reelmelier` 선택 → 확장 프로그램 옵션 열기 → 설정 저장/로드 확인

- [ ] **Step 4: 커밋**

```bash
git add options/
git commit -m "feat: add options page for API key and settings"
```

---

### Task 5: Popup UI — 친구 관리

**Files:**
- Create: `popup/popup.html`
- Create: `popup/popup.css`
- Create: `popup/popup.js` (친구 관리 부분)

- [ ] **Step 1: popup.html 작성**

`popup/popup.html`:

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <!-- Header -->
  <header>
    <span class="logo">Reelmelier</span>
    <button id="settingsBtn" class="icon-btn" title="설정">⚙️</button>
  </header>

  <!-- Friends Section -->
  <section id="friendsSection">
    <div class="section-label">친구 목록</div>
    <div id="friendChips"></div>
    <button id="addFriendBtn" class="chip-add">+ 추가</button>
  </section>

  <!-- Add/Edit Friend Modal -->
  <div id="friendModal" class="modal hidden">
    <div class="modal-content">
      <div class="modal-title" id="modalTitle">친구 추가</div>
      <div class="field">
        <label>이름</label>
        <input type="text" id="friendName" placeholder="민수">
      </div>
      <div class="field">
        <label>취향</label>
        <input type="text" id="friendPreference" placeholder="힐링되는 고양이 릴스">
      </div>
      <div class="field">
        <label>인스타 유저네임</label>
        <input type="text" id="friendUsername" placeholder="minsu_cat">
      </div>
      <div class="modal-actions">
        <button id="modalDeleteBtn" class="btn-danger hidden">삭제</button>
        <div class="spacer"></div>
        <button id="modalCancelBtn" class="btn-secondary">취소</button>
        <button id="modalSaveBtn" class="btn-primary">저장</button>
      </div>
    </div>
  </div>

  <!-- Controls Section -->
  <section id="controlsSection">
    <div class="section-label">릴스 탐색</div>
    <div class="controls-row">
      <input type="number" id="reelCount" value="10" min="1" max="50">
      <span class="count-label">개 탐색</span>
      <div class="spacer"></div>
      <button id="startBtn" class="btn-primary">시작</button>
    </div>
  </section>

  <!-- Progress Section -->
  <section id="progressSection" class="hidden">
    <div class="section-label">진행상황</div>
    <div class="progress-box">
      <div class="progress-header">
        <span id="progressText">0/10 릴스 확인</span>
        <span id="progressPercent" class="accent">0%</span>
      </div>
      <div class="progress-bar">
        <div id="progressFill" class="progress-fill"></div>
      </div>
      <div id="progressDetail" class="progress-detail"></div>
    </div>
    <button id="stopBtn" class="btn-danger" style="margin-top:8px;width:100%;">중지</button>
  </section>

  <!-- Result Section -->
  <section id="resultSection" class="hidden">
    <div class="section-label">결과</div>
    <div id="resultContent" class="result-box"></div>
  </section>

  <script src="../utils/storage.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: popup.css 작성**

`popup/popup.css`:

```css
* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  width: 380px;
  min-height: 400px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  background: #0f0f1a;
  color: #e0e0e0;
  font-size: 13px;
}

header {
  background: linear-gradient(135deg, #6a0dad, #e91e63);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.logo { font-size: 16px; font-weight: 700; color: white; }
.icon-btn {
  background: none; border: none; font-size: 14px; cursor: pointer;
  color: rgba(255,255,255,0.7);
}
.icon-btn:hover { color: white; }

section { padding: 12px 16px; }

.section-label {
  font-size: 11px; font-weight: 600; color: #e91e63;
  margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px;
}

/* Friend Chips */
#friendChips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.chip {
  background: #252545; border-radius: 14px; padding: 5px 12px;
  font-size: 12px; cursor: pointer; transition: background 0.2s;
  max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.chip:hover { background: #353560; }
.chip-name { font-weight: 600; }
.chip-pref { color: #aaa; margin-left: 4px; font-size: 11px; }
.chip-add {
  background: none; border: 1px dashed #555; border-radius: 14px;
  padding: 5px 12px; font-size: 12px; color: #888; cursor: pointer;
}
.chip-add:hover { border-color: #e91e63; color: #e91e63; }

/* Modal */
.modal {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 10;
}
.modal.hidden { display: none; }
.modal-content {
  background: #1a1a2e; border-radius: 10px; padding: 20px; width: 320px;
}
.modal-title { font-size: 15px; font-weight: 600; margin-bottom: 16px; }
.field { margin-bottom: 12px; }
.field label { display: block; font-size: 11px; color: #aaa; margin-bottom: 4px; }
.field input {
  width: 100%; padding: 8px 10px; background: #252545; border: 1px solid #333;
  border-radius: 6px; color: #e0e0e0; font-size: 13px;
}
.field input:focus { border-color: #6a0dad; outline: none; }
.modal-actions { display: flex; gap: 8px; margin-top: 16px; }
.spacer { flex: 1; }

/* Buttons */
.btn-primary {
  background: linear-gradient(135deg, #6a0dad, #e91e63); border: none;
  color: white; padding: 8px 18px; border-radius: 6px; font-size: 13px;
  font-weight: 600; cursor: pointer;
}
.btn-secondary {
  background: #333; border: none; color: #ccc; padding: 8px 18px;
  border-radius: 6px; font-size: 13px; cursor: pointer;
}
.btn-danger {
  background: #d32f2f; border: none; color: white; padding: 8px 18px;
  border-radius: 6px; font-size: 13px; cursor: pointer;
}
.hidden { display: none !important; }

/* Controls */
.controls-row {
  display: flex; align-items: center; gap: 8px;
}
#reelCount {
  width: 56px; padding: 8px; background: #252545; border: 1px solid #333;
  border-radius: 6px; color: white; font-size: 14px; text-align: center;
}
.count-label { color: #aaa; }

/* Progress */
.progress-box { background: #252545; border-radius: 8px; padding: 12px; }
.progress-header { display: flex; justify-content: space-between; margin-bottom: 6px; }
.accent { color: #e91e63; }
.progress-bar { background: #333; border-radius: 3px; height: 4px; }
.progress-fill {
  background: linear-gradient(90deg, #6a0dad, #e91e63);
  height: 100%; border-radius: 3px; width: 0%; transition: width 0.3s;
}
.progress-detail { font-size: 11px; color: #888; margin-top: 6px; }

/* Results */
.result-box { background: #252545; border-radius: 8px; padding: 12px; }
.result-friend { margin-bottom: 8px; }
.result-friend-name { font-weight: 600; font-size: 13px; }
.result-friend-count { color: #e91e63; font-size: 12px; }
.result-summary { font-size: 12px; color: #aaa; border-top: 1px solid #333; padding-top: 8px; margin-top: 8px; }
```

- [ ] **Step 3: popup.js — 친구 관리 로직 작성**

`popup/popup.js`:

```js
let friends = [];
let editingIndex = -1;

// --- Friend Management ---

async function loadFriends() {
  friends = await getFriends();
  renderFriendChips();
}

function renderFriendChips() {
  const container = document.getElementById('friendChips');
  container.innerHTML = '';
  friends.forEach((friend, index) => {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.innerHTML = `<span class="chip-name">${friend.name}</span><span class="chip-pref">${friend.preference}</span>`;
    chip.addEventListener('click', () => openEditFriend(index));
    container.appendChild(chip);
  });
}

function openAddFriend() {
  editingIndex = -1;
  document.getElementById('modalTitle').textContent = '친구 추가';
  document.getElementById('friendName').value = '';
  document.getElementById('friendPreference').value = '';
  document.getElementById('friendUsername').value = '';
  document.getElementById('modalDeleteBtn').classList.add('hidden');
  document.getElementById('friendModal').classList.remove('hidden');
}

function openEditFriend(index) {
  editingIndex = index;
  const friend = friends[index];
  document.getElementById('modalTitle').textContent = '친구 수정';
  document.getElementById('friendName').value = friend.name;
  document.getElementById('friendPreference').value = friend.preference;
  document.getElementById('friendUsername').value = friend.username;
  document.getElementById('modalDeleteBtn').classList.remove('hidden');
  document.getElementById('friendModal').classList.remove('hidden');
}

async function saveFriend() {
  const name = document.getElementById('friendName').value.trim();
  const preference = document.getElementById('friendPreference').value.trim();
  const username = document.getElementById('friendUsername').value.trim();
  if (!name || !preference || !username) return;

  const friend = { name, preference, username };
  if (editingIndex === -1) {
    friends.push(friend);
  } else {
    friends[editingIndex] = friend;
  }
  await saveFriends(friends);
  renderFriendChips();
  closeModal();
}

async function deleteFriend() {
  if (editingIndex === -1) return;
  friends.splice(editingIndex, 1);
  await saveFriends(friends);
  renderFriendChips();
  closeModal();
}

function closeModal() {
  document.getElementById('friendModal').classList.add('hidden');
}

// --- Event Listeners ---

document.addEventListener('DOMContentLoaded', () => {
  loadFriends();
  document.getElementById('addFriendBtn').addEventListener('click', openAddFriend);
  document.getElementById('modalSaveBtn').addEventListener('click', saveFriend);
  document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
  document.getElementById('modalDeleteBtn').addEventListener('click', deleteFriend);
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
  });
});
```

- [ ] **Step 4: Chrome에 로드하여 수동 테스트**

팝업 열기 → 친구 추가/수정/삭제 → 팝업 닫았다 다시 열어서 데이터 유지 확인

- [ ] **Step 5: 커밋**

```bash
git add popup/
git commit -m "feat: add popup UI with friend management"
```

---

### Task 6: Popup UI — 실행 제어 및 결과 표시

**Files:**
- Modify: `popup/popup.js`

- [ ] **Step 1: popup.js에 실행 제어 로직 추가**

`popup/popup.js` 하단에 추가:

```js
// --- Execution Control ---

let isRunning = false;

function startExecution() {
  const count = parseInt(document.getElementById('reelCount').value, 10);
  if (count < 1 || count > 50) return;
  if (friends.length === 0) {
    alert('친구를 먼저 추가하세요.');
    return;
  }

  isRunning = true;
  document.getElementById('controlsSection').querySelector('.btn-primary').disabled = true;
  document.getElementById('progressSection').classList.remove('hidden');
  document.getElementById('resultSection').classList.add('hidden');
  updateProgress(0, count, []);

  chrome.runtime.sendMessage({ type: 'START_SCAN', count, friends });
}

function stopExecution() {
  chrome.runtime.sendMessage({ type: 'STOP_SCAN' });
  isRunning = false;
  document.getElementById('controlsSection').querySelector('.btn-primary').disabled = false;
}

function updateProgress(current, total, details) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  document.getElementById('progressText').textContent = `${current}/${total} 릴스 확인`;
  document.getElementById('progressPercent').textContent = `${pct}%`;
  document.getElementById('progressFill').style.width = `${pct}%`;
  const detailText = details.length > 0 ? details.join(', ') : '';
  document.getElementById('progressDetail').textContent = detailText;
}

function showResult(result) {
  isRunning = false;
  document.getElementById('progressSection').classList.add('hidden');
  document.getElementById('resultSection').classList.remove('hidden');
  document.getElementById('controlsSection').querySelector('.btn-primary').disabled = false;

  const container = document.getElementById('resultContent');
  let html = '';

  if (result.sent && result.sent.length > 0) {
    result.sent.forEach((s) => {
      html += `<div class="result-friend">
        <span class="result-friend-name">${s.friend}</span>
        <span class="result-friend-count">${s.reels.length}개 전송</span>
      </div>`;
    });
  }

  if (result.failed && result.failed.length > 0) {
    result.failed.forEach((f) => {
      html += `<div class="result-friend">
        <span class="result-friend-name">${f.friend}</span>
        <span style="color:#d32f2f;font-size:12px;">전송 실패</span>
      </div>`;
    });
  }

  html += `<div class="result-summary">
    총 ${result.totalReels}개 탐색 · ${result.matched}개 매칭 · ${result.skipped}개 패스
  </div>`;

  container.innerHTML = html;
}

// --- Message Listener ---

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS_UPDATE') {
    updateProgress(msg.current, msg.total, msg.details);
  }
  if (msg.type === 'SCAN_COMPLETE') {
    showResult(msg.result);
    saveLastResult(msg.result);
  }
});

// Update DOMContentLoaded to add execution listeners
const originalDOMContentLoaded = document.addEventListener;
document.getElementById('startBtn')?.addEventListener('click', startExecution);
document.getElementById('stopBtn')?.addEventListener('click', stopExecution);
```

- [ ] **Step 2: DOMContentLoaded에 실행 버튼 리스너 통합**

`popup/popup.js`의 기존 `DOMContentLoaded` 핸들러를 수정 — `startBtn`, `stopBtn` 리스너 추가:

기존 DOMContentLoaded 안에 추가:
```js
  document.getElementById('startBtn').addEventListener('click', startExecution);
  document.getElementById('stopBtn').addEventListener('click', stopExecution);
```

그리고 하단의 중복된 `document.getElementById('startBtn')?.addEventListener(...)` 두 줄 삭제.

- [ ] **Step 3: 이전 결과 로드 기능 추가**

DOMContentLoaded 안에 추가:
```js
  // Load last result if exists
  getLastResult().then((result) => {
    if (result) showResult(result);
  });
```

- [ ] **Step 4: Chrome에서 수동 테스트**

팝업 열기 → 시작 버튼 동작 확인 (친구 없으면 alert, 있으면 진행상황 섹션 표시)

- [ ] **Step 5: 커밋**

```bash
git add popup/popup.js
git commit -m "feat: add execution controls and result display to popup"
```

---

### Task 7: Content Script — API 인터셉트

**Files:**
- Create: `content/injector.js`
- Create: `content/content-script.js`

- [ ] **Step 1: injector.js 작성 (main world 스크립트)**

`content/injector.js`:

```js
(function () {
  const REEL_ENDPOINTS = ['/api/graphql', '/api/v1/clips/'];
  const REELMELIER_MSG_TYPE = 'REELMELIER_INTERCEPTED';

  function isReelEndpoint(url) {
    return REEL_ENDPOINTS.some((ep) => url.includes(ep));
  }

  function extractReelData(data) {
    const reels = [];

    function traverse(obj) {
      if (!obj || typeof obj !== 'object') return;
      // Look for media objects with video versions (reels)
      if (obj.media && obj.media.code && obj.media.video_versions) {
        const media = obj.media;
        const caption = media.caption ? media.caption.text || '' : '';
        const hashtags = caption.match(/#[\w\uAC00-\uD7A3]+/g) || [];
        const comments = (media.preview_comments || [])
          .slice(0, 10)
          .map((c) => c.text || '');
        const thumbnailUrl =
          media.image_versions2?.candidates?.[0]?.url || null;
        const audioTitle =
          media.clips_metadata?.original_sound_info?.audio_asset_id ||
          media.clips_metadata?.music_info?.music_asset_info?.title ||
          '';
        const reelId = media.code;

        reels.push({
          reelId,
          reelUrl: `https://www.instagram.com/reel/${reelId}/`,
          caption,
          hashtags: hashtags.map((h) => h.slice(1)),
          comments,
          thumbnailUrl,
          audioTitle: String(audioTitle),
        });
      }
      // Also check items array pattern
      if (obj.id && obj.code && obj.video_versions) {
        const caption = obj.caption ? obj.caption.text || '' : '';
        const hashtags = caption.match(/#[\w\uAC00-\uD7A3]+/g) || [];
        const comments = (obj.preview_comments || [])
          .slice(0, 10)
          .map((c) => c.text || '');
        const thumbnailUrl =
          obj.image_versions2?.candidates?.[0]?.url || null;
        const audioTitle =
          obj.clips_metadata?.original_sound_info?.audio_asset_id ||
          obj.clips_metadata?.music_info?.music_asset_info?.title ||
          '';

        reels.push({
          reelId: obj.code,
          reelUrl: `https://www.instagram.com/reel/${obj.code}/`,
          caption,
          hashtags: hashtags.map((h) => h.slice(1)),
          comments,
          thumbnailUrl,
          audioTitle: String(audioTitle),
        });
      }

      if (Array.isArray(obj)) {
        obj.forEach(traverse);
      } else {
        Object.values(obj).forEach(traverse);
      }
    }

    traverse(data);
    // Deduplicate by reelId
    const seen = new Set();
    return reels.filter((r) => {
      if (seen.has(r.reelId)) return false;
      seen.add(r.reelId);
      return true;
    });
  }

  // Monkey-patch fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    if (isReelEndpoint(url)) {
      response.clone().json().then((data) => {
        const reels = extractReelData(data);
        if (reels.length > 0) {
          window.postMessage({ type: REELMELIER_MSG_TYPE, reels }, '*');
        }
      }).catch(() => {});
    }
    return response;
  };

  // Monkey-patch XMLHttpRequest
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._reelmelierUrl = url;
    return originalOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      if (this._reelmelierUrl && isReelEndpoint(this._reelmelierUrl)) {
        try {
          const data = JSON.parse(this.responseText);
          const reels = extractReelData(data);
          if (reels.length > 0) {
            window.postMessage({ type: REELMELIER_MSG_TYPE, reels }, '*');
          }
        } catch {}
      }
    });
    return originalSend.apply(this, args);
  };
})();
```

- [ ] **Step 2: content-script.js 작성**

`content/content-script.js`:

```js
(function () {
  let isScanning = false;
  let reelQueue = [];
  let processedReelIds = new Set();
  let targetCount = 0;
  let collectedCount = 0;

  // Inject the main world interceptor script
  function injectInterceptor() {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('content/injector.js');
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  // Listen for intercepted reel data from main world
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== 'REELMELIER_INTERCEPTED') return;
    if (!isScanning) return;

    const reels = event.data.reels || [];
    for (const reel of reels) {
      if (processedReelIds.has(reel.reelId)) continue;
      processedReelIds.add(reel.reelId);
      reelQueue.push(reel);
    }
  });

  // Scroll to next reel
  function scrollToNextReel() {
    window.scrollBy({ top: window.innerHeight, behavior: 'smooth' });
  }

  // Process reels one by one
  async function processReels() {
    while (isScanning && collectedCount < targetCount) {
      if (reelQueue.length === 0) {
        scrollToNextReel();
        await sleep(2000);
        continue;
      }

      const reel = reelQueue.shift();
      collectedCount++;

      // Send to background for classification
      chrome.runtime.sendMessage({
        type: 'CLASSIFY_REEL',
        reel,
        current: collectedCount,
        total: targetCount,
      });

      if (collectedCount < targetCount) {
        scrollToNextReel();
        await sleep(1500);
      }
    }

    if (collectedCount >= targetCount) {
      chrome.runtime.sendMessage({ type: 'COLLECTION_DONE' });
    }
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Listen for commands from background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'START_CONTENT_SCAN') {
      isScanning = true;
      reelQueue = [];
      processedReelIds.clear();
      collectedCount = 0;
      targetCount = msg.count;
      processReels();
      sendResponse({ ok: true });
    }
    if (msg.type === 'STOP_CONTENT_SCAN') {
      isScanning = false;
      sendResponse({ ok: true });
    }
    if (msg.type === 'SEND_DM') {
      // Delegate to dm-sender
      sendDM(msg.username, msg.reelUrls).then((result) => {
        sendResponse(result);
      });
      return true; // async response
    }
  });

  // Initialize
  injectInterceptor();
})();
```

- [ ] **Step 3: Chrome에 로드 → instagram.com/reels/ 열기 → 콘솔에서 인터셉트 확인**

개발자 도구 콘솔에서 `window.addEventListener('message', e => { if(e.data?.type==='REELMELIER_INTERCEPTED') console.log('intercepted:', e.data.reels); })` 으로 확인

- [ ] **Step 4: 커밋**

```bash
git add content/injector.js content/content-script.js
git commit -m "feat: add API interceptor and content script for reel data collection"
```

---

### Task 8: DM 전송

**Files:**
- Create: `content/dm-sender.js`
- Modify: `manifest.json` (content_scripts에 dm-sender.js 추가)

- [ ] **Step 1: dm-sender.js 작성**

`content/dm-sender.js`:

```js
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForSelector(selector, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await sleep(300);
  }
  return null;
}

async function waitForSelectorAll(selector, minCount = 1, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const els = document.querySelectorAll(selector);
    if (els.length >= minCount) return els;
    await sleep(300);
  }
  return [];
}

function simulateInput(element, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set || Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

async function sendDM(username, reelUrls) {
  const results = { sent: [], failed: [] };
  const MAX_RETRIES = 3;

  try {
    // Navigate to DM new message page
    window.location.href = 'https://www.instagram.com/direct/new/';
    await sleep(3000);

    // Wait for the search input in DM compose
    const searchInput = await waitForSelector(
      'input[name="queryBox"], input[placeholder*="검색"], input[placeholder*="Search"]'
    );
    if (!searchInput) {
      return { sent: [], failed: reelUrls.map((url) => ({ url, error: 'Search input not found' })) };
    }

    // Type username
    simulateInput(searchInput, username);
    await sleep(1500);

    // Click the matching user result
    const userResult = await waitForSelector(
      `[role="listbox"] button, [role="option"], div[class*="result"] span`
    );
    if (!userResult) {
      return { sent: [], failed: reelUrls.map((url) => ({ url, error: 'User not found in search' })) };
    }
    userResult.click();
    await sleep(1000);

    // Click "Chat" / "다음" button to open the conversation
    const nextBtn = await waitForSelector(
      'div[role="button"]:not([aria-disabled="true"])'
    );
    if (nextBtn) {
      nextBtn.click();
      await sleep(2000);
    }

    // Send each reel URL
    for (const reelUrl of reelUrls) {
      let sent = false;
      for (let retry = 0; retry < MAX_RETRIES && !sent; retry++) {
        try {
          const messageInput = await waitForSelector(
            'textarea[placeholder*="메시지"], textarea[placeholder*="Message"], div[role="textbox"][contenteditable="true"]'
          );
          if (!messageInput) throw new Error('Message input not found');

          if (messageInput.tagName === 'TEXTAREA') {
            simulateInput(messageInput, reelUrl);
          } else {
            // contenteditable div
            messageInput.focus();
            messageInput.textContent = reelUrl;
            messageInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
          }

          await sleep(500);

          // Press Enter to send
          messageInput.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
          );
          await sleep(1000);

          sent = true;
          results.sent.push(reelUrl);
        } catch (err) {
          if (retry === MAX_RETRIES - 1) {
            results.failed.push({ url: reelUrl, error: err.message });
          }
          await sleep(1000);
        }
      }
    }
  } catch (err) {
    return {
      sent: results.sent,
      failed: [
        ...results.failed,
        ...reelUrls
          .filter((url) => !results.sent.includes(url))
          .map((url) => ({ url, error: err.message })),
      ],
    };
  }

  return results;
}
```

- [ ] **Step 2: manifest.json에 dm-sender.js 추가**

`manifest.json`의 `content_scripts[0].js` 배열을 수정:

```json
"js": ["content/dm-sender.js", "content/content-script.js"]
```

`dm-sender.js`를 먼저 로드하여 `sendDM` 함수가 `content-script.js`에서 사용 가능하도록 함.

- [ ] **Step 3: 커밋**

```bash
git add content/dm-sender.js manifest.json
git commit -m "feat: add DM sender with DOM automation and retry logic"
```

---

### Task 9: Background Service Worker — 오케스트레이터

**Files:**
- Create: `background/service-worker.js`

- [ ] **Step 1: service-worker.js 작성**

`background/service-worker.js`:

```js
importScripts('utils/storage.js', 'utils/openai.js');

let scanState = {
  isRunning: false,
  friends: [],
  targetCount: 0,
  classifiedReels: [],   // { reel, matches, reason, confidence }
  processedCount: 0,
  tabId: null,
};

function resetState() {
  scanState = {
    isRunning: false,
    friends: [],
    targetCount: 0,
    classifiedReels: [],
    processedCount: 0,
    tabId: null,
  };
}

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'START_SCAN') {
    handleStartScan(msg);
    sendResponse({ ok: true });
  }

  if (msg.type === 'STOP_SCAN') {
    handleStopScan();
    sendResponse({ ok: true });
  }

  if (msg.type === 'CLASSIFY_REEL') {
    handleClassifyReel(msg);
    sendResponse({ ok: true });
  }

  if (msg.type === 'COLLECTION_DONE') {
    handleCollectionDone();
    sendResponse({ ok: true });
  }

  return false;
});

async function handleStartScan(msg) {
  resetState();
  scanState.isRunning = true;
  scanState.friends = msg.friends;
  scanState.targetCount = msg.count;

  // Find or create Instagram reels tab
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  let tab;

  if (tabs.length > 0) {
    tab = tabs[0];
    await chrome.tabs.update(tab.id, { url: 'https://www.instagram.com/reels/', active: true });
  } else {
    tab = await chrome.tabs.create({ url: 'https://www.instagram.com/reels/' });
  }

  scanState.tabId = tab.id;

  // Wait for page load then start content script scanning
  chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
    if (tabId === scanState.tabId && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      setTimeout(() => {
        chrome.tabs.sendMessage(scanState.tabId, {
          type: 'START_CONTENT_SCAN',
          count: scanState.targetCount,
        });
      }, 2000);
    }
  });
}

function handleStopScan() {
  if (scanState.tabId) {
    chrome.tabs.sendMessage(scanState.tabId, { type: 'STOP_CONTENT_SCAN' });
  }
  scanState.isRunning = false;
}

async function handleClassifyReel(msg) {
  if (!scanState.isRunning) return;

  const settings = await getSettings();
  if (!settings.apiKey) {
    broadcastToPopup({
      type: 'PROGRESS_UPDATE',
      current: msg.current,
      total: msg.total,
      details: ['API 키가 설정되지 않았습니다'],
    });
    return;
  }

  // Classify with OpenAI
  const result = await classifyReel(
    settings.apiKey,
    settings.model,
    scanState.friends,
    msg.reel
  );

  scanState.processedCount = msg.current;

  const details = [];
  if (result.error) {
    details.push(`릴스 ${msg.current}: 분류 실패`);
  } else if (result.matches.length > 0 && result.confidence >= settings.confidenceThreshold) {
    scanState.classifiedReels.push({
      reel: msg.reel,
      matches: result.matches,
      reason: result.reason,
      confidence: result.confidence,
    });
    details.push(`${result.matches.join(', ')}에게 매칭!`);
  } else {
    details.push(`패스`);
  }

  broadcastToPopup({
    type: 'PROGRESS_UPDATE',
    current: msg.current,
    total: msg.total,
    details,
  });
}

async function handleCollectionDone() {
  if (!scanState.isRunning) return;

  const settings = await getSettings();

  // Group reels by friend
  const friendReelMap = {};
  for (const classified of scanState.classifiedReels) {
    for (const friendName of classified.matches) {
      if (!friendReelMap[friendName]) {
        friendReelMap[friendName] = [];
      }
      friendReelMap[friendName].push(classified.reel.reelUrl);
    }
  }

  // Send DMs friend by friend
  const sentResults = [];
  const failedResults = [];

  for (const friend of scanState.friends) {
    const reelUrls = friendReelMap[friend.name];
    if (!reelUrls || reelUrls.length === 0) continue;

    const dmResult = await chrome.tabs.sendMessage(scanState.tabId, {
      type: 'SEND_DM',
      username: friend.username,
      reelUrls,
    });

    if (dmResult.sent.length > 0) {
      sentResults.push({ friend: friend.name, reels: dmResult.sent });
    }
    if (dmResult.failed.length > 0) {
      failedResults.push({ friend: friend.name, reels: dmResult.failed });
    }

    // Random delay between friends
    const delay =
      settings.dmDelayMin +
      Math.random() * (settings.dmDelayMax - settings.dmDelayMin);
    await new Promise((r) => setTimeout(r, delay));
  }

  const totalMatched = scanState.classifiedReels.length;
  const finalResult = {
    totalReels: scanState.targetCount,
    matched: totalMatched,
    skipped: scanState.targetCount - totalMatched,
    sent: sentResults,
    failed: failedResults,
  };

  broadcastToPopup({ type: 'SCAN_COMPLETE', result: finalResult });
  scanState.isRunning = false;
}

async function broadcastToPopup(msg) {
  try {
    await chrome.runtime.sendMessage(msg);
  } catch {
    // Popup might be closed — ignore
  }
}
```

- [ ] **Step 2: Chrome에 리로드하여 전체 플로우 수동 테스트**

1. 옵션 페이지에서 OpenAI API 키 입력
2. 팝업에서 친구 추가 (테스트용 — 본인 부계정 등)
3. 릴스 개수 3으로 설정
4. 시작 클릭 → instagram.com/reels/ 이동 → 릴스 수집 → 분류 → DM 전송 확인

- [ ] **Step 3: 커밋**

```bash
git add background/service-worker.js
git commit -m "feat: add background service worker orchestrating scan, classify, and DM flow"
```

---

### Task 10: DOM Fallback 및 에러 처리

**Files:**
- Modify: `content/content-script.js`

- [ ] **Step 1: DOM fallback 함수 추가**

`content/content-script.js`에 `processReels` 함수 내부, reel 데이터가 비어있을 때 DOM에서 직접 추출하는 fallback:

```js
  function extractReelFromDOM() {
    const caption = document.querySelector(
      'h1[dir="auto"], span[dir="auto"][class*="Caption"], div[class*="Caption"] span'
    )?.textContent || '';

    const hashtags = caption.match(/#[\w\uAC00-\uD7A3]+/g) || [];

    const comments = Array.from(
      document.querySelectorAll('ul[class*="Comment"] span[dir="auto"]')
    )
      .slice(0, 10)
      .map((el) => el.textContent);

    // Get current URL as reel ID
    const urlMatch = window.location.href.match(/\/reel\/([^/?]+)/);
    const reelId = urlMatch ? urlMatch[1] : `unknown-${Date.now()}`;

    return {
      reelId,
      reelUrl: urlMatch
        ? `https://www.instagram.com/reel/${reelId}/`
        : window.location.href,
      caption,
      hashtags: hashtags.map((h) => h.slice(1)),
      comments,
      thumbnailUrl: null,
      audioTitle: '',
    };
  }
```

- [ ] **Step 2: processReels에 fallback 통합**

`processReels` 함수의 `if (reelQueue.length === 0)` 분기 수정:

```js
    if (reelQueue.length === 0) {
      // Try DOM fallback before scrolling
      const domReel = extractReelFromDOM();
      if (domReel.caption && !processedReelIds.has(domReel.reelId)) {
        processedReelIds.add(domReel.reelId);
        reelQueue.push(domReel);
        continue;
      }
      scrollToNextReel();
      await sleep(2000);
      continue;
    }
```

- [ ] **Step 3: 커밋**

```bash
git add content/content-script.js
git commit -m "feat: add DOM fallback for reel data extraction when API intercept fails"
```

---

### Task 11: 로그인 체크 및 최종 통합

**Files:**
- Modify: `background/service-worker.js`
- Modify: `content/content-script.js`

- [ ] **Step 1: content-script.js에 로그인 체크 추가**

`content/content-script.js`의 메시지 리스너에 추가:

```js
    if (msg.type === 'CHECK_LOGIN') {
      // Instagram redirects to login page if not logged in
      const isLoggedIn =
        !window.location.href.includes('/accounts/login') &&
        document.querySelector('svg[aria-label="홈"], svg[aria-label="Home"]') !== null;
      sendResponse({ isLoggedIn });
      return;
    }
```

- [ ] **Step 2: service-worker.js의 handleStartScan에 로그인 체크 추가**

`handleStartScan` 함수에서 탭 로드 완료 후, `START_CONTENT_SCAN` 보내기 전에:

```js
      setTimeout(async () => {
        const loginCheck = await chrome.tabs.sendMessage(scanState.tabId, {
          type: 'CHECK_LOGIN',
        });
        if (!loginCheck.isLoggedIn) {
          broadcastToPopup({
            type: 'SCAN_COMPLETE',
            result: {
              totalReels: 0,
              matched: 0,
              skipped: 0,
              sent: [],
              failed: [],
              error: '인스타그램에 로그인되어 있지 않습니다.',
            },
          });
          scanState.isRunning = false;
          return;
        }
        chrome.tabs.sendMessage(scanState.tabId, {
          type: 'START_CONTENT_SCAN',
          count: scanState.targetCount,
        });
      }, 2000);
```

- [ ] **Step 3: popup.js에 에러 메시지 표시**

`showResult` 함수에 에러 처리 추가:

```js
  if (result.error) {
    html = `<div style="color:#d32f2f;font-size:13px;padding:8px 0;">${result.error}</div>`;
    container.innerHTML = html;
    return;
  }
```

- [ ] **Step 4: .gitignore 생성**

```
node_modules/
.superpowers/
```

- [ ] **Step 5: 전체 수동 테스트**

1. 인스타 로그아웃 상태에서 시작 → 에러 메시지 확인
2. 인스타 로그인 후 시작 → 릴스 수집 → 분류 → DM 전송 → 결과 리포트 확인

- [ ] **Step 6: 최종 커밋**

```bash
git add -A
git commit -m "feat: add login check, error display, and gitignore"
```

---

## Checklist: Spec → Task Coverage

| Spec 섹션 | Task |
|-----------|------|
| 사용 시나리오 | 5, 6, 9 |
| 아키텍처 (4 components) | 1, 4, 5, 7, 9 |
| 데이터 수집 (API 인터셉트) | 7 |
| AI 분류 | 3, 9 |
| DM 전송 (DOM 조작) | 8 |
| Popup UI | 5, 6 |
| Options Page | 4 |
| 파일 구조 | 1 |
| 데이터 저장 | 2 |
| 전체 실행 플로우 | 9 |
| 에러 처리 | 10, 11 |
