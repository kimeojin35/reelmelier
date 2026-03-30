# Reelmelier (릴믈리에) — Design Spec

인스타그램 릴스를 AI로 분류하여 친구에게 자동 DM 공유하는 크롬 확장 프로그램.

## 사용 시나리오

1. 친구 목록과 취향 키워드 등록 (예: 민수 → "힐링되는 고양이 릴스")
2. 탐색할 릴스 개수 입력 (예: 10개)
3. "시작" 클릭
4. 확장 프로그램이 릴스 탭에서 릴스를 하나씩 넘기며 정보 수집
5. OpenAI API로 각 릴스를 분류 → 매칭되는 친구가 있으면 큐에 저장, 없으면 패스
6. 탐색 완료 후 친구별로 그룹핑하여 인스타 DM으로 릴스 링크 자동 전송
7. 결과 리포트 표시

## 아키텍처

```
┌─────────────────────────────────────┐
│          Chrome Extension           │
├──────────┬──────────┬───────────────┤
│ Popup UI │ Options  │ Background SW │
│ (제어판) │ (설정)   │ (오케스트라)  │
└────┬─────┴────┬─────┴───────┬───────┘
     │          │             │
     │          │     ┌───────▼────────┐
     │          │     │ Content Script │
     │          │     ├────────────────┤
     │          │     │ • API 인터셉트 │
     │          │     │   (데이터수집) │
     │          │     │ • DOM 조작     │
     │          │     │   (DM 전송)    │
     │          │     └───────┬────────┘
     │          │             │
     │          │     ┌───────▼────────┐
     │          │     │  OpenAI API    │
     │          │     │  (분류 판단)   │
     │          │     └────────────────┘
```

4개 컴포넌트:
- **Popup UI** — 친구 관리, 릴스 개수 설정, 시작/정지, 결과 리포트
- **Options Page** — OpenAI API 키 입력/저장
- **Background Service Worker** — 전체 흐름 조율, OpenAI API 호출, 상태 관리
- **Content Script** — Instagram 페이지에서 API 응답 인터셉트(데이터 수집) + DOM 조작(DM 전송)

## 데이터 수집 (API 인터셉트)

Content Script가 Instagram 내부 GraphQL API 응답을 가로채서 릴스 데이터를 추출한다.

동작:
1. Content Script가 `<script>` 태그를 페이지에 삽입하여 main world에서 `fetch`/`XMLHttpRequest`를 monkey-patch (Content Script의 isolated world에서는 페이지의 네트워크 요청을 가로챌 수 없으므로 main world injection 필수)
2. Main world 스크립트가 릴스 관련 엔드포인트(`/api/graphql`, `/api/v1/clips/`) 응답을 가로채면 `window.postMessage`로 Content Script에 전달
3. Content Script가 릴스 탭에서 스크롤을 자동 수행하여 새 릴스 로드 트리거

각 릴스에서 추출할 데이터:

| 필드 | 출처 | 용도 |
|------|------|------|
| 캡션 텍스트 | API 응답 | AI 분류 |
| 해시태그 | 캡션에서 파싱 | AI 분류 |
| 댓글 (상위 10개) | API 응답 | AI 분류 맥락 |
| 썸네일 URL | API 응답 (`display_url`) | AI 비전 분석 |
| 릴스 URL/ID | API 응답 | DM 공유 링크 |
| 오디오 정보 | API 응답 | AI 분류 보조 |

API 응답에 고화질 썸네일 URL이 포함되어 있으므로 별도 스크린샷 캡처 불필요. Background SW가 이 URL을 OpenAI Vision API에 전달.

## AI 분류

Background Service Worker가 수집된 릴스 데이터를 OpenAI API로 보내서 분류한다.

프롬프트 구조:

```
시스템: 너는 릴스 분류기야. 각 친구의 취향 설명을 보고,
       이 릴스가 어떤 친구에게 맞는지 판단해.
       맞는 친구가 없으면 "none"을 반환해.

입력:
- 친구 목록: [{name: "민수", preference: "힐링되는 고양이 릴스"}, ...]
- 릴스 정보: {caption, hashtags, comments, audio_title}
- 썸네일 이미지: [image_url]

출력 (JSON):
{
  "matches": ["민수"],
  "reason": "고양이가 등장하며 잔잔한 배경음악",
  "confidence": 0.85
}
```

규칙:
- 하나의 릴스가 여러 친구에게 매칭 가능
- confidence가 임계값(기본 0.5) 미만이면 패스
- 매칭 친구 없으면 스킵
- 모델: `gpt-4o` (비전 지원 + 비용 효율)
- 릴스마다 개별 API 호출

## DM 전송 (DOM 조작)

모든 릴스 분류 완료 후 친구별로 그룹핑하여 순차 전송한다.

전송 흐름:
1. 결과를 친구별로 그룹핑 (민수: [릴스1, 릴스3], 지은: [릴스2])
2. 친구 한 명씩 순차 처리:
   - `instagram.com/direct/new/`로 이동
   - 검색창에 인스타 유저네임 입력 → 결과에서 선택
   - 릴스 링크(`instagram.com/reel/ABC123`) 입력 → 전송
   - 여러 개면 각 링크를 순차 전송
3. 다음 친구로 이동

설계 결정:
- **친구 식별**: 인스타 유저네임으로 검색 (설정에서 등록)
- **전송 간격**: 각 DM 사이에 2~5초 랜덤 딜레이 (스팸 감지 방지)
- **실패 처리**: DOM 요소 못 찾으면 3회 재시도 후 스킵, 리포트에 실패 표시
- **타이밍**: 릴스 탐색 완료 후 일괄 전송 (탐색 중에는 DM 안 보냄)
- **방식**: 릴스 공유 버튼 대신 DM 창에서 릴스 URL 직접 전송. 인스타가 자동으로 릴스 프리뷰 생성.

## Popup UI

싱글 스크롤 레이아웃 (400×500px):

- **헤더**: 로고 + 설정(⚙️) 버튼
- **친구 목록**: 칩 형태 (이름 + 취향 요약). "+" 버튼으로 추가, 클릭으로 편집/삭제
- **실행 컨트롤**: 릴스 개수 입력 + 시작 버튼
- **진행상황**: 프로그레스바 + 현재 상태 (N/M 릴스 확인, X개 전송됨)
- **결과 리포트**: 완료 후 친구별 전송 결과 요약

## Options Page

| 설정 | 기본값 | 설명 |
|------|--------|------|
| OpenAI API Key | (빈값) | GPT-4o 호출용 |
| AI 모델 | `gpt-4o` | 변경 가능 |
| Confidence 임계값 | `0.5` | 이 이하면 패스 |
| DM 전송 간격 | `2~5초` | 스팸 방지 랜덤 딜레이 |

## 파일 구조

```
reelmelier/
├── manifest.json          # Chrome Extension Manifest V3
├── popup/
│   ├── popup.html
│   ├── popup.css
│   └── popup.js           # 친구 관리, 실행 제어, 결과 표시
├── options/
│   ├── options.html
│   └── options.js         # API 키, 모델, 임계값 저장
├── background/
│   └── service-worker.js  # 오케스트레이터: 흐름 제어, OpenAI 호출
├── content/
│   ├── content-script.js  # Content Script 진입점: 메시지 라우팅, DOM 조작 (isolated world)
│   ├── injector.js        # 페이지 main world에 주입할 API 인터셉트 스크립트
│   └── dm-sender.js       # DM 전송 DOM 조작 로직
├── utils/
│   ├── openai.js          # OpenAI API 래퍼
│   └── storage.js         # chrome.storage 헬퍼
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## 데이터 저장 (chrome.storage.local)

- `friends` — 친구 목록 `[{name, preference, username}]`
- `settings` — API 키, 모델, 임계값, 딜레이
- `lastResult` — 마지막 실행 결과 리포트

## 전체 실행 플로우

```
[시작 버튼 클릭]
    ↓
① 릴스 탭(instagram.com/reels/) 열기 or 이동
    ↓
② 릴스 하나 로드 → API 응답 인터셉트로 데이터 추출
    ↓
③ Background SW → OpenAI API 호출 (캡션+해시태그+댓글+썸네일)
    ↓
④ 분류 결과 수신
   ├─ 매칭 있음 → 결과 큐에 저장
   └─ 매칭 없음 → 패스
    ↓
⑤ 다음 릴스로 스크롤 (키보드 ↓ 또는 스와이프 시뮬레이션)
    ↓
⑥ ②~⑤ 반복 (설정한 개수만큼)
    ↓
⑦ 탐색 완료 → 결과를 친구별로 그룹핑
    ↓
⑧ 친구 한 명씩 DM 페이지로 이동 → 릴스 링크 전송
    ↓
⑨ 전부 완료 → 팝업에 결과 리포트 표시
```

## 에러 처리

- **API 인터셉트 실패**: DOM fallback으로 캡션/해시태그 직접 추출
- **OpenAI API 오류**: 해당 릴스 스킵, 리포트에 표시
- **DM 전송 실패**: 3회 재시도 후 스킵, 리포트에 실패 표시
- **인스타 로그인 안 됨**: 시작 전 감지, 사용자에게 알림
