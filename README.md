# Reelmelier (릴믈리에)

인스타그램 릴스를 AI(Claude)가 분석하여 친구 취향에 맞는 릴스를 자동으로 DM 공유하는 크롬 확장 프로그램.

## 사용법

1. `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드
2. 설정(⚙️)에서 Anthropic API 키 입력
3. 친구 추가 (이름 + 취향 설명 + 인스타 유저네임)
4. 탐색할 릴스 개수 설정 → 시작

## 동작 방식

```
릴스 탭 자동 오픈 → 릴스 하나씩 스크롤
→ 캡션/해시태그/댓글/썸네일 수집
→ Claude API로 친구 취향과 매칭 판단
→ 매칭된 릴스를 친구에게 DM 자동 전송
→ 결과 리포트
```

## 기술 스택

- Chrome Extension Manifest V3
- Anthropic Claude API (비전 + 텍스트)
- Vanilla JS

## 설정

| 항목 | 기본값 | 설명 |
|------|--------|------|
| AI 모델 | Claude Sonnet 4.6 | Haiku 4.5도 선택 가능 |
| Confidence 임계값 | 0.3 | 이 이하면 패스 |
| DM 딜레이 | 2~5초 | 스팸 방지 |
