/**
 * kakao-template-guard.verify.ts — CT-87 카카오 템플릿 활성상태 발송 판정 (순수)
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/kakao-template-guard.verify.ts
 * 핵심: 검수 APR + 활성 R(B_IV_013_02_79738 실사례) = 차단, A = 허용, 미동기(null) = 과차단 방지 허용.
 */
import assert from 'node:assert';
import { decideKakaoTemplateSendable } from '../kakao-template-guard-core';

let passed = 0;
function ok(name: string, fn: () => void) { fn(); passed++; console.log(`  ok - ${name}`); }

console.log('[1] 허용');
{
  ok('A = 발송 가능', () => assert.strictEqual(decideKakaoTemplateSendable('A').sendable, true));
  ok('null(미동기) = 통과 (기존 검수 가드만)', () => assert.strictEqual(decideKakaoTemplateSendable(null).sendable, true));
  ok('undefined = 통과', () => assert.strictEqual(decideKakaoTemplateSendable(undefined).sendable, true));
  ok('빈 문자열 = 통과', () => assert.strictEqual(decideKakaoTemplateSendable('').sendable, true));
  ok('소문자 a도 허용 (대소문자 정규화)', () => assert.strictEqual(decideKakaoTemplateSendable('a').sendable, true));
  ok('미지의 상태값 = 통과 (과차단 방지)', () => assert.strictEqual(decideKakaoTemplateSendable('X').sendable, true));
}

console.log('[2] 차단 — 79738 실사례 포함');
{
  const r = decideKakaoTemplateSendable('R');
  ok('R(활성 대기) = 차단', () => assert.strictEqual(r.sendable, false));
  ok('R 코드 = TEMPLATE_INACTIVE', () => assert.strictEqual(r.code, 'TEMPLATE_INACTIVE'));
  ok('R 사유 문구 존재', () => assert.ok((r.reason || '').includes('활성')));

  const s = decideKakaoTemplateSendable('S');
  ok('S(중단) = 차단', () => assert.strictEqual(s.sendable, false));
  ok('S 코드 = TEMPLATE_STOPPED', () => assert.strictEqual(s.code, 'TEMPLATE_STOPPED'));

  const d = decideKakaoTemplateSendable('D');
  ok('D(삭제) = 차단', () => assert.strictEqual(d.sendable, false));
  ok('D 코드 = TEMPLATE_DELETED', () => assert.strictEqual(d.code, 'TEMPLATE_DELETED'));

  ok('공백 섞인 " r " 도 차단 (trim)', () => assert.strictEqual(decideKakaoTemplateSendable(' r ').sendable, false));
}

console.log(`\n${passed} assertions passed — kakao-template-guard`);
