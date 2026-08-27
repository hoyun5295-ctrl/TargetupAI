import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { renderDmBaseCss, renderDmDesign3Css } from './dm-tokens';
import { DM_MOTIF_TITLE_HOOK, DM_EVENT_CARD_SECTIONS } from './dm-property-contract';

/**
 * ★ 2026-07-20 남지현 재오픈("편집 화면 ≠ 출력 화면" — '설레는 휴가준비' 위 강조색 막대) 재발 방지 게이트.
 *
 * [근본] 아트디렉션 모티프(accentMotif=rule/bracket/index)는 제목 클래스 `.dm-text-h2`의
 *   ::before/::after로 걸린다. 발행 SSR(dm-section-renderer)은 섹션 제목에 이 클래스를 붙이는데
 *   편집 캔버스는 클래스 없는 div로 그려, 모티프 장식이 발행물에만 나타났다.
 *   앞선 게이트가 못 잡은 이유 — dm-editor-parity는 "편집기 컨트롤이 있는 속성"만, dm-variant-parity는
 *   "CSS 셀렉터 존재"만 본다. 이번 건은 양쪽 CSS가 멀쩡했고 깨진 건 그 셀렉터가 걸릴 마크업 클래스였다.
 *
 * [게이트] 섹션 클래스(dm-product-carousel 등) 기준으로 "발행이 제목에 dm-text-h2를 쓰는 섹션 집합"과
 *   "편집 캔버스가 쓰는 집합"이 같은지 기계 대조. 한쪽만 추가/삭제하면 pre-push에서 push가 막힌다.
 */

function readFirst(candidates: string[]): { src: string; used: string } {
  const used = candidates.find((p) => fs.existsSync(p)) || '';
  return { src: used ? fs.readFileSync(used, 'utf8') : '', used };
}

/**
 * dm-text-h2가 "클래스 속성"으로 실제 요소에 붙은 출현만 센다(Codex 지적 — 주석 `// dm-text-h2`나
 * 무관한 문자열은 제외). class="...dm-text-h2..." / className="..." / className={... dm-text-h2 ...} 3형태.
 */
const H2_CLASS_ATTR = /(?:class|className)\s*=\s*(?:"[^"]*\bdm-text-h2\b|'[^']*\bdm-text-h2\b|\{[^}]*\bdm-text-h2\b)/g;

/**
 * 소스를 선언 단위로 쪼개, 섹션 루트 클래스(dm-section dm-XXX)별 "제목에 dm-text-h2 클래스가 붙은 출현 수"를 센다.
 * 존재 여부(Set)만 보면 구도가 여럿인 섹션에서 한 구도만 빠진 부분 회귀를 놓친다(상품=classic/focus/list 3구도).
 * 출현 수로 세면 한 구도만 클래스를 잃어도 수가 어긋나 잡힌다.
 * [한계] "클래스를 제목이 아닌 이웃 요소로 이설"하는 우회는 출현 수가 유지돼 정적으로 완전 차단 불가 —
 *   DM_MOTIF_TITLE_HOOK 계약 등재 규칙 + 실측 3면 대조로 보완한다.
 */
/** 블록/JSX/라인 주석 제거 — 주석 안 `className="dm-text-h2"` 텍스트로 카운트를 보상하는 우회 차단(Codex 지적). */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function titleH2Counts(rawSrc: string, splitter: RegExp, classPattern: RegExp): Map<string, number> {
  const counts = new Map<string, number>();
  for (const chunk of stripComments(rawSrc).split(splitter)) {
    const hits = (chunk.match(H2_CLASS_ATTR) || []).length;
    if (hits === 0) continue;
    for (const cls of new Set([...chunk.matchAll(classPattern)].map((m) => m[1]))) {
      counts.set(cls, (counts.get(cls) || 0) + hits);
    }
  }
  return counts;
}

function toPlain(counts: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

describe('dm title parity — 발행 SSR ↔ 편집 캔버스 제목 클래스(dm-text-h2) 동기', () => {
  const ssr = readFirst([
    path.resolve(process.cwd(), 'src/utils/dm/dm-section-renderer.ts'),
    path.resolve(process.cwd(), 'packages/backend/src/utils/dm/dm-section-renderer.ts'),
  ]);
  const canvasDir = [
    path.resolve(process.cwd(), '../frontend/src/components/dm/canvas'),
    path.resolve(process.cwd(), 'packages/frontend/src/components/dm/canvas'),
  ].find((p) => fs.existsSync(p)) || '';
  // 파일별로 읽어 컴포넌트 단위로 쪼갠다 — 파일을 통으로 이어 붙이면 h2를 쓰는 컴포넌트가
  // 이웃 파일의 섹션 클래스까지 끌어와 거짓 양성이 된다.
  const canvasFiles = canvasDir
    ? fs.readdirSync(canvasDir).filter((f) => f.endsWith('.tsx')).map((f) => fs.readFileSync(path.join(canvasDir, f), 'utf8'))
    : [];

  // ★ 2026-07-21 Codex 지적 — splitter가 `function`/`export function`만 알면 컴포넌트를 `export const`·
  //   `export async function`으로 바꿔 이웃 청크에 병합시키는 우회가 생긴다. 선언 형태 전반을 청크 경계로 인식한다.
  const SSR_SPLIT = /\n(?:export\s+)?(?:async\s+)?function |\n(?:export\s+)?const \w+\s*=/;
  const CANVAS_SPLIT = /\nexport\s+(?:default\s+)?(?:async\s+)?function |\nexport\s+const \w+\s*[:=]/;

  // ★ 2026-08-26 제목을 공통 함수로 뺀 섹션 보정 — 상품 슬라이드는 classic·list·focus 세 구도가
  //   `productTitleHtml(p)` 하나를 쓴다(구도마다 따로 쓰면 한 구도만 클래스를 잃는 결함이 다시 난다).
  //   정적 카운터는 함수 호출을 못 따라가므로, 호출부를 그 함수가 실제로 내는 클래스 속성으로 치환해 센다.
  //   그 함수가 정말 dm-text-h2를 내는지는 dm-editor-parity의 행동 테스트가 밟는다.
  const TITLE_HELPER_EXPANSIONS: Array<[RegExp, string]> = [
    [/\$\{productTitleHtml\(p\)\}/g, '<div class="dm-text-h2"></div>'],
  ];
  const expandTitleHelpers = (s: string) =>
    TITLE_HELPER_EXPANSIONS.reduce((acc, [call, emits]) => acc.replace(call, emits), s);

  const ssrH2 = titleH2Counts(expandTitleHelpers(ssr.src), SSR_SPLIT, /class="dm-section (dm-[a-z-]+)"/g);
  const canvasH2 = new Map<string, number>();
  for (const src of canvasFiles) {
    for (const [cls, n] of titleH2Counts(src, CANVAS_SPLIT, /className="dm-section (dm-[a-z-]+)"/g)) {
      canvasH2.set(cls, (canvasH2.get(cls) || 0) + n);
    }
  }

  it('양쪽 소스를 찾는다', () => {
    expect(ssr.used, '발행 SSR 소스를 못 찾음 — process.cwd()=' + process.cwd()).toBeTruthy();
    expect(canvasDir, '편집 캔버스 디렉터리를 못 찾음 — process.cwd()=' + process.cwd()).toBeTruthy();
    expect(ssrH2.size).toBeGreaterThan(0);
  });

  it('발행이 dm-text-h2로 그리는 섹션은 편집 캔버스도 같은 클래스로 그린다', () => {
    const missing = [...ssrH2.keys()].filter((c) => !canvasH2.has(c));
    expect(
      missing,
      `편집 캔버스 제목에 dm-text-h2 누락: ${missing.join(', ')} — 모티프(rule/bracket/index) 장식이 편집 화면에만 사라진다`,
    ).toEqual([]);
  });

  it('편집 캔버스가 dm-text-h2로 그리는 섹션은 발행도 같은 클래스로 그린다', () => {
    const extra = [...canvasH2.keys()].filter((c) => !ssrH2.has(c));
    expect(
      extra,
      `발행 SSR 제목에 dm-text-h2 누락: ${extra.join(', ')} — 편집 화면에만 장식·큰 제목이 보인다`,
    ).toEqual([]);
  });

  it('구도별 제목 수까지 같다 (한 구도만 클래스를 잃는 부분 회귀 차단)', () => {
    expect(
      toPlain(canvasH2),
      '섹션별 dm-text-h2 제목 수가 발행과 다름 — 구도(classic/focus/list 등) 하나가 클래스를 잃었는지 확인',
    ).toEqual(toPlain(ssrH2));
  });

  // 계약표(dm-property-contract)가 SoT — 섹션을 늘리면 표에 등재해야 이 게이트가 함께 커진다.
  for (const cls of DM_MOTIF_TITLE_HOOK.sections) {
    it(`이번 신고 지점 포함 핵심 섹션이 양쪽 집합에 있다: ${cls}`, () => {
      expect(ssrH2.has(cls), `발행 SSR에 ${cls} 제목 h2 없음`).toBe(true);
      expect(canvasH2.has(cls), `편집 캔버스에 ${cls} 제목 h2 없음`).toBe(true);
    });
  }

  // ★ 2026-07-21 Codex 지적 — 계약표를 "완전 SoT"로 강제. 새 h2 제목 섹션을 SSR·캔버스에만 추가하고
  //   DM_MOTIF_TITLE_HOOK.sections 등재를 빠뜨리면, 모티프 장식 소비를 아무도 밟지 않는 사각이 다시 생긴다.
  it('발행이 dm-text-h2로 그리는 섹션 전량이 계약표에 등재돼 있다 (미등재 사각 0)', () => {
    const registered = new Set<string>(DM_MOTIF_TITLE_HOOK.sections);
    const unregistered = [...ssrH2.keys()].filter((c) => !registered.has(c));
    expect(
      unregistered,
      `계약표 미등재 h2 섹션: ${unregistered.join(', ')} — dm-property-contract.ts DM_MOTIF_TITLE_HOOK.sections에 추가 필요`,
    ).toEqual([]);
  });

  it('모티프 장식이 실제로 dm-text-h2에 걸리는 구조가 양쪽 CSS에 남아 있다', () => {
    const viewerCss = renderDmDesign3Css();
    expect(viewerCss).toContain('body[data-dm-motif="rule"] .dm-section .dm-text-h2::before');
    const builder = readFirst([
      path.resolve(process.cwd(), '../frontend/src/styles/dm-builder.css'),
      path.resolve(process.cwd(), 'packages/frontend/src/styles/dm-builder.css'),
    ]);
    expect(builder.used, '편집 CSS를 못 찾음').toBeTruthy();
    expect(builder.src).toContain('.dm-builder[data-dm-motif="rule"] .dm-section .dm-text-h2::before');
  });

  it('모티프 4종이 편집·발행 양쪽 CSS에 모두 있다 (index만 발행에 있던 누락 재발 차단)', () => {
    const viewerCss = renderDmDesign3Css();
    const builder = readFirst([
      path.resolve(process.cwd(), '../frontend/src/styles/dm-builder.css'),
      path.resolve(process.cwd(), 'packages/frontend/src/styles/dm-builder.css'),
    ]);
    const missing = DM_MOTIF_TITLE_HOOK.motifs.filter((m) => {
      const key = `[data-dm-motif="${m}"]`;
      return !viewerCss.includes(key) || !builder.src.includes(key);
    });
    expect(missing, `한쪽 CSS에만 있는 모티프: ${missing.join(', ')} — 편집 화면과 발행물이 갈린다`).toEqual([]);
  });

  it('제목 타이포 자간이 편집·발행 동일 (편집만 한 단계 좁던 드리프트 재발 차단)', () => {
    const builder = readFirst([
      path.resolve(process.cwd(), '../frontend/src/styles/dm-builder.css'),
      path.resolve(process.cwd(), 'packages/frontend/src/styles/dm-builder.css'),
    ]);
    const pick = (src: string, cls: string): string => {
      const line = src.split('\n').find((l) => l.trimStart().startsWith(`${cls} `) || l.trimStart().startsWith(`${cls}{`));
      const m = line ? line.match(/letter-spacing:\s*([^;]+);/) : null;
      return m ? m[1].trim() : 'none';
    };
    const viewerCss = renderDmBaseCss();
    for (const cls of ['.dm-text-hero', '.dm-text-h1', '.dm-text-h2']) {
      expect(pick(builder.src, cls), `${cls} 자간이 발행과 다름`).toBe(pick(viewerCss, cls));
    }
  });
});

/**
 * ★ 2026-07-21 섹션 셸 정합 게이트 — 발행이 dmEventCard(아이콘+오버라인 헤더의 큰 이벤트 카드)로 감싸는 섹션은
 *   편집 캔버스도 DmEventCard로 감싸야 한다. 옛 단순 카드(CARD_STYLE)면 셸 구조가 달라 편집≠발행(Codex 지적).
 */
describe('dm section shell parity — 발행 dmEventCard ↔ 편집 DmEventCard 섹션 동기', () => {
  const ssr = readFirst([
    path.resolve(process.cwd(), 'src/utils/dm/dm-section-renderer.ts'),
    path.resolve(process.cwd(), 'packages/backend/src/utils/dm/dm-section-renderer.ts'),
  ]);
  const canvasDir = [
    path.resolve(process.cwd(), '../frontend/src/components/dm/canvas'),
    path.resolve(process.cwd(), 'packages/frontend/src/components/dm/canvas'),
  ].find((p) => fs.existsSync(p)) || '';
  const canvasSrc = canvasDir
    ? fs.readdirSync(canvasDir).filter((f) => f.endsWith('.tsx')).map((f) => stripComments(fs.readFileSync(path.join(canvasDir, f), 'utf8'))).join('\n')
    : '';

  // 발행: `<div class="dm-section dm-X" ...>${dmEventCard(` (한 줄)
  const ssrEventCard = new Set(
    [...stripComments(ssr.src).matchAll(/class="dm-section (dm-[a-z-]+)"[^\n]*\$\{dmEventCard\(/g)].map((m) => m[1]),
  );
  // 편집: `className="dm-section dm-X">` 다음에 `<DmEventCard`
  const canvasEventCard = new Set(
    [...canvasSrc.matchAll(/className="dm-section (dm-[a-z-]+)">\s*<DmEventCard/g)].map((m) => m[1]),
  );

  it('발행이 dmEventCard로 감싸는 섹션 = 계약표(DM_EVENT_CARD_SECTIONS)', () => {
    expect([...ssrEventCard].sort()).toEqual([...DM_EVENT_CARD_SECTIONS].sort());
  });

  it('발행 dmEventCard 섹션 = 편집 DmEventCard 섹션 (셸 구조 동기)', () => {
    const onlySsr = [...ssrEventCard].filter((c) => !canvasEventCard.has(c));
    const onlyCanvas = [...canvasEventCard].filter((c) => !ssrEventCard.has(c));
    expect(onlySsr, `발행만 이벤트 카드(편집은 단순 카드): ${onlySsr.join(', ')} — 편집 캔버스도 DmEventCard로 감싸야 편집=발행`).toEqual([]);
    expect(onlyCanvas, `편집만 이벤트 카드(발행은 다른 셸): ${onlyCanvas.join(', ')}`).toEqual([]);
  });
});
