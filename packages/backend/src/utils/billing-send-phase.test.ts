/**
 * billing-send-phase.test.ts — 청구 축 send_phase 진리표 고정
 *
 * ★ 2026-08-18 (Codex 적대 검토 high #2): 두 선택기가 `= 'sent'` / `IS NULL`이라
 *   'preparing'·'queued'가 어디에도 안 걸려 완료된 실발송이 청구에서 사라질 수 있었다.
 *   여기서 고정하는 성질은 하나다 — **정의역의 모든 값이 정확히 한 축에 들어간다.**
 */
import { describe, it, expect } from 'vitest';
import {
  SEND_PHASE_DOMAIN,
  isSentPhase,
  isNonSentPhase,
  sentPhaseSql,
  nonSentPhaseSql,
} from './billing-send-phase';

describe('청구 축 send_phase 분할', () => {
  it('정의역의 모든 값이 정확히 한 축에 들어간다 — 어느 쪽도 아니면 그 발송은 청구에서 사라진다', () => {
    for (const phase of SEND_PHASE_DOMAIN) {
      const hits = [isSentPhase(phase), isNonSentPhase(phase)].filter(Boolean).length;
      expect(hits, `phase=${String(phase)}`).toBe(1);
    }
  });

  it('정의역에 없는 새 phase가 생겨도 축 B가 받는다 — 청구 누락이 아니라 과다 후보가 되게', () => {
    for (const unknown of ['sending', 'paused', 'RETRY', '']) {
      expect(isNonSentPhase(unknown), unknown).toBe(true);
      expect(isSentPhase(unknown), unknown).toBe(false);
    }
  });

  it('NULL은 축 B다 — 레거시 직접발송(send_phase 미기재)이 여기로 온다', () => {
    expect(isNonSentPhase(null)).toBe(true);
    expect(isNonSentPhase(undefined)).toBe(true);
  });

  it('축 B의 SQL은 IS DISTINCT FROM이다 — <>를 쓰면 NULL이 조용히 빠진다', () => {
    expect(nonSentPhaseSql('c3')).toBe("c3.send_phase IS DISTINCT FROM 'sent'");
    expect(nonSentPhaseSql('c3')).not.toContain('<>');
    expect(sentPhaseSql('c2')).toBe("c2.send_phase = 'sent'");
  });
});
