/**
 * dm.ts — 모바일 DM 빌더 라우트
 *
 * 마운트:
 *   공개: /api/dm/v  (뷰어 + 추적 — helmet 전 마운트)
 *   인증: /api/dm    (CRUD + 이미지 — 한줄로 authenticate)
 *
 * 한줄로 AI 프로 요금제 이상.
 */

import { Request, Response, Router, json } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import {
  createDm, updateDm, deleteDm, getDmList, getDmDetail, getDmByCode, cloneDm,
  publishDm, trackDmView, getDmStats, getDmRecipientEngagementRows,
  saveDmVersion, listDmVersions, restoreDmVersion, setApprovalStatus, buildDmSnapshot,
  extractFlatSectionsFromDm, extractPagesFromDm, extractDmCopyText,
  stopDm, resumeDm, isDmStopped, isDmStoppedByCode, DM_TRANSITION_BLOCK_MESSAGES,
} from '../utils/dm/dm-builder';
// ★ 2026-08-25 DB 스키마 부재 → 503 안내(CLAUDE.md db_alter_safety_net)
import { isMissingSchemaError, migrationPendingBody } from '../utils/db-errors';
// ★ 2026-07-03 DM 문안 학습 코퍼스 적재 (전 채널 학습 통합 Phase 1)
import { logCampaignTraining } from '../utils/training-logger';
// ★ 2026-07-03 Gap5 Layer2: 고객별 발송 카운터 (예측 분모 전용 — 타겟 선정 무관)
import { recordCustomerSends } from '../utils/customer-send-stats';
import { renderDmViewerHtml, renderDmViewerHtmlWithCustomer, renderDmErrorHtml } from '../utils/dm/dm-viewer';
// ★ 2026-07-08 연동 몰 상품 자동 첨부 (생성된 상품 슬라이드 항목명 → 몰 이름매칭 이미지·링크)
import { attachMallImagesToProductCarousels } from '../utils/mall-product-match';
import {
  parsePrompt, recommendLayout, seedBrandContact, generateCopy, transformTone, improveMessage,
  oneShotGenerate,
  type CampaignSpec, type ToneKey,
} from '../utils/dm/dm-ai';
import { checkCredit, deductCreditSafe, InsufficientCreditError, getCreditState } from '../utils/ai-credit';
import { getCreditCost } from '../utils/ai-credit-calc';
import { runInCreditBundle } from '../utils/ai-credit-context';
import type { Section } from '../utils/dm/dm-section-registry';
import { selectSampleCustomers, selectSampleCustomerByKey, type SampleCustomerKey } from '../utils/dm/dm-sample-customer';
import { lookupDmRecipientToken, issueDmRecipientTokensBulk, lookupDmShortLink } from '../utils/dm/dm-recipient-token';
// ★ 2026-07-10 고객사 자체 URL 단축(hlj.kr) — 박성용 신기능(100크레딧·도메인 평판 보호)
import {
  createCustomShortLink, lookupCustomShortLink, recordCustomShortLinkClick,
  listCustomShortLinks, setCustomShortLinkActive,
  // ★ 2026-07-15 발행 DM 한글 주소 별칭
  upsertDmAliasLink, getDmAliasLink, isSlugAvailable,
} from '../utils/dm/dm-custom-short-link';
import { validateCustomShortLinkUrl, normalizeCustomLinkTitle, CUSTOM_LINK_DAILY_LIMIT, validateCustomSlug } from '../utils/dm/dm-custom-short-link-core';
import {
  computeDmProgressPct, isDmCompleted, sumSectionClicks,
  sanitizeSectionInteractions, buildDmSectionLabel, dmSectionTypeLabel, summarizeDmResponse,
} from '../utils/dm/dm-tracking';
import { extractJsonFromAiText } from '../utils/ai-json';
// ★ CT-08 개별회신번호 — 고객 등록매장 번호(store_phone) 발송 + 미등록 번호 제외(직접발송과 동일 안전망)
import { filterByIndividualCallback, buildCallbackErrorResponse, buildCallbackConfirmResponse } from '../utils/callback-filter';
import { buildCustomerFilter } from '../utils/customer-filter';
import { buildChannelEligibilityWhere } from '../utils/channel-eligibility';
import { createDirectSendCampaign, countStagingFiltered } from '../utils/direct-send-core';
import { DirectSendError } from '../utils/direct-send-spec';
import { getOpt080Number, stripAdPartsDeep, normalizeSmsSeparatorLines } from '../utils/messageUtils';
import { isUuid } from '../utils/normalize';
import { callAIWithFallback, getSeasonContext } from '../services/ai';
import { buildSystemPromptWithBrandVoice } from '../utils/brand-voice-prompt';
import { getAvailableVariables } from '../utils/dm/dm-variable-resolver';
import { validateDm } from '../utils/dm/dm-validate';
import { getCompanyBrandKit, updateCompanyBrandKit, DEFAULT_BRAND_KIT } from '../utils/dm/dm-brand-kit';
// ★ 2026-07-21 브랜드 학습 통합 — 회사 기본정보(브랜드명·사업자·업종) CRUD (companies 컬럼, Phase 0 실측)
import { getBrandBasicInfo, updateBrandBasicInfo } from '../utils/brand-basic-info';
import { INDUSTRY_CODES, INDUSTRY_LABELS } from '../utils/industry-codes';
import { buildEventPromptBlock, normalizeEventText } from '../utils/event-brief';
// ★ 2026-07-16 M3 — 상품 이미지 후보(네이버 쇼핑 검색 — 원탭 확정 전용) + 행사 URL 본문 수집
import { searchNaverShopCandidates, isNaverShopSearchConfigured } from '../utils/naver-shop-search';
import { fetchEventTextFromUrl } from '../utils/dm/dm-brand-extractor';
// ★ 2026-07-14 디자인 4.0 M5 — 행사 → 정예 템플릿 스토리 힌트 (결정적 선택기, design-core)
import { buildEventTemplateHintBlock } from '../utils/design-core/event-package';
// ★ 2026-07-16 자가 호스팅 웹폰트 @font-face 생성 (궁서 폴백 정정)
import { renderSelfHostFontFaceCss } from '../utils/design-core/fonts';
import { listTemplates, getTemplate, instantiateTemplate } from '../utils/dm/dm-template-registry';
import { insertTestSmsQueue } from '../utils/sms-queue';
import { getUserTestContacts } from '../utils/test-contact-helper';
import { sanitizeSmsText } from '../utils/auto-notify-message';
import { convertLegacyToSections } from '../utils/dm/dm-legacy-converter';
import { previewBrandExtract } from '../utils/dm/dm-brand-kit';
import {
  createAbTest, getAbTest, getAbTestByShortCode, listAbTests, updateAbTest,
  deleteAbTest, startAbTest, pauseAbTest, completeAbTest, aggregateResults,
  pickVariant, variantToPageId, trackAbTestView,
  type AbVariantKey,
} from '../utils/dm/dm-ab-test';
// ★ CT-17: 모바일 DM 빌더는 PRO 이상만 사용 가능
import { requirePlanFeature } from '../utils/plan-guard';
// ★ D216+ 신규 5 AI 모듈 (CT-86 ~ CT-90)
import { selfDiagnoseDm } from '../utils/dm/dm-self-diagnosis';
import { applyQuickAction, type QuickActionType } from '../utils/dm/dm-quick-action';
import { recommendEventType } from '../utils/dm/dm-event-recommender';
import { suggestNextSection } from '../utils/dm/dm-section-suggester';
import { getPersonalizationVariables } from '../utils/dm/dm-personalization-engine';
// ★ 2026-06-14 B 인터랙션 엔진 — 제출/추첨/조회/다운로드/사전지정/경품 CT
import {
  submitEventResponse, getResponses, getWinners, getResponseStats,
  buildResponseExportRows, importPresetWinners, replacePrizesForSection,
  syncPrizesFromSections, isInteractionCampaign,
} from '../utils/dm/dm-interaction';
import { parseWinnerRows, buildEventInsight } from '../utils/dm/dm-interaction-core';
import * as XLSX from 'xlsx';

// ────────────── D216+ 503 안전망 helper (db_alter_safety_net 영구 룰) ──────────────
function isDbMigrationPendingError(err: any): boolean {
  const msg = err?.message || '';
  return msg.includes('column') && msg.includes('does not exist');
}

function send503Migration(res: any, requiredAlter: string) {
  return res.status(503).json({
    success: false,
    error: `DB 마이그레이션 필요: 운영자에게 ${requiredAlter} 실행 요청 의무`,
    code: 'DB_MIGRATION_PENDING',
  });
}

const DM_IMAGE_DIR = path.join(process.cwd(), 'uploads', 'dm-images');

// ============================================================
//  공개 라우터 (인증 불필요 — app.ts에서 helmet 전 마운트)
// ============================================================

export const dmPublicRouter = Router();

// ★ 2026-07-02(5) 본문 파서 — 공개 라우터는 app.ts에서 helmet·전역 express.json() '앞'에 마운트되므로
//   (인라인 스크립트 CSP 때문) 여기 POST(track·event-response·ab track)는 전역 파서를 못 거친다.
//   그 결과 req.body가 비어 비콘의 토큰·anon·scroll·duration이 전부 유실 → 열람 껍데기 행만 쌓이던 결함.
//   라우터 자체 JSON 파서를 붙여 본문을 받게 한다(GET 뷰어는 본문 없어 영향 0).
dmPublicRouter.use(json({ limit: '1mb' }));

// DM 이미지 서빙
dmPublicRouter.get('/images/:companyId/:filename', (req: Request, res: Response) => {
  const { companyId, filename } = req.params;
  const filePath = path.join(DM_IMAGE_DIR, companyId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// ★ 2026-07-16 자가 호스팅 웹폰트 — 발행 뷰어·편집 캔버스·이메일 공용 (구글 CDN 미로드 궁서 폴백 정정).
//   helmet 전 마운트라 CORP/CSP 제약 없음. 편집기(app.hanjul.ai)·이메일 교차 출처 로드 위해 CORS 허용.
const DM_FONT_DIR = path.join(__dirname, '../../assets/dm-fonts');

// @font-face 선언(전 자가호스팅 서체) — url(fonts/…)은 이 CSS(/api/dm/v/fonts.css) 기준 상대 = /api/dm/v/fonts/…
dmPublicRouter.get('/fonts.css', (_req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/css; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(renderSelfHostFontFaceCss('fonts'));
});

// woff2 서빙 — 파일명 화이트리스트(경로 조작 차단) + 장기 캐시(immutable).
dmPublicRouter.get('/fonts/:file', (req: Request, res: Response) => {
  const file = req.params.file;
  if (!/^[a-z0-9-]+\.woff2$/i.test(file)) return res.status(400).send('bad request');
  const filePath = path.join(DM_FONT_DIR, file);
  if (!filePath.startsWith(DM_FONT_DIR) || !fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.setHeader('Content-Type', 'font/woff2');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(filePath);
});

// ★ 2026-07-06 단축링크 리다이렉트 (hlj.kr/<code> → nginx rewrite → /api/dm/v/s/<code>)
//   기존 뷰어 URL로 302만 한다 — 추적·개인화(?r)·발송 로직 무변경(무결 최우선, Harold 확정).
//   만료 토큰 = ?r 없이 공용 렌더로 / 미존재·오류 = 서비스 홈으로. 고객에게 500을 절대 보여주지 않는다.
dmPublicRouter.get('/s/:code', async (req: Request, res: Response) => {
  const base = process.env.HANJUL_BASE_URL || 'https://hanjul.ai';
  try {
    const found = await lookupDmShortLink(req.params.code);
    if (!found) {
      // ★ 2026-07-10 3순위: 고객사 자체 URL 단축(dm_custom_short_links) — 박성용 신기능(Harold 100크레딧 확정).
      //   기존 2축(수신자 토큰 → 발행 페이지) miss 후에만 조회 = 기존 링크 동작 무변경.
      //   클릭 집계는 fire-and-forget(실패해도 리다이렉트 무영향). 테이블 미생성/오류 = 홈 폴백(500 노출 0).
      try {
        const custom = await lookupCustomShortLink(req.params.code);
        if (custom) {
          void recordCustomShortLinkClick(custom.id).catch(() => {});
          return res.redirect(302, custom.targetUrl);
        }
      } catch (e: any) {
        console.warn('[DM 커스텀 단축링크] 조회 오류 — 홈으로 폴백:', e?.message);
      }
      return res.redirect(302, base);
    }
    const target = found.expired
      ? `${base}/api/dm/v/dm-${found.dmCode}`
      : `${base}/api/dm/v/dm-${found.dmCode}?r=${found.token}`;
    return res.redirect(302, target);
  } catch (e: any) {
    console.warn('[DM 단축링크] 조회 오류 — 홈으로 폴백:', e?.message);
    return res.redirect(302, base);
  }
});

// DM 뷰어 — 공개 페이지
dmPublicRouter.get('/:code', async (req: Request, res: Response) => {
  try {
    const dm = await getDmByCode(req.params.code);
    if (!dm) {
      // ★ 2026-08-06 없는 코드와 **내린 코드**는 고객에게 다른 말을 해야 한다(서수란 접수 — 행사 종료).
      //   이 조회는 404 경로에서만 돈다(정상 열람에는 쿼리가 늘지 않는다).
      //   조회가 실패하면 기존 문구로 떨어진다 — 문구 하나 때문에 뷰어를 죽이지 않는다.
      let stopped = false;
      try { stopped = await isDmStoppedByCode(req.params.code); } catch { /* 기존 문구로 폴백 */ }
      return res
        .status(404)
        .send(renderDmErrorHtml(stopped ? '종료된 페이지입니다.' : '존재하지 않는 DM입니다.'));
    }

    // ★ 2026-07-02 서버측 이중 기록 제거 — 열람 기록은 뷰어 진입 비콘(init) 1곳으로 통일.
    //   (구: 익명 1행 + 토큰 phone 1행 + 클라 비콘 1행 = 열람 1회에 3행·view_count 3배 부풀림)

    // ?r=<token> 수신자별 개인화 (토큰 없음/만료/미마이그레이션 = 공용 fallback, PII 노출 0)
    const rToken = (req.query.r as string) || null;
    if (rToken) {
      try {
        const lookup = await lookupDmRecipientToken(rToken);
        if (lookup && lookup.dmId === dm.id && lookup.companyId === dm.company_id) {
          const custR = await query(
            `SELECT * FROM customers WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
            [lookup.customerId, dm.company_id],
          );
          if (custR.rows.length > 0) {
            const personalizedHtml = await renderDmViewerHtmlWithCustomer(dm, '/api/dm/v', custR.rows[0], dm.company_id);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(personalizedHtml);
          }
        }
      } catch {
        // 토큰 조회 실패(예: 테이블 미마이그레이션) = 공용 렌더로 안전 폴백
      }
    }

    // ★ 2026-07-02(2) 공용 링크(토큰 없음/만료)도 치환 경로(customer=null) — %고객명% 원문 노출 대신 fallback("고객님").
    //   치환 실패(DB 등)면 원문 렌더로 폴백해 뷰어 자체는 살린다.
    let html: string;
    try {
      html = await renderDmViewerHtmlWithCustomer(dm, '/api/dm/v', null, dm.company_id);
    } catch {
      html = renderDmViewerHtml(dm, '/api/dm/v');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error('[DM뷰어] 오류:', err.message);
    res.status(500).send(renderDmErrorHtml('일시적 오류가 발생했습니다.'));
  }
});

// 열람 추적 API — ★ 2026-07-02 토큰(r) = 추적 1급 키. 서버가 토큰→고객 phone 확정(클라 phone 불신뢰).
dmPublicRouter.post('/:code/track', async (req: Request, res: Response) => {
  try {
    const dm = await getDmByCode(req.params.code);
    if (!dm) return res.status(404).json({ error: 'Not found' });

    const b = req.body || {};
    const ip = req.ip || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;

    let token: string | null = typeof b.r === 'string' && b.r ? String(b.r).slice(0, 32) : null;
    let phone: string | null = null;
    if (token) {
      try {
        const lookup = await lookupDmRecipientToken(token);
        if (lookup && lookup.dmId === dm.id && lookup.companyId === dm.company_id) {
          const custR = await query(
            `SELECT phone FROM customers WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
            [lookup.customerId, dm.company_id],
          );
          phone = custR.rows[0]?.phone || null;
        } else {
          token = null; // 다른 DM 토큰/만료 = 익명 취급
        }
      } catch {
        token = null; // 토큰 테이블 미마이그레이션 등 = 익명 폴백 (열람 기록 자체는 유지)
      }
    }
    // 구 링크(?p=phone) 하위호환 — 토큰 확정 실패 시에만 클라 값 사용
    if (!phone && typeof b.phone === 'string' && b.phone) phone = String(b.phone).slice(0, 20);

    await trackDmView({
      dmId: dm.id,
      companyId: dm.company_id,
      phone,
      recipientToken: token,
      anonymousId: typeof b.anon === 'string' && b.anon ? b.anon : null,
      pageReached: b.page_reached,
      totalPages: b.total_pages,
      durationDelta: b.duration,
      maxScrollPct: b.max_scroll_pct,
      sectionDelta: b.section_interactions,
      isInit: b.init === 1 || b.init === true,
      // ★ 2026-07-15 유입원(공용 링크 slug) — 뷰어 ?src= 비콘 동봉값. 정규화·격리는 trackDmView가 담당
      entrySource: typeof b.src === 'string' && b.src ? b.src : null,
      ip,
      userAgent: ua,
    });
    res.json({ ok: true });
  } catch (err: any) {
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_views ALTER(recipient_token/anonymous_id/max_scroll_pct)');
    }
    console.error('[DM추적] 오류:', err.message);
    res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================================
//  인증 라우터 (한줄로 authenticate)
// ============================================================

export const dmRouter = Router();
dmRouter.use(authenticate);
// ★ CT-17: mobile_dm 요금제 게이팅 (PRO+) — 인증 직후 전 라우트 적용
dmRouter.use(requirePlanFeature('mobile_dm'));

// 이미지 업로드 (2MB, JPG/PNG/WebP)
const dmImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 5 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = file.mimetype.toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(ext) && allowedMime.includes(mime)) {
      cb(null, true);
    } else {
      cb(new Error('JPG, PNG, WebP 파일만 업로드 가능합니다.'));
    }
  },
});

// POST /api/dm/upload-image
dmRouter.post('/upload-image', (req: any, res: any) => {
  const upload = dmImageUpload.array('images', 5);
  upload(req, res, async (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '파일 크기는 5MB 이하만 가능합니다.' });
      return res.status(400).json({ error: err.message || '업로드 실패' });
    }
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: '파일이 없습니다.' });

    const companyDir = path.join(DM_IMAGE_DIR, companyId);
    if (!fs.existsSync(companyDir)) fs.mkdirSync(companyDir, { recursive: true });

    const results: any[] = [];
    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      const filename = `${uuidv4()}${ext}`;
      const filePath = path.join(companyDir, filename);
      fs.writeFileSync(filePath, file.buffer);
      results.push({
        // ★ 2026-06-14 fix: 실제 서빙 경로(dmPublicRouter /api/dm/v/images)로 반환 — 기존 flyer 경로는 서빙 라우트 없어 캔버스/editor 이미지 전부 깨짐
        url: `/api/dm/v/images/${companyId}/${filename}`,
        filename,
        size: file.size,
      });
    }
    return res.json({ success: true, images: results });
  });
});

// DELETE /api/dm/delete-image
dmRouter.delete('/delete-image', (req: any, res: any) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url 필요' });

  const m = url.match(/\/(?:api\/dm\/images|api\/dm\/v\/images|api\/flyer\/p\/dm-images)\/([^/]+)\/([^/]+)$/);
  if (!m || m[1] !== companyId) return res.status(403).json({ error: '접근 권한 없음' });

  const filePath = path.join(DM_IMAGE_DIR, m[1], m[2]);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return res.json({ success: true });
});

// GET /api/dm — 목록
dmRouter.get('/', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    // ★ 2026-07-14 사용자별 노출(서수란 신고): 관리자=회사 전체, 일반 사용자=본인 생성분만.
    const isDmAdmin = req.user?.userType === 'company_admin' || req.user?.userType === 'super_admin';
    const list = await getDmList(companyId, isDmAdmin ? null : req.user?.userId);
    return res.json(list);
  } catch (err: any) {
    console.error('[DM목록] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/dm — 생성
dmRouter.post('/', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ error: '권한이 필요합니다.' });
    if (!req.body.title?.trim()) return res.status(400).json({ error: '제목을 입력해주세요.' });
    const dm = await createDm(companyId, userId, req.body);
    return res.json(dm);
  } catch (err: any) {
    console.error('[DM생성] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ============================================================
// ★ 2026-07-10 고객사 자체 URL 단축 (hlj.kr) — 박성용 신기능, Harold 100크레딧 확정
//   외부 MDM 등 고객사 URL → hlj.kr/<code> 발급 + 클릭 집계. AI 호출 0 — 가치 과금(인프라 서빙+추적).
//   도메인 평판 보호 = dm-custom-short-link-core 검증(오픈 리다이렉터 차단) + 일일 상한 + 비활성 토글.
//   ('/:id'보다 먼저 등록 — 경로 캡처 방지)
// ============================================================

// GET /api/dm/short-links — 내 단축 링크 목록
dmRouter.get('/short-links', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const links = await listCustomShortLinks(companyId);
    const base = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
    return res.json({
      success: true,
      links: links.map((l) => ({ ...l, shortUrl: base ? `${base}/${l.code}` : null })),
      dailyLimit: CUSTOM_LINK_DAILY_LIMIT,
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('does not exist') && (msg.includes('relation') || msg.includes('column'))) {
      return res.status(503).json({ success: false, error: '단축 URL 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[커스텀 단축링크 목록] 오류:', msg);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/dm/short-links — 단축 링크 생성 (100크레딧 — 발급 성공 후 멱등 차감)
dmRouter.post('/short-links', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ error: '권한이 필요합니다.' });

    const base = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
    if (!base) return res.status(400).json({ error: '단축 도메인이 설정되지 않았습니다. 운영자에게 문의해주세요.' });

    // 도메인 평판 보호 — 검증 실패 = 사용자 문구 그대로 400 (크레딧 차감 전)
    const v = validateCustomShortLinkUrl(req.body?.url);
    if (!v.ok || !v.url) return res.status(400).json({ error: v.reason || '올바른 URL이 아닙니다.' });
    const title = normalizeCustomLinkTitle(req.body?.title);

    // 크레딧 — 사전 확인 → 발급 성공 → 멱등 차감(키=링크 id). 발급 실패/상한 초과 시 미차감.
    //   일일 상한 판정은 CT의 INSERT 단문에 결합(선-카운트 TOCTOU 정정 — Codex 지적).
    //   deductCreditSafe 영구 실패는 전사 정책대로 [CREDIT][MISS] 로그+수동 재차감(효과물 회수 없음 — DM 발행과 동일).
    const cost = getCreditCost('dm-custom-short-link');
    await checkCredit(companyId, cost);
    const link = await createCustomShortLink({ companyId, userId, targetUrl: v.url, title });
    if (!link) {
      return res.status(429).json({ error: `단축 링크는 하루 ${CUSTOM_LINK_DAILY_LIMIT}건까지 생성할 수 있습니다.` });
    }
    await deductCreditSafe({
      companyId, cost, source: 'dm-custom-short-link', createdBy: userId,
      idempotencyKey: `dm-custom-short-link:${link.id}`,
    });

    return res.json({ success: true, link: { ...link, shortUrl: `${base}/${link.code}` } });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    const msg = err?.message || '';
    if (msg.includes('does not exist') && (msg.includes('relation') || msg.includes('column'))) {
      return res.status(503).json({ success: false, error: '단축 URL 기능을 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[커스텀 단축링크 생성] 오류:', msg);
    return res.status(500).json({ error: msg || '서버 오류' });
  }
});

// PATCH /api/dm/short-links/:linkId — 활성/비활성 토글 (비활성 = 즉시 홈 폴백, 오염/오발급 대응)
dmRouter.patch('/short-links/:linkId', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!isUuid(req.params.linkId)) return res.status(400).json({ error: '올바르지 않은 링크 ID입니다.' });
    const isActive = req.body?.isActive === true;
    const link = await setCustomShortLinkActive(companyId, req.params.linkId, isActive);
    if (!link) return res.status(404).json({ error: '링크를 찾을 수 없습니다.' });
    const base = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
    return res.json({ success: true, link: { ...link, shortUrl: base ? `${base}/${link.code}` : null } });
  } catch (err: any) {
    console.error('[커스텀 단축링크 토글] 오류:', err?.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ★ 2026-07-14 사용자별 소유 가드(서수란 신고) — 일반 사용자는 본인 생성 DM만 조회·수정·삭제·복제.
//   관리자(company_admin/super_admin)=회사 전체. 0709 자동마케팅 선례 동일. created_by=createDm에서 항상 기록되는 기존 컬럼.
async function canAccessDm(dmId: string, companyId: string, userType?: string, userId?: string): Promise<boolean> {
  if (userType === 'company_admin' || userType === 'super_admin') {
    const r = await query(`SELECT 1 FROM dm_pages WHERE id = $1 AND company_id = $2`, [dmId, companyId]);
    return r.rows.length > 0;
  }
  const r = await query(`SELECT 1 FROM dm_pages WHERE id = $1 AND company_id = $2 AND created_by = $3`, [dmId, companyId, userId || '']);
  return r.rows.length > 0;
}

// ============================================================
// ★ 2026-07-15 발행 DM 한글 주소 별칭 (Harold 확정 — 이새 vo.la/반짝이새_07 사례)
//   발행 공용 링크에 한글 slug 별칭(hlj.kr/반짝세일_07) — 무료·DM당 1개(기존 랜덤 코드는 그대로 유효).
//   target에 ?src=<slug>를 저장해 리다이렉트 무변경으로 유입원이 뷰어 비콘까지 흐른다.
// ============================================================

const ALIAS_MIGRATION_MSG = 'DB 마이그레이션 필요: 운영자에게 dm_custom_short_links(dm_page_id)/dm_views(entry_source) ALTER 실행을 요청해주세요.';

function isMissingDbObject(err: any): boolean {
  const msg = String(err?.message || '');
  return msg.includes('does not exist') && (msg.includes('relation') || msg.includes('column'));
}

// GET /api/dm/:id/alias — 현재 한글 주소(없으면 alias:null)
dmRouter.get('/:id/alias', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!isUuid(req.params.id)) return res.status(400).json({ error: '올바르지 않은 DM ID입니다.' });
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, req.user?.userId))) {
      return res.status(403).json({ error: '본인이 생성한 DM만 접근할 수 있습니다.' });
    }
    const base = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
    const alias = await getDmAliasLink(req.params.id, companyId);
    return res.json({
      success: true,
      alias: alias ? { ...alias, shortUrl: base ? `${base}/${alias.code}` : null } : null,
    });
  } catch (err: any) {
    if (isMissingDbObject(err)) {
      return res.status(503).json({ success: false, error: ALIAS_MIGRATION_MSG, code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[DM 한글주소 조회] 오류:', err?.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/dm/:id/alias — 한글 주소 생성/변경 { slug } (무료 — 발행된 DM만)
dmRouter.post('/:id/alias', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ error: '권한이 필요합니다.' });
    if (!isUuid(req.params.id)) return res.status(400).json({ error: '올바르지 않은 DM ID입니다.' });
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, req.user?.userId))) {
      return res.status(403).json({ error: '본인이 생성한 DM만 접근할 수 있습니다.' });
    }
    const base = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
    if (!base) return res.status(400).json({ error: '단축 도메인이 설정되지 않았습니다. 운영자에게 문의해주세요.' });

    const v = validateCustomSlug(req.body?.slug);
    if (!v.ok || !v.slug) return res.status(400).json({ error: v.reason || '올바른 주소가 아닙니다.' });

    const d = await query(`SELECT short_code, title FROM dm_pages WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`, [req.params.id, companyId]);
    if (d.rows.length === 0) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    const dmShortCode = d.rows[0].short_code ? String(d.rows[0].short_code) : '';
    if (!dmShortCode) return res.status(400).json({ error: '발행된 DM만 한글 주소를 만들 수 있습니다. 먼저 발행해주세요.' });

    // 뷰어 직링크(리다이렉트 1홉) + 유입원 태그 — 비콘이 ?src를 실어 링크별 추적
    const viewerBase = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
    const targetUrl = `${viewerBase}/api/dm/v/dm-${dmShortCode}?src=${encodeURIComponent(v.slug)}`;

    const alias = await upsertDmAliasLink({
      companyId, userId, dmPageId: req.params.id, slug: v.slug, targetUrl,
      title: normalizeCustomLinkTitle(d.rows[0].title),
    });
    if (!alias) {
      return res.status(409).json({ error: '이미 사용 중인 주소입니다. 다른 문구를 입력해주세요.' });
    }
    return res.json({ success: true, alias: { ...alias, shortUrl: `${base}/${alias.code}` } });
  } catch (err: any) {
    if (isMissingDbObject(err)) {
      return res.status(503).json({ success: false, error: ALIAS_MIGRATION_MSG, code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[DM 한글주소 생성] 오류:', err?.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// GET /api/dm/:id/public-link-stats — 기본형(공용 링크) 추적: 클릭 → 열람 → 유니크 → 스크롤·체류 + 일별 추이
//   개인화 발송 추적(recipients-tracking)과 분리된 두 번째 축 (Harold 확정 2026-07-15).
dmRouter.get('/:id/public-link-stats', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!isUuid(req.params.id)) return res.status(400).json({ error: '올바르지 않은 DM ID입니다.' });
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, req.user?.userId))) {
      return res.status(403).json({ error: '본인이 생성한 DM만 접근할 수 있습니다.' });
    }
    const base = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');

    const d = await query(`SELECT short_code FROM dm_pages WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`, [req.params.id, companyId]);
    if (d.rows.length === 0) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    const dmShortCode = d.rows[0].short_code ? String(d.rows[0].short_code) : '';

    const alias = await getDmAliasLink(req.params.id, companyId);

    // 공용(비개인화 = 익명) 열람 전체 — 수신자 토큰/phone 매칭이 없는 행
    const totals = await query(
      `SELECT COUNT(*)::int AS views,
              COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS unique_visitors,
              COALESCE(SUM(open_count), 0)::int AS opens,
              AVG(max_scroll_pct)::numeric(5,1) AS avg_scroll_pct,
              AVG(duration_seconds)::numeric(10,0) AS avg_duration_seconds
         FROM dm_views
        WHERE dm_id = $1::uuid AND company_id = $2::uuid
          AND recipient_token IS NULL AND phone IS NULL`,
      [req.params.id, companyId],
    );

    // 유입 링크별 분해 (entry_source = 공용 링크 slug)
    const bySource = await query(
      `SELECT entry_source,
              COUNT(*)::int AS views,
              COUNT(DISTINCT anonymous_id) FILTER (WHERE anonymous_id IS NOT NULL)::int AS unique_visitors,
              COALESCE(SUM(open_count), 0)::int AS opens,
              AVG(max_scroll_pct)::numeric(5,1) AS avg_scroll_pct,
              AVG(duration_seconds)::numeric(10,0) AS avg_duration_seconds
         FROM dm_views
        WHERE dm_id = $1::uuid AND company_id = $2::uuid AND entry_source IS NOT NULL
        GROUP BY entry_source
        ORDER BY views DESC`,
      [req.params.id, companyId],
    );

    // 최근 14일 일별 추이 (공용 열람)
    const daily = await query(
      `SELECT to_char((viewed_at AT TIME ZONE 'Asia/Seoul')::date, 'MM-DD') AS day,
              COUNT(*)::int AS views
         FROM dm_views
        WHERE dm_id = $1::uuid AND company_id = $2::uuid
          AND recipient_token IS NULL AND phone IS NULL
          AND viewed_at >= NOW() - INTERVAL '14 days'
        GROUP BY (viewed_at AT TIME ZONE 'Asia/Seoul')::date
        ORDER BY (viewed_at AT TIME ZONE 'Asia/Seoul')::date`,
      [req.params.id, companyId],
    );

    return res.json({
      success: true,
      alias: alias ? { ...alias, shortUrl: base ? `${base}/${alias.code}` : null } : null,
      publicUrl: dmShortCode && base ? `${base}/${dmShortCode}` : null,
      totals: totals.rows[0] || null,
      bySource: bySource.rows,
      daily: daily.rows,
    });
  } catch (err: any) {
    if (isMissingDbObject(err)) {
      return res.status(503).json({ success: false, error: ALIAS_MIGRATION_MSG, code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[DM 공용링크 추적] 오류:', err?.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// GET /api/dm/:id — 상세
dmRouter.get('/:id', async (req: any, res: any, next: any) => {
  // ★ 2026-07-02: uuid 아닌 경로('/overview'·'/brand-kit' 등 뒤에 등록된 정적 GET)가
  //   '/:id'에 가로채여 500 나던 결함 — uuid 형식이 아니면 다음 라우트로 넘긴다.
  if (!isUuid(req.params.id)) return next();
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, req.user?.userId))) {
      return res.status(403).json({ error: '본인이 생성한 DM만 접근할 수 있습니다.' });
    }
    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json(dm);
  } catch (err: any) {
    console.error('[DM상세] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// PUT /api/dm/:id — 수정
dmRouter.put('/:id', async (req: any, res: any, next: any) => {
  if (!isUuid(req.params.id)) return next(); // '/brand-kit' 등 정적 PUT 가로채기 차단
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, req.user?.userId))) {
      return res.status(403).json({ error: '본인이 생성한 DM만 수정할 수 있습니다.' });
    }
    const updated = await updateDm(req.params.id, companyId, req.body);
    if (!updated) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json(updated);
  } catch (err: any) {
    console.error('[DM수정] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// DELETE /api/dm/:id — 삭제
dmRouter.delete('/:id', async (req: any, res: any, next: any) => {
  if (!isUuid(req.params.id)) return next(); // 정적 DELETE 경로 가로채기 차단
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, req.user?.userId))) {
      return res.status(403).json({ error: '본인이 생성한 DM만 삭제할 수 있습니다.' });
    }
    const ok = await deleteDm(req.params.id, companyId);
    if (!ok) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[DM삭제] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/dm/:id/clone — 복제 (AI 호출 0 = 크레딧 차감 없음)
dmRouter.post('/:id/clone', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId || !userId) return res.status(403).json({ error: '권한이 필요합니다.' });
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, userId))) {
      return res.status(403).json({ error: '본인이 생성한 DM만 복제할 수 있습니다.' });
    }
    const cloned = await cloneDm(req.params.id, companyId, userId);
    if (!cloned) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json({ success: true, dm: cloned });
  } catch (err: any) {
    console.error('[DM복제] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/dm/:id/publish — 발행
dmRouter.post('/:id/publish', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    // ★ 2026-08-06 중지된 DM은 이 경로로 되살아나지 않는다(서수란 접수).
    //   화면의 [발행 주소 복사]가 이 엔드포인트를 부르므로, 막지 않으면 **주소를 복사하는 순간 중지가 풀린다.**
    //   되살리는 문은 [재개] 하나여야 한다 — 그래야 "왜 다시 열렸는지"가 기록으로 남는다.
    if (await isDmStopped(req.params.id, companyId)) {
      return res.status(409).json({
        error: '중지된 DM입니다. 다시 열려면 [재개]를 눌러주세요.',
        code: 'DM_STOPPED',
      });
    }
    // ★ 종량제: 발행(단축URL 확정) 최초 1회만(멱등키 dm-publish:dmId). 인터랙션 캠페인=50(F 안1), 일반 DM=30. test-send 자동발행(publishDm 직접 호출)은 라우트 미경유=미과금. 재발행은 멱등 0.
    const isInteraction = await isInteractionCampaign(companyId, req.params.id);
    const costSource = isInteraction ? 'dm-interaction-publish' : 'dm-builder';
    const pubCost = getCreditCost(costSource);
    const charged = await query(
      `SELECT 1 FROM ai_credit_transactions WHERE company_id = $1::uuid AND idempotency_key = $2 LIMIT 1`,
      [companyId, `dm-publish:${req.params.id}`]
    );
    const firstPublish = charged.rows.length === 0;
    if (firstPublish) await checkCredit(companyId, pubCost);
    const result = await publishDm(req.params.id, companyId);
    if (!result) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });

    // ★ 2026-07-28 검수 치명 무시 발행 기록 (서수란 접수 — 이미지만 올린 DM이 footer 부재로 막히던 건).
    //   무시 가능한 치명(required_info)만 프론트가 넘길 수 있고, 여기서는 "누가 언제 무엇을 넘겼는지"를 남긴다.
    //   기록이 없으면 "고객이 확인하고 본인이 발행했다"는 방어가 성립하지 않는다.
    //   컬럼은 신규가 아니다 — validation_result는 /validate가 이미 쓰고 있는 기존 jsonb.
    //   실패해도 발행은 유지한다(경품 동기화와 같은 원칙 — 기록 실패로 발행을 되돌리지 않는다).
    const overrideReq = req.body?.validation_override;
    if (overrideReq && Array.isArray(overrideReq.items) && overrideReq.items.length > 0) {
      try {
        await query(
          // dm_pages.validation_result = jsonb (2026-07-28 information_schema 실측 확정).
          // ::jsonb 캐스팅은 그대로 둔다 — || 가 jsonb 전용 연산자라 타입이 바뀌면 런타임에 터지고 tsc는 못 잡는다.
          `UPDATE dm_pages
              SET validation_result = (COALESCE(validation_result::jsonb, '{}'::jsonb) || $1::jsonb),
                  updated_at = NOW()
            WHERE id = $2 AND company_id = $3`,
          [
            JSON.stringify({
              overridden_at: new Date().toISOString(),
              overridden_by: req.user?.userId || null,
              overridden_items: overrideReq.items
                .filter((i: any) => i && typeof i.message === 'string')
                .map((i: any) => ({ area: String(i.area || ''), message: String(i.message) })),
            }),
            req.params.id,
            companyId,
          ],
        );
      } catch (e: any) {
        console.error('[DM발행] 검수 무시 기록 실패:', e?.message);
      }
    }
    // ★ B 연계: lucky_draw/roulette 경품 설정 → dm_prizes 동기화 (실패해도 발행은 유지)
    try { await syncPrizesFromSections(companyId, req.params.id); }
    catch (e: any) { console.error('[DM발행] 경품 동기화 오류:', e?.message); }
    if (firstPublish) {
      await deductCreditSafe({
        companyId, cost: pubCost, source: costSource, createdBy: req.user?.userId,
        idempotencyKey: `dm-publish:${req.params.id}`,
      });
    }
    // ★ 2026-07-08 발행 URL도 hlj.kr 단축 도메인 — /s/:code가 dm_recipient_tokens 미발견 시
    //   dm_pages.short_code 폴백 조회 → 토큰 없이 공용 렌더 302 (추적·발송 로직 무변경).
    //   env(DM_SHORT_LINK_BASE) 미설정 = 기존 긴 뷰어 URL 그대로 (무결 최우선).
    const pubShortBase = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
    return res.json({
      short_code: result.short_code,
      short_url: pubShortBase
        ? `${pubShortBase}/${result.short_code}`
        : `${process.env.HANJUL_BASE_URL || 'https://hanjul.ai'}/api/dm/v/dm-${result.short_code}`,
    });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    console.error('[DM발행] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ============================================================
// ★ 2026-08-06 발행 중지 / 재개 (서수란 접수 "모바일DM 관리에 대한 정지 버튼 생성 요청")
//   업체 사정(행사 종료 등)으로 발행한 DM에 고객이 접속하지 못하게 막는다.
//   **삭제가 아닌 이유는 접수 그대로다** — 삭제하면 열람·발송 이력이 CASCADE로 함께 사라진다.
//   뷰어는 손대지 않는다: `getDmByCode`가 이미 `status='published'`만 열기 때문에
//   상태를 옮기는 것만으로 즉시 차단된다. 전이 자체는 `dm-builder` CT의 조건부 UPDATE 한 문장.
// ============================================================

// POST /api/dm/:id/stop — 발행 중지
dmRouter.post('/:id/stop', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, req.user?.userId))) {
      return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    }
    // ★ 2026-08-06 판정은 UPDATE 한 문장이 한다(Codex 3R high). ★ 2026-08-08 사유도 그 문장의
    //   같은 스냅샷이 돌려준다(4R medium) — 따로 조회하면 경합 시 엉뚱한 원인을 지목한다.
    const { row, block } = await stopDm(req.params.id, companyId);
    // 0행 = 바뀐 것이 없다 — 성공이라 답하지 않고, 전이 문장이 판정한 사유를 그대로 알린다.
    if (!row) {
      return res.status(block === 'not_found' ? 404 : 409).json({
        error: DM_TRANSITION_BLOCK_MESSAGES[block || 'race'],
        code: block === 'ab_running' ? 'DM_STOP_BLOCKED' : 'DM_NOT_PUBLISHED',
      });
    }
    return res.json({ success: true, status: row.status, short_code: row.short_code });
  } catch (err: any) {
    console.error('[DM중지] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// POST /api/dm/:id/resume — 재개
dmRouter.post('/:id/resume', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, req.user?.userId))) {
      return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    }
    // ★ 2026-08-06 이미 추첨이 끝난 행사는 재개하지 않는다(Codex 2R high) — 응모 폼이 다시 열리는데
    //   그 응모는 **당첨될 수 없다**(추첨은 1회뿐이고 `dm_draw_runs`가 있으면 재추첨 대상에서 영구 제외된다).
    //   판정은 UPDATE 안에 있다(3R high — 밖에 두면 조회와 UPDATE 사이에 워커가 추첨을 claim한다).
    const { row, block } = await resumeDm(req.params.id, companyId);
    if (!row) {
      // 사유는 전이 문장의 같은 스냅샷이 판정했다(2026-08-08, 4R medium) — 별도 조회 없음.
      return res.status(block === 'not_found' ? 404 : 409).json({
        error: DM_TRANSITION_BLOCK_MESSAGES[block || 'race'],
        code: block === 'drawn' ? 'DM_RESUME_BLOCKED' : 'DM_NOT_STOPPED',
      });
    }
    // 재개는 발행비를 다시 받지 않는다 — 이미 발행된 문서의 상태를 되돌리는 것이라
    //   `publishDm`(단축코드 발급·과금 멱등)을 지나지 않는다. 주소도 그대로다.
    return res.json({ success: true, status: row.status, short_code: row.short_code });
  } catch (err: any) {
    console.error('[DM재개] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// GET /api/dm/:id/stats — 통계
dmRouter.get('/:id/stats', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const stats = await getDmStats(req.params.id, companyId);
    return res.json(stats);
  } catch (err: any) {
    console.error('[DM통계] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// ============================================================
//  AI 엔진 5종 (D125 §9)
// ============================================================

// ★ D216+ POST /api/dm/ai/one-shot-generate — 자연어 OR 시나리오 → 완성된 sections[] 통합 생성
dmRouter.post('/ai/one-shot-generate', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const prompt: string = (req.body?.prompt || '').toString().trim();
    const scenario: string | undefined = req.body?.scenario;
    const brandName: string | undefined = req.body?.brand_name;
    // ★ 2026-07-07(4) 행사 캠페인 — 행사 원문 단독 입력도 생성 가능. 브리프 블록을 프롬프트에 합성
    //   (parsePrompt가 원문 기재 혜택을 spec.benefit으로 추출 → 기재 혜택만 카피에 반영되는 기존 경로 그대로).
    const eventText = req.body?.event_text ? normalizeEventText(req.body.event_text) : '';

    if (!prompt && !scenario && !eventText) {
      return res.status(400).json({ error: 'prompt 또는 scenario 영역 필요' });
    }
    if (prompt.length > 2000) {
      return res.status(400).json({ error: '프롬프트는 2000자 이내로 입력해주세요.' });
    }
    // ★ 2026-07-14 디자인 4.0 M5 — 행사 성격 → 정예 템플릿 스토리 힌트(결정적 매칭, 빈 행사문 = '' 우회)
    const effectivePrompt = eventText
      ? `${buildEventPromptBlock(eventText)}${(() => { const h = buildEventTemplateHintBlock(eventText); return h ? `\n\n${h}` : ''; })()}${prompt ? `\n\n[추가 요청]\n${prompt}` : ''}`
      : prompt;

    // ★ 종량제: DM 생성(돌려보기) = 3크레딧 묶음 (내부 parse/copy/tone은 집계만, 차감 0). 발행 시 30 별도.
    const genCost = getCreditCost('dm-ai-generate');  // 3
    await checkCredit(companyId, genCost);
    const result = await runInCreditBundle(async () => {
      const r = await oneShotGenerate({ prompt: effectivePrompt, scenario, brandName, companyId, eventText });
      await deductCreditSafe({ companyId, cost: genCost, source: 'dm-ai-generate', createdBy: req.user?.userId });
      return r;
    });
    // ★ 2026-07-21 연락처 시드는 oneShotGenerate 내부(페이지 분할 전)에서 실제 회사 brand_kit로 수행 — sections·pages 모두 반영(편집=발송). 여기 재시드 불필요.
    // ★ 2026-07-08 연동 몰 상품 자동 첨부 — 상품 슬라이드 항목명 이름매칭 → 이미지·링크·정가·할인가 채움(빈 값만, 몰 실패 skip). 발송 코어 무관(생성 결과 후처리).
    try { await attachMallImagesToProductCarousels(companyId, result.sections); } catch { /* best-effort */ }
    return res.json({
      success: true,
      data: {
        sections: result.sections,
        pages: result.pages,
        layout_mode: result.layoutMode,
        brand_kit: result.brandKit,
        spec: result.spec,
        scenario: result.scenario,
        // ★ 2026-07-16 M1 — 행사 브리프 + 반영 커버리지(미반영 항목 정직 표시 — 숨기지 않는다)
        brief: result.brief ?? null,
        coverage: result.coverage ?? null,
      },
    });
  } catch (err: any) {
    console.error('[DM AI one-shot-generate] 오류:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'AI 통합 생성 실패' });
  }
});

// ★ 2026-07-16 M3 — POST /api/dm/products/image-candidates — 상품명 → 네이버 쇼핑 후보 이미지 (최대 5)
//   자동 삽입 아님: 편집기가 후보를 띄우고 사용자가 탭 1번으로 확정한다 (오매칭 구조적 0 — 설계서 §2-5).
dmRouter.post('/products/image-candidates', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ success: false, error: '상품명이 필요합니다.' });
    // ★ 2026-07-19 (Harold): 브랜드+제품명 조합 검색 — 기획전 스샷 조립(캐러셀 title=브랜드)의 적중률 향상
    const brand = String(req.body?.brand || '').trim().slice(0, 60);
    if (!isNaverShopSearchConfigured()) {
      // 미설정 = 정직 안내 (후보 기능만 비활성 — 직접 업로드 경로는 항상 있음)
      return res.json({ success: true, configured: false, candidates: [] });
    }
    const candidates = await searchNaverShopCandidates([brand, name].filter(Boolean).join(' '), 5);
    return res.json({ success: true, configured: true, candidates });
  } catch (err: any) {
    console.error('[DM products/image-candidates] 오류:', err.message);
    return res.status(500).json({ success: false, error: err.message || '후보 검색 실패' });
  }
});

// ★ 2026-07-16 M3 — POST /api/dm/ai/event-text-from-url — 행사 URL → 페이지 본문 텍스트
//   반환 텍스트는 브리프 입력칸에 합쳐져 사용자가 눈으로 확인·보정 후 생성에 쓰인다(이미지 판독과 동일 이중 검증).
dmRouter.post('/ai/event-text-from-url', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const url = String(req.body?.url || '').trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ success: false, error: '올바른 URL을 입력해주세요.' });
    const text = await fetchEventTextFromUrl(url);
    if (!text) {
      return res.json({
        success: false,
        error: '이 페이지는 내용을 자동으로 가져올 수 없습니다(사이트가 외부 수집을 차단). 행사 내용을 직접 붙여넣어주세요.',
      });
    }
    return res.json({ success: true, text });
  } catch (err: any) {
    console.error('[DM ai/event-text-from-url] 오류:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'URL 수집 실패' });
  }
});

// POST /api/dm/ai/parse-prompt — 자연어 → CampaignSpec
dmRouter.post('/ai/parse-prompt', async (req: any, res: any) => {
  try {
    const prompt: string = (req.body?.prompt || '').toString().trim();
    if (!prompt) return res.status(400).json({ error: '프롬프트가 비어있어요.' });
    if (prompt.length > 2000) return res.status(400).json({ error: '프롬프트는 2000자 이내로 입력해주세요.' });
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const spec = await parsePrompt(prompt, companyId);
    return res.json({ spec });
  } catch (err: any) {
    console.error('[DM AI parse-prompt] 오류:', err.message);
    return res.status(500).json({ error: err.message || 'AI 파싱 실패' });
  }
});

// POST /api/dm/ai/recommend-layout — CampaignSpec → Section[]
dmRouter.post('/ai/recommend-layout', async (req: any, res: any) => {
  try {
    const spec = req.body?.spec as CampaignSpec | undefined;
    if (!spec || typeof spec !== 'object') return res.status(400).json({ error: 'spec이 필요해요.' });
    let sections = recommendLayout(spec);
    // ★ 2026-07-21 향후 DM은 브랜드학습 참조 — 회사 brand_kit 연락처를 footer·store_info 빈 필드에 시드(편집=발송). 조회 실패해도 안전 degrade.
    const companyId = req.user?.companyId;
    if (companyId) {
      try { sections = seedBrandContact(sections, await getCompanyBrandKit(companyId)); } catch { /* 시드 실패 = 빈 섹션 그대로(회귀 0) */ }
    }
    return res.json({ sections });
  } catch (err: any) {
    console.error('[DM AI recommend-layout] 오류:', err.message);
    return res.status(500).json({ error: err.message || 'AI 레이아웃 추천 실패' });
  }
});

// POST /api/dm/ai/generate-copy — 섹션별 카피 3안
dmRouter.post('/ai/generate-copy', async (req: any, res: any) => {
  try {
    const spec = req.body?.spec as CampaignSpec | undefined;
    const section = req.body?.section as Section | undefined;
    if (!spec || !section) return res.status(400).json({ error: 'spec + section이 필요해요.' });
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const copy = await generateCopy(spec, section, companyId);
    return res.json({ copy });
  } catch (err: any) {
    console.error('[DM AI generate-copy] 오류:', err.message);
    return res.status(500).json({ error: err.message || 'AI 카피 생성 실패' });
  }
});

// POST /api/dm/ai/transform-tone — 톤 변환
dmRouter.post('/ai/transform-tone', async (req: any, res: any) => {
  try {
    const text: string = (req.body?.text || '').toString();
    const targetTone: ToneKey = (req.body?.target_tone || 'friendly') as ToneKey;
    if (!text.trim()) return res.status(400).json({ error: '원문이 비어있어요.' });
    if (text.length > 500) return res.status(400).json({ error: '500자 이내로 입력해주세요.' });
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const result = await transformTone(text, targetTone, companyId);
    return res.json({ text: result });
  } catch (err: any) {
    console.error('[DM AI transform-tone] 오류:', err.message);
    return res.status(500).json({ error: err.message || 'AI 톤 변환 실패' });
  }
});

// ============================================================
//  개인화 변수 + 샘플 렌더링 (D125 §11)
// ============================================================

// GET /api/dm/variables — 회사별 사용 가능 변수 목록
dmRouter.get('/variables', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const variables = await getAvailableVariables(companyId);
    return res.json({ variables });
  } catch (err: any) {
    console.error('[DM 변수목록] 오류:', err.message);
    return res.status(500).json({ error: err.message || '변수 목록 로드 실패' });
  }
});

// GET /api/dm/sample-customers — 샘플 고객 3종 (VIP/신규/Empty)
dmRouter.get('/sample-customers', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const samples = await selectSampleCustomers(companyId);
    return res.json({ samples });
  } catch (err: any) {
    console.error('[DM 샘플고객] 오류:', err.message);
    return res.status(500).json({ error: err.message || '샘플 로드 실패' });
  }
});

// POST /api/dm/:id/send-to-target — 타겟 추출 대상에게 수신자별 개인화 DM 링크 문자 발송 (P4)
//   직접발송 파이프라인(createDirectSendCampaign) 재사용 = 크레딧·수신거부/무효·(광고)/080·취소 스위퍼 안전망 보존.
//   수신자별 고유 링크(?r=<token>) = staging extra1 → 템플릿 %기타1% 치환(direct-send-worker).
dmRouter.post('/:id/send-to-target', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId || companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });

    const { filter, messageText, isAd, scheduledAt, allCustomers, callback: callbackReq, useIndividualCallback, confirmCallbackExclusion, resendCustomerIds } = req.body as {
      filter?: Record<string, { operator: string; value: any }>;
      messageText?: string;
      isAd?: boolean;
      scheduledAt?: string | null;
      allCustomers?: boolean;
      /** ★ 2026-07-02(3) 발신번호 선택 — 회사 등록 번호만 허용, 미전달 = 기본 번호 */
      callback?: string;
      /** ★ 2026-07-02(3) 고객별 등록매장 번호(store_phone)로 개별 회신 — CT-08 필터(미등록 번호 제외) 적용 */
      useIndividualCallback?: boolean;
      /** 미등록/미보유 제외 안내 확인 후 재호출 플래그 */
      confirmCallbackExclusion?: boolean;
      /** ★ 2026-07-06 미열람자 재발송 — 지정 고객 id만 발송(자격·수신거부·차감 게이트는 동일 경로 전부 적용) */
      resendCustomerIds?: string[];
    };
    // ★ 2026-07-06 재발송 모드 — 서버가 회사 격리 + DM 채널 자격을 재적용하므로 filter 불요
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const resendIds = Array.isArray(resendCustomerIds)
      ? resendCustomerIds.map((x) => String(x)).filter((x) => UUID_RE.test(x)).slice(0, 10000)
      : [];
    const isResend = resendIds.length > 0;
    // ★ 2026-07-02(3) 전체 고객 발송 지원 — 타겟 추출 "전체 고객"(isAll) 확정분은 빈 filter 허용(= 조건 없음 = 전체 + DM 자격)
    if (!isResend && !allCustomers && (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0)) {
      return res.status(400).json({ error: '발송 대상 조건이 필요합니다. 전체 발송은 타겟 추출에서 "전체 고객"으로 확정해주세요.' });
    }
    const effectiveFilter = (isResend || allCustomers) ? {} : (filter as Record<string, { operator: string; value: any }>);
    if (!messageText?.trim()) return res.status(400).json({ error: '문자 본문을 입력해주세요.' });
    const scheduled = !!scheduledAt;
    if (scheduled) {
      const when = new Date(scheduledAt as string);
      if (isNaN(when.getTime()) || when.getTime() < Date.now() + 60 * 1000) {
        return res.status(400).json({ error: '예약 시각은 현재보다 1분 이상 이후여야 합니다.' });
      }
    }

    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });

    // ★ 2026-08-06 중지된 DM은 실발송하지 않는다(Codex 적대검증 high).
    //   **발행비 처리·수신자 적재보다 앞이다** — 뒤에 두면 잔액이 먼저 나가고,
    //   고객에게는 종료된 404 링크가 실제로 전송된다. 중지의 목적과 정면으로 어긋난다.
    //   여기서는 방금 읽은 행(`getDmDetail` = SELECT *)의 상태를 그대로 본다 — 같은 축이라 재조회가 낭비다.
    //   행이 손에 없는 길목(publish·test-send)은 CT `isDmStopped`를 부른다.
    if (dm.status === 'stopped') {
      return res.status(409).json({
        error: '중지된 DM입니다. 발송하려면 먼저 [재개]를 눌러주세요.',
        code: 'DM_STOPPED',
      });
    }

    // ★ 2026-07-12 D-1 발행비 정합 — 발행비(멱등키 dm-publish:dmId) 미납 + 실고객 발송 이력 없음이면
    //   402 PUBLISH_FEE_REQUIRED → 프론트 발행 확인 모달 → confirmPublishFee=true 재요청 시 이 자리에서
    //   발행비 확정(멱등키 = /publish와 동일) 후 발송 진행. 테스트 발행(무과금)·API 직행 우회 차단.
    //   (/publish 왕복 재시도는 차감 swallow 시 402 루프 가능 — Codex 지적으로 인라인 확정 설계.)
    //   예외: ①과거 실발송 이력(dm_recipient_tokens) = 구 정책 통과분 소급 금지 ②크레딧제 미적용 회사.
    //   판정 조회 실패 = 기존 동작(발송 우선 — 발송 무결 최우선). 차감 영구 실패 = [CREDIT][MISS] 수동 재차감(전사 정책).
    let publishFeeGate: { source: string; cost: number } | null = null;
    try {
      const chargedR = await query(
        `SELECT 1 FROM ai_credit_transactions WHERE company_id = $1::uuid AND idempotency_key = $2 LIMIT 1`,
        [companyId, `dm-publish:${req.params.id}`],
      );
      if (chargedR.rows.length === 0) {
        const [legacyR, creditState] = await Promise.all([
          query(`SELECT 1 FROM dm_recipient_tokens WHERE dm_id = $1::uuid AND company_id = $2::uuid LIMIT 1`, [req.params.id, companyId]),
          getCreditState(companyId),
        ]);
        if (legacyR.rows.length === 0 && creditState.creditEnabled) {
          const isInteractionFee = await isInteractionCampaign(companyId, req.params.id);
          const feeSource = isInteractionFee ? 'dm-interaction-publish' : 'dm-builder';
          publishFeeGate = { source: feeSource, cost: getCreditCost(feeSource) };
        }
      }
    } catch (feeErr: any) {
      console.warn('[DM 타겟 발송] 발행비 판정 실패 — 기존 동작으로 진행:', feeErr?.message);
    }
    if (publishFeeGate) {
      if (req.body?.confirmPublishFee !== true) {
        return res.status(402).json({
          error: '이 DM은 아직 발행 크레딧이 확정되지 않았습니다. 발행 확인 후 발송해주세요.',
          code: 'PUBLISH_FEE_REQUIRED',
          costSource: publishFeeGate.source,
        });
      }
      try {
        await checkCredit(companyId, publishFeeGate.cost);
      } catch (e: any) {
        if (e instanceof InsufficientCreditError) {
          return res.status(402).json({ error: '발행 크레딧이 부족합니다. 충전 후 다시 시도해주세요.', code: 'INSUFFICIENT_CREDIT' });
        }
        throw e;
      }
      await deductCreditSafe({
        companyId, cost: publishFeeGate.cost, source: publishFeeGate.source,
        createdBy: req.user?.userId, idempotencyKey: `dm-publish:${req.params.id}`,
      });
    }

    // 발행(short_code) 보장
    let shortCode = dm.short_code;
    if (!shortCode) {
      const pub = await publishDm(req.params.id, companyId);
      shortCode = pub.short_code;
    }
    if (!shortCode) return res.status(500).json({ error: 'DM 발행에 실패했습니다.' });

    // 광고 가드 — 광고성이면 무료수신거부(080) 필수 (정보통신망법)
    if (isAd) {
      const opt080 = await getOpt080Number(userId || null, companyId);
      if (!opt080) return res.status(400).json({ error: '광고성 발송은 무료수신거부(080) 번호 등록이 필요합니다.', code: 'NO_OPT080' });
    }

    // 발신번호 — 선택값(회사 등록 번호인지 검증) 우선, 미전달 시 기본 등록 번호.
    // 개별 회신(useIndividualCallback) 모드는 고객별 번호가 우선이라 기본 번호가 없어도 통과(폴백용으로만 사용).
    let callback: string | null = null;
    const wantedCb = !useIndividualCallback && callbackReq ? String(callbackReq).replace(/\D/g, '') : '';
    if (wantedCb) {
      const cbSel = await query(
        `SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers WHERE company_id = $1 AND REPLACE(phone, '-', '') = $2 LIMIT 1`,
        [companyId, wantedCb],
      );
      callback = cbSel.rows[0]?.phone || null;
      if (!callback) return res.status(400).json({ error: '등록되지 않은 발신번호입니다. 발신번호 관리에서 확인해주세요.', code: 'INVALID_CALLBACK' });
    } else {
      const cbRes = await query(
        `SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1`,
        [companyId],
      );
      callback = cbRes.rows[0]?.phone || null;
    }
    if (!callback && !useIndividualCallback) return res.status(400).json({ error: '등록된 발신번호가 없습니다. 발신번호 등록 후 발송해주세요.', code: 'NO_CALLBACK' });

    // 발송 대상 resolve — DM 채널 자격(전화 유효·수신거부/무효 아님·활성) + filter. phone 중복 제거.
    //   전체 고객(allCustomers)이면 filter 조건 없이 DM 자격만 적용.
    //   ★ 2026-07-06 재발송(resendIds)이면 지정 고객 한정 — 자격 필터는 동일하게 재적용(그 사이 수신거부한 고객 자동 제외).
    const { sql: filterSql, params: filterParams } = buildCustomerFilter(effectiveFilter, {
      tableAlias: 'c', startParamIndex: 2, storeCodeMode: 'skip', inputFormat: 'structured',
    });
    const dmWhere = buildChannelEligibilityWhere('dm', 'c');
    const recRes = isResend
      ? await query(
          `SELECT DISTINCT ON (c.phone) c.id, c.phone, c.name, c.store_phone
             FROM customers c
            WHERE c.company_id = $1::uuid AND c.id = ANY($2::uuid[]) AND (${dmWhere})
            ORDER BY c.phone, c.id`,
          [companyId, resendIds],
        )
      : await query(
          `SELECT DISTINCT ON (c.phone) c.id, c.phone, c.name, c.store_phone
             FROM customers c
            WHERE c.company_id = $1::uuid AND (${dmWhere})${filterSql}
            ORDER BY c.phone, c.id`,
          [companyId, ...filterParams],
        );
    let recipients = recRes.rows;
    if (recipients.length === 0) return res.status(400).json({ error: '발송 대상이 0명입니다. 조건을 조정해주세요.', code: 'ZERO_MATCH' });

    // ★ 2026-07-02(3) 고객별 등록매장 번호(개별 회신) — CT-08: store_phone→callback 세팅 + 미보유/미등록 번호 제외
    if (useIndividualCallback) {
      const cbResult = await filterByIndividualCallback(recipients, companyId, userId || undefined);
      if (cbResult.filtered.length === 0) {
        return res.status(400).json(buildCallbackErrorResponse(cbResult.callbackMissingCount, cbResult.callbackUnregisteredCount));
      }
      // 제외 대상이 있으면 사용자 확인 후 재호출 (직접발송과 동일 UX)
      if (cbResult.callbackSkippedCount > 0 && !confirmCallbackExclusion) {
        return res.json(buildCallbackConfirmResponse(cbResult, cbResult.filtered.length));
      }
      recipients = cbResult.filtered;
    }

    // 수신자별 토큰 발급(벌크) + 링크 구성
    let tokenPairs: Array<{ customerId: string; token: string; shortCode?: string }>;
    try {
      tokenPairs = await issueDmRecipientTokensBulk(dm.id, companyId, recipients.map((r: any) => String(r.id)), 30);
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('relation') && msg.includes('does not exist')) {
        return res.status(503).json({ error: '수신자별 열람 기록을 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
      }
      throw e;
    }
    const tokenByCust: Record<string, string> = {};
    const shortByCust: Record<string, string> = {};
    for (const p of tokenPairs) {
      tokenByCust[p.customerId] = p.token;
      if (p.shortCode) shortByCust[p.customerId] = p.shortCode;
    }
    const baseUrl = process.env.HANJUL_BASE_URL || 'https://hanjul.ai';
    // ★ 2026-07-06 단축링크(hlj.kr) — env 설정 + short_code 발급 성공 수신자만 짧은 링크(SMS 바이트 절감).
    //   env 미설정/발급 폴백 = 기존 긴 링크 그대로(발송·추적 무결 최우선).
    const shortBase = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');

    // staging 적재 — phone + name(%고객명%) + extra1(수신자별 DM 링크 %기타1%) + callback(개별 회신 시 수신자별 매장번호)
    const stagingId = uuidv4();
    const phones = recipients.map((r: any) => String(r.phone || '').replace(/\D/g, ''));
    const names = recipients.map((r: any) => (r.name ?? null));
    const links = recipients.map((r: any) => {
      const sc = shortBase ? shortByCust[String(r.id)] : undefined;
      return sc ? `${shortBase}/${sc}` : `${baseUrl}/api/dm/v/dm-${shortCode}?r=${tokenByCust[String(r.id)] || ''}`;
    });
    const cbs = recipients.map((r: any) => (useIndividualCallback && r.callback ? String(r.callback).replace(/\D/g, '') : null));
    await query(
      `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name, extra1, callback)
       SELECT $1::uuid, $2::uuid, u.phone, u.name, u.extra1, u.callback
         FROM UNNEST($3::text[], $4::text[], $5::text[], $6::text[]) AS u(phone, name, extra1, callback)`,
      [stagingId, companyId, phones, names, links, cbs],
    );

    // 정제 후 실제 발송 수(중복·수신거부 제외) — 커밋과 동일 기준으로 과금 정확
    const { sendCount } = await countStagingFiltered(stagingId, companyId, userId, true, true);
    if (sendCount === 0) {
      await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1`, [stagingId]);
      return res.status(400).json({ error: '수신 가능한 대상이 0명입니다(수신거부 제외 후).', code: 'ZERO_MATCH' });
    }

    // 본문 = 사용자 문구 + 수신자별 링크. %DM링크% 위치에 링크(없으면 끝에 첨부). 수신자별 = %기타1%.
    // ★ 2026-07-02: 광고 발송은 문안 속 (광고)/무료수신거부 문구를 먼저 걷어낸다 — 남아 있으면
    //   buildAdMessage가 이미 붙은 것으로 판단해 설정된 080 합성을 건너뛰어 임의 번호가 그대로 발송됨.
    const bodyText = isAd ? stripAdPartsDeep(messageText.trim()) : messageText.trim();
    if (!bodyText) return res.status(400).json({ error: '문자 본문을 입력해주세요.' });
    const finalMessage = bodyText.includes('%DM링크%')
      ? bodyText.split('%DM링크%').join('%기타1%')
      : `${bodyText}\n%기타1%`;

    let campaignId: string;
    try {
      const result = await createDirectSendCampaign(
        {
          stagingId,
          campaignName: `DM 발송 · ${dm.title || ''} · ${new Date().toLocaleDateString('ko-KR')}`,
          msgType: 'LMS',
          message: finalMessage,
          subject: (dm.title || 'DM').slice(0, 40),
          callback: callback || '',
          useIndividualCallback: !!useIndividualCallback,
          sendChannel: 'sms',
          adEnabled: isAd === true,
          total: sendCount,
          scheduled,
          scheduledAt: scheduled ? (scheduledAt as string) : null,
          dedupEnabled: true,
          unsubFilterEnabled: true,
        },
        { companyId, userId },
        { finalSource: 'manual' },
      );
      campaignId = result.campaignId;
    } catch (e: any) {
      await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1`, [stagingId]).catch(() => {});
      if (e instanceof DirectSendError && e.code === 'INSUFFICIENT_BALANCE') {
        return res.status(402).json({ error: '잔액이 부족합니다.', code: 'INSUFFICIENT_BALANCE' });
      }
      // ★ 2026-07-02 그 외 DirectSendError(링크 placeholder 가드 등) = 정의된 상태코드 + 사용자 친화 메시지
      if (e instanceof DirectSendError) {
        return res.status(e.httpStatus || 400).json({ error: e.message, code: e.code, ...(e.extra || {}) });
      }
      throw e;
    }

    // ★ 2026-07-03 Gap5 Layer2: 고객별 발송 카운터 (예측 분모 전용, fire-and-forget — 발송·돈 무영향, campaignRef 멱등)
    void recordCustomerSends({
      companyId,
      campaignRef: `dm:${campaignId}`,
      customerIds: recipients.map((r: any) => String(r.id || '')).filter(Boolean),
    });

    // ★ 2026-07-03 DM 문안 학습 코퍼스 적재 (fire-and-forget, 발송·응답 무영향).
    //   DM 카드 창작 문안 + isAd + 대상 수 → ai_training_logs(messageType='DM'). source_ref=dm.id 멱등(재발송 중복 0).
    //   문안두뇌 RAG 검색·미래 학습 모델의 DM 원천. 열람 결과 라벨은 Phase 1d에서 환류.
    const dmCopyText = extractDmCopyText(dm);
    if (dmCopyText) {
      logCampaignTraining({
        campaignId: dm.id,
        companyId,
        messageType: 'DM',
        isAd: isAd === true,
        targetCount: sendCount,
        finalMessage: dmCopyText,
        finalSource: 'manual',
      }).catch(() => { /* 학습 적재 실패는 발송에 영향 없음 */ });
    }

    return res.json({ success: true, campaignId, sent: sendCount });
  } catch (err: any) {
    console.error('[DM 타겟 발송] 오류:', err?.message);
    return res.status(500).json({ error: err?.message || 'DM 발송 실패' });
  }
});

// GET /api/dm/:id/recipients-tracking — DM 타겟 발송 수신자별 열람/액션 현황 (P4 추적)
//   dm_recipient_tokens(발송 대상) × dm_views(열람, phone 매칭) → 누가 열었고 어디까지 봤는지.
dmRouter.get('/:id/recipients-tracking', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });

    // ★ 2026-07-02 토큰 우선 매칭(신규 비콘) + phone 매칭(구 데이터 하위호환) + 깊이/클릭 동봉
    //   2026-07-02(5) CT 이관 — 상세 endpoint·AI 학습 워커와 공용 (getDmRecipientEngagementRows)
    const rows = await getDmRecipientEngagementRows(req.params.id, companyId);

    // ★ 2026-07-06 구매 전환 — 발송(토큰 발급) 후 7일 내 purchases 실측 (고객별 건수·금액).
    //   purchases.purchase_date = timezone 없는 timestamp(KST 적재) ↔ t.created_at timestamptz → KST 변환 명시.
    //   조회 실패는 격리(전환 없이 응답) — 기존 추적 표시 무결.
    const purchaseByCust: Record<string, { count: number; amount: number }> = {};
    try {
      const pRes = await query(
        `SELECT t.customer_id, COUNT(*)::int AS cnt, COALESCE(SUM(p.total_amount), 0)::numeric AS amt
           FROM dm_recipient_tokens t
           JOIN purchases p ON p.company_id = t.company_id AND p.customer_id = t.customer_id
            AND p.purchase_date >= (t.created_at AT TIME ZONE 'Asia/Seoul')
            AND p.purchase_date <= (t.created_at AT TIME ZONE 'Asia/Seoul') + INTERVAL '7 days'
          WHERE t.dm_id = $1::uuid AND t.company_id = $2::uuid
          GROUP BY t.customer_id`,
        [req.params.id, companyId],
      );
      for (const r of pRes.rows) purchaseByCust[String(r.customer_id)] = { count: Number(r.cnt) || 0, amount: Number(r.amt) || 0 };
    } catch (e: any) {
      console.warn('[DM 발송 추적] 구매 전환 조회 실패(전환 없이 응답):', e?.message);
    }

    const recipients = rows.map((row: any) => {
      const viewed = !!row.viewed_at;
      const totalPages = Number(row.total_pages || 0);
      const pageReached = Number(row.page_reached || 0);
      const maxScrollPct = row.max_scroll_pct === null || row.max_scroll_pct === undefined ? null : Number(row.max_scroll_pct);
      const progressPct = viewed ? computeDmProgressPct(pageReached, totalPages, maxScrollPct) : 0;
      const purchase = purchaseByCust[String(row.customer_id)] || null;
      return {
        customerId: row.customer_id,
        name: row.name || null,
        phone: row.phone || null,
        sentAt: row.sent_at,
        viewed,
        pageReached,
        totalPages,
        maxScrollPct,
        progressPct,
        completed: viewed && isDmCompleted(pageReached, totalPages, maxScrollPct),
        clicks: sumSectionClicks(row.section_interactions),
        // ★ 2026-07-02(3) 고객 액션(응모/투표/쿠폰 수령/설문 등 dm_event_responses) 여부
        responded: !!row.responded,
        durationSeconds: Number(row.duration_seconds || 0),
        lastActiveAt: row.last_active_at || null,
        // ★ 2026-07-06 재열람·기기(공유 신호)·구매 전환
        openCount: viewed ? Math.max(1, Number(row.open_count) || 1) : 0,
        deviceCount: Array.isArray(row.seen_anon_ids) ? row.seen_anon_ids.length : (viewed ? 1 : 0),
        purchaseCount: purchase?.count || 0,
        purchaseAmount: purchase?.amount || 0,
      };
    });

    // 깔때기 요약: 발송 → 열람 → 50% 도달 → 완독 → 클릭 → 응모(액션) → 구매 전환
    const summary = {
      sent: recipients.length,
      viewed: recipients.filter((x) => x.viewed).length,
      reached50: recipients.filter((x) => x.viewed && x.progressPct >= 50).length,
      completed: recipients.filter((x) => x.completed).length,
      clicked: recipients.filter((x) => x.clicks > 0).length,
      responded: recipients.filter((x) => x.responded).length,
      purchased: recipients.filter((x) => x.purchaseCount > 0).length,
      purchaseAmount: recipients.reduce((acc, x) => acc + (x.purchaseAmount || 0), 0),
      reViewed: recipients.filter((x) => x.openCount > 1).length,
      multiDevice: recipients.filter((x) => x.deviceCount > 1).length,
    };

    // ★ 2026-07-06 열람 시간대 분포(KST) — 다음 발송 시간 참고. 실패 격리.
    let hourDistribution: Array<{ hour: number; cnt: number }> = [];
    try {
      const hRes = await query(
        `SELECT EXTRACT(HOUR FROM viewed_at AT TIME ZONE 'Asia/Seoul')::int AS hour, COUNT(*)::int AS cnt
           FROM dm_views WHERE dm_id = $1::uuid AND company_id = $2::uuid
          GROUP BY 1 ORDER BY 2 DESC`,
        [req.params.id, companyId],
      );
      hourDistribution = hRes.rows.map((r: any) => ({ hour: Number(r.hour), cnt: Number(r.cnt) }));
    } catch (e: any) {
      console.warn('[DM 발송 추적] 시간대 분포 조회 실패:', e?.message);
    }

    // ★ 2026-07-06 섹션 이탈 집계 — 열람자별 "마지막으로 본 섹션"(발행물 순서 기준)을 세어 이탈 지점 top 산출.
    //   완독자는 이탈로 세지 않는다. 실패 격리.
    let sectionExits: Array<{ id: string; label: string; count: number }> = [];
    try {
      const dm = await getDmDetail(req.params.id, companyId);
      if (dm) {
        const ordered = extractFlatSectionsFromDm(dm).map((s: any) => ({
          id: String(s?.id || ''),
          label: buildDmSectionLabel(String(s?.type || ''), s?.props),
        }));
        const orderIdx = new Map(ordered.map((s, i) => [s.id, i]));
        const exitCount = new Map<string, number>();
        for (const r of rows) {
          if (!r.viewed_at) continue;
          const completed = isDmCompleted(r.page_reached, r.total_pages, r.max_scroll_pct);
          if (completed) continue;
          const si = sanitizeSectionInteractions(r.section_interactions);
          let lastIdx = -1;
          for (const id of Object.keys(si)) {
            if (si[id].views <= 0) continue;
            const idx = orderIdx.get(id);
            if (idx !== undefined && idx > lastIdx) lastIdx = idx;
          }
          if (lastIdx >= 0) {
            const id = ordered[lastIdx].id;
            exitCount.set(id, (exitCount.get(id) || 0) + 1);
          }
        }
        sectionExits = [...exitCount.entries()]
          .map(([id, count]) => ({ id, label: ordered[orderIdx.get(id)!].label, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
      }
    } catch (e: any) {
      console.warn('[DM 발송 추적] 섹션 이탈 집계 실패:', e?.message);
    }

    return res.json({ success: true, summary, recipients, hourDistribution, sectionExits });
  } catch (err: any) {
    const msg = err?.message || '';
    if ((msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist')) {
      return res.status(503).json({ error: '수신자별 열람 기록을 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[DM 발송 추적] 오류:', err?.message);
    return res.status(500).json({ error: err?.message || '추적 조회 실패' });
  }
});

// GET /api/dm/:id/recipient-detail?customerId= — 수신자 1명 상세 (섹션 여정 + 요소 클릭 + 응답 이력)
//   ★ 2026-07-02(5) Harold 지시 — "어떤 섹션을 보고 어떤 버튼을 눌렀고 무슨 액션을 했는지" 행 단위 상세.
dmRouter.get('/:id/recipient-detail', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const customerId = String(req.query.customerId || '');
    if (!isUuid(req.params.id) || !isUuid(customerId)) return res.status(400).json({ error: '잘못된 요청입니다.' });

    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });

    const rows = await getDmRecipientEngagementRows(req.params.id, companyId, customerId);
    const row: any = rows[0] || null;
    const si = sanitizeSectionInteractions(row?.section_interactions);

    // 발행물 섹션 순서대로 여정 구성 (조회/클릭 0인 섹션도 포함 = 어디서 멈췄는지 보이게)
    const seen = new Set<string>();
    const sections = extractFlatSectionsFromDm(dm).map((s: any) => {
      const id = String(s?.id || '');
      seen.add(id);
      const c = si[id];
      return {
        id,
        type: String(s?.type || ''),
        label: buildDmSectionLabel(String(s?.type || ''), s?.props),
        views: c?.views || 0,
        clicks: c?.clicks || 0,
        elements: c?.elements || null,
      };
    });
    // 편집에서 삭제됐지만 기록은 남은 섹션 — 뒤에 덧붙여 데이터 유실 없이 표시
    for (const [id, c] of Object.entries(si)) {
      if (seen.has(id)) continue;
      sections.push({ id, type: '', label: '(삭제된 섹션)', views: c.views, clicks: c.clicks, elements: c.elements || null });
    }

    const rres = await query(
      `SELECT section_id, section_type, response_data, occurred_at
         FROM dm_event_responses
        WHERE company_id = $1::uuid AND campaign_id = $2::uuid AND customer_id = $3::uuid
        ORDER BY occurred_at ASC
        LIMIT 200`,
      [companyId, req.params.id, customerId],
    );
    const responses = rres.rows.map((r: any) => ({
      sectionId: r.section_id,
      sectionType: r.section_type,
      typeLabel: dmSectionTypeLabel(String(r.section_type || '')),
      summary: summarizeDmResponse(String(r.section_type || ''), r.response_data),
      occurredAt: r.occurred_at,
    }));

    const viewed = !!row?.viewed_at;
    return res.json({
      success: true,
      view: viewed ? {
        viewedAt: row.viewed_at,
        lastActiveAt: row.last_active_at || null,
        durationSeconds: Number(row.duration_seconds || 0),
        maxScrollPct: row.max_scroll_pct === null || row.max_scroll_pct === undefined ? null : Number(row.max_scroll_pct),
        pageReached: Number(row.page_reached || 0),
        totalPages: Number(row.total_pages || 0),
        progressPct: computeDmProgressPct(row.page_reached, row.total_pages, row.max_scroll_pct),
        completed: isDmCompleted(row.page_reached, row.total_pages, row.max_scroll_pct),
      } : null,
      sections,
      responses,
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if ((msg.includes('relation') || msg.includes('column')) && msg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요: dm_recipient_tokens/dm_views/dm_event_responses 확인 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[DM 수신자 상세] 오류:', err?.message);
    return res.status(500).json({ error: err?.message || '수신자 상세 조회 실패' });
  }
});

// POST /api/dm/:id/generate-copy — DM 발송용 문안 1개 생성 (브랜드보이스 주입, %DM링크% 포함) — P4 편집기
//   경량 단일 생성(캠페인 다변형 generate-message와 별개). 종량제 3크레딧(callAIWithFallback creditCost).
//   ★ 2026-07-02(3) Harold 지시 — 문안은 "DM 편집 내용"에 근거해 생성(섹션 요약 주입) + JSON 응답 방어 파싱.
dmRouter.post('/:id/generate-copy', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    // ★ 2026-07-02(3) Harold 지시 — 프롬프트는 선택. 비워두면 편집된 DM 내용만으로 자동 생성.
    const { prompt } = req.body as { prompt?: string };
    const userPrompt = prompt?.trim() || '';
    // ★ 2026-07-07(4) SMS 우선 옵션 — hlj.kr 단축링크(22자) 도입으로 90바이트 SMS가 가능해짐. 기본은 기존 LMS.
    const lengthMode: 'sms' | 'lms' = req.body?.length_mode === 'sms' ? 'sms' : 'lms';

    // DM 편집 내용 요약 — 문자는 이 DM 페이지를 알리는 것이므로 실제 편집된 내용이 문안의 근거
    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    const dmLines: string[] = [];
    if (dm.title) dmLines.push(`DM 제목: ${dm.title}`);
    if (dm.store_name) dmLines.push(`브랜드/매장: ${dm.store_name}`);
    for (const s of extractFlatSectionsFromDm(dm).slice(0, 24)) {
      const p: any = s?.props || {};
      switch (s?.type) {
        case 'hero': if (p.headline) dmLines.push(`히어로: ${p.headline}${p.sub_copy ? ` / ${p.sub_copy}` : ''}`); break;
        case 'text_card': if (p.headline || p.body) dmLines.push(`텍스트: ${p.headline || ''} ${String(p.body || '').slice(0, 100)}`.trim()); break;
        case 'coupon': if (p.discount_label) dmLines.push(`쿠폰: ${p.discount_label}${p.coupon_code ? ` (코드 ${p.coupon_code})` : ''}`); break;
        case 'instant_coupon': if (p.coupon_label) dmLines.push(`즉시쿠폰: ${p.coupon_label} ${p.discount_description || ''}`.trim()); break;
        case 'product_carousel': {
          // ★ 2026-07-08 가격 동반 요약 — 문안 규칙이 "요약에 적힌 표현만 인용"이라 가격이 여기 있어야 문안에 들어간다
          const items = (Array.isArray(p.products) ? p.products : []).slice(0, 5).map((x: any) => {
            const nm = String(x?.name || '').trim();
            if (!nm) return '';
            const price = Number(x?.price || 0);
            const dis = Number(x?.discount_price || 0);
            if (price > 0 && dis > 0 && dis < price) return `${nm} ${price.toLocaleString('ko-KR')}원 → ${dis.toLocaleString('ko-KR')}원`;
            const fp = dis > 0 ? dis : price;
            return fp > 0 ? `${nm} ${fp.toLocaleString('ko-KR')}원` : nm;
          }).filter(Boolean);
          if (items.length) dmLines.push(`상품: ${items.join(' / ')}`);
          break;
        }
        case 'countdown': if (p.urgency_text) dmLines.push(`마감 안내: ${p.urgency_text}`); break;
        case 'limited_quantity': if (p.title) dmLines.push(`선착순: ${p.title}`); break;
        case 'lucky_draw': if (p.title) dmLines.push(`응모 이벤트: ${p.title}`); break;
        case 'roulette': if (p.title) dmLines.push(`룰렛 이벤트: ${p.title}`); break;
        case 'cta': { const b = (Array.isArray(p.buttons) ? p.buttons : [])[0]; if (b?.label) dmLines.push(`행동 유도: ${b.label}`); break; }
        // ★ 2026-07-07(4) 16섹션 커버리지 — 열거 밖 신규/기타 섹션도 대표 텍스트를 요약에 반영 (탭·설문·투표·이메일수집 등)
        default: {
          const rep = p.headline || p.title || p.question || p.label || p.text;
          if (rep && String(rep).trim()) dmLines.push(`${String(s?.type || '섹션')}: ${String(rep).slice(0, 80)}`);
          break;
        }
      }
    }
    const dmSummary = dmLines.length
      ? `\n\n[DM 페이지 편집 내용: 이 문자는 아래 DM을 알리는 문자입니다. 문안은 반드시 이 내용에 근거해 작성]\n${dmLines.join('\n')}`
      : '';

    // ★ 2026-07-02(3) 계절·시기 감성 주입 — DM 내용 + 시즌감으로 풍성한 카피 (구체 사실 창작은 여전히 금지)
    const { monthLabel, seasonHint } = getSeasonContext();
    const lengthRule = lengthMode === 'sms'
      ? `- 단문(SMS) 우선: %DM링크%는 발송 시 22자 내외 단축링크로 치환됩니다. 링크를 제외한 본문은 한글 기준 28자 안(전체 90바이트 안)으로: 감성 후크 반 줄 + 핵심 한 조각 + %DM링크%. 줄바꿈 없이 한 줄.`
      : `- 밋밋한 나열 대신 감성 후크(첫 줄) + 핵심 내용 + 행동 유도 흐름으로.
- 80~250자. 줄바꿈은 실제 줄바꿈 문자로.`;
    const baseSystem = `당신은 한줄로 SMS/LMS 마케팅 카피라이터입니다. 아래 조건으로 ${lengthMode === 'sms' ? '단문(SMS)' : 'LMS'} 문자 본문 1개만 작성합니다.
- 반드시 %DM링크% 를 문안 안 자연스러운 위치에 1회 포함(수신자별 개인화 링크가 여기 들어갑니다).
- 혜택·쿠폰·이벤트는 [DM 페이지 편집 내용]에 실제 적힌 표현만 그대로 인용. 거기 없는 혜택(%/원/쿠폰/무료/할인/사은품/적립) 임의 창작 절대 금지.
- 지금은 ${monthLabel}(${seasonHint}). 계절감과 시기 감성을 가벼운 수식·인사로 자연스럽게 녹여 카피를 풍성하게. 단 시즌 묘사는 일반적 사실만, 통계·행사 등 구체 사실 지어내기 금지.
- [DM 페이지 편집 내용]에 상품 가격이 있으면 대표 상품 1~3개를 "정가 → 할인가" 형식 그대로 본문에 담아라(전 상품 나열로 장황해지지 않게).
- 구분선은 하이픈 10개(----------)를 초과 금지. 긴 대시/등호/특수문자 줄은 휴대폰에서 두 줄로 꺾여 보인다.
${lengthRule}
- 유니코드 이모지 금지(SMS 호환).
- 개인화는 %고객명% 등 명시된 변수만 사용.
[출력 형식: 절대 준수] 문자 본문 텍스트만 그대로 출력. JSON·코드블록·따옴표·"channel"·"body" 같은 형식 절대 금지.${dmSummary}`;
    const system = await buildSystemPromptWithBrandVoice(companyId, baseSystem);

    const text = await callAIWithFallback({
      system,
      userMessage: `${userPrompt ? `추가 요청: ${userPrompt}\n\n` : ''}[DM 페이지 편집 내용]을 고객에게 알리는 LMS 문안 1개를 본문 텍스트로만 작성하세요. %DM링크% 를 포함하세요.`,
      model: 'sonnet',
      maxTokens: 800,
      temperature: 0.7,
      companyId,
      source: 'dm-copy-generate',
      creditCost: 3,
      userId,
    });

    let msg = String(text || '').trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
    // ★ 방어 파싱 — AI가 형식을 어기고 {"channel","body"} JSON으로 답하면 body만 추출 (JSON 원문 노출 차단)
    if (msg.startsWith('{')) {
      try {
        const parsed: any = extractJsonFromAiText(msg);
        const body = parsed?.body ?? parsed?.message ?? parsed?.text;
        if (typeof body === 'string' && body.trim()) msg = body.trim();
      } catch { /* JSON 아님 = 텍스트 그대로 */ }
    }
    // 리터럴 \n(백슬래시+n)로 온 줄바꿈을 실제 줄바꿈으로 정규화
    msg = msg.replace(/\\n/g, '\n').trim();
    // ★ 2026-07-02: AI가 문안에 넣은 (광고)/무료수신거부(임의 번호 포함) 제거 —
    //   080 문구는 발송 시점에 buildAdMessage가 설정된 번호로 합성한다.
    msg = stripAdPartsDeep(msg);
    // ★ 2026-07-08 긴 구분선 줄 정규화 — 기기 화면 폭에서 두 줄로 꺾이는 것 차단 (CT-messageUtils)
    msg = normalizeSmsSeparatorLines(msg);
    if (!msg) return res.status(500).json({ error: '문안 생성 결과가 비어 있습니다. 다시 시도해주세요.' });
    if (!msg.includes('%DM링크%')) msg = `${msg}\n%DM링크%`;
    return res.json({ success: true, message: msg });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) return res.status(402).json({ error: '크레딧이 부족합니다. 충전 후 이용해주세요.', code: 'INSUFFICIENT_CREDIT' });
    console.error('[DM 문안 생성] 오류:', err?.message);
    return res.status(500).json({ error: err?.message || '문안 생성 실패' });
  }
});

// POST /api/dm/:id/render-sample — 샘플 고객 기준 뷰어 HTML 렌더링
dmRouter.post('/:id/render-sample', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const sampleKey: SampleCustomerKey = (req.body?.sample_key || 'vip') as SampleCustomerKey;
    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    const sample = await selectSampleCustomerByKey(companyId, sampleKey);
    const html = await renderDmViewerHtmlWithCustomer(dm, '/api/dm/v', sample.data, companyId);
    return res.json({
      sample: { key: sample.key, label: sample.label, description: sample.description },
      html,
    });
  } catch (err: any) {
    console.error('[DM 샘플렌더] 오류:', err.message);
    return res.status(500).json({ error: err.message || '렌더링 실패' });
  }
});

// ============================================================
//  레거시 → 섹션 변환 (D125 §15)
// ============================================================

// POST /api/dm/:id/convert-to-scroll — slides 모드 DM을 sections 모드로 변환
dmRouter.post('/:id/convert-to-scroll', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
    if (dm.layout_mode === 'scroll') return res.status(400).json({ error: '이미 섹션 모드예요.' });

    const { sections } = convertLegacyToSections({
      title: dm.title,
      header_template: dm.header_template,
      footer_template: dm.footer_template,
      header_data: dm.header_data,
      footer_data: dm.footer_data,
      pages: dm.pages,
    });

    // D128: 변환 결과를 단일 페이지로 감싸서 저장 (향후 페이지 분할 편집 가능)
    const convertedPages = [{ id: 'p-converted', sections }];
    const updated = await updateDm(req.params.id, companyId, {
      layout_mode: 'scroll',
      sections,
      pages: convertedPages,
      approval_status: 'draft',
    } as any);

    return res.json({ dm: updated, converted_sections: sections.length });
  } catch (err: any) {
    console.error('[DM 레거시변환] 오류:', err.message);
    return res.status(500).json({ error: err.message || '변환 실패' });
  }
});

// ============================================================
//  테스트 발송 (D125 §14)
// ============================================================

// POST /api/dm/:id/test-send — 담당자 번호로 테스트 SMS + DM 링크
dmRouter.post('/:id/test-send', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });

    // 담당자 번호: frontend가 body로 보내면 그것, 없으면 회사 담당자(test_contacts) CT-11 자동 조회 (campaigns/test-send와 동일 — 사용자별 격리)
    let phones: string[] = Array.isArray(req.body?.manager_phones) ? req.body.manager_phones : [];
    if (phones.length === 0 && userId) {
      const contacts = await getUserTestContacts(companyId, userId);
      phones = contacts.map((c) => c.phone);
    }
    const cleanPhones = phones.map((p) => String(p).replace(/[^0-9]/g, '')).filter((p) => p.length >= 10 && p.length <= 11);
    if (cleanPhones.length === 0) return res.status(400).json({ error: '등록된 담당자 번호가 없어요. 설정 > 담당자 번호에서 추가해주세요.' });
    if (cleanPhones.length > 5) return res.status(400).json({ error: '테스트 발송은 최대 5명까지예요.' });

    const sampleKey: SampleCustomerKey = (req.body?.sample_key || 'vip') as SampleCustomerKey;

    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });

    // ★ 2026-07-24(Harold 확정): 미발행 DM 테스트 발송 시 자동발행(publishDm) 금지 — 크레딧 없이 short_code(발행 URL)가
    //   영구 발급돼 목록 복사·실사용으로 발행 과금을 우회하던 결함(서수란 접수). 발행(과금) 후에만 테스트 발송 허용.
    //   발행 전 확인은 편집기 캔버스 미리보기로. (발송 경로 1096은 발행비 게이트로 차감 후 발행 — 무게이트는 여기뿐이었음)
    if (!dm.short_code) {
      return res.status(400).json({ error: '발행 후 테스트 발송이 가능해요. 발행 전에는 편집기 미리보기로 확인해주세요.', code: 'DM_NOT_PUBLISHED' });
    }
    // ★ 2026-08-06 중지분은 테스트 발송도 막는다(Codex 적대검증 high).
    //   `short_code`는 중지돼도 남아 있으므로 위 가드를 그대로 통과한다 —
    //   담당자 번호로 종료된 404 링크가 나가 "중지가 안 먹었다"는 오진으로 이어진다.
    if (dm.status === 'stopped') {
      return res.status(409).json({ error: '중지된 DM입니다. 먼저 [재개]를 눌러주세요.', code: 'DM_STOPPED' });
    }

    const baseUrl = process.env.HANJUL_BASE_URL || 'https://hanjul.ai';
    const url = `${baseUrl}/api/dm/v/dm-${dm.short_code}?p=test&s=${sampleKey}`;

    const sampleLabel = sampleKey === 'vip' ? 'VIP 샘플' : sampleKey === 'newbie' ? '신규 샘플' : '데이터없음';
    const body = sanitizeSmsText(
      `[DM 테스트 발송]\n${dm.title || '(제목 없음)'}\n\n미리보기: ${url}\n\n- 샘플: ${sampleLabel}\n- 발송 시각: ${new Date().toLocaleString('ko-KR')}`
    );

    // ★ 2026-06-24: app_etc1은 SMSQ_SEND_10에서 varchar(50). 옛 `dm-test-${UUID}-${Date.now()}`(58자)가
    //   넘쳐 INSERT가 'Data too long'으로 던져지고 아래 per-phone catch에 삼켜져, 화면엔 "요청을 보냈어요"인데
    //   큐 0건(미발송)이던 버그. 캠페인 테스트(campaigns.ts:350)와 동일하게 'test'로 통일 — 50자 안에 들어가고
    //   테스트 내역·정산·통계(app_etc1='test' AND app_etc2=회사ID 조회)에도 자동 포함된다.
    //   어느 DM인지는 본문(`[DM 테스트 발송]\n제목\n미리보기:URL`)에 이미 있어 식별 손실 없음.
    const testId = 'test';
    const subject = `[DM 테스트] ${dm.title || ''}`.slice(0, 40);

    // ★ 2026-06-22: 빈 callBack은 발신번호가 없어 실제 발송이 안 됨(테스트 "보냈어요"인데 문자 안옴) → 회사 기본 발신번호 조회(campaigns 테스트발송과 동일 경로).
    const cbRow = await query(`SELECT phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1`, [companyId]);
    const testCallback = cbRow.rows[0]?.phone || '';

    const results: Array<{ phone: string; ok: boolean; error?: string }> = [];
    for (const phone of cleanPhones) {
      try {
        await insertTestSmsQueue(
          phone,
          testCallback,  // 회사 기본 발신번호 (campaigns 테스트발송과 동일; 없으면 Agent fallback)
          body,
          'LMS',       // LMS (본문 + URL 링크) — ★ toQtmsgType는 풀네임을 받음. 옛 'L'은 MMS로 떨궈져 "이미지 필수" 실패.
          testId,
          subject,
          { companyId, billId: userId },
        );
        results.push({ phone, ok: true });
      } catch (e: any) {
        results.push({ phone, ok: false, error: e?.message });
      }
    }

    const sentCount = results.filter((r) => r.ok).length;
    const failedCount = results.filter((r) => !r.ok).length;
    // ★ 2026-06-24: 전건 적재 실패면 200으로 거짓 성공을 주지 않는다(효과 검증 후 성공 표시 — 0611 6원칙).
    //   옛 코드는 per-phone INSERT 오류를 results에 담고도 항상 ok:true/200을 반환해 화면이
    //   "요청을 보냈어요"라고 거짓말했다(이번 버그의 표면 증상). 적재 0건이면 실패 사유를 그대로 노출.
    if (sentCount === 0) {
      const firstErr = results.find((r) => !r.ok)?.error;
      return res.status(500).json({
        ok: false,
        sent: 0,
        failed: failedCount,
        error: firstErr ? `테스트 발송 적재 실패: ${firstErr}` : '테스트 발송에 실패했어요.',
        results,
      });
    }
    return res.json({
      ok: true,
      sent: sentCount,
      failed: failedCount,
      preview_url: url,
      results,
    });
  } catch (err: any) {
    console.error('[DM 테스트발송] 오류:', err.message);
    return res.status(500).json({ error: err.message || '테스트 발송 실패' });
  }
});

// ============================================================
//  버전 관리 + 승인 (D125 §13)
// ============================================================

// GET /api/dm/:id/versions — 버전 목록
dmRouter.get('/:id/versions', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    // ⛔ 버전 API 셋(목록·저장·복원)이 **같은 소유 가드**를 지난다. 둘만 막으면 남은 하나로 같은 내용이 샌다
    //   (목록이 `sections`·`brand_kit`을 그대로 돌려준다). 정책 원천 = 0714 서수란 신고 · `canAccessDm`.
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, req.user?.userId))) {
      return res.status(403).json({ error: '이 DM에 접근할 권한이 없어요.' });
    }
    const versions = await listDmVersions(req.params.id, companyId);
    return res.json({ versions });
  } catch (err: any) {
    console.error('[dm/versions] 목록 조회 실패:', err);
    return res.status(500).json({ error: '버전 목록을 불러오지 못했습니다.' });
  }
});

// POST /api/dm/:id/versions — 새 버전 저장
dmRouter.post('/:id/versions', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    // ⛔ 사용자별 소유 가드(0714 서수란 신고 정책)를 이 라우트만 빠뜨리고 있었다(★Codex 적대 1R high).
    //   회사 격리는 "같은 회사 남의 DM"을 막지 못한다. 저장 응답에 화면 상태가 실리므로 열람 경로이기도 하다.
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, userId))) {
      return res.status(403).json({ error: '이 DM에 접근할 권한이 없어요.' });
    }
    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
    const label = (req.body?.label || `수동저장 ${new Date().toLocaleString('ko-KR')}`) as string;
    const note = (req.body?.note || null) as string | null;
    const sections = extractFlatSectionsFromDm(dm);
    const brandKit = typeof dm.brand_kit === 'string' ? JSON.parse(dm.brand_kit) : (dm.brand_kit || {});
    // ⛔ 화면 상태 전부를 담는다(★2026-08-25 재오픈) — `sections`만 담으면 복원해도 화면이 안 바뀐다.
    //   평탄화한 `sections`는 옛 소비처(diff 표시·옛 번들)를 위해 함께 남긴다.
    const snapshot = buildDmSnapshot(dm);
    const version = await saveDmVersion(req.params.id, label, sections, brandKit, note, userId, snapshot);
    // ⛔ 스냅샷 본문(화면 상태 전부)은 응답에 싣지 않는다 — 화면은 저장 뒤 목록을 다시 불러온다.
    //   `RETURNING *`을 그대로 돌려주면 필요 없는 전체 상태가 매 저장마다 흘러나간다.
    const { snapshot: _omit, sections: _omitSections, brand_kit: _omitBrandKit, ...meta } = version || {};
    return res.json({ version: meta });
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      console.error('[dm/versions] snapshot 컬럼 부재:', err?.message);
      return res.status(503).json(migrationPendingBody('dm_versions.snapshot 컬럼 추가'));
    }
    console.error('[dm/versions] 스냅샷 저장 실패:', err);
    return res.status(500).json({ error: '스냅샷을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
});

// POST /api/dm/:id/versions/:vid/restore — 버전 복원
dmRouter.post('/:id/versions/:vid/restore', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    // ⛔ 복원은 화면 상태를 통째로 덮는 파괴적 동작이다 — 소유 가드를 반드시 지난다(★Codex 적대 1R high).
    if (!(await canAccessDm(req.params.id, companyId, req.user?.userType, req.user?.userId))) {
      return res.status(403).json({ error: '이 DM에 접근할 권한이 없어요.' });
    }
    const restored = await restoreDmVersion(req.params.id, req.params.vid, companyId);
    if (!restored) return res.status(404).json({ error: '버전을 찾을 수 없어요.' });
    // mergedPages = 페이지 경계가 없던 옛 스냅샷이라 한 페이지로 합쳐 되돌렸다(화면이 그대로 알린다)
    return res.json({ dm: restored.dm, mergedPages: restored.mergedPages });
  } catch (err: any) {
    if (isMissingSchemaError(err)) {
      console.error('[dm/versions/restore] snapshot 컬럼 부재:', err?.message);
      return res.status(503).json(migrationPendingBody('dm_versions.snapshot 컬럼 추가'));
    }
    // ⛔ 드라이버·DB 원문을 사용자에게 돌려주지 않는다(★2026-08-24 접수 cmt6qug4s00v1jnotsqeaf12g).
    //   화면에 `invalid input syntax for type json`이 그대로 떴다. 원인은 로그로 남기고 고객에게는 할 일을 준다.
    console.error('[dm/versions/restore] 복원 실패:', err);
    return res.status(500).json({ error: '이 버전으로 되돌리지 못했습니다. 잠시 뒤 다시 시도해 주세요.' });
  }
});

// POST /api/dm/:id/request-approval — 검수 요청 (draft → review)
dmRouter.post('/:id/request-approval', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const updated = await setApprovalStatus(req.params.id, companyId, 'review');
    if (!updated) return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
    return res.json({ dm: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/dm/:id/approve — 승인 (review → approved)
dmRouter.post('/:id/approve', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin' && userType !== 'super_admin') {
      return res.status(403).json({ error: '승인 권한이 없어요 (company_admin 이상).' });
    }
    const updated = await setApprovalStatus(req.params.id, companyId, 'approved');
    if (!updated) return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
    return res.json({ dm: updated });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/dm/:id/reject — 반려 (review → rejected, reason 기록)
dmRouter.post('/:id/reject', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userType = req.user?.userType;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (userType !== 'company_admin' && userType !== 'super_admin') {
      return res.status(403).json({ error: '반려 권한이 없어요 (company_admin 이상).' });
    }
    const _reason: string = (req.body?.reason || '').toString();
    // 반려 사유는 별도 테이블이 없으므로 최근 version에 note로 남기는 방식을 V2로 연기.
    // 현재는 approval_status만 변경.
    const updated = await setApprovalStatus(req.params.id, companyId, 'rejected');
    if (!updated) return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
    return res.json({ dm: updated, reason: _reason });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  브랜드 킷 + 템플릿 (D125 §12)
// ============================================================

// GET /api/dm/brand-kit — 회사 브랜드 킷 조회
dmRouter.get('/brand-kit', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const kit = await getCompanyBrandKit(companyId);
    return res.json({ brand_kit: kit, default: DEFAULT_BRAND_KIT });
  } catch (err: any) {
    console.error('[DM BrandKit GET] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/dm/brand-kit — 회사 브랜드 킷 수정
dmRouter.put('/brand-kit', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const patch = req.body || {};
    const kit = await updateCompanyBrandKit(companyId, patch);
    return res.json({ brand_kit: kit });
  } catch (err: any) {
    console.error('[DM BrandKit PUT] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/dm/industry-codes — 문안 참조 업종 목록 (회사 접근 가능·기본정보 탭 셀렉트용, SSOT=industry-codes.ts)
dmRouter.get('/industry-codes', async (req: any, res: any) => {
  try {
    if (!req.user?.companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    return res.json({ industries: INDUSTRY_CODES.map((code) => ({ code, label: INDUSTRY_LABELS[code] })) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/dm/brand-basic-info — 회사 기본정보 조회 (브랜드 학습 ①기본정보 탭)
dmRouter.get('/brand-basic-info', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const info = await getBrandBasicInfo(companyId);
    return res.json({ basic_info: info });
  } catch (err: any) {
    console.error('[DM BrandBasicInfo GET] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/dm/brand-basic-info — 회사 기본정보 수정 (화이트리스트 컬럼만 부분 업데이트)
dmRouter.put('/brand-basic-info', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const info = await updateBrandBasicInfo(companyId, req.body || {});
    return res.json({ basic_info: info });
  } catch (err: any) {
    console.error('[DM BrandBasicInfo PUT] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/dm/templates — 템플릿 목록 (category/industry 필터)
dmRouter.get('/templates', async (req: any, res: any) => {
  try {
    const category = req.query.category as any;
    const industry = req.query.industry as any;
    const items = listTemplates({ category, industry });
    return res.json({ templates: items });
  } catch (err: any) {
    console.error('[DM Template 목록] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/dm/templates/:id — 템플릿 상세
dmRouter.get('/templates/:id', async (req: any, res: any) => {
  try {
    const t = getTemplate(req.params.id);
    if (!t) return res.status(404).json({ error: '템플릿을 찾을 수 없어요.' });
    return res.json({ template: t });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/dm/from-template — 템플릿 기반 신규 DM 생성
dmRouter.post('/from-template', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const { template_id, title, store_name } = req.body || {};
    const t = getTemplate(template_id);
    if (!t) return res.status(404).json({ error: '템플릿을 찾을 수 없어요.' });

    const companyKit = await getCompanyBrandKit(companyId);
    const instance = instantiateTemplate(t, { title, storeName: store_name, brandKit: companyKit });

    const created = await createDm(companyId, req.user?.userId, {
      title: instance.title,
      store_name: instance.store_name,
      layout_mode: 'scroll',
      sections: instance.sections,
      brand_kit: instance.brand_kit,
      template_id: instance.template_id,
    } as any);

    return res.json({ dm: created });
  } catch (err: any) {
    console.error('[DM from-template] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  검수 엔진 (D125 §10)
// ============================================================

// POST /api/dm/:id/validate — 10영역 자동 검수
dmRouter.post('/:id/validate', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });

    const samples = await selectSampleCustomers(companyId);
    const result = await validateDm(
      {
        sections: extractFlatSectionsFromDm(dm),
        brand_kit: dm.brand_kit,
        scheduled_at: dm.scheduled_at || null,
        publish_mode: (req.body?.publish_mode as 'now' | 'scheduled' | 'approval_required') || 'now',
      },
      { sampleCustomers: samples.map((s) => ({ key: s.key, data: s.data })) },
    );

    // validation_result 컬럼에 저장
    try {
      await query(
        `UPDATE dm_pages SET validation_result = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`,
        [JSON.stringify(result), req.params.id, companyId],
      );
    } catch (e) {
      console.warn('[DM 검수결과 저장] 실패:', (e as any)?.message);
    }

    return res.json(result);
  } catch (err: any) {
    console.error('[DM 검수] 오류:', err.message);
    return res.status(500).json({ error: err.message || '검수 실패' });
  }
});

// POST /api/dm/ai/improve — 전체 섹션 카피 개선 제안
dmRouter.post('/ai/improve', async (req: any, res: any) => {
  try {
    const sections = req.body?.sections as Section[] | undefined;
    const brandKit = req.body?.brand_kit;
    if (!Array.isArray(sections)) return res.status(400).json({ error: 'sections 배열이 필요해요.' });
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const suggestions = await improveMessage(sections, brandKit, companyId);
    return res.json({ suggestions });
  } catch (err: any) {
    console.error('[DM AI improve] 오류:', err.message);
    return res.status(500).json({ error: err.message || 'AI 개선 제안 실패' });
  }
});

// ============================================================
//  브랜드킷 URL 자동추출 (D126 V2)
// ============================================================

// POST /api/dm/brand-kit/extract — URL에서 og:image/favicon/theme-color 추출
dmRouter.post('/brand-kit/extract', async (req: any, res: any) => {
  try {
    const url = (req.body?.url || '').toString().trim();
    if (!url) return res.status(400).json({ error: 'url 필요' });
    const result = await previewBrandExtract(url);
    return res.json(result);
  } catch (err: any) {
    console.error('[DM 브랜드추출] 오류:', err.message);
    return res.status(500).json({ error: err.message || '브랜드 추출 실패' });
  }
});

// ============================================================
//  A/B 테스트 CRUD (D126 V2)
// ============================================================

// GET /api/dm/ab-tests — 목록
dmRouter.get('/ab-tests', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const tests = await listAbTests(companyId);
    return res.json({ tests });
  } catch (err: any) {
    console.error('[AB목록] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/dm/ab-tests — 신규 생성
dmRouter.post('/ab-tests', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });

    const body = req.body || {};
    if (!body.name || !body.variant_a_page_id || !body.variant_b_page_id) {
      return res.status(400).json({ error: 'name / variant_a_page_id / variant_b_page_id 필수' });
    }
    const test = await createAbTest(companyId, req.user?.userId || null, {
      name: body.name,
      description: body.description,
      variant_a_page_id: body.variant_a_page_id,
      variant_b_page_id: body.variant_b_page_id,
      variant_c_page_id: body.variant_c_page_id || null,
      variant_a_weight: body.variant_a_weight,
      variant_b_weight: body.variant_b_weight,
      variant_c_weight: body.variant_c_weight,
      primary_metric: body.primary_metric,
    });
    return res.json({ test });
  } catch (err: any) {
    console.error('[AB생성] 오류:', err.message);
    return res.status(400).json({ error: err.message || '생성 실패' });
  }
});

// GET /api/dm/ab-tests/:id — 상세 + 최신 집계
dmRouter.get('/ab-tests/:id', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const summary = await aggregateResults(req.params.id, companyId);
    if (!summary) return res.status(404).json({ error: '찾을 수 없습니다.' });
    return res.json(summary);
  } catch (err: any) {
    console.error('[AB상세] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// PUT /api/dm/ab-tests/:id — 수정
dmRouter.put('/ab-tests/:id', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const updated = await updateAbTest(req.params.id, companyId, req.body || {});
    if (!updated) return res.status(404).json({ error: '찾을 수 없습니다.' });
    return res.json({ test: updated });
  } catch (err: any) {
    console.error('[AB수정] 오류:', err.message);
    return res.status(400).json({ error: err.message || '수정 실패' });
  }
});

// POST /api/dm/ab-tests/:id/start — 시작 (short_code 발급 + status='running')
dmRouter.post('/ab-tests/:id/start', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const test = await startAbTest(req.params.id, companyId);
    if (!test) return res.status(404).json({ error: '찾을 수 없습니다.' });
    return res.json({ test });
  } catch (err: any) {
    console.error('[AB시작] 오류:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/dm/ab-tests/:id/pause — 일시정지
dmRouter.post('/ab-tests/:id/pause', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const test = await pauseAbTest(req.params.id, companyId);
    if (!test) return res.status(404).json({ error: '실행 중인 테스트가 아닙니다.' });
    return res.json({ test });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/dm/ab-tests/:id/complete — 종료 + result_summary 고정
dmRouter.post('/ab-tests/:id/complete', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const test = await completeAbTest(req.params.id, companyId);
    if (!test) return res.status(404).json({ error: '찾을 수 없습니다.' });
    return res.json({ test });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// DELETE /api/dm/ab-tests/:id
dmRouter.delete('/ab-tests/:id', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const ok = await deleteAbTest(req.params.id, companyId);
    if (!ok) return res.status(404).json({ error: '찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  A/B 테스트 공개 뷰어 (인증 불필요 — dmPublicRouter에 등록)
// ============================================================

// GET /api/dm/v/ab/:code — variant 선택 + 해당 DM 렌더
dmPublicRouter.get('/ab/:code', async (req: Request, res: Response) => {
  try {
    const test = await getAbTestByShortCode(req.params.code);
    if (!test) return res.status(404).send(renderDmErrorHtml('A/B 테스트를 찾을 수 없어요.'));

    // 쿠키 스티키
    const cookieName = `dm_ab_${test.id.replace(/-/g, '')}`;
    const raw = req.headers.cookie || '';
    const match = raw.match(new RegExp(`${cookieName}=(a|b|c)`));
    const existing = match ? (match[1] as AbVariantKey) : undefined;
    const variant = pickVariant(test, existing);

    const pageId = variantToPageId(test, variant);
    if (!pageId) return res.status(404).send(renderDmErrorHtml('선택된 variant DM이 없습니다.'));

    // ★ 2026-08-06 A/B 공개 URL도 발행 상태를 본다(Codex 적대검증 high).
    //   그 전에는 id로만 읽어, 중지한 variant가 이 주소로 계속 노출됐다 — 일반 뷰어만 막고 옆문을 열어 둔 셈이다.
    //   fail-closed: `published`가 아니면 렌더하지 않고, 중지분에만 종료 문구를 준다(없는 문서와 다른 말).
    // ★ 2026-08-06 **회사 조건도 함께 건다**(Codex 2R critical) — 테스트 행의 회사는 이미 손에 있는데
    //   page를 id로만 읽고 있었다. variant에 타사 UUID가 들어가면 이 공개 주소가 그 회사 DM을 그대로 렌더한다.
    //   UUID를 알아야 한다는 조건은 권한 경계가 아니다.
    const dmRes = await query(
      `SELECT * FROM dm_pages WHERE id = $1 AND company_id = $2 AND status = 'published'`,
      [pageId, test.company_id],
    );
    const dm = dmRes.rows[0];
    if (!dm) {
      let stopped = false;
      try { stopped = await isDmStopped(pageId, test.company_id); } catch { /* 기존 문구로 폴백 */ }
      return res.status(404).send(renderDmErrorHtml(stopped ? '종료된 페이지입니다.' : 'DM을 찾을 수 없어요.'));
    }

    // 첫 진입 추적 (variant 정보 함께)
    const phone = (req.query.p as string) || null;
    const ip = req.ip || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;
    const totalPages = extractPagesFromDm(dm).length || 1;
    trackAbTestView(test.id, variant, pageId, dm.company_id, phone, 1, totalPages, 0, ip, ua).catch(() => {});

    // 쿠키 발급 (30일)
    if (!existing) {
      res.setHeader(
        'Set-Cookie',
        `${cookieName}=${variant}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`,
      );
    }

    // ★ 2026-07-02(2) A/B 뷰어도 치환 경로(customer=null) — %고객명% 원문 노출 차단 (동일 패턴 전수 적용)
    let html: string;
    try {
      html = await renderDmViewerHtmlWithCustomer(dm, '/api/dm/v', null, dm.company_id);
    } catch {
      html = renderDmViewerHtml(dm, '/api/dm/v');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error('[AB뷰어] 오류:', err.message);
    res.status(500).send(renderDmErrorHtml('일시적 오류가 발생했습니다.'));
  }
});

// POST /api/dm/v/ab/:code/track — A/B 열람 진행 추적
dmPublicRouter.post('/ab/:code/track', async (req: Request, res: Response) => {
  try {
    const test = await getAbTestByShortCode(req.params.code);
    if (!test) return res.status(404).json({ error: 'Not found' });

    const cookieName = `dm_ab_${test.id.replace(/-/g, '')}`;
    const raw = req.headers.cookie || '';
    const match = raw.match(new RegExp(`${cookieName}=(a|b|c)`));
    const variant: AbVariantKey = match ? (match[1] as AbVariantKey) : 'a';
    const pageId = variantToPageId(test, variant);
    if (!pageId) return res.status(404).json({ error: 'variant page not found' });

    const { phone, page_reached, total_pages, duration } = req.body || {};
    const ip = req.ip || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;

    await trackAbTestView(
      test.id, variant, pageId, test.company_id,
      phone || null,
      page_reached || 1,
      total_pages || 0,
      duration || 0,
      ip, ua,
    );
    return res.json({ ok: true, variant });
  } catch (err: any) {
    console.error('[AB추적] 오류:', err.message);
    return res.status(500).json({ error: 'Internal error' });
  }
});

// ============================================================
//  D216+ 신규 endpoint 8건 — 5 AI 모듈 (CT-86 ~ CT-90) + 통계 + 이벤트 응답
// ============================================================

// POST /api/dm/:id/self-diagnose — CT-86 5 factor 자율 진단
dmRouter.post('/:id/self-diagnose', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const campaignId = req.params.id;
    const result = await selfDiagnoseDm(companyId, campaignId);
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[DM self-diagnose] 오류:', err.message);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_pages ALTER 4 + dm_event_responses CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/dm/:id/quick-action — CT-87 1-click 3 액션
dmRouter.post('/:id/quick-action', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const campaignId = req.params.id;
    const action = req.body?.action as QuickActionType;
    if (!['ai_refine', 'design_align', 'variable_consistency'].includes(action)) {
      return res.status(400).json({ success: false, error: '알 수 없는 액션' });
    }
    const result = await applyQuickAction(companyId, campaignId, action);
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[DM quick-action] 오류:', err.message);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_pages ALTER 4 + dm_event_responses CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/dm/event-recommend — CT-88 이벤트 종류 추천
dmRouter.post('/event-recommend', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const { campaign_goal, target_audience, budget_level } = req.body || {};
    const result = await recommendEventType(companyId, {
      campaign_goal,
      target_audience,
      budget_level,
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[DM event-recommend] 오류:', err.message);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_pages ALTER 4 + dm_event_responses CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dm/:id/section-suggest — CT-89 다음 섹션 추천
dmRouter.get('/:id/section-suggest', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const campaignId = req.params.id;
    const result = await suggestNextSection(companyId, campaignId);
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[DM section-suggest] 오류:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dm/personalization-vars — CT-90 Liquid 변수 자동 추천
dmRouter.get('/personalization-vars', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const section_type = req.query.section_type as string | undefined;
    const current_text = req.query.current_text as string | undefined;
    const result = await getPersonalizationVariables(companyId, { section_type, current_text });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('[DM personalization-vars] 오류:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dm/overview — 회사 전체 5 metric 요약
dmRouter.get('/overview', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });

    // ★ 2026-07-14 "내 DM 현황" 사용자 스코프(서수란 신고): 일반 사용자=본인 생성분만, 관리자=회사 전체.
    const isDmAdmin = req.user?.userType === 'company_admin' || req.user?.userType === 'super_admin';
    const ownerId = isDmAdmin ? null : req.user?.userId;
    const ownerAnd = ownerId ? ' AND created_by = $2' : '';
    const ownerParams: any[] = ownerId ? [companyId, ownerId] : [companyId];
    // dm_views/dm_event_responses는 created_by가 없으므로 본인 DM id 하위질의로 스코프.
    const ownDmSubqView = ownerId ? ` AND dm_id IN (SELECT id FROM dm_pages WHERE company_id = $1 AND created_by = $2)` : '';
    const ownDmSubqResp = ownerId ? ` AND campaign_id IN (SELECT id FROM dm_pages WHERE company_id = $1 AND created_by = $2)` : '';

    // dm_pages 집계 = 핵심(목록과 같은 테이블 — 항상 존재). 실패 시에만 전체 오류.
    const totals = await query(
      `SELECT
        COUNT(*) AS total_dm,
        COUNT(*) FILTER (WHERE status = 'published') AS published_dm
      FROM dm_pages
      WHERE company_id = $1${ownerAnd}`,
      ownerParams,
    );

    // dm_views / dm_event_responses = 부분 실패(테이블 미생성 등) 시 0으로 degrade.
    //   한 테이블이 없어도 전체 endpoint를 500 내지 않고 dm_pages 집계는 살려 화면이 비지 않게 한다.
    let totalViews = 0;
    let uniqueViewers = 0;
    let totalResponses = 0;
    try {
      const views30d = await query(
        `SELECT
          COUNT(*) AS total_views,
          COUNT(DISTINCT phone) FILTER (WHERE phone IS NOT NULL) AS unique_viewers
        FROM dm_views
        WHERE company_id = $1 AND viewed_at >= NOW() - INTERVAL '30 days'${ownDmSubqView}`,
        ownerParams,
      );
      totalViews = Number(views30d.rows[0]?.total_views || 0);
      uniqueViewers = Number(views30d.rows[0]?.unique_viewers || 0);
    } catch (e: any) {
      console.warn('[DM overview] dm_views 집계 skip:', e?.message);
    }
    try {
      const responses30d = await query(
        `SELECT COUNT(*) AS total_responses
        FROM dm_event_responses
        WHERE company_id = $1 AND occurred_at >= NOW() - INTERVAL '30 days'${ownDmSubqResp}`,
        ownerParams,
      );
      totalResponses = Number(responses30d.rows[0]?.total_responses || 0);
    } catch (e: any) {
      console.warn('[DM overview] dm_event_responses 집계 skip:', e?.message);
    }

    const avgCtr = totalViews > 0 ? (totalResponses / totalViews) * 100 : 0;

    return res.json({
      success: true,
      data: {
        total_dm: Number(totals.rows[0]?.total_dm || 0),
        published_dm: Number(totals.rows[0]?.published_dm || 0),
        total_views_30d: totalViews,
        unique_viewers_30d: uniqueViewers,
        total_responses_30d: totalResponses,
        avg_ctr_30d: Number(avgCtr.toFixed(2)),
      },
    });
  } catch (err: any) {
    console.error('[DM overview] 오류:', err.message);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_pages ALTER');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/dm/top-campaigns — Top CTR DM 10
dmRouter.get('/top-campaigns', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const limit = Math.min(Number(req.query.limit) || 10, 50);
    // ★ 2026-07-14 사용자 스코프(서수란 신고): 관리자=회사 전체, 일반 사용자=본인 생성 DM만.
    const isDmAdmin = req.user?.userType === 'company_admin' || req.user?.userType === 'super_admin';
    const ownerId = isDmAdmin ? null : req.user?.userId;
    const ownerAnd = ownerId ? ' AND dp.created_by = $3' : '';
    const tcParams: any[] = ownerId ? [companyId, limit, ownerId] : [companyId, limit];

    const result = await query(
      `SELECT
        dp.id,
        dp.title,
        dp.approval_status,
        COUNT(DISTINCT dv.id) AS view_count,
        COUNT(DISTINCT der.id) AS interaction_count,
        CASE WHEN COUNT(DISTINCT dv.id) > 0
          THEN ROUND((COUNT(DISTINCT der.id)::numeric / COUNT(DISTINCT dv.id)) * 100, 2)
          ELSE 0
        END AS ctr
      FROM dm_pages dp
      LEFT JOIN dm_views dv ON dv.dm_id = dp.id AND dv.viewed_at >= NOW() - INTERVAL '30 days'
      LEFT JOIN dm_event_responses der ON der.campaign_id = dp.id AND der.occurred_at >= NOW() - INTERVAL '30 days'
      WHERE dp.company_id = $1${ownerAnd}
      GROUP BY dp.id, dp.title, dp.approval_status
      HAVING COUNT(DISTINCT dv.id) > 0
      ORDER BY ctr DESC, view_count DESC
      LIMIT $2`,
      tcParams,
    );

    return res.json({ success: true, data: result.rows });
  } catch (err: any) {
    console.error('[DM top-campaigns] 오류:', err.message);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_event_responses CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/dm/v/:code/event-response — 인터랙션 참여 제출(공개): 동의·식별·중복·룰렛 즉시 추첨
dmPublicRouter.post('/:code/event-response', async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const body = req.body || {};
    const sectionId = body.section_id;
    const sectionType = body.section_type;
    if (!sectionId || !sectionType) {
      return res.status(400).json({ success: false, error: 'section_id / section_type 필수' });
    }
    // 식별 우선순위: 토큰(body.r — 발송 링크, 서버 권위) > phone(?p= 쿼리/body — 구 링크 하위호환).
    // customer_id는 클라 신뢰 X.
    const phone = (req.query.p as string) || body.phone || null;
    const result = await submitEventResponse({
      code,
      sectionId,
      sectionType,
      data: body.data ?? body.response_data ?? {},
      anonymousId: body.anonymous_id || null,
      token: typeof body.r === 'string' && body.r ? String(body.r).slice(0, 32) : null,
      phone,
      ip: req.ip || null,
      ua: (req.headers['user-agent'] as string) || null,
    });
    if (!result.ok) {
      return res.status(result.status || 400).json({ success: false, error: result.error });
    }
    return res.json({ success: true, already: result.already || false, result: result.result ?? null });
  } catch (err: any) {
    console.error('[DM event-response] 오류:', err.message);
    if (isDbMigrationPendingError(err)) {
      return send503Migration(res, 'dm_prizes / dm_winners / dm_draw_runs CREATE');
    }
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
//  인터랙션 결과 — 회사 admin 조회·다운로드·사전지정·경품 (B / 2026-06-14)
// ════════════════════════════════════════════════════════════

const dmXlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

/** dm 소유 검증 (companyId 격리) */
async function assertDmOwner(dmId: string, companyId: string): Promise<boolean> {
  const r = await query(`SELECT 1 FROM dm_pages WHERE id = $1 AND company_id = $2`, [dmId, companyId]);
  return r.rows.length > 0;
}

function handleInteractionError(res: any, err: any): void {
  console.error('[DM interaction] 오류:', err.message);
  if (isDbMigrationPendingError(err)) {
    send503Migration(res, 'dm_prizes / dm_winners / dm_draw_runs CREATE');
    return;
  }
  res.status(500).json({ error: err.message });
}

// GET /api/dm/:id/responses?page=&limit= — 응모자 명단
dmRouter.get('/:id/responses', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await assertDmOwner(req.params.id, companyId))) return res.status(404).json({ error: 'DM 미발견' });
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 50;
    return res.json(await getResponses(companyId, req.params.id, page, limit));
  } catch (err: any) {
    return handleInteractionError(res, err);
  }
});

// GET /api/dm/:id/winners — 당첨자 명단
dmRouter.get('/:id/winners', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await assertDmOwner(req.params.id, companyId))) return res.status(404).json({ error: 'DM 미발견' });
    return res.json(await getWinners(companyId, req.params.id));
  } catch (err: any) {
    return handleInteractionError(res, err);
  }
});

// GET /api/dm/:id/event-stats — 응모·당첨·열람 집계 (열람 통계 /:id/stats와 별개)
dmRouter.get('/:id/event-stats', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await assertDmOwner(req.params.id, companyId))) return res.status(404).json({ error: 'DM 미발견' });
    return res.json(await getResponseStats(companyId, req.params.id));
  } catch (err: any) {
    return handleInteractionError(res, err);
  }
});

// GET /api/dm/:id/event-insight — 결과 분석 (응모·당첨·열람 실측 기반 인사이트, 임의 상수 0)
dmRouter.get('/:id/event-insight', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await assertDmOwner(req.params.id, companyId))) return res.status(404).json({ error: 'DM 미발견' });
    const stats = await getResponseStats(companyId, req.params.id);
    return res.json(buildEventInsight(stats));
  } catch (err: any) {
    return handleInteractionError(res, err);
  }
});

// GET /api/dm/:id/responses/export — 응모자 xlsx 다운로드 (전체, 페이지 루프 — 무 silent 절단)
dmRouter.get('/:id/responses/export', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await assertDmOwner(req.params.id, companyId))) return res.status(404).json({ error: 'DM 미발견' });
    const out: any[] = [];
    let page = 1;
    for (;;) {
      const chunk = await getResponses(companyId, req.params.id, page, 500);
      out.push(...chunk.rows);
      if (out.length >= chunk.total || chunk.rows.length === 0) break;
      page++;
    }
    const winners = await getWinners(companyId, req.params.id);
    const rows = buildResponseExportRows(out, winners);
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '응모자');
    const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="dm-responses-${req.params.id}.xlsx"`);
    return res.send(buffer);
  } catch (err: any) {
    return handleInteractionError(res, err);
  }
});

// POST /api/dm/:id/winners/import — 엑셀 사전 지정 당첨자 업로드
dmRouter.post('/:id/winners/import', dmXlsxUpload.single('file'), async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await assertDmOwner(req.params.id, companyId))) return res.status(404).json({ error: 'DM 미발견' });
    if (!req.file) return res.status(400).json({ error: '엑셀 파일이 필요합니다.' });
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(sheet) as any[];
    const { winners, errors } = parseWinnerRows(json);
    const sectionId = (req.body?.section_id as string) || null;
    const { inserted, linked } = await importPresetWinners(companyId, req.params.id, sectionId, winners);
    return res.json({ success: true, inserted, linked, parse_errors: errors });
  } catch (err: any) {
    return handleInteractionError(res, err);
  }
});

// PUT /api/dm/:id/prizes — 경품 설정(A editor·발행 공용). body: { section_id, prizes:[{rank,name,total_count,win_method,roulette_segment_id?}] }
dmRouter.put('/:id/prizes', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    if (!(await assertDmOwner(req.params.id, companyId))) return res.status(404).json({ error: 'DM 미발견' });
    const sectionId = req.body?.section_id;
    if (!sectionId) return res.status(400).json({ error: 'section_id 필수' });
    const prizes = Array.isArray(req.body?.prizes) ? req.body.prizes : [];
    await replacePrizesForSection(companyId, req.params.id, sectionId, prizes);
    return res.json({ success: true, count: prizes.length });
  } catch (err: any) {
    return handleInteractionError(res, err);
  }
});
