/**
 * ai-json 안전 파서 수동 테스트 — 백엔드 vitest 부재로 ts-node 단독 실행.
 * 실행: npx ts-node src/utils/__tests__/ai-json.manual-test.ts
 * 종료코드 0 = 전부 통과, 1 = 실패.
 */
import { extractJsonFromAiText } from '../ai-json';

let pass = 0;
let fail = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log(`  PASS: ${name}`);
  } catch (e: any) {
    fail++;
    console.log(`  FAIL: ${name} — ${e?.message || e}`);
  }
}
function eq(a: any, b: any, msg: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg} (got ${JSON.stringify(a)})`);
}
function throws(fn: () => void, msg: string) {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`${msg} — 예외 미발생`);
}

// 1) 순수 JSON
check('순수 JSON 객체', () => {
  const r = extractJsonFromAiText('{"a":1,"b":"x"}');
  eq(r.a, 1, 'a=1'); eq(r.b, 'x', 'b=x');
});

// 2) ```json 코드펜스
check('```json 코드펜스', () => {
  const r = extractJsonFromAiText('```json\n{"variants":[{"message_text":"안녕"}]}\n```');
  eq(r.variants[0].message_text, '안녕', 'message_text');
});

// 3) 코드펜스(json 태그 없음)
check('``` 코드펜스', () => {
  const r = extractJsonFromAiText('```\n{"x":2}\n```');
  eq(r.x, 2, 'x=2');
});

// 4) ★ 사고 재현 — 앞에 설명/본문 섞임 (코드펜스 없음)
check('앞 설명문 + JSON 혼입', () => {
  const r = extractJsonFromAiText('다음과 같이 생성했습니다.\n{"variants":[{"message_text":"%고객명%님 안녕"}]}');
  eq(r.variants[0].message_text, '%고객명%님 안녕', 'message_text 추출');
});

// 5) 뒤에도 설명 붙음
check('JSON 뒤 설명문', () => {
  const r = extractJsonFromAiText('{"ok":true} 이상입니다.');
  eq(r.ok, true, 'ok');
});

// 6) 배열 응답
check('배열 응답', () => {
  const r = extractJsonFromAiText('[{"a":1},{"a":2}]');
  eq(r.length, 2, 'len=2');
});

// 7) 순수 프로세(JSON 없음) → throw (호출부 fallback)
check('순수 프로세 → throw', () => {
  throws(() => extractJsonFromAiText('%고객명%님, 안녕하세요. 봄 행사입니다.'), 'JSON 없으면 throw');
});

// 8) 빈 응답 → throw
check('빈 응답 → throw', () => {
  throws(() => extractJsonFromAiText(''), '빈 응답 throw');
});

console.log(`\n결과: ${pass} pass / ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
