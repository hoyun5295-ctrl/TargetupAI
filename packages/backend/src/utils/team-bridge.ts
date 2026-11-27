/**
 * ★ CT: Team 한줄로 다리(한줄로AI 쪽) — 2026-11-26 Team 한줄로 가(토대) · 설계서 = C:\Users\ceo\projects\team-hanjullo\docs\design.md §9-7
 *
 * Team 한줄로는 한줄로AI 와 성격이 다른 별개 플랫폼이다(Harold 1126 「아예 분리」). Team 은 한줄로 DB 를 읽지 않고,
 * 한줄로AI 가 이 다리로 내주는 값만 받는다. 데이터를 줄지 말지는 슈퍼관리자가 회사마다 정한다(「Team 한줄로로 데이터 주기」 스위치).
 * 사용구분(companies.usage_type = web · agent · both)은 그대로 둔다 — 값을 늘리지 않는다(청구 · 결과 · 로그인 제한이 읽는 칸).
 *
 * 문지기(다리 문) = 루프백 출발지(ip-allowlist CT · trust proxy 'loopback' 이라 nginx 를 거친 요청은 실제 출발지로 판정) + 서비스 키(TEAM_BRIDGE_KEY · 32자 이상 · 없으면 문 닫힘).
 * 표 = team_bridge_companies(company_id PK · enabled · updated_by · updated_at) · 표가 없으면 라우트가 503 DB_MIGRATION_PENDING.
 */
import crypto from 'crypto';
import { query } from '../config/database';
import { isIpAllowed, parseIpAllowlist } from './ip-allowlist';

const LOOPBACK = parseIpAllowlist('127.0.0.1,::1');
/** 해지 회사는 Team 으로 값이 가지 않는다 — 이 판정의 유일한 자리(다리 목록 · 슈퍼관리자 표 · 켜기가 함께 쓴다 · Codex C166 1R #1) */
const NOT_TERMINATED = `c.status IS DISTINCT FROM 'terminated'`;
const MIN_KEY_LEN = 32;

/** 다리 문을 부른 곳이 같은 서버(루프백)인가 */
export function isTeamBridgeCallerAllowed(rawIp: string | null | undefined): boolean {
  return isIpAllowed(rawIp, LOOPBACK);
}

/** 서비스 키 대조 — 길이를 새지 않게 해시끼리 일정 시간 비교 · 키가 없거나 짧으면 늘 거절(닫힌 쪽) */
export function teamBridgeKeyOk(given: unknown, expected: string | undefined = process.env.TEAM_BRIDGE_KEY): boolean {
  const e = String(expected ?? '').trim();
  if (e.length < MIN_KEY_LEN || typeof given !== 'string' || !given) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(e).digest();
  return crypto.timingSafeEqual(a, b);
}

export interface TeamBridgeCompany {
  id: string;
  name: string;
  usageType: 'web' | 'agent' | 'both';
  status: string;
}

/** Team 으로 값이 가는 회사 = 스위치 켬 · 해지 아님(다리 문이 Team 에 주는 목록) */
export async function listTeamEnabledCompanies(): Promise<TeamBridgeCompany[]> {
  const r = await query(
    `SELECT c.id, c.company_name, c.usage_type, c.status
       FROM team_bridge_companies t
       JOIN companies c ON c.id = t.company_id
      WHERE t.enabled = true AND ${NOT_TERMINATED}
      ORDER BY c.company_name`,
  );
  return r.rows.map((row: any) => ({
    id: String(row.id),
    name: String(row.company_name ?? ''),
    usageType: row.usage_type === 'agent' || row.usage_type === 'both' ? row.usage_type : 'web',
    status: String(row.status ?? ''),
  }));
}

/** 슈퍼관리자 회사 목록에 「Team」 표를 달 회사 id — 다리 목록과 같은 판정(해지 회사는 표 없음) */
export async function listTeamEnabledIds(): Promise<string[]> {
  const r = await query(
    `SELECT t.company_id FROM team_bridge_companies t JOIN companies c ON c.id = t.company_id WHERE t.enabled = true AND ${NOT_TERMINATED}`,
  );
  return r.rows.map((row: any) => String(row.company_id));
}

/**
 * 스위치 켜기 · 끄기 — 저장된 결과(켬 · 끔)를 돌려준다(화면 안내는 이 값으로 · Codex C166 1R #2).
 * 없는 회사 · 해지 회사 켜기 = null(끄기는 해지 회사도 받는다).
 * 회사 행을 FOR SHARE 로 잡고 판정한다 — 해지(UPDATE)와 겹치면 해지 커밋을 기다린 뒤 바뀐 행으로 다시 판정해 null(Codex C166 2R #1).
 */
export async function setTeamBridge(companyId: string, enabled: boolean, actorId: string | null): Promise<boolean | null> {
  const r = await query(
    `INSERT INTO team_bridge_companies (company_id, enabled, updated_by, updated_at)
     SELECT c.id, $2, $3, now() FROM companies c WHERE c.id = $1 AND ($2 = false OR ${NOT_TERMINATED})
     FOR SHARE OF c
     ON CONFLICT (company_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING enabled`,
    [companyId, enabled, actorId],
  );
  return r.rows.length ? r.rows[0].enabled === true : null;
}
