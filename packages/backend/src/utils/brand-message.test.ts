/**
 * CT-12 브랜드메시지 적재 규약 조립·대체발송 매핑 — 2026-08-15 경계 규약 정정 계약 고정
 *
 * 근거: 형식이 어긋난 적재는 큐에는 들어가고 발송만 **오류 로그 없이** 버려진다.
 * 규약 = msg_contents(내용물: 자유형 순수 본문 / 기본형 TYPE_DEF+변수 JSON)
 *      + k_etc_json(제어·부가: senderkey·CHAT_BUBBLE_TYPE·TARGETING·AD_FLAG·PUSH_ALARM·
 *        HEADER·ADDITIONAL_CONTENT·UNSUBSCRIBE_*·ATTACHMENT — varchar(1024) 한도).
 * 이 형태는 런타임이 아니라 테스트가 지켜야 한다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildBrandQueuePayload,
  buildAttachmentJson,
  resolveBrandFallback,
  isSupportedBubbleType,
  SUPPORTED_BUBBLE_TYPES,
  BrandMessageBuildError,
} from './brand-message';
import { getDisplayContents, getSendTypeLabel } from './sms-result-map';

/**
 * sendAt을 창 안(KST 10:00)으로 고정한다 — 조립기가 발송 가능 시간(08:00~20:50)을 판정하므로
 * 고정하지 않으면 테스트가 **실행 시각에 따라** 통과/실패한다. 창 판정 자체는 전용 describe가 본다.
 */
// 미래 날짜를 쓴다 — 지난 시각은 "지금 나가는 건"으로 판정되므로(큐가 도래 행을 바로 집는다)
// 오늘 날짜로 고정하면 테스트가 실행 시각에 따라 흔들린다.
const IN_WINDOW = '2027-08-18 10:00:00';

/**
 * ★ 2026-08-18 7R — **파일 전체를 고정 시계 위에서 돌린다.**
 * 조립기가 "지난 시각 = 지금 발송"으로 판정하므로, 실제 시계로 두면 fixture가 과거가 되는 순간
 * (2027-08-18 이후) 테스트의 성질이 조용히 바뀐다. 기준 = KST 2027-08-18 09:00.
 */
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2027-08-18T00:00:00Z'));
});
afterEach(() => vi.useRealTimers());

const FREE_BASE = {
  typeDef: 'FREE' as const, senderKey: 'sk-test', targeting: 'I', bubbleType: 'TEXT', isAd: true, message: '본문',
  sendAt: IN_WINDOW,
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

  it('미지원 유형은 조립기가 차감 전에 거부한다 (게이트가 조립기 안에 있다)', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, bubbleType: 'CAROUSEL_FEED' }))
      .toThrow(/지원하지 않습니다/);
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

  it('ATTACHMENT는 k_etc_json에 실리고 msg_contents에는 안 섞인다', () => {
    const { msgContents, etcJson } = buildBrandQueuePayload({
      ...FREE_BASE, bubbleType: 'IMAGE',
      attachmentJson: JSON.stringify({
        image: { img_url: 'https://img/x.jpg' },
        button: [{ name: 'b', type: 'WL', url_mobile: 'https://x' }],
      }),
    });
    const etc = JSON.parse(etcJson);
    expect(etc.ATTACHMENT.button[0].type).toBe('WL');
    expect(etc.ATTACHMENT.image.img_url).toBe('https://img/x.jpg');
    expect(msgContents).toBe('본문');
  });

  it('빈 header·additionalContent는 키 자체를 만들지 않는다', () => {
    const etc = JSON.parse(buildBrandQueuePayload({ ...FREE_BASE, header: '  ', additionalContent: '' }).etcJson);
    expect(etc.HEADER).toBeUndefined();
    expect(etc.ADDITIONAL_CONTENT).toBeUndefined();
  });

  // 매뉴얼 §4.4.1 — HEADER는 WIDE_ITEM_LIST/PREMIUM_VIDEO, ADDITIONAL_CONTENT는 COMMERCE 전용이다.
  // 지원 3종(TEXT·IMAGE·WIDE)은 둘 다 "미사용"이라 값이 오면 조립을 멈춘다(무시하고 보내면 폐기 위험).
  it('지원 3종에 header·additionalContent를 넣으면 throw', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, header: '헤더' })).toThrow(/상단 제목을 사용하지 않습니다/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, additionalContent: '부가설명' })).toThrow(/부가 정보를 사용하지 않습니다/);
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

  it('IMAGE·WIDE는 이미지가 없으면 throw (매뉴얼 requireImage)', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, bubbleType: 'IMAGE' })).toThrow(/이미지가 필요합니다/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, bubbleType: 'WIDE', message: '짧은 본문' }))
      .toThrow(/이미지가 필요합니다/);
  });

  // 매뉴얼 §5.3.2 — 기본형은 파라미터 미입력 시 "템플릿에 등록된 이미지가 발송"된다.
  // 자유형 기준을 기본형에 그대로 걸면 정상 템플릿 발송이 거부된다.
  it('기본형은 이미지 없이도 통과한다 — 이미지는 템플릿이 갖고 있다', () => {
    expect(() => buildBrandQueuePayload({
      typeDef: 'BASIC_TCD', senderKey: 'sk', targeting: 'I', bubbleType: 'IMAGE', isAd: true, sendAt: IN_WINDOW,
    })).not.toThrow();
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

// ============================================================
// 매뉴얼 v2.3.1 규격 — 조립기가 6개 호출부 전부에 같은 판정을 준다
// ============================================================
//
// ★ 2026-08-18. 이 규칙들은 예전에 `/brand-send` 자유형 1곳에서만 검사됐다(나머지 5경로는 무검사).
//   조립기 안으로 옮긴 뒤로는 조립을 부르는 모든 경로가 통과해야만 큐에 들어간다.

const att = (o: any) => JSON.stringify(o);
const IMAGE_OK = { image: { img_url: 'https://img/x.jpg' } };

describe('본문 길이·줄바꿈 (§4.4.1)', () => {
  it('TEXT 1,300자 초과 throw / 이하 통과', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, message: '가'.repeat(1301) })).toThrow(/최대 1300자/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, message: '가'.repeat(1300) })).not.toThrow();
  });

  it('WIDE 본문은 76자까지', () => {
    const wide = { ...FREE_BASE, bubbleType: 'WIDE', attachmentJson: att(IMAGE_OK) };
    expect(() => buildBrandQueuePayload({ ...wide, message: '가'.repeat(77) })).toThrow(/최대 76자/);
    expect(() => buildBrandQueuePayload({ ...wide, message: '가'.repeat(76) })).not.toThrow();
  });

  // 본문은 trim() 뒤에 판정된다(실제로 큐에 실리는 값 그대로) — 끝 개행은 세어지지 않으므로
  // 개행을 글자 사이에 둔다.
  const lines = (newlineCount: number) => Array.from({ length: newlineCount + 1 }, () => 'a').join('\n');

  it('줄바꿈 상한 — TEXT 99 · IMAGE 29 · WIDE 5', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, message: lines(100) })).toThrow(/줄바꿈은 최대 99개/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, message: lines(99) })).not.toThrow();
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, bubbleType: 'IMAGE', attachmentJson: att(IMAGE_OK), message: lines(30),
    })).toThrow(/줄바꿈은 최대 29개/);
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, bubbleType: 'WIDE', attachmentJson: att(IMAGE_OK), message: lines(6),
    })).toThrow(/줄바꿈은 최대 5개/);
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, bubbleType: 'WIDE', attachmentJson: att(IMAGE_OK), message: lines(5),
    })).not.toThrow();
  });

  it('끝 개행은 trim되어 큐에 실리지 않는다 — 판정도 실린 값 기준이다', () => {
    const { msgContents } = buildBrandQueuePayload({ ...FREE_BASE, message: '본문\n\n' });
    expect(msgContents).toBe('본문');
  });

  it('이모지는 1자로 센다 — 서로게이트 쌍을 2자로 세면 멀쩡한 문안이 거부된다', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, message: '🙂'.repeat(1300) })).not.toThrow();
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, message: '🙂'.repeat(1301) })).toThrow(/최대 1300자/);
  });
});

describe('버튼 규격 (§6.10.3)', () => {
  it('WL은 버튼명·모바일 링크가 둘 다 필요하다', () => {
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ button: [{ type: 'WL', url_mobile: 'https://x' }] }),
    })).toThrow(/버튼명/);
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ button: [{ name: '보기', type: 'WL' }] }),
    })).toThrow(/모바일 링크/);
  });

  it('AL은 스킴·링크 중 2개 이상이 필요하다', () => {
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ button: [{ name: '앱', type: 'AL', url_mobile: 'https://x' }] }),
    })).toThrow(/2개 이상/);
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE,
      attachmentJson: att({ button: [{ name: '앱', type: 'AL', url_mobile: 'https://x', scheme_ios: 'app://x' }] }),
    })).not.toThrow();
  });

  it('AC(채널추가) 버튼은 타겟팅 M·N에서만 쓸 수 있다', () => {
    const acBtn = att({ button: [{ name: '채널 추가', type: 'AC' }] });
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, targeting: 'I', attachmentJson: acBtn }))
      .toThrow(/채널추가 버튼은 대상 범위가/);
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, targeting: 'M', unsubscribePhone: '0801234567', attachmentJson: acBtn,
    })).not.toThrow();
  });

  it('AC 버튼명은 "채널 추가" 고정 · BF 버튼명은 3종 중 선택', () => {
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, targeting: 'M', unsubscribePhone: '0801234567',
      attachmentJson: att({ button: [{ name: '친구추가', type: 'AC' }] }),
    })).toThrow(/버튼명은 채널 추가/);
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ button: [{ name: '예약', type: 'BF', biz_form_key: 'k' }] }),
    })).toThrow(/톡에서 예약하기/);
  });

  it('쿠폰을 함께 쓰면 TEXT 버튼 상한이 5가 아니라 4다 (§6.10.3.3)', () => {
    const coupon = { title: '1000원 할인 쿠폰', description: '오늘까지', url_mobile: 'https://c' };
    const btns = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `b${i}`, type: 'WL', url_mobile: 'https://x' }));
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, attachmentJson: att({ button: btns(5) }) })).not.toThrow();
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, attachmentJson: att({ button: btns(5), coupon }) }))
      .toThrow(/쿠폰을 함께 쓰면 버튼은 최대 4개/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, attachmentJson: att({ button: btns(4), coupon }) })).not.toThrow();
  });

  it('모르는 버튼 종류는 거부한다', () => {
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ button: [{ name: 'x', type: 'ZZ' }] }),
    })).toThrow(/지원하지 않는 버튼 종류/);
  });
});

describe('쿠폰 규격 (§6.10.7)', () => {
  it('클릭 URL은 평면 키(url_mobile)다 — 옛 link 래핑은 거부', () => {
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ coupon: { title: '쿠폰', description: '설명', link: { url_mobile: 'https://x' } } }),
    })).toThrow(/쿠폰 링크 형식이 올바르지 않습니다/);
  });

  it('buildAttachmentJson이 평면 키로 낸다 (link 키는 만들지 않는다)', () => {
    const json = JSON.parse(buildAttachmentJson({
      coupon: { title: '1000원 쿠폰', description: '오늘까지', url_mobile: 'https://c' },
    })!);
    expect(json.coupon).toEqual({ title: '1000원 쿠폰', description: '오늘까지', url_mobile: 'https://c' });
    expect(json.coupon.link).toBeUndefined();
  });

  it('설명은 필수이고 길이는 유형별로 다르다 (TEXT 12 · WIDE 18)', () => {
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ coupon: { title: '1000원 할인 쿠폰', url_mobile: 'https://c' } }),
    })).toThrow(/쿠폰 설명이 필요합니다/);
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ coupon: { title: '1000원 할인 쿠폰', description: '가'.repeat(13), url_mobile: 'https://c' } }),
    })).toThrow(/최대 12자/);
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, bubbleType: 'WIDE', message: '짧은 본문',
      attachmentJson: att({ ...IMAGE_OK, coupon: { title: '1000원 할인 쿠폰', description: '가'.repeat(18), url_mobile: 'https://c' } }),
    })).not.toThrow();
  });

  // 포털 coupon.title "사용 가능한 쿠폰 제목" — 자유 문구는 카카오가 거절한다.
  it('쿠폰 제목은 정해진 5형식만 통과한다', () => {
    const ok = (title: string) => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ coupon: { title, description: '오늘까지', url_mobile: 'https://c' } }),
    });
    expect(() => ok('1000원 할인 쿠폰')).not.toThrow();
    expect(() => ok('1,000원 할인 쿠폰')).not.toThrow();
    expect(() => ok('10% 할인 쿠폰')).not.toThrow();
    expect(() => ok('배송비 할인 쿠폰')).not.toThrow();
    expect(() => ok('아메리카노 무료 쿠폰')).not.toThrow();
    expect(() => ok('등급 UP 쿠폰')).not.toThrow();

    expect(() => ok('여름맞이 특별 쿠폰')).toThrow(/정해진 형식/);
    expect(() => ok('101% 할인 쿠폰')).toThrow(/정해진 형식/);
    expect(() => ok('0원 할인 쿠폰')).toThrow(/정해진 형식/);
    expect(() => ok('여덟글자넘는이름 무료 쿠폰')).toThrow(/정해진 형식/);
  });

  it('쿠폰에는 클릭 주소가 있어야 한다', () => {
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ coupon: { title: '배송비 할인 쿠폰', description: '오늘까지' } }),
    })).toThrow(/쿠폰 URL이 필요합니다/);
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, attachmentJson: att({ coupon: { title: '배송비 할인 쿠폰', description: '오늘까지', scheme_ios: 'coupon://x' } }),
    })).not.toThrow();
  });
});

describe('발송 가능 시간 (KST 08:00~20:50 · 매뉴얼 §3.9.1)', () => {
  // 종료는 exclusive다 — 매뉴얼 §3.9.1이 20:50을 금지 구간의 **시작**으로 적는다.
  // 기준 시계 = KST 2027-08-18 09:00. 창 경계는 **미래 시각**으로 본다 —
  // 지난 시각은 "지금 발송"으로 재므로 경계 검증에 쓸 수 없다(순수 함수 경계는 send-time-util 테스트가 소유).
  it('경계 — 20:49 통과 · 20:50 차단 · 익일 08:00 통과 · 익일 07:59 차단', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-18 20:49:59' })).not.toThrow();
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-18 20:50:00' })).toThrow(/8시부터 저녁 8시 50분/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-19 08:00:00' })).not.toThrow();
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-19 07:59:59' })).toThrow(/8시부터 저녁 8시 50분/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-19 03:00:00' })).toThrow(/8시부터 저녁 8시 50분/);
  });

  it('시각 문자열은 KST로 읽는다 — 서버 표준시가 무엇이든 판정이 같아야 한다', () => {
    // 2027-08-18T23:00:00Z = KST 익일 08:00 → 창 안
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: new Date('2027-08-18T23:00:00Z') })).not.toThrow();
    // 2027-08-18T12:00:00Z = KST 21:00 → 창 밖
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: new Date('2027-08-18T12:00:00Z') })).toThrow();
  });

  it('읽을 수 없는 시각은 조용히 "지금"으로 흐르지 않고 throw', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '언젠가' })).toThrow(/발송 예약 시각/);
  });

  // 오프셋 없는 ISO를 그대로 new Date에 넘기면 서버 표준시에 따라 결과가 갈린다.
  it('오프셋 없는 ISO는 거부하고, 오프셋이 명시된 ISO만 받는다', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-18T10:00:00.000' })).toThrow(/발송 예약 시각/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-18T10:00:00+09:00' })).not.toThrow();
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-18T01:00:00Z' })).not.toThrow();
  });

  it('달력에 없는 날짜는 조용히 정규화되지 않고 throw', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-02-31 10:00:00' })).toThrow(/발송 예약 시각/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-18 25:00:00' })).toThrow(/발송 예약 시각/);
  });
});

// ★ 0818 Codex 적대 리뷰 수용분 회귀
describe('리뷰 수용 회귀', () => {
  it('옛 쿠폰 link 래핑은 투영 전에 잡힌다 — 링크 없는 쿠폰으로 조용히 나가지 않는다', () => {
    // buildAttachmentJson이 평면 키만 골라 담으면 link는 그 자리에서 사라져 조립기가 못 본다.
    expect(() => buildAttachmentJson({
      coupon: { title: '1000원 할인 쿠폰', description: '오늘까지', link: { url_mobile: 'https://x' } } as any,
    })).toThrow(/쿠폰 링크 형식/);
  });

  // 타입을 느슨하게 보면 "검사는 통과하고 카카오에서 버려지는" 모양이 만들어진다.
  it('첨부 타입 fail-open 차단 — 배열·객체가 문자열 자리에 오면 거부', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, attachmentJson: '[]' }))
      .toThrow(/첨부\(ATTACHMENT\) 형식/);
    expect(() => buildBrandQueuePayload({
      ...FREE_BASE, bubbleType: 'IMAGE', attachmentJson: att({ image: { img_url: {} } }),
    })).toThrow(/이미지 주소 형식/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, attachmentJson: att({ coupon: 'x' }) }))
      .toThrow(/쿠폰 형식/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, attachmentJson: att({ button: { name: 'b' } }) }))
      .toThrow(/버튼 형식/);
  });

  it('sendAt은 문자열·Date만 받는다 — false·0·배열이 조용히 "지금"이 되지 않는다', () => {
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: false as any })).toThrow(/발송 예약 시각/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: 0 as any })).toThrow(/발송 예약 시각/);
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: [] as any })).toThrow(/발송 예약 시각/);
    // 오프셋 없는 ISO는 KST 평문 경로로 새어 들어오면 안 된다(구분자는 공백만 허용).
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-18T10:00' })).toThrow(/발송 예약 시각/);
  });

  it('기본형이 이미지 객체를 보냈는데 알맹이가 비면 거부한다 — 면제는 "안 보낸 경우"만', () => {
    const basic = {
      typeDef: 'BASIC_TCD' as const, senderKey: 'sk', targeting: 'I', bubbleType: 'IMAGE',
      isAd: true, sendAt: IN_WINDOW,
    };
    expect(() => buildBrandQueuePayload(basic)).not.toThrow();                    // 미제공 = 템플릿이 담당
    expect(() => buildBrandQueuePayload({ ...basic, attachmentJson: att({ image: { img_url: '  ' } }) }))
      .toThrow(/이미지가 필요합니다/);                                             // 제공했는데 빈 값 = 잘못된 덮어쓰기
  });
});

describe('buildBrandQueuePayload — 기본형: msg_contents=TYPE_DEF+변수 / 제어 필드는 k_etc_json', () => {
  it('BASIC_TCD — MESSAGE 키를 넣지 않고(매뉴얼), TYPE_DEF 마커만 남긴다', () => {
    const { msgContents, etcJson } = buildBrandQueuePayload({
      typeDef: 'BASIC_TCD', senderKey: 'sk', targeting: 'I', bubbleType: 'TEXT', isAd: true, sendAt: IN_WINDOW,
    });
    expect(JSON.parse(msgContents)).toEqual({ TYPE_DEF: 'BASIC_TCD' });
    const etc = JSON.parse(etcJson);
    expect(etc.CHAT_BUBBLE_TYPE).toBe('TEXT');
    expect(etc.TARGETING).toBe('I');
  });

  it('BASIC_VAR — 변수는 msg_contents에, 제어 필드는 k_etc_json에', () => {
    const { msgContents } = buildBrandQueuePayload({
      typeDef: 'BASIC_VAR', senderKey: 'sk', targeting: 'I', bubbleType: 'TEXT', isAd: true, sendAt: IN_WINDOW,
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
      typeDef: 'BASIC_VAR', senderKey: 'sk', targeting: 'I', bubbleType: 'TEXT', isAd: true, sendAt: IN_WINDOW,
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
      typeDef: 'BASIC_TCD', senderKey: 'sk', targeting: 'I', bubbleType: 'TEXT', isAd: true, sendAt: IN_WINDOW,
    });
    expect(getDisplayContents('F', msgContents)).toBe('(기본형 템플릿 발송)');
  });
});

// ★ 2026-08-18 5R·6R — 지난 예약 시각과 마감 코앞 예약이 가드를 우회하던 구멍.
//   ⛔ 실제 시계로 기대값을 계산하면 하루 대부분의 시각에서 **옛 결함도 통과한다**(6R 지적).
//      가짜 시계를 금지 시간대에 고정해 단일 기대값으로 본다.
describe('시각 판정은 "실제로 나갈 때"를 기준으로 한다', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const at = (iso: string) => vi.setSystemTime(new Date(iso));

  it('금지 시각(KST 03:00)에서는 과거 예약이 거부된다 — 지난 시각으로 재면 늘 통과한다', () => {
    at('2027-08-17T18:00:00Z');   // KST 2027-08-18 03:00
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2020-01-01 10:00:00' }))
      .toThrow(/8시부터 저녁 8시 50분/);
  });

  it('창 안(KST 14:00)에서는 과거 예약이 지금 기준으로 통과한다', () => {
    at('2027-08-18T05:00:00Z');   // KST 14:00
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2020-01-01 10:00:00' })).not.toThrow();
  });

  it('마감 코앞 예약은 즉시 건과 똑같이 여유가 적용된다 — 차감·적재 중에 20:50을 넘는다', () => {
    at('2027-08-18T11:49:58Z');   // KST 20:49:58
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-18 20:49:59' }))
      .toThrow(/8시부터 저녁 8시 50분/);
  });

  it('여유 밖의 예약은 그대로 통과한다 — 창을 임의로 좁히지 않는다', () => {
    at('2027-08-18T11:00:00Z');   // KST 20:00
    expect(() => buildBrandQueuePayload({ ...FREE_BASE, sendAt: '2027-08-18 20:49:00' })).not.toThrow();
  });
});
