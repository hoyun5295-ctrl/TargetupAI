/**
 * CT-12 브랜드메시지 msg_contents 조립·대체발송 매핑 — 2026-07-30 재구축 계약 고정
 *
 * 근거: 형식이 어긋난 msg_contents는 큐에는 들어가고 발송만 **오류 로그 없이** 버려진다.
 * 그래서 조립기의 출력 형태(필수 3키 대문자·지원 유형 게이트·대체발송 N/A/B)는
 * 런타임이 아니라 테스트가 지켜야 한다.
 */

import { describe, it, expect } from 'vitest';
import {
  buildBrandMsgContents,
  resolveBrandFallback,
  validateBrandMessage,
  isSupportedBubbleType,
  SUPPORTED_BUBBLE_TYPES,
  BrandMessageBuildError,
} from './brand-message';
import { getDisplayContents, getSendTypeLabel } from './sms-result-map';

describe('지원 유형 게이트 — TEXT·IMAGE·WIDE만', () => {
  it('지원 3종만 통과한다', () => {
    expect([...SUPPORTED_BUBBLE_TYPES]).toEqual(['TEXT', 'IMAGE', 'WIDE']);
    expect(isSupportedBubbleType('TEXT')).toBe(true);
    expect(isSupportedBubbleType('text')).toBe(true);
    expect(isSupportedBubbleType('WIDE_ITEM_LIST')).toBe(false);
    expect(isSupportedBubbleType('CAROUSEL_FEED')).toBe(false);
    expect(isSupportedBubbleType('PREMIUM_VIDEO')).toBe(false);
    expect(isSupportedBubbleType('COMMERCE')).toBe(false);
    expect(isSupportedBubbleType('CAROUSEL_COMMERCE')).toBe(false);
  });

  it('validateBrandMessage가 미지원 유형을 차감 전에 거부한다', () => {
    const base = {
      bubbleType: 'CAROUSEL_FEED' as any, senderKey: 'sk', phones: ['01000000000'],
      targeting: 'I', isAd: true, companyId: 'c', userId: 'u',
      carouselItems: [{}, {}] as any,
    };
    const r = validateBrandMessage(base as any);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('지원하지 않습니다');
  });
});

describe('buildBrandMsgContents — 필수 3키 대문자 JSON', () => {
  it('자유형 TEXT — TYPE_DEF/TARGETING/CHAT_BUBBLE_TYPE/MESSAGE', () => {
    const j = JSON.parse(buildBrandMsgContents({
      typeDef: 'FREE', targeting: 'I', bubbleType: 'TEXT', message: '본문',
    }));
    expect(j).toEqual({ TYPE_DEF: 'FREE', TARGETING: 'I', CHAT_BUBBLE_TYPE: 'TEXT', MESSAGE: '본문' });
  });

  it('HEADER·ATTACHMENT가 있으면 대문자 키로 실린다', () => {
    const j = JSON.parse(buildBrandMsgContents({
      typeDef: 'FREE', targeting: 'M', bubbleType: 'IMAGE', message: 'm', header: '헤더',
      attachmentJson: JSON.stringify({ button: [{ name: 'b', type: 'WL', url_mobile: 'https://x' }] }),
    }));
    expect(j.HEADER).toBe('헤더');
    expect(j.ATTACHMENT.button[0].type).toBe('WL');
  });

  it('자유형인데 본문이 비면 throw — 무로그 폐기 대신 적재 전 차단', () => {
    expect(() => buildBrandMsgContents({ typeDef: 'FREE', targeting: 'I', bubbleType: 'TEXT', message: ' ' }))
      .toThrow(BrandMessageBuildError);
  });

  it('미지원 유형·캐러셀·깨진 ATTACHMENT·잘못된 TARGETING 전부 throw', () => {
    expect(() => buildBrandMsgContents({ typeDef: 'FREE', targeting: 'I', bubbleType: 'COMMERCE', message: 'm' })).toThrow();
    expect(() => buildBrandMsgContents({ typeDef: 'FREE', targeting: 'I', bubbleType: 'TEXT', message: 'm', carouselJson: '[]' })).toThrow();
    expect(() => buildBrandMsgContents({ typeDef: 'FREE', targeting: 'I', bubbleType: 'TEXT', message: 'm', attachmentJson: '{깨짐' })).toThrow();
    expect(() => buildBrandMsgContents({ typeDef: 'FREE', targeting: 'X', bubbleType: 'TEXT', message: 'm' })).toThrow();
  });

  it('기본형 — MESSAGE 키를 넣지 않는다(매뉴얼: 내용은 템플릿 몫)', () => {
    const tcd = JSON.parse(buildBrandMsgContents({ typeDef: 'BASIC_TCD', targeting: 'I', bubbleType: 'TEXT' }));
    expect(tcd).toEqual({ TYPE_DEF: 'BASIC_TCD', TARGETING: 'I', CHAT_BUBBLE_TYPE: 'TEXT' });

    const varJ = JSON.parse(buildBrandMsgContents({
      typeDef: 'BASIC_VAR', targeting: 'I', bubbleType: 'TEXT',
      messageVariableJson: JSON.stringify({ 변수명: '따스함' }),
    }));
    expect(varJ.MESSAGE_VARIABLE).toEqual({ 변수명: '따스함' });
    expect(varJ.MESSAGE).toBeUndefined();
  });

  it('BASIC_VAR인데 변수가 없으면 throw', () => {
    expect(() => buildBrandMsgContents({ typeDef: 'BASIC_VAR', targeting: 'I', bubbleType: 'TEXT' })).toThrow();
  });
});

describe('resolveBrandFallback — 화면 축(NO/SM/LM/MM) → 큐 축(N/A/B)', () => {
  it('NO→N (대체 없음, 문구·제목 불요)', () => {
    expect(resolveBrandFallback({ resendType: 'NO' })).toEqual({ nextType: 'N' });
    expect(resolveBrandFallback({})).toEqual({ nextType: 'N' });
  });

  it('SM→A — 대체문안이 없으면 원문 본문을 쓴다(브랜드는 원문그대로 S/L 불가)', () => {
    expect(resolveBrandFallback({ resendType: 'SM', originalMessage: '원문' }))
      .toEqual({ nextType: 'A', nextContents: '원문' });
    expect(resolveBrandFallback({ resendType: 'SM', resendMessage: '대체', originalMessage: '원문' }))
      .toEqual({ nextType: 'A', nextContents: '대체' });
  });

  it('LM→B — 제목 필수, 없으면 throw', () => {
    expect(resolveBrandFallback({ resendType: 'LM', resendMessage: '대체', resendTitle: '제목' }))
      .toEqual({ nextType: 'B', nextContents: '대체', titleStr: '제목' });
    expect(() => resolveBrandFallback({ resendType: 'LM', resendMessage: '대체' })).toThrow(BrandMessageBuildError);
  });

  it('A/B인데 문구가 전혀 없으면 throw — 빈 대체문안을 큐에 넣지 않는다', () => {
    expect(() => resolveBrandFallback({ resendType: 'SM' })).toThrow(BrandMessageBuildError);
  });

  it('MM은 지원하지 않는다 — 조용한 실패 대신 즉시 거부', () => {
    expect(() => resolveBrandFallback({ resendType: 'MM', originalMessage: 'm' })).toThrow(BrandMessageBuildError);
  });
});

describe('결과 표시 — 브랜드 행(msg_type=F)', () => {
  it("라벨 'F' → 브랜드메시지", () => {
    expect(getSendTypeLabel('F')).toBe('브랜드메시지');
  });

  it('본문 표시 — JSON에서 MESSAGE만 풀고, 기본형은 안내 문구, 타 유형은 원문 그대로', () => {
    const free = JSON.stringify({ TYPE_DEF: 'FREE', TARGETING: 'I', CHAT_BUBBLE_TYPE: 'TEXT', MESSAGE: '본문' });
    expect(getDisplayContents('F', free)).toBe('본문');
    const basic = JSON.stringify({ TYPE_DEF: 'BASIC_TCD', TARGETING: 'I', CHAT_BUBBLE_TYPE: 'TEXT' });
    expect(getDisplayContents('F', basic)).toBe('(기본형 템플릿 발송)');
    expect(getDisplayContents('L', '일반 LMS 본문')).toBe('일반 LMS 본문');
    expect(getDisplayContents('F', 'JSON 아님')).toBe('JSON 아님');
  });
});
