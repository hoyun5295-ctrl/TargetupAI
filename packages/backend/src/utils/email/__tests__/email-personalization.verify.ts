/**
 * email-personalization.verify.ts — 이메일 개인화 순수 검증 (DB import 0)
 * 실행: cd packages/backend && npx ts-node src/utils/email/__tests__/email-personalization.verify.ts
 */
import assert from 'node:assert';
import { evalDisplayCondition, resolveEmailSectionsForCustomer, renderEmailText } from '../email-personalization';
import type { Section } from '../../dm/dm-section-registry';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

const vip = { name: '김민수', grade: 'VIP', points: 12000 };
const normal = { name: '이서연', grade: '일반', points: 0 };
const base = (over: Partial<Section>): Section => ({ id: 'x', type: 'text_card', order: 0, visible: true, props: {} as any, ...over });

console.log('[email-personalization] evalDisplayCondition');
ok('eq 통과/탈락', () => {
  assert.strictEqual(evalDisplayCondition({ field: 'grade', op: 'eq', value: 'VIP' }, vip), true);
  assert.strictEqual(evalDisplayCondition({ field: 'grade', op: 'eq', value: 'VIP' }, normal), false);
});
ok('gt 숫자 비교', () => {
  assert.strictEqual(evalDisplayCondition({ field: 'points', op: 'gt', value: '1000' }, vip), true);
  assert.strictEqual(evalDisplayCondition({ field: 'points', op: 'gt', value: '1000' }, normal), false);
});
ok('빈 고객 안전(필드 없음 = 빈 문자)', () => {
  assert.strictEqual(evalDisplayCondition({ field: 'grade', op: 'eq', value: 'VIP' }, {}), false);
  assert.strictEqual(evalDisplayCondition({ field: 'grade', op: 'ne', value: 'VIP' }, {}), true);
});

console.log('[email-personalization] renderEmailText');
ok('Liquid 치환', () => {
  assert.ok(renderEmailText('{{ customer.name }}님', vip).includes('김민수'));
});
ok('Liquid 문법 없으면 원본 유지', () => {
  assert.strictEqual(renderEmailText('여름 신상 안내', vip), '여름 신상 안내');
});

console.log('[email-personalization] resolveEmailSectionsForCustomer');
ok('섹션 string 필드 Liquid 치환', () => {
  const secs = [base({ props: { headline: '{{ customer.name }}님', body: '{{ customer.grade }} 고객님' } as any })];
  const out = resolveEmailSectionsForCustomer(secs, vip);
  assert.ok((out[0].props as any).headline.includes('김민수'));
  assert.ok((out[0].props as any).body.includes('VIP'));
});
ok('display_condition 불충족 섹션 제외', () => {
  const secs = [
    base({ id: 'a', display_condition: { field: 'grade', op: 'eq', value: 'VIP' }, props: { body: 'VIP only' } as any }),
    base({ id: 'b', order: 1, props: { body: '모두' } as any }),
  ];
  assert.deepStrictEqual(resolveEmailSectionsForCustomer(secs, normal).map((s) => s.id), ['b']);
  assert.deepStrictEqual(resolveEmailSectionsForCustomer(secs, vip).map((s) => s.id), ['a', 'b']);
});
ok('visible=false 제외', () => {
  const secs = [base({ id: 'a', visible: false, props: {} as any }), base({ id: 'b', order: 1, props: {} as any })];
  assert.deepStrictEqual(resolveEmailSectionsForCustomer(secs, vip).map((s) => s.id), ['b']);
});
ok('원본 sections 불변(새 배열 반환)', () => {
  const secs = [base({ props: { headline: '{{ customer.name }}' } as any })];
  resolveEmailSectionsForCustomer(secs, vip);
  assert.strictEqual((secs[0].props as any).headline, '{{ customer.name }}');
});

console.log(`[email-personalization] ${passed} passed`);
