/**
 * email-training-message.verify.ts — 이메일 학습 메시지 합성 순수 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/email-training-message.verify.ts
 * (DB import 0 — 제목+본문 결합, textBody 우선·HTML 태그 제거. 마스킹은 logTrainingData가 별도.)
 */
import assert from 'node:assert';
import { buildEmailTrainingMessage } from '../email-training-message';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[email-training-message] buildEmailTrainingMessage — 제목 + 본문 결합');

ok('textBody 있으면 우선 (htmlBody 무시)', () =>
  assert.strictEqual(
    buildEmailTrainingMessage('여름 세일', '여름 특가 안내입니다', '<p>HTML 무시</p>'),
    '여름 세일\n\n여름 특가 안내입니다'));

ok('textBody 비면 htmlBody 태그 제거', () =>
  assert.strictEqual(
    buildEmailTrainingMessage('가을 신상', '', '<p>가을 신상품 출시</p>'),
    '가을 신상\n\n가을 신상품 출시'));

ok('block 종료 태그 </p> → 줄바꿈 보존', () =>
  assert.strictEqual(
    buildEmailTrainingMessage('공지', null, '<p>첫째 줄</p><p>둘째 줄</p>'),
    '공지\n\n첫째 줄\n둘째 줄'));

ok('<br> · <br/> 태그 → 줄바꿈', () =>
  assert.strictEqual(
    buildEmailTrainingMessage('안내', null, '한 줄<br>두 줄<br/>세 줄'),
    '안내\n\n한 줄\n두 줄\n세 줄'));

ok('HTML 엔티티 디코드 (&nbsp; &amp;)', () =>
  assert.strictEqual(
    buildEmailTrainingMessage('할인', null, '<p>50% 할인&nbsp;&amp; 무료배송</p>'),
    '할인\n\n50% 할인 & 무료배송'));

ok('빈 단락 제거 + 양끝 trim', () =>
  assert.strictEqual(
    buildEmailTrainingMessage('정리', null, '<p>위</p><p></p><p></p><p>아래</p>'),
    '정리\n\n위\n아래'));

ok('script · style 블록 내용 통째 제거', () =>
  assert.strictEqual(
    buildEmailTrainingMessage('메일', null, '<style>.x{color:red}</style><p>본문</p><script>alert(1)</script>'),
    '메일\n\n본문'));

ok('subject만 있고 본문 비면 제목만', () =>
  assert.strictEqual(buildEmailTrainingMessage('제목만', '', ''), '제목만'));

ok('subject 비고 본문만 있으면 본문만', () =>
  assert.strictEqual(buildEmailTrainingMessage('', '본문 텍스트', ''), '본문 텍스트'));

ok('전부 비면 빈 문자열', () =>
  assert.strictEqual(buildEmailTrainingMessage('', '', ''), ''));

ok('null/undefined 방어 (subject null, textBody null)', () =>
  assert.strictEqual(
    buildEmailTrainingMessage(null as any, null, '<p>본문만</p>'),
    '본문만'));

console.log(`\n[email-training-message] ${passed} passed`);
