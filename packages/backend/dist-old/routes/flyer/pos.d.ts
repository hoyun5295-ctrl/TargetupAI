/**
 * ★ 전단AI POS Agent 수신 라우트
 * 마운트: /api/flyer/pos
 * CT: CT-F12 flyer-pos-ingest.ts, CT-F16 flyer-pos-ai.ts
 *
 * ⚠️ 이 라우트는 POS Agent(외부 프로세스)에서 호출한다.
 * flyerAuthenticate가 아닌 별도 agent_key 인증을 사용.
 */
declare const router: import("express-serve-static-core").Router;
export default router;
//# sourceMappingURL=pos.d.ts.map