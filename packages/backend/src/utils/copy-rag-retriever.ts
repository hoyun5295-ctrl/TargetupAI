/**
 * copy-rag-retriever.ts — 문안 두뇌 ① 성과 문안 검색기 (RAG)
 *
 * 생성 직전, 그 회사·채널·광고여부에 맞고 성과(클릭률) 좋은 과거 문안을 ai_training_logs에서 꺼낸다.
 *   - 회사 우선: tenant_ref = hmacHash(company_id) 매칭 (자기 자산 — 원문 활용).
 *   - 업종 폴백: 회사 표본이 minCompany 미만일 때만 같은 industry_code 비식별 문안으로 보강(타사 — 패턴만).
 *   - 정직 폴백: 둘 다 부족하면 빈 결과 → 조립기가 RAG 없이 기존 방식으로 생성(가짜 예시 0).
 *   - 성과 라벨(success_count) 없으면 최신순으로 자동 적응(임의 상수 0).
 *
 * 모든 ai_training_logs 컬럼은 information_schema 덤프(2026-06-27)로 존재 확인됨.
 */

import pool from '../config/database';
import { getTenantRef } from './training-logger';
import { hasIdentifierLeak } from './copy-deidentify';

export interface TrainingRow {
  id?: string; // ★ 2026-07-04 성과 환류: 업종 시드 행 식별(사용 기록용)
  final_message: string;
  message_features: Record<string, unknown> | null;
  sent_count: number | null;
  success_count: number | null;
  click_count?: number | null; // ★ 2026-07-04 Tier 1 반응 신호(컬럼 미생성 시 undefined — 정렬 자동 폴백)
  created_at: string;
}

export interface CopyExample {
  text: string;
  source: 'company' | 'industry';
  features: Record<string, unknown> | null;
  successRate: number | null;
  seedId?: string; // ★ 2026-07-04 성과 환류: industry(큐레이션 시드)일 때만 채움
}

export interface RetrieveInput {
  companyId: string;
  industryCode: string | null;
  channels: string[];   // 우선 채널 배열 (예: ['EMAIL'] 또는 ['SMS','LMS','MMS'])
  isAd: boolean;
  limit?: number;
  brandVoiceRegistered?: boolean; // ★ A6: 등록 회사면 업종 폴백 OFF(자기것만)
}

export interface RetrieveResult {
  examples: CopyExample[];
  companyCount: number;
  industryCount: number;
  industryFeatures: IndustryFeatureSummary | null; // ★ A6: 업종 구조·통계(원문 X)
}

// 회사 표본이 이 미만이면 업종 폴백으로 보강
export const MIN_COMPANY_SAMPLE = 5;
// 회사+업종 합계가 이 미만이면 정직 폴백(빈 결과)
export const MIN_TOTAL_SAMPLE = 3;
// 프롬프트에 넣을 기본 예시 수
export const DEFAULT_LIMIT = 8;
// DB에서 후보로 가져올 행 수 (앱에서 성과 정렬 후 limit만 사용)
const FETCH_CANDIDATES = 60;

// 큐레이션 시드 = 탈색·검수된 업종 베스트를 sentinel tenant로 저장(스키마 ALTER 0). 세더·검색기 공유 키.
export const CURATED_SEED_KEY = '__CURATED_SEED__';

interface RankedRow {
  ex: CopyExample;
  createdAt: string;
  clickRate: number | null; // ★ 2026-07-04 Tier 1: 클릭 수신자/발송 (없으면 null — successRate 폴백)
}

function toRanked(row: TrainingRow, source: 'company' | 'industry'): RankedRow {
  const sent = row.sent_count;
  const successRate = sent && sent > 0 ? (row.success_count || 0) / sent : null;
  // ★ 2026-07-04 Tier 1: 반응 신호(클릭)가 있으면 최우선 정렬 신호. 같은 채널군 안에서만 비교되므로
  //   (retrieve가 message_type 필터) 신호 있는 채널(DM 열람·이메일 클릭)끼리만 경쟁 — 채널 간 왜곡 없음.
  const clickRate = row.click_count != null && sent && sent > 0 ? Math.min(row.click_count / sent, 1) : null;
  // ★ 2026-06-30 정정: PG created_at은 런타임 Date 객체(타입은 string이나 실제 Date) →
  //   sortRanked가 문자열 메서드 .localeCompare를 호출하다 "is not a function" throw → RAG 성과 문안
  //   검색 전체 degrade(0630 문안 두뇌 미작동). ISO 문자열로 강제(문자열 비교 = 시간순). null/문자열도 안전.
  const ca = row.created_at as unknown;
  return {
    ex: {
      text: row.final_message, source, features: row.message_features, successRate,
      // ★ 2026-07-04 성과 환류: 시드 사용 기록용 id — industry(큐레이션 시드)만
      ...(source === 'industry' && row.id ? { seedId: String(row.id) } : {}),
    },
    createdAt: ca instanceof Date ? ca.toISOString() : String(ca || ''),
    clickRate,
  };
}

// ★ 2026-07-04 Tier 1 정렬: 클릭률(반응) > 전달 성공률 > 최신 — 있는 신호만 쓰고 없으면 자연 폴백(임의 상수 0)
function sortRanked(rows: RankedRow[]): RankedRow[] {
  return rows.sort((a, b) => {
    // 1) 반응 신호(클릭률) 우선 — 한쪽만 있으면 그쪽 우대
    if (a.clickRate !== null || b.clickRate !== null) {
      if (a.clickRate === null) return 1;
      if (b.clickRate === null) return -1;
      if (b.clickRate !== a.clickRate) return b.clickRate - a.clickRate;
    }
    // 2) 전달 성공률
    const ar = a.ex.successRate;
    const br = b.ex.successRate;
    if (ar === null && br === null) return b.createdAt.localeCompare(a.createdAt);
    if (ar === null) return 1;
    if (br === null) return -1;
    if (br !== ar) return br - ar;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** 순수 정렬·폴백·dedup — 회사 우선, 부족 시 업종 보강 */
export function rankExamples(
  company: TrainingRow[],
  industry: TrainingRow[],
  limit: number,
  minCompany: number,
  brandVoiceRegistered = false,
): CopyExample[] {
  const co = sortRanked(company.map((r) => toRanked(r, 'company')));
  let pool: RankedRow[] = co;
  // ★ A6 (2026-06-30): 브랜드보이스 등록 회사 = 업종 폴백 OFF(자기것만). 미등록 + 회사 부족 시에만 업종 보강.
  if (!brandVoiceRegistered && company.length < minCompany) {
    const ind = sortRanked(industry.map((r) => toRanked(r, 'industry')));
    pool = [...co, ...ind]; // 회사 우선, 업종은 뒤에 보강
  }

  const seen = new Set<string>();
  const out: CopyExample[] = [];
  for (const r of pool) {
    const key = (r.ex.text || '').replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r.ex);
    if (out.length >= limit) break;
  }
  return out;
}

export interface IndustryFeatureSummary {
  sampleCount: number;
  avgLengthChars: number;
  avgSentenceCount: number;
  hasCtaRatio: number; // CTA 힌트를 포함한 표본 비율 0~1
}

const CTA_HINTS = ['지금', '바로', '확인', '방문', '오세요', '받아', '신청', '예약', '클릭'];

/** 업종 표본의 구조·통계만 요약 (원문 문장·고유표현 일절 미포함 — 시그니처 누출 0) */
export function summarizeIndustryFeatures(rows: TrainingRow[]): IndustryFeatureSummary {
  const n = rows.length;
  if (n === 0) return { sampleCount: 0, avgLengthChars: 0, avgSentenceCount: 0, hasCtaRatio: 0 };
  let lenSum = 0, sentSum = 0, ctaCount = 0;
  for (const r of rows) {
    const t = String(r.final_message || '');
    lenSum += t.length;
    sentSum += t.split(/[.!?。\n]/).filter((s) => s.trim().length > 0).length || 1;
    if (CTA_HINTS.some((h) => t.includes(h))) ctaCount++;
  }
  return {
    sampleCount: n,
    avgLengthChars: Math.round(lenSum / n),
    avgSentenceCount: Math.round((sentSum / n) * 10) / 10,
    hasCtaRatio: Math.round((ctaCount / n) * 100) / 100,
  };
}

const SELECT_COLS = 'id, final_message, message_features, sent_count, success_count, created_at';

// ★ 2026-07-04 Tier 1: click_count 컬럼 존재 1회 프로브(information_schema) — 마이그레이션 전 배포 안전.
//   pm2 재시작 시 재프로브. 존재하면 SELECT에 포함 → 정렬이 반응 신호로 자동 승급.
let engagementColsAvailable: boolean | null = null;
async function selectColsWithEngagement(): Promise<string> {
  if (engagementColsAvailable === null) {
    try {
      const r = await pool.query(
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_training_logs' AND column_name = 'click_count' LIMIT 1`,
      );
      engagementColsAvailable = r.rows.length > 0;
    } catch {
      engagementColsAvailable = false;
    }
  }
  return engagementColsAvailable ? `${SELECT_COLS}, click_count` : SELECT_COLS;
}

/** DB 검색 — 회사 1차 + (부족 시) 업종 2차 → rankExamples */
export async function retrieveCopyExamples(input: RetrieveInput): Promise<RetrieveResult> {
  const { companyId, industryCode, channels, isAd } = input;
  const limit = input.limit ?? DEFAULT_LIMIT;
  const tenantRef = getTenantRef(companyId);
  const curatedTenant = getTenantRef(CURATED_SEED_KEY);
  const cols = await selectColsWithEngagement(); // ★ 2026-07-04 Tier 1: click_count 있으면 포함

  const companyRes = await pool.query(
    `SELECT ${cols}
     FROM ai_training_logs
     WHERE tenant_ref = $1 AND message_type = ANY($2::text[]) AND is_ad = $3
       AND final_message IS NOT NULL AND length(final_message) >= 10
     ORDER BY created_at DESC
     LIMIT $4`,
    [tenantRef, channels, isAd, FETCH_CANDIDATES],
  );

  // ★ 2026-07-04 Track B 업종 보강 = 탈색·검수된 큐레이션 시드(sentinel tenant)만. 원본 타사 행 미조회(누출 0).
  let industryRows: TrainingRow[] = [];
  if (!input.brandVoiceRegistered && companyRes.rows.length < MIN_COMPANY_SAMPLE && industryCode) {
    const industryRes = await pool.query(
      `SELECT ${cols}
       FROM ai_training_logs
       WHERE tenant_ref = $1 AND industry_code = $2 AND message_type = ANY($3::text[]) AND is_ad = $4
         AND final_message IS NOT NULL AND length(final_message) >= 10
       ORDER BY created_at DESC
       LIMIT $5`,
      [curatedTenant, industryCode, channels, isAd, FETCH_CANDIDATES],
    );
    // 방어: 시드는 이미 탈색됐지만, 식별자 잔존 행은 서빙에서 제외(누출 0 이중)
    industryRows = (industryRes.rows as TrainingRow[]).filter((r) => !hasIdentifierLeak(r.final_message));
  }

  const companyRows = companyRes.rows as TrainingRow[];
  const ranked = rankExamples(companyRows, industryRows, limit, MIN_COMPANY_SAMPLE, !!input.brandVoiceRegistered);
  const industryFeatures = industryRows.length > 0 ? summarizeIndustryFeatures(industryRows) : null;

  // ★ 2026-07-04 업종 원문 서빙 = 탈색·검수된 큐레이션 시드에 한함(위 쿼리가 sentinel tenant만 조회).
  //   회사 예시 + 시드(비누출) 유지. 시드는 조립기에서 "탈색·참고용" 블록으로 렌더된다.
  const examples = ranked.filter(
    (e) => e.source === 'company' || (e.source === 'industry' && !hasIdentifierLeak(e.text)),
  );

  // 정직 폴백: 회사+업종 합계가 최소 표본 미만이면 빈 결과(가짜 예시 금지)
  if (companyRows.length + industryRows.length < MIN_TOTAL_SAMPLE) {
    return { examples: [], companyCount: companyRows.length, industryCount: industryRows.length, industryFeatures };
  }

  return { examples, companyCount: companyRows.length, industryCount: industryRows.length, industryFeatures };
}
