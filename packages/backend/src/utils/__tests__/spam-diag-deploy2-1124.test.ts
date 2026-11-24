/**
 * 막힌 부분 짚어 보기 배포 2(★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §7 · §8 · §11)
 *   정본 문구(조사까지 · 두 말투) · 진단 대기 칸 · 담당자 문자 · 배선(워커 A 만 진단 · 문안 수정 = 같은 트랜잭션 닫기 · 메일 틱 · 화면) · 고객 문구 금지 낱말.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ default: { connect: vi.fn(), query: vi.fn() }, query: vi.fn(async () => ({ rows: [] })), mysqlQuery: vi.fn() }));

import { diagStateSentence, diagReasonText, markedTemplateLines, type SpamBlockHints } from '../spam-diag';
import { diagHoldOf, diagHoldJson } from '../agency-spam-diag';
import { buildTestFailedNotify } from '../agency-send-notify';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('정본 문구(설계서 §8-4)', () => {
  it('화면 = 해요체 · 문자 · 메일 = 합니다체 · 통신사 표시명(LG U+)', () => {
    expect(diagStateSentence('KT', 1, 'arrived')).toBe('글 속 주소를 빼니 KT에 도착했어요. 주소를 바꿔 보세요.');
    expect(diagStateSentence('LGU', 1, 'blocked')).toBe('글 속 주소를 빼도 LG U+에서 막혔어요. 주소만의 문제는 아니에요.');
    expect(diagStateSentence('SKT', 2, 'arrived')).toBe('표시한 줄을 빼니 SKT에 도착했어요. 그 줄의 표현을 바꿔 보세요.');
    expect(diagStateSentence('KT', 2, 'blocked')).toBe('표시한 줄을 빼도 KT에서 막혔어요.');
    expect(diagStateSentence('KT', 1, 'checking')).toBe('KT로 보내 확인하고 있어요.');
    expect(diagStateSentence('KT', 1, 'unknown')).toBe('확인을 마치지 못했어요.');
    expect(diagStateSentence('KT', 1, 'arrived', true)).toBe('글 속 주소를 빼니 KT에 도착했습니다. 주소를 바꿔 주세요.');
  });
  it('자격 사유 = 정본 셋', () => {
    expect(diagReasonText('permission')).toBe('이 발신번호로는 다시 확인할 수 없어요.');
    expect(diagReasonText('cap')).toBe('오늘은 더 확인할 수 없어요. 내일 다시 해 주세요.');
    expect(diagReasonText('off')).toBe('지금은 다시 확인할 수 없어요.');
    expect(diagReasonText('not_sendable')).toBe('지금은 다시 확인할 수 없어요.');
  });
  it('회신 메일 원문 = 의심 조각이 든 줄 앞 ▶ · 뒤로 민 조각 · 그 밖 조각은 표시 0', () => {
    const h: SpamBlockHints = { parent: {} as any, sentText: '', sendable: true, carriers: [{
      carrier: 'KT', baseline: null, checks: {}, next: 1, nextBasis: 'url', nextLines: [],
      suspects: [{ token: 'https://a.example/x', kind: 'url', line: 1 }, { token: '단독', kind: 'other', line: 2 }, { token: '혜택', kind: 'rule', line: 2, demoted: true }],
    }] };
    expect(markedTemplateLines('(광고) 하늘몰\n>https://a.example/x\n단독 혜택', h)).toEqual(['(광고) 하늘몰', '▶ >https://a.example/x', '단독 혜택']);
  });
});

describe('진단 대기 칸(last_test_result.diagHold)', () => {
  it('지금 문안 버전만 · 얹으면 검사 중 후보는 지운다 · 지우면 다른 칸은 그대로', () => {
    const hold = { parentTestId: 't1', version: 3, content: '글', rounds: 1, startedAt: '2026-11-24T00:00:00Z' };
    const row = { content_version: 3, last_test_result: { heldCandidate: { content: 'x' }, other: 1 } };
    const on = JSON.parse(diagHoldJson(row, hold)!);
    expect(on).toEqual({ other: 1, diagHold: hold });
    expect(diagHoldOf({ content_version: 3, last_test_result: on })).toEqual(hold);
    expect(diagHoldOf({ content_version: 4, last_test_result: on })).toBeNull();
    expect(JSON.parse(diagHoldJson({ last_test_result: on }, null)!)).toEqual({ other: 1 });
    expect(diagHoldJson({ last_test_result: { diagHold: hold } }, null)).toBeNull();
  });
});

describe('담당자 문자(M2)', () => {
  it('4a = 통신사 · 주소를 바꿔 주세요 · 로그인 주소 · 「세 차례」 0', () => {
    const t = buildTestFailedNotify({ label: '하늘몰 겨울 대축제', carriers: ['KT'], addressCause: true });
    expect(t).toBe('[대행발송] 문안이 KT 스팸 검사에 걸렸습니다.\n건: 하늘몰 겨울 대축제\n글 속 주소를 빼니 KT에 도착했습니다. 주소를 바꿔 주세요.\n로그인: hanjul.ai/agency-send');
  });
  it('그 밖 = 통신사 괄호 · 결과 한 줄(있을 때) · 「세 차례」 0', () => {
    const t = buildTestFailedNotify({ label: '건', carriers: ['KT', 'LG U+'], resultLine: '막혔을 수 있는 부분: 글 속 주소' });
    expect(t).toBe('[대행발송] 문안이 스팸 검사에 걸렸습니다(KT, LG U+).\n건: 건\n막혔을 수 있는 부분: 글 속 주소\n로그인하여 문안을 고쳐 주세요: hanjul.ai/agency-send');
    expect(buildTestFailedNotify({ label: '건' })).not.toMatch(/세 차례/);
  });
});

describe('배선(소스 계약)', () => {
  const worker = read('utils/agency-send-worker.ts');
  const change = read('utils/agency-send-change.ts');
  const mail = read('utils/agency-send-mail-worker.ts');
  it('워커 A 만 진단(diag: true) · 워커 B 는 진단 0 · 진단 대기 이어 보기가 runSpamRound 앞', () => {
    expect(worker.match(/runSpamRound\([^)]*\{ diag: true/g)?.length).toBe(1);
    expect(worker).toContain('await runSpamRound(target, 0);');
    const a = worker.indexOf('const hold = diagHoldOf(row);');
    expect(a).toBeGreaterThan(-1);
    expect(a).toBeLessThan(worker.indexOf("await runSpamRound(row, 0, { diag: true, resume });"));
  });
  it('진단 시작은 resume 아닐 때만 · 막힘 사건 뒤 · 다듬기 앞', () => {
    const i = worker.indexOf('if (opts.diag && !opts.resume)');
    expect(i).toBeGreaterThan(worker.indexOf("if (!resumedT) await logEvent(row.id, 'spam_blocked'"));
    expect(i).toBeLessThan(worker.indexOf('const refined = await refineForSpam('));
  });
  it('★ 배포 2 Codex 2R — 진단 대기 뒤 T 근거 통과는 당일 검사로 치지 않는다(final_test_at 0 · 발송일 워커 B 가 검사)', () => {
    expect(worker).toContain("const sameDaySend = detail?.resumedFrom !== 'diag' && isSameKstDay(passedAt, new Date(row.requested_at));");
    expect(worker).toContain("testIds: [opts.resume.preferTestId], resumedFrom: 'diag'");
  });
  it('★ 배포 2 Codex 2R — 화면 등록 = 사람 검사 · 대행 소유 진단 0(앞 확인 + 등록 트랜잭션 guard)', () => {
    const route = read('routes/spam-filter.ts');
    const a = route.indexOf("router.post('/tests/:id/diagnose'");
    const body = route.slice(a, route.indexOf('router.', a + 10));
    expect(body).toContain("${notAutoSpamSourceSql('t.source')}");
    // ★ 배포 2 Codex 3R — 소유 확인 뒤는 DB 정본 id 만(요청의 대문자 id 로 대행 소유 · 잠금 키가 어긋나지 않게)
    const after = body.slice(body.indexOf('const parentId = String(own.rows[0].id);'));
    expect(after.length).toBeLessThan(body.length);
    expect(after).toContain('if (await agencyOwnsDiag(parentId))');
    expect(after).toContain('registerDiag({ parentTestId: parentId,');
    expect(after).toContain('guard: async (run) => !(await agencyOwnsDiag(parentId, run))');
    expect(after).not.toMatch(/[(\s]testId[,)]/);   // 요청 id 를 인자로 넘기는 자리 0(r.testId 응답 칸은 제외)
  });
  it('★ 배포 2 Codex 3R — 재개 첫 회차가 T 를 이어 본 통과도 진단 재개 표시(당일 검사 0)', () => {
    const a = worker.indexOf('const resumedT = ');
    const mark = worker.indexOf("if (resumedT) detail.resumedFrom = 'diag';");
    expect(mark).toBeGreaterThan(a);
    expect(mark).toBeLessThan(worker.indexOf("if (verdict === 'pass') return { verdict, passed: true, finalContent: content, rounds, detail };", a));
  });
  it('★ 배포 2 Codex 3R — 4a 확정 사건 둘 = 상태와 같은 트랜잭션 COMMIT 앞 · 워커는 커밋 뒤 담당자 문자만', () => {
    const diag = read('utils/agency-spam-diag.ts');
    const fn = diag.slice(diag.indexOf('export async function settleAgencyDiag4a('), diag.indexOf('export async function releaseAgencyDiag('));
    const commit = fn.indexOf("await client.query('COMMIT');");
    const hint = fn.indexOf("branch: '4a'");
    const failed = fn.indexOf("agencyEvent(row.id, 'test_failed', { rounds: hold.rounds, reason: 'spam_address' }, run);");
    expect(hint).toBeGreaterThan(fn.indexOf("SET status = 'test_failed'"));
    expect(failed).toBeGreaterThan(-1);
    expect(Math.max(hint, failed)).toBeLessThan(commit);
    expect(fn).toContain('arrived: locked.arrived');
    const w = worker.slice(worker.indexOf('async function settleDiag4a('), worker.indexOf('export function lastSpamTestId('));
    expect(w).not.toMatch(/logEvent\(/);
    expect(w).toContain('await notifyManager(');
  });
  it('★ 배포 2 Codex 5R 구조 — 확인 문자 · 결과 행을 쓰는 문장(서버 전수) = 한 줄 키(id = $n) · 여러 줄은 판 행을 먼저 잠근 진단 닫기와 한 단말 한 줄 보고뿐', () => {
    const walk = (dir: string): string[] => readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? (d.name === '__tests__' ? [] : walk(`${dir}/${d.name}`)) : d.name.endsWith('.ts') ? [`${dir}/${d.name}`] : []);
    const multi: string[] = [];
    for (const f of ['utils', 'routes', 'services'].flatMap(walk)) {
      for (const m of read(f).matchAll(/`([^`]*UPDATE (?:spam_test_probes|spam_filter_test_results)\b[^`]*)`/g)) {
        if (/\bid = \$/.test(m[1])) continue;
        multi.push(`${f} ${(m[1].match(/WHERE[^\n]*/) || [''])[0].trim().slice(0, 60)}`);
      }
    }
    expect(multi.sort()).toEqual([
      // 보고 = 한 단말의 한 줄(검사 · 통신사 · 유형 · 번호)
      'routes/spam-filter.ts WHERE test_id = $1 AND carrier = $2 AND message_type = $3 AN',
      // 확인 문자 한 줄 닫기 = 부르는 쪽이 한 줄 키(id · 유일 키 message_hash)를 넘긴다(아래 시험)
      'utils/spam-probe.ts WHERE ${oneRowWhere}',
      // 진단 닫기 = lockDiagResultRows 가 판 행을 먼저 다 잠근 뒤(아래 시험)
      "utils/spam-diag.ts WHERE status IN ('claimed', 'sent')",
      "utils/spam-diag.ts WHERE (result IS NULL OR result = 'unconfirmed')",
      // 늦은 보고 표시 = 한 단말의 한 줄
      'utils/spam-test-queue.ts WHERE test_id = $1 AND phone = $2 AND carrier = $3 AND messa',
    ].sort());
    // 정리 작업 = 대상 id 를 먼저 읽고 한 줄씩(같은 조건을 다시 건다)
    const probe = read('utils/spam-probe.ts');
    expect(probe).toContain('closeProbeRow(`id = $${params.length + 1} AND ${probeWhere}`, [...params, id], probeTo, resultTo);');
    // ★ 6R — 보고 매칭 = 유일 키 한 줄을 고르기 · 기한 · 쓰기가 한 문장(closeProbes 의 두 단계를 거치지 않는다)
    const match = probe.slice(probe.indexOf('export async function matchProbeReport('));
    const matchBody = match.slice(0, match.indexOf('\n}\n'));
    expect(matchBody).toContain("const got = await closeProbeRow(\n    `message_hash = $1 AND phone = $2 AND carrier = $3 AND status IN ('claimed', 'sent') AND (deadline_at IS NULL OR deadline_at >= NOW())`");
    expect(matchBody).not.toContain('closeProbes(');
    expect(probe).toContain("WHERE t.id = $3 AND p.result_id = t.id AND p.status IN ('received', 'expired')");
    expect(probe).toContain("WHERE p.id = $1 AND p.result_id = r.id AND p.status = 'claimed'");
    expect(read('utils/spam-test-queue.ts')).toContain('WHERE id = $1 AND received = false AND result IS NULL');
    // 진단 쪽 T 결과 행 = id 순(4a · 등록)
    expect(read('utils/agency-spam-diag.ts')).toContain('SELECT id FROM spam_filter_test_results WHERE test_id = $1::uuid ORDER BY id FOR UPDATE');
    expect(read('utils/spam-test-queue.ts')).toContain('SELECT result FROM spam_filter_test_results WHERE test_id = $1::uuid AND carrier = $2 ORDER BY id FOR UPDATE');
  });
  it('★ 배포 2 Codex 3R · 4R 구조 — 판 행 잠금 순서 = lockDiagResultRows 한 곳(진단 잠금 → 확인 문자 → 결과 행 · 기한 처리와 같은 순) · 진단 닫기 · 4a 확정이 그것만 거친다', () => {
    const sd = read('utils/spam-diag.ts');
    const lk = sd.slice(sd.indexOf('export async function lockDiagResultRows('), sd.indexOf('export async function closeDiagnosis('));
    expect(lk.indexOf('DIAG_LOCK_SQL')).toBeGreaterThan(-1);
    expect(lk.indexOf('FROM spam_test_probes p')).toBeGreaterThan(lk.indexOf('DIAG_LOCK_SQL'));
    expect(lk.indexOf('FOR UPDATE OF r')).toBeGreaterThan(lk.indexOf('FROM spam_test_probes p'));
    const fn = sd.slice(sd.indexOf('export async function closeDiagnosis('), sd.indexOf('export function diagStateSentence('));
    const firstWrite = Math.min(...['UPDATE spam_test_probes', 'UPDATE spam_filter_test_results', 'UPDATE spam_filter_tests'].map((k) => fn.indexOf(k)).filter((i) => i >= 0));
    expect(fn.indexOf('await lockDiagResultRows(parentTestId, run)')).toBeGreaterThan(-1);
    expect(fn.indexOf('await lockDiagResultRows(parentTestId, run)')).toBeLessThan(firstWrite);
    expect(fn).not.toContain('DIAG_LOCK_SQL');   // 진단 잠금도 그 함수가 잡는다
    // 판 결과 행을 직접 잠그는 자리는 그 함수뿐(4a 확정은 그 함수를 부른다)
    expect((sd.match(/FOR UPDATE OF r/g) || []).length).toBe(1);
    const diag = read('utils/agency-spam-diag.ts');
    const s4a = diag.slice(diag.indexOf('export async function settleAgencyDiag4a('), diag.indexOf('export async function releaseAgencyDiag('));
    expect(s4a).toContain('await lockDiagResultRows(hold.parentTestId, run);');
    expect(s4a).not.toMatch(/spam_test_probes/);
    const probe2 = read('utils/spam-probe.ts');
    const cp = probe2.slice(probe2.indexOf('async function closeProbes('));
    expect(cp.indexOf('UPDATE spam_test_probes')).toBeLessThan(cp.indexOf('UPDATE spam_filter_test_results'));
  });

  it('문안 수정 = 잠근 행에서 진단 대기를 읽고 같은 트랜잭션 COMMIT 앞에서 닫는다', () => {
    const lock = change.indexOf('const openDiag = lockedRow.rows[0] ? diagHoldOf(lockedRow.rows[0]) : null;');
    const close = change.indexOf('if (openDiag) await closeDiagnosis(openDiag.parentTestId, q);');
    expect(lock).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(lock);
    expect(close).toBeLessThan(change.indexOf("await client.query('COMMIT'); committed = true;"));
  });
  it('메일 틱 = 회신 재시도 다음에 검사 결과 회신 패스(실패해도 틱을 멈추지 않음)', () => {
    expect(mail.indexOf('await sendPendingSpamResultMails(mailbox).catch(')).toBeGreaterThan(mail.indexOf('await retryPendingReplies(mailbox);'));
  });
  it('화면 = 검사 창이 카드를 그린다 · 진행 기록 표에 새 사건 둘 · 경고 창에 한 줄', () => {
    const FE = join(SRC, '..', '..', 'frontend', 'src');
    const modal = readFileSync(join(FE, 'components', 'SpamFilterTestModal.tsx'), 'utf8');
    const log = readFileSync(join(FE, 'components', 'agency', 'AgencyEventLog.tsx'), 'utf8');
    const warn = readFileSync(join(FE, 'components', 'direct-send', 'SendSpamWarnModal.tsx'), 'utf8');
    expect(modal).toContain('<SpamBlockHintCard');
    expect(log).toMatch(/spam_hint: '/);
    expect(log).toMatch(/spam_result_mail: '/);
    expect(warn).toContain("variant === 'blocked' && hintLine");
  });
  it('고객 문구 = 검사 방식 낱말 · 모델명 · 우리 쪽 원인 단정 · 줄표 0(새 화면 · 정본 문구 파일)', () => {
    const FE = join(SRC, '..', '..', 'frontend', 'src');
    const card = readFileSync(join(FE, 'components', 'SpamBlockHintCard.tsx'), 'utf8');
    const strings = (src: string) => (src.match(/'[^'\n]*'|`[^`\n]*`/g) || []).join('\n');
    for (const s of [strings(card), strings(read('utils/spam-diag.ts')), strings(read('utils/agency-spam-diag.ts'))]) {
      expect(s).not.toMatch(/테스트폰|시험 폰|시험폰|실제 휴대폰|장비 문제|Claude|Anthropic|GPT|Sonnet|Opus|Haiku|—/);
    }
  });
});
