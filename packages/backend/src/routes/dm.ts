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
  createDm, updateDm, deleteDm, getDmList, getDmDetail, getDmByCode,
  publishDm, trackDmView, getDmStats,
  saveDmVersion, listDmVersions, restoreDmVersion, setApprovalStatus,
  extractFlatSectionsFromDm, extractPagesFromDm,
} from '../utils/dm/dm-builder';
import { renderDmViewerHtml, renderDmViewerHtmlWithCustomer, renderDmErrorHtml } from '../utils/dm/dm-viewer';
import {
  parsePrompt, recommendLayout, generateCopy, transformTone, improveMessage,
  type CampaignSpec, type ToneKey,
} from '../utils/dm/dm-ai';
import type { Section } from '../utils/dm/dm-section-registry';
import { selectSampleCustomers, selectSampleCustomerByKey, type SampleCustomerKey } from '../utils/dm/dm-sample-customer';
import { getAvailableVariables } from '../utils/dm/dm-variable-resolver';
import { validateDm } from '../utils/dm/dm-validate';
import { getCompanyBrandKit, updateCompanyBrandKit, DEFAULT_BRAND_KIT } from '../utils/dm/dm-brand-kit';
import { listTemplates, getTemplate, instantiateTemplate } from '../utils/dm/dm-template-registry';
import { insertTestSmsQueue } from '../utils/sms-queue';
import { sanitizeSmsText } from '../utils/auto-notify-message';
import { convertLegacyToSections } from '../utils/dm/dm-legacy-converter';
import { previewBrandExtract } from '../utils/dm/dm-brand-kit';
import {
  createAbTest, getAbTest, getAbTestByShortCode, listAbTests, updateAbTest,
  deleteAbTest, startAbTest, pauseAbTest, completeAbTest, aggregateResults,
  pickVariant, variantToPageId, trackAbTestView,
  type AbVariantKey,
} from '../utils/dm/dm-ab-test';

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

// 이미지 업로드 (2MB, JPG/PNG/WebP)
const dmImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 5 },
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
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '파일 크기는 2MB 이하만 가능합니다.' });
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
        url: `/api/flyer/p/dm-images/${companyId}/${filename}`,
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

  const m = url.match(/\/api\/dm\/images\/([^/]+)\/([^/]+)$/);
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

// POST /api/dm/:id/publish — 발행
dmRouter.post('/:id/publish', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const result = await publishDm(req.params.id, companyId);
    if (!result) return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
    return res.json({
      short_code: result.short_code,
      short_url: `https://hanjul-flyer.kr/dm-${result.short_code}`,
    });
  } catch (err: any) {
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

// POST /api/dm/ai/parse-prompt — 자연어 → CampaignSpec
dmRouter.post('/ai/parse-prompt', async (req: any, res: any) => {
  try {
    const prompt: string = (req.body?.prompt || '').toString().trim();
    if (!prompt) return res.status(400).json({ error: '프롬프트가 비어있어요.' });
    if (prompt.length > 2000) return res.status(400).json({ error: '프롬프트는 2000자 이내로 입력해주세요.' });
    const spec = await parsePrompt(prompt);
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
    const copy = await generateCopy(spec, section);
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
    const result = await transformTone(text, targetTone);
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
    const userId = req.user?.id;
    if (!companyId) return res.status(403).json({ error: '회사 권한이 필요합니다.' });

    const phones: string[] = Array.isArray(req.body?.manager_phones) ? req.body.manager_phones : [];
    const cleanPhones = phones.map((p) => String(p).replace(/[^0-9]/g, '')).filter((p) => p.length >= 10 && p.length <= 11);
    if (cleanPhones.length === 0) return res.status(400).json({ error: '담당자 번호가 비어있거나 유효하지 않아요.' });
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

    const testId = `dm-test-${req.params.id}-${Date.now()}`;
    const subject = `[DM 테스트] ${dm.title || ''}`.slice(0, 40);

    const results: Array<{ phone: string; ok: boolean; error?: string }> = [];
    for (const phone of cleanPhones) {
      try {
        await insertTestSmsQueue(
          phone,
          '',          // callBack — 회사 기본 발신번호 사용 (선택적; 빈 문자열이면 Agent가 처리)
          body,
          'L',         // LMS (본문 + URL 길이 고려)
          testId,
          subject,
          { companyId, billId: userId },
        );
        results.push({ phone, ok: true });
      } catch (e: any) {
        results.push({ phone, ok: false, error: e?.message });
      }
    }

    return res.json({
      ok: true,
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
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
    const userId = req.user?.id;
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

    const created = await createDm(companyId, req.user?.id, {
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
    const suggestions = await improveMessage(sections, brandKit);
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
    const test = await createAbTest(companyId, req.user?.id || null, {
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
