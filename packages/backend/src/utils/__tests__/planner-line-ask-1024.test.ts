/**
 * ★ 2026-10-24 플래너 한 줄 + 모자란 것만 질문(뿌리 대장 R9 · docs/ROOT-LEDGER.md)
 *   읽은 칸은 묻지 않는다 · 못 읽은 칸만 질문표 · 답은 서버가 다시 만든 질문표로만 검증(잠긴 채널 · 없는 상품 · 기간 빈칸 = 거절).
 */
import { describe, expect, it } from 'vitest';
import { plannerLineAsk, plannerLineEventBody, plannerLineQuestions, plannerLineSendChannels, type PlannerLineAskContext, type PlannerLineRead } from '../planner-line-read';

const NOW = Date.UTC(2026, 9, 24, 3); // 2026-10-24 12:00 KST
const base: PlannerLineRead = {
  title: '기초 1+1 행사', period: { startsOn: '2026-10-25', endsOn: '2026-10-30' }, periodNote: null, benefit: '1+1',
  productTerms: ['기초'], audience: { kind: 'all' }, channels: ['sms'], unsupported: [],
};
const ctx: PlannerLineAskContext = {
  channels: [
    { channel: 'sms', label: '메시징(문자)', available: true, reason: null },
    { channel: 'dm', label: '모바일 DM', available: false, reason: '모바일 DM 설정을 먼저 마쳐 주세요.' },
    { channel: 'email', label: '이메일 브로마이드', available: true, reason: null },
  ],
  products: { door: 'mall', list: [{ key: 'k1', name: '기초 3종 세트', buyers: 40 }, { key: 'k2', name: '수분 크림', buyers: 12 }, { key: 'k3', name: '기초 토너', buyers: 5 }] },
};
const ids = (r: PlannerLineRead, c = ctx) => plannerLineQuestions(r, c).map((q) => q.id);

describe('플래너 한 줄 질문표 — 못 읽은 칸만', () => {
  it('다 읽은 한 줄 = 질문 0 · 버튼 한 번에 담기 본문', () => {
    expect(ids(base)).toEqual([]);
    const b = plannerLineEventBody(base, {}, ctx, NOW);
    expect(b).toEqual({ ok: true, body: {
      title: '기초 1+1 행사', startsOn: '2026-10-25', endsOn: '2026-10-30', benefitText: '1+1',
      touchpoints: [{ channel: 'sms', timing: { anchor: 'start' } }], audience: { kind: 'all' },
    } });
  });

  it('혜택 없음 = 혜택만 묻는다 · 「혜택 없이」 = 빈 혜택 · 답 없음 = 거절', () => {
    const r = { ...base, benefit: null };
    expect(ids(r)).toEqual(['benefit']);
    expect(plannerLineEventBody(r, {}, ctx, NOW).ok).toBe(false);
    const b = plannerLineEventBody(r, { benefit: '' }, ctx, NOW);
    expect(b.ok && b.body.benefitText).toBe('');
  });

  it('기간 못 읽음 = 시작 · 끝 날짜를 묻고 지난 날짜는 거절', () => {
    const r = { ...base, period: null, periodNote: '이미 지난 기간이에요. 날짜를 골라 주세요' };
    expect(ids(r)).toEqual(['startsOn', 'endsOn']);
    expect(plannerLineQuestions(r, ctx)[0].help).toBe('이미 지난 기간이에요. 날짜를 골라 주세요');
    expect(plannerLineEventBody(r, { startsOn: '2026-10-01', endsOn: '2026-10-05' }, ctx, NOW)).toEqual({ ok: false, error: '이미 지난 날짜예요. 행사 마지막 날을 다시 골라 주세요.' });
    const b = plannerLineEventBody(r, { startsOn: '2026-11-01', endsOn: '2026-11-03' }, ctx, NOW);
    expect(b.ok && [b.body.startsOn, b.body.endsOn]).toEqual(['2026-11-01', '2026-11-03']);
  });

  it('받는 사람 못 읽음 = 전체 · 관측 상품 보기 · 상품을 고르면 언제 산 고객인지까지 답해야 한다', () => {
    const r: PlannerLineRead = { ...base, audience: { kind: 'unread', raw: '기초 안 산 고객' } };
    expect(ids(r)).toEqual(['audience', 'since']);
    expect(plannerLineQuestions(r, ctx)[0].options?.map((o) => o.value)).toEqual(['all', 'p:k1', 'p:k2', 'p:k3']);
    expect(plannerLineEventBody(r, { audience: 'p:k2' }, ctx, NOW)).toEqual({ ok: false, error: '「언제 산 고객인가요?」에 답해 주세요.' });
    const b = plannerLineEventBody(r, { audience: 'p:k2', since: '90' }, ctx, NOW);
    expect(b.ok && b.body.audience).toEqual({ kind: 'product_buyers', door: 'mall', keys: ['k2'], names: ['수분 크림'], since: '2026-07-26' });
    // 화면이 지어낸 상품 · 보기 밖 기간 = 거절
    expect(plannerLineEventBody(r, { audience: 'p:k9', since: '90' }, ctx, NOW).ok).toBe(false);
    expect(plannerLineEventBody(r, { audience: 'p:k2', since: '7' }, ctx, NOW).ok).toBe(false);
    // 전체를 고르면 기간은 묻지 않아도 된다
    expect(plannerLineEventBody(r, { audience: 'all' }, ctx, NOW).ok).toBe(true);
  });

  it('구매자 제안이 관측 상품에 맞으면 대상은 묻지 않고 기간만 · 기본값 없음(「모두」 = 도움말만)', () => {
    const r: PlannerLineRead = { ...base, audience: { kind: 'product_buyers', terms: ['기초'], allTime: true } };
    expect(ids(r)).toEqual(['since']);
    expect(plannerLineQuestions(r, ctx)[0].recommended).toBeUndefined();
    expect(plannerLineEventBody(r, {}, ctx, NOW).ok).toBe(false);
    const b = plannerLineEventBody(r, { since: '0' }, ctx, NOW);
    expect(b.ok && b.body.audience).toEqual({ kind: 'product_buyers', door: 'mall', keys: ['k1', 'k3'], names: ['기초 3종 세트', '기초 토너'], since: null });
    // 상품 목록을 못 읽었으면 넓히지 않고 묻는다
    expect(ids(r, { ...ctx, products: null })).toEqual(['audience', 'since']);
  });

  it('읽은 채널이 잠겼으면 채널을 묻고 잠긴 보기는 고를 수 없다', () => {
    const r = { ...base, channels: ['dm' as const] };
    expect(ids(r)).toEqual(['channel']);
    const q = plannerLineQuestions(r, ctx)[0];
    expect(q.options?.find((o) => o.value === 'dm')).toMatchObject({ disabled: true, reason: '모바일 DM 설정을 먼저 마쳐 주세요.' });
    expect(plannerLineEventBody(r, { channel: 'dm' }, ctx, NOW)).toEqual({ ok: false, error: '모바일 DM 설정을 먼저 마쳐 주세요.' });
    const b = plannerLineEventBody(r, { channel: 'email' }, ctx, NOW);
    expect(b.ok && b.body.touchpoints).toEqual([{ channel: 'email', timing: { anchor: 'start' } }]);
  });

  it('질문 창 지문 — 같은 사정 = 같은 지문 · 상품이 새로 맞거나 채널이 열리고 닫히면 지문이 바뀐다(담기 = 409 다시 묻기)', () => {
    const r: PlannerLineRead = { ...base, audience: { kind: 'product_buyers', terms: ['세럼'], allTime: false } };
    const k1 = plannerLineAsk(r, ctx).askKey;
    expect(plannerLineAsk(r, { ...ctx }).askKey).toBe(k1);
    // 읽을 때는 맞는 상품이 없어 사람이 골랐는데 담기 전에 「세럼」 상품이 생겼다 → 질문표가 달라지고 지문도 달라진다
    const grown = { ...ctx, products: { door: 'mall' as const, list: [...ctx.products!.list, { key: 'k4', name: '비타 세럼', buyers: 3 }] } };
    expect(plannerLineQuestions(r, ctx).map((q) => q.id)).toContain('audience');
    expect(plannerLineQuestions(r, grown).map((q) => q.id)).not.toContain('audience');
    expect(plannerLineAsk(r, grown).askKey).not.toBe(k1);
    const locked = { ...ctx, channels: ctx.channels.map((c) => (c.channel === 'sms' ? { ...c, available: false, reason: '발신번호를 먼저 등록해 주세요.' } : c)) };
    expect(plannerLineAsk(base, locked).askKey).not.toBe(plannerLineAsk(base, ctx).askKey);
  });

  it('읽은 채널 일부만 닫혔으면 묻지 않고 열린 것만 담는다 · 화면에 보이는 담을 채널 = 저장 본문 채널', () => {
    const r = { ...base, channels: ['sms' as const, 'dm' as const] };
    expect(ids(r)).toEqual([]);
    expect(plannerLineSendChannels(r, ctx)).toEqual(['sms']);
    const b = plannerLineEventBody(r, {}, ctx, NOW);
    expect(b.ok && (b.body.touchpoints as any[]).map((t) => t.channel)).toEqual(plannerLineSendChannels(r, ctx));
  });
});
