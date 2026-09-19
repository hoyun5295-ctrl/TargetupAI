/**
 * system-alimtalk.ts — 한줄로가 직접 보내는 인증번호를 승인 알림톡으로 (★2026-09-19 Harold 지시)
 *
 * 대상 = 로그인 다중인증(mfa.ts) · 발신번호 추가인증(sender-auth.ts) 두 가지뿐이다(충전 안내 2종은 Harold 제외).
 * 알림톡이 실패하면 **같은 문구를 SMS로** 게이트웨이가 자동 전환한다(k_next_type 'S' · alimtalk-fallback CT).
 *
 * ⛔ 이 함수는 "실었다/못 실었다"만 돌려준다. 못 실은 이유가 무엇이든 false → 호출부가 **종전 문자**를 보낸다.
 *    인증번호가 안 가면 로그인·발신이 막힌다. 알림톡은 더 나은 길일 뿐 유일한 길이 아니다.
 * ⛔ 본문은 템플릿 원장(kakao_templates.content)을 채운 것이다. 코드에 문구를 적지 않는다 —
 *    카카오는 승인 문구와 글자까지 같아야 받는다.
 * ⛔ 청구·발송결과·AI 학습에 안 잡힌다: app_etc1 미기재(테스트발송 청구 = app_etc1='test' 조건 · 학습 코퍼스 = appEtc1 필수 ·
 *    발송결과 = 캠페인 id 매칭). 회사 식별(app_etc2)은 **비토 라인일 때만** 싣는다 — 그 라인은 발신프로필 키를
 *    템플릿 코드 + 회사로 찾기 때문이다(sms-queue insertAlimtalkQueue). 그 외 라인은 종전 인증 문자처럼 식별 컬럼 0.
 *
 * 스위치(ENV · 둘 다 있어야 켜진다 · 배포만으로는 아무것도 안 바뀐다):
 *   SYSTEM_ALIMTALK_KINDS      = 'mfa_login,sender_auth' 처럼 켤 종류(쉼표) · 비면 전부 종전 문자
 *   SYSTEM_ALIMTALK_LINE_GROUP = 내보낼 라인그룹 이름(sms_line_groups.group_name · 예: 한줄로01) — 코드에 라인을 적지 않는다
 */
import { query } from '../config/database';
import { insertAlimtalkQueue, getBitoSmsTables, getPlatformNoticeCallback } from './sms-queue';
import { isValidSmsTable } from './sms-table-validator';
import { fillAlimtalkVarMap, findUnfilledAlimtalkVars } from './alimtalk-vars';
import { resolveAlimtalkFallback } from './alimtalk-fallback';

export type AuthAlimtalkKind = 'mfa_login' | 'sender_auth';

/**
 * 승인 템플릿 코드(주식회사 인비토 · 발신프로필 "한줄로" · 0919 운영 실측 APPROVED).
 * 문구는 원장이 소유한다 — 여기에는 어느 템플릿을 쓰는지만 적는다.
 */
export const AUTH_ALIMTALK_TEMPLATES: Record<AuthAlimtalkKind, string> = {
  mfa_login: 'B_NG_013_02_84157',   // 다중인증 인증번호 — "[한줄로] / 로그인 인증번호 / #{인증번호}를 5분안에 입력 해주세요."
  sender_auth: 'B_NG_013_02_84158', // 추가인증 인증번호 — "[한줄로] / 발신 인증번호 / #{인증번호}를 5분안에 입력 해주세요."
};

/** 두 템플릿의 유일한 변수 */
export const AUTH_CODE_VAR = '#{인증번호}';

export function isAuthAlimtalkEnabled(kind: AuthAlimtalkKind, env: NodeJS.ProcessEnv = process.env): boolean {
  const kinds = String(env.SYSTEM_ALIMTALK_KINDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return kinds.includes(kind) && String(env.SYSTEM_ALIMTALK_LINE_GROUP || '').trim() !== '';
}

function skip(kind: AuthAlimtalkKind, reason: string): false {
  console.warn(`[system-alimtalk] ${kind} 알림톡 생략 → 종전 문자: ${reason}`);
  return false;
}

/**
 * 인증번호 알림톡 적재. true = 큐에 실었다(호출부는 문자를 보내지 않는다) · false = 호출부가 종전 문자를 보낸다.
 */
export async function trySendAuthCodeAlimtalk(kind: AuthAlimtalkKind, phone: string, code: string): Promise<boolean> {
  if (!isAuthAlimtalkEnabled(kind)) return false;
  const templateCode = AUTH_ALIMTALK_TEMPLATES[kind];
  const groupName = String(process.env.SYSTEM_ALIMTALK_LINE_GROUP || '').trim();
  try {
    const tpl = await query(
      `SELECT t.company_id, t.content, t.status, p.is_active
         FROM kakao_templates t
         JOIN kakao_sender_profiles p ON p.id = t.profile_id
        WHERE t.template_code = $1
        LIMIT 1`,
      [templateCode],
    );
    const row = tpl.rows[0];
    if (!row) return skip(kind, `템플릿 원장에 ${templateCode} 없음`);
    if (row.status !== 'APPROVED') return skip(kind, `템플릿 ${templateCode} 상태 ${row.status}`);
    if (row.is_active === false) return skip(kind, '발신프로필 비활성');
    if (!row.content) return skip(kind, '템플릿 본문 비어 있음');

    const varMap = { [AUTH_CODE_VAR]: String(code) };
    const unfilled = findUnfilledAlimtalkVars(row.content, varMap);
    if (unfilled.length > 0) return skip(kind, `채울 수 없는 변수 ${unfilled.join(',')}`);
    const message = fillAlimtalkVarMap(row.content, varMap, null);

    const lg = await query(
      `SELECT sms_tables FROM sms_line_groups WHERE group_name = $1 AND is_active = true LIMIT 1`,
      [groupName],
    );
    const table = String((lg.rows[0]?.sms_tables || [])[0] || '');
    if (!table || !isValidSmsTable(table)) return skip(kind, `라인그룹 "${groupName}" 테이블 없음·이상(${table || '없음'})`);

    // 실패 전환 = 같은 문구 SMS(규칙 = alimtalk-fallback CT · 인증번호 문구는 SMS 한 통에 들어간다)
    const fallback = resolveAlimtalkFallback({ nextType: 'S' });
    const isBitoLine = (await getBitoSmsTables()).includes(table);

    const inserted = await insertAlimtalkQueue([table], [{
      phone: String(phone).replace(/\D/g, ''),
      callback: getPlatformNoticeCallback(),
      message,
      templateCode,
      nextType: fallback.nextType,
      ...(isBitoLine ? { companyId: row.company_id } : {}),
    }]);
    if (inserted !== 1) return skip(kind, `큐 적재 ${inserted}건`);
    return true;
  } catch (err: any) {
    return skip(kind, `오류 ${err?.message || err}`);
  }
}
