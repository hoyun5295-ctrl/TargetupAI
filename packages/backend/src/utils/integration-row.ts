/**
 * ★ CT: 자사몰 연동 행 만들기 · 몰 접두 외부 번호(★ 2026-10-28 자사몰 대비 K9 · 불변 I9 · 결함 M38)
 *
 * 1. createIntegrationRow = `INSERT INTO company_integrations` 의 유일한 자리(R1). 새 행에 meta.id_prefix(몰 접두)를 고정하고,
 *    다시 저장(ON CONFLICT)은 들어온 meta 에서 id_prefix 를 걷어 합친다 — 재연결 · 재저장이 접두를 바꾸지 못한다(빈 접두였던 옛 행도 그대로).
 * 2. mallScopedIds = 어댑터가 식별 · 주문 적재에 싣는 외부 회원 · 주문 번호의 유일한 출처(R1). 접두 = 그 행 id_prefix ??
 *    (우커머스 ? `{몰}:` : '') — 옛 행은 빈 접두라 출력 글자가 지금과 같고, 우커머스는 지금 접두 그대로다.
 *    회원 번호 → 비회원은 `guest:{휴대폰}` → 번호도 없으면 `order:{주문번호}`(옛 cdp-order-identity 규칙을 안으로 합침).
 */
import type { TxRun } from '../config/database';
import { sealSecret, sealMetaSecrets, webhookSecretColumnFitsSealed } from './secret-box';

/** 새 연동 행의 몰 접두 — 고도몰 · 자체호스팅은 회사당 몰 하나라 빈 접두(둘째 몰은 요청이 올 때 몰 식별자 칸부터 · 설계서 K9) */
export function newRowIdPrefix(provider: string, mallId: string): string {
  return provider === 'godo' || provider === 'custom' ? '' : `${mallId}:`;
}

/** INSERT 칸 값 — 바인드 값 또는 SQL 식 */
export type RowVal = { v: unknown; cast?: string } | { sql: string };

export interface IntegrationRowSpec {
  companyId: string;
  provider: string;
  mallId: string;
  status: RowVal;
  meta: object;
  accessToken?: RowVal;
  refreshToken?: RowVal;
  tokenExpiresAt?: RowVal;
  scope?: RowVal;
  webhookSecret?: RowVal;
  connectedAt?: RowVal;
  /** 이미 있는 행에서 바꿀 칸(meta · updated_at 밖) — EXCLUDED.* · company_integrations.* 를 쓸 수 있다 */
  onConflict: string[];
  /** 이미 있는 행의 meta 식 — existing = 그 행 meta · incoming = 들어온 meta(id_prefix 걷음). 기본 = existing || incoming */
  metaOnConflict?: (existing: string, incoming: string) => string;
  returning?: string;
}

export async function createIntegrationRow(run: TxRun, spec: IntegrationRowSpec): Promise<any> {
  // ★ 1028 K8 — 자격 칸 · meta 비밀 키는 이 자리에서 암호화(키 없음 = 평문 · webhook_secret 은 칸이 넓어진 뒤(DDL-2)만)
  const sealV = (x: RowVal | undefined): RowVal | undefined => (x && 'v' in x && typeof x.v === 'string' ? { ...x, v: sealSecret(x.v) } : x);
  const sealWebhook = spec.webhookSecret && 'v' in spec.webhookSecret && typeof spec.webhookSecret.v === 'string' && await webhookSecretColumnFitsSealed();
  spec = {
    ...spec,
    accessToken: sealV(spec.accessToken),
    refreshToken: sealV(spec.refreshToken),
    webhookSecret: sealWebhook ? sealV(spec.webhookSecret) : spec.webhookSecret,
    meta: sealMetaSecrets(spec.meta),
  };
  const params: unknown[] = [spec.companyId, spec.provider, spec.mallId];
  const val = (x: RowVal | undefined, dflt: string): string => {
    if (!x) return dflt;
    if ('sql' in x) return x.sql;
    params.push(x.v);
    return `$${params.length}${x.cast ? `::${x.cast}` : ''}`;
  };
  const access = val(spec.accessToken, "''");
  const refresh = val(spec.refreshToken, "''");
  const expires = val(spec.tokenExpiresAt, 'NULL');
  const scope = val(spec.scope, "''");
  const secret = val(spec.webhookSecret, 'NULL');
  const connected = val(spec.connectedAt, 'NULL');
  const status = val(spec.status, "'pending'");
  params.push(JSON.stringify({ ...spec.meta, id_prefix: newRowIdPrefix(spec.provider, spec.mallId) }));
  const meta = `$${params.length}::jsonb`;
  const existing = 'company_integrations.meta';
  const incoming = `(EXCLUDED.meta - 'id_prefix')`;
  const metaSet = spec.metaOnConflict ? spec.metaOnConflict(existing, incoming) : `${existing} || ${incoming}`;
  return run(
    `INSERT INTO company_integrations (
      id, company_id, provider, mall_id, access_token, refresh_token,
      token_expires_at, scope, meta, webhook_secret, connected_at, status, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), $1::uuid, $2, $3, ${access}, ${refresh},
      ${expires}, ${scope}, ${meta}, ${secret}, ${connected}, ${status}, NOW(), NOW()
    )
    ON CONFLICT (company_id, provider, mall_id) DO UPDATE SET
      meta = ${metaSet},
      ${[...spec.onConflict, 'updated_at = NOW()'].join(',\n      ')}${spec.returning ? `\n    RETURNING ${spec.returning}` : ''}`,
    params,
  );
}

/** 외부 번호 범위 — 연동 행(제공자 · 몰 식별자 · meta.id_prefix 원문 · 없으면 null) */
export interface MallScope {
  provider: string;
  mallId: string;
  idPrefix?: string | null;
}

export function mallIdPrefix(scope: MallScope): string {
  if (typeof scope.idPrefix === 'string') return scope.idPrefix;
  return scope.provider === 'woocommerce' ? `${scope.mallId}:` : '';
}

/**
 * 그 몰의 외부 번호 — memberExternalId = 회원 번호만(회원 정보 웹훅 · 가져오기) · externalId = 주문의 고객 열쇠(회원 → guest → order) ·
 * orderId = 주문 번호(번호가 없으면 빈 글자). 접두는 셋 모두 같은 몰 접두.
 */
export function mallScopedIds(
  scope: MallScope,
  ids: { memberId?: unknown; phone?: unknown; orderId?: unknown },
): { memberExternalId: string; externalId: string; orderId: string } {
  const p = mallIdPrefix(scope);
  const m = String(ids.memberId ?? '').trim();
  const ph = String(ids.phone ?? '').trim();
  const o = String(ids.orderId ?? '').trim();
  return {
    memberExternalId: m ? `${p}${m}` : '',
    externalId: m ? `${p}${m}` : ph ? `${p}guest:${ph}` : `${p}order:${o}`,
    orderId: o ? `${p}${o}` : '',
  };
}
