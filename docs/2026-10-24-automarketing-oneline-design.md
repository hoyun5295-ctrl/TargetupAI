# 자동 마케팅 = 한 줄 + 모자란 것만 질문 + 구조체크 결함 닫기 (2026-10-24)

- 접수: Harold 1024 「자동마케팅 구조체크해봐」 → 결함 15 + 「한 줄로 더 쉽게 · 부족한 건 AI 가 질문으로 채우기 = 모든 기능의 목표」(결함 16)
- 절차: 브레인스토밍 5역할(기획 · 프론트 · 백엔드 · 디자이너 · 회의론자) 1차 · 교차 토론 → 주재자 수렴 → 회의론자 최종 검증 16건 반영(§9)
- 승인: Harold 1024 「설계안 나오면 구현 끝까지 끝내고 코덱스리뷰까지 완벽하게 마무리한다음에 배포명령어 제시해」
- 기능 SoT = `docs/FEATURE-AUTOMARKETING.md`(이 문서는 시점 설계 · 구현 기록 §10)
- 배포 순서: 여정 C56 위에서 시작 · 같은 날 배포 · DDL 0

## 0. 한눈에

| 바꾸는 것 | 전 | 후 |
|---|---|---|
| 한 줄 입력 | 바로 5크레딧 문안 · 못 정한 것은 「세부 설정에서」 | 모자란 것만 묻는다(닫힌 목록 ①~⑥) · 답하기 전 0크레딧 |
| 창 | 승인 창 + 뒤에 뜨는 200 확인 창 | 한 창 · 두 상태(A 여쭤볼 것 / B 승인) · 금액 · 잔액이 그 창 바닥에 |
| 돈 | 5 · 200 둘 다 요청 키 없음 · 200 은 등록 뒤 차감 · 실패 무시 | 5 = 화면 키 + 서버 지문 · 200 = 등록과 같은 트랜잭션 · 발송 10 = 보내기 직전 엄격 차감 |
| 문안 | 검사 · 알림 · 화면 · 발송이 각자 문안을 만든다(혜택은 발송 때만 치환) | operatorFinalCopy 한 함수 + 지문 · 관문 |
| 문 | 5 주소 주인 확인 없음 · 500 원문 19곳 | operatorGate · operatorError 한 벌 |

## 1. 한 줄 → 질문(서버 · 순수 · AI 0)

### 1-1 칸마다 자리
| 칸 | 한 줄에 있으면 | 없으면 = 추천(멈추지 않음 · 결과 문장에 보인다) | 「반드시」(답 전에는 버튼 잠김 · 미리 고른 답 0) |
|---|---|---|---|
| 대상 | 등록 때 1회 번역(축 / 칸 조건) | — | ① 칸을 못 정함 ② 번역 실패 · 조건 없음 · **AI 가 「전체 고객」을 고름**(§9-11) |
| 주기 | parseScheduleFromText | 생일 축 = 생일인 날(매일) · 그 밖 = 매월 | ③ **사람이 쓴 주기**가 짝(같은 고객 반복)에 막힘 |
| 요일 · 날짜 | 읽음 | 가장 빨리 첫 회차가 나가는 날 | — |
| 시각 | 읽음 | 09:00 | 발송 가능 시간 밖이면 옮기고 결과 문장에 한 줄(§9-16) |
| 혜택 | 사람 글만(listenLine) | 행사 말 아님 = 혜택 없음 | ④ 행사 말 + 값 없음 · 값이 조건과 섞임(사람 글 조각을 채운 글 칸) · 혜택 글 안의 날짜 |
| 회신번호 | — | 기본 번호 · 기본 없음 + 후보 1개 = 그 번호를 **칸에 적는다**(§9-13) | ⑤ 기본 없음 + 후보 2개 이상 |
| 담당자 알림 번호 | — | 계정 휴대폰 | ⑥ 계정 휴대폰 없음 |
| 080 없음 · 회신번호 0개 · 데이터 없는 축 · 0명 | 막힘(질문 아님 · 0크레딧 · 넓히지 않음) | | |

- 번역 순서(§9-12): 한 줄에 주기 말이 없으면 번역에 'monthly' 를 넘긴다(짝이 늘 통과) → 번역 뒤 생일 축이면 매일(생일인 날). 짝 판정은 질문표가 한 번만 한다.
- ② 선택지 = 쓸 수 있는 축(짝에 막히면 자물쇠 + 사유) + 맨 끝 「수신 동의한 전체 고객 · N명」. 칸 조건 고르기는 두지 않는다(기준 값 입력이 함께 있어야 해 한 번 누름으로 닫히지 않는다 · 조건은 한 줄에 쓰면 번역이 칸으로 옮긴다 · 주재자 판정 11).
- 지나가는 날짜(§9-14): 회차마다 AI 가 목표 문장으로 다시 쓰므로 **날짜를 가리키는 말(연월일 · 월일)** 은 생성 입력에서 뺀다(원문 보존 · 연 1회는 월일 유지). 「이번 주 · 오늘만 · N일간」은 회차 기준 상대 말이라 남긴다. 결과 문장에 「「10월 25일」은 회차마다 지나가는 날짜라 문안에서 뺐어요」(주재자 판정 12 · [넣기] 없음 = 넣을 저장 칸 0 · DDL 0).
- 혜택 근거(§9-15): 회차 문안의 혜택 근거 = 사람 칸(benefit_content) 하나. AI 가 쓴 목표(오늘의 추천 · 캘린더)의 숫자 · 낱말은 근거가 되지 않는다.
- 혜택 허용 꼴에 「N% (할인)쿠폰」 추가(one-line-facts CT 한 곳 · 모든 한 줄 입구 공통 · 영향표 §8).
- 표본 시험(질문 수 고정): 「생일 고객에게 30% 할인 쿠폰」 = 0 · 「매주 VIP에게 신상품 소식」 = ③ · 「주말 세일 안내 보내줘」 = ② · ④ · 「VIP만 20% 할인」 = ④.

### 1-2 CT
- 서버 `utils/one-line-ct/questions.ts` = 질문 모양(LineQuestion) + pickAnswer. 여정 질문표는 같은 모양을 다시 내보낸다.
- 서버 `utils/automarketing-interview.ts` = buildOperatorQuestions(사실 → 질문 · 순수) · decideOperatorAnswers(서버 보관본 질문표로만 답 검증 → 고칠 값).
- 화면 `components/zone/ZoneQuestion.tsx` = 질문 한 줄(라벨 · 도움말 · 알약 · 자물쇠 + 사유 · 글 칸) · 여정 InterviewModal 과 자동 마케팅 창이 같이 쓴다.

## 2. 한 창 · 두 상태 · 돈은 두 순간
- 창 = JourneyModalShell + **이 창만 disableDismiss**(배경 · Esc 닫힘 0 · 닫기 = X 만 · §9-1).
- 상태 A 「여쭤볼 것」(질문이 있을 때만) — 바닥 버튼 하나: 미답 = 잠긴 [위 N개에 답해 주세요] · 답함 = [이대로 첫 문안 보기 · 5크레딧](직접 쓴 문안 = 0).
- 상태 B 「승인」 — 결과 문장 → 누구에게 → 문안 → 얼마나 · 멈추는 법.
  - 0크레딧 편집(기준 숫자 · 칸 고르기 · 직접 쓴 문안)은 **문안을 만들지 않고** 다시 센다(§9-6).
  - 문안 입력 지문(축 key · 칸 · 연산자 · 혜택 · 채널 · 문안 방식 · 값 제외)이 바뀌면 시작 잠금 + [이 대상으로 다시 만들기 · 5크레딧]. 문안은 이 버튼과 상태 A 버튼에서만 만든다.
  - 바닥: 「시작하면 200크레딧 · 잔액 a → b」 · [이번 주 승인하고 시작 · 200크레딧]. 뒤에 뜨던 CreditConfirmModal 삭제.
  - 시작 본문 = preview_id + 지금 탭의 variant_index(§9-9).
- 입구: 명령 줄 · 자세히 쓰기 · 오늘의 추천 · 한 줄 답 카드 · 시나리오 · 「세부설정으로 시작」 저장 = 이 창. 캘린더 = 일괄 등록 그대로(월 키 · §9-4). 다음 승인 = 상태 B 만.

## 3. 요청 키(§9-5)
| 호출 | 돈 | 키 | 재전송 · 결과 모름 |
|---|---|---|---|
| /preview · 문안 만드는 /preview/update | 5 | 화면 키(한 줄마다 하나 · 지금 결과를 만든 키를 창이 들고 있다) → 원장 `ai-operator-propose:{회사}:{사람}:{화면 키}:{지문}` | 같은 화면 키 /preview = 보관본 그대로(AI 0 · 차감 0) · 원장에 키가 있으면 잔액 확인 건너뜀 · 만료 뒤 다시 만들기도 같은 키 |
| /from-preview | 200 | previewId = 운영자 행 id | 잠금 하나로 판정 + 등록 · 재전송 = 409 처리 중 · 보관본은 커밋 뒤에 지움 · 행이 있으면 그 행을 돌려줌 |
| 캘린더 POST /continuous | 200×N | 화면 키(달마다) = 행 id · 등록 기록과 같은 트랜잭션 | 같은 키 = 그 행 |

## 4. 결함 처방
- **registerOperator**(6 · 7 · N6 · §9-2): 시연 회사 판정 → BEGIN → `_deductWithClient(manageTx:false)` 키 `continuous-operator:{id}` → INSERT(id · 승인 기간 · 회신번호 칸 한 문장) ON CONFLICT (id) DO NOTHING → 0행 = ROLLBACK + 같은 회사 · 같은 사람 행 → deducted · duplicate · not_applicable 일 때만 COMMIT · 잔액 부족 402 · 그 밖 ROLLBACK 503. checkCredit 사전 확인 · 뒤 차감 삭제.
- **operatorFinalCopy**(1): 안 번호 → 사람 편집 → 이모지 안전화 → 혜택 치환 → 90바이트 넘으면 LMS → (광고) · 080 → 지문(회신번호 · 080 · 채널 · 제목 · 본문 · 단축 전). 쓰는 곳 = 회차 3사 검사 · 화면 재검사 · 담당자 문자 · 목록 응답 final · 승인 지문 · 발송 · 리마인드(§9-8). 화면 흉내 삭제.
- **안 번호**(9): 제안 생성 때 추천 안 저장 · `userSelection ?? 통과 안 ?? 추천 ?? 0` · 발송 자리 무작위 표집 삭제 · 승인 = {variantIndex, fingerprint} · 다르면 409 + 지금 final.
- **중지 · 보관**(8): closeOpenProposals(scheduled · pending · admin_review → admin_stopped) · 승인 선점에 `운영자 status <> 'archived'` · 중지 창 「승인 대기 제안 N건도 함께 닫아요」.
- **문 · 오류**(2 · 3 · 4): operatorGate(회사 · 주인 · 남의 것 404 · 돈 · 발송 주소만 요금제) · operatorError(500 원문 0 · DB 준비 전 503). 주인 판정 = owner-scope 한 함수(여정 journeyViewerOf 도 같은 함수). 조회 · 거부 · 정지 · 보관은 요금제가 잠겨도 열어 둔다(강등 회사가 남은 예약을 멈출 수 있게 · 기존 계약).
- **operatorSpend**(5): 상태 집합 하나(approved · auto_executed · sent · sending) · 기준 = 발송 시각(없으면 만든 시각) · 금액 = 실측 · 목록 · 회차 · 발송 직전 · 알림 공용.
- 문구(10) 「발송을 시작했어요(N명)」 · 프롬프트 모순(11) · 브리핑 날짜(12) · 죽은 주소 삭제(13) · 여정으로 가져가기 한 길(14) · 기능 문서 §11(15).
- N2(5 키) · N5(지문) · N6(등록 한 문장) · N7 = BUGS 등재만(§9-1).

## 5. 돈 정책 X1 · X2
- X1: `creditOverageAllowance` 에서 continuous-operator-send = 0(선불 · 후불 모두 · §9-10).
- X2: 발송 자리 = sendStagingId 표식 직후 · createDirectSendCampaign 직전 · `deductCreditOutcome(throwOnInsufficient)` 키 `continuous-operator-send:{proposalId}:{stagingId}`.
  - 잔액 부족 = staging 정리 · 제안 admin_review · 운영자 paused_no_credit · 문자. 원장 오류(failed) = admin_review.
  - 되돌림 = 10분 작업자 · 30분 지난 예약 중 그 staging 으로 만든 캠페인 없음 · 제안이 그 staging 으로 발송 중 아님만 `release:` 키 환불.
  - 새 발송은 chargePending 을 심지 않는다. 옛 표식 정산 워커는 남은 표식이 빠질 때까지 둔다.

## 6. 혜택이 바뀐 회차(Q6 · §9-7 · §9-8)
- 혜택 · 회신번호를 쓰는 세 곳(updateOperator · approveOperatorWindow · 회신번호 PUT) → 열린 제안(scheduled · pending · admin_review)마다 시스템 재검사(따로 선점 · 무료 횟수에 세지 않음 · 같은 지문 = 안 함). 통과하면 같은 토큰 CAS 로 `spamCheck.fp` 를 쓴다.
- 발송 관문(JS · 리마인드 포함): `spamCheck.fp = 지금 지문` 또는 `approvedFp = 지금 지문`(approveProposal 만 쓰는 칸). 아니면 admin_review + 문자. 옛 행(지문 없음)은 검사한 안에 혜택 자리가 없으면 통과(치환이 바꾸는 글자 0) · 있으면 검토.
- 카드 버튼 = [스팸 검사] · [이 문안으로 승인]. 「검사하고 보내기」 글 0.

## 7. 공용 · 화면 정리
- 화면: ZoneQuestion · MK_BTN_PAY · 이탤릭 출처 캡션 2곳 삭제 · 제안 상세 창 배경 닫힘 · 「타겟 · AI가 자동으로 잡습니다」 칩 줄 · 「Predictive에서…」 토스트 · proposalAction try · Esc 한 번에 창 둘.
- recurring.ts 에 'automarketing' 입구.

## 8. 영향표(공용 CT)
| CT | 소비처 | 영향 |
|---|---|---|
| BENEFIT_SHAPES 「N% 쿠폰」 | lineBenefitPrefill → listenLine(여정 · 한 줄 DM · 이메일 · 템플릿 · 플래너) | 「30% 할인 쿠폰」이 「30% 할인」 대신 「30% 할인 쿠폰」 전체로 채워진다 · 「30% 쿠폰」이 새로 채워진다 · 사람 글 그대로(넓어짐 0) |
| creditOverageAllowance | _deductWithClient · hasCreditForStrict | continuous-operator-send 만 0 · 다른 원천 불변 |
| JourneyModalShell | 변경 0(이 창이 disableDismiss 를 넘긴다) | 0 |
| owner-scope | journeyViewerOf · 자동 마케팅 문 | 여정 = 모르는 사용자 유형이면 자기 것만(닫힌 쪽) |
| orchestrate 차감 인자 | 자동 마케팅 미리보기만 키 · throwOnInsufficient 를 준다 | 안 주는 호출 = 지금 그대로 |

## 9. 회의론자 최종 검증 16건 → 반영
1 껍데기 수정 대신 이 창만 disableDismiss · N7 은 BUGS · 2 차감 먼저 → INSERT · 시연 회사 BEGIN 전 · 3 판정 + 등록 한 잠금 · 커밋 뒤 보관본 삭제 · 4 캘린더 = 화면 키 · 같은 트랜잭션 기록 · 5 키 재전송 3갈래 · 6 편집 = 문안 0 · 지문은 값 제외 · 7 재검사 따로 선점 + fp · 8 리마인드 · approvedFp · 단축 전 · 옛 행 · 9 variant_index · 첫 회차 그 안만 검사 · 10 후불도 0 · 11 AI 「전체」 = ② · 12 번역은 매월 먼저 · 13 회신번호 칸에 적기 · 14 날짜 말 기본 = 뺀다 · 15 혜택 근거 = 사람 칸 · 16 시각 옮기기 = 검증 전.

## 10. 구현 기록

### 10-1 새 파일 · 바뀐 파일
- 새 파일 = `utils/one-line-ct/questions.ts`(질문 모양 · pickAnswer · 여정과 공용) · `utils/automarketing-interview.ts`(질문표 ①~⑥ · 답 검증 · 날짜 말) · `utils/operator-final-copy.ts`(나가는 문안 · 지문 · 관문) · `utils/operator-route.ts`(문 · 오류) · 화면 `components/zone/ZoneQuestion.tsx` · `hooks/useCreditBalance.ts`.
- 바뀐 파일 = 미리보기(`automarketing-preview.ts`) · 운영자(`continuous-operator.ts`) · 주소(`routes/ai.ts`) · 문안 생성(`ai-orchestrator.ts` · `ai.ts`) · 혜택 조각(`one-line-facts.ts`) · 시각(`autosend-policy.ts`) · 캘린더 기록 · 마이너스 허용(`ai-credit-tx.ts`) · 주인 판정(`journey-access.ts`) · 창(`OperatorPreviewModal` · `ProposalDecisionCard` · `ContinuousOperatorPage` · `MarketingCalendarPage` · `JourneysPage` · `InterviewModal`).
- 짝 시험 = `utils/__tests__/automarketing-oneline-1024.test.ts`(41건) · 옛 시험은 바뀐 설계에 맞춰 기대값을 고쳤다(지운 기능을 지키던 단언은 지움 · zone-api 기준 다시 기록).

### 10-2 검증
- backend · frontend tsc 0 · backend vitest 675파일 9,878건(Codex 5R 뒤) · 렌더 3폭(390 · 768 · 1280) 33화면 넘침 0(새 Tailwind 빌드 · 5R 뒤 다시 · 긴 보기 글 「… · 매월로 보내요」 포함) · 10px 글씨 1곳 = 기존 상태 배지(이번 변경 밖).

### 10-3 Codex 적대 리뷰
| 라운드 | 지적 | 처리 |
|---|---|---|
| 1R | 7건 — ① 되돌림 조회가 정상 차감에 막힘(LIMIT 뒤 JS 거름) ② 재생성 문안의 검사 채널 ≠ 통과 지문 채널 ③ [시작됐는지 확인하기]가 고른 안을 버림 ④ 같은 화면 키 · 다른 세부 설정 = 옛 보관본 재사용 ⑤ 추천 주기(생일 → 다른 대상)가 짝 판정을 우회 ⑥ 개별 회신이면 검사 지문 번호 ≠ 발송 번호 ⑦ 짝에 막힌 대상 보기가 전부 잠김(답할 수 없는 질문) | 전부 수용 · ① 거름을 SQL WHERE 로(7일 상한 유지) ② 지문 함수 하나(copyFingerprint) · 통과 지문 = 검사한 모양 · 다른 채널 재생성 = 통과 0 ③ 안 번호 ref ④ 보관본에 본문 지문(bodyPrint) ⑤ 추천 주기 다시 정하기 · ③ 늘 판정 · 등록 · 편집 마지막 문(400 AUDIENCE_PAIRING) ⑥ 지문 번호 = 발송 함수 값(대체 0) ⑦ axis:KEY\|monthly 보기 |
| 2R | 2건(high) — ① 짝 판정 조회와 UPDATE 가 따로라 동시 편집 둘(주기만 · 대상만)이 금지 조합(매일 + 전체)을 남김 ② 직접 쓴 문안의 옛 통과 기록 키에 080 · 채널이 없어 080 만 바뀌면 검사 없이 새 통과 지문 | 전부 수용 · ① 행 잠금 판정 한 함수(lockAndCheckPairing · FOR UPDATE · 저장과 같은 트랜잭션) = 편집(updateOperator · 바뀔 때만) · 승인 저장(approveOperatorWindow · 늘) · 같이 닫음 = 승인 창 ③ 「매월로」 답이 저장되지 않던 구멍(답했을 때만 주기 · 날짜 · 다음 생성 시각 저장) ② 기록 키 = copyFingerprint(검사 번호 · 080 · 채널 · 제목 · 본문) |
| 3R | 1건(medium) — 승인 창을 연 뒤 다른 편집이 일정을 바꾸면(매월 25일 답 → 매월 1일 저장) 승인 기간(25일) ≠ 저장 일정(1일) | 수용 · 승인 창 보관본에 창을 열 때의 일정 다섯 칸(operatorScheduleShape) · 잠근 행과 다르면 저장 0(409 SCHEDULE_CHANGED · 화면은 창을 닫는다) · 답한 주기가 있으면 주기가 같아도 날짜 · 다음 생성 시각 저장 |
| 4R | 1건(medium) — 잠근 뒤 짝 판정이 일정 비교보다 먼저라, 바뀐 일정이 400(짝)으로 가려져 옛 창이 남음 | 수용 · 일정 비교를 잠금 함수 안 · 잠근 직후 · 짝 판정 앞으로(비교 한 곳) |
| 5R | **approve · 지적 0** | — |

### 10-4 배포 전 · 뒤
- DDL 0. 배포 전 확인 = 등록 키 PK(continuous_operators.id) · 되돌림 SQL 이 읽는 칸(campaigns.staging_id · company_id) information_schema 1회.
- 배포 뒤 실측 1건 = 한 줄 → (질문이 있으면 답) → 첫 문안 5 한 번 → [시작] 200 → 회차 발송 직전 발송 크레딧 · 원장 키(continuous-operator-send:제안:적재 묶음) 1행 · 보내지 못한 시도는 30분 뒤 release: 키 1행.
