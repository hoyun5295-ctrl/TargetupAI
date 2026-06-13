# DM 전체 디자인 완성도 설계서 (E) — 2026-06-13

> 모바일 DM 재설계 7개 서브 중 **E**. 연계: A(editor 빈 패널 해소), C(이미지 placeholder).

## 배경 (검색 실측)

Harold: "전체적으로 다 후져 솔직히 진짜 구려." 실측 디자인 문제.
1. **정렬 제각각**: 헤더 logo형 좌측(`space-between`)·히어로 가운데(align)·상품 placeholder 좌측·일부 이벤트(룰렛/쿠폰)만 가운데 — 일관성 0.
2. **이미지 미설정 자리**: 히어로 미설정 시 검은 배경(neutral-900)만, "이미지 넣어주세요" 안내 없음.
3. **속성 패널 빔**(A): 신규 섹션 선택 시 제목만.
4. **캔버스 ↔ 발송 뷰어 정렬 불일치 위험**: 캔버스(HeaderSection 등)와 뷰어(dm-viewer renderHeader 등)가 별도 코드 → 정렬·여백 다를 수 있음(D230+ 발송 본문 일치 정신).

## 목표

정렬·여백·톤을 통일하고, 빈 상태를 안내로 채우고, 캔버스와 발송 뷰어를 일치시킨다.

## 1. 정렬 통일

- 헤더 logo형에 **정렬 옵션**(좌/가운데) 추가 — 기본 가운데(Harold). 전화번호는 가운데 시 브랜드 아래 작게.
- 섹션 공통 정렬 토큰: 제목·placeholder·안내문 정렬을 섹션 메타로 일관(상품 가로스크롤은 예외).
- 캔버스(`HeaderSection`/`HeroSection`/`NewSections`)와 뷰어(`dm-section-renderer`/`dm-viewer`)의 정렬·여백을 **동일 토큰**(dm-tokens)으로 통일 → 미리보기=발송 일치.

## 2. 빈 상태 안내

- 이미지 미설정: 검은/회색 자리에 "이미지를 넣어주세요" 아이콘+안내(편집 모드만, 발송엔 미노출).
- 섹션 내용 미입력: placeholder를 일관 스타일(이탤릭·회색)로.
- 빈 DM: 가운데 일러스트 + "빠른 시작으로 만들기" CTA.

## 3. 여백·톤 토큰 정리

- `dm-tokens.ts`(--dm-sp-*/--dm-fs-*/--dm-neutral-*/--dm-radius-*)를 섹션 전체가 일관 참조. 하드코딩 px 제거.
- 브랜드 킷(primary/accent/tone) 반영 일관 — 톤(playful/premium/elegant)별 폰트·여백 변형.
- 모달·패널 다크톤 통일(한줄로 톤앤매너).

## 4. 속성 패널 UX (A 연계)

- 빈 패널 0(A 완료 시). 공통 속성(표시/AI재생성제외/스타일변형) + 섹션별 설정 + 도움말 hint.

## 5. 캔버스 ↔ 뷰어 일치 검증

- 동일 섹션을 캔버스·뷰어로 렌더 → 시각 diff 점검(주요 섹션). 정렬·여백·색 토큰 일치.

## 검증

- frontend tsc 0 / backend tsc 0(뷰어 렌더러).
- 자가 grep: 박-단어·모델명·native dialog 0. ConfirmModal/useToast(native dialog 0).
- 디자인 퀄리티 최소 = AI 여정(Journey Builder) 동급(feedback_design_quality_minimum_journey_level).

## 배포

`tp-push` → frontend `build:safe` + backend(뷰어 렌더러 변경 시 `pm2 restart all`).
