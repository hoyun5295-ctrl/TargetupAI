/**
 * ★ 2026-09-29 인앱 만들기 개편 — 데이터 계약 · 초안/게시 · 남은 슬라이드 게이트 · 하루 보지 않기 (설계서 docs/2026-09-29-inapp-editor-redesign-design.md §1)
 *
 * 고정하는 것:
 *   ① design.poster_layout / dismiss_mode 화이트리스트(모르는 값 탈락 = 지금 포스터 · 지금 닫기)
 *   ② 슬라이드 새 키(eyebrow · subtitle · bg_color · image_fit) 정규화 · 초안은 사진 없는 장도 자리를 지킨다
 *   ③ 배지 규칙 = 모든 장 eyebrow 가 같을 때만
 *   ④ 게시 조건 CT(inAppPublishDefect) — active 로 넘어가는 모든 길목(생성 · 수정 · 변형 · 플래너 실행)
 *   ⑤ 초안 = draft 표시 + 멈춤 둘 다(플래너 제작처럼 draft 없는 멈춤 저장은 지금처럼 엄격)
 *   ⑥ 남은 슬라이드 게이트(update SET · 서빙) · 하루 보지 않기 억제 SQL · 목록 publish_charged
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  sanitizeInAppDesign,
  sanitizePosterSlides,
  posterSlidesHaveUneditedPlaceholder,
  composeFlatFromPosterSlides,
  commonPosterEyebrow,
  inAppPublishDefect,
  isInAppDraftSave,
  inAppNotPublishableError,
  parseInAppNotPublishable,
  sanitizeAppMessageColors,
  INAPP_NOT_PUBLISHABLE_ERROR,
} from '../inapp-message';

const utilSrc = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');
const routeSrc = readFileSync(join(__dirname, '..', '..', 'routes', 'cdp.ts'), 'utf8');
const between = (s: string, a: string, b: string) => {
  const i = s.indexOf(a);
  expect(i, a).toBeGreaterThan(-1);
  const j = s.indexOf(b, i + a.length);
  return s.slice(i, j > -1 ? j : undefined);
};

describe('① design — 레이아웃 · 닫기 방식', () => {
  it('허용 값만 남긴다', () => {
    expect(sanitizeInAppDesign({ poster_layout: 'event_card', dismiss_mode: 'snooze_day' })).toEqual({ poster_layout: 'event_card', dismiss_mode: 'snooze_day' });
    expect(sanitizeInAppDesign({ poster_layout: 'banner_sheet' })).toEqual({ poster_layout: 'banner_sheet' });
    expect(sanitizeInAppDesign({ poster_layout: 'overlay' })).toEqual({ poster_layout: 'overlay' });
  });
  it('모르는 값은 버린다(키 없음 = 지금 동작)', () => {
    expect(sanitizeInAppDesign({ poster_layout: 'carousel', dismiss_mode: 'forever' })).toBeNull();
    expect(sanitizeInAppDesign({ poster_layout: 'event_card', dismiss_mode: 'week' })).toEqual({ poster_layout: 'event_card' });
  });
});

describe('② 슬라이드 새 키 · 초안', () => {
  it('eyebrow · subtitle trim · bg_color hex 만 · image_fit 두 값만', () => {
    const [s] = sanitizePosterSlides([{ image_url: '/a.png', eyebrow: ' EVENT ', subtitle: ' 첫 달 ', bg_color: '#1A2B3C', image_fit: 'contain' }]);
    expect(s).toMatchObject({ eyebrow: 'EVENT', subtitle: '첫 달', bg_color: '#1A2B3C', image_fit: 'contain' });
    const [t] = sanitizePosterSlides([{ image_url: '/a.png', eyebrow: '  ', bg_color: 'red', image_fit: 'fill' }]);
    expect(t).toEqual({ image_url: '/a.png' });
  });
  it('기본은 사진 없는 장을 버린다(옛 동작 그대로)', () => {
    expect(sanitizePosterSlides([{ title: '글만' }, { image_url: '/b.png' }])).toHaveLength(1);
  });
  it('초안(allowEmptyImage)은 사진 없는 장도 자리를 지킨다', () => {
    const out = sanitizePosterSlides([{ title: '글만' }, { image_url: '/b.png' }], { allowEmptyImage: true });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ image_url: '', title: '글만' });
  });
  it('라벨 · 윗줄의 혜택 placeholder 도 잡는다', () => {
    expect(posterSlidesHaveUneditedPlaceholder([{ image_url: '/a', eyebrow: '[혜택 안내: 직접 작성해주세요]' }])).toBe(true);
    expect(posterSlidesHaveUneditedPlaceholder([{ image_url: '/a', subtitle: '직접 작성해주세요' }])).toBe(true);
    expect(posterSlidesHaveUneditedPlaceholder([{ image_url: '/a', eyebrow: 'EVENT', subtitle: '첫 달 무료' }])).toBe(false);
  });
  it('앱 채널 = 면 색도 단색 보정 경로를 탄다', () => {
    const m: any = { posterSlides: [{ bg_color: 'linear-gradient(#112233, #445566)' }] };
    sanitizeAppMessageColors(m);
    expect(m.posterSlides[0].bg_color).toBe('#112233');
  });
});

describe('③ 배지 규칙', () => {
  it('모든 장 eyebrow 가 같으면 그 값', () => {
    expect(commonPosterEyebrow([{ image_url: '/a', eyebrow: 'EVENT' }, { image_url: '/b', eyebrow: 'EVENT' }] as any)).toBe('EVENT');
  });
  it('하나라도 다르거나 비면 null', () => {
    expect(commonPosterEyebrow([{ image_url: '/a', eyebrow: 'EVENT' }, { image_url: '/b', eyebrow: 'NEW' }] as any)).toBeNull();
    expect(commonPosterEyebrow([{ image_url: '/a', eyebrow: 'EVENT' }, { image_url: '/b' }] as any)).toBeNull();
    expect(commonPosterEyebrow([{ image_url: '/a' }] as any)).toBeNull();
  });
  it('flat 합성이 그 규칙을 쓴다(옛 슬라이드 = eyebrow 없음 = null · 회귀 0)', () => {
    expect(composeFlatFromPosterSlides([{ image_url: '/a', eyebrow: 'EVENT' }] as any, {}).badgeText).toBe('EVENT');
    expect(composeFlatFromPosterSlides([{ image_url: '/a', title: 't' }] as any, {}).badgeText).toBeNull();
  });
});

describe('④ 게시 조건 CT', () => {
  const ok = { title: '제목', body: '본문', template: 'center_modal', buttons: [], content_blocks: [] };
  it('조건 충족 = null', () => {
    expect(inAppPublishDefect(ok)).toBeNull();
    expect(inAppPublishDefect({ ...ok, template: 'full_image', image_url: '/a.png', poster_slides: [{ image_url: '/a.png' }, { image_url: '/b.png' }] })).toBeNull();
  });
  it('제목 · 본문', () => {
    expect(inAppPublishDefect({ ...ok, title: '  ' })?.field).toBe('title');
    expect(inAppPublishDefect({ ...ok, body: '' })?.field).toBe('body');
  });
  it('장이 있는 포스터 계열 = 본문 선택 · 장 없는 옛 포스터는 지금처럼 본문 필수', () => {
    expect(inAppPublishDefect({ ...ok, body: '', template: 'full_image', image_url: '/a', poster_slides: [{ image_url: '/a', title: '제목' }] })).toBeNull();
    expect(inAppPublishDefect({ ...ok, body: '', template: 'full_image', image_url: '/a' })?.field).toBe('body');
  });
  it('혜택 placeholder — 제목 · 배지 · 버튼 · 블록 · 장', () => {
    expect(inAppPublishDefect({ ...ok, title: '[혜택 안내: 직접 작성해주세요]' })?.field).toBe('placeholder');
    expect(inAppPublishDefect({ ...ok, badge_text: '직접 작성해주세요' })?.field).toBe('placeholder');
    expect(inAppPublishDefect({ ...ok, buttons: [{ label: '[혜택' }] })?.field).toBe('placeholder');
    expect(inAppPublishDefect({ ...ok, content_blocks: [{ type: 'benefit', text: '' }] })?.field).toBe('placeholder');
    expect(inAppPublishDefect({ ...ok, template: 'full_image', image_url: '/a', poster_slides: [{ image_url: '/a', subtitle: '[직접 작성' }] })?.field).toBe('placeholder');
  });
  it('포스터 = 장마다 사진(몇 번째 장인지) · 장이 없으면 포스터 사진', () => {
    const d = inAppPublishDefect({ ...ok, template: 'full_image', image_url: '/a', poster_slides: [{ image_url: '/a' }, { image_url: '' }] });
    expect(d).toEqual({ message: '2번째 장에 사진을 넣어 주세요.', field: 'slide_image', slide: 1 });
    expect(inAppPublishDefect({ ...ok, template: 'full_image', image_url: '' })?.field).toBe('image');
  });
  it('throw 문구 왕복(라우트가 풀어 400 으로 답한다)', () => {
    const d = { message: '3번째 장에 사진을 넣어 주세요.', field: 'slide_image' as const, slide: 2 };
    const e = inAppNotPublishableError(d);
    expect(e.message.startsWith(INAPP_NOT_PUBLISHABLE_ERROR)).toBe(true);
    expect(parseInAppNotPublishable(e.message)).toEqual(d);
    expect(parseInAppNotPublishable('BENEFIT_PLACEHOLDER_UNEDITED: x')).toBeNull();
  });
});

describe('⑤ 초안 판정', () => {
  it('draft 표시 + 멈춤 둘 다일 때만', () => {
    expect(isInAppDraftSave({ draft: true, status: 'paused' })).toBe(true);
    expect(isInAppDraftSave({ draft: true, status: 'active' })).toBe(false);
    expect(isInAppDraftSave({ status: 'paused' })).toBe(false); // 플래너 제작 = 지금처럼 엄격
    expect(isInAppDraftSave({ draft: 'true', status: 'paused' } as any)).toBe(false);
  });
  it('생성 CT — 초안만 완화 · 게시로 만드는 생성은 게시 조건 CT', () => {
    const c = between(utilSrc('inapp-message.ts'), 'export async function createInAppMessage(', '\nexport async function listInAppMessages(');
    expect(c).toContain("if (!draft && (!input.title || !input.body)) throw new Error('title과 body는 필수입니다.');");
    // (Codex 1R) 저장은 사진 없는 장을 버리지 않는다 — 게시 판정이 거절한다(조용한 장 유실 · 판정 우회 차단)
    expect(c).toContain('sanitizePosterSlides(input.poster_slides, { allowEmptyImage: true })');
    expect(between(utilSrc('inapp-message.ts'), 'export async function updateInAppMessage(', '\nexport async function propagatePosterToVariants(')).toContain('sanitizePosterSlides(input.poster_slides, { allowEmptyImage: true })');
    expect(c).toContain("const finalStatus = draft ? 'paused' : (input.status || 'active');");
    expect(c).toMatch(/if \(finalStatus === 'active'\) \{\s*const defect = inAppPublishDefect\(/);
  });
  it('수정 CT — 결과 행이 active 면 한 트랜잭션 안에서 판정 · 미달 = 되돌리고 throw', () => {
    const u = between(utilSrc('inapp-message.ts'), 'export async function updateInAppMessage(', '\nexport async function deleteInAppMessage(');
    expect(u).toContain("await client.query('BEGIN');");
    const iUpd = u.indexOf('result = await client.query(');
    const iDefect = u.indexOf("const defect = row && row.status === 'active' ? inAppPublishDefect(row) : null;");
    const iCommit = u.indexOf("await client.query('COMMIT');");
    expect(iUpd).toBeGreaterThan(-1);
    expect(iDefect).toBeGreaterThan(iUpd);
    expect(iCommit).toBeGreaterThan(iDefect);
    expect(u).toContain("await client.query('ROLLBACK').catch(() => undefined);");
    expect(u).toContain('client.release();');
  });
  it('게시 중 메시지에 도착한 초안 저장 = 거절(행 잠금 뒤 확인 · 라우트 409) — 늦은 자동 저장이 게시를 멈춤으로 되돌리지 않는다', () => {
    const u = between(utilSrc('inapp-message.ts'), 'export async function updateInAppMessage(', '\nexport async function propagatePosterToVariants(');
    const iLock = u.indexOf('SELECT status FROM cdp_inapp_messages WHERE id = $1::uuid AND company_id = $2::uuid FOR UPDATE');
    expect(iLock).toBeGreaterThan(u.indexOf("await client.query('BEGIN');"));
    expect(iLock).toBeLessThan(u.indexOf('result = await client.query('));
    expect(u).toContain("if (cur.rows[0]?.status === 'active') throw new Error(INAPP_DRAFT_ON_LIVE_ERROR);");
    const put = between(routeSrc, "router.put('/inapp/:id',", "router.put('/inapp/:id/audience-filter'");
    expect(put).toMatch(/if \(msg === INAPP_DRAFT_ON_LIVE_ERROR\) \{\s*return res\.status\(409\)/);
  });
  it('변형 생성 · 변형 켜기 · 플래너 실행도 같은 CT', () => {
    const v = utilSrc('inapp-variant-optimizer.ts');
    expect(between(v, 'export async function createVariant(', '\nexport async function setVariantStatus(')).toMatch(/if \(input\.status !== 'paused'\) \{\s*const defect = inAppPublishDefect\(/);
    // (Codex 1R high) 상태만 바꾸는 켜기 = 단일 길목(한 트랜잭션 · 행 잠금 → 판정 → 켜기)
    expect(between(v, 'export async function setVariantStatus(', '\n}\n')).toContain('await activateInAppMessage({ companyId, messageId: variantId, parentMessageId });');
    // ★ 2026-10-04 플래너 1차 채널 = 문자·DM·메일 — 실행부에 인앱 켜기 분기가 없다(켜는 길목은 activateInAppMessage 하나로 남는다).
    const p = utilSrc('planner-executor.ts');
    expect(p).not.toContain('async function executeInapp(');
    expect(p).not.toContain("SET status = 'active'");
  });
  it('켜기 단일 길목 — 한 트랜잭션에서 FOR UPDATE → 판정 → 켜기 · 미달 = 되돌리고 결함 반환', () => {
    const a = between(utilSrc('inapp-message.ts'), 'export async function activateInAppMessage(', '\nexport async function deleteInAppMessage(');
    const iBegin = a.indexOf("await client.query('BEGIN');");
    const iLock = a.indexOf('FOR UPDATE');
    const iDefect = a.indexOf('const defect = inAppPublishDefect(cur.rows[0]);');
    const iUpd = a.indexOf("SET status = 'active'");
    const iCommit = a.indexOf("await client.query('COMMIT');");
    expect(iBegin).toBeGreaterThan(-1);
    expect(iBegin).toBeLessThan(iLock);
    expect(iLock).toBeLessThan(iDefect);
    expect(iDefect).toBeLessThan(iUpd);
    expect(iUpd).toBeLessThan(iCommit);
    expect(a).toContain("return { ok: false, reason: 'defect', defect };");
    expect(a).toContain('client.release();');
  });
  it('라우트 — 게시 조건 미달 = 400 INAPP_NOT_PUBLISHABLE(결함 자리 동봉)', () => {
    for (const [a, b] of [
      ["router.post('/inapp',", "router.put('/inapp/:id',"],
      ["router.put('/inapp/:id',", "router.put('/inapp/:id/audience-filter'"],
      ["router.post('/inapp/variant',", "router.post('/inapp/upload-image',"],
    ]) {
      const blk = between(routeSrc, a, b);
      expect(blk, a).toContain("code: 'INAPP_NOT_PUBLISHABLE', defect: notPublishable");
    }
  });
});

describe('[반영] = A/B 변형에 모양 전파', () => {
  const m = utilSrc('inapp-message.ts');
  it('부모 · 초안 아님 · 모양 칸이 왔을 때만 · 같은 트랜잭션(COMMIT 앞)', () => {
    const u = between(m, 'export async function updateInAppMessage(', '\nexport async function propagatePosterToVariants(');
    const iProp = u.indexOf('await propagatePosterToVariants(client, row);');
    expect(iProp).toBeGreaterThan(-1);
    expect(iProp).toBeLessThan(u.indexOf("await client.query('COMMIT');"));
    expect(u).toContain("if (row && !draft && !row.parent_message_id && (posterSlidesProvided || designProvided || input.template !== undefined)) {");
  });
  it('변형 생성과 같은 규칙: 부모 장 사본 + 첫 장 제목·본문만 변형 값 · 장 없는 부모는 변형 사진 유지', () => {
    const f = between(m, 'export async function propagatePosterToVariants(', '\nexport async function deleteInAppMessage(');
    expect(f).toContain("if (!parent || parent.template !== 'full_image') return 0;");
    expect(f).toContain('? [{ ...parentSlides[0], title: k.title, body: k.body }, ...parentSlides.slice(1)]');
    expect(f).toContain("composeFlatFromPosterSlides(slides, { title: k.title, body: k.body, imageUrl: parent.image_url, buttons: [] })");
    expect(f).toContain("image_url = CASE WHEN $9::boolean OR COALESCE(image_url, '') = '' THEN $5 ELSE image_url END,");
    expect(f).toMatch(/AND parent_message_id = \$2::uuid AND status <> 'archived'\s*FOR UPDATE/);
  });
  it('전파 SQL 이 실제로 변형 행을 바꾼다(가짜 연결로 실행)', async () => {
    const { propagatePosterToVariants } = await import('../inapp-message');
    const calls: any[] = [];
    const client = {
      query: async (text: string, params?: any[]) => {
        calls.push({ text, params });
        if (text.includes('SELECT id, title, body')) return { rows: [{ id: 'v1', title: '변형 제목', body: '변형 본문' }] };
        return { rows: [] };
      },
    };
    const n = await propagatePosterToVariants(client, {
      id: 'p1', company_id: 'c1', template: 'full_image', design: { poster_layout: 'event_card' },
      poster_slides: [{ image_url: '/a.png', title: '부모', eyebrow: 'EVENT' }, { image_url: '/b.png' }],
      image_url: '/a.png', badge_text: 'EVENT',
    });
    expect(n).toBe(1);
    const upd = calls[1];
    expect(JSON.parse(upd.params[3])).toEqual([
      { image_url: '/a.png', title: '변형 제목', body: '변형 본문', eyebrow: 'EVENT' },
      { image_url: '/b.png' },
    ]);
    expect(JSON.parse(upd.params[2])).toEqual({ poster_layout: 'event_card' });
    expect(upd.params[4]).toBe('/a.png');
    expect(upd.params[8]).toBe(true);
  });
  it('(Codex 1R) 전파 뒤 켜진 변형이 게시 조건 미달이면 throw(부모 수정까지 같은 트랜잭션에서 되돌린다)', async () => {
    const { propagatePosterToVariants } = await import('../inapp-message');
    const client = {
      query: async (text: string) => {
        if (text.includes('SELECT id, title, body')) return { rows: [{ id: 'v1', title: '변형', body: '[혜택 안내: 직접 작성해주세요]' }] };
        return { rows: [{ id: 'v1', status: 'active', template: 'full_image', title: '변형', body: '[혜택 안내: 직접 작성해주세요]', image_url: '/a.png', poster_slides: [], buttons: [], content_blocks: [] }] };
      },
    };
    await expect(propagatePosterToVariants(client, { id: 'p1', company_id: 'c1', template: 'full_image', image_url: '/a.png', poster_slides: [] }))
      .rejects.toThrow(/INAPP_NOT_PUBLISHABLE: .*A\/B 변형에 적용할 수 없어요/);
  });
});

describe('⑥ 남은 슬라이드 게이트 · 하루 보지 않기 · 과금 이력', () => {
  const m = utilSrc('inapp-message.ts');
  it('update SET — 최종 형태가 포스터가 아니면 장을 비운다', () => {
    expect(m).toMatch(/poster_slides = CASE\s*WHEN COALESCE\(\$15, template\) IS DISTINCT FROM 'full_image' THEN NULL\s*WHEN \$38::boolean THEN \$39::jsonb\s*ELSE poster_slides\s*END,/);
  });
  it('서빙 — 포스터가 아닌 형태의 장은 내보내지 않는다', () => {
    expect(m).toContain("posterSlides: (row.template || row.position) === 'full_image' && Array.isArray(row.poster_slides) ? row.poster_slides : [],");
  });
  it('하루 보지 않기 = dismiss + snooze_day + 24시간 · opt_out 과 같은 부모 축 조회', () => {
    const q = between(m, 'SELECT DISTINCT COALESCE(m2.parent_message_id, m2.id) AS root_id', 'optParams');
    expect(q).toContain("i.event_type = 'opt_out'");
    expect(q).toContain("OR (i.event_type = 'dismiss' AND i.button_id = 'snooze_day' AND i.occurred_at > NOW() - INTERVAL '24 hours')");
  });
  it('서빙 개인화 · 변수 스캔 = 라벨 · 윗줄 포함', () => {
    expect(routeSrc).toContain("if (typeof s.eyebrow === 'string') out.eyebrow = renderTextForCustomer(s.eyebrow, renderCustomer).rendered;");
    expect(routeSrc).toContain("if (typeof s.subtitle === 'string') out.subtitle = renderTextForCustomer(s.subtitle, renderCustomer).rendered;");
    const p = utilSrc('inapp-personalization.ts');
    expect(p).toContain('scanText(s.eyebrow);');
    expect(p).toContain('scanText(s.subtitle);');
  });
  it('목록 = 게시 과금 이력(publish_charged) · 키 묶음 한 번 조회', () => {
    const g = between(routeSrc, "router.get('/inapp', async", '\n});');
    expect(g).toContain("const chargedKeys = await chargedKeysAmong(companyId, messages.map((m) => `inapp-publish:${m.id}`));");
    expect(g).toContain('publish_charged: chargedKeys.has(`inapp-publish:${m.id}`),');
    expect(utilSrc('ai-credit.ts')).toContain('WHERE company_id = $1::uuid AND idempotency_key = ANY($2::text[])');
  });
});
