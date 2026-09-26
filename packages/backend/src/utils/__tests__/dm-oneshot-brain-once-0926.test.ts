/**
 * 원스텝 DM 생성 — 문안두뇌는 한 번만 읽는다 (★2026-09-26 한줄로 V2 R1-29 중 반복 부하 제거분)
 *
 * 옛: 섹션마다 generateCopy가 composeCopyBrain(회사 성과 문안 RAG + 브랜드 키트 조회)을 다시 불렀다.
 *     같은 회사·같은 채널·같은 입력이라 결과가 같은데 섹션 수만큼 DB를 다시 읽었다.
 * 처방: oneShotGenerate가 루프 앞에서 한 번 만들어 넘긴다(generateCopy의 선택 인자 · 넘기면 다시 읽지 않는다).
 *   다른 호출부(routes/dm.ts 단일 섹션 재생성)는 인자를 안 넘겨 지금과 같다.
 * (섹션별 AI 호출 병렬화는 공급사 동시 호출 한도 영향이 있어 소요 시간 실측 뒤 판단 — 원장 측정 항목)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const brainMock = vi.fn(async () => ({ promptSuffix: '\n[brain]' }));
vi.mock('../copy-prompt-composer', () => ({ composeCopyBrain: (...a: any[]) => (brainMock as any)(...a) }));
const aiMock = vi.fn(async () => '{"headline":"h"}');
vi.mock('../../services/ai', () => ({ callAIWithFallback: (...a: any[]) => (aiMock as any)(...a) }));
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));

import { generateCopy } from '../dm/dm-ai';

const spec: any = { brand: { name: 'b' }, objective: 'promo', target: 't', benefit: null, tone: 'friendly', industry: 'x' };
const section: any = { id: 's1', type: 'hero', props: {} };

describe('generateCopy 문안두뇌 인자', () => {
  beforeEach(() => { brainMock.mockClear(); aiMock.mockClear(); });

  it('넘겨받으면 다시 읽지 않고 그 값을 시스템에 붙인다', async () => {
    await generateCopy(spec, section, 'co-1', undefined, '\n[pre]');
    expect(brainMock).not.toHaveBeenCalled();
    expect(String((aiMock.mock.calls[0] as any[])[0].system)).toContain('[pre]');
  });

  it('안 넘기면 지금처럼 읽는다', async () => {
    await generateCopy(spec, section, 'co-1');
    expect(brainMock).toHaveBeenCalledTimes(1);
  });
});

describe('원스텝 배선', () => {
  const src = readFileSync(join(__dirname, '..', 'dm', 'dm-ai.ts'), 'utf8');
  const one = src.slice(src.indexOf('export async function oneShotGenerate('));
  it('루프 앞에서 한 번 만들고 섹션마다 넘긴다', () => {
    const iBrain = one.indexOf('const copyBrainSuffix = await resolveDmCopyBrainSuffix(opts.companyId);');
    const iLoop = one.indexOf('for (let i = 0; i < sectionTypes.length; i++) {');
    expect(iBrain).toBeGreaterThan(-1);
    expect(iBrain).toBeLessThan(iLoop);
    expect(one).toContain('generateCopy(spec, section, opts.companyId, eventContext, copyBrainSuffix)');
  });
});

describe('섹션 카피 병렬(★R1-29 속도분)', () => {
  const src = readFileSync(join(__dirname, '..', 'dm', 'dm-ai.ts'), 'utf8');
  const one = src.slice(src.indexOf('export async function oneShotGenerate('));
  it('섹션 카피 AI 호출을 동시 상한 3으로(입력 순서 보존 CT)', () => {
    expect(src).toContain('const DM_ONESHOT_COPY_CONCURRENCY = 3;');
    expect(one).toContain('await mapWithConcurrency(sections, DM_ONESHOT_COPY_CONCURRENCY, async (section) => {');
  });
});
