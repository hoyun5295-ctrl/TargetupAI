// replaces: none
/**
 * 인앱 포스터 · 기능형 재구성 — 실 PostgreSQL(★ 2026-11-05 설계서 docs/2026-11-05-inapp-poster-function-redesign-design.md §6 실 PG · CT-IA11)
 *
 *   판정 행 = 저장 결과 행(create · update · createVariant · 켜기 · 전파) · 미달 = 되돌림(행 0)
 *   DM 연결 판정(경품 DM 막음 · 투표 DM 통과 · 트랜잭션 연결로 읽음) · 남은 시간 띠 끝 시각(부모만)
 *   서빙 관문(caps 없음 = 통짜 0 · 20개 채우기는 걸러진 뒤 수로) · 통짜 비우기 · 한 장 카드 = 틀만 지움
 *   [반영] 글 얹기 → 통짜 = 문구 변형 멈춤 · 다시 켜기 거절 · 원본 되돌리면 켜기 통과 · 통짜 변형 그림 유지
 *   변형 서빙 사본 = 부모 끝 시각 · 통짜 부모 변형 = 그림 필수
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { createInAppMessage, updateInAppMessage, getActiveMessagesForCustomerV2, parseInAppNotPublishable, INAPP_EXAMPLE_IMAGE_PREFIX } from '../inapp-message';
import { createVariant, setVariantStatus } from '../inapp-variant-optimizer';

const CO = randomUUID();
const CO_PAGE = randomUUID();
const OWNER = randomUUID();
const OWNER2 = randomUUID();
const ALL_CAPS = new Set(['poster_baked', 'frame_card', 'strip_coupon', 'strip_countdown']);
const future = () => new Date(Date.now() + 3 * 3600_000).toISOString();

const slide = (over: Record<string, any> = {}) => ({ image_url: '/api/cdp/inapp/image/x/a.jpg', title: '포스터 제목', ...over });
const poster = (over: Record<string, any> = {}) => ({
  template: 'full_image', title: '포스터 제목', body: '본문', status: 'active' as const, channel: 'web' as const,
  poster_slides: [slide()], design: { dismiss_mode: 'snooze_day' }, ...over,
});
const defectOf = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e: any) { return parseInAppNotPublishable(String(e?.message || '')) || { message: String(e?.message), field: 'x' as any, code: e?.code }; }
};
const count = async (company: string, title: string) => Number((await pool.query(`SELECT COUNT(*)::int AS n FROM cdp_inapp_messages WHERE company_id = $1 AND title = $2`, [company, title])).rows[0].n);

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '인앱 포스터 시험' });
  await insertMinimalRow(pool, 'companies', { id: CO_PAGE, company_name: '인앱 포스터 쪽 시험' });
  await insertMinimalRow(pool, 'users', { id: OWNER, company_id: CO, user_type: 'admin', is_active: true, phone: '010-0000-1150', login_id: 't-1105-inapp' });
  await insertMinimalRow(pool, 'users', { id: OWNER2, company_id: CO_PAGE, user_type: 'admin', is_active: true, phone: '010-0000-1151', login_id: 't-1105-inapp2' });
  // DM 두 장 — 투표만 · 경품(룰렛) 섞임(쪽 구조 pages) · 다른 회사 DM
  await insertMinimalRow(pool, 'dm_pages', { id: randomUUID(), company_id: CO, created_by: OWNER, title: '투표 DM', status: 'published', short_code: 'poll1105', sections: JSON.stringify([{ type: 'poll' }]) });
  await insertMinimalRow(pool, 'dm_pages', { id: randomUUID(), company_id: CO, created_by: OWNER, title: '경품 DM', status: 'published', short_code: 'prize1105', sections: JSON.stringify([]), pages: JSON.stringify([{ sections: [{ type: 'poll' }, { type: 'roulette' }] }]) });
  await insertMinimalRow(pool, 'dm_pages', { id: randomUUID(), company_id: CO_PAGE, created_by: OWNER2, title: '남의 DM', status: 'published', short_code: 'other1105', sections: JSON.stringify([{ type: 'poll' }]) });
});

describe('판정 행 = 저장 결과 행 · 미달 = 되돌림', () => {
  it('예시 그림 게시 = 거절 · 행 0', async () => {
    const d = await defectOf(createInAppMessage(CO, OWNER, poster({ title: '예시 그림 게시', poster_slides: [slide({ title: '예시 그림 게시', image_url: `${INAPP_EXAMPLE_IMAGE_PREFIX}kyeolon-baked-sheet/0` })], design: { poster_text: 'baked' } }) as any));
    expect(d?.field).toBe('slide_image');
    expect(await count(CO, '예시 그림 게시')).toBe(0);
  });
  it('최상위 링크(image_link_url)만 쓴 경품 DM 연결 = 거절 · 투표 DM = 통과 · 다른 회사 DM = 거절', async () => {
    const prize = await defectOf(createInAppMessage(CO, OWNER, poster({ title: '경품 연결', imageLinkUrl: 'https://hanjul.ai/api/dm/v/dm-prize1105' }) as any));
    expect(prize?.field).toBe('link');
    expect(await count(CO, '경품 연결')).toBe(0);
    const other = await defectOf(createInAppMessage(CO, OWNER, poster({ title: '남의 연결', poster_slides: [slide({ title: '남의 연결', cta: { label: '참여', action_url: '/api/dm/v/dm-other1105' } })] }) as any));
    expect(other?.message).toContain('연결할 수 없는 DM');
    const ok = await createInAppMessage(CO, OWNER, poster({ title: '투표 연결', poster_slides: [slide({ title: '투표 연결', cta: { label: '참여', action_url: '/api/dm/v/dm-poll1105' } })] }) as any);
    expect(ok.status).toBe('active');
  });
  it('남은 시간 띠 = 끝 시각 없음 거절 · 있으면 통과', async () => {
    const no = await defectOf(createInAppMessage(CO, OWNER, poster({ title: '시간 없음', design: { poster_strip: { type: 'countdown' } } }) as any));
    expect(no?.field).toBe('end_at');
    const yes = await createInAppMessage(CO, OWNER, poster({ title: '시간 있음', endAt: future(), design: { poster_strip: { type: 'countdown' } } }) as any);
    expect(yes.endAt).toBeTruthy();
  });
  it('수정 = 결과 행으로 판정 · 경품 DM 으로 바꾸면 되돌림(내용 그대로)', async () => {
    const m = await createInAppMessage(CO, OWNER, poster({ title: '수정 대상' }) as any);
    const d = await defectOf(updateInAppMessage(CO, m.id, { buttons: [{ label: '참여', action_url: 'https://hanjul.ai/api/dm/v/dm-prize1105' }] } as any));
    expect(d?.field).toBe('link');
    const row = (await pool.query(`SELECT buttons FROM cdp_inapp_messages WHERE id = $1`, [m.id])).rows[0];
    expect(JSON.stringify(row.buttons)).not.toContain('prize1105');
  });
});

describe('[반영] 통짜 전환 · 변형 규칙(부모 선잠금)', () => {
  it('글 얹기 → 통짜 = 문구 변형 멈춤 · 다시 켜기 거절 · 원본 되돌리면 켜기 통과', async () => {
    const parent = await createInAppMessage(CO, OWNER, poster({ title: '전환 원본' }) as any);
    const kid = await createVariant(CO, OWNER, { parentMessageId: parent.id, title: '문구 변형', body: '다른 문구' });
    const toBaked = await updateInAppMessage(CO, parent.id, { design: { poster_text: 'baked', dismiss_mode: 'snooze_day' }, poster_slides: [slide({ title: '전환 원본' })] } as any);
    expect(toBaked?.variantsPaused).toBe(1);
    const k1 = (await pool.query(`SELECT status, design FROM cdp_inapp_messages WHERE id = $1`, [kid])).rows[0];
    expect(k1.status).toBe('paused');
    expect(k1.design?.poster_text).toBeUndefined();
    const again = await defectOf(setVariantStatus(CO, parent.id, kid, 'active'));
    expect(again?.message).toContain('그림을 바꾼 변형만');
    // (Codex 구현 1R high) 일반 수정(PUT)으로 켜도 같은 판정(부모 먼저 잠금 · 변형 판정) · 상태 그대로
    const viaPut = await defectOf(updateInAppMessage(CO, kid, { status: 'active' } as any));
    expect(viaPut?.message).toContain('그림을 바꾼 변형만');
    expect((await pool.query(`SELECT status FROM cdp_inapp_messages WHERE id = $1`, [kid])).rows[0].status).toBe('paused');
    // 원본을 글 얹기로 되돌리면 그 변형을 다시 켤 수 있다
    await updateInAppMessage(CO, parent.id, { design: { dismiss_mode: 'snooze_day' }, poster_slides: [slide({ title: '전환 원본' })] } as any);
    expect(await setVariantStatus(CO, parent.id, kid, 'active')).toBe(true);
  });
  it('통짜 부모 변형 = 그림 필수 · 첫 장 = 변형 그림 · 통짜 [반영]은 변형 그림을 지킨다', async () => {
    const parent = await createInAppMessage(CO, OWNER, poster({ title: '통짜 원본', design: { poster_text: 'baked' } }) as any);
    const noImg = await createVariant(CO, OWNER, { parentMessageId: parent.id, title: '그림 없음', body: '' }).catch((e) => e);
    if (noImg?.code !== 'INAPP_VARIANT_NEEDS_IMAGE') console.log('[변형 오류]', noImg?.message, noImg?.position);
    expect(noImg?.code).toBe('INAPP_VARIANT_NEEDS_IMAGE');
    const kid = await createVariant(CO, OWNER, { parentMessageId: parent.id, title: '그림 변형', body: '', image_url: '/api/cdp/inapp/image/x/b.jpg' });
    const k = (await pool.query(`SELECT design, poster_slides, image_url FROM cdp_inapp_messages WHERE id = $1`, [kid])).rows[0];
    expect(k.design.poster_text).toBe('baked');
    expect(k.poster_slides[0].image_url).toBe('/api/cdp/inapp/image/x/b.jpg');
    await updateInAppMessage(CO, parent.id, { design: { poster_text: 'baked', poster_frame: 'card' }, poster_slides: [slide({ title: '통짜 원본' })] } as any);
    const k2 = (await pool.query(`SELECT design, poster_slides, status FROM cdp_inapp_messages WHERE id = $1`, [kid])).rows[0];
    expect(k2.status).toBe('active');
    expect(k2.design.poster_frame).toBe('card');
    expect(k2.poster_slides[0].image_url).toBe('/api/cdp/inapp/image/x/b.jpg');
  });
});

describe('서빙 관문 · 통짜 비우기 · 변형 끝 시각', () => {
  // ★ 2026-11-08 C114 I-2 = 내보내지 않음 0(Harold 「업체 앱에 판을 올리라고 할 수 없다」) — caps 없음도 통짜를 보낸다(글 비움 · 대체 글)
  it('caps 없음 = 통짜도 보낸다(글 비움 · 대체 글) · 카드 = 틀만 지움 · caps 있음 = 통짜 비워서 · 틀 그대로', async () => {
    const baked = await createInAppMessage(CO, OWNER, poster({ title: '서빙 통짜', design: { poster_text: 'baked' }, poster_slides: [slide({ title: '서빙 통짜' })] }) as any);
    const card = await createInAppMessage(CO, OWNER, poster({ title: '서빙 카드', design: { poster_frame: 'card' }, poster_slides: [slide({ title: '서빙 카드' })] }) as any);
    const anon = randomUUID();
    const none = await getActiveMessagesForCustomerV2({ companyId: CO, anonymousId: anon, channel: 'web' });
    const b0 = none.find((m) => m.id === baked.id)!;
    expect(b0).toBeTruthy();
    expect(b0.title).toBe('');
    expect(b0.posterSlides[0].alt).toBe('서빙 통짜');
    const c0 = none.find((m) => m.id === card.id)!;
    expect(c0.design?.poster_frame).toBeUndefined();
    const all = await getActiveMessagesForCustomerV2({ companyId: CO, anonymousId: randomUUID(), channel: 'web', clientCaps: ALL_CAPS });
    const b = all.find((m) => m.id === baked.id)!;
    expect(b.title).toBe('');
    expect(b.posterSlides[0].title).toBeUndefined();
    expect(b.posterSlides[0].alt).toBe('서빙 통짜');
    expect(all.find((m) => m.id === card.id)!.design?.poster_frame).toBe('card');
  });
  // ★ C114 I-2 거르기 0 → caps 와 무관하게 쪽 상한(20)까지 채운다(통짜도 옛 앱 꼴로 나간다)
  it('20개 채우기 = caps 없음 · 있음 모두 20(통짜 25 + 보통 3 · 거르는 것 0)', async () => {
    for (let i = 0; i < 3; i++) await createInAppMessage(CO_PAGE, OWNER2, poster({ title: `보통 ${i}`, poster_slides: [slide({ title: `보통 ${i}` })] }) as any);
    for (let i = 0; i < 25; i++) await createInAppMessage(CO_PAGE, OWNER2, poster({ title: `통짜 ${i}`, design: { poster_text: 'baked' }, poster_slides: [slide({ title: `통짜 ${i}` })] }) as any);
    const out = await getActiveMessagesForCustomerV2({ companyId: CO_PAGE, anonymousId: randomUUID(), channel: 'web' });
    expect(out.length).toBe(20);
    const withCaps = await getActiveMessagesForCustomerV2({ companyId: CO_PAGE, anonymousId: randomUUID(), channel: 'web', clientCaps: ALL_CAPS });
    expect(withCaps.length).toBe(20);
  });
  it('변형이 뽑히면 서빙 사본 끝 시각 = 부모 끝 시각(남은 시간 띠의 마감)', async () => {
    const end = future();
    const parent = await createInAppMessage(CO, OWNER, poster({ title: '끝 시각 원본', endAt: end, design: { poster_text: 'baked', poster_strip: { type: 'countdown' } }, poster_slides: [slide({ title: '끝 시각 원본' })] }) as any);
    const kid = await createVariant(CO, OWNER, { parentMessageId: parent.id, title: '끝 시각 변형', body: '', image_url: '/api/cdp/inapp/image/x/c.jpg' });
    // 부모에 노출 1건 = 탐색 단계에서 노출이 가장 적은 변형이 뽑힌다
    await insertMinimalRow(pool, 'cdp_inapp_impressions', { company_id: CO, message_id: parent.id, event_type: 'impression', anonymous_id: 'seed-1105' });
    const anon = randomUUID();
    const out = await getActiveMessagesForCustomerV2({ companyId: CO, anonymousId: anon, channel: 'web', clientCaps: ALL_CAPS });
    const v = out.find((m) => m.id === kid)!;
    expect(v).toBeTruthy();
    expect(new Date(v.endAt as any).getTime()).toBe(new Date(end).getTime());
  });
});
