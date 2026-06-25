/**
 * qtmsg-type.verify.ts — 발송 타입 → QTmsg msg_type 변환 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/qtmsg-type.verify.ts
 * (DB import 0.)
 *
 * 2026-06-25: 옛 toQtmsgType은 'SMS'/'LMS'만 명시하고 나머지를 전부 'M'(MMS)로 떨궜다.
 *   DM 테스트발송이 단축코드 'L'을 넘기자 'M'으로 변환 → 이미지 없는 MMS → "MMS 이미지 필수" 실패.
 *   풀네임/단축코드 둘 다 받고, 알 수 없는 값은 'M' 대신 'L'(LMS, 이미지 불필요)로 안전 처리.
 */
import assert from 'node:assert';
import { toQtmsgType } from '../qtmsg-type';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[qtmsg-type] toQtmsgType — 풀네임/단축코드 둘 다 안전 변환');

ok('SMS → S', () => assert.strictEqual(toQtmsgType('SMS'), 'S'));
ok('LMS → L', () => assert.strictEqual(toQtmsgType('LMS'), 'L'));
ok('MMS → M', () => assert.strictEqual(toQtmsgType('MMS'), 'M'));

ok('단축코드 S → S', () => assert.strictEqual(toQtmsgType('S'), 'S'));
ok("★ 단축코드 L → L (DM 테스트발송 버그: 옛 버전은 'M'으로 떨궈 이미지필수 MMS 에러)", () =>
  assert.strictEqual(toQtmsgType('L'), 'L'));
ok('단축코드 M → M', () => assert.strictEqual(toQtmsgType('M'), 'M'));

ok('소문자 lms → L', () => assert.strictEqual(toQtmsgType('lms'), 'L'));
ok('소문자 mms → M', () => assert.strictEqual(toQtmsgType('mms'), 'M'));

ok("알 수 없는 값 → L (옛 'M' 기본이 본 사고 원인 — 안전 default)", () =>
  assert.strictEqual(toQtmsgType('XYZ'), 'L'));
ok('빈 문자열 → L', () => assert.strictEqual(toQtmsgType(''), 'L'));

console.log(`\n[qtmsg-type] ${passed}/10 passed`);
