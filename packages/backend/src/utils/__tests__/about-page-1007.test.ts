/**
 * ★ 2026-10-07 공개 소개 페이지 대개편(`/about`) 계약 — 설계서 docs/2026-10-07-about-page-redesign-design.md §4 · §6
 *   소개 페이지는 정적 자산이던 시절 6주씩 낡았다. 이제 앱 기능 안내 창과 같은 원장을 읽으니,
 *   원장과 소개 페이지 구성이 어긋나거나 규약(줄표 · 모델명 · 미출시 · 동시 재생)을 어기면 여기서 막는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ABOUT_GROUPS, ABOUT_GUARDS, ABOUT_HERO, ABOUT_SLOT_IDS, ABOUT_CONTACT_PATH } from '../../../../frontend/src/constants/about-page';

const FE = resolve(__dirname, '../../../../frontend');
const read = (rel: string) => readFileSync(resolve(FE, rel), 'utf8').replace(/\r\n/g, '\n');
const INTROS = read('src/constants/plan-feature-intros.ts');
const PAGE = read('src/pages/AboutPage.tsx');
const CSS = read('src/pages/about-page.css');
const CONF = read('src/constants/about-page.ts');

/** 원장 한 항목(맨 위 `{` 블록) — 다른 테스트와 같은 나눔 */
function entry(id: string): string {
  const block = INTROS.split('\n  {\n').find((b) => b.includes(`\n    id: '${id}',`) || b.startsWith(`    id: '${id}',`));
  if (!block) throw new Error(`원장에 ${id} 없음`);
  return block.split('\n  },')[0];
}
const ALL_IDS = ABOUT_GROUPS.flatMap((g) => g.ids);

describe('구성 ↔ 원장', () => {
  it('묶음의 기능은 원장에 있고 예시 영상과 카드 한 줄(tagline)이 있다', () => {
    expect(ALL_IDS.length).toBe(11);
    expect(new Set(ALL_IDS).size).toBe(ALL_IDS.length);
    for (const id of ALL_IDS) {
      const e = entry(id);
      expect(e, id).toContain(`video: { src: '/videos/plan-feature/${id}.mp4', poster: '/videos/plan-feature/${id}.jpg' }`);
      expect(e, id).toMatch(/\n    tagline: '[^']{4,30}',/);
    }
  });

  it('미출시 기능(SNS)은 싣지 않는다', () => {
    expect(ALL_IDS).not.toContain('sns');
    expect(entry('sns')).not.toContain('tagline:');
  });

  it('첫 화면 · 빈칸 단어도 묶음 안의 기능이다', () => {
    for (const id of [ABOUT_HERO.center, ABOUT_HERO.left, ABOUT_HERO.right, ...ABOUT_SLOT_IDS]) expect(ALL_IDS).toContain(id);
  });

  it('「지키는 것」 제목은 그 기능 원장 안전장치 제목과 글자 그대로 같다', () => {
    expect(ABOUT_GUARDS).toHaveLength(4);
    for (const g of ABOUT_GUARDS) {
      const safe = entry(g.id).split('\n    safeguards: [')[1] || '';
      expect(safe, `${g.id} · ${g.title}`).toContain(`title: '${g.title}'`);
      expect(g.line.length).toBeLessThanOrEqual(30); // 짧은 한 줄(글 줄임 · Harold 1007)
    }
  });

  it('도입 상담 = 요금제 화면의 상담 창 주소', () => {
    expect(ABOUT_CONTACT_PATH).toBe('/pricing?openContactModal=true');
    expect(read('src/pages/PricingPage.tsx')).toContain("if (params.get('openContactModal') === 'true') {");
  });
});

describe('화면 규약', () => {
  it('기능 문장은 원장에서 읽는다(페이지에 기능 문장 0) · 뼈대 문장 유지', () => {
    expect(PAGE).toContain("import { PLAN_FEATURE_INTROS, PLAN_FEATURE_MIN_PLAN, type PlanFeatureIntro } from '../constants/plan-feature-intros';");
    expect(PAGE).toContain('<p>{f.tagline || f.summary}</p>');
    expect(PAGE).toContain('<b>발송 승인은 언제나 사람이 합니다.</b>');
  });

  it('★ 영상은 동시에 하나만 — 카드는 정지 그림 · 첫 화면은 가운데 한 편 · 상세 창 한 편', () => {
    expect((PAGE.match(/<video /g) || []).length).toBe(2);
    const cards = PAGE.slice(PAGE.indexOf('<div className="cards">'), PAGE.indexOf('</main>'));
    expect(cards).not.toContain('<video');
    expect(cards).toContain('<img src={f.video.poster} alt="" loading="lazy" />');
    expect(PAGE).toContain('<div className="phone p2"><img src={hero.left.video.poster} alt="" /></div>');
    expect(PAGE).toContain('<div className="phone p3"><img src={hero.right.video.poster} alt="" /></div>');
    // 상세 창을 열면 첫 화면 영상은 멈춘다 · 동작 줄이기 설정이면 재생하지 않는다
    expect(PAGE).toContain('heroVideo.current?.pause();');
    expect(PAGE).toContain("if (v) { v.currentTime = 0; if (!reduce) void v.play().catch(() => undefined); }");
  });

  it('상세 창 = Esc · Tab 가두기 · 포커스 복귀 · 배경 누름으로 닫지 않음 · native dialog 0', () => {
    expect(PAGE).toContain("if (e.key === 'Escape') { setOpenId(null); return; }");
    expect(PAGE).toContain('prevFocus?.focus?.();');
    expect(PAGE).toContain('<div className="sheet-bg" aria-hidden="true" />');
    expect(PAGE).not.toMatch(/sheet-bg"[^>]*onClick/);
    expect(PAGE).not.toMatch(/\b(alert|confirm|prompt)\(/);
  });

  it('줄표 · 모델명 0(페이지 · 구성 · 카드 한 줄) · 크레딧 숫자 0', () => {
    const taglines = (INTROS.match(/\n    tagline: '[^']*',/g) || []).join('\n');
    for (const [name, src] of [['page', PAGE.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')], ['conf', CONF.replace(/\/\*[\s\S]*?\*\//g, '')], ['tagline', taglines]] as const) {
      expect(src, name).not.toContain('—');
      expect(src, name).not.toMatch(/Opus|Sonnet|Haiku|GPT|Claude|Anthropic|claude-/);
    }
    expect(PAGE).not.toMatch(/\d+\s*크레딧/);
  });

  it('스타일은 .hj-about 안에서만(앱 다른 화면에 새지 않게)', () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter(Boolean);
    for (const r of rules) {
      const sel = r.split('{')[0].trim();
      if (!sel || sel.startsWith('@') || /^(from|to|\d+%)$/.test(sel)) continue;
      for (const one of sel.split(',')) expect(one.trim(), one).toMatch(/^\.hj-about\b/);
    }
  });
});

describe('주소', () => {
  it('/about = 로그인한 사람만 · 로그인 화면 /about 링크 0 · 옛 주소는 공개 소개 /intro 로 넘긴다', () => {
    const app = read('src/App.tsx');
    // ★ 2026-10-07 Harold: 소개는 로그인한 사람만 · 로그인 화면엔 소개 링크 없음
    expect(app).toContain('<Route path="/about" element={<PrivateRoute><AboutGate><AboutPage /></AboutGate></PrivateRoute>} />');
    expect(read('src/pages/LoginPage.tsx')).not.toContain('href="/about"');
    expect(read('src/pages/Dashboard.tsx')).not.toContain('href="/about"');   // ★ 2026-10-07 숨김 — 대시보드 링크도 제거
    for (const f of ['src/pages/LoginPage.tsx', 'src/pages/Dashboard.tsx']) expect(read(f)).not.toContain('about-ai-operator.html?v=');
    const old = read('public/about-ai-operator.html');
    // ★ 2026-10-07 Harold: 상세 소개는 hoyun 전용 · 바깥에 낸 옛 주소는 공개 소개(/intro)로
    expect(old).toContain('<meta http-equiv="refresh" content="0; url=/intro" />');
    expect(old).toContain("location.replace('/intro');");
  });
});
