// ============================================================
// crm-agency-request.ts — CRM 캠페인 대행: 캠페인대행요청서 양식 정의 + 파싱 (순수 CT, DB import 0)
// ============================================================
// 스펙: docs/superpowers/specs/2026-07-09-crm-campaign-agency-design.md §2
// 양식 구조: A열 라벨 / B열 값 고정. 상품만 productsHeader 아래 3열 표(상품명·정가·할인가).
// 양식 다운로드(xlsx 생성)와 업로드 파싱이 같은 라벨 상수를 쓰므로 코드 = 단일 진실.
// 파싱 실패/누락은 throw하지 않고 missingRequired로 보고 — 슈퍼관리자에서 직원이 보정하는 흐름.

export const AGENCY_REQUEST_LABELS = {
  title: '행사명 (필수)',
  periodStart: '행사 시작일 (필수, 예: 2026-07-15)',
  periodEnd: '행사 종료일 (필수)',
  description: '행사 내용 (필수, 자유롭게 서술)',
  benefit: '혜택 내용 (필수, 예: 전 구매 고객 10% 할인)',
  channels: '희망 채널 (선택: 문자/알림톡/DM/이메일/인앱/여정 — 쉼표 구분, 비우면 AI 추천)',
  budget: '예산 (선택, 원)',
  note: '참고사항 (선택)',
  productsHeader: '[대상 상품/신제품 — 아래 표에 입력 (선택)]',
} as const;

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
  /** 누락된 필수 라벨 목록 — throw 대신 보고(직원 보정 흐름) */
  missingRequired: string[];
}

/** 양식 xlsx의 행(aoa) — 다운로드 endpoint가 XLSX.utils.aoa_to_sheet로 변환해 내려준다. */
export function buildRequestTemplateRows(): any[][] {
  const L = AGENCY_REQUEST_LABELS;
  return [
    ['한줄로 캠페인대행요청서', ''],
    ['※ (필수) 항목을 채우신 후 이 파일을 그대로 업로드해 주세요.', ''],
    [L.title, ''],
    [L.periodStart, ''],
    [L.periodEnd, ''],
    [L.description, ''],
    [L.benefit, ''],
    [L.channels, ''],
    [L.budget, ''],
    [L.note, ''],
    [L.productsHeader, '', ''],
    ['상품명', '정가(원)', '할인가(원)'],
    ['', '', ''],
    ['', '', ''],
    ['', '', ''],
  ];
}

const toNum = (v: any): number | null => {
  const n = Number(String(v ?? '').replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const toStr = (v: any): string => String(v ?? '').trim();

/** 업로드된 시트(aoa rows)를 파싱한다. 라벨 텍스트가 살짝 달라져도(고객 편집) 라벨 원문 일치 기준 — 불일치는 누락으로 보고. */
export function parseRequestSheet(rows: any[][]): AgencyRequestParsed {
  const L = AGENCY_REQUEST_LABELS;
  const byLabel = new Map<string, any>();
  for (const r of rows || []) {
    const label = toStr(r?.[0]);
    if (label && !byLabel.has(label)) byLabel.set(label, r?.[1]);
  }
  const get = (label: string) => toStr(byLabel.get(label));

  // 상품 표 — productsHeader 다음다음 행부터(헤더행 skip), 상품명 있는 행만
  const products: AgencyRequestProduct[] = [];
  const headerIdx = (rows || []).findIndex((r) => toStr(r?.[0]) === L.productsHeader);
  if (headerIdx >= 0) {
    for (let i = headerIdx + 2; i < rows.length; i++) {
      const name = toStr(rows[i]?.[0]);
      if (!name) continue;
      products.push({ name, price: toNum(rows[i]?.[1]), salePrice: toNum(rows[i]?.[2]) });
    }
  }

  const requiredEntries: Array<[string, string]> = [
    [L.title, get(L.title)],
    [L.periodStart, get(L.periodStart)],
    [L.periodEnd, get(L.periodEnd)],
    [L.description, get(L.description)],
    [L.benefit, get(L.benefit)],
  ];

  return {
    title: get(L.title),
    periodStart: get(L.periodStart),
    periodEnd: get(L.periodEnd),
    description: get(L.description),
    benefit: get(L.benefit),
    channels: get(L.channels).split(',').map((s) => s.trim()).filter(Boolean),
    budget: toNum(byLabel.get(L.budget)),
    note: get(L.note),
    products,
    missingRequired: requiredEntries.filter(([, v]) => !v).map(([label]) => label),
  };
}
