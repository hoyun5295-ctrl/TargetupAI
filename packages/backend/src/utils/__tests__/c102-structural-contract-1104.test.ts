/**
 * C102 여정 · 자동마케팅 구조 결함 0 — 계약 시험(★ 2026-11-04 · 설계서 docs/2026-11-04-c102-structural-zero-design.md §3)
 *
 * 축 가(값 범위) · 축 나(값이 그려지는 화면) — C98 · C99 흐름 표에 칸이 없어 「범위 밖」으로 흘렀던 두 축을 소스에서 기계로 뽑아 지킨다.
 *   K1 원장 날것 읽기 = CT-D6(구매 행) 밖은 이유 붙은 허용 목록뿐(실측과 같아야 한다 · 새 자리 = 빨간불)
 *   K2 자동마케팅 성과 문구 = 들어온 문(purchaseDoors) · 「자사몰 연동(구매 데이터 수집)」 0
 *   K3 지도 응답 notices = 작업 화면이 그린다 · 매장 구매 들어오는 때 줄
 *   K4 상태만 바꾸는 갈래 = 옛 결제 표식을 굳힌다
 *   K5 안내 문구 속 [단추] 이름 = 화면에 실제로 있는 단추(여정 · 자동마케팅 · 플래너)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { journeyNotices, LEDGER_ENTRY_NOTICE } from '../journey-lifecycle-map';
import { ledgerPurchaseRowSql, LEDGER_PURCHASES_SQL } from '../two-door-purchase';

const PKG = join(__dirname, '..', '..', '..', '..');   // packages/
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['__tests__', 'node_modules', 'dist'].includes(f)) walk(p, out); }
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};
const load = (dir: string) => walk(join(PKG, dir)).map((p) => ({ rel: relative(PKG, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }));
const backend = load('backend/src');
const frontend = load('frontend/src');
const code = (text: string) => text.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const read = (rel: string) => [...backend, ...frontend].find((f) => f.rel === rel)!.text;

describe('K1 원장(purchases)을 날것으로 읽는 자리 = CT-D6 밖은 이유 붙은 허용 목록(G1 · 환불 · 반품 음수 행 = 구매 아님)', () => {
  /** 파일 → [수, 이유] — 실측과 같아야 한다(늘거나 줄면 빨간불 · 줄었으면 이 표도 줄인다) */
  const ALLOW: Record<string, [number, string]> = {
    'backend/src/utils/two-door-purchase.ts': [5, 'CT 자신(구매 행 부분 질의 · 원장 문 있나 · 환불 합 · 환불 날 · G7 고객 없는 행 잇기)'],
    'backend/src/utils/customer-purchase-aggregates.ts': [1, '매장만 회사 요약 집계 = 횟수 · 최근은 FILTER(ledgerPurchaseRowSql) · 누계 = 순액(환불 행 포함)'],
    'backend/src/utils/journey-purchase-ledger.ts': [1, '문 마지막 도착 시각 = 어느 행이든 도착(구매 판정 아님)'],
    'backend/src/utils/purchase-history-source.ts': [1, '구매 이력 화면 = 원장 행 기록 그대로(환불 행도 보인다 · 고객 화면 = C99 §3 범위 밖 기능)'],
    'backend/src/routes/admin.ts': [1, '관리 화면(여정 · 자동마케팅 밖 · C99 §3 범위 밖 기능 Harold 1103)'],
    'backend/src/routes/analysis.ts': [3, 'AI 분석(C99 §3 범위 밖 기능 Harold 1103)'],
    'backend/src/routes/customers.ts': [3, '고객 화면(C99 §3 범위 밖 기능 · C101 작업 파일)'],
    'backend/src/routes/dm.ts': [1, 'DM(C99 §3 범위 밖 기능 Harold 1103)'],
    'backend/src/utils/customer-timeline.ts': [2, '고객 360 타임라인(C99 §3 범위 밖 기능 Harold 1103)'],
    'backend/src/utils/demo-data.ts': [2, '시연 데이터 만들기 · 지우기(판정 아님)'],
    'backend/src/utils/inapp-funnel-stats.ts': [1, '인앱(C99 §3 범위 밖 기능 Harold 1103)'],
    'backend/src/utils/recipient-conversion.ts': [1, 'buildRecipientRunConversions = AI 분석 전용(routes/analysis.ts · C99 §3 범위 밖)'],
  };
  it('실측 = 허용 목록', () => {
    const seen: Record<string, number> = {};
    for (const f of backend) {
      const n = (code(f.text).match(/\b(FROM|JOIN)\s+purchases\b/g) || []).length;
      if (n) seen[f.rel] = n;
    }
    expect(seen).toEqual(Object.fromEntries(Object.entries(ALLOW).map(([k, [n]]) => [k, n])));
  });
  it('구매 행 = 금액 없음 또는 0 이상 · 부분 질의는 그 조각 하나', () => {
    expect(ledgerPurchaseRowSql('p')).toBe("((p.total_amount IS NULL OR p.total_amount >= 0) AND (p.purchase_date IS NULL OR (p.purchase_date <= (NOW() AT TIME ZONE 'Asia/Seoul'))))");   // G1 음수 · G6 미래 날짜(kstNotFutureSql 한 곳)
    expect(LEDGER_PURCHASES_SQL).toContain(ledgerPurchaseRowSql('lp'));
  });
  it('매장만 요약 · 두 문 요약 = CT 조각을 쓴다(횟수 · 최근 = 구매 행 · 누계 = 순액)', () => {
    const agg = read('backend/src/utils/customer-purchase-aggregates.ts');
    expect(agg).toContain("const BUY = ledgerPurchaseRowSql('p');");
    expect((agg.match(/FILTER \(WHERE \$\{BUY\}\)/g) || []).length).toBe(4);   // 횟수 · 최근 날짜 · 금액 · 매장
    expect(agg).toMatch(/rf AS \(\$\{ledgerRefundTotalsSql\('\$1::uuid', '\$2::uuid\[\]'\)\}\)/);
    expect(agg).toContain("const NET_TOTAL = 'GREATEST(COALESCE(agg.total, 0) + COALESCE(rf.refund, 0), 0)';");
  });
});

describe('K2 자동마케팅 성과 문구 = 들어온 문 그대로(G4 · C99-F1)', () => {
  it('ROI 응답 두 갈래(발송 0 · 계산) 모두 purchaseDoors 를 싣는다 · 발송 0 이어도 관문을 먼저 본다', () => {
    const roi = read('backend/src/utils/automarketing-roi.ts');
    expect((roi.match(/hasCdpData, purchaseDoors,|hasCdpData,\n\s+purchaseDoors,/g) || []).length).toBe(2);
    expect(roi.indexOf('const purchaseDoors')).toBeLessThan(roi.indexOf('if (campaigns === 0)'));
  });
  it('자동마케팅 화면 · 성과 화면 = roiAttributionNote 한 곳 · 옛 「자사몰 연동(구매 데이터 수집)」 0', () => {
    expect(frontend.filter((f) => f.text.includes('자사몰 연동(구매 데이터 수집)')).map((f) => f.rel)).toEqual([]);
    expect(read('frontend/src/pages/ContinuousOperatorPage.tsx')).toMatch(/roiAttributionNote\(roi\)\.empty/);
    expect(read('frontend/src/pages/ContinuousOperatorPage.tsx')).toMatch(/roiAttributionNote\(roi\)\.ledgerCaveat/);
    expect(read('frontend/src/pages/PerformancePage.tsx')).toMatch(/roiAttributionNote\(amRoi\)\.empty/);
    expect(read('frontend/src/components/automarketing/types.ts')).toMatch(/d\?\.ledger \? '매장 구매는 날짜로 세어/);
  });
});

describe('K3 지도 응답 notices = 작업 화면이 그린다 · 매장 구매 들어오는 때(G5 · C99 §12 T8)', () => {
  it('작업 화면 시작 칸 = mj.notices 를 그린다', () => {
    expect(read('frontend/src/components/journey/workspace/JourneyWorkspace.tsx')).toMatch(/\(mj\?\.notices \|\| \[\]\)\.map\(\(n\) => <li key=\{n\}>\{n\}<\/li>\)/);
  });
  it('원장 문 + 매장 구매를 읽는 여정 = 안내 줄 · 그 밖 = 없음', () => {
    expect(LEDGER_ENTRY_NOTICE).toBe('매장 구매는 하루 모아 다음 날 오전 9시 ~ 12시에 이 여정에 들어와요.');
    for (const t of ['cdp.purchase', 'purchase.first', 'customer.dormant_return']) {
      expect(journeyNotices(t, true, { ledgerDoor: true })).toContain(LEDGER_ENTRY_NOTICE);
      expect(journeyNotices(t, true, { ledgerDoor: false })).not.toContain(LEDGER_ENTRY_NOTICE);
    }
    expect(journeyNotices('purchase.product', true, { ledgerDoor: true, productDoor: 'ledger' })).toContain(LEDGER_ENTRY_NOTICE);
    expect(journeyNotices('purchase.product', true, { ledgerDoor: true, productDoor: 'mall' })).not.toContain(LEDGER_ENTRY_NOTICE);
    expect(journeyNotices('customer.created', true, { ledgerDoor: true })).not.toContain(LEDGER_ENTRY_NOTICE);
  });
  it('지도 응답이 회사 원장 문 · 상품 여정 문을 넘긴다', () => {
    const map = read('backend/src/utils/journey-lifecycle-map.ts');
    expect(map).toContain('notices: journeyNotices(triggerEvent, goalExitEnabled, { ledgerDoor, productDoor:');
    expect(map).toMatch(/const ledgerDoor = !!\(await getPurchaseDoorStatus\(companyId\)/);
  });
});

describe('K4 상태만 바꾸는 갈래 = 옛 결제(표식 없음 · 기록 당시 결제) 표식을 굳힌다(G2)', () => {
  it('3-C 갈래가 isRevenueApplied 로 판정해 revenue_applied 를 같은 문장에 싣는다', () => {
    const o = read('backend/src/utils/cdp-orders.ts');
    const at = o.indexOf('// 3-C.');
    const body = o.slice(at, o.indexOf('// 4.', at));
    expect(body).toContain('const legacyApplied = props.revenue_applied === undefined && isRevenueApplied({ properties: props });');
    expect(body).toContain('JSON.stringify(legacyApplied ? { ...extra, revenue_applied: true } : extra)');
  });
  it('cdp_events 상태를 쓰는 자리 = cdp-orders.ts 하나(다른 UPDATE 는 고객 연결만)', () => {
    const writers = backend.filter((f) => /UPDATE cdp_events\s+SET[\s\S]{0,200}properties/.test(code(f.text))).map((f) => f.rel);
    expect(writers).toEqual(['backend/src/utils/cdp-orders.ts']);
  });
});

describe('K5 안내 문구 속 [단추] 이름 = 화면에 실제로 있는 단추(G3 · 여정 · 자동마케팅 · 플래너)', () => {
  const SCOPE = /(journey|automarketing|operator|planner|autosend|manager-board|ContinuousOperator|Journey|Planner)/;
  /** 단추 글자 꼴 = JSX 글(줄 하나 통째 · 태그 「>」 · 식 「}」 바로 뒤) 또는 문자열 머리(라벨 값 · 동사) · 서버가 주는 단추 라벨(label: '…') */
  const labelExists = (name: string): boolean => {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const asText = new RegExp(`(^\\s*${esc}\\s*$|[>}]\\s*${esc}|['"\`]${esc})`);
    return frontend.some((f) => code(f.text).split('\n').some((l) => !l.includes(`[${name}]`) && asText.test(l)))
      || backend.some((f) => new RegExp(`label:\\s*['\`]${esc}['\`]`).test(code(f.text)));
  };
  it('범위 안 문구의 「[이름](로|를|으로| 버튼)」 = 그 이름이 단추로 있다', () => {
    const missing: string[] = [];
    for (const f of [...backend, ...frontend]) {
      if (!SCOPE.test(f.rel)) continue;
      // 단추 이름 = 한글로 시작하는 짧은 이름(「[N, N+24h]로」 같은 구간 · 변수 표기는 단추가 아니다)
      const re = /\[([가-힣][가-힣A-Za-z0-9 ·]{1,15})\](로|를|으로| 버튼)/g;
      const t = code(f.text);
      let m: RegExpExecArray | null;
      while ((m = re.exec(t))) if (!labelExists(m[1].trim())) missing.push(`${f.rel} [${m[1]}]`);
    }
    expect(missing).toEqual([]);
  });
  it('없는 [정지] 단추 안내 0(실제 = [자동 발송 정지])', () => {
    expect([...backend, ...frontend].filter((f) => /\[정지\](로|를| 버튼)/.test(code(f.text))).map((f) => f.rel)).toEqual([]);
  });
});

/** SQL 줄 주석(-- …) · 블록 주석 · TS 줄 주석(// …)을 지운 본문 — 꺼 둔 조건을 판정으로 세지 않는다(Codex 7R). */
const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
/** 이름 붙은 함수 · 상수 선언의 본문(다음 최상위 선언 앞까지) — 글자 수 창 대신 선언 경계. */
const declBody = (text: string, head: string): string => {
  const at = text.indexOf(head);
  expect(at, head).toBeGreaterThanOrEqual(0);
  const next = text.slice(at + head.length).search(/\n(export |const |function |async function |\/\*\*)/);
  return text.slice(at, next < 0 ? undefined : at + head.length + next);
};
/** 주석을 지우고 공백을 하나로 · 괄호 · 쉼표 · 대괄호 · 중괄호 · 세미콜론 앞뒤 공백 없앰(줄바꿈 · 들여쓰기 같은 꼴 바꿈에 안 깨진다 · Codex 8R). 기대값도 같은 함수를 지난다. */
const squash = (s: string) => noComments(s).replace(/\s+/g, ' ').replace(/\s*([(),[\]{};])\s*/g, '$1').replace(/,([)\]}])/g, '$1').trim();   // 끝 쉼표도 꼴
const has = (hay: string, needle: string) => expect(squash(hay)).toContain(squash(needle));

describe('K6 「미래 = 아직 일어나지 않은 구매」 판정 한 곳(G6 · Codex 4R · G9)', () => {
  it('원장 구매 · 환불 행 = ledgerNotFutureSql(= kstNotFutureSql) 을 주석 밖에서 부른다', () => {
    const ct = read('backend/src/utils/two-door-purchase.ts');
    has(declBody(ct, 'export function ledgerNotFutureSql('), 'kstNotFutureSql(`${p}.purchase_date`)');
    has(declBody(ct, 'export function ledgerRefundRowSql('), '${p}.total_amount < 0 AND ${ledgerNotFutureSql(p)}');
    has(declBody(ct, 'export function ledgerPurchaseRowSql('), '${p}.total_amount >= 0) AND ${ledgerNotFutureSql(p)}');
  });
  it('원본 최근일 · 옛 값 옮기기 · 목표 요약 항 = 주석 밖의 kstNotFutureSql 조건', () => {
    const agg = read('backend/src/utils/customer-purchase-aggregates.ts');
    has(agg, 'const SRC_RECENT_DATE = `(CASE WHEN ${kstNotFutureSql(SRC_RECENT_RAW)} THEN ${SRC_RECENT_RAW} END)`;');
    const carry = squash(declBody(agg, 'export async function recomputeCustomerPurchaseSummary('));
    const legacy = carry.slice(carry.indexOf(squash("jsonb_set(${SRC}, '{recent}'")), carry.indexOf(squash('const useSrc')));
    has(legacy, "AND NOT ${ledgerRefundOnDaySql('$1::uuid', 'c.id', 'c.recent_purchase_date')}");
    has(legacy, "AND ${kstNotFutureSql('c.recent_purchase_date')}");
    has(declBody(read('backend/src/utils/journey-goal-purchase.ts'), 'export function purchasedSinceEntrySql('),
      "AND pc.recent_purchase_date > (${e}.entered_at AT TIME ZONE 'Asia/Seoul')::date AND ${kstNotFutureSql('pc.recent_purchase_date')})");
  });
  it('몰 결제 시각(G9) = 보정 한 줄 · orderPaidAt 부르기 1 · 네 소비 자리가 그 paidAt', () => {
    const raw = read('backend/src/utils/cdp-orders.ts');
    const o = squash(raw);
    has(raw, 'const paidAt = clampOccurredAt(orderPaidAt(input), new Date()).toISOString();');
    expect((o.match(/orderPaidAt\(/g) || []).length).toBe(2);   // 정의 1 + 보정 줄 1
    expect((o.match(/\[existing\.id,input\.status,input\.totalAmount,srcAt,paidAt,/g) || []).length).toBe(2);   // 되살림 · 승격 UPDATE
    has(raw, "name: 'purchase', source: input.source, identityLinkId: idResult.linkId, customerId: idResult.customerId, properties: purchaseEventProperties(input, { revenue_applied: true, src_at: srcAt, ...extra }), occurredAt: paidAt");   // 신규 기록
    has(raw, 'const paidDay = kstDateKey(new Date(paidAt));');   // 요약 최근일
    expect((o.match(/input\.paidAt \?\?/g) || []).length).toBe(1);   // 결제 시각 계산 = orderPaidAt 정의 한 곳(R1)
  });
});

describe('K7 고객보다 먼저 온 원장 행 잇기 = 원장 적재 트랜잭션 안 · 요약 셈보다 먼저(G7)', () => {
  /** 가짜 run — 잇기(가져온 상수와 같은 문장)가 고객 b 를 돌려주고, 갈래 판정은 주어진 값 · 그 뒤 문장의 인자를 모은다. */
  const fakeRun = async (branch: { sticky: boolean; mall: boolean; ledger: boolean }) => {
    const { LINK_ORPHAN_LEDGER_ROWS_SQL } = await import('../two-door-purchase');
    const calls: Array<{ sql: string; params: any[] }> = [];
    const run = async (sql: string, params: any[] = []) => {
      calls.push({ sql, params });
      if (sql === LINK_ORPHAN_LEDGER_ROWS_SQL) return { rows: [{ customer_id: 'b' }] };
      if (squash(sql).includes('two_door_since IS NOT NULL AS sticky')) return { rows: [branch] };
      return { rows: [], rowCount: 0 };
    };
    return { run, calls, LINK_ORPHAN_LEDGER_ROWS_SQL };
  };
  /** 요약 칸을 실제로 쓰는 문장 = 고객 UPDATE 중 구매 횟수 칸을 쓰는 것(잠금 SELECT · 옛 값 옮기기 UPDATE 는 아니다). */
  const summaryUpdates = (calls: Array<{ sql: string; params: any[] }>) =>
    calls.filter((c) => /UPDATE customers c SET/.test(squash(c.sql)) && /purchase_count=/.test(squash(c.sql).replace(/ /g, '')));
  it.each([
    ['매장만', { sticky: false, mall: false, ledger: true }],
    ['두 문', { sticky: true, mall: true, ledger: true }],
  ])('%s 갈래: 첫 문장 = 잇기 · 요약 UPDATE 가 돌고 그 대상 = 이 적재 고객 + 이은 고객', async (_n, branch) => {
    const { applyLedgerIngestSummary } = await import('../customer-purchase-aggregates');
    const { run, calls, LINK_ORPHAN_LEDGER_ROWS_SQL } = await fakeRun(branch);
    await applyLedgerIngestSummary(run, 'co', ['a']);
    expect(calls[0].sql).toBe(LINK_ORPHAN_LEDGER_ROWS_SQL);
    const ups = summaryUpdates(calls);
    expect(ups).toHaveLength(1);
    expect(ups[0].params[1]).toEqual(expect.arrayContaining(['a', 'b']));
  });
  it('이 적재 고객이 없어도 이은 고객만으로 요약 UPDATE 가 돈다', async () => {
    const { applyLedgerIngestSummary } = await import('../customer-purchase-aggregates');
    const { run, calls } = await fakeRun({ sticky: false, mall: false, ledger: true });
    await applyLedgerIngestSummary(run, 'co', []);
    const ups = summaryUpdates(calls);
    expect(ups).toHaveLength(1);
    expect(ups[0].params[1]).toEqual(['b']);
  });
  it('잇기 SQL: 후보(CTE) = 고객 없는 행 · 최근 3일 · 순서 · 상한 / UPDATE = 같은 행 · 고객 없음 재확인(주석 밖)', async () => {
    const { LINK_ORPHAN_LEDGER_ROWS_SQL } = await import('../two-door-purchase');
    const sql = squash(LINK_ORPHAN_LEDGER_ROWS_SQL);
    const cte = sql.slice(sql.indexOf(squash('WITH cand AS (')), sql.indexOf('UPDATE purchases o'));
    const upd = sql.slice(sql.indexOf('UPDATE purchases o'));
    expect(cte).toContain(squash('o.customer_id IS NULL'));
    expect(cte).toContain(squash("o.created_at >= NOW() - INTERVAL '3 days'"));
    expect(cte).toContain(squash('ORDER BY o.created_at, o.id LIMIT 1000'));
    expect(cte).toContain(squash('cu.company_id = o.company_id AND cu.phone = o.customer_phone'));
    expect(upd).toContain(squash('SET customer_id = cand.cid, created_at = NOW()'));
    expect(upd).toContain(squash('WHERE o.id = cand.id AND o.customer_id IS NULL'));
    expect(upd).toMatch(/RETURNING o\.customer_id$/);   // 이은 고객 id 를 돌려줘야 요약 셈에 든다(Codex 9R · 지우면 이은 고객이 빠지고 다음 잇기에서도 IS NULL 로 안 잡힌다)
  });
});
