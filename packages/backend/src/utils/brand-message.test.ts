/**
 * CT-12 브랜드메시지 적재 규약 조립·대체발송 매핑 — 2026-08-15 경계 규약 정정 계약 고정
 *
 * 근거: 형식이 어긋난 적재는 큐에는 들어가고 발송만 **오류 로그 없이** 버려진다.
 * 규약 = msg_contents(내용물: 자유형 순수 본문 / 기본형 TYPE_DEF+변수 JSON)
 *      + k_etc_json(제어·부가: senderkey·CHAT_BUBBLE_TYPE·TARGETING·AD_FLAG·PUSH_ALARM·
 *        HEADER·ADDITIONAL_CONTENT·UNSUBSCRIBE_*·ATTACHMENT — varchar(1024) 한도).
 * 이 형태는 런타임이 아니라 테스트가 지켜야 한다.
 */

import { describe, it, expect } from 'vitest';
import {
  buildBrandQueuePayload,
  resolveBrandFallback,
  validateBrandMessage,
  isSupportedBubbleType,
  SUPPORTED_BUBBLE_TYPES,
  BrandMessageBuildError,
} from './brand-message';
import { getDisplayContents, getSendTypeLabel } from './sms-result-map';

const FREE_BASE = {
  typeDef: 'FREE' as const, senderKey: 'sk-test', targeting: 'I', bubbleType: 'TEXT', isAd: true, message: '본문',
};

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

describe('buildBrandQueuePayload — 자유형: msg_contents=순수 본문 / k_etc_json=제어·부가', () => {
  it('본문은 평문 그대로, JSON이 아니다 (관리 화면 본문 노출 결함의 뿌리 차단)', () => {
    const { msgContents } = buildBrandQueuePayload({ ...FREE_BASE });
    expect(msgContents).toBe('본문');
    expect(() => JSON.parse(msgContents)).toThrow();
  });

  it('k_etc_json에 필수 5키가 전부 명시된다 — 게이트웨이 기본값에 맡기지 않는다', () => {
    const etc = JSON.parse(buildBrandQueuePayload({ ...FREE_BASE }).etcJson);
    expect(etc).toEqual({
      senderkey: 'sk-test', CHAT_BUBBLE_TYPE: 'TEXT', TARGETING: 'I', AD_FLAG: 'Y', PUSH_ALARM: 'Y',
    });
  });

  it('AD_FLAG는 사용자 선택값 그대로 — isAd:false면 N', () => {
    const etc = JSON.parse(buildBrandQueuePayload({ ...FREE_BASE, isAd: false }).etcJson);
    expect(etc.AD_FLAG).toBe('N');
  });

  it('PUSH_ALARM — 기본 Y, false 명시 시 N', () => {
    expect(JSON.parse(buildBrandQueuePayload({ ...FREE_BASE }).etcJson).PUSH_ALARM).toBe('Y');
    expect(JSON.parse(buildBrandQueuePayload({ ...FREE_BASE, pushAlarm: false }).etcJson).PUSH_ALARM).toBe('N');
  });

  it('HEADER·ADDITIONAL_CONTENT·ATTACHMENT는 값이 있으면 k_etc_json에 실린다 (msg_contents에는 안 섞인다)', () => {
    const { msgContents, etcJson } = buildBrandQueuePayload({
      ...FREE_BASE, bubbleType: 'IMAGE', header: '헤더', additionalContent: '부가설명',
      attachmentJson: JSON.stringify({ button: [{ name: 'b', type: 'WL', url_mobile: 'https://x' }] }),
    });
    const etc = JSON.parse(etcJson);
    expect(etc.HEADER).toBe('헤더');
    expect(etc.ADDITIONAL_CONTENT).toBe('부가설명');
    expect(etc.ATTACHMENT.button[0].type).toBe('WL');
    expect(msgContents).toBe('본문');
  });

  it('빈 header·additionalContent는 키 자체를 만들지 않는다', () => {
    const etc = JSON.parse(buildBrandQueuePayload({ ...FREE_BASE, header: '  ', additionalContent: '' }).etcJson);
    expect(etc.HEADER).toBeUndefined();
    expect(etc.ADDITIONAL_CONTENT).toBeUndefined();
  });

  it('무료수신거부 — M/N 타겟팅은 번호 필수(없으면 throw), 있으면 UNSUBSCRIBE_* 키로 실린다', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, targeting: 'M' })).toThrow(BrandMessageBuildError);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, targeting: 'N' })).toThrow(BrandMessageBuildError);
    const etc = JSON.parse(buildBrandQueuePayload({
      ...FREE_BASE, targeting: 'M', unsubscribePhone: '0801234567', unsubscribeAuth: '1234',
    }).etcJson);
    expect(etc.TARGETING).toBe('M');
    expect(etc.UNSUBSCRIBE_PHONE_NUMBER).toBe('0801234567');
    expect(etc.UNSUBSCRIBE_AUTH_NUMBER).toBe('1234');
    // I 타겟팅은 번호 없이 통과
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, targeting: 'I' })).not.toThrow();
  });

  it('발신프로필 키가 비면 throw — 조립 시점 fail-closed', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, senderKey: ' ' })).toThrow(BrandMessageBuildError);
  });

  it('자유형인데 본문이 비면 throw — 무로그 폐기 대신 적재 전 차단', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, message: ' ' })).toThrow(BrandMessageBuildError);
  });

  it('미지원 유형·캐러셀·깨진 ATTACHMENT·잘못된 TARGETING 전부 throw', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, bubbleType: 'COMMERCE' })).toThrow();
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, carouselJson: '[]' })).toThrow();
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, attachmentJson: '{깨짐' })).toThrow();
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, targeting: 'X' })).toThrow();
  });

  it('k_etc_json이 컬럼 한도(1024자)를 넘으면 throw — 적재가 깨지기 전에 막는다', () => {
    const longAttachment = JSON.stringify({
      button: Array.from({ length: 5 }, (_, i) => ({
        name: `버튼${i}`, type: 'WL', url_mobile: `https://example.com/${'x'.repeat(200)}?i=${i}`,
      })),
    });
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, attachmentJson: longAttachment }))
      .toThrow(/너무 깁니다/);
  });
});

describe('buildBrandQueuePayload — 기본형: msg_contents=TYPE_DEF+변수 / 제어 필드는 k_etc_json', () => {
  it('BASIC_TCD — MESSAGE 키를 넣지 않고(매뉴얼), TYPE_DEF 마커만 남긴다', () => {
    const { msgContents, etcJson } = buildBrandQueuePayload({
      typeDef: 'BASIC_TCD', senderKey: 'sk', targeting: 'I', bubbleType: 'TEXT', isAd: true,
    });
    expect(JSON.parse(msgContents)).toEqual({ TYPE_DEF: 'BASIC_TCD' });
    const etc = JSON.parse(etcJson);
    expect(etc.CHAT_BUBBLE_TYPE).toBe('TEXT');
    expect(etc.TARGETING).toBe('I');
  });

  it('BASIC_VAR — 변수는 msg_contents에, 제어 필드는 k_etc_json에', () => {
    const { msgContents } = buildBrandQueuePayload({
      typeDef: 'BASIC_VAR', senderKey: 'sk', targeting: 'I', bubbleType: 'TEXT', isAd: true,
      messageVariableJson: JSON.stringify({ 변수명: '따스함' }),
    });
    const j = JSON.parse(msgContents);
    expect(j.TYPE_DEF).toBe('BASIC_VAR');
    expect(j.MESSAGE_VARIABLE).toEqual({ 변수명: '따스함' });
    expect(j.MESSAGE).toBeUndefined();
    expect(j.TARGETING).toBeUndefined();
    expect(j.CHAT_BUBBLE_TYPE).toBeUndefined();
  });

  it('BASIC_VAR인데 변수가 없으면 throw', () => {
    expect(() => buildBrandQueuePayload({
      typeDef: 'BASIC_VAR', senderKey: 'sk', targeting: 'I', bubbleType: 'TEXT', isAd: true,
    })).toThrow();
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

describe('결과 표시 — 브랜드 행(msg_type=F) 신·구 규약 혼재 기간', () => {
  it("라벨 'F' → 브랜드메시지", () => {
    expect(getSendTypeLabel('F')).toBe('브랜드메시지');
  });

  it('신규 적재분(순수 본문)은 원문 그대로 표시된다', () => {
    const { msgContents } = buildBrandQueuePayload({ ...FREE_BASE, message: '실제 안내 문구' });
    expect(getDisplayContents('F', msgContents)).toBe('실제 안내 문구');
  });

  it('기존 적재분(JSON 전문)은 MESSAGE만 풀어 표시된다 — 하위호환 유지', () => {
    const legacy = JSON.stringify({ TYPE_DEF: 'FREE', TARGETING: 'I', CHAT_BUBBLE_TYPE: 'TEXT', MESSAGE: '본문' });
    expect(getDisplayContents('F', legacy)).toBe('본문');
    const legacyBasic = JSON.stringify({ TYPE_DEF: 'BASIC_TCD', TARGETING: 'I', CHAT_BUBBLE_TYPE: 'TEXT' });
    expect(getDisplayContents('F', legacyBasic)).toBe('(기본형 템플릿 발송)');
    expect(getDisplayContents('L', '일반 LMS 본문')).toBe('일반 LMS 본문');
  });

  it('신규 기본형 적재분({TYPE_DEF}만)도 기본형 안내로 표시된다', () => {
    const { msgContents } = buildBrandQueuePayload({
      typeDef: 'BASIC_TCD', senderKey: 'sk', targeting: 'I', bubbleType: 'TEXT', isAd: true,
    });
    expect(getDisplayContents('F', msgContents)).toBe('(기본형 템플릿 발송)');
  });
});
