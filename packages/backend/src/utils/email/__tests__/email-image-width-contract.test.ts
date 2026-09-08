/**
 * email-image-width-contract.test.ts — 이미지 폭 계약 (2026-09-08)
 *
 * 경위: 남지현 접수 `cmtqsp5uw09yujnot3k93uh62` "메일 수신 시 가로 폭 정렬".
 *   탑텐 캠페인 실측에서 본문 이미지 `<img>`에 **HTML 폭 속성이 하나도 없고 인라인 style만** 있었다.
 *   그 이미지 원본이 1792×2400이라, style을 해석하지 못하는 뷰어에서는 한 장이 그대로 펴져
 *   문서 폭을 1792px로 벌린다(하이웍스 수신에서 좌우 스크롤). 셸 폭을 아무리 고정해도
 *   **안에 든 이미지가 셸보다 넓으면 표가 벌어진다** — 그래서 폭 계약은 셸과 이미지 두 층이다.
 *
 * 계약: 렌더러가 내는 모든 `<img>`는 폭을 잡아 주는 HTML 속성을 하나 이상 가진다.
 *   `width`(px 또는 %)면 폭이 직접 잡히고, `height`만 있어도 브라우저가 비율로 폭을 계산하므로 안전하다
 *   (로고처럼 원본 비율이 제각각이라 폭을 못 박을 수 없는 자리가 그 경우다).
 *   ⛔ 속성 없이 style만 싣지 마라 — CSS를 지우는 뷰어에서 그 한 장이 문서 폭을 결정한다.
 */
import { describe, it, expect } from 'vitest';
import { renderEmailSections } from '../email-section-renderer';
import { ALL_SECTIONS, BACKGROUNDS, sec } from './email-all-sections.fixture';
import type { Section } from '../../dm/dm-section-registry';

const imgTags = (html: string): string[] => html.match(/<img\b[^>]*>/gi) || [];
const hasSizeAttr = (tag: string): boolean => /\s(width|height)\s*=\s*"/i.test(tag);

describe('이미지 폭 계약 — CSS를 못 읽는 뷰어에서도 폭이 잡힌다', () => {
  it('전 블록·전 구도: 모든 img가 width 또는 height 속성을 갖는다', () => {
    const html = renderEmailSections(ALL_SECTIONS, {});
    const tags = imgTags(html);
    expect(tags.length).toBeGreaterThan(0);          // 표본 0이면 계약이 아무것도 안 지킨다
    const naked = tags.filter((t) => !hasSizeAttr(t)).map((t) => t.slice(0, 200));
    expect(naked).toEqual([]);
  });

  it('배경면 5종에서도 같은 계약', () => {
    for (const bg of BACKGROUNDS) {
      const html = renderEmailSections(ALL_SECTIONS.map((s) => ({ ...s, background: bg }) as Section), {});
      const naked = imgTags(html).filter((t) => !hasSizeAttr(t)).map((t) => `[bg=${bg}] ${t.slice(0, 200)}`);
      expect(naked).toEqual([]);
    }
  });

  it('접수 재현 — 본문 이미지(text_card)는 552px로 잡힌다', () => {
    const html = renderEmailSections([sec('text_card', { headline: '쿠폰', body: '안내', image_url: 'https://ex.com/big.jpg' }, 0)], {});
    const tag = imgTags(html).find((t) => t.includes('big.jpg')) || '';
    expect(tag).toMatch(/\swidth="552"/);
    expect(tag).toContain('max-width:552px');        // 싣는 쪽(속성)과 덮는 쪽(CSS)을 함께 고정
  });

  it('폭을 못 박는 자리(로고)는 height 속성으로 비율이 잡힌다', () => {
    const html = renderEmailSections([sec('header', { variant: 'logo', brand_name: 'X', logo_url: 'https://ex.com/logo.png' }, 0)], {});
    const tag = imgTags(html).find((t) => t.includes('logo.png')) || '';
    expect(tag).toMatch(/\sheight="\d+"/);
  });
});
