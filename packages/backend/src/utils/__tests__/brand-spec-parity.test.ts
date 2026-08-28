/**
 * 브랜드메시지 규격 파리티 계약 (★2026-08-28 자유형 5종 개통)
 *
 * 왜 있나
 *   규격의 원본은 백엔드 `utils/brand-message.ts`의 `BUBBLE_TYPES` + `BUBBLE_TYPE_OPENED`다.
 *   그런데 등록 화면은 글자수·개수를 **입력 중에** 막아 줘야 해서 서버 응답을 기다릴 수 없고,
 *   같은 값을 프론트에도 둘 수밖에 없다. **사본은 갈라진다** — 실제로 갈라져 있었다:
 *     와이드리스트 아이템 = CT 5 / 화면 4 · 캐러셀 카드 = CT 6 / 화면 10·11 · 버튼명 = CT 축 없음 / 화면 14 고정.
 *   그 상태로 등록된 템플릿은 화면을 통과하고 발송에서 죽는다(규격 밖은 무로그 폐기).
 *
 * 못 박는 것
 *   1. 유형 집합이 양쪽에서 같다(하나가 늘거나 줄면 깨진다).
 *   2. 유형마다 모든 숫자·불리언 축이 정확히 같다.
 *   3. 캐러셀 서브 규격도 축 단위로 같다.
 *   4. `opened`(발송 개방)가 백엔드 원장과 같다 — 화면이 열리지 않은 유형을 열린 것처럼 보이면 안 된다.
 *
 * ⚠ 프론트 소스를 **텍스트로 읽어** 비교한다(패키지 경계를 넘는 import를 만들지 않는다).
 *   선례 = `admin-role-label-parity.test.ts` · `audit-action-labels.test.ts`.
 *
 * 고치는 법 — 백엔드를 고치고 프론트 파일을 다시 뽑아 넣는다. 프론트만 고치면 이 테스트가 깨진다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BUBBLE_TYPES, BUBBLE_TYPE_OPENED } from '../brand-message';

const FRONT = path.resolve(__dirname, '../../../../frontend/src/constants/brand-message-spec.ts');

/** 프론트 파일에서 BRAND_SPEC 객체 리터럴만 뽑아 파싱한다 (JSON 리터럴로 유지되고 있다) */
function parseFrontSpec(): Record<string, any> {
  const src = fs.readFileSync(FRONT, 'utf8');
  const start = src.indexOf('export const BRAND_SPEC: Record<string, BrandSpec> = {');
  if (start < 0) {
    throw new Error('프론트 BRAND_SPEC 선언을 찾지 못했다 — 이름이 바뀌었으면 이 계약도 함께 고친다');
  }
  const open = src.indexOf('{', start);
  // 중괄호 균형으로 리터럴 끝을 찾는다(문자열 안 중괄호는 이 파일 값에 없다 — 아래 sanity가 지킨다)
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end < 0) throw new Error('프론트 BRAND_SPEC 리터럴의 끝을 찾지 못했다');
  return JSON.parse(src.slice(open, end + 1));
}

/** 비교 대상 축 — 여기 없는 축은 검사되지 않는다. 백엔드에 축을 더하면 이 목록도 함께 늘린다 */
const SPEC_KEYS = [
  'code', 'label', 'maxMessage', 'maxNewline', 'maxButtons', 'minButtons',
  'couponMaxButtons', 'couponDescMax', 'maxHeader',
  'requireImage', 'requireHeader', 'requireVideo', 'requireCommerce',
  'minItems', 'maxItems', 'maxButtonName', 'maxAdditional', 'maxAdditionalNewline', 'maxCommerceTitle',
] as const;

const CAROUSEL_KEYS = [
  'allowIntro', 'introHeaderMax', 'introContentMax', 'introContentNewline',
  'listMinWithIntro', 'listMaxWithIntro', 'listMin', 'listMax',
  'itemHeader', 'itemHeaderMax', 'itemMessage', 'itemMessageMax', 'itemMessageNewline',
  'itemAdditional', 'itemAdditionalMax', 'itemAdditionalNewline', 'itemButtonMax',
] as const;

describe('브랜드메시지 규격은 백엔드와 프론트가 같다', () => {
  const front = parseFrontSpec();

  it('추출 자체가 비면 이 계약이 죽은 것이다', () => {
    expect(Object.keys(front).length).toBeGreaterThan(0);
  });

  it('유형 집합이 같다', () => {
    expect(Object.keys(front).sort()).toEqual(Object.keys(BUBBLE_TYPES).sort());
  });

  it.each(Object.keys(BUBBLE_TYPES))('%s: 모든 규격 축이 같다', (code) => {
    const be = BUBBLE_TYPES[code] as any;
    const fe = front[code];
    expect(fe, `${code}가 프론트에 없다`).toBeDefined();
    for (const key of SPEC_KEYS) {
      expect(fe[key], `${code}.${key}`).toBe(be[key]);
    }
  });

  it.each(Object.keys(BUBBLE_TYPES))('%s: 캐러셀 규격이 같다', (code) => {
    const be = (BUBBLE_TYPES[code] as any).carousel;
    const fe = front[code].carousel;
    if (!be) {
      expect(fe, `${code}는 캐러셀 유형이 아닌데 프론트에 캐러셀 규격이 있다`).toBeUndefined();
      return;
    }
    expect(fe, `${code}의 캐러셀 규격이 프론트에 없다`).toBeDefined();
    for (const key of CAROUSEL_KEYS) {
      expect(fe[key], `${code}.carousel.${key}`).toBe(be[key]);
    }
  });

  it('발송 개방 상태가 원장과 같다', () => {
    for (const code of Object.keys(BUBBLE_TYPES)) {
      expect(front[code].opened, `${code}.opened`).toBe(!!BUBBLE_TYPE_OPENED[code]);
    }
  });

  it('프론트 값에 중괄호를 담은 문자열이 없다 (위 파싱이 성립하는 전제)', () => {
    const src = fs.readFileSync(FRONT, 'utf8');
    const literal = src.slice(src.indexOf('export const BRAND_SPEC')).split('};')[0];
    // ⛔ 개행을 넘나드는 `[^"]*`는 오탐한다 — 한 줄 안에서만 본다.
    const bad = literal.split('\n').filter((l) => /"[^"\n]*[{}][^"\n]*"/.test(l));
    expect(bad, '값에 중괄호가 들어가면 중괄호 균형 파싱이 깨진다').toEqual([]);
  });
});
