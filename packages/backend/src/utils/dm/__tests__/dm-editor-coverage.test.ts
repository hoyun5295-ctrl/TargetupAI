/**
 * dm-editor-coverage.test.ts — DM 편집기 속성 **전수** 커버리지 (★ 2026-10-14 · 임은지 접수 1014 ①② 뿌리 R1)
 *
 * 옛 구조: `dm-property-contract.ts`의 표에 **손으로 등재한 것만** 파리티 테스트가 지켰다 — 편집기 속성 183 중 150이 표 밖이었고,
 * 접수가 올 때마다 그 한 속성을 표에 올리는 식이라 "안 올린 나머지"는 아무도 밟지 않았다(0722 이메일수집 완료 문구 수정이
 * 설문엔 안 퍼진 뿌리). 이메일은 0916 `email-editor-coverage.test.ts`가 기계 파생으로 뒤집었고, 이 파일이 DM에 같은 것을 둔다.
 *
 * 판정 = **행동 탐침**: 편집기 소스에서 뽑은 속성(구문 트리 · `editor-keys.ts`)마다 값을 바꿔 렌더해 기본 출력과 달라야 통과.
 *   · 발행 렌더(ssr): 섹션이 가진 **구도 전부**로 돌린다(0904 CTA ghost — classic만 읽던 결함 재발 차단).
 *     문자열 탐침은 태그·data-*를 걷어낸 가시 텍스트에 있어야 하고, data-*로만 나가도 뷰어가 그 속성 이름을 읽으면 통과(kind=viewer 자동).
 *   · 편집 캔버스(canvas): React 렌더 없이 컴포넌트 함수 본문의 이름 대조(근사 — 원장에 명기).
 *   · 이메일(email): 이메일이 그리는 12타입만, 같은 탐침.
 * 탐침이 출력을 못 바꾸는 속성은 `DM_PROP_EXEMPT`에 **사유와 함께** 있거나 `DM_PROP_UNREVIEWED`(줄기만 하는 래칫)에 이름이 있어야 한다.
 * 이름이 "서버 규칙"처럼 보이는 속성(one_*·required·quantity·expires*·probability·*_count)은 서버가 실제로 읽어야 통과(reader 본문 실재).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SECTION_TYPES, SECTION_DEFAULTS, PARTICIPATION_TYPES, type Section } from '../dm-section-registry';
import { renderSection } from '../dm-section-renderer';
import { TREATMENTS } from '../dm-art-direction';
import {
  DM_PROP_EXEMPT, DM_SERVER_RULE_NAME, DM_SERVER_RULES_PENDING, DM_SERVER_RULES_PENDING_MAX,
  DM_PROP_UNREVIEWED, DM_PROP_UNREVIEWED_MAX, DM_PROBE_CONTEXT,
} from '../dm-property-contract';
import { renderEmailSections } from '../../email/email-section-renderer';
import { EMAIL_BLOCK_WHITELIST, EMAIL_TREATMENTS } from '../../email/email-blocks';
import { EMAIL_PROP_EXEMPT } from '../../email/email-property-contract';
import { extractEditorKeys, countEditorKeys, type EditorKeys } from './editor-keys';
import {
  SECTION_DEFAULTS as FE_SECTION_DEFAULTS, PARTICIPATION_TYPES as FE_PARTICIPATION_TYPES,
} from '../../../../../frontend/src/utils/dm-section-defaults';

const FE_ROOT = resolve(__dirname, '../../../../../frontend/src');
const EDITOR_DIR = resolve(FE_ROOT, 'components/dm/panels/editors');
const CANVAS_DIR = resolve(FE_ROOT, 'components/dm/canvas');
const BE_DM = resolve(__dirname, '..');
const read = (p: string) => readFileSync(p, 'utf8');

// ── 편집기 파일 = SectionPropsEditor 분기에서 파생(손 표 0) ──
const propsEditorSrc = read(resolve(FE_ROOT, 'components/dm/panels/SectionPropsEditor.tsx'));
const EDITOR_FILE: Record<string, string> = {};
for (const m of propsEditorSrc.matchAll(/case '(\w+)':\s*return <(\w+Editor)\b/g)) EDITOR_FILE[m[1]] = `${m[2]}.tsx`;

// ── 캔버스 컴포넌트 = canvas/SectionRenderer 분기에서 파생 · 본문 = 그 함수만 ──
const canvasRendererSrc = read(resolve(CANVAS_DIR, 'SectionRenderer.tsx'));
const CANVAS_COMPONENT: Record<string, string> = {};
for (const m of canvasRendererSrc.matchAll(/case '(\w+)':\s*return <(\w+Section)\b/g)) CANVAS_COMPONENT[m[1]] = m[2];
const canvasSources = readdirSync(CANVAS_DIR).filter((f) => f.endsWith('.tsx')).map((f) => read(resolve(CANVAS_DIR, f)));
function canvasBody(component: string): string {
  for (const src of canvasSources) {
    const i = src.search(new RegExp(`(?:^|\\n)(?:export (?:default )?)?function ${component}\\(`));
    if (i < 0) continue;
    const rest = src.slice(i + 1);
    const next = rest.search(/\n(?:export (?:default )?)?(?:function |const \w+ = \()/);
    return next < 0 ? rest : rest.slice(0, next);
  }
  return '';
}

// ── 뷰어가 읽는 data-* 이름(kind=viewer 자동 판정의 근거) ──
const viewerSrc = read(resolve(BE_DM, 'dm-viewer.ts'));
const VIEWER_ATTRS = new Set([...viewerSrc.matchAll(/data-[a-z0-9-]+/g)].map((m) => m[0]));

// ── 서버가 읽는 함수 본문(kind=server reader 실재 검사) ──
const serverSrc = ['dm-interaction.ts', 'dm-interaction-core.ts', 'dm-publish-core.ts'].map((f) => read(resolve(BE_DM, f))).join('\n');
function serverFnBody(fn: string): string {
  const i = serverSrc.search(new RegExp(`(?:^|\\n)(?:export )?(?:async )?function ${fn}\\(`));
  if (i < 0) return '';
  const rest = serverSrc.slice(i + 1);
  const next = rest.search(/\n(?:export )?(?:async )?function /);
  return next < 0 ? rest : rest.slice(0, next);
}

// ── 편집기 키(공통 칸 포함) ──
const KEYS: Record<string, EditorKeys> = {};
for (const type of SECTION_TYPES) {
  const file = EDITOR_FILE[type];
  if (file) KEYS[type] = extractEditorKeys(read(resolve(EDITOR_DIR, file)), file);
}
// 공통 칸(SectionPropsEditor 안의 <DoneTextField> 등)은 편집기 파일 밖이라 따로 센다 — 참여 8종에 합친다.
const commonKeys = extractEditorKeys(propsEditorSrc, 'SectionPropsEditor.tsx');
for (const type of PARTICIPATION_TYPES) {
  if (!KEYS[type]) continue;
  KEYS[type] = { ...KEYS[type], top: [...new Set([...KEYS[type].top, ...commonKeys.top])].sort() };
}

const TOTAL_KEYS = Object.values(KEYS).reduce((a, k) => a + countEditorKeys(k), 0);
/** 첫 실측값(2026-10-14) = 206(편집기 27개 198 + 공용 완료 문구 칸 × 참여 8종). 줄면 추출기가 키를 흘리기 시작한 것 — 하한. */
const TOTAL_KEYS_FLOOR = 206;

// ── 탐침 ──
type Probe = { value: unknown; kind: 'bool' | 'num' | 'color' | 'url' | 'enum' | 'text' };
function probesOf(type: string, prop: string, cur: unknown, editorDefault?: unknown): Probe[] | null {
  const e = DM_PROBE_CONTEXT.enums[`${type}.${prop}`];
  if (e !== undefined) return [{ value: e, kind: 'enum' }];
  const leaf = prop.replace(/^.*\./, '');
  if (typeof cur === 'boolean') return [{ value: !cur, kind: 'bool' }];
  // 편집기가 `props.X ?? true/false`로 보여 주면 X는 boolean — 미지정이면 양쪽 다 시도
  if (cur === undefined && typeof editorDefault === 'boolean') return [{ value: true, kind: 'bool' }, { value: false, kind: 'bool' }];
  if (typeof cur === 'number') return [{ value: cur + 7, kind: 'num' }];
  if (Array.isArray(cur) || (cur !== null && typeof cur === 'object')) return null;
  if (/(_color|^color|_bg)$/.test(leaf)) return [{ value: cur === '#1a2b3c' ? '#3c2b1a' : '#1a2b3c', kind: 'color' }];
  if (/url$/i.test(leaf)) return [{ value: `https://probe.example/${leaf}`, kind: 'url' }];
  if (typeof cur === 'string') return [{ value: `탐침_${leaf}`, kind: 'text' }];
  if (/^(show_|enable_|allow_|one_|is_|has_|auto_|pull_up)|_required$|_visible$/.test(leaf)) {
    return [{ value: true, kind: 'bool' }, { value: false, kind: 'bool' }]; // 미지정 boolean은 양쪽 다 시도(렌더러 기본이 어느 쪽인지 모른다)
  }
  return [{ value: `탐침_${leaf}`, kind: 'text' }];
}

function visibleText(html: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
}

/** 출력 비교 — 'pass' · 'viewer'(data-*로만 나가고 뷰어가 읽음) · 'fail' */
function judge(base: string, out: string, probe: Probe): 'pass' | 'viewer' | 'fail' {
  if (base === out) return 'fail';
  if (probe.kind !== 'text') return 'pass';
  const v = String(probe.value);
  if (visibleText(out).includes(v)) return 'pass';
  const attrs = [...out.matchAll(/\s([a-zA-Z-]+)="[^"]*"/g)].filter((m) => m[0].includes(v)).map((m) => m[1]);
  if (attrs.length && attrs.every((a) => a.startsWith('data-') && VIEWER_ATTRS.has(a))) return 'viewer';
  return 'fail';
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
function baseProps(type: string): Record<string, unknown> {
  return { ...clone(SECTION_DEFAULTS[type as keyof typeof SECTION_DEFAULTS] as unknown as Record<string, unknown>), ...(DM_PROBE_CONTEXT.base[type] || {}) };
}
function mk(type: string, props: Record<string, unknown>, treatment?: string): Section {
  return { id: 's1', type, order: 0, visible: true, props, ...(treatment ? { treatment } : {}) } as unknown as Section;
}
const ssr = (type: string, props: Record<string, unknown>, treatment: string) => renderSection(mk(type, props, treatment), {} as any);
const email = (type: string, props: Record<string, unknown>, treatment: string) => renderEmailSections([mk(type, props, treatment)], {});
const treatmentsOf = (type: string): readonly string[] => TREATMENTS[type] || ['classic'];
const emailTreatmentsOf = (type: string): readonly string[] => EMAIL_TREATMENTS[type] || ['classic'];

/** 속성 하나의 탐침 변형들 — 최상위 키 · 배열 항목 필드(arr[].k) */
type Variant = { name: string; props: Record<string, unknown>; probe: Probe };
function variantsOf(type: string, prop: string, base0: Record<string, unknown>, editorDefaults: Record<string, unknown> = {}): Variant[] | { error: string } {
  // 그 속성에만 얹는 전제(DM_PROBE_CONTEXT.with) — 기본 출력도 같은 전제로 비교한다
  const base = { ...base0, ...(DM_PROBE_CONTEXT.with[`${type}.${prop}`] || {}) };
  const m = prop.match(/^(\w+)\[\]\.(\w+)$/);
  if (m) {
    const [, arr, k] = m;
    const list = base[arr];
    if (!Array.isArray(list) || list.length === 0) return { error: `${type}.${arr} 항목이 없다 — DM_PROBE_CONTEXT.base.${type}.${arr}에 항목 1개를 둔다` };
    const cur = (list[0] as Record<string, unknown>)[k];
    const probes = probesOf(type, prop, cur, editorDefaults[k]);
    if (!probes) return { error: `${type}.${prop} 탐침을 만들 수 없다(값 타입 ${typeof cur}) — DM_PROBE_CONTEXT.enums에 둔다` };
    return probes.map((probe) => {
      const props = clone(base);
      (props[arr] as Record<string, unknown>[])[0] = { ...(props[arr] as Record<string, unknown>[])[0], [k]: probe.value };
      return { name: prop, props, probe };
    });
  }
  const probes = probesOf(type, prop, base[prop], editorDefaults[prop]);
  if (!probes) return { error: `${type}.${prop} 탐침을 만들 수 없다(값 타입 ${typeof base[prop]}) — DM_PROBE_CONTEXT.enums에 둔다` };
  return probes.map((probe) => ({ name: prop, props: { ...clone(base), [prop]: probe.value }, probe }));
}

/** 탐침 대상 속성 전부 — 배열 키 자체(items에 항목 필드가 있는 최상위 키)는 항목 필드로만 센다 */
function allProps(k: EditorKeys): string[] {
  return [...k.top.filter((t) => !k.items[t]), ...Object.entries(k.items).flatMap(([arr, ks]) => ks.map((x) => `${arr}[].${x}`))];
}

const exemptKey = (e: { section: string; prop: string; surface: string; treatment?: string }) =>
  `${e.surface}:${e.section}.${e.prop}${e.treatment ? '@' + e.treatment : ''}`;
// kind=server 행은 "서버가 읽는다"는 이름 걸림의 근거일 뿐, 발행 면 탐침의 면제가 아니다(동의 체크 data-consent 처럼 SSR 배선도 함께 필요한 값이 있다 · Codex 1R)
const EXEMPT = new Map(DM_PROP_EXEMPT.filter((e) => e.kind !== 'server').map((e) => [exemptKey(e), e]));
const EMAIL_EXEMPT = new Set(EMAIL_PROP_EXEMPT.map((e) => `email:${e.section}.${e.prop}`));
function isExempt(name: string): boolean {
  // 'ssr:hero.image_url@split' 은 구도 없는 'ssr:hero.image_url' 행으로도 면제된다
  if (EXEMPT.has(name) || EMAIL_EXEMPT.has(name)) return true;
  const bare = name.replace(/@[\w-]+$/, '');
  // 이메일 편집기의 숨김 목록(EMAIL_HIDDEN_EDITOR_FIELDS)은 면제 근거가 아니다 — 중복 컨트롤(헤드라인 강조)은 이메일 전용 컨트롤로 계속 편집된다(Codex 1R)
  return EXEMPT.has(bare) || EMAIL_EXEMPT.has(bare);
}
const UNREVIEWED = new Set(DM_PROP_UNREVIEWED);

/** 한 면(surface)에서 속성 하나를 구도 전부로 탐침 → 실패 이름들(전 구도 실패면 구도 없는 이름 하나) */
function probeSurface(
  surface: 'ssr' | 'email', type: string, prop: string, base: Record<string, unknown>,
  treatments: readonly string[], render: (p: Record<string, unknown>, t: string) => string,
  editorDefaults: Record<string, unknown> = {},
): { fails: string[]; errors: string[] } {
  const v = variantsOf(type, prop, base, editorDefaults);
  if ('error' in v) return { fails: [], errors: [v.error] };
  const baseWith = { ...base, ...(DM_PROBE_CONTEXT.with[`${type}.${prop}`] || {}) };
  const failedTreatments: string[] = [];
  for (const t of treatments) {
    const baseOut = render(baseWith, t);
    const ok = v.some((x) => judge(baseOut, render(x.props, t), x.probe) !== 'fail');
    if (!ok) failedTreatments.push(t);
  }
  if (failedTreatments.length === 0) return { fails: [], errors: [] };
  if (failedTreatments.length === treatments.length) return { fails: [`${surface}:${type}.${prop}`], errors: [] };
  return { fails: failedTreatments.map((t) => `${surface}:${type}.${prop}@${t}`), errors: [] };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('DM 커버리지 — 대조의 바탕', () => {
  it('27타입 전부가 편집기 파일·캔버스 컴포넌트에 매핑돼 있다(분기에서 파생 · 손 표 0)', () => {
    for (const type of SECTION_TYPES) {
      expect(EDITOR_FILE[type], `${type} 편집기 분기(SectionPropsEditor) 없음`).toBeTruthy();
      expect(CANVAS_COMPONENT[type], `${type} 캔버스 분기(canvas/SectionRenderer) 없음`).toBeTruthy();
      expect(canvasBody(CANVAS_COMPONENT[type]).length, `${type} 캔버스 컴포넌트 ${CANVAS_COMPONENT[type]} 본문을 못 찾음`).toBeGreaterThan(0);
    }
  });

  it(`편집기 키 총수 ${TOTAL_KEYS} ≥ 하한 ${TOTAL_KEYS_FLOOR}(추출기가 키를 흘리기 시작하면 여기서 깨진다)`, () => {
    expect(TOTAL_KEYS).toBeGreaterThanOrEqual(TOTAL_KEYS_FLOOR);
  });

  it('기본값 + 바탕 보정으로 그린 발행 렌더가 비어 있지 않다(구도 전부)', () => {
    const empty: string[] = [];
    for (const type of SECTION_TYPES) {
      const base = baseProps(type);
      for (const t of treatmentsOf(type)) if (!ssr(type, base, t)) empty.push(`${type}@${t}`);
    }
    expect(empty, '빈 출력은 탐침이 무의미하다 — DM_PROBE_CONTEXT.base에 바탕을 준다').toEqual([]);
  });

  it('참여 8종 = 렌더러가 data-dm-result를 내는 타입 = 프론트 미러', () => {
    const withResult = SECTION_TYPES.filter((type) => ssr(type, baseProps(type), 'classic').includes('data-dm-result'));
    expect([...withResult].sort()).toEqual([...PARTICIPATION_TYPES].sort());
    expect([...FE_PARTICIPATION_TYPES].sort()).toEqual([...PARTICIPATION_TYPES].sort());
  });
});

describe('DM 커버리지 — 예외 원장 자체의 규율', () => {
  it('면제 사유는 20자 이상이고 "아직·예정·미구현·나중"을 쓰지 않는다 · kind 4종 밖 없음', () => {
    for (const e of DM_PROP_EXEMPT) {
      expect(e.why.length, `${exemptKey(e)} 사유가 짧다`).toBeGreaterThanOrEqual(20);
      expect(/아직|예정|미구현|나중/.test(e.why), `${exemptKey(e)} 사유가 "안 했다"다 — 미검토는 DM_PROP_UNREVIEWED로`).toBe(false);
      expect(['server', 'viewer', 'n/a', 'removed']).toContain(e.kind);
    }
  });

  it('kind=server 행은 reader 함수 본문에 그 속성을 읽는 코드가 실제로 있다(파일 전체 스캔 X)', () => {
    for (const e of DM_PROP_EXEMPT.filter((x) => x.kind === 'server')) {
      expect(e.reader, `${exemptKey(e)} reader 없음`).toBeTruthy();
      const body = serverFnBody(e.reader!);
      expect(body.length, `${exemptKey(e)} reader ${e.reader} 본문을 못 찾음`).toBeGreaterThan(0);
      const leaf = e.prop.replace(/^.*\./, '');
      expect(new RegExp(`\\.${leaf}\\b`).test(body), `${e.reader} 본문이 .${leaf}를 읽지 않는다`).toBe(true);
    }
  });

  it('kind=removed 행은 편집기·기본값 양쪽에 남아 있지 않고, 그 밖 행은 편집기가 아직 노출한다(원장 부패 차단)', () => {
    for (const e of DM_PROP_EXEMPT) {
      const keys = KEYS[e.section];
      expect(keys, `${exemptKey(e)} 편집기 없음`).toBeTruthy();
      const exposed = allProps(keys).includes(e.prop);
      if (e.kind === 'removed') {
        expect(exposed, `${exemptKey(e)} 제거됐다는 속성을 편집기가 노출한다`).toBe(false);
        expect(Object.keys(SECTION_DEFAULTS[e.section as keyof typeof SECTION_DEFAULTS] || {})).not.toContain(e.prop);
      } else {
        expect(exposed, `${exemptKey(e)} 편집기에서 사라진 속성 — 행을 지운다`).toBe(true);
      }
    }
  });

  it('래칫: 미검토 목록·서버 규칙 대기 목록은 상한 이하(줄기만 한다)', () => {
    expect(DM_PROP_UNREVIEWED.length).toBeLessThanOrEqual(DM_PROP_UNREVIEWED_MAX);
    expect(DM_SERVER_RULES_PENDING.length).toBeLessThanOrEqual(DM_SERVER_RULES_PENDING_MAX);
    expect(new Set(DM_PROP_UNREVIEWED).size, '미검토 목록에 중복').toBe(DM_PROP_UNREVIEWED.length);
  });
});

describe('DM 커버리지 — 발행 면 전수 탐침(섹션당 1 · 누락 일괄)', () => {
  const SEEN_FAILS = new Set<string>();
  for (const type of SECTION_TYPES) {
    it(`[${type}] 편집기 속성 전부가 발행 렌더·캔버스·이메일에서 소비되거나 원장에 있다`, () => {
      const keys = KEYS[type];
      expect(keys, `${type} 편집기 키 없음`).toBeTruthy();
      const base = baseProps(type);
      const props = allProps(keys);
      const unexplained: string[] = [];
      const errors: string[] = [];
      const canvas = canvasBody(CANVAS_COMPONENT[type]);
      for (const prop of props) {
        const found: string[] = [];
        // 발행 렌더
        const s = probeSurface('ssr', type, prop, base, treatmentsOf(type), (p, t) => ssr(type, p, t), keys.defaults);
        found.push(...s.fails); errors.push(...s.errors);
        // 이메일(그리는 12타입만)
        if ((EMAIL_BLOCK_WHITELIST as readonly string[]).includes(type)) {
          const e = probeSurface('email', type, prop, base, emailTreatmentsOf(type), (p, t) => email(type, p, t), keys.defaults);
          found.push(...e.fails); errors.push(...e.errors);
        }
        // 캔버스(이름 대조 근사)
        const leaf = prop.replace(/^.*\./, '');
        if (!new RegExp(`\\b${leaf}\\b`).test(canvas)) found.push(`canvas:${type}.${prop}`);
        for (const name of found) {
          SEEN_FAILS.add(name);
          if (!isExempt(name) && !UNREVIEWED.has(name)) unexplained.push(name);
        }
      }
      expect(errors, '탐침을 만들 수 없는 속성 — DM_PROBE_CONTEXT에 둔다').toEqual([]);
      expect(unexplained, `값을 바꿔도 출력이 안 바뀌는 속성(화면에서는 "눌러도 안 바뀐다") — 렌더에 넣거나 DM_PROP_EXEMPT에 사유와 함께 둔다`).toEqual([]);
    });
  }

  it('미검토 목록의 항목이 통과하게 됐으면 목록에서 뺀다(이름 바꿔치기·늘리기 차단)', () => {
    const stale = DM_PROP_UNREVIEWED.filter((n) => !SEEN_FAILS.has(n));
    expect(stale, '이제 소비되는 속성 — DM_PROP_UNREVIEWED에서 지우고 MAX를 줄인다').toEqual([]);
  });

  it('면제 행이 가리키는 실패가 실제로 있다(없어진 면제 = 원장 부패)', () => {
    // server 행은 이름 걸림의 근거(발행물에 나오든 말든)라 탐침 실패와 묶지 않는다
    const stale = DM_PROP_EXEMPT.filter((e) => e.kind !== 'removed' && e.kind !== 'server' && !SEEN_FAILS.has(exemptKey(e)));
    expect(stale.map(exemptKey), '탐침이 이제 통과하는 속성 — 면제 행을 지운다').toEqual([]);
  });
});

describe('DM 커버리지 — 서버 규칙 이름(발행물에 안 나와도 그냥 통과 금지)', () => {
  it('규칙 이름 속성은 kind=server 행(reader 실재)이거나 대기 목록에 있다', () => {
    const missing: string[] = [];
    const covered = new Set<string>();
    for (const type of SECTION_TYPES) {
      for (const prop of allProps(KEYS[type] || { top: [], items: {}, defaults: {} })) {
        const leaf = prop.replace(/^.*\./, '');
        if (!DM_SERVER_RULE_NAME.test(leaf)) continue;
        const name = `${type}.${prop}`;
        const server = DM_PROP_EXEMPT.some((e) => e.kind === 'server' && e.section === type && e.prop === prop && e.reader);
        if (server) covered.add(name);
        else if (!DM_SERVER_RULES_PENDING.includes(name)) missing.push(name);
      }
    }
    expect(missing, '서버가 읽지 않는 "규칙" 이름 — 서버 판정(dm-interaction)에 넣고 kind=server로 등재하거나 DM_SERVER_RULES_PENDING에 둔다').toEqual([]);
    const stale = DM_SERVER_RULES_PENDING.filter((n) => covered.has(n));
    expect(stale, '서버가 읽게 된 규칙 — 대기 목록에서 뺀다').toEqual([]);
  });
});

describe('DM 커버리지 — 편집기 표시 기본값 = 미지정 렌더', () => {
  it('`props.X ?? D` 로 보여 주는 값이 키 없는 발행물과 같다(구도 전부)', () => {
    const mismatch: string[] = [];
    for (const type of SECTION_TYPES) {
      const keys = KEYS[type];
      if (!keys) continue;
      for (const [prop, d] of Object.entries(keys.defaults)) {
        const base = baseProps(type);
        delete base[prop];
        for (const t of treatmentsOf(type)) {
          if (ssr(type, base, t) !== ssr(type, { ...base, [prop]: d }, t)) mismatch.push(`${type}.${prop} ?? ${JSON.stringify(d)} @${t}`);
        }
      }
    }
    expect(mismatch, '편집기는 켜짐으로 보여 주는데 발행물은 꺼져 있다(또는 반대) — 편집기 기본값을 렌더 기본에 맞춘다').toEqual([]);
  });
});

describe('DM 커버리지 — 백엔드 registry ↔ 프론트 defaults 미러', () => {
  it('SECTION_DEFAULTS 27타입 키·값이 같다', () => {
    for (const type of SECTION_TYPES) {
      expect(FE_SECTION_DEFAULTS[type as keyof typeof FE_SECTION_DEFAULTS], `${type} 기본값이 다르다`)
        .toEqual(SECTION_DEFAULTS[type as keyof typeof SECTION_DEFAULTS]);
    }
  });

  it('Props 타입 키가 같다(백엔드 registry ↔ 프론트 defaults 소스 대조)', () => {
    const typeKeys = (src: string): Record<string, string[]> => {
      const out: Record<string, string[]> = {};
      for (const m of src.matchAll(/export type (\w+Props) = \{((?:[^{}]|\{[^{}]*\})*?)\};/g)) {
        const body = m[2].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        out[m[1]] = [...body.matchAll(/(?:^|[{;\n])\s*([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/g)].map((x) => x[1]).sort();
      }
      return out;
    };
    const be = typeKeys(read(resolve(BE_DM, 'dm-section-registry.ts')));
    const fe = typeKeys(read(resolve(FE_ROOT, 'utils/dm-section-defaults.ts')));
    expect(Object.keys(fe).sort()).toEqual(Object.keys(be).sort());
    for (const name of Object.keys(be)) expect(fe[name], `${name} 키가 다르다`).toEqual(be[name]);
  });
});

describe('DM 편집기 소스 게이트(접수 ①·⑧ 1단계)', () => {
  it('선택지 줄 나누기는 LineListInput(FormControls) 한 곳 — 편집기 onChange 안 split 0건(접수 ① 뿌리)', () => {
    const bad: string[] = [];
    for (const f of readdirSync(EDITOR_DIR).filter((x) => x.endsWith('.tsx'))) {
      const src = read(resolve(EDITOR_DIR, f));
      if (/\.split\(\s*['"`]\\n/.test(src)) bad.push(f);
    }
    expect(bad, '줄 목록 편집은 LineListInput을 쓴다(초안 state · 빈 줄 제거 한 곳)').toEqual([]);
    expect(read(resolve(FE_ROOT, 'components/dm/panels/FormControls.tsx'))).toMatch(/export function LineListInput\(/);
  });

  it('발행본 확인창([저장하고 보내기]·[저장하고 나가기]) 처리기는 save() 외 다른 쓰기를 부르지 않는다(⑧ 1단계 · 새 라이브 쓰기 경로 0)', () => {
    const src = read(resolve(FE_ROOT, 'pages/DmBuilderPage.tsx'));
    // 새 만들기 흐름(DmEditScreen)엔 DM 테스트 발송 입구가 없다(옛 DmTopBar 는 hidden 고정) → 확인창은 둘. 입구가 생기면 라벨을 더한다.
    const LABELS = ['저장하고 보내기', '저장하고 나가기'];
    const blocks: string[] = [];
    let i = 0;
    while ((i = src.indexOf('setConfirm({', i)) >= 0) {
      let depth = 0, j = src.indexOf('{', i);
      for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
      blocks.push(src.slice(i, j + 1)); i = j;
    }
    const mine = blocks.filter((b) => LABELS.some((l) => b.includes(`'${l}'`)));
    expect(mine.length, '발행본 확인창이 모자란다 — 라벨이 바뀌었으면 LABELS를 맞춘다').toBeGreaterThanOrEqual(LABELS.length);
    for (const b of mine) expect(/\bapi\.(post|put|patch|delete)\(|\bfetch\(/.test(b), `확인창 처리기에 저장 밖 쓰기: ${b.slice(0, 160)}`).toBe(false);
  });
});
