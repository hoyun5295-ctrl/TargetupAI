/**
 * CT: Provider OAuth 자격 해석 — 회사별 BYO 자격(company_integrations.meta) 우선, 없으면 env fallback.
 * 순수 함수 (DB import 0) — model B(고객이 자기 카페24·네이버 self-app 키를 직접 입력) 토대.
 *
 * 규칙: client_id / client_secret / redirect_uri 셋이 모두 있어야 채택. 하나라도 비면 그 출처는 미채택.
 *   - 회사 meta 자격 완비 → 'company'
 *   - 회사 미완비 + env(한줄로 자체 앱) 완비 → 'env'
 *   - 둘 다 미완비 → { ok:false, reason:'missing' } (호출부가 503 친절 안내)
 */

export interface ProviderOAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** company_integrations.meta 에 보관되는 회사 자체 앱 자격 (snake_case). */
export interface CompanyMetaCreds {
  app_client_id?: string | null;
  app_client_secret?: string | null;
  app_redirect_uri?: string | null;
}

export type ResolvedCredentials =
  | { ok: true; source: 'company' | 'env'; credentials: ProviderOAuthCredentials }
  | { ok: false; reason: 'missing' };

/** 공백/빈 문자열은 미사용 취급 — trim 후 1자 이상이면 정상값 반환. */
function usable(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** 셋 모두 정상값이면 자격 객체, 하나라도 비면 null. */
function complete(
  clientId: string | null | undefined,
  clientSecret: string | null | undefined,
  redirectUri: string | null | undefined,
): ProviderOAuthCredentials | null {
  const id = usable(clientId);
  const secret = usable(clientSecret);
  const redirect = usable(redirectUri);
  if (id && secret && redirect) return { clientId: id, clientSecret: secret, redirectUri: redirect };
  return null;
}

/**
 * 회사 자격(meta) 우선, 없으면 env fallback, 둘 다 없으면 missing.
 * @param metaCreds company_integrations.meta 의 app_client_id/secret/redirect_uri
 * @param envCreds 한줄로 자체 앱 env 자격 (CAFE24_CLIENT_ID 등) — 회사 자격이 우선이라 보조
 */
export function resolveProviderOAuthCredentials(
  metaCreds: CompanyMetaCreds | null | undefined,
  envCreds: Partial<ProviderOAuthCredentials> | null | undefined,
): ResolvedCredentials {
  const company = complete(metaCreds?.app_client_id, metaCreds?.app_client_secret, metaCreds?.app_redirect_uri);
  if (company) return { ok: true, source: 'company', credentials: company };

  const env = complete(envCreds?.clientId, envCreds?.clientSecret, envCreds?.redirectUri);
  if (env) return { ok: true, source: 'env', credentials: env };

  return { ok: false, reason: 'missing' };
}
