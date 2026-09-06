/**
 * sales-outreach-s8.test.ts — 2026-09-06(3) Harold 스토리라인 정정
 *  브랜드 팔레트 선택(렌더 워커 계산 스타일 → 주색 · 못 뽑으면 null · 기본 보라 0) · 자리표시자 노출 0 · 증거 카드 중복 제거 ·
 *  제안 메일 스토리라인(1 자동으로 이만큼 + DM 캡처 · 2 자사몰 연동 대비 + 실샘플 · 3 5분 투자 3칸) · 실샘플 선택 · 포스터 배경 힌트 · 톤 규칙.
 * DB·AI·네트워크 0.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), pool: { connect: vi.fn() }, default: { connect: vi.fn(), query: vi.fn() } }));
vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn(async () => '') }));

import { pickBrandColorFromPalette } from '../sales-outreach-render';
import { OUTREACH_NEUTRAL_PRIMARY } from '../sales-outreach-look';
import { insertProofCard, buildProposalEmailSections, buildOutreachPlainText, pickShowcaseExampleUrl, posterStyleHint, dropPlaceholderSentences } from '../sales-outreach-produce';
import { getActiveStyleGuide } from '../sales-outreach-style';
import { OUTREACH_GENERATION_RULES } from '../sales-outreach-exemplars';
import { BENEFIT_PLACEHOLDER } from '../copy-benefit-detector';
import type { Section } from '../dm/dm-section-registry';

const read = (rel: string) => readFileSync(resolve(__dirname, '..', '..', rel), 'utf-8');
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const sec = (type: string, props: Record<string, unknown>, order = 0): Section => ({ id: `s-${type}-${order}`, type, order, visible: true, props } as unknown as Section);

describe('브랜드 팔레트 → 주색', () => {
  it('채도 있는 색 중 가중치 최대 · 흰·검·회색은 제외 · 비면 null(호출부가 무채색 톤 · 기본 보라 0)', () => {
    expect(pickBrandColorFromPalette([
      { hex: '#ffffff', weight: 900, sources: ['header'] },
      { hex: '#111111', weight: 500, sources: ['button'] },
      { hex: '#2f7d5b', weight: 120, sources: ['button', 'cssvar'] },
      { hex: '#e5e7eb', weight: 400, sources: ['nav'] },
      { hex: '#c9a34e', weight: 80, sources: ['a'] },
    ])).toBe('#2f7d5b');
    expect(pickBrandColorFromPalette([{ hex: '#ffffff', weight: 100, sources: [] }, { hex: '#000000', weight: 100, sources: [] }])).toBeNull();
    expect(pickBrandColorFromPalette([])).toBeNull();
    expect(pickBrandColorFromPalette(null)).toBeNull();
    expect(pickBrandColorFromPalette([{ hex: 'not-a-color', weight: 10, sources: [] }])).toBeNull();
    expect(OUTREACH_NEUTRAL_PRIMARY).toMatch(/^#[0-9a-f]{6}$/);
    expect(OUTREACH_NEUTRAL_PRIMARY).not.toBe('#4f46e5');
  });
  it('워커는 팔레트·뷰포트 캡처를 돌려주고 클라이언트가 그대로 매핑한다 · 페이지 쪽 코드에 백슬래시 정규식 0(템플릿 리터럴)', () => {
    const worker = code('workers/outreach-render-worker.ts');
    expect(worker).toContain('screenshotViewportBase64');
    expect(worker).toContain("palette, screenshotViewportBase64 };");
    const start = worker.indexOf('const toHex = (c) =>');
    const end = worker.indexOf('.map((e) => ({ hex: e.hex', start);
    expect(start).toBeGreaterThan(-1); expect(end).toBeGreaterThan(start);
    expect(worker.slice(start, end)).not.toContain('\\');
    const client = code('utils/sales-outreach-render.ts');
    expect(client).toContain("palette: Array.isArray(parsed.palette) ? parsed.palette : []");
    expect(client).toContain('screenshotViewport: !!opts.screenshotViewport');
    const jobs = code('utils/sales-outreach-jobs.ts');
    // ★ v3 팔레트 원천 = rendered 팔레트 → 없으면 paletteShot(별 변수 · rendered 대입 0)
    expect(jobs).toContain('pickBrandColorFromPalette(paletteSrc)');
    expect(jobs).toContain('rendered.palette : (paletteShot?.palette || [])');
    // ★ v3 4값(못 뽑으면 'neutral' → BRAND_COLOR_FALLBACK 경고)
    expect(jobs).toContain("colorSource: (fromPalette ? 'render' : brandColorRes.source || 'neutral') as BrandColorSource4");
    const produce = code('utils/sales-outreach-produce.ts');
    expect(produce).toContain('accessiblePrimaryOf(input.brandColor) || OUTREACH_NEUTRAL_PRIMARY');
  });
});

describe('증거 카드 중복 제거 · 포스터 배경 힌트 · 톤 규칙', () => {
  it('모델이 리뷰 수·평점으로 만든 text_card 는 증거 카드가 서면 빠진다 · 숫자 없는 카드는 남는다', () => {
    const base = [
      sec('hero', {}, 0),
      sec('product_carousel', { products: [{ name: 'a' }] }, 1),
      sec('text_card', { tag: 'REVIEW', headline: '455,093개의 리얼 리뷰', body: '많은 고객이 남긴 후기' }, 2),
      sec('text_card', { tag: 'BRAND', headline: '착한 성분 식물 유래 화장품', body: '전제품 더마테스트 통과' }, 3),
      sec('footer', {}, 4),
    ];
    const r = insertProofCard(base, { reviewTotal: 455093, rating: 4.9, rankLabel: null, collectedAt: '2026-09-06T05:00:00Z' }, '아이소이');
    const heads = r.sections.map((s: any) => String(s.props?.headline || s.type));
    expect(heads).toEqual(['hero', 'product_carousel', '리뷰 455,093건 · 평점 4.9', '착한 성분 식물 유래 화장품', 'footer']);
    expect(r.sections.map((s) => s.order)).toEqual([0, 1, 2, 3, 4]);
  });
  it('포스터 배경 힌트 = 브랜드 색 톤 + 깨끗한 스튜디오 + 상단 문구 자리 · 색이 없으면 중립 배경', () => {
    expect(posterStyleHint('#2f7d5b')).toContain('brand accent color #2f7d5b');
    expect(posterStyleHint('#2f7d5b')).toContain('top 30% calm');
    expect(posterStyleHint(null)).toContain('neutral soft backdrop');
    expect(OUTREACH_GENERATION_RULES).toContain('범용 문구를 쓰지 마라');
    expect(OUTREACH_GENERATION_RULES).toContain('그 수치로 text_card 를 만들지 마라');
  });
  it('실샘플 선택 — 업종 매칭 템플릿 중 파일이 있는 첫 장 · 하나도 없으면 null · 공개 라우트 경로', () => {
    const has = new Set<string>();
    expect(pickShowcaseExampleUrl('beauty', (id) => has.has(id))).toBeNull();
    const url = pickShowcaseExampleUrl('beauty', () => true);
    expect(url).toMatch(/\/api\/image-studio\/template-sample\/[A-Za-z0-9_-]+$/);
  });
});

describe('제안 메일 — 자리표시자 노출 0 · 스토리라인 순서', () => {
  const guide = getActiveStyleGuide();
  const P = BENEFIT_PLACEHOLDER;
  const base = {
    companyName: '아이소이', industry: 'beauty', selectedEvent: { quote: '티퍼런스 기프트 컬렉션 최대 20% OFF' } as any,
    copyBody: `(광고) 아이소이에서 티퍼런스 기프트 컬렉션 최대 ${P} OFF 행사를 진행 중입니다. 기프트 컬렉션은 {{DM_LINK}} 에서 확인하세요.`,
    posterUrl: 'https://hanjul.ai/p.jpg', dmUrl: 'https://hlj.kr/x', previewUrl: 'https://hanjul.ai/api/outreach/v/abc', unsubscribeNotice: '수신거부 안내',
    brandSections: [] as Section[], subject: '제목', intro: `아이소이 공식몰에서 최대 ${P} OFF 행사를 보았습니다. 티퍼런스 컬렉션이 인상적이었습니다.`,
    now: new Date('2026-09-06T03:00:00Z'), dmCaptureUrl: 'https://hanjul.ai/api/cdp/inapp/image/c/dm.jpg', showcaseImageUrl: 'https://hanjul.ai/api/image-studio/template-sample/t1',
  };
  it('자리표시자가 든 문장은 서두·문안에서 빠진다 · 인용(홈페이지 원문)은 남는다 · html·평문 어디에도 자리표시자 0', () => {
    const s = buildProposalEmailSections(guide, base) as any[];
    const all = JSON.stringify(s);
    expect(all).not.toContain(P);
    const lead = s[2];
    expect(lead.props.body).toContain('티퍼런스 컬렉션이 인상적이었습니다.');
    expect(lead.props.body).toContain('홈페이지에서 본 내용');
    const copy = s.find((x) => x.props?.tag === guide.emailCopy.showcase.tag);
    expect(copy.props.body).toContain('기프트 컬렉션은 https://hlj.kr/x 에서 확인하세요.');
    expect(copy.props.body).not.toContain('OFF 행사');
    expect(buildOutreachPlainText(guide, base)).not.toContain(P);
    expect(dropPlaceholderSentences(`전부 ${P} 뿐`)).toBe('');
  });
  it('문안이 자리표시자만 남으면 문안 블록을 생략한다 · 서두가 비면 기본 서두', () => {
    const s = buildProposalEmailSections(guide, { ...base, copyBody: `최대 ${P} OFF`, intro: `${P}` }) as any[];
    expect(s.some((x) => x.props?.tag === guide.emailCopy.showcase.tag)).toBe(false);
    expect(s[2].props.body).toContain(guide.emailCopy.introDefault('아이소이'));
  });
  it('★ v3 순서 = header · hero · 서두 · [1 자동] · DM 캡처 text_card(image left) · 포스터 text_card · 문안 · [2 대비] · 실샘플 text_card · [3 5분] · 기능 3칸 · CTA · 서비스(회신 문장) · footer · gallery 0', () => {
    const s = buildProposalEmailSections(guide, base) as any[];
    const tags = s.map((x) => x.props?.tag || x.props?.title || x.type);
    expect(tags.slice(0, 5)).toEqual(['header', 'hero', guide.emailCopy.lead.tag, guide.emailCopy.story.auto.tag, guide.emailCopy.story.capture.title]);
    // 캡처는 gallery 가 아니라 이미지 위 text_card(세로 캡처 = image_position left · 캡처 위 글자 0)
    const cap = s[4];
    expect(cap.type).toBe('text_card');
    expect(cap.props.image_url).toBe(base.dmCaptureUrl);
    expect(cap.props.image_position).toBe('left');
    expect(cap.props.headline).toBe(guide.emailCopy.story.capture.dmHeadline);
    const poster = s[5];
    expect(poster.type).toBe('text_card');
    expect(poster.props.image_url).toBe(base.posterUrl);
    expect(s.filter((x) => x.type === 'gallery').length).toBe(0);
    const compareIdx = tags.indexOf(guide.emailCopy.story.compare.tag);
    expect(s[compareIdx + 1].type).toBe('text_card');
    expect(s[compareIdx + 1].props.headline).toBe(guide.emailCopy.story.compare.imageTitle);
    expect(s[compareIdx + 1].props.image_url).toBe(base.showcaseImageUrl);
    expect(tags[compareIdx + 2]).toBe(guide.emailCopy.features.tag);
    expect(tags.slice(compareIdx + 3, compareIdx + 6)).toEqual(['이미지 스튜디오', '문안과 여정', '자동마케팅']);
    expect(tags[compareIdx + 6]).toBe('cta');
    // 서비스 카드 마지막 줄 = 회신 유도 문장(기본) · 편집분이 있으면 그것(60자)
    const service = s[compareIdx + 7];
    expect(service.props.headline).toBe(guide.emailCopy.service.headline);
    expect(String(service.props.body).endsWith(guide.emailCopy.reply)).toBe(true);
    const edited = buildProposalEmailSections(guide, { ...base, replyLine: '  이미지 2장만  회신해 주세요  ' }) as any[];
    expect(String(edited[compareIdx + 7].props.body).endsWith('이미지 2장만 회신해 주세요')).toBe(true);
    expect(buildOutreachPlainText(guide, base)).toContain(guide.emailCopy.reply);
    expect(tags[tags.length - 1]).toBe('footer');
    expect(s.every((x, i) => x.order === i)).toBe(true);
    // 홈 캡처가 있으면 대조 왼쪽 카드가 DM 캡처 앞에 선다 · 없으면 생략
    const withHome = buildProposalEmailSections(guide, { ...base, homeCaptureUrl: 'https://hanjul.ai/api/cdp/inapp/image/c/home.jpg' }) as any[];
    expect(withHome[4].props.image_url).toBe('https://hanjul.ai/api/cdp/inapp/image/c/home.jpg');
    expect(withHome[4].props.headline).toBe(guide.emailCopy.story.capture.homeHeadline('아이소이'));
    expect(withHome[5].props.image_url).toBe(base.dmCaptureUrl);
    // 캡처·실샘플이 없으면 그 카드만 빠지고 나머지는 그대로
    const bare = buildProposalEmailSections(guide, { ...base, dmCaptureUrl: null, showcaseImageUrl: null }) as any[];
    expect(bare.filter((x) => x.type === 'gallery').length).toBe(0);
    expect(bare.some((x) => x.props?.image_url === base.dmCaptureUrl)).toBe(false);
    expect(bare.some((x) => x.props?.tag === guide.emailCopy.story.compare.tag)).toBe(true);
  });
  it('문구 사실 검사 — 모델명 0 · 줄표 0 · 업체명 직후 조사 0', () => {
    const c = guide.emailCopy;
    const texts = [c.hero.headline, c.hero.subCopy, c.story.auto.body('인비토'), c.story.compare.body('인비토'), c.features.headline('인비토'), ...c.features.items.map((i) => i.body('인비토'))];
    for (const t of texts) {
      expect(t).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|—/);
      const i = t.indexOf('인비토');
      if (i >= 0) expect(['을', '를', '이', '가', '은', '는', '과', '와']).not.toContain(t[i + 3]);
    }
  });
});

describe('소스 계약 — DM 캡처 저장·승계 · 메일 입력 배선', () => {
  it('producing_dm 은 캡처 URL 을 asset 에 남기고 숨김 재실행은 승계 · producing_email 은 캡처·실샘플을 조립에 넘긴다', () => {
    const jobs = code('utils/sales-outreach-jobs.ts');
    // ★ v3 발행 참조(pub)의 뷰어 URL 을 캡처한다(조립/발행 분리)
    expect(jobs).toContain('captureAndScoreDm(pub.viewerUrl, { companyId: ctx.companyId })');
    expect(jobs).toContain("const captureUrl = carry ? (carry.captureUrl || null) : (captured?.captureUrl || null);");
    expect(jobs).toContain('dmCaptureUrl: dmAsset?.captureUrl ? String(dmAsset.captureUrl) : null,');
    expect(jobs).toContain('showcaseImageUrl: pickShowcaseExampleUrl(job.industry_category),');
    const produce = code('utils/sales-outreach-produce.ts');
    expect(produce).toContain("screenshot: true, screenshotViewport: true, viewportWidth: 375");
    expect(produce).toContain('const moved = moveTempToPermanent(companyId, tempId);');
  });
});
