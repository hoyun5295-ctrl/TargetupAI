/**
 * 막힌 부분 짚어 보기 배포 2(★2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §7 · §8 · §11)
 *   정본 문구(조사까지 · 두 말투) · 진단 대기 칸 · 담당자 문자 · 배선(워커 A 만 진단 · 문안 수정 = 같은 트랜잭션 닫기 · 메일 틱 · 화면) · 고객 문구 금지 낱말.
 *   ★ 2026-11-26 C164(설계서 docs/2026-11-25-spam-diag-rewrite-design.md) — 판 = 「뺀 글」에서 「목적을 지킨 채 바꾼 글」로 · 4a 없앰 · 찾은 글 이어받기(diagFix) · 새 화면 입구 셋. 옛 판 문구 · 4a 계약은 새 계약으로 바꿨다.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ default: { connect: vi.fn(), query: vi.fn() }, query: vi.fn(async () => ({ rows: [] })), mysqlQuery: vi.fn() }));

import { plateName, plateStateText, triedPlatesLine, diagReasonText, markedTemplateLines, assemblerLegalLine, screenRenderer, SPAM_FIX_TEXT, type SpamBlockHints, type Plate } from '../spam-diag';
import { editableLines } from '../spam-block-hint';
import { buildAdMessage } from '../messageUtils';
import { diagHoldOf, diagHoldJson, diagFixOf, agencyFixLines } from '../agency-spam-diag';
import { buildTestFailedNotify } from '../agency-send-notify';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

describe('정본 문구(설계서 §8-4)', () => {
  const plate = (kind: Plate['plan']['kind'], results: Plate['results']): Plate => ({ testId: 't', n: 1, userId: 'u', plan: { kind } as any, text: '', subject: null, createdAt: '', results });
  it('판 이름 넷 · 판 상태 = 확인 중 · 닿음(보낸 통신사 전부) · 막힘(막은 통신사만) · 확인 못 함 · 화면 = 해요체 · 문자 · 메일 = 합니다체 · 통신사 표시명(LG U+)', () => {
    expect([plateName('w1'), plateName('w1u'), plateName('w2'), plateName('w2u')]).toEqual(['표현을 바꾼 글', '주소도 바꾼 글', '글을 새로 쓴 글', '새로 쓴 글에 주소도 바꾼 글']);
    expect(plateStateText(plate('w1', [{ carrier: 'KT', state: 'checking' }, { carrier: 'LGU', state: 'arrived' }]))).toBe('확인하고 있어요');
    expect(plateStateText(plate('w1', [{ carrier: 'KT', state: 'arrived' }, { carrier: 'LGU', state: 'arrived' }]))).toBe('KT, LG U+에 닿았어요');
    expect(plateStateText(plate('w1', [{ carrier: 'KT', state: 'blocked' }, { carrier: 'LGU', state: 'arrived' }]))).toBe('KT에서 막혔어요');
    expect(plateStateText(plate('w1', [{ carrier: 'KT', state: 'blocked' }, { carrier: 'LGU', state: 'unknown' }]))).toBe('확인을 마치지 못했어요');
    expect(plateStateText(plate('w1', [{ carrier: 'KT', state: 'blocked' }]), true)).toBe('KT에서 막혔습니다');
    expect(plateStateText(plate('w1', [{ carrier: 'SKT', state: 'arrived' }]), true)).toBe('SKT에 닿았습니다');
  });
  it('해 본 것 한 줄 = 결과가 정해진 판만(확인 중은 뺀다) · 받기 실패 문장 둘', () => {
    const plates = [plate('w1', [{ carrier: 'KT', state: 'blocked' }]), plate('w1u', [{ carrier: 'KT', state: 'checking' }])];
    expect(triedPlatesLine(plates, true)).toBe('표현을 바꾼 글: KT에서 막혔습니다.');
    expect(triedPlatesLine([plates[1]])).toBe('');
    expect(SPAM_FIX_TEXT).toEqual({ changed: '글이 바뀌어 넣을 수 없어요. 지금 글로 다시 검사해 주세요.', smsTooLong: '바꾼 글이 SMS 길이를 넘어 넣을 수 없어요.' });
  });
  it('자격 사유 = 정본 셋', () => {
    expect(diagReasonText('permission')).toBe('이 발신번호로는 다시 확인할 수 없어요.');
    expect(diagReasonText('cap')).toBe('오늘은 더 확인할 수 없어요. 내일 다시 해 주세요.');
    expect(diagReasonText('off')).toBe('지금은 다시 확인할 수 없어요.');
    expect(diagReasonText('not_sendable')).toBe('지금은 다시 확인할 수 없어요.');
    // ★ 1126 C164 — 새 사유 둘(고칠 줄 없음 · 주소를 못 바꿈) · 소유 · 닫힘은 같은 문장
    expect(diagReasonText('no_editable')).toBe('이 글은 바꿔 볼 줄이 없어요.');
    expect(diagReasonText('url')).toBe('주소는 바꾸지 못했어요.');
    expect(diagReasonText('owned')).toBe('지금은 다시 확인할 수 없어요.');
    expect(diagReasonText('closed')).toBe('지금은 다시 확인할 수 없어요.');
  });
  it('회신 메일 원문 = 의심 조각이 든 줄 앞 ▶ · 뒤로 민 조각 · 그 밖 조각은 표시 0', () => {
    const h: SpamBlockHints = { parent: {} as any, sentText: '', sendable: true, plates: [], carriers: [{
      carrier: 'KT', baseline: null,
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
  it('★ 1126 C164 찾은 글(diagFix) = 대기를 지우는 같은 값에 얹는다 · 지금 문안 버전만 · 그 뒤 대기를 지워도(장애 재시도) 남는다', () => {
    const hold = { parentTestId: 't1', version: 3, content: '글', rounds: 1, startedAt: '2026-11-26T00:00:00Z' };
    const fix = { version: 3, content: '바꾼 글', plateTestId: 'p1', rounds: 1 };
    const on = JSON.parse(diagHoldJson({ last_test_result: { diagHold: hold, other: 1 } }, null, fix)!);
    expect(on).toEqual({ other: 1, diagFix: fix });
    expect(diagFixOf({ content_version: 3, last_test_result: on })).toEqual(fix);
    expect(diagFixOf({ content_version: 4, last_test_result: on })).toBeNull();
    expect(JSON.parse(diagHoldJson({ last_test_result: on }, null)!)).toEqual({ other: 1, diagFix: fix });
  });
});

describe('★ 1126 C164 승인 문자의 바꾼 곳 줄(설계서 §10-2 · 고객이 낸 글 ↔ 통과해 저장한 글)', () => {
  it('줄마다 「원래 → 바꾼」 · 주소를 바꿨으면 주소 줄 · 글이 같으면 줄 없음', () => {
    process.env.DM_SHORT_LINK_BASE = 'https://hlj.kr';
    expect(agencyFixLines('겨울 혜택 안내\n>https://tinyurl.example/zz9\n매장에서 만나요', '겨울 소식 안내\n>https://hlj.kr/Ab12cd\n매장에서 만나요')).toEqual([
      '스팸 검사에 걸려 아래처럼 바꿨습니다. 승인하시면 바꾼 글로 보냅니다.',
      '겨울 혜택 안내 → 겨울 소식 안내',
      '>https://tinyurl.example/zz9 → >https://hlj.kr/Ab12cd',
      '글 속 주소는 같은 곳으로 가는 한줄로 짧은 주소로 바꿨습니다.',
    ]);
    expect(agencyFixLines('같은 글', '같은 글')).toEqual([]);
    // 줄 수가 달라진 글(다듬기가 줄을 합침) = 줄 대조 없이 머리 줄만
    expect(agencyFixLines('첫 줄\n둘째 줄', '한 줄로 합친 글')).toEqual(['스팸 검사에 걸려 아래처럼 바꿨습니다. 승인하시면 바꾼 글로 보냅니다.']);
  });
});

describe('담당자 문자(M2)', () => {
  it('★ 1126 C164 — 「주소를 바꿔 주세요」로 멈추는 문자(4a)는 없다(문구 · 인자 0)', () => {
    const notify = read('utils/agency-send-notify.ts');
    expect(notify).not.toMatch(/addressCause|주소를 바꿔 주세요/);
  });
  it('막힘 문자 = 통신사 괄호 · 결과 한 줄(있을 때) · 「세 차례」 0', () => {
    const t = buildTestFailedNotify({ label: '건', carriers: ['KT', 'LG U+'], resultLine: '막혔을 수 있는 부분: 글 속 주소' });
    expect(t).toBe('[대행발송] 문안이 스팸 검사에 걸렸습니다(KT, LG U+).\n건: 건\n막혔을 수 있는 부분: 글 속 주소\n로그인하면 문안을 고치거나 검사 결과와 관계없이 그대로 보내기를 고를 수 있어요: hanjul.ai/agency-send');   // ★ 2026-11-24 그대로 보내기 안내
    expect(buildTestFailedNotify({ label: '건' })).not.toMatch(/세 차례/);
  });
});

describe('배선(소스 계약)', () => {
  const worker = read('utils/agency-send-worker.ts');
  const change = read('utils/agency-send-change.ts');
  const mail = read('utils/agency-send-mail-worker.ts');
  it('워커 A 만 진단(diag: true) · 워커 B 는 진단 0 · 진단 대기 이어 보기가 runSpamRound 앞', () => {
    expect(worker.match(/runSpamRound\([^)]*\{ diag: true/g)?.length).toBe(1);
    expect(worker).toContain('await runSpamRound(target, overridden ? MAX_TEST_ROUNDS - 1 : 0);');   // ★ 2026-11-24 그대로 보내기 버전 = 한 차례 · 진단 옵션 없음은 그대로
    const a = worker.indexOf('const hold = diagHoldOf(row) ?? await recoverAgencyHold(row).catch(() => null);');   // ★ 1126 C164 — 대기가 없으면 판에서 되찾는다
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
  it('★ 배포 2 Codex 2R · ★ 1126 C164 — 화면 입구 셋 = 사람 검사(소유 확인 CT · DB 정본 id) · 대행 소유 진단 0(앞 확인 + 등록 트랜잭션 guard) · 옛 /diagnose 0', () => {
    const route = read('routes/spam-filter.ts');
    expect(route).not.toContain("'/tests/:id/diagnose'");
    for (const path of ["router.post('/tests/:id/rewrite', authenticate, demoBlock,", "router.post('/tests/:id/rewrite/next', authenticate, demoBlock,", "router.post('/tests/:id/fix-apply', authenticate,"]) {
      const a = route.indexOf(path);
      expect(a, path).toBeGreaterThan(-1);
      const body = route.slice(a, route.indexOf('\nrouter.', a + 10));
      // 소유 확인 뒤는 DB 정본 id 만(요청의 대문자 id 로 대행 소유 · 잠금 키가 어긋나지 않게)
      expect(body).toContain("const parentId = await ownManualSpamTestId((req as any).user.companyId, String(req.params.id || ''), resolveOwnerScope(req));");
      expect(body).toContain('parentTestId: parentId');
      expect(body).not.toMatch(/parentTestId: (?!parentId)/);
      expect(body).toContain("migrationPendingBody('spam_filter_tests ALTER(diag_plan)')");
    }
    const sd = read('utils/spam-diag.ts');
    const own = sd.slice(sd.indexOf('export async function ownManualSpamTestId('), sd.indexOf('\n}\n', sd.indexOf('export async function ownManualSpamTestId(')));
    expect(own).toContain("${spamCustomerTestSql('t')} AND ${notAutoSpamSourceSql('t.source')}");
    expect(own).toContain('return own.rows[0] ? String(own.rows[0].id) : null;');
    // 화면 등록 = 대행 소유를 앞에서 보고 · 등록 트랜잭션의 부모 진단 잠금 아래에서 한 번 더(screenGuard)
    const start = sd.slice(sd.indexOf('export async function startScreenRewrite('), sd.indexOf('export async function nextScreenRewrite('));
    expect(start).toContain("if (await agencyOwnsDiag(h.parent.id)) return { ok: false, reason: 'owned' };");
    expect(start).toContain('guard: screenGuard(h.parent.id)');
    expect(sd).toContain('const screenGuard = (parentTestId: string) => async (run: SqlRun) => !(await agencyOwnsDiag(parentTestId, run));');
    const next = sd.slice(sd.indexOf('export async function nextScreenRewrite('), sd.indexOf('export async function applyScreenFix('));
    expect(next).toContain('guard: screenGuard(h.parent.id)');
    // 자격(스위치 · 소유 · 닫힘 · 발신번호 권한) = 판을 만드는 길 전부가 지나는 한 곳
    const adv = sd.slice(sd.indexOf('export async function advanceRewrite('), sd.indexOf('// ─────────────── 화면 소유(직접발송)'));
    expect(adv.indexOf('await rewriteEligibility({ hint: i.hint, owner: i.owner, actorUserId: i.actorUserId })')).toBeGreaterThan(-1);
    expect(adv.indexOf('await rewriteEligibility(')).toBeLessThan(adv.indexOf('await buildPlate('));
    expect((sd.match(/await registerPlate\(/g) || []).length).toBe(1);   // 등록은 advanceRewrite 안 한 곳
  });
  it('★ 1126 C164 Codex 구현 1R — 화면 입구 셋 · 판 만들기 = 판 칸 준비를 맨 먼저 본다(없으면 칸 없음으로 던져 503 · 판 상태 충돌로 보이지 않는다) · 새 링크는 주소 판에서만 · 닫힌 창의 늦은 받기 응답은 버린다', () => {
    const sd = read('utils/spam-diag.ts');
    for (const [fn, end] of [['export async function startScreenRewrite(', 'export async function nextScreenRewrite('], ['export async function nextScreenRewrite(', 'export async function applyScreenFix('], ['export async function applyScreenFix(', 'let rewriteCycleRunning']] as const) {
      const body = sd.slice(sd.indexOf(fn), sd.indexOf(end));
      const first = body.slice(body.indexOf('{\n') + 2).trimStart();
      expect(first.startsWith('await requirePlanColumn();'), fn).toBe(true);
    }
    const adv = sd.slice(sd.indexOf('export async function advanceRewrite('), sd.indexOf('// ─────────────── 화면 소유(직접발송)'));
    expect(adv.indexOf('await requirePlanColumn();')).toBeGreaterThan(-1);
    expect(adv.indexOf('await requirePlanColumn();')).toBeLessThan(adv.indexOf('await buildPlate('));
    expect(sd).toContain("if (!(await hasDiagColumn()) || !(await hasPlanColumn())) throw Object.assign(new Error('column diag_plan does not exist'), { code: '42703' });");
    // 새 링크 = 주소 판(w1u · w2u)에서만 · 그 밖의 판은 앞에서 만든 링크만
    expect(sd).toContain("create: i.kind === 'w1u' || i.kind === 'w2u'");
    expect(read('utils/spam-link-swap.ts')).toContain('if (!i.create) return null;');
    // 받기 = 회사 스위치를 본다 · 카드의 받기 단추도 자격이 될 때만
    const apply = sd.slice(sd.indexOf('export async function applyScreenFix('), sd.indexOf('let rewriteCycleRunning'));
    expect(apply).toContain("if (!parent || !(await diagEnabledFor(parent.companyId))) return { ok: false, reason: 'not_found' };");
    expect(sd).toContain("applyLabel: auto || !el.ok ? '' : '이 글로 바꾸고 다시 검사',");
    // 화면 — 카드가 사라진 뒤 온 응답은 버리고 · 검사 창은 그 검사를 아직 보고 있을 때만 작성 칸에 넣는다
    const FE = join(SRC, '..', '..', 'frontend', 'src');
    const card = readFileSync(join(FE, 'components', 'SpamBlockHintCard.tsx'), 'utf8').replace(/\r\n/g, '\n');
    const post = card.slice(card.indexOf('const post = async ('), card.indexOf('const start = async ()'));
    expect(post.indexOf('if (!alive.current) return null;')).toBeGreaterThan(post.indexOf('await res.json()'));
    expect(post.indexOf('if (!alive.current) return null;')).toBeLessThan(post.indexOf('return data;'));
    expect(card).toContain('useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);');
    const modal = readFileSync(join(FE, 'components', 'SpamFilterTestModal.tsx'), 'utf8').replace(/\r\n/g, '\n');
    const on = modal.slice(modal.indexOf('onApply={onApplyFix ? (body, sub, smsTooLongText) => {'));
    expect(on.indexOf('if (!mountedRef.current || liveIdRef.current !== testId) return null;')).toBeGreaterThan(-1);
    expect(on.indexOf('if (!mountedRef.current || liveIdRef.current !== testId) return null;')).toBeLessThan(on.indexOf('const next = onApplyFix(body, sub);'));
  });
  it('★ 배포 2 Codex 3R — 재개 첫 회차가 T 를 이어 본 통과도 진단 재개 표시(당일 검사 0)', () => {
    const a = worker.indexOf('const resumedT = ');
    const mark = worker.indexOf("if (resumedT) detail.resumedFrom = 'diag';");
    expect(mark).toBeGreaterThan(a);
    expect(mark).toBeLessThan(worker.indexOf("if (verdict === 'pass') return { verdict, passed: true, finalContent: content, rounds, detail };", a));
  });
  it('★ 1126 C164 — 찾음 = 진단을 닫는 같은 트랜잭션에 찾은 글(diagFix) · 같은 row 에 얹어 이 주기의 검사 · 보류 저장이 본다 · 찾은 글은 이어 보기(resume)가 아니라 새 3사 검사 · 4a 0', () => {
    const diag = read('utils/agency-spam-diag.ts');
    expect(diag).not.toMatch(/settleAgencyDiag4a|kind: '4a'|kind: '4b'/);
    const rel = diag.slice(diag.indexOf('export async function releaseAgencyDiag('), diag.indexOf('export async function agencyBlockSummary('));
    const upd = rel.indexOf('UPDATE agency_send_requests SET last_test_result = $3::jsonb');
    const close = rel.indexOf('await closeDiagnosis(hold.parentTestId, run);');
    expect(upd).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(upd);
    expect(close).toBeLessThan(rel.indexOf("await client.query('COMMIT');"));
    const a = worker.indexOf('const hold = diagHoldOf(row) ?? await recoverAgencyHold(row).catch(() => null);');
    const blk = worker.slice(a, worker.indexOf('await runSpamRound(row, 0, { diag: true, resume });', a));
    expect(blk).toContain("const fix: DiagFix | null = step.kind === 'found' ? { version: hold.version, content: step.content, plateTestId: step.plateTestId, rounds: hold.rounds } : null;");
    expect(blk).toContain('await releaseAgencyDiag(row, token, hold, diagHoldJson(row, null, fix))');
    expect(blk).toContain("row.last_test_result = { ...(row.last_test_result && typeof row.last_test_result === 'object' ? row.last_test_result : {}), diagHold: undefined, ...(fix ? { diagFix: fix } : {}) };");
    expect(blk).toContain("else resume = { content: hold.content, rounds: hold.rounds, preferTestId: hold.parentTestId, passed: step.kind === 'pass' };");
    expect(worker).not.toMatch(/settleDiag4a|resumeAvoid/);
    // 재개 우선순위 = 검사 중이던 후보 > 찾은 글 > 지금 글(찾은 글은 후보 · 이어 보기가 없을 때만)
    const round = worker.slice(worker.indexOf('async function runSpamRound('), worker.indexOf('let firstTest:'));
    const held = round.indexOf('content = held.content;');
    const fixAt = round.indexOf('const fix = diagFixOf(row);');
    expect(held).toBeGreaterThan(-1);
    expect(fixAt).toBeGreaterThan(held);
    expect(round.slice(0, fixAt)).toContain('} else if (content === original) {');
    // 결과 칸을 안 쓰는 두 반려만 찾은 글을 지운다(같은 칸 대입은 한 줄) · 장애 갈래는 지우지 않는다
    expect((worker.match(/\{ dropDiagFix: true \}/g) || []).length).toBe(2);
    expect(worker).toContain("sets.push(opts.dropDiagFix ? `last_test_result = last_test_result - 'spamOverridable' - 'diagFix'` : `last_test_result = last_test_result - 'spamOverridable'`);");
    // 승인 링크 = 보여 준 글의 버전(savedVersion)으로 서명 · 바꾼 곳 줄 = 찾은 글을 거친 접수만 · 고객이 낸 글 ↔ 통과해 저장한 글
    expect(worker).toContain('const linkRow = { ...((await freshLinkFields(row.id)) || row), content_version: savedVersion };');
    expect(worker).toContain("const fixLines = viaFix ? agencyFixLines(String(row.original_content || ''), finalContent) : [];");
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
    // 등록 = 부모의 대상 통신사 결과 행 전부를 id 순으로(★ 1126 C164 판 하나를 막힌 통신사 전부에)
    expect(read('utils/spam-test-queue.ts')).toContain('SELECT carrier, result FROM spam_filter_test_results WHERE test_id = $1::uuid AND carrier = ANY($2::text[]) ORDER BY id FOR UPDATE');
  });
  it('★ 배포 2 Codex 3R · 4R 구조 — 판 행 잠금 순서 = lockDiagResultRows 한 곳(진단 잠금 → 확인 문자 → 결과 행 · 기한 처리와 같은 순) · 진단 닫기 · 4a 확정이 그것만 거친다', () => {
    const sd = read('utils/spam-diag.ts');
    const lk = sd.slice(sd.indexOf('export async function lockDiagResultRows('), sd.indexOf('export async function closeDiagnosis('));
    expect(lk.indexOf('DIAG_LOCK_SQL')).toBeGreaterThan(-1);
    expect(lk.indexOf('FROM spam_test_probes p')).toBeGreaterThan(lk.indexOf('DIAG_LOCK_SQL'));
    expect(lk.indexOf('FOR UPDATE OF r')).toBeGreaterThan(lk.indexOf('FROM spam_test_probes p'));
    const fn = sd.slice(sd.indexOf('export async function closeDiagnosis('), sd.indexOf('// ─────────────── 보이는 문장'));
    const firstWrite = Math.min(...['UPDATE spam_test_probes', 'UPDATE spam_filter_test_results', 'UPDATE spam_filter_tests'].map((k) => fn.indexOf(k)).filter((i) => i >= 0));
    expect(fn.indexOf('await lockDiagResultRows(parentTestId, run)')).toBeGreaterThan(-1);
    expect(fn.indexOf('await lockDiagResultRows(parentTestId, run)')).toBeLessThan(firstWrite);
    expect(fn).not.toContain('DIAG_LOCK_SQL');   // 진단 잠금도 그 함수가 잡는다
    // 판 결과 행을 직접 잠그는 자리는 그 함수뿐 · 닫힘 표시(diag_plan.closed)도 그 잠금 뒤 같은 닫기 안
    expect((sd.match(/FOR UPDATE OF r/g) || []).length).toBe(1);
    expect(fn.indexOf("jsonb_set(diag_plan, '{closed}', 'true'::jsonb)")).toBeGreaterThan(fn.indexOf('await lockDiagResultRows(parentTestId, run)'));
    expect(read('utils/agency-spam-diag.ts')).not.toMatch(/spam_test_probes|FOR UPDATE/);
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

describe('★ 1124 회사 스위치(슈퍼관리자 · companies.spam_diag_enabled · ENV 없앰)', () => {
  const FE = join(SRC, '..', '..', 'frontend', 'src');
  const fe = (p: string) => readFileSync(join(FE, p), 'utf8');
  it('판정 = diagEnabledFor 한 곳 · ENV 스위치 잔존 0(서버 전수)', () => {
    const walk = (dir: string): string[] => readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? (d.name === '__tests__' ? [] : walk(`${dir}/${d.name}`)) : d.name.endsWith('.ts') ? [`${dir}/${d.name}`] : []);
    const all = ['utils', 'routes', 'services', 'config'].flatMap(walk);
    expect(all.filter((f) => /SPAM_DIAG_SENDS|diagSendsOn/.test(read(f)))).toEqual([]);
    expect(all.filter((f) => /diagEnabledFor\(/.test(read(f))).sort()).toEqual(['utils/spam-diag-gate.ts', 'utils/spam-diag.ts', 'utils/spam-probe.ts', 'utils/spam-test-queue.ts']);
    expect(read('utils/spam-diag-gate.ts')).toContain("(to_jsonb(c) ->> 'spam_diag_enabled') = 'true' AS on FROM companies c WHERE c.id = $1::uuid");
  });
  it('소비처 셋 = 그 판의 회사 id · 발송 관문 둘은 잠금 아래 같은 연결 · 저장점 안(권한보다 먼저)', () => {
    expect(read('utils/spam-diag.ts')).toContain('if (!(await diagEnabledFor(parent.companyId))) return { ok: false, reason: \'off\' };');
    for (const [f, who] of [['utils/spam-probe.ts', 'k'], ['utils/spam-test-queue.ts', 'p']] as const) {
      const s = read(f);
      const sp = s.indexOf("await client.query('SAVEPOINT diag_gate');");
      const on = s.indexOf(`switchOn = await diagEnabledFor(${who}.companyId, run);`);
      const cb = s.indexOf(`if (switchOn) callbackAllowed = await diagCallbackAllowed(${who}.companyId,`);
      expect(sp).toBeGreaterThan(-1);
      expect(on).toBeGreaterThan(sp);
      expect(cb).toBeGreaterThan(on);
    }
  });
  it('슈퍼관리자 API = GET · PATCH /companies/:id/spam-diag · 슈퍼관리자 · uuid · boolean 필수 · 칸 없음 503', () => {
    const admin = read('routes/admin.ts');
    expect(admin).toContain("router.get('/companies/:id/spam-diag', authenticate, requireSuperAdmin, requireUuidId,");
    expect(admin).toContain("router.patch('/companies/:id/spam-diag', authenticate, requireSuperAdmin, requireUuidId,");
    const patch = admin.slice(admin.indexOf("router.patch('/companies/:id/spam-diag'"));
    const body = patch.slice(0, patch.indexOf('\n});\n'));
    expect(body).toContain("if (typeof enabled !== 'boolean') return res.status(400)");
    expect(body).toContain("migrationPendingBody('companies.spam_diag_enabled ALTER')");
  });
  it('★ 1124 확인 문자 1분 · Codex 2R — 검사 창 다시 읽기 = 응답이 지금 검사(liveIdRef)의 것일 때만 적용(「다시 검사」 뒤 옛 응답 무시)', () => {
    const modal = fe('components/SpamFilterTestModal.tsx');
    const poll = modal.slice(modal.indexOf('const pollResults = async (id: string) => {'));
    const body = poll.slice(0, poll.indexOf('\n  };\n'));
    const json = body.indexOf('const data = await res.json();');
    const guard = body.indexOf('if (!res.ok || liveIdRef.current !== id || seq <= appliedSeqRef.current) return;');   // ★ Codex 7R — 실패 응답은 순번을 올리지 않는다
    // ★ Codex 6R — 응답 순번: 보낼 때 순번을 받고(fetch 앞) · 적용한 가장 늦은 순번 이하의 응답은 버리고 · 적용할 때 그 순번을 적는다(상태 쓰기 앞)
    expect(body.indexOf('const seq = ++pollSeqRef.current;')).toBeGreaterThan(-1);
    expect(body.indexOf('const seq = ++pollSeqRef.current;')).toBeLessThan(body.indexOf('await fetch('));
    expect(body.indexOf('appliedSeqRef.current = seq;')).toBeGreaterThan(guard);
    expect(body.indexOf('appliedSeqRef.current = seq;')).toBeLessThan(body.indexOf('setResults('));
    expect(json).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(json);
    for (const apply of ['setResults(', 'setHints(', 'setFinalBy(', 'setStatus(', 'startSlowPoll()']) expect(body.indexOf(apply)).toBeGreaterThan(guard);
    // ★ Codex 3R 구조 — 15초 다시 읽기 타이머 = startSlowPoll 한 곳 · 틱마다 지금 검사(liveIdRef)를 읽는다(옛 id 를 붙잡지 않음) · 카드 onSent = 지금 검사가 아니면 아무것도 안 함
    expect((modal.match(/slowRef\.current = setInterval\(/g) || []).length).toBe(1);
    // ★ Codex 4R — 지금 검사가 없으면 걸지 않음 · 틱에서 없으면 스스로 끔 · 닫힘(언마운트) = 지금 검사를 먼저 비우고 타이머 끔(두 갈래)
    expect(modal).toContain('if (!mountedRef.current || slowRef.current || !liveIdRef.current) return;');
    expect(modal).toMatch(/slowRef\.current = setInterval\(\(\) => \{\s*const cur = liveIdRef\.current;\s*if \(!cur\) \{ if \(slowRef\.current\) \{ clearInterval\(slowRef\.current\); slowRef\.current = null; \} return; \}\s*void pollResults\(cur\);/);
    expect((modal.match(/return \(\) => \{ mountedRef\.current = false; liveIdRef\.current = null; clearTimers\(\); \};/g) || []).length).toBe(2);
    expect(modal).not.toMatch(/return \(\) => clearTimers\(\);/);
    // ★ Codex 5R — 타이머를 거는 세 자리(카운트다운 · 빠른 읽기 · 15초 읽기) = 창이 열려 있을 때만(닫힌 뒤 늦게 끝난 요청이 되살리지 않음)
    expect((modal.match(/= setInterval\(/g) || []).length).toBe(3);
    for (const [fn, timer] of [['const startServerBasedCountdown = useCallback(() => {', 'countdownRef.current = setInterval('], ['const startPolling = useCallback((id: string) => {', 'pollRef.current = setInterval('], ['const startSlowPoll = () => {', 'slowRef.current = setInterval(']]) {
      const at = modal.indexOf(fn);
      const seg = modal.slice(at, modal.indexOf(timer, at));
      expect(at, fn).toBeGreaterThan(-1);
      expect(seg, fn).toMatch(/if \(!mountedRef\.current[^)]*\) return;/);
    }
    expect(modal).toContain('    mountedRef.current = true;\n    if (journeyStep)');
    const onSent = modal.slice(modal.indexOf('<SpamBlockHintCard testId={testId}'));
    const sentBody = onSent.slice(0, onSent.indexOf('}} />'));
    expect(sentBody.indexOf('if (liveIdRef.current !== testId) return;')).toBeGreaterThan(-1);
    expect(sentBody.indexOf('if (liveIdRef.current !== testId) return;')).toBeLessThan(sentBody.indexOf('void pollResults(testId);'));
    expect(sentBody).toContain('startSlowPoll();');
    expect(modal).toContain('const resetForRetest = useCallback(() => {');
    expect(modal.slice(modal.indexOf('const resetForRetest'))).toMatch(/^[\s\S]{0,600}liveIdRef\.current = null;/);
  });
  it('화면 = 회사 상세 기본 탭에 스위치(값은 컴포넌트가 직접 GET · PATCH) · 꺼진 회사 카드 = 다시 확인 칸째 숨김', () => {
    expect(fe('components/admin/company-detail/tabs/CompanyBasicTab.tsx')).toContain('<SpamDiagSwitch companyId={editCompany.id} showAlert={showAlert} />');
    const sw = fe('components/admin/company-detail/SpamDiagSwitch.tsx');
    expect(sw).toContain('fetch(`/api/admin/companies/${companyId}/spam-diag`, { headers');
    expect(sw).toContain("method: 'PATCH'");
    expect(sw).not.toMatch(/window\.(alert|confirm)|\balert\(|confirm\(/);
    // ★ 1126 C164 뒤 — 스위치 설명 글 = 지금 동작(표현을 바꾼 글로 닿는 글 찾기) · 옛 동작(의심 부분을 뺀 글 · 원인 좁히기) 문구 0
    expect(sw).toContain('표현을 바꾼 글을 막힌 통신사로 보내 닿는 글을 찾습니다');
    expect(sw).not.toMatch(/뺀 글|원인을 좁힙/);
    const card = fe('components/SpamBlockHintCard.tsx');
    // ★ 1126 C164 — 꺼진 회사 = 서버가 hidden 으로(단추 · 사유 줄 0) · 카드는 idle + start + 원문을 받은 창일 때만 찾기 단추
    expect(read('utils/spam-diag.ts')).toContain("card.state = el.reason === 'off' ? 'hidden' : 'idle';");
    expect(card).toContain("{state === 'idle' && rw?.start && canAct && (");
    expect(card).toContain('const canAct = !!template && !!onApply;');
    expect(card).not.toMatch(/\/diagnose|주소 빼고|줄 빼고|빼니 도착|빼도 /);
  });
});

describe('★ Codex 구현 3R — 발송 조립기가 법정 줄로 인정하는 줄은 고칠 줄이 아니다(조립기의 판정 그대로)', () => {
  const HEADS = ['(광고) 매장 소식', '( 광고 ) 매장 소식', '（광고）매장 소식', '  (광고)매장 소식'];
  const FOOTS = ['무료수신거부 080-000-0000', '무료 수신 거부 080-000-0000', '무료거부0800000000', '무료 거부 080'];
  const PLAIN = ['매장 소식', '광고 문의는 매장으로', '수신 설정 안내'];

  it('조립기가 머리말 · 꼬리말을 더 붙이지 않는 꼴 = 법정 줄 · 붙이는 꼴 = 아님(기대값 = 조립기의 실제 결과)', () => {
    for (const l of HEADS) {
      expect(buildAdMessage(l, 'LMS', true, '080-000-0000').startsWith(l)).toBe(true);   // 독립 출처 = 조립기가 머리말을 더 붙이지 않는다
      expect(assemblerLegalLine(l)).toBe(true);
    }
    for (const l of FOOTS) {
      expect(buildAdMessage(`행사\n${l}`, 'LMS', true, '080-000-0000')).toBe(`(광고) 행사\n${l}`);   // 꼬리말을 더 붙이지 않는다
      expect(assemblerLegalLine(l)).toBe(true);
    }
    for (const l of PLAIN) {
      expect(buildAdMessage(l, 'LMS', true, '080-000-0000')).toBe(`(광고) ${l}\n무료수신거부 080-000-0000`);
      expect(assemblerLegalLine(l)).toBe(false);
    }
  });

  it('원문에 직접 쓴 띄어 쓴 머리말 · 단문 꼬리말 줄은 고정(고칠 줄 = 본문 줄만)', () => {
    const t = '( 광고 ) 매장 소식\n겨울 행사 안내\n무료거부0800000000';
    expect(editableLines(t, t, assemblerLegalLine)).toEqual([{ sentLine: 1, tplLine: 1 }]);
    const u = '（광고）매장 소식\n겨울 행사 안내\n무료 수신 거부 080-000-0000';
    expect(editableLines(u, u, assemblerLegalLine)).toEqual([{ sentLine: 1, tplLine: 1 }]);
  });
});

describe('★ Codex 구현 4R — 원문을 검사 글로 조립하는 조합이 여럿이면 전부가 같은 글을 낼 때만 그 글(어느 조합이 그 화면의 것인지 모른다)', () => {
  // 머리말 · 꼬리말을 이미 가진 글 = 광고 표기를 켜도 끄도 원문 그대로 나온다(맞는 조합이 여럿)
  const T = '(광고\n) 하늘몰\n■ 최대 35% 할인\n무료 수신거부 080-000-0000';
  const parent = { companyId: '00000000-0000-0000-0000-0000000000aa', userId: '00000000-0000-0000-0000-0000000000ab', messageType: 'LMS', callback: '0212345678', firstRecipient: null } as any;

  it('표기를 그대로 둔 바꿈 = 어느 조합이든 같은 글 → 그 글 · 머리말이 깨진 바꿈 = 켬(머리말을 새로 붙임) 과 끔(그대로)이 다른 글 → null', async () => {
    const render = await screenRenderer({ parent, sentText: T }, T);
    expect(render(T)).toBe(T);
    expect(render(T.replace('할인', '세일'))).toBe(T.replace('할인', '세일'));
    expect(render('(광고\n하늘몰 소식\n■ 최대 35% 할인\n무료 수신거부 080-000-0000')).toBeNull();
  });

  it('어느 조합으로도 검사 글이 안 나오면 늘 null', async () => {
    const render = await screenRenderer({ parent, sentText: T + ' ' }, T);
    expect(render(T)).toBeNull();
  });
});
