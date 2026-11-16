// replaces: none
/**
 * C136 배포 나 — 제작 대행 체험 · 실 PostgreSQL 판(★ 2026-11-16 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §4 ~ §7 · §11 · 대기 DDL C136-DDL-1 을 시험 안에서 얹는다)
 *   운영 문장(utils/proposal-trial.ts 의 SQL)을 실제 표 위에서 그대로 돌린다. 밖의 부품(그림 · 문안 · DM · 검사 · 문자)은 가짜 deps 로 바꿔 부른 횟수를 센다.
 *   1. 신청 = 회사당 한 번 · 진 요청은 사진을 쓰지 않는다 · 실패하면 자리도 사진도 남지 않는다
 *   2. 제작 = 단계마다 적는다 · 적힌 단계는 다시 만들지 않는다 · 소유권을 잃으면 방금 만든 것을 지우고 멈춘다 · 가져가기 조건
 *   3. 다시 만들기 = 옛 참조가 회수 목록으로 가고 회수가 지운다(쓰이는 중 = 지우지 않고 뺀다 · 못 지움 = 남는다)
 *   4. 전달 = 확인 대기일 때만 한 요청 · 읽은 뒤 바뀌었으면 통하지 않는다 · 알림 세 상태
 *   5. 담당자 화면 · 채우기의 권한 · 현황 SQL
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { pool } from '../../config/database';
import { ledgerBlockSql } from './pg/global-setup';
import { recordAuditLog } from '../audit-log';
import {
  PROPOSAL_AUDIT, PROPOSAL_AUDIT_TARGET, PROPOSAL_READY_TEXT, PROPOSAL_STEP_SQL, PROPOSAL_PARK_SQL, ProposalError,
  readProposalTrial, proposalTrialExists, requestProposalTrial, startProposalProduce, runProposalProduce, collectProposalGarbage,
  editProposalCopy, setProposalCallback, deliverProposalKit, notifyProposalReady, proposalViewFor, proposalFillFor,
  loadProposalAdmin, loadProposalAdminDetail, proposalPrefillPhone, proposalPageContent, isProducingHere,
  type ProduceDeps, type DeliverDeps, type ProposalKit,
} from '../proposal-trial';

const CO = (n: number) => `00000000-0000-0000-0000-00000c136c${String(n).padStart(2, '0')}`;
const UU = (n: number) => `00000000-0000-0000-0000-00000c136d${String(n).padStart(2, '0')}`;
const file = (name: string) => ({ buffer: Buffer.from(name), originalname: name });
const input = (c: number, over: Record<string, unknown> = {}) => ({
  companyId: CO(c), userId: UU(c), src: 'kim-test', channel: 'MMS' as const, brief: '겨울 신상 니트 입고', extra: null, notifyPhone: '01012345678',
  files: [file('a'), file('b'), file('c')], ...over,
});

let calls: string[] = [];
let seq = 0;
const saver = () => ({
  save: (companyId: string, files: ReadonlyArray<{ buffer: Buffer }>) => { calls.push(`save:${files.length}`); return files.map((_, i) => ({ url: `/api/dm/v/images/${companyId}/ph-${++seq}-${i}.jpg` })); },
  removeFile: (_c: string, url: string) => { calls.push(`unlink:${url.split('/').pop()}`); return true; },
});
const produceDeps = (over: Partial<ProduceDeps> = {}): ProduceDeps => ({
  companyInfo: async () => ({ name: '시험상점', industry: null }),
  pickHeadlines: async () => { calls.push('pick'); return { picks: ['t1', 't2', 't3'], title: '헤드라인' }; },
  makePoster: async (i) => { calls.push(`poster:${i.templateId}`); return { url: `/api/cdp/inapp/image/${i.companyId}/p-${++seq}.jpg` }; },
  ensurePosterAsset: async (i) => { calls.push('asset'); return `asset-${i.url.split('/').pop()}`; },
  makeCopies: async () => { calls.push('copies'); return [1, 2, 3].map((n) => ({ subject: `제목${n}`, text: `문안${n}` })); },
  buildDm: async () => { calls.push('dm'); return `dm-${++seq}`; },
  publishDmUrl: async (id) => `https://hanjul.ai/d/${id}`,
  callbackOf: async () => '0212345678',
  spamCheck: async (i) => { calls.push('spam'); return i.copies.map(() => 'pass' as const); },
  deleteDm: async (id) => { calls.push(`deleteDm:${id}`); return true; },
  deleteAsset: async (_c, id) => { calls.push(`deleteAsset:${id}`); return { deleted: true, inUse: false }; },
  assetIdOf: async () => null,
  removeFile: (_c, url) => { calls.push(`removeFile:${url.split('/').pop()}`); return true; },
  alert: async (i) => { calls.push(`alert:${i.kind}`); },
  ...over,
});
const deliverDeps = (over: Partial<DeliverDeps> = {}): DeliverDeps => ({
  sendNotice: async (_c, phone, text) => { calls.push(`sms:${phone}`); expect(text).toBe(PROPOSAL_READY_TEXT); return 1; },
  collect: async () => 0,
  ...over,
});
const count = (prefix: string) => calls.filter((c) => c.startsWith(prefix)).length;
/** 직원 화면이 지금 보고 있는 판 번호 */
const rev = async (c: number) => (await readProposalTrial(CO(c)))!.revision;
/** 신청 → 제작까지 끝낸 회사 하나 */
const produced = async (c: number) => {
  expect(await requestProposalTrial(input(c), saver())).toBe('created');
  expect(await startProposalProduce(CO(c), { kind: 'resume' }, produceDeps(), true)).toEqual({ ok: true });
  calls = [];
  return (await readProposalTrial(CO(c)))!;
};

beforeAll(async () => {
  await pool.query(ledgerBlockSql('C136-DDL-1'));
  await pool.query('DELETE FROM proposal_trials WHERE company_id::text LIKE $1', ['00000000-0000-0000-0000-00000c136c%']);
  await pool.query(`DELETE FROM audit_logs WHERE target_type = $1 AND (target_id::text LIKE $2 OR details->>'src' LIKE 'c136-%')`, [PROPOSAL_AUDIT_TARGET, '00000000-0000-0000-0000-00000c136c%']);
});
beforeEach(() => { calls = []; });

describe('신청(실 PG) — 회사당 한 번 · 자리를 먼저 잡고 사진은 그 뒤', () => {
  it('처음 = 새 행 · 사진 주소가 적힌다 · 다시 = 이미 있음(사진을 쓰지 않는다)', async () => {
    expect(await proposalTrialExists(CO(1))).toBe(false);
    expect(await requestProposalTrial(input(1), saver())).toBe('created');
    const row = (await readProposalTrial(CO(1)))!;
    expect(row.status).toBe('requested');
    expect(row.photo_urls).toHaveLength(3);
    expect(row).toMatchObject({ src: 'kim-test', channel: 'MMS', brief: '겨울 신상 니트 입고', notify_phone: '01012345678', revision: 0, kit: {}, garbage: [], notify_tries: 0 });
    calls = [];
    expect(await requestProposalTrial(input(1), saver())).toBe('exists');
    expect(calls).toEqual([]);
    expect(await proposalTrialExists(CO(1))).toBe(true);
  });

  it('⛔ 같은 회사의 신청 여덟 개가 동시에 와도 하나만 · 진 요청은 사진을 쓰지 않는다', async () => {
    const got = await Promise.all(Array.from({ length: 8 }, () => requestProposalTrial(input(2), saver())));
    expect(got.filter((g) => g === 'created')).toHaveLength(1);
    expect(got.filter((g) => g === 'exists')).toHaveLength(7);
    expect(count('save:')).toBe(1);
  });

  it('사진 저장이 던지면 자리도 남지 않는다 · 일부만 저장되면 400 이고 쓴 사진을 지운다', async () => {
    await expect(requestProposalTrial(input(3), { ...saver(), save: () => { throw new Error('disk full'); } })).rejects.toThrow('disk full');
    expect(await proposalTrialExists(CO(3))).toBe(false);
    const part = saver();
    await expect(requestProposalTrial(input(3), { ...part, save: (c, f) => part.save(c, f.slice(0, 2)) })).rejects.toBeInstanceOf(ProposalError);
    expect(await proposalTrialExists(CO(3))).toBe(false);
    expect(count('unlink:')).toBe(2);
    expect(await requestProposalTrial(input(3), saver())).toBe('created');   // 실패한 뒤 다시 신청할 수 있다
  });
});

describe('제작(실 PG) — 단계마다 적고 · 적힌 단계는 다시 만들지 않는다', () => {
  it('처음부터 끝까지 = 확인 대기 · 포스터 3(자산까지) · 문안 3(검사 통과) · 모바일 DM 주소 · 부품을 부른 순서', async () => {
    expect(await startProposalProduce(CO(1), { kind: 'resume' }, produceDeps(), true)).toEqual({ ok: true });
    const row = (await readProposalTrial(CO(1)))!;
    expect(row.status).toBe('produced');
    expect(row.produce_token).toBeNull();
    expect(row.kit.title).toBe('헤드라인');
    expect(row.kit.posters).toHaveLength(3);
    for (const p of row.kit.posters!) expect(p).toMatchObject({ url: expect.stringContaining('/api/cdp/inapp/image/'), assetId: expect.stringContaining('asset-') });
    expect(row.kit.posters!.map((p) => p!.templateId)).toEqual(['t1', 't2', 't3']);
    expect(row.kit.copies).toEqual([1, 2, 3].map((n) => ({ subject: `제목${n}`, text: `문안${n}`, spam: 'pass' })));
    expect(row.kit.dm).toMatchObject({ url: expect.stringContaining('https://hanjul.ai/d/dm-') });
    expect(row.kit).toMatchObject({ callback: '0212345678', spamDone: true });
    expect(calls.filter((c) => !c.startsWith('alert'))).toEqual(['pick', 'poster:t1', 'asset', 'poster:t2', 'asset', 'poster:t3', 'asset', 'copies', 'dm', 'spam']);
    expect(calls).toContain('alert:produced');
    expect(isProducingHere(CO(1))).toBe(false);
    // 단계마다 한 번씩 적었다(선점 1 + 헤드라인 1 + 포스터 6 + 문안 1 + DM 1 + 검사 1 + 끝 1)
    expect(row.revision).toBe(12);
  });

  it('⛔ 이어 하기 — 적힌 단계는 만들기 함수를 부르지 않는다(주소만 적힌 포스터는 자산부터 잇는다)', async () => {
    await requestProposalTrial(input(4), saver());
    const partial: ProposalKit = { title: '헤드라인', picks: ['t1', 't2', 't3'], posters: [{ url: `/api/cdp/inapp/image/${CO(4)}/old.jpg`, assetId: null, templateId: 't1' }, null, null] };
    await pool.query('UPDATE proposal_trials SET kit = $2::jsonb, produce_error = $3 WHERE company_id = $1::uuid', [CO(4), JSON.stringify(partial), '끊김']);
    calls = [];
    expect(await startProposalProduce(CO(4), { kind: 'resume' }, produceDeps(), true)).toEqual({ ok: true });
    expect(count('pick')).toBe(0);
    expect(calls.filter((c) => c.startsWith('poster:'))).toEqual(['poster:t2', 'poster:t3']);
    expect(count('asset')).toBe(3);
    const row = (await readProposalTrial(CO(4)))!;
    expect(row.status).toBe('produced');
    expect(row.produce_error).toBeNull();
    expect(row.kit.posters![0]).toEqual({ url: `/api/cdp/inapp/image/${CO(4)}/old.jpg`, assetId: 'asset-old.jpg', templateId: 't1' });
  });

  it('필수 단계가 실패하면 신청 상태로 돌아가고 사유가 남는다 · 만든 단계는 남아 다음에 이어 한다', async () => {
    await requestProposalTrial(input(5), saver());
    calls = [];
    await startProposalProduce(CO(5), { kind: 'resume' }, produceDeps({ makeCopies: async () => { throw new Error('문안 서버 오류'); } }), true);
    let row = (await readProposalTrial(CO(5)))!;
    expect(row.status).toBe('requested');
    expect(row.produce_error).toBe('문안 서버 오류');
    expect(row.kit.posters!.every((p) => !!p?.assetId)).toBe(true);
    expect(calls).toContain('alert:failed');
    calls = [];
    await startProposalProduce(CO(5), { kind: 'resume' }, produceDeps(), true);
    row = (await readProposalTrial(CO(5)))!;
    expect(row.status).toBe('produced');
    expect(count('poster:')).toBe(0);
  });

  it('모바일 DM · 스팸 검사는 실패해도 완성본으로 넘긴다(「DM 없음」 · 「검사하지 못함」으로 적는다)', async () => {
    await requestProposalTrial(input(6), saver());
    await startProposalProduce(CO(6), { kind: 'resume' }, produceDeps({
      buildDm: async () => { throw new Error('dm down'); }, spamCheck: async () => { throw new Error('spam down'); },
    }), true);
    let row = (await readProposalTrial(CO(6)))!;
    expect(row.status).toBe('produced');
    expect(row.kit.dm).toBeNull();
    expect(row.kit.copies!.map((c) => c.spam)).toEqual(['unknown', 'unknown', 'unknown']);
    // ⛔ 「만들지 못함」으로 적힌 DM 은 이어 하기 · 검사 다시에서 다시 만들지 않는다(직원이 「DM 다시 만들기」를 눌렀을 때만)
    calls = [];
    await startProposalProduce(CO(6), { kind: 'spam' }, produceDeps(), true);
    expect(count('dm')).toBe(0);
    expect((await readProposalTrial(CO(6)))!.kit.dm).toBeNull();
    // ⛔ 조립은 됐는데 발행하지 못한 DM(발행 잠금 · 발행 실패) = kit 에 두지 않고 같은 기록에서 회수 목록으로 보내 지운다
    for (const publishDmUrl of [async () => null, async () => { throw new Error('publish down'); }]) {
      calls = [];
      await startProposalProduce(CO(6), { kind: 'dm' }, produceDeps({ buildDm: async () => { calls.push('dm'); return 'dm-unpublished'; }, publishDmUrl }), true);
      row = (await readProposalTrial(CO(6)))!;
      expect([row.status, row.kit.dm, row.garbage]).toEqual(['produced', null, []]);
      expect(calls.filter((c) => c.startsWith('dm') || c.startsWith('deleteDm'))).toEqual(['dm', 'deleteDm:dm-unpublished']);
    }
    // 통신사 확인 중 · 보낼 수 없는 글자 = 통과도 차단도 아닌 제 이름으로 적힌다
    await startProposalProduce(CO(6), { kind: 'spam' }, produceDeps({ spamCheck: async () => ['checking', 'rejected', 'pass'] }), true);
    expect((await readProposalTrial(CO(6)))!.kit.copies!.map((c) => c.spam)).toEqual(['checking', 'rejected', 'pass']);
    // 등록된 발신번호가 없으면 검사 부품을 부르지 않는다
    await requestProposalTrial(input(7), saver());
    calls = [];
    await startProposalProduce(CO(7), { kind: 'resume' }, produceDeps({ callbackOf: async () => null }), true);
    expect(count('spam')).toBe(0);
    expect((await readProposalTrial(CO(7)))!.kit).toMatchObject({ callback: null, spamDone: true });
  });

  it('⛔ 소유권을 잃으면 방금 만든 것을 지우고 멈춘다 — 상태 · 사유를 건드리지 않는다', async () => {
    await requestProposalTrial(input(8), saver());
    calls = [];
    let made = 0;
    const other = '00000000-0000-0000-0000-0000000000aa';
    await startProposalProduce(CO(8), { kind: 'resume' }, produceDeps({
      makePoster: async (i) => {
        made++;
        // 둘째 포스터를 만드는 동안 다른 실행이 가져갔다
        if (made === 2) await pool.query('UPDATE proposal_trials SET produce_token = $2::uuid WHERE company_id = $1::uuid', [CO(8), other]);
        calls.push(`poster:${i.templateId}`);
        return { url: `/api/cdp/inapp/image/${i.companyId}/lost-${made}.jpg` };
      },
    }), true);
    const row = (await readProposalTrial(CO(8)))!;
    expect(row.status).toBe('producing');
    expect(row.produce_token).toBe(other);
    expect(row.produce_error).toBeNull();
    expect(count('removeFile:')).toBe(0);                       // 적지 못한 그림 = 그 자리에서 지우지 않는다
    expect(row.garbage).toEqual([{ kind: 'poster', assetId: null, url: `/api/cdp/inapp/image/${CO(8)}/lost-2.jpg` }]);   // 회수 목록에 남는다(가져간 쪽의 회수가 지운다)
    expect(row.kit.posters!.filter(Boolean)).toHaveLength(1);   // 첫 포스터만 적혀 있다
    expect(count('copies')).toBe(0);
    expect(calls.some((c) => c.startsWith('alert:'))).toBe(false);
    // 토큰이 다른 실행은 시작도 못 한다
    calls = [];
    await runProposalProduce(CO(8), '00000000-0000-0000-0000-0000000000bb', produceDeps());
    expect(calls).toEqual([]);
  });

  it('가져가기 — 제작 중이고 마지막 기록이 30분 안이면 못 가져간다 · 30분이 넘으면 가져가 이어 한다 · 전달한 뒤에는 다시 못 만든다', async () => {
    expect(await startProposalProduce(CO(8), { kind: 'resume' }, produceDeps(), true)).toEqual({ ok: false, reason: 'busy' });
    await pool.query(`UPDATE proposal_trials SET produce_beat_at = now() - interval '31 minutes' WHERE company_id = $1::uuid`, [CO(8)]);
    calls = [];
    expect(await startProposalProduce(CO(8), { kind: 'resume' }, produceDeps(), true)).toEqual({ ok: true });
    expect(calls.filter((c) => c.startsWith('poster:'))).toHaveLength(2);   // 적혀 있던 첫 포스터는 다시 만들지 않았다
    expect(calls).toContain('removeFile:lost-2.jpg');                        // 앞 실행이 회수 목록에 남긴 그림은 가져간 실행의 회수가 지운다
    expect((await readProposalTrial(CO(8)))!.garbage).toEqual([]);
    expect((await readProposalTrial(CO(8)))!.status).toBe('produced');
    expect(await startProposalProduce('00000000-0000-0000-0000-00000c136cff', { kind: 'resume' }, produceDeps(), true)).toEqual({ ok: false, reason: 'none' });
  });
});

type Q = (text: any, params?: any) => Promise<any>;
/**
 * 단계 기록 문장의 nth 번째 호출을 「답을 못 받은 쓰기」로 만든다(부르는 쪽에는 바로 오류).
 *   applied  = 실제로는 실행됐다 · skipped = 실행되지 않았다
 *   inflight = 다른 연결의 트랜잭션에서 실행돼 행 잠금을 쥔 채 300ms 뒤에 끝난다(오류가 돌아온 뒤에도 진행 중인 쓰기)
 *   late     = 회수 목록에 남기는 문장이 끝난 직후에 도착해 실행된다(늦게 도착한 쓰기)
 *   failPark = 실행되지 않았고, 회수 목록에 남기는 문장도 실패한다(DB 가 죽음)
 */
const lostWrite = (nth: number, mode: 'applied' | 'skipped' | 'inflight' | 'late' | 'failPark') => {
  const real = pool.query.bind(pool) as Q;
  let seen = 0;
  let pending: (() => Promise<any>) | null = null;
  return vi.spyOn(pool, 'query').mockImplementation((async (text: any, params: any) => {
    if (text === PROPOSAL_STEP_SQL && ++seen === nth) {
      if (mode === 'applied') await real(text, params);
      if (mode === 'inflight') {
        const c = await pool.connect();
        await c.query('BEGIN');
        await c.query(text, params);
        setTimeout(() => { c.query('COMMIT').then(() => c.release(), () => c.release(true)); }, 300);
      }
      if (mode === 'late') pending = () => real(text, params);
      throw new Error('db connection lost');
    }
    if (mode === 'failPark' && text === PROPOSAL_PARK_SQL) throw new Error('db connection lost');
    const r = await real(text, params);
    if (text === PROPOSAL_PARK_SQL && pending) { const run = pending; pending = null; await run(); }
    return r;
  }) as any);
};
/** 신청의 COMMIT 을 「답을 못 받은 쓰기」로 만든다 — applied = 적혔다 · aborted = 버려졌다 · inflight = 300ms 뒤에 적힌다(그동안 연결은 끊긴 것처럼 보인다) · fenceDown = 적혔고, 뒤처리 연결도 얻지 못한다 */
const lostCommit = (mode: 'applied' | 'aborted' | 'inflight' | 'fenceDown') => {
  const real = pool.connect.bind(pool) as () => Promise<any>;
  let n = 0;
  return vi.spyOn(pool, 'connect').mockImplementation((async () => {
    if (++n > 1) {
      if (mode === 'fenceDown') throw new Error('no connection');
      return real();
    }
    const client = await real();
    const q = client.query;
    client.query = async function (sql: any, ...rest: any[]) {
      if (sql !== 'COMMIT') return q.call(client, sql, ...rest);
      if (mode === 'inflight') {
        client.query = async () => { throw new Error('connection broken'); };
        const release = client.release.bind(client);
        client.release = () => { setTimeout(() => { client.query = q; q.call(client, 'COMMIT').then(() => release(), () => release(true)); }, 300); };
      } else {
        client.query = q;
        await q.call(client, mode === 'aborted' ? 'ROLLBACK' : 'COMMIT');
      }
      throw new Error('connection lost at commit');
    };
    return client;
  }) as any);
};

describe('적지 못한 산출물(실 PG · Codex 구현 1R · 2R) — 그 자리에서 지우지 않는다: 앞 쓰기를 막고 회수 목록에 남기거나, 가르지 못하면 남겨 두고 알린다', () => {
  it('⛔ 신청: COMMIT 은 됐는데 답을 못 받았다 = 사진을 지우지 않고 신청된 것으로 돌려준다(지우면 고칠 길이 없다)', async () => {
    const spy = lostCommit('applied');
    try { expect(await requestProposalTrial(input(30), saver())).toBe('created'); } finally { spy.mockRestore(); }
    expect(count('unlink:')).toBe(0);
    expect((await readProposalTrial(CO(30)))!.photo_urls).toHaveLength(3);
  });

  it('⛔ 신청: 답을 못 받은 COMMIT 이 그 뒤에 끝난다 = 끝날 때까지 기다렸다가 가른다(먼저 지우지 않는다)', async () => {
    const spy = lostCommit('inflight');
    try { expect(await requestProposalTrial(input(35), saver())).toBe('created'); } finally { spy.mockRestore(); }
    expect(count('unlink:')).toBe(0);
    const row = (await readProposalTrial(CO(35)))!;
    expect([row.status, row.photo_urls.length]).toEqual(['requested', 3]);
  });

  it('⛔ 신청: 답을 못 받은 COMMIT 이 실제로는 버려졌다 = 사진을 지우고 오류를 돌려준다 · 다시 신청할 수 있다', async () => {
    const spy = lostCommit('aborted');
    try { await expect(requestProposalTrial(input(36), saver())).rejects.toThrow('connection lost at commit'); } finally { spy.mockRestore(); }
    expect(count('unlink:')).toBe(3);
    expect(await proposalTrialExists(CO(36))).toBe(false);
    expect(await requestProposalTrial(input(36), saver())).toBe('created');
  });

  it('⛔ 신청: 가르지 못하면(뒤처리 연결을 얻지 못함) 사진을 지우지 않고 오류를 돌려준다', async () => {
    const spy = lostCommit('fenceDown');
    try { await expect(requestProposalTrial(input(33), saver())).rejects.toThrow('connection lost at commit'); } finally { spy.mockRestore(); }
    expect(count('unlink:')).toBe(0);
    expect((await readProposalTrial(CO(33)))!.photo_urls).toHaveLength(3);   // 실제로는 신청이 됐고 사진도 그대로다
  });

  it('⛔ 제작: 포스터 기록이 실제로는 적혔다 = 그대로 둔다(회수 목록에 넣지 않는다) · 다음 이어 하기가 그 포스터를 다시 만들지 않는다', async () => {
    await requestProposalTrial(input(31), saver());
    calls = [];
    const spy = lostWrite(2, 'applied');   // 1 = 헤드라인 · 2 = 첫 포스터의 주소 기록
    try { await startProposalProduce(CO(31), { kind: 'resume' }, produceDeps(), true); } finally { spy.mockRestore(); }
    const row = (await readProposalTrial(CO(31)))!;
    expect(row.kit.posters![0]!.url).toContain('/api/cdp/inapp/image/');
    expect(row.garbage).toEqual([]);
    expect(count('removeFile:')).toBe(0);
    expect(calls).not.toContain('alert:orphan');
    expect([row.status, row.produce_token, row.produce_error]).toEqual(['requested', null, 'db connection lost']);
    calls = [];
    await startProposalProduce(CO(31), { kind: 'resume' }, produceDeps(), true);
    expect(calls.filter((c) => c.startsWith('poster:'))).toEqual(['poster:t2', 'poster:t3']);
    expect((await readProposalTrial(CO(31)))!.status).toBe('produced');
  });

  it('⛔ 제작: 오류가 돌아온 뒤에도 진행 중이던 기록이 그 뒤에 끝난다 = 끝난 뒤에 가른다(그림을 지우지 않고 회수 목록에도 넣지 않는다)', async () => {
    await requestProposalTrial(input(37), saver());
    calls = [];
    const spy = lostWrite(2, 'inflight');
    try { await startProposalProduce(CO(37), { kind: 'resume' }, produceDeps(), true); } finally { spy.mockRestore(); }
    const row = (await readProposalTrial(CO(37)))!;
    expect(row.kit.posters![0]!.url).toContain('/api/cdp/inapp/image/');
    expect(row.garbage).toEqual([]);
    expect(count('removeFile:')).toBe(0);
    expect([row.status, row.produce_token]).toEqual(['requested', null]);
  });

  it('⛔ 제작: 포스터 기록이 적히지 않았다 = 그 자리에서 지우지 않고 회수 목록에 남긴다 → 다음 실행의 회수가 지운다', async () => {
    await requestProposalTrial(input(34), saver());
    calls = [];
    const spy = lostWrite(2, 'skipped');
    try { await startProposalProduce(CO(34), { kind: 'resume' }, produceDeps(), true); } finally { spy.mockRestore(); }
    let row = (await readProposalTrial(CO(34)))!;
    expect(count('removeFile:')).toBe(0);
    expect(calls).not.toContain('alert:orphan');
    expect((row.kit.posters || []).filter(Boolean)).toHaveLength(0);
    expect(row.garbage).toHaveLength(1);
    expect(row.garbage[0]).toMatchObject({ kind: 'poster', assetId: null });
    const parked = (row.garbage[0] as any).url.split('/').pop();
    calls = [];
    await startProposalProduce(CO(34), { kind: 'resume' }, produceDeps(), true);
    expect(calls[0]).toBe(`removeFile:${parked}`);            // 제작을 잇기 전에 회수부터
    row = (await readProposalTrial(CO(34)))!;
    expect([row.status, row.garbage]).toEqual(['produced', []]);
  });

  it('⛔ 제작: 답을 못 받은 기록이 회수 목록에 남긴 직후에 도착해도 적히지 못한다(소유권을 먼저 내려놓았다) — 완성본과 회수 목록이 같은 그림을 함께 가리키지 않는다', async () => {
    await requestProposalTrial(input(38), saver());
    calls = [];
    const spy = lostWrite(2, 'late');
    try { await startProposalProduce(CO(38), { kind: 'resume' }, produceDeps(), true); } finally { spy.mockRestore(); }
    const row = (await readProposalTrial(CO(38)))!;
    expect((row.kit.posters || []).filter(Boolean)).toHaveLength(0);   // 늦게 도착한 기록은 0행
    expect(row.garbage).toHaveLength(1);
    expect(count('removeFile:')).toBe(0);
  });

  it('⛔ 제작: 회수 목록에 남기지도 못하면(DB 가 죽음) 아무것도 지우지 않고 사람에게 알린다', async () => {
    await requestProposalTrial(input(39), saver());
    calls = [];
    const spy = lostWrite(2, 'failPark');
    try { await startProposalProduce(CO(39), { kind: 'resume' }, produceDeps(), true); } finally { spy.mockRestore(); }
    expect(count('removeFile:')).toBe(0);
    expect(calls).toContain('alert:orphan');
  });

  it('⛔ 제작: 모바일 DM 기록이 적히지 않았다 = 지우지 않고 회수 목록에 → 다음 회수가 지운다 · 실제로는 적혔다 = 두고 이어 한다', async () => {
    await produced(32);
    let spy = lostWrite(1, 'skipped');     // DM 다시 만들기 = 단계 기록 1 이 DM
    try { await startProposalProduce(CO(32), { kind: 'dm' }, produceDeps({ buildDm: async () => { calls.push('dm'); return 'dm-lost'; } }), true); } finally { spy.mockRestore(); }
    let row = (await readProposalTrial(CO(32)))!;
    expect(calls).not.toContain('deleteDm:dm-lost');
    expect(row.kit.dm).toBeUndefined();
    expect(row.garbage).toEqual([{ kind: 'dm', id: 'dm-lost' }]);
    calls = [];
    spy = lostWrite(1, 'applied');
    try { await startProposalProduce(CO(32), { kind: 'resume' }, produceDeps({ buildDm: async () => { calls.push('dm'); return 'dm-kept'; } }), true); } finally { spy.mockRestore(); }
    row = (await readProposalTrial(CO(32)))!;
    expect(calls[0]).toBe('deleteDm:dm-lost');
    expect(calls).not.toContain('deleteDm:dm-kept');
    expect([row.kit.dm, row.garbage]).toEqual([{ id: 'dm-kept', url: 'https://hanjul.ai/d/dm-kept' }, []]);
  });

  it('회수: 자산 번호가 안 적힌 포스터(자산 등재 뒤 그 기록이 실패한 경우)는 주소로 자산을 찾아 지운다', async () => {
    const url = `/api/cdp/inapp/image/${CO(32)}/unnumbered.jpg`;
    await pool.query('UPDATE proposal_trials SET garbage = $2::jsonb WHERE company_id = $1::uuid', [CO(32), JSON.stringify([{ kind: 'poster', assetId: null, url }])]);
    calls = [];
    expect(await collectProposalGarbage(CO(32), produceDeps({ assetIdOf: async (_c, u) => (u === url ? 'asset-by-url' : null) }))).toBe(0);
    expect(calls).toEqual(['deleteAsset:asset-by-url', 'removeFile:unnumbered.jpg']);
    expect((await readProposalTrial(CO(32)))!.garbage).toEqual([]);
  });
});

describe('다시 만들기 · 회수(실 PG) — 옛 참조는 회수 목록으로 가고, 지운 것만 목록에서 빠진다', () => {
  it('포스터 한 장 다시 = 옛 포스터가 회수되고 다음 템플릿으로 새로 만든다(다른 자리는 그대로)', async () => {
    const before = await produced(10);
    const old = before.kit.posters![1]!;
    expect(await startProposalProduce(CO(10), { kind: 'poster', index: 1 }, produceDeps(), true)).toEqual({ ok: true });
    const row = (await readProposalTrial(CO(10)))!;
    expect(row.status).toBe('produced');
    expect(row.garbage).toEqual([]);
    expect(calls).toContain(`deleteAsset:${old.assetId}`);
    expect(calls).toContain(`removeFile:${old.url.split('/').pop()}`);
    expect(calls.filter((c) => c.startsWith('poster:'))).toEqual(['poster:t3']);   // 자리 1 + 한 번 다시 = 다음 후보
    expect(row.kit.posters![1]!.url).not.toBe(old.url);
    expect(row.kit.posters![0]).toEqual(before.kit.posters![0]);
    expect(row.kit.dm).toEqual(before.kit.dm);
    expect(count('copies')).toBe(0);
  });

  it('첫 포스터를 다시 만들면 모바일 DM 도 다시 만든다 · 전체 다시 = 전부 회수하고 처음부터', async () => {
    const before = await produced(11);
    await startProposalProduce(CO(11), { kind: 'poster', index: 0 }, produceDeps(), true);
    expect(calls).toContain(`deleteDm:${before.kit.dm!.id}`);
    expect(count('dm')).toBe(1);
    expect(calls.indexOf(`deleteDm:${before.kit.dm!.id}`)).toBeLessThan(calls.findIndex((c) => c.startsWith('deleteAsset:')));   // DM 먼저 · 포스터 나중
    calls = [];
    await startProposalProduce(CO(11), { kind: 'all' }, produceDeps(), true);
    expect(count('deleteAsset:')).toBe(3);
    expect(count('deleteDm:')).toBe(1);
    expect(calls.filter((c) => !c.startsWith('alert') && !c.startsWith('delete') && !c.startsWith('removeFile'))).toEqual(['pick', 'poster:t1', 'asset', 'poster:t2', 'asset', 'poster:t3', 'asset', 'copies', 'dm', 'spam']);
    expect((await readProposalTrial(CO(11)))!.garbage).toEqual([]);
  });

  it('⛔ 회수 — 쓰이는 중인 포스터는 지우지 않고 목록에서만 뺀다 · 파일을 못 지우면 목록에 남아 다음에 다시 한다 · 자산 삭제가 던져도 남는다', async () => {
    const before = await produced(12);
    const [a, b, c] = before.kit.posters!.map((p) => p!);
    await pool.query('UPDATE proposal_trials SET garbage = $2::jsonb WHERE company_id = $1::uuid', [CO(12), JSON.stringify([
      { kind: 'poster', assetId: a.assetId, url: a.url }, { kind: 'poster', assetId: b.assetId, url: b.url }, { kind: 'poster', assetId: c.assetId, url: c.url }, { kind: 'dm', id: 'dm-x' },
    ])]);
    calls = [];
    const left = await collectProposalGarbage(CO(12), produceDeps({
      deleteAsset: async (_co, id) => { if (id === c.assetId) throw new Error('db'); return { deleted: id !== a.assetId, inUse: id === a.assetId }; },
      removeFile: (_co, url) => { calls.push(`removeFile:${url.split('/').pop()}`); return false; },
    }));
    expect(left).toBe(2);
    expect(calls).toEqual(['deleteDm:dm-x', `removeFile:${b.url.split('/').pop()}`]);   // 쓰이는 중인 a 는 파일을 건드리지 않았다
    expect((await readProposalTrial(CO(12)))!.garbage).toEqual([{ kind: 'poster', assetId: b.assetId, url: b.url }, { kind: 'poster', assetId: c.assetId, url: c.url }]);
    // 다음 회수 = 남은 것만 다시 한다 · 자산 행이 이미 없어도(지웠다고 답하지 않아도) 파일을 지운 뒤에 뺀다
    calls = [];
    expect(await collectProposalGarbage(CO(12), produceDeps({ deleteAsset: async () => ({ deleted: false, inUse: false }) }))).toBe(0);
    expect(count('removeFile:')).toBe(2);
    expect((await readProposalTrial(CO(12)))!.garbage).toEqual([]);
  });

  it('직원의 문안 고치기 · 발신번호 바꾸기 = 확인 대기일 때만 · 읽은 뒤 바뀌었으면 통하지 않는다 · 고치면 검사 결과가 지워진다', async () => {
    const before = await produced(13);
    expect(await editProposalCopy(CO(13), before.revision - 1, 0, { subject: '새 제목', text: '새 문안' })).toBe('changed');
    expect(await editProposalCopy(CO(13), before.revision, 5, { text: 'x' })).toBe('invalid');
    expect(await editProposalCopy(CO(13), before.revision, 0, { text: '   ' })).toBe('invalid');
    expect(await editProposalCopy(CO(13), before.revision, 0, { subject: '새 제목', text: '새 문안' })).toBe('ok');
    let row = (await readProposalTrial(CO(13)))!;
    expect(row.kit.copies![0]).toEqual({ subject: '새 제목', text: '새 문안', spam: 'none' });
    expect(row.kit.copies![1].spam).toBe('pass');
    expect(row.kit.spamDone).toBe(false);
    expect(row.revision).toBe(before.revision + 1);
    expect(await setProposalCallback(CO(13), row.revision, '02-999-0000', async () => ['0212345678'])).toBe('invalid');
    expect(await setProposalCallback(CO(13), row.revision, '02-1234-5678', async () => ['0212345678'])).toBe('ok');
    row = (await readProposalTrial(CO(13)))!;
    expect(row.kit.copies!.map((c) => c.spam)).toEqual(['none', 'none', 'none']);
    // 검사 다시 = 문안은 그대로 두고 검사만 다시 돈다
    calls = [];
    await startProposalProduce(CO(13), { kind: 'spam' }, produceDeps(), true);
    expect(calls.filter((c) => !c.startsWith('alert'))).toEqual(['spam']);
    expect((await readProposalTrial(CO(13)))!.kit.copies![0]).toEqual({ subject: '새 제목', text: '새 문안', spam: 'pass' });
  });
});

describe('전달 · 알림(실 PG)', () => {
  it('전달 = 확인 대기일 때만 · 알림 한 통 · 다시 누르면 통하지 않는다 · 전달한 뒤에는 다시 만들 수 없다', async () => {
    await produced(20);
    expect(await deliverProposalKit(CO(20), UU(99), await rev(20), deliverDeps())).toEqual({ result: 'ok', notice: 'sent' });
    const row = (await readProposalTrial(CO(20)))!;
    expect(row).toMatchObject({ status: 'delivered', delivered_by: UU(99), notify_tries: 1 });
    expect(row.notified_at).not.toBeNull();
    expect(calls).toEqual(['sms:01012345678']);   // 전달이 밖에 남기는 일은 안내 문자 한 통뿐이다
    calls = [];
    expect((await deliverProposalKit(CO(20), UU(99), row.revision, deliverDeps())).result).toBe('not_ready');
    expect(calls).toEqual([]);
    expect(await startProposalProduce(CO(20), { kind: 'all' }, produceDeps(), true)).toEqual({ ok: false, reason: 'delivered' });
    expect(await editProposalCopy(CO(20), row.revision, 0, { text: 'x' })).toBe('changed');
  });

  it('⛔ 두 사람이 동시에 전달을 눌러도 한 요청만 통하고 문자는 한 통', async () => {
    const r21 = (await produced(21)).revision;
    const got = await Promise.all([deliverProposalKit(CO(21), UU(98), r21, deliverDeps()), deliverProposalKit(CO(21), UU(99), r21, deliverDeps())]);
    expect(got.filter((g) => g.result === 'ok')).toHaveLength(1);
    expect(got.filter((g) => g.result === 'changed' || g.result === 'not_ready')).toHaveLength(1);
    expect(count('sms:')).toBe(1);
  });

  it('⛔ 직원 화면이 본 판이 아니면 전달이 통하지 않는다 — 그 뒤에 문안 고치기 · 다시 만들기가 끼었으면 본 적 없는 완성본이 나가지 않는다', async () => {
    const seen = (await produced(22)).revision;
    // 다른 직원이 그 사이 문안을 고쳤다(화면은 옛 판을 보고 있다)
    expect(await editProposalCopy(CO(22), seen, 0, { text: '그 사이 고친 문안' })).toBe('ok');
    expect((await deliverProposalKit(CO(22), UU(99), seen, deliverDeps())).result).toBe('changed');
    expect((await readProposalTrial(CO(22)))!.status).toBe('produced');
    expect(count('sms:')).toBe(0);
    // 화면을 새로 고쳐 고친 문안을 본 뒤(지금 판 번호)에는 전달된다 · 나가는 것은 고친 문안이다
    expect((await deliverProposalKit(CO(22), UU(99), await rev(22), deliverDeps())).result).toBe('ok');
    expect((await readProposalTrial(CO(22)))!.kit.copies![0].text).toBe('그 사이 고친 문안');
    expect(count('sms:')).toBe(1);
    // 포스터 한 장을 다시 만든 뒤에도 옛 판 번호로는 전달하지 못한다
    const old = (await produced(27)).revision;
    await startProposalProduce(CO(27), { kind: 'poster', index: 2 }, produceDeps(), true);
    calls = [];
    expect((await deliverProposalKit(CO(27), UU(99), old, deliverDeps())).result).toBe('changed');
    expect((await readProposalTrial(CO(27)))!.status).toBe('produced');
    expect(count('sms:')).toBe(0);
  });

  it('포스터 · 문안이 덜 된 완성본은 전달하지 못한다', async () => {
    await produced(23);
    await pool.query(`UPDATE proposal_trials SET kit = jsonb_set(kit, '{posters,2}', 'null'::jsonb) WHERE company_id = $1::uuid`, [CO(23)]);
    expect((await deliverProposalKit(CO(23), UU(99), await rev(23), deliverDeps())).result).toBe('incomplete');
    expect((await deliverProposalKit('00000000-0000-0000-0000-00000c136cff', UU(99), 0, deliverDeps())).result).toBe('none');
  });

  it('알림 세 상태 — 적재를 못 하면 「확인되지 않음」 · 2분 동안은 다시 보내기가 통하지 않는다 · 화면이 본 시도 수일 때만 · 보낸 뒤에는 다시 안 간다', async () => {
    await produced(24);
    expect(await deliverProposalKit(CO(24), UU(99), await rev(24), deliverDeps({ sendNotice: async () => { throw new Error('mysql down'); } }))).toEqual({ result: 'ok', notice: 'unknown' });
    let row = (await readProposalTrial(CO(24)))!;
    expect(row).toMatchObject({ status: 'delivered', notify_tries: 1, notified_at: null });
    expect(await notifyProposalReady(CO(24), 1, deliverDeps())).toBe('held');          // 앞 시도 뒤 2분 안
    expect(count('sms:')).toBe(0);
    await pool.query(`UPDATE proposal_trials SET notify_tried_at = now() - interval '3 minutes' WHERE company_id = $1::uuid`, [CO(24)]);
    expect(await notifyProposalReady(CO(24), 0, deliverDeps())).toBe('held');          // 화면이 본 시도 수가 다르다
    const both = await Promise.all([notifyProposalReady(CO(24), 1, deliverDeps()), notifyProposalReady(CO(24), 1, deliverDeps())]);
    expect(both.sort()).toEqual(['held', 'sent']);                                      // 둘이 동시에 눌러도 한 통
    expect(count('sms:')).toBe(1);
    row = (await readProposalTrial(CO(24)))!;
    expect(row.notify_tries).toBe(2);
    expect(row.notified_at).not.toBeNull();
    await pool.query(`UPDATE proposal_trials SET notify_tried_at = now() - interval '3 minutes' WHERE company_id = $1::uuid`, [CO(24)]);
    expect(await notifyProposalReady(CO(24), 2, deliverDeps())).toBe('held');          // 이미 보냈다
    // 번호가 없으면 보내지 않는다
    await produced(25);
    await pool.query('UPDATE proposal_trials SET notify_phone = NULL WHERE company_id = $1::uuid', [CO(25)]);
    expect((await deliverProposalKit(CO(25), UU(99), await rev(25), deliverDeps())).notice).toBe('no_phone');
  });
});

describe('담당자 화면 · 채우기(실 PG) — 신청자 본인과 회사 관리자만', () => {
  const me = { userId: UU(20), companyId: CO(20), userType: 'company_user' };
  const admin = { userId: UU(77), companyId: CO(20), userType: 'company_admin' };
  const stranger = { userId: UU(78), companyId: CO(20), userType: 'company_user' };

  it('신청 전 = 없음 · 만드는 중 = 진행(번호는 가려서) · 같은 회사의 다른 일반 사용자 = 「이미 신청함」만 · 전달됨 = 완성본', async () => {
    expect(await proposalViewFor({ userId: UU(60), companyId: CO(60), userType: 'company_admin' })).toEqual({ state: 'none' });
    await requestProposalTrial(input(26), saver());
    expect(await proposalViewFor({ userId: UU(26), companyId: CO(26), userType: 'company_user' }))
      .toMatchObject({ state: 'working', brief: '겨울 신상 니트 입고', channel: 'MMS', notifyPhone: '010-****-5678' });
    expect(await proposalViewFor(stranger)).toEqual({ state: 'other' });
    // ⛔ 확인 대기(직원이 아직 전달하지 않은) 완성본은 관리자 계정에게도 내려가지 않는다
    const waiting: any = await proposalViewFor({ userId: UU(13), companyId: CO(13), userType: 'company_admin' });
    expect((await readProposalTrial(CO(13)))!.status).toBe('produced');
    expect(waiting.state).toBe('working');
    expect([waiting.posters, waiting.copies, waiting.dmUrl]).toEqual([undefined, undefined, undefined]);
    await pool.query('UPDATE proposal_trials SET opened_at = NULL, used_at = NULL WHERE company_id = $1::uuid', [CO(20)]);
    const view: any = await proposalViewFor(me);
    expect(view.state).toBe('ready');
    expect(view.posters).toHaveLength(3);
    expect(view.copies).toHaveLength(3);
    expect(view.dmUrl).toContain('https://hanjul.ai/d/');
    const opened = (await readProposalTrial(CO(20)))!.opened_at;
    expect(opened).not.toBeNull();
    await proposalViewFor(admin);
    expect((await readProposalTrial(CO(20)))!.opened_at).toEqual(opened);   // 처음 연 시각만 남는다
  });

  it('⛔ 채우기 = 지금 계정의 권한과 전달 상태를 다시 본다 · 고른 번호의 문안과 포스터 자산만 준다 · 처음 누른 시각을 적는다', async () => {
    const row = (await readProposalTrial(CO(20)))!;
    expect(await proposalFillFor(stranger, { poster: 0, copy: 0, withDm: false })).toBeNull();
    expect(await proposalFillFor({ userId: UU(20), companyId: CO(21), userType: 'company_user' }, { poster: 0, copy: 0, withDm: false })).toBeNull();   // 다른 회사의 완성본
    expect(await proposalFillFor({ userId: UU(26), companyId: CO(26), userType: 'company_user' }, { poster: null, copy: 0, withDm: false })).toBeNull();   // 아직 만드는 중
    expect(await proposalFillFor({ userId: UU(13), companyId: CO(13), userType: 'company_admin' }, { poster: 0, copy: 0, withDm: false })).toBeNull();   // 다 만들었지만 아직 전달 전
    expect((await readProposalTrial(CO(13)))!.used_at).toBeNull();
    expect((await readProposalTrial(CO(20)))!.used_at).toBeNull();
    expect(await proposalFillFor(me, { poster: 1, copy: 2, withDm: false })).toEqual({ message: '문안3', subject: '제목3', msgType: 'MMS', assetId: row.kit.posters![1]!.assetId });
    expect((await readProposalTrial(CO(20)))!.used_at).not.toBeNull();
    expect(await proposalFillFor(admin, { poster: null, copy: 0, withDm: false })).toEqual({ message: '문안1', subject: '제목1', msgType: 'LMS', assetId: null });
    expect(await proposalFillFor(me, { poster: null, copy: 0, withDm: true })).toEqual({ message: `문안1\n\n${row.kit.dm!.url}`, subject: '제목1', msgType: 'LMS', assetId: null });
    expect(await proposalFillFor(me, { poster: 0, copy: 7, withDm: false })).toBeNull();
  });
});

describe('현황 · 그 밖의 읽기(실 PG) — 문장이 실제 표에서 돈다', () => {
  it('링크별 = src 마다 열람 수 · 로그인한 회사 수 · 회사별 = 로그인만 한 회사도 나온다 · 상세', async () => {
    for (let i = 0; i < 3; i++) await recordAuditLog({ action: PROPOSAL_AUDIT.view, targetType: PROPOSAL_AUDIT_TARGET, details: { src: 'c136-kim' } });
    await recordAuditLog({ action: PROPOSAL_AUDIT.view, targetType: PROPOSAL_AUDIT_TARGET, details: { src: '' } });
    await recordAuditLog({ actorUserId: UU(20), action: PROPOSAL_AUDIT.open, targetType: PROPOSAL_AUDIT_TARGET, targetId: CO(20), details: { src: 'c136-kim' } });
    await recordAuditLog({ actorUserId: UU(20), action: PROPOSAL_AUDIT.open, targetType: PROPOSAL_AUDIT_TARGET, targetId: CO(20), details: { src: 'c136-kim' } });
    await recordAuditLog({ actorUserId: UU(61), action: PROPOSAL_AUDIT.open, targetType: PROPOSAL_AUDIT_TARGET, targetId: CO(61), details: { src: 'c136-kim' } });
    const { links, companies } = await loadProposalAdmin();
    expect(links.find((l) => l.src === 'c136-kim')).toMatchObject({ views: 3, companies: 2 });
    const done = companies.find((c) => c.company_id === CO(20));
    expect(done).toMatchObject({ status: 'delivered', src: 'kim-test', sent_after: 0, notify_tries: 1 });
    expect(done.first_open).not.toBeNull();
    const openedOnly = companies.find((c) => c.company_id === CO(61));
    expect(openedOnly).toMatchObject({ status: null, src: 'c136-kim', sent_after: 0 });
    const detail = (await loadProposalAdminDetail(CO(20)))!;
    expect(detail.row.status).toBe('delivered');
    expect(detail.producing).toBe(false);
    expect(Array.isArray(detail.callbacks)).toBe(true);
    expect(await loadProposalAdminDetail('00000000-0000-0000-0000-00000c136cff')).toBeNull();
  });

  it('번호 미리 채움 · 소개 글의 금액 문장 = 실제 표를 읽는다(없으면 빈 글자)', async () => {
    expect(await proposalPrefillPhone(UU(1))).toBe('');
    const page = await proposalPageContent(true);
    expect(page.css).toContain('.ppg ');
    expect(page.html).not.toContain('{{agencyPrice}}');
    expect(page.html).toMatch(/비즈니스 요금제(\(월 [0-9,]+만 원\))?부터/);
    expect((await proposalPageContent(false)).html).toBe('');
  });
});
