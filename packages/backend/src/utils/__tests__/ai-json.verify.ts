/**
 * ai-json.verify.ts — extractJsonFromAiText 안전 파싱 가드 (DB import 0).
 * 실행: npx ts-node packages/backend/src/utils/__tests__/ai-json.verify.ts
 *
 * 2026-06-30 회귀: AI가 여러 줄 LMS 본문을 응답 JSON에 escape 안 된 raw 줄바꿈(0x0A)으로 담으면
 *   JSON.parse가 "Bad control character in string literal"로 거부 → generateMessages fallback(비상 골격).
 *   extractJsonFromAiText가 문자열 내부 raw 제어문자를 escape 후 파싱해 항상 성공해야 한다.
 */
import assert from 'node:assert';
import { extractJsonFromAiText } from '../ai-json';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[ai-json] extractJsonFromAiText 검증');

// ★ 핵심 회귀: 문자열 안 raw 줄바꿈(0x0A) — AI 다줄 LMS 본문 재현. (정정 전엔 throw)
ok('문자열 내부 raw 줄바꿈 → 정상 파싱', () => {
  const raw = '{"variants":[{"message_text":"첫 줄\n둘째 줄\n셋째 줄"}]}';
  const r = extractJsonFromAiText<any>(raw);
  assert.strictEqual(r.variants[0].message_text, '첫 줄\n둘째 줄\n셋째 줄');
});

ok('raw 탭/캐리지리턴도 escape 후 파싱', () => {
  const raw = '{"a":"탭\t끝","b":"줄\r끝"}';
  const r = extractJsonFromAiText<any>(raw);
  assert.strictEqual(r.a, '탭\t끝');
  assert.strictEqual(r.b, '줄\r끝');
});

ok('이미 escape된 \\n은 그대로 보존(이중 escape 안 함)', () => {
  const valid = '{"a":"b\\nc"}'; // JSON 안의 \n (정상)
  const r = extractJsonFromAiText<any>(valid);
  assert.strictEqual(r.a, 'b\nc');
});

ok('문자열 안 escape된 따옴표 보존', () => {
  const raw = '{"a":"그는 \\"안녕\\"\n이라 했다"}'; // 이스케이프 따옴표 + raw 줄바꿈
  const r = extractJsonFromAiText<any>(raw);
  assert.strictEqual(r.a, '그는 "안녕"\n이라 했다');
});

ok('코드펜스 + raw 줄바꿈 동시', () => {
  const raw = '```json\n{"m":"가\n나"}\n```';
  const r = extractJsonFromAiText<any>(raw);
  assert.strictEqual(r.m, '가\n나');
});

ok('설명문 혼입 + raw 줄바꿈', () => {
  const raw = '다음은 결과입니다: {"m":"가\n나"} 이상입니다.';
  const r = extractJsonFromAiText<any>(raw);
  assert.strictEqual(r.m, '가\n나');
});

ok('정상 단줄 JSON 회귀 0', () => {
  const r = extractJsonFromAiText<any>('{"x":1,"y":"z"}');
  assert.strictEqual(r.x, 1);
  assert.strictEqual(r.y, 'z');
});

ok('배열 JSON', () => {
  const r = extractJsonFromAiText<any>('[{"m":"가\n나"}]');
  assert.strictEqual(r[0].m, '가\n나');
});

console.log(`\n[ai-json] ${passed} passed`);
