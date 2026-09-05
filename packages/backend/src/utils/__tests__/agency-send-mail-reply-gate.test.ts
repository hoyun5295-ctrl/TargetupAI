/**
 * 대행발송 이메일 회신 상한 게이트 계약 (★2026-09-05 §21-3 (1))
 *
 * 경위 = 호출부가 `if (!(await replyAllowed(...)))`로 **객체를 부정**해 게이트가 한 번도 닫힌 적이 없었다.
 *   그 상태에서 부정 연산만 고치면 `REPLY_RATE_PER_HOUR` 기본값 0 때문에 `sent >= 0`이 항상 참이 되어
 *   **전 회신이 침묵한다**(이메일 경로에서 회신은 확인 화면을 대신하는 유일한 통지다).
 *   그래서 판정을 순수 함수로 뽑아 0=무제한 · 상한 도달 1회 안내 · 그 뒤 침묵을 한 자리에 고정한다.
 *
 * ⛔ 이 파일이 지키는 것 = 불변 22("회신 상한에 걸려도 침묵하지 않는다")가 **실행 코드에 존재**한다는 것.
 */
import { describe, it, expect } from 'vitest';
import { decideReplyGate } from '../agency-send-mail-worker';

describe('회신 상한 판정(decideReplyGate) — §21-3 (1)', () => {
  describe('상한 0 = 무제한(기본값)', () => {
    it('보낸 통수가 얼마든 통과시킨다. 안내도 띄우지 않는다', () => {
      expect(decideReplyGate(0, 0, false)).toEqual({ allow: true, capNotice: false });
      expect(decideReplyGate(999, 0, false)).toEqual({ allow: true, capNotice: false });
    });

    it('음수(오설정)도 무제한으로 본다 — 실수로 -1을 넣어 전 회신이 멈추면 안 된다', () => {
      expect(decideReplyGate(10, -1, false)).toEqual({ allow: true, capNotice: false });
    });

    it('⛔ 무제한이어도 같은 사유 24시간 억제는 그대로 집행한다(같은 말을 두 번 하지 않는다)', () => {
      expect(decideReplyGate(0, 0, true)).toEqual({ allow: false, capNotice: false });
    });
  });

  describe('상한 N이 걸린 경우', () => {
    it('상한 미만이면 통과', () => {
      expect(decideReplyGate(0, 5, false)).toEqual({ allow: true, capNotice: false });
      expect(decideReplyGate(4, 5, false)).toEqual({ allow: true, capNotice: false });
    });

    it('상한에 **정확히** 닿은 회차에만 안내를 한 통 보낸다', () => {
      expect(decideReplyGate(5, 5, false)).toEqual({ allow: false, capNotice: true });
    });

    it('그 안내가 sent로 기록되어 카운트를 올리므로 다음 회차부터는 저절로 침묵한다', () => {
      expect(decideReplyGate(6, 5, false)).toEqual({ allow: false, capNotice: false });
      expect(decideReplyGate(7, 5, false)).toEqual({ allow: false, capNotice: false });
    });

    it('상한을 넘긴 상태에서 24시간 억제가 겹쳐도 침묵이다(안내 중복 금지)', () => {
      expect(decideReplyGate(6, 5, true)).toEqual({ allow: false, capNotice: false });
    });

    it('⛔ 상한 도달과 24시간 억제가 같은 회차에 겹치면 상한 안내가 이긴다 — 왜 답이 없는지를 말해야 한다', () => {
      expect(decideReplyGate(5, 5, true)).toEqual({ allow: false, capNotice: true });
    });
  });

  describe('같은 사유 24시간 억제', () => {
    it('상한 여유가 있어도 같은 사유를 이미 보냈으면 막는다. 단 안내는 띄우지 않는다(침묵이 아니다)', () => {
      expect(decideReplyGate(1, 5, true)).toEqual({ allow: false, capNotice: false });
    });
  });
});
