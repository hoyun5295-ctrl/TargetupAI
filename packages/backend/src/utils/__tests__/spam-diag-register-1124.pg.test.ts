// replaces: none
/**
 * 확인 판 등록 · 읽기 · 닫기 — 실 PostgreSQL 판(★ 2026-11-24 · 설계서 docs/2026-11-23-spam-block-cause-hint-design.md §6-2-1 · §6-2-2 · §9
 *   ★ 2026-11-26 C164 재작성 · 설계서 docs/2026-11-25-spam-diag-rewrite-design.md §5 · §7 · §8 · §11 · §14)
 *   DDL-1 · DDL-2 · DDL-4(앞 설계서 §9) · DDL-5(재작성 §11)를 이 사본에 실행해 칸 · 유일 부분 인덱스를 만든다(DDL 문장도 함께 검증).
 *   판 = 표현을 바꾼 글을 막힌 통신사 전부로 한 판(R1 ~ R3) · 출처 spam_diag · 차감 0 · 계획(diag_plan) · 같은 판 두 번 = 같은 판 · 하루 상한 직렬화 ·
 *   소유 · 닫힘은 판 행에 · 주소 판의 링크는 등록 트랜잭션 안에서. 표현 판의 AI 는 여기서 정해진 글을 돌려주는 대역을 쓴다(검사 = 등록 · 잠금 · 읽기).
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { randomUUID } from 'crypto';

const loaded = vi.hoisted(() => ({ n: 0 }));   // ★ 배포 3 Codex 1R — 관문이 적재까지 갔는가
const ai = vi.hoisted(() => ({ calls: 0, fail: false, swap: null as null | [string, string] }));
vi.mock('../sms-queue', async (orig) => ({ ...(await orig() as any), insertTestSmsQueue: async () => { loaded.n += 1; } }));
vi.mock('../system-alert', async (orig) => ({ ...(await orig() as any), sendSystemAlert: async () => 1 }));
// 표현 판의 AI 대역 — 고칠 줄의 「할인」을 1회차 「세일」 · 2회차 「특가」로 바꾼 글(숫자 · 주소는 그대로) · 제목(한 줄)은 바꾸지 않는다 · ai.swap 을 주면 그 바꿈으로
vi.mock('../agency-send-refine', async (orig) => ({
  ...(await orig() as any),
  refineForSpam: async (o: { original: string; round: number; editable?: number[] }) => {
    ai.calls += 1;
    if (ai.fail || !o.editable || !o.original.includes('\n')) return { ok: false, reason: 'test' };
    const lines = o.original.split('\n');
    for (const i of o.editable) lines[i] = ai.swap ? lines[i].replace(ai.swap[0], ai.swap[1]) : lines[i].replace('할인', o.round === 1 ? '세일' : '특가');
    return { ok: true, content: lines.join('\n') };
  },
}));

import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { ledgerBlockSql } from './pg/global-setup';
import { enqueueSpamTest, RENDERED_SAMPLE_MARK, resetSpamStampCache, sendDiagTestRow } from '../spam-test-queue';
import { resetSpamProbeSchemaCache } from '../spam-probe';
import { diagEnabledFor } from '../spam-diag-gate';
import {
  buildSpamBlockHints, closeDiagnosis, lockDiagResultRows, readPlates, spamHintLine, rewriteStepOf, advanceRewrite, markPlateEnded,
  startScreenRewrite, nextScreenRewrite, applyScreenFix, runSpamRewriteCycle, spamHintsResponse,
} from '../spam-diag';
import { startAgencyDiag, stepAgencyDiag, recoverAgencyHold, releaseAgencyDiag, diagHoldJson, type DiagFix } from '../agency-spam-diag';
// 직접발송 화면이 검사 글을 만드는 두 함수(DirectSendPanel buildSpamTestContent = 광고 표기 → 첫 수신자 값) — 서버 조립의 독립 출처
import { buildAdMessageFront, replaceDirectVars } from '../../../../frontend/src/utils/formatDate';

const CO = randomUUID();
const US = randomUUID();
const TEXT = '(광고) 하늘몰 겨울 행사\n>https://tinyurl.example/zz9\n■ 최대 35% 할인\n무료 수신거부 080-000-0000';
const TPL = { body: TEXT, subject: null as string | null };
const W1 = TEXT.replace('할인', '세일');
/** 조립 함수 대역(광고 표기 · 수신자 값 없는 글 = 원문이 곧 검사 글) */
const ID = (body: string) => body;
let cbSeq = 0;

/** 막힌 부모 검사(렌더 끝난 글 · blocked 인 통신사만 막힘) — 발신번호는 부모마다 새 합성 번호(발신번호 하루 상한이 시험끼리 얽히지 않게) */
async function parent(blocked: string[] = ['KT'], text = TEXT, firstRecipient: Record<string, any> = { [RENDERED_SAMPLE_MARK]: true }): Promise<string> {
  const id = randomUUID();
  cbSeq += 1;
  const cb = `0221${String(100000 + cbSeq)}`;   // 합성 번호(규격 통과 · 도달 불가 시험 값)
  await insertMinimalRow(pool, 'sender_numbers', { company_id: CO, phone_number: cb, is_active: true });
  await pool.query(
    `INSERT INTO spam_filter_tests (id, company_id, user_id, callback_number, message_content_lms, message_hash, status, source, first_recipient, created_at, completed_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'completed', 'manual', $7, NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '4 minutes')`,
    [id, CO, US, cb, text, `h-${id.slice(0, 8)}`, JSON.stringify(firstRecipient)],
  );
  for (const carrier of ['SKT', 'KT', 'LGU']) {
    const result = blocked.includes(carrier) ? 'blocked' : 'pass';
    await pool.query(`INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone, received, result) VALUES ($1, $2, 'LMS', $3, $4, $5)`,
      [id, carrier, `0100000112${carrier.length}`, result === 'pass', result]);
  }
  return id;
}
/** 그 부모의 마지막 판 결과를 통신사마다 정한다(대기열 · 단말 보고 대신) */
async function settle(parentId: string, results: Record<string, 'pass' | 'blocked' | 'error'>): Promise<void> {
  const plates = await readPlates(parentId);
  const last = plates[plates.length - 1];
  for (const [carrier, result] of Object.entries(results)) {
    await pool.query(`UPDATE spam_filter_test_results SET received = $3, result = $4 WHERE test_id = $1 AND carrier = $2`, [last.testId, carrier, result === 'pass', result]);
  }
  await pool.query(`UPDATE spam_filter_tests SET status = 'completed', completed_at = NOW() WHERE id = $1`, [last.testId]);
}
const linkCount = async () => (await pool.query(`SELECT COUNT(*)::int AS n FROM dm_custom_short_links WHERE company_id = $1`, [CO])).rows[0].n;

beforeAll(async () => {
  process.env.DM_SHORT_LINK_BASE = 'https://hlj.kr';
  for (const id of ['C89-DDL-1', 'C89-DDL-2', 'C89-DDL-3', 'C89-DDL-4', 'C89-DDL-5', 'C98-DDL-2']) await pool.query(ledgerBlockSql(id));   // C98-DDL-2 = customers.joined_at(등록의 표본 고객 조회)
  // 앞 설계서 §9 DDL-1 · DDL-2 그대로
  await pool.query(`SET lock_timeout = '3s'; ALTER TABLE spam_filter_tests ADD COLUMN IF NOT EXISTS diag_of uuid NULL;`);
  await pool.query(`CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_spam_filter_tests_diag ON spam_filter_tests (diag_of, variant_id) WHERE diag_of IS NOT NULL;`);
  // ★ 1124 앞 설계서 §9 DDL-4 그대로(회사 스위치 · 슈퍼관리자)
  await pool.query(`SET lock_timeout = '3s'; ALTER TABLE companies ADD COLUMN IF NOT EXISTS spam_diag_enabled boolean NOT NULL DEFAULT false;`);
  // ★ 1126 재작성 설계서 §11 DDL-5 그대로(판 계획)
  await pool.query(`ALTER TABLE spam_filter_tests ADD COLUMN IF NOT EXISTS diag_plan jsonb;`);
  resetSpamStampCache();
  resetSpamProbeSchemaCache();
  await insertMinimalRow(pool, 'companies', { id: CO });
  await insertMinimalRow(pool, 'users', { id: US, company_id: CO, user_type: 'user', is_active: true, login_id: `t-1124-reg-${US.slice(0, 8)}` });
  // KT 단말 두 대(★ 배포 2 Codex 1R — 판은 통신사마다 한 대만 쓴다)
  for (const [carrier, phone] of [['SKT', '01000001123'], ['KT', '01000001122'], ['KT', '01000001129'], ['LGU', '01000001124']]) {
    await pool.query(`INSERT INTO spam_filter_devices (device_id, carrier, phone, is_active) VALUES ($1, $2, $3, true) ON CONFLICT DO NOTHING`, [`dev-1124-${carrier}-${phone}`, carrier, phone]);
  }
  await pool.query(`UPDATE companies SET spam_diag_enabled = true WHERE id = $1`, [CO]);
});

describe('판 등록(닿는 글 찾기 시작 → enqueueSpamTest diag)', () => {
  it('첫 판 = 표현만 바꾼 글 · 막힌 통신사 전부로 한 판(R1) · 출처 spam_diag · diag_of = 부모 · 계획(소유 · 종류 · 원문 · 고칠 줄 · 대상 · 바꿈) · 주소 · 숫자 그대로 · 차감 거래 0 · 링크 0', async () => {
    const p = await parent(['KT', 'LGU']);
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL })).toEqual({ ok: true });
    const t = (await pool.query(`SELECT id, source, diag_of, variant_id, message_content_lms, status, user_id, diag_plan FROM spam_filter_tests WHERE diag_of = $1`, [p])).rows;
    expect(t.length).toBe(1);
    expect(t[0]).toMatchObject({ source: 'spam_diag', diag_of: p, variant_id: 'R1', status: 'queued', user_id: US, message_content_lms: W1 });
    expect(t[0].diag_plan).toEqual({
      v: 1, owner: 'screen', kind: 'w1', template: TPL, editable: [{ sentLine: 1, tplLine: 1 }, { sentLine: 2, tplLine: 2 }], targets: ['KT', 'LGU'], urls: [],
      fixes: [{ field: 'body', tplLine: 2, before: '■ 최대 35% 할인', after: '■ 최대 35% 세일', kind: 'text' }],
    });
    // 결과 행 = 대상 통신사마다 단말 한 대(KT 는 단말이 둘이어도 한 행)
    const rows = (await pool.query(`SELECT carrier FROM spam_filter_test_results WHERE test_id = $1 ORDER BY carrier`, [t[0].id])).rows;
    expect(rows.map((x: any) => x.carrier)).toEqual(['KT', 'LGU']);
    expect((await pool.query(`SELECT 1 FROM balance_transactions WHERE reference_id = $1`, [String(t[0].id)])).rows.length).toBe(0);
    expect(await linkCount()).toBe(0);
  });

  it('늦은 보고로 통과가 된 통신사는 대상에서 빠진다(등록 잠금 아래 다시 본다) · 전부 통과가 됐으면 판 0', async () => {
    const p = await parent(['KT', 'LGU']);
    const h = (await buildSpamBlockHints(p, { templateText: TEXT }))!;   // 둘 다 막힘일 때 읽은 판단
    const s = rewriteStepOf(h, 'screen', TPL);
    await pool.query(`UPDATE spam_filter_test_results SET result = 'pass', received = true WHERE test_id = $1 AND carrier = 'LGU'`, [p]);
    const r = await advanceRewrite({ render: ID, hint: h, owner: 'screen', actorUserId: US, candidates: ['w1'], template: TPL, editable: s.editable });
    expect(r).toMatchObject({ ok: true, kind: 'w1' });
    const plate = (await readPlates(p))[0];
    expect(plate.plan.targets).toEqual(['KT']);
    expect(plate.results.map((x) => x.carrier)).toEqual(['KT']);
    const q = await parent(['KT']);
    const hq = (await buildSpamBlockHints(q, { templateText: TEXT }))!;
    await pool.query(`UPDATE spam_filter_test_results SET result = 'pass', received = true WHERE test_id = $1 AND carrier = 'KT'`, [q]);
    expect(await advanceRewrite({ render: ID, hint: hq, owner: 'screen', actorUserId: US, candidates: ['w1'], template: TPL, editable: rewriteStepOf(hq, 'screen', TPL).editable })).toEqual({ ok: false, reason: 'not_blocked' });
    expect((await readPlates(q)).length).toBe(0);
  });

  it('같은 판 두 번 = 같은 판(결과 행 · 상한 소모 0 · 두 번 누름 · 일꾼 두 번) · 그 사이 다른 판이 생겼으면 등록 0', async () => {
    const p = await parent();
    const h = (await buildSpamBlockHints(p, { templateText: TEXT }))!;
    const s = rewriteStepOf(h, 'screen', TPL);
    const go = () => advanceRewrite({ render: ID, hint: h, owner: 'screen', actorUserId: US, candidates: ['w1'], template: TPL, editable: s.editable });
    const [a, b] = await Promise.all([go(), go()]);
    expect(a.ok && b.ok).toBe(true);
    expect((a as any).testId).toBe((b as any).testId);
    expect([(a as any).reused, (b as any).reused].sort()).toEqual([false, true]);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM spam_filter_tests WHERE diag_of = $1`, [p])).rows[0].n).toBe(1);
    // 판이 아직 확인 중인데 다음 판(w2)을 넣으려는 등록 = 잠금 아래 다시 본 단계가 허용하지 않는다
    const stale = { ...h, plates: (await readPlates(p)).map((x) => ({ ...x, results: x.results.map((r) => ({ ...r, state: 'blocked' as const })) })) };
    expect(await advanceRewrite({ render: ID, hint: stale, owner: 'screen', actorUserId: US, candidates: ['w2'], template: TPL, editable: s.editable })).toEqual({ ok: false, reason: 'closed' });
    expect((await readPlates(p)).length).toBe(1);
  });

  it('부르는 쪽 조건이 거짓(대행 = 접수를 놓침 · 문안 버전이 바뀜) = 판 0 · 스위치 꺼짐 · 확인 판을 부모로 · 고칠 줄 없음 = 판 0', async () => {
    const p = await parent();
    const h = (await buildSpamBlockHints(p, { templateText: TEXT }))!;
    const s = rewriteStepOf(h, 'screen', TPL);
    expect(await advanceRewrite({ render: ID, hint: h, owner: 'screen', actorUserId: US, candidates: ['w1'], template: TPL, editable: s.editable, guard: async () => false })).toEqual({ ok: false, reason: 'closed' });
    await pool.query(`UPDATE companies SET spam_diag_enabled = false WHERE id = $1`, [CO]);
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL })).toEqual({ ok: false, reason: 'off' });
    await pool.query(`UPDATE companies SET spam_diag_enabled = true WHERE id = $1`, [CO]);
    expect((await readPlates(p)).length).toBe(0);
    // 원문에 글자 그대로 있는 줄이 없으면(전부 수신자 값 · 법정 줄) 고칠 줄 0
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: { body: '%이름% 고객님', subject: null } })).toEqual({ ok: false, reason: 'no_editable' });
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL })).toEqual({ ok: true });
    const plate = (await readPlates(p))[0];
    expect(await startScreenRewrite({ parentTestId: plate.testId, actorUserId: US, template: TPL })).toEqual({ ok: false, reason: 'not_blocked' });   // 판은 부모가 될 수 없다
  });

  it('소유가 다른 진단 = owned(판 행의 소유로 · 사건보다 먼저) · 닫힌 진단 = closed(닫기가 판 행에 남긴 표시)', async () => {
    const p = await parent();
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL })).toEqual({ ok: true });
    await settle(p, { KT: 'blocked' });
    const h = (await buildSpamBlockHints(p))!;
    const s = rewriteStepOf(h, 'screen');
    expect(await advanceRewrite({ render: ID, hint: h, owner: 'agency', actorUserId: US, candidates: ['w2'], template: TPL, editable: s.editable })).toEqual({ ok: false, reason: 'owned' });
    await closeDiagnosis(p);
    expect((await readPlates(p))[0].plan.closed).toBe(true);
    const h2 = (await buildSpamBlockHints(p))!;
    expect(await advanceRewrite({ render: ID, hint: h2, owner: 'screen', actorUserId: US, candidates: ['w2'], template: TPL, editable: s.editable })).toEqual({ ok: false, reason: 'closed' });
    // 닫기 직전에 읽은 판단으로 등록해도(닫힘을 모르는 채) 등록 잠금 아래에서 닫힘을 본다
    expect(await advanceRewrite({ render: ID, hint: h, owner: 'screen', actorUserId: US, candidates: ['w2'], template: TPL, editable: s.editable })).toEqual({ ok: false, reason: 'closed' });
    expect((await readPlates(p)).length).toBe(1);
  });

  it('하루 상한 = 서로 다른 부모 둘이 마지막 한 자리를 함께 노려도 하나만(고정 키 잠금 아래 셈)', async () => {
    const [p1, p2] = [await parent(), await parent()];
    const used = (await pool.query(`SELECT COUNT(*)::int AS n FROM spam_filter_tests WHERE source = 'spam_diag' AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')`)).rows[0].n;
    const cb = (await pool.query(`SELECT callback_number FROM spam_filter_tests WHERE id = $1`, [p1])).rows[0].callback_number;
    const reg = (p: string) => enqueueSpamTest({
      companyId: CO, userId: US, callbackNumber: cb, messageContentLms: '고친 글', messageType: 'LMS',
      source: 'spam_diag', skipPrepaid: true, rendered: true, variantId: 'R1',
      diag: { parentTestId: p, carriers: ['KT'], capPerCallback: 1000, capTotal: used + 1, plan: { v: 1, owner: 'screen' } },
    });
    const out = await Promise.all([reg(p1), reg(p2)]);
    expect(out.filter((o) => o.ok).length).toBe(1);
    expect(out.find((o) => !o.ok)).toMatchObject({ errorCode: 'DIAG_CAP', error: 'total' });
  });
});

describe('판 차례 · 주소 판 · 받기', () => {
  it('주소가 있는 글 = 표현 판이 막히면 묻는다(일꾼은 주소 판을 만들지 않는다 = 링크 0) → 고객이 누르면 그때 짧은 주소를 만들어 한 판 → 닿으면 찾음 → 받기 = 지금 작성 칸 글에 바꿈만', async () => {
    const p = await parent();
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL });
    await settle(p, { KT: 'blocked' });
    const before = ai.calls;
    await runSpamRewriteCycle();
    expect((await readPlates(p)).length).toBe(1);   // 물음 단계 = 일꾼이 판을 더하지 않는다
    expect(ai.calls).toBe(before);
    expect(await linkCount()).toBe(0);
    const card = (await spamHintsResponse((await buildSpamBlockHints(p))!, US)).rewrite;
    expect(card.state).toBe('ask_url');
    expect(card.ask?.text).toBe('표현을 바꿔도 KT에서 막혔어요. 글 속 주소(tinyurl.example/zz9)가 막는 것일 수 있어요. 같은 곳으로 가는 한줄로 짧은 주소로 바꿔서 확인해 볼까요?');
    expect(card.ask?.options.map((o) => o.label)).toEqual(['주소도 바꿔서 확인', '주소는 그대로 두고 글을 새로 써서 확인']);

    expect(await nextScreenRewrite({ parentTestId: p, actorUserId: US, choice: 'url' })).toEqual({ ok: true });
    const plates = await readPlates(p);
    expect(plates.map((x) => [x.n, x.plan.kind])).toEqual([[1, 'w1'], [2, 'w1u']]);
    const link = (await pool.query(`SELECT id, code, target_url, title FROM dm_custom_short_links WHERE company_id = $1`, [CO])).rows;
    expect(link.length).toBe(1);
    expect(link[0]).toMatchObject({ target_url: 'https://tinyurl.example/zz9', title: '스팸 검사에서 바꾼 주소' });   // 원래 주소를 그대로 가리킨다
    const short = `https://hlj.kr/${link[0].code}`;
    expect(plates[1].text).toBe(W1.replace('https://tinyurl.example/zz9', short));
    expect(plates[1].plan.urls).toEqual([{ from: 'https://tinyurl.example/zz9', to: short, linkId: link[0].id }]);

    await settle(p, { KT: 'pass' });
    const found = (await spamHintsResponse((await buildSpamBlockHints(p))!, US)).rewrite;
    expect(found.state).toBe('found');
    expect(found.found).toMatchObject({
      title: 'KT에 닿는 글을 찾았어요', keepLine: '숫자와 날짜는 그대로예요.', applyLabel: '이 글로 바꾸고 다시 검사',
      urlLine: '글 속 주소를 한줄로 짧은 주소로 바꿨어요. 누르면 지금 주소로 넘어가요. 클릭 수는 이 주소에도 잡혀요.',
      fixes: [{ before: '>https://tinyurl.example/zz9', after: `>${short}` }, { before: '■ 최대 35% 할인', after: '■ 최대 35% 세일' }],
    });
    // 받기 = 원문 그대로면 줄 위치로 · 수신자 값이 든 보낸 글이 아니라 작성 칸 글(변수 칸 그대로)에 넣는다
    expect(await applyScreenFix({ parentTestId: p, current: TPL })).toEqual({ ok: true, body: `(광고) 하늘몰 겨울 행사\n>${short}\n■ 최대 35% 세일\n무료 수신거부 080-000-0000`, subject: null });
    expect(await applyScreenFix({ parentTestId: p, current: { body: '아예 다른 글', subject: null } })).toEqual({ ok: false, reason: 'changed' });
    await pool.query(`DELETE FROM dm_custom_short_links WHERE company_id = $1`, [CO]);
  });

  it('주소 판이 막히면 일꾼이 새로 쓴 글(짧은 주소 유지 · 링크는 다시 만들지 않는다)을 잇는다 · 3판 뒤 = 끝(못 찾음) · 일꾼을 두 번 돌려도 판 하나', async () => {
    const p = await parent();
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL });
    await settle(p, { KT: 'blocked' });
    await nextScreenRewrite({ parentTestId: p, actorUserId: US, choice: 'url' });
    await settle(p, { KT: 'blocked' });
    await Promise.all([runSpamRewriteCycle(), runSpamRewriteCycle()]);
    await runSpamRewriteCycle();
    const plates = await readPlates(p);
    expect(plates.map((x) => x.plan.kind)).toEqual(['w1', 'w1u', 'w2']);
    expect(await linkCount()).toBe(1);
    expect(plates[2].text).toBe(plates[1].text.replace('세일', '특가'));
    expect(plates[2].plan.urls).toEqual(plates[1].plan.urls);
    await settle(p, { KT: 'blocked' });
    const before = ai.calls;
    await runSpamRewriteCycle();
    expect(ai.calls).toBe(before);   // 3판 = 일꾼이 더 부르지 않는다
    const card = (await spamHintsResponse((await buildSpamBlockHints(p))!, US)).rewrite;
    expect(card.state).toBe('end');
    expect(card.endText).toBe('KT에 닿는 글을 찾지 못했어요. 막힌 표현을 바꾼 뒤 다시 검사해 주세요.');
    expect(card.plates.map((x) => `${x.name}: ${x.stateText}`)).toEqual(['표현을 바꾼 글: KT에서 막혔어요', '주소도 바꾼 글: KT에서 막혔어요', '글을 새로 쓴 글: KT에서 막혔어요']);
    await pool.query(`DELETE FROM dm_custom_short_links WHERE company_id = $1`, [CO]);
  });

  it('주소가 없는 글 = 일꾼이 새로 쓴 글을 잇는다 · 못 만들면 마지막 판에 사유를 적고 다음 주기는 AI 를 다시 부르지 않는다', async () => {
    const text = '(광고) 하늘몰 겨울 행사\n■ 최대 35% 할인\n무료 수신거부 080-000-0000';
    const p = await parent(['KT'], text);
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: { body: text, subject: null } });
    await settle(p, { KT: 'blocked' });
    ai.fail = true;
    try {
      await runSpamRewriteCycle();
      const last = (await readPlates(p))[0];
      expect(last.plan.ended?.reason).toBe('no_plate');
      const before = ai.calls;
      await runSpamRewriteCycle();
      expect(ai.calls).toBe(before);
    } finally { ai.fail = false; }
    expect((await readPlates(p)).length).toBe(1);
    expect((await spamHintsResponse((await buildSpamBlockHints(p))!, US)).rewrite.state).toBe('end');
  });

  it('주소 판 등록이 되돌려지면(판 글 확정 실패) 그 등록이 만든 링크도 사라진다', async () => {
    const p = await parent();
    const cb = (await pool.query(`SELECT callback_number FROM spam_filter_tests WHERE id = $1`, [p])).rows[0].callback_number;
    const out = await enqueueSpamTest({
      companyId: CO, userId: US, callbackNumber: cb, messageContentLms: W1, messageType: 'LMS',
      source: 'spam_diag', skipPrepaid: true, rendered: true, variantId: 'R1',
      diag: {
        parentTestId: p, carriers: ['KT'], capPerCallback: 1000, capTotal: 100000, plan: { v: 1, owner: 'screen' },
        prepare: async (run) => {
          await run(`INSERT INTO dm_custom_short_links (company_id, code, target_url) VALUES ($1::uuid, $2, 'https://tinyurl.example/zz9')`, [CO, `rb${randomUUID().slice(0, 6)}`]);
          return null;
        },
      },
    });
    expect(out).toMatchObject({ ok: false, errorCode: 'DIAG_PREPARE' });
    expect(await linkCount()).toBe(0);
    expect((await pool.query(`SELECT COUNT(*)::int AS n FROM spam_filter_tests WHERE diag_of = $1`, [p])).rows[0].n).toBe(0);
  });
});

describe('읽기 · 닫기', () => {
  it('판 상태 읽기 · 닫기 = 열린 결과 error · queued 판 completed · 닫힘 표시 · 그 뒤 한 줄 = 확인을 마치지 못함', async () => {
    const p = await parent();
    const h = await buildSpamBlockHints(p);
    expect(h?.carriers.map((c) => c.carrier)).toEqual(['KT']);
    expect(h?.carriers[0].suspects[0].kind).toBe('url');
    expect(spamHintLine(h!)).toBe('막혔을 수 있는 부분: 글 속 주소');
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL });
    const plate = (await readPlates(p))[0];
    expect(plate.results).toEqual([{ carrier: 'KT', state: 'queued' }]);
    await closeDiagnosis(p);
    const t = (await pool.query(`SELECT status, diag_plan FROM spam_filter_tests WHERE id = $1`, [plate.testId])).rows[0];
    expect(t.status).toBe('completed');
    expect(t.diag_plan.closed).toBe(true);
    expect((await pool.query(`SELECT result FROM spam_filter_test_results WHERE test_id = $1`, [plate.testId])).rows[0].result).toBe('error');
    const h2 = await buildSpamBlockHints(p);
    expect(spamHintLine(h2!)).toBe('표현을 바꾼 글: 확인을 마치지 못했어요.');
    expect(spamHintLine(h2!, true)).toBe('표현을 바꾼 글: 확인을 마치지 못했습니다.');
  });

  it('옛 꼴 판(통신사 글자 + 번호 · 계획 없음)은 새 읽기가 판으로 보지 않는다(재작성 §11 · 옛 판을 가리키는 진단은 판 결과가 빈 채 끝난다)', async () => {
    const p = await parent();
    const k1 = randomUUID();
    await pool.query(
      `INSERT INTO spam_filter_tests (id, company_id, user_id, callback_number, message_content_lms, message_hash, status, source, variant_id, diag_of, first_recipient, completed_at)
       VALUES ($1, $2, $3, '0221231126', $4, $5, 'completed', 'spam_diag', 'K1', $6::uuid, $7, NOW())`,
      [k1, CO, US, '(광고) 하늘몰 겨울 행사\n■ 최대 35% 할인\n무료 수신거부 080-000-0000', `h-${k1.slice(0, 8)}`, p, JSON.stringify({ [RENDERED_SAMPLE_MARK]: true })],
    );
    await pool.query(`INSERT INTO spam_filter_test_results (test_id, carrier, message_type, phone, received, result) VALUES ($1, 'KT', 'LMS', '01000001122', true, 'pass')`, [k1]);
    expect(await readPlates(p)).toEqual([]);
    const card = (await spamHintsResponse((await buildSpamBlockHints(p))!, US)).rewrite;
    expect(card.state).toBe('idle');
    expect(card.start?.label).toBe('주소와 혜택은 그대로 두고 KT에 닿는 글 찾기');
    expect(card.start?.note).toBe('표현을 바꾼 글을 KT로만 보내 닿는지 확인해요. 요금은 없어요. 창을 닫아도 계속 찾아요.');
  });

  it('판이 전부 닿음 = 찾음 · 정해진 값은 닫기가 건드리지 않는다 · 끝 사유는 한 번만 적힌다', async () => {
    const text = '(광고) 하늘몰 겨울 행사\n■ 최대 35% 할인\n무료 수신거부 080-000-0000';
    const p = await parent(['KT', 'LGU'], text);
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: { body: text, subject: null } });
    await settle(p, { KT: 'pass', LGU: 'pass' });
    const plate = (await readPlates(p))[0];
    await markPlateEnded(p, plate.testId, 'first');
    await markPlateEnded(p, plate.testId, 'second');
    await closeDiagnosis(p);
    const after = (await readPlates(p))[0];
    expect(after.results).toEqual([{ carrier: 'KT', state: 'arrived' }, { carrier: 'LGU', state: 'arrived' }]);
    expect(after.plan.ended?.reason).toBe('first');
    const found = (await spamHintsResponse((await buildSpamBlockHints(p))!, US)).rewrite;
    expect(found.state).toBe('hidden');   // 닫힌 진단 = 화면은 의심 부분만(판 줄 · 받기 단추 0)
    expect(found.plates).toEqual([]);
    expect(spamHintLine((await buildSpamBlockHints(p))!, true)).toBe('표현을 바꾼 글: KT, LG U+에 닿았습니다.');
  });

  it('★ 배포 3 Codex 1R — 회사 스위치 끄기 저장이 관문보다 먼저 커밋되면 검사 문자 관문은 꺼짐을 읽는다(관문이 끄기 커밋을 기다림 · 적재 0)', async () => {
    const p = await parent();
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL });
    const tid = (await readPlates(p))[0].testId;
    const cb = (await pool.query(`SELECT callback_number FROM spam_filter_tests WHERE id = $1`, [p])).rows[0].callback_number;
    const row = (await pool.query(`SELECT id, phone FROM spam_filter_test_results WHERE test_id = $1`, [tid])).rows[0];
    await pool.query(`UPDATE spam_filter_tests SET status = 'active' WHERE id = $1`, [tid]);   // 대기열이 집은 판
    const a = await pool.connect();
    loaded.n = 0;
    try {
      await a.query('BEGIN');
      await a.query(`UPDATE companies SET spam_diag_enabled = false WHERE id = $1`, [CO]);   // 슈퍼관리자 끄기 저장(커밋 전)
      const gate = sendDiagTestRow({ testId: tid, parentTestId: p, companyId: CO, userId: US, callback: cb, rowId: String(row.id), phone: String(row.phone), messageType: 'LMS', content: '글', title: '' });
      gate.catch(() => undefined);
      await new Promise((res) => setTimeout(res, 500));
      await a.query('COMMIT');
      expect(await gate).toBe(false);
      expect(loaded.n).toBe(0);
      expect((await pool.query(`SELECT result FROM spam_filter_test_results WHERE id = $1`, [row.id])).rows[0].result).toBe('error');
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      a.release();
      await pool.query(`UPDATE companies SET spam_diag_enabled = true WHERE id = $1`, [CO]);
    }
  });

  it('★ Codex 구현 1R — 통신사 둘로 보낸 판에서 한 행이 관문에서 거부돼도 열린 행이 남아 있는 동안 판은 닫히지 않는다 → 나머지 행도 자기 관문을 지나 닫힌다(빈 채 남는 결과 0)', async () => {
    const p = await parent(['KT', 'LGU']);
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL });
    const tid = (await readPlates(p))[0].testId;
    const cb = (await pool.query(`SELECT callback_number FROM spam_filter_tests WHERE id = $1`, [p])).rows[0].callback_number;
    const rows = (await pool.query(`SELECT id, phone FROM spam_filter_test_results WHERE test_id = $1 ORDER BY carrier`, [tid])).rows;
    expect(rows.length).toBe(2);
    await pool.query(`UPDATE spam_filter_tests SET status = 'active' WHERE id = $1`, [tid]);
    await pool.query(`UPDATE companies SET spam_diag_enabled = false WHERE id = $1`, [CO]);   // 두 행 모두 거부될 사유(판 전체의 사유)
    loaded.n = 0;
    try {
      const send = (row: any) => sendDiagTestRow({ testId: tid, parentTestId: p, companyId: CO, userId: US, callback: cb, rowId: String(row.id), phone: String(row.phone), messageType: 'LMS', content: '글', title: '' });
      const state = async () => ({
        status: (await pool.query(`SELECT status FROM spam_filter_tests WHERE id = $1`, [tid])).rows[0].status,
        results: (await pool.query(`SELECT result FROM spam_filter_test_results WHERE test_id = $1 ORDER BY carrier`, [tid])).rows.map((x: any) => x.result),
      });
      expect(await send(rows[0])).toBe(false);
      expect(await state()).toEqual({ status: 'active', results: ['error', null] });   // 열린 행이 남았다 = 판은 아직 닫히지 않는다
      expect(await send(rows[1])).toBe(false);
      expect(await state()).toEqual({ status: 'completed', results: ['error', 'error'] });
      expect(loaded.n).toBe(0);
    } finally {
      await pool.query(`UPDATE companies SET spam_diag_enabled = true WHERE id = $1`, [CO]);
    }
  });

  it('★ Codex 구현 1R — 회사 스위치를 끈 뒤에는 이미 찾은 글도 받기가 닫힌다(카드의 받기 단추도 없다) · 다시 켜면 받는다', async () => {
    const text = '(광고) 하늘몰 겨울 행사\n■ 최대 35% 할인\n무료 수신거부 080-000-0000';
    const tpl = { body: text, subject: null };
    const p = await parent(['KT'], text);
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: tpl });
    await settle(p, { KT: 'pass' });
    await pool.query(`UPDATE companies SET spam_diag_enabled = false WHERE id = $1`, [CO]);
    try {
      expect(await applyScreenFix({ parentTestId: p, current: tpl })).toEqual({ ok: false, reason: 'not_found' });
      const off = (await spamHintsResponse((await buildSpamBlockHints(p))!, US)).rewrite;
      expect(off.state).toBe('found');
      expect(off.found?.applyLabel).toBe('');
    } finally {
      await pool.query(`UPDATE companies SET spam_diag_enabled = true WHERE id = $1`, [CO]);
    }
    expect(await applyScreenFix({ parentTestId: p, current: tpl })).toEqual({ ok: true, body: text.replace('할인', '세일'), subject: null });
  });

  it('★ 배포 3 Codex 3R — 시간 상한은 회사 행 읽기 한 문장에만 · 읽은 뒤 그 트랜잭션의 직전 값으로 되돌린다', async () => {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SET LOCAL statement_timeout = '7s'`);
      expect(await diagEnabledFor(CO, (sql, params) => c.query(sql, params))).toBe(true);
      expect((await c.query(`SELECT current_setting('statement_timeout') AS v`)).rows[0].v).toBe('7s');
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });

  it('★ 배포 3 Codex 2R — 다른 쓰기가 회사 행을 오래 쥐어도 관문은 대기 상한(2초) 안에 거부로 끝난다(적재 0 · 대기열이 멈추지 않음)', async () => {
    const p = await parent();
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL });
    const tid = (await readPlates(p))[0].testId;
    const cb = (await pool.query(`SELECT callback_number FROM spam_filter_tests WHERE id = $1`, [p])).rows[0].callback_number;
    const row = (await pool.query(`SELECT id, phone FROM spam_filter_test_results WHERE test_id = $1`, [tid])).rows[0];
    await pool.query(`UPDATE spam_filter_tests SET status = 'active' WHERE id = $1`, [tid]);
    const a = await pool.connect();
    loaded.n = 0;
    try {
      await a.query('BEGIN');
      await a.query(`SELECT id FROM companies WHERE id = $1 FOR UPDATE`, [CO]);   // 선불 차감 등 회사 행을 쥔 쓰기(끝나지 않음)
      const t0 = Date.now();
      const sent = await sendDiagTestRow({ testId: tid, parentTestId: p, companyId: CO, userId: US, callback: cb, rowId: String(row.id), phone: String(row.phone), messageType: 'LMS', content: '글', title: '' });
      const took = Date.now() - t0;
      expect(sent).toBe(false);
      expect(loaded.n).toBe(0);
      expect(took).toBeLessThan(6_000);
      expect((await pool.query(`SELECT result FROM spam_filter_test_results WHERE id = $1`, [row.id])).rows[0].result).toBe('error');
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      a.release();
    }
  }, 20_000);

  it('★ 배포 2 Codex 4R — 진단 닫기(판 행 잠금)와 확인 문자 기한 처리(확인 문자 → 결과 행)가 겹쳐도 교착 0', async () => {
    const p = await parent();
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL });
    const tid = (await readPlates(p))[0].testId;
    const childRes = String((await pool.query(`SELECT id FROM spam_filter_test_results WHERE test_id = $1`, [tid])).rows[0].id);
    await pool.query(`UPDATE spam_filter_test_results SET result = 'unconfirmed' WHERE id = $1`, [childRes]);
    const probe = (await pool.query(
      `INSERT INTO spam_test_probes (result_id, phone, carrier, nonce, message_hash, status, claimed_at, sent_at, deadline_at)
       VALUES ($1, '01000001122', 'KT', $2, $3, 'sent', NOW(), NOW(), NOW()) RETURNING id`,
      [childRes, randomUUID().slice(0, 6).toUpperCase(), `hash-4r-${childRes.slice(0, 8)}`],
    )).rows[0].id;
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query('BEGIN');
      await a.query(`UPDATE spam_test_probes SET status = 'expired', decided_at = NOW() WHERE id = $1`, [probe]);   // 기한 처리 = 확인 문자 먼저
      await b.query('BEGIN');
      const runB = (sql: string, params?: any[]) => b.query(sql, params);
      const bDone = (async () => { await lockDiagResultRows(p, runB); await closeDiagnosis(p, runB); await b.query('COMMIT'); })();
      bDone.catch(() => undefined);
      await new Promise((res) => setTimeout(res, 500));
      const up = await a.query(`UPDATE spam_filter_test_results SET result = 'error' WHERE id = $1 AND result = 'unconfirmed'`, [childRes]);   // 그다음 결과 행
      await a.query('COMMIT');
      await bDone;
      expect(up.rowCount).toBe(1);
      const after = (await pool.query(`SELECT p.status, r.result FROM spam_test_probes p JOIN spam_filter_test_results r ON r.id = p.result_id WHERE p.id = $1`, [probe])).rows[0];
      expect(after).toEqual({ status: 'expired', result: 'error' });
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await b.query('ROLLBACK').catch(() => undefined);
      a.release();
      b.release();
    }
  });
});

describe('조립 관문(★ Codex 구현 3R — 판과 받기가 같은 글이 되는지를 발송 조립기로 본다)', () => {
  const OPT = '080-000-0000';
  const front = (body: string, fr: Record<string, any>) => replaceDirectVars(buildAdMessageFront(body, 'LMS', true, OPT), fr, '');

  beforeAll(async () => {
    await pool.query(`UPDATE users SET opt_out_080_number = $2 WHERE id = $1`, [US, OPT]);
  });

  it('직접발송 화면이 만든 검사 글(광고 표기 · 수신거부 줄 · 첫 수신자 값)을 서버가 글자 그대로 다시 조립한다 → 판 = 원문 줄의 바꿈 · 받은 글을 화면이 조립하면 닿은 그 판 글', async () => {
    const fr = { name: '김하늘', extra1: 'VIP' };
    const tpl = { body: '%이름% 고객님 겨울 행사\n■ 최대 35% 할인\n>https://tinyurl.example/zz9', subject: null };
    const sent = front(tpl.body, fr);
    expect(sent).toBe('(광고) 김하늘 고객님 겨울 행사\n■ 최대 35% 할인\n>https://tinyurl.example/zz9\n무료수신거부 080-000-0000');
    const p = await parent(['KT'], sent, fr);
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: tpl })).toEqual({ ok: true });
    const plate = (await readPlates(p))[0];
    expect(plate.plan.editable).toEqual([{ sentLine: 1, tplLine: 1 }, { sentLine: 2, tplLine: 2 }]);   // 값이 든 첫 줄 · 붙은 수신거부 줄은 고정
    expect(plate.plan.fixes).toEqual([{ field: 'body', tplLine: 1, before: '■ 최대 35% 할인', after: '■ 최대 35% 세일', kind: 'text' }]);
    await settle(p, { KT: 'pass' });
    const got = await applyScreenFix({ parentTestId: p, current: tpl });
    expect(got).toMatchObject({ ok: true, body: '%이름% 고객님 겨울 행사\n■ 최대 35% 세일\n>https://tinyurl.example/zz9' });
    expect(front((got as any).body, fr)).toBe(plate.text);
  });

  it('① 원문을 어떻게 조립해도 검사한 글이 다시 나오지 않으면 고칠 줄 없음(AI 0 · 판 0) · 다시 나오면 판', async () => {
    const tpl = { body: '하늘몰 겨울 행사\n■ 최대 35% 할인', subject: null };
    // 검사한 글의 수신거부 번호가 지금 그 계정의 번호와 다르다(검사 뒤 번호가 바뀜) = 광고 표기를 켜도 끄도 같은 글이 안 나온다
    const p = await parent(['KT'], '(광고) 하늘몰 겨울 행사\n■ 최대 35% 할인\n무료수신거부 080-999-9999', {});
    const before = ai.calls;
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: tpl })).toEqual({ ok: false, reason: 'no_editable' });
    expect(ai.calls).toBe(before);
    expect((await readPlates(p)).length).toBe(0);
    const q = await parent(['KT'], '(광고) 하늘몰 겨울 행사\n■ 최대 35% 할인\n무료수신거부 080-000-0000', {});
    expect(await startScreenRewrite({ parentTestId: q, actorUserId: US, template: tpl })).toEqual({ ok: true });
    expect((await readPlates(q))[0].text).toBe('(광고) 하늘몰 겨울 행사\n■ 최대 35% 세일\n무료수신거부 080-000-0000');
  });

  it('② 수신자 값의 줄바꿈으로 줄이 밀린 글(원문에 수신거부 줄이 있어 줄 수로는 안 보인다) = 판의 줄과 받기의 줄이 달라진다 → 판 0', async () => {
    const fr = { extra1: '등급 안내\n겨울 할인' };
    const tpl = { body: '%기타1%\n겨울 할인\n무료수신거부 080-000-0000', subject: null };
    const sent = front(tpl.body, fr);
    expect(sent).toBe('(광고) 등급 안내\n겨울 할인\n겨울 할인\n무료수신거부 080-000-0000');
    const p = await parent(['KT'], sent, fr);
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: tpl })).toEqual({ ok: false, reason: 'no_plate' });
    expect((await readPlates(p)).length).toBe(0);
  });

  it('원문에 직접 쓴 띄어 쓴 광고 머리말 줄은 AI 로 가지 않는다(고칠 줄 = 본문 줄만)', async () => {
    const text = '( 광고 ) 하늘몰 할인 소식\n■ 최대 35% 할인\n무료 수신 거부 080-000-0000';
    const p = await parent(['KT'], text);
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: { body: text, subject: null } })).toEqual({ ok: true });
    const plate = (await readPlates(p))[0];
    expect(plate.plan.editable).toEqual([{ sentLine: 1, tplLine: 1 }]);
    expect(plate.text).toBe('( 광고 ) 하늘몰 할인 소식\n■ 최대 35% 세일\n무료 수신 거부 080-000-0000');
  });

  it('★ Codex 구현 4R — 줄을 넘는 광고 머리말(광고를 끈 발송에 직접 쓴 표기): 표기가 깨진 판은 만들지 않는다(글 전체로 조립기에 묻는다) · 표기를 지킨 판은 만든다', async () => {
    const text = '(광고\n) 하늘몰\n■ 최대 35% 할인';
    const tpl = { body: text, subject: null };
    const p = await parent(['KT'], text, {});
    ai.swap = [') 하늘몰', '하늘몰 소식'];
    try {
      expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: tpl })).toEqual({ ok: false, reason: 'no_plate' });
    } finally {
      ai.swap = null;
    }
    expect((await readPlates(p)).length).toBe(0);
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: tpl })).toEqual({ ok: true });
    expect((await readPlates(p))[0].text).toBe('(광고\n) 하늘몰\n■ 최대 35% 세일');
  });

  it('★ Codex 구현 5R — 줄을 넘는 수신거부 꼬리말(광고를 끈 발송에 직접 쓴 표기): 꼬리말이 깨진 판은 만들지 않는다 · 지킨 판은 만든다', async () => {
    const text = '하늘몰 소식\n■ 최대 35% 할인\n무료\n수신 거부 080-000-0000';
    const tpl = { body: text, subject: null };
    const p = await parent(['KT'], text, {});
    ai.swap = ['수신 거부', '수신 중단'];
    try {
      expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: tpl })).toEqual({ ok: false, reason: 'no_plate' });
    } finally {
      ai.swap = null;
    }
    expect((await readPlates(p)).length).toBe(0);
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: tpl })).toEqual({ ok: true });
    expect((await readPlates(p))[0].text).toBe('하늘몰 소식\n■ 최대 35% 세일\n무료\n수신 거부 080-000-0000');
  });

  it('★ Codex 구현 4R — 주소 판도 등록 트랜잭션 안에서 관문 ② 를 지난다: 짧은 주소로 바꾼 글이 조립과 어긋나면 판 0 · 그때 만든 링크도 되돌림 · 맞으면 주소 판', async () => {
    const p = await parent(['KT']);
    await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL });
    await settle(p, { KT: 'blocked' });
    const h = (await buildSpamBlockHints(p))!;
    const s = rewriteStepOf(h, 'screen');
    const links = await linkCount();
    const go = (render: (body: string) => string | null) => advanceRewrite({ render, hint: h, owner: 'screen', actorUserId: US, candidates: ['w1u'], template: s.template!, editable: s.editable });
    // 짧은 주소가 든 글만 조립이 어긋나는 대역(표현 판은 지났다 · 주소를 바꾼 글에서 어긋난다)
    expect(await go((body) => (body.includes('hlj.kr') ? null : body))).toEqual({ ok: false, reason: 'url' });
    expect((await readPlates(p)).length).toBe(1);
    expect(await linkCount()).toBe(links);
    expect(await go(ID)).toMatchObject({ ok: true, kind: 'w1u' });
    expect(await linkCount()).toBe(links + 1);
    await pool.query(`DELETE FROM dm_custom_short_links WHERE company_id = $1`, [CO]);
  });
});

describe('대행(닿는 글 찾기 · 진단 대기 · 재작성 설계서 §8 · §9-2)', () => {
  /** 검사 중으로 선점된 접수(이 워커의 토큰) — 발송은 내일 */
  async function agencyRow(): Promise<any> {
    const id = randomUUID();
    const token = randomUUID();
    const requested = new Date(Date.now() + 86_400_000);
    await insertMinimalRow(pool, 'agency_send_requests', {
      id, company_id: CO, status: 'testing', source: 'screen', content_version: 1, original_content: TEXT, current_content: TEXT,
      file_name: '겨울 행사.xlsx', message_type: 'LMS', callback_number: '0221231125', manager_phone: '01000000000', phone_column: '전화번호',
      requested_at: requested, created_by: US, lock_token: token,
    });
    return { id, lock_token: token, content_version: 1, requested_at: requested, created_by: US, company_id: CO, original_content: TEXT, current_content: TEXT, last_test_result: null };
  }

  it('첫 막힘 = 대행 소유 판(계획에 접수 · 버전 · 회차) → 대기 저장 전에 죽어도 판에서 되찾는다 → 막히면 묻지 않고 주소 판 → 닿으면 이 버전 글에 바꿈을 넣은 글 → 닫는 저장에 찾은 글 · 판 닫힘 · 그 뒤 되찾기 0', async () => {
    const p = await parent();
    const row = await agencyRow();
    const hold = await startAgencyDiag(row, p, TEXT, 1);
    expect(hold).toMatchObject({ parentTestId: p, version: 1, content: TEXT, rounds: 1 });
    expect((await readPlates(p))[0].plan).toMatchObject({ owner: 'agency', kind: 'w1', template: { body: TEXT, subject: null }, agency: { requestId: row.id, version: 1, rounds: 1 } });
    // 대행이 가진 진단 = 화면은 판을 더하지 못한다
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL })).toEqual({ ok: false, reason: 'owned' });
    // 대기를 저장하기 전에 죽은 경우(결과 칸에 대기 없음) = 판에서 되찾는다 · 다른 문안 버전이면 없음
    expect(await recoverAgencyHold(row)).toMatchObject({ parentTestId: p, version: 1, content: TEXT, rounds: 1 });
    expect(await recoverAgencyHold({ ...row, content_version: 2 })).toBeNull();
    expect(await stepAgencyDiag(row, hold!)).toEqual({ kind: 'wait' });

    await settle(p, { KT: 'blocked' });
    // ★ Codex 구현 1R — 대기를 저장하기 전에 죽어 판에서 되찾은 경우 = 결과 칸에 대기가 없다 · 첫 판이 이미 막혔어도 다음 판을 건다
    expect((await pool.query(`SELECT last_test_result FROM agency_send_requests WHERE id = $1`, [row.id])).rows[0].last_test_result).toBeNull();
    expect(await stepAgencyDiag(row, (await recoverAgencyHold(row))!)).toEqual({ kind: 'wait' });   // 주소가 있는 글 = 묻지 않고 주소 판(동의 = 승인 문자 1클릭)
    const plates = await readPlates(p);
    expect(plates.map((x) => x.plan.kind)).toEqual(['w1', 'w1u']);
    expect(await linkCount()).toBe(1);
    const short = plates[1].plan.urls[0].to;

    await settle(p, { KT: 'pass' });
    const step = await stepAgencyDiag(row, hold!);
    const fixed = `(광고) 하늘몰 겨울 행사\n>${short}\n■ 최대 35% 세일\n무료 수신거부 080-000-0000`;
    expect(step).toEqual({ kind: 'found', content: fixed, plateTestId: plates[1].testId });
    const fix: DiagFix = { version: 1, content: fixed, plateTestId: plates[1].testId, rounds: 1 };
    expect(await releaseAgencyDiag(row, row.lock_token, hold!, diagHoldJson(row, null, fix))).toBe(true);
    expect((await pool.query(`SELECT last_test_result FROM agency_send_requests WHERE id = $1`, [row.id])).rows[0].last_test_result).toEqual({ diagFix: fix });
    expect((await readPlates(p)).every((x) => x.plan.closed === true)).toBe(true);
    expect(await recoverAgencyHold(row)).toBeNull();
    await pool.query(`DELETE FROM dm_custom_short_links WHERE company_id = $1`, [CO]);
  });

  it('접수를 놓친 워커(선점 토큰이 다름)는 판을 못 건다 · 발송까지 2시간이 안 남았으면 판 0 · 이 문안 버전에 이미 진단을 시작했으면 다시 안 건다', async () => {
    const p = await parent();
    const row = await agencyRow();
    expect(await startAgencyDiag({ ...row, lock_token: randomUUID() }, p, TEXT, 1)).toBeNull();
    expect((await readPlates(p)).length).toBe(0);
    const q = await parent();
    const soon = await agencyRow();
    expect(await startAgencyDiag({ ...soon, requested_at: new Date(Date.now() + 30 * 60_000) }, q, TEXT, 1)).toBeNull();
    expect((await readPlates(q)).length).toBe(0);
    // 위 두 번 모두 진단 사건(spam_hint)은 남는다 = 같은 버전에 다시 걸지 않는다
    expect(await startAgencyDiag(row, p, TEXT, 1)).toBeNull();
    expect((await readPlates(p)).length).toBe(0);
  });

  it('★ Codex 구현 1R — 같은 검사에 화면과 대행(또는 대행 접수 둘)이 첫 판을 함께 걸면 먼저 건 쪽만 주인 · 늦은 쪽은 남의 판을 자기 것으로 받지 않는다(대행은 대기를 만들지 않아 남의 진단을 닫지 않는다)', async () => {
    // 화면이 먼저 · 대행은 판이 없을 때 읽은 판단으로 등록하려 한다
    const p = await parent();
    const rowA = await agencyRow();
    const stale = (await buildSpamBlockHints(p, { templateText: TEXT }))!;
    const ed = rewriteStepOf(stale, 'agency', TPL).editable;
    expect(await startScreenRewrite({ parentTestId: p, actorUserId: US, template: TPL })).toEqual({ ok: true });
    expect(await advanceRewrite({ render: ID, hint: stale, owner: 'agency', actorUserId: US, candidates: ['w1'], template: TPL, editable: ed, agency: { requestId: rowA.id, version: 1, rounds: 1 } })).toEqual({ ok: false, reason: 'owned' });
    expect((await readPlates(p)).map((x) => x.plan.owner)).toEqual(['screen']);
    expect(await recoverAgencyHold(rowA)).toBeNull();
    // 대행이 먼저 · 화면은 판이 없을 때 읽은 판단으로 등록하려 한다 · 같은 검사를 이어 본 다른 접수도 마찬가지
    const q = await parent();
    const rowB = await agencyRow();
    const rowC = await agencyRow();
    const staleQ = (await buildSpamBlockHints(q, { templateText: TEXT }))!;
    expect(await startAgencyDiag(rowB, q, TEXT, 1)).not.toBeNull();
    expect(await advanceRewrite({ render: ID, hint: staleQ, owner: 'screen', actorUserId: US, candidates: ['w1'], template: TPL, editable: ed })).toEqual({ ok: false, reason: 'owned' });
    expect(await advanceRewrite({ render: ID, hint: staleQ, owner: 'agency', actorUserId: US, candidates: ['w1'], template: TPL, editable: ed, agency: { requestId: rowC.id, version: 1, rounds: 1 } })).toEqual({ ok: false, reason: 'owned' });
    // 같은 접수라도 문안 버전이 다르면(문안을 고친 뒤의 주기) 옛 버전의 판을 자기 것으로 받지 않는다
    expect(await advanceRewrite({ render: ID, hint: staleQ, owner: 'agency', actorUserId: US, candidates: ['w1'], template: TPL, editable: ed, agency: { requestId: rowB.id, version: 2, rounds: 1 } })).toEqual({ ok: false, reason: 'owned' });
    const plates = await readPlates(q);
    expect(plates.length).toBe(1);
    expect(plates[0].plan.agency?.requestId).toBe(rowB.id);
    expect(await recoverAgencyHold(rowC)).toBeNull();
  });

  it('30분을 넘긴 진단 대기 = 4c(다음 판을 만들지 않는다 · 지금처럼 다듬기) · 못 찾으면 4c 에 해 본 것 한 줄', async () => {
    const p = await parent(['KT'], '(광고) 하늘몰 겨울 행사\n■ 최대 35% 할인\n무료 수신거부 080-000-0000');
    const row = await agencyRow();
    const text = '(광고) 하늘몰 겨울 행사\n■ 최대 35% 할인\n무료 수신거부 080-000-0000';
    const hold = (await startAgencyDiag(row, p, text, 1))!;
    await pool.query(`UPDATE agency_send_requests SET last_test_result = $2::jsonb WHERE id = $1`, [row.id, diagHoldJson(row, hold)]);
    await settle(p, { KT: 'blocked' });
    const before = ai.calls;
    expect(await stepAgencyDiag(row, { ...hold, startedAt: new Date(Date.now() - 31 * 60_000).toISOString() })).toEqual({ kind: '4c', sentence: '' });
    expect(ai.calls).toBe(before);
    expect((await readPlates(p)).length).toBe(1);
    expect(await stepAgencyDiag(row, hold)).toEqual({ kind: 'wait' });   // 주소 없는 글 = 새로 쓴 글
    await settle(p, { KT: 'blocked' });
    expect(await stepAgencyDiag(row, hold)).toEqual({ kind: '4c', sentence: '표현을 바꾼 글: KT에서 막혔습니다. 글을 새로 쓴 글: KT에서 막혔습니다.' });
  });
});
