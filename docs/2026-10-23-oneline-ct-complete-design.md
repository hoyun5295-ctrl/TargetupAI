# 한줄 CT 완성 설계서 (2026-10-23)

> **원래 안건(Harold 1023):** 「한번에 완벽한 CT를 만들고 비어있는곳들 배선까지 완벽하게 해서 컨트롤타워를 최대한 활용해서 완벽한 아웃풋이 나올 수 있도록 · 구조체크를 하고 그걸 결함을 수정하는 방향으로 완벽하게」
> 앞 설계서 = [2026-10-22 한줄 CT](2026-10-22-oneline-ct-design.md)(§11 확정 사항은 그대로). 이 문서는 1023 구조체크 결함 5 · 빈 입구 배선 · 결과물 결함을 **한 배포**로 닫는다. DDL 0.
> 브레인스토밍 역할 소집은 harold-guard(「발동」 턴만)가 막아, 주재자가 다섯 관점(기획 · 프론트 · 디자이너 · 백엔드 · 회의론자)을 직접 검토해 반영했다.

## §0 완료 기준 (전부 참이면 「완벽」)

| # | 기준 | 증거 |
|---|---|---|
| 1 | 같은 한 줄 = 같은 의도(모든 입구) | `listenLine` 인터페이스 시험 · gaps · 판단 대체 · 재료 판 · 반복 점검 · 시연이 같은 값 |
| 2 | 같은 재료 = 같은 판정(재료 판 · 미리보기 · 요리 관문 · 플래너) | 구성 5 × 채널 3 × 재료 3벌 표 시험 · 1023 실측 어긋남(인앱 미리보기 빈 칸 3~5 대 재료 판 0) = 0 |
| 3 | 돈 순서 한 곳 · 세 채널 같은 결말 | 가짜 원장 · 몰 · 저장으로 시나리오 시험(아래 §7) · 라우트 소스 글자 시험 삭제 |
| 4 | 결과물 하한 | 구성 5 × 채널 3 × (풍부 · 최소) 30장 렌더 검사: 반 칸 0 · 빈 구역 0 · 같은 사진 반복 0 · 주 버튼 하나 |
| 5 | 시연 5장면 = 실제 CT 함수로 · 마감은 한 줄에서 읽은 값 | 시연 명령 PNG 5장 + Harold 「됐다」 |
| 6 | 빈 입구 | 여정 · 자동마케팅 한 줄에 반복 발송 점검 문구 · 자동마케팅 발송 때 혜택 근거 = 컨셉 글만 |
| 7 | 출고 게이트 | tsc 0 · backend · frontend vitest 전체 · build:safe 양쪽 · Codex 적대 approve · 실과금 원장 1건(Harold) |

## §1 결함 → 처방 (한 배포)

### A. 구조 (1023 구조체크)

| ID | 결함(근거) | 처방 |
|---|---|---|
| A1 | 「칸이 찼나」 판정 네 벌: `line-compositions.ts:213` compositionMissing(미리보기 · 채널 안 봄) · `:228 · :242`(재료 판 · 관문) · `planner-build.ts:122` plannerNeeds · 화면 `LineStepsModal.tsx:1160` slotFilled. 실측 = 인앱 미리보기 빈 칸 3~5 · 재료 판 0 | `diagnoseComposition(comp, materials, channel)` 하나 → 칸마다 `{ key, level, ask, why, need, have, filled }`. 재료 판 칸 목록 · 미리보기 빈 칸 수와 점선 · 요리 관문 · 플래너 구성 관문이 이것만. compositionMissing · compositionBlocking · compositionBlockingFor · plannerNeeds(구성 갈래) 삭제 |
| A1-b | 답 → 재료 변환 두 벌: 화면 `LineCompositionBoard.tsx:23` previewMaterialsOf + 서버 `preview.ts:30` / 서버 `index.ts:232` lineCookMaterials | 미리보기 요청 = **만들기 본문 그대로** + 화면이 가진 상품 사진 목록(몰 재조회 대신) → 서버 `sanitizeLineStepsBody` → `lineCookMaterials` 하나. 응답 = 그림 + A1 진단 칸 목록. 화면은 그 칸 목록으로 칩 · 「꼭 필요한 칸 N개」 · 만들기 막기를 그린다(구성 모드 slotFilled · previewMaterialsOf · 서버 previewMaterials 삭제). 미리보기를 못 받으면 막지 않고 서버 관문이 판정(400 응답에 빠진 칸 키 · 화면이 그 칸으로 이동) |
| A2 | 요리 돈 순서 세 벌: `dm.ts:1001-1257` · `email.ts:1194-1357` · `cdp.ts:1619-1739` · 설계서 §11-3 chargeLineCook grep 0 · 시험 = 소스 글자 위치(`oneline-ct-1022.test.ts:249-260`) | `one-line-ct/order.ts` `runLineCookOrder(input, deps, adapter)`. 단계 = 한 줄 잠금 → 같은 시도(오늘 · 어제 키) 409 → 금액 확정(PRICE_CHANGED 409 · 원장 모름 503) → 몰 재조회 · 페이지 대조(409) → 잔액(402) → **cook 콜백**(크레딧 묶음 안) → adapter.persist → 차감 → 결말(냄 · 이미 냄 · 미적용만 건넴 · 그 밖 = adapter.release + 503). adapter 둘: `draft`(DM · 초안 행 저장 · 회수 · 착지 기억 `line-draft-memo`) · `return`(이메일 · 인앱). deps = 원장 · 몰 · 페이지 · 저장(`planner-build.ts` BuildDeps 와 같은 모양 · 시험 = 가짜). **멱등 payload 는 라우트가 지금과 같은 값으로 넘긴다(원장 키 바이트 불변).** 1017 일반 단계 요청(구성 없음)도 같은 주문(cook = 지금 생성기 + 재료 놓기). 라우트에는 요청 읽기 · cook 콜백 · 응답 모양만 남는다 |
| A3 | 옛 템플릿 4종 갈래: gaps 가 옛 4종 + 구성 5종을 함께 계산(`ai.ts:1076-1079`) · 화면은 구성이 오면 구성만(`LineStepsModal.tsx:214-219`) → DM · 이메일 · 인앱에서 옛 갈래는 닿지 않음 | gaps 의 templates · template_plans 계산 삭제 · dm · email · cdp 의 tplDef 갈래 삭제(옛 id 가 오면 400 「템플릿을 다시 골라 주세요」 · 열린 옛 탭 대비) · 재료 판 템플릿 모드 삭제. **남김** = 옛 module(AI 영업 · 플래너 옛 행사 · `/line-templates` 목록 · 예시 경로) |
| A4 | 듣기 셋(`one-line-facts.ts` · `services/ai-line.ts` · `planner-line-read.ts`) · 구성 추천 두 번 다른 입력(`ai.ts:1079` 업종 없이 · `index.ts:123` 업종 넣고) · 설계서 §2 listenLine grep 0 | `one-line-ct/listen.ts` `listenLine(line, { reads, industry, nowMs })` → 의도 `{ typed, benefit, concreteBenefit, promotion, periodEnd, periodMentioned, relativeDates, productTerms, urls, rank }`(지금 규칙 함수를 모아 부른다 · 규칙 자체는 그대로 + B4). gaps · 판단 대체 · 재료 판(buildCompositionPlan) · 반복 점검(C1) · 시연이 이것만. gaps 구성 추천 = 업종 넣고(판단 대체와 같은 순위) · 플래너 읽기는 혜택 · 상품 낱말만 이것에서(기간 범위 읽기는 플래너 고유 · 그대로) · 문자 대상 조건 해석은 정밀 모델 그대로(§11 확정) |
| A5 | 판단 몫 판정 두 벌: `services/ai-line.ts:146` aiLineBasePaid · `line-steps-context.ts:56` lineJudgeCovered | aiLineBasePaid 안을 `lineJudgeCovered(companyId, aiLineLineFp(line), now)` 하나로(오류 = 지금처럼 AiLineError 503) |

### B. 결과물

| ID | 결함(근거) | 처방 |
|---|---|---|
| B1 | 사진 묶음 반 칸: 렌더러 2열(`dm-section-renderer.ts:998`) · 메뉴판 더 보기 사진 1장(`line-compositions.ts:425-426`) · 룩북 분위기 2장 + 첫 장 크게(`:412-413` mosaic) → 옆 칸 빔 | `photoGroup(urls)` 하나: 1장 = 한 줄 크게(list_1xN) · 2장 = 2열 · 3장 = 첫 장 크게 + 2. 룩북 · 메뉴판 같이 |
| B2 | 플래너 구성은 특징 · 사용 단계 · 꼬리표 · 참여 방법이 늘 빈 채로 요리(`planner-build.ts:266` points · usage 빈 배열) → 주인공 · 룩북 · 메뉴판 · 이벤트가 그 구역 없이 나감 | 플래너 요리만: 문구 AI **같은 호출**이 비어 있는 suggest 칸 초안도 돌려준다(추가 AI 호출 0 · 추가 과금 0 · 숫자 · 혜택 · 효능 거름 `cleanLineCtText` · `keepFeaturePoints` 그대로). 초안 DM 은 편집 화면에서 고친다. 재료 판 입구는 사람이 정한 칸이라 쓰지 않는다 |
| B3 | 시연 기간 어긋남: 한 줄 「이번 달 말까지」 · 장면 periodDays 9(`scripts/data/oneline-demo-scenes.json`) · 시연 명령이 CT 사슬을 손으로 다시 엮음(`scripts/oneline-demo-set.ts:100-160` · 비채널 판정 compositionBlocking) | 시연 명령 = listenLine 마감 제안 → 없을 때만 periodDays · 진단 = diagnoseComposition · 요리 = CT 함수 그대로 |
| B4 | 상대 마감을 못 읽음: `one-line-steps.ts:79` lineEndDatePrefill 은 「10월 31일까지」 꼴만 → 「이번 달 말까지」를 친 사람에게 재료 판이 마감일을 다시 묻는다 | 허용 꼴 추가: 「이번 달 말까지」 · 「월말까지」 → 이번 달 마지막 날 · 「이번 주 일요일까지」 · 「이번 주말까지」 → 이번 주 일요일 · 「오늘까지」 · 「내일까지」. 제안 칩(사람이 눌러야 답)이라는 1017 계약 그대로 · 「N일간」 은 시작일이 없어 비운다 · 배송 · 예약 등 기한 낱말 줄은 지금처럼 비운다 |

### C. 빈 입구 배선

| ID | 결함(근거) | 처방 |
|---|---|---|
| C1 | 여정 · 자동마케팅은 한 번 만들면 계속 나가는데, 한 줄을 CT 가 점검하지 않는다(여정 · 자동마케팅 파일 CT 참조 0 · grep 1023). 자동마케팅은 컨셉에 혜택이 없으면 AI 가 쓴 혜택이 자리표시가 되고 채우지 않으면 그 회차가 멈춘다(`auto-campaign-worker.ts:848-856`) | `one-line-ct/recurring.ts` `checkRecurringLine(intent, entrance)` → 안내 문장(막지 않음 · AI 0 · 0원): ① 지나가는 날짜 말(이번 주말 · 오늘만 · 이번 달 말 · 날짜) = 「이 문장은 다음 발송 때도 그대로 나가요」 ② 혜택 의도 + 구체 혜택 없음 = 자동마케팅 「혜택 문구를 컨셉에 적어 두세요. 비우면 AI 가 혜택 자리를 비워 두고, 채우지 않은 회차는 나가지 않아요」 · 여정 「만든 뒤 혜택 칸에서 채워요」 ③ 구체 혜택 있음 = 「이 혜택만 실어요: (원문)」. gaps 응답에 `recurring`(menu = journeys · auto). 여정 명령 카드 아래 한 줄 · 자동마케팅 설정 창 컨셉 칸 아래 한 줄(칸을 벗어날 때) |
| C2 | 자동마케팅 발송 때 혜택 근거에 브랜드 슬로건 · 소개가 들어간다(`services/ai.ts:1383-1392` · 워커가 licenseText 를 안 넘김 `auto-campaign-worker.ts:274-290`) → 옛 행사 「30%」가 컨셉에 없어도 고객에게 나갈 수 있다. 한 줄 입구는 1005 에 닫은 길 | 워커의 generateMessages 3곳(`:293` · `:336` · `:1435`)에 `licenseText = 컨셉 글`. **영향:** 컨셉에 없는 혜택을 브랜드 소개에서 가져다 쓰던 켜진 캠페인은 그 혜택이 자리표시가 되어 발송 전날 알림 → 채우지 않으면 그 회차 중단(지금 규칙). 배포 전 켜진 AI 자동발송 수 · 컨셉에 혜택 없는 수를 SQL 로 확인(SCHEMA 정독 뒤 명령 드림) |

## §2 CT interface (one-line-ct 바깥이 아는 전부)

| 함수 | 단계 | 받는 것 → 주는 것 |
|---|---|---|
| `listenLine` | ① | 한 줄 · 사진 조각 · 업종 · 시각 → 의도 |
| `runLineJudge` | ② | 지금 그대로(판단 2 · 규칙 대체 = listenLine 순위) |
| `diagnoseComposition` | ③ | 구성 · 재료 · 채널 → 칸 목록 |
| `buildCompositionPlan(s)` | ③ | 의도 + 회사 사실 → 재료 판(진단 칸 위) |
| `previewComposition` | ③ | 구성 · 채널 · 만들기 본문 · 사진 목록 → 그림 + 칸 목록 |
| `runLineCookOrder` + `draftAdapter` · `returnAdapter` | ⑤ · 돈 | 입력 · deps · adapter → 결과 또는 정해 둔 오류(상태 · 코드 · 문장) |
| `checkRecurringLine` | ③ | 의도 · 입구 → 안내 문장 |
| `draftLineCook` · `buildLineCook*` | ⑤ | 주문의 cook 콜백 안에서 · 플래너 |

## §3 입구 배선표 (끝 상태)

| 입구 | ① 듣기 | ② 판단 | ③ 진단 | ④ 채우기 | ⑤ 요리 · 돈 |
|---|---|---|---|---|---|
| 모바일DM · 이메일 · 인앱 | listenLine | runLineJudge | diagnoseComposition | 재료 판(서버 칸 목록) | runLineCookOrder |
| 마케팅플래너 | listenLine(혜택 · 상품) | 사람이 구성 고름 | diagnoseComposition | 플래너 화면 | draftLineCook + 초안 칸(B2) · 플래너 돈 순서 · 단가 그대로 |
| 문자(AI 한줄로) | 정밀 대상 해석 그대로 | 판단 몫 공유(A5) | 확인 판 | 지금 그대로 | 지금 그대로 |
| 여정 | listenLine | 여정 생성기 안 | checkRecurringLine | 혜택 채움 패널(1005) | 여정 생성기 그대로 |
| 자동마케팅 | listenLine | 없음 | checkRecurringLine | 컨셉 칸 | 발송 때 근거 = 컨셉 글(C2) |

## §4 영향표 (전 소비처 grep 1023)

| 바꾸는 것 | 소비처 | 영향 |
|---|---|---|
| compositionMissing → diagnoseComposition | `line-compositions.ts:218` · `preview.ts:70 · :79` | 미리보기 빈 칸 수 · 점선이 채널 칸표 기준으로 바뀜(의도된 정정) |
| compositionBlocking | `scripts/oneline-demo-set.ts:141` | 시연 판정이 채널 기준으로 |
| compositionBlockingFor · compositionChannelSlots | `one-line-ct/index.ts:60 · :268` | 같은 판정 · 진단 함수 안으로 |
| plannerNeeds · plannerTemplateMissing | `planner-build.ts:144 · :206 · :207 · :387` · 화면 `PlannerEventModal.tsx:45`(빠진 키 → 문구 표만) | 구성 갈래 = 진단 함수 · 빠진 키 이름(link · products · benefit · product_photos · photos)은 그대로 |
| previewMaterials · renderCompositionPreview | `routes/line-templates.ts:121-122` | 요청 본문이 만들기 본문으로 · 화면 `utils/one-line.ts:191` fetchCompositionPreview 같이 |
| rankCompositions | `ai.ts:1079` · `index.ts:123` | gaps 추천이 업종 반영 |
| rankLineTemplates · buildLineTemplatePlan · template_plans | `ai.ts:1057 · :1077 · :1078 · :1105` · 화면 `one-line.ts:632-634` | 삭제 |
| tplDef 갈래 | `dm.ts:1015 · :1186-1198 · :1228` · `email.ts:1207 · :1319-1327` · `cdp.ts:1630 · :1700-1705` | 삭제 · 옛 id = 400 |
| aiLineBasePaid | `services/ai-line.ts:233 · :390 · :478 · :493 · :549` | 같은 답(문자 입구엔 사진 조각 없음) · 판정 한 벌 |
| lineEndDatePrefill | `one-line-ct/index.ts:70` · `line-template-plan.ts:60`(옛 plan · AI 영업 밖 · 같이 이득) | 상대 마감 제안 칩이 새로 뜸 |
| generateMessages licenseText | `auto-campaign-worker.ts:293 · :336 · :1435` | §1 C2 영향 |
| LineStepsModal 템플릿 모드 · slotFilled(구성) · previewMaterialsOf | `LineStepsModal.tsx`(구성 · 템플릿 분기 38곳) · `LineCompositionBoard.tsx` · 입구 3화면 setXxxSteps 의 templates 칸(`DmBuilderPage.tsx:1084` · `EmailCampaignsPage.tsx:633` · `InAppMessagesPage.tsx:610`) | 구성 모드만 · 칸 판정 = 서버 |

## §5 지우는 것

옛 템플릿 갈래(입구 3 · gaps · 재료 판) · compositionMissing · compositionBlocking · compositionBlockingFor(진단 안으로) · plannerNeeds 구성 갈래 · previewMaterials(서버) · previewMaterialsOf(화면) · 재료 판 구성 slotFilled · 라우트 소스 글자 시험(`oneline-ct-1022.test.ts:249-260`).

## §6 이번에 안 하는 것

- 플래너 단가를 15 로: 1018 플래너 v2 결정(엔진 키 DM · 메일 그대로)이 살아 있다. 단가는 Harold 결정.
- 여정 단계에 CT 로 만든 DM 링크 넣기: 발행비 · 단가가 걸린 새 상품 결정.
- 단계 없는 한 줄 요청(1005 · 1010 시도 토큰 경로) · 한 줄 아닌 일반 생성: 화면 입구가 단계 요청으로 옮겨 간 뒤 남은 길이라 돈 순서 이동 밖(손대면 원장 키 바이트가 바뀐다).

## §7 시험 (seam = interface · 지금 시험은 남기고 바뀐 판정만 고친다)

1. listenLine: 한 줄 표본(1022 시연 5 · 상대 마감 꼴 · 기한 낱말 · 사진 조각) → 의도 고정값 · gaps · 판단 대체 · 재료 판 · 반복 점검이 같은 값.
2. diagnoseComposition: 구성 5 × 채널 3 × 재료(풍부 · 최소 · 1023 실측 재료) → 칸 표 · 미리보기 빈 칸 수 = 재료 판 빈 칸 수.
3. runLineCookOrder(가짜 deps): 첫 결과물 15 한 번 · 판단 뒤 13 · 다시 3 · 같은 시도 재전송 = 409 ALREADY_DONE(오늘 · 어제 키) · 금액 다르면 409 PRICE_CHANGED(AI · 차감 0) · 원장 모름 503 · 잔액 402(결과 0) · 차감 결말 failed = 결과 0 + DM 초안 회수 · 회수 실패 = orphan · 같은 한 줄 동시 = 409 · cook 실패 = 차감 0.
4. 렌더 검사 30장(LESSONS_META 14) · B1 반 칸 0.
5. checkRecurringLine: 날짜 말 · 혜택 의도 · 구체 혜택 표본.
6. 자동마케팅: 워커 3곳 licenseText 전달(가짜 생성기) · 컨셉에 없는 혜택 = 자리표시.

## §8 돈 · 발송 실측 시나리오 (배포 뒤 · Harold 실행)

1. 사내 실차감 회사 DM: 한 줄 → 판단 2 → 만들기 13 → 원장 행 2(aio-base · olc) · 같은 한 줄 이메일 추가 3 → 원장 행 1.
2. 자동마케팅 시험 캠페인(컨셉에 혜택 없음 · 시험 회사): 저장 때 안내 문구 · 전날 생성 문안의 혜택 = 자리표시 · 알림.
(SQL · 화면 순서는 배포 안내 때 명령 하나씩)

## §9 이행 순서 (주재자 단독 · 순차 · 한 배포)

1 listen(A4 · B4) → 2 diagnose(A1) → 3 photoGroup(B1) → 4 미리보기 본문 통일(A1-b · 서버 · 화면) → 5 옛 갈래 제거(A3) → 6 돈 순서(A2 · dm → email → cdp) → 7 판단 몫(A5) → 8 플래너 초안(B2) → 9 반복 점검 · 자동마케팅 근거(C1 · C2) → 10 시연 명령(B3) → tsc 0 · vitest 전체 · 렌더 검사 30장 · Codex 적대(approve 까지) · build:safe 양쪽 → 배포 안내(백엔드 · 프론트 같은 배포 · DDL 0).
