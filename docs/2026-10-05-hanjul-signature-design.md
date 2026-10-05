# 한줄로 시그니처 설계서: 한 줄 → 완성본 → 지어낼 수 없는 사실만 보강 (2026-10-05)

> 호출어 **"한줄로 시그니처"**. 상태 = **설계 확정(Harold 승인 2026-10-05 「추천대로 삭제하고 설계서 작성해 구현까지」) · Codex 적대 2R approve · 커밋 `ed500035` · .62 배포 확인(1005) · DDL 0 · 스위치 2종 비어 꺼짐 · 66 동기화 보류** · 구현 기록 = §10.
> 근거 = 브레인스토밍 5역할(기획 · 프론트엔드 · 백엔드 · 디자이너 · 회의론자 · 1차 의견 → 교차 토론 1라운드 → 회의론자 최종 검증) + 주재자 코드 재확인.
> 관련 = [원스텝 인터뷰 설계서](2026-08-13-one-step-content-interview-design.md)(§0-3 · §0-5 · §0-6 함정을 이 설계가 그대로 지킨다) · [FEATURE-AI-AUTO-BUILD.md](FEATURE-AI-AUTO-BUILD.md)(만들기 = 재료형 입구 · 이 설계 대상 밖) · [AI 존 대개편 설계서](2026-09-30-ai-zone-redesign-design.md)(한 줄 칸 7메뉴 원장).

---

## §0 30초 요약

- **시그니처 문장**: "한 줄이면 보낼 수 있는 완성본이 나옵니다. 저희가 지어낼 수 없는 사실만 한 번 여쭙니다."
- **무엇**: 한 줄 칸이 있는 입구(AI 존 7메뉴 + 허브 문자)가 같은 계약을 따른다. 한 줄 → 시스템이 채울 수 있는 것은 채운 완성본 → AI가 지어낼 수 없는 사실(1차 = 혜택)만 묻는다.
- **새 모달 8개가 아니라 부품 셋**: 서버 순수 판정(`one-line-facts.ts`) · 칸 묶음(`LineFacts`) · 완성도 줄(`ZoneCompletion`).
- **묻는 자리 규칙**: 생성 전 칸은 이미 멈추는 자리가 있는 곳에만(DM 확인 창). 생성 뒤에는 결과에 채울 자리가 있으면 [채우기 · 무료], 없으면 [넣고 새로 만들기 · 그 채널 생성비].
- **스위치 둘(비면 꺼짐 · 운영 고객 무변화)**: `ONE_LINE_FACTS_COMPANY_IDS`(보강 전부) · `COPY_C_TEST_COMPANY_IDS`(허브 문자 C안 반반 시험). 선택 기록은 스위치 없음(기록만 · 화면·발송 무변경).
- **DDL 0 · 신규 크레딧 키 0 · 대행 델타 0.**

---

## §1 Harold 결정 (2026-10-05)

| # | 결정 |
|---|---|
| H1 | 대시보드의 열리지 않는 창 3개(발송 방식 선택 `AiSendTypeModal` · AI 맞춤한줄 `AiCustomSendFlow` · 추천 템플릿 `RecommendTemplateModal`) **삭제**. 여는 곳 0(`setShowAiSendType(true)` · `setShowTemplates(true)` grep 0) |
| H2 | 보강 뒤 다시 만들기 = **그 채널 기존 생성비 1회**(1회 무료 없음 · 재료만 바꿔 무료로 빠지는 구멍 방지) |
| H3 | 회의 수렴안 + 회의론자 최종 검증 정정 그대로 구현 |

---

## §2 출발점 (코드 실측 · 주재자 재확인)

| 사실 | 근거 |
|---|---|
| 문자 한 줄의 실제 입구 = 허브 propose → orchestrate → generateMessages | `routes/ai.ts:1331-1410` · `ai-orchestrator.ts:491` |
| 같은 한 줄이 입구마다 5가지 다른 체감(바로 생성 · 확인 창 · 채널 창 · 추천→브리핑 · 칸에 담기) | `DmBuilderPage.tsx:894-898` · `EmailCampaignsPage.tsx:719-735` · `InAppMessagesPage.tsx:1015-1035` · `JourneysPage.tsx:2009` · `QuickCampaignPage.tsx:404` |
| 혜택이 없으면 문자 생성기는 시즌감으로 채우고 자리를 남기지 않는다 · DM은 근거 없는 카피를 버린다 | `copy-benefit-detector.ts:5-6` · `dm-ai.ts:480-486` |
| 이메일 · 인앱 생성기는 자리를 남긴다 | `email-ai.ts:245·248` · `inapp-ai-generator.ts:371` |
| `detectBenefits`는 '할인' 낱말만 있어도 참 | `copy-benefit-detector.ts:16-41` |
| DM 한 줄의 출구 가드 근거 = parsePrompt 요약(자기 참조) | `dm-ai.ts:480` (`rawEvent || specSummary`) |
| 허브 문자: 회사 AI 메모리가 목표 문장에 붙어 혜택 근거 · 혜택 강조 지시가 된다 | `ai-orchestrator.ts:485-495` → `ai.ts:1163·1299` |
| 인앱 한 줄은 원문을 보내지 않아 사용자가 쓴 혜택도 자리표시로 바뀐다 | `InAppMessagesPage.tsx:591-594` · `inapp-ai-generator.ts:369-371` |
| 여정 한 줄 제출이 모달에 남은 혜택 칸 값을 함께 보낸다 | `JourneysPage.tsx:2009` |
| DM · 이메일 한 줄 생성 차감에 멱등키 없음 | `dm.ts:1017` · `email.ts:1152` |
| 허브 3안 선택이 기록되지 않는다(학습 로그 `final_source='manual'` 고정) | `campaigns.ts:3190` · `AiOperatorPage.tsx:833-853` |
| 허브는 새 제안마다 A안을 미리 고른다(위치 편향) | `AiOperatorPage.tsx:354·567` |

---

## §3 공통 계약 (한 줄 칸이 있는 입구 전부 · 만들기 · 행사 모달은 재료형이라 제외)

1. **받기**: 한 줄 하나. 다시 입력 요구 0. 실패해도 한 줄은 지우지 않는다.
2. **자동 채움**: 브랜드 정보 · 고객 데이터 · 몰 상품 · 성과 문안 · 등록 링크는 생성기 파라미터로만. **사용자 원문 자리에는 사용자가 친 글자만**(원스텝 §0-6).
3. **판정**(AI 0 · 무과금 · 입력 기준): 서버 CT `oneLineGaps(line)` 하나. 화면은 `POST /api/ai/one-line/gaps`로 묻기만 한다(규칙 사본 0 · 구현 때 미러 + 짝 테스트 안보다 단순해 바꿈). 1차 항목 = **혜택 하나**. 마감은 생성 전에 묻지 않는다(상대 날짜 파서 한계 → 다시 입력 위반).
   - 묻는 조건 = 행사 의도가 있고 + 구체 혜택 값이 0개. 의도가 없는 한 줄(입고 소식 · 매장 안내)은 묻지 않는다.
   - 구체 값 = 숫자 금액·%·N+N · 한글 금액(천원 · 만원 · 오천원) · N배 · 더블 · 그 자체로 구체적인 낱말(증정 · 사은품 · 무료배송 · 반값 · 1+1 · 무료).
   - 문턱 금액("5만원 이상 구매 시")과 가격("39,000원 오픈")은 혜택 값이 아니다.
   - 의도 낱말 = 세일 · 할인 · 특가 · 프로모션 · 이벤트 · 쿠폰 · 적립 · 기획전 · 블프 · 블랙프라이데이 · 감사제 · 얼리버드 · 시즌오프 · OFF. "상시"가 함께 나오면 의도 아님.
   - 계약 테스트: "같은 한 줄에서 혜택 값을 지우면 gap이 생긴다(지울수록 줄지 않는다)" + 업종별 고정 사례.
4. **묻는 자리**:
   - 생성 전 칸 = 이미 멈추는 자리가 있는 곳만: **DM 크레딧 확인 창**(`extraContent`). 판정이 안 걸리면 오늘과 똑같은 창.
   - 허브 문자(확인 창 없음 · 침묵형 생성기) = 판정이 걸렸을 때만 작은 창(같은 칸 부품). 걸리지 않으면 지금처럼 바로 생성.
   - 그 밖(이메일 · 인앱) = 생성 먼저 → 완성도 줄 → 보강 시트. 시트의 채움 버튼은 **결과로 정한다**: 결과에 그 종류의 자리가 있으면 [채우기 · 무료](0크레딧 · 고친 문장 보존), 없으면 [넣고 새로 만들기 · N크레딧](항상 새 초안).
   - 자동 마케팅 = 이미 설정 화면에서 혜택(`benefit_content`)을 미리 받는다 → 새 칸 없음. 여정 = 스튜디오 채움 패널이 이미 같은 일을 한다 → 새 칸 없음.
5. **보이기 = `ZoneCompletion` 하나**: 머리 = `fixHeadline` 3단(`make-flow.ts:188-194` 그대로) · 줄 = must(그 입구의 발송 관문과 같은 판정) / suggest(입력 판정) / ok / info(반영 검산 · 그 입구에 있을 때만). % 금지 · 최대 3줄 + "그 밖에 N".
6. **보강 시트**: 데스크톱 오른쪽 · 모바일 아래(완성본이 보인 채). 생성 직후 **must가 있을 때만 1회 자동**으로 열고, 생성 전에 이미 물은 항목은 칩으로만 남긴다. 저장된 초안 다시 열기에서는 자동으로 열지 않는다. 백드롭 닫힘 금지 · 닫기 = 취소.
7. **돈**: 묻기 0 · 채우기 0 · 다시 만들기 = 그 채널 기존 생성비 1회(H2) · 대행 델타 0.
   - DM · 이메일 한 줄 생성(스위치 켠 회사 · 시도 토큰이 온 요청): 멱등키 `oneline:{회사}:{채널}:{토큰}:{입력 지문16}` · 같은 토큰 동시 요청 잠금(409) · 이미 차감된 키는 생성하지 않고 409 · 조회 실패 503. 토큰 없는 옛 요청 = 지금 동작 그대로.

---

## §4 부품

| 부품 | 파일 | 몫 |
|---|---|---|
| 판정 CT(서버) | `backend/src/utils/one-line-facts.ts` | 스위치 2종(`companyListAllows` 재사용) · `oneLineGaps` · `sanitizeLineFacts`(혜택 검증 = `validateAnswer('benefit')` 재사용) · `buildLineEventText`(한 줄 + `[혜택]` 라벨 줄 · 원스텝 라벨 규약) · 시도 토큰 검증 · 멱등키 |
| 화면 CT | `frontend/src/utils/one-line.ts` | 판정 조회(`fetchOneLineGaps` · 실패 = 묻지 않음) · 시도 토큰 · 채울 자리 종류표(혜택 · 기간 정확 표기) · 종류별 좁은 치환 · 이메일 발송 관문 정규식 미러(짝 테스트가 글자 단위 대조) |
| 칸 묶음 | `frontend/src/components/zone/LineFacts.tsx` | 혜택 칸 + [없음] + 이유 한 줄(「혜택 숫자는 AI가 지어내지 않아요 · 비워도 만들어요」) · 기간 칸(이메일 채우기용) · 칸 안 Enter는 제출이 아니다 · 프리필 0 |
| 완성도 줄 + 시트 | `frontend/src/components/zone/ZoneCompletion.tsx` | `FixRow` 승격(만들기 결과 화면과 같은 부품) · 머리 3단 · 시트(데스크톱 오른쪽 · 모바일 아래) · 채움 버튼 이름이 동작대로 갈림 |

---

## §5 입구별 적용

| 입구 | 바뀌는 것(스위치 켠 회사만) |
|---|---|
| 모바일 DM | ① 한 줄 → `event_text`(서버가 스위치를 보고 옮긴다 · 출구 가드 근거가 사용자 원문이 된다) ② 판정이 걸리면 확인 창에 혜택 칸 ③ 혜택 답은 별도 필드 → 서버가 `[혜택]` 줄로 원문에 붙인다 ④ 시도 토큰 멱등 ⑤ 편집기 머리 칸에 `ZoneCompletion`(서버 검수 + 발행 관문의 링크·채울 자리 판정 + 반영 검산) ⑥ 실패해도 한 줄 유지 · 완료 알림 말투 교체 |
| 이메일 | ① 시도 토큰 멱등 ② 편집기 머리 칸에 `ZoneCompletion`(채울 자리 = 발송 관문 판정 미러) ③ 보강 시트 = 혜택 · 기간 칸 → 자리 0크레딧 치환(되돌리기 기록) |
| 인앱 | ① 한 줄 → `event_text`(서버 · 사용자가 쓴 혜택이 살아남는다) ② 편집 화면에 `ZoneCompletion` + 혜택 채우기 |
| 여정 | 한 줄 제출이 화면에 안 보이는 모달 혜택 값을 싣지 않는다(채움은 기존 스튜디오 패널) |
| 허브 문자 | ① 혜택 근거 · 혜택 감지를 `licenseText`(목표 문장 + 사용자 답)로 한정(메모리 · 계절 · 대상 블록 제외) ② 판정 시 작은 창 ③ C안 시험(별도 스위치) |
| 자동 마케팅 · 만들기 · SNS | 변경 없음(자동 마케팅 = 설정 폼이 이미 혜택을 받음 · 만들기 = 재료형 · SNS = 6단계 대상 판정만) |

---

## §6 안건3: 문자 3안 C안

- **선택 기록(스위치 없음)**: 허브 발송 body에 `aiVariants { messages(3안 원문) · selectedIndex · recommendedIndex · edited · aiRefined · cVariant }`. `/direct-send`는 원값만 넘기고, 검증(배열 · 최대 3개 · 각 2000자 · 인덱스 0~2)과 계산은 `logTrainingData` 안(실패 격리 · 발송 응답 경로 무접촉). `final_source` = edited ? 'edited' : 'selected_as_is'. 모양이 틀리면 기록만 옛 방식('manual').
- **C안 시험(`COPY_C_TEST_COMPANY_IDS`)**: 허브 제안마다 C 유형을 반반 무작위(`mz` · `punchy`) → `generateMessages`의 `cVariant` 인자(기본 = 현행 MZ). 자동 마케팅 · 자동발송 · 플래너 · `/generate-message`는 넘기지 않는다(bandit 오염 0).
- **'짧고 강한형'** 정의: 인사 · 수식 · 넘버링 없이 무엇 · 언제 · 어디서를 4줄 안에. 한 줄에 혜택이 없으면 혜택 언급 0. 첫 줄은 숫자로 시작하지 않는다(B와 분리). 고객 용어 = 자동 마케팅 문안 스타일 「짧고 강한」과 같은 말.
- **판정**: 같은 회사 안 두 집단의 "C를 골라 보낸 비율"과 "고친 데 없이 보낸 비율". 집단당 발송 30건 미만이면 판정 불가 = 현행 유지.

---

## §7 영향표 (전 소비처)

| 대상 | 소비처 | 영향 |
|---|---|---|
| `generateMessages` 새 인자 `licenseText` · `cVariant` | `routes/ai.ts:362` · `ai-orchestrator.ts:491·818` · `auto-campaign-worker.ts:289·332·1413` · `continuous-operator.ts:1113` · `planner-copy.ts:222` | 인자 없으면 문자 단위 동일(계약 테스트). 넘기는 곳 = orchestrate 두 곳(허브 propose일 때만) |
| `AgentContext` 새 필드 `lineFacts` · `cVariant` | orchestrate · orchestrateWithAI · 자동 마케팅(continuous-operator) | 자동 마케팅은 넘기지 않는다 → 무변경 |
| `/api/dm/ai/one-shot-generate` | DmBuilderPage 한 줄 · 빠른 시작 · AiPromptModal · EventCampaignModal | `one_line:true`가 온 요청만. 그 밖 요청 무변경. 스위치 밖 회사가 `facts`를 보내면 400(조용히 버리지 않는다) |
| `/api/email/ai/generate-sections` | 이메일 한 줄 · EmailEditScreen AI · 만들기(materials) · 행사 모달 | `attempt_token`이 온 요청만 멱등. 그 밖 무변경 |
| `/api/cdp/inapp/ai-generate` | 인앱 한 줄 · 빠른 시작 · 행사 모달 | `one_line:true` + 스위치 + 원문 없음일 때만 한 줄을 원문으로 |
| `/api/dm/:id/validate` 응답 | QuickCampaignResultPage · MakeSendModal 등 | 필드 추가만(`publish_static_block`). 기존 필드 무변경 |
| `dmPublishBlocker` | `/publish` · `/send-to-target` | 링크 · 채울 자리 판정을 함수로 떼어 같은 순서로 부른다(동작 무변경 · 기존 계약 테스트 유지) |
| `/api/campaigns/direct-send` | 직접발송 · 허브 승인 발송 | 학습 로그 인자 추가만. 발송 · 응답 무변경 |
| `TrainingLogParams.finalSource` | logTrainingData 호출 3곳 · logCampaignTraining | 선택 인자로 완화(기존 호출은 모두 값을 준다 → 무변경) |
| `POST /api/ai/one-line/gaps`(신설) | DM 한 줄 · 여정 스위치 확인 | AI 0 · DB 0 · 스위치 밖 = enabled:false(화면 그대로) |
| `FixRow` 승격 | QuickCampaignResultPage | 같은 부품 import로 바뀜(모양 동일) |
| 대시보드 삭제(H1) | Dashboard.tsx 상태 · 핸들러 · 렌더 3블록 + 컴포넌트 3파일 + `sms-charset-contract.test.ts` 화면 목록 | 열리는 곳 0이라 화면 변화 0. 저장 세그먼트(세그먼트 화면에서 읽음)는 그대로 |

---

## §8 하지 않는 것 (범위 밖 · 기록)

- 허브 입력칸을 ZoneCommand로 교체 · 허브 3안 탭의 AI 점수 표기 · ZoneCommand `<input>` → textarea(판독 글은 줄바꿈을 " · "로 바꿔 넣는 것만 한다).
- 결과 화면 통일(만들기 결과면으로 착지 이동) · 만들기 결과면의 발행 관문 판정 동기화.
- 맞춤한줄 백엔드 라우트(`/parse-briefing` · `/generate-custom`) 정리 — 화면 소비처 0이 됐다(별건).
- 원스텝 인터뷰 흡수 · 결정축(후킹 · 긴급성 · 증거) 질문.
- 인앱 · 여정 · 자동 마케팅 생성 차감의 멱등키 통일.

---

## §9 검증 · 출고

- 백 · 프 tsc 0 · 백엔드 vitest 전량 · 계약 테스트(판정 표본 · 짝 · 인자 없음 = 문자 단위 동일 · 스위치 밖 무변경 · 멱등 · 학습 로그 이상 입력 무해).
- 사용자 노출 문자열 grep: 모델명 0 · 줄표 0 · native dialog 0.
- Codex `adversarial-review`(돈 경로): DM · 이메일 생성 멱등 · `/direct-send` 학습 로그 · `generateMessages` 근거 한정.
- 배포 = 백엔드 먼저(필드 추가만) → 프론트. 켜는 순서 = 사내 회사 1곳 `ONE_LINE_FACTS_COMPANY_IDS` → 같은 한 줄 10건 전후 비교 → 확대.

---

## §10 구현 기록 (2026-10-05)

### 10-1. 바뀐 파일

| 층 | 파일 | 몫 |
|---|---|---|
| 판정 CT(신설) | `backend/src/utils/one-line-facts.ts` | 스위치 2종 · `oneLineGaps`(행사 의도 + 혜택 값 0 · 비율 · 배수 · 금액은 혜택 문맥일 때만 값) · `sanitizeLineFacts` · `buildLineEventText` · 시도 토큰 · 멱등키 · 잠금 키 |
| 판정 엔드포인트 | `routes/ai.ts` `POST /one-line/gaps` | AI 0 · DB 0 · 스위치 밖 = enabled:false |
| 허브 제안 | `routes/ai.ts` `/operator/propose` | 판정이 걸리면 생성 · 차감 전 `needsFacts` · 답(facts) 검증 · 스위치 밖 답 = 400 · C안 반반(`copyCVariant` 응답) |
| 문자 생성기 | `services/ai.ts` | `licenseText`(오면 혜택 근거 · 감지 = 그 글자 전체) · `cVariant`(`applyCopyCVariant` 세 자리 교체 · `COPY_C_NAMES`) |
| 오케스트레이터 | `services/ai-orchestrator.ts` | `AgentContext.lineFacts` · `cVariant` → 두 경로 generateMessages 에 전달(자동 마케팅 · 자동발송 · 플래너는 안 넘김) |
| DM 생성 | `routes/dm.ts` one-shot v0 | 한 줄 → `event_text` · `[혜택]` 줄 · 시도 토큰 멱등(잠금 409 · 이미 낸 키 409 · 원장 조회 실패 503) · 응답 `one_line` |
| DM 검수 | `routes/dm.ts` `/:id/validate` · `utils/dm/dm-publish-gate.ts` | 응답에 `publish_static_block`(첫 발행 관문 앞 두 칸 · 실패 격리) · `dmPublishStaticBlock` 분리(동작 무변경) |
| 이메일 생성 | `routes/email.ts` | 시도 토큰 멱등 · 응답 `one_line { enabled, gaps }` · `email-ai.ts PLACEHOLDER_PATTERN` export 만 |
| 인앱 생성 | `routes/cdp.ts` | 한 줄 + 원문 없음 = 한 줄을 원문으로 · 응답 `one_line` |
| 학습 로그 | `utils/training-logger.ts` · `routes/campaigns.ts` | `parseHubVariantsRecord` · `aiVariantsRaw`(검증 · 계산 = 적재기 try 안) · `/direct-send` 는 원값 한 줄만 |
| 화면 부품(신설) | `frontend/src/utils/one-line.ts` · `components/zone/LineFacts.tsx` · `components/zone/ZoneCompletion.tsx` | 판정 조회 · 시도 토큰 · 판독 글 붙이기 · 채울 자리 종류표 · 종류별 좁은 치환 · 이메일 관문 정규식 미러 / 칸 묶음 · 확인 창 블록 · 묻는 창 · 보강 시트 / 완성도 줄 · `FixRow`(만들기 결과 화면과 공유) |
| 화면 배선 | `DmBuilderPage` · `EmailCampaignsPage` · `make/EmailEditScreen` · `InAppMessagesPage` · `AiOperatorPage` · `JourneysPage` · `QuickCampaignResultPage`(FixRow import 만) | §5 입구별 그대로 |
| 삭제(H1) | `components/AiSendTypeModal.tsx` · `AiCustomSendFlow.tsx` · `RecommendTemplateModal.tsx` + `Dashboard.tsx` 상태 · 핸들러 · 렌더 | 화면 변화 0(여는 곳 0) · `sms-charset-contract` 화면 목록 · `sender-auth` 배선 수 5 → 4 정정 |

### 10-2. 운영 스위치(배포만으로는 아무것도 바뀌지 않는다)

- `ONE_LINE_FACTS_COMPANY_IDS` = 쉼표 회사 id · `*` = 전 회사 · 비면 꺼짐. 켜면 §5 전부(허브 C안 시험 제외).
- `COPY_C_TEST_COMPANY_IDS` = 같은 형식. 켜면 허브 제안마다 C안 = MZ감성형 / 짧고 강한형 반반.
- 스위치 없이 바로 바뀌는 것 = 허브 발송 학습 로그에 3안 선택 기록이 실림(화면 · 발송 무변경) · 한 줄 칸에 이미지 판독 글을 넣을 때 줄바꿈 대신 「 · 」(한 줄 칸이 줄바꿈을 지우던 것) · 대시보드 열리지 않던 창 3개 삭제.
- ENV 를 바꾼 배포는 `pm2 restart … --update-env`(OPS §2-2 · reload 는 env 를 안 읽는다).

### 10-3. 회의론자 최종 검증 반영

1(치환 좁게) · 2(0단계 생성기 문구 불변 · 링크 문구 통일 안 함) · 3(묻는 시점 = 결과 판정 · 자동 마케팅 새 칸 없음) · 4(인앱 원문) · 5(학습 로그 계산은 적재기 안) · 6(판정 규칙 · 업종 고정 사례 테스트) · 7(시트 자동 열기 = must 있을 때 1회 · 생성 전 물은 항목은 칩만) · 8(스위치 = 서버 판정 · 스위치 밖 답 400) · 9(멱등 409 · 503 · 같은 토큰 잠금) · 10(must = 입구별 관문 판정) · 11(C 측정 = 제안별 반반 무작위 · 기록에 C 종류) · 13(허브 근거 한정) · 14(판독 글 「 · 」) · 15(실패해도 한 줄 유지) · 16(칸 프리필 0) · 17(SNS 대상 밖). 12(이메일 자리 생성률 실측)는 결과 판정 규칙으로 대신했다(자리가 없으면 새로 만들기).

### 10-4. Codex 적대 검토(gpt-6-astra)

- **1R needs-attention** — high 1: licenseText 가 와도 브랜드 슬로건 · 소개가 혜택 근거로 남음 → 수용(근거 = licenseText 전체) · medium 1: 「면 100% 티셔츠」 · 「더블 코트」를 혜택 값으로 읽어 안 물음 → 수용(비율 · 배수도 혜택 문맥일 때만 값 · 「비타민C 20% 세럼」 사례 추가).
- 자체 정정: 검수 응답의 새 판정이 예외를 내면 기존 검수 화면이 500 → 실패 격리(값만 null).
- **2R approve** — 지적 0. critical · high 0으로 닫힘.

### 10-5. 검증

- backend tsc 0 · frontend tsc 0 · backend vitest 568파일 8,021건 전부 통과.
- 계약 테스트 3파일: `one-line-facts.test.ts`(판정 · 업종 사례 · 지울수록 gap · 멱등키 · 스위치 · import 0) · `__tests__/hanjul-signature-1005.test.ts`(C안 교체 문자 단위 · 근거 한정 · 학습 로그 이상 입력 무해 · 라우트 게이트) · `__tests__/hanjul-signature-ui-1005.test.ts`(화면 자리표 = 실제 심는 글자 · 좁은 치환 · 관문 정규식 글자 대조 · 입구 배선 · 삭제 · 문구).
- 옛 결함 주입 5건(근거 한정 해제 · 문턱 금액 제거 · 값 판정 제거 · 선택 인덱스 범위 해제 · 기간 자리에 혜택 표기 섞기) → 전부 테스트가 잡음 · 원복 확인.
- 화면 확인은 하지 않았다(preview 도구 금지 규칙 · 운영 검증 = Harold). 배포 뒤 실측 = §10-6.

### 10-6. 배포 뒤 실측(사내 회사 1곳에 스위치를 켠 뒤)

1. 모바일 DM 한 줄 「이번 주 쿠션 세일 알림」 → 확인 창에 혜택 칸 → 「전 상품 20%」 → 완성 DM 첫 화면에 20% · 편집기 위 완성도 줄.
2. 같은 한 줄로 [없음] → 혜택 문구 없이 완성 · 완성도 줄에 「혜택을 적어 주시면」 제안 줄.
3. 이메일 한 줄 「VIP에게 가을 신상 사전 공개 초대」 → 생성 직후 혜택 · 기간 자리가 있으면 시트 1회 → 채우기(크레딧 변화 0).
4. 인앱 한 줄 「신규 가입 10% 쿠폰 팝업」 → 결과에 10% 그대로(자리표시 아님).
5. 허브 「주말 특가 문자 보내줘」 → 묻는 창 → 답 → 제안 1회 차감만(`ai_credit_transactions` 확인).
6. 허브 승인 발송 1건 뒤 `ai_training_logs` 그 행의 `selected_candidate_id` · `final_source` · `model_params.hubVariants`.
