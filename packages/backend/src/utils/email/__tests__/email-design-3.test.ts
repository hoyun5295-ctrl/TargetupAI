/**
 * email-design-3.test.ts — 이메일 디자인 3.0 축 고정 (2026-07-13)
 *
 * 문서 골격(다크모드 meta·모바일 @media·footer 슬롯) / VML 불릿프루프 버튼 / 명시 프리헤더 우선 /
 * 다크 셸 반전 / 타입스케일·밀도 / 모티프·디바이더 / 구도(treatment) / 헤드라인 마커 / design 입력 정규화.
 * 순수 함수(DB-free) — vitest 단독 실행 가능.
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections, EMAIL_FOOTER_SLOT } from '../email-section-renderer';
import { normalizeEmailDesign, isDarkBackground, emailFontStack, emailGoogleFontsImport } from '../email-tokens';
import { selectEmailTreatment } from '../email-blocks';
import type { Section } from '../../dm/dm-section-registry';

const sec = (type: string, props: Record<string, unknown>, order = 0, extra: Record<string, unknown> = {}): Section =>
  ({ id: `s-${type}-${order}`, type, order, visible: true, props, ...extra } as unknown as Section);

const SAMPLE: Section[] = [
  sec('hero', { headline: '여름 신상품 출시', sub_copy: '지금 만나보세요' }, 0),
  sec('text_card', { headline: '소개', body: '본문 내용입니다' }, 1),
  sec('cta', { buttons: [{ label: '지금 보기', url: 'https://shop.example.com', style: 'primary' }] }, 2),
  sec('footer', { notes: '본 메일 안내' }, 3),
];

describe('디자인 3.0 — 문서 골격', () => {
  it('완전한 HTML 문서 + 다크모드 meta + 모바일 @media + footer 슬롯(</body> 앞) 1개', () => {
    const html = renderEmailSections(SAMPLE, {});
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain('name="supported-color-schemes"');
    expect(html).toContain('@media (max-width:600px)');
    expect(html).toContain('@media (prefers-color-scheme:dark)');
    expect(html.trim().endsWith('</html>')).toBe(true);
    expect(html.split(EMAIL_FOOTER_SLOT).length).toBe(2); // 정확히 1개
    expect(html.indexOf(EMAIL_FOOTER_SLOT)).toBeLessThan(html.indexOf('</body>'));
  });

  it('불릿프루프 버튼 — MSO VML roundrect + 비-MSO 폴백 조건부 주석', () => {
    const html = renderEmailSections(SAMPLE, {});
    expect(html).toContain('<!--[if mso]><v:roundrect');
    expect(html).toContain('<!--[if !mso]><!-->');
    expect(html).toContain('arcsize="30%"');
  });

  it('명시 프리헤더(design.preheader) 우선 — 자동 추출 대신 지정 문구', () => {
    const html = renderEmailSections(SAMPLE, { design: { preheader: '수신함 미리보기 문구' } });
    expect(html).toContain('수신함 미리보기 문구');
    const hidden = html.slice(html.indexOf('display:none;font-size:1px'), html.indexOf('&nbsp;&zwnj;'));
    expect(hidden).toContain('수신함 미리보기 문구');
    expect(hidden).not.toContain('여름 신상품 출시');
  });
});

describe('디자인 3.0 — 다크 셸·타입스케일·밀도', () => {
  it('어두운 배경 = 중립 반전(텍스트 밝게 + 카드 #171717 리터럴)', () => {
    const html = renderEmailSections(SAMPLE, { design: { palette: { background: '#0e1018' } } });
    expect(html).toContain('#f4f4f5');   // text
    expect(html).toContain('#171717');   // cardBg 리터럴
    expect(html).toContain('background:#0e1018'); // shellBg
  });

  it('isDarkBackground — WCAG 대비 판정 (라이트 배경 false)', () => {
    expect(isDarkBackground('#0e1018')).toBe(true);
    expect(isDarkBackground('#ffffff')).toBe(false);
    expect(isDarkBackground('#faf6ef')).toBe(false);
    expect(isDarkBackground(undefined)).toBe(false);
  });

  it('타입스케일 bold = hero 34px/900 · minimal = 28px/600 (미설정 = 기존 40px 유지)', () => {
    const bold = renderEmailSections(SAMPLE, { design: { art_direction: { typeScale: 'bold' } } });
    expect(bold).toContain('font-size:34px');
    expect(bold).toContain('font-weight:900');
    const minimal = renderEmailSections(SAMPLE, { design: { art_direction: { typeScale: 'minimal' } } });
    expect(minimal).toContain('font-size:28px');
    const plain = renderEmailSections(SAMPLE, {});
    expect(plain).toContain('font-size:40px');
  });

  it('여백 밀도 airy = 1.4배 리터럴 px (hero 32→45px)', () => {
    const html = renderEmailSections(SAMPLE, { design: { art_direction: { spacingDensity: 'airy' } } });
    expect(html).toContain('45px');
  });
});

describe('디자인 3.0 — 모티프·디바이더·헤드라인 마커', () => {
  it('모티프 rule = 헤드라인 위 포인트 바 / index = 01 넘버링', () => {
    const rule = renderEmailSections(SAMPLE, { design: { art_direction: { accentMotif: 'rule' } } });
    expect(rule).toContain('width:28px;height:3px');
    const idx = renderEmailSections(SAMPLE, { design: { art_direction: { accentMotif: 'index' } } });
    expect(idx).toContain('letter-spacing:0.18em');
    expect(idx).toMatch(/>0\d</);
  });

  it('디바이더 hairline = 섹션 사이 hr (헤더 뒤·푸터 앞 제외)', () => {
    const html = renderEmailSections(SAMPLE, { design: { art_direction: { sectionDivider: 'hairline' } } });
    // hero|text_card / text_card|cta 사이 2곳 (cta|footer 제외)
    const count = html.split('border-top:1px solid').length - 1;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it('헤드라인 마커/밑줄 — headline_emphasis 소비', () => {
    const marker = renderEmailSections([sec('hero', { headline: '특가', headline_emphasis: 'marker' }, 0)], {});
    expect(marker).toContain('linear-gradient(transparent 58%');
    const underline = renderEmailSections([sec('text_card', { headline: '안내', headline_emphasis: 'underline' }, 0)], {});
    expect(underline).toContain('border-bottom:3px solid');
  });
});

describe('디자인 3.0 — 구도(treatment)', () => {
  it('hero split(이미지) = 50% 2열 / typographic = 이미지 무시 대형 타이포', () => {
    const split = renderEmailSections([
      sec('hero', { headline: '제목', image_url: 'https://cdn.example.com/a.jpg' }, 0, { treatment: 'split' }),
    ], {});
    expect(split.split('width="50%"').length - 1).toBe(2);
    const typo = renderEmailSections([
      sec('hero', { headline: '타이포 제목', image_url: 'https://cdn.example.com/a.jpg' }, 0, { treatment: 'typographic' }),
    ], {});
    expect(typo).not.toContain('cdn.example.com/a.jpg');
    expect(typo).toContain('타이포 제목');
  });

  it('cta bar = 전폭 강조 밴드 + 반전 버튼 / ghost = 아웃라인 강제', () => {
    const bar = renderEmailSections([
      sec('cta', { buttons: [{ label: '보기', url: 'https://a.example.com', style: 'primary' }] }, 0, { treatment: 'bar' }),
    ], {});
    expect(bar).toContain('background:#ffffff'); // 반전 버튼
    const ghost = renderEmailSections([
      sec('cta', { buttons: [{ label: '보기', url: 'https://a.example.com', style: 'primary' }] }, 0, { treatment: 'ghost' }),
    ], {});
    expect(ghost).not.toContain('background-image:linear-gradient(180deg'); // 그라데이션 primary 없음
  });

  it('coupon spotlight = 다크 패널(#171717 리터럴) / product list = 96px 썸네일 행', () => {
    const spot = renderEmailSections([
      sec('coupon', { discount_label: '혜택 안내', coupon_code: 'CODE1' }, 0, { treatment: 'spotlight' }),
    ], {});
    expect(spot).toContain('background:#171717');
    const list = renderEmailSections([
      sec('product_carousel', { products: [{ name: '상품A', price: 1000, image_url: 'https://cdn.example.com/p.jpg' }] }, 0, { treatment: 'list' }),
    ], {});
    expect(list).toContain('width:96px');
  });

  it('selectEmailTreatment — 미허용/미등재 = classic (fail-closed)', () => {
    expect(selectEmailTreatment('hero', 'split')).toBe('split');
    expect(selectEmailTreatment('hero', 'sticky')).toBe('classic');
    expect(selectEmailTreatment('footer', 'bar')).toBe('classic');
    expect(selectEmailTreatment('cta', undefined)).toBe('classic');
  });

  it('배경면 — dark 밴드 = #171717 래핑 / tint = 워시', () => {
    const dark = renderEmailSections([sec('text_card', { headline: '어두운 면', body: '본문' }, 0, { background: 'dark' })], {});
    expect(dark).toContain('background:#171717');
    const tint = renderEmailSections([sec('text_card', { headline: '틴트 면', body: '본문' }, 0, { background: 'tint' })], {});
    expect(tint).toContain('linear-gradient(0deg');
  });

  it('배경면 dark × 라이트 테마 = 밴드 안 텍스트가 밝은 토큰 (palette.background에 안 덮임 — Codex 3R 회귀)', () => {
    const html = renderEmailSections(
      [sec('text_card', { headline: '어두운 면', body: '본문' }, 0, { background: 'dark' })],
      { design: { palette: { primary: '#111827', background: '#ffffff' } } },
    );
    expect(html).toContain('background:#171717');
    // 밴드 안 본문/헤드라인은 다크 셸 반전 텍스트(#f4f4f5)여야 — 라이트 텍스트(#262626 계열)면 미가독
    expect(html).toContain('color:#f4f4f5');
  });
});

describe('디자인 3.0 — design 입력 정규화·서체', () => {
  it('normalizeEmailDesign — enum·hex·길이 화이트리스트만 통과', () => {
    const d = normalizeEmailDesign({
      theme: 'editorial',
      art_direction: { typeScale: 'editorial', accentMotif: 'evil-value', sectionDivider: 'hairline' },
      palette: { primary: '#112233', accent: 'javascript:alert(1)', background: '#0e1018' },
      preheader: 'x'.repeat(200),
      evil_key: 'drop',
    });
    expect(d?.theme).toBe('editorial');
    expect(d?.art_direction?.typeScale).toBe('editorial');
    expect(d?.art_direction?.accentMotif).toBeUndefined();
    expect(d?.art_direction?.sectionDivider).toBe('hairline');
    expect(d?.palette?.primary).toBe('#112233');
    expect(d?.palette?.accent).toBeUndefined();
    expect(d?.preheader?.length).toBe(90);
    expect((d as Record<string, unknown>)?.evil_key).toBeUndefined();
    expect(normalizeEmailDesign(null)).toBeNull();
    expect(normalizeEmailDesign({})).toBeNull();
    expect(normalizeEmailDesign('str')).toBeNull();
  });

  it('emailFontStack — 카탈로그 서체 = 이메일 폴백 스택 승격, 미매칭 = null', () => {
    expect(emailFontStack('"Noto Serif KR", serif')).toContain('Nanum Myeongjo');
    expect(emailFontStack('"Custom Font", sans-serif')).toBeNull();
  });

  it('emailGoogleFontsImport — 카탈로그 서체만 @import, 기본 스택 = 빈 문자열', () => {
    expect(emailGoogleFontsImport('"Noto Serif KR", serif')).toContain('fonts.googleapis.com');
    expect(emailGoogleFontsImport('"Pretendard Variable", Pretendard, sans-serif')).toBe('');
  });

  it('디스플레이 서체(design.font_display) = 헤드라인 font-family 반영 + style 큰따옴표 0', () => {
    const html = renderEmailSections(SAMPLE, { design: { font_display: '"Noto Serif KR", serif' } });
    expect(html).toContain("'Noto Serif KR'");
    expect(html).not.toContain('font-family:"');
    expect(html).toContain('@import');
  });
});
