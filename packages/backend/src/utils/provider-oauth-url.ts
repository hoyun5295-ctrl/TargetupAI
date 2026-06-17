/**
 * CT: Provider OAuth authorize URL 빌더 (순수, DB import 0).
 * client_id/redirect_uri를 creds로 주입 — 회사 BYO 자격이든 한줄로 env 자격이든 동일 사용(model B 토대).
 * URL 형식은 기존 cafe24-client.ts / naver-commerce-client.ts와 동일(동작 보존).
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

/**
 * 네이버 커머스 authorize URL — https://api.commerce.naver.com/oauth2/authorize
 */
export function buildNaverCommerceAuthorizeUrl(
  creds: ProviderOAuthCredentials,
  storeId: string,
  state: string,
  scope: string,
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: creds.clientId,
    state,
    redirect_uri: creds.redirectUri,
    scope,
    store_id: storeId,
  });
  return `https://api.commerce.naver.com/oauth2/authorize?${params.toString()}`;
}
