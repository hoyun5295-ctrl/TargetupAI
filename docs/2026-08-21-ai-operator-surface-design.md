# AI Operator 표면 개편 — 「밝은 지면, 진한 오브젝트」 (설계서 · **★Harold 판정 기각 — §13**)

> **★2026-08-21 저녁 판정: 이 설계서의 라이트 안은 Harold 부부 A/B에서 "기존이 낫다"로 기각됐다.** 같은 날 2차 회의의 C·B 안(옛 지면 유지 + 개선 / 새 지면 + 개선)도 기각.
> 최종 = **옛 허브 그대로 + 제목 한 단 축소 + ! 호버 팝오버(제목 아래 중앙)** — §13. §1~§12는 경위 기록으로 보존한다(다시 같은 안을 내지 않기 위해).
>
> 2026-08-21 Harold 발안("AI Operator 허브와 하위 메뉴 전부에서 'AI로 대충 만들었네'로 읽히는 티를 완벽하게 벗겨내고 싶다").
> 브레인스토밍 회의(COLLAB §1 — 기획·디자이너·프론트엔드·백엔드·회의론자) 3라운드 끝에 **전원 서명**한 합의안이다.
> 이 문서가 소유하는 것 = 결정·토큰·매핑·범위·회차·게이트·⛔·회의 기록. 불변 원칙의 원천은 CLAUDE.md와 `status/lessons/LESSONS_FRONTEND.md`이고,
> 라이트 토큰의 값은 `packages/frontend/src/utils/console-ui.ts`가 소유한다(여기는 왜 그 값인가만).
> 표기 규약: **[확정]** = 코드·실측으로 본 사실 / **[합의]** = 회의 전원 서명 / **[Harold]** = 대표 결정 / **[미검증]** = 실측 전 가설.

---

## §0 한 줄

AI Operator 허브와 하위 20페이지의 지면을 **대시보드·관리 화면과 같은 라이트(`bg-gray-100`)** 로 내리고, 바이올렛은 지면에서 빼서 **불투명 실행 오브젝트 1장**에만 올린다.
유리 카드·블러·그라데이션 버튼·영문 eyebrow·"AI " 접두 라벨을 걷어내되, 제목 크기·카드 구성·hover 연출은 그대로 둔다.
허브 1장을 실제 코드로 먼저 바꿔 배포하고 Harold가 라이브에서 판정한 뒤에만 나머지로 간다.

## §1 왜 이 형태인가 — 회의가 확인한 사실

- **[확정] AI 티의 실체는 바이올렛이 아니라 "채도 있는 어두운 지면 + 유리 카드 + 그라데이션 액센트"라는 조합이다.**
  Harold가 좋다고 한 대시보드 카드 3장 중 하나가 `from-violet-700 via-purple-700 to-fuchsia-600`([Dashboard.tsx:2801](../packages/frontend/src/pages/Dashboard.tsx))인데 AI 티가 나지 않는다 —
  `bg-gray-100` 밝은 지면([Dashboard.tsx:2046](../packages/frontend/src/pages/Dashboard.tsx)) 위 **5% 면적의 불투명 오브젝트**이기 때문이다. 허브는 같은 보라를 **100% 면적의 지면**에 깔았다. 차이는 색이 아니라 면적이다.
- **[확정] 유리 카드는 원인이 아니라 증상이다.** 지면에 채도가 있으니 그 위 컬러 타일이 지면과 싸우고, 중화하려고 반투명 유리(`bg-white/[0.07] backdrop-blur-xl`)를 덮게 된다. mo-tive.com(Harold가 "AI로 만든 티가 나는" 예로 든 사이트) 실측 = 유리 카드 `rgba(255,255,255,.03)` 80곳·그라데이션 배경 242·그라데이션 글자 50·영문 eyebrow 28·지면 `rgb(6,11,24)`.
- **[확정] 다크 21페이지가 이 앱의 소수파다.** `packages/frontend/src` 실측 `bg-white` 1,922 : `slate-950` 245 : `violet-950` 42. 대시보드·카카오&RCS·발송결과·수신거부·설정이 이미 라이트+인디고(콘솔 톤 0818). 대시보드→허브 진입 때 명도가 뒤집히는 것이 "다른 회사 제품" 신호의 1번 원인.
- **[확정] 12모듈 타일의 "12색"은 실제 9색·아이콘 9종이다.** `from-violet-400 to-fuchsia-500` 3장 중복(플래너·이미지 스튜디오·자율 예측), `from-emerald-400 to-teal-500` 2장 중복, Brain 아이콘 3회 — 색이 구분 일을 하지 않는다(`constants/ai-operator-modules.ts:43-61`).
- **[확정] 주재자의 앞선 두 시안(다크 유지 + 빼기)은 실패했다.** "검정 + 인디고 + 얇은 선"은 또 하나의 AI 기본값이다(memory `feedback_ai_tell_is_surface_signal_not_decoration`). 회의론자 판정: "Harold가 기각한 것은 '어두운 회색'이지 '밝음'이 아니다. 라이트는 미검증이지 기각된 적이 없다."
- **[확정] 회의가 분리한 두 축** — "AI 티를 완벽하게 벗긴 제품"에 가까운 쪽 = 라이트 / "더 안전한" 쪽 = 다크 유지(12줄). 이 안은 **안전 축을 버리고 완성도 축을 택한 것**이고, 그 대가가 §6의 "허브 1장 선행·페이지 단위 원자 전환·기각 시 즉시 revert"다.

## §2 확정 사실 (코드 실측 — 21페이지 + 공용)

| # | 사실 | 근거 |
|---|---|---|
| 1 | 루트 지면 = `bg-violet-950` 10 / `bg-slate-950` 7 / `from-slate-950 via-slate-900 to-slate-950` 3(ContinuousOperator·InAppMessages·ImageStudio) / DM빌더 인라인 `linear-gradient(135deg,#020617,#0f172a,#020617)` 2 / **PredictiveDashboardPage:478 본문 루트만 slate 그라데이션 잔존**(0821 커밋이 로딩·에러 456·464행만 바꿈 — 로딩은 보라, 데이터 오면 slate) | `min-h-screen` 전수 |
| 2 | sticky 헤더 레시피 **6종·25곳**(`bg-violet-800/50 backdrop-blur-md` 6 · `bg-slate-950/80 blur-sm` 6 · `bg-slate-900/70 blur-md` 3 · `bg-slate-900/80` 3 · `/90·/95` 3 · DM 인라인 1) | 프론트 실측 |
| 3 | α 토큰 2,554건 — 고유값 `text-white` 15종 · `bg-white` 13종 · `border-white` 7종. 상위 = `border-white/10` 493 · `text-white` 489 · `text-white/40` 297 · `bg-white/5` 255 · `text-white/50` 231 | §4 매핑 표의 근거 |
| 4 | 시그니처 그라데이션 `from-violet-500 to-fuchsia-500` 류 = 페이지 100(리터럴 50 + 데이터 조립) · 전역 163. 조립 데이터 = `ai-operator-modules.ts:45-60` 12건 · `AiOperatorPage.tsx:192-199` ACCENT_TOKENS 6 · `:2046-2050` priorityColor 3. 소비처 = AiOperatorPage 5곳 · AiOperatorWalkthroughModal:166 · BetaFeatureModal:154 | Tailwind `safelist` 없음(`tailwind.config.js`) — 데이터에서 문자열이 사라지면 CSS도 사라지고, 우연히 얹혀 살던 곳이 함께 죽는다 |
| 5 | `backdrop-blur` 210줄 중 `fixed inset-0` 스크림 116 · 헤더 25 · 패널 나머지. 페이지 내부 모달(`fixed inset-0`) **38곳**(EmailCampaigns 8 · InApp 7 · Journeys 5 …) | 0818 P0의 방아쇠 = blur × `overflow-hidden` 조합(`console-ui.ts:240-243`) |
| 6 | JourneysPage 불투명 `bg-slate-900` 29건 중 **24건은 입력 컨트롤**, 모달 1 | 기계 치환하면 칸이 지면과 같은 색이 되어 사라진다 |
| 7 | 서버가 색을 소유하는 AI 렌더 표면 **3종** — `performance-pdf-render.ts:39-41`(`primary '#7c3aed'`) · `crm-agency-pdf-render.ts:36-38,53,78,82-83,88`(violet 전면) · `daily-insight-mailer.ts:109-141`(다크 메일 + `linear-gradient(135deg,#7c3aed,#d946ef)` + CTA `#7c3aed`). **정산 PDF(`billing-pdf.ts`, indigo-700·라이트)·`pdf-party-block.ts`(정산 전용)·`invoice-public.ts`(거래처 공개 청구 페이지)는 AI 표면이 아니다** | 백엔드 실측·자기 정정 |
| 8 | 서버가 내려주는 "AI " 라벨 — `send-type-axis.ts:39-45` `SEND_TYPE_LABEL`(ai:'AI 추천' · operator:'AI 오퍼레이터' — 프론트 `campaign-axis.ts:149-157`과 동일을 `brand-axis-invariants.test.ts:178`이 강제, CSV 내보내기 축 공유) · `performance-data-availability.ts:99,108` `actionLabel: 'AI Operator 진입'` | |
| 9 | 인앱 컴포넌트 2개는 서버 렌더러와 파리티 테스트 3종(`inapp-poster-parity`·`inapp-media-fit-parity`·`inapp-flat-contract`)으로 묶여 있고, `inapp-media-fit-parity.test.ts:36-84`는 `pages/InAppMessagesPage.tsx` 본문의 인라인 style 문자열까지 대조한다 | 프론트 톤만 바꾸면 계약이 깨진다 |
| 10 | 라이트 토큰 CT `console-ui.ts`(`CUI_*` 104개)가 이미 11파일을 굴린다. 헤더 주석 27~28행 "라이트 표면 전용 … 다크 톤 화면(여정·AI 기능)에는 옮기지 않는다" | L로 가면 AI 화면도 라이트 표면이라 전제가 소멸 — 주석이 낡은 것 |
| 11 | `ui-token-invariants.test.ts:84-95`가 `DiagnosisHeroCard.tsx`의 `from-(indigo|violet|slate|sky)-[6-9]00` 그라데이션 **존재**를 단정 | 그 파일은 공용 컴포넌트 — §5 범위 밖이라 건드리지 않고 T1은 별도 파일로 |
| 12 | 12장 균질(1줄 설명·카드 높이 정합)과 hover 확대는 D209+ Harold 명시 지시(`ai-operator-modules.ts:34-36`) | 지시 범위 = 문구 길이·높이. 색·지면은 대상 아님(기획 확인) |

## §3 합의 결정

### 3-1. 지면·토큰 [합의]

새 파일을 만들지 않는다. **`console-ui.ts`에 `CUI_*`를 재사용하고 AI 고유분만 같은 파일의 `CUI_AI_*` 구획에 추가한다.** 이유 = 그 파일의 존재 이유가 "kakao-ui가 범위를 속이게 되자 이름을 넓혀 승격"이고, 라이트 전환으로 AI 표면이 같은 범위가 되면 또 승격시킬 자리지 새 파일을 팔 자리가 아니다. 파일이 둘이면 `CUI_INPUT`/`OUI_INPUT`이 갈라지는 미래가 확정된다.

| 역할 | 값(Tailwind 표준만 — 커스텀 hex 금지) | 소유 |
|---|---|---|
| 지면 | `bg-gray-100` | `CUI_AI_PAGE` 신설(`CUI_PAGE`는 `bg-white` — 관리 화면은 그대로) |
| 패널 | `bg-white border border-gray-200 rounded-2xl shadow-sm` | `CUI_PANEL` 재사용(현재 `border-neutral-200` — neutral/gray 혼용은 §9-6) |
| 파인 곳(중첩·입력) | `bg-gray-50 border border-gray-200` | `CUI_AI_INSET` |
| 텍스트 3단 | `text-gray-900` / `text-gray-600` / `text-gray-400` | 매핑 표 §4 |
| 액센트 | `bg-indigo-600` · 연한 칩 `bg-indigo-50 text-indigo-700` · focus `ring-4 ring-indigo-600/15` | `CUI_BTN_PRIMARY` 재사용 |
| 상태 | emerald / amber / rose / blue — 배경 `-50` · 글자 `-700` · 경계 `-200` · 아이콘 `-600` | `CUI_*` 기존 tone |
| 헤더 | `sticky top-0 z-40 bg-white border-b border-gray-200` **blur 0** | `CUI_HEADER` 재사용(현재 `border-neutral-200`) |
| 모달 · 스크림 | `bg-white border-gray-200 rounded-2xl shadow-2xl` · 스크림 `bg-gray-900/40`, **blur 0**(`CUI_MODAL_SCRIM`이 0818 이후 blur 없이 운영 중·접수 0) | `CUI_MODAL`·`CUI_MODAL_SCRIM` 재사용 |
| 입력 컨트롤 | `h-11 bg-white border border-gray-300 rounded-xl placeholder-gray-400 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15` | `CUI_INPUT` 재사용 |
| 자간 | 제목 `tracking-[-0.03em]`(`CUI_TITLE`과 같은 값) · 카드 제목 `tracking-[-0.02em]` · 숫자 `tabular-nums` | |

### 3-2. 허브 장면 [합의 + Harold]

| 요소 | 결정 |
|---|---|
| 헤더 | `CUI_HEADER`. 로고 칩 `w-9 h-9 rounded-xl bg-indigo-600` + `Sparkles text-white` — **이 화면의 Sparkles 1개**. 크레딧 `rounded-full bg-gray-50 border border-gray-200 text-gray-700 tabular-nums` |
| 제목 | `text-4xl md:text-5xl font-bold tracking-[-0.03em] text-gray-900 leading-tight` — **크기 유지**. 그라데이션 글자·배지·영문 eyebrow·2줄 부제 없음(0821 선행 적용분 유지) |
| ! 버튼 | `w-8 h-8 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-900 hover:text-white` — 호버/탭 팝오버는 0821 선행 적용분의 구조 유지, 색만 라이트 토큰 |
| 입력창(주인공) | `bg-white border-2 border-gray-300 rounded-2xl shadow-sm focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-600/15`. **좌측 Sparkles 삭제**(mo-tive 프롬프트 박스와 같은 문법) |
| 히어로 전송 버튼 | **`bg-indigo-600` 단색**, 강조는 색이 아니라 크기 — `h-12 px-6 text-[15px] font-semibold`(주 버튼 `h-11 px-5 text-[14px]`). amber·gray-900 전부 철회(0817에 "검정 primary → 인디고"로 되돌린 이력 — 같은 판단을 세 번 하지 않는다) |
| 추천 칩 | `h-9 px-3.5 rounded-full bg-white border border-gray-200 text-[13px] text-gray-700 hover:border-gray-900` — 무채. 칩은 예시지 기능이 아니다 |
| **컬러 오브젝트 1장** [Harold] | 히어로 아래 **"오늘 추천 실행" 카드 1장**에만 대시보드 카드 문법을 쓴다 — `bg-gradient-to-br from-indigo-600 to-violet-600 ring-1 ring-white/20 shadow-lg shadow-indigo-600/25` + 워터마크 `text-white/10`(카드 밖으로 잘리게) + 우하단 원형 셰브론만 이동. **바이올렛은 여기서 산다.** 2장 이상 금지 — 대시보드에서 컬러 카드가 강한 건 3장뿐이라서다 |
| 좌 진단 패널 | `CUI_PANEL p-5 h-full`. 점수 `text-[32px] font-bold tabular-nums text-emerald-600/amber-600/rose-600`(`font-mono` 폐기 — 코드처럼 보인다). 경고 항목 `border-l-2 border-amber-400 pl-3`. 우선순위 3색은 **유지**(색이 우선순위를 말하는 유일한 곳) — `border-l-4 border-rose-500/emerald-500/blue-500` + 흰 바탕. 2px 보라 테두리·그라데이션·`shadow-2xl shadow-violet-500/20` 제거. 마이크로 라벨 `text-[11px] text-gray-400`(10px 금지) |
| 우 12모듈 | §3-3 |

### 3-3. 12모듈 그리드 [합의 + Harold]

**흰 카드 + 행색 아이콘 칩 + 행 라벨.** 채도는 실행 오브젝트(3-2의 1장)에만 두고 12장은 흰 카드다 — 대시보드 문법 "채도 = 지금 실행"을 깨지 않기 위해. 디자이너의 "흰 카드가 지면과 겹친다"는 실제 클래스로 철회됐다(우측 그리드 컨테이너·래퍼·`main` 모두 배경 없음 → 라이트에서 타일이 앉는 면은 `bg-gray-100`이지 white가 아니다).

| 행 | 모듈 | 칩 색 |
|---|---|---|
| 자동화 | 여정 자동화 · 자동 마케팅 · 마케팅 플래너 | `bg-indigo-600` |
| 발송 채널 | 모바일 DM · Email 캠페인 · 인앱메시지 | `bg-teal-600` |
| 제작·두뇌 | 원클릭 캠페인 · 이미지 스튜디오 · AI 메모리 | `bg-amber-600` |
| 고객 이해 | 자사몰 연동 · 성과리포트 · AI 자율 예측 | `bg-rose-600` |

- 카드 `bg-white border border-gray-200 rounded-2xl p-5 hover:border-gray-300 hover:shadow-md` · 칩 `w-10 h-10 rounded-xl` · 제목 `text-[14px] font-semibold tracking-[-0.02em] text-gray-900` · 설명 `text-[12.5px] text-gray-600 leading-[1.55]`(11px 한글 금지) · 셰브론 `text-gray-300 group-hover:text-gray-900 group-hover:translate-x-0.5` · `hover:scale`은 **유지**(D209+).
- **행 라벨** [Harold 승인] `text-[11px] font-semibold text-gray-400 mb-2` — 자동화 / 발송 채널 / 제작·두뇌 / 고객 이해. 카드 수·높이·1줄 설명은 불변이라 D209+ 개정이 아니다.
- 데이터: `SubModuleCard.gradient: string` → **`tone: 'indigo'|'teal'|'amber'|'rose'`** rename + 완성 리터럴 맵(`CUI_AI_TILE_TONE`). 소비처 2곳(AiOperatorPage·AiOperatorWalkthroughModal) 동시 변경 — tsc가 소비처를 세게 한다. 명도 `-600` 한 칸 고정(갈리면 위계로 오해된다).

### 3-4. 버튼·연출 [합의]

| 종류 | 클래스 |
|---|---|
| 주 | `CUI_BTN_PRIMARY`(= `bg-indigo-600 hover:bg-indigo-500 … text-white`) |
| 보조 | `bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 hover:border-gray-400` |
| 위험 | `bg-rose-600 hover:bg-rose-500 text-white` / 저강도 `text-rose-600 border border-rose-200 hover:bg-rose-50` |

- 그라데이션 = 컬러 오브젝트 1장 외 **0**. 장식 `blur-3xl` 원 0. 상시 색 그림자(`shadow-violet-500/20` 류) 0 — 컬러 오브젝트 위의 `shadow-lg shadow-{색}-600/25`만 예외.
- **hover 연출 유지**(scale·hover:shadow — D209+ "호버 효과 강화" Harold 지시).
- 영문 대문자 eyebrow(`tracking-[0.3em] uppercase`) 0 · 그라데이션 글자 0 · "Enterprise Beta·검증 중" 류 배지 0.

### 3-5. 문구 [합의 + Harold]

원칙 한 줄 — **"AI는 주어가 아니라 방법이다."** 라벨은 사용자가 얻는 결과로 쓰고, AI는 설명문에서만 말한다.
- 화면 라벨: `AI 여정 7종 자동 설계` → `여정 7종 자동 설계` · `AI가 분석한 오늘 추천 캠페인` → `오늘 추천 캠페인` · `AI 진단 우선 항목` → `우선 점검 항목` · 영문은 제품명 `AI Operator` 하나, 기능명은 전부 한국어.
- Sparkles = **화면당 1개**(크레딧을 소모하는 실행 지점). 나머지는 의미 아이콘(Workflow·Activity·FileText·Lightbulb·Check·RefreshCw).
- 서버: `performance-data-availability.ts:99,108` `actionLabel` → `'오퍼레이터 진입'`(같은 배열의 나머지가 전부 "메뉴명 + 진입").
- **[Harold] 발송 유형명 `SEND_TYPE_LABEL`(ai:'AI 추천' · operator:'AI 오퍼레이터')은 유지한다.** 0818 접수 대응으로 Harold가 부른 이름이고 CSV 내보내기 축을 공유한다. T4에서 제외.
- 설명문·온보딩·기능정의서의 "AI" 서술은 남긴다(영업 자산 — 라벨에서만 뺀다).

### 3-6. 서버 AI 렌더 3종 [합의]

| 파일 | 변경 |
|---|---|
| `performance-pdf-render.ts:39-41` | `primary '#7c3aed'` → `'#4f46e5'`(`dm-tokens.ts brand.primary`와 같은 값 → 화면·PDF·이메일 3면이 한 색) · `dark '#1f2937'`→gray-900 `#111827` · `gray '#6b7280'` 유지 |
| `crm-agency-pdf-render.ts` | violet 계열 8곳 → indigo 계열(`#4f46e5`·`#3730a3`·`#eef2ff`·`#e0e7ff`·`#818cf8`·`#c7d2fe`) |
| `daily-insight-mailer.ts:109-141` | **회차1에서 110행 그라데이션부터**(`linear-gradient(135deg,#7c3aed,#d946ef)` → `#4f46e5` 단색). 본문 라이트 반전(`#0f172a` 다크 → 흰 지면·`#111827` 글자·CTA `#4f46e5`)은 회차2 |
| PDF 색 대비 검증 | `performance-pdf-render-smoke.verify.ts` → `.test.ts`로 개명해 `npm test`에 물린다(`vitest include = src/**/*.test.ts`). dist 변화 0·pm2 불요(`tsconfig exclude`) — **회차2 착수 조건** |

## §4 α 토큰 매핑 표 [확정 — 21페이지 고유값 실측]

기계 치환 가능 ≈ **81%**(2,079/2,554). 불가 19%(≈475)는 전부 **무α `text-white`** — 컬러 오브젝트(실행 카드·행색 칩·상태 배지) 위의 흰 글씨는 남기고 지면 위는 바꿔야 하는데 같은 문자열이라 sed로 갈리지 않는다. 파일별 잔존 수를 **커밋 메시지에 숫자로** 남긴다.

| 현재 | 건수 | 라이트 | 기계 |
|---|---|---|---|
| `text-white/40·45·50` | 592 | `text-gray-500` | ○ |
| `text-white/25·30·35` | 121 | `text-gray-400` | ○ |
| `text-white/55·60·65·70·75` | 327 | `text-gray-600` | ○ |
| `text-white/80·85·90` | 124 | `text-gray-700` | ○ |
| `text-white`(무α) | 489 | `text-gray-900` **또는 유지** | △ 육안 |
| `bg-white/5 · /[0.03~0.08]` | 308 | `bg-gray-50` | ○ |
| `bg-white/10·15·20·25·30` | 183 | `bg-white`(+ 기존 border 유지) | ○ |
| `border-white/5·10·15` | 553 | `border-gray-200` | ○ |
| `border-white/20·25` | 22 | `border-gray-300` | ○ |
| `placeholder-white/α` | 53 | `placeholder-gray-400` | ○ |
| `divide-white/5` | 4 | `divide-gray-200` | ○ |

- 색 스윕은 `#hex`와 `rgba(`·`stroke="rgba(255…"`(차트 축·격자 21건/4파일 — 라이트에서 흰 선은 사라진다) **둘 다**.
- 입력 컨트롤(`bg-slate-900` 29) → `CUI_INPUT` 1회 치환. 페이지 내부 모달 38 → `CUI_MODAL`/`CUI_MODAL_SCRIM`, 단 **`overflow-hidden`이 붙은 스크림은 blur 유무와 무관하게 개별 판정**.

## §5 범위 — 파일 목록 (계약 테스트 상수가 소유)

**대상(회차1·2)**: `pages/` AiOperatorPage · JourneysPage · JourneyDetailPage · JourneyPausePage · JourneyStatsPage · ContinuousOperatorPage · MarketingPlannerPage · PlannerBriefPage · MarketingCalendarPage · EmailCampaignsPage · InAppMessagesPage(회차2 **마지막**, `npx vitest inapp-` 3종 green을 커밋 게이트로) · QuickCampaignPage · ImageStudioPage · AiMemoryPage · CdpSettingsPage · PerformancePage · PredictiveDashboardPage · SegmentsPage · DiagnosisPage · AiUsagePage · CampaignAgencyPage · DmBuilderPage(**크롬만** — 헤더·허브 타일 데이터 이모지 28, 별도 배치)
**대상(회차3) — AI 전용 공용 55파일**: `components/automarketing`(11) · `AiMemory`(9) · `AiUsage`(3) · `cdp`(9) · `email`(5) · `journey`(20 − `GradeOrderModal` 1 = 19, CustomersTab 공유분 제외). 착수 전 **"대상 21페이지 밖에서 import되는 파일" grep으로 재선별**(콘솔 톤 §4-1 원복 사고 방지).
**범위 밖**: `ConfirmModal`(40파일 공용) · `CustomerDataRequiredModal` · `CreditHistoryModal` · `AiOperatorWalkthroughModal`(Dashboard 공유 — 단 `tone` 필드 rename의 소비처로는 수정) · `components/inapp` 2(서버 파리티 — 별건) · `pages/Dashboard.tsx`(**비교 기준점, 무변경**) · DM 캔버스·`styles/dm-builder.css`(`--dm-*` = 고객 발행물 미러) · `/admin/*` 2(BestCopy·AiTrainingData) · 진입 링크 없는 3(AiBatches·AiExplain·VoiceInbound — 살아 있는 화면인지 먼저 판정) · 정산 PDF·`pdf-party-block`·`invoice-public`.

## §6 회차·게이트·배포

| 회차 | 내용 | 게이트 | 배포 |
|---|---|---|---|
| 0 | §8 문서 3개 + `console-ui.ts` 헤더 주석(쓰는 표면 목록·27~28행 계약) **문장만**. `CUI_AI_*` 구획 + `tone` 맵 신설(소비자 0) | tsc | 없음(회차1에 동승) |
| 1 | **허브 1장** 실코드 라이트 + 컬러 오브젝트 1장 + 행 라벨·4색 칩 + `daily-insight-mailer.ts:110` 그라데이션 1줄 + `PredictiveDashboardPage:478` 잔존 정정 + `AiOperatorWalkthroughModal` tone 소비 | tsc · `grep -c "bg-gray-100" dist/assets/*.css` · 허브 파일 `text-white\|white/\d` 잔존 수 기록 | **배포 1 → Harold 라이브 판정.** 배포 시 허브에서 뜨는 다크 공용 모달 목록을 먼저 고지 |
| 2 | 하위 20페이지(유형별 묶음 4: 단순 4장 → 차트 4장 → 모달 밀집 3장 → 인앱) + 서버 AI 렌더 3 + `actionLabel` 2 + PDF 색 테스트 | 전환 완료 파일 잔존 0 게이트(T1~T3) · 인앱 파리티 3종 · 모달 38 `fixed inset-0` 재판정 | **배포 2.** `send-type-axis`는 유지라 backend 빌드·pm2 불요 |
| 3 | AI 전용 공용 55 — 디렉터리 단위 커밋 6개 | 동일 | **배포 3** |

- **기각 시**: 회차1은 1커밋 `git revert`. **회차0의 문서 3개도 같은 revert에 포함**(문서만 새 문장으로 남으면 두 번 뒤집기의 씨앗).
- 계약 테스트는 **회차1 합격 후 green으로 투입**(먼저 red로 박아 두면 기각 시 문서·테스트가 하루 만에 두 번 뒤집힌다).
- 배포 안내 = `status/OPS.md` §2-2 형식, 프론트 한 줄(`packages/frontend && npm run build:safe`). 테스트 파일만 바뀌는 회차는 backend 빌드·pm2 불요(`tsconfig exclude`가 `__tests__`를 dist에서 뺀다).
- 목업 없음. Harold 판정은 **라이브 배포본**으로만(앞선 시안 2회가 재현 오차로 실패).

## §7 계약 테스트 (회차1 합격 후) — `packages/backend/src/utils/__tests__/ai-surface-invariants.test.ts` 신설

기존 `ui-token-invariants.test.ts` 형식(`scanSources`·`SCAN_TIMEOUT_MS`·"오탐 0인 규칙만"). 파일 목록은 **테스트 파일이 소유**한다(프론트에 두면 고치는 쪽이 목록을 줄여 통과시킨다).

| 규칙 | 내용 | 오탐 |
|---|---|---|
| T0 | 대상 목록 ≥ 21 + 각 파일 길이 > 0 — 경로가 어긋나면 아래가 조용히 통과한다 | — |
| T1 | 대상 파일의 **루트 컨테이너 한 줄**에 `bg-gradient-to-` 없음 + 지면은 `CUI_AI_PAGE`만 | 루트 한 줄로 좁혀 내부 카드 오탐 0. Predictive:478이 첫 red |
| T2 | 대상 파일 `bg-clip-text` 0 | 앱 전체 4파일 |
| T3 | 대상 파일 `tracking-[0.3em]` + `uppercase` 동반 0 | 2파일 |
| T4 | `CUI_AI_*` 라벨 구획 값에 `/^AI\s/` 없음 + 한국어 포함, 추출 건수 > 0. **`SEND_TYPE_LABEL`은 제외** | 구획을 한정해 발송결과·수신거부 라벨 오탐 0 |
| T5 | `brand-axis-invariants.test.ts:178`(프론트↔서버 `SEND_TYPE_LABEL` 동일) 유지 — 신규 코드 0 | |
| T6 | `CUI_AI_PAGE` 실값 ↔ `LESSONS_FRONTEND.md`에서 정규식으로 뽑은 지면 클래스 `toEqual`, 추출 건수 = 1 단정 | 문장이 아니라 **토큰 상수**만 대조 |
| 잔존 0 | 전환 완료 파일 목록(회차마다 추가)에 `text-white\|white/\d` 0 — 미전환 파일은 목록에 넣지 않는다(red 상시화 = 무시) | |

- `ui-token-invariants.test.ts:84-95`(DiagnosisHeroCard 그라데이션 존재 단정)는 **손대지 않는다** — 그 파일은 §5 범위 밖.
- Sparkles 개수는 테스트가 아니라 **완료 판정 grep**(lucide는 전역에서 정당하게 쓰인다).
- 정규식 스캔은 완전 차단이 아니다(`brand-axis-invariants.test.ts:50` "AST 불수용"). 루트를 변수로 조립하면 빠져나간다 — 그래서 T1이 "토큰만"을 함께 본다.

## §8 문서 개정 (회차0 — 문장만, 한 문장으로)

세 문서가 지금 서로 다른 지면을 강제한다. 코드보다 먼저 맞추지 않으면 다음 세션이 문서를 근거로 되돌린다.

| 문서 | 현재 | 개정 |
|---|---|---|
| `CLAUDE.md` `design_quality_minimum_ceiling_free` 하한 요건 | "다크 slate-950 + 액센트 정합" | "**지면은 `console-ui.ts` 토큰(관리·AI 화면 = 라이트 + 인디고 액센트, 작업 캔버스 = 다크)** + 액센트 정합" |
| `LESSONS_FRONTEND.md` 디자인 최소 기준 표 219·220·221·226행 | "violet→fuchsia 그라데이션" · "다크 톤 + violet 액센트 — 모든 페이지" | "AI 자율 진단 카드(흰 패널 + 인디고 액센트)" · "자연어 입력 카드(흰 입력창, 인디고 포커스)" · "빠른 시작 카드(행색 단색 칩)" · "**라이트 지면 `bg-gray-100` + 인디고 액센트(`console-ui.ts` 토큰) — 관리·AI 화면. 작업 캔버스(DM·이미지 스튜디오 편집면)만 다크**" |
| `LESSONS_FRONTEND.md` 235~238행 ⛔(0821 선행 기록) | "AI Operator 계열 지면은 `bg-violet-950` 단색" | "AI Operator 계열 지면은 `bg-gray-100`(`CUI_AI_PAGE`). 바이올렛은 실행 오브젝트 1장에만" — T6이 이 문장을 읽는다 |
| `docs/2026-08-18-console-ui-unification.md` §1 2행 · §2-6 | "바이올렛은 AI 기능 화면 색 — 관리 화면에 쓰지 않는다" · "다크 규약을 침범하지 않는다(여정·AI 기능 화면…)" | "바이올렛은 AI 기능의 **실행 오브젝트** 색(지면 아님) — 관리 화면에 쓰지 않는다" · "다크 규약 = `ConfirmModal` 등 공용 모달과 작업 캔버스. AI 기능 화면은 0821부터 라이트(→ [AI Operator 표면 개편](2026-08-21-ai-operator-surface-design.md))" |
| `console-ui.ts` 헤더 주석 15~19·27~28행 | 쓰는 표면 4종 · "라이트 표면 전용 … 다크 톤 화면(여정·AI 기능)에는 옮기지 않는다" | 쓰는 표면에 "AI Operator 허브 + 하위 20(2026-08-21)" 추가 · "**공용 다크 모달(`ConfirmModal`)과 작업 캔버스에는 옮기지 않는다**" |
| `memory` `feedback_ai_tell_is_surface_signal_not_decoration` | "AI Operator 계열 = `violet-950`" | 라이트 결정으로 갱신 + 회의 경위 링크 |

## §9 위험과 처방

1. **부분 전환에서 죽는다** — 한 페이지 안에 흰 글씨가 남은 자리(`LESSONS_FRONTEND:15` 사고의 역방향). → 페이지 단위 원자 전환 + 잔존 0 게이트.
2. **차트 축·격자가 사라진다** — `stroke="rgba(255,…)"` 21건/4파일. tsc·기존 테스트 모두 못 잡는다. → §4 `rgba(` 스윕 + 차트 4색 고정(indigo/teal/amber/rose `-600`).
3. **모달 38곳** — 라이트 셸로 바꾸며 `overflow-hidden` × blur/transform을 다시 만진다(0818 P0 형태). → `fixed inset-0` 재판정 후에만, 회차2 세 번째 묶음.
4. **흰 화면 위 다크 공용 모달** — 콘솔 톤 §2-6이 이미 "전역 규약"으로 수용. 회차1 배포 시 목록을 먼저 고지("알고 남긴 규약"과 "덜 만든 화면"의 차이). Harold가 불일치로 지적하면 그때 `ConfirmModal`에 `tone` prop 1개(default 다크·40파일 무변) 또는 AI 페이지를 `components/shared/ConfirmDialogShell.tsx`(0815 라이트 셸·소비처 4)로 이전 — 지적 없으면 열지 않는다.
5. **인앱 페이지** — α 최다(88) + 인라인 style 8 + 파리티 테스트가 소스 문자열 대조. → 회차2 마지막, 클래스만 바꾸고 인라인 style 줄은 건드리지 않는다, `npx vitest inapp-` 3종 green 게이트.
6. **`neutral`/`gray` 혼용** — `console-ui.ts`는 `neutral-*`, 대시보드는 `gray-*`(Tailwind 값은 거의 같다). 이 트랙은 `CUI_*`를 재사용하므로 **기존 토큰 값은 바꾸지 않고** 신설 `CUI_AI_*`만 gray 계열. 통일은 별건.
7. **그라데이션 데이터 제거 시 우연 생존 클래스 소멸** — safelist 없음. → 회차마다 산출물 CSS grep(`dist/assets/index-*.css`).
8. **"AI " 접두 제거 = 영업 자산 훼손**으로 읽힐 위험 → 라벨에서만, 설명·온보딩 유지(§3-5).
9. **의존성 추가 금지** — `safe-build.sh:38`이 `node_modules/typescript` 존재 시 `npm install`을 건너뛴다(0815 `tailwindcss-animate` 직접 구현 경위). 이번 작업 의존성 0.
10. **0718 재발 축 아님** — 새 페이지·동적 import를 만들지 않는다. 토큰은 순수 상수.

## §10 Harold 결정 기록 (2026-08-21)

| 안건 | 결정 |
|---|---|
| 컬러 오브젝트(대시보드 카드 문법) 허브 이식 범위 | **"오늘 추천 실행" 1장** |
| 12모듈 행 라벨(자동화/발송 채널/제작·두뇌/고객 이해) | **진행** — 카드 높이·1줄 설명 정합(D209+) 유지 조건 |
| 발송 유형명 `SEND_TYPE_LABEL`('AI 추천'·'AI 오퍼레이터') | **유지** |

## §11 ⛔

- **지면에 채도를 깔지 않는다.** 바이올렛은 실행 오브젝트 1장. 두 장째부터 12색 타일의 재판이다.
- **빼기로 고치지 않는다.** 제목 크기·카드 수·높이·hover 연출은 그대로. 장식을 지우면 "검정+인디고+얇은 선"이 남고 그것도 AI 기본값이다.
- **페이지 단위 원자 전환.** 컴포넌트 단위로 쪼개면 한 페이지에 두 톤이 공존한다.
- **목업으로 판정받지 않는다.** 라이브 배포본만.
- **새 토큰 파일을 파지 않는다.** `console-ui.ts`에 승격. 커스텀 hex 금지.
- **공용 다크 모달·DM 캔버스·`dm-builder.css`·정산 PDF·공개 청구 페이지·메인 대시보드는 이 트랙이 손대지 않는다.**
- **기각 시 문서도 함께 revert.** 문서만 새 문장으로 남기지 않는다.
- 검출기(impeccable detect) 카운트를 목표로 삼지 않는다 — 문자열 카운터다.

## §12 회의 기록 (역할별 결론 · 양보)

| 역할 | 1차 | 최종 | 양보·정정 |
|---|---|---|---|
| 기획 | 라이트 + 채도 오브젝트("면적이 문제") | 동일 | 12타일 단색 안 철회 → 흰 카드(채도 = 실행 문법) · ConfirmModal tone prop → 무접촉(고지 조건) |
| 디자이너 | 라이트 #f3f4f6 / 다크면 잉크 #17161C | 라이트 `bg-gray-100` | 커스텀 hex 철회 → 표준 · 4색 단색 타일 철회 → 흰 카드(실제 클래스 확인) · 히어로 CTA amber·gray-900 철회 → indigo-600 · 컬러 카드 1장은 "추론"이라 A/B로 |
| 프론트엔드 | violet-950 유지("지면이 보라를 흡수") | 라이트("비용을 알고도 L") | 흡수 논리 철회(대시보드 2801 실증) · 스크림 blur 유지 철회 · `operator-ui.ts` 신설 철회 → `console-ui.ts` · gray-900 철회 · 공용 37 → 55(journey 19 포함) · 인앱 2 포함 철회 |
| 백엔드 | 다크("서버가 이미 그 축") | 라이트 조건부(PDF 색 테스트 = 회차2 조건) | `ai-console-ui.ts` 신설 철회 · `pdf-party-block` AI 표면 목록에서 제외(정산 전용) · `invoice-public` 범위 밖 |
| 회의론자 | "색 고르기 전 조건 A·B·C" | 라이트("AI 티 제거에 가까운 쪽 = L, 안전 = D — 배치1을 L로: L→D는 되돌릴 수 있고 D→L은 두 번 뒤집기") | "대표가 보라 허브가 낫다고 했다"를 L 반대 근거로 쓴 것 철회(비교 대상은 시안 ②였음) · "유리 축만 먼저" 철회 |
| 주재자 | zinc-900 중간값 수렴안 | 폐기 | 회의론자 판정 "기각된 조합(검정+인디고+얇은 선)의 재조립" 수용. Harold 지시 "통일을 강압하지 말고 합의가 이루어지게" 이후 진행만 |

## §13 Harold 판정과 종결 (2026-08-21 저녁)

| 보인 것 | 판정(Harold + 배우자) |
|---|---|
| 주재자 시안 ① 대시보드·허브 다크 중립(slate, 제목 축소·타일 회색화) | "모든 면에서 현재께 낫다" |
| 실코드 ② `bg-violet-950` 단색 + 글로우 1 + 히어로 정리 + ! 팝오버(배포됨) | "예전 것보다 별로" — 팝오버가 제목 2행을 가림, 지면 평평 |
| 1차 회의 합의 ③ 라이트 `bg-gray-100`(이 문서 §3) — 위젯 | "둘 다 기존이 낫다" |
| 2차 회의 합의 ④ C(옛 지면·글로우·헤더·제목 유지 + 입력창 유리·타일 행 4색·진단 유리·타이포) / B(새 지면) — 위젯 A/C/B 토글 | "여전히 A(기존)가 낫다. 호버는 수정, 제목 폰트는 줄여라(촌스럽다)" |

**공통 원인(회의론자 2차 판정 그대로)** — 네 안 모두 옛 허브에서 **뺐다**(색 종류·층·대비·글로우). 판정자는 매번 "덜 뺀 쪽"을 골랐다. 우리가 "퀄리티"라 부른 것은 **절제**였고, 판정자가 사는 것은 **깊이와 밀도**였다. "AI 티"는 대표가 든 예시(mo-tive)의 라벨이지 판정 함수가 아니었다.

**최종 적용(코드)** — `pages/AiOperatorPage.tsx`: 지면·글로우 3·헤더 로고/워드마크·입력창 블러 테두리·영문 라벨 전부 **옛 커밋(`f605c6e6^`) 값으로 원복**. 남긴 변경 = ①히어로 배지·eyebrow·부제 제거 → 제목 + ! (Harold 최초 요청) ②제목 `text-4xl md:text-5xl` → `text-3xl md:text-4xl`(옛 그라데이션 글자 유지) ③! 팝오버를 제목 **아래 중앙**(`left-1/2 -translate-x-1/2 top-full`)으로 — 버튼 우측 앵커가 제목을 가리던 결함 정정. 하위 10페이지 지면 `violet-950` 치환도 원복(`git checkout f605c6e6^`).

**폐기** — §3~§8의 라이트 토큰·α 매핑·서버 톤 동기화·계약 테스트 T1~T6·문서 개정안(§8은 실행하지 않았다). `console-ui.ts` 무변경.

**남는 원칙(LESSONS_FRONTEND ⛔에 등재)** — 이 화면군의 "퀄리티 상승"은 **빼기로 하지 않는다.** 다음에 손댈 때는 옛 허브를 하한으로 두고 **변경 1개씩** 실코드로 배포해 라이브에서 판정받는다. 위젯·목업 A/B는 이 트랙에서 네 번 틀렸다.
