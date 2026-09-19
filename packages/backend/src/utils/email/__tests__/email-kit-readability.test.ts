/**
 * ★ 2026-09-19 재오픈 2건 — 회사 킷 색이 흰색이면 이메일 장식이 전부 사라진다.
 *   헤더 D-Day·쿠폰 강조 = 흰 면 위 흰 글씨(`cmu3m03ze03najnlu1fjw857n`) ·
 *   히어로 헤드라인 마커·밑줄 = 흰 바탕 위 흰 워시·흰 선(`cmu3n0fdj03x1jnlua7bfr9h2`).
 *
 * 실측(0919 운영 PG): 주식회사 인비토 `brand_kit` 주색·강조색 = `#ffffff` · 직원이 손으로 만든 초안은
 *   `design.palette`가 비어 회사 킷을 그대로 썼다. 같은 회사 AI 자동제작 초안만 `#1f2937`(0915 보정)이었다.
 * 원인 = 보정(`accessiblePrimaryOf`)이 AI 자동제작 래퍼에만 있고 이메일 렌더 엔진에는 없었다
 *   (LESSONS_BACKEND 0915 "장치가 엔진 밖 래퍼에 있으면 두 번째 입구는 맨몸으로 나간다"의 재발).
 *
 * 이 파일이 고정하는 계약 — 회사 킷 색은 엔진 입구(`renderEmailSections`)에서 한 번 읽기 좋게 만든다.
 *   주색 = AI 자동제작과 같은 규칙 · 강조색 = 흰·연회색만 "지정 없음" · 사람이 고른 색(테마·블록 강조색)은 그대로.
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections } from '../email-section-renderer';
import { readableEmailKit } from '../email-tokens';
import { accessiblePrimaryOf, isLightNeutral, OUTREACH_NEUTRAL_PRIMARY } from '../../sales-outreach-look';
import { getContrastRatio, DM_COLOR_TOKENS } from '../../dm/dm-tokens';
import type { Section } from '../../dm/dm-section-registry';

const sec = (type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}): Section =>
  ({ id: 's-' + type, type, order: 0, visible: true, props, ...extra } as unknown as Section);

/** 접수 회사 실측값 그대로 */
const WHITE_KIT = { primary_color: '#ffffff', accent_color: '#ffffff' };
/** 운영에 있는 나머지 조합(2개사) — 출력이 한 글자도 바뀌면 안 된다 */
const PROD_OK_KIT = { primary_color: '#4f46e5', accent_color: '#f59e0b' };

const renderWith = (s: Section, brandKit: Record<string, unknown> | null, design: Record<string, unknown> | null = null) =>
  renderEmailSections([s], { brandKit: brandKit as never, design: design as never });

describe('readableEmailKit — 회사 킷 색 보정 규칙', () => {
  it('흰 주색 → AI 자동제작과 같은 무채색 · 흰 강조색 → 지정 없음(기본 강조색으로 떨어진다)', () => {
    const k = readableEmailKit(WHITE_KIT);
    expect(k?.primary_color).toBe(OUTREACH_NEUTRAL_PRIMARY);
    expect(k?.accent_color).toBeUndefined();
  });

  it('운영 나머지 조합은 값이 그대로다', () => {
    expect(readableEmailKit(PROD_OK_KIT)).toEqual(PROD_OK_KIT);
  });

  it('기준을 넘는 주색은 입력 문자열 그대로(대문자 표기까지)', () => {
    expect(readableEmailKit({ primary_color: '#4F46E5' })?.primary_color).toBe('#4F46E5');
  });

  it('흰 글씨 대비 4.5 미만 유채색 주색 = AI 자동제작 경로와 같은 값', () => {
    expect(readableEmailKit({ primary_color: '#10b981' })?.primary_color).toBe(accessiblePrimaryOf('#10b981'));
    expect(getContrastRatio(readableEmailKit({ primary_color: '#10b981' })!.primary_color!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it('유채색 강조색은 연해도 그대로(우리 기본 강조색부터 대비 4.5 미만이다)', () => {
    expect(readableEmailKit({ accent_color: '#fde68a' })?.accent_color).toBe('#fde68a');
    expect(getContrastRatio(DM_COLOR_TOKENS.brand.accent, '#ffffff')).toBeLessThan(4.5);
  });

  it('킷 색이 없으면 손대지 않는다(기본색은 resolveEmailBrand가 그대로 채운다)', () => {
    expect(readableEmailKit(null)).toBeNull();
    expect(readableEmailKit(undefined)).toBeUndefined();
    expect(readableEmailKit({ font_family: 'Pretendard' })).toEqual({ font_family: 'Pretendard' });
  });

  it('회사 킷 원장 객체를 바꾸지 않는다', () => {
    const kit = { ...WHITE_KIT };
    readableEmailKit(kit);
    expect(kit).toEqual(WHITE_KIT);
  });
});

describe('isLightNeutral — 흰·연회색 판정(accessiblePrimaryOf 안의 같은 줄을 꺼낸 것)', () => {
  it('흰색·연회색 = 참 · 유채색·짙은 무채색·해석 불가 = 거짓', () => {
    expect(isLightNeutral('#ffffff')).toBe(true);
    expect(isLightNeutral('#d1d5db')).toBe(true);
    expect(isLightNeutral('#4f46e5')).toBe(false);
    expect(isLightNeutral('#fde68a')).toBe(false);
    expect(isLightNeutral('#1f2937')).toBe(false);
    expect(isLightNeutral('red')).toBe(false);
    expect(isLightNeutral(undefined)).toBe(false);
  });

  it('accessiblePrimaryOf 동작은 꺼내기 전과 같다', () => {
    expect(accessiblePrimaryOf('#ffffff')).toBeNull();
    expect(accessiblePrimaryOf('#d1d5db')).toBeNull();
    expect(accessiblePrimaryOf('#4f46e5')).toBe('#4f46e5');
    expect(accessiblePrimaryOf('#10b981')).toBe('#0b7e58');
  });
});

describe('접수 1 — 헤더 D-Day·쿠폰 강조가 흰 킷에서도 보인다', () => {
  const EVENT = { brand_name: '인비토', event_title: '테스트', event_date: '2030-01-01T00:00:00.000Z' };

  it('D-Day 면이 흰 글씨와 대비 4.5 이상', () => {
    const html = renderWith(sec('header', { ...EVENT, variant: 'countdown' }), WHITE_KIT);
    const bg = /<td style="padding:[^"]*;background:(#[0-9a-f]{6});background-image:linear-gradient\(135deg/i.exec(html)?.[1];
    expect(bg).toBeDefined();
    expect(getContrastRatio(bg!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(html).not.toContain('linear-gradient(135deg,#ffffff 0%,#ffffff 55%');
  });

  it('쿠폰 강조 면 = 기본 강조색 → 보정 주색(흰→흰이 아니다)', () => {
    const html = renderWith(sec('header', { brand_name: '인비토', variant: 'coupon', discount_label: '테스트', coupon_code: 'TEST' }), WHITE_KIT);
    expect(html).toContain(`linear-gradient(135deg,${DM_COLOR_TOKENS.brand.accent} 0%,${OUTREACH_NEUTRAL_PRIMARY} 100%)`);
    expect(html).not.toContain('linear-gradient(135deg,#ffffff 0%,#ffffff 100%)');
  });
});

describe('접수 2 — 히어로 헤드라인 마커·밑줄이 흰 킷에서도 보인다', () => {
  it('마커 워시 = 보정 주색', () => {
    const html = renderWith(sec('hero', { headline: '테스트', headline_emphasis: 'marker' }), WHITE_KIT);
    expect(html).toContain('rgba(31,41,55,0.26)');
    expect(html).not.toContain('rgba(255,255,255,0.26)');
  });

  it('밑줄 = 보정 주색', () => {
    const html = renderWith(sec('hero', { headline: '테스트', headline_emphasis: 'underline' }), WHITE_KIT);
    expect(html).toContain(`border-bottom:3px solid ${OUTREACH_NEUTRAL_PRIMARY}`);
    expect(html).not.toContain('border-bottom:3px solid #ffffff');
  });
});

describe('같은 뿌리 — 흰 강조색 별점(B-0915-3)', () => {
  it('별점 색 미지정 = 기본 강조색(흰색이 아니다)', () => {
    const html = renderWith(sec('reviews', { reviews: [{ body: '좋아요', rating: 5, author: '고객' }] }), WHITE_KIT);
    const starColors = [...html.matchAll(/color:(#[0-9a-f]{6})[^>]*>[★☆]/gi)].map((m) => m[1].toLowerCase());
    expect(starColors.length).toBeGreaterThan(0);
    expect(starColors.every((c) => c === DM_COLOR_TOKENS.brand.accent)).toBe(true);
  });
});

describe('보정은 흰 면 계약이다 — 어두운 배경면은 원래 출력 그대로', () => {
  // 적대 검토(0919)에서 잡은 것: 엔진 입구에서 ctx 킷을 통째로 바꾸면 "어둡게" 배경면(#171717)의 브랜드 재해석까지
  // 보정 주색 #1f2937을 받아 **어두운 면 위 어두운 태그·밑줄**이 됐다(흰 킷일 때 원래는 흰색이라 보였다).
  it('흰 킷 + 어둡게 배경면 = 태그·밑줄이 보정 전과 같은 흰색(어두운 면 위에서 보인다)', () => {
    const html = renderWith(sec('text_card', { tag: 'TAG', headline: '안내', headline_emphasis: 'underline' }, { background: 'dark' }), WHITE_KIT);
    expect(html).toContain('border-bottom:3px solid #ffffff');
    expect(html).toContain('letter-spacing:0.18em;color:#ffffff');
    expect(html).not.toContain(`border-bottom:3px solid ${OUTREACH_NEUTRAL_PRIMARY}`);
  });

  // 히어로 사진 아래 문구 밴드는 블록이 스스로 만드는 어두운 면(#171717 · 프리셋 soft/strong/top)이다.
  // 0916 첫 캡처에서 마커가 회색 띠로 보였던 자리 = 흰 워시가 어두운 밴드 위에서 보였던 것. 이 출력은 지킨다.
  const HERO_IMG = { headline: '인비토 테스트', image_url: 'https://example.invalid/a.jpg' };

  it('히어로 사진 + 어두운 문구 밴드 = 마커·밑줄이 보정 전과 같다', () => {
    const marker = renderWith(sec('hero', { ...HERO_IMG, headline_emphasis: 'marker' }), WHITE_KIT);
    expect(marker).toContain('bgcolor="#171717"');
    expect(marker).toContain('rgba(255,255,255,0.26)');
    const underline = renderWith(sec('hero', { ...HERO_IMG, headline_emphasis: 'underline', overlay: 'soft' }), WHITE_KIT);
    expect(underline).toContain('border-bottom:3px solid #ffffff');
  });

  it('히어로 사진 + 밴드 없음(흰 면) = 보정 주색', () => {
    const html = renderWith(sec('hero', { ...HERO_IMG, headline_emphasis: 'marker', overlay: 'none' }), WHITE_KIT);
    expect(html).toContain('rgba(31,41,55,0.26)');
  });

  it('히어로 브랜드 틴트 밴드 = 면은 보정 주색(흰 글씨가 보인다) · 마커는 그 어두운 면 위에서 보이는 원래 색', () => {
    const html = renderWith(sec('hero', { ...HERO_IMG, headline_emphasis: 'marker', overlay: 'brand' }), WHITE_KIT);
    expect(html).toContain(`bgcolor="${OUTREACH_NEUTRAL_PRIMARY}"`);
    expect(html).toContain('rgba(255,255,255,0.26)');
  });

  // 렌더러의 어두운 면은 셋이다(grep: b.dark · #171717 · onDark) — ①셸 전체(킷·테마 배경이 어두움) ②어둡게 배경면 ③히어로 문구 밴드.
  it('셸이 어두우면(킷 배경색 또는 테마 배경색) 킷을 보정하지 않는다', () => {
    const byKit = readableEmailKit({ ...WHITE_KIT, background_color: '#0e1018' });
    expect(byKit).toEqual({ ...WHITE_KIT, background_color: '#0e1018' });
    expect(readableEmailKit(WHITE_KIT, { palette: { background: '#0b1220' } })).toEqual(WHITE_KIT);
    const html = renderWith(sec('hero', { headline: '테스트', headline_emphasis: 'underline' }), { ...WHITE_KIT, background_color: '#0e1018' });
    expect(html).toContain('border-bottom:3px solid #ffffff');
  });

  it('셸이 밝으면(킷 배경색 흰색) 보정한다', () => {
    expect(readableEmailKit({ ...WHITE_KIT, background_color: '#ffffff' })?.primary_color).toBe(OUTREACH_NEUTRAL_PRIMARY);
  });

  it('어둡게 배경면 출력은 킷 보정과 무관하다(미달 유채색 킷도 원색 그대로)', () => {
    const html = renderWith(sec('text_card', { headline: '안내', headline_emphasis: 'underline' }, { background: 'dark' }), { primary_color: '#10b981' });
    expect(html).toContain('border-bottom:3px solid #10b981');
  });
});

describe('블록 강조색 경로도 킷 강조색은 보정된 값을 쓴다', () => {
  it('블록 강조색 지정 + 흰 킷 강조색 = 보조 버튼 면이 기본 강조색(흰 면 흰 글씨가 아니다)', () => {
    const html = renderWith(
      sec('cta', { buttons: [{ label: '더보기', url: 'https://example.invalid', style: 'secondary' }] }, { accent_color: '#e11d48' }),
      WHITE_KIT,
    );
    expect(html).toContain(`background:${DM_COLOR_TOKENS.brand.accent}`);
    expect(html).not.toContain('background:#ffffff;background-image:none');
  });
});

describe('사람이 고른 색은 보정하지 않는다', () => {
  it('캠페인 테마 주색이 흰 킷보다 우선하고 그대로 나간다', () => {
    const html = renderWith(sec('hero', { headline: '테스트', headline_emphasis: 'marker' }), WHITE_KIT, { palette: { primary: '#e11d48' } });
    expect(html).toContain('rgba(225,29,72,0.26)');
  });

  it('블록 "버튼·강조색"은 연한 색이어도 지정값 그대로', () => {
    const html = renderWith(sec('text_card', { headline: '안내', headline_emphasis: 'underline' }, { accent_color: '#fde68a' }), WHITE_KIT);
    expect(html).toContain('border-bottom:3px solid #fde68a');
  });
});
