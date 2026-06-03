# 2026-06-03 여정 "문안 수정" 모달 전면 개편 핸드오프 (다음 세션)

> 이 문서 하나로 다음 세션이 **추측 0**으로 작업하도록 작성. 모든 경로·줄번호는 이 세션에서 실제로 읽고 확인한 사실. 데이터 shape 등 100% 확인 못 한 것은 "확인 필요"로 명시해 두었으니 **단정하지 말고 그 파일을 직접 읽고 확정할 것.**

---

## 🔴 0. 절대 철칙 (Harold 명시 — 위반 = 협업 종료)

- **추측 금지.** 원인·SQL·컬럼·동작을 추측으로 말하지 않는다. 코드를 직접 읽고, 스키마는 information_schema(실제 DB) / SCHEMA.md / pg_constraint로 확인한 사실만 말한다. "~인 것 같다 / ~일 것이다" 금지.
- **DB ALTER 전 information_schema 검증.** tsc 통과 ≠ SQL 유효. SQL 문자열 안 컬럼명은 tsc가 검증 못 한다.
- **배포는 tp-push(로컬) 먼저 → 서버 git pull → build:safe → pm2 restart → dist grep으로 실제 반영 검증.** 빌드만 시키지 말 것. (이번 세션에 이걸 빠뜨려 여러 번 헛돌았다 — 5절 참조.)
- 답변은 사실만 짧게. 자연 한국어. 이모지/포장 금지.

---

## 1. 작업 목표 (Harold 명시 — 2026-06-03)

`JourneyMessageEditModal`("문안 수정" 모달)을 전면 재작성. 여정 = 핵심 마케팅 툴 → **AI 여정(Journey Builder) 동급 디자인 퀄리티 의무.** 3가지:

1. **전체화면 + 가로 스텝 레이아웃.** 지금은 작은 본문 textarea가 세로로 스택돼 답답함. 모달을 거의 전체화면으로 키우고, step을 **세로 스크롤 → 가로 컬럼(좌→우 1·2·3·4…)**, 컬럼이 화면보다 많으면 **우측 스크롤**. 각 컬럼 = 한 step(제목+본문), 본문 textarea를 화면 높이만큼 크게 → 한눈에 보며 편집.
2. **원본 ↔ 치환 미리보기 토글.** 변수가 많아 나열되면 답답하니, 토글로 "변수 치환된 실제 발송 모습"을 보여준다. (Harold: "이미 구현해 놨잖아" = 아래 2절 자산 재사용.)
3. **빈 변수 경고.** `{{ customer.name | default: '고객' }}`처럼 default 있으면 안전하지만, default 없는 `{{ customer.X }}`는 값이 없으면 **그 줄이 통째로 빈다.** 사용자가 처리하도록 경고를 띄운다.

---

## 2. 재사용 자산 (이미 있음 — 새로 만들지 말 것)

### 2-1. 변수 강조/치환 컨트롤타워 — `packages/frontend/src/utils/highlightVars.tsx`
- `highlightVars(text, theme='light'|'dark')` (16행): `%변수%` / `{{ Liquid }}` / `{% tag %}`를 amber span으로 강조 (= **원본 보기**).
- `mergeAndHighlightVars(text, sampleCustomer, theme, sampleCustomerFields)` (68행): 변수를 샘플 고객 데이터로 **치환**해 emerald span으로 표시. **값 없는 변수는 이미 취소선(line-through, missingClass, 80~82행)으로 표시함** → "빈 변수 시각화"가 부분적으로 이미 됨.
  - `sampleCustomer` = 한국어 키 객체 (예 `{ 고객명:'김민수', 등급:'VIP' }`) — `%변수%` 치환용
  - `sampleCustomerFields` = 영문 키 객체 (예 `{ name:'김민수', grade:'VIP' }`) — `{{ Liquid }}` 렌더용
  - 여정 문안은 스크린샷상 `{{ customer.name | default:'고객' }}` 형식(Liquid, 영문 키) → **sampleCustomerFields가 핵심.**

### 2-2. Liquid 렌더 — `packages/frontend/src/utils/liquid-templating.ts`
- export: `renderLiquid`, `detectLiquidSyntax`, `flattenCustomerForLiquid`, `SAMPLE_CUSTOMERS`.
- ⚠️ **확인 필요:** `SAMPLE_CUSTOMERS`의 정확한 shape(배열? 키가 한국어/영문 어느 쪽?)는 이 세션에서 끝까지 안 봤다. **다음 세션이 이 파일을 직접 읽어 확정할 것.** (정적 샘플이라 토글 미리보기의 fallback으로 가장 간단·안전.)

### 2-3. 실제 사용 패턴 참조 — `packages/frontend/src/pages/JourneysPage.tsx`
- 샘플 고객 fetch: `POST /api/ai/operator/sample-customer { triggerEvent, triggerFilters }` → `{ sampleCustomer, sampleCustomerFields }` (705~723행).
- 원본 표시: `highlightVars(s.messageTemplate, 'dark')` (2373행).
- 치환 표시: `mergeAndHighlightVars(preview, sampleCustomer, 'dark', sampleCustomerFields)` (2426~2427행).
- **편집 모달은 journey의 trigger를 바로 모를 수 있음** → 두 선택지 중 택1:
  - (A·권장·간단) `SAMPLE_CUSTOMERS` 정적 샘플 사용 — 외부 fetch 없음.
  - (B) load 시 받은 journey 객체에 trigger_event/trigger_filters가 있으면 위 sample-customer endpoint로 fetch. ⚠️ journey 상세 응답에 그 필드가 오는지 GET /journeys/:id 응답으로 **확인 후** 결정.

---

## 3. 대상 파일 현재 상태 — `packages/frontend/src/components/journey/JourneyMessageEditModal.tsx` (255행, 전면 재작성 대상)

이 세션에서 전체 정독함. 정확한 구조:
- props: `journeyId, journeyName, journeyStatus, token, onClose, onSaved`
- 이미 **다크톤 + violet + useToast** (native dialog 0). 헤더(PenLine 아이콘 + 그라데이션) 있음.
- `load()` (56행): `GET /api/ai/operator/journeys/:id` → `data.steps` 중 `step_type==='message'`만 필터 → `{ id, stepOrder, channel, messageTemplate, subject }` 매핑.
- `patchStep(id, patch)` (88행): step 로컬 수정.
- `changed` (91행): initial 대비 바뀐 step만.
- `handleSave()` (95행): changed 각 step을 `PATCH /api/ai/operator/journeys/:id/steps/:stepId { messageTemplate, subject }`로 저장. **검증: 본문 trim 10자+ / LMS·MMS는 subject 필수.**
- 현재 본문 = `<textarea rows={4}>` (214행) — **이게 작아서 답답하다는 그 부분.**
- 렌더: `return ( <div fixed inset-0 ...> <div max-w-2xl ...> ... )` — **max-w-2xl가 작은 모달 원인.**

### 깨면 안 되는 것 (백엔드 무수정)
- 저장 endpoint(PATCH steps {messageTemplate, subject})와 검증 규칙(10자+/제목 필수)은 **그대로 유지.**
- `changed`(바뀐 step만 저장), ESC 닫기, saving 중 닫기 차단 유지.

---

## 4. 설계 (이대로 구현 — 예시 클래스는 참고, 톤만 지키면 조정 가능)

### 4-1. 전체화면 + 가로 스텝
- 컨테이너: `max-w-2xl` → 거의 전체화면. 예: 바깥 `fixed inset-0 ... p-3`, 안쪽 `w-full max-w-[96vw] max-h-[94vh]` (또는 `inset-4`).
- 본문 영역: 현재 `space-y-4`(세로) → **`flex gap-4 overflow-x-auto`(가로)**.
- 각 step = 고정폭 컬럼: 예 `w-[360px] shrink-0 flex flex-col`. 컬럼 내부: 헤더(Step N 배지 + 채널 배지) → 제목(LMS/MMS만) → 본문. **본문 textarea를 `flex-1`로 컬럼 높이 가득** 채워 크게.
- 컬럼 4개+ 면 자연히 우측 스크롤. 다크톤(bg-slate-900 + border-white/10 + violet) 유지.

### 4-2. 원본 ↔ 치환 미리보기 토글
- 헤더에 토글 (state 예: `const [viewMode, setViewMode] = useState<'edit'|'preview'>('edit')`).
- `edit`: 각 컬럼 본문 = `<textarea>` (수정 가능).
- `preview`: 각 컬럼 본문 = `<div className="whitespace-pre-wrap">{mergeAndHighlightVars(s.messageTemplate, sampleCustomer, 'dark', sampleCustomerFields)}</div>` (읽기전용, **값 없는 변수 자동 취소선**). 제목도 동일 적용 권장.
- sampleCustomer/sampleCustomerFields = 2-3절 방식으로 확보(권장: SAMPLE_CUSTOMERS 정적).

### 4-3. 빈 변수 경고
- 각 step 본문에서 Liquid 변수 추출: 정규식 `/\{\{([^}]+)\}\}/g`.
- 각 매치 내부 문자열에 `default:`(공백 무관 `|\s*default\s*:`)가 **없으면** 경고 대상.
- 컬럼 상단(또는 본문 아래)에 경고 배지: 예 "⚠️ 값이 없으면 줄이 빕니다 — `{{ customer.grade }}` 같은 변수에 `| default: '...'` 추가 권장". default 있는 변수는 경고 제외.
- (참고) `%변수%`는 보통 한국어 키이고 default 개념이 약함 → 치환 미리보기의 취소선으로 충분. Liquid `{{ }}` default 누락만 경고해도 Harold 요구 충족.

### 4-4. 디자인 퀄리티 (필수)
- 다크톤 + violet 액센트, sticky 헤더(이미 있음), Source caption 유지, 모바일 반응형(가로 스크롤이라 자연 충족), ConfirmModal/useToast(native dialog 0).

---

## 5. 이번 세션(2026-06-03) 다른 미완·주의 — 다음 세션 반드시 인지

### 5-1. ★ 여정 활성화 버그 체인 (코드 fix 완료, tsc 0 / 배포 반영 검증 필수)
순서대로 드러난 버그(503이 앞을 막아 다음이 안 보였음). 전부 **코드+SCHEMA/실DB로 확정 후** 고침:
1. **503 컬럼**: `journey-pretest-validator.ts` `s.callback_number`→`j.callback_number`(callback_number는 journeys 컬럼), `message_body`→`message_template`(journey_step_variants 본문 컬럼). 같은 버그 `journey-builder.ts createJourneyStepSnapshots`도 정정.
2. **발송 치환 빈값**: `journey-executor.ts` 발송용 customer SELECT(thin) → `SELECT *` (등급·지역 등 변수가 빈 값으로 나가던 문제).
3. **$3 저장(42P08)**: `journey-builder.ts updateJourneyStep` UPDATE에 안 쓰던 `$3`(companyId) → WHERE에 `AND EXISTS (SELECT 1 FROM journeys j WHERE j.id=$2::uuid AND j.company_id=$3::uuid)`로 사용.
4. **user_id FK**: `journey-pretest-validator.validateJourneyForActivation`이 enqueueSpamTest에 zero UUID(`00000000-...`) 넘겨 spam_filter_tests.user_id(users FK) 위반 → endpoint의 `req.user?.userId`를 받아 넘기게 함(ai.ts pretest-validate + 함수 시그니처 userId 추가).
5. **batchId UUID**: 같은 함수가 batchId를 `jpt_<시각>_<랜덤>` 문자열로 만들어 spam_filter_tests.batch_id(uuid)에 넣어 "invalid input syntax for type uuid" → `randomUUID()`로 변경(crypto import 추가).

### 5-2. ★ 진단용 임시 코드 (복구 필요)
- `spam-test-queue.ts:226` catch가 진단 목적으로 raw 에러를 UI/응답에 노출 중(`스팸 테스트 큐 등록 오류: ${err.message}` + console.log). 여정 활성화가 정상 통과하는 것 확인되면 **친화 메시지로 복구**(사용자에게 raw DB 에러 노출 X).

### 5-3. native 모달 sweep (앱 전역) — 6/16 완료
- 완료: FileUploadMappingModal, CustomerDBModal, AiBatchesPage, PricingPage, AlarmUserManager, AlimtalkSendersSection (전부 tsc 0).
- **남은 10개**: AlimtalkManagementSection, BrandTemplateManagementSection, AiOperatorPage, PushCampaignsPage, VoiceInboundPage, CalendarModal, LoginBlocksManagement, BalanceModals, AddressBookModal, AdminDashboard.
- 패턴: `alert()` → `useToast()`(error/warning/success) / `confirm()` → 공용 `ConfirmModal`(import `ConfirmModal, { type ConfirmState }`, state `useState<ConfirmState|null>`, confirm 이후 로직을 `onConfirm` 콜백으로 이동, JSX에 `<ConfirmModal state onClose>` 추가). JourneysPage·AlarmUserManager·AlimtalkSendersSection가 완성 예시.
- import 경로: components 내부 = `./ToastProvider`·`./ConfirmModal` / components/하위폴더 = `../ToastProvider`·`../ConfirmModal` / pages = `../components/...`. 파일별 tsc로 검증.
- AdminDashboard·BalanceModals·AddressBookModal은 양 많음 → 파일당 끊어서.

### 5-4. 스팸필터 테스트 = 실제 발송 (사실)
- `executeSpamTest`(spam-test-queue.ts:302)가 **QTmsg로 실제 발송 + 테스트폰 3대(SKT/KT/LGU+) 수신 확인**. 통신사 성공인데 앱 미수신 = 차단 판정. **AI 추측 아님.**
- 부작용: 검증 때마다 실제 SMS 발송 + 잔액 차감(skipPrepaid=false), step당 폴링 수~수십 초. step 많은 여정은 **nginx 타임아웃(`<html>` 에러) 위험** → 필요시 활성화 검증을 비차단/폴링단축으로 바꾸는 안을 Harold와 결정.

### 5-5. 여정 활성화 150 크레딧 (사실 — 정상 구현)
- `ai.ts` activate endpoint(2537·2545행): 최초 활성화(draft→active)만 150 차감, 멱등키 `journey-activate:${journeyId}`, 재개는 0. cost = `ai-credit-calc.ts:94 'journey-activate':150`.
- 모달 안내: `JourneyActivationConfirmModal.tsx:344` (검증 통과 'ready' 화면에서만 표시).

---

## 6. 배포 (이번 세션 누적분 — 미배포 가능성/검증 필수)

```
# 로컬 (C:\Users\ceo\projects\targetup) — push 먼저!
tp-push "여정 활성화 체인 fix + 스팸 enqueue + native 모달 6 + (문안모달 개편)"
git log --oneline -1            # 새 커밋 해시 메모

# 서버
cd /home/administrator/targetup-app && git pull
git log --oneline -1            # 로컬 해시와 같아야 함
cd packages/backend && npm run build:safe && pm2 restart all
cd ../frontend && npm run build:safe
# 반영 검증 (예시): grep -c randomUUID dist/utils/journey-pretest-validator.js  → 1+
```
- 변경 파일: **backend** = ai.ts, journey-pretest-validator.ts, journey-builder.ts, journey-executor.ts, spam-test-queue.ts / **frontend** = JourneysPage.tsx + native 모달 6개 (+ 다음 세션 문안모달).
- ⚠️ 이번 세션 교훈: tp-push가 "no changes / Everything up-to-date"로 나오면 변경이 push에 안 실린 것 → 그 출력 확보. dist grep이 0이면 빌드/푸시 미반영. **항상 dist로 최종 확인.**

---

## 7. 작업 순서 권장 (다음 세션)
1. (선행) 위 5-1 fix들이 서버에 실제 반영됐는지 dist grep으로 확인 → 여정 활성화가 끝까지 도는지 Harold 테스트.
2. 본 문안 수정 모달 개편(1~4절) 구현 → tsc 0 + native dialog grep 0 → 배포.
3. 여유 시 5-3 native 모달 남은 10개 + 5-2 임시 catch 복구.
