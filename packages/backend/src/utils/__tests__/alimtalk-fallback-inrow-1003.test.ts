/**
 * 알림톡 실패 → 문자 대체 성공이 원래 알림톡(K) 행의 결과코드(7830 SMS · 7831 LMS)로만 남는 모양 (★2026-10-03 서수란 접수 · 크로커다일 9/29)
 *
 * 대체발송 결과는 두 모양으로 온다.
 *   ① 옛 QTmsg 라인 = 대체 문자가 별도 행(L/S + k_oriseq = 원본 K행 seqno)
 *   ② 비토 게이트웨이 라인(SMSQ_SEND_13~16) = 별도 행 없이 원래 K행의 status_code 가 7830/7831
 *      (실측 1003 Harold: 13~16 에 ①모양 0건 · ②모양 4건 = 인비토 7/27 1 · 크로커다일 9/22 2 · 9/29 1)
 * 옛: 판정이 ①만 알아서 ②가 통계에서 알림톡 성공으로 잡히고 정산에서 알림톡 단가로 청구됐다.
 * 처방: ②를 "대체 문자 1건"으로 읽는 판정을 sms-result-map 한 곳에 두고 청구 식·통계 분리·결과 필터·유형 라벨이 따른다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  KAKAO_FALLBACK_SMS_CODE, KAKAO_FALLBACK_LMS_CODE, alimtalkFallbackMsgType,
  ALIMTALK_FALLBACK_TYPE_WHEN_SQL, SUBSTITUTE_ROW_SQL,
  classifyMsgChannel, getSendTypeLabel, tallySmsChannelCounts, isSuccess,
} from '../sms-result-map';
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
    expect(alimtalkFallbackMsgType('K', 7830)).toBe('S');
    expect(alimtalkFallbackMsgType('K', 7831)).toBe('L');
    expect(alimtalkFallbackMsgType('K', '7831')).toBe('L');
  });

  it('카카오 전달 성공·실패·대기 K행과 K가 아닌 행은 대체가 아니다', () => {
    expect(alimtalkFallbackMsgType('K', 1800)).toBeNull();
    expect(alimtalkFallbackMsgType('K', 7421)).toBeNull();
    expect(alimtalkFallbackMsgType('K', 100)).toBeNull();
    expect(alimtalkFallbackMsgType('K', null)).toBeNull();
    expect(alimtalkFallbackMsgType('K', undefined)).toBeNull();
    expect(alimtalkFallbackMsgType('L', 7831)).toBeNull();
    expect(alimtalkFallbackMsgType('S', 7830)).toBeNull();
  });
});

describe('통계 채널 분리 (슈퍼관리자 발송통계 엑셀 「알림톡대체발송」 행)', () => {
  it('K + 7831 → substitute_lms · K + 7830 → substitute_sms · K + 1800 → alimtalk', () => {
    expect(classifyMsgChannel('K', null, 7831)).toBe('substitute_lms');
    expect(classifyMsgChannel('K', null, 7830)).toBe('substitute_sms');
    expect(classifyMsgChannel('K', null, 1800)).toBe('alimtalk');
  });

  it('옛 모양(L/S + k_oriseq)과 상태코드를 안 넘기는 호출은 종전 그대로다', () => {
    expect(classifyMsgChannel('L', 361669, 1000)).toBe('substitute_lms');
    expect(classifyMsgChannel('S', '361669')).toBe('substitute_sms');
    expect(classifyMsgChannel('K', null)).toBe('alimtalk');
    expect(classifyMsgChannel('L', null, 7831)).toBe('lms');
  });

  it('크로커다일 9/29 모양(K 1800 2건 + K 7831 1건)이 알림톡 2 · LMS 대체 1로 갈린다', () => {
    const r = tallySmsChannelCounts([
      { msg_type: 'K', k_oriseq: null, status_code: 1800, cnt: 2 },
      { msg_type: 'K', k_oriseq: null, status_code: 7831, cnt: 1 },
    ]);
    expect(r.alimtalk).toEqual({ total: 2, success: 2, fail: 0, pending: 0 });
    expect(r.substitute_lms).toEqual({ total: 1, success: 1, fail: 0, pending: 0 });
    expect(r.substitute_sms.total).toBe(0);
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
  it('K행 대체 성공을 그 문자 유형으로 바꾸는 분기가 F 분기 뒤 · ELSE 앞에 있다', () => {
    expect(ALIMTALK_FALLBACK_TYPE_WHEN_SQL).toBe(
      "WHEN msg_type = 'K' AND status_code = 7830 THEN 'S' WHEN msg_type = 'K' AND status_code = 7831 THEN 'L'",
    );
    const at = BILLING_MSG_TYPE_SQL.indexOf(ALIMTALK_FALLBACK_TYPE_WHEN_SQL);
    expect(at).toBeGreaterThan(BILLING_MSG_TYPE_SQL.indexOf("ELSE 'FN' END)"));
    expect(BILLING_MSG_TYPE_SQL.endsWith(`${ALIMTALK_FALLBACK_TYPE_WHEN_SQL} ELSE msg_type END`)).toBe(true);
  });

  it('바뀐 유형은 문자 청구 유형키로 간다(에이전트 대체분 KS/KL 을 문자 단가로 청구하는 0904 규칙과 같다)', () => {
    expect(MSG_TYPE_TO_USAGE_KEY[alimtalkFallbackMsgType('K', 7830) as string]).toBe('SMS');
    expect(MSG_TYPE_TO_USAGE_KEY[alimtalkFallbackMsgType('K', 7831) as string]).toBe('LMS');
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
    expect(src('utils/sms-result-map.ts')).toContain('const ch = classifyMsgChannel(r.msg_type, r.k_oriseq, r.status_code);');
  });
});
