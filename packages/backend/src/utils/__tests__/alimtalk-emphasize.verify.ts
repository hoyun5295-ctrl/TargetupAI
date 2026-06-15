/**
 * alimtalk-emphasize.verify.ts — 알림톡 k_etc_json 생성(buildAlimtalkEtcJson) 검증
 * 실행: npx ts-node packages/backend/src/utils/__tests__/alimtalk-emphasize.verify.ts
 * (DB import 0 — 순수. 치환 함수 주입형.
 *  ★ 강조: k_etc_json = {title}. 대표링크: {attachment_link:{url_mobile,url_pc,...}} — 변수명 attachment_link(link 아님, 게이트웨이 명시 2026-06-16).)
 */
import assert from 'node:assert';
import { buildAlimtalkEtcJson, toAttachmentLink } from '../alimtalk-emphasize';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[alimtalk-emphasize] buildAlimtalkEtcJson');

ok('title + 치환 → {title:치환값} (senderkey 없음)', () => {
  const r = buildAlimtalkEtcJson({
    emphasizeTitle: '#{이름}님 주문',
    substitute: (raw) => raw.replace('#{이름}', '홍길동'),
  });
  const o = JSON.parse(r!);
  assert.strictEqual(o.title, '홍길동님 주문');
  assert.ok(!('senderkey' in o)); // ★ 매뉴얼: 알림톡은 senderkey 제외
});

ok('title만(치환 미주입) → {title:원문}', () => {
  assert.strictEqual(buildAlimtalkEtcJson({ emphasizeTitle: '안내' }), JSON.stringify({ title: '안내' }));
});

ok('emphasizeTitle·representLink 모두 없음 → undefined (etcJson 미전달)', () => {
  assert.strictEqual(buildAlimtalkEtcJson({}), undefined);
  assert.strictEqual(buildAlimtalkEtcJson({ emphasizeTitle: '' }), undefined);
  assert.strictEqual(buildAlimtalkEtcJson({ emphasizeTitle: null }), undefined);
});

ok('치환 결과가 빈 문자열이어도 원문 truthy면 title 키 유지', () => {
  const o = JSON.parse(buildAlimtalkEtcJson({ emphasizeTitle: '#{없는변수}', substitute: () => '' })!);
  assert.strictEqual(o.title, '');
});

ok('강조만(representLink 없음) → title 키 하나뿐', () => {
  const o = JSON.parse(buildAlimtalkEtcJson({ emphasizeTitle: '안내', substitute: (r) => r })!);
  assert.deepStrictEqual(Object.keys(o), ['title']);
});

// ── 대표링크(attachment_link) ──
ok('representLink만(camel) → {attachment_link:snake} (title 없음)', () => {
  const o = JSON.parse(buildAlimtalkEtcJson({
    representLink: { urlMobile: 'https://m.x.com', urlPc: 'https://x.com' },
  })!);
  assert.ok(!('title' in o));
  assert.deepStrictEqual(o.attachment_link, { url_mobile: 'https://m.x.com', url_pc: 'https://x.com' });
});

ok('title + representLink → {title, attachment_link} 동봉', () => {
  const o = JSON.parse(buildAlimtalkEtcJson({
    emphasizeTitle: '#{n}', substitute: () => '57000',
    representLink: { urlMobile: 'https://m.x.com', urlPc: 'https://x.com' },
  })!);
  assert.strictEqual(o.title, '57000');
  assert.deepStrictEqual(o.attachment_link, { url_mobile: 'https://m.x.com', url_pc: 'https://x.com' });
});

ok('representLink 값 0개(빈 객체/빈 문자열) + title 없음 → undefined', () => {
  assert.strictEqual(buildAlimtalkEtcJson({ representLink: {} }), undefined);
  assert.strictEqual(buildAlimtalkEtcJson({ representLink: { urlMobile: '' } }), undefined);
});

ok('toAttachmentLink: camel→snake 변환 + 값 없는 키 생략', () => {
  assert.deepStrictEqual(
    toAttachmentLink({ urlMobile: 'https://m', urlPc: '', schemeIos: 'a://b', schemeAndroid: null }),
    { url_mobile: 'https://m', scheme_ios: 'a://b' },
  );
  assert.strictEqual(toAttachmentLink(null), undefined);
  assert.strictEqual(toAttachmentLink({}), undefined);
});

ok('attachmentLink(snake 직접, staging 재파싱) 우선 — representLink 무시', () => {
  const o = JSON.parse(buildAlimtalkEtcJson({
    attachmentLink: { url_mobile: 'https://keep.com' },
    representLink: { urlMobile: 'https://ignored.com' },
  })!);
  assert.deepStrictEqual(o.attachment_link, { url_mobile: 'https://keep.com' });
});

console.log(`\n${passed} assertions passed`);
process.exit(0);
