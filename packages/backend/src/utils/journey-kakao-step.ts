/**
 * journey-kakao-step.ts — 여정 알림톡 칸을 보낼 수 있는가 판정 한 곳(★ 2026-11-02 설계서 docs/2026-11-02-journey-automarketing-core-fix-design.md 3-14 · 3-0 CT-J5).
 *
 * 왜 있나
 *   실행기만 템플릿 코드 · 존재 · 승인 · 카카오 활성을 봐서, 템플릿이 없거나 미승인인 알림톡 칸도 켜졌다가 첫 고객이 들어오는 순간 여정이 멈췄다(D11).
 *   켜기 검증은 칸 본문(message_template)의 #{…} 만 연결을 봤는데 실행기는 승인 템플릿 본문을 채운다 → 둘이 다르면 검사를 지난 칸이 빈 자리로 나갔다(D21).
 *   → 켜기 · 켜기 검증 · 실행기가 이 함수 하나를 부른다. 변수 연결 = 실제로 보내는 글(kakao_templates.content) 기준(alimtalk-vars findUnfilledAlimtalkVars).
 */
import { query } from '../config/database';
import { decideKakaoTemplateSendable, getImcTemplateStatusSafe } from './kakao-template-guard';
import { findUnfilledAlimtalkVars } from './alimtalk-vars';
import type { RepresentLink } from './alimtalk-emphasize';

export interface KakaoTemplateRow {
  id: string;
  template_code: string;
  content: string;
  buttons: any[];
  status: string;
  emphasize_title?: string | null;
  represent_link?: RepresentLink | null;
  profile_key?: string | null;
}

export interface KakaoStepBlock {
  /** 실행 기록 · 멈춤 기록 코드 */
  reason: string;
  /** 실행기 멈춤 사유(여정 멈춤 칸 · 화면은 pauseReasonView 가 다시 읽는다) */
  pauseText: string;
  /** 켜기 · 점검 화면 문장(담당자 말) */
  userText: string;
}

export interface KakaoStepVerdict {
  /** 승인 템플릿 행(막혔어도 찾았으면 준다 · 실행기 렌더 · 버튼 · 강조 표기) */
  row: KakaoTemplateRow | null;
  block: KakaoStepBlock | null;
}

/** ★ 2026-11-05 C103 F11 — 그 회사의 그 템플릿 본문(판정 · 실행기와 같은 행 · 회사 격리 · 없으면 null) · run = 잠금 쥔 트랜잭션 연결 */
export async function kakaoTemplateContent(
  companyId: string,
  code: string,
  run: (sql: string, params?: any[]) => Promise<{ rows: any[] }> = query,
): Promise<string | null> {
  const c = String(code || '').trim();
  if (!c) return null;
  const r = await run(`SELECT content FROM kakao_templates WHERE template_code = $1 AND company_id = $2::uuid LIMIT 1`, [c, companyId]);
  return r.rows[0] ? String(r.rows[0].content ?? '') : null;
}

/** 알림톡 칸 판정 — 템플릿 코드 · 존재(회사 격리) · 승인 · 카카오 활성 · 템플릿 본문 변수 연결 */
export async function kakaoStepVerdict(
  companyId: string,
  step: { step_order: number | string; alimtalk_template_code: string | null; alimtalk_variable_map: Record<string, string> | null },
): Promise<KakaoStepVerdict> {
  const order = step.step_order;
  const code = String(step.alimtalk_template_code || '').trim();
  if (!code) {
    return { row: null, block: { reason: 'alimtalk_template_code_empty', pauseText: `step ${order} 알림톡 템플릿 코드가 비어있어 발송 차단`, userText: '알림톡 템플릿을 고르지 않았어요. 템플릿을 골라 주세요.' } };
  }
  const tplRes = await query(
    `SELECT t.id, t.template_code, t.content, t.buttons, t.status, t.emphasize_title, t.represent_link, p.profile_key
       FROM kakao_templates t
       LEFT JOIN kakao_sender_profiles p ON p.id = t.profile_id
      WHERE t.template_code = $1 AND t.company_id = $2::uuid LIMIT 1`,
    [code, companyId],
  );
  if (tplRes.rows.length === 0) {
    return { row: null, block: { reason: 'alimtalk_template_not_found', pauseText: `step ${order} 알림톡 템플릿(${code}) 미존재 또는 회사 격리 위반`, userText: '고른 알림톡 템플릿을 찾을 수 없어요. 템플릿을 다시 골라 주세요.' } };
  }
  const row = tplRes.rows[0] as KakaoTemplateRow;
  if (!['APPROVED', 'APR'].includes(String(row.status || '').toUpperCase())) {
    return { row, block: { reason: 'alimtalk_template_not_approved', pauseText: `step ${order} 알림톡 템플릿 미승인 (status=${row.status})`, userText: '알림톡 템플릿이 아직 승인되지 않았어요. 승인된 템플릿을 골라 주세요.' } };
  }
  // ★ CT-87 (2026-06-10): 카카오 활성상태(A) 가드 — 활성 대기(R) 템플릿은 카카오가 전부 7300 거부
  const guard = decideKakaoTemplateSendable(await getImcTemplateStatusSafe(companyId, code));
  if (!guard.sendable) {
    return { row, block: { reason: 'alimtalk_template_inactive', pauseText: `step ${order} ${guard.reason || '카카오 템플릿 비활성'}`, userText: `알림톡 템플릿을 지금 보낼 수 없어요(${guard.reason || '카카오 템플릿 비활성'}).` } };
  }
  const unfilled = findUnfilledAlimtalkVars(row.content, step.alimtalk_variable_map);
  if (unfilled.length > 0) {
    return { row, block: { reason: 'alimtalk_variable_unmapped', pauseText: `step ${order} 알림톡 템플릿 변수 연결 빠짐 (${unfilled.join(', ')})`, userText: `알림톡 템플릿의 ${unfilled.join(', ')} 에 넣을 값을 연결해 주세요.` } };
  }
  return { row, block: null };
}
