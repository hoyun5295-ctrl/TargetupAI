/**
 * AI 존 범위·호출 추출 헬퍼 — **테스트 전용**(vitest include는 `*.test.ts`라 이 파일은 수집되지 않는다).
 *
 * ★2026-09-30 AI 존 대개편(docs/2026-09-30-ai-zone-redesign-design.md §6-1).
 * 개편은 화면의 틀·색을 바꾸고 기능은 1비트도 바꾸지 않는다. 그 약속을 사람 눈이 아니라 기계가 지키게
 * 개편 직전 소스에서 "AI 존이 부르는 서버 경로(횟수 포함)와 이동 목적지"를 뽑아 기준표로 고정한다.
 *
 * 범위 = 뒤로가기 뿌리가 `/ai-operator`인 루트 페이지 25 → 상대 import 전이 폐포(pages·components).
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve, dirname, normalize, relative } from 'path';

export const FRONT_SRC = resolve(__dirname, '../../../../frontend/src');

/** 루트 페이지(개편 전후 같은 목록 · 새 AI 존 화면이 생기면 여기에 더한다) */
export const ZONE_ROOTS = [
  'pages/AiOperatorPage.tsx',
  'pages/AiMemoryPage.tsx',
  'pages/AiUsagePage.tsx',
  'pages/CdpSettingsPage.tsx',
  'pages/ContinuousOperatorPage.tsx',
  'pages/EmailCampaignsPage.tsx',
  'pages/ImageStudioPage.tsx',
  'pages/InAppMessagesPage.tsx',
  'pages/JourneyDetailPage.tsx',
  'pages/JourneyMapPage.tsx',
  'pages/JourneysPage.tsx',
  'pages/JourneyStatsPage.tsx',
  'pages/MarketingCalendarPage.tsx',
  'pages/MarketingPlannerPage.tsx',
  'pages/PerformancePage.tsx',
  'pages/PlannerBriefPage.tsx',
  'pages/PlannerEventDetailPage.tsx', // ★ 2026-10-04 플래너 보강 · 행사 상세(로그인판 확인 화면)
  'pages/PredictiveDashboardPage.tsx',
  'pages/QuickCampaignLegacyPage.tsx',
  'pages/QuickCampaignPage.tsx',
  'pages/QuickCampaignResultPage.tsx',
  'pages/SnsPage.tsx',
  'pages/DmBuilderPage.tsx',
  'pages/SegmentsPage.tsx',
  'pages/AiBatchesPage.tsx',
  'pages/AiExplainPage.tsx',
];

function walk(dir: string, out: string[]): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && /\.tsx?$/.test(e.name)) out.push(full);
  }
  return out;
}

let fileCache: Map<string, string> | null = null;
function files(): Map<string, string> {
  if (fileCache) return fileCache;
  fileCache = new Map();
  for (const f of walk(FRONT_SRC, [])) fileCache.set(relative(FRONT_SRC, f).split('\\').join('/'), readFileSync(f, 'utf8'));
  return fileCache;
}

function resolveImport(fromRel: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = normalize(join(dirname(fromRel), spec)).split('\\').join('/');
  for (const c of [`${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`, base]) {
    if (files().has(c)) return c;
  }
  return null;
}

/** 루트에서 상대 import로 닿는 pages·components 파일 전부(루트 포함) */
export function zoneFiles(): string[] {
  const seen = new Set<string>();
  const stack = ZONE_ROOTS.filter((r) => existsSync(join(FRONT_SRC, r)));
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = files().get(f) || '';
    for (const m of src.matchAll(/(?:import|export)[^'"`]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const dep = resolveImport(f, m[1] || m[2]);
      if (dep && (dep.startsWith('pages/') || dep.startsWith('components/'))) stack.push(dep);
    }
  }
  return [...seen].sort();
}

/** 주석 제거(블록·줄). 문자열 안 `//`(URL)는 건드리지 않도록 줄 주석은 줄 맨 앞 공백 뒤만 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
}

/** 문자열 안의 `${…}`를 `:p`로, 쿼리스트링을 떼어 경로 모양만 남긴다 */
function shape(raw: string): string {
  return raw.replace(/\$\{[^}]*\}/g, ':p').replace(/\?.*$/, '').replace(/\/+$/, '');
}

export interface ZoneCalls {
  /** 서버 경로 → AI 존 전체 등장 횟수 */
  api: Record<string, number>;
  /** 이동 목적지(navigate · goBackOr · Link to · location.href) 집합 */
  nav: string[];
}

export function extractZoneCalls(list = zoneFiles()): ZoneCalls {
  const api: Record<string, number> = {};
  const nav = new Set<string>();
  for (const f of list) {
    const src = stripComments(files().get(f) || '');
    for (const m of src.matchAll(/[`'"](\/api\/[^`'"\s]*)[`'"]/g)) {
      const p = shape(m[1]);
      api[p] = (api[p] || 0) + 1;
    }
    for (const m of src.matchAll(/(?:navigate|goBackOr\(\s*navigate\s*,)\s*\(?\s*[`'"](\/[^`'"]*)[`'"]/g)) nav.add(shape(m[1]));
    for (const m of src.matchAll(/\bto=\{?\s*[`'"](\/[^`'"]*)[`'"]/g)) nav.add(shape(m[1]));
    for (const m of src.matchAll(/location\.href\s*=\s*[`'"](\/[^`'"]*)[`'"]/g)) nav.add(shape(m[1]));
    // 탭 목록처럼 객체로 적은 목적지(`to: '/x'`)도 입구다(★ 2026-09-30 존 탭)
    for (const m of src.matchAll(/\bto:\s*[`'"](\/[^`'"]*)[`'"]/g)) nav.add(shape(m[1]));
  }
  return { api, nav: [...nav].sort() };
}
