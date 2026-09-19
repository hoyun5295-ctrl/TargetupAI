/**
 * ★ 2026-09-19 남지현 접수 `cmu51p03g05t8jnlufxnmty1a` (P0) — 대행발송 메일 접수 문안에 무료수신거부가 두 번 들어간다.
 *
 * 고객 원문 끝에 `무료 수신거부 : 080-139-5626`(띄어쓰기·콜론)이 이미 있었는데, (광고)+080 CT(buildAdMessage)가
 * 기존 문구를 `/무료수신거부|무료거부/`(붙여 쓴 형태)로만 찾아 `무료수신거부 080-139-5626`을 한 줄 더 붙였다.
 * 이 CT를 지나는 스팸 테스트·받는 사람별 미리보기·실제 발송만 중복이었고, 원문을 그대로 그리는 승인 링크·홈페이지는
 * 정상이었다(접수 원문 그대로).
 *
 * 계약: 수신거부 문구 판정은 띄어쓰기·콜론을 허용한다(같은 파일 stripAdPartsDeep 과 같은 너비).
 *       프론트 미리보기 미러(formatDate.ts buildAdMessageFront)도 **같은 식**이어야 한다 — 다르면 화면 ≠ 발송.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { buildAdMessage, prepareSendMessage, AD_REJECT_FOOTER_RE } from '../messageUtils';

const OPT = '080-139-5626';
// 접수 캡처(폴라초이스 0918 LMS) 문안의 앞·뒤를 그대로 옮긴 축약본
const CUSTOMER = '(광고) 환절기 자외선 잔여 손상과\n칙칙해진 톤이 신경 쓰이는 요즘.\n\nSKINCARE THAT KEEPS ITS PROMISES\n폴라초이스\n\n무료 수신거부 : 080-139-5626';

describe('수신거부 문구 판정 — 띄어쓰기·콜론 변형도 이미 있는 것으로 본다', () => {
  it('접수 문안(무료 수신거부 : 080…)에 두 번째 줄을 붙이지 않는다', () => {
    const out = buildAdMessage(CUSTOMER, 'LMS', true, OPT);
    expect(out).toBe(CUSTOMER);
    expect(out.match(/수신\s*거부/g)?.length).toBe(1);
  });

  it.each([
    ['무료 수신거부 080-139-5626'],
    ['무료수신 거부 080-139-5626'],
    ['무료 수신 거부: 080-139-5626'],
    ['무료수신거부 080-139-5626'],
  ])('LMS 변형 %s → 그대로', (footer) => {
    const msg = `본문\n\n${footer}`;
    expect(buildAdMessage(msg, 'LMS', true, OPT)).toBe(`(광고) ${msg}`);
  });

  it.each([['무료거부 0801395626'], ['무료 거부 0801395626']])('SMS 변형 %s → 그대로', (footer) => {
    const msg = `본문\n${footer}`;
    expect(buildAdMessage(msg, 'SMS', true, OPT)).toBe(`(광고)${msg}`);
  });

  it('문구가 없으면 종전처럼 붙인다(LMS·SMS)', () => {
    expect(buildAdMessage('본문', 'LMS', true, OPT)).toBe(`(광고) 본문\n무료수신거부 ${OPT}`);
    expect(buildAdMessage('본문', 'SMS', true, OPT)).toBe('(광고)본문\n무료거부0801395626');
  });

  it('"수신거부"만 있고 "무료"가 없으면 이미 있는 것으로 보지 않는다(법정 문구는 무료 수신거부)', () => {
    expect(buildAdMessage('본문\n수신거부 080-139-5626', 'LMS', true, OPT)).toContain(`\n무료수신거부 ${OPT}`);
  });

  it('두 번 적용해도 같다(멱등)', () => {
    const once = buildAdMessage('본문', 'LMS', true, OPT);
    expect(buildAdMessage(once, 'LMS', true, OPT)).toBe(once);
    expect(buildAdMessage(CUSTOMER, 'LMS', true, OPT)).toBe(buildAdMessage(buildAdMessage(CUSTOMER, 'LMS', true, OPT), 'LMS', true, OPT));
  });

  it('발송·미리보기 조립(prepareSendMessage)도 중복이 없다 — 대행 미리보기·실발송이 부르는 함수', () => {
    const { message } = prepareSendMessage(CUSTOMER, {}, {}, { msgType: 'LMS', isAd: true, opt080Number: OPT });
    expect(message).toBe(CUSTOMER);
  });
});

describe('프론트 미리보기 미러가 같은 판정식을 쓴다', () => {
  const candidates = [
    path.resolve(process.cwd(), '../frontend/src/utils/formatDate.ts'),
    path.resolve(process.cwd(), 'packages/frontend/src/utils/formatDate.ts'),
  ];
  const src = fs.readFileSync(candidates.find((p) => fs.existsSync(p)) || candidates[0], 'utf8');

  it('formatDate.ts AD_REJECT_FOOTER_RE = 백엔드 AD_REJECT_FOOTER_RE', () => {
    const m = /const AD_REJECT_FOOTER_RE = \/(.+)\/;/.exec(src);
    expect(m, 'formatDate.ts에 AD_REJECT_FOOTER_RE 정의가 없다').toBeTruthy();
    expect(m![1]).toBe(AD_REJECT_FOOTER_RE.source);
  });

  it('buildAdMessageFront가 그 식으로 판정한다(옛 붙여 쓴 식 잔존 0)', () => {
    expect(src).toContain('const hasRejectFooter = AD_REJECT_FOOTER_RE.test(message);');
    expect(src).not.toContain('/무료수신거부|무료거부/.test(message)');
  });
});
