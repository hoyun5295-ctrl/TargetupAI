/**
 * 두 문 회사 구매 계약 시험 — 뿌리 R54(★ 2026-11-04 C99 · 설계서 docs/2026-11-03-two-door-purchase-design.md §3 · §7 · 대장 docs/ROOT-LEDGER.md)
 *
 * R54 = 같은 사실이 두 원천(자사몰 결제 cdp_events · 매장 원장 purchases)으로 들어오는데 한 원천만 진실로 고른다(다른 원천 사실이 빠진다)
 *       · 또는 같은 사실 판정 없이 둘을 더한다(두 번 센다).
 * 대상은 소스에서 기계로 뽑는다(손 등재 표 = 허용 목록뿐 · 목록은 실측과 같아야 한다 = 새 자리 · 사라진 자리 모두 빨간불).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..');
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (f !== '__tests__' && f !== 'node_modules') walk(p, out); } else if (/\.ts$/.test(f) && !/\.test\.ts$/.test(f)) out.push(p);
  }
  return out;
};
const files = walk(SRC).map((p) => ({ rel: relative(SRC, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }));
const read = (rel: string) => files.find((f) => f.rel === rel)!.text;
const templates = (text: string): string[] => {
  const out: string[] = [];
  const re = /`([^`]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(m[1]);
  return out;
};
const between = (s: string, a: string, b: string): string => {
  const i = s.indexOf(a);
  expect(i, a).toBeGreaterThanOrEqual(0);
  const j = s.indexOf(b, i + a.length);
  expect(j, b).toBeGreaterThan(i);
  return s.slice(i, j);
};

describe('R54 ① 문 판정 삭제 — 「회사마다 문 하나」 이름이 소스에 없다(T2)', () => {
  const GONE = ['isMallPurchaseDoorActive', 'resolvePurchaseLedgerGate', 'isMallPurchaseDoorForJourneyStats', 'currentPurchaseDoor', 'hasWebhookRevenueHistory', 'hasJoinedAtEvidence', 'PURCHASE_DOOR_CHANGED', 'purchaseDoorChanged'];
  it.each(GONE)('%s = 0', (name) => {
    expect(files.filter((f) => f.text.includes(name)).map((f) => f.rel)).toEqual([]);
  });
});

describe('R54 ② 원장과 몰 결제를 한 문장에서 같이 읽는 SQL = 같은 구매 CT(CT-D1 · CT-D2 · CT-D4)를 지나거나 이유 붙은 허용 목록(있나만 보는 OR = 겹쳐도 값이 같다)', () => {
  const CT = /purchaseFactsSql\(|ledgerDupOfMallSql\(|mallDupOfLedgerSql\(|purchaseAfterSql\(|purchaseWithinDaysSql\(/;
  /** 파일 → [수, 이유] — 실측과 같아야 한다(늘거나 줄면 빨간불 · 줄었으면 이 표도 줄인다) */
  const ALLOW: Record<string, [number, string]> = {
    'utils/automarketing-roi.ts': [1, '관문 = 구매 데이터가 있나(있나만 · 귀속 숫자는 CT-D1 을 지난 두 문장)'],
    'utils/campaign-response-attribution.ts': [1, '관문 = 구매 데이터가 있나(있나만 · 귀속 숫자는 CT-D2)'],
    'utils/cdp-orders.ts': [1, '몰만 갈래 차감의 최근일 되돌림(원장 행이 있는 회사 = 두 문 갈래 = CT-D3 · 이 문장 앞에서 돌아간다)'],
    'utils/company-data-profile.ts': [1, '구매 데이터가 있는 회사인가(있나만)'],
    'utils/journey-product.ts': [1, '상품 재구매 목표 = 저장한 문 하나(문 매개변수로 한쪽만 · 더하지 않는다)'],
    'utils/journey-purchase-ledger.ts': [1, '문 안내 = 문마다 마지막 도착 시각(따로 MAX · 더하지 않는다)'],
    'utils/journey-target-extractor.ts': [2, '장바구니 · 둘러보고 안 삼 = 구매가 없나(NOT EXISTS · 있나만)'],
    'utils/product-signal.ts': [1, '★ 1113 C133 상품 신호 다시 세기 = 문마다 따로 행(door 칸으로 갈라 쓴다 · 한 숫자로 더하지 않는다) · 「그 뒤 그 상품을 샀나」 = 있나만(NOT EXISTS)'],
    'utils/two-door-purchase.ts': [4, 'CT 자신(CT-D2 사실 · CT-D4 두 조각 · 회사 갈래 = 있나만)'],
    'utils/two-door-transition.ts': [1, '전환 패스 대상 회사 = 회사 갈래와 같은 판정(있나만)'],
  };
  it('실측 = 허용 목록', () => {
    const seen: Record<string, number> = {};
    for (const f of files) {
      for (const sql of templates(f.text)) {
        const ledger = /\b(FROM|JOIN)\s+(purchases\b|\$\{LEDGER_PURCHASES_SQL\})|companyLedgerExistsSql\(/.test(sql);   // ★ 1104 C102 — 구매 행 부분 질의 · 원장 문 조각도 원장 읽기
        const mall = /netPurchaseSql\(|event_name\s*(=\s*'purchase'|IN\s*\([^)]*'purchase')|FROM cdp_events/.test(sql);
        if (!ledger || !mall) continue;
        if (CT.test(sql) && f.rel !== 'utils/two-door-purchase.ts') continue;
        seen[f.rel] = (seen[f.rel] || 0) + 1;
      }
    }
    expect(seen).toEqual(Object.fromEntries(Object.entries(ALLOW).map(([k, [n]]) => [k, n])));
  });
  it('몰 결제 숫자와 따로 더하는 원장 문장(성과 귀속) = 같은 구매 줄을 뺀다(CT-D1) · 몰 문장과 원장 문장이 같은 파일에 있으면 원장 쪽에 조각', () => {
    const bad: string[] = [];
    for (const f of files) {
      const ts = templates(f.text);
      const mallSum = ts.some((s) => /netPurchaseSql\(/.test(s) && /total_amount/.test(s) && !/\b(FROM|JOIN)\s+(purchases\b|\$\{LEDGER_PURCHASES_SQL\})|companyLedgerExistsSql\(/.test(s));
      if (!mallSum) continue;
      for (const s of ts) {
        if (/\b(FROM|JOIN)\s+(purchases|\$\{LEDGER_PURCHASES_SQL\})\s+p\b/.test(s) && /total_amount/.test(s) && !/FROM cdp_events/.test(s) && !/(ledgerDupOfMallSql|purchaseFactsSql)\(/.test(s)) bad.push(`${f.rel}: ${s.replace(/\s+/g, ' ').slice(0, 90)}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('R54 ③ 요약 칸 작성자 — 두 문 회사 = CT-D3 하나(T1)', () => {
  it('구매 요약 칸을 SET 하는 UPDATE = 요약 CT · 주문 CT 두 파일뿐', () => {
    const writers = new Set<string>();
    for (const f of files) {
      for (const sql of templates(f.text)) {
        // 칸 목록을 문장 밖 표에서 끼우는 자리(SET ${pairs.map · SET ${sets.join)도 같은 쓰기로 센다
        if (/UPDATE\s+customers\b/.test(sql) && (/\b(purchase_count|total_purchase_amount|recent_purchase_date)\s*=/.test(sql) || /SET\s+\$\{(pairs\.map|sets\.join)/.test(sql))) writers.add(f.rel);
      }
    }
    expect([...writers].sort()).toEqual(['utils/cdp-orders.ts', 'utils/customer-purchase-aggregates.ts']);
  });
  it('주문 CT 의 증분 · 차감 = 두 문 갈래 판정 뒤(판정이 먼저 · 두 문이면 CT-D3 로 돌아간다)', () => {
    const o = read('utils/cdp-orders.ts');
    const apply = o.search(/if \(await resolvePurchaseSummaryBranch\(run, companyId\) === 'two_door'\) \{\s*await recomputeCustomerPurchaseSummary\(run, companyId, \[idResult\.customerId!\]\);\s*return \{ rfmUpdated: true, stale: false \};/);
    const inc = o.indexOf('purchase_count = COALESCE(purchase_count, 0) + 1');
    const dec = o.indexOf('purchase_count = GREATEST(COALESCE(c.purchase_count, 0) - 1, 0)');
    expect(apply).toBeGreaterThan(-1);
    expect(apply).toBeLessThan(inc);
    // ★ Codex 구현 1R #1 — 차감 = 갈래 판정 · 두 문이면 표식 쓰기 **전에** 한 번 센다(첫 계산이 취소 뒤면 취소된 날짜가 옛 값으로 굳는다) · 표식 뒤 다시 센다
    const rev = between(o, "if (decision.action === 'reverse') {", 'const reverseAmount = decision.reverseAmount');
    const pre = rev.search(/const twoDoor = await resolvePurchaseSummaryBranch\(run, companyId\) === 'two_door';\s*if \(twoDoor\) await recomputeCustomerPurchaseSummary\(run, companyId, \[idResult\.customerId!\]\);/);
    expect(pre).toBeGreaterThan(-1);
    expect(pre).toBeLessThan(rev.indexOf("jsonb_build_object('revenue_reversed', true"));
    expect(rev).toMatch(/if \(twoDoor\) \{\s*await recomputeCustomerPurchaseSummary\(run, companyId, \[idResult\.customerId!\]\);\s*return \{ rfmUpdated: true, stale: false \};/);
    expect(o.indexOf("if (decision.action === 'reverse') {")).toBeLessThan(dec);
    expect(o.indexOf('await lockCompanyPurchaseSummary(run, companyId);')).toBeLessThan(o.indexOf('const existingRes = await run('));
  });
  it('원본 요약 값 칸(summary_source) 쓰기 = 업서트 CT · 요약 CT 두 파일 · two_door_since 쓰기 = 회사 갈래 한 곳', () => {
    const src = files.filter((f) => templates(f.text).some((s) => /SET\s+summary_source\s*=|summary_source\s*=\s*(jsonb|CASE|COALESCE)/.test(s))).map((f) => f.rel).sort();
    expect(src).toEqual(['utils/customer-purchase-aggregates.ts', 'utils/customer-upsert.ts']);
    const tds = files.filter((f) => templates(f.text).some((s) => /SET\s+two_door_since\s*=/.test(s))).map((f) => f.rel);
    expect(tds).toEqual(['utils/two-door-purchase.ts']);
  });
  it('원장 적재 요약 = 적재 트랜잭션 안(회사 잠금 → 적재 → 갈래) · 커밋 뒤 따로 돌리기 0', () => {
    const s = read('routes/sync.ts');
    const tx = between(s, 'await withTransaction(async (pRun) => {', 'systemError = systemError || txError;');
    expect(tx.indexOf('await lockCompanyPurchaseSummary(pRun, companyId);')).toBeLessThan(tx.indexOf('buildPurchaseIngestSql('));
    expect(tx.indexOf('await applyLedgerIngestSummary(pRun, companyId,')).toBeGreaterThan(tx.indexOf('if (systemError) throw systemError;'));
    expect(s).not.toContain('updateCustomerPurchaseAggregates');
  });
  it('고객 업서트 = 라우트는 runBatch 만(회사 잠금 → 갈래 → 업서트 → 원본 값 → 두 문 CT-D3) · buildBatch 직접 0', () => {
    for (const f of files.filter((x) => x.rel.startsWith('routes/'))) expect(f.text, f.rel).not.toMatch(/\.buildBatch\(/);
    const u = between(read('utils/customer-upsert.ts'), 'const runBatch = async (', '\n  };');
    const order = ['await lockCompanyPurchaseSummary(run, companyId);', "(await resolvePurchaseSummaryBranch(run, companyId)) === 'two_door'", 'buildBatch(companyId, rows, uploadedBy, { twoDoor })', 'await writeSourceSummary(run, companyId, rows);', 'await recomputeCustomerPurchaseSummary(run, companyId,'];
    let at = -1;
    for (const m of order) { const i = u.indexOf(m); expect(i, m).toBeGreaterThan(at); at = i; }
  });
});

describe('R54 ④ 진입 = 같은 날 다른 문 진입 소유(CT-D5 · T3) · 구매 판정 = CT-D4(T5) · 상품 = (문, 키)(T7)', () => {
  const w = read('utils/journey-trigger-watcher.ts');
  const x = read('utils/journey-target-extractor.ts');
  it('후보가 태어나는 두 커서 SQL 이 같은 조각을 걸고 · 넣기 반복문이 잠금 안에서 한 번 더 · 표식에 문 · 날짜', () => {
    expect(between(x, 'export async function selectCdpEventRowsForCursor(', 'export async function selectPurchaseLedgerRowsForCursor(')).toContain("crossDoorEntryOwnedSql(`$${params.length}`, 'e.customer_id', `'mall'`, mallEntryDaySql('e'))");
    expect(between(x, 'export async function selectPurchaseLedgerRowsForCursor(', 'export async function selectLastPriorPurchase(')).toContain("crossDoorEntryOwnedSql(`$${params.length}`, 'p.customer_id', `'ledger'`, ledgerEntryDaySql('p'))");
    expect(w).toContain("ownsPurchaseDay(j) && eventName === 'purchase',");
    expect(w).toContain('ownsPurchaseDay(j) ? (j.lineageIds || [j.id]) : undefined,');
    const loop = between(w, 'for (const customerId of ids) {', 'await client.query(INSERT_EXECUTION_SQL');
    expect(loop.indexOf("crossDoorEntryOwnedSql('$1', '$2::uuid', '$3::text', '$4::text')")).toBeGreaterThan(loop.indexOf('triggerEntryUsedSql('));
    expect(w).toMatch(/return usesPurchaseLedger\(j\.trigger_event\) && j\.trigger_event !== PRODUCT_TRIGGER_EVENT;/);
  });
  it('이전 구매 · 구매 주기 · 미리보기 = 두 문 사실', () => {
    expect(between(x, 'export async function selectLastPriorPurchase(', 'export async function selectCartAbandonProperties(')).toContain('purchaseFactsSql(');
    expect(between(x, "case 'customer.cycle_lapsed': {", "case 'customer.grade_changed': {")).toContain('purchaseFactsSql(');
    expect(between(x, 'export async function cdpEventTargetQuery(', 'export interface CdpCursorQuery')).toMatch(/if \(eventName === 'purchase' && !\(cursorStart && windowEnd\)\) \{[\s\S]{0,400}purchaseFactsSql\(/);
  });
  it('기다리기 · 조건 · 목표의 「구매」 = CT-D4(사건이 구매일 때만 · 그 밖 사건 = 지금 그대로)', () => {
    const e = read('utils/journey-executor.ts');
    expect(e).toMatch(/const ev = waitEventName === 'purchase'\s*\? await query\([\s\S]{0,200}purchaseAfterSql\('e\.customer_id', '\$3::uuid', 'a\.at'\)/);
    expect(e).toMatch(/const r = eventName === 'purchase'\s*\? await query\([\s\S]{0,200}purchaseWithinDaysSql\('c\.id', '\$2::uuid', '\$3'\)/);
    expect(read('utils/journey-goal-purchase.ts')).toContain('OR ${purchaseAfterSql(`${e}.customer_id`, companyParam, `${e}.entered_at`)}');
  });
  it('상품 목표 = 저장한 문의 키만 · 실행기가 문을 넘긴다 · 감시 = 저장한 문 하나만 돈다', () => {
    expect(read('utils/journey-product.ts')).toMatch(/WHERE \(\$5::text = 'mall' AND EXISTS[\s\S]*OR \(\$5::text = 'ledger' AND EXISTS/);
    expect(read('utils/journey-executor.ts')).toContain('[head.company_id, e.customer_id, e.entered_at, productKeys, productDoor]');
    expect(w).toContain("if (productDoor === 'ledger') return drainCursorDoor(() => processPurchaseLedgerJourney(j));");
  });
});

describe('R53 넓힘 — 가입 근거 = 쓰는 길(T10 · 읽는 곳 = joinedAtEvidence 하나)', () => {
  it('joined_at 근거 판정 SQL = customer-joined-at 한 곳 · 잠금 문구 = 상수', () => {
    const readers = files.filter((f) => f.rel !== 'utils/customer-joined-at.ts' && templates(f.text).some((s) => /joined_at IS NOT NULL\)/.test(s) && /EXISTS/.test(s))).map((f) => f.rel);
    expect(readers).toEqual([]);
    const j = read('utils/customer-joined-at.ts');
    expect(j).toContain("provider = 'cafe24' AND status = 'active'");
    expect(j).toContain("sync_type = 'customers' AND mode = 'incremental'");
    expect(j).toContain('completed_at IS NOT NULL AND error_message IS NULL AND (success_count > 0 OR total_count = 0)');
    expect(read('utils/journey-trigger-capability.ts')).toContain("no('signup', NO_JOINED_AT_REASON)");
  });
});
