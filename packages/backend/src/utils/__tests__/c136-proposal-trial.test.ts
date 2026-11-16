// replaces: none
/**
 * C136 배포 나 — 제안 페이지 + 제작 대행 체험(★ 2026-11-16 · 설계서 docs/2026-11-16-c136-proposal-kit-trial-design.md §3 ~ §7 · §11)
 *   1. 순수 판정 = 신청 본문 · 사진 · 다시 만들기(빠지는 참조 → 회수 목록) · 완성 여부 · 열람 권한 · 금액 글자
 *   2. 화면 쪽 = 넘김 값은 번호뿐 · 계정 · 회사 · 10분 · 한 번만 · 로그인 뒤 복귀 · 관리자 탭의 단계 · 알림 상태
 *   3. 소스 계약 = 문 순서 · 소개 글은 서버에만 · 보호 파일 무접촉 · 크레딧 원장 무접촉 · 작성 화면은 누른 뒤에만 채운다
 *   SQL 이 실제 표에서 도는지 · 동시 요청 = c136-proposal-trial.pg.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fsModule, { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(), pool: { query: vi.fn(), connect: vi.fn() } }));

import {
  PROPOSAL_BRIEF_MAX, PROPOSAL_EXTRA_MAX, PROPOSAL_PHOTO_MAX_BYTES, PROPOSAL_NOTIFY_HOLD_MINUTES, PROPOSAL_READY_TEXT,
  PROPOSAL_INSERT_SQL, PROPOSAL_CLAIM_SQL, PROPOSAL_STEP_SQL, PROPOSAL_DELIVER_SQL, PROPOSAL_NOTIFY_TRY_SQL, PROPOSAL_PARK_SQL, PROPOSAL_TAKEOVER_MINUTES,
  cleanProposalSrc, parseProposalRequest, checkProposalPhotos, kitRefs, applyProposalRedo, kitComplete, maskPhone, agencyPriceText, canViewProposal, spamStateOf,
  type ProposalKit,
} from '../proposal-trial';
import { PROPOSAL_PAGE_CSS, PROPOSAL_INTRO_HTML } from '../../content/gated/proposal-page';
import { gatedImageFile } from '../gated-content';
import { gatedImageNames } from '../../../../frontend/src/utils/gated-content';
import {
  cleanProposalSrc as cleanSrcFront, stashProposalPick, takeProposalPick, PROPOSAL_PICK_MAX_AGE_MS,
} from '../../../../frontend/src/utils/proposal-kit';
import { isLoginReturnAllowed, rememberLoginReturn, rememberExplicitLoginReturn, takeLoginReturn } from '../../../../frontend/src/utils/login-return';
import { PROPOSAL_STAGES, PROPOSAL_NOTIFY_HOLD_MS, proposalStageOf, proposalNotifyState, mergeProposalDrafts, proposalDraftDirty } from '../../../../frontend/src/utils/proposal-admin';

const SRC = join(__dirname, '..', '..');
const FRONT = join(SRC, '..', '..', 'frontend');
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, '$1');
const back = (rel: string) => read(join(SRC, rel));
const front = (rel: string) => read(join(FRONT, 'src', rel));
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

const jpg = (size = 64) => { const b = Buffer.alloc(size); b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; return { buffer: b }; };
const poster = (n: number, asset: string | null = `a${n}`) => ({ url: `/api/cdp/inapp/image/c/p${n}.jpg`, assetId: asset, templateId: `t${n}` });
const copies = () => [1, 2, 3].map((n) => ({ subject: `s${n}`, text: `x${n}`, spam: 'pass' as const }));
const fullKit = (): ProposalKit => ({ title: '제목', picks: ['t1', 't2', 't3'], posters: [poster(1), poster(2), poster(3)], redo: [0, 0, 0], copies: copies(), dm: { id: 'dm-1', url: 'https://hanjul.ai/d/x' }, callback: '021234', spamDone: true });

describe('신청 본문 · 사진(순수)', () => {
  const ok = { channel: 'mms', brief: '  겨울   신상\n니트 입고 ', extra: '', notifyPhone: '010-1234-5678', src: 'kim.01' };

  it('본문 = 방식 · 한 줄 · 번호를 본다 · 공백은 한 칸으로 · 번호는 숫자만 · src 는 꼴이 맞을 때만', () => {
    expect(parseProposalRequest(ok)).toEqual({ ok: true, value: { channel: 'MMS', brief: '겨울 신상 니트 입고', extra: null, notifyPhone: '01012345678', src: 'kim.01' } });
    expect(parseProposalRequest({ ...ok, channel: 'LMS', extra: ' 이메일도  ', src: '<script>' })).toMatchObject({ ok: true, value: { channel: 'LMS', extra: '이메일도', src: null } });
    for (const bad of [
      { ...ok, channel: 'SMS' }, { ...ok, channel: '' }, { ...ok, brief: '   ' }, { ...ok, brief: 'a'.repeat(PROPOSAL_BRIEF_MAX + 1) },
      { ...ok, extra: 'a'.repeat(PROPOSAL_EXTRA_MAX + 1) }, { ...ok, notifyPhone: '02-123-4567' }, { ...ok, notifyPhone: '0101234' }, { ...ok, notifyPhone: '' }, null, undefined,
    ]) expect(parseProposalRequest(bad as any).ok, String(JSON.stringify(bad)).slice(0, 50)).toBe(false);
    expect(parseProposalRequest({ ...ok, brief: 'a'.repeat(PROPOSAL_BRIEF_MAX) }).ok).toBe(true);
  });

  it('사진 = 3 ~ 4장 · 실제 그림 바이트 · 장당 10MB', () => {
    expect(checkProposalPhotos([jpg(), jpg(), jpg()])).toBeNull();
    expect(checkProposalPhotos([jpg(), jpg(), jpg(), jpg()])).toBeNull();
    expect(checkProposalPhotos([jpg(), jpg()])).toContain('3 ~ 4장');
    expect(checkProposalPhotos([jpg(), jpg(), jpg(), jpg(), jpg()])).toContain('3 ~ 4장');
    expect(checkProposalPhotos(null)).toContain('3 ~ 4장');
    expect(checkProposalPhotos([jpg(), jpg(), { buffer: Buffer.from('<html>not an image</html>') }])).toContain('JPG');
    expect(checkProposalPhotos([jpg(), jpg(), { buffer: Buffer.alloc(0) }])).toContain('10MB');
    expect(checkProposalPhotos([jpg(), jpg(), jpg(PROPOSAL_PHOTO_MAX_BYTES + 1)])).toContain('10MB');
  });

  it('src = 영문 · 숫자 · - _ . 40자 · 화면과 서버가 같은 꼴을 받는다', () => {
    for (const v of ['kim', 'a.b-c_d', 'A1', 'a'.repeat(40), ' kim ', '', 'a'.repeat(41), 'a b', '한글', 'a/b', 'a?b=1', null, 7, undefined]) {
      expect(cleanSrcFront(v), String(v)).toBe(cleanProposalSrc(v));
    }
    expect(cleanProposalSrc(' kim ')).toBe('kim');
    expect(cleanProposalSrc('a/b')).toBeNull();
  });
});

describe('사진 저장 CT(campaign-quick saveMaterialImages) — 한 장이라도 쓰다 실패하면 이 호출이 쓴 파일을 거두고 던진다', () => {
  it('둘째 장에서 쓰기가 실패하면 첫째 장 파일도 남지 않는다 · 성공할 때의 반환은 그대로(그림이 아닌 것은 건너뛴다)', async () => {
    const { saveMaterialImages } = await import('../campaign-quick');
    // 실제 폴더에 쓴다(시험 전용 회사 이름 · 끝나면 폴더째 지운다)
    const company = `c136-save-test-${process.pid}`;
    const dir = join(process.cwd(), 'uploads', 'dm-images', company);
    try {
      // 그림 판정은 지나지만 파일로 쓸 수 없는 값(Buffer 가 아니다) = 둘째 장에서 쓰기가 던진다
      const unwritable = { buffer: { length: 64, 0: 0xff, 1: 0xd8, 2: 0xff } as unknown as Buffer };
      expect(() => saveMaterialImages(company, [jpg(), unwritable, jpg()])).toThrow();
      expect(readdirSync(dir)).toEqual([]);
      const out = saveMaterialImages(company, [jpg(), { buffer: Buffer.from('<html>not an image</html>') }, jpg()]);
      expect(out).toHaveLength(2);
      expect(out.every((o) => o.url.startsWith(`/api/dm/v/images/${company}/`))).toBe(true);
      expect(readdirSync(dir)).toHaveLength(2);
    } finally {
      fsModule.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('다시 만들기(순수) — kit 에서 빠지는 참조는 빠짐없이 회수 목록으로 간다', () => {
  it('kit 이 가리키는 밖의 산출물 = DM + 주소가 있는 포스터 전부(자산 번호가 아직 없어도)', () => {
    expect(kitRefs(fullKit())).toEqual([{ kind: 'dm', id: 'dm-1' }, ...[1, 2, 3].map((n) => ({ kind: 'poster', assetId: `a${n}`, url: poster(n).url }))]);
    expect(kitRefs({ posters: [poster(1, null), null, null] })).toEqual([{ kind: 'poster', assetId: null, url: poster(1).url }]);
    expect(kitRefs({})).toEqual([]);
    expect(kitRefs(null)).toEqual([]);
  });

  it('⛔ 어떤 다시 만들기든 「앞 kit 의 참조 = 뒤 kit 의 참조 + 회수 목록」(어디에도 안 적힌 산출물 0)', () => {
    const key = (g: any) => (g.kind === 'dm' ? `dm:${g.id}` : `poster:${g.url}`);
    const redos = [{ kind: 'resume' }, { kind: 'all' }, { kind: 'spam' }, { kind: 'dm' }, { kind: 'poster', index: 0 }, { kind: 'poster', index: 1 }, { kind: 'poster', index: 2 }, { kind: 'poster', index: 3 }, { kind: 'poster', index: -1 }, { kind: 'poster', index: 1.5 }] as const;
    const kits: ProposalKit[] = [fullKit(), { ...fullKit(), dm: null }, { posters: [poster(1, null), null, null] }, {}];
    for (const kit of kits) for (const redo of redos) {
      const out = applyProposalRedo(kit, redo as any);
      expect([...kitRefs(out.kit), ...out.garbage].map(key).sort(), JSON.stringify(redo)).toEqual(kitRefs(kit).map(key).sort());
    }
  });

  it('이어 하기 = 그대로 · 전체 = 빈 kit · 검사 다시 = 문안은 두고 결과만 지운다 · DM 다시 = DM 만 뺀다', () => {
    const kit = fullKit();
    expect(applyProposalRedo(kit, { kind: 'resume' })).toEqual({ kit, garbage: [] });
    expect(applyProposalRedo(kit, { kind: 'all' }).kit).toEqual({});
    const spam = applyProposalRedo(kit, { kind: 'spam' });
    expect(spam.kit.copies).toEqual(copies().map((c) => ({ ...c, spam: 'none' })));
    expect(spam.kit).toMatchObject({ spamDone: false, posters: kit.posters, dm: kit.dm });
    const dm = applyProposalRedo(kit, { kind: 'dm' });
    expect('dm' in dm.kit).toBe(false);
    expect(dm.kit.posters).toEqual(kit.posters);
    expect(dm.garbage).toEqual([{ kind: 'dm', id: 'dm-1' }]);
  });

  it('포스터 한 장 다시 = 그 자리만 비우고 다시 만든 횟수를 올린다 · 첫 장이면 DM 도 뺀다 · 범위 밖 번호 = 아무 일도 없다', () => {
    const kit = fullKit();
    const one = applyProposalRedo(kit, { kind: 'poster', index: 1 });
    expect(one.kit.posters).toEqual([poster(1), null, poster(3)]);
    expect(one.kit.redo).toEqual([0, 1, 0]);
    expect(one.kit.dm).toEqual(kit.dm);
    expect(one.garbage).toEqual([{ kind: 'poster', assetId: 'a2', url: poster(2).url }]);
    const first = applyProposalRedo(kit, { kind: 'poster', index: 0 });
    expect('dm' in first.kit).toBe(false);
    expect(first.garbage).toEqual([{ kind: 'poster', assetId: 'a1', url: poster(1).url }, { kind: 'dm', id: 'dm-1' }]);
    expect(applyProposalRedo(one.kit, { kind: 'poster', index: 1 }).kit.redo).toEqual([0, 2, 0]);
    expect(applyProposalRedo(kit, { kind: 'poster', index: 3 })).toEqual({ kit, garbage: [] });
  });

  it('완성 여부 = 포스터 3(자산 등재까지) · 문안 3(본문 있음) · DM 은 없어도 완성이다', () => {
    expect(kitComplete(fullKit())).toBe(true);
    expect(kitComplete({ ...fullKit(), dm: null })).toBe(true);
    expect(kitComplete({ ...fullKit(), posters: [poster(1), poster(2), poster(3, null)] })).toBe(false);
    expect(kitComplete({ ...fullKit(), posters: [poster(1), null, poster(3)] })).toBe(false);
    expect(kitComplete({ ...fullKit(), posters: [poster(1), poster(2)] })).toBe(false);
    expect(kitComplete({ ...fullKit(), copies: copies().slice(0, 2) })).toBe(false);
    expect(kitComplete({ ...fullKit(), copies: copies().map((c, i) => (i === 2 ? { ...c, text: '' } : c)) })).toBe(false);
    expect(kitComplete({})).toBe(false);
    expect(kitComplete(null)).toBe(false);
  });
});

describe('열람 권한 · 표시 글(순수)', () => {
  it('완성본 · 진행 상태 = 신청자 본인 + 회사 관리자(같은 회사의 다른 일반 사용자 · 행 없음 = 못 본다)', () => {
    const row = { requested_by: 'u-1' };
    expect(canViewProposal(row, { userId: 'u-1', userType: 'company_user' })).toBe(true);
    expect(canViewProposal(row, { userId: 'u-9', userType: 'company_admin' })).toBe(true);
    expect(canViewProposal(row, { userId: 'u-9', userType: 'company_user' })).toBe(false);
    expect(canViewProposal(row, { userType: 'company_user' })).toBe(false);
    expect(canViewProposal(null, { userId: 'u-1', userType: 'company_admin' })).toBe(false);
  });

  it('검사 판정 → 완성본 상태: 확인 중 · 검사 중 = 「확인 중」(통과도 차단도 아니다) · 보낼 수 없는 글자 · 검사 장애는 제 이름으로', () => {
    expect((['pass', 'blocked', 'unconfirmed', 'pending', 'rejected', 'error'] as const).map((v) => spamStateOf(v))).toEqual(['pass', 'blocked', 'checking', 'checking', 'rejected', 'unknown']);
  });

  it('번호 가리기 · 금액 글자(만 원 단위로 떨어질 때만 · 그 밖 = 빈 글자) · 도착 문자', () => {
    expect(maskPhone('01012345678')).toBe('010-****-5678');
    expect(maskPhone('010-123-4567')).toBe('010-****-4567');
    expect(maskPhone('1234')).toBe('');
    expect(maskPhone(null)).toBe('');
    expect(agencyPriceText(3000000)).toBe('(월 300만 원)');
    expect(agencyPriceText('12500000')).toBe('(월 1,250만 원)');
    for (const v of [0, -1, 3005000, null, undefined, 'x', NaN]) expect(agencyPriceText(v), String(v)).toBe('');
    expect(PROPOSAL_READY_TEXT).toContain('https://hanjul.ai/proposal');
    expect(PROPOSAL_READY_TEXT).not.toMatch(/\(광고\)|—|·/);   // 안내 문자다(광고 아님) · 줄표 · 가운뎃점 없음
  });

  it('문장의 조건 — 자리 먼저 · 소유권 = 토큰 · 가져가기 30분 · 전달 = 확인 대기 ∧ 읽은 판 · 알림 = 본 시도 수 ∧ 2분', () => {
    expect(PROPOSAL_INSERT_SQL).toMatch(/ON CONFLICT \(company_id\) DO NOTHING\s+RETURNING/);
    expect(PROPOSAL_STEP_SQL).toMatch(/produce_token = \$2::uuid/);
    expect(PROPOSAL_STEP_SQL).not.toMatch(/produce_beat_at\s*[<>]/);          // 시각은 소유권 조건이 아니다
    expect(PROPOSAL_CLAIM_SQL).toContain(`produce_beat_at < now() - interval '${PROPOSAL_TAKEOVER_MINUTES} minutes'`);
    expect(PROPOSAL_CLAIM_SQL).toMatch(/revision = \$3/);
    expect(PROPOSAL_DELIVER_SQL).toMatch(/status = 'produced' AND revision = \$2::int/);
    expect(PROPOSAL_DELIVER_SQL).not.toMatch(/\bkit\b/);            // 전달은 완성본을 고치지 않는다
    expect(PROPOSAL_STEP_SQL).toContain('garbage = garbage || $4::jsonb');   // 단계 기록과 회수 목록이 한 문장
    expect(PROPOSAL_NOTIFY_TRY_SQL).toMatch(/notify_tries = \$2/);
    expect(PROPOSAL_NOTIFY_TRY_SQL).toContain(`notify_tried_at < now() - interval '${PROPOSAL_NOTIFY_HOLD_MINUTES} minutes'`);
    expect(PROPOSAL_NOTIFY_TRY_SQL).toMatch(/notified_at IS NULL/);
  });
});

describe('화면 쪽(순수) — 넘김 값 · 로그인 뒤 복귀 · 관리자 탭 표시', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as any).sessionStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
  });
  afterEach(() => { delete (globalThis as any).sessionStorage; });
  const me = { userId: 'u-1', companyId: 'c-1' };
  const pick = { ...me, poster: 1, copy: 2, withDm: false };

  it('⛔ 넘김 값에는 번호와 계정 · 회사 · 시각만 있다(문안 · 주소 = 0)', () => {
    expect(stashProposalPick(pick, 1000)).toBe(true);
    expect(store.size).toBe(1);
    expect(JSON.parse([...store.values()][0])).toEqual({ ...pick, at: 1000 });
    expect(takeProposalPick(me, 2000)).toEqual({ ...pick, at: 1000 });
    expect(store.size).toBe(0);                       // 한 번 꺼내면 지워진다
    expect(takeProposalPick(me, 2000)).toBeNull();
  });

  it('⛔ 다른 계정 · 다른 회사 · 10분 뒤 · 꼴이 틀린 값 = 쓰지 않는다(그래도 값은 지워진다)', () => {
    const cases: Array<[any, any, number]> = [
      [pick, { userId: 'u-2', companyId: 'c-1' }, 2000], [pick, { userId: 'u-1', companyId: 'c-2' }, 2000], [pick, null, 2000], [pick, { userId: 'u-1' }, 2000],
      [pick, me, 1000 + PROPOSAL_PICK_MAX_AGE_MS + 1], [pick, me, 999],
      [{ ...pick, copy: 3 }, me, 2000], [{ ...pick, copy: '1' }, me, 2000], [{ ...pick, poster: 5 }, me, 2000], [{ ...pick, poster: undefined }, me, 2000], [{ ...pick, withDm: 'yes' }, me, 2000],
    ];
    for (const [value, who, now] of cases) {
      stashProposalPick(value, 1000);
      expect(takeProposalPick(who, now), JSON.stringify([value, who, now]).slice(0, 90)).toBeNull();
      expect(store.size).toBe(0);
    }
    store.set('hj_proposal_kit_pick', '{broken');
    expect(takeProposalPick(me, 2000)).toBeNull();
    stashProposalPick({ ...pick, poster: null, withDm: true }, 1000);
    expect(takeProposalPick(me, 1000 + PROPOSAL_PICK_MAX_AGE_MS)).toMatchObject({ poster: null, withDm: true });
    delete (globalThis as any).sessionStorage;        // 저장이 막힌 브라우저 = 넘기지 못함 · 꺼내지 못함(던지지 않는다)
    expect(stashProposalPick(pick)).toBe(false);
    expect(takeProposalPick(me)).toBeNull();
  });

  it('로그인 뒤 복귀 = /proposal 과 꼴이 맞는 src 만 · 「로그인」을 누른 쪽이 옛 카페24 복귀 값을 이긴다', () => {
    for (const ok of ['/proposal', '/proposal?src=kim.01', `/proposal?src=${'a'.repeat(40)}`]) expect(isLoginReturnAllowed(ok), ok).toBe(true);
    for (const bad of ['/proposal/', '/proposal?src=', '/proposal?src=a&next=//evil.example', '/proposal?next=/x', `/proposal?src=${'a'.repeat(41)}`, '//evil.example/proposal', '/proposal#x', 'https://evil.example/proposal']) {
      expect(isLoginReturnAllowed(bad), bad).toBe(false);
    }
    store.set('cafe24_return_mall_id', 'mall-1');
    rememberLoginReturn('/proposal?src=kim');                        // 보호 경로가 남기는 쪽은 카페24 값을 건드리지 않는다
    expect(store.get('cafe24_return_mall_id')).toBe('mall-1');
    rememberExplicitLoginReturn('/proposal?src=a&next=//evil');      // 허용 밖 = 아무 일도 없다
    expect(store.get('cafe24_return_mall_id')).toBe('mall-1');
    rememberExplicitLoginReturn('/proposal?src=kim');
    expect(store.has('cafe24_return_mall_id')).toBe(false);
    expect(takeLoginReturn()).toBe('/proposal?src=kim');
    expect(takeLoginReturn()).toBeNull();
  });

  it('관리자 탭 — 단계 일곱 · 지나온 단계 수 · 우리 쪽에서 기다리는 자리', () => {
    const base = { status: null, opened_at: null, used_at: null, sent_after: 0, produce_error: null } as any;
    expect(PROPOSAL_STAGES).toHaveLength(7);
    expect(proposalStageOf(base)).toEqual({ done: 1, label: '로그인까지', waiting: false });
    expect(proposalStageOf({ ...base, status: 'requested' })).toEqual({ done: 2, label: '제작 대기', waiting: true });
    expect(proposalStageOf({ ...base, status: 'requested', produce_error: '끊김' }).label).toBe('제작 멈춤');
    expect(proposalStageOf({ ...base, status: 'producing' })).toEqual({ done: 2, label: '제작 중', waiting: true });
    expect(proposalStageOf({ ...base, status: 'produced' })).toEqual({ done: 3, label: '확인 대기', waiting: true });
    expect(proposalStageOf({ ...base, status: 'delivered' })).toEqual({ done: 4, label: '전달함', waiting: false });
    expect(proposalStageOf({ ...base, status: 'delivered', opened_at: 'x' }).done).toBe(5);
    expect(proposalStageOf({ ...base, status: 'delivered', opened_at: 'x', used_at: 'y' }).done).toBe(6);
    expect(proposalStageOf({ ...base, status: 'delivered', opened_at: 'x', used_at: 'y', sent_after: 2 })).toEqual({ done: 7, label: '보내기 누름 뒤 직접발송 2건', waiting: false });
    // 누르지 않은 회사의 직접발송은 「발송」으로 세지 않는다
    expect(proposalStageOf({ ...base, status: 'delivered', opened_at: 'x', sent_after: 9 }).done).toBe(5);
  });

  it('⛔ 관리자 탭 — 편집 칸은 서버 문안을 따른다(Codex 구현 1R): 빈 칸에서 시작해도 채워진다 · 손댄 칸은 그 서버 값이 그대로일 때만 지킨다', () => {
    const s = (n: number) => ({ subject: `제목${n}`, text: `문안${n}` });
    const server = [s(1), s(2), s(3)];
    // 제작 중에 열었다(문안 없음) → 제작이 끝난 뒤 읽으면 서버 문안이 보인다
    expect(mergeProposalDrafts([], [], server)).toEqual(server);
    // 손대지 않은 칸 = 서버 값 · 손댄 칸(둘째) = 지킨다
    const edited = [s(1), { subject: '제목2', text: '고치는 중' }, s(3)];
    expect(mergeProposalDrafts(edited, server, server)).toEqual(edited);
    // 그 사이 서버의 둘째 문안이 바뀌었다(다시 만들기 · 다른 직원의 저장) = 서버 값을 보인다(본 적 없는 문안이 전달되지 않게)
    const regenerated = [s(1), { subject: '새 제목', text: '새 문안' }, s(3)];
    expect(mergeProposalDrafts(edited, server, regenerated)).toEqual(regenerated);
    // 저장한 뒤 = 서버 값과 같다 · 문안 수가 줄거나 늘어도 서버 수를 따른다
    expect(mergeProposalDrafts(edited, server, [s(1), edited[1], s(3)])).toEqual([s(1), edited[1], s(3)]);
    expect(mergeProposalDrafts(edited, server, [])).toEqual([]);
    expect(mergeProposalDrafts([s(1)], [s(1)], server)).toEqual(server);
    // 손댄 칸 판정 = 저장된 값과 다르다(제목 없음 = 빈 글자)
    expect(proposalDraftDirty(edited[1], { subject: '제목2', text: '문안2' })).toBe(true);
    expect(proposalDraftDirty(s(1), { subject: '제목1', text: '문안1' })).toBe(false);
    expect(proposalDraftDirty({ subject: '', text: 'x' }, { subject: null, text: 'x' })).toBe(false);
    expect(proposalDraftDirty(undefined, { text: 'x' })).toBe(false);
    expect(proposalDraftDirty(s(1), undefined)).toBe(false);
    // 화면: 읽을 때마다 같은 규칙 · 저장하지 않은 문안이 있으면 전달 단추가 잠긴다
    const tab = strip(front('components/admin/ProposalTrialTab.tsx'));
    expect(tab).toContain('setDrafts((prev) => mergeProposalDrafts(prev, base, server));');
    expect(tab).not.toMatch(/keepDrafts/);
    expect(tab).toContain('const unsaved = drafts.some((d, i) => proposalDraftDirty(d, kit.copies?.[i]));');
    expect(tab).toContain("disabled={row.status !== 'produced' || busy || unsaved}");
  });

  it('관리자 탭 — 도착 알림의 상태 = 서버의 2분과 같은 값 · 시도 뒤 2분 안에는 「보내는 중」(다시 보내기 없음)', () => {
    expect(PROPOSAL_NOTIFY_HOLD_MS).toBe(PROPOSAL_NOTIFY_HOLD_MINUTES * 60_000);
    const now = Date.parse('2026-11-16T10:00:00Z');
    const r = (over: any) => ({ status: 'delivered', notify_tries: 0, notify_tried_at: null, notified_at: null, ...over });
    expect(proposalNotifyState(r({ status: 'produced' }), now)).toBe('before');
    expect(proposalNotifyState(r({}), now)).toBe('idle');
    expect(proposalNotifyState(r({ notify_tries: 1, notify_tried_at: '2026-11-16T09:59:00Z' }), now)).toBe('sending');
    expect(proposalNotifyState(r({ notify_tries: 1, notify_tried_at: '2026-11-16T09:58:00Z' }), now)).toBe('unknown');
    expect(proposalNotifyState(r({ notify_tries: 1, notify_tried_at: null }), now)).toBe('unknown');
    expect(proposalNotifyState(r({ notify_tries: 2, notify_tried_at: '2026-11-16T09:59:30Z', notified_at: '2026-11-16T09:59:31Z' }), now)).toBe('sent');
  });
});

describe('소스 계약 — 문 순서 · 소개 글은 서버에만 · 발송 · 과금 무접촉', () => {
  const routes = strip(back('routes/proposal.ts'));
  const ct = strip(back('utils/proposal-trial.ts'));

  it('⛔ 담당자 주소 = 로그인 → 호출 상한 → 고객사 문 · 신청은 「이미 신청함」을 본문(사진)보다 먼저 본다', () => {
    expect(routes).toContain("router.get('/', authenticate, limiter('view', 120), customerGate, async");
    expect(routes).toContain("router.post('/request', authenticate, limiter('request', 10), customerGate, alreadyRequested, photos, async");
    expect(routes).toContain("router.get('/fill', authenticate, limiter('fill', 60), customerGate, async");
    const gate = routes.slice(routes.indexOf('async function customerGate'), routes.indexOf('const viewLimiter'));
    expect(gate).toContain('await canSeeIntroContent(req.user as any)');
    expect(gate.indexOf("res.setHeader('Cache-Control', GATED_CACHE_CONTROL);")).toBeLessThan(gate.indexOf('await canSeeIntroContent('));
    // 본문을 읽는 것은 photos 하나뿐이다(앱의 JSON 파서는 multipart 를 읽지 않는다)
    expect(routes.match(/upload\.array\(/g)).toHaveLength(1);
  });

  it('⛔ 직원 주소는 전부 한 문(로그인 → 슈퍼관리자 → 허용 계정 · 회사 번호 꼴)을 지난다 · 로그인 전 주소는 열람 기록 하나뿐이고 글을 주지 않는다', () => {
    expect(routes).toContain('const staff = [authenticate, requireSuperAdmin, staffGate] as const;');
    // 전달 = 직원 화면이 본 판 번호를 받는다(없으면 400)
    expect(routes).toContain('const out = await deliverProposalKit(req.params.companyId, String(req.user?.userId), revision);');
    expect(front('components/admin/ProposalTrialTab.tsx')).toContain("act('deliver', { revision: row.revision },");
    const defs = routes.match(/router\.(get|post)\('[^']+'[^\n]*/g)!;
    expect(defs).toHaveLength(11);
    const admin = defs.filter((d) => d.includes("'/admin"));
    expect(admin).toHaveLength(7);
    for (const d of admin) expect(d, d).toMatch(/^router\.(get|post)\('\/admin[^']*', \.\.\.staff, async/);
    const open = defs.filter((d) => !d.includes('authenticate') && !d.includes('...staff'));
    expect(open).toEqual([expect.stringContaining("router.post('/view', viewLimiter, async")]);
    const view = routes.slice(routes.indexOf("router.post('/view'"), routes.indexOf("router.get('/'"));
    expect(view).not.toMatch(/proposalPageContent|proposalViewFor|res\.json/);
    const gate = routes.slice(routes.indexOf('async function staffGate'), routes.indexOf('const staff ='));
    expect(gate).toContain('await isIntroLeadsViewer(req.user?.userId)');
    expect(gate).toContain('UUID_RE.test(String(req.params.companyId))');
  });

  it('마운트 = 요금제 라우터보다 먼저 · 표가 없으면 503(500 을 내지 않는다)', () => {
    const app = back('app.ts');
    expect(app.indexOf("app.use('/api/plans/proposal', proposalRoutes)")).toBeGreaterThan(0);
    expect(app.indexOf("app.use('/api/plans/proposal', proposalRoutes)")).toBeLessThan(app.search(/app\.use\('\/api\/plans', /));
    expect(routes).toContain('if (handleDbMigrationError(err, res, TABLE)) return;');
    expect(routes.match(/return fail\(err, res, '[a-z-]+'\);/g)!.length).toBeGreaterThanOrEqual(9);
  });

  it('⛔ 소개 글 · 그림은 서버 보관뿐 — 프론트 소스 · 공개 폴더에 구절이 없다 · 그림은 보관 폴더에 있다 · CSS 는 .ppg 아래뿐', () => {
    const needles = ['한 번의 신청으로', '캠페인 대행 운영의 제작을', '지금 쓰시는 발송은', '보고도 안 산 고객에게', '바로 옆에 놓습니다', '담당자님이 하실 일은', 'ppg-ar'];
    for (const n of needles) expect(PROPOSAL_INTRO_HTML, n).toContain(n);     // 헛 구절로 통과하지 않게
    const files = [...walk(join(FRONT, 'src')), ...walk(join(FRONT, 'public'))].filter((p) => /\.(ts|tsx|html|css|json|js|svg|md|txt)$/.test(p));
    const hits: string[] = [];
    for (const p of files) { const text = readFileSync(p, 'utf8'); for (const n of needles) if (text.includes(n)) hits.push(`${p.slice(FRONT.length + 1)} :: ${n}`); }
    expect(hits).toEqual([]);
    const names = gatedImageNames(PROPOSAL_PAGE_CSS, PROPOSAL_INTRO_HTML);
    expect(names.length).toBeGreaterThanOrEqual(8);
    for (const n of names) expect(gatedImageFile(n), n).not.toBeNull();
    expect(PROPOSAL_INTRO_HTML).toContain('{{agencyPrice}}');
    expect(PROPOSAL_INTRO_HTML).not.toMatch(/<script|on[a-z]+=|javascript:/i);
    // 선택자는 전부 .ppg 로 시작한다(다른 화면에 새지 않는다) — @규칙 · 키프레임 단계 · 닫는 괄호 줄은 뺀다
    const heads = PROPOSAL_PAGE_CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('{').slice(0, -1).map((b) => b.slice(b.lastIndexOf('}') + 1).trim()).filter(Boolean);
    const stray = heads.flatMap((h) => h.split(',').map((s) => s.trim())).filter((s) => s && !s.startsWith('.ppg') && !s.startsWith('@') && !/^(from|to|\d+(\.\d+)?%)$/.test(s));
    expect(stray).toEqual([]);
    expect(PROPOSAL_PAGE_CSS + PROPOSAL_INTRO_HTML).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/i);
  });

  it('⛔ 발송 · 정산 보호 파일은 이 기능을 모른다 · 이 기능은 발송 큐에 안내 문자 한 길로만 닿는다', () => {
    for (const f of ['routes/campaigns.ts', 'routes/spam-filter.ts', 'utils/messageUtils.ts', 'routes/results.ts', 'routes/billing.ts']) {
      expect(back(f), f).not.toMatch(/proposal-trial|proposal_trials|proposalRoutes|ProposalKit/);
    }
    expect(ct).not.toMatch(/insertSmsQueue|bulkInsertSmsQueue|prepaid|deductCredit|ai_credit|credit_ledger|from '\.\.\/routes\//i);
    expect(ct.match(/insertNoticeSms\(/g)).toHaveLength(1);
    // 안내 문자의 행 꼴 = 다른 안내와 같다(시각 칸은 비우고 지금 보낸다 · app_etc2 = 회사)
    expect(ct).toContain("[[phone, getPlatformNoticeCallback(), text, 'L', '[한줄로] 완성본 안내', null, '', companyId, '', '', '']],");
    // DM 발행 = 발행 코어 하나 · 그 앞에 첫 발행 잠금 · 발행비를 걷는 길(publishDmCore · 차감 함수)은 부르지 않는다
    expect(ct.indexOf('await dmPublishBlockOf(companyId, id)')).toBeGreaterThan(0);
    expect(ct.indexOf('await dmPublishBlockOf(companyId, id)')).toBeLessThan(ct.indexOf('await publishDmWithPrizes(id, companyId)'));
    expect(ct).not.toMatch(/\bpublishDm\(|publishDmCore|settleOrUndo|checkCredit\(companyId/);
    expect(routes).not.toMatch(/insertNoticeSms|SmsQueue|prepaid|campaigns/i);
  });

  it('⛔ AI 크레딧 원장 무접촉 — 제작 전체가 크레딧 묶음 안 · DM 조립에는 묻지도 걷지도 않는 deps', () => {
    const run = ct.slice(ct.indexOf('export async function runProposalProduce'), ct.indexOf('export async function collectProposalGarbage'));
    expect(run).toMatch(/^export async function runProposalProduce\([^)]*\): Promise<void> \{\n  await runInCreditBundle\(async \(\) => \{/);
    expect(run.trimEnd().endsWith('}')).toBe(true);
    expect(run.match(/runInCreditBundle\(/g)).toHaveLength(1);
    // ⛔ 적지 못한 산출물은 그 자리에서 지우지 않는다(Codex 구현 1R · 2R) — 산출물을 만든 뒤의 기록은 record 한 길 → parkUnrecorded
    expect(run.match(/await record\(/g)).toHaveLength(3);
    expect(run).toContain('await parkUnrecorded(companyId, token, made, err instanceof LostOwnership ? null : err, deps);');
    expect(run).not.toMatch(/deps\.(removeFile|deleteDm|deleteAsset)\(/);
    const park = ct.slice(ct.indexOf('async function parkUnrecorded('), ct.indexOf('const producingHere'));
    expect(park.length).toBeGreaterThan(300);
    // 소유권을 먼저 내려 앞 쓰기를 막고(제작 실패 문장) 그다음에 회수 목록에 남긴다 · 이 함수는 아무것도 지우지 않는다
    expect(park.indexOf('if (uncertain) await query(PROPOSAL_FAIL_SQL')).toBeGreaterThan(0);
    expect(park.indexOf('if (uncertain) await query(PROPOSAL_FAIL_SQL')).toBeLessThan(park.indexOf('await query(PROPOSAL_PARK_SQL'));
    expect(park).not.toMatch(/removeArtifact|removeFile|deleteDm|deleteAsset|readProposalTrial/);
    expect(PROPOSAL_PARK_SQL).toContain('CASE WHEN COALESCE(kit @> $3::jsonb, false) OR garbage @> $4::jsonb THEN garbage ELSE garbage || jsonb_build_array($2::jsonb) END');
    // 지우는 자리 = 회수 하나(회수 목록에 적힌 것만)
    expect(ct.match(/await removeArtifact\(/g)).toHaveLength(1);
    expect(ct.slice(ct.indexOf('export async function collectProposalGarbage('), ct.indexOf('export async function editProposalCopy('))).toContain('done = await removeArtifact(companyId, it, deps);');
    // 신청: 사진을 지우는 때 = 적히지 않았다고 확정된 때뿐(COMMIT 을 보내기 전이고 ROLLBACK 이 통했다 · 또는 자리를 다시 잡아 갈랐다)
    const req = ct.slice(ct.indexOf('export async function requestProposalTrial('), ct.indexOf('export interface ProduceDeps'));
    expect(req).toContain("definite = (await client.query('ROLLBACK').then(() => true, () => false)) && !sentCommit;");
    expect(req).toContain("const settled = definite ? 'gone' : await settleUncertainRequest(input, saved);");
    expect(req).toContain("if (settled === 'gone') for (const x of saved) deps.removeFile(input.companyId, x.url);");
    expect(req.match(/deps\.removeFile\(/g)).toHaveLength(1);
    expect(req.indexOf('sentCommit = true;')).toBeLessThan(req.indexOf("await client.query('COMMIT');"));
    // 가르는 길 = 같은 자리를 다시 잡아 본다(같은 열쇠의 INSERT 는 앞 트랜잭션이 끝날 때까지 기다린다) · 잡은 자리는 언제나 돌려놓는다
    const fence = ct.slice(ct.indexOf('async function settleUncertainRequest('), ct.indexOf('export async function requestProposalTrial('));
    expect(fence.indexOf('await client.query(PROPOSAL_INSERT_SQL')).toBeLessThan(fence.indexOf("await client.query('ROLLBACK');"));
    expect(fence).not.toContain("query('COMMIT')");
    expect(fence).not.toMatch(/removeFile/);
    expect(ct).toContain("const deps = { ...defaultBuildDeps(), enabled: () => true, creditEnabled: async () => false, checkCredit: async () => undefined, deductOutcome: async () => 'not_required' as const };");
    expect(ct).toMatch(/expectedTotal: 0/);
    // 만들기 부품은 runProposalProduce 안에서만 불린다(묶음 밖에서 AI 를 부르는 길 0)
    const outside = ct.replace(run, '').replace(/export function defaultProduceDeps\(\)[\s\S]*?\n\}\n/, '');
    expect(outside).not.toMatch(/deps\.(pickHeadlines|makePoster|makeCopies|buildDm|spamCheck)\(/);
  });

  it('⛔ 작성 화면은 「명단만 올려 보내기」를 누른 뒤에만 채워진다 — 대시보드가 부르는 자리 하나 · 채우기만 하고 보내지 않는다', () => {
    const dash = front('pages/Dashboard.tsx');
    const calls = dash.split('\n').filter((l) => l.includes('loadPendingProposalKit()'));
    expect(calls).toHaveLength(1);
    expect(calls[0].trim()).toBe("if (openParam === 'direct-send') void loadPendingProposalKit();");
    // 평소의 직접발송 열기 줄은 글자 그대로다(이 기능이 그 줄을 바꾸지 않는다)
    expect(dash).toContain("if (openParam === 'direct-send') { setShowDirectSend(true); setDirectSendChannel('sms'); void loadPendingAudience(); }");
    const body = dash.slice(dash.indexOf('const loadPendingProposalKit = async () => {'), dash.indexOf('// v1.5.0: 파일 업로드 오픈 전 싱크 차단 체크'));
    expect(body).toContain('const pick = takeProposalPick({ userId: user?.id, companyId: user?.company?.id });');
    expect(body.indexOf('if (!pick) return;')).toBeLessThan(body.indexOf('await fetchProposalFill(pick)'));
    expect(body.match(/setDirect[A-Za-z]+\(/g)).toEqual(['setDirectMessage(', 'setDirectSubject(', 'setDirectMsgType(']);   // 명단 · 발신번호 · 예약 칸은 건드리지 않는다
    expect(strip(body)).not.toMatch(/\/api\/|Send\(|Recipients|Callback/);
    // 제안 페이지 화면은 내용을 넘기지 않는다(번호만) · 이동은 평소의 직접발송 열기 주소
    const page = strip(front('pages/ProposalPage.tsx'));
    expect(page).toContain("'/dashboard?open=direct-send'");
    expect(page.match(/stashProposalPick\(/g)).toHaveLength(1);
    expect(page).not.toMatch(/sessionStorage|localStorage\.setItem/);
  });

  it('새 화면 파일 — native dialog 0 · 동적 import 0 · 모델명 0 · 로그인 전 화면이 받는 주소는 열람 기록뿐', () => {
    for (const f of ['pages/ProposalPage.tsx', 'utils/proposal-kit.ts', 'utils/proposal-admin.ts', 'components/admin/ProposalTrialTab.tsx']) {
      const code = strip(front(f));
      expect(code, f).not.toMatch(/\b(alert|confirm|prompt)\(|\bimport\(|Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/);
    }
    const page = strip(front('pages/ProposalPage.tsx'));
    const gate = page.slice(page.indexOf('function Gate('), page.indexOf('function Inside('));
    expect(gate.length).toBeGreaterThan(200);
    expect(gate).toContain('reportProposalView(');
    expect(gate).toContain('rememberExplicitLoginReturn(');
    expect(gate).not.toMatch(/fetchProposal\(|resolveGated\(|dangerouslySetInnerHTML/);
    const app = front('App.tsx');
    expect(app).toContain('<Route path="/proposal" element={<ProposalPage />} />');
  });
});
