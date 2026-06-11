// T3 — 인앱 메시지가 실제 쓰는 개인화 변수 추출 (DB-free 순수 로직 검증)
// 실행: npx ts-node src/utils/__tests__/inapp-used-vars.verify.ts
import assert from 'node:assert';
import { extractUsedInAppVariables, INAPP_BROWSER_VAR_WHITELIST } from '../inapp-personalization';

function msg(over: Record<string, any> = {}) {
  return {
    title: '',
    body: '',
    buttons: [] as Array<{ label?: string }>,
    personalizationVars: [] as string[],
    ...over,
  };
}

// 1) 빈 메시지 → 빈 배열
assert.deepEqual(extractUsedInAppVariables([]), []);
assert.deepEqual(extractUsedInAppVariables([msg()]), []);

// 2) personalization_vars 명시 → 화이트리스트 교차 포함
let vars = extractUsedInAppVariables([msg({ personalizationVars: ['name', 'grade'] })]);
assert.ok(vars.includes('name'));
assert.ok(vars.includes('grade'));

// 3) 본문 옛 %변수% 패턴 스캔 → 컬럼명 매핑
vars = extractUsedInAppVariables([msg({ body: '%포인트% 적립 안내 %고객명%' })]);
assert.ok(vars.includes('points'));
assert.ok(vars.includes('name'));

// 4) 제목 Liquid {{ customer.X }} 스캔
vars = extractUsedInAppVariables([msg({ title: '{{ customer.region }} 지역 혜택' })]);
assert.ok(vars.includes('region'));

// 5) 버튼 라벨 스캔
vars = extractUsedInAppVariables([msg({ buttons: [{ label: '{{ customer.name }}님 보기' }] })]);
assert.ok(vars.includes('name'));

// 6) 화이트리스트 밖 변수(phone 등 개인정보)는 제외
vars = extractUsedInAppVariables([msg({ body: '{{ customer.phone }} %전화%' })]);
assert.ok(!vars.includes('phone'));
assert.equal(vars.length, 0);

// 7) 여러 메시지 합집합 + 중복 제거
vars = extractUsedInAppVariables([
  msg({ body: '%고객명%' }),
  msg({ title: '{{ customer.name }}', personalizationVars: ['points'] }),
]);
assert.equal(vars.filter((v: string) => v === 'name').length, 1);
assert.ok(vars.includes('points'));

// 8) %최근구매매장% → recent_purchase_store 매핑 + default 필터 동반 Liquid도 인식
vars = extractUsedInAppVariables([
  msg({ body: "%최근구매매장% / {{ customer.grade | default: '일반' }}" }),
]);
assert.ok(vars.includes('recent_purchase_store'));
assert.ok(vars.includes('grade'));

// 9) 화이트리스트에 phone 미포함 (브라우저 응답 동봉 차단)
assert.ok(!INAPP_BROWSER_VAR_WHITELIST.includes('phone'));
assert.ok(INAPP_BROWSER_VAR_WHITELIST.includes('name'));

console.log('inapp-used-vars.verify OK');
