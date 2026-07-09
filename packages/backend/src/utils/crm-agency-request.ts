// ============================================================
// crm-agency-request.ts — CRM 캠페인 대행: 요청 폼 정규화 + 필수 검증 (순수 CT, DB import 0)
// ============================================================
// 스펙: docs/superpowers/specs/2026-07-09-crm-agency-webform-redesign-design.md
// ★ 2026-07-09 웹 폼 전환 (Harold): xlsx 양식 다운로드/업로드/파싱 폐지 — 고객사가 구조화 폼 +
//   행사 이미지(최대 5장)로 직접 접수한다. 폼 값이 AgencyRequestParsed 그대로 parsed_json에
//   저장되므로 파싱 단계 자체가 없다. 하류(제안서 엔진·PDF·관리자 보정 폼)의 단일 입력 스키마
//   = AgencyRequestParsed (구조 불변 — 기존 접수 행과 호환).
// 필수 누락은 throw하지 않고 missingRequired로 보고 — 접수 endpoint가 400 처리, 관리자 보정 폼이 하이라이트.

export interface AgencyRequestProduct {
  name: string;
  price: number | null;
  salePrice: number | null;
}

export interface AgencyRequestParsed {
  title: string;
  periodStart: string;
  periodEnd: string;
  description: string;
  benefit: string;
  channels: string[];
  budget: number | null;
  note: string;
  products: AgencyRequestProduct[];
  /** 누락된 필수 항목 라벨 목록 — throw 대신 보고(접수 400 · 직원 보정 흐름) */
  missingRequired: string[];
}

/** 필수 항목 (key → 사용자 라벨) — 접수 폼·관리자 보정 폼·서버 검증의 단일 진실 */
export const AGENCY_REQUIRED_FIELDS: Array<[string, string]> = [
  ['title', '행사명'],
  ['periodStart', '행사 시작일'],
  ['periodEnd', '행사 종료일'],
  ['description', '행사 내용'],
  ['benefit', '혜택 내용'],
];

const toNum = (v: any): number | null => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const toStr = (v: any): string => String(v ?? '').trim();

/** 웹 폼 payload(JSON) → 검증된 AgencyRequestParsed. 이상값은 정규화, 필수 누락은 missingRequired 보고. */
export function buildParsedFromForm(raw: any): AgencyRequestParsed {
  const channels = (Array.isArray(raw?.channels)
    ? raw.channels.map(toStr)
    : toStr(raw?.channels).split(',').map((s) => s.trim())
  ).filter(Boolean).slice(0, 10);

  const products: AgencyRequestProduct[] = (Array.isArray(raw?.products) ? raw.products : [])
    .map((p: any) => ({ name: toStr(p?.name).slice(0, 120), price: toNum(p?.price), salePrice: toNum(p?.salePrice) }))
    .filter((p: AgencyRequestProduct) => p.name)
    .slice(0, 30);

  const parsed: AgencyRequestParsed = {
    title: toStr(raw?.title).slice(0, 200),
    periodStart: toStr(raw?.periodStart).slice(0, 40),
    periodEnd: toStr(raw?.periodEnd).slice(0, 40),
    description: toStr(raw?.description).slice(0, 4000),
    benefit: toStr(raw?.benefit).slice(0, 1000),
    channels,
    budget: toNum(raw?.budget),
    note: toStr(raw?.note).slice(0, 2000),
    products,
    missingRequired: [],
  };
  parsed.missingRequired = AGENCY_REQUIRED_FIELDS
    .filter(([key]) => !toStr((parsed as any)[key]))
    .map(([, label]) => label);
  return parsed;
}

/** 이미지 자동 입력(접수 폼 프리필) 전용 — 날짜는 ISO(YYYY-MM-DD)만 통과(달력 입력칸 호환), 아니면 빈 값.
 *  저장·보정 경로에는 적용하지 않는다(legacy xlsx 행의 자유 서식 날짜 보존). */
export function sanitizeIntakeDates(parsed: AgencyRequestParsed): AgencyRequestParsed {
  const iso = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '');
  return { ...parsed, periodStart: iso(parsed.periodStart), periodEnd: iso(parsed.periodEnd) };
}
