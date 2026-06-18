/**
 * cdp-app-id.verify.ts — CDP 네이티브 앱 키 인증 순수 헬퍼 검증 (DB-free)
 * 실행: npx ts-node --project packages/backend/tsconfig.json packages/backend/src/utils/__tests__/cdp-app-id.verify.ts
 * 핵심: cdp-auth.ts는 config/database를 import해 순수 테스트가 못 도는다 → 순수 헬퍼는 이 DB-free 파일로 분리.
 */
import assert from 'node:assert';
import { isAllowedAppId, isValidBundleId, normAppId } from '../cdp-app-id';

let passed = 0;
const ok = (n: string, f: () => void) => { f(); passed++; console.log(`  ok - ${n}`); };

console.log('[1] normAppId');
ok('소문자·트림 정규화', () => assert.strictEqual(normAppId('  KR.Poppon.App '), 'kr.poppon.app'));
ok('null/undefined 빈 문자열', () => { assert.strictEqual(normAppId(null as any), ''); assert.strictEqual(normAppId(undefined as any), ''); });

console.log('[2] isAllowedAppId');
ok('등록된 번들ID 통과(대소문자·공백 무시)', () => assert.strictEqual(isAllowedAppId(['kr.poppon.app'], ' KR.Poppon.App '), true));
ok('미등록 차단', () => assert.strictEqual(isAllowedAppId(['kr.poppon.app'], 'com.other.app'), false));
ok('빈 목록 차단', () => assert.strictEqual(isAllowedAppId([], 'kr.poppon.app'), false));
ok('빈 appId 차단', () => assert.strictEqual(isAllowedAppId(['kr.poppon.app'], ''), false));
ok('null 목록 차단', () => assert.strictEqual(isAllowedAppId(null, 'kr.poppon.app'), false));
ok('목록도 정규화 비교', () => assert.strictEqual(isAllowedAppId(['KR.Poppon.App'], 'kr.poppon.app'), true));

console.log('[3] isValidBundleId');
ok('정상 역DNS 통과', () => assert.strictEqual(isValidBundleId('kr.poppon.app'), true));
ok('com.example.myapp 통과', () => assert.strictEqual(isValidBundleId('com.example.myapp'), true));
ok('대문자 입력도 정규화 후 통과', () => assert.strictEqual(isValidBundleId('KR.Poppon.App'), true));
ok('점 없음 차단', () => assert.strictEqual(isValidBundleId('poppon'), false));
ok('공백·특수문자 차단', () => { assert.strictEqual(isValidBundleId('kr poppon!'), false); assert.strictEqual(isValidBundleId('kr.poppon!'), false); });
ok('빈 문자열 차단', () => assert.strictEqual(isValidBundleId(''), false));

console.log(`\n${passed} assertions passed — cdp-app-id`);
process.exit(0);
