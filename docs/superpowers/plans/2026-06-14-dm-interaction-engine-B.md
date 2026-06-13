# DM 인터랙션 실동작 엔진 (B) 구현 계획 — 2026-06-14

> **For agentic workers:** 이 계획은 본 세션에서 **인라인 직접 실행**한다(Harold `no_parallel_tasks` 룰 — subagent-driven 금지). 단계는 `- [ ]` 체크박스로 추적.

**Goal:** 모바일 DM의 룰렛/추첨/설문/이메일수집 인터랙션이 실제로 참여를 받고 → 당첨을 처리하고 → 회사가 결과를 조회·xlsx 다운로드하게 한다. (설계서 `docs/superpowers/specs/2026-06-13-dm-interaction-engine-design.md`의 B.)

**Architecture:** 순수 추첨 코어(`dm-interaction-core.ts`, DB-free, ts-node TDD) + DB 로직 CT(`dm-interaction.ts`) + 마감추첨 워커(`dm-draw-worker.ts`, 1분 cron) + 기존 공개 endpoint `/:code/event-response` 확장 + 인증 admin endpoint(조회/다운로드/사전지정 import/경품설정). 식별 = `?p=phone` → customers 매칭(서버 권위) / 비회원 anonymous_id. 추첨 3방식 = 룰렛(실시간 가중랜덤+재고차감) / 마감랜덤(워커) / 엑셀 사전지정.

**Tech Stack:** Node/Express + TypeScript(ts-node, 빌드 무관), PostgreSQL(`query` from `config/database`), xlsx(`import * as XLSX`), 순수 시드 RNG(mulberry32 — `Math.random`/`Date.now` 미사용).

---

## 신규 스키마 (★ Harold 직접 실행 SQL — 마지막에 따로 전달)

> `dm_prizes`·`dm_winners` 2테이블 + claim/시드 감사용 `dm_draw_runs` 1테이블 + 응모 중복방지 부분 UNIQUE 인덱스.
> `dm_draw_runs`를 둔 이유: 마감추첨 워커의 **원자적 claim(중복 추첨=중복 통보 차단)** + 추첨 시드 감사를 신규 테이블에 격리 → 라이브 뷰어가 쓰는 코어 `dm_pages`를 ALTER하지 않아 무위험. (설계서 2테이블 가정의 "워커 claim 방법" 공백을 메움.)

```sql
-- 1) 경품/등급/재고
CREATE TABLE IF NOT EXISTS dm_prizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES dm_pages(id) ON DELETE CASCADE,
  section_id uuid NOT NULL,
  rank integer NOT NULL,
  name text NOT NULL,
  total_count integer NOT NULL,
  remaining integer NOT NULL,
  win_method varchar(20) NOT NULL,            -- 'random' | 'preset' | 'roulette'
  roulette_segment_id varchar(20),
  reward_code_pool jsonb,
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dm_prizes_campaign ON dm_prizes(campaign_id, section_id);

-- 2) 당첨자
CREATE TABLE IF NOT EXISTS dm_winners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES dm_pages(id) ON DELETE CASCADE,
  section_id uuid,
  prize_id uuid REFERENCES dm_prizes(id) ON DELETE SET NULL,
  response_id uuid REFERENCES dm_event_responses(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  rank integer,
  win_method varchar(20) NOT NULL,            -- 'random' | 'preset' | 'roulette'
  winner_name text, winner_phone text, winner_email text,
  is_member boolean NOT NULL DEFAULT false,
  reward_code text,
  notified_at timestamptz,                    -- F/G 당첨 통보 발송 시각
  drawn_at timestamptz NOT NULL DEFAULT NOW(),
  created_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dm_winners_campaign ON dm_winners(campaign_id, rank);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dm_winners_response ON dm_winners(response_id) WHERE response_id IS NOT NULL;

-- 3) 마감 추첨 claim + 시드 감사 (워커 동시실행/재실행 시 중복 추첨 차단)
CREATE TABLE IF NOT EXISTS dm_draw_runs (
  campaign_id uuid PRIMARY KEY REFERENCES dm_pages(id) ON DELETE CASCADE,
  section_id uuid,
  seed text NOT NULL,
  entry_count integer NOT NULL DEFAULT 0,
  winner_count integer NOT NULL DEFAULT 0,
  drawn_at timestamptz NOT NULL DEFAULT NOW()
);

-- 4) 1인 1회 응모 중복방지 (lucky_draw/roulette/poll/email_capture 등 — 식별자 있는 참여만)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_dm_response_per_user
  ON dm_event_responses (campaign_id, section_id, COALESCE(customer_id::text, anonymous_id))
  WHERE COALESCE(customer_id::text, anonymous_id) IS NOT NULL;
```

검증 SQL(테이블 생성 후 확인용, Harold 실행):
```sql
SELECT table_name FROM information_schema.tables WHERE table_name IN ('dm_prizes','dm_winners','dm_draw_runs');
SELECT indexname FROM pg_indexes WHERE indexname IN ('uniq_dm_response_per_user','uniq_dm_winners_response','idx_dm_prizes_campaign','idx_dm_winners_campaign');
```

> 코드는 `dm_prizes`/`dm_winners`/`dm_draw_runs` 미생성 시 `isDbMigrationPendingError` → `send503Migration`(기존 헬퍼)로 503 안내(500 X). 워커는 try/catch 격리(발송·돈 영향 0).

---

## File Structure

| 파일 | 책임 | 생성/수정 |
|------|------|-----------|
| `packages/backend/src/utils/dm/dm-interaction-core.ts` | 순수: `pickRouletteSegment`/`drawWinners`/`parseWinnerRows`/`sumProbabilities` + 시드 RNG | Create |
| `packages/backend/src/utils/__tests__/dm-interaction-core.verify.ts` | 순수 TDD | Create |
| `packages/backend/src/utils/dm/dm-interaction.ts` | DB 로직 CT: 제출/추첨/조회/집계/다운로드행/import/경품 | Create |
| `packages/backend/src/utils/dm/dm-draw-worker.ts` | 마감 추첨 1분 cron + claim | Create |
| `packages/backend/src/routes/dm.ts` | `/:code/event-response` 확장 + admin endpoint 6 추가 | Modify |
| `packages/backend/src/app.ts` | `startDmDrawWorker()` 등록 | Modify |
| `packages/backend/src/utils/dm/dm-viewer.ts` | 뷰어 인터랙션 JS(룰렛/폼/투표 제출·결과) | Modify |

---

## Task 1: 순수 추첨 코어 + TDD

**Files:**
- Create: `packages/backend/src/utils/dm/dm-interaction-core.ts`
- Test: `packages/backend/src/utils/__tests__/dm-interaction-core.verify.ts`

- [ ] **Step 1: 코어 작성** (`dm-interaction-core.ts`) — 전체 코드

```ts
/**
 * dm-interaction-core.ts — DM 인터랙션 순수 코어 (DB-free, ts-node TDD)
 * 실행: npx ts-node packages/backend/src/utils/__tests__/dm-interaction-core.verify.ts
 * 임의 상수 0 — 확률/등급/인원은 호출부(섹션 props·dm_prizes)에서 주입.
 */

// 시드 RNG (mulberry32 + xmur3 해시) — Math.random/Date.now 미사용, 추첨 재현 가능
export function makeSeededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (h ^ (h >>> 16)) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- 룰렛 실시간 ---
export type RouletteSegmentLite = { id: string; label: string; probability: number };
export type SegmentPrize = { prizeId: string; remaining: number };
export type RoulettePick = { segmentId: string; label: string; won: boolean; prizeId: string | null };

/** 가중 랜덤으로 세그먼트 선택. 당첨 세그먼트라도 재고 0이면 won=false(꽝). rng 주입(테스트 결정적). */
export function pickRouletteSegment(
  segments: RouletteSegmentLite[],
  prizeBySegment: Record<string, SegmentPrize>,
  rng: () => number,
): RoulettePick {
  if (!segments || segments.length === 0) return { segmentId: '', label: '', won: false, prizeId: null };
  const weights = segments.map((s) => (typeof s.probability === 'number' && s.probability > 0 ? s.probability : 0));
  const total = weights.reduce((acc, w) => acc + w, 0);
  let idx = 0;
  if (total <= 0) {
    idx = Math.min(segments.length - 1, Math.floor(rng() * segments.length));
  } else {
    let r = rng() * total;
    for (let i = 0; i < segments.length; i++) { idx = i; r -= weights[i]; if (r < 0) break; }
  }
  const seg = segments[idx];
  const prize = prizeBySegment[seg.id];
  const won = !!(prize && prize.remaining > 0);
  return { segmentId: seg.id, label: seg.label, won, prizeId: won ? prize.prizeId : null };
}

// --- 마감 후 자동 랜덤 추첨 ---
export type DrawEntry = { responseId: string; key: string }; // key = customer_id 또는 anonymous_id
export type RankPrize = { prizeId: string; rank: number; count: number };
export type DrawnWinner = { responseId: string; key: string; rank: number; prizeId: string };

/** 응모자 풀에서 등급(rank asc)별 인원만큼 시드 셔플로 추첨. 1인 1회·중복 당첨 제외·응모<인원이면 가능분만. */
export function drawWinners(entries: DrawEntry[], prizesByRank: RankPrize[], seed: string): DrawnWinner[] {
  const rng = makeSeededRng(seed);
  const seen = new Set<string>();
  const pool: DrawEntry[] = [];
  for (const e of entries) {
    if (e.key && seen.has(e.key)) continue;
    if (e.key) seen.add(e.key);
    pool.push(e);
  }
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
  }
  const ranks = [...prizesByRank].sort((x, y) => x.rank - y.rank);
  const winners: DrawnWinner[] = [];
  let cursor = 0;
  for (const p of ranks) {
    for (let k = 0; k < p.count && cursor < pool.length; k++) {
      const e = pool[cursor++];
      winners.push({ responseId: e.responseId, key: e.key, rank: p.rank, prizeId: p.prizeId });
    }
  }
  return winners;
}

// --- 엑셀 사전 지정 파싱 ---
export type RawWinnerRow = Record<string, any>;
export type ParsedWinner = { name: string; phone: string; email: string | null; rank: number | null };
export type WinnerParseResult = { winners: ParsedWinner[]; errors: { row: number; message: string }[] };

/** 한/영 헤더 모두 허용(이름/name, 전화/phone, 이메일/email, 등급/rank). 행별 오류 수집. */
export function parseWinnerRows(rows: RawWinnerRow[]): WinnerParseResult {
  const winners: ParsedWinner[] = [];
  const errors: { row: number; message: string }[] = [];
  rows.forEach((row, i) => {
    const line = i + 2; // 헤더 1행 + 1-based
    const name = String(row['이름'] ?? row['name'] ?? '').trim();
    const phone = String(row['전화'] ?? row['전화번호'] ?? row['phone'] ?? '').replace(/[^0-9]/g, '');
    const email = String(row['이메일'] ?? row['email'] ?? '').trim();
    const rankRaw = row['등급'] ?? row['rank'];
    if (!name && !phone) { errors.push({ row: line, message: '이름·전화가 모두 비어 있음' }); return; }
    if (!phone) { errors.push({ row: line, message: '전화번호 누락' }); return; }
    let rank: number | null = null;
    if (rankRaw !== undefined && rankRaw !== null && String(rankRaw).trim() !== '') {
      const n = Number(rankRaw);
      if (!Number.isInteger(n) || n < 1) { errors.push({ row: line, message: `등급 값 오류: ${String(rankRaw)}` }); return; }
      rank = n;
    }
    winners.push({ name, phone, email: email || null, rank });
  });
  return { winners, errors };
}

/** 룰렛 확률 합계(A 룰렛 editor 검증 공용). */
export function sumProbabilities(segments: { probability?: number }[]): number {
  return segments.reduce((acc, s) => acc + (typeof s.probability === 'number' ? s.probability : 0), 0);
}
```

- [ ] **Step 2: 실패 테스트 작성** (`dm-interaction-core.verify.ts`) — 전체 코드

```ts
/**
 * dm-interaction-core.verify.ts — DM 인터랙션 순수 코어 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/dm-interaction-core.verify.ts
 */
import assert from 'node:assert';
import {
  makeSeededRng, pickRouletteSegment, drawWinners, parseWinnerRows, sumProbabilities,
} from '../dm/dm-interaction-core';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const SEGS = [
  { id: '1', label: '1등', probability: 0.1 },
  { id: '2', label: '2등', probability: 0.3 },
  { id: '3', label: '꽝', probability: 0.6 },
];

console.log('[pickRouletteSegment]');
ok('가중 랜덤 — rng 0 → 첫 세그먼트', () => {
  const r = pickRouletteSegment(SEGS, { '1': { prizeId: 'p1', remaining: 5 } }, () => 0);
  assert.strictEqual(r.segmentId, '1'); assert.strictEqual(r.won, true); assert.strictEqual(r.prizeId, 'p1');
});
ok('재고 0 세그먼트 = 꽝(won=false)', () => {
  const r = pickRouletteSegment(SEGS, { '1': { prizeId: 'p1', remaining: 0 } }, () => 0);
  assert.strictEqual(r.segmentId, '1'); assert.strictEqual(r.won, false); assert.strictEqual(r.prizeId, null);
});
ok('경품 없는 세그먼트(꽝 구간) = won=false', () => {
  const r = pickRouletteSegment(SEGS, {}, () => 0.99);
  assert.strictEqual(r.segmentId, '3'); assert.strictEqual(r.won, false);
});
ok('확률 합 0 → 균등 fallback(에러 X)', () => {
  const r = pickRouletteSegment([{ id: 'a', label: 'A', probability: 0 }], {}, () => 0.5);
  assert.strictEqual(r.segmentId, 'a');
});
ok('빈 세그먼트 안전', () => {
  const r = pickRouletteSegment([], {}, () => 0.5);
  assert.strictEqual(r.segmentId, ''); assert.strictEqual(r.won, false);
});

console.log('[drawWinners]');
const ENTRIES = Array.from({ length: 10 }, (_, i) => ({ responseId: `r${i}`, key: `k${i}` }));
ok('등급별 인원만큼 추첨(1등1+2등2=3명)', () => {
  const w = drawWinners(ENTRIES, [{ prizeId: 'p1', rank: 1, count: 1 }, { prizeId: 'p2', rank: 2, count: 2 }], 'seed-x');
  assert.strictEqual(w.length, 3);
  assert.strictEqual(w.filter((x) => x.rank === 1).length, 1);
  assert.strictEqual(w.filter((x) => x.rank === 2).length, 2);
});
ok('중복 당첨 없음(responseId·key 유일)', () => {
  const w = drawWinners(ENTRIES, [{ prizeId: 'p1', rank: 1, count: 3 }], 'seed-y');
  assert.strictEqual(new Set(w.map((x) => x.responseId)).size, w.length);
});
ok('같은 key 중복 응모는 1회만 풀 진입', () => {
  const dup = [{ responseId: 'a', key: 'same' }, { responseId: 'b', key: 'same' }, { responseId: 'c', key: 'other' }];
  const w = drawWinners(dup, [{ prizeId: 'p1', rank: 1, count: 5 }], 'seed-z');
  assert.strictEqual(w.length, 2);
});
ok('응모 < 인원 → 가능분만', () => {
  const w = drawWinners(ENTRIES.slice(0, 2), [{ prizeId: 'p1', rank: 1, count: 5 }], 'seed-q');
  assert.strictEqual(w.length, 2);
});
ok('같은 시드 = 같은 결과(재현)', () => {
  const a = drawWinners(ENTRIES, [{ prizeId: 'p1', rank: 1, count: 3 }], 'fixed');
  const b = drawWinners(ENTRIES, [{ prizeId: 'p1', rank: 1, count: 3 }], 'fixed');
  assert.deepStrictEqual(a.map((x) => x.responseId), b.map((x) => x.responseId));
});

console.log('[parseWinnerRows]');
ok('정상 행 파싱(한글 헤더)', () => {
  const r = parseWinnerRows([{ 이름: '홍길동', 전화: '010-1234-5678', 이메일: 'a@b.c', 등급: 1 }]);
  assert.strictEqual(r.errors.length, 0);
  assert.deepStrictEqual(r.winners[0], { name: '홍길동', phone: '01012345678', email: 'a@b.c', rank: 1 });
});
ok('전화 누락 = 행 오류', () => {
  const r = parseWinnerRows([{ name: '김', email: 'x@y.z' }]);
  assert.strictEqual(r.winners.length, 0); assert.strictEqual(r.errors.length, 1);
});
ok('등급 비정상(0/문자) = 행 오류', () => {
  const r = parseWinnerRows([{ name: '이', phone: '01000000000', rank: 'A' }]);
  assert.strictEqual(r.errors.length, 1);
});
ok('등급 비우면 rank=null 허용', () => {
  const r = parseWinnerRows([{ name: '박', phone: '01011112222' }]);
  assert.strictEqual(r.winners[0].rank, null); assert.strictEqual(r.errors.length, 0);
});

console.log('[sumProbabilities]');
ok('합계', () => assert.ok(Math.abs(sumProbabilities(SEGS) - 1.0) < 1e-9));

console.log(`\n[dm-interaction-core] ${passed} assertions GREEN`);
```

- [ ] **Step 3: 실행 → 실패 확인 후 GREEN**

Run: `npx ts-node packages/backend/src/utils/__tests__/dm-interaction-core.verify.ts`
Expected: 처음 모듈 없으면 FAIL → 코어 작성 후 전 assertion GREEN.

---

## Task 2: DB 로직 CT (`dm-interaction.ts`)

**Files:** Create `packages/backend/src/utils/dm/dm-interaction.ts`

함수(시그니처 고정 — route/worker가 소비):

- `resolveCustomerIdByPhone(companyId, phone): Promise<string|null>` — `SELECT id FROM customers WHERE company_id=$1 AND phone=$2 LIMIT 1`. (클라 customer_id 신뢰 X — 서버 phone 매칭이 권위.)
- `submitEventResponse(input): Promise<SubmitResult>` — 핵심:
  1. `getDmByCode`로 dm 해석(company_id, id, sections).
  2. 섹션 props 조회(sections에서 section_id 매칭) → `consent_required`/`one_*_per_user` 판단.
  3. 동의 필수인데 `data.consent !== true` → `{ ok:false, error:'동의가 필요합니다' }`(400).
  4. `?p=phone` 있으면 `resolveCustomerIdByPhone` → customerId, isMember=true. 없으면 anonymous_id.
  5. `INSERT INTO dm_event_responses (...) ON CONFLICT (uniq_dm_response_per_user 대상) DO NOTHING RETURNING id`.
     - 0행(중복) → 기존 응답 SELECT → 룰렛이면 기존 `response_data.spin_result` 반환 `{ ok:true, already:true, result }`.
  6. 룰렛이면 추첨: 해당 섹션 `dm_prizes`(roulette_segment_id, remaining) 로드 → `pickRouletteSegment(segments, prizeBySegment, Math.random)` → won이면 원자적 차감 `UPDATE dm_prizes SET remaining=remaining-1 WHERE id=$1 AND remaining>0 RETURNING id`(0행이면 동시성 소진 → won=false 재판정) → `dm_winners` INSERT(win_method='roulette', response_id) → `response_data.spin_result` UPDATE. 반환 `{ ok:true, result:{ won, label, prizeName } }`.
  7. 그 외(poll/survey/email_capture/lucky_draw) → `{ ok:true }`(접수 확인). poll면 집계 반환 옵션.
  - `consent_at`은 동의 시 `response_data`에 ISO 기록.
- `getResponses(companyId, dmId, {page,limit}): Promise<{rows, total}>` — company_id 격리. 회원/비회원 구분 컬럼 포함.
- `getWinners(companyId, dmId): Promise<rows>` — dm_winners join dm_prizes(name).
- `getResponseStats(companyId, dmId): Promise<stats>` — 응모수/회원비/섹션별 + `dm_views`(열람·체류) 합. **임의 상수 0** — 실데이터만, 없으면 0/`insufficient_data`.
- `buildResponseExportRows(responses, winners): any[]` — **순수**(이름·전화·이메일·회원여부·참여시각·당첨여부·당첨등급) → Task 1 코어에 넣을지 검토(현재는 dm-interaction 내 순수 함수, 가능하면 코어로). xlsx 변환은 route에서.
- `importPresetWinners(companyId, dmId, sectionId, parsed: ParsedWinner[]): Promise<{inserted, linked}>` — phone으로 응모자 response_id·customer_id 연결 시도(없으면 NULL) → `dm_winners` INSERT(win_method='preset').
- `replacePrizesForSection(companyId, dmId, sectionId, prizes): Promise<void>` — 트랜잭션: 해당 (campaign, section) `dm_prizes` DELETE 후 INSERT(remaining=total_count). A editor·발행이 호출.
- `loadDrawableCampaigns(): Promise<rows>` / `claimDrawRun(campaignId, sectionId, seed): Promise<boolean>` / `persistDrawWinners(...)` — 워커 전용(Task 5).

전 함수 catch에서 신규 테이블 미생성 = `isDbMigrationPendingError` 재노출(route가 503 변환).

- [ ] Step 1: 위 함수 작성(트랜잭션은 `getClient`/`BEGIN` 기존 패턴 따름 — 구현 시 `config/database` export 확인).
- [ ] Step 2: `npx tsc -p packages/backend --noEmit` 0 에러.

---

## Task 3: 공개 제출 endpoint 확장 (`dm.ts` `/:code/event-response`)

**Files:** Modify `packages/backend/src/routes/dm.ts:1265-1309`

- [ ] 기존 단순 INSERT 핸들러를 `submitEventResponse` 호출로 교체. body에 `phone`·`data`(=response_data 호환) 수용, `?p=` 쿼리도 phone으로 인정. 응답 `{ success, already?, result? }`. 기존 SDK 필드(`response_data`,`customer_id`) 하위호환 유지. catch에 `isDbMigrationPendingError`→`send503Migration('dm_prizes/dm_winners CREATE')`.
- [ ] `npx tsc -p packages/backend --noEmit` 0.

---

## Task 4: 인증 admin endpoint (`dm.ts` dmRouter)

**Files:** Modify `packages/backend/src/routes/dm.ts`(dmRouter 영역)

- [ ] `GET /:id/responses?page=&limit=` → `getResponses`(companyId=req.user.companyId 격리).
- [ ] `GET /:id/winners` → `getWinners`.
- [ ] `GET /:id/stats` → `getResponseStats`.
- [ ] `GET /:id/responses/export` → `getResponses`+`getWinners`→`buildResponseExportRows`→`XLSX.utils.json_to_sheet`+`XLSX.write({type:'buffer',bookType:'xlsx'})`, `Content-Disposition` 파일명 ASCII-safe(`toAsciiSafeFilename` 패턴).
- [ ] `POST /:id/winners/import` (multer memoryStorage) → `XLSX.read(buffer,{type:'buffer'})`→`sheet_to_json`→`parseWinnerRows`→`importPresetWinners`. errors 함께 반환.
- [ ] `PUT /:id/prizes` body `{ section_id, prizes:[{rank,name,total_count,roulette_segment_id?,win_method}] }` → `replacePrizesForSection`. (A editor·발행 공용.)
- [ ] 전 endpoint: dm 소유 검증(`SELECT 1 FROM dm_pages WHERE id=$1 AND company_id=$2`) + 신규 테이블 503 분기.
- [ ] tsc 0.

---

## Task 5: 마감 추첨 워커 (`dm-draw-worker.ts`)

**Files:** Create `packages/backend/src/utils/dm/dm-draw-worker.ts`; Modify `packages/backend/src/app.ts`

- [ ] `runDmDrawOnce()`:
  1. published + lucky_draw 섹션 보유 + 아직 `dm_draw_runs` 없는 campaign 로드(`loadDrawableCampaigns`).
  2. 각 campaign의 lucky_draw 섹션 props에서 `draw_at` 파싱 → `draw_at <= NOW`만.
  3. `claimDrawRun(campaignId, sectionId, seed)` — `INSERT INTO dm_draw_runs ... ON CONFLICT (campaign_id) DO NOTHING RETURNING campaign_id`. 0행이면 이미 추첨됨 → skip(중복 추첨 차단).
  4. 응모자 = `dm_event_responses`(section_type='lucky_draw') → `DrawEntry[]`(key=COALESCE(customer_id, anonymous_id)). 경품 = `dm_prizes`(win_method='random', rank/total_count).
  5. `drawWinners(entries, prizesByRank, seed)` → `dm_winners` INSERT(win_method='random', response_id/customer_id 연결) → `dm_draw_runs` counts UPDATE.
  - seed = `${campaignId}:${draw_at}`(결정적·감사 가능).
- [ ] `startDmDrawWorker()`: `setInterval(60s)` + `_running` 가드(cancelled-queue-sweeper 미러). 첫 1회 즉시 실행.
- [ ] `app.ts`: import + 기존 `startEmailSendSweeper();` 부근에 `startDmDrawWorker();` 추가.
- [ ] tsc 0.

---

## Task 6: 뷰어 인터랙션 JS (`dm-viewer.ts`)

**Files:** Modify `packages/backend/src/utils/dm/dm-viewer.ts`

- [ ] 룰렛: 회전 애니메이션 시작 → `POST /api/dm/v/:code/event-response`(phone from `?p=`, anonymous_id from localStorage) → 서버 당첨 세그먼트 인덱스로 휠 정지 + 결과 표시. 이미 참여(already) = 이전 결과 표시.
- [ ] 폼(lucky_draw/email_capture): 필드 검증 + `consent_required`면 동의 체크 필수 → submit → 접수 확인. 마감 후 `?p=` 재방문 시 당첨 표시는 stats/winners 공개 조회 또는 안내문.
- [ ] poll: 옵션 선택 → submit → `show_result_after_vote`면 실시간 % 막대.
- [ ] anonymous_id = localStorage 생성·캐시. 제출 결과 localStorage 캐시(재방문 중복 표시).
- [ ] 구현 전 `dm-viewer.ts`의 기존 룰렛/폼 렌더·클릭 추적 코드 read 후 확장(인라인 중복 X). native dialog(alert/confirm) 사용 X — 뷰어 내 커스텀 안내 영역.
- [ ] tsc 0.

---

## Task 7: 검증 (verification-before-completion)

- [ ] `npx ts-node packages/backend/src/utils/__tests__/dm-interaction-core.verify.ts` → 전 assertion GREEN(출력 첨부).
- [ ] `npx tsc -p packages/backend --noEmit` → 0 errors(출력 첨부).
- [ ] 자가 grep: 신규/수정 파일에 박-단어·모델명(Opus/Sonnet/GPT/Claude)·native dialog(alert/confirm/prompt) = 0건(grep 결과 첨부).
- [ ] 발송·돈 경로 무관 확인(B는 수집·추첨·조회. 통보 발송은 F/G).

---

## 개인정보·법적 (설계서 §5) — B 범위 처리

- 동의 필수 섹션은 `data.consent===true` 강제 + `consent_at` 기록(submitEventResponse).
- 조회/다운로드 = `req.user.companyId` 격리만.
- 보관기간 파기 워커 = **후속 과제로 분리**(회사 보관기간 설정·익명화 정책 별도 결정 필요). B 핵심(수집·추첨·조회)에 미포함, STATUS.md "추가 과제"로 기록.

## 배포 (Harold)

`tp-push "0614 모바일DM B 인터랙션 엔진"` → backend는 **ts-node라 `pm2 restart all`만**(build:safe 무관) → 신규 3테이블 + 인덱스 SQL은 별도 전달분 Harold 직접 실행 → frontend 변경 없음(B는 backend+뷰어).

## Self-Review (spec 대조)

- 수집(2-A endpoint)·룰렛 실시간(3-A pickRouletteSegment+차감)·마감랜덤(3-B 워커+drawWinners)·사전지정(3-C parseWinnerRows+import)·조회/다운로드(4)·동의(5)·DM 내 완결(6) → 전부 task 매핑됨.
- spec의 `dm_pages.draw_at` 가정 → 실제 섹션 props라 정정(Task 5).
- spec 2테이블 → claim/시드용 `dm_draw_runs` 추가(무위험 격리, 근거 명시).
- 신규 endpoint `/submit` → 기존 `/:code/event-response` 확장으로 대체(중복 방지).
