/**
 * ★ 행사 캠페인 API (2026-07-08)
 *
 * 1) POST /api/event-campaigns/extract-image — 업로드 이미지(스샷) → 행사 내용 텍스트 (vision 판독, 3크레딧 성공 시 차감)
 * 2) 생성 초안 DB 임시 보관 (소멸 방지) — 3채널 생성 세트를 계정에 보관하고 재개:
 *    POST   /api/event-campaigns/drafts            — 세트 생성
 *    PATCH  /api/event-campaigns/drafts/:id         — 채널 payload/상태/제목 갱신
 *    GET    /api/event-campaigns/drafts             — 활성 세트 목록(최근 30일) — 재개용
 *    GET    /api/event-campaigns/drafts/:id         — 세트 1건
 *    POST   /api/event-campaigns/drafts/:id/archive — 보관 종료(status='archived')
 *
 * 발송·정산 테이블은 건드리지 않는다 — 생성 payload JSON만 별도 테이블(event_campaign_drafts)에 보관.
 * 신규 테이블 미생성(배포 순간) = handleDbMigrationError 503(DB_MIGRATION_PENDING).
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { authenticate } from '../middlewares/auth';
import { resolveOwnerScope } from '../utils/owner-scope';
import { query } from '../config/database';
import { normalizeEventText } from '../utils/event-brief';
import { extractEventsFromImages, MAX_EVENT_IMAGES } from '../utils/event-image-extract';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { InsufficientCreditError } from '../utils/ai-credit';
// ★ 2026-09-06 S5 재료 입구(사본 저장 · 텍스트 비었을 때만 판독 · 견적)
import { requirePlanFeature } from '../utils/plan-guard';
import { saveMaterialImages, extractMaterialsText, quoteQuickCampaign, quickPlanLocked, quickMaterialsEnabled, QUICK_MATERIALS_MAX_IMAGES } from '../utils/campaign-quick';

export const eventCampaignRouter = Router();
eventCampaignRouter.use(authenticate);

const CHANNEL_KEYS = new Set(['dm', 'email', 'inapp']);
const DRAFT_STATUS = new Set(['active', 'archived']);
const SOURCE_KINDS = new Set(['text', 'image']);

// 이미지 업로드 — dm.ts dmImageUpload 미러(메모리 저장, 5MB×5장, jpg/png/webp)
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: MAX_EVENT_IMAGES },
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    if (['image/jpeg', 'image/png', 'image/webp'].includes(mime)) cb(null, true);
    else cb(new Error('JPG, PNG, WebP 이미지만 업로드 가능합니다.'));
  },
});

// ─────────────────────────────────────────────────────────────────────
// 1. POST /extract-image — 이미지 → 행사 내용 텍스트
// ─────────────────────────────────────────────────────────────────────
eventCampaignRouter.post('/extract-image', (req: any, res: Response) => {
  imageUpload.array('images', MAX_EVENT_IMAGES)(req, res, async (uploadErr: any) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, error: uploadErr.message || '이미지 업로드 오류' });
    }
    try {
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
      const files = (req.files as Express.Multer.File[]) || [];
      if (!files.length) return res.status(400).json({ success: false, error: '이미지를 1장 이상 올려주세요.' });
      const images = files.map((f) => ({ media_type: f.mimetype, data: f.buffer.toString('base64') }));
      // ★ 2026-07-19 구조화 판독 — event_text(산문·기존 소비처 호환) + events(구조 — DM 디터미니스틱 조립용)
      const { events, eventText } = await extractEventsFromImages({ images, companyId, userId: req.user?.userId });
      return res.json({ success: true, event_text: eventText, events });
    } catch (err: any) {
      if (err instanceof InsufficientCreditError) {
        return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
      }
      if (err?.name === 'AiRateLimitExceeded') {
        return res.status(429).json({ success: false, error: err.message });
      }
      console.error('[event-campaigns extract-image] 오류:', err?.message);
      return res.status(500).json({ success: false, error: err?.message || '이미지 판독 실패' });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// ★ 2026-09-06 S5 재료 입구 — GET /materials/quote(견적 · 노출 스위치 · 요금제 잠금) · POST /materials(사본 저장 + 텍스트 비었을 때만 판독)
// ─────────────────────────────────────────────────────────────────────
eventCampaignRouter.get('/materials/quote', async (req: any, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const imageCount = Math.max(0, Math.min(QUICK_MATERIALS_MAX_IMAGES, Number(req.query?.images) || 0));
    const hasText = String(req.query?.has_text || '') === '1';
    const quote = quoteQuickCampaign({ imageCount, hasText });
    return res.json({ success: true, enabled: quickMaterialsEnabled(companyId), plan_locked: await quickPlanLocked(companyId), max_images: QUICK_MATERIALS_MAX_IMAGES, ...quote });
  } catch (err: any) {
    console.error('[event-campaigns materials/quote] 오류:', err?.message);
    return res.status(500).json({ success: false, error: '견적을 계산하지 못했습니다.' });
  }
});

eventCampaignRouter.post('/materials', requirePlanFeature('mobile_dm'), (req: any, res: Response) => {
  imageUpload.array('images', MAX_EVENT_IMAGES)(req, res, async (uploadErr: any) => {
    if (uploadErr) return res.status(400).json({ success: false, error: uploadErr.message || '이미지 업로드 오류' });
    try {
      const companyId = req.user?.companyId;
      if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
      if (!quickMaterialsEnabled(companyId)) return res.status(403).json({ success: false, error: '이 기능은 아직 열리지 않았습니다.' });
      const files = (req.files as Express.Multer.File[]) || [];
      const eventText = normalizeEventText(req.body?.event_text);
      if (!files.length && !eventText) return res.status(400).json({ success: false, error: '이미지 1장 이상 또는 행사 내용을 입력해주세요.' });
      const images = saveMaterialImages(companyId, files);
      let text = eventText;
      let events: unknown[] | null = null;
      let extracted = false;
      if (!eventText && files.length) {
        // 텍스트가 비었을 때만 판독(3크레딧 · 성공 시만 · 판독 함수가 차감) — 판독본은 origin 'vision'(면허 아님)
        const r = await extractMaterialsText({ companyId, userId: req.user?.userId, files });
        text = r.eventText; events = r.events; extracted = true;
      }
      return res.json({ success: true, images, event_text: text, events, extracted });
    } catch (err: any) {
      if (err instanceof InsufficientCreditError) return res.status(402).json({ success: false, error: err.message, code: 'INSUFFICIENT_CREDIT' });
      if (err?.name === 'AiRateLimitExceeded') return res.status(429).json({ success: false, error: err.message });
      console.error('[event-campaigns materials] 오류:', err?.message);
      return res.status(500).json({ success: false, error: '재료를 저장하지 못했습니다. 잠시 후 다시 시도해주세요.' });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
// 2. 생성 초안 DB 임시 보관
// ─────────────────────────────────────────────────────────────────────

/** 행사 원문 첫 줄에서 제목 파생 (최대 60자) */
function deriveTitle(eventText: string): string {
  const first = String(eventText || '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) || '행사 캠페인';
  return first.slice(0, 60);
}

// POST /drafts — 세트 생성
eventCampaignRouter.post('/drafts', async (req: any, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const eventText = normalizeEventText(req.body?.event_text);
    const sourceKind = SOURCE_KINDS.has(req.body?.source_kind) ? req.body.source_kind : 'text';
    const channels = req.body?.channels && typeof req.body.channels === 'object' ? req.body.channels : {};
    const title = (typeof req.body?.title === 'string' && req.body.title.trim()) ? req.body.title.trim().slice(0, 120) : deriveTitle(eventText);

    const r = await query(
      `INSERT INTO event_campaign_drafts (company_id, created_by, title, event_text, source_kind, channels)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
       RETURNING id`,
      [companyId, req.user?.userId || null, title, eventText, sourceKind, JSON.stringify(channels)],
    );
    return res.json({ success: true, id: r.rows[0].id });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'event_campaign_drafts')) return;
    console.error('[event-campaigns POST /drafts] 오류:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || '초안 보관 실패' });
  }
});

// PATCH /drafts/:id — 채널 payload/상태/제목 갱신
eventCampaignRouter.patch('/drafts/:id', async (req: any, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const id = String(req.params.id || '');

    const sets: string[] = ['updated_at = NOW()'];
    const vals: any[] = [];
    let n = 1;

    const channel = req.body?.channel;
    if (channel !== undefined) {
      if (!CHANNEL_KEYS.has(channel)) return res.status(400).json({ success: false, error: '알 수 없는 채널입니다.' });
      const channelData = req.body?.channel_data ?? {};
      // 한 채널만 병합 — 나머지 채널 payload 보존 (jsonb ||)
      sets.push(`channels = channels || jsonb_build_object($${n}::text, $${n + 1}::jsonb)`);
      vals.push(channel, JSON.stringify(channelData));
      n += 2;
    }
    if (typeof req.body?.title === 'string') { sets.push(`title = $${n}`); vals.push(req.body.title.slice(0, 120)); n += 1; }
    if (typeof req.body?.event_text === 'string') { sets.push(`event_text = $${n}`); vals.push(normalizeEventText(req.body.event_text)); n += 1; }
    if (DRAFT_STATUS.has(req.body?.status)) { sets.push(`status = $${n}`); vals.push(req.body.status); n += 1; }

    const ownerId = resolveOwnerScope(req);
    const idParam = n; const compParam = n + 1;
    vals.push(id, companyId);
    const ownerClause = ownerId ? ` AND created_by = $${n + 2}::uuid` : '';
    if (ownerId) vals.push(ownerId);
    const r = await query(
      `UPDATE event_campaign_drafts SET ${sets.join(', ')}
       WHERE id = $${idParam}::uuid AND company_id = $${compParam}::uuid${ownerClause}
       RETURNING id`,
      vals,
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: '초안을 찾을 수 없습니다.' });
    return res.json({ success: true, id: r.rows[0].id });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'event_campaign_drafts')) return;
    console.error('[event-campaigns PATCH /drafts] 오류:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || '초안 갱신 실패' });
  }
});

// GET /drafts — 활성 세트 목록 (최근 30일, 재개용)
eventCampaignRouter.get('/drafts', async (req: any, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    // ★ 생성물 격리 — 담당자=본인 초안만, 관리자=회사 전체.
    const ownerId = resolveOwnerScope(req);
    const ownerClause = ownerId ? ' AND created_by = $2::uuid' : '';
    const params: any[] = [companyId];
    if (ownerId) params.push(ownerId);
    const r = await query(
      `SELECT id, title, event_text, source_kind, channels, status, created_at, updated_at
       FROM event_campaign_drafts
       WHERE company_id = $1::uuid AND status = 'active' AND updated_at > NOW() - INTERVAL '30 days'${ownerClause}
       ORDER BY updated_at DESC
       LIMIT 50`,
      params,
    );
    return res.json({ success: true, drafts: r.rows });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'event_campaign_drafts')) return;
    console.error('[event-campaigns GET /drafts] 오류:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || '초안 목록 조회 실패' });
  }
});

// GET /drafts/:id — 세트 1건
eventCampaignRouter.get('/drafts/:id', async (req: any, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const ownerId = resolveOwnerScope(req);
    const ownerClause = ownerId ? ' AND created_by = $3::uuid' : '';
    const params: any[] = [String(req.params.id || ''), companyId];
    if (ownerId) params.push(ownerId);
    const r = await query(
      `SELECT id, title, event_text, source_kind, channels, status, created_at, updated_at
       FROM event_campaign_drafts
       WHERE id = $1::uuid AND company_id = $2::uuid${ownerClause}`,
      params,
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: '초안을 찾을 수 없습니다.' });
    return res.json({ success: true, draft: r.rows[0] });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'event_campaign_drafts')) return;
    console.error('[event-campaigns GET /drafts/:id] 오류:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || '초안 조회 실패' });
  }
});

// POST /drafts/:id/archive — 보관 종료
eventCampaignRouter.post('/drafts/:id/archive', async (req: any, res: Response) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const ownerId = resolveOwnerScope(req);
    const ownerClause = ownerId ? ' AND created_by = $3::uuid' : '';
    const params: any[] = [String(req.params.id || ''), companyId];
    if (ownerId) params.push(ownerId);
    const r = await query(
      `UPDATE event_campaign_drafts SET status = 'archived', updated_at = NOW()
       WHERE id = $1::uuid AND company_id = $2::uuid${ownerClause}
       RETURNING id`,
      params,
    );
    if (!r.rows.length) return res.status(404).json({ success: false, error: '초안을 찾을 수 없습니다.' });
    return res.json({ success: true });
  } catch (err: any) {
    if (handleDbMigrationError(err, res, 'event_campaign_drafts')) return;
    console.error('[event-campaigns POST /drafts/:id/archive] 오류:', err?.message);
    return res.status(500).json({ success: false, error: err?.message || '보관 종료 실패' });
  }
});
