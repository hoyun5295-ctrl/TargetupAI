/**
 * dm-short-link-slug.test.ts — 외부 URL 단축의 한글 주소 지정 + 단가 계약 (★ 2026-09-16 박성용 접수)
 *
 * 접수 = "단축 URL 생성 시 난수 외에 한글 주소도 만들 수 있게". 부품은 이미 다 있었다 —
 * 검증(validateCustomSlug)·충돌 검사(isSlugAvailable)·NFC·리다이렉트가 **발행 DM 별칭 경로에만** 배선돼
 * 있었고 외부 URL 단축은 난수 발급기에 묶여 있었다. 그래서 같은 목록에 한글과 난수가 섞여 보였다.
 *
 * 런타임 테스트로는 "두 입구가 같은 검증을 쓰는가"·"단가가 두 곳에서 같은가"가 안 잡힌다 — 소스로 밟는다.
 * (검증 규칙 자체의 계약은 dm-custom-short-link-core.test.ts가 이미 소유한다 — 여기서 다시 세우지 않는다.)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const ctSrc = read('../dm-custom-short-link.ts');
const routeSrc = read('../../../routes/dm.ts');
const creditSrc = read('../../ai-credit-calc.ts');
const feCreditSrc = read('../../../../../frontend/src/constants/credit.ts');
const modalSrc = read('../../../../../frontend/src/components/dm/DmShortLinkModal.tsx');

describe('한글 주소 — 두 입구가 같은 규칙을 쓴다', () => {
  it('라우트가 지정 주소를 validateCustomSlug로만 받는다 — 발행 DM 별칭과 같은 함수', () => {
    // 규칙을 한 곳에서만 정의해야 "DM 별칭은 되는데 단축은 안 되는" 어긋남이 생기지 않는다.
    expect(routeSrc).toContain('const s = validateCustomSlug(rawSlug)');
    expect(routeSrc, '검증 통과값(NFC)만 CT로 넘겨야 한다').toContain('slug = s.slug');
    expect(routeSrc).toContain('createCustomShortLink({ companyId, userId, targetUrl: v.url, title, slug })');
  });

  it('CT가 지정 주소일 때만 선점을 보고, 미지정이면 종전 난수다', () => {
    expect(ctSrc).toContain('if (wanted && !(await isSlugAvailable(wanted, null))) throw new ShortLinkSlugTakenError(wanted)');
    expect(ctSrc, '미지정 경로가 난수 발급기를 잃으면 안 된다').toContain('const code = wanted || await issueUniqueCode()');
  });

  it('선점과 경합이 같은 예외로 모인다 — 호출부가 한 가지만 처리한다', () => {
    // isSlugAvailable 과 INSERT 사이의 창은 UNIQUE(code)가 막는다. 그 23505를 따로 흘리면
    // 사용자는 같은 상황에서 다른 메시지를 본다.
    expect(ctSrc).toContain("if (String(err?.code) === '23505' && wanted) throw new ShortLinkSlugTakenError(wanted)");
    expect(routeSrc).toContain('err instanceof ShortLinkSlugTakenError');
    expect(routeSrc).toContain("code: 'SHORT_LINK_SLUG_TAKEN'");
  });

  it('선점 실패는 크레딧 차감보다 앞에서 끝난다 — 과금 0', () => {
    const create = routeSrc.indexOf('const link = await createCustomShortLink(');
    const deduct = routeSrc.indexOf("source: 'dm-custom-short-link', createdBy: userId");
    expect(create).toBeGreaterThan(-1);
    expect(deduct).toBeGreaterThan(-1);
    expect(create, '차감이 발급보다 앞서면 실패한 발급에 과금된다').toBeLessThan(deduct);
  });

  it('일일 상한 판정이 INSERT 단문 결합으로 남아 있다 — 지정 주소가 상한을 우회하지 않는다', () => {
    expect(ctSrc).toContain('WHERE (SELECT COUNT(*) FROM dm_custom_short_links');
    expect(ctSrc).toContain('< $6');
  });
});

describe('단축 URL 단가 — 원장 하나에서 읽는다 (2026-09-16 100 → 20)', () => {
  it('백엔드·프론트 단가가 같다 — 한쪽만 바꾸면 모달 표시가 실차감과 어긋난다', () => {
    expect(creditSrc).toContain("'dm-custom-short-link': 20,");
    expect(feCreditSrc).toContain("'dm-custom-short-link': 20,");
  });

  it('20 이상이라 확인 모달이 유지된다 — 되돌릴 수 없는 발급 앞의 관문', () => {
    // 한 번 쓴 코드는 비활성해도 재사용이 막힌다(옛 링크가 새 대상으로 가면 안 된다).
    // 그래서 오타 하나가 그 이름을 영구히 죽인다 — 확인 창은 클릭이 아니라 이름 자원을 지킨다.
    const m = /'dm-custom-short-link':\s*(\d+)/.exec(feCreditSrc);
    expect(m, '프론트 단가 등록이 없다').toBeTruthy();
    expect(Number(m![1])).toBeGreaterThanOrEqual(20);
    expect(modalSrc).toContain('source="dm-custom-short-link"');
  });

  it('모달 안내 문구가 단가를 하드코딩하지 않는다 — 값이 바뀌는 날 거짓말이 된다', () => {
    expect(modalSrc).toContain("const SHORT_LINK_CREDIT = CONFIRM_CREDIT_COSTS['dm-custom-short-link']");
    expect(modalSrc).toContain('발급 1건 = {SHORT_LINK_CREDIT}크레딧');
    expect(modalSrc, '옛 하드코딩이 남아 있다').not.toContain('발급 1건 = 100크레딧');
  });

  it('지정 주소면 확인 창이 그 주소를 그대로 보여준다 — 오타가 영구 손실이라', () => {
    expect(modalSrc).toContain('hlj.kr/${slug.trim()} 주소로 발급합니다');
  });
});
