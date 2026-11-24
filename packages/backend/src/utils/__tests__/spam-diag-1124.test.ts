/**
 * 스팸 검사 확인 판(spam_diag) — 배포 1 제외 처리 계약 (★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §10-1 · §11)
 *
 * 확인 판 = 막힌 검사에서 의심 부분을 뺀 글을 막힌 통신사 단말에만 보내 보는 검사 행(출처 spam_diag · 고객 무료).
 * 못 박는 것
 *   1. 출처 값 하나(varchar 20 안) · 청구 제외 · 자동 검사 목록(함수판 · SQL판 같은 목록)에 들어간다.
 *   2. 고객에게 보이는 목록 · 건수에서 빼는 조각은 CT 하나(spamCustomerTestSql).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, relative, sep } from 'path';
import {
  SPAM_DIAG_SOURCE, spamBillableTestSql, isSpamTestBillable, isAutoSpamSource, notAutoSpamSourceSql, spamCustomerTestSql,
} from '../spam-trial';

const SRC = join(__dirname, '..', '..');

/** backend src 의 운영 소스(.ts · 시험 제외) */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') sourceFiles(p, out); }
    else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * 검사 표를 읽는 SQL(FROM · JOIN spam_filter_tests) 중 확인 판을 빼는 조각이 없는 자리를 파일별로 센다.
 *   조각 = spamCustomerTestSql(고객에게 보이는 목록 · 건수 · 이어 보기) · spamBillableTestSql(청구 제외 목록에 spam_diag 가 든다) ·
 *   notAutoSpamSourceSql(자동 목록에 spam_diag 가 든다 · 수동 창). 판정 창 = 그 자리부터 템플릿 문자열 끝(다음 백틱)까지.
 */
function uncoveredByFile(): Record<string, number> {
  const re = /(FROM|JOIN)\s+spam_filter_tests\b/g;
  const ok = /spamCustomerTestSql\(|spamBillableTestSql\(|notAutoSpamSourceSql\(/;
  const counts: Record<string, number> = {};
  for (const f of sourceFiles(SRC)) {
    const s = readFileSync(f, 'utf8');
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const end = s.indexOf('`', m.index);
      const win = s.slice(m.index, end < 0 ? m.index + 400 : end);
      if (ok.test(win)) continue;
      const key = relative(SRC, f).split(sep).join('/');
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return counts;
}

/**
 * 조각 없이 읽어도 되는 자리 = 고객에게 보이는 목록 · 건수가 아닌 내부 길(설계서 §10-1 「무변경」 줄).
 *   새 자리가 생기거나 아래 자리에서 조각이 빠진 고객 화면 쿼리가 늘면 수가 달라져 실패한다 → 그 자리를 §10-1 대로 분류한다.
 */
const INTERNAL_READS: Record<string, { n: number; why: string }> = {
  'routes/spam-filter.ts': { n: 4, why: '같은 글 진행 중 중복 막기(확인 판도 세야 수신 보고가 갈린다) · 체험 실패 정리 · 아이디로 한 건 읽기 둘' },
  'services/ai-line-spam.ts': { n: 1, why: '아이디로 한 건 읽기' },
  'utils/agency-send-worker.ts': { n: 5, why: '대행 묶음(batch) 기준 · 확인 판은 묶음 id 가 없다' },
  'utils/monthly-usage.ts': { n: 1, why: '차감 거래 기준 집계 · 확인 판은 차감 0' },
  'utils/precheck-usage.ts': { n: 1, why: '아이디로 한 건 읽기' },
  'utils/spam-probe.ts': { n: 3, why: '확인 문자 다시 보내기 · 첫 선점 · sendProbe 의 출처 읽기(확인 판도 같은 길 · 관문은 sendProbe 안)' },
  'utils/spam-diag.ts': { n: 7, why: '확인 판 CT 자체(부모 읽기 · 판 읽기 · 있는 판 찾기 · 판 행 잠금 둘(확인 문자 → 결과 행 · ★ Codex 4R) · 닫기 둘) · 지난 통과 글 읽기는 조각을 쓴다' },
  'utils/spam-test-queue.ts': { n: 18, why: '확인 판 등록(같은 판 찾기 · 하루 상한 셈 · 충돌 뒤 다시 찾기) · 수신 보고 귀속 · 대기열 집기 · 멈춘 검사 정리 · 실행 · 확인 판 관문의 판 읽기 · 기다림 · 아이디 · 묶음 읽기(확인 판도 같은 길)' },
  'utils/spam-test-view.ts': { n: 1, why: '대기열 앞사람 수(확인 판도 실제로 줄을 선다)' },
  'utils/spam-trial.ts': { n: 2, why: "체험 셈(source = 'trial' 행만)" },
};

describe('확인 판 출처 값', () => {
  it('값 = spam_diag · 칸 길이(varchar 20) 안', () => {
    expect(SPAM_DIAG_SOURCE).toBe('spam_diag');
    expect(SPAM_DIAG_SOURCE.length).toBeLessThanOrEqual(20);
  });

  it('청구 제외(고객 무료) — 함수판 · SQL판', () => {
    expect(isSpamTestBillable('spam_diag')).toBe(false);
    expect(spamBillableTestSql('t')).toBe("COALESCE(t.source, 'manual') NOT IN ('trial', 'auto_ai_free', 'spam_diag')");
  });

  it('자동 검사 목록에 든다(수동 창 복원 제외 · 자동 시간 값) — 함수판 · SQL판 같은 목록', () => {
    expect(isAutoSpamSource('spam_diag')).toBe(true);
    expect(notAutoSpamSourceSql('t.source')).toBe("COALESCE(t.source, '') NOT IN ('auto_ai', 'auto_ai_free', 'spam_diag')");
  });

  it('고객에게 보이는 목록 · 건수 조각 = 확인 판만 뺀다(표시값 없는 옛 행은 남는다)', () => {
    expect(spamCustomerTestSql('t')).toBe("COALESCE(t.source, '') <> 'spam_diag'");
  });
});

describe('기계 추출 계약 — 검사 표를 읽는 SQL 전수(설계서 §10-1 · §11)', () => {
  it('조각 없이 읽는 자리 = 내부 길 허용 목록과 파일 · 수가 정확히 같다', () => {
    const want = Object.fromEntries(Object.entries(INTERNAL_READS).map(([k, v]) => [k, v.n]));
    expect(uncoveredByFile()).toEqual(want);
  });

  it('§10-1 「확인 판 제외」 자리마다 조각이 있다', () => {
    const src = (p: string) => readFileSync(join(SRC, p), 'utf8');
    const expectCount = (p: string, n: number) => expect((src(p).match(/spamCustomerTestSql\(/g) || []).length, p).toBeGreaterThanOrEqual(n);
    expectCount('routes/spam-filter.ts', 3);        // recent-check · 목록 개수 · 목록
    expectCount('routes/campaigns.ts', 2);          // 검사 집계 · 최근 100건
    expectCount('routes/manage-stats.ts', 1);       // 상세 목록(집계는 청구 제외 조각이 WHERE 에 있다)
    expectCount('routes/admin.ts', 3);              // 상세 · 판정 집계 · 차단 문안 표본
    expectCount('services/ai-line-spam.ts', 1);     // 사용자 자동 검사 점유
    expectCount('utils/precheck-usage.ts', 1);      // 사전 점검 이용 기록
    expectCount('utils/performance-benchmark.ts', 1); // 통신사 차단율 지표
    expectCount('utils/spam-probe.ts', 1);          // 하루 측정(R36)
    expectCount('utils/spam-test-queue.ts', 1);     // 같은 검사 이어 보기(spamCheckFor)
  });
});
