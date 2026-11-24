// replaces: none
/**
 * C150 스팸 검사 통신사 늦은 전달 판정 + 재검사 대기 — 계약 시험(★ 2026-11-21 · 설계서 docs/2026-11-21-c150-spam-carrier-delay-retest-design.md §5)
 *   K1 · K2(R103) 늦은 보고 창 = 조각 하나 · 자동 시간 초과 줄 칸이 실측 지연을 덮는다
 *   K3 미가입 0 — 사람 검사 값 그대로 · 고객 문구 「길어도 N분」 ≥ 화면 마감
 *   K4(R89 넓힘) 보류 사건 종류 한 곳 · 감시가 뜬다 · runSpamRound 첫머리가 보류 묶음 장애를 장애로
 *   K6(R104) 하루 측정 경보 = 날짜 키 + 24시간 쿨다운
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { stripComments } from './helpers/producer-scan';
import {
  SPAM_LATE_REPORT_MINUTES, SPAM_AUTO_LATE_REPORT_MINUTES, SPAM_PROBE_AFTER_MINUTES, spamRowLateMinutesSql, spamProbeAfterMinutesSql,
} from '../spam-test-queue';
import { PROBE_DEADLINE_MINUTES, PROBE_RECLAIM_MINUTES, spamMeasureWindow } from '../spam-probe';

const BE = join(__dirname, '..', '..');
const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const be = (rel: string) => read(join(BE, rel));
function sourceFiles(root: string, ext: RegExp): string[] {
  return (readdirSync(root, { recursive: true }) as string[])
    .map((f) => String(f).replace(/\\/g, '/'))
    .filter((f) => ext.test(f) && !/(^|\/)__tests__\//.test(f) && !/\.(test|spec|verify)\.tsx?$/.test(f) && !/(^|\/)(dist|dist-old|node_modules)\//.test(f));
}
/** 함수 선언 본문 글(구문 트리) */
function fnBody(rel: string, name: string): string {
  const src = be(rel);
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true);
  let out = '';
  const visit = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name && n.body) out = n.body.getText(sf);
    else ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** 1121 금강제화 LG U+ 실측 — 검사 닫힘 08:04:22 → 전달 08:18:41(닫힌 뒤 지연 초) */
const MEASURED_CARRIER_DELAY_AFTER_CLOSE_S = 860;

describe('K1 · K2 (R103) 늦은 보고 창 = 조각 하나 · 자동 시간 초과 줄 칸이 실측 지연을 덮는다', () => {
  it('스팸 검사 표를 쓰는 파일에서 닫힌 시각을 NOW() 와 견주는 SQL = 전부 창 조각을 거친다 · 날 삽입 0', () => {
    const files = sourceFiles(BE, /\.ts$/).filter((f) => be(f).includes('spam_filter_tests'));
    const sites: string[] = [];
    const bad: string[] = [];
    for (const f of files) {
      const src = stripComments(be(f));
      const re = /completed_at\s*(?:>=|<=|<|>)\s*NOW\(\)\s*-/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const after = src.slice(m.index, m.index + 200);
        sites.push(`${f}@${m.index}`);
        if (!/spamRowLateMinutesSql\(|spamProbeAfterMinutesSql\(/.test(after)) bad.push(`${f}: ${after.slice(0, 90)}`);
      }
      if (/\$\{SPAM_LATE_REPORT_MINUTES\}\s*minutes/.test(src)) bad.push(`${f}: 늦은 보고 창 날 삽입`);
    }
    expect(sites.length).toBeGreaterThanOrEqual(3);   // 고칠 수 있는 때 · lateOpen · 확인 문자 시작(뽑기가 살아 있다)
    expect(bad).toEqual([]);
  });
  it('자동 · 시간 초과 줄 칸 ≥ 실측 지연 × 2 · 조각이 그 상수를 쓴다', () => {
    expect(SPAM_AUTO_LATE_REPORT_MINUTES * 60).toBeGreaterThanOrEqual(2 * MEASURED_CARRIER_DELAY_AFTER_CLOSE_S);
    expect(spamRowLateMinutesSql('t', 'lr.result')).toBe(
      `(CASE WHEN lr.result = 'timeout' AND NOT (COALESCE(t.source, '') NOT IN ('auto_ai', 'auto_ai_free', 'spam_diag')) THEN ${SPAM_AUTO_LATE_REPORT_MINUTES} ELSE ${SPAM_LATE_REPORT_MINUTES} END)`,
    );
  });
});

describe('K3 미가입 0 — 사람 검사 값 그대로 · 고객 문구 상한', () => {
  it('사람 검사 = 늦은 보고 10분 · 기한 5분 · 다시 보내기 2분(옛 값) · 확인 문자 시작 = 사람 · 자동 모두 1분(★ 1124 Harold 「1분으로 바꿔」 · 옛 사람 10분)', () => {
    expect([SPAM_LATE_REPORT_MINUTES, PROBE_DEADLINE_MINUTES, PROBE_RECLAIM_MINUTES, SPAM_PROBE_AFTER_MINUTES]).toEqual([10, 5, 2, 1]);
    expect(spamProbeAfterMinutesSql('t')).toBe('(1)');
  });
  it('고객 화면 · 서버 문구 「길어도 N분」 = 화면 다시 읽기 마감(spamTestFinalBy = 10 + 5 + 2 + 2분) 이상', () => {
    const finalByMin = SPAM_LATE_REPORT_MINUTES + PROBE_DEADLINE_MINUTES + PROBE_RECLAIM_MINUTES + 2;
    const hits: Array<{ f: string; n: number }> = [];
    for (const [root, tag, ext] of [[FE, 'frontend/src', /\.tsx?$/], [BE, 'backend/src', /\.ts$/]] as const) {
      for (const f of sourceFiles(root, ext)) {
        const src = stripComments(read(join(root, f)));
        for (const m of src.matchAll(/길어도 (\d+)분/g)) hits.push({ f: `${tag}/${f}`, n: Number(m[1]) });
      }
    }
    expect(hits.length).toBeGreaterThanOrEqual(5);
    expect(hits.filter((h) => h.n < finalByMin)).toEqual([]);
  });
});

describe('K4 (R89 넓힘) 보류 깨우기 · 보류 장애 셈', () => {
  const W = 'utils/agency-send-worker.ts';
  it('보류 사건을 쓰는 자리 = settleSpamHold 하나 · 종류 = SPAM_HOLD_EVENT(감시 · 묶음 읽기와 같은 상수) · 검사 id 를 싣는다', () => {
    const src = stripComments(be(W));
    expect(src.match(/'spam_check_hold'/g)).toHaveLength(1);   // 상수 정의 한 곳
    expect(src).toContain("export const SPAM_HOLD_EVENT = 'spam_check_hold';");
    const hold = fnBody(W, 'settleSpamHold');
    expect(hold).toContain('const recorded = await insertAgencyEvent(row.id, SPAM_HOLD_EVENT, {');
    expect(hold).toContain('testIds: Array.isArray(detail?.testIds) ? detail.testIds.map(String) : [],');
    // ★ Codex 구현 1R #2 — 보류 사건을 못 남기면 보류로 돌리지 않고 장애 갈래(사건 = 셈의 근거 · 삼키지 않는다) · 상태 되돌림보다 앞
    const guard = hold.indexOf('if (!recorded) { await settleSpamCheckError(row, token, backTo, phase, detail).catch(() => undefined); return; }');
    expect(guard).toBeGreaterThan(0);
    expect(hold.indexOf('const back = await setStatus(')).toBeGreaterThan(guard);
    expect(hold).not.toMatch(/logEvent\(row\.id, SPAM_HOLD_EVENT/);
    expect(fnBody(W, 'insertAgencyEvent')).not.toMatch(/catch/);
  });
  it('★ Codex 구현 2R(1R #2 와 같은 뿌리) — 판정이 SQL 로 읽는 스팸 검사 사건(spam_check_*) · 보류 사건은 삼키는 logEvent 로 쓰지 않는다 · 장애 사건을 못 남기면 상태를 안 되돌린다', () => {
    const src = stripComments(be(W));
    const readKinds = [...new Set([...src.matchAll(/kind\s*=\s*'(spam_check_[a-z_]+)'/g)].map((m) => m[1]))].sort();
    expect(readKinds).toEqual(['spam_check_error', 'spam_check_recovered']);   // 뽑기가 살아 있다(새 종류 = 이 줄이 실패)
    // 둘째 인자(사건 종류)가 그 종류인 logEvent(다른 사건 payload 안의 같은 글자 = reason: 'spam_check_error' 는 종류가 아니다)
    for (const k of readKinds) expect(src, k).not.toMatch(new RegExp(`logEvent\\([^,()]+,\\s*'${k}'`));
    expect(src).not.toMatch(/logEvent\([^,()]+,\s*SPAM_HOLD_EVENT/);
    const err = fnBody(W, 'settleSpamCheckError');
    const write = err.indexOf("await insertAgencyEvent(row.id, 'spam_check_error', { phase, version, batchId: batchId || null });");
    const bail = err.indexOf('return;', write);
    expect(write).toBeGreaterThan(0);
    expect(bail).toBeGreaterThan(write);
    expect(err.indexOf('withSpamRecoverLock(')).toBeGreaterThan(bail);   // 상태 전환(잠금 구역)은 사건을 남긴 뒤
    expect(fnBody(W, 'heldSpamBatch')).toContain('e.kind !== SPAM_HOLD_EVENT');
    expect(fnBody(W, 'wakeResolvedSpamHolds')).toContain('[SPAM_HOLD_EVENT],');
  });
  it('감시 = 보류가 아니면(통과 · 차단 · 장애) 깨운다 · 일꾼이 띄운다', () => {
    expect(fnBody(W, 'wakeResolvedSpamHolds')).toContain('if (held && !isSpamHold(held.verdict)) woke.push(String(row.id));');
    const start = fnBody(W, 'startAgencySendWorker');
    expect(start).toMatch(/setInterval\(\(\) => \{\s*void wakeResolvedSpamHolds\(\)/);
    expect(start).toContain('}, SPAM_HOLD_WAKE_MS);');
  });
  it('runSpamRound — 검사 회차의 detail 에 검사 id · 보류 묶음 장애 = 검사 호출 앞에서 장애로 돌려준다(새 검사 0)', () => {
    const body = fnBody(W, 'runSpamRound');
    const held = body.indexOf('const held = await heldSpamBatch(String(row.id), Number(row.content_version || 0));');
    // ★ 1122 C158 — 보류 묶음 장애 갈래 = 블록(접수 거절이면 반려 · 아니면 장애) · 어느 쪽이든 검사 호출 앞에서 돌려준다(새 검사 0)
    const guardOpen = body.indexOf("if (held && held.verdict === 'error') {");
    const guard = body.indexOf("return { verdict: 'error', passed: false, finalContent: original, rounds: startRound, detail: { batchId: held.batchId } };", guardOpen);
    expect(guardOpen).toBeGreaterThan(0);
    const call = body.indexOf('await autoSpamTestWithRegenerate(');
    expect(held).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(held);
    expect(call).toBeGreaterThan(guard);
    expect(body).toContain('testIds: Object.values(result.testIds ?? {})');
    // 부르는 쪽 두 곳 = 장애 갈래가 detail 을 그대로 장애 마감에 넘긴다(같은 묶음 회복 키)
    const src = stripComments(be(W));
    expect(src).toContain("if (verdict === 'error') { await settleSpamCheckError(row, token, 'received', 'first', detail); continue; }");
    expect(src).toMatch(/settleSpamCheckError\(target, token, 'approved', 'final', detail\)/);
  });
  it('★ Codex 구현 1R #1 — 발송 직전 단계 선점 = 후보를 읽을 때의 revision 조건(두 갈래 모두 같은 문장) · 인라인 선점 0', () => {
    const body = fnBody(W, 'finalTestRow');
    expect(body.match(/await query\(FINAL_STAGE_CLAIM_SQL, \[row\.id, Number\(row\.revision\)\]\)/g)).toHaveLength(2);
    expect(body).not.toMatch(/SET status = 'final_testing'/);
    const src = stripComments(be(W));
    expect(src.match(/SET status = 'final_testing'/g)).toHaveLength(1);   // 상수 정의 한 곳
    expect(src).toMatch(/WHERE id = \$1::uuid AND status = 'approved' AND revision = \$2::int RETURNING \*`;/);
  });
});

describe('K6 (R104) 하루 측정 경보 = 날짜 키 + 24시간 쿨다운', () => {
  it('measureSpamVerdicts 의 경보 = 한국 날짜 키 · 쿨다운 24시간', () => {
    const src = be('utils/spam-probe.ts');
    const sf = ts.createSourceFile('spam-probe.ts', src, ts.ScriptTarget.Latest, true);
    const found: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && n.expression.getText(sf) === 'sendSystemAlert' && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
        const arg = n.arguments[0];
        const dk = arg.properties.find((p) => p.name?.getText(sf) === 'dedupKey');
        const cd = arg.properties.find((p) => p.name?.getText(sf) === 'cooldownMs');
        if (dk && ts.isPropertyAssignment(dk) && dk.initializer.getText(sf).includes('spam-verdict-after-decided')) {
          found.push(`${dk.initializer.getText(sf)} | ${cd && ts.isPropertyAssignment(cd) ? cd.initializer.getText(sf) : '없음'}`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(found).toEqual(['`spam-verdict-after-decided:${w.day}` | 24 * 60 * 60 * 1000']);
  });
  it('★ 배포 뒤 19:31 메일 — 자료 창 = 그 날짜 키의 [전날 09시, 그날 09시) · 몇 시에 돌든 같은 날 = 같은 창 · 이웃 날 창은 겹침 · 빈틈 0 · 「돌린 때부터 24시간」 0', () => {
    const at0931 = spamMeasureWindow(new Date('2026-11-21T00:31:00Z'));   // 한국 09:31
    const at1931 = spamMeasureWindow(new Date('2026-11-21T10:31:49Z'));   // 한국 19:31(배포 재시작)
    expect(at1931).toEqual(at0931);
    expect(at1931).toEqual({ day: '20261121', start: new Date('2026-11-20T00:00:00Z'), end: new Date('2026-11-21T00:00:00Z') });
    const next = spamMeasureWindow(new Date('2026-11-22T00:05:00Z'));     // 다음 날 한국 09:05
    expect(next.day).toBe('20261122');
    expect(next.start.getTime()).toBe(at1931.end.getTime());              // 그날 끝 = 다음 날 시작
    const body = fnBody('utils/spam-probe.ts', 'measureSpamVerdicts');
    expect(body).toContain('const w = spamMeasureWindow(now);');
    expect(body).toContain('[w.start, w.end],');
    expect(body).not.toMatch(/INTERVAL '24 hours'/);
  });
});
