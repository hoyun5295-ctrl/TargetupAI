# C103 · 1104 오류접수 처방 설계서 (2026-11-05)

> 범위 = 흐름 표 · 결함 장부 `docs/2026-11-05-intake-1104-flow-ledger.md` 전체(F1 ~ F11 · Harold 1105 「확정」).
> 순서(Harold 1105) = 설계서 → 구조체크로 설계 결함 닫기 → Codex 설계 approve → 구현 → Codex 구현 approve → 배포 명령 보고.
> 서버 판 = `d7e3061f`(로컬 코드와 같음). 카드 = C103.

## §0 진행 표

| 단계 | 상태 |
|---|---|
| 흐름 표 · 결함 장부 | 끝(1105 Harold 확정) |
| 설계서 | 이 문서 |
| 설계 구조체크 | 1차 끝(§8 SC-1 ~ SC-6 반영) |
| Codex 설계 | 1R 지적 8 · 2R 지적 2 수용 · 3R approve(1105) |
| 구현 · 시험 | 끝(1105) · tsc 백엔드 · 프론트 0 · 백엔드 vitest 757파일 통과(실 PG 도장 13 = test:pg 뒤 통과) · 실 PG 55파일 387건 · 계약 `c103-intake-contract-1105` · 실 PG `c103-intake-1105` · `c103-objection-resolve-1105` · 직원 문서(체크리스트 B 2 · 3 · 11 · 매뉴얼 4 · 5 · 6장 · 직원 시트 24 ~ 29) |
| Codex 구현 | 1R 지적 4(높음 1 · 중간 3) · 2R 1(1R ④와 같은 뿌리 = 발신프로필 · 템플릿 한 쌍 판정으로 구조 처방) 수용 · 3R approve(1105) · 1R 에서 같은 뿌리 남은 자리 2 = 계약이 잡음(만료 판정 4자리 + 정리 CT = spamTestRunElapsedMs 하나) |
| 배포 명령 보고 | 보고(1105) · 순서 = C103-S0 ① ② → C103-DDL-1 → push(C103 파일만) → pull → 백엔드 · 프론트 build:safe → 적재 0 조건 재시작(restart-env) → uptime · 엑셀 확인 → C103-S1 직원 시트 |

## §1 결정 한 가지(F2 · 확정 전 유료 스팸 검사)

C91(1101) 설계는 「칸 저장 뒤 자동 검사」였다. 접수 2(남지현 P1 · 댓글 포함)는 「확정 전 자동 검사는 불필요한 지출 · 「지금 스팸 검사」를 누를 때와 켤 때만」을 요청했다.
- **추천 = 접수 요청대로.** 이유: ① 켜기 검증 · 보내기 전 검사 · 주간 검사가 이미 같은 글을 검사한다(나가는 글은 빠짐없이 검사됨 · 켜기 · 보내기 전 검사는 그대로) ② 자동 검사는 저장 · 혜택 넣기 · 「켜기 전 점검」 창 열기마다 새 글이면 차감했다(§1-2 표 여섯 자리) ③ F1 을 닫으면 「지금 스팸 검사」 결과가 켜기에 그대로 쓰여(같은 날 같은 글 = 이어 보기 · 차감 0) 사람이 검사 시점을 고를 수 있다.
- 이 결정은 Harold 「확정」(1105)에 포함된 것으로 진행하고, 배포 명령 보고에서 다시 한 줄로 알린다.
- AI 한줄로 결과 카드 자동 검사(1018 Harold 결정 · 카드당 2회)는 같은 모양이지만 다른 기능의 별도 결정이라 바꾸지 않는다(§7 기록).

## §2 처방 한눈표

| ID | 뿌리 | 처방(한 줄) | 바뀌는 파일 |
|---|---|---|---|
| F1 | R1 · R5 | 여정 「지금 스팸 검사」 = 여정 칸 검사 주소(서버가 켜기와 같은 함수로 글을 만든다) · 결과 읽기 = 공용 CT | `routes/ai.ts` · `journey-pretest-validator.ts` · `routes/spam-filter.ts` · 새 CT `utils/spam-test-view.ts` · `SpamFilterTestModal.tsx` · `JourneyWorkspace.tsx` |
| F2 | 결정 | 칸 저장 · 칸 넣기 · 혜택/링크 넣기 자동 검사 삭제 · 「켜기 전 점검」 = [모두 켜기]를 누를 때 검사 · 점검 문구 | `routes/ai.ts` · `journey-check.ts` · `BatchActivateModal.tsx` |
| F3 | R56 | 만들기 창 = 늘 번호 질문 · [시작] 카드 「보내는 번호」 칸(번호 · 매장번호로 보내기) · 서버 = 등록 번호만 받음 · 막힘 문구 | `InterviewModal.tsx` · `JourneyStartCard.tsx` · `journey-start-form.ts` · `JourneyWorkspace.tsx` · `routes/ai.ts` · `journey-builder.ts` |
| F4 | R56 | 체크리스트 B 2 · 11 · 매뉴얼 문장 고쳐 다시 뽑기 | `docs/2026-11-03-journey-automarketing-checklist.xlsx` · `-staff-manual.pdf` |
| F5 | R56 | 최대 인원 뜻 = 화면 문구 CT 한 곳 · 세 화면이 부름 | 새 `frontend/src/utils/journey-cap-copy.ts` · `JourneyStartCard.tsx` · `JourneyActivationConfirmModal.tsx` · `BatchActivateModal.tsx` |
| F6 | R57(새) | `customers_unified` 뷰에 가입일 칸 · FIELD_MAP 칸 ⊆ 뷰 칸 실 PG 계약 · 슈퍼관리자 데이터 유무 = FIELD_MAP 으로 칸 해석 | DDL C103-DDL-1 · `routes/admin.ts` · 새 실 PG 시험 |
| F7 | R10 · 안전망 | 엑셀 실패 = 서버 오류 글만 보임 · 칸 없음 = 503 | `CustomerDBModal.tsx` · `routes/customers.ts` |
| F8 | R6 | 이의신청 줄 [변경 없음 · 확인 메일 다시 보내기] = 옛 행 해소 · 무효 → 같은 장 새 확인 메일(옛 발송 길 그대로) | `routes/billing.ts` · `utils/invoice-confirm.ts` · `routes/invoice-public.ts` · `AdminDashboard.tsx` |
| F9 | R56 | 붙이기 점검 문구 = 화면 단추 이름 그대로 | `utils/journey-attach.ts` |
| F10 | R56 | 작업 화면 알림톡 칸 = 공용 알림톡 패널로 템플릿 · 변수 · 대체 발송 고르기 | `JourneyWorkspace.tsx` · 새 `components/journey/workspace/JourneyKakaoStepEditor.tsx` |
| F11 | R5 | 알림톡 칸 글 = 고른 템플릿 본문 한 곳(서버가 맞춤 · 직접 고침 거절) · 문안 수정 창 = 읽기만 | `journey-builder.ts` · `JourneyMessageEditModal.tsx` |

## §3 처방 상세

### F1 · 「지금 스팸 검사」 글 = 켜기 검사 글

- 서버 새 주소 2(여정 문 · `journeyGate` + `canAccessJourney`):
  - `POST /api/ai/operator/journeys/:id/steps/:stepId/spam-check` `{ variantId? }` → 그 칸 판의 **저장된** 글 · 제목 · 채널 · 광고 판정 · 여정 회신번호로 `stepSpamInput`(켜기 · 점검 판과 같은 함수 · 표본 = 이 여정 대상 1명 · `renderJourneySmsMessage`)을 만든다. ① 같은 키 오늘 검사(장애 아님)가 있으면 그 검사(차감 0 · 수락 규칙 거치지 않음 · 남의 검사도 결과 보기만) ② 없으면 **수동 검사 수락 규칙**(아래 공용 CT)을 지나 `enqueueSpamTest({ source: 'manual', reuseSameDay: true, skipPrepaid: false, manualAdmission: { userId } })`. 응답 = `{ reused, view, message, subject }`(검사 번호는 내주지 않는다 · 읽기는 아래 GET 이 키로).
  - `GET` 같은 주소 `?variantId=` → 지금 저장된 글로 같은 키를 엿봐(`peekSpamCheck`) **공용 안전 보기**(`spamCheckView` · 상태 · 앞 대기 수 · 진행 초 · 통신사별 결과만)를 준다. 검사 행 원본(`t.*` · `first_recipient` · 만든 사람)은 어디에도 싣지 않는다(Codex 설계 1R H2). 키에 맞는 검사가 없으면 `{ view: null }` = 「검사 전」.
  - 칸이 문자 칸(SMS · LMS · MMS)이 아니면 400 · 회신번호가 없으면 400 「보내는 번호를 먼저 정해 주세요.」 · 보관 · 끝난 여정 = 409 · 글이 비면 400.
- **수동 검사 수락 규칙 = 공용 CT 하나**(Codex 1R H3 · `utils/spam-test-queue.ts`):
  - `assertManualSpamCallback(companyId, userId, callback)` = 검사 직전 `getRegisteredCallbackSet(companyId, userId)`(사용자 배정 범위 · 지금 `/spam-filter/test` 71-76 과 같은 함수)에 있어야 함 · 없으면 400 `UNREGISTERED_CALLBACK`.
  - `manualSpamInProgressInTx(client, userId)` = `SPAM_TEST_USER_LOCK_SQL` 아래 그 사용자의 사람 검사(자동 출처 제외 · 상태 `pending` · `active` · **`queued`**)가 있으면 409. `enqueueSpamTest` 의 등록 트랜잭션이 `manualAdmission` 이 오면 키 잠금 앞에서 이 함수를 부른다 · `/spam-filter/test` 의 두 갈래(218 · 256)도 같은 함수로 바꾼다(상태 집합에 `queued` 가 더해짐 = 여정 수동 검사가 줄에 있는 동안 다른 수동 검사도 409 · 한 사람 한 검사 규칙 그대로).
- 공용 CT `utils/spam-test-view.ts` `spamCheckView(testId, status, createdAt, msgType)` = 지금 `services/ai-line-spam.ts` `verdictOf`(55-92 · 상태 queued · running · pass · blocked · checking · warn + 통신사별 + 앞 대기 수 + 진행 초) 원본을 옮긴 것. AI 한줄로 칩 · 여정 검사 창이 같이 부른다(R1 · 원본 복사 · AI 한줄로 동작 무변경).
- `journey-pretest-validator.ts` `startStepSpamCheck`(결과 버림) → `enqueueStepSpamCheck`(결과 반환 · source · manualAdmission 인자). 자동 검사 부르는 곳이 사라지므로(F2) 여정 검사 주소가 유일한 소비처.
- 화면: `SpamFilterTestModal` 에 선택 prop `journeyStep?: { journeyId; stepId; variantId? }` · 있으면 「여정 칸 보기 모드」: 시작 = 여정 POST · 읽기 = 여정 GET 을 3초마다 · 화면 상태는 서버 보기만으로 그린다(queued = 「검사 줄에서 차례를 기다리는 중 · 앞 N건」 · running = 서버 진행 초로 남은 시간 · 끝 = 통신사별 결과) · **화면 60초 타이머로 읽기를 끊지 않는다**(Codex 1R M7 · 끝 상태 = 서버 pass · blocked · warn 또는 checking 의 확정 뒤). 미리보기 = 서버가 준 검사 글. 진행 중 검사 되살리기(`/active-test`) · 이력 탭은 이 모드에서 그리지 않는다(여정 칸 검사는 칸 키로 다시 찾는다). prop 이 없으면 지금 동작 그대로(다른 화면 무변경).
- 작업 화면 [지금 스팸 검사]: 그 칸에 저장 안 한 고친 곳이 있으면 열지 않고 「고친 곳을 저장한 뒤 검사해요.」 · 창을 닫으면 점검 다시 읽기.
- 영향: `/api/spam-filter/test` 를 부르는 다른 화면(직접발송 등) = 수락 규칙 함수만 바뀜(상태 집합에 queued · 같은 의미). 차감 = 지금 수동 검사와 같은 선불 길(`enqueueSpamTest` 안 `prepaidDeduct`) · 같은 날 같은 글이면 차감 0.

### F2 · 확정 전 자동 검사 없앰(§1 결정)

- `routes/ai.ts` PATCH 칸(3578-3581) · POST 칸(3635) · copy-facts(3705-3706)의 `startJourneyStepSpamChecks` 호출 삭제 · `journey-check.ts` `startJourneyStepSpamChecks` 함수 삭제.
- 점검 판 문구 `journey-check.ts:95` 「칸을 저장하면 스팸 검사를 자동으로 해요(켤 때도 해요).」 → 「「지금 스팸 검사」를 누르거나 켤 때 검사해요.」
- `BatchActivateModal`: 열기 · 고르기 effect 의 자동 검증(104-108) 삭제 · 첫 구매 빼기 뒤 자동 재검증(176) 삭제(그 여정을 「검사 전」으로). [모두 켜기] = 고른 여정 중 통과 아닌 것을 차례로 검증 → 모두 통과면 같은 누름으로 켜기 · 하나라도 아니면 그 줄 사유를 보이고 멈춤. 줄마다 [점검] 단추(옛 「다시 검증」)는 검사 전에도 보인다. 단추 위 한 줄: 「켤 때 스팸 검사를 해요. 오늘 같은 글은 다시 검사하지 않아요.」
- **누른 순간 목록 고정**(Codex 1R H5): [모두 켜기]를 누르면 그 순간의 고른 여정 · 최대 인원 · 겹침 해소 · 매장번호 확인을 하나의 값으로 잡고, 검증 ~ 켜기 응답까지 고르기 · 최대 인원 칸 · 겹침 단추(「이번엔 켜지 않기」 · 첫 구매 빼기) · 매장번호 확인 · 줄 [점검]을 모두 잠근다(`running`). 켜기 요청은 잡아 둔 값만 싣는다.
- 켜기 창(`JourneyActivationConfirmModal`)은 「켜기」를 누를 때 열리고 그때 검증 = 그대로(요청과 같은 때).
- 그대로 두는 검사(나가는 글 보호): 켜기 검증 · 새 모양 저장(`reshape` = 켜기) · 보내기 2시간 전 검사(켜진 여정의 고친 글 = 보내기 전 반드시 검사) · 주간 검사.
- 매뉴얼 문장(§F4)과 체크리스트 시험 3(켜진 여정 문안 고치기)의 기대 결과는 그대로(저장 문구 · 보내기 전 검사).

### F3 · 회신번호를 고르고 바꾸는 자리

- `InterviewModal`: 등록 번호가 1개 이상이면 **늘** 「어느 번호로 보낼까요?」를 그리고 기본 번호(`defaultPhone`)를 미리 고른다(`needsCallbackChoice` 삭제). 0개 = 지금 안내 그대로. `canBuild` = 번호 고름.
- `journey-start-form.ts`: 폼에 `callbackNumber` · `callbackMode` 초기값(`journey.callback_number` · `callback_mode`) · 바뀐 키 계산에 포함(이미 새 모양 키 목록에 있음 = 켜진 여정은 새 모양 길).
- `JourneyStartCard`: 「누구에게」 아래 「보내는 번호」 칸 = 등록 번호 고르기(설명 함께) + 「고객 매장번호로 보내기(매장번호가 없는 고객은 이 번호로)」 토글. 번호 목록 = 작업 화면이 이미 받는 `/journeys-callback-numbers`(330행 · 지금은 080 만 씀)를 칸까지 넘긴다. 칸 표식 `data-fix-target="callback"`.
- 서버 옵션 저장(`routes/ai.ts` 4094): `callbackNumber` 가 **회사 등록 번호**(`listJourneyCallbackNumbers` · 만들기 · 상품 여정과 같은 목록)가 아니면 400 「등록된 발신번호만 고를 수 있어요.」 · 빈 값 = 지우지 않음(지금 규칙).
- 고치기 동작 `edit_callback` → [시작] 카드 「보내는 번호」 칸으로 이동 · 표식으로 찾음.
- 문구: `journey-builder.ts:791` → 「보내는 번호가 비어 있어요. [시작] 카드 「보내는 번호」에서 골라 주세요.」 · `journey-pause-reason.ts:28` 고치기 이름은 그대로(동작이 이제 칸으로 감).

### F4 · 직원 문서

- 체크리스트 엑셀 B 시트: 2번 맞음 기준 → 「조건이 맞고, 지금 맞는 인원이 예상과 비슷하다. 시작이 「고른 고객에게」이고 조건 없이 보낼 때만 「전체 고객에게 보내기」를 켰다(생일 · 구매 같은 사건 여정은 이 단추가 없다)」 · 11번 어디서 보나 → 「「켜기」를 누를 때 뜨는 창 · 「고객 관계 지도」 탭 바닥 「켜기 전 점검」」 · 3번 → 「정했다(넘으면 그 회차는 보내지 않고 여정이 멈춘다) …」.
- 매뉴얼 PDF(원본 HTML = 1103 세션 작업 폴더 `manual/manual.html`): 4장 「누구에게」(전체 고객 단추 = 고른 고객 시작만) · 최대 인원(넘으면 0통 · 멈춤) · 5장 「저장할 때 스팸 검사를 자동으로」 → 「「지금 스팸 검사」를 누르거나 켤 때」 · 6장 「여러 여정 한꺼번에 켜기」 = 「고객 관계 지도」 탭 바닥 「켜기 전 점검」 · 9장 「문안을 고칠 때」 → 「고친 문안은 보내기 전에」 · 알림톡 칸 템플릿 고르기 자리(F10 뒤 = 작업 화면 알림톡 칸). 다시 뽑아 같은 파일 이름으로.

### F5 · 최대 인원 뜻 한 곳

- 새 CT `frontend/src/utils/journey-cap-copy.ts` `journeyCapHelp(cap: number | null, standing: boolean)`:
  - 정함 = 「한 회차에 이 수를 넘으면 그 회차는 보내지 않고 여정이 멈춰요(골라서 보내지 않아요). 멈추면 담당자에게 알려요.」 + standing 이면 「나눠 보내려면 「하루에 N명씩 나눠 받기」를 써요.」
  - 비움 = 「비우면 제한 없이 보내요. 고객 정보를 한꺼번에 옮겨 오면 들어온 분 모두에게 한꺼번에 나가요.」
- [시작] 카드 최대 인원 칸 아래 · 켜기 창(369-372) · 켜기 전 점검 창(259-261)이 이 함수만 부른다(옛 문구 리터럴 0).
- 사실 근거 = `journey-step-limits.ts:50-61` · `journey-anchor-scheduler.ts:263-277` · `journey-trigger-watcher.ts:347-355`(넘으면 멈춤 · 하루 몫은 「고른 고객에게」 · 휴면만).

### F6 · 고객 뷰 칸 = FIELD_MAP 칸

- DDL `C103-DDL-1`(배포 앞 · 옛 코드 무해 = 칸 하나 끝에 더함): `CREATE OR REPLACE VIEW public.customers_unified` = 덤프 정의(`schema.sql` 2208) 그대로 + 바깥 SELECT 끝에 `t.joined_at` · 안쪽 SELECT 에 `customers.joined_at` · 아래 UNION 끝에 `customers.joined_at`(칸 순서 = 기존 40 + 끝에 하나 · PG 규칙). `SET lock_timeout = '3s'`. 뷰에 기대는 다른 객체 0(덤프 grep).
- 실 PG 계약 시험(새 `test:pg` 파일): FIELD_MAP 의 칸 필드(`storageType: 'column'`) 전부가 `t_tpl_after` 의 `customers_unified` 칸에 있다 → 칸을 더하고 뷰 DDL 을 원장에 안 올리면 빨간불.
- `routes/admin.ts` 칸 데이터 유무(3770-3796): 손 매핑에 없는 키 = `getFieldByKey(key)` 의 칸(`storageType: 'column'`)으로 해석 · 그래도 없으면 custom_fields(지금 규칙). 기본 시험: FIELD_MAP 칸 키 전부가 칸으로 해석된다.
- 영향(뷰를 읽는 곳 · `customers_unified` grep 7파일): 칸이 하나 늘 뿐 · `SELECT *` 로 뷰를 읽어 칸 순서에 기대는 곳 0(확인 대상 = §4 S0).

### F7 · 엑셀 실패 안내

- `CustomerDBModal` 다운로드 실패: 응답이 JSON 이면 `error` 글 · 아니면 「다운로드하지 못했어요. 잠시 뒤 다시 눌러 주세요.」(응답 원문 출력 0).
- `routes/customers.ts` 다운로드 · 목록 · `/filter` catch: `isMissingSchemaError` → 503 `migrationPendingBody('customers_unified 칸(뷰 다시 만들기 · 원장 C103-DDL-1)')`(같은 CT · db_alter_safety_net).

### F8 · 이의신청 「변경 없음」 → 다시 확인 요청

- **먼저 발송 길을 토큰에 묶는다(Codex 설계 1R H1 · 공용 CT `invoice-confirm.ts` · 모든 발송 길이 이득)**: 지금 2단계 발송 선점(408-411)과 전달 확정(`markConfirmationDelivered` 165-168)은 장(billing) 단위라 「어느 확인 행(토큰)의 메일인가」에 묶이지 않는다. 바꿈 =
  - 발송 선점 = `UPDATE billings SET emailed_at = NOW(), emailed_to = $2 WHERE id = $1 AND emailed_at IS NULL AND EXISTS (SELECT 1 FROM invoice_confirmations ic WHERE ic.billing_id = $1 AND ic.token = $3 AND ic.superseded_at IS NULL)` → 1단계에서 잡은 토큰이 그사이 무효가 됐으면(이의 해소 · 재발급) 0행 = 보내지 않는다.
  - 전달 확정 = `markConfirmationDelivered(client, { …, token })` 이 `WHERE token = $t AND superseded_at IS NULL AND taxbill_status = 'manual_wait'` 로만 승격(장 단위 갱신 0). 부르는 곳(같은 파일 484 · `billing.ts` 단건 재발송) 모두 토큰을 넘긴다.
  - 발송 결과에 **`mailUncertain` = 발송 표시가 남은 실패 수**를 더한다 = ① 불확정(60초 초과 · SMTP 응답 불명 · 표시를 일부러 남기는 갈래 470-474) ② 확실한 미발송인데 표시 해제 쿼리가 실패한 경우(461-468 catch · Codex 설계 2R M1). 둘 다 「미발송만 보기」(`emailed_at IS NULL`)에 안 잡히므로 복구 길 = 단건 [메일 재발송]. `mailFailed` 는 지금처럼 전부 센다(옛 소비처 의미 무변경 · 새 칸만 더함).
- 서버 새 주소 `PUT /api/admin/billing/confirmations/:id/objection-resolve`(슈퍼관리자 · 몸 없음):
  1. 한 트랜잭션(잠금 순서 = 일괄발급 1단계와 같게 장 → 확인 행): 그 확인 행의 장 `billings … FOR UPDATE` → 그 확인 행 `FOR UPDATE` · 조건 = `taxbill_status = 'objected' AND superseded_at IS NULL AND issued_at IS NULL AND objection_resolved_at IS NULL` → `objection_resolved_at = NOW(), superseded_at = NOW()` · 같은 장 `billings.emailed_at = NULL, emailed_to = NULL`. 0행 = 409 「이미 처리됐거나 이의신청 상태가 아니에요. 새로고침해 주세요.」 · 그 장에 발급 대기 이상 계산서(`taxbill_issues` ready · submitted · issued)가 있으면 409(수정 재발행 가드와 같은 조건 · 이의 행이면 원래 없음).
  2. 커밋 뒤 그 장 하나로 `createAndSendConfirmations`(일괄발급 · [메일 재시도]와 같은 길 = 새 토큰 행 → PDF → 토큰에 묶인 발송 선점 → 메일 → 토큰 전달 확정). 장 하나 고르는 함수 = `invoice-confirm.ts` 새 `resendConfirmationForSheet(billingId)`(retry 와 같은 SELECT · `b.id` 하나 · `emailed_at IS NULL`).
  3. 응답(효과 검증 뒤 성공 표시 · 6원칙 ②) = sent 1 → 「확인 메일을 다시 보냈어요.」 · 확실한 미발송(SMTP 거절 · 렌더 · 금액 불일치) → `success: false` 「확인 메일을 보내지 못했어요. 「미발송만 보기」에서 [메일 재시도]로 다시 보낼 수 있어요.」 · **표시가 남은 실패(`mailUncertain` · 불확정 또는 표시 해제 실패)** → `success: false` 「보냈는지 확인하지 못했어요. 업체에 받았는지 확인하고, 못 받았으면 그 거래내역서의 [메일 재발송]으로 다시 보내 주세요.」(단건 재발송 = `billing.ts` 3400~ · `ensureConfirmationToken` 이 살아 있는 새 토큰을 싣는다 · 발송 표시를 확인 없이 풀지 않는다 · Codex 1R M8).
- 칸 = 이미 있는 `objection_resolved_at` · `superseded_at`(덤프 실측 · 코드 쓰기 0이던 칸 · DDL 0).
- 업체 옛 링크(`invoice-public.ts` 52 · 66): `superseded_at` + `objection_resolved_at` = 「이의신청을 확인했어요. 새로 보내 드린 확인 메일에서 다시 확인해 주세요.」(재발급 문구와 가름) · 옛 링크로 컨펌 · 이의 0(지금 superseded 규칙).
- 관리 화면(`AdminDashboard.tsx` 3616-3677): 이의신청 줄(살아 있는 행)에 [변경 없음 · 확인 메일 다시 보내기] → 확인 창(공용 `ConfirmModal`) 「업체에 이 거래내역서 확인 메일을 다시 보냅니다. 업체가 새 메일에서 컨펌하면 계산서 흐름이 이어집니다.」 → 결과 토스트 · 목록 다시 읽기. 무효 줄 표시 = `objection_resolved_at` 이면 「이의 확인 뒤 다시 보냄」 · 아니면 「재발급으로 무효」.
- 목록 조회(`billing.ts` 631-670): 상태 탭(전체 아님)에서는 `superseded_at IS NULL` 행만(이의신청 탭에 처리한 옛 행이 남지 않게) · 전체 = 이력 그대로.
- 영향표(`emailed_at` 소비처 = `billing.ts` 14줄 · `invoice-confirm.ts` 7줄 · 화면 6곳): 미발송 거름(200) · 삭제 가드(2452 = `emailed_at || email_sent_at` → `email_sent_at` 이 남아 「보낸 장」 판정 유지) · 단건 재발송(3419-3449 = 그 장 잠금 · 같은 기준) · 일괄발급 적재(`emailed_at IS NULL` + 살아 있는 행 없음 = 새 행) · 화면 「발송」 날짜(새 발송 시각으로 바뀜 · 정상). 잠깐 비는 동안(커밋 ~ 발송 표시 선점)의 상태 = 「미발송 장」(재시도 대상 · 정상 상태 집합 안).
- 수정 재발행(조정 0 잠금)은 그대로(변경 없음은 이 길로 · 조정 있음은 재발행).

### F9 · 붙이기 점검 문구

- 화면 단추 이름 = [시작] 카드 `${목표 이름}하면 남은 문자 안 보냄`(목표 종류마다 앞말이 다름 · `JourneyStartCard.tsx:209-210`). 서버 문구는 바뀌는 앞말을 「…」로 두고 고정 꼬리를 그대로 쓴다.
- `journey-attach.ts:69` → 「앞 여정의 [시작] 카드에서 「…하면 남은 문자 안 보냄」이 꺼져 있어 목표를 이뤄 마치는 고객이 없어요. 앞 여정에서 켜거나 다른 결과를 고르세요.」 · `:189` → 「앞 여정의 [시작] 카드에서 「…하면 남은 문자 안 보냄」이 꺼져 있어 이 결과로 마치는 고객이 없어요.」
- 계약(§5): 여정 서버 문구 속 「…」 이름의 고정 조각(「…」 · 숫자 · 따옴표 자리를 뺀 가장 긴 조각)이 화면 소스에 있다 · 로그 머리 · 안내 문자 제목 · 템플릿 자리표시는 이유 붙은 허용 목록.

### F10 · 작업 화면 알림톡 칸 고치기

- 새 `components/journey/workspace/JourneyKakaoStepEditor.tsx`: 공용 `AlimtalkChannelPanel`(6곳 공용 · 정보 알림 만들기와 같은 부품) + 받는 모습 미리보기. 값 = 칸의 `alimtalk_profile_id` · `alimtalk_template_code` · `alimtalk_variable_map` · `alimtalk_next_*`. 발신프로필 · 템플릿 · 고객 칸 목록 = 그 칸을 처음 열 때 한 번 받음(`/api/alimtalk/senders` · `/api/companies/kakao-templates` · `/api/customers/enabled-fields` · 목록 화면과 같은 주소).
- 작업 화면 알림톡 칸(1084-1088 읽기 전용) → 편집 가능 상태면 이 편집기 · 고친 값은 칸 초안(`drafts`)에 담겨 「고친 곳 N개 저장」으로 한 번에 PATCH(지금 저장 길 · 알림톡 키는 서버 칸 주소가 이미 받음).
- **알림톡 키 = 「문안」 묶음으로 옮긴다**(Codex 설계 1R H4 · 서버 `journey-step-edit-policy.ts` `STEP_EDIT_KEYS`): 템플릿 · 변수 · 대체 발송 · 발신프로필은 그 칸이 무엇을 말하는가(= 문안)다. 지금 「구조」라 진행 고객이 있는 멈춘 여정(`structure: false`)과 켜진 여정(새 모양 · 멈춘 여정은 새 모양 거절 `journey-reshape.ts:82-88`)에서 고칠 길이 없어, 템플릿 승인 취소로 멈춘 여정이 복구되지 않았다. 「문안」이면 초안 · 멈춤(진행 고객 있어도) · 켜짐 모두 그 자리 고침 · 진행 고객은 다음 알림톡부터 새 템플릿(문자 문안 고침과 같은 뜻). 켜진 여정 고침 확정본(`createStepSnapshot` · 신뢰도 0)은 알림톡 칸에도 생기지만 실행기의 재검사 전 미룸 · 보류 관문은 문자 칸만(`journey-executor.ts:632` `isTextChannel` · 700-711)이고 알림톡 발송은 칸 행의 템플릿(`kakaoStepVerdict` 782)을 읽어 그 자리 고침이 바로 반영된다 · 문안 고침 판정(`assertStepCopySendable` `journey-builder.ts:1416-1420`)도 알림톡 칸 밖. 화면 `STRUCTURE_KEYS` 에는 넣지 않는다(SC-2 정정 · 서버와 같은 집합 = 짝 시험).
- **켜진 여정 허가 표식**(Codex 설계 2R M2): 서버는 켜진 여정의 문안 묶음 변경에 `allowActiveMessageEdit: true` 를 요구한다(`journey-step-edit-policy.ts:141-144`). 화면 저장(`JourneyWorkspace.tsx:563`)이 지금 본문 · 제목일 때만 붙이므로, 붙이는 판정 = **패치에 문안 묶음 키(본문 · 제목 · 알림톡 6)가 하나라도 있으면**으로 바꾼다. 화면의 문안 묶음 키 목록 = 서버 `STEP_EDIT_KEYS.copy` 와 같은 집합(짝 시험).
- 서버 `touchesCopy`(`journey-builder.ts:1438` = 본문 · 제목만)는 그대로 둔다 = 켜진 여정 고침 확정본 · 보내기 전 재검사 기록 지우기는 **문자 글**에만 필요하다(알림톡 발송은 확정본 글이 아니라 칸 행의 템플릿 · 변수를 그 자리에서 읽는다 · `journey-executor.ts:782` `kakaoStepVerdict(step)` · 확정본은 본문 · 제목만 덮는다 579-583). 알림톡 키만 바뀐 켜진 여정 저장 = 확정본 0 · 다음 알림톡부터 새 템플릿 · 새 변수.
- 저장 전 화면 검사(`validateCopy` 575-591)를 채널로 가른다(Codex 1R M6): 문자 = 지금 그대로 · 알림톡 = 템플릿 고름 · 변수 전부 연결 · 대체 발송 규칙(`AlimtalkChannelPanel` 의 공용 검증 함수) · 제목 요구 0.
- 시나리오 시험: 초안 · 멈춤(진행 고객 0) · 멈춤(진행 고객 있음) · 켜짐 × (템플릿 바꿈 · **본문 · 제목 없이 변수 연결만 바꿈**) = 그 자리 저장(켜짐 = 허가 표식 실림 · 확정본 0) · 다시 켜기 통과(승인 템플릿) / 승인 안 된 템플릿 = 켜기 거절 문구 / 켜짐 + 허가 표식 없는 알림톡 키 변경 = 409 STEP_EDIT_LOCKED(서버 규칙 유지 확인).
- 점검 판 고치기(`fixTarget: 'alimtalk'`) → 그 칸 + 편집기(`data-fix-target="alimtalk"`).
- 문구 1088 「문안 수정 창에서 고쳐요」 삭제.

### F11 · 알림톡 칸 글 = 템플릿 본문

- 서버 `updateJourneyStep`(journey-builder.ts 1316~): 최종 채널이 kakao 이면 ① `messageTemplate` 직접 고침 = 400 「알림톡 칸 글은 고른 템플릿 글 그대로 나가요. 템플릿을 바꿔 주세요.」(값이 지금 템플릿 본문과 같으면 통과 · 옛 화면 호환) ② 템플릿 코드가 바뀌면 `message_template` = 그 회사의 그 템플릿 본문(`kakaoStepVerdict` 와 같은 조회 · 회사 격리).
- `JourneyMessageEditModal`: 알림톡 칸 = 읽기만(템플릿 본문 그림) + 「알림톡 칸은 작업 화면 알림톡 칸에서 템플릿을 바꿔요.」 · 저장 대상에서 뺌.
- 발송은 지금도 템플릿 본문(`journey-kakao-step.ts:51` · `journey-executor.ts:782`) = 무변경.

## §4 배포 순서 · SQL

- 배포 앞 S0(읽기만 · Harold 실행): ① 뷰를 `SELECT *` 로 읽는 함수 · 뷰 없음 확인 = `SELECT count(*) FROM pg_depend d JOIN pg_rewrite r ON r.oid = d.objid JOIN pg_class v ON v.oid = r.ev_class WHERE d.refobjid = 'public.customers_unified'::regclass AND v.relname <> 'customers_unified';`(기대 0) ② 무효 컨펌 행 수 = `SELECT count(*) FILTER (WHERE superseded_at IS NOT NULL), count(*) FILTER (WHERE objection_resolved_at IS NOT NULL) FROM invoice_confirmations;`(기대 0 · 0)
- 배포 앞 DDL: C103-DDL-1(§3 F6 · 원장에 원문).
- 코드 배포: 백엔드 + 프론트(build:safe · 재시작 = 적재 0건 조건 · 런북).
- 배포 뒤: 엑셀 다운로드 확인 · 직원 지시문(§6).
- 원장(`status/DEPLOY-LEDGER.md`)에 C103-S0 · C103-DDL-1 · C103-S1 을 구현 끝에 올린다.
- C103-DDL-1 되돌리기(필요할 때만 · CREATE OR REPLACE VIEW 는 칸을 뺄 수 없어 지우고 다시 만든다 · 뷰에 기대는 객체 0 = C103-S0 ① 1105 출력 0 · 옛 정의 = 운영 덤프 2026-10-27 원문 · 옛 코드는 가입일 칸을 읽지 않는다):

```bash
docker exec -i targetup-postgres psql -U targetup targetup -v ON_ERROR_STOP=1 <<'SQL'
SET lock_timeout = '3s';
BEGIN;
DROP VIEW public.customers_unified;
CREATE VIEW public.customers_unified AS
 SELECT t.id,
    t.company_id,
    t.phone,
    t.name,
    t.gender,
    t.birth_date,
    t.age,
    t.email,
    t.address,
    t.grade,
    t.points,
    t.store_code,
    t.registered_store,
    t.registered_store_number,
    t.registration_type,
    t.recent_purchase_amount,
    t.recent_purchase_store,
    t.total_purchase_amount,
    t.wedding_anniversary,
    t.is_married,
    t.sms_opt_in,
    t.custom_fields,
    t.is_opt_out,
    t.is_invalid,
    t.created_at,
    t.updated_at,
    t.source,
    t.birth_year,
    t.birth_month_day,
    t.region,
    t.total_purchase,
    t.last_purchase_date,
    t.purchase_count,
    t.is_active,
    t.recent_purchase_date,
    t.store_name,
    t.callback,
    t.store_phone,
    t.uploaded_by,
    t.rn
   FROM ( SELECT customers.id,
            customers.company_id,
            customers.phone,
            customers.name,
            customers.gender,
            customers.birth_date,
            customers.age,
            customers.email,
            customers.address,
            customers.grade,
            customers.points,
            customers.store_code,
            customers.registered_store,
            customers.registered_store_number,
            customers.registration_type,
            customers.recent_purchase_amount,
            customers.recent_purchase_store,
            customers.total_purchase_amount,
            customers.wedding_anniversary,
            customers.is_married,
            customers.sms_opt_in,
            customers.custom_fields,
            customers.is_opt_out,
            customers.is_invalid,
            customers.created_at,
            customers.updated_at,
            customers.source,
            customers.birth_year,
            customers.birth_month_day,
            customers.region,
            customers.total_purchase,
            customers.last_purchase_date,
            customers.purchase_count,
            customers.is_active,
            customers.recent_purchase_date,
            customers.store_name,
            customers.callback,
            customers.store_phone,
            customers.uploaded_by,
            row_number() OVER (PARTITION BY customers.company_id, customers.phone, customers.name ORDER BY
                CASE
                    WHEN ((customers.source)::text = 'sync'::text) THEN 0
                    ELSE 1
                END) AS rn
           FROM public.customers
          WHERE ((customers.name IS NOT NULL) AND ((customers.name)::text <> ''::text))) t
  WHERE (t.rn = 1)
UNION ALL
 SELECT customers.id,
    customers.company_id,
    customers.phone,
    customers.name,
    customers.gender,
    customers.birth_date,
    customers.age,
    customers.email,
    customers.address,
    customers.grade,
    customers.points,
    customers.store_code,
    customers.registered_store,
    customers.registered_store_number,
    customers.registration_type,
    customers.recent_purchase_amount,
    customers.recent_purchase_store,
    customers.total_purchase_amount,
    customers.wedding_anniversary,
    customers.is_married,
    customers.sms_opt_in,
    customers.custom_fields,
    customers.is_opt_out,
    customers.is_invalid,
    customers.created_at,
    customers.updated_at,
    customers.source,
    customers.birth_year,
    customers.birth_month_day,
    customers.region,
    customers.total_purchase,
    customers.last_purchase_date,
    customers.purchase_count,
    customers.is_active,
    customers.recent_purchase_date,
    customers.store_name,
    customers.callback,
    customers.store_phone,
    customers.uploaded_by,
    1 AS rn
   FROM public.customers
  WHERE ((customers.name IS NULL) OR ((customers.name)::text = ''::text));
COMMIT;
SQL
```

## §5 시험

| 뿌리 · 결함 | 시험(기계 추출 · 변이로 빨간불 확인) |
|---|---|
| F1 R1 | 여정 화면(`components/journey/**` · `pages/Journey*`)에서 `SpamFilterTestModal` 을 `journeyStep` 없이 여는 자리 0 · 여정 칸 검사 주소 본문이 `stepSpamInput` 길(`enqueueStepSpamCheck`)만 부른다 |
| F2 | `routes/ai.ts` 여정 주소 본문 중 유료 검사 함수(`enqueueStepSpamCheck` · `runStepSpamTest` · `validateJourneyForActivation` 기본 검사 · `enqueueSpamTest`)를 부르는 주소 = 허용 목록(spam-check POST · pretest-validate · reshape · activate 계열)만 · `BatchActivateModal` effect 안 검증 호출 0 |
| F3 · F10 R56 | 서버 고치기 동작(`PauseFixAction` · `JourneyCheckTarget` 값 = 소스에서 뽑음)마다 작업 화면 처리가 있고 도착 칸에 `data-fix-target` 표식이 있다(콜백 · 알림톡 · 칸 · 시작) · 옵션 저장이 등록 아닌 번호를 400 |
| F5 | 세 화면이 `journeyCapHelp` 를 부르고 옛 문구 리터럴 0 |
| F6 R57 | 실 PG: FIELD_MAP 칸 ⊆ 뷰 칸 · 기본: admin 칸 해석이 FIELD_MAP 칸 키 전부를 칸으로 |
| F7 | 화면 다운로드 실패가 응답 원문을 토스트에 싣지 않는다(소스) · 다운로드 catch 503 분기 |
| F8 R6 | 컨펌 상태 값(소스 `ALLOWED` · CHECK)마다 나가는 쓰기가 있다(objected = 해소 주소) · 해소 주소 실 PG(잠금 · 0행 409 · 장 발송 표시 해제 · 새 행) |
| F9 | 서버 붙이기 문구 속 「…」 이름이 화면 소스 글자에 있다(문구 속 단추 계약 · 여정 서버 파일 전수) |
| F11 | kakao 칸 messageTemplate 고침 400 · 템플릿 바꿈 = 본문 맞춤(단위) · 문안 수정 창이 kakao 칸 입력을 안 그림(소스) |

뿌리 대장(`docs/ROOT-LEDGER.md`): R57 새로(「표에 칸을 더해도 그 칸을 읽는 뷰 · 손 매핑이 따라가지 않는다」) · R56 넓힘(고치기 동작 도착 칸 · 직원 문서) · R6 넓힘(이의신청).

## §6 직원 지시문 초안(구현 전 · 엑셀 = `docs/2026-11-05-c103-staff-sheet.xlsx`)

계정 = 테스트계정 · 받는 번호 = 직원 본인 휴대폰 · 정산 시트 = 테스트 회사 정산서(받는 메일 = 직원 본인 메일).

**24 여정 스팸 검사 때**
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 여정 → 초안 여정 하나를 연다 → 문자 칸 하나 문안 끝에 「감사합니다」를 붙이고 「고친 곳 1개 저장」 | 오른쪽 점검 그 칸에 「스팸 검사 전」과 「「지금 스팸 검사」를 누르거나 켤 때 검사해요.」 |
| 2 | 「혜택 넣기」에 「첫 구매 10% 쿠폰」을 넣는다 | 「모든 문자 칸에 혜택을 넣었어요.」 · 점검은 「스팸 검사 전」 그대로 |
| 3 | 충전 화면에서 잔액을 적어 둔다 → 그 칸에서 「지금 스팸 검사」 | 창의 문자 글이 큰 휴대폰 「받는 모습」과 같은 글(고객 이름이 채워짐) · 1분 안에 통신사 결과 |
| 4 | 창을 닫는다 | 점검 그 칸 「스팸 검사 통과」(막히면 「스팸 검사에서 막혔어요」) |
| 5 | 「지금 스팸 검사」를 한 번 더 누른다 | 바로 같은 결과 · 충전 화면 잔액이 3번 뒤 값에서 더 줄지 않음 |
| 6 | 「켜기」 | 「자동 검증 통과: 모든 칸이 보낼 준비가 됐어요」 · 잔액이 5번 값에서 더 줄지 않음(다른 칸이 검사 전이었다면 그 칸만큼만) |
| 7 | 「고객 관계 지도」 탭 → 초안이 있으면 바닥 「켜기 전 점검」 | 창이 열려도 줄마다 「검증 중」이 돌지 않는다 · 단추 위 「켤 때 스팸 검사를 해요.」 |

**25 보내는 번호**
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 여정 → 한 줄 입력에 「구매 직후 감사인사」 → 질문 받기 | 「어느 번호로 보낼까요?」에 번호가 보이고 기본 번호가 골라져 있다 |
| 2 | 다른 번호를 고르고 「이대로 만들기」 → 열기 | 큰 휴대폰 머리 줄 = 고른 번호 |
| 3 | [시작] 카드 「보내는 번호」에서 또 다른 번호를 고르고 저장 | 「저장했어요. 켜기 전에 점검을 받아요.」 · 머리 줄 번호가 바뀜 |
| 4 | 「고객 매장번호로 보내기」를 켜고 저장 → 「켜기」 | 매장번호가 발신번호로 등록 안 된 고객이 있으면 「미등록 매장번호: 발송 실패 예정 N명」 창 |

**26 알림톡 칸**
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 정보 알림으로 만든 초안(알림톡 칸 있음)을 열고 그 칸을 고른다 | 발신프로필 · 템플릿 · 변수 연결 칸이 보인다 |
| 2 | 다른 승인 템플릿을 고르고 변수를 다 연결 → 「고친 곳 1개 저장」 | 받는 모습 = 새 템플릿 글 |
| 3 | 목록 → 그 여정 「문안 수정」 | 알림톡 칸은 글을 고칠 수 없고 「알림톡 칸은 작업 화면 알림톡 칸에서 템플릿을 바꿔요.」 |
| 4 | 변수 하나를 비우고 저장 → 「켜기」 | 켜지지 않고 「알림톡 템플릿의 #{…} 에 넣을 값을 연결해 주세요.」 · 점검 「고치기」를 누르면 그 칸 연결 칸으로 간다 |

**27 [시작] 카드 문구**
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 초안 여정 [시작] 카드 「한 번에 최대」에 50 | 아래 「한 회차에 이 수를 넘으면 그 회차는 보내지 않고 여정이 멈춰요(골라서 보내지 않아요).」 |
| 2 | 비운다 | 「비우면 제한 없이 보내요. …」 |
| 3 | 「켜기」 창 · 「켜기 전 점검」 창의 최대 인원 칸 | 1 · 2 와 같은 글 |
| 4 | 「목표를 이루면 남은 문자 안 보냄」을 끈 여정 뒤에 다른 여정을 「목표를 이룬 고객」으로 붙인다 | 막히며 「…「…하면 남은 문자 안 보냄」 단추…」 안내 · 그 단추가 [시작] 카드에 있다 |

**28 고객 DB 엑셀**
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | 대시보드 고객 DB 현황 → 상세 보기 → 엑셀 다운로드 | 엑셀 파일을 받는다 · 가입일 있는 고객은 「가입일」 열에 날짜 |
| 2 | 필터 필드 선택 → 가입일 → 조회 | 목록이 나온다(오류 0) |

**29 정산 이의신청 변경 없음**
| 순 | 하세요 | 보이면 맞음 |
|---|---|---|
| 1 | (테스트 회사 정산서 · 받는 메일 = 본인) 받은 메일 확인 링크 → 「이의신청」에 「확인 부탁」 | 「이의신청이 접수되었습니다. …」 |
| 2 | 슈퍼관리자 → 세금계산서 · 컨펌 현황 → 이의신청 | 그 줄에 「변경 없음 · 확인 메일 다시 보내기」 |
| 3 | 누르고 창에서 보내기 | 「확인 메일을 다시 보냈어요.」 · 그 줄이 이의신청 탭에서 빠지고 컨펌 대기 탭에 새 줄(날짜를 직접 고르는 회사는 날짜 지정 대기 탭) |
| 4 | 본인 메일 | 새 거래내역서 확인 메일 1통(PDF 첨부) |
| 5 | 1번의 옛 메일 링크를 연다 | 「이의신청을 확인했어요. 새로 보내 드린 확인 메일에서 다시 확인해 주세요.」 · 컨펌 단추 없음 |
| 6 | 새 메일 링크 → 컨펌 | 「컨펌이 완료되었습니다 …」 · 현황 컨펌됨 |

## §8 설계 구조체크(1차 · 이음매 대조 · 1105)

| # | 이음매 | 발견 | 설계 반영 |
|---|---|---|---|
| SC-1 | 회신번호 쓰는 자리 | 셋 = 만들기(`journey-interview-ai.ts:208-211` · 목록 대조 있음) · 시작 설정 저장(`routes/ai.ts:4094` · 대조 0) · 새 모양(`journey-reshape.ts:71` → `updateJourneyCallback` `journey-builder.ts:2073` · 대조 0) | 공용 검사 `assertJourneyCallbackRegistered(companyId, phone)` = `journey-draft-save.ts`(목록 CT 옆 · 숫자만 비교) · 쓰는 셋이 다 부름(만들기는 같은 함수로 바꿈 · 효과 자리 안) |
| SC-2 | 알림톡 칸 고친 값 → 켜진 여정 | 서버 = 알림톡 키 6개가 「구조」(`journey-step-edit-policy.ts:22-28` · 켜진 여정 = 새 모양) · 화면 `STRUCTURE_KEYS`(`JourneyWorkspace.tsx:95`) = 채널 · 광고 · 사진만 | **Codex 1R H4 로 바뀜** = 알림톡 키를 서버 「문안」 묶음으로 옮긴다(F10) · 화면 구조 키에는 넣지 않음(서버 구조 묶음과 같은 집합 = 짝 시험) |
| SC-3 | F1 읽기 주소 | 검사 뒤 칸 글을 고쳐 저장하면 그 키의 검사가 없다 | GET = `{ test: null }` → 창 「검사 전」 · 다시 누르면 새 글로 등록 |
| SC-4 | F8 날짜 직접 선택 회사 | `markConfirmationDelivered` 가 정책 manual 이면 승격 안 함 → 새 행 = 날짜 지정 대기 | 직원 시트 29-3 기대 = 「컨펌 대기(날짜를 직접 고르는 회사는 날짜 지정 대기)」 |
| SC-5 | F10 알림톡 목록 받기 | 목록 화면(`JourneysPage.tsx:810-856`)이 발신프로필 · 템플릿 · 고객 칸을 인라인으로 받는다 | 받기 · 꼴 맞추기를 공용 `frontend/src/utils/alimtalk-catalog.ts` 로 옮겨 목록 화면 · 새 편집기가 같이 부른다(no_inline_duplication) |
| SC-6 | F2 켜기 전 점검 · 최대 인원 저장 | [모두 켜기] 안에서 최대 인원 저장 → 다시 검증 → 「한 번 더 눌러 주세요」(143-147) | 새 흐름 = 같은 누름 안에서 저장 → 검증 → 통과면 켜기(「한 번 더」 문구 삭제) |

| SC-7 | F2 점검 판 다시 읽기 | 작업 화면이 「검사 전 · 검사 중 · 확인 중」이 있으면 20초마다 최대 60번 다시 읽는다(`JourneyWorkspace.tsx:306-313` · 「칸 저장 뒤 자동 검사가 끝나 바뀐다」 전제) · 자동 검사가 없어지면 「검사 전」은 저절로 안 바뀜 | 다시 읽기 조건 = `hold > 0`(검사 중 · 확인 중)만 · 「지금 스팸 검사」 창을 닫을 때 · 저장 뒤 한 번 읽기 |

빈칸 0(처방마다 쓰는 쪽 · 읽는 쪽 파일:행 대조 끝) → Codex 설계로.

## §9 Codex 설계 판정

| 라운드 | 지적 | 판정 | 반영 |
|---|---|---|---|
| 1R H1 | F8 발송 표시를 비우면 옛 토큰 늦은 작업이 다시 보낼 수 있고 전달 확정이 토큰에 안 묶임 | 수용(`invoice-confirm.ts:299-331 · 408-411 · 165-168` 확인) | F8 = 발송 선점 · 전달 확정을 토큰에 묶음(공용 CT) · 잠금 순서 장 → 확인 행 |
| 1R H2 | F1 키로 찾은 남의 검사 상세(`t.*` · 첫 수신자) 노출 | 수용 | F1 GET = 공용 안전 보기(`spamCheckView` = AI 한줄로 `verdictOf` 옮김)만 · 원본 행 0 |
| 1R H3 | F1 큐 등록이 수동 검사 보호(번호 배정 · 한 사람 한 검사 잠금) 우회 | 수용(`spam-filter.ts:71-76 · 216-262` 확인) | 수동 수락 규칙 공용 CT 2개 · 두 입구 같이 · 상태에 queued 포함 |
| 1R H4 | F10 진행 고객 있는 멈춘 알림톡 여정 복구 불가 | 수용(`journey-step-edit-policy.ts:45-49` · `journey-reshape.ts:82-88` 확인) | 알림톡 키 = 「문안」 묶음(실행기 미룸 관문 = 문자 칸만 확인) · 시나리오 시험 |
| 1R H5 | F2 검증 중 선택 바뀌면 옛 목록으로 켜짐 | 수용(`BatchActivateModal.tsx:128-152 · 311-314`) | 누른 순간 값 고정 · 검증 ~ 켜기 동안 모든 조작 잠금 |
| 1R M6 | F10 저장 전 화면 검사가 제목 없는 알림톡 막음 | 수용(`JourneyWorkspace.tsx:575-591`) | 채널별 저장 검사 |
| 1R M7 | F1 큐 대기 중 60초 타이머가 추적 끊음 | 수용(`SpamFilterTestModal.tsx:120-126 · 267-298`) | 여정 칸 모드 = 서버 상태 · 진행 초만으로 · 화면 타이머로 끊지 않음 |
| 1R M8 | F8 발송 불확정에 안내한 재시도 길 없음 | 수용(`invoice-confirm.ts:455-475 · 226`) | `mailUncertain` 칸 · 불확정 = 단건 [메일 재발송] 안내 · 표시 해제 0 |
| 2R M1 | F8 확실한 미발송 + 표시 해제 실패가 안내한 재시도 길에 안 잡힘 | 수용(`invoice-confirm.ts:457-468 · 226`) | `mailUncertain` = 표시가 남은 실패(불확정 + 해제 실패) → 단건 재발송 안내 |
| 2R M2 | F10 알림톡 키를 문안 묶음으로 옮겨도 화면이 허가 표식을 본문 · 제목에만 붙여 켜진 여정 저장 거절 | 수용(`JourneyWorkspace.tsx:563` · `journey-step-edit-policy.ts:141-144` · `journey-builder.ts:1438-1443`) | 허가 표식 = 문안 묶음 키 전부(짝 시험) · 서버 `touchesCopy` = 문자 글만 유지(근거 적음) · 변수만 바꿈 시나리오 |

뿌리 판정(같은 부류 반복인가): 2R M1 = 1R M8(불확정 안내)과 같은 이음매(발송 표시가 남는 갈래)의 남은 갈래 · 같은 부류 두 번째라 갈래를 「표시가 남은 실패」 하나의 칸으로 묶었다(갈래마다 따로 세지 않음). 2R M2 = 1R H4 처방(묶음 이동)의 화면 쪽 짝 · 묶음 키 목록을 화면 · 서버 한 집합으로 묶어(짝 시험) 같은 어긋남이 다시 나지 않게 했다.

1R 뿌리 판정(같은 부류 반복인가): 1R 은 첫 라운드 · 여덟 지적은 서로 다른 이음매(발송 소유 · 읽기 범위 · 수락 규칙 · 편집 정책 · 화면 잠금 · 저장 검사 · 화면 타이머 · 불확정 갈래).

## §7 남은 위험 · 범위 밖(기록만)

- AI 한줄로 결과 카드 자동 스팸 검사(카드당 2회 · 1018 결정) = F2 와 같은 모양 · 바꾸려면 Harold 결정.
- 자동마케팅 만들기 단계 = 이번 기계 추출 밖(같은 모양 추출 = 다음 과제).
- `invoice_confirmations.superseded_at` 를 쓰는 다른 자리 0 이었다(이번에 처음 씀) · 재발급(삭제 후 재발행)은 행 삭제 길 그대로.
- F8 잠깐 비는 순간(해소 커밋 ~ 발송 선점 사이) 서버가 멈추면 그 장 = 「미발송」(재시도로 복구 · 정상 상태 집합 안).
- F1 구현 한계(1105 · 구현 중 판정) = A/B 문안이 있는 칸의 「지금 스팸 검사」는 판을 고르는 화면이 없어 첫 판만 검사한다(서버 주소는 variantId 를 받는다) · 나머지 판은 켤 때 · 보내기 전 검사가 잡는다(검사 0 으로 나가는 판 0).
