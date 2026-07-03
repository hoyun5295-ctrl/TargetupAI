/**
 * ★ CT: 카페24 scripttags 자동삽입 — 연동 = 행동 수집(SDK) 개통 (2026-07-03 B-2)
 *
 * OAuth 연동 성공 직후 몰에 한줄로 SDK <script>를 자동 등록(scripttags Admin API).
 * 설치 담당자 추가 작업 0 — 몰 1클릭 연동만으로 page_view/click 수집이 켜진다.
 *
 * 멱등: 기존 등록 여부를 GET으로 확인 후 없을 때만 POST. script_no는 company_integrations.meta에 보관.
 * fire-and-forget: 실패해도 연동 자체엔 영향 없음(로그만) — 호출부가 .catch로 삼킨다.
 *
 * ⚠ scripttags Admin API 필드(display_location 허용값·응답 script_no·요청 wrapper)는
 *   gyunoo83 재연동 실측의 raw 응답 로그(`[Cafe24 ScriptTag] 등록 응답(raw)`)로 최종 확정한다.
 *   mall.write_application scope(B-1) 필요 — 기존 연동 몰은 재동의 후에만 등록 성공.
 */

import { query } from '../config/database';
import { getCafe24Integration, cafe24ApiCall, getCafe24ByoCredentials } from './cafe24-client';
import { issueCdpKeyPair } from './cdp-auth';

// 카페24 scripttag src는 CORS(Access-Control-Allow-Origin: *)가 필수 → backend CORS 서빙 경로 사용.
//   (nginx 정적 /sdk/ 엔 CORS 헤더 없음 — 422 방지.) ?k= 로 공개 키 전달(SDK v0.3.8+ fallback).
const SDK_SRC_BASE = 'https://app.hanjul.ai/api/cafe24/sdk/v0.3.8/hanjul.min.js';

/** 회사 CDP public key 확보 — 있으면 재사용(기존 SDK 설치 보호), 없을 때만 신규 발급. */
async function ensureCompanyPublicKey(companyId: string): Promise<string | null> {
  const r = await query(`SELECT cdp_api_key FROM companies WHERE id = $1::uuid`, [companyId]);
  const existing = r.rows[0]?.cdp_api_key as string | undefined;
  if (existing) return existing;
  const issued = await issueCdpKeyPair(companyId);
  return issued.cdpApiKey;
}

function buildSdkSrc(publicKey: string): string {
  return `${SDK_SRC_BASE}?k=${encodeURIComponent(publicKey)}`;
}

async function mergeIntegrationMeta(companyId: string, mallId: string, patch: Record<string, unknown>): Promise<void> {
  await query(
    `UPDATE company_integrations
     SET meta = COALESCE(meta, '{}'::jsonb) || $3::jsonb, updated_at = NOW()
     WHERE company_id = $1::uuid AND provider = 'cafe24' AND mall_id = $2`,
    [companyId, mallId, JSON.stringify(patch)]
  );
}

/**
 * 몰에 한줄로 SDK scripttag를 멱등 등록. 연동 성공 직후 fire-and-forget 호출.
 */
export async function ensureCafe24ScriptTag(companyId: string, mallId: string): Promise<void> {
  const integration = await getCafe24Integration(companyId, mallId);
  if (!integration) {
    console.log('[Cafe24 ScriptTag] 연동 정보 없음 — skip:', mallId);
    return;
  }

  const publicKey = await ensureCompanyPublicKey(companyId);
  if (!publicKey) {
    console.log('[Cafe24 ScriptTag] public key 확보 실패 — skip:', mallId);
    return;
  }
  const src = buildSdkSrc(publicKey);
  const byoCreds = await getCafe24ByoCredentials(companyId, mallId);

  // 멱등 — 이미 우리 SDK가 등록돼 있으면 script_no만 meta에 갱신하고 종료
  try {
    const list = await cafe24ApiCall<any>(integration, '/scripttags', { method: 'GET' }, byoCreds);
    const tags = Array.isArray(list?.scripttags) ? list.scripttags : [];
    const mine = tags.find(
      (s: any) => typeof s?.src === 'string' && s.src.includes('/sdk/') && s.src.includes('hanjul'),
    );
    if (mine?.script_no) {
      console.log('[Cafe24 ScriptTag] 이미 등록됨 script_no=', mine.script_no, 'mall=', mallId);
      await mergeIntegrationMeta(companyId, mallId, { scripttag_no: mine.script_no, scripttag_src: mine.src });
      return;
    }
  } catch (e: any) {
    console.log('[Cafe24 ScriptTag] 기존 목록 조회 실패(신규 등록 진행):', e?.message || e);
  }

  // 신규 등록 — 요청 wrapper·display_location은 raw 응답 로그로 실측 확정
  const body = {
    shop_no: 1,
    request: {
      src,
      display_location: ['ALL'],
    },
  };
  const res = await cafe24ApiCall<any>(integration, '/scripttags', { method: 'POST', body }, byoCreds);
  console.log('[Cafe24 ScriptTag] 등록 응답(raw):', JSON.stringify(res).slice(0, 800));
  const scriptNo = res?.scripttag?.script_no ?? res?.scripttags?.[0]?.script_no ?? null;
  await mergeIntegrationMeta(companyId, mallId, { scripttag_no: scriptNo, scripttag_src: src });
  console.log('[Cafe24 ScriptTag] 등록 완료 script_no=', scriptNo, 'mall=', mallId);
}

/**
 * 연동 해제 시 등록했던 scripttag 제거. fire-and-forget(실패 무시).
 */
export async function removeCafe24ScriptTag(companyId: string, mallId: string): Promise<void> {
  try {
    const r = await query(
      `SELECT meta FROM company_integrations
       WHERE company_id = $1::uuid AND provider = 'cafe24' AND mall_id = $2 LIMIT 1`,
      [companyId, mallId],
    );
    const scriptNo = (r.rows[0]?.meta || {})?.scripttag_no;
    if (!scriptNo) return;

    const integration = await getCafe24Integration(companyId, mallId);
    if (!integration) return;
    const byoCreds = await getCafe24ByoCredentials(companyId, mallId);

    await cafe24ApiCall<any>(integration, `/scripttags/${scriptNo}`, { method: 'DELETE' }, byoCreds);
    await mergeIntegrationMeta(companyId, mallId, { scripttag_no: null });
    console.log('[Cafe24 ScriptTag] 제거 완료 script_no=', scriptNo, 'mall=', mallId);
  } catch (e: any) {
    console.log('[Cafe24 ScriptTag] 제거 실패(무시):', e?.message || e);
  }
}
