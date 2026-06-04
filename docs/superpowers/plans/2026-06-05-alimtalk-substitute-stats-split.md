# 알림톡 대체발송 통계 분리 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for the pure-function task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 슈퍼관리자 발송통계 엑셀(`/stats/export`)에서 알림톡 캠페인을 "알림톡"(msg_type=K)과 "알림톡대체발송"(msg_type=L·k_oriseq>0) 두 행으로 분리해, 정산 담당자가 알림톡/LMS 단가를 따로 청구할 수 있게 한다.

**Architecture:** 10곳이 공유하는 `aggregateSmsCountsByCampaign`은 손대지 않는다. 통계 전용 채널 분리 집계 함수와 순수 분류 함수를 신설하고, 엑셀 로직에서만 `send_channel='alimtalk'` 캠페인에 적용한다.

**Tech Stack:** Node/Express, TypeScript, PostgreSQL(캠페인 메타) + MySQL QTmsg(`SMSQ_SEND_*` 큐), ts-node `.verify.ts`.

---

## 실측 확정 (DB 검증 완료 — 추가 검증 불요)

- 대상 캠페인 `c617cd1c-da13-4fd5-8549-7617bfb6ea9b`(IVITO123) = 알림톡(K) 6건(1800 성공4·7300 실패2) + 대체발송(L·k_oriseq>0) 2건(1000 성공2). 전부 `SMSQ_SEND_1_202606`.
- 대체 L 2건의 `k_oriseq`(361669/361670)가 K 실패 2건의 `seqno`와 일치, 통신사 11(SKT)/19(LG U+) = 발송내역 스샷과 일치.
- `SMSQ_SEND` 컬럼 `msg_type`·`k_oriseq`·`status_code`·`app_etc1` 실재(29컬럼 덤프 확인).
- `campaigns.send_channel` 실재(admin.ts:3214 운영 SELECT 중).
- smsdb에 IMC 테이블 없음 → `kakaoBatchAggByGroup`=0 → 알림톡(K)도 `SMSQ_SEND`에 있음. 분리는 SMSQ `msg_type` 기준.

## File Structure

- **Modify** `packages/backend/src/utils/sms-result-map.ts` — `classifyMsgChannel` + `tallySmsChannelCounts` 순수 함수 추가(컨트롤타워, 인라인 금지).
- **Create** `packages/backend/src/utils/__tests__/sms-channel-split.verify.ts` — 순수 테스트.
- **Modify** `packages/backend/src/utils/stats-aggregation.ts` — `aggregateSmsChannelSplitByCampaign` 집계 함수(라인그룹 묶기 재사용).
- **Modify** `packages/backend/src/routes/admin.ts` (`/stats/export` 3228~3301) — 알림톡 캠페인 2행 분리.

---

## Task 1: 순수 분류·집계 함수 + 테스트 (TDD)

**Files:**
- Modify: `packages/backend/src/utils/sms-result-map.ts` (getCampaignChannelLabel 아래, 207행 뒤)
- Test: `packages/backend/src/utils/__tests__/sms-channel-split.verify.ts`

- [ ] **Step 1: 실패 테스트 작성** — `sms-channel-split.verify.ts`

```ts
/**
 * sms-channel-split.verify.ts — 알림톡/대체발송 채널 분류·집계 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/sms-channel-split.verify.ts
 * (DB import 0 — msg_type/k_oriseq/status_code 분류 + 채널별 성공·실패 집계 순수 함수.)
 */
import assert from 'node:assert';
import { classifyMsgChannel, tallySmsChannelCounts } from '../sms-result-map';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[sms-channel-split] classifyMsgChannel');
ok('K → alimtalk', () => assert.strictEqual(classifyMsgChannel('K', null), 'alimtalk'));
ok('L + k_oriseq>0 → substitute', () => assert.strictEqual(classifyMsgChannel('L', 361669), 'substitute'));
ok('L + k_oriseq 문자열 → substitute', () => assert.strictEqual(classifyMsgChannel('L', '361669'), 'substitute'));
ok('L + k_oriseq NULL → lms', () => assert.strictEqual(classifyMsgChannel('L', null), 'lms'));
ok('L + k_oriseq 0 → lms', () => assert.strictEqual(classifyMsgChannel('L', 0), 'lms'));
ok('S → sms', () => assert.strictEqual(classifyMsgChannel('S', null), 'sms'));
ok('M → mms', () => assert.strictEqual(classifyMsgChannel('M', null), 'mms'));
ok('알 수 없는 타입 → other', () => assert.strictEqual(classifyMsgChannel('X', null), 'other'));

console.log('[sms-channel-split] tallySmsChannelCounts — 실측 캠페인 c617 분포');
ok('K 6(성공4·실패2) + L대체 2(성공2)', () => {
  const r = tallySmsChannelCounts([
    { msg_type: 'K', k_oriseq: null, status_code: 1800, cnt: 4 },
    { msg_type: 'K', k_oriseq: null, status_code: 7300, cnt: 2 },
    { msg_type: 'L', k_oriseq: 361669, status_code: 1000, cnt: 1 },
    { msg_type: 'L', k_oriseq: 361670, status_code: 1000, cnt: 1 },
  ]);
  assert.strictEqual(r.alimtalk.total, 6);
  assert.strictEqual(r.alimtalk.success, 4);
  assert.strictEqual(r.alimtalk.fail, 2);
  assert.strictEqual(r.alimtalk.pending, 0);
  assert.strictEqual(r.substitute.total, 2);
  assert.strictEqual(r.substitute.success, 2);
  assert.strictEqual(r.substitute.fail, 0);
});
ok('일반 LMS·SMS는 별도 채널, 대기(100) 분리', () => {
  const r = tallySmsChannelCounts([
    { msg_type: 'L', k_oriseq: null, status_code: 1000, cnt: 5 },
    { msg_type: 'S', k_oriseq: null, status_code: 6, cnt: 3 },
    { msg_type: 'S', k_oriseq: null, status_code: 100, cnt: 1 },
  ]);
  assert.strictEqual(r.lms.success, 5);
  assert.strictEqual(r.sms.success, 3);
  assert.strictEqual(r.sms.pending, 1);
  assert.strictEqual(r.alimtalk.total, 0);
});
ok('빈 입력 → 전 채널 0', () => {
  const r = tallySmsChannelCounts([]);
  assert.strictEqual(r.alimtalk.total, 0);
  assert.strictEqual(r.substitute.total, 0);
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
```

- [ ] **Step 2: 실패 확인**

Run: `npx ts-node packages/backend/src/utils/__tests__/sms-channel-split.verify.ts`
Expected: FAIL — `classifyMsgChannel`/`tallySmsChannelCounts` is not exported.

- [ ] **Step 3: 최소 구현** — `sms-result-map.ts` 207행(`getCampaignChannelLabel` 닫는 `}`) 뒤에 추가

```ts
/**
 * 발송 채널 분류 (집계 키) — getSendTypeLabel과 동일 규칙의 영문 키 버전.
 * 통계에서 알림톡(K)과 카카오실패 대체발송(L·k_oriseq>0)을 분리 집계할 때 사용.
 */
export type SmsChannel = 'alimtalk' | 'substitute' | 'lms' | 'sms' | 'mms' | 'other';

export function classifyMsgChannel(msgType: string, kOriseq?: number | string | null): SmsChannel {
  if (msgType === 'K') return 'alimtalk';
  if (msgType === 'L') {
    const ori = Number(kOriseq);
    if (kOriseq != null && kOriseq !== '' && !Number.isNaN(ori) && ori > 0) return 'substitute';
    return 'lms';
  }
  if (msgType === 'S') return 'sms';
  if (msgType === 'M') return 'mms';
  return 'other';
}

export interface ChannelCount { total: number; success: number; fail: number; pending: number; }

/**
 * msg_type/k_oriseq/status_code별 집계 행 배열을 채널별 성공·실패·대기로 누적.
 * status 판정은 SUCCESS_CODES/PENDING_CODES(이 파일) 단일 진실 재사용.
 */
export function tallySmsChannelCounts(
  rows: Array<{ msg_type: string; k_oriseq?: number | string | null; status_code: number | string; cnt: number | string }>
): Record<SmsChannel, ChannelCount> {
  const init = (): ChannelCount => ({ total: 0, success: 0, fail: 0, pending: 0 });
  const out: Record<SmsChannel, ChannelCount> = {
    alimtalk: init(), substitute: init(), lms: init(), sms: init(), mms: init(), other: init(),
  };
  for (const r of rows) {
    const ch = classifyMsgChannel(r.msg_type, r.k_oriseq);
    const cnt = Number(r.cnt || 0);
    const code = Number(r.status_code);
    const b = out[ch];
    b.total += cnt;
    if (isSuccess(code)) b.success += cnt;
    else if (isPending(code)) b.pending += cnt;
    else b.fail += cnt;
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx ts-node packages/backend/src/utils/__tests__/sms-channel-split.verify.ts`
Expected: PASS — `14 assertions passed`.

---

## Task 2: 채널 분리 집계 함수 (DB — tsc + 통합 검증)

**Files:**
- Modify: `packages/backend/src/utils/stats-aggregation.ts` (aggregateSmsCountsByCampaign 275행 뒤)

- [ ] **Step 1: import에 순수 함수 추가** — stats-aggregation.ts:14

```ts
import { SUCCESS_CODES_SQL, PENDING_CODES_SQL, tallySmsChannelCounts, SmsChannel, ChannelCount } from './sms-result-map';
```

- [ ] **Step 2: 집계 함수 추가** — aggregateSmsCountsByCampaign 닫는 `}`(275행) 뒤

라인그룹 테이블셋 묶기는 `aggregateSmsCountsByCampaign`과 동일 패턴. 마지막 쿼리만 `app_etc1, msg_type, (k_oriseq>0 여부), status_code` GROUP BY raw로 가져와 `tallySmsChannelCounts`로 채널 분리.

```ts
/**
 * ★ 알림톡 통계 분리 — 캠페인의 SMS 큐를 채널(알림톡 K / 대체발송 L·k_oriseq>0 / lms·sms·mms)별로
 *   성공·실패·대기 집계. 통계 엑셀에서 알림톡 캠페인을 "알림톡"/"알림톡대체발송" 2행으로 가르는 전용.
 *   aggregateSmsCountsByCampaign(전 통계·결과 공유)은 불변 — 이 함수는 엑셀에서만 호출.
 * @returns Map<campaignId, Record<SmsChannel, {total,success,fail,pending}>>
 */
export async function aggregateSmsChannelSplitByCampaign(
  campaigns: Array<{ id: string; company_id: string; created_by: string | null }>
): Promise<Map<string, Record<SmsChannel, ChannelCount>>> {
  const result = new Map<string, Record<SmsChannel, ChannelCount>>();
  if (campaigns.length === 0) return result;

  // (company_id, created_by)별 → 라인그룹 테이블셋별 묶기 (aggregateSmsCountsByCampaign과 동일)
  type UserGroup = { companyId: string; userId: string | null; ids: string[] };
  const byUser = new Map<string, UserGroup>();
  for (const c of campaigns) {
    const key = `${c.company_id}::${c.created_by || ''}`;
    if (!byUser.has(key)) byUser.set(key, { companyId: c.company_id, userId: c.created_by, ids: [] });
    byUser.get(key)!.ids.push(c.id);
  }
  const userGroupTables: Array<{ ug: UserGroup; tables: string[] }> = await Promise.all(
    Array.from(byUser.values()).map(async (ug) => ({
      ug, tables: await getCompanySmsTablesWithLogs(ug.companyId, ug.userId || undefined),
    }))
  );
  const byTableSet = new Map<string, { tables: string[]; ids: string[] }>();
  for (const { ug, tables } of userGroupTables) {
    if (tables.length === 0) continue;
    const tableKey = [...tables].sort().join(',');
    if (!byTableSet.has(tableKey)) byTableSet.set(tableKey, { tables, ids: [] });
    byTableSet.get(tableKey)!.ids.push(...ug.ids);
  }

  // 라인그룹 테이블셋별 raw 집계: app_etc1 + msg_type + (대체 여부) + status_code
  const rawByCampaign = new Map<string, Array<{ msg_type: string; k_oriseq: number | null; status_code: number; cnt: number }>>();
  for (const [, group] of byTableSet) {
    if (group.ids.length === 0 || group.tables.length === 0) continue;
    const placeholders = group.ids.map(() => '?').join(',');
    const unions = group.tables
      .map(t => `SELECT app_etc1 AS _grp, msg_type,
                   CASE WHEN k_oriseq IS NOT NULL AND k_oriseq > 0 THEN 1 ELSE 0 END AS is_sub,
                   status_code, COUNT(*) AS cnt
                 FROM ${t} WHERE app_etc1 IN (${placeholders})
                 GROUP BY app_etc1, msg_type, is_sub, status_code`)
      .join(' UNION ALL ');
    // 같은 테이블이 LIVE+LOG로 쪼개질 수 있어 outer 재합산
    const sql = `SELECT _grp, msg_type, is_sub, status_code, SUM(cnt) AS cnt
                 FROM (${unions}) u GROUP BY _grp, msg_type, is_sub, status_code`;
    const params: any[] = [];
    for (let i = 0; i < group.tables.length; i++) params.push(...group.ids);
    const rows = await mysqlQuery(sql, params) as any[];
    for (const r of rows) {
      const cid = String(r._grp);
      if (!rawByCampaign.has(cid)) rawByCampaign.set(cid, []);
      rawByCampaign.get(cid)!.push({
        msg_type: String(r.msg_type),
        k_oriseq: Number(r.is_sub) === 1 ? 1 : null,  // tallySmsChannelCounts는 k_oriseq>0 여부만 봄
        status_code: Number(r.status_code),
        cnt: Number(r.cnt || 0),
      });
    }
  }

  for (const [cid, rows] of rawByCampaign) result.set(cid, tallySmsChannelCounts(rows));
  return result;
}
```

- [ ] **Step 3: tsc 통과 확인**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors.

---

## Task 3: 엑셀 `/stats/export` 알림톡 2행 분리

**Files:**
- Modify: `packages/backend/src/routes/admin.ts` (3228~3301 — exportSmsMap/exportByKey 빌드·라벨)

- [ ] **Step 1: import에 분리 집계 추가** — admin.ts:15

```ts
import { buildDateRangeFilter, aggregateSmsCountsByCampaign, aggregateSmsSendTimesByCampaign, aggregateSmsChannelSplitByCampaign, getCampaignResultCounts, STAT_DATE_EXPR } from '../utils/stats-aggregation';
```

- [ ] **Step 2: 알림톡 캠페인 분리 집계 + 2행 빌드** — admin.ts 3228~3268 교체

핵심: `send_channel='alimtalk'` 캠페인은 `splitMap`에서 alimtalk/substitute 채널을 꺼내 **채널을 key에 추가**한 2개 버킷으로, 나머지는 기존 합산 그대로.

```ts
    const exportSmsMap = await aggregateSmsCountsByCampaign(exportMetaResult.rows);
    const exportKakaoMap = await kakaoBatchAggByGroup(exportMetaResult.rows.map((c: any) => c.id));
    // 알림톡 캠페인만 채널 분리 집계(알림톡 K / 대체발송 L·k_oriseq>0)
    const alimtalkCampaigns = exportMetaResult.rows.filter((c: any) => c.send_channel === 'alimtalk');
    const exportSplitMap = await aggregateSmsChannelSplitByCampaign(alimtalkCampaigns);

    type ExportBucket = {
      send_date: string; company_name: any; company_code: any; login_id: any; user_name: any;
      message_type: any; send_channel: any; send_type: any; channel_label: string;
      campaign_count: number; total_target: number;
      total_sent: number; total_success: number; total_fail: number; total_pending: number;
    };
    const exportByKey = new Map<string, ExportBucket>();

    const addBucket = (c: any, channelKey: string, channelLabel: string,
                       target: number, sent: number, success: number, fail: number, pending: number) => {
      const key = `${c.send_date}|${c.company_id}|${c.created_by || ''}|${channelKey}|${c.send_type || ''}`;
      if (!exportByKey.has(key)) {
        exportByKey.set(key, {
          send_date: c.send_date, company_name: c.company_name, company_code: c.company_code,
          login_id: c.login_id, user_name: c.user_name,
          message_type: c.message_type, send_channel: c.send_channel, send_type: c.send_type,
          channel_label: channelLabel,
          campaign_count: 0, total_target: 0,
          total_sent: 0, total_success: 0, total_fail: 0, total_pending: 0,
        });
      }
      const b = exportByKey.get(key)!;
      b.campaign_count++;
      b.total_target += target;
      b.total_sent += sent; b.total_success += success; b.total_fail += fail; b.total_pending += pending;
    };

    for (const c of exportMetaResult.rows) {
      if (c.send_channel === 'alimtalk') {
        const split = exportSplitMap.get(c.id);
        const a = split?.alimtalk ?? { total: 0, success: 0, fail: 0, pending: 0 };
        const s = split?.substitute ?? { total: 0, success: 0, fail: 0, pending: 0 };
        // 알림톡 행 (대상건수는 알림톡 발송분에 귀속, 대체는 0 — 중복 합산 방지)
        addBucket(c, 'alimtalk', '알림톡', Number(c.target_count || 0), a.total, a.success, a.fail, a.pending);
        // 대체발송 행 (집계가 0이어도 행 표기는 생략 — 대체 발생분만)
        if (s.total > 0) {
          addBucket(c, 'substitute', '알림톡대체발송', 0, s.total, s.success, s.fail, s.pending);
        }
      } else {
        const sms = exportSmsMap.get(c.id) || { total_count: 0, success_count: 0, fail_count: 0, pending_count: 0 };
        const kakao = exportKakaoMap.get(c.id) || { total: 0, success: 0, fail: 0, pending: 0 };
        const channelKey = `${c.message_type || ''}|${c.send_channel || ''}`;
        addBucket(
          c, channelKey, getCampaignChannelLabel(c.send_channel, c.message_type),
          Number(c.target_count || 0),
          Number(sms.total_count || 0) + kakao.total,
          Number(sms.success_count || 0) + kakao.success,
          Number(sms.fail_count || 0) + kakao.fail,
          Number(sms.pending_count || 0) + kakao.pending,
        );
      }
    }
```

- [ ] **Step 3: CSV 라벨을 channel_label로 교체** — admin.ts 3293행

```ts
      r.channel_label,
```

(기존 `getCampaignChannelLabel(r.send_channel, r.message_type)` 한 줄 대체. import는 일반 캠페인 addBucket에서 계속 사용하므로 유지.)

- [ ] **Step 4: tsc 통과 확인**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors.

---

## Task 4: 통합 검증 + 자가 grep

- [ ] **Step 1: 순수 테스트 재실행**

Run: `npx ts-node packages/backend/src/utils/__tests__/sms-channel-split.verify.ts`
Expected: `14 assertions passed`.

- [ ] **Step 2: backend tsc 0**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 3: 자가 grep** — 모델명/박-단어/native dialog 0건(신규 코드)

Run: 변경 3파일에 대해 Grep `옛|박[음힘는을힌지혀힙히혔힐았]|Opus|Sonnet|GPT|alert\(|confirm\(`
Expected: 0건.

- [ ] **Step 4: 배포 후 실측 검증(Harold)** — 엑셀 다운로드 시 `c617` 캠페인이
  `알림톡 전송6·성공4·실패2` + `알림톡대체발송 전송2·성공2·실패0` 두 행으로 분리되는지 확인.

---

## 배포 메모

- backend만 변경(frontend 무관). ts-node 운영 → `git pull` + `pm2 restart targetup-backend`(restart all 금지 — 한줄전단 영향).
- DB 마이그레이션 0. 신규 SQL 컬럼 전부 실측 완료.
- 정산(돈) 인접 → 배포 전 `/codex:adversarial-review` 권장(채널 분리 집계·대상건수 귀속).
