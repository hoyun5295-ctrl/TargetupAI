/**
 * ★ 2026-10-07 (박성용 접수 cmuxvwasa0pvajnn462s5ubyr) 알림톡 캠페인 = 알림톡 시도 · 대체 문자 분리
 *   접수 실례 = 3건 「알림톡 3 성공」 → 실제 알림톡 2 성공 + 1 실패 → LMS 대체 1 성공(거래내역서 = 알림톡 41 + LMS 4 와 같은 기준).
 */
import { describe, it, expect } from 'vitest';
import { tallyAlimtalkFallback, getSendTypeLabel, getStatusLabel } from '../sms-result-map';

describe('tallyAlimtalkFallback', () => {
  it('비토 라인(K행 결과 7831) — 알림톡 3 = 성공 2 · 실패 1 / 대체 LMS 1 성공', () => {
    const r = tallyAlimtalkFallback([
      { msg_type: 'K', k_oriseq: null, status_code: 1000, cnt: 2 },
      { msg_type: 'K', k_oriseq: null, status_code: 7831, cnt: 1 },
    ]);
    expect({ total: r.total, success: r.success, fail: r.fail, pending: r.pending }).toEqual({ total: 3, success: 2, fail: 1, pending: 0 });
    expect(r.fallback.LMS).toEqual({ total: 1, success: 1, fail: 0, pending: 0 });
    expect(r.fallback.SMS.total).toBe(0);
  });

  it('옛 라인(실패 K행 + k_oriseq 있는 L행) — 같은 결과', () => {
    const r = tallyAlimtalkFallback([
      { msg_type: 'K', k_oriseq: null, status_code: 1000, cnt: 2 },
      { msg_type: 'K', k_oriseq: null, status_code: 7300, cnt: 1 },
      { msg_type: 'L', k_oriseq: 1, status_code: 6, cnt: 1 },
    ]);
    expect({ total: r.total, success: r.success, fail: r.fail }).toEqual({ total: 3, success: 2, fail: 1 });
    expect(r.fallback.LMS).toEqual({ total: 1, success: 1, fail: 0, pending: 0 });
  });

  it('대체 문자도 실패 · 대기는 그대로 센다 · 대체 아닌 일반 문자는 세지 않는다', () => {
    const r = tallyAlimtalkFallback([
      { msg_type: 'K', k_oriseq: null, status_code: 7300, cnt: 2 },
      { msg_type: 'S', k_oriseq: 9, status_code: 2000, cnt: 1 },
      { msg_type: 'S', k_oriseq: 9, status_code: 100, cnt: 1 },
      { msg_type: 'L', k_oriseq: null, status_code: 6, cnt: 5 },
    ]);
    expect(r.total).toBe(2);
    expect(r.fallback.SMS).toEqual({ total: 2, success: 0, fail: 1, pending: 1 });
    expect(r.fallback.LMS.total).toBe(0);
  });
});

describe('짧은 라벨(칸 넘침 정정)', () => {
  it('유형 · 결과', () => {
    expect(getSendTypeLabel('K', null, 7831)).toBe('대체 LMS');
    expect(getSendTypeLabel('S', 3)).toBe('대체 SMS');
    expect(getStatusLabel(7831)).toBe('LMS 대체 성공');
    expect(getStatusLabel(7830)).toBe('SMS 대체 성공');
  });
});
