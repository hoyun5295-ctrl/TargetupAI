/**
 * 회사 학습 메모리 = composeVoicePrompt 한 곳(★ 2026-11-01 여정 재발 방지 배포 2 C1 · docs/2026-11-01-journey-recurrence-prevention-design.md §3 C1)
 *
 * 옛: 여정 생성 · 다듬기 · 기준일 칸 · journey-builder · 인앱 · 문안 두뇌 · AI 한줄로가 메모리를 저마다 넣었고(20 · 30건),
 *     여정 편집 · 다음 칸 추천 · 스팸 재작성 · 그 밖 생산자는 0이었다(J4). 목소리 없는 회사는 목소리 CT 가 이른 반환이라 0.
 * 새: 목소리 CT 가 이른 반환 앞에서 상위 6건(1,200자)을 넣는다 · 따로 넣던 곳은 지운다(래칫).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { sourceFiles, stripComments } from './helpers/producer-scan';

const memoryMock = vi.fn(async (_companyId: string, _n?: number) => '');
vi.mock('../company-memory', () => ({ buildMemoryPromptContext: (c: string, n?: number) => memoryMock(c, n) }));
vi.mock('../../config/database', () => ({
  default: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  query: vi.fn(async () => ({ rows: [] })),
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
}));

import { composeVoicePrompt, invalidateBrandVoiceCache } from '../brand-voice-prompt';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => stripComments(readFileSync(join(SRC, rel), 'utf8').replace(/\r\n/g, '\n'));
const files = sourceFiles(SRC, /\.ts$/);

describe('C1 목소리 CT 가 메모리를 넣는다(목소리 없는 회사 포함)', () => {
  beforeEach(() => { memoryMock.mockReset(); invalidateBrandVoiceCache(); });

  it('목소리 없음 + 메모리 있음 = 지시문 뒤에 메모리 블록 · 상위 6건', async () => {
    memoryMock.mockResolvedValue('## 회사 학습 메모리\n- 성공 패턴: 짧은 첫 줄');
    const r = await composeVoicePrompt({ companyId: 'm-1', producer: 't', mode: 'write', kind: 'marketing', basePrompt: 'BASE' });
    expect(r.system).toBe('BASE\n\n## 회사 학습 메모리\n- 성공 패턴: 짧은 첫 줄');
    expect(memoryMock).toHaveBeenCalledWith('m-1', 6);
  });

  it('메모리 없음 = 지시문 글자 그대로(I15 유지)', async () => {
    memoryMock.mockResolvedValue('');
    const r = await composeVoicePrompt({ companyId: 'm-2', producer: 't', mode: 'write', kind: 'marketing', basePrompt: 'BASE' });
    expect(r.system).toBe('BASE');
  });

  it('메모리 조회 실패 = 메모리 없이 진행(생산자를 막지 않는다)', async () => {
    memoryMock.mockRejectedValue(new Error('db down'));
    const r = await composeVoicePrompt({ companyId: 'm-3', producer: 't', mode: 'write', kind: 'marketing', basePrompt: 'BASE' });
    expect(r.system).toBe('BASE');
  });

  it('1,200자 상한', async () => {
    memoryMock.mockResolvedValue('가'.repeat(5000));
    const r = await composeVoicePrompt({ companyId: 'm-4', producer: 't', mode: 'write', kind: 'marketing', basePrompt: 'B' });
    expect(r.system.length).toBe(1 + 2 + 1200);
  });

  it('회사 없음 = 메모리 조회 0', async () => {
    const r = await composeVoicePrompt({ companyId: undefined, producer: 't', mode: 'write', kind: 'marketing', basePrompt: 'B' });
    expect(r.system).toBe('B');
    expect(memoryMock).not.toHaveBeenCalled();
  });
});

describe('C1 래칫 — 메모리를 직접 부르는 곳', () => {
  // 고객 문안 생산자는 목소리 CT 로만 메모리를 받는다. 아래는 문안 생산자가 아니라서 남긴 곳(이유 줄 · 늘리면 이유).
  const ALLOWED: Record<string, string> = {
    'utils/brand-voice-prompt.ts': '주인(composeVoicePrompt 한 곳)',
    'utils/company-memory.ts': '정의',
    'routes/ai-memory.ts': '메모리 화면의 묻기 · 문안 생산 아님',
    'services/ai-orchestrator.ts': 'AI 오퍼레이터 계획 지시문 · 문안은 generateMessages(목소리 CT)가 쓴다',
    'utils/alimtalk-ai-matcher.ts': '알림톡 템플릿 고르기 · 템플릿 글은 검수본 고정',
    'utils/marketing-calendar-store.ts': '마케팅 달력 계획 · 문안 아님',
  };
  it('buildMemoryPromptContext 를 부르는 파일 = 허용 목록뿐', () => {
    const callers = files.filter((f) => /\bbuildMemoryPromptContext\b/.test(read(f)));
    expect(callers.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it('문안 두뇌(composeCopyBrain)를 부르는 파일은 목소리 CT 도 부른다(메모리가 두뇌에서 빠졌으므로)', () => {
    const brain = files.filter((f) => f !== 'utils/copy-prompt-composer.ts' && /\bcomposeCopyBrain\s*\(/.test(read(f)));
    expect(brain.length).toBeGreaterThan(0);
    for (const f of brain) expect({ f, voice: /\bcomposeVoicePrompt\s*\(/.test(read(f)) }).toEqual({ f, voice: true });
  });

  it('문안 두뇌 본문에 메모리 조회 0 · memoryIncluded 옵션 0', () => {
    const src = read('utils/copy-prompt-composer.ts');
    expect(src).not.toMatch(/buildMemoryPromptContext|memoryIncluded/);
  });
});
