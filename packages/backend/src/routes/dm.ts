/**
 * dm.ts — 모바일 DM 빌더 라우트
 *
 * 마운트:
 *   공개: /api/dm/v  (뷰어 + 추적 — helmet 전 마운트)
 *   인증: /api/dm    (CRUD + 이미지 — 한줄로 authenticate)
 *
 * 한줄로 AI 프로 요금제 이상.
 */

import { Request, Response, Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../config/database';
import { authenticate } from '../middlewares/auth';
import {
  createDm, updateDm, deleteDm, getDmList, getDmDetail, getDmByCode, cloneDm,
  publishDm, trackDmView, getDmStats,
  saveDmVersion, listDmVersions, restoreDmVersion, setApprovalStatus,
  extractFlatSectionsFromDm, extractPagesFromDm,
} from '../utils/dm/dm-builder';
import { renderDmViewerHtml, renderDmViewerHtmlWithCustomer, renderDmErrorHtml } from '../utils/dm/dm-viewer';
import {
  parsePrompt, recommendLayout, generateCopy, transformTone, improveMessage,
  oneShotGenerate,
  type CampaignSpec, type ToneKey,
} from '../utils/dm/dm-ai';
import { checkCredit, deductCreditSafe, InsufficientCreditError } from '../utils/ai-credit';
import { getCreditCost } from '../utils/ai-credit-calc';
import { runInCreditBundle } from '../utils/ai-credit-context';
import type { Section } from '../utils/dm/dm-section-registry';
import { selectSampleCustomers, selectSampleCustomerByKey, type SampleCustomerKey } from '../utils/dm/dm-sample-customer';
import { lookupDmRecipientToken, issueDmRecipientTokensBulk } from '../utils/dm/dm-recipient-token';
import { buildCustomerFilter } from '../utils/customer-filter';
import { buildChannelEligibilityWhere } from '../utils/channel-eligibility';
import { createDirectSendCampaign, countStagingFiltered } from '../utils/direct-send-core';
import { DirectSendError } from '../utils/direct-send-spec';
import { getOpt080Number } from '../utils/messageUtils';
import { getAvailableVariables } from '../utils/dm/dm-variable-resolver';
import { validateDm } from '../utils/dm/dm-validate';
import { getCompanyBrandKit, updateCompanyBrandKit, DEFAULT_BRAND_KIT } from '../utils/dm/dm-brand-kit';
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
    error: `DB 마이그레이션 필요 — 운영자에게 ${requiredAlter} 실행 요청 의무`,
    code: 'DB_MIGRATION_PENDING',
  });
}

const DM_IMAGE_DIR = path.join(process.cwd(), 'uploads', 'dm-images');

// ============================================================
//  공개 라우터 (인증 불필요 — app.ts에서 helmet 전 마운트)
// ============================================================

export const dmPublicRouter = Router();

// DM 이미지 서빙
dmPublicRouter.get('/images/:companyId/:filename', (req: Request, res: Response) => {
  const { companyId, filename } = req.params;
  const filePath = path.join(DM_IMAGE_DIR, companyId, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// DM 뷰어 — 공개 페이지
dmPublicRouter.get('/:code', async (req: Request, res: Response) => {
  try {
    const dm = await getDmByCode(req.params.code);
    if (!dm) return res.status(404).send(renderDmErrorHtml('존재하지 않는 DM입니다.'));

    // 초기 추적 (phone 파라미터가 있으면)
    const phone = (req.query.p as string) || null;
    const pages = Array.isArray(dm.pages) ? dm.pages : JSON.parse(dm.pages || '[]');
    const ip = req.ip || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;
    trackDmView(dm.id, dm.company_id, phone, 1, pages.length, 0, ip, ua).catch(() => {});

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
            // 수신자별 추적 — 토큰의 고객 phone으로 열람 기록(추적 페이지가 수신자별 액션 집계)
            trackDmView(dm.id, dm.company_id, custR.rows[0].phone || null, 1, pages.length, 0, ip, ua).catch(() => {});
            const personalizedHtml = await renderDmViewerHtmlWithCustomer(dm, '/api/dm/v', custR.rows[0], dm.company_id);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.send(personalizedHtml);
          }
        }
      } catch {
        // 토큰 조회 실패(예: 테이블 미마이그레이션) = 공용 렌더로 안전 폴백
      }
    }

    const html = renderDmViewerHtml(dm, '/api/dm/v');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (err: any) {
    console.error('[DM뷰어] 오류:', err.message);
    res.status(500).send(renderDmErrorHtml('일시적 오류가 발생했습니다.'));
  }
});

// 열람 추적 API
dmPublicRouter.post('/:code/track', async (req: Request, res: Response) => {
  try {
    const dm = await getDmByCode(req.params.code);
    if (!dm) return res.status(404).json({ error: 'Not found' });

    const { phone, page_reached, total_pages, duration } = req.body;
    const ip = req.ip || req.socket?.remoteAddress || null;
    const ua = req.headers['user-agent'] || null;

    await trackDmView(
      dm.id, dm.company_id,
      phone || null,
      page_reached || 1,
      total_pages || 0,
      duration || 0,
      ip, ua
    );
    res.json({ ok: true });
  } catch (err: any) {
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
    const list = await getDmList(companyId);
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

// GET /api/dm/:id — 상세
dmRouter.get('/:id', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json(dm);
  } catch (err: any) {
    console.error('[DM상세] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// PUT /api/dm/:id — 수정
dmRouter.put('/:id', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const updated = await updateDm(req.params.id, companyId, req.body);
    if (!updated) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json(updated);
  } catch (err: any) {
    console.error('[DM수정] 오류:', err.message);
    return res.status(500).json({ error: '서버 오류' });
  }
});

// DELETE /api/dm/:id — 삭제
dmRouter.delete('/:id', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
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
    // ★ B 연계: lucky_draw/roulette 경품 설정 → dm_prizes 동기화 (실패해도 발행은 유지)
    try { await syncPrizesFromSections(companyId, req.params.id); }
    catch (e: any) { console.error('[DM발행] 경품 동기화 오류:', e?.message); }
    if (firstPublish) {
      await deductCreditSafe({
        companyId, cost: pubCost, source: costSource, createdBy: req.user?.userId,
        idempotencyKey: `dm-publish:${req.params.id}`,
      });
    }
    return res.json({
      short_code: result.short_code,
      // ★ 2026-06-22: hanjul-flyer.kr는 한줄전단 제품 도메인 — 한줄로 DM은 거기서 "전단지를 찾을 수 없"으로 404.
      //   동작하는 한줄로 viewer(테스트발송 링크와 동일 베이스 /api/dm/v)로 발행. getDmByCode가 dm- 접두사 제거해 조회.
      short_url: `${process.env.HANJUL_BASE_URL || 'https://hanjul.ai'}/api/dm/v/dm-${result.short_code}`,
    });
  } catch (err: any) {
    if (err instanceof InsufficientCreditError) {
      return res.status(402).json({ error: err.message, code: 'INSUFFICIENT_CREDIT' });
    }
    console.error('[DM발행] 오류:', err.message);
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

    if (!prompt && !scenario) {
      return res.status(400).json({ error: 'prompt 또는 scenario 영역 필요' });
    }
    if (prompt.length > 2000) {
      return res.status(400).json({ error: '프롬프트는 2000자 이내로 입력해주세요.' });
    }

    // ★ 종량제: DM 생성(돌려보기) = 3크레딧 묶음 (내부 parse/copy/tone은 집계만, 차감 0). 발행 시 30 별도.
    const genCost = getCreditCost('dm-ai-generate');  // 3
    await checkCredit(companyId, genCost);
    const result = await runInCreditBundle(async () => {
      const r = await oneShotGenerate({ prompt, scenario, brandName, companyId });
      await deductCreditSafe({ companyId, cost: genCost, source: 'dm-ai-generate', createdBy: req.user?.userId });
      return r;
    });
    return res.json({
      success: true,
      data: {
        sections: result.sections,
        pages: result.pages,
        layout_mode: result.layoutMode,
        brand_kit: result.brandKit,
        spec: result.spec,
        scenario: result.scenario,
      },
    });
  } catch (err: any) {
    console.error('[DM AI one-shot-generate] 오류:', err.message);
    return res.status(500).json({ success: false, error: err.message || 'AI 통합 생성 실패' });
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
    const sections = recommendLayout(spec);
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

    const { filter, messageText, isAd, scheduledAt } = req.body as {
      filter?: Record<string, { operator: string; value: any }>;
      messageText?: string;
      isAd?: boolean;
      scheduledAt?: string | null;
    };
    if (!filter || typeof filter !== 'object' || Object.keys(filter).length === 0) {
      return res.status(400).json({ error: '발송 대상 조건이 필요합니다.' });
    }
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

    // 발신번호 (회사 기본 등록 번호)
    const cbRes = await query(
      `SELECT REPLACE(phone, '-', '') AS phone FROM callback_numbers WHERE company_id = $1 AND is_default = true LIMIT 1`,
      [companyId],
    );
    const callback = cbRes.rows[0]?.phone || null;
    if (!callback) return res.status(400).json({ error: '등록된 발신번호가 없습니다. 발신번호 등록 후 발송해주세요.', code: 'NO_CALLBACK' });

    // 발송 대상 resolve — DM 채널 자격(전화 유효·수신거부/무효 아님·활성) + filter. phone 중복 제거.
    const { sql: filterSql, params: filterParams } = buildCustomerFilter(filter, {
      tableAlias: 'c', startParamIndex: 2, storeCodeMode: 'skip', inputFormat: 'structured',
    });
    const dmWhere = buildChannelEligibilityWhere('dm', 'c');
    const recRes = await query(
      `SELECT DISTINCT ON (c.phone) c.id, c.phone, c.name
         FROM customers c
        WHERE c.company_id = $1::uuid AND (${dmWhere})${filterSql}
        ORDER BY c.phone, c.id`,
      [companyId, ...filterParams],
    );
    const recipients = recRes.rows;
    if (recipients.length === 0) return res.status(400).json({ error: '발송 대상이 0명입니다. 조건을 조정해주세요.', code: 'ZERO_MATCH' });

    // 수신자별 토큰 발급(벌크) + 링크 구성
    let tokenPairs: Array<{ customerId: string; token: string }>;
    try {
      tokenPairs = await issueDmRecipientTokensBulk(dm.id, companyId, recipients.map((r: any) => String(r.id)), 30);
    } catch (e: any) {
      const msg = e?.message || '';
      if (msg.includes('relation') && msg.includes('does not exist')) {
        return res.status(503).json({ error: 'DB 마이그레이션 필요 — 운영자에게 dm_recipient_tokens 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
      }
      throw e;
    }
    const tokenByCust: Record<string, string> = {};
    for (const p of tokenPairs) tokenByCust[p.customerId] = p.token;
    const baseUrl = process.env.HANJUL_BASE_URL || 'https://hanjul.ai';

    // staging 적재 — phone + name(%고객명%) + extra1(수신자별 DM 링크 %기타1%)
    const stagingId = uuidv4();
    const phones = recipients.map((r: any) => String(r.phone || '').replace(/\D/g, ''));
    const names = recipients.map((r: any) => (r.name ?? null));
    const links = recipients.map((r: any) => `${baseUrl}/api/dm/v/dm-${shortCode}?r=${tokenByCust[String(r.id)] || ''}`);
    await query(
      `INSERT INTO campaign_send_staging (staging_id, company_id, phone, name, extra1)
       SELECT $1::uuid, $2::uuid, u.phone, u.name, u.extra1
         FROM UNNEST($3::text[], $4::text[], $5::text[]) AS u(phone, name, extra1)`,
      [stagingId, companyId, phones, names, links],
    );

    // 정제 후 실제 발송 수(중복·수신거부 제외) — 커밋과 동일 기준으로 과금 정확
    const { sendCount } = await countStagingFiltered(stagingId, companyId, userId, true, true);
    if (sendCount === 0) {
      await query(`DELETE FROM campaign_send_staging WHERE staging_id = $1`, [stagingId]);
      return res.status(400).json({ error: '수신 가능한 대상이 0명입니다(수신거부 제외 후).', code: 'ZERO_MATCH' });
    }

    // 본문 = 사용자 문구 + 수신자별 링크. %DM링크% 위치에 링크(없으면 끝에 첨부). 수신자별 = %기타1%.
    const bodyText = messageText.trim();
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
          callback,
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
      throw e;
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

    const r = await query(
      `SELECT DISTINCT ON (t.customer_id)
              t.customer_id, c.name, c.phone, t.created_at AS sent_at,
              v.page_reached, v.total_pages, v.duration_seconds, v.viewed_at, v.last_active_at
         FROM dm_recipient_tokens t
         JOIN customers c ON c.id = t.customer_id AND c.company_id = t.company_id
         LEFT JOIN LATERAL (
           SELECT page_reached, total_pages, duration_seconds, viewed_at, last_active_at
             FROM dm_views dv
            WHERE dv.dm_id = t.dm_id AND dv.phone = c.phone
            ORDER BY dv.viewed_at DESC LIMIT 1
         ) v ON true
        WHERE t.dm_id = $1::uuid AND t.company_id = $2::uuid
        ORDER BY t.customer_id, t.created_at DESC
        LIMIT 1000`,
      [req.params.id, companyId],
    );

    const recipients = r.rows.map((row: any) => {
      const viewed = !!row.viewed_at;
      const totalPages = Number(row.total_pages || 0);
      const pageReached = Number(row.page_reached || 0);
      return {
        customerId: row.customer_id,
        name: row.name || null,
        phone: row.phone || null,
        sentAt: row.sent_at,
        viewed,
        pageReached,
        totalPages,
        completed: viewed && totalPages > 0 && pageReached >= totalPages,
        durationSeconds: Number(row.duration_seconds || 0),
        lastActiveAt: row.last_active_at || null,
      };
    });

    const summary = {
      sent: recipients.length,
      viewed: recipients.filter((x) => x.viewed).length,
      completed: recipients.filter((x) => x.completed).length,
    };

    return res.json({ success: true, summary, recipients });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return res.status(503).json({ error: 'DB 마이그레이션 필요 — dm_recipient_tokens 테이블 생성 요청', code: 'DB_MIGRATION_PENDING' });
    }
    console.error('[DM 발송 추적] 오류:', err?.message);
    return res.status(500).json({ error: err?.message || '추적 조회 실패' });
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

    let dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });

    // short_code 없으면 자동 발행 (테스트용 링크 생성)
    if (!dm.short_code) {
      await publishDm(req.params.id, companyId);
      dm = await getDmDetail(req.params.id, companyId);
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
    const versions = await listDmVersions(req.params.id, companyId);
    return res.json({ versions });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/dm/:id/versions — 새 버전 저장
dmRouter.post('/:id/versions', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.userId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const dm = await getDmDetail(req.params.id, companyId);
    if (!dm) return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
    const label = (req.body?.label || `수동저장 ${new Date().toLocaleString('ko-KR')}`) as string;
    const note = (req.body?.note || null) as string | null;
    const sections = extractFlatSectionsFromDm(dm);
    const brandKit = typeof dm.brand_kit === 'string' ? JSON.parse(dm.brand_kit) : (dm.brand_kit || {});
    const version = await saveDmVersion(req.params.id, label, sections, brandKit, note, userId);
    return res.json({ version });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/dm/:id/versions/:vid/restore — 버전 복원
dmRouter.post('/:id/versions/:vid/restore', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const restored = await restoreDmVersion(req.params.id, req.params.vid, companyId);
    if (!restored) return res.status(404).json({ error: '버전을 찾을 수 없어요.' });
    return res.json({ dm: restored });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
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

    const dmRes = await query(`SELECT * FROM dm_pages WHERE id = $1`, [pageId]);
    const dm = dmRes.rows[0];
    if (!dm) return res.status(404).send(renderDmErrorHtml('DM을 찾을 수 없어요.'));

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

    const html = renderDmViewerHtml(dm, '/api/dm/v');
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

    // dm_pages 집계 = 핵심(목록과 같은 테이블 — 항상 존재). 실패 시에만 전체 오류.
    const totals = await query(
      `SELECT
        COUNT(*) AS total_dm,
        COUNT(*) FILTER (WHERE status = 'published') AS published_dm
      FROM dm_pages
      WHERE company_id = $1`,
      [companyId],
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
        WHERE company_id = $1 AND viewed_at >= NOW() - INTERVAL '30 days'`,
        [companyId],
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
        WHERE company_id = $1 AND occurred_at >= NOW() - INTERVAL '30 days'`,
        [companyId],
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
      WHERE dp.company_id = $1
      GROUP BY dp.id, dp.title, dp.approval_status
      HAVING COUNT(DISTINCT dv.id) > 0
      ORDER BY ctr DESC, view_count DESC
      LIMIT $2`,
      [companyId, limit],
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
    // phone = ?p= 쿼리 우선(발송 링크), 없으면 body.phone. customer_id는 클라 신뢰 X(서버 phone 매칭이 권위).
    const phone = (req.query.p as string) || body.phone || null;
    const result = await submitEventResponse({
      code,
      sectionId,
      sectionType,
      data: body.data ?? body.response_data ?? {},
      anonymousId: body.anonymous_id || null,
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
