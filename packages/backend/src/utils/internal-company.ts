/**
 * 사내 회사 판정 CT (★ 2026-10-28 B-1028-3 · 뿌리 대장 R1)
 *
 * 사내 회사 = 시연 회사(`companies.is_demo` · demo-company.ts 한 곳) 또는 사내 시험 회사(ENV `INTERNAL_TEST_COMPANY_IDS` · 쉼표 uuid 목록).
 * 쓰는 곳 = 운영 시스템 경보(`sendSystemAlert` 입구 한 곳) · 사내 회사의 연동 · 여정 · 자동마케팅 · 돈 일은 운영 경보 문자로 보내지 않는다(Harold 1028).
 *   목록이 비면(기본) = 시연 회사만 = 지금 동작. 시험 회사는 실제 발송을 하므로 시연 회사(발송 0 · 돈 0)와 따로 둔다.
 * 판정 실패(조회 오류) = 사내 아님(경보는 모르면 보낸다).
 */
import { isDemoCompany, listDemoCompanyIds } from './demo-company';
import { isUuid } from './normalize';

export function internalTestCompanyIds(env: string | undefined = process.env.INTERNAL_TEST_COMPANY_IDS): Set<string> {
  return new Set(String(env || '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => isUuid(s)));
}

/** 경보가 가리키는 행들의 회사가 하나뿐이면 그 회사 · 여럿이거나 하나라도 모르면 null(고객사 일이 섞인 경보가 사내 판정으로 빠지지 않게 · Codex R1) */
export function soleCompanyId(ids: Iterable<string | null | undefined>): string | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (!id) return null;
    seen.add(String(id).trim().toLowerCase());
  }
  return seen.size === 1 ? [...seen][0] : null;
}

export async function isInternalCompany(companyId: string | null | undefined): Promise<boolean> {
  const id = String(companyId || '').trim().toLowerCase();
  if (!id || !isUuid(id)) return false;
  if (internalTestCompanyIds().has(id)) return true;
  try {
    return await isDemoCompany(id);
  } catch {
    return false;
  }
}

/** 사내 회사 id 전체(시연 ∪ 사내 시험) — 전역 집계에서 빼는 목록(★ 2026-10-29 고객 보안 공지 확인 현황 · Codex 설계 1R) · 시연 목록 조회 오류는 그대로 던진다 */
export async function listInternalCompanyIds(): Promise<string[]> {
  const ids = new Set(internalTestCompanyIds());
  for (const id of await listDemoCompanyIds()) ids.add(String(id).trim().toLowerCase());
  return [...ids];
}
