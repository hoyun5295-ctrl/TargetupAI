/**
 * 차수 3 ⑥ 개선 (★ 2026-09-27 한줄로 V2) — 부하·속도·정리
 *
 * R180 자사몰 진단 이벤트 COUNT에 기간 하한 · R181 이벤트마다 즉시 재계산 제거(5분 워커가 한다) ·
 * R187 처리 끝난 웹훅 기록 보관 기한 · R200 페이지 조회 고객 행 갱신 10분 간격 ·
 * R125 스튜디오 임시 보관 상한을 모든 임시 쓰기에 · R249 인앱 진단 프롬프트의 근거 없는 효과 수치 제거 ·
 * R288 기억 검색 관련도 = 단어 단위 · R291 few-shot = 최근 발송 순 · R164 ROI 자사몰 보유 확인 = EXISTS ·
 * R196 정산 재시도 10분 간격 · R064 에이전트 상세 실패 상세 5건 + 총수.
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

describe('CDP 개선', () => {
  it('R180 진단 이벤트 COUNT = 30일 하한', () => {
    expect(src('cdp-diagnostics.ts')).toContain("FROM cdp_events\n      WHERE company_id = $1::uuid\n        AND occurred_at > NOW() - INTERVAL '30 days'");
  });
  it('R181 이벤트마다 즉시 재계산하지 않는다(워커가 한다)', () => {
    const e = src('cdp-events.ts');
    expect(e).not.toContain('void recomputeProfile(');
  });
  it('R187 처리 끝난 웹훅 기록은 보관 기한(★0928 전송자격인증 4.2 = 1년 이상 → 13개월) 뒤 정리', () => {
    const w = src('cdp-webhook-retry-worker.ts');
    expect(w).toContain("WHERE status IN ('processed', 'duplicate') AND created_at < NOW() - make_interval(days => $1)");
    expect(w).toContain('[LOG_RETENTION_DAYS],');
    expect(w).not.toContain("INTERVAL '180 days'");
    expect(readFileSync(join(__dirname, '..', '..', 'config', 'defaults.ts'), 'utf8')).toContain('export const LOG_RETENTION_DAYS = 395;');
  });
  it('R200 페이지 조회 고객 행 갱신 = 10분 간격', () => {
    const f = src('customer-cdp-fusion.ts');
    expect(f).toContain("AND (last_page_view_at IS NULL OR last_page_view_at < $2::timestamptz - INTERVAL '10 minutes')");
  });
});

describe('STUDIO · AI · ANAL · OPS · ADMIN 개선', () => {
  it('R125 임시 쓰기 라우트 전부 상한 확인', () => {
    const r = src('..', 'routes', 'image-studio.ts');
    for (const route of ["'/generate'", "'/edit'", "'/ingest-product'", "'/upload-product'", "'/remove-bg'", "'/compose'"]) {
      const b = between(r, `imageStudioRouter.post(${route}`, '\nimageStudioRouter.');
      expect(b, route).toContain("if (isStudioTempFull(companyId)) return respondStudioError(res, new StudioError('TEMP_FULL', 409));");
    }
    expect(src('image-studio.ts')).toContain('export function isStudioTempFull(companyId: string): boolean {');
  });
  it('R249 인앱 진단 프롬프트에 근거 없는 효과 수치 없음 · 통계 = 최근 30일', () => {
    const x = src('inapp-explainer.ts');
    expect(x).not.toContain('CTR +30~50%');
    expect(x).not.toContain('200~400자 권장');
    expect(x).not.toContain('추가 시 CTR +30% 예상');
    expect(x).toContain('[통계 (최근 30일)]');
  });
  it('R288 기억 검색 관련도 = 질문 단어 단위', () => {
    const m = src('..', 'routes', 'ai-memory.ts');
    expect(m).toContain('const queryTerms = Array.from(new Set(lowerQ.split(');
    expect(m).not.toContain('includes(lowerQ.slice(0, 20))');
  });
  it('R291 few-shot = 최근 발송 순(두 곳)', () => {
    const a = src('..', 'routes', 'ai.ts');
    expect(a).not.toMatch(/ORDER BY content\s+LIMIT 10/);
    expect((a.match(/ORDER BY MAX\(sent_at\) DESC/g) || []).length).toBe(2);
  });
  it('R164 ROI 자사몰 보유 확인 = EXISTS', () => {
    const m = src('automarketing-roi.ts');
    expect(m).toContain('SELECT EXISTS (');
    expect(m).not.toContain('SELECT COUNT(*)::int AS cnt FROM cdp_events');
  });
  it('R196 정산 재시도 = 마지막 시도 10분 뒤', () => {
    const o = src('continuous-operator.ts');
    const b = between(o, 'async function settlePendingCharges(', '\n}\n');
    expect(b).toContain("< to_char((NOW() AT TIME ZONE 'UTC') - INTERVAL '10 minutes', 'YYYY-MM-DD\"T\"HH24:MI:SS')");
  });
  it('R064 에이전트 상세 실패 상세 = 5건 + 총수', () => {
    const s = src('..', 'routes', 'admin-sync.ts');
    expect(s).toContain('AS failures_total');
    expect(fe('pages', 'AdminDashboard.tsx')).toContain('(log.failures_total ?? log.failures.length) > 5');
  });
});
