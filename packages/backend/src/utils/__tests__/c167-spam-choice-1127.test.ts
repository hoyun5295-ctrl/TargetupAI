/**
 * C167-C(★ 2026-11-27 · 뿌리 R113 · 설계서 docs/2026-11-27-c167-agency-spam-choice-design.md) — 대행 스팸 막힘 = 「스팸 통과 문안으로 승인 / 처음 접수한 문안 그대로 승인」.
 *   접수 = 서수란 cmwu6xwl22id9jnscc1qh2d38(재오픈 1125 · BUGS B-1126-4) · 판정(순수) · 알림 문장 · 결과 메일 · 화면 함수.
 *   실행 트랜잭션 = agency-spam-override-1124.pg.test.ts(실 PG).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({ rows: [] as any[][] }));
vi.mock('../../config/database', () => {
  const query = vi.fn(async () => ({ rows: db.rows.shift() ?? [] }));
  return { query, pool: { query, connect: vi.fn() }, default: { query, connect: vi.fn() } };
});
import { spamOverrideOf, agencyActions, spamChoiceLabel } from '../agency-send-actions';
import { rewriteChoiceMarker, buildSpamResultMail } from '../agency-spam-diag';
import { buildPassedNotify, buildReapprovalNotify, buildTestFailedNotify, buildFinalBlockedNotify, agencyRewriteOf, buildLinkApprovedNotify } from '../agency-send-notify';
import { agencyChoiceView } from '../../../../frontend/src/components/agency/agency-send-api';

const NOW = new Date('2026-11-25T03:00:00Z');   // KST 12:00
const kst = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
const ORIGINAL = '(광고) 블랙프라이데이 기간 한정 20% 더블 기획\n무료 수신거부 : 080-139-56';
const REWRITE = '(광고) 블랙프라이데이 기간 동안 20% 더블 기획을 소개해 드려요\n무료 수신거부 : 080-139-56';
function row(o: Record<string, any> = {}) {
  return {
    status: 'awaiting_approval', content_version: 4, revision: 9, campaign_id: null,
    requested_at: kst(2026, 11, 27, 10), approval_requested_at: NOW,
    original_content: ORIGINAL, current_content: REWRITE,
    last_test_result: { round: 2, spamOverridable: { version: 4, submitted: ORIGINAL, checkedAt: NOW.toISOString(), submittedTested: true } },
    ...o,
  };
}

describe('C167-C 판정 spamOverrideOf — 고친 글로 승인을 묻는 중에도 처음 문안 그대로 승인', () => {
  it('승인 대기 · 재승인 + 이 버전 표식 + 글 다름 = 열림 · 표시 재료(이름 · 글 · 빈 자리)', () => {
    for (const status of ['awaiting_approval', 'reapproval']) {
      const o = spamOverrideOf(row({ status }), NOW);
      expect(o).toMatchObject({ ok: true, text: ORIGINAL, retime: false });
      expect(o.shown).toEqual({ label: '처음 접수한 문안', submitted: ORIGINAL, blanks: [] });
    }
  });
  it('표식 글이 처음 접수한 글이 아니면(당일 재검사 = 승인했던 글) 이름 = 「승인하셨던 문안」', () => {
    const o = spamOverrideOf(row({ status: 'reapproval', last_test_result: { spamOverridable: { version: 4, submitted: '승인했던 글', checkedAt: NOW.toISOString(), submittedTested: true } } }), NOW);
    expect(o.shown?.label).toBe('승인하셨던 문안');
    expect(spamChoiceLabel({ original_content: 'a' }, 'a')).toBe('처음 접수한 문안');
  });
  it('승인 요청 시각 = 행의 값(24시간 지나면 닫힘 · retime 아님) · test_failed 는 지금', () => {
    const late = spamOverrideOf(row({ approval_requested_at: new Date(NOW.getTime() - 25 * 3_600_000) }), NOW);
    expect(late).toMatchObject({ ok: false, retime: false });
    expect(late.shown).not.toBeNull();   // 고를 수 없을 때도 표시 재료는 있다(Codex 설계 3R #1)
    expect(spamOverrideOf(row({ status: 'test_failed', approval_requested_at: new Date(NOW.getTime() - 25 * 3_600_000) }), NOW).ok).toBe(true);
  });
  it('15분 잠금 = 닫힘 · retime · 표시 재료 있음', () => {
    const o = spamOverrideOf(row({ requested_at: kst(2026, 11, 25, 12, 10) }), NOW);
    expect(o).toMatchObject({ ok: false, retime: true });
    expect(o.shown?.submitted).toBe(ORIGINAL);
  });
  it('승인 대기에서 표식 글 = 지금 글 · 옛 버전 표식 · 승인 완료 = 고를 것 없음(표시 재료도 없음)', () => {
    expect(spamOverrideOf(row({ current_content: ORIGINAL }), NOW)).toMatchObject({ ok: false, shown: null });
    expect(spamOverrideOf(row({ content_version: 5 }), NOW)).toMatchObject({ ok: false, shown: null });
    expect(spamOverrideOf(row({ status: 'approved' }), NOW)).toMatchObject({ ok: false, shown: null });
  });
  it('test_failed 는 표식 글 = 지금 글이어도 열림(다듬은 글을 버리고 처음 글이 막힘 · Codex 설계 2R #2)', () => {
    const o = spamOverrideOf(row({ status: 'test_failed', current_content: ORIGINAL }), NOW);
    expect(o.ok).toBe(true);
    expect(o.shown?.label).toBe('처음 접수한 문안');
  });
  it('표식 글의 채우지 않은 자리 = 표시 재료 blanks', () => {
    const withBlank = '(광고) OOO점 블랙프라이데이';
    const o = spamOverrideOf(row({ original_content: withBlank, last_test_result: { spamOverridable: { version: 4, submitted: withBlank, checkedAt: NOW.toISOString(), submittedTested: true } } }), NOW);
    expect(o.shown?.blanks.length).toBe(1);
  });
  it('주체 = 로그인 · 링크 열림 · 운영 닫힘', () => {
    expect(agencyActions('user', row(), NOW).spamOverride.ok).toBe(true);
    expect(agencyActions('link', row(), NOW).spamOverride.ok).toBe(true);
    expect(agencyActions('staff', row(), NOW).spamOverride.ok).toBe(false);
  });
  it('표식 = 고친 글로 통과면 바꾸기 전 글 · 같으면 null(지움)', () => {
    expect(rewriteChoiceMarker(4, ORIGINAL, REWRITE, { content: ORIGINAL, createdAt: NOW })).toMatchObject({ version: 4, submitted: ORIGINAL, submittedTested: true });
    expect(rewriteChoiceMarker(4, ORIGINAL, ORIGINAL, { content: ORIGINAL, createdAt: NOW })).toBeNull();
    expect(rewriteChoiceMarker(4, ORIGINAL, REWRITE, { content: REWRITE, createdAt: NOW })).toMatchObject({ submittedTested: false });   // 첫 회차가 다른 글 = 당일 근거 아님
  });
});

describe('C167-C 알림 문장 — 무엇이 막혔는지 · 두 길', () => {
  const ctx = { label: '대행발송 양식.xlsx', whenText: '11월 25일 17:00', count: 6 };
  const choosable = { label: '처음 접수한 문안', choosable: true, retime: false };
  it('승인 문자 = 「통과했습니다」 단독 0 · 처음 문안이 걸려 고친 문안으로 통과 · 두 길(주소 · 로그인)', () => {
    for (const t of [buildPassedNotify({ ...ctx, rewrite: choosable, approveUrl: 'https://hanjul.ai/c/x' }), buildPassedNotify({ ...ctx, rewrite: choosable, originalWhenText: '11월 25일 16:00', approveUrl: 'https://hanjul.ai/c/x' })]) {
      expect(t).toContain('처음 접수한 문안이 스팸 검사에 걸려, 한줄로가 고친 문안으로 통과했습니다');
      expect(t).not.toMatch(/\[대행발송\] 스팸 검사를 통과했습니다/);
      expect(t).toContain('아래 주소에서 고친 문안으로 승인하거나 처음 접수한 문안 그대로 승인할 수 있습니다');
    }
    expect(buildPassedNotify({ ...ctx, rewrite: choosable })).toContain('로그인하여 고친 문안으로 승인하거나');
    expect(buildPassedNotify({ ...ctx, rewrite: { ...choosable, choosable: false, retime: true }, approveUrl: 'u' })).toContain('처음 접수한 문안 그대로 보내려면 시각을 먼저 바꿔 주세요');
    expect(buildPassedNotify(ctx)).toContain('[대행발송] 스팸 검사를 통과했습니다');   // 고친 글 아님 = 지금 그대로
  });
  it('재승인 문자 = 승인했던 문안이 발송 전 검사에 걸려 고친 문안으로 통과 · 두 길', () => {
    const t = buildReapprovalNotify({ ...ctx, rewrite: { label: '승인하셨던 문안', choosable: true, retime: false }, approveUrl: 'u' });
    expect(t).toContain('승인하셨던 문안이 발송 전 스팸 검사에 걸려, 한줄로가 고친 문안으로 통과했습니다');
    expect(t).toContain('승인하셨던 문안 그대로 승인할 수 있습니다');
  });
  it('막힘 문자 = 주소가 있으면 그대로 승인 · 시각 바꾸기 길 · 로그인 주소는 고치기만', () => {
    const t = buildTestFailedNotify({ label: '건', carriers: ['KT'], rewrite: choosable, approveUrl: 'https://hanjul.ai/c/y' });
    expect(t).toContain('검사 결과와 관계없이 처음 접수한 문안 그대로 보내려면 아래 주소에서 승인할 수 있어요.');
    expect(t).toContain('https://hanjul.ai/c/y');
    expect(t).toContain('문안을 고치려면 로그인해 주세요');
    expect(t).not.toMatch(/로그인하면 .*그대로 보내기/);
    expect(buildTestFailedNotify({ label: '건', rewrite: { ...choosable, choosable: false, retime: true }, approveUrl: 'u' })).toContain('아래 주소에서 시각을 먼저 바꿔 주세요');
    expect(buildTestFailedNotify({ label: '건', rewrite: choosable })).not.toContain('아래 주소');   // 주소 없는 본문(담당자별 주소는 perPhoneTexts)
  });
  it('예약취소 문자 = 「로그인 하시어 승인」 0 · 받은 문자의 주소', () => {
    expect(buildFinalBlockedNotify({ label: '건' })).not.toMatch(/로그인 하시어/);
    expect(buildFinalBlockedNotify({ label: '건' })).toContain('받으신 문자의 주소에서 고를 수 있어요');
  });
  it('알림 칸 = 표시 재료가 있을 때만', () => {
    expect(agencyRewriteOf(spamOverrideOf(row(), NOW), true)).toEqual({ label: '처음 접수한 문안', choosable: true, retime: false });
    expect(agencyRewriteOf(spamOverrideOf(row({ current_content: ORIGINAL }), NOW), true)).toBeNull();
    // 시각 바꾸기 안내 = 링크에서 시각 변경이 열려 있을 때만(15분 잠금 = 못 바꿈 · Codex 구현 1R #2)
    const locked = spamOverrideOf(row({ status: 'test_failed', requested_at: kst(2026, 11, 25, 12, 10) }), NOW);
    expect(locked.retime).toBe(true);
    expect(agencyRewriteOf(locked, agencyActions('link', row({ status: 'test_failed', requested_at: kst(2026, 11, 25, 12, 10) }), NOW).reschedule.ok)).toMatchObject({ retime: false });
  });
  it('링크 그대로 승인 완료 문자 = 무엇으로 승인했는지 · 새 버전 주소(보내기 전 취소 길 · Codex 구현 1R #1)', () => {
    const t = buildLinkApprovedNotify({ label: '건', approvedTail: '0000', submittedLabel: '처음 접수한 문안', approveUrl: 'https://hanjul.ai/c/z' });
    expect(t).toContain('처음 접수한 문안 그대로 발송이 승인되었습니다');
    expect(t).toContain('보내기 전에 취소하려면 아래 주소를 열어 주세요.');
    expect(t).toContain('https://hanjul.ai/c/z');
    expect(buildLinkApprovedNotify({ label: '건', approvedTail: '0000' })).not.toContain('아래 주소');
  });
});

describe('C167-C 결과 메일 — 「보내 주신 문안」 = 고객이 낸 글 · 고친 글은 따로(접수 재오픈 3)', () => {
  beforeEach(() => { db.rows = []; });
  it('고친 글이 있으면 두 글을 이름으로 가른다 · 끝 문장 정리', async () => {
    db.rows = [[{ payload: { carriers: [{ carrier: 'KT', result: 'blocked' }, { carrier: 'SKT', result: 'pass' }] } }], []];
    const mail = await buildSpamResultMail({ id: 'r1', content_version: 4, status: 'test_failed', file_name: '양식.xlsx', original_content: ORIGINAL, current_content: REWRITE });
    expect(mail).not.toBeNull();
    const t = mail!.text;
    const a = t.indexOf('보내 주신 문안');
    const b = t.indexOf('한줄로가 고쳐 본 문안');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(t.slice(a, b)).toContain('기간 한정 20% 더블 기획');   // 보내 주신 = 처음 글
    expect(t.slice(b)).toContain('소개해 드려요');                 // 고친 글은 따로
    expect(t).not.toContain('보내 주신 글');
    expect(t).not.toContain('기록과 다시 보낸 결과로 좁힌 것입니다. 위 내용은');
  });
  it('고친 글이 없으면 한 칸', async () => {
    db.rows = [[{ payload: { carriers: [{ carrier: 'KT', result: 'blocked' }] } }], []];
    const mail = await buildSpamResultMail({ id: 'r2', content_version: 4, status: 'test_failed', file_name: '양식.xlsx', original_content: ORIGINAL, current_content: ORIGINAL });
    expect(mail!.text).toContain('보내 주신 문안');
    expect(mail!.text).not.toContain('한줄로가 고쳐 본 문안');
  });
});

describe('C167-C 화면 함수 agencyChoiceView — 재료는 서버 shown 만 · 주 단추는 열지 않는다', () => {
  const shown = { label: '처음 접수한 문안', submitted: ORIGINAL, blanks: [] };
  it('승인 대기 = 스팸 통과 문안 + 처음 문안 두 칸 · 주 단추 이름', () => {
    const v = agencyChoiceView('awaiting_approval', { ok: true, reason: null, retime: false, shown }, REWRITE);
    expect(v.blocks.map((b) => b.kind)).toEqual(['current', 'submitted']);
    expect(v.blocks[0].label).toContain('스팸 통과 문안');
    expect(v.primaryLabel).toBe('스팸 통과 문안으로 승인');
    expect(v.submitted).toMatchObject({ label: '처음 접수한 문안', ok: true });
  });
  it('test_failed = 「스팸 통과」 낱말 0 · 글이 같으면 한 칸 · 다르면 고쳐 본 문안 칸 추가', () => {
    const same = agencyChoiceView('test_failed', { ok: true, reason: null, retime: false, shown }, ORIGINAL);
    expect(same.blocks.length).toBe(1);
    const diff = agencyChoiceView('test_failed', { ok: false, reason: '보낼 시각이 가까워', retime: true, shown }, REWRITE);
    expect(diff.blocks.map((b) => b.label).join(' ')).not.toContain('스팸 통과');
    expect(diff.blocks[1].label).toContain('한줄로가 고쳐 본 문안');
    expect(diff.submitted).toMatchObject({ ok: false, reason: '보낼 시각이 가까워' });
    expect(diff.primaryLabel).toBeNull();
  });
  it('재료 없음 = 지금 화면 그대로', () => {
    expect(agencyChoiceView('awaiting_approval', { ok: false, reason: null, retime: false, shown: null }, REWRITE)).toEqual({ blocks: [], submitted: null, primaryLabel: null });
    expect(agencyChoiceView('awaiting_approval', undefined, REWRITE).blocks).toEqual([]);
  });
});
