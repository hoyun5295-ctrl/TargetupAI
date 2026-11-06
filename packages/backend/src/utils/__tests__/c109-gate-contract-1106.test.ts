/**
 * C109 검사 입구 · 판정 값 계약(★ 2026-11-06 설계서 docs/2026-11-06-b1106-1-unsupported-char-design.md §9 K4 · K8)
 *   K4(R7) 반려 = 'rejected'(장애 아님 · 다시 검사 0) · 합치기 순서 · 저장 한 값 왕복 · 사유 필수 갈래
 *   K8 반례 추적(Codex 설계 4R #1) — 보낼 수 있는 글자(U+212B 옹스트롬 기호)가 두 번째 치환(Liquid downcase)에서 보낼 수 없는 글자(U+00E5)가 된다(1106 실측).
 *      렌더가 끝난 글(rendered) = 검사 입구가 다시 치환하지 않는다 → 반려 0 · 표식이 검사 행에 남는다 · 표식을 빼면 반려(변이).
 */
import { describe, it, expect, vi } from 'vitest';

const inserted: any[][] = [];
const client = {
  query: vi.fn(async (sql: string, p?: any[]) => {
    const s = String(sql).trim();
    if (s.includes('INSERT INTO spam_filter_tests')) { inserted.push(p || []); return { rows: [{ id: 'test-1', created_at: new Date() }] }; }
    return { rows: [] };
  }),
  release: vi.fn(),
};
const plainQuery = vi.fn(async (sql: string, _p?: any[]) => {
  const s = String(sql);
  if (s.includes('FROM spam_filter_devices')) return { rows: [{ id: 'd1', carrier: 'SKT', phone: '01000000001' }] };
  if (s.includes('INSERT INTO spam_filter_tests')) return { rows: [{ id: 'x' }] };
  return { rows: [] };
});
vi.mock('../../config/database', () => ({
  default: { connect: vi.fn(async () => client), query: (...a: any[]) => (plainQuery as any)(...a) },
  query: (...a: any[]) => (plainQuery as any)(...a),
  mysqlQuery: vi.fn(async () => []),
}));
vi.mock('../store-scope', () => ({ getSampleCustomerScope: async () => ({ where: '', params: [] }) }));

import {
  enqueueSpamTest, spamVerdictOf, mergeAlternativeVerdicts, spamVerdictWithRetry, enqueueFailureVerdict, SPAM_VERDICT_WORD,
  toSpamCheckRecord, readSpamCheckRecord, spamRejectionOf, spamRejectionPlaces, autoVariantResult, RENDERED_SAMPLE_MARK, isRenderedSample,
  SPAM_REJECTED_DEFAULT_TEXT, cleanSpamSampleValues,
} from '../spam-test-queue';
import { mergeSpamVerdicts } from '../journey-pretest-validator';
import { isSmsEncodableChar } from '../sms-charset';
import { replaceVariables } from '../messageUtils';

const LIQUID = "{{ 'Å' | downcase }}님";

describe('K8 반례 추적 — 렌더가 끝난 글은 다시 치환하지 않는다', () => {
  it('전제(1106 실측): U+212B = 보낼 수 있는 글자 · 두 번째 치환 결과 U+00E5 = 보낼 수 없는 글자', () => {
    expect(isSmsEncodableChar('Å')).toBe(true);
    expect(replaceVariables(LIQUID, {} as any, {} as any, undefined as any)).toBe('å님');
    expect(isSmsEncodableChar('å')).toBe(false);
  });
  const base = { companyId: '00000000-0000-0000-0000-0000000000c1', userId: '00000000-0000-0000-0000-0000000000a1', callbackNumber: '0212345678',
    messageContentSms: LIQUID, messageType: 'SMS' as const, source: 'auto_ai' as const, batchId: 'b1', skipPrepaid: true, firstRecipient: { name: '가' } };
  it('rendered 아님(옛 길) = 입구가 다시 치환해 반려(사유에 위치 · 코드 · 그 글자 0)', async () => {
    const out = await enqueueSpamTest({ ...base });
    expect(out.ok).toBe(false);
    expect(out.errorCode).toBe('SMS_UNSUPPORTED_CHARS');
    expect(out.unsupportedChars).toEqual(['U+00E5']);
    expect(out.error).toContain('U+00E5');
    expect(out.error!.startsWith('문자로 보낼 수 없는 글자가 있어 검사하지 않았어요: ')).toBe(true);
    expect([...String(out.error)].every((c) => isSmsEncodableChar(c) || c === '\n')).toBe(true);
    expect(enqueueFailureVerdict(out.errorCode)).toBe('rejected');
  });
  it('rendered = 받은 글 그대로(반려 0) · 검사 행 표본 칸 = 표식(워커가 다시 치환하지 않는다)', async () => {
    inserted.length = 0;
    const out = await enqueueSpamTest({ ...base, rendered: true });
    expect(out.errorCode).not.toBe('SMS_UNSUPPORTED_CHARS');
    const firstRecipientParam = inserted.flat().find((v) => typeof v === 'string' && v.includes(RENDERED_SAMPLE_MARK));
    expect(firstRecipientParam).toBeTruthy();
    expect(isRenderedSample(JSON.parse(String(firstRecipientParam)))).toBe(true);
    expect(isRenderedSample({ name: '가' })).toBe(false);
    expect(isRenderedSample(null)).toBe(false);
  });
  it('검사 입력 치환 값(P5) = 문자열 값만 정리한 사본(원본 불변) · 안쪽(custom_fields JSONB · 배열)까지 · 날짜 객체 그대로', () => {
    const d = new Date(0);
    const sample = { name: '가😊', grade: 'VIP​', n: 3, custom_fields: { custom_1: 'VIP😊', tags: ['a😊', 1] }, joined: d };
    const out = cleanSpamSampleValues(sample);
    expect(out).toEqual({ name: '가', grade: 'VIP', n: 3, custom_fields: { custom_1: 'VIP', tags: ['a', 1] }, joined: d });
    expect(out.joined).toBe(d);
    expect(sample.name).toBe('가😊');
    expect(sample.custom_fields.custom_1).toBe('VIP😊');
  });
  it('custom_fields 표본 값이 실제 치환에 들어가도 정리 뒤 = 반려 0(Codex 구현 1R #3 · 치환 = 진짜 replaceVariables)', () => {
    // 치환 표 꼴 = messageUtils enrichWithCustomFields 가 만드는 그대로(column = 필드 키 · storageType = custom_fields · 값 = custom_fields[키])
    const map = { 등급: { column: 'custom_1', type: 'string', description: '등급', sample: '', storageType: 'custom_fields' } } as any;
    const raw = { name: '가', custom_fields: { custom_1: 'VIP😊' } };
    expect(replaceVariables('%등급% 고객님', raw as any, map, undefined as any)).toBe('VIP😊 고객님');   // 옛 = 안쪽 값이 그대로 들어가 입구 반려
    const after = replaceVariables('%등급% 고객님', cleanSpamSampleValues(raw) as any, map, undefined as any);
    expect(after).toBe('VIP 고객님');
    expect([...after].every((c) => isSmsEncodableChar(c) || c === '\n')).toBe(true);
  });
});

describe('K4(R7) 반려 = rejected · 장애 아님', () => {
  it('판정 · 이름표 · 큐 실패 매핑', () => {
    expect(spamVerdictOf({ spamResult: 'rejected', carrierResults: [] } as any, 1)).toBe('rejected');
    expect(SPAM_VERDICT_WORD.rejected).toBe('보낼 수 없는 글자');
    expect(enqueueFailureVerdict('SMS_UNSUPPORTED_CHARS')).toBe('rejected');
    expect(enqueueFailureVerdict('NO_TEST_DEVICE')).toBe('failed');
    expect(enqueueFailureVerdict(undefined)).toBe('failed');
  });
  it('합치기 순서 — 대안(통과 > 확인 중 > 검사 중 > 차단 > 보낼 수 없는 글자 > 장애) · 판 여럿(차단 > 보낼 수 없는 글자 > 장애 > 확인 중 > 검사 중 > 통과)', () => {
    expect(mergeAlternativeVerdicts(['rejected', 'error'])).toBe('rejected');
    expect(mergeAlternativeVerdicts(['rejected', 'blocked'])).toBe('blocked');
    expect(mergeAlternativeVerdicts(['rejected', 'pass'])).toBe('pass');
    expect(mergeSpamVerdicts(['error', 'rejected'])).toBe('rejected');
    expect(mergeSpamVerdicts(['blocked', 'rejected'])).toBe('blocked');
    expect(mergeSpamVerdicts(['pending', 'rejected', 'pass'])).toBe('rejected');
  });
  it('다시 검사 고리 = 장애만 다시 · 반려는 첫 회에 돌려준다(run 1번)', async () => {
    const run = vi.fn(async () => ({ variants: [{ spamResult: 'rejected', rejection: '문자로 보낼 수 없는 글자가 있어 검사하지 않았어요: 맨 앞 이모지(U+1F60A)', carrierResults: [] }], totalTestCount: 1 }));
    const r = await spamVerdictWithRetry(run, { attempts: 3, waitMs: 0 });
    expect(r.verdict).toBe('rejected');
    expect(run).toHaveBeenCalledTimes(1);
    expect(spamRejectionOf(r.variant)).toContain('U+1F60A');
  });
  it('저장 한 값 왕복 — 사유 보존 · 옛 문자열 · 옛 객체 · 사유 없는 반려 = 기본 문장', () => {
    const v = autoVariantResult({ variantId: 'A', messageText: 'x', carrierResults: [], regenerated: false, regenerateCount: 0 }, 'rejected', '문자로 보낼 수 없는 글자가 있어 검사하지 않았어요: 제목 맨 앞 보낼 수 없는 글자(U+00E9)');
    expect(v.spamResult).toBe('rejected');
    const rec = toSpamCheckRecord(v);
    const back = readSpamCheckRecord(JSON.parse(JSON.stringify(rec)));
    expect(back).toEqual({ result: 'rejected', rejection: v.rejection });
    expect(spamRejectionPlaces(back!.result === 'rejected' ? back!.rejection : '')).toBe('제목 맨 앞 보낼 수 없는 글자(U+00E9)');
    expect(readSpamCheckRecord('pass')).toEqual({ result: 'pass' });
    expect(readSpamCheckRecord({ result: 'rejected' })).toEqual({ result: 'rejected', rejection: SPAM_REJECTED_DEFAULT_TEXT });
    expect(readSpamCheckRecord({ spamResult: 'blocked' })).toEqual({ result: 'blocked' });
    expect(readSpamCheckRecord('이상한 값')).toEqual({ result: 'failed' });
    expect(readSpamCheckRecord(null)).toBeNull();
    expect(autoVariantResult({ variantId: 'A', messageText: 'x', carrierResults: [], regenerated: false, regenerateCount: 0 }, 'rejected', null).rejection).toBe(SPAM_REJECTED_DEFAULT_TEXT);
  });
});
