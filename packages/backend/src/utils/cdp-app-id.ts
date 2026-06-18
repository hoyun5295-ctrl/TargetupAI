/**
 * cdp-app-id.ts — CDP 네이티브 앱 키 인증 순수 헬퍼 (DB-free)
 *
 * 자사몰 연동(CDP)이 웹 전용(도메인 Origin)이라 네이티브 앱은 Origin을 못 보낸다.
 * 앱은 public key(X-Hanjullo-Key) + 등록 번들ID(X-Hanjullo-App-Id)로 인증한다.
 * companies.cdp_allowed_app_ids(text[]) = cdp_allowed_origins의 앱 버전.
 *
 * ★ 이 파일은 config/database를 import하지 않는다(순수). cdp-auth.ts·cdp.ts가 import해 쓰고,
 *   .verify.ts가 DB 없이 테스트한다(config/database import 시 process.exit(1) 회피 — LESSONS_BACKEND).
 */

/** 번들ID 정규화 — 트림 + 소문자 */
export function normAppId(s: string): string {
  return String(s || '').trim().toLowerCase();
}

/** 역DNS 번들ID 형식 검증 (예: kr.poppon.app, com.example.myapp) — 정규화 후 판정 */
export function isValidBundleId(s: string): boolean {
  const id = normAppId(s);
  return /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/.test(id);
}

/** 등록된 번들ID 목록(회사 cdp_allowed_app_ids)에 appId가 있는지 — 양쪽 정규화 비교 */
export function isAllowedAppId(allowed: string[] | null | undefined, appId: string): boolean {
  const id = normAppId(appId);
  if (!id) return false;
  if (!Array.isArray(allowed) || allowed.length === 0) return false;
  return allowed.map(normAppId).includes(id);
}
