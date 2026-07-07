/**
 * alimtalk-emphasize.test.ts — withSenderKey (비토 게이트웨이 라인 전용 SENDER_KEY 주입 헬퍼)
 *
 * 배경(2026-07-07): 비토 Agent v1.0.10은 알림톡에 발신프로필키(kakao_sender_key)를 명시 요구
 *   (미동봉 = 필드매핑 실패 → status_code 9999). Agent는 k_etc_json(kakao_payload)의
 *   SENDER_KEY/sender_key/senderKey/senderkey 키를 kakao_sender_key 표준 필드로 승격한다.
 *   표준 QTmsg 라인은 중계서버가 템플릿코드로 자동 도출하므로 주입 대상이 아니다(비토 라인 한정).
 */
import { describe, test, expect } from 'vitest';
import { withSenderKey } from './alimtalk-emphasize';

describe('withSenderKey', () => {
  test('기존 etcJson({title, attachment_link})에 SENDER_KEY 병합 — 기존 키 보존', () => {
    const base = JSON.stringify({
      title: '홍길동님 주문',
      attachment_link: { url_mobile: 'https://m.x.com', url_pc: 'https://x.com' },
    });
    const merged = JSON.parse(withSenderKey(base, 'abcdef0123456789'));
    expect(merged.title).toBe('홍길동님 주문');
    expect(merged.attachment_link).toEqual({ url_mobile: 'https://m.x.com', url_pc: 'https://x.com' });
    expect(merged.SENDER_KEY).toBe('abcdef0123456789');
  });

  test('etcJson undefined(기본형/버튼형) → {"SENDER_KEY"}만 생성', () => {
    expect(JSON.parse(withSenderKey(undefined, 'k1'))).toEqual({ SENDER_KEY: 'k1' });
  });

  test('etcJson null → {"SENDER_KEY"}만 생성', () => {
    expect(JSON.parse(withSenderKey(null, 'k2'))).toEqual({ SENDER_KEY: 'k2' });
  });

  test('깨진 JSON → SENDER_KEY만 (발송 차단 X, 기존 파싱 실패 관용 동일)', () => {
    expect(JSON.parse(withSenderKey('{broken', 'k3'))).toEqual({ SENDER_KEY: 'k3' });
  });

  test('배열/비객체 JSON → SENDER_KEY만 (객체 아니면 병합 불가)', () => {
    expect(JSON.parse(withSenderKey('[1,2]', 'k4'))).toEqual({ SENDER_KEY: 'k4' });
    expect(JSON.parse(withSenderKey('"str"', 'k5'))).toEqual({ SENDER_KEY: 'k5' });
  });

  test('이미 SENDER_KEY가 있으면 새 값으로 덮음 (단일 진실 = 조회값)', () => {
    const merged = JSON.parse(withSenderKey(JSON.stringify({ SENDER_KEY: 'old', title: 't' }), 'new'));
    expect(merged.SENDER_KEY).toBe('new');
    expect(merged.title).toBe('t');
  });
});
