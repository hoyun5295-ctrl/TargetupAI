# 자동마케팅(Continuous Operator) 자율 발송 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (Harold 배포 사이에 검토). 각 단계 `- [ ]` 체크박스.

**Goal:** 자동마케팅 자동실행이 크레딧만 차감하고 실발송이 없던 결함을 없애고, 매달 계절 문안을 AI가 생성→안전필터 추출→스팸 테스트→담당자 정지창→T 자율 발송하는 한 사이클을 완성한다.

**Architecture:** 직접발송 파이프라인(campaign+staging+청크 워커)을 백엔드 함수 `sendCampaignDirect`로 추출해 재사용. 워커 2단계 — T−lead 준비(생성·스팸·담당자 테스트/알림·scheduled) + T 발송(추출·staging·sendCampaignDirect·크레딧 멱등·통지). 안전필터·계절 소스는 기존 CT 재사용/추출.

**Tech Stack:** Node/Express + TypeScript(ts-node 실행), PostgreSQL. 순수 테스트 = `src/**/__tests__/*.verify.ts` + `node:assert`, 실행 `npx ts-node <path>`.

---

## 확정 설계 결정 (세션8)

- **타이밍** — 운영자가 schedule_time(=T)을 설정 → `continuous_operators.next_run_at`=T. 워커 준비 패스는 `next_run_at − lead ≤ NOW`일 때 발화(준비 후 next_run_at를 다음 사이클로 전진 → 재준비 차단). 발송 패스는 `operator_proposals.scheduled_send_at ≤ NOW AND status='scheduled'`일 때 발화.
- **lead(준비·정지 창)** — `continuous_operators.auto_send_lead_minutes`(신규, nullable, null→120). opt_out_minutes(기본 5)는 의미 충돌이라 재사용 안 함.
- **상태기계** — pending(수동 검토) / scheduled(자율 준비됨, T 대기) / sent(발송 완료) / admin_stopped(정지) / admin_review(스팸 미통과) / rejected·expired·approved(기존). 'auto_executed'는 옛 값 — 신규 생성 X, 기존 행 호환 위해 타입에만 유지.
- **재추출은 발송 시점(T)** — 준비 때 recipientCount는 추정. 실제 발송은 T에 filters로 다시 추출(2시간 새 수신거부 반영). 안전필터 적용.
- **크레딧 2갈래** — ① 기능 크레딧 `continuous-operator-send`(3, 멱등키 proposalId): 발송 성공 시점 1회(생성 시점 차감 제거). ② 실 SMS 발송비 `prepaidDeduct`: sendCampaignDirect 내부(직접발송과 동일).
- **계절 소스** — `utils/season-context.ts` 신규 CT. journey-ai-generator.ts는 이번에 건드리지 않음(여정 배포분 보호) → SEASON 데이터 일시 중복, 추후 journey-ai-generator를 CT로 이관(태스크 칩으로 분리). objective=불변, 계절=톤·소재로 프롬프트 주입.
- **0건/예산** — 준비·발송 시점 0건 → 이번 사이클 스킵 + 담당자 알림(정지 X). 잔액/예산 부족 → 스킵 + 알림.
- **compliance fail-open 정정** — 검수 AI 에러 시 passed=false(자동발송 비자격). 수동 검토 경로는 영향 없음.
- **검증(verification 7일) 제거** — Q9: 컬럼 보존 + 미사용. isAutoSendAllowed/incrementVerificationDays 호출 제거.
- **알림 발송** — 담당자 테스트/알림/완료통지 = 무과금 인증 라인(getAuthSmsTable + bulkInsertSmsQueue), 기존 notifyOperatorAdmins 패턴 재사용·확장.

---

## 파일 구조

| 파일 | 역할 | 신규/수정 |
|---|---|---|
| `utils/season-context.ts` | SEASON_BY_MONTH + getSeasonContext + buildSeasonPromptBlock (순수) | 신규 |
| `utils/operator-recipients.ts` | extractSendableRecipients(filters→customers, buildJourneySafetyFilter 적용) | 신규 |
| `utils/direct-send-core.ts` | sendCampaignDirect(spec) + stageRecipients + countStagingFiltered(이전) | 신규 |
| `utils/continuous-operator-autosend.ts` | 준비/발송 2단계 + 순수 helper(lead·scheduled·결정) | 신규 |
| `services/ai.ts` | countFilteredCustomers → buildJourneySafetyFilter | 수정 |
| `routes/ai.ts` | preview-recipients → extractSendableRecipients / listProposals status 화이트리스트 | 수정 |
| `routes/campaigns.ts` | /direct-send/commit → sendCampaignDirect 위임, countStagingFiltered import | 수정 |
| `utils/continuous-operator.ts` | 준비 단계 정정(scheduled·검증제거·테스트알림) + 워커 2단계 + 계절 주입 + updated_at 버그 | 수정 |
| `utils/continuous-operator-policy.ts` | 죽은 스팸코드 제거 + 검증 helper 제거 | 수정 |
| `services/ai-orchestrator.ts` | compliance catch passed=false | 수정 |
| `frontend ContinuousOperatorPage.tsx` | 발송시각·자율모드·정지이력·결과 | 수정 |

각 `.verify.ts`는 `src/utils/__tests__/`에 둔다.

---

## Task 0: ALTER (Harold 실행) + db_alter_safety_net

**Files:** DB 마이그레이션 (Harold) + 코드 catch 가드(각 endpoint/worker).

- [ ] **Step 1: Harold에게 ALTER SQL 제공 (information_schema 재확인 후)**

```sql
-- operator_proposals: 자율 발송 예정 시각
ALTER TABLE operator_proposals ADD COLUMN IF NOT EXISTS scheduled_send_at timestamptz;
-- continuous_operators: 준비·정지 창(분), null→120
ALTER TABLE continuous_operators ADD COLUMN IF NOT EXISTS auto_send_lead_minutes integer;
```

- [ ] **Step 2: 코드 catch 가드** — scheduled_send_at/auto_send_lead_minutes를 쓰는 워커·endpoint catch에 `column ... does not exist` → 503 DB_MIGRATION_PENDING(워커는 로그+스킵). (Task 5·6에서 각 위치 반영.)

> ALTER는 Harold가 실행. 코드는 컬럼 부재 시 503/스킵으로 안전.

---

## Task 1: season-context CT (순수 TDD)

**Files:**
- Create: `packages/backend/src/utils/season-context.ts`
- Test: `packages/backend/src/utils/__tests__/season-context.verify.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// season-context.verify.ts
// 실행: npx ts-node packages/backend/src/utils/__tests__/season-context.verify.ts
import assert from 'node:assert';
import { SEASON_BY_MONTH, getSeasonContext, buildSeasonPromptBlock } from '../season-context';

let passed = 0;
function ok(n: string, f: () => void) { f(); passed++; console.log(`  ok - ${n}`); }

ok('12개월 전부 정의', () => { for (let m = 1; m <= 12; m++) assert.ok(SEASON_BY_MONTH[m]?.season && Array.isArray(SEASON_BY_MONTH[m].keywords)); });
ok('5월=가정의달 키워드', () => assert.ok(SEASON_BY_MONTH[5].keywords.some(k => k.includes('가정') || k.includes('어버이'))));
ok('getSeasonContext(2026-09-15 KST)=9월/추석', () => {
  const c = getSeasonContext(new Date('2026-09-15T03:00:00Z')); // KST 12:00
  assert.strictEqual(c.month, 9);
  assert.ok(c.keywords.some(k => k.includes('추석') || k.includes('한가위')));
});
ok('buildSeasonPromptBlock 업종 반영', () => {
  const b = buildSeasonPromptBlock(12, '카페');
  assert.ok(b.includes('12월') && b.includes('카페'));
});
ok('buildSeasonPromptBlock 업종 미지정 안전', () => {
  const b = buildSeasonPromptBlock(3, null);
  assert.ok(b.includes('3월') && !b.includes('null'));
});

console.log(`\n${passed} assertions passed`);
```

- [ ] **Step 2: 실패 확인** — `npx ts-node packages/backend/src/utils/__tests__/season-context.verify.ts` → "Cannot find module '../season-context'".

- [ ] **Step 3: 구현**

```ts
// season-context.ts
// 월별 한국 시즌 달력 + 업종 톤. (journey-ai-generator의 동일 표를 추후 이 CT로 이관 예정 — tech debt.)
export const SEASON_BY_MONTH: Record<number, { season: string; keywords: string[] }> = {
  1:  { season: '겨울', keywords: ['새해', '새출발', '신년 계획', '추위', '연말정산'] },
  2:  { season: '겨울 끝', keywords: ['설날', '발렌타인데이', '입학 준비', '봄맞이'] },
  3:  { season: '봄', keywords: ['새 학기', '봄꽃', '환절기', '새로운 시작', '화이트데이'] },
  4:  { season: '봄', keywords: ['벚꽃', '봄나들이', '식목일', '야외활동'] },
  5:  { season: '봄 끝', keywords: ['가정의달', '어린이날', '어버이날', '스승의날', '부부의날'] },
  6:  { season: '초여름', keywords: ['호국보훈의달', '현충일', '여름맞이', '장마 준비'] },
  7:  { season: '여름', keywords: ['장마', '바캉스', '휴가', '제헌절'] },
  8:  { season: '여름', keywords: ['휴가 절정', '광복절', '여름 마무리', '개학 준비'] },
  9:  { season: '가을', keywords: ['추석', '한가위', '환절기', '가을맞이'] },
  10: { season: '가을', keywords: ['단풍', '국군의날', '개천절', '한글날'] },
  11: { season: '늦가을', keywords: ['빼빼로데이', '수능', '김장', '겨울맞이'] },
  12: { season: '겨울', keywords: ['크리스마스', '연말', '송년', '새해 준비'] },
};

export function getSeasonContext(now: Date): { month: number; season: string; keywords: string[] } {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const month = kst.getUTCMonth() + 1;
  const ctx = SEASON_BY_MONTH[month] || { season: '계절', keywords: [] };
  return { month, season: ctx.season, keywords: ctx.keywords };
}

export function buildSeasonPromptBlock(month: number, businessType: string | null): string {
  const ctx = SEASON_BY_MONTH[month] || { season: '계절', keywords: [] };
  const biz = businessType && businessType.trim() ? businessType.trim() : '일반';
  return [
    `[이번 달 계절 컨텍스트 — KST]`,
    `- 현재 ${month}월 (${ctx.season})`,
    `- 시즌 키워드: ${ctx.keywords.join(', ')}`,
    `- 업종(${biz})에 맞는 톤으로 위 시즌 감성을 자연스럽게 녹이세요. 목표 자체는 바꾸지 마세요.`,
  ].join('\n');
}
```

- [ ] **Step 4: 통과 확인** — 위 명령 재실행 → "N assertions passed".

- [ ] **Step 5: 박-단어/금지어 grep** — `npx`로 통과 후, 작성 파일 grep 0건 확인.

- [ ] **Step 6: 커밋(Harold)** — 표준 종료 멘트.

---

## Task 2: 안전필터 통일 (countFilteredCustomers + preview-recipients + 추출 CT)

**Files:**
- Create: `utils/operator-recipients.ts` + `__tests__/operator-recipients.verify.ts`
- Modify: `services/ai.ts:2268-2304`(countFilteredCustomers), `routes/ai.ts:1227-1242`(preview-recipients)

설계: 추출/카운트 모두 `buildJourneySafetyFilter('c')`(기존 CT, import만) 사용. 인라인 안전필터 금지.

- [ ] **Step 1: operator-recipients 순수 테스트(SQL 조각 합성 검증)**

```ts
// operator-recipients.verify.ts
import assert from 'node:assert';
import { buildSendableRecipientsSql } from '../operator-recipients';

let passed = 0;
function ok(n: string, f: () => void) { f(); passed++; console.log(`  ok - ${n}`); }

ok('안전필터 4종 포함', () => {
  const { sql } = buildSendableRecipientsSql({ grade: { op: 'eq', value: 'VIP' } }, [/*companyId*/ 'CID'], '');
  assert.ok(/c\.is_active\s*=\s*true/.test(sql));
  assert.ok(/c\.is_opt_out\s+IS\s+NOT\s+TRUE/.test(sql));
  assert.ok(/c\.is_invalid\s+IS\s+NOT\s+TRUE/.test(sql));
  assert.ok(/unsubscribes\s+u[\s\S]*u\.company_id\s*=\s*c\.company_id/.test(sql));
});
ok('storeFilter 합성', () => {
  const { sql } = buildSendableRecipientsSql({}, ['CID'], ' AND c.id IN (1)');
  assert.ok(sql.includes('AND c.id IN (1)'));
});

console.log(`\n${passed} assertions passed`);
```

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: operator-recipients 구현** — buildFilterWhereClauseCompat(CT-01) + buildJourneySafetyFilter 합성. (alias `c` 통일.)

```ts
// operator-recipients.ts
import { query } from '../config/database';
import { buildFilterWhereClauseCompat } from './filterUtils'; // ← 실제 export 위치 확인 후 import (services/ai.ts·routes/ai.ts가 쓰는 동일 CT)
import { buildJourneySafetyFilter } from './journey-safety-filter';

export function buildSendableRecipientsSql(
  filters: Record<string, any>,
  baseParams: any[],     // [companyId, ...storeScope]
  storeFilter: string,   // ' AND c.id IN (...)' 또는 ''
): { sql: string; params: any[] } {
  const { sql: filterWhere, params: filterParams } = buildFilterWhereClauseCompat(filters, baseParams.length + 1);
  const sql =
    `SELECT c.id, c.phone, c.name, c.gender, c.region, c.birth_date, c.age, c.grade, c.custom_fields
     FROM customers c
     WHERE c.company_id = $1
       AND ${buildJourneySafetyFilter('c')}
       ${storeFilter}
       ${filterWhere}
     LIMIT 10000`;
  return { sql, params: [...baseParams, ...filterParams] };
}

export async function extractSendableRecipients(
  filters: Record<string, any>, baseParams: any[], storeFilter: string,
): Promise<any[]> {
  const { sql, params } = buildSendableRecipientsSql(filters, baseParams, storeFilter);
  const r = await query(sql, params);
  return r.rows;
}
```
> filterWhere가 alias 없는 컬럼(`id IN ...`)을 쓰면 customers 단일 테이블이라 모호성 없음. storeFilter는 호출부에서 `c.` alias로 맞춘다(preview-recipients 기존 `id IN` → `c.id IN`).

- [ ] **Step 4: 통과 확인**

- [ ] **Step 5: countFilteredCustomers 수정(services/ai.ts:2280-2293)** — main count의 `c.is_active=true AND c.sms_opt_in=true ... NOT EXISTS(... user_id ...)`를 `${buildJourneySafetyFilter('c')}`로 교체. unsubscribeCount 2번째 쿼리는 호출부 사용 여부 grep 후: 미사용이면 `unsubscribeCount: 0`로 단순화, 사용이면 base(안전필터의 비-unsub 부분)+`EXISTS unsub(company,phone)`로 재작성. import 추가.

- [ ] **Step 6: preview-recipients 수정(routes/ai.ts:1231-1242)** — 인라인 SQL을 `extractSendableRecipients(filters, baseParams, storeFilter)`로 교체. storeFilter의 `id IN`을 `c.id IN`으로 맞춤(`customer_id ... company_id=$1`). recipients 빌드 로직 유지.

- [ ] **Step 7: tsc 0 + 박-단어 grep 0 + 커밋(Harold)**

---

## Task 3: sendCampaignDirect 추출 (직접발송 함수화)

**Files:**
- Create: `utils/direct-send-core.ts`
- Modify: `routes/campaigns.ts` (/direct-send/commit → 위임, countStagingFiltered import)

설계: /direct-send/commit 본문(라인그룹·검증·countStagingFiltered·campaigns INSERT·prepaidDeduct·triggerDirectSendWorker)을 `sendCampaignDirect(spec, ctx)`로 동작 보존 이동. HTTP는 req.body→spec 매핑 후 호출, 결과/throw를 res로 매핑. countStagingFiltered도 core로 이동(commit·count·worker 동일 기준 유지).

- [ ] **Step 1: 순수 테스트(spec 검증·에러 타입)**

```ts
// direct-send-core.verify.ts
import assert from 'node:assert';
import { validateDirectSendSpec, DirectSendError } from '../direct-send-core';

let passed = 0;
function ok(n: string, f: () => void) { f(); passed++; console.log(`  ok - ${n}`); }

ok('LMS 제목 누락 → 에러', () => {
  assert.throws(() => validateDirectSendSpec({ msgType: 'LMS', subject: '', callback: '01012345678', useIndividualCallback: false } as any),
    (e: any) => e instanceof DirectSendError && e.code === 'SUBJECT_REQUIRED');
});
ok('회신번호 누락 → 에러', () => {
  assert.throws(() => validateDirectSendSpec({ msgType: 'SMS', callback: '', useIndividualCallback: false } as any),
    (e: any) => e instanceof DirectSendError && e.code === 'CALLBACK_REQUIRED');
});
ok('정상 SMS → 통과', () => {
  assert.doesNotThrow(() => validateDirectSendSpec({ msgType: 'SMS', callback: '01012345678', useIndividualCallback: false } as any));
});

console.log(`\n${passed} assertions passed`);
```

- [ ] **Step 2: 실패 확인**

- [ ] **Step 3: direct-send-core 구현** — `DirectSendError(code)` + `validateDirectSendSpec(spec)`(순수: 제목/회신번호 형식 등 DB 불요 검증) + `countStagingFiltered`(campaigns.ts에서 이동) + `sendCampaignDirect(spec, ctx)`(라인그룹·발신번호 등록 검증·count·INSERT·prepaidDeduct·trigger; campaigns.ts:1338-1446 로직 그대로). 알림톡/카카오 분기는 spec.sendChannel로 유지(자율발송 v1은 sms/lms만 전달).

```ts
// direct-send-core.ts (요지 — campaigns.ts commit 본문 이동, 동작 보존)
export class DirectSendError extends Error {
  constructor(public code: string, message: string, public httpStatus = 400, public extra?: any) { super(message); }
}
export interface DirectSendSpec {
  stagingId: string; msgType: string; subject?: string|null; message?: string|null;
  callback?: string|null; sendChannel?: string; adEnabled?: boolean;
  scheduled?: boolean; scheduledAt?: string|null; splitEnabled?: boolean; splitCount?: number;
  useIndividualCallback?: boolean; individualCallbackColumn?: string|null; mmsImagePaths?: string[]|null;
  dedupEnabled?: boolean; unsubFilterEnabled?: boolean; campaignName?: string;
  /* alimtalk/kakao 필드는 기존 commit과 동일하게 옵션 전달 */
  [k: string]: any;
}
export function validateDirectSendSpec(spec: DirectSendSpec): void { /* 제목/회신번호 형식 순수 검증 — campaigns.ts:1364-1372 발췌 */ }
export async function sendCampaignDirect(spec: DirectSendSpec, ctx: { companyId: string; userId: string }):
  Promise<{ campaignId: string; accepted: number }> { /* campaigns.ts:1338-1446 이동: 라인그룹·발신번호 DB검증·countStagingFiltered·campaigns INSERT·prepaidDeduct·triggerDirectSendWorker. 실패는 DirectSendError throw */ }
```

- [ ] **Step 4: 통과 확인**

- [ ] **Step 5: /direct-send/commit를 위임으로 교체** — req.body→spec, `await sendCampaignDirect(spec, {companyId, userId})`, 결과 202 / DirectSendError→해당 status. countStagingFiltered import(또는 core 재export). /direct-send/count도 core의 countStagingFiltered 사용.

- [ ] **Step 6: 회귀 — tsc 0 + 기존 직접발송 흐름(모달 count→commit→worker) 동작 보존 확인(Harold 운영 검증).** 박-단어 grep 0. 커밋(Harold).

> ★ 톤28 504 경로라 동작 보존이 최우선. 로직은 이동만(변경 X), 검증 분기·즉시 202·청크 워커 트리거 동일.

---

## Task 4: 준비 단계 — generateProposalForOperator 정정 (continuous-operator.ts)

**Files:** Modify `utils/continuous-operator.ts:293-604` + `utils/continuous-operator-autosend.ts`(순수 helper).

변경점:
1. auto-eligible 통과 시: status='scheduled', `scheduled_send_at`=T(=현재 operator.next_run_at), `admin_notified_at`=NOW. (옛 'auto_executed'·생성시점 send 크레딧 차감 제거.)
2. 검증 게이팅(isAutoSendAllowed, line 571-584) 제거.
3. 스팸 미통과 → admin_review(유지). 0건/예산초과 → 스킵+알림(Task 6).
4. 담당자 **테스트발송(실문안 1건)** + **정지 안내 1건**(Task 6의 notify 확장).
5. updated_at 버그 — operator_proposals UPDATE(line 550 등)에서 `updated_at = NOW()` 제거(컬럼 없음).
6. 계절 주입(Task 8).

- [ ] **Step 1: 순수 helper 테스트**

```ts
// continuous-operator-autosend.verify.ts
import assert from 'node:assert';
import { resolveAutoSendLeadMinutes, computeScheduledSendAt, decideSendOutcome } from '../continuous-operator-autosend';

let passed = 0;
function ok(n: string, f: () => void) { f(); passed++; console.log(`  ok - ${n}`); }

ok('lead 기본 120', () => assert.strictEqual(resolveAutoSendLeadMinutes(null), 120));
ok('lead 음수/0 방어 → 120', () => { assert.strictEqual(resolveAutoSendLeadMinutes(0), 120); assert.strictEqual(resolveAutoSendLeadMinutes(-5), 120); });
ok('lead 설정값 클램프(최대 1440)', () => { assert.strictEqual(resolveAutoSendLeadMinutes(30), 30); assert.strictEqual(resolveAutoSendLeadMinutes(99999), 1440); });
ok('scheduledSendAt = T(operator next_run_at 그대로)', () => {
  const T = new Date('2026-12-01T01:00:00Z');
  assert.strictEqual(computeScheduledSendAt(T).getTime(), T.getTime());
});
ok('0건 → skip', () => assert.strictEqual(decideSendOutcome({ recipientCount: 0, balanceOk: true }).action, 'skip'));
ok('잔액부족 → skip+notify', () => { const o = decideSendOutcome({ recipientCount: 10, balanceOk: false }); assert.strictEqual(o.action, 'skip'); assert.ok(o.notify); });
ok('정상 → send', () => assert.strictEqual(decideSendOutcome({ recipientCount: 10, balanceOk: true }).action, 'send'));

console.log(`\n${passed} assertions passed`);
```

- [ ] **Step 2: 실패 확인 → Step 3: helper 구현(resolveAutoSendLeadMinutes clampInt 0<n≤1440 else 120 / computeScheduledSendAt(T)=T / decideSendOutcome) → Step 4: 통과 확인.**

- [ ] **Step 5: generateProposalForOperator 정정** — auto-eligible 분기 INSERT를 status='scheduled' + scheduled_send_at=$ + admin_notified_at=NOW로(컬럼 부재 503 가드). line 571-584 검증 블록 제거. line 591-601 send 크레딧 차감 제거. line 550 updated_at 제거. import autosend helper.

- [ ] **Step 6: tsc 0 + 박-단어 grep 0 + 커밋(Harold).**

---

## Task 5: 발송 단계 + 워커 2단계 (continuous-operator-autosend.ts + continuous-operator.ts)

**Files:** `utils/continuous-operator-autosend.ts`(runAutoSendPass) + `utils/continuous-operator.ts`(runOperatorWorker 2단계).

- [ ] **Step 1: runAutoSendPass 구현** — `SELECT p.*, o.* FROM operator_proposals p JOIN continuous_operators o ON o.id=p.operator_id WHERE p.status='scheduled' AND p.scheduled_send_at <= NOW() LIMIT N`. 각 건:
  1. proposalJson.target.filters → extractSendableRecipients(filters, [companyId], '') → rows.
  2. decideSendOutcome(recipientCount, balanceOk). 0건/skip → 알림 + status 처리(아래) + continue.
  3. stageRecipients(stagingId, companyId, rows.map({phone,name,extra1~3,callback})).
  4. spec 구성(proposalJson.messages[0].body/subject, channel, callback=회사 default 또는 reject_number) → `sendCampaignDirect(spec, {companyId, userId: operator.createdBy})`.
  5. 성공 → deductCreditSafe(continuous-operator-send, 멱등키 proposalId) + markProposalExecuted(proposalId, campaignId) + UPDATE status='sent', auto_sent_at=NOW.
  6. notifyOperatorAdmins("발송 완료", "N명 발송 완료").
  7. DirectSendError(잔액 등) → 스킵 처리 + 알림(status='admin_review' 또는 're-pending', Task 6에서 확정).
  - 멱등: status='scheduled' → 'sending' claim UPDATE(RETURNING)로 동시 진입 차단(직접발송 worker claim 패턴).

- [ ] **Step 2: runOperatorWorker 2단계화** — 기존 준비 패스(due operators) + **신규 발송 패스(runAutoSendPass)** 둘 다 호출. 준비 패스 due 쿼리에 lead 반영: `next_run_at - (COALESCE(auto_send_lead_minutes,120)||' minutes')::interval <= NOW()`. 준비 후 updateOperatorAfterRun가 next_run_at 다음 사이클 전진(재준비 차단).

- [ ] **Step 3: tsc 0 + 박-단어 grep 0 + 커밋(Harold). 운영 검증(Harold).**

---

## Task 6: 스팸 실패 정지 / 0건·예산 스킵 / 담당자 테스트·알림 확장

**Files:** `utils/continuous-operator.ts` + `utils/continuous-operator-autosend.ts`.

- [ ] **Step 1: 스팸 2회 후 실패 → 운영자 정지 + 사유 알림** — decideSpamOutcome admin_review 분기에서 추가로 `UPDATE continuous_operators SET status='paused'`(Q: 운영자 정지) + notifyOperatorAdmins("자동마케팅 정지", 사유). (기존은 제안서만 admin_review.) — ※ Harold 확정: 스팸 끝내 실패 시 operator 정지.

- [ ] **Step 2: 0건/예산 → 스킵 + 알림** — 준비/발송 시점 0건·잔액부족 → notifyOperatorAdmins + 이번 사이클 종료(operator status 유지, next_run_at만 다음 주기). proposal은 status='expired'(또는 미생성).

- [ ] **Step 3: 담당자 테스트발송(실문안 1건) + 정지 안내 1건** — 준비 통과 시: ① 실문안을 담당자 폰으로 1건 인증라인 발송(buildAdMessage/buildAdSubject로 (광고)·080 합성 = 실발송과 동일 본문, LESSONS_BACKEND D230+ 사고 차단) ② 정지 안내 1건(정지 링크/메뉴 안내). notifyOperatorAdmins 확장 또는 신규 sendAdminTestMessage.

- [ ] **Step 4: tsc 0 + 박-단어 grep 0 + 커밋(Harold).**

> 테스트발송 본문은 실발송 경로와 동일 CT(prepareSendMessage/buildAdMessage/buildAdSubject) 사용 — 검증·테스트·실발송 본문 일치(D230+ 사고 차단).

---

## Task 7: 죽은 코드 제거 + compliance fail-open 정정

**Files:** `utils/continuous-operator-policy.ts`, `services/ai-orchestrator.ts`, `utils/continuous-operator.ts`.

- [ ] **Step 1: 죽은 스팸 코드 제거** — policy.ts의 spamTestWithRetry / estimateSpamScore / detectSpamWords / simpleSpamWordRemoval / SPAM_WORDS / SpamTestResult 제거. import·참조 grep 0건 확인 후 삭제.

- [ ] **Step 2: 검증 helper 제거** — isAutoSendAllowed / incrementVerificationDays 제거(호출부 Task 4에서 이미 제거). 컬럼(verification_*)은 보존(Q9).

- [ ] **Step 3: compliance fail-open 정정(ai-orchestrator.ts:278-281)** — catch 반환을 `{ passed: false, riskLevel: 'medium', warnings: ['자동 검수를 완료하지 못해 자동발송을 보류합니다'], suggestions: [] }`. (수동 검토 경로 영향 0, 자동 자격만 차단.)

- [ ] **Step 4: 옛 박/특수표현 정리** — Task에서 만진 policy.ts 구역의 박-단어·과한 표현 자연 한국어로(전수 X, 만진 부분 한정). grep 0건.

- [ ] **Step 5: tsc 0 + 커밋(Harold).**

---

## Task 8: 계절 문안 주입 (orchestrate 프롬프트)

**Files:** `utils/continuous-operator.ts`(generateProposalForOperator orchestrate 호출부) + 필요 시 `services/ai-orchestrator.ts` 문안 sub-agent 프롬프트 seam.

- [ ] **Step 1: 주입 지점 확인** — orchestrate가 문안 생성 sub-agent에 넘기는 컨텍스트에 `buildSeasonPromptBlock(getSeasonContext(now).month, companyInfo.business_type)` 추가. objective는 불변, 계절은 톤·소재로만(§6-8). AgentContext에 seasonBlock 옵션 추가 또는 companyInfo에 동봉.

- [ ] **Step 2: 구현 + tsc 0** — 임의 혜택 생성 금지 문구 유지(feedback_ai_no_arbitrary_benefit). 모델 분리(자동마케팅=opus) 불변.

- [ ] **Step 3: 커밋(Harold).**

> daily 주기도 허용(§6-2)이나 같은 달 계절 재사용 — 별 분기 없음.

---

## Task 9: 프론트 ContinuousOperatorPage (여정 빌더 동급)

**Files:** Modify `frontend .../ContinuousOperatorPage.tsx`(경로 grep 후).

- [ ] **Step 1: 발송 시각 T 선택** — schedule + schedule_time(=T) + auto_send_lead_minutes(준비/정지 창) 설정 UI. 다크 톤 + violet 액센트.
- [ ] **Step 2: 자율 모드 표시** — 자율 ON/OFF, 다음 발송 예정(scheduled_send_at), 준비/정지 창 안내. AI 자율 진단 카드 톤.
- [ ] **Step 3: 정지 이력 + 발송 결과** — admin_stopped/ sent 목록 + campaign_id 결과 링크.
- [ ] **Step 4: native dialog 0건(ConfirmModal+useToast) / 모델명 0건 / 박-단어 0건 grep.**
- [ ] **Step 5: 마케팅 UX(1클릭·추가입력 최소) 자가 점검 + tsc 0 + 커밋(Harold).**

---

## Self-Review (spec 대조)

- §7-1 안전필터 → Task 2 ✓ / §7-2 추출 → Task 3 ✓ / §7-3 ALTER → Task 0 ✓ / §7-4 워커 2단계 → Task 4·5 ✓ / §7-5 스팸·0건 → Task 6 ✓ / §7-6 검증제거·죽은코드·compliance → Task 4·7 ✓ / §7-7 계절 → Task 1·8 ✓ / §7-8 프론트 → Task 9 ✓.
- §6 확정 전부 반영(주기 일간 포함=Task5 분기 없음 / lead 120=Task0·4 / 테스트발송 2건=Task6 / 정지창 회사설정=Task0 / 수동 UI 유지=기존 approve 유지 / 완료통지=Task5 / 예산 스킵=Task6 / 목표+계절=Task8 / 검증컬럼 보존=Task7 / 프론트=Task9).
- 미해결 확인 필요: countFilteredCustomers unsubscribeCount 소비처(Task2 Step5 grep) / sendAdminTestMessage 회신·라인(인증라인) / 발송 실패 status 최종값(Task5·6) / ContinuousOperatorPage 실제 경로(Task9).

---

## 비목표 (YAGNI)

- 알림톡/푸시/이메일 자율발송, A/B 고도화, 실시간 대시보드는 이번 범위 밖. 이번은 빠진 발송 + 안전 + 계절 문안 + 자율 사이클에 집중(§9).
