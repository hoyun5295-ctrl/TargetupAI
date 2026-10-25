/**
 * 승인 마감 시각(첫 발송일 · KST) — 발송 창이 닫히기 한 시간 앞에서 끊는다(설계서 Q5 · §6-4).
 * ★ 2026-10-25 원장 #62 — 순수 모듈로 뺐다(import 0). 플래너 확인(planner-confirm) · 사유 문장(planner-reasons · DB 0 원칙) · 화면(GET /api/send-policy)이 이 값 하나를 읽는다.
 */
export const PLANNER_APPROVAL_DEADLINE_HOUR = 20;
