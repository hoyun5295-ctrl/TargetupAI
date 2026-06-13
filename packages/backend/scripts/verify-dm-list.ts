/**
 * DM 목록 썸네일 요약 순수 로직 검증 (DB 의존 0).
 * 실행: cd packages/backend && npx ts-node scripts/verify-dm-list.ts
 */
import { buildSectionSummary } from '../src/utils/dm/dm-builder';

let pass = 0, fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.error(`  FAIL  ${name}`); }
}

console.log('[1] sections 기반 요약');
{
  const row = {
    brand_kit: { primary_color: '#ec4899' },
    sections: [
      { type: 'cta', order: 3, visible: true, props: { buttons: [] } },
      { type: 'hero', order: 1, visible: true, props: { headline: '여름 신상 입고' } },
      { type: 'coupon', order: 2, visible: true, props: {} },
    ],
  };
  const s = buildSectionSummary(row);
  ok('order순 정렬 (hero→coupon→cta)', JSON.stringify(s.types) === JSON.stringify(['hero', 'coupon', 'cta']));
  ok('headline = 첫 hero', s.headline === '여름 신상 입고');
  ok('accent = brand primary', s.accent === '#ec4899');
  ok('count = 3', s.count === 3);
}

console.log('[2] visible=false 제외 + 6개 캡');
{
  const sections = Array.from({ length: 9 }, (_, i) => ({ type: `t${i}`, order: i, visible: i !== 0, props: {} }));
  const s = buildSectionSummary({ sections });
  ok('visible=false(t0) 제외', !s.types.includes('t0'));
  ok('types 최대 6개', s.types.length === 6);
  ok('count = visible 8개', s.count === 8);
}

console.log('[3] headline 폴백 (hero 없음 → header brand_name → text body)');
{
  const s1 = buildSectionSummary({ sections: [{ type: 'header', order: 1, visible: true, props: { brand_name: '브랜드A' } }] });
  ok('header brand_name 추출', s1.headline === '브랜드A');
  const s2 = buildSectionSummary({ sections: [{ type: 'text_card', order: 1, visible: true, props: { body: '본문 텍스트' } }] });
  ok('text_card body 추출', s2.headline === '본문 텍스트');
  const s3 = buildSectionSummary({ sections: [{ type: 'coupon', order: 1, visible: true, props: {} }] });
  ok('추출 대상 없으면 null', s3.headline === null);
}

console.log('[4] legacy pages (sections 없음)');
{
  const s = buildSectionSummary({ pages: [{}, {}, {}], brand_kit: null });
  ok('types 빈 배열', s.types.length === 0);
  ok('count = pages 길이', s.count === 3);
  ok('accent null', s.accent === null);
}

console.log('[5] 빈/누락 입력 방어');
{
  const s = buildSectionSummary({});
  ok('전부 없으면 count 0', s.count === 0 && s.types.length === 0 && s.headline === null && s.accent === null);
  const s2 = buildSectionSummary({ sections: [] });
  ok('빈 sections → legacy 분기 count 0', s2.count === 0);
  const s3 = buildSectionSummary({ sections: 'not-an-array' as any });
  ok('비배열 sections 방어', s3.count === 0);
}

console.log('[6] headline 60자 캡');
{
  const long = '가'.repeat(80);
  const s = buildSectionSummary({ sections: [{ type: 'hero', order: 1, visible: true, props: { headline: long } }] });
  ok('headline 60자 컷', s.headline !== null && s.headline.length === 60);
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
