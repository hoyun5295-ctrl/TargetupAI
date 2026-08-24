/**
 * ★ 2026-08-24 AI 영업 아웃리치 v2 — 잡 상태머신 CT
 * 설계 = docs/2026-07-31-ai-sales-outreach-design.md §15 (테이블 §15-7 · 착수 전 실측 = information_schema 0건 확인 완료 2026-08-24)
 *
 * 규율(LESSONS_BACKEND 핵심 원칙):
 * - 게이트는 효과를 만드는 함수 안(0819) — 라우트 검사와 별개로 이 파일의 효과 함수가 스스로 판정한다. fail-closed.
 * - 소유권 = lock_token(uuid) CAS. 타임스탬프를 fencing 토큰으로 쓰지 않는다(마이크로초/밀리초 왕복 불일치).
 *   lock_at은 좀비 판정용 heartbeat 전용.
 * - 단계 결과는 3값 ok|no_event|unavailable — 의존 장애(unavailable)를 내용 판정(no_event)으로 접지 않는다.
 * - 스탬프는 성공 분기 안에서만 찍는다. 실패는 그 단계에서 정직하게 멈춘다(자동 완화 0).
 * - 행사(이벤트)는 AI가 서술하지 않는다 — 인용 구조체로만 받고 서버가 크롤 원문과 문자열 재대조.
 *   부정·종료·조건 표현이 섞인 인용은 이벤트째 폐기. 종료일이 실재하고 미래일 때만 혜택 수치 면허.
 * - jsonb 파라미터는 반드시 JSON.stringify(드라이버가 배열을 PG 배열 리터럴로 직렬화하는 사고 방지).
 */
import { randomUUID } from 'crypto';
import { query } from '../config/database';
import { callAIWithFallback } from '../services/ai';
import { fetchEventTextFromUrl, fetchHtmlGuarded } from './dm/dm-brand-extractor';
import { stripUnauthorizedBenefits, BENEFIT_PLACEHOLDER } from './copy-benefit-detector';
import { getActiveStyleGuide } from './sales-outreach-style';
import { isSalesOutreachOperator } from './audit-log';
import { isIndustryCode, industryLabel } from './industry-codes';
import {
  getOutreachContext, produceOutreachImage, produceOutreachDm, buildProposalEmail,
  PUBLIC_BASE, OUTREACH_PREVIEW_DAYS,
} from './sales-outreach-produce';
import { sendOutreachProposalMail, isOutreachMailerReady, outreachMailTo } from './outreach-mailer';

// ===== 타입 =====

export type OutreachStage =
  | 'queued' | 'crawling' | 'analyzing' | 'awaiting_confirm'
  | 'producing_copy' | 'producing_image' | 'producing_dm' | 'producing_email'
  | 'ready' | 'sent' | 'failed';

export type StageOutcome = 'ok' | 'no_event' | 'unavailable';

export interface EventCandidate {
  /** 크롤 원문에 실재함을 서버가 확인한 인용문(재대조 통과분만 저장) */
  quote: string;
  sourceUrl: string;
  startDate: string | null;
  endDate: string | null;
  /** 종료일이 실재(YYYY-MM-DD)하고 미래일 때만 true — 혜택 수치 인용 면허 */
  benefitLicensed: boolean;
  /** 'crawl' = 자동 추출·재대조 통과 / 'manual' = Harold 직접 붙여넣기 */
  origin: 'crawl' | 'manual';
}

export interface OutreachSelection {
  /** event_quote.candidates 배열 인덱스. null = 행사 없음(일반형) */
  eventIndex: number | null;
  /** 봇 차단 등 크롤 실패 시 직접 붙여넣는 행사 원문(있으면 eventIndex 무시) */
  manualEventText?: string;
  /** 선택 이미지 URL. null = 이미지 없이 진행 */
  imageUrl: string | null;
  /** 크롤 판정과 다르면 바꿔 넣는 업종 코드 */
  industryCategory?: string;
}

/** 라우트가 안전 문구로 변환할 수 있는 분류 오류 — err.message 원문을 사용자에게 내리지 않기 위한 축 */
export class OutreachError extends Error {
  constructor(
    public code: 'FORBIDDEN' | 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'NOT_READY',
    message: string,
  ) {
    super(message);
  }
}

/** 테이블 미생성(마이그레이션 전) 판정 — 라우트 catch에서 503 DB_MIGRATION_PENDING 분기용 */
export function isOutreachMigrationPending(err: any): boolean {
  const msg = String(err?.message || '');
  return err?.code === '42P01'
    || (/does not exist/i.test(msg) && /(relation|column|table)/i.test(msg));
}

// ===== 게이트 (효과를 만드는 모든 함수의 첫 줄) =====

async function assertOperator(operatorSuperAdminId: string | null | undefined): Promise<void> {
  if (!(await isSalesOutreachOperator(operatorSuperAdminId))) {
    throw new OutreachError('FORBIDDEN', '이 기능을 사용할 권한이 없습니다.');
  }
}

// ===== 등록 =====

export async function enqueueOutreachJob(
  input: { companyName: string; industryCategory?: string | null; homepageUrl: string },
  operatorSuperAdminId: string | null | undefined,
): Promise<{ id: string }> {
  await assertOperator(operatorSuperAdminId);
  if (!getOutreachContext()) {
    // §15-6 — 내부 전용 회사·사용자 ENV 미설정 = 기능 전체를 정직하게 거절(자동 폴백 금지)
    throw new OutreachError('NOT_READY', '준비가 되지 않았습니다: OUTREACH_COMPANY_ID·OUTREACH_USER_ID 설정이 필요합니다.');
  }

  const companyName = String(input.companyName || '').trim();
  if (!companyName || companyName.length > 100) {
    throw new OutreachError('VALIDATION', '업체명을 확인해주세요(1~100자).');
  }
  let homepageUrl = String(input.homepageUrl || '').trim();
  if (!homepageUrl) throw new OutreachError('VALIDATION', '홈페이지 주소를 입력해주세요.');
  if (!/^https?:\/\//i.test(homepageUrl)) homepageUrl = 'https://' + homepageUrl;
  try {
    void new URL(homepageUrl);
  } catch {
    throw new OutreachError('VALIDATION', '홈페이지 주소 형식이 올바르지 않습니다.');
  }
  const industry = input.industryCategory && isIndustryCode(input.industryCategory)
    ? input.industryCategory : null;

  const result = await query(
    `INSERT INTO sales_outreach_jobs (company_name, industry_category, homepage_url, stage, created_by)
     VALUES ($1, $2, $3, 'queued', $4)
     RETURNING id`,
    [companyName, industry, homepageUrl, operatorSuperAdminId],
  );
  const id = result.rows[0].id as string;

  // best-effort 실행 — 실패해도 등록 응답에는 영향 없음(sweeper·재시도가 회수 축)
  runOutreachJob(id).catch((err: any) => {
    console.error('[sales-outreach] 파이프라인 실행 실패:', id, err?.message);
    markFailed(id, 'crawling', '분석 시작에 실패했습니다. 다시 시도해주세요.').catch(() => {});
  });

  return { id };
}

// ===== 수집 → 분석 → 확정 대기 =====

/** 부정·종료·조건 표현 — 인용에 섞이면 이벤트째 폐기(애매하면 폐기 쪽) */
const DISQUALIFYING_MARKERS = [
  '종료', '마감되었', '마감됐', '지난 이벤트', '지난이벤트', '완료된', '당첨자 발표',
  '품절', 'sold out', '이벤트가 끝', '아쉽게도', '제외', '한정 인원 마감', '예정입니다',
];

const norm = (s: string) => String(s || '').replace(/\s+/g, ' ').trim();

function isFutureDate(yyyymmdd: string | null | undefined): boolean {
  if (!yyyymmdd || !/^\d{4}-\d{2}-\d{2}$/.test(yyyymmdd)) return false;
  const d = new Date(yyyymmdd + 'T23:59:59+09:00');
  return !Number.isNaN(d.getTime()) && d.getTime() >= Date.now();
}

/** 페이지 HTML에서 이미지 후보 URL 추출 — og:image + <img src>, 절대화·확장자 필터·중복 제거·상한 12 */
function extractImageCandidates(html: string, baseUrl: string): string[] {
  const found: string[] = [];
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (og?.[1]) found.push(og[1]);
  const imgRe = /<img[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null && found.length < 60) found.push(m[1]);

  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of found) {
    try {
      const abs = new URL(raw, baseUrl).toString();
      if (!/^https?:\/\//i.test(abs)) continue;
      if (!/\.(jpe?g|png|webp)(\?|#|$)/i.test(abs)) continue;
      if (/(logo|icon|favicon|sprite|banner_top|btn_)/i.test(abs)) continue; // 로고 픽셀 금지 축의 1차 필터
      if (seen.has(abs)) continue;
      seen.add(abs);
      out.push(abs);
      if (out.length >= 12) break;
    } catch { /* 무시 — 후보 하나 버림 */ }
  }
  return out;
}

/** 큐 선점 → 크롤 → AI 인용 추출 → 서버 재대조 → awaiting_confirm 정지. 전이는 전부 lock_token CAS. */
export async function runOutreachJob(jobId: string): Promise<void> {
  const lockToken = randomUUID();
  const claimed = await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'crawling', lock_token = $2, lock_at = NOW()
      WHERE id = $1 AND stage = 'queued'
      RETURNING company_name, homepage_url, industry_category`,
    [jobId, lockToken],
  );
  if (claimed.rows.length === 0) return; // 다른 실행이 선점 — 아무것도 바꾸지 않는다
  const job = claimed.rows[0];

  // --- 크롤 (가드 경로만 — extractBrandFromUrl 사용 금지) ---
  let eventText: string | null = null;
  let page: { html: string; baseUrl: string } | null = null;
  try {
    [eventText, page] = await Promise.all([
      fetchEventTextFromUrl(job.homepage_url),
      fetchHtmlGuarded(job.homepage_url),
    ]);
  } catch (err: any) {
    console.error('[sales-outreach] 크롤 예외:', jobId, err?.message);
  }

  const crawlOutcome: StageOutcome = (eventText || page) ? 'ok' : 'unavailable';
  const titleMatch = page?.html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const brandProfile = {
    siteTitle: titleMatch ? norm(titleMatch[1]).slice(0, 120) : null,
    excerpt: eventText ? eventText.slice(0, 600) : null,
    imageCandidates: page ? extractImageCandidates(page.html, page.baseUrl) : [],
    selectedImageUrl: null as string | null,
    crawledAt: new Date().toISOString(),
  };

  if (crawlOutcome === 'unavailable') {
    // 봇 차단·타임아웃 — 행사 후보 없이 확정 대기로(화면에서 직접 붙여넣기 폴백). "확인 실패"를 "행사 없음"으로 접지 않는다.
    await query(
      `UPDATE sales_outreach_jobs
          SET stage = 'awaiting_confirm',
              brand_profile = $2::jsonb,
              event_quote = $3::jsonb,
              stage_results = COALESCE(stage_results, '{}'::jsonb) || $4::jsonb,
              lock_at = NOW()
        WHERE id = $1 AND stage = 'crawling' AND lock_token = $5`,
      [jobId, JSON.stringify(brandProfile), JSON.stringify({ candidates: [] }),
       JSON.stringify({ crawling: 'unavailable' }), lockToken],
    );
    return;
  }

  const toAnalyzing = await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'analyzing',
            brand_profile = $2::jsonb,
            stage_results = COALESCE(stage_results, '{}'::jsonb) || $3::jsonb,
            lock_at = NOW()
      WHERE id = $1 AND stage = 'crawling' AND lock_token = $4
      RETURNING id`,
    [jobId, JSON.stringify(brandProfile), JSON.stringify({ crawling: 'ok' }), lockToken],
  );
  if (toAnalyzing.rows.length === 0) return; // 소유권 상실 — 이후 쓰기 전부 중단

  // --- 분석: AI는 인용만, 판정은 서버가 ---
  let analyzeOutcome: StageOutcome = 'no_event';
  let candidates: EventCandidate[] = [];
  if (eventText) {
    try {
      const raw = await callAIWithFallback({
        system: [
          '너는 웹페이지 본문에서 "지금 진행 중인 행사·이벤트·프로모션"을 찾아 인용하는 분석기다.',
          '규칙:',
          '- 본문에 실제로 있는 문장을 글자 그대로(띄어쓰기 포함 원문 그대로) 인용한다. 요약·의역·창작 금지.',
          '- 진행 중인지 불분명하거나 종료된 행사는 제외한다.',
          '- 날짜는 본문에 명시된 것만 YYYY-MM-DD로 적고, 없으면 null.',
          '- 최대 3개. 없으면 빈 배열.',
          '- 출력은 JSON 배열 하나만: [{"quote":"...","start_date":null,"end_date":null}]',
        ].join('\n'),
        userMessage: eventText,
        maxTokens: 1200,
        temperature: 0.2,
        source: 'sales-outreach-analyze',
      });
      const block = raw.match(/\[[\s\S]*\]/);
      const parsed = block ? JSON.parse(block[0]) : [];
      if (Array.isArray(parsed)) {
        const normText = norm(eventText);
        for (const c of parsed.slice(0, 3)) {
          const quote = norm(String(c?.quote || ''));
          if (!quote || quote.length < 8) continue;
          if (!normText.includes(quote)) continue; // 원문 재대조 실패 = 폐기(환각 차단)
          if (DISQUALIFYING_MARKERS.some((k) => quote.toLowerCase().includes(k.toLowerCase()))) continue;
          const startDate = typeof c?.start_date === 'string' ? c.start_date : null;
          const endDate = typeof c?.end_date === 'string' ? c.end_date : null;
          candidates.push({
            quote,
            sourceUrl: job.homepage_url,
            startDate,
            endDate,
            benefitLicensed: isFutureDate(endDate),
            origin: 'crawl',
          });
        }
      }
      analyzeOutcome = candidates.length > 0 ? 'ok' : 'no_event';
    } catch (err: any) {
      // AI 장애는 내용 판정이 아니다 — unavailable로 남겨 재시도 대상으로(발송 대상 아님)
      console.error('[sales-outreach] 분석 실패:', jobId, err?.message);
      analyzeOutcome = 'unavailable';
      candidates = [];
    }
  }

  await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'awaiting_confirm',
            event_quote = $2::jsonb,
            stage_results = COALESCE(stage_results, '{}'::jsonb) || $3::jsonb,
            lock_at = NOW()
      WHERE id = $1 AND stage = 'analyzing' AND lock_token = $4`,
    [jobId, JSON.stringify({ candidates, generatedAt: new Date().toISOString() }),
     JSON.stringify({ analyzing: analyzeOutcome }), lockToken],
  );
}

// ===== 확정(사람 게이트) → 제작 =====

export async function confirmOutreachSelection(
  jobId: string,
  selection: OutreachSelection,
  operatorSuperAdminId: string | null | undefined,
): Promise<void> {
  await assertOperator(operatorSuperAdminId);

  const cur = await query(
    `SELECT stage, event_quote, brand_profile FROM sales_outreach_jobs WHERE id = $1`,
    [jobId],
  );
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'awaiting_confirm') {
    throw new OutreachError('CONFLICT', '지금은 확정할 수 있는 상태가 아닙니다. 화면을 새로고침해주세요.');
  }

  const eventQuote = cur.rows[0].event_quote || { candidates: [] };
  const allCandidates: EventCandidate[] = Array.isArray(eventQuote.candidates) ? eventQuote.candidates : [];

  let selected: EventCandidate | null = null;
  const manual = norm(String(selection.manualEventText || ''));
  if (manual) {
    if (manual.length > 2000) throw new OutreachError('VALIDATION', '직접 입력 행사 원문은 2000자 이내로 입력해주세요.');
    // 사람이 붙여넣은 원문 = 사실 확인 책임이 사람에게 있는 인용. 날짜 검증이 없으므로 혜택 수치 면허는 없다.
    selected = { quote: manual, sourceUrl: 'manual', startDate: null, endDate: null, benefitLicensed: false, origin: 'manual' };
  } else if (selection.eventIndex !== null && selection.eventIndex !== undefined) {
    const idx = Number(selection.eventIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx >= allCandidates.length) {
      throw new OutreachError('VALIDATION', '행사 선택이 올바르지 않습니다.');
    }
    selected = allCandidates[idx];
  }

  const profile = cur.rows[0].brand_profile || {};
  let selectedImageUrl: string | null = null;
  if (selection.imageUrl) {
    const candidates: string[] = Array.isArray(profile.imageCandidates) ? profile.imageCandidates : [];
    if (!candidates.includes(selection.imageUrl)) {
      throw new OutreachError('VALIDATION', '이미지 선택이 올바르지 않습니다(후보 목록에 없는 주소).');
    }
    selectedImageUrl = selection.imageUrl;
  }
  const industry = selection.industryCategory && isIndustryCode(selection.industryCategory)
    ? selection.industryCategory : null;

  const lockToken = randomUUID();
  const updated = await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'producing_copy',
            event_quote = $2::jsonb,
            brand_profile = $3::jsonb,
            industry_category = COALESCE($4, industry_category),
            lock_token = $5, lock_at = NOW()
      WHERE id = $1 AND stage = 'awaiting_confirm'
      RETURNING id`,
    [jobId,
     JSON.stringify({ candidates: allCandidates, selected, confirmedBy: operatorSuperAdminId, confirmedAt: new Date().toISOString() }),
     JSON.stringify({ ...profile, selectedImageUrl }),
     industry, lockToken],
  );
  if (updated.rows.length === 0) {
    throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  }

  runProduction(jobId, lockToken).catch((err: any) => {
    console.error('[sales-outreach] 제작 실행 실패:', jobId, err?.message);
    markFailed(jobId, 'producing_copy', '제작을 시작하지 못했습니다. 다시 시도해주세요.', lockToken).catch(() => {});
  });
}

// ===== 제작 파이프라인 (producing_copy → image → dm → email → ready · 단계별 재개 가능) =====

/** 최신 산출물 1건 조회(재개 시 앞 단계 결과를 DB에서 읽는다 — 메모리 전달 없음 = 단계별 재시도 성립 근거) */
async function latestAsset(jobId: string, kind: string): Promise<any | null> {
  const r = await query(
    `SELECT payload FROM sales_outreach_assets WHERE job_id = $1 AND kind = $2 ORDER BY created_at DESC LIMIT 1`,
    [jobId, kind],
  );
  return r.rows[0]?.payload || null;
}

/** 산출물 INSERT를 소유권 검증과 **한 문장으로 결속**(Codex 3R high) — 검증 후 INSERT로 나누면
 *  그 사이에 소유권을 잃은 느린 워커가 나중에 자산을 남겨, 검토된 최신본을 잃은 실행의 산출물이
 *  덮을 수 있다(latestAsset은 created_at 최신을 읽는다). 0행 = 소유권 상실(호출부는 즉시 중단). */
async function insertAssetOwned(
  jobId: string, kind: string, payload: unknown, stage: string, lockToken: string,
): Promise<boolean> {
  const r = await query(
    `INSERT INTO sales_outreach_assets (job_id, kind, payload)
     SELECT $1, $2, $3::jsonb
      WHERE EXISTS (SELECT 1 FROM sales_outreach_jobs WHERE id = $1 AND stage = $4 AND lock_token = $5)
     RETURNING id`,
    [jobId, kind, JSON.stringify(payload), stage, lockToken],
  );
  return r.rows.length > 0;
}

/** 현재 stage 하나를 처리하고 다음 stage로 CAS 전이. 소유권 상실 = false(즉시 중단). */
async function runProduction(jobId: string, lockToken: string): Promise<void> {
  for (let guard = 0; guard < 8; guard++) {
    const cur = await query(
      `SELECT stage, company_name, industry_category, event_quote, brand_profile, preview_code
         FROM sales_outreach_jobs WHERE id = $1 AND lock_token = $2`,
      [jobId, lockToken],
    );
    if (cur.rows.length === 0) return; // 소유권 상실
    const job = cur.rows[0];
    const stage: string = job.stage;
    if (!String(stage).startsWith('producing_')) return; // ready·failed 등 — 여기 소관 아님
    const selected: EventCandidate | null = job.event_quote?.selected || null;

    try {
      if (stage === 'producing_copy') {
        const guide = getActiveStyleGuide();
        const eventBlock = selected
          ? `진행 중 행사(원문 인용 · 이 안의 사실만 쓴다):\n"${selected.quote}"`
          : '확인된 행사 없음: 행사 언급 없이 브랜드 일반형으로 쓴다.';
        const aiText = await callAIWithFallback({
          system: [
            '너는 SMS/LMS 마케팅 문안 작성기다. 아래 규칙을 지켜 문안 1건만 출력한다(설명·머리말 없이 본문만).',
            `구성: ${guide.copy.structure.join(' → ')}`,
            `톤: ${guide.copy.tone}`,
            `길이: ${guide.copy.maxLength}자 이내.`,
            '모바일 DM 링크 자리는 {{DM_LINK}} 토큰 그대로 둔다.',
            ...guide.prohibitions.map((p) => `금지: ${p}`),
          ].join('\n'),
          userMessage: `브랜드: ${job.company_name} (업종: ${industryLabel(job.industry_category)})\n${eventBlock}`,
          maxTokens: 800,
          temperature: 0.7,
          source: 'sales-outreach-copy',
        });
        // 혜택 수치 게이트 — 면허(검증 통과 + 종료일 미래) 있는 인용만 원본으로 인정. 나머지는 전부 placeholder.
        const originalBody = selected && selected.benefitLicensed ? selected.quote : '';
        const body = stripUnauthorizedBenefits(aiText.trim(), originalBody);
        if (!(await insertAssetOwned(jobId, 'copy', {
          body,
          benefitLicensed: !!(selected && selected.benefitLicensed),
          styleGuideVersion: guide.version,
          sampleTrained: guide.sampleTrained,
        }, 'producing_copy', lockToken))) return;
        if (!(await advanceStage(jobId, lockToken, 'producing_copy', 'producing_image'))) return;

      } else if (stage === 'producing_image') {
        const img = await produceOutreachImage({
          jobId,
          companyName: job.company_name,
          industry: job.industry_category,
          selectedImageUrl: job.brand_profile?.selectedImageUrl || null,
        });
        if (!(await insertAssetOwned(jobId, 'studio_image', {
          url: img.publicUrl, usedCutout: img.usedCutout, personJudge: img.personJudge,
          skippedReason: img.skippedReason, width: img.width, height: img.height,
        }, 'producing_image', lockToken))) return;
        if (!(await advanceStage(jobId, lockToken, 'producing_image', 'producing_dm'))) return;

      } else if (stage === 'producing_dm') {
        const eventText = selected ? selected.quote
          : (job.brand_profile?.excerpt || `${job.company_name} 브랜드 안내`);
        const ctx = getOutreachContext();
        if (!ctx) throw new Error('OUTREACH_COMPANY_ID·OUTREACH_USER_ID가 설정되지 않았습니다.');
        const dm = await produceOutreachDm({ companyName: job.company_name, eventText, companyId: ctx.companyId, userId: ctx.userId });
        // 소유권을 잃은 실행의 DM 발행(외부 효과)은 결속으로 못 막는다 — 내부 전용 회사의 draft DM 1개 잔존이
        // 전부이고(과금 0·고객 무관) 자산 결속이 화면·메일 사용을 차단하므로 위험 수용(Codex 3R 판단 기록).
        if (!(await insertAssetOwned(jobId, 'dm', { dmId: dm.dmId, dmUrl: dm.dmUrl }, 'producing_dm', lockToken))) return;
        if (!(await advanceStage(jobId, lockToken, 'producing_dm', 'producing_email'))) return;

      } else if (stage === 'producing_email') {
        const copyAsset = await latestAsset(jobId, 'copy');
        const dmAsset = await latestAsset(jobId, 'dm');
        const imageAsset = await latestAsset(jobId, 'studio_image');
        if (!copyAsset?.body || !dmAsset?.dmUrl) {
          throw new Error('앞 단계 산출물이 없어 메일을 조립할 수 없습니다.');
        }
        // 공개 샘플 코드 — 최초 1회만 발급(재조립해도 URL 불변). 내부 URL·토큰은 메일 조립에 넘기지 않는다(H2).
        let previewCode: string = job.preview_code || '';
        if (!previewCode) {
          previewCode = randomUUID().replace(/-/g, '').slice(0, 10);
          const codeSet = await query(
            `UPDATE sales_outreach_jobs SET preview_code = $2
              WHERE id = $1 AND lock_token = $3 AND preview_code IS NULL RETURNING preview_code`,
            [jobId, previewCode, lockToken],
          );
          if (codeSet.rows.length === 0) {
            const re = await query(`SELECT preview_code FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
            previewCode = re.rows[0]?.preview_code || previewCode;
          }
        }
        const email = await buildProposalEmail({
          companyName: job.company_name,
          industry: job.industry_category,
          selectedEvent: selected,
          copyBody: String(copyAsset.body),
          posterUrl: imageAsset?.url || null,
          dmUrl: String(dmAsset.dmUrl),
          previewUrl: `${PUBLIC_BASE}/api/outreach/v/${previewCode}`,
          unsubscribeNotice: (process.env.OUTREACH_UNSUB_NOTICE || '').trim(),
        });
        if (!(await insertAssetOwned(jobId, 'email_html',
          { subject: email.subject, html: email.html, intro: email.intro }, 'producing_email', lockToken))) return;
        if (!(await advanceStage(jobId, lockToken, 'producing_email', 'ready'))) return;
        return; // 파이프라인 종점

      } else {
        return;
      }
    } catch (err: any) {
      console.error(`[sales-outreach] ${stage} 실패:`, jobId, err?.message);
      const reasonMap: Record<string, string> = {
        producing_copy: 'AI 문안 생성에 실패했습니다. 다시 시도해주세요.',
        producing_image: '대표 이미지 제작에 실패했습니다. 다시 시도해주세요.',
        producing_dm: '모바일 DM 제작에 실패했습니다. 다시 시도해주세요.',
        producing_email: '제안 메일 조립에 실패했습니다. 다시 시도해주세요.',
      };
      await markFailed(jobId, stage, reasonMap[stage] || '제작에 실패했습니다.', lockToken);
      return;
    }
  }
}

/** 단계 전이 CAS + 성공 스탬프(성공 분기 안에서만) — 0행 = 소유권 상실 */
async function advanceStage(jobId: string, lockToken: string, from: string, to: string): Promise<boolean> {
  const r = await query(
    `UPDATE sales_outreach_jobs
        SET stage = $3,
            stage_results = COALESCE(stage_results, '{}'::jsonb) || $4::jsonb,
            lock_at = NOW()
      WHERE id = $1 AND stage = $2 AND lock_token = $5
      RETURNING id`,
    [jobId, from, to, JSON.stringify({ [from]: 'ok' }), lockToken],
  );
  return r.rows.length > 0;
}

// ===== 발송 (사람 클릭이 유일 경로 — 워커·스케줄러 호출 불가 구조) =====

/** 발송 중복 클릭 방지(프로세스 내) — 최종 방어는 DB WHERE 조건 */
const mailInFlight = new Set<string>();

export async function sendOutreachMailForJob(
  jobId: string,
  operatorSuperAdminId: string | null | undefined,
): Promise<{ outcome: string; detail: string }> {
  await assertOperator(operatorSuperAdminId); // 승인 컨텍스트 — 이 함수를 부를 수 있는 것은 사람 라우트뿐
  if (!isOutreachMailerReady()) {
    throw new OutreachError('NOT_READY', '영업 발신 계정(OUTREACH_SMTP_USER/PASS)이 설정되지 않아 발송이 잠겨 있습니다.');
  }
  const unsub = (process.env.OUTREACH_UNSUB_NOTICE || '').trim();
  if (!unsub) {
    // H19 — 수신거부 문구 확정 전에는 발송이 열리지 않는다(§10 결론이 오면 ENV 값 하나로 개통)
    throw new OutreachError('NOT_READY', '수신거부 안내 문구(OUTREACH_UNSUB_NOTICE)가 확정되지 않아 발송이 잠겨 있습니다.');
  }
  const cur = await query(
    `SELECT stage, mail_sent_at FROM sales_outreach_jobs WHERE id = $1`, [jobId],
  );
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'sent' && cur.rows[0].stage !== 'ready') {
    throw new OutreachError('CONFLICT', '발송할 수 있는 상태가 아닙니다(제작 완료 후 가능).');
  }
  if (cur.rows[0].stage === 'sent') {
    throw new OutreachError('CONFLICT', '이미 발송된 건입니다.');
  }
  const emailAsset = await latestAsset(jobId, 'email_html');
  if (!emailAsset?.html || !emailAsset?.subject) {
    throw new OutreachError('CONFLICT', '조립된 메일이 없습니다. 메일 재조립 후 발송해주세요.');
  }
  const html = String(emailAsset.html);
  if (html.includes(BENEFIT_PLACEHOLDER)) {
    throw new OutreachError('NOT_READY', '직접 채울 자리(혜택 안내)가 남아 있습니다. 문안을 수정하고 메일을 재조립한 뒤 발송할 수 있습니다.');
  }
  if (!html.includes(unsub)) {
    throw new OutreachError('NOT_READY', '수신거부 문구가 반영되기 전의 메일입니다. 메일 재조립 후 발송해주세요.');
  }
  if (mailInFlight.has(jobId)) {
    throw new OutreachError('CONFLICT', '발송이 진행 중입니다.');
  }
  mailInFlight.add(jobId);
  try {
    // SMTP 호출 **전** DB CAS 선점(Codex 3R high) — mailInFlight는 프로세스 내 한정이라 다중 프로세스가
    // 같은 ready를 각자 통과하면 메일이 두 번 나간다. 선점된 요청만 발송한다. lock_at = 선점 시각(끊긴 sending은 sweeper가 unknown으로 복구).
    const claimed = await query(
      `UPDATE sales_outreach_jobs
          SET mail_result = 'sending', lock_at = NOW()
        WHERE id = $1 AND stage = 'ready' AND mail_sent_at IS NULL
          AND (mail_result IS NULL OR mail_result IN ('rejected','unknown'))
        RETURNING id`,
      [jobId],
    );
    if (claimed.rows.length === 0) {
      throw new OutreachError('CONFLICT', '발송이 이미 진행 중이거나 상태가 바뀌었습니다. 잠시 후 화면을 새로고침해주세요.');
    }

    const result = await sendOutreachProposalMail({ subject: String(emailAsset.subject), html });
    if (result.outcome === 'sent') {
      const done = await query(
        `UPDATE sales_outreach_jobs
            SET stage = 'sent', mail_sent_at = NOW(), mail_result = 'sent'
          WHERE id = $1 AND stage = 'ready' AND mail_result = 'sending' AND mail_sent_at IS NULL
          RETURNING id`,
        [jobId],
      );
      if (done.rows.length === 0) {
        // 메일은 나갔는데 상태 기록이 어긋났다(발송 중 상태 변경) — 성공으로 답하지 않는다(0행 = sent 금지).
        console.error('[sales-outreach] 발송 후 상태 기록 0행:', jobId);
        return { outcome: 'unknown', detail: '메일은 발송됐으나 상태 기록이 어긋났습니다. 수신함과 목록 상태를 확인해주세요.' };
      }
    } else {
      // rejected·unknown은 성공으로 접지 않는다 — 상태는 ready 유지, 결과만 기록(재발송 가능)
      await query(
        `UPDATE sales_outreach_jobs SET mail_result = $2 WHERE id = $1 AND mail_result = 'sending'`,
        [jobId, result.outcome],
      );
    }
    console.log('[sales-outreach] 발송 결과:', jobId, result.outcome, '→', outreachMailTo());
    return { outcome: result.outcome, detail: result.detail };
  } finally {
    mailInFlight.delete(jobId);
  }
}

/** 수신함 도착 확인(사람) — 자동 종결 금지 축(R7). sent 상태에서만. */
export async function confirmOutreachMailArrived(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const r = await query(
    `UPDATE sales_outreach_jobs SET mail_confirmed_at = NOW()
      WHERE id = $1 AND stage = 'sent' AND mail_confirmed_at IS NULL RETURNING id`,
    [jobId],
  );
  if (r.rows.length === 0) throw new OutreachError('CONFLICT', '수신 확인할 수 있는 상태가 아닙니다.');
}

/** "업체에 전달함" 표시(사람) — 공개 샘플 페이지 수명 연장 트리거(H15) + 중복 방지 축(R15). */
export async function markOutreachForwarded(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const r = await query(
    `UPDATE sales_outreach_jobs SET forwarded_at = NOW()
      WHERE id = $1 AND stage = 'sent' AND forwarded_at IS NULL RETURNING id`,
    [jobId],
  );
  if (r.rows.length === 0) throw new OutreachError('CONFLICT', '전달 표시할 수 있는 상태가 아닙니다.');
}

/** 문안 수정(사람 편집 = 사람 책임) → 메일 재조립 필요 상태로. placeholder 해소 경로. */
export async function editOutreachCopy(jobId: string, body: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const text = String(body || '').trim();
  if (!text || text.length > 2000) throw new OutreachError('VALIDATION', '문안은 1~2000자로 입력해주세요.');
  const cur = await query(`SELECT stage FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'ready') throw new OutreachError('CONFLICT', '제작 완료 상태에서만 문안을 수정할 수 있습니다.');
  const inserted = await query(
    `INSERT INTO sales_outreach_assets (job_id, kind, payload)
     SELECT $1, 'copy', $2::jsonb
      WHERE EXISTS (SELECT 1 FROM sales_outreach_jobs WHERE id = $1 AND stage = 'ready')
     RETURNING id`,
    [jobId, JSON.stringify({ body: text, editedBy: operatorSuperAdminId, editedAt: new Date().toISOString() })],
  );
  if (inserted.rows.length === 0) {
    throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다. 화면을 새로고침해주세요.');
  }
  await rebuildOutreachEmail(jobId, operatorSuperAdminId);
}

/** 메일 재조립(ready → producing_email 재실행) — 수신거부 문구 반영·문안 수정 반영 경로. 미리보기 = 발송본 유지. */
export async function rebuildOutreachEmail(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const lockToken = randomUUID();
  // 발송 선점(sending) 중에는 재조립 금지 — SMTP가 나가는 동안 stage를 바꾸면 발송 후 기록이 어긋난다(Codex 3R).
  const r = await query(
    `UPDATE sales_outreach_jobs SET stage = 'producing_email', lock_token = $2, lock_at = NOW()
      WHERE id = $1 AND stage = 'ready' AND mail_result IS DISTINCT FROM 'sending' RETURNING id`,
    [jobId, lockToken],
  );
  if (r.rows.length === 0) throw new OutreachError('CONFLICT', '재조립할 수 있는 상태가 아닙니다(발송 진행 중일 수 있습니다).');
  runProduction(jobId, lockToken).catch((err: any) => {
    console.error('[sales-outreach] 메일 재조립 실패:', jobId, err?.message);
    markFailed(jobId, 'producing_email', '메일 재조립에 실패했습니다.', lockToken).catch(() => {});
  });
}

// ===== 공개 샘플 페이지 (L2 — 무인증·noindex·만료. 산출물 렌더만, 내부 정보 0 = H1) =====

export async function getPublicOutreachHtml(code: string): Promise<string | null> {
  const c = String(code || '').trim();
  if (!/^[0-9a-f]{10}$/i.test(c)) return null;
  const r = await query(
    `SELECT id, mail_sent_at, forwarded_at, purged_at, created_at
       FROM sales_outreach_jobs WHERE preview_code = $1`,
    [c],
  );
  if (r.rows.length === 0) return null;
  const job = r.rows[0];
  if (job.purged_at) return null;
  // 수명 기산 = 발송 성공 시각(없으면 생성 시각) · 전달 표시는 연장 트리거(H15) — 늦은 기산점을 쓴다
  const basis = job.forwarded_at || job.mail_sent_at || job.created_at;
  const basisMs = new Date(basis).getTime();
  if (Number.isFinite(basisMs) && Date.now() > basisMs + OUTREACH_PREVIEW_DAYS * 24 * 60 * 60 * 1000) {
    return null;
  }
  const emailAsset = await latestAsset(job.id, 'email_html');
  return emailAsset?.html ? String(emailAsset.html) : null;
}

// ===== 실패 기록·재시도·조회 =====

/** 실패 종결 — lockToken이 있으면 소유권 조건으로, 없으면 미선점(queued) 행만.
 *  무조건 WHERE id로 쓰면 발송 완료·타 실행 소유 건까지 덮는다. 선점된 채 죽은 건은 sweeper가 집는다. */
async function markFailed(jobId: string, failStage: string, reason: string, lockToken?: string): Promise<void> {
  await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'failed', fail_stage = $2, fail_reason = $3
      WHERE id = $1 ${lockToken ? 'AND lock_token = $4' : `AND stage = 'queued' AND lock_token IS NULL`}`,
    lockToken ? [jobId, failStage, reason, lockToken] : [jobId, failStage, reason],
  );
}

/** 실패 건 재시도 — 실패한 그 단계부터 다시(§15-3). 자동 재시도는 없다 — 이 함수의 호출자는 사람 라우트뿐. */
export async function retryOutreachJob(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<void> {
  await assertOperator(operatorSuperAdminId);
  const cur = await query(
    `SELECT stage, fail_stage FROM sales_outreach_jobs WHERE id = $1`, [jobId],
  );
  if (cur.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  if (cur.rows[0].stage !== 'failed') throw new OutreachError('CONFLICT', '재시도할 수 있는 상태가 아닙니다.');
  const failStage: string = cur.rows[0].fail_stage || 'crawling';

  if (failStage.startsWith('producing_')) {
    // 제작 단계 실패 = 그 단계부터 재개(앞 단계 산출물은 DB에 있다)
    const lockToken = randomUUID();
    const reset = await query(
      `UPDATE sales_outreach_jobs
          SET stage = $2, fail_stage = NULL, fail_reason = NULL, lock_token = $3, lock_at = NOW()
        WHERE id = $1 AND stage = 'failed' RETURNING id`,
      [jobId, failStage, lockToken],
    );
    if (reset.rows.length === 0) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다.');
    runProduction(jobId, lockToken).catch((err: any) => {
      console.error('[sales-outreach] 재시도 실행 실패:', jobId, err?.message);
      markFailed(jobId, failStage, '재시도 시작에 실패했습니다.', lockToken).catch(() => {});
    });
    return;
  }

  // 수집·분석 실패 = 수집부터 다시
  const reset = await query(
    `UPDATE sales_outreach_jobs
        SET stage = 'queued', fail_stage = NULL, fail_reason = NULL, lock_token = NULL
      WHERE id = $1 AND stage = 'failed'
      RETURNING id`,
    [jobId],
  );
  if (reset.rows.length === 0) throw new OutreachError('CONFLICT', '다른 요청이 먼저 처리했습니다.');
  runOutreachJob(jobId).catch((err: any) => {
    console.error('[sales-outreach] 재시도 실행 실패:', jobId, err?.message);
    markFailed(jobId, 'crawling', '재시도 시작에 실패했습니다.').catch(() => {});
  });
}

export async function getOutreachJob(jobId: string, operatorSuperAdminId: string | null | undefined): Promise<any> {
  await assertOperator(operatorSuperAdminId);
  const job = await query(`SELECT * FROM sales_outreach_jobs WHERE id = $1`, [jobId]);
  if (job.rows.length === 0) throw new OutreachError('NOT_FOUND', '대상 건을 찾을 수 없습니다.');
  const assets = await query(
    `SELECT id, kind, payload, regen_count, created_at FROM sales_outreach_assets WHERE job_id = $1 ORDER BY created_at`,
    [jobId],
  );
  return { ...job.rows[0], assets: assets.rows };
}

export async function getLatestOutreachJob(operatorSuperAdminId: string | null | undefined): Promise<any | null> {
  await assertOperator(operatorSuperAdminId);
  const job = await query(
    `SELECT id, company_name, industry_category, homepage_url, stage, fail_stage, fail_reason, mail_result, created_at
       FROM sales_outreach_jobs ORDER BY created_at DESC LIMIT 1`,
    [],
  );
  return job.rows[0] || null;
}
