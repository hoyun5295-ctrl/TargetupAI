/**
 * 채널별 발송 자격 WHERE 빌더 (순수 — DB import 0, 파라미터 0)
 *
 * 🎯 목적
 *   타겟 추출(/api/targets/extract)에서 "이 채널로 실제 보낼 수 있는 인원수(channelEligibleCount)"를
 *   계산할 때 쓰는 채널별 안전 WHERE 절을 한 곳에서 만든다.
 *
 * ⛔ 원칙 — 미리보기 인원수는 실제 발송 경로와 같아야 한다 (LESSONS D230+).
 *   아래 각 채널 WHERE는 발송 경로의 실제 자격 필터를 grep으로 확정해 그대로 미러한 것이다:
 *   - email : email-channel.ts RECIPIENT_SAFETY_WHERE
 *             (email 있음(@포함) + email_opt_in IS DISTINCT FROM false[NULL 허용] + opt_out/invalid 아님, is_active 미적용)
 *   - dm    : ai-segment-generator previewMatching 문자 발송 base (is_active·sms_opt_in 강제 + opt_out/invalid NULL 안전)
 *   - kakao : journey-executor 발송 직전 안전필터 (문자 자격과 동일 — 정보성도 현재 sms_opt_in 포함)
 *   - inapp : inapp-segment-matcher(CT-78) 표시 자격 (is_active 만 — 별도 식별자 컬럼 없음)
 *
 *   값(필터 조건)은 buildCustomerFilter가 파라미터화해 따로 AND로 결합한다.
 *   여기서 만드는 절은 리터럴뿐이라 주입 표면이 없다(alias만 검증).
 *
 * ★ 후속(P2 이메일 배선 시): email-channel.ts RECIPIENT_SAFETY_WHERE를 이 CT의 email 절로 단일화 + 1건 실측.
 *   현재는 발송 경로를 건드리지 않기 위해 동일 문자열을 미러만 한다.
 */

export type ChannelKey = 'email' | 'dm' | 'inapp' | 'kakao';

/** SQL 식별자(테이블 alias)로 안전한 문자만 허용 — 주입 차단 */
const SAFE_ALIAS = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * 채널별 발송 자격 WHERE 절(리터럴 조건들의 AND 결합, 선두 AND 없음).
 * @param channel 대상 채널
 * @param alias customers 테이블 alias (기본 'c')
 * @throws 지원하지 않는 채널 / 안전하지 않은 alias
 */
export function buildChannelEligibilityWhere(channel: ChannelKey, alias: string = 'c'): string {
  if (!SAFE_ALIAS.test(alias)) {
    throw new Error(`안전하지 않은 테이블 alias: ${alias}`);
  }
  const a = alias;

  switch (channel) {
    case 'email':
      return (
        `${a}.email IS NOT NULL AND ${a}.email LIKE '%@%' ` +
        `AND ${a}.email_opt_in IS DISTINCT FROM false ` +
        `AND ${a}.is_opt_out IS DISTINCT FROM true ` +
        `AND ${a}.is_invalid IS DISTINCT FROM true`
      );
    case 'dm':
    case 'kakao':
      return (
        `${a}.is_active = true AND ${a}.sms_opt_in = true ` +
        `AND (${a}.is_opt_out = false OR ${a}.is_opt_out IS NULL) ` +
        `AND (${a}.is_invalid = false OR ${a}.is_invalid IS NULL)`
      );
    case 'inapp':
      return `${a}.is_active = true`;
    default:
      throw new Error(`지원하지 않는 채널: ${channel}`);
  }
}
