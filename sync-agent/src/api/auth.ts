/**
 * API 인증 헤더 관리
 */

export interface AuthCredentials {
  apiKey: string;
  apiSecret: string;
}

/**
 * 인증 헤더를 생성합니다.
 */
export function createAuthHeaders(credentials: AuthCredentials): Record<string, string> {
  return {
    'X-Sync-ApiKey': credentials.apiKey,
    'X-Sync-Secret': credentials.apiSecret,
    'Content-Type': 'application/json',
  };
}
