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
import { BUBBLE_TYPES, BUBBLE_TYPE_OPENED, BUTTON_TYPES } from '../brand-message';

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
  'itemAdditional', 'itemAdditionalMax', 'itemAdditionalNewline', 'itemButtonMax', 'itemButtonMin',
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

/**
 * 버튼 종류 파리티 (★2026-09-22 신설)
 *
 * 왜 있나 — 위 유형 파리티는 있었는데 **버튼 종류에는 계약이 없었고, 그래서 갈렸다.**
 *   0922 박성용 지적 시점 실측: 백엔드 원장 8종(WL·AL·BK·MD·BF·BC·BT·AC) ↔ 발송 창 6종(AL·BF 없음)
 *   ↔ 템플릿 등록 화면 6종(BC·BT 없음). 셋이 서로 달랐고 고객은 앱링크를 쓸 방법이 없었다.
 *   화면에 없는 버튼은 "우리가 못 하는 기능"이 되고, 원장에 없는 버튼을 화면이 열면 규격 밖 값이
 *   큐를 지나 발송만 죽는다(0922 실측 = status_code 9999 · 차감만 남는다).
 *
 * 못 박는 것
 *   1. 발송 창 목록은 백엔드 원장의 부분집합이다(원장에 없는 코드를 화면이 열 수 없다).
 *   2. 원장에 있는데 화면에 없는 코드는 **보류 사유와 함께** 아래 목록에 있어야 한다.
 *      = 빠뜨린 것과 일부러 안 연 것을 코드가 구분하게 만든다.
 *   3. 라벨이 양쪽에서 같다(같은 버튼을 두 이름으로 부르지 않는다).
 */
const EDITOR = path.resolve(__dirname, '../../../../frontend/src/components/BrandMessageEditor.tsx');

/**
 * 원장에 있지만 발송 창에 아직 열지 않은 버튼 — 열 때 여기서 빼고 화면에 넣는다.
 * ⛔ 사유 없이 비워 두면 안 된다. 이 목록이 "빠뜨린 것"과 "일부러 안 연 것"을 가른다.
 */
const BUTTON_NOT_EXPOSED: Record<string, string> = {
  // ★2026-09-22 현재 비어 있다 = 원장 8종이 전부 발송 창에 열려 있다.
  //   비즈니스폼(BF)은 한때 여기 있었는데, 근거가 REST 템플릿 등록 API(`bizFormId` 정수)였다.
  //   발송이 타는 길은 소켓 전문이고 **연동규약서 v20251031 §3.4는 `Biz_form_key`(text)**로 적는다 —
  //   원장이 맞았고 화면만 비어 있었다. 「문서가 갈린다」로 덮기 전에 그 경로의 규격서를 찾는다.
};

/** 발송 창 BUTTON_TYPES 배열에서 code·label만 뽑는다 (TS 표현식이 섞여 JSON.parse는 못 쓴다) */
function parseEditorButtons(): { code: string; label: string }[] {
  const src = fs.readFileSync(EDITOR, 'utf8');
  const start = src.indexOf('export const BUTTON_TYPES = [');
  if (start < 0) {
    throw new Error('발송 창 BUTTON_TYPES 선언을 찾지 못했다 — 이름이 바뀌었으면 이 계약도 함께 고친다');
  }
  const open = src.indexOf('[', start);
  const end = src.indexOf('];', open);
  if (end < 0) throw new Error('발송 창 BUTTON_TYPES 배열의 끝을 찾지 못했다');
  const body = src.slice(open, end);
  const out: { code: string; label: string }[] = [];
  const re = /\{\s*code:\s*'([A-Z]{2})'\s*,\s*label:\s*'([^']+)'/g;
  for (let m = re.exec(body); m; m = re.exec(body)) out.push({ code: m[1], label: m[2] });
  return out;
}

describe('브랜드 버튼 종류 파리티 — 발송 창 ↔ 백엔드 원장', () => {
  const editor = parseEditorButtons();

  it('발송 창에서 코드를 읽어 낸다 (파싱 전제)', () => {
    expect(editor.length, '버튼 종류를 하나도 못 읽었다면 배열 모양이 바뀐 것이다').toBeGreaterThan(0);
  });

  it('화면이 여는 버튼은 전부 원장에 있다', () => {
    const unknown = editor.filter((b) => !BUTTON_TYPES[b.code]).map((b) => b.code);
    expect(unknown, '원장에 없는 버튼을 화면이 열면 규격 밖 값이 큐를 지나 발송만 죽는다').toEqual([]);
  });

  it('원장에 있는데 화면에 없는 버튼은 보류 사유를 갖는다', () => {
    const shown = new Set(editor.map((b) => b.code));
    const missing = Object.keys(BUTTON_TYPES).filter((c) => !shown.has(c));
    for (const code of missing) {
      expect(BUTTON_NOT_EXPOSED[code], `${code}가 화면에 없다 — 열거나, 왜 안 여는지 BUTTON_NOT_EXPOSED에 적는다`).toBeTruthy();
    }
  });

  it('보류 목록은 원장에 있는 코드만 담는다 (사라진 버튼의 사유가 남지 않게)', () => {
    for (const code of Object.keys(BUTTON_NOT_EXPOSED)) {
      expect(BUTTON_TYPES[code], `${code}는 원장에 없는데 보류 목록에 남아 있다`).toBeDefined();
    }
  });

  it('라벨이 양쪽에서 같다', () => {
    for (const b of editor) {
      expect(b.label, `${b.code} 라벨`).toBe(BUTTON_TYPES[b.code].label);
    }
  });
});
