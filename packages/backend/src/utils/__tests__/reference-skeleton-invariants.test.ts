/**
 * reference-skeleton-invariants.test.ts — 참조 골격 학습층 불변식 (2026-09-03 · 설계서 §9 1~4·10~13)
 *
 * 잠그는 것
 *  1. 사다리 배선 — dm-ai의 체인 결정 블록에서 참조 골격 조회는 `else if (prompt)` 분기 안에만 있다(structure·scenario 분기보다 뒤).
 *  2. 탈출구 1개 — `disableLearnedStructure`가 실재한다(opt-in 파라미터가 아니라 opt-out).
 *  3. 조회 실패·serving off = null — 생성 경로는 현행과 같다(getStructureSkeleton이 throw하지 않는다).
 *  4. 이메일 system = baseSystem + brain.promptSuffix + structureBlock, 골격 없으면 '' · EMAIL_BLOCKS_SYSTEM 권장 순서 한 줄 무변경.
 * 10. 저장은 append — DELETE 없음 · 같은 ref.id 무시 · serving 보존.
 * 11. 플래너 제작 호출부가 재료 확장 함수를 쓴다(공용 buildPlannerEventText는 호출만).
 * 12. 아웃리치는 임베드·sns 상시 absent + 결과를 `structure`로 명시 전달 + asset에 structureRef 기록.
 * 13. 승격·순수 모듈은 props를 읽지 않는다 · 모델명 0.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../../config/database', () => {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { default: { query }, query, mysqlQuery: vi.fn(), pool: { query } };
});

import * as db from '../../config/database';
import { getStructureSkeleton, saveStructureSkeleton } from '../best-copy-assets';
import { emptySkeletonMeta, appendChains, type SkeletonChain } from '../dm/dm-structure-resolve';

const SRC = resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');
/** 주석 제거 후 검사 — 이력을 적은 주석이 "호출이 남았다"로 오판되지 않게 */
const readCode = (rel: string) =>
  read(rel).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

const count = (s: string, needle: string) => s.split(needle).length - 1;

const NEW_FILES = [
  'utils/dm/dm-structure-resolve.ts',
  'utils/email/email-structure-prompt.ts',
  'utils/reference-skeleton-promote.ts',
  'utils/best-copy-assets.ts',
];

describe('reference-skeleton invariants', () => {
  it('1. dm-ai 사다리 — 참조 골격 조회는 체인 결정 블록의 prompt 분기 안에만', () => {
    const code = readCode('utils/dm/dm-ai.ts');
    expect(count(code, 'getStructureSkeleton(')).toBe(1);
    const start = code.indexOf('let sectionTypes: SectionType[];');
    const end = code.indexOf('const sections: Section[] = [];', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = code.slice(start, end);
    expect(count(block, 'getStructureSkeleton(')).toBe(1);
    const promptBranch = block.indexOf('} else if (prompt) {');
    expect(promptBranch).toBeGreaterThan(-1);
    // structure·scenario 분기(prompt 분기 앞)에는 참조 골격이 없다
    const before = block.slice(0, promptBranch);
    expect(before).not.toContain('getStructureSkeleton(');
    expect(before).not.toContain('resolveStructure(');
    expect(before).toContain('normalizeSectionChain(structure.sectionTypes');
    expect(before).toContain('sectionTypes = scenarioMeta.sections;');
    // prompt 분기 안: 참조 골격이 없으면 기존 AI 설계 경로가 그대로 남아 있다
    const after = block.slice(promptBranch);
    expect(after).toContain('designSectionLayout(spec, opts.companyId)');
    expect(after).toContain('resolveStructure(');
  });

  it('2. 탈출구는 opt-out 1개(disableLearnedStructure) — opt-in 힌트 파라미터 없음', () => {
    const code = readCode('utils/dm/dm-ai.ts');
    expect(code).toContain('disableLearnedStructure');
    expect(code).not.toContain('structureHint');
  });

  it('3. 조회 예외·serving off = null(throw 0) · requireServing:false면 행', async () => {
    const q = (db as any).default.query as ReturnType<typeof vi.fn>;
    q.mockReset();
    q.mockRejectedValueOnce(new Error('boom'));
    await expect(getStructureSkeleton('general', 'DM')).resolves.toBeNull();

    const meta = appendChains(emptySkeletonMeta(), [chain('a', ['header', 'hero', 'cta', 'footer'])]).meta;
    const row = { id: 'row1', industry_code: 'general', channel: 'DM', content: '', meta, created_at: 'x' };
    q.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    await expect(getStructureSkeleton('general', 'DM')).resolves.toBeNull(); // serving.enabled=false
    q.mockResolvedValueOnce({ rows: [row], rowCount: 1 });
    const got = await getStructureSkeleton('general', 'DM', { requireServing: false });
    expect(got?.id).toBe('row1');
    expect(got?.meta.chains.length).toBe(1);
  });

  it('4. 이메일 — system 결합식·EMAIL_BLOCKS_SYSTEM 권장 순서 한 줄 무변경', () => {
    const code = readCode('utils/email-ai.ts');
    expect(code).toContain('system: baseSystem + brain.promptSuffix + structureBlock');
    expect(code).toContain("const structureBlock = skeleton ? renderStructureBlock(skeleton.meta.stats) : ''");
    expect(read('utils/email-ai.ts')).toContain('권장 순서: header → hero → 본문(text_card / product_carousel / gallery) → cta → footer.');
  });

  it('10. 저장은 append — DELETE 없음 · 같은 ref.id 무시 · serving 보존', async () => {
    const code = readCode('utils/best-copy-assets.ts');
    const fn = code.slice(code.indexOf('export async function saveStructureSkeleton'), code.indexOf('export async function setStructureServing'));
    expect(fn).not.toMatch(/DELETE/);
    expect(fn).toContain('UPDATE best_copy_assets');

    const q = (db as any).default.query as ReturnType<typeof vi.fn>;
    q.mockReset();
    const existingMeta = {
      ...appendChains(emptySkeletonMeta(), [chain('dup', ['header', 'hero', 'cta', 'footer'])]).meta,
      serving: { enabled: true, enabled_by: 'ceo', enabled_at: '2026-09-03T00:00:00.000Z' },
    };
    q.mockResolvedValueOnce({ rows: [{ id: 'row1', industry_code: 'general', channel: 'DM', content: '', meta: existingMeta, created_at: 'x' }], rowCount: 1 });
    q.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // UPDATE
    const r = await saveStructureSkeleton('general', 'DM', [
      chain('dup', ['header', 'hero', 'cta', 'footer']),
      chain('new', ['header', 'hero', 'product_carousel', 'cta', 'footer']),
    ]);
    expect(r).toMatchObject({ ok: true, added: 1, skippedDuplicate: 1, total: 2 });
    const update = q.mock.calls[1];
    expect(String(update[0])).toMatch(/UPDATE best_copy_assets SET content = \$1, meta = \$2 WHERE id = \$3 AND meta = \$4::jsonb/);
    const savedMeta = JSON.parse(update[1][1]);
    expect(savedMeta.chains.length).toBe(2);
    expect(savedMeta.serving).toEqual(existingMeta.serving);
    expect(savedMeta.stats.n).toBe(2);
  });

  it('11. 플래너 — 제작 호출부 2곳이 재료 확장을 쓰고 공용 buildPlannerEventText는 그대로', () => {
    const code = readCode('utils/planner-production.ts');
    expect(count(code, 'await buildPlannerProductionEventText(tp)')).toBe(2);
    expect(code).toContain('buildPlannerExtraMaterial(');
    const exec = readCode('utils/planner-execution.ts');
    const fn = exec.slice(exec.indexOf('export function buildPlannerEventText'), exec.indexOf('export function buildPlannerExtraMaterial'));
    expect(fn).not.toContain('brand_name'); // 공용 함수에 재료를 섞지 않았다
  });

  it('12. 아웃리치 — 임베드·sns 상시 absent · 골격을 구성 힌트로 명시 전달 · asset structureRef', () => {
    // ★ 2026-09-05 아웃리치 DM은 공용 oneShotGenerate 대신 전용 few-shot 생성으로 바뀌었다(0905 설계서 §19 ①).
    //   골격은 `skeletonTypes`(프롬프트 [참고 구성 순서])로 전달되고, 근거 기록(structureRef)은 그대로 asset에 남는다.
    const produce = readCode('utils/sales-outreach-produce.ts');
    expect(produce).toContain("embeds: 'absent'");
    expect(produce).toContain("social: 'absent'");
    expect(produce).toContain('skeletonTypes: structureRef ? structureRef.sectionTypes');
    expect(produce).toContain('[참고 구성 순서]');
    const jobs = readCode('utils/sales-outreach-jobs.ts');
    expect(jobs).toContain('benefitLicensed: !!licensedQuote');
    expect(jobs).toContain('structureRef: dm.structureRef');
  });

  it('14. 베스트 구성 = ceo 전용 게이트가 모든 /best-layout 입구 앞에 한 번(라우트별 덧대기 0) · 베스트 문안 경로에는 남은 골격 라우트 0', () => {
    const code = readCode('routes/admin.ts');
    const gate = code.indexOf("router.use('/best-layout', authenticate, requireSuperAdmin, requireBestLayoutViewer)");
    expect(gate).toBeGreaterThan(-1);
    for (const p of ["'/best-layout/skeleton'", "'/best-layout/skeleton/candidates'", "'/best-layout/skeleton/promote'", "'/best-layout/skeleton/serving'"]) {
      const at = code.indexOf(p);
      expect(at, `${p} 라우트`).toBeGreaterThan(gate);
    }
    expect(code).not.toContain("'/best-copy/skeleton");
    // access는 게이트 앞(허용 여부는 누구나 물을 수 있다)
    expect(code.indexOf("'/best-layout/access'")).toBeLessThan(gate);
    const auth = readCode('middlewares/auth.ts');
    expect(auth).toContain('isBestLayoutViewer(req.user?.userId)');
    const audit = readCode('utils/audit-log.ts');
    expect(audit).toContain("'BEST_LAYOUT_VIEWER_IDS', 'ceo'");
    expect(readCode('utils/admin-role.ts')).toContain("key: 'bestLayout'");
  });

  it('13. 순수·승격 모듈은 props를 읽지 않는다 · 모델명 0', () => {
    for (const f of ['utils/dm/dm-structure-resolve.ts', 'utils/reference-skeleton-promote.ts']) {
      expect(readCode(f), `${f}에 .props 접근`).not.toContain('.props');
    }
    for (const f of NEW_FILES) {
      expect(read(f), `${f}에 모델명 문자열`).not.toMatch(/sonnet|opus|haiku|claude|anthropic|gpt-/i);
    }
  });
});

function chain(id: string, seq: string[]): SkeletonChain {
  return {
    seq: seq as SkeletonChain['seq'],
    author_type: 'catalog',
    author_type_source: 'auto',
    src: 'human_edited',
    ref: { kind: 'dm', id, promoted_at: '2026-09-03T00:00:00.000Z', promoted_by: 'test' },
  };
}
