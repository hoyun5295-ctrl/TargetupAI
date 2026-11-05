# 1104 오류접수 4 + 질의 1 · 흐름 표 · 결함 장부 (2026-11-05)

> 결함 플레이북(`status/DEFECT-PLAYBOOK.md`) 0 ~ 2단계 산출물. 설계 · 처방 · 코드 = 0(흐름 표 Harold 확인 뒤).
> 서버 판 = `d7e3061f`(배포 원장 머리 · 1104 08:32). 그 뒤 커밋 2개(`6ac53868` · `d5be4958`)는 문서만이라 **로컬 HEAD 코드 = 서버 코드**. 접수 시각(1104 14:44 ~ 15:56)은 모두 이 판 위.
> 칸은 소스 grep 으로 뽑았다(패턴은 각 표 머리). 판정 근거 = 코드 읽기(파일:행). 실행 확인이 필요한 칸은 「미검증」으로 적고 §7 에 확인 명령을 둔다.

## §0 접수 대조표(묶음 · 이 축이 없으면 그 접수가 닫히는가)

| 접수 | 등록자 · 시각 | 내용 | 묶음 | 축 |
|---|---|---|---|---|
| 1 정산 업체 이의신청 확인 후 처리 | 서수란 · 14:44 | 이의신청 뒤 「변경 없음」이면 다음 진행 불가(컨펌 단추 없음 · 수정 재발행 잠김) | C | 컨펌 · 이의신청 상태 전이 |
| 2 여정 스팸테스트 자동화 | 남지현 · 15:56(댓글 16:00) | 혜택 · 링크 넣기 · 「고친 곳 N개 저장」마다 스팸 검사가 자동으로 돈다 · 확정 때(켜기 · 「지금 스팸 검사」)만 원함 | A | 여정 문안 바뀜 → 유료 검사 |
| 3 B 여정 켜기 전 확인 질의 | 서수란 · 15:55 | 「전체 고객에게 보내기」 위치 · 최대 인원 뜻 · 「여러 여정 켜기 창」 위치 | A | 직원 체크리스트 B 시트 문구 ↔ 화면 |
| 4 고객 DB 현황 엑셀 다운로드 | 서수란 · 15:52 | 상세보기 [엑셀 다운로드] = 「다운로드 실패: {"error":"다운로드 중 오류가 발생했습니다."}」 | B | 활성 필드 ↔ 읽는 표 |
| 5 여정 회신번호 선택 | 임은지 · 15:28 | 문장으로 여정 만들기에 「어느 번호로 보낼까요?」가 안 나옴 | A | 여정 회신번호 정하기 · 바꾸기 |

빠진 축 = 0(다섯 접수 모두 A · B · C 중 하나가 닫는다).

## §1 묶음 A · 여정 만들기 → 고치기 → 검사 → 켜기

뽑은 패턴: `startJourneyStepSpamChecks|startStepSpamCheck|runStepSpamTest|enqueueSpamTest(` (백엔드) · `/steps/|copy-facts|onSpamTest|SpamFilterTestModal` (여정 화면) · `defaultPhone|defaultCallbackOf|callback` (여정 화면 · 만들기 CT) · `전체 고객에게 보내기|한 번에 보낼 최대|OVERLAP_UNRESOLVED|BatchActivateModal` (화면 · 서버).

| # | 이음매 | 쓰는 쪽 | 읽는 · 그리는 쪽 | 값 범위 | 그리는 화면 | 판정 |
|---|---|---|---|---|---|---|
| A1 | 만들기 창 회신번호 질문 | `journey-interview-ai.ts:113 · 141` callback = `defaultCallbackOf` (`journey-draft-save.ts:48-52` = 기본 표시 번호 또는 번호가 1개면 그 번호) | `InterviewModal.tsx:177` `needsCallbackChoice = !defaultPhone` → 질문 칸 `:340-355` | 번호 0 · 1 · 기본 있음 · 기본 없음 2개 이상 | 기본이 있거나 번호가 1개면 질문 자체를 그리지 않음 | 결함 F3 |
| A2 | 만든 여정의 회신번호 저장 | `journey-interview-ai.ts:208-211`(고른 값 · 없으면 기본) | 작업 화면 휴대폰 머리 줄 `JourneyWorkspace.tsx:1032`(보이기만) | 기본 번호 · 고른 번호 · 빈 값(옛 여정 · 복제) | 바꾸는 자리 0(`JourneyStartCard.tsx` 1 ~ 265 회신번호 칸 없음) · 서버는 받는다(`journey-options-validator.ts:96-97`) | 결함 F3 |
| A3 | 회신번호 빔 → 멈춤 · 켜기 거절 안내 | `journey-pause-reason.ts:28` 「회신번호를 정해 주세요」 + 고치기 `edit_callback` · `journey-builder.ts:791` 「여정 편집 후 다시 시도해주세요」 | `JourneyWorkspace.tsx:730` `edit_callback` → `pickStep('start')` | 빈 회신번호 | 고치기 단추가 회신번호 칸 없는 [시작] 카드로 감 | 결함 F3 |
| A4 | 칸 저장 → 자동 유료 검사 | `routes/ai.ts:3578-3581`(PATCH 칸 · 글 · 제목 · 채널 · 광고 바뀜) · `:3635`(칸 넣기) | `journey-check.ts:122-152` → `journey-pretest-validator.ts:370-378`(`skipPrepaid: false` · 같은 날 같은 글만 이어 보기) | 새 글마다 1회 차감 · 판(A/B)마다 | 점검 판 「칸을 저장하면 스팸 검사를 자동으로 해요」 `journey-check.ts:95` | 설계대로 동작(C91 D1 · D2) · 접수 2 와 충돌 = 결정 F2 |
| A5 | 혜택 넣기 · 링크 넣기 | `JourneyWorkspace.tsx:502-519` → `routes/ai.ts:3694-3711`(서버가 모든 문자 칸에 바로 저장) | `:3706` 채운 칸마다 자동 검사 | 문자 칸 N개 × 판 | 화면은 「저장」을 누르기 전이라 사람은 저장 안 한 것으로 봄 | 결정 F2 |
| A6 | 「지금 스팸 검사」(수동) | `JourneyWorkspace.tsx:1174 · 1291-1305` 글 = 화면 `buildAdMessageFront(템플릿)` · 표본 고객 없음 | `routes/spam-filter.ts:124-144` 표본 = 회사 최근 수신동의 고객 · `replaceVariables` | 변수 · Liquid · 장바구니 · 예측 값이 든 글 | 결과는 그 창 안에만 | 결함 F1 |
| A7 | 자동 · 켜기 · 점검 판 검사 글 | `journey-pretest-validator.ts:329-348` 표본 = 이 여정 대상 1명(`journey-message-render.ts:149-161`) · 렌더 = `renderJourneySmsMessage`(`:92-137` 예측 · 외부 값 · 장바구니 · 정리) | 점검 판 = 같은 글 해시로 엿보기 `:354-364` · 켜기 = 같은 날 같은 글 이어 보기 `:380-414` | 같은 칸이라도 A6 과 해시가 다름(변수가 있으면) | 수동 검사 통과가 점검 판 · 켜기에 안 잡힘 | 결함 F1 |
| A8 | AI 한줄로 결과 카드 자동 검사(형제) | `LineResultCards.tsx:107-130` 글이 바뀌면 다시 검사 · 카드당 자동 2회(`:21`) | `services/ai-line-spam.ts:157` | 카드 × 2 | 칩 | 같은 모양(편집 중 유료 자동 검사) · F2 와 함께 결정 |
| A9 | 「전체 고객에게 보내기」 | `JourneyStartCard.tsx:162-164` = 시작 「고른 고객에게」(`journey-trigger-capability.ts:274` custom) + 조건 0 일 때만 | 체크리스트 B 시트 2번 「조건 없이 보낼 때만 「전체 고객에게 보내기」를 켰다」(모든 여정 문장) | 사건 여정(생일 · 구매 등) = 「이 사건이 생긴 모든 고객」 `:130` · 단추 없음 | 문서에 있는 단추가 그 여정 화면에 없음 | 결함 F4 |
| A10 | 한 번에 보낼 최대 인원 | 저장 = [시작] 카드 `JourneyStartCard.tsx:184-186`(「비우면 제한 없음」만) · 켜기 창 `JourneyActivationConfirmModal.tsx:369-372`(「넘으면 자동으로 멈추고 알려 드려요」) | 판정 = `journey-step-limits.ts:50-61` · 날짜 여정 `journey-anchor-scheduler.ts:263-277` · 사건 여정 `journey-trigger-watcher.ts:347-355` | 대상 ≤ 상한 = 영향 0 · 대상 > 상한 = **여정 전체 멈춤 · 0통**(골라 보내지 않음 · 이월 없음) · 「하루에 N명씩 나눠 받기」는 「고른 고객에게」 · 휴면 여정만 | 같은 값의 뜻이 화면마다 다름([시작] 카드엔 없음) | 결함 F5 |
| A11 | 겹치는 여정 안내 | 서버 `routes/ai.ts:3469 · 4062` · `journey-activation.ts:313`(409 OVERLAP_UNRESOLVED) | 단건 켜기 창 `JourneyActivationConfirmModal.tsx:509-514` · 다시 켜기 `useJourneyActions.tsx:120-122` · 시작 설정 저장 `JourneyWorkspace.tsx:552` · 지도 「켜기 전 점검」 `JourneyMapPage.tsx:361-368`(초안 있을 때만) → `BatchActivateModal.tsx:294` | - | 체크리스트 B 시트 11번 「여러 여정 켜기 창」 = 그 이름의 창 없음 | 결함 F4 |

## §1-2 묶음 A 다시 뽑기 · 「만들기 → 켜기 전」 기계 추출(1105 Harold 「다시 뽑자」)

> §1 은 접수 자리 둘레를 grep 으로 넓힌 것이라 이 절이 묶음 A 의 흐름 표를 대신한다. 서버 판 = 로컬 코드(§ 머리).
> 추출 = 화면 · 서버 둘 다(지난 네 표는 백엔드만). 스크립트 = scratchpad `extract_flow.py` · `extract_copy.py`(읽기 전용 · 패턴은 아래 원문).

### 뽑은 칸 · 패턴 · 수

| 칸 | 패턴(원문) | 뽑은 수 | 판정 |
|---|---|---|---|
| 가 화면 → 서버 여정 호출 | 화면 `.ts/.tsx` 의 문자열 `/api/[^'"\`]*journ` · 여정 화면 파일(`components/journey/` · `pages/Journey*` · `SpamFilterTestModal`)의 `/api/` 전부 | 여정 주소 호출 80 · 여정 화면의 모든 주소 호출 99 | 서버 주소에 다 이어짐(짝 없음 2 = `JourneyDiagnosisPanel.tsx:120 · 129` 공용 `call()` POST → `ai.ts:3276 · 3119` 손 확인) |
| 나 서버 여정 주소 · 받는 키 | `\b(\w*[Rr]outer)\.(get\|post\|patch\|put\|delete)\(\s*'…journ…'` · 본문 `const {…} = req.body` · `req.body.X` · 설정 검사기 `src.X` | 여정 주소 56 · 키 101 | 받는 키 ↔ 화면 입력 대조 = 아래 F3 · F10 |
| 다 서버 고치기 동작 · 막힘 코드 → 화면 | 여정 서버 파일 `(action\|fixTarget\|fix): '…'` · `code: '[A-Z_]+'` | 동작 17 · 코드 27 | 코드 = 화면이 서버 글을 그대로 그림(`journeyApiErrorText` · 토스트) · 동작 도착 화면 = 아래 F3 · F10 |
| 라 돈 · AI 를 부르는 화면 동작 | 서버 바닥 `deductCredit*` · `chargeThenSaveDraft` · `prepaidDeduct` · `enqueueSpamTest` · `startStepSpamCheck` · `runStepSpamTest` · `autoSpamTestWithRegenerate` · AI = `callAIWithFallback` 등 · 호출 그래프 = 같은 파일 함수 + import 로만 이음(이름 겹침 제외 · 값으로 넘기는 함수 포함) | 돈 · AI 닿는 여정 주소 19 + 공용 3(`decorate-message` · `alimtalk/match` · `spam-filter/test`) | 아래 표 |
| 마-1 여정 문구 속 단추 · 창 · 칸 이름 → 화면 | 여정 서버 · 화면 파일 따옴표 글 안 `「…」` · `[…]` | 152 · 화면에 없음 90(로그 머리 · 안내 문자 제목 · 템플릿 자리표시 제외하면 1) | F9 |
| 마-2 직원 문서 이름 → 화면 · 서버 | 체크리스트 · 직원 시트 3 · 매뉴얼 PDF 의 `「…」` · `[…]` | 189 · 없음 52(문서 이름 · 「보이면 맞음」 같은 시트 말 · 자동마케팅 · 켠 뒤 시험 제외하면 만들기 ~ 켜기 전 = 3) | F4 · F3 |

### 라 · 돈 · AI 를 부르는 화면 동작(만들기 → 켜기 전)

| 화면 동작 | 화면 줄 | 서버 → 바닥 | 계기 | 판정 |
|---|---|---|---|---|
| 문장으로 만들기 [질문 받기] | `InterviewModal.tsx:152` | parse → AI(우리 비용) | 누름 | 정상 |
| [이대로 만들기] | `InterviewModal.tsx:201` | design → `chargeThenSaveDraft` | 누름 · 금액 표시 `:465` | 정상 |
| 상품 여정 만들기 · 진단 추천 만들기 | `ProductJourneyModal.tsx:126` · `JourneyDiagnosisPanel.tsx:120 · 129` | product/create · reco/design → `chargeThenSaveDraft` | 누름 | 정상 |
| AI 다듬기 · AI 꾸미기 · 다음 칸 추천 받기 · A/B 자동 만들기 | `JourneyWorkspace.tsx:482 · 527 · 961` · `JourneyVariantsEditor.tsx:241` | refine-step · decorate-message · recommend-next-step · auto-generate → `deductCreditOutcome` | 누름 | 정상 |
| 「고친 곳 N개 저장」 · 칸 넣기 | `JourneyWorkspace.tsx:564 · 625` | → `startStepSpamCheck` | 저장할 때 자동 | F2 |
| 「문안 수정」 창 저장 | `JourneyMessageEditModal.tsx:130` | → `startStepSpamCheck` | 저장할 때 자동 | F2 |
| 혜택 넣기 · 링크 넣기 | `JourneyWorkspace.tsx:511` | copy-facts → 모든 문자 칸 `startStepSpamCheck` | 누름 = 바로 서버 저장 + 칸 수만큼 검사 | F2 |
| 「켜기 전 점검」 창 열기 | `BatchActivateModal.tsx:104-108`(고른 여정 = 기본 초안 전부 · 고를 때마다) | pretest-validate → `runStepSpamTest` | 창을 열면 자동 | F2 |
| 「켜기」 창 열기 | `JourneyActivationConfirmModal.tsx:132` | pretest-validate → `runStepSpamTest` | 켜기를 누를 때 | 정상(직원 요청과 같은 때) |
| 「지금 스팸 검사」 | `JourneyWorkspace.tsx:1174` → `SpamFilterTestModal.tsx:251` | spam-filter/test → `prepaidDeduct` | 누름 | F1(검사 글이 켜기와 다름) |
| 점검 판 읽기 | `JourneyWorkspace.tsx:297` | check → 엿보기만(`journey-check.ts:88` `spam: peekStepSpam`) | 자동 · 돈 0 | 정상 |
| 옛 검토 화면(정보 알림 · 날짜축) 저장 | `JourneysPage.tsx:1348` | POST journeys → 칸을 실어 보내면 AI 0(`journey-builder.ts:361` 앞 갈래) | 누름 | 정상 |

### 이번에 새로 나온 결함 · 넓어진 결함

| ID | 뿌리 | 사슬(파일:행) | 고객사가 겪는 일 |
|---|---|---|---|
| F2 넓힘 | 결정 | 확정 전 유료 검사 자리 = 칸 저장 · 칸 넣기 · 문안 수정 창 저장 · 혜택/링크 넣기 · **「켜기 전 점검」 창을 열기만 해도 초안 전부**(위 표) · AI 한줄로 카드(§1 A8) | 창을 열어 보기만 해도 초안마다 검사비 |
| F3 넓힘 | R56 | 서버는 회신번호 · 매장번호로 보내기를 바꿀 수 있다(`journey-options-validator.ts:96-97` · `journey-step-edit-policy.ts:119-125` · `journey-reshape.ts:71`) · 화면 폼도 그 키를 안다(`journey-start-form.ts:32`) · **입력 자리는 0**(시작 카드 · 작업 화면 · 문안 수정 창) · 매장번호로 보내기 고르기 = 옛 검토 화면(`JourneysPage.tsx:1891-1903`)에만 · 문장으로 만들기 · 상품 여정 = 없음 | 회신번호 · 매장번호 발송을 만든 뒤 못 바꿈 · 기본 번호 회사는 만들 때도 못 고름 |
| F9 새로 | R56 | 붙이기 점검 안내 「앞 여정이 「목표 달성하면 끝내기」를 꺼 둬서 …」(`journey-attach.ts:69 · 189`) · 화면 이름 = [시작] 카드 「구매하면 남은 문자 안 보냄」(`JourneyStartCard.tsx:209-210`) | 안내가 가리키는 단추를 못 찾음 |
| F10 새로 | R56(F3 과 같은 뿌리) | 알림톡 칸 막힘 · 멈춤 안내 = 「템플릿을 (다시) 골라 주세요」 · 「#{…} 에 넣을 값을 연결해 주세요」(`journey-kakao-step.ts:48-71` · `journey-check.ts:45-49` · `journey-pause-reason.ts:29`) → 점검 판 고치기 = 그 칸 고르기 → 작업 화면 알림톡 칸 = 읽기만 · 「문안 수정 창에서 고쳐요」(`JourneyWorkspace.tsx:1084-1088`) → 문안 수정 창 = 알림톡 칸도 글 칸 하나(`JourneyMessageEditModal.tsx:246-252`) · 템플릿 · 변수 고르는 자리 = 만들 때(정보 알림 만들기 · 옛 검토 화면 `JourneysPage.tsx:866-893`)뿐 | 템플릿이 승인 취소 · 비활성 · 변수 빔이 되면 화면에서 고칠 길 없음 |
| F11 새로 | R5(본 것 ≠ 나가는 것) | 문안 수정 창이 알림톡 칸 글을 고쳐 저장(`JourneyMessageEditModal.tsx:246-252 · 130` · 채널 거름 없음) · 발송 = 승인 템플릿 본문(`journey-kakao-step.ts:51` `kakao_templates.content` · `journey-executor.ts:782`) | 알림톡 문안을 고쳤다고 보이지만 고객에게는 옛 템플릿 글이 나감 |

### 같은 뿌리로 묶기(이 단계)

- **값의 주인 ↔ 고치는 화면 자리**(F3 · F10): 서버가 받는 여정 값 · 서버 안내의 고치기가 가리키는 값마다 그 값을 바꾸는 화면 입력이 있어야 한다. 지금은 회신번호 · 매장번호 모드 · 알림톡 템플릿 · 변수 넷이 입력 0.
- **같은 글을 두 곳이 만든다**(F1 · F11): 검사 글(수동 · 켜기) · 알림톡 글(고치는 글 · 보내는 글).
- **이름 · 뜻이 화면마다 다르다**(F4 · F5 · F9).
- **확정 전 돈**(F2): 결정 하나로 여섯 자리가 같이 정해진다.

### 빈칸 확인

- 칸 가 ~ 마 = 뽑은 줄 전부 판정(짝 없음 2 · 이름 없음 90 · 문서 없음 52 = 위 판정 · 나머지 = 정상 또는 단계 밖).
- 단계 밖으로 둔 것 = 켠 뒤(멈춤 · 다시 켜기 · 끝내기 · 보관 · 지우기 · 통계) · 자동마케팅 만들기 단계(같은 모양 추출 안 함 · 기록만).
- 빈칸 = 0(이 단계 · 여정).

## §2 묶음 B · 고객 DB 현황 → 상세보기 → 엑셀

뽑은 패턴: `customers_unified` (백엔드 전체) · `buildDynamicSelectExpr(|buildDynamicFilterCompat(` · `\.blob()|res.text()` (화면).

| # | 이음매 | 쓰는 쪽 | 읽는 쪽 | 값 범위 | 그리는 화면 | 판정 |
|---|---|---|---|---|---|---|
| B1 | [엑셀 다운로드] | `CustomerDBModal.tsx:321-347` | `routes/customers.ts:244-436` | 3,578명(접수 화면) | - | - |
| B2 | 어떤 칸을 내보낼지 | `enabled-fields.ts:270-312` = **`customers` 표**에서 칸마다 값 있는 행 수(FIELD_MAP 칸 전부) | `customers.ts:363-380` → `enabled-fields.ts:396-439` = **`customers_unified` 뷰**에서 SELECT | 가입일(`joined_at`) 값이 1행 이상인 회사 = 칸 목록에 들어감 | - | 결함 F6(미검증 · §7 ①) |
| B3 | 가입일 칸 생김 | `standard-field-map.ts:92-93 · 530`(C98 `3af58654`) · DDL `DEPLOY-LEDGER.md:749-763` C98-DDL-2 = `ALTER TABLE customers ADD COLUMN joined_at` 만 | 뷰 칸 = `SCHEMA.md:618-619`(0822 실측 40칸 · 가입일 없음 · 뷰를 다시 만든 DDL 기록 0) | 1103 이후 가입 근거가 찍힌 고객(화면 추가 · 업로드 · 싱크 새 고객) | - | 결함 F6 |
| B4 | 같은 뿌리 · 목록 필터 | 「필터 필드 선택」 = 활성 필드(가입일 포함) | `customers.ts:126-132` → `customer-filter.ts:301-306`(칸 이름 그대로) · FROM `customers_unified` `:203` | 「가입일」 필터를 고를 때 | 목록 「서버 오류」 | 결함 F6(같은 뿌리) |
| B5 | 같은 뿌리 · 필터 미리보기 | 같음 | `customers.ts:439-478` FROM `customers_unified c` | 「가입일」 조건 | - | 결함 F6(같은 뿌리) |
| B6 | 같은 뿌리 · 슈퍼관리자 칸 데이터 유무 | `standard_fields` 가입일 행(C98-DML-1) | `routes/admin.ts:3770-3796` 손 매핑(가입일 없음 → `custom_fields->>'joined_at'` 으로 셈) | 늘 0 | 「데이터 없음」으로 보임 | 결함 F6(같은 뿌리 · 화면 값 틀림) |
| B7 | 영향 없음 확인 | - | 대상 수 `customers.ts:913-994` · 추출 `:1007-1093` = `customers` 표 | - | - | 정상(근거 = 줄) |
| B8 | 실패 안내 | 서버 catch `customers.ts:432-435` = 500 한 갈래(칸 없음 503 분기 없음) | `CustomerDBModal.tsx:344-346 · 360` 응답 글자 원문을 토스트에 | 서버 JSON | 「다운로드 실패: {"error":…}」(접수 캡처 그대로) · 같은 꼴 화면 = 이 1곳뿐(grep `res.text()`) | 결함 F7 |

## §3 묶음 C · 정산서 발송 → 업체 컨펌 · 이의신청 → 계산서

뽑은 패턴: `taxbill_status = '|objection|superseded_at` (백엔드) · `objection|이의신청` (관리 화면).

| # | 이음매 | 쓰는 쪽 | 읽는 쪽 | 상태 | 판정 |
|---|---|---|---|---|---|
| C1 | 컨펌 메일 발송 | `invoice-confirm.ts:158-170 · 266` | - | manual_wait → pending | 정상 |
| C2 | 업체 컨펌 | `invoice-public.ts:196-197`(`objection_at IS NULL` 조건) | 발급 워커 `taxbill-worker.ts:28-40` | pending · due → confirmed → ready | 정상 |
| C3 | 업체 이의신청 | `invoice-public.ts:213-233` | 업체 화면 `:49-52 · 66`(「담당자가 확인 후 연락드리겠습니다」 · 컨펌 단추 없음) | → objected | 정상(들어가는 길) |
| C4 | 이의 통지 메일 | `invoice-confirm.ts:525-630` | 담당자 메일 | objected | 정상 |
| C5 | 관리자 대신 컨펌 | `routes/billing.ts:1331-1352` = `manual_wait` · `objection_at IS NULL` 만 | `AdminDashboard.tsx:3649-3672` 단추 = manual_wait 행만 | objected = 막힘 | 결함 F8 |
| C6 | 관리 목록 이의신청 행 | - | `AdminDashboard.tsx:3674-3676` 사유 글만 · 단추 0 | objected | 결함 F8 |
| C7 | 수정 재발행 | 서버 `billing.ts:2703-2707`(정산 지우고 다시 발행 · 조정 수 검사 없음) | 화면 `QtyAdjustModal.tsx:277` `disabled={adjusted === 0 \|\| changed > 0}` · 문구 `:266` 「조정이 없습니다」 | 조정 0 = 잠김 | 결함 F8 |
| C8 | objected 를 푸는 쓰기 | grep = 쓰는 자리 1(`invoice-public.ts:232`) · 푸는 자리 0 | - | 나가는 길 = 조정 1건 이상 재발행뿐 | 결함 F8 |

## §4 결함 장부

| ID | 묶음 · 접수 | 뿌리(`docs/ROOT-LEDGER.md`) | 사슬 | 고객사 · 직원이 겪는 일 | 서버 지금 / 배포 뒤 | 확인 |
|---|---|---|---|---|---|---|
| F1 | A · 2 | R1(같은 사실 두 벌) · R5(본 것 ≠ 나가는 것) | 같은 칸을 검사하는 글을 두 곳이 따로 만든다(A6 화면 + 회사 최근 고객 · A7 서버 렌더 + 여정 대상 고객) | 「지금 스팸 검사」는 돈이 나가도 점검 판 · 켜기에 안 쓰여 켜기 때 다시 차감 · 변수 · Liquid 글은 실제 나갈 글이 아닌 글로 통과가 날 수 있음 | 있음 / 있음 | 코드 읽기 · 실측 미검증 |
| F2 | A · 2(+ A8 형제) | 결정(C91 D1 · D2 설계대로 동작) | 칸 저장 · 칸 넣기 · 혜택/링크 넣기마다 새 글이면 유료 검사 | 확정 전 문안마다 검사비 | 설계대로 / 설계대로 | 코드 읽기 |
| F3 | A · 5 | R56(서버 안내를 화면이 못 받음) | 만들기 창은 기본 번호가 있으면 묻지 않고(A1) · 만든 뒤엔 바꿀 자리 0(A2) · 회신번호 멈춤 · 켜기 거절의 고치기가 칸 없는 곳으로 감(A3) | 여정마다 보낼 번호를 고를 수 없음 · 번호가 비거나 바뀌면 화면에서 고칠 길 없음 | 있음 / 있음 | 코드 읽기 |
| F4 | A · 3 | R56(문구 속 단추가 실제로 있나 · 직원 문서) | 체크리스트 B 2번 · 11번이 화면에 없는 단추 · 창 이름을 적음 | 직원이 단추 · 창을 못 찾음(접수 3) | 문서 결함(서버 무관) | 엑셀 원문 대조 |
| F5 | A · 3 | R56(같은 값의 뜻이 화면마다 다름) | 최대 인원 = 넘으면 여정 전체 멈춤 · 0통인데 [시작] 카드엔 설명 없음 | 「50명 골라 보내고 나머지 이월」로 이해 · 대상이 많은 날 0통 | 있음 / 있음 | 코드 읽기 |
| F6 | B · 4 | 새 뿌리 후보 R57(표에 칸을 더해도 그 칸을 읽는 뷰 · 손 매핑이 따라가지 않음) | FIELD_MAP 칸 = 표 기준 탐지 → 뷰 SELECT · C98 가입일이 표에만 | 가입일 값이 있는 회사 = 엑셀 늘 실패 · 「가입일」 필터 목록 · 미리보기 실패 · 슈퍼관리자 화면 가입일 0 | 있음 / 있음 | 코드 · DDL 기록 · **실행 확인(1105 Harold 출력 = 서버 오류 로그 `고객 다운로드 오류: error: column "joined_at" does not exist` · 끝 5줄 = 1104 15:05:15 · 15:05:19 · 15:05:29 · 1105 10:31:35 · 10:31:41 · 첫 발생 시각은 미확인)** |
| F7 | B · 4 | R10 꼴(응답 원문 노출) · db_alter_safety_net | 서버 500 한 갈래 + 화면이 응답 글자 그대로 | 「{"error":…}」 원문이 보임 | 있음 / 있음 | 코드 읽기 · 접수 캡처 |
| F9 | A · 다시 뽑기 | R56 | 붙이기 점검 안내가 화면에 없는 이름 「목표 달성하면 끝내기」(§1-2) | 안내가 가리키는 단추를 못 찾음 | 있음 / 있음 | 코드 읽기 |
| F10 | A · 다시 뽑기 | R56(F3 과 같은 뿌리) | 알림톡 템플릿 · 변수를 만든 뒤 고르는 자리 0 · 켜기 · 멈춤 안내의 고치기가 그 없는 자리로 감(§1-2) | 템플릿 승인 취소 · 비활성 · 변수 빔을 화면에서 못 고침 | 있음 / 있음 | 코드 읽기 |
| F11 | A · 다시 뽑기 | R5 | 문안 수정 창이 알림톡 칸 글을 고쳐 저장 · 발송은 승인 템플릿 본문(§1-2) | 고쳤다고 보이지만 나가는 글은 그대로 | 있음 / 있음 | 코드 읽기 |
| F8 | C · 1 | R6(닫히지 않는 상태) | objected 에서 나가는 길 = 조정 1건 이상 수정 재발행뿐 · 업체 컨펌 · 관리자 대신 컨펌 · 목록 단추 모두 막힘 | 「변경 없음」 확인 뒤 계산서까지 갈 길 없음 | 있음 / 있음 | 코드 읽기 · grep |

## §5 직원 질의(접수 3) 사실 답

1. 「전체 고객에게 보내기」 = 시작이 「고른 고객에게」인 여정에서 조건을 하나도 넣지 않았을 때만 [시작] 카드에 나온다(`JourneyStartCard.tsx:162-164`). 생일 D-7 · 구매 같은 사건 여정은 「이 사건이 생긴 모든 고객」이라 이 단추가 없다. 체크리스트 B 2번 문장이 모든 여정에 해당하는 것처럼 적혀 있다(F4).
2. 한 번에 보낼 최대 인원 = 대량 진입 차단기다. 한 회차(날짜 여정 = 그 칸의 그날 발송 · 사건 여정 = 감시 한 번) 대상이 이 수를 넘으면 그중 일부를 골라 보내지 않고 **여정 전체를 멈추고 0통**이며 담당자에게 알린다. 넘지 않으면 아무 영향 없다. 나눠 보내려면 「하루에 N명씩 나눠 받기」(「고른 고객에게」 · 휴면 여정만). 쓰는 때 = 고객 정보를 한꺼번에 옮겨 와 대상이 갑자기 늘 때의 사고 방지. 예시(대상 100 · 상한 50) = 그날 0통 · 여정 멈춤(F5).
3. 「여러 여정 켜기 창」이라는 창은 없다. 겹침 안내가 실제로 나오는 곳 = 작업 화면 「켜기」를 눌렀을 때 · 다시 켤 때 · 시작 설정 저장 때 「같은 구매로 함께 시작되는 여정이 N쌍 있어요」, 그리고 「고객 관계 지도」 탭 바닥 「켜기 전 점검」(초안이 있을 때만)(F4).

## §6 범위 밖 기록(착수 0)

- `invoice_confirmations.superseded_at` 을 쓰는 자리 0 · 읽기만 여러 곳(재발행은 정산 삭제 뒤 새 행) · 업체 화면 `superseded` 상태는 나올 수 없음.

## §7 빈칸 · 확인 명령(Harold 실행 · 하나씩)

- ① F6 실행 확인 = 서버 오류 로그에 가입일 칸 없음 오류가 있는가 → **1105 확인됨**(§4 F6 칸).
- ② (①이 맞으면) 영향 회사 수 · ③ 뷰 칸 실측 = ① 결과를 본 뒤 낸다.
- F1 · F3 · F5 · F8 실행 확인 = 설계서 단계의 직원 지시문으로(구현 전에 기대 결과 고정).

## §8-0 지난 여정 흐름 표가 이 결함을 못 잡은 이유(1105 대조)

| 지난 표 | 단계 · 칸 | 뽑은 대상 | 이번 결함 자리 |
|---|---|---|---|
| 1102 여정 · 자동마케팅 흐름 표(C98 바탕) | 흐름 다섯 = 가입 환영 · 구매 즉시 · 날짜 · 운영 중 수정 · 자동마케팅 회차(모두 켜진 뒤) · 칸 A ~ J = 멈춤 · 문안 쓰기 · 확정본 · 진입 · 회차 · 상한 · 채울 자리 · 담당자 안내 | `packages/backend/src` 파일 이름 거름 138개(§0-1 `FILE_RE`) · 화면 파일 0 | 만들기 창 회신번호 · 바꾸는 자리(F3) · 수동 검사 창(F1) · [시작] 카드 설명(F5) = 단계 없음 |
| 1103 C99 두 문 흐름 표 | 구매 사건 · 요약 칸 · 가입 근거 | 백엔드 구매 칸 258줄 | 해당 없음 |
| 1104 C102 두 축 | 값 범위 · 「서버가 만든 값 · 문구 → 그리는 화면」 한 방향 | 서버 문구에서 출발 | 화면 단추 · 입력에서 출발하는 반대 방향(F3 고치기 단추의 도착 화면) 없음 |
| 1103 직원 체크리스트 · 매뉴얼 | - | 설계서에서 문장으로 씀 | 여정 종류마다 화면 대조 없음(F4) |
| C98 가입일 칸(FIELD_MAP) | 여정 신규 판정 | 설계서 `2026-11-02-journey-automarketing-core-fix-design.md:163` = 「표준 필드에 가입일 추가」 한 줄 · FIELD_MAP 소비처(`enabled-fields` · `customers_unified`) 언급 0(grep) | 고객 DB 엑셀 · 필터 · 슈퍼관리자 표가 영향표 밖 → F6 이 C98 배포로 생김 |

→ 플레이북 흐름 첫 단계 「만들기 → 켜기 전(사람이 화면에서 값을 정하고 · 고치고 · 검사하는 단계)」가 네 표 어디에도 단계로 없었다. 이번 §1 A 도 접수 자리 둘레를 grep 으로 넓힌 것이라 그 단계 전체 추출이 아니었다 → §1-2 에서 화면 · 서버 둘 다 기계로 다시 뽑음(새 결함 F9 · F10 · F11 · F2 · F3 넓힘).

## §8 닫기 칸(플레이북 §2)

- [ ] 흐름 표 빈칸 0 · Harold 확인 날짜
- [ ] 결함마다 처방 · 뿌리 번호 · 계약 시험 · 변이 빨간불
- [ ] tsc 0 · 백엔드 시험 전체 · 실 PG 시험
- [ ] Codex 설계 · 구현 approve
- [ ] 서버 `deployed_head` 에 커밋
- [ ] 직원 지시문 결과 전 항목 「맞음」
- [ ] BUGS · 기능 문서 · 이 장부 갱신
