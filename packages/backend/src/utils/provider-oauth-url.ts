/**
 * CT: Provider OAuth authorize URL 빌더 (순수, DB import 0).
 * client_id/redirect_uri를 creds로 주입 — 회사 BYO 자격이든 한줄로 env 자격이든 동일 사용(model B 토대).
 * ★ 2026-07-06: 네이버 빌더 삭제 — 실제 커머스 API는 client_credentials(authorize URL 개념 없음, 서버 실측 확정).
 *   naver-commerce-client.ts 참조. 이 파일은 카페24 전용으로 축소.
 */
import type { ProviderOAuthCredentials } from './provider-credentials';

/**
 * 카페24 authorize URL — https://{mall_id}.cafe24api.com/api/v2/oauth/authorize
 * @throws mall_id 형식 오류 시
 */
export function buildCafe24AuthorizeUrl(
  creds: ProviderOAuthCredentials,
  mallId: string,
  state: string,
  scope: string,
): string {
  if (!/^[a-z0-9_-]+$/i.test(mallId)) {
    throw new Error('카페24 mall_id 형식이 올바르지 않습니다.');
  }
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: creds.clientId,
    state,
    redirect_uri: creds.redirectUri,
    scope,
  });
  return `https://${mallId}.cafe24api.com/api/v2/oauth/authorize?${params.toString()}`;
}
