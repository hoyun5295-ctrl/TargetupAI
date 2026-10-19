/**
 * session-data.ts — 로그아웃 · 401 에서 지울 세션 저장 키(★ 2026-10-19 B-1018-5③)
 *
 * 같은 탭에서 다른 계정으로 로그인하면 앞 계정의 임시 글 · 넘기기 문장 · 만들던 결과가 남아 보였다(1019 AI 한줄로 실화면과 같은 부류).
 * 여기 = 회사 데이터가 담기는 키만. 지우면 안 되는 키는 넣지 않는다:
 *   로그인 뒤 돌아갈 주소(hj_login_return_path) · 카페24 연결 복귀 몰(cafe24_return_mall_id · 로그인 성공 때 소비 · Codex D1) ·
 *   강제 로그아웃 사유(forceLogoutReason) · 새 판 한 번 새로고침 표식 · 화면 자리 기억.
 * AI 한줄로 진행은 utils/ai-line.ts clearAiLineRuns 가 따로 소유한다.
 */
const EXACT_KEYS = [
  'hj_event_dm_draft', 'hj_event_email_draft', 'hj_event_inapp_pkg',   // EventCampaignModal 임시 글
  'hj_ai_build_result',                                                  // AI 자동제작 결과(utils/ai-build.ts)
  'jmap-interview-v1',                                                   // 여정 문장 만들기 인터뷰(InterviewModal)
  'aiOperatorPrefill', 'ai_operator_prefill_objective', 'continuousOperatorPrefill', 'journeyObjectivePrefill', 'segment_prefill_card',   // 화면 넘기기 문장
] as const;
const PREFIX_KEYS = ['diagnosis-draft-'] as const;                     // 진단 마법사 답(판별)

export function clearSessionCompanyData(): void {
  try {
    const drop: string[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const k = sessionStorage.key(i);
      if (k && ((EXACT_KEYS as readonly string[]).includes(k) || PREFIX_KEYS.some((p) => k.startsWith(p)))) drop.push(k);
    }
    for (const k of drop) sessionStorage.removeItem(k);
  } catch { /* 무시 */ }
}
