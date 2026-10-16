/**
 * 알림톡 실패 → 문자 대체 성공이 원래 알림톡(K) 행의 결과코드(7830 SMS · 7831 LMS)로만 남는 모양 (★2026-10-03 서수란 접수 · 크로커다일 9/29)
 *
 * 대체발송 결과는 두 모양으로 온다.
 *   ① 옛 QTmsg 라인 = 대체 문자가 별도 행(L/S + k_oriseq = 원본 K행 seqno)
 *   ② 비토 게이트웨이 라인(SMSQ_SEND_13~16) = 별도 행 없이 원래 K행의 status_code 가 7830/7831
 *      (실측 1003 Harold: 13~16 에 ①모양 0건 · ②모양 4건 = 인비토 7/27 1 · 크로커다일 9/22 2 · 9/29 1)
 * 옛: 판정이 ①만 알아서 ②가 통계에서 알림톡 성공으로 잡히고 정산에서 알림톡 단가로 청구됐다.
 * 처방: ②를 "대체 문자 1건"으로 읽는 판정을 sms-result-map 한 곳에 두고 청구 식·통계 분리·결과 필터·유형 라벨이 따른다.
 * ★ 2026-10-16 B-1016-1 — 판정 함수가 fallbackOf 하나로 모였다(옛 alimtalkFallbackMsgType·classifyMsgChannel·tallySmsChannelCounts 삭제).
 *   이 파일의 1003 고정본(크로커다일 9/29 모양 · 옛 모양 · 라벨 · 필터)은 그대로 두고 기대값만 새 함수로 옮겼다.
 *   청구 유형은 문자(S·L)가 아니라 대체 집계 코드(KS·KL → SMS_FB·LMS_FB · 단가는 문자 상속) — 새 계약 = alimtalk-fallback-axis-1016.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  KAKAO_FALLBACK_SMS_CODE, KAKAO_FALLBACK_LMS_CODE, fallbackOf,
  FALLBACK_BILLING_CODE_WHEN_SQL, SUBSTITUTE_ROW_SQL,
  getSendTypeLabel, tallyAlimtalkFallback, isSuccess,
} from '../sms-result-map';
import { FALLBACK_BILLING_CODE } from '../billing-types';
import { BILLING_MSG_TYPE_SQL, MSG_TYPE_TO_USAGE_KEY } from '../send-usage-aggregation';

const src = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8');

describe('K행 대체 성공 코드 판정', () => {
  it('7830 = SMS 대체 · 7831 = LMS 대체 (둘 다 성공 코드)', () => {
    expect(KAKAO_FALLBACK_SMS_CODE).toBe(7830);
    expect(KAKAO_FALLBACK_LMS_CODE).toBe(7831);
    expect(isSuccess(7830)).toBe(true);
    expect(isSuccess(7831)).toBe(true);
  });

  it('K + 7830 → S · K + 7831 → L · 숫자 문자열도 같다', () => {
    expect(fallbackOf('K', null, 7830)).toBe('S');
    expect(fallbackOf('K', null, 7831)).toBe('L');
    expect(fallbackOf('K', null, '7831')).toBe('L');
  });

  it('카카오 전달 성공·실패·대기 K행과 K가 아닌 행의 7830/7831 은 대체가 아니다', () => {
    expect(fallbackOf('K', null, 1800)).toBeNull();
    expect(fallbackOf('K', null, 7421)).toBeNull();
    expect(fallbackOf('K', null, 100)).toBeNull();
    expect(fallbackOf('K', null, null)).toBeNull();
    expect(fallbackOf('K', null, undefined)).toBeNull();
    expect(fallbackOf('L', null, 7831)).toBeNull();
    expect(fallbackOf('S', null, 7830)).toBeNull();
  });
});

describe('통계 분리 (슈퍼관리자 발송통계 엑셀 · 캠페인 목록 = 같은 집계 · ★1016)', () => {
  it('옛 모양(L/S + k_oriseq)도 대체다 · k_oriseq 없는 L 은 아니다', () => {
    expect(fallbackOf('L', 361669, 1000)).toBe('L');
    expect(fallbackOf('S', '361669')).toBe('S');
    expect(fallbackOf('K', null)).toBeNull();
    expect(fallbackOf('L', null, 7831)).toBeNull();
  });

  it('크로커다일 9/29 모양(K 1800 2건 + K 7831 1건) = 알림톡 시도 3(성공 2 · 실패 1) · LMS 대체 1', () => {
    // ★ 2026-10-16 옛 엑셀 분류는 「알림톡 2 · 대체 1」(시도 1건이 사라짐 = 이번 접수 ①). 이제 알림톡 행 = 시도 전체.
    const r = tallyAlimtalkFallback([
      { msg_type: 'K', k_oriseq: null, status_code: 1800, cnt: 2 },
      { msg_type: 'K', k_oriseq: null, status_code: 7831, cnt: 1 },
    ]);
    expect({ total: r.total, success: r.success, fail: r.fail, pending: r.pending }).toEqual({ total: 3, success: 2, fail: 1, pending: 0 });
    expect(r.fallback.LMS).toEqual({ total: 1, success: 1, fail: 0, pending: 0 });
    expect(r.fallback.SMS.total).toBe(0);
  });
});

describe('유형 라벨 (발송결과 상세·엑셀·관리자 상세·고객 타임라인)', () => {
  it('K + 7831/7830 은 대체발송 라벨 · K + 1800 은 알림톡', () => {
    expect(getSendTypeLabel('K', null, 7831)).toBe('대체 LMS');
    expect(getSendTypeLabel('K', 0, 7830)).toBe('대체 SMS');
    expect(getSendTypeLabel('K', null, 1800)).toBe('알림톡');
    expect(getSendTypeLabel('K', null)).toBe('알림톡');
  });

  it('옛 모양 라벨은 그대로다', () => {
    expect(getSendTypeLabel('L', 361669)).toBe('대체 LMS');
    expect(getSendTypeLabel('L', null, 7831)).toBe('LMS');
  });
});

describe('청구 유형 식 BILLING_MSG_TYPE_SQL', () => {
  it('대체 분기가 F 분기 뒤 · ELSE 앞에 있다', () => {
    const at = BILLING_MSG_TYPE_SQL.indexOf(FALLBACK_BILLING_CODE_WHEN_SQL);
    expect(at).toBeGreaterThan(BILLING_MSG_TYPE_SQL.indexOf("ELSE 'FN' END)"));
    expect(BILLING_MSG_TYPE_SQL.endsWith(`${FALLBACK_BILLING_CODE_WHEN_SQL} ELSE msg_type END`)).toBe(true);
  });

  it('K행 대체 성공 = 대체 유형(★1016 · 단가는 문자 상속 · 에이전트 대체분 KS/KL 과 같은 유형)', () => {
    expect(MSG_TYPE_TO_USAGE_KEY[FALLBACK_BILLING_CODE[fallbackOf('K', null, 7830)!]]).toBe('SMS_FB');
    expect(MSG_TYPE_TO_USAGE_KEY[FALLBACK_BILLING_CODE[fallbackOf('K', null, 7831)!]]).toBe('LMS_FB');
  });
});

describe('발송결과 「대체발송」 필터 = 두 모양 모두', () => {
  it('공용 조각이 옛 모양과 K행 대체 성공을 함께 고른다', () => {
    expect(SUBSTITUTE_ROW_SQL).toBe(
      "((k_oriseq > 0 AND msg_type IN ('L', 'S')) OR (msg_type = 'K' AND status_code IN (7830, 7831)))",
    );
  });

  it('필터 네 곳이 공용 조각을 쓰고 인라인 조건이 남지 않는다', () => {
    const results = src('routes/results.ts');
    const exp = src('utils/campaign-sms-export.ts');
    expect(results).not.toContain("k_oriseq > 0 AND msg_type IN ('L', 'S')`");
    expect(exp).not.toContain("k_oriseq > 0 AND msg_type IN ('L', 'S')`");
    expect(results.match(/AND \$\{SUBSTITUTE_ROW_SQL\}/g)?.length).toBe(3);
    expect(exp.match(/AND \$\{SUBSTITUTE_ROW_SQL\}/g)?.length).toBe(1);
  });
});

describe('행 단위 라벨 호출이 상태코드를 넘긴다', () => {
  it('발송결과 상세·엑셀 · 캠페인 엑셀 · 관리자 상세 · 고객 타임라인 · 통계 분리', () => {
    const results = src('routes/results.ts');
    expect(results).toContain('send_type: getSendTypeLabel(m.msg_type, m.k_oriseq, m.status_code),');
    expect(results).toContain('const msgTypeDisplay = getSendTypeLabel(m.msg_type, m.k_oriseq, m.status_code);');
    expect(src('utils/campaign-sms-export.ts')).toContain('const msgTypeDisplay = getSendTypeLabel(m.msg_type, m.k_oriseq, m.status_code);');
    const admin = src('routes/admin.ts');
    expect(admin).toContain('sendType: getSendTypeLabel(r.msg_type, r.k_oriseq, r.status_code),');
    expect(admin).toContain("getSendTypeLabel(r.msg_type, r.k_oriseq, r.status_code),\n          sendType");
    expect(src('utils/customer-timeline.ts')).toContain('const typeLabel = getSendTypeLabel(msgType, r.k_oriseq, r.status_code);');
    expect(src('utils/sms-result-map.ts')).toContain('const fb = fallbackOf(r.msg_type, r.k_oriseq, code);');
  });
});
