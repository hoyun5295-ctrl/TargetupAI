/**
 * AI 존 표면 불변식 (★ 2026-09-30 AI 존 대개편 · docs/2026-09-30-ai-zone-redesign-design.md §3 · §5 · §7)
 *
 * 0821 오퍼레이터 표면 단계(OUI · 허브 보라 무접촉 · 메뉴 slate-950)를 대체한다(operator-surface-invariants 폐기).
 * 새 체계: 모든 AI 존 화면 = 같은 틀(components/zone · 남색 머리 띠 + 명령 카드 + 밝은 작업대).
 *   허브 = 목업 1안(남색 명령 띠 + 명령 카드) · 편집기 = EditShell(같은 남색 머리) · 공용 창 = 여는 쪽 문맥으로 밝은 짝.
 *
 * 이 파일이 잠그는 것(파일 지정 계약 + 값 대조 · 오탐 0인 규칙만)
 *   1. 존 화면 25개(★ 2026-10-04 플래너 행사 상세 추가)는 ZoneFrame(또는 편집기 머리 ZoneHeader)을 쓰고, 옛 머리·바닥(OUI_HEADER · OperatorAura · 짙은 로비 그라데이션)이 0회다.
 *   2. 허브는 남색 띠 + 밝은 문맥이고 옛 보라 지면이 0회다.
 *   3. 타일 12장은 아이콘·그라데이션이 서로 겹치지 않는다(D9) · 한 줄 입력 카드는 자동화 7메뉴 고정 · 허브 행 이름표가 12장을 한 번씩 덮는다.
 *   4. 값 계약: 작업대는 밝다 · 톤 문맥의 기본값은 'dark'(AI 존 밖 공용 창 회귀 0).
 *   5. 공용 창 8개는 밝은 짝과 원래 짙은 값을 함께 가진다(존 밖은 그대로 · 존 안은 밝게).
 *   6. 편집기 머리(EditShell · DM 블록 조립)는 남색 머리 값(MK_HEADER)을 쓰고 밝은 문맥을 내린다.
 *   7. 존 차트는 흰 격자·축(rgba(255,255,255,…))을 쓰지 않는다(흰 카드 위에서 사라진다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { OUI_PAGE } from '../../../../frontend/src/utils/operator-ui';
import { MK_PAGE, MK_HEADER } from '../../../../frontend/src/utils/make-ui';
import { ZONE_ROOTS } from './zone-scope';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const read = (rel: string) => readFileSync(resolve(FRONT, rel), 'utf8');
/** 주석을 뺀 코드(경위를 적은 주석은 대상이 아니다) */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');

const HUB = 'pages/AiOperatorPage.tsx';
const ZONE_PAGES = ZONE_ROOTS.filter((r) => r !== HUB);

/** 존 화면에 남아 있으면 안 되는 옛 머리·바닥 */
const FORBIDDEN = [
  /\bOUI_HEADER\b/,
  /\bOperatorAura\b/,
  /from-violet-900 via-fuchsia-900 to-violet-900/,
  /from-slate-950 via-slate-900 to-slate-950/,
  /className="min-h-screen bg-slate-950/,
  /className="min-h-screen bg-gradient/,
];

describe('AI 존 표면 불변식', () => {
  it('존 화면 25개 = 같은 틀(ZoneFrame · 편집기 머리 ZoneHeader) + 옛 머리·바닥 0회', () => {
    expect(ZONE_PAGES.length).toBe(25);
    const offenders: string[] = [];
    for (const rel of ZONE_PAGES) {
      const src = code(rel);
      if (!/from '\.\.\/components\/zone\/Zone(Frame|Header)'/.test(src)) offenders.push(`${rel} :: 존 틀 import 없음`);
      for (const re of FORBIDDEN) if (re.test(src)) offenders.push(`${rel} :: 옛 표면 ${re}`);
    }
    expect(offenders).toEqual([]);
  });

  it('허브 = 남색 명령 띠 + 밝은 문맥 · 옛 보라 지면 0회', () => {
    const src = code(HUB);
    expect(src).toContain('<SurfaceToneProvider tone="light">');
    expect(src).toMatch(/<section className="bg-slate-900 text-white" data-zone="hub-band">/);
    expect(src).toContain('data-zone="command"');
    expect(src).not.toMatch(/from-violet-900|via-fuchsia-900/);
    expect(src).not.toMatch(/\bOUI_/);
  });

  it('타일 12장 = 아이콘·그라데이션이 서로 겹치지 않는다(D9)', () => {
    const mod = read('constants/ai-operator-modules.ts');
    const block = mod.slice(mod.indexOf('export const SUB_MODULE_CARDS'), mod.indexOf('];', mod.indexOf('export const SUB_MODULE_CARDS')));
    const rows = [...block.matchAll(/\{\s*icon:\s*(\w+),\s*gradient:\s*'([^']+)'[\s\S]*?id:\s*'([a-z-]+)'/g)].map((m) => ({ icon: m[1], gradient: m[2], id: m[3] }));
    expect(rows.length).toBe(12);
    const dupIcon = rows.filter((r, i) => rows.findIndex((x) => x.icon === r.icon) !== i).map((r) => r.id);
    const dupGrad = rows.filter((r, i) => rows.findIndex((x) => x.gradient === r.gradient) !== i).map((r) => r.id);
    expect(dupIcon, '아이콘이 겹친다').toEqual([]);
    expect(dupGrad, '그라데이션이 겹친다').toEqual([]);
  });

  it('한 줄 입력 카드는 자동화 7메뉴 고정(Harold "한줄로 입력창은 자동화로 한정")', () => {
    const mod = read('constants/ai-operator-modules.ts');
    const block = mod.slice(mod.indexOf('export const SUB_MODULE_CARDS'), mod.indexOf('];', mod.indexOf('export const SUB_MODULE_CARDS')));
    const withLine = [...block.matchAll(/id:\s*'([a-z-]+)',\s*\n?\s*oneLine:/g)].map((m) => m[1]).sort();
    expect(withLine).toEqual(['auto-marketing', 'dm', 'email', 'inapp', 'journeys', 'make', 'sns']);
  });

  it('허브 행 이름표가 12장을 한 번씩 덮는다(빠지는 카드 0)', () => {
    const mod = read('constants/ai-operator-modules.ts');
    const rowsBlock = mod.slice(mod.indexOf('export const HUB_CARD_ROWS'), mod.indexOf('];', mod.indexOf('export const HUB_CARD_ROWS')));
    const ids = [...rowsBlock.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    const cardIds = [...mod.matchAll(/\bid:\s*'([a-z-]+)'/g)].map((m) => m[1]);
    expect(ids.slice().sort()).toEqual(cardIds.slice().sort());
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('값 계약: 작업대는 밝다 · 톤 문맥 기본값은 dark(존 밖 회귀 0)', () => {
    expect(OUI_PAGE).toContain('bg-slate-100');
    expect(OUI_PAGE).not.toContain('slate-950');
    expect(MK_PAGE).toContain('bg-slate-100');
    expect(MK_HEADER).toContain('bg-slate-900');
    const frame = read('components/zone/ZoneFrame.tsx');
    expect(frame).toContain('<SurfaceToneProvider tone="light">');
    expect(frame).toContain('bg-slate-100');
    expect(read('components/zone/surface-tone.tsx')).toMatch(/createContext<SurfaceTone>\('dark'\)/);
  });

  it.each([
    'components/ConfirmModal.tsx',
    'components/PlanFeatureModal.tsx',
    'components/TargetRecipientsModal.tsx',
    'components/AiRefineModal.tsx',
    'components/MmsUploadModal.tsx',
    'components/assets/AssetLibraryPickerModal.tsx',
    'components/journey/GradeOrderModal.tsx',
    'components/journey/JourneyModalShell.tsx',
  ])('공용 창 %s = 밝은 짝 + 원래 짙은 값 공존', (rel) => {
    const src = code(rel);
    expect(src).toContain('useLightSurface()');
    expect(src).toMatch(/light \?/);
    expect(src, '존 밖 짙은 값이 사라지면 대시보드 등 다른 화면이 바뀐다').toMatch(/bg-slate-9[05]0|text-white\/|bg-white\/|border-white\//);
  });

  it('편집기 머리 = 남색 머리 값 + 밝은 문맥', () => {
    for (const rel of ['components/make/EditShell.tsx', 'components/dm/build/DmBlockBuilder.tsx']) {
      const src = code(rel);
      expect(src, rel).toContain('className={MK_HEADER}');
      expect(src, rel).toContain('<SurfaceToneProvider tone="light">');
    }
  });

  // ★ Codex R1: 여정 행 카드(overflow-hidden) 안에서 ⋯ 메뉴가 잘려 발송 대상 확인·끝내기·삭제에 닿지 못했다 → 메뉴는 포털 + 버튼 좌표.
  it('⋯ 메뉴는 포털로 그린다(부모 overflow 에 잘리지 않는다)', () => {
    const src = code('components/zone/ZoneHeader.tsx');
    const menu = src.slice(src.indexOf('export function ZoneMoreMenu'));
    expect(menu).toContain('createPortal(');
    expect(menu).toMatch(/className="fixed z-\[1500\]/);
    expect(menu).not.toMatch(/className=\{`absolute/);
    // ★ Codex R2: 위아래 모두 모자라도 항목이 화면 밖으로 나가지 않는다(높이 제한 + 안쪽 스크롤) · 창 크기 변경은 무조건 닫는다(Window 는 Node 가 아니다)
    expect(menu).toContain('maxHeight');
    expect(menu).toMatch(/fixed z-\[1500\][^"]*overflow-y-auto/);
    expect(menu).toMatch(/const onResize = \(\) => setOpen\(false\);/);
    expect(menu).toMatch(/t instanceof Node/);
  });

  // ★ Codex R1: 이메일 [라이브러리에서 시작]이 접힌 "다른 방법" 패널 안의 창을 열려다 아무 일도 없었다.
  //   명령 카드·머리로 옮긴 입구(onClick/onAction 의 set 함수)가 여는 상태는 접힌 패널(OtherMethods) 밖에서 소비돼야 한다.
  // ★ 2026-10-01 보정 v3(Harold "입구가 칩으로 작게 있으니 안 보인다 · 같은 줄에 있어야 · 공간이 남는데 한쪽에 몰았다")
  it('보정 v3: 입구 = 시작 카드 · 접힌 입구 패널·외톨이 버튼 0 · 명령 카드 아랫줄 0', () => {
    // 옛 큰 입구 자리 = 시작 카드(ZoneFrame start). 접힌 "다른 방법" 패널(OtherMethods)은 없앴다(창을 여는 입구가 접힌 패널 안에 숨지 않는다).
    for (const rel of ['pages/ContinuousOperatorPage.tsx', 'pages/DmBuilderPage.tsx', 'pages/EmailCampaignsPage.tsx', 'pages/JourneysPage.tsx', 'pages/JourneyMapPage.tsx', 'pages/InAppMessagesPage.tsx', 'pages/QuickCampaignPage.tsx']) {
      expect(code(rel), rel).toMatch(/\bstart=\{/);
    }
    for (const rel of ZONE_ROOTS) {
      expect(code(rel), rel).not.toMatch(/<OtherMethods\b|\baux=\{/);
    }
    expect(code('components/make/HomeParts.tsx')).not.toMatch(/export function OtherMethods\b/);
    // 명령 카드 = 한 줄 입력 또는 [앞머리·숫자·설명 … 보조 ≤2 · 1차]. 아랫줄(stats·checks·stamp) 없음 — 숫자는 머리 오른쪽, 기준 시각은 머리 아래.
    expect(code('components/zone/ZoneCommand.tsx')).not.toMatch(/\b(stats|checks|stamp|alts|more)\?:/);
  });

  it('보정 v3: 좌우 끝 한 줄 — 머리 · 명령 카드 · 확정 바가 화면 폭(wrap)을 같이 쓴다', () => {
    const f = code('components/zone/ZoneFrame.tsx');
    expect(f).toMatch(/<ZoneHeader \{\.\.\.head\} paint=\{false\} full=\{width === 'full'\} \/>/);
    // 1240 상자 선언은 wrap 한 곳뿐(명령 카드·확정 바가 따로 1240 을 박으면 전폭 화면에서 끝이 어긋난다)
    expect((f.match(/max-w-\[1240px\]/g) || []).length).toBe(1);
    expect(f).toMatch(/\$\{wrap\} -mt-7 relative z-10/);
    expect(f).toMatch(/\$\{wrap\} min-h-16 py-2\.5/);
  });

  it('보정 v3: 목록 걸러보기 = 한 덩어리 전환 버튼(ZoneSegmented) · 숫자 띠 7~8칸 = 4칸 2줄(금액 잘림 0)', () => {
    for (const rel of ['components/make/HomeParts.tsx', 'pages/JourneysPage.tsx', 'pages/JourneyMapPage.tsx', 'pages/ContinuousOperatorPage.tsx', 'pages/InAppMessagesPage.tsx', 'pages/PerformancePage.tsx']) {
      expect(code(rel), rel).toMatch(/<ZoneSegmented\b/);
    }
    const strip = code('components/zone/ZoneStatStrip.tsx');
    expect(strip).toMatch(/7: 'grid-cols-2 md:grid-cols-4', 8: 'grid-cols-2 md:grid-cols-4'/);
    expect(strip).not.toMatch(/lg:grid-cols-[78]\b/);
  });

  it('존 차트는 흰 격자·축을 쓰지 않는다', () => {
    for (const rel of ['pages/PerformancePage.tsx', 'pages/JourneyStatsPage.tsx', 'pages/PredictiveDashboardPage.tsx', 'components/cdp/CdpAnalyticsPanels.tsx', 'components/AiUsage/CostForecastChart.tsx']) {
      expect(code(rel), rel).not.toMatch(/stroke="rgba\(255,255,255/);
    }
  });
});
