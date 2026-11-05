/**
 * journey-callback.ts — 여정 회신번호 목록 · 등록 판정 한 곳(★ 2026-11-05 C103 F3 · SC-1 · 설계서 docs/2026-11-05-intake-1104-fix-design.md)
 *
 * 여정 회신번호를 쓰는 자리 = 만들기(문장으로 · 상품 여정) · 시작 설정 저장(routes/ai.ts 옵션) · 새 모양(journey-builder updateJourneyCallback).
 *   옛: 만들기만 목록과 대조했고(못 찾으면 말없이 기본 번호로 바꿈) 나머지 둘은 아무 번호나 받았다.
 *   이제 셋 다 isRegisteredJourneyCallback 하나로 판정한다(등록 안 된 번호 = 400 · 말없는 바꿈 0).
 * 의존 = DB · 입력 오류 형뿐(journey-builder · journey-draft-save 가 순환 없이 부른다).
 */
import { query } from '../config/database';
import { JourneyInputError } from './journey-step-limits';

export interface CallbackNumberRow {
  phone: string;
  source: string;
  description: string | null;
  is_default: boolean;
}

/** 회사 회신번호 목록(인증된 발신번호 + 회신번호 · 기본 먼저 · 숫자만). GET journeys-callback-numbers 와 같은 SQL(한 곳 · journey-draft-save 에서 옮김). */
export async function listJourneyCallbackNumbers(companyId: string): Promise<CallbackNumberRow[]> {
  const r = await query(
    `SELECT DISTINCT phone, source, description, is_default FROM (
       SELECT regexp_replace(phone_number, '[^0-9]', '', 'g') AS phone, 'sender' AS source, description, false AS is_default
       FROM sender_numbers
       WHERE company_id = $1::uuid AND is_active = true AND is_verified = true
       UNION
       SELECT regexp_replace(phone, '[^0-9]', '', 'g') AS phone, 'callback' AS source, label AS description, is_default
       FROM callback_numbers
       WHERE company_id = $1::uuid
     ) src
     WHERE phone IS NOT NULL AND LENGTH(phone) >= 8
     ORDER BY is_default DESC NULLS LAST, phone ASC`,
    [companyId]
  );
  return r.rows;
}

export const JOURNEY_CALLBACK_UNREGISTERED_MESSAGE = '등록된 발신번호만 고를 수 있어요. 발신번호 관리에서 확인해 주세요.';

/** 비교 = 숫자만(목록 SQL 이 숫자만으로 돌려준다) */
export function isRegisteredJourneyCallback(rows: CallbackNumberRow[], phone: string | null | undefined): boolean {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 8 && rows.some((r) => r.phone === d);
}

/** 고른 번호(숫자만)를 돌려준다 · 비면 null · 등록 번호가 아니면 JourneyInputError(400) */
export async function assertJourneyCallbackRegistered(companyId: string, phone: string | null | undefined): Promise<string | null> {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d) return null;
  if (!isRegisteredJourneyCallback(await listJourneyCallbackNumbers(companyId), d)) throw new JourneyInputError(JOURNEY_CALLBACK_UNREGISTERED_MESSAGE);
  return d;
}
