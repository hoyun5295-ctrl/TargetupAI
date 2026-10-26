/**
 * 1026 AI 답 JSON 여러 덩어리 — 직접발송 맞춤법 「실패」(나인 10/26 13:21) 재현 고정
 *
 * 실측: 운영과 같은 지시문 · 같은 호출로 10번 재현 → 1번이 아래 원문(AI 가 첫 JSON 뒤 영어로 스스로 정정하고
 *   JSON 을 하나 더 붙임)으로 「Unexpected non-whitespace character after JSON」 실패 · 운영 로그에는 흔적 0.
 *
 * 잠그는 것
 *   1. 읽기 CT 는 망가진 답에서 덩어리를 건지거나 짐작하지 않는다 — 던진다(Codex 1R~3R: 건지기 규칙마다 반례)
 *   2. 지금 읽히던 답(코드 울타리 · 앞 설명 · 문자열 안 줄바꿈)은 그대로
 *   3. 못 읽으면 경고 1줄 · 답 원문 · 파서 오류 문장 0(조용한 실패 0 · 고객 글이 로그로 새지 않는다)
 *   4. 맞춤법 엔진 = 못 읽으면 한 번만 다시 묻는다(캐시 0) · 두 번 다 못 읽으면 실패 · issues 없는 답 = 실패(가짜 성공 0)
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractJsonFromAiText } from '../ai-json';
import { callAIWithFallback } from '../../services/ai';
import { runSpellCheck } from '../spell-check';

vi.mock('../../services/ai', () => ({ callAIWithFallback: vi.fn() }));

// 서버 재현 13:33 #2 원문(그대로 복사 · 2026-10-26 14:50 .62)
const CAPTURED_SELF_CORRECTION =
  '{"issues":[{"before":"오직 단 하루,","after":"오직 단 하루","reason":"문장이 끝나는 자리에 쉼표가 아닌 종결 표현이 와야 자연스러움"}]}\n\n' +
  'Hmm, wait. Let me reconsider: that issue is a stylistic matter, not a spelling error, and the rules say not to touch style. Correcting my output:\n\n' +
  '{"issues":[]}';

// Codex 3R 반례 = 끝 쉼표로 깨진 실제 교정 + 「없으면 이렇게」 예시(예시만 건지면 교정이 사라진다)
const BROKEN_FIX_PLUS_EXAMPLE = '{"issues":[{"before":"안녕 하세요","after":"안녕하세요","reason":"띄어쓰기"}],} 참고: 문제가 없으면 {"issues":[]}를 반환합니다.';

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
afterEach(() => { vi.restoreAllMocks(); vi.mocked(callAIWithFallback).mockReset(); });

describe('1. 망가진 답 = 건지거나 짐작하지 않고 던진다', () => {
  const CASES: Array<[string, string]> = [
    ['자기 정정 뒤 두 번째 JSON(운영 재현 원문)', CAPTURED_SELF_CORRECTION],
    ['교정 뒤 「없으면 이렇게」 예시(Codex 1R)', '{"issues":[{"before":"안녕 하세요","after":"안녕하세요"}]} 참고: 문제가 없으면 {"issues":[]}를 반환합니다.'],
    ['「Example of corrected output:」 예시(Codex 2R)', '{"issues":[{"before":"안녕 하세요","after":"안녕하세요"}]}\nExample of corrected output:\n{"issues":[]}'],
    ['끝 쉼표로 못 읽는 객체(안쪽 배열 0 · Codex 1R)', '{"issues":[{"before":"안녕 하세요","after":"안녕하세요"}],"notes":[],}'],
    ['괄호 짝 깨짐 뒤 안쪽 배열(Codex 2R)', '{"issues":[{"before":"안녕 하세요","after":"안녕하세요"}}, "notes":[]}'],
    ['깨진 교정 + 예시(Codex 3R)', BROKEN_FIX_PLUS_EXAMPLE],
    ['앞 설명 속 [브랜드] + JSON(원래도 실패 · 건지지 않는다)', '[Atelier Nain]은 브랜드명이라 그대로 둡니다.\n{"issues":[]}'],
  ];
  for (const [name, raw] of CASES) {
    it(name, () => { quiet(); expect(() => extractJsonFromAiText(raw)).toThrow(); });
  }
});

describe('2. 지금 읽히던 답은 그대로', () => {
  it('코드 울타리', () => { expect(extractJsonFromAiText('결과입니다.\n```json\n{"a":1}\n```')).toEqual({ a: 1 }); });
  it('앞 설명 + 단일 JSON', () => { expect(extractJsonFromAiText('설명입니다. {"a":[1,2]} 끝')).toEqual({ a: [1, 2] }); });
  it('문자열 안 raw 줄바꿈', () => { expect(extractJsonFromAiText('{"text":"줄1\n줄2"}')).toEqual({ text: '줄1\n줄2' }); });
  it('배열 답', () => { expect(extractJsonFromAiText('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]); });
});

describe('3. 못 읽으면 흔적을 남긴다 · 원문 0', () => {
  it('던진다 + 경고 1줄 · 이름 · 번호가 로그로 새지 않는다', () => {
    const warn = quiet();
    expect(() => extractJsonFromAiText('{"issues":[{"before":"홍길동 010-1234-5678"')).toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0].join(' '));
    expect(line).toContain('[ai-json]');
    expect(line).not.toContain('홍길동');
    expect(line).not.toContain('1234');
  });
  it('JSON 파서 오류 문장(원문 조각이 들어간다)도 로그에 넣지 않는다', () => {
    const warn = quiet();
    expect(() => extractJsonFromAiText('[홍길동님 안내] 이 답은 JSON 이 아닙니다')).toThrow();
    expect(String(warn.mock.calls[0].join(' '))).not.toContain('홍길동');
  });
  it('빈 답도 경고 1줄', () => {
    const warn = quiet();
    expect(() => extractJsonFromAiText('   ')).toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('읽히는 답은 경고 0', () => {
    const warn = quiet();
    extractJsonFromAiText('{"issues":[]}');
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('4. 맞춤법 엔진 = 한 번 다시 묻기 · 가짜 성공 0', () => {
  const input = { companyId: 'c', text: '안녕 하세요', system: 's', userMessage: 'u', source: 'direct-send-spell', protectedSpans: [] };
  it('운영 재현 원문 → 다시 물어 읽으면 성공(두 번 다 캐시 0)', async () => {
    quiet();
    vi.mocked(callAIWithFallback).mockResolvedValueOnce(CAPTURED_SELF_CORRECTION).mockResolvedValueOnce('{"issues":[]}');
    const r = await runSpellCheck(input);
    expect(r).toMatchObject({ failed: false, issues: [] });
    expect(callAIWithFallback).toHaveBeenCalledTimes(2);
    for (const c of vi.mocked(callAIWithFallback).mock.calls) expect(c[0]).toMatchObject({ noCache: true });
  });
  it('첫 답을 읽으면 한 번만 묻는다', async () => {
    vi.mocked(callAIWithFallback).mockResolvedValueOnce('{"issues":[]}');
    const r = await runSpellCheck(input);
    expect(r.failed).toBe(false);
    expect(callAIWithFallback).toHaveBeenCalledTimes(1);
  });
  it('두 번 다 못 읽으면 실패(세 번째는 없다)', async () => {
    quiet();
    vi.mocked(callAIWithFallback).mockResolvedValue(CAPTURED_SELF_CORRECTION);
    const r = await runSpellCheck(input);
    expect(r.failed).toBe(true);
    expect(callAIWithFallback).toHaveBeenCalledTimes(2);
  });
  it('깨진 교정 + 예시만 두 번 오면 = 실패(Codex 3R · 교정을 숨기는 「고칠 곳 0」 아님)', async () => {
    quiet();
    vi.mocked(callAIWithFallback).mockResolvedValue(BROKEN_FIX_PLUS_EXAMPLE);
    expect((await runSpellCheck(input)).failed).toBe(true);
  });
  it('issues 배열이 없는 답만 오면 = 실패', async () => {
    vi.mocked(callAIWithFallback).mockResolvedValue('{"result":"ok"}');
    expect((await runSpellCheck(input)).failed).toBe(true);
  });
  it('AI 호출 자체 오류는 삼키지 않고 그대로 올린다(라우트 catch 가 기록)', async () => {
    vi.mocked(callAIWithFallback).mockRejectedValueOnce(new Error('AI_DELAYED'));
    await expect(runSpellCheck(input)).rejects.toThrow('AI_DELAYED');
    expect(callAIWithFallback).toHaveBeenCalledTimes(1);
  });
});
