# 2026-06-18 디버깅 4건 — 근본 원인 분석 (수정 전 / 다음 세션 인계)

> 원인 분석만 완료. 수정 미착수. 각 건 = 현상 / 근본 원인(파일:라인) / 수정 방향. 한 건씩 진행.

---

## 1. 모바일 DM — 완성 이미지 업로드 모드 (기능 갭)

**현상**: 시세이도처럼 외주가 완성 이미지(4페이지 슬라이드)를 주는 브랜드는, 섹션을 짜지 않고 페이지별 완성 이미지만 올려 슬라이드/스크롤 + 단축 URL을 만들고 싶음.

**근본 원인 (버그 아님, 기능 갭)**:
- 모델이 섹션 기반: `stores/dmBuilderStore.ts` — `pages[].sections[]` + `layoutMode 'scroll'|'slides'`. 완성 이미지 1장=1페이지로 올리는 진입이 없음.
- 섹션 타입(`utils/dm-section-defaults.ts:16` `SectionType`)에 **풀페이지 전용 이미지 타입은 없음**. 단, 이미 있는 것:
  - `slideshow` (`SlideshowSlide = {image_url, caption?, link_url?}`) = 이미지 여러 장 슬라이드 (한 섹션 안).
  - `gallery` = 이미지 스크롤. `hero` = 풀배너 이미지 1장(+카피).
- 즉 "여러 완성 이미지 + 슬라이드/스크롤"은 `slideshow`/`gallery`가 **이미 지원**. 빠진 건 **진입점**: 섹션을 고르지 않고 "완성 이미지만 업로드"하는 흐름.

**수정 방향(택1, 다음 세션 결정)**:
- (A·간단·권장) "완성 이미지 업로드" 빠른 시작 → 업로드한 N장으로 `slideshow`(슬라이드) 또는 `gallery`(스크롤) 섹션 1개 자동 생성 → 단축 URL. 신규 섹션 타입 불필요.
- (B) 풀블리드 `image_full` 섹션 타입 신규(이미지 1장=1페이지) + slides 모드. 페이지=이미지 모델 부활(예전 D119 개념).
- 렌더(단축 URL) = backend `utils/dm/dm-builder.ts` — slideshow/gallery 렌더가 이미 있으면 (A)는 백엔드 변경 최소.

---

## 2. AI 오퍼레이션 — 자동 마케팅 생성 차단 (권한 정책, 버그 아님)

**현상**: 일반 사용자 계정(중간관리자 아님)으로 "+자동 마케팅 시작" → "(Continuous) Operator 신설은 회사 관리자만 가능합니다" 403.

**근본 원인 (의도된 게이팅)**:
- `routes/ai.ts:1729` `POST /operator/continuous` → `1735` `if (userType !== 'company_admin') return 403 'Continuous Operator 신설은 회사 관리자만 가능합니다.'`
- 추가로 `1741` `isAiOperatorAllowed(planCtx, req.user)` BETA 게이트(ENT 베타/허용 사용자).
- Operator 전 변경이 admin 전용으로 일관: 생성 1735 · 수정 1782 · 삭제 1822 · 수동실행 1950 · 승인 1995 · 거부 2017.

**판단 필요 (주인님)**: 회사 관리자 전용이 의도면 = 버그 아님(테스트를 admin 계정으로). 일반 사용자도 생성 허용할 거면 = `ai.ts:1735` 게이트 완화(단, 발송·돈에 닿으므로 영향 검토 + `feedback_ai_operator_user_gating` 룰 일치 확인). **정책 먼저, 그 다음 코드.**

---

## 3. AI Operator — 생성된 문안 수동 수정 불가 (UI 갭)

**현상**: 프롬프트로 생성된 추천 문안을 손으로 못 고침. AI 다듬기 후에도 추가 편집 수단 없음.

**근본 원인**:
- `pages/AiOperatorPage.tsx:960~967` 본문이 **읽기 전용 `<pre>`**로 렌더(`activeBody`를 highlightVars/mergeAndHighlightVars로 표시만).
- 변경 수단은 둘뿐: "AI로 다듬기"(`988` → AiRefineModal → `refinedOverrides[idx]` 오버라이드) + "다듬어짐·되돌리기"(`969`). **직접 타이핑 편집 입력이 없음.**
- 다듬은 결과도 같은 `<pre>`라 다듬은 뒤에도 직접 편집 불가.

**수정 방향**:
- 본문 박스에 편집 토글(또는 클릭 시 `<textarea>` 전환) → 입력값을 `refinedOverrides[safeIdx]`에 기록(수동 오버라이드). 다듬기 결과 위에서도 이어서 편집 가능.
- 데이터 배선은 이미 존재(`refinedOverrides` 맵 + `activeBody = refinedOverrides[idx] || variant.body`, `472`/`846`). 편집 UI만 추가하면 됨. 발송 시 `activeBody`(오버라이드 우선) 사용 경로도 그대로 맞물림.

---

## 4. 싱크에이전트 — 2008 R2(Oracle 최저사양) 서비스 시작 실패 + 콘솔 깨짐 (원인 2개)

**현상**: `[OK] runtime works - installing service`까지 가고 `[SC] StartService 실패 1053`(서비스가 제때 응답 안 함)으로 STOPPED. + 콘솔 한글이 mojibake.

### 4-A. StartService 1053 (서비스 시작 실패) — 구조적, OS 무관
**근본 원인**:
- `src/service/index.ts:90~95` `installServiceWindows()`가 `sc create SyncAgent binPath= "${exePath}"`로 **맨 exe(Node pkg 단일 실행파일)를 서비스로 등록**.
- `src/main.ts`에 **Windows 서비스(SCM) 모드가 전혀 없음** — 설정 있으면 `import('./index')`로 에이전트 루프만 실행(라인 136). SCM에 `SERVICE_RUNNING`을 보고하는 디스패처(`StartServiceCtrlDispatcher`/`SetServiceStatus`) 없음.
- → `sc start`가 exe를 띄워도 exe가 SCM에 RUNNING 보고를 안 함 → SCM 약 30초 타임아웃 → **1053**. Node 단일 exe는 래퍼 없이 Windows 서비스가 될 수 없음 → **2008 R2/사양 문제 아니라 어느 Windows에서도 실패**.
- (부가 결함) 설정 파일 전(미설정) 상태로 서비스가 exe를 띄우면 `main.ts:108` `!exists` 분기로 **설치 마법사**가 뜸 — 서비스 모드에 부적합.

**수정 방향**:
- Windows 서비스 래퍼 도입(WinSW.exe 또는 NSSM 동봉, 혹은 node-windows). `sc create binPath=`을 **래퍼**로 가리키게 하고 래퍼가 exe를 자식으로 실행 + SCM 핸드셰이크 담당. (Linux는 systemd Type=simple이라 무관 — 현 코드 정상.)
- 또는 서비스 모드 진입 시(별도 플래그) SCM 디스패처를 구현/우회. 가장 현실적 = WinSW 동봉(2008 R2 호환 .NET 버전 주의).
- 서비스 실행 경로에선 마법사 진입 차단(설정 없으면 즉시 종료/대기).

### 4-B. 콘솔 mojibake (로그 깨짐) — 코드페이지 불일치
**근본 원인**:
- 설치 bat `scripts/INSTALL-run-as-admin.bat.tpl` — `@echo off`만 있고 **`chcp 65001` 없음**. 2008 R2 한국어 콘솔 기본 코드페이지 = cp949(EUC-KR).
- exe(`service/index.ts`)는 UTF-8 한글 + 박스문자(`╔══╗`) + 이모지(✅❌⚠️📋💡)를 stdout으로 출력. bat이 `diagnose.txt`(UTF-8)로 받아 `type`으로 cp949 콘솔에 뿌림 → UTF-8 바이트가 cp949로 해석돼 **깨짐**(이모지·박스문자는 cp949 매핑 없어 `?`).
- 증거: 같은 화면에서 `sc`(Windows 기본툴, cp949 출력)는 멀쩡, exe의 UTF-8 출력만 깨짐.

**수정 방향**:
- bat 첫 줄에 `chcp 65001 >nul` + bat 파일 UTF-8 저장. + exe 시작 시 Windows 콘솔 출력 코드페이지를 UTF-8로(예: 부팅 시 `chcp 65001` 호출 또는 콘솔 API).
- 더 견고히 = 서비스/설치 콘솔 출력에서 **이모지·박스문자 제거(ASCII 안전)** — 구형 콘솔에서 어차피 표현 불가. 한글은 chcp 65001로 해결.

---

## 진행 순서 제안
- 2번 = 정책 판단 선행(주인님). 3번·1번 = frontend 기능(중간). 4번 = 별도 sync-agent 레포(4-A 서비스 래퍼가 가장 큼, 4-B는 빠름).
- 한 건씩: 그 건 zip/화면 재확인 → 수정안 → 동의 → 구현 → 검증.
