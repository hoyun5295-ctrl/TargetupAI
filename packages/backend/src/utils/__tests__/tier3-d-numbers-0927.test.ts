/**
 * 차수 3 ④ 수치·표시 (★ 2026-09-27 한줄로 V2)
 *
 * R091 분석 최적 시간·요일·히트맵이 UTC로 계산(9시간·요일 어긋남) → campaign_runs.sent_at(UTC 벽시계)을 KST로 바꾸는 CT.
 * R093 · R165 구매 전환·자동마케팅 매출이 수신자와 무관한 회사 전체 구매 → 발송 큐 실수신 번호로 귀속하는 CT.
 * R233 예측 입력이 발송 있는 날만(빈 날 누락) → 빈 날 0 채우기.
 * R239 등급 전환율 분모가 이벤트 JOIN 뒤 합계라 부풀음 → 발송 합과 전환을 따로 센다.
 * R250 · R251 인앱 귀속 매출이 클릭 수만큼 곱해지고 · 날짜 자정 비교로 노출 전 구매까지 귀속 → 고객당 1회 · KST 날짜로 클릭 다음 날부터.
 * R074 일평균이 호출 있는 날만 나눔 · 전월 대비가 이번 달 누계 vs 지난달 전체 → 창 일수로 · 지난달 같은 기간과 비교.
 * R365 누적 추천이 현재 제안 성과를 두 번 더함 → 누적에서 현재 제안 제외.
 * R317 공개 변이 보상 기록에 반복 제한 없음 → 방문자·변이당 30분 2회.
 * R264 실시간 위치가 마지막 끝낸 스텝을 현재로 셈 → 다음 스텝(current_step_order + 1).
 * R296 매장번호 사전 확인이 앞 1,000명만 → 미리보기 수 CT와 같은 상한.
 * R417 식별 고객 수 = 잘린 행 수(500) → 전체 수.
 * R204 원천 하나가 잘려도 합친 결과가 정확히 limit이면 커서 없음 → 어느 원천이든 잘렸으면 커서.
 * R063 배치 기록(started_at 없음)이 오늘 건수·오류 집계에서 빠짐 → 시각 폴백 · 동기화 1회 = 마지막 배치 1행.
 * R129 일일 인사이트 어제 발송 0 고정 → 발송통계와 같은 청구 축 실측.
 * R078 · R193 고객 평균 구매를 custom_fields에서 읽어 늘 0 → 표준 컬럼(같은 패턴 7곳 전부).
 * R183 자사몰 AI 진단이 모든 오류를 '건강도 50점'으로 → 크레딧·한도는 그대로 알리고 실패는 실패로 · 성공 뒤 차감.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const fe = (...p: string[]) => readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', ...p), 'utf8');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  if (i < 0) throw new Error(`못 찾음: ${a}`);
  const j = s.indexOf(b, i + a.length);
  return s.slice(i, j < 0 ? undefined : j);
};

describe('R091 분석 시각 = KST', () => {
  it('CT(행동) · 분석 시각·요일 추출이 CT를 거친다', async () => {
    const { kstFromNaiveUtc } = await import('../stats-aggregation');
    expect(kstFromNaiveUtc('cr.sent_at')).toBe("((cr.sent_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Seoul')");
    const a = src('..', 'routes', 'analysis.ts');
    expect(a).not.toContain('FROM cr.sent_at)');
    expect((a.match(/EXTRACT\(DOW FROM \$\{kstFromNaiveUtc\('cr\.sent_at'\)\}\)/g) || []).length).toBe(8);
    expect((a.match(/EXTRACT\(HOUR FROM \$\{kstFromNaiveUtc\('cr\.sent_at'\)\}\)/g) || []).length).toBe(6);
  });
});

describe('R093 · R165 실수신자 구매 귀속', () => {
  it('CT = 발송 큐 성공 번호 · 확인 못 한 캠페인은 0으로 넣지 않는다', () => {
    const r = src('recipient-conversion.ts');
    expect(r).toContain('return await readCampaignQueuedPhones(companyId, campaignId, camp.rows[0], { successOnly: true });');
    expect(r).toContain('= ANY($3::text[])');
    expect(r).toContain("if (phones === null || phones === undefined) continue;");
    expect(r).toContain("${kstFromNaiveUtc('cr.sent_at')}");
  });
  it('분석 구매 전환이 CT를 쓴다(회사 전체 구매 JOIN 제거)', () => {
    const a = src('..', 'routes', 'analysis.ts');
    expect(a).not.toContain('LEFT JOIN purchases pu ON pu.company_id = c.company_id');
    expect(a).toContain('const conv = await buildRecipientRunConversions(companyId, dateFrom, dateTo);');
  });
  it('자동마케팅 매출이 실수신자만 · 구매 1건 1회', () => {
    const m = src('automarketing-roi.ts');
    expect(m).toContain('const phones = await recipientPhonesOfCampaign(companyId, String(row.id));');
    expect(m).toContain('const seenEvents = new Map<string, number>();');
    expect(m).not.toContain('AND EXISTS (');
    expect(m).not.toMatch(/FROM purchases/);
  });
});

describe('R233 예측 입력 빈 날 0', () => {
  it('KST 날짜 전 구간을 만들고 발송 없는 날은 0', () => {
    const f = src('full-analysis-collect.ts');
    const b = between(f, 'export async function buildForecast(', '\n}\n');
    expect(b).toContain('generate_series(');
    expect(b).toContain('LEFT JOIN sent s ON s.d = days.d');
  });
});

describe('R239 등급 전환율 분모', () => {
  it('발송 합과 전환을 따로 센다', () => {
    const g = src('grade-conversion-stats.ts');
    expect(g).toContain('sent_by_grade AS (');
    expect(g).toContain('conv_by_grade AS (');
    expect(g).toContain('LEFT JOIN conv_by_grade cv ON cv.grade = s.grade');
  });
});

describe('R250 · R251 인앱 귀속', () => {
  it('고객당 1회 · 클릭 다음 KST 날짜부터', () => {
    const i = src('inapp-funnel-stats.ts');
    expect(i).not.toContain('recent_purchase_date::timestamptz');
    expect((i.match(/c\.recent_purchase_date > \(i\.occurred_at AT TIME ZONE 'Asia\/Seoul'\)::date/g) || []).length).toBe(2);
    const f = between(i, 'export async function buildInAppFunnel(', '\nexport ');
    expect(f).toContain('MAX(c.recent_purchase_amount) AS amount');
  });
});

describe('R074 AI 사용량', () => {
  it('일평균 = 창 일수 · 지난달 같은 기간 대비', () => {
    const u = src('..', 'routes', 'ai-usage.ts');
    expect(u).toContain('const dailyAvg = daily.reduce((s, d) => s + d.count, 0) / USAGE_WINDOW_DAYS;');
    expect(u).toContain("AND called_at <  LEAST(");
    const p = fe('pages', 'AiUsagePage.tsx');
    expect(p).not.toContain('전월 대비');
    expect(p).toContain('지난달 같은 기간 대비');
  });
});

describe('R365 누적 추천', () => {
  it('누적에서 현재 제안 변이를 뺀다', () => {
    const b = src('bandit-optimizer.ts');
    expect(between(b, 'export async function recommendVariantForProposal(', '\n}\n')).toContain('if (v.proposalId === proposalId) continue;');
  });
});

describe('R317 공개 변이 보상 반복 제한', () => {
  it('방문자·변이당 30분 2회', () => {
    const c = src('..', 'routes', 'cdp.ts');
    expect(c).toContain("router.post('/journey-variants/:variantId/track', requireCdpKeyOrBrowserOrigin, cdpVariantTrackOnce, async");
    expect(c).toContain('const cdpVariantTrackOnce = cdpBurstLimit(2, 30 * 60_000, (req, companyId) => `${companyId}:jv:${req.params.variantId}:${String((req.body || {}).anonymous_id || req.ip || \'\')}`);');
  });
});

describe('R264 여정 실시간 위치', () => {
  it('다음 스텝 = current_step_order + 1', () => {
    const j = src('journey-stats.ts');
    expect(j).not.toContain('je.current_step_order = js.step_order');
    expect((j.match(/je\.current_step_order \+ 1 = js\.step_order/g) || []).length).toBe(3);
  });
});

describe('R296 · R417 · R204 표시', () => {
  it('매장번호 사전 확인 = 미리보기 수와 같은 상한', () => {
    const a = src('..', 'routes', 'ai.ts');
    const b = between(a, "router.post('/operator/journeys/:id/activate'", '\nrouter.');
    expect(b).toContain('stRow.rows[0].trigger_filters || {}, JOURNEY_COUNT_CAP, undefined, undefined,');
  });
  it('식별 고객 수 = 전체', () => {
    const i = src('inapp-funnel-stats.ts');
    expect(i).toContain('COUNT(*) OVER ()::int AS identified_total');
    expect(i).toContain('identifiedTotal: Number(vRes.rows[0]?.identified_total) || 0,');
  });
  it('타임라인 = 어느 원천이든 잘렸으면 커서', () => {
    const t = src('customer-timeline.ts');
    expect(t).toContain('const anySourceTruncated = Object.values(sources).some((s) => !!s?.truncated);');
    expect(t).toContain('const nextBefore = (merged.length > limit || anySourceTruncated) && page.length > 0 ? encodeCursor(page[page.length - 1]) : null;');
  });
});

describe('R063 싱크 집계', () => {
  it('시각 폴백 · 동기화 1회 = 마지막 배치 1행', () => {
    const s = src('..', 'routes', 'admin-sync.ts');
    expect(s).not.toMatch(/WHERE started_at >= /);
    expect(s).not.toMatch(/AND started_at >= /);
    expect((s.match(/COALESCE\(started_at, completed_at\) >= \$\{KST_TODAY_START_SQL\}/g) || []).length).toBe(2);
    expect(s).toContain("COALESCE(started_at, completed_at) >= NOW() - INTERVAL '24 hours'");
    expect((s.match(/batch_index IS NULL OR batch_index >= total_batches/g) || []).length).toBe(2);
    expect(s).not.toContain('ORDER BY started_at DESC');
  });
});

describe('R129 일일 인사이트 어제 실적', () => {
  it('발송통계와 같은 청구 축 실측', () => {
    const d = src('daily-insight-mailer.ts');
    expect(d).not.toContain('yesterdaySent: 0,');
    expect(d).toContain('const dayData = await buildCompanyUsageByDay({ companyId, startDate: yesterday, endDate: yesterday });');
  });
});

describe('R078 · R193 고객 평균 구매 = 표준 컬럼', () => {
  it('custom_fields 구매 칸 읽기 0곳', () => {
    for (const f of [['..', 'routes', 'ai.ts'], ['citations.ts'], ['continuous-operator.ts'], ['crm-agency-proposal.ts']]) {
      const s = src(...f);
      expect(s, f.join('/')).not.toContain("custom_fields->>'purchase_count'");
      expect(s, f.join('/')).not.toContain("custom_fields->>'total_spent'");
    }
    expect((src('..', 'routes', 'ai.ts').match(/AVG\(purchase_count\)/g) || []).length).toBe(4);
  });
});

describe('R183 자사몰 AI 진단', () => {
  it('크레딧·한도는 그대로 던지고 실패는 실패로 · 성공 뒤 차감', () => {
    const x = src('cdp-fusion-explainer.ts');
    expect(x).toContain('if (err instanceof InsufficientCreditError || err instanceof AiRateLimitExceeded) throw err;');
    expect(x).not.toContain('자사몰 진단 영역 일시 오류');
    expect(x).toContain('const text = await runInCreditBundle(() => callAIWithFallback({');
    expect(x.indexOf('const parsed = JSON.parse(jsonStr);')).toBeLessThan(x.indexOf("source: 'cdp-fusion-explainer', idempotencyKey: `cdp-explain:${randomUUID()}`"));
    const c = src('..', 'routes', 'cdp.ts');
    const b = between(c, "router.post('/explain'", '\nrouter.');
    expect(b).toContain('if (err instanceof InsufficientCreditError) return res.status(402)');
    expect(b).toContain('if (err instanceof AiRateLimitExceeded) return res.status(429)');
  });
});

describe('Codex 차수3 D 1R — 성공 뒤 차감 확정 · 순매출 · KST 기간 경계', () => {
  it('성공 뒤 차감 확정 CT — 잔액 부족으로 실패하면 402로 막는다(세 자리 공통)', () => {
    const c = src('ai-credit.ts');
    const b = between(c, 'export async function settleCreditAfterSuccess(', '\n}\n');
    // 차감 시점의 잔액 부족을 그대로 던진다(재조회 없음 · Codex 차수3 D 2R)
    expect(b).toContain('await deductCreditOutcome({ ...opts, throwOnInsufficient: true });');
    expect(b).not.toContain('hasCreditForStrict');
    expect(c).toContain('if (opts.throwOnInsufficient) throw err;');
    expect(src('cdp-fusion-explainer.ts')).toContain('await settleCreditAfterSuccess({ companyId, cost: explainCost, source: \'cdp-fusion-explainer\', idempotencyKey: `cdp-explain:${randomUUID()}` });');
    expect(src('inapp-ai-generator.ts')).toContain('await settleCreditAfterSuccess({ companyId: input.companyId, cost: inappCost, source: \'inapp-ai-generator\', idempotencyKey: `inapp-ai:${randomUUID()}` });');
    expect(src('..', 'routes', 'ai.ts')).toContain('await settleCreditAfterSuccess({ companyId, cost: explainCost, source: \'ai-operator-explain\', idempotencyKey: `ai-explain:${randomUUID()}` });');
    const cdp = src('..', 'routes', 'cdp.ts');
    expect(between(cdp, "router.post('/inapp/ai-generate'", '\nrouter.')).toContain('if (err instanceof InsufficientCreditError) return res.status(402)');
  });
  it('자동마케팅 매출 = 결제 확정·미환불 주문만 · 같은 주문은 한 번', () => {
    const m = src('automarketing-roi.ts');
    // 주문 단위 판정 — 같은 주문의 행 하나라도 환불이면 주문 전체 제외(Codex 차수3 D 2R)
    expect(m).toContain("COALESCE(e.properties->>'revenue_reversed', '') = 'true' AS reversed,");
    expect(m).toContain("HAVING NOT bool_or(x.reversed) AND bool_or(x.paid)");
    expect(m).toContain("MAX(x.amount) FILTER (WHERE x.paid) AS amount");
    expect(m).toContain("e.source || ':' || COALESCE(NULLIF(e.properties->>'order_id', ''), e.id::text) AS order_key");
    expect(m).toContain('seenEvents.set(String(x.order_key), Number(x.amount) || 0);');
  });
  it('campaign_runs 기간 경계 = KST 자정(UTC 벽시계로 바꿔 비교)', async () => {
    const { kstDayStartNaiveUtc } = await import('../stats-aggregation');
    expect(kstDayStartNaiveUtc('$2')).toBe("((($2)::date::timestamp AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC')");
    const a = src('..', 'routes', 'analysis.ts');
    expect(a).not.toContain('cr.sent_at >= $2::date');
    expect(a).not.toContain("cr.sent_at < $3::date + INTERVAL '1 day'");
    expect((a.match(/cr\.sent_at >= \$\{kstDayStartNaiveUtc\('\$2'\)\}/g) || []).length).toBe(7);
    expect((a.match(/cr\.sent_at < \$\{kstDayStartNaiveUtc\('\(\$3\)::date \+ 1'\)\}/g) || []).length).toBe(7);
    const r = src('recipient-conversion.ts');
    expect(r).toContain("AND cr.sent_at >= ${kstDayStartNaiveUtc('$2')}");
    expect(r).toContain("AND cr.sent_at < ${kstDayStartNaiveUtc('($3)::date + 1')}");
  });
});
