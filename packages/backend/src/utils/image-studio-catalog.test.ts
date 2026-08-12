/**
 * 이미지 스튜디오 카탈로그 계약 (★ 2026-08-11 · +64종 확장과 함께 신설).
 *
 * 카탈로그는 데이터만 늘어나는 파일이라 사람 눈으로만 검수해 왔다. 249종을 넘기면서
 * **손으로 못 지키는 규약**을 여기에 고정한다(규약 원문 = `docs/FEATURE-IMAGE-STUDIO.md` §2·§4).
 *
 * 여기서 막는 것:
 *  ① `id` 중복 — 중복이면 `getTemplate`이 앞의 것만 돌려주고 뒤 항목은 영영 안 열린다(§4-2 grep 규약의 자동화판).
 *  ② 은닉 필드 유출 — `scaffold`·`textStyle`이 공개 응답에 섞이면 프롬프트가 그대로 공개된다(§2-1).
 *  ③ 혜택 수치·브랜드 실명 — 고객 노출 문자열에 `%`·`원`·쿠폰·무료가 들어가면 AI가 지어낸 혜택처럼 읽힌다(§2-2).
 *  ④ 추천 용도 누락 — 화면이 이 값으로 고르게 하므로 빈 항목이 있으면 그 템플릿만 근거 없이 놓인다.
 */
import { describe, it, expect } from 'vitest';
import { STUDIO_TEMPLATES, listTemplatesPublic } from './image-studio-templates';

/**
 * §2-2 금지 표기를 두 층으로 나눈다 — **어디에 쓰였는가로 죄가 갈린다.**
 *
 * - `AMOUNT`(수치) = 어디에도 못 쓴다. 카탈로그가 금액·비율을 말하는 순간 우리가 혜택을 지어낸 것이 된다.
 * - `OFFER_WORD`(쿠폰·무료) = **포스터에 들어갈 예시 문구**(sample·defaultTexts)에서만 금지다.
 *   `name`·`desc`·`useCase`는 템플릿을 고르는 메뉴 라벨이라 "쿠폰 티켓 모양의 디자인"을 그렇게 부를 수밖에 없다.
 *   그림의 모티프를 가리키는 말과, 포스터에 새겨질 약속은 다르다.
 */
const AMOUNT = /(\d+\s*%|\d[\d,]*\s*원)/;
const OFFER_WORD = /(쿠폰|무료)/;
const PLACEHOLDER = '[혜택은 직접 입력해주세요]';

describe('이미지 스튜디오 카탈로그', () => {
  it('id가 중복되지 않는다 — 중복이면 뒤 항목은 영영 열리지 않는다', () => {
    const ids = STUDIO_TEMPLATES.map((t) => t.id);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dup, `중복 id: ${Array.from(new Set(dup)).join(', ')}`).toEqual([]);
  });

  it('모든 항목이 추천 용도를 갖는다 — 화면이 이 값으로 고르게 한다', () => {
    const empty = STUDIO_TEMPLATES.filter((t) => !t.useCase || !t.useCase.trim()).map((t) => t.id);
    expect(empty, `useCase 누락: ${empty.join(', ')}`).toEqual([]);
  });

  it('공개 목록에 은닉 프롬프트가 새지 않는다 — 새면 우리와 자유 프롬프트 도구가 같아진다', () => {
    const pub = listTemplatesPublic();
    expect(pub.length).toBe(STUDIO_TEMPLATES.length);
    for (const row of pub as any[]) {
      expect(row.scaffold, `${row.id}: scaffold 유출`).toBeUndefined();
      expect(row.textStyle, `${row.id}: textStyle 유출`).toBeUndefined();
    }
    // 공개돼야 하는 축은 반대로 빠지면 안 된다.
    expect(pub[0]).toHaveProperty('useCase');
    expect(pub[0]).toHaveProperty('exampleUrl');
  });

  it('고객 노출 문자열 어디에도 금액·비율이 없다 — 카탈로그가 수치를 말하면 지어낸 혜택이 된다', () => {
    const bad: string[] = [];
    for (const t of STUDIO_TEMPLATES) {
      for (const [field, value] of [
        ['name', t.name], ['desc', t.desc], ['useCase', t.useCase],
        ['sample.title', t.sample?.title], ['sample.subtitle', t.sample?.subtitle],
        ['defaultTexts.title', t.defaultTexts?.title], ['defaultTexts.subtitle', t.defaultTexts?.subtitle],
      ] as const) {
        // {salePrice}는 몰 실데이터 치환 토큰이라 수치가 아니다(사용자 데이터가 들어온다).
        if (value && value !== '{salePrice}' && AMOUNT.test(value)) bad.push(`${t.id}.${field}: ${value}`);
      }
    }
    expect(bad, `금액·비율 표기 검출:\n${bad.join('\n')}`).toEqual([]);
  });

  it('포스터에 들어갈 예시 문구에 혜택 약속이 없다 — 그림에 새겨지면 우리가 약속한 것이 된다', () => {
    const bad: string[] = [];
    for (const t of STUDIO_TEMPLATES) {
      for (const [field, value] of [
        ['sample.title', t.sample?.title], ['sample.subtitle', t.sample?.subtitle],
        // label도 포스터 상단에 그대로 새겨진다 — 제목·부제만 보면 절반만 막는다.
        ['defaultTexts.label', t.defaultTexts?.label],
        ['defaultTexts.title', t.defaultTexts?.title], ['defaultTexts.subtitle', t.defaultTexts?.subtitle],
      ] as const) {
        if (!value || value === PLACEHOLDER || value === '{salePrice}' || value === '{productName}') continue;
        if (OFFER_WORD.test(value)) bad.push(`${t.id}.${field}: ${value}`);
      }
    }
    expect(bad, `예시 문구에 혜택 약속:\n${bad.join('\n')}`).toEqual([]);
  });

  it('트랙·카테고리가 계약대로다 — 행사 트랙은 kind가 명시돼 있어야 화면 탭이 갈린다', () => {
    const EVENT_CATEGORIES = ['멤버십·고객감사', '오픈·기념일', '시즌·명절 행사', '팝업·페스티벌', '데이·기념일', '클래스·체험'];
    const wrong = STUDIO_TEMPLATES
      .filter((t) => EVENT_CATEGORIES.includes(t.category) && t.kind !== 'event')
      .map((t) => t.id);
    expect(wrong, `행사 카테고리인데 kind가 event가 아니다: ${wrong.join(', ')}`).toEqual([]);

    const strayEvent = STUDIO_TEMPLATES
      .filter((t) => t.kind === 'event' && !EVENT_CATEGORIES.includes(t.category))
      .map((t) => t.id);
    expect(strayEvent, `제품 카테고리인데 kind가 event다: ${strayEvent.join(', ')}`).toEqual([]);
  });
});
