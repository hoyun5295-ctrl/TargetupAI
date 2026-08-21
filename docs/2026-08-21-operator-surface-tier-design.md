# AI Operator 표면 단계 체계(OUI) : 설계·구현 기록 (2026-08-21)

> **호출어 = "오퍼레이터 표면 단계"**. 이 문서가 체계·값·불변식·⛔·이력을 소유한다. STATUS·SOT-INDEX·memory는 포인터만.
> 결정 경위 = §8 회의록(전원 합의 브레인스토밍). 허브 자체의 0821 낮 판정 경위 = [AI Operator 표면 개편 §13](2026-08-21-ai-operator-surface-design.md).

## §1 한 줄
허브는 보라 아이덴티티 면으로 무접촉, 메뉴 안 작업면 16개는 `bg-slate-950` 단색 + 바이올렛 액센트로 통일했다. 값은 `frontend/src/utils/operator-ui.ts`(`OUI_*`) 하나가 소유하고, 불변식 테스트가 잠근다.

## §2 배경(실측)
Harold: "각 메뉴마다 배경색부터 아예 달라. 전체 통일시키는 게 맞지 않겠냐. 오퍼레이터 메인은 보라로 하고 메뉴 안은 자동마케팅이나 플래너처럼 한다든지 의견 제시가 있어야지." 0821 낮 A/B에서 허브 옛 톤이 이긴 것은 상대 평가였고 보라 선호가 아니다(Harold 정정).

착수 전 실측(`grep -rn "min-h-screen" packages/frontend/src/pages/*.tsx`):
| 바닥 | 파일 |
|---|---|
| 보라 그라데이션(허브와 동일) | AiOperatorPage(허브) · JourneysPage · JourneyDetailPage · JourneyStatsPage · JourneyPausePage · EmailCampaignsPage · AiUsagePage · CdpSettingsPage · PredictiveDashboardPage(로딩·에러 2곳만) |
| slate 그라데이션 | ContinuousOperatorPage · InAppMessagesPage(2) · ImageStudioPage · PredictiveDashboardPage(본문) |
| slate 단색 | MarketingPlannerPage · PlannerBriefPage · AiMemoryPage · PerformancePage · QuickCampaignPage · MarketingCalendarPage |
| slate+violet | BestCopyPage · AiTrainingDataPage(둘 다 슈퍼관리자, 뒤로가기 = /admin) |
| 인라인 hex | DmBuilderPage |
헤더 바도 3벌(`bg-violet-800/50` · `bg-slate-950/80` · `bg-slate-900/70`). 0527에 다크→보라로 옮겼다가 0627에 AI 메모리·인앱이 조용히 slate로 돌아온 왕복 이력이 있었고 주석은 "보라 톤 다운"으로 남아 있었다(정정함).

## §3 체계
| 단 | 바닥 | 아우라 | 폭 | 헤더 | 적용 |
|---|---|---|---|---|---|
| 허브 | 보라 그라데이션 + 글로우 3(현행) | 현행 | 현행 | 현행 | AiOperatorPage 1개 |
| 흐름 작업면 | `bg-slate-950` 단색 | 상단 1(absolute) | 3xl | 표준 | 자동마케팅 · 원클릭 · 여정 main/review |
| 데이터 작업면 | `bg-slate-950` 단색 | 상단 1 | 7xl(현행 5xl·6xl·1600px은 폭 별건까지 유지) | 표준 | 플래너 · 브리핑 · 캘린더 · AI 메모리 · 사용량 · 성과 · 예측 · 자사몰 연동 · Email · 여정 상세·통계 · 인앱 목록 · 이미지 갤러리 |
| 캔버스 뷰 | `bg-slate-950` 단색 | 0 | 전면 | 표준 | 여정 studio · 인앱 편집(두 번째 root) · 이미지 스튜디오 편집 단계 |

- 바이올렛은 메뉴 안에서 액센트(버튼·활성 탭·진행바·아이콘 타일·아우라)로만 쓴다. 바닥·헤더 바에 violet 면을 두지 않는다.
- 헤더 1규격: `OUI_HEADER`(sticky · slate-950/80 · blur · `border-b`) 안에 뒤로가기(`OUI_BACK`) · 아이콘 타일 10x10(`OUI_ICON_TILE` + 허브 타일과 같은 그라데이션을 호출부가 붙임) · 제목(`OUI_TITLE` text-lg/xl) · 부제(`OUI_SUBTITLE`, 모바일 숨김) · 우측 액션 최대 2.
- 통일성은 바닥보다 헤더가 만든다(상단 72px에 가장 먼저·가장 오래 보이는 색면).
- CT 선택 규칙: **뒤로가기를 따라 올라간 뿌리가 `/ai-operator`면 `OUI_` / 관리·조회면 `CUI_` / DM 편집기 안이면 `DM_`.** 콘솔과 가르는 1차 축은 액센트 색이 아니라 지면이 다크냐 라이트냐다.

## §4 구현(2026-08-21 밤, 전량)
| 파일 | 변경 |
|---|---|
| `frontend/src/utils/operator-ui.ts` (신설) | `OUI_PAGE` · `OUI_PAGE_CENTER` · `OUI_AURA(_WRAP)` · `OUI_WRAP_NARROW/WIDE/FULL` · `OUI_HEADER` · `OUI_HEADER_ROW` · `OUI_BACK` · `OUI_ICON_TILE` · `OUI_TITLE` · `OUI_SUBTITLE` · `OUI_BADGE_NEW` · `OUI_BTN_PRIMARY/OUTLINE/GHOST` · `OUI_CARD(_HOVER/_ACCENT)` · `OUI_EMPTY*` · `OUI_TAB_ON/OFF` · `OUI_SRC` · `OUI_CHART_TOOLTIP` |
| `frontend/src/components/operator/OperatorAura.tsx` (신설) | 상단 아우라 1. root 바로 아래 형제. 캔버스 뷰는 조건부로 뺀다 |
| 작업면 16파일 | root → `OUI_PAGE`(로딩·에러 조기 반환은 `OUI_PAGE_CENTER`) · 헤더 바 → `OUI_HEADER` · 헤더 행 폭(3xl/7xl 표준형만) → `OUI_WRAP_* + OUI_HEADER_ROW` · 뒤로가기·타일·제목·부제 토큰화 |
| JourneysPage · JourneyDetailPage · JourneyStatsPage | 타일 없던 헤더에 Workflow 타일(`from-fuchsia-400 to-purple-500`) 추가. 상세·통계는 본문 안 헤더를 sticky 바로 승격. 목록 아우라는 `view !== 'studio'`일 때만 |
| ContinuousOperatorPage | 아이콘 `bg-indigo-500`(콘솔 액센트 잔재) → 허브 타일 그라데이션 `from-indigo-400 to-violet-500` |
| PredictiveDashboardPage | 로딩·에러 보라 2곳 → slate(진입 때 번쩍이던 현존 결함 해소). 본문 헤더 sticky 바로 승격 |
| InAppMessagesPage | 첫 root(채널 선택)만 아우라, 두 번째 root(목록+편집)는 아우라 0 |
| ImageStudioPage | `stage === 'gallery'`일 때만 아우라 |
| PerformancePage · PredictiveDashboardPage · JourneyStatsPage | Recharts 툴팁 `#0f172a` 인라인 → `OUI_CHART_TOOLTIP` |
| AiMemory · InApp · Email · AiUsage · Journeys | 거짓 주석("다크 → 보라 톤 다운") 정정 |
| `backend/src/utils/__tests__/operator-surface-invariants.test.ts` (신설) | §6 불변식 |

게이트: frontend tsc 0 · backend vitest(불변식 4종 + 전량) · 프론트 `build:safe`는 배포 시.

## §5 바꾸지 않은 것(의도)
- 허브 `AiOperatorPage`: 지면·글로우·헤더 무접촉. 지면 리터럴은 허브 파일에 정확히 1회(토큰 이관 없음).
- `JourneyPausePage`: 비로그인 수신자 공개 면이라 아이덴티티 톤(보라) 유지.
- `DmBuilderPage`: 인라인 style + dm-tokens 체계. 별건.
- `BestCopyPage` · `AiTrainingDataPage`: 슈퍼관리자(뒤로가기 `/admin`). 규칙상 OUI 대상이 아니다.
- 본문 폭(5xl·6xl·1600px)과 보라 전제로 올린 글씨 명도(JourneysPage `/80·/55`): 색 변경과 섞지 않기로 해 그대로. 별건.
- Data source 캡션: 값 소유는 `ui-token-invariants`. 신규 캡션 추가 없음.

## §6 불변식 (`operator-surface-invariants.test.ts`)
1. 대상 목록 16파일: 바닥·헤더 바 리터럴 0회(`from-violet-900 via-fuchsia-900 to-violet-900` · `bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950` · `from-slate-950 via-violet-950 to-slate-950` · `className="min-h-screen bg-slate-950` · `className="min-h-screen bg-gradient` · `bg-violet-800/50`) + `OUI_PAGE` import.
2. 보호 목록(허브 · DM 빌더 · 정지 공개 페이지 · 진단 · 대행 · 카페24 런치 · 베스트카피 · 학습데이터): `OUI_` 0회. 두 목록 교집합 0. 목록 밖은 대상 아님.
3. 허브 지면 리터럴은 허브 파일에 정확히 1회.
4. 값 계약(import, 색 축만): `OUI_PAGE` ∋ `bg-slate-950`, ∌ `via-`; `OUI_HEADER` ∋ `border-b` · `sticky`.
넣지 않은 규칙: 아우라 포함 의무(조건부 렌더라 정적 판별 불가) · 폭 단정.

## §7 별건(이 트랙 밖, 착수 판단 = Harold)
- 허브 타일 그라데이션 중복 5종: 플래너·이미지 스튜디오·예측(`violet-400→fuchsia-500`), AI 메모리·자사몰 연동(`emerald-400→teal-500`). 디자이너 제안값 = 이미지 스튜디오 `sky-400→indigo-500` · 예측 `purple-400→indigo-600` · 자사몰 연동 `lime-400→emerald-500`(플래너·메모리 유지). 0718·0812 배열은 Harold 확정이라 별건.
- 본문 폭 4벌 정렬(3xl/7xl/full 3단으로). 여정 한 파일 안에 5벌.
- `SegmentsPage` · `OnboardingWizardPage` 보라 바닥(오퍼레이터 뿌리 아님).
- `JourneyPausePage:325` 캡션 "CT-94 · HMAC-SHA256" 내부 식별자가 비로그인 고객 화면에 노출(1줄 HOTFIX 권장, LESSONS_META 단어 게이트 위반).
- `DmBuilderPage` 인라인 hex 정리.
- JourneysPage 보라 전제 글씨 명도(`/80·/55`)를 slate 위 기준(`/70·/50`)으로 내릴지: 라이브에서 흐린 곳만.

## §8 회의록(전원 합의 브레인스토밍, 2026-08-21 저녁)
참석 = 기획 · 프론트엔드 · 디자이너 · 백엔드 · 회의론자(전원 읽기 전용) / 주재 = 비토. 절차 = 1차 의견 → 주재자 실측 검증 → 교차 반박 1라운드 → 회의론자 최종 검증 → 수렴.

**주재자 실측표 정정(회의가 잡아냄)**: 자사몰 연동 누락 · 여정은 4파일 · 예측 본문은 이미 slate · AI 메모리·인앱 주석 거짓 · 타일 중복 5종 · 폭 4벌.

**쟁점과 결론**
| 쟁점 | 갈린 의견 | 결론 |
|---|---|---|
| 첫 수 | 주재자: 여정 1페이지 / 전원: 자동마케팅 더하기 | 자동마케팅 더하기(이미 slate) |
| 바닥 변경 | 회의론자: 문법만 / 기획·디자이너: 원문이 바닥 | 게이트 뒤 2수(Harold "합의안으로 끝까지"로 같은 세션에 전량 실행, 게이트 = 체계대로 검정) |
| 2단 vs 3단 | 기획 폭 / 디자이너 뷰 | 색 2벌 + 아우라·폭 3단 |
| CT 시점 | 프론트·디자이너 1수 / 기획 2수 | 전량 실행이라 1회차에 신설 |
| 타일 색 연결 | 디자이너 헬퍼 / 프론트 prop | prop(16페이지 의존 회피) |
| 배포 단위 | 기획 색군 / 백엔드 파일 | 색군, 예측은 파일 단위로 해소 |
| 정지 공개 페이지 | 프론트 포함 / 기획 제외 | 제외 |
| 캡션 | 디자이너 문법 필수 / 기획·백엔드 반대 | 기존 불변식 소유, 신규 없음 |
| 타일 중복 분리 | 디자이너 분리 / 기획 별건 | 별건(값은 §7) |
| 폭 정렬 | 기획 1순위 / 회의론자 근거 약함 | 색과 분리, 별건 |

**회의론자 최종 검증 3건(반영)**: ① CT 규칙은 "뒤로가기 목적지"가 아니라 "뿌리"(여정 상세·통계는 `/ai-journeys`로 돌아감) ② 2수 게이트는 예측 답 단독 ③ 글씨 명도 하향은 색 커밋에서 분리.
**채택하지 않은 의견**: 디자이너 "1수에 여정 헤더 바 동반"(변수 둘) · 디자이너 "캡션 문법 필수"(소유자 이중).

## §9 ⛔
- 허브 값은 `operator-ui.ts`로 옮기지 않는다. 허브는 보호 목록이다.
- 새 오퍼레이터 화면은 대상 목록 등재 + `OUI_PAGE`가 리뷰 항목이다. 바닥·헤더 바 리터럴을 직접 쓰지 않는다.
- 작업면 바닥은 단색이다. `via-slate-900` 그라데이션은 카드(`bg-white/5`)와 바닥 차를 지워 카드 체계를 무너뜨린다.
- 아우라는 root의 형제로, `absolute`로만. 조상에 filter·transform을 두지 않는다. 캔버스 뷰에는 두지 않는다.
- 판정 질문은 "같은 앱으로 보입니까 · 튀는 곳이 있습니까"다. "어느 쪽이 나으냐"는 0821에 네 번 진 질문이다.
