"use strict";
/**
 * dm.ts — 모바일 DM 빌더 라우트
 *
 * 마운트:
 *   공개: /api/dm/v  (뷰어 + 추적 — helmet 전 마운트)
 *   인증: /api/dm    (CRUD + 이미지 — 한줄로 authenticate)
 *
 * 한줄로 AI 프로 요금제 이상.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dmRouter = exports.dmPublicRouter = void 0;
const express_1 = require("express");
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const multer_1 = __importDefault(require("multer"));
const uuid_1 = require("uuid");
const database_1 = require("../config/database");
const auth_1 = require("../middlewares/auth");
const dm_builder_1 = require("../utils/dm/dm-builder");
const dm_viewer_1 = require("../utils/dm/dm-viewer");
const dm_ai_1 = require("../utils/dm/dm-ai");
const dm_sample_customer_1 = require("../utils/dm/dm-sample-customer");
const dm_variable_resolver_1 = require("../utils/dm/dm-variable-resolver");
const dm_validate_1 = require("../utils/dm/dm-validate");
const dm_brand_kit_1 = require("../utils/dm/dm-brand-kit");
const dm_template_registry_1 = require("../utils/dm/dm-template-registry");
const sms_queue_1 = require("../utils/sms-queue");
const auto_notify_message_1 = require("../utils/auto-notify-message");
const dm_legacy_converter_1 = require("../utils/dm/dm-legacy-converter");
const dm_brand_kit_2 = require("../utils/dm/dm-brand-kit");
const dm_ab_test_1 = require("../utils/dm/dm-ab-test");
// ★ CT-17: 모바일 DM 빌더는 PRO 이상만 사용 가능
const plan_guard_1 = require("../utils/plan-guard");
const DM_IMAGE_DIR = path_1.default.join(process.cwd(), 'uploads', 'dm-images');
// ============================================================
//  공개 라우터 (인증 불필요 — app.ts에서 helmet 전 마운트)
// ============================================================
exports.dmPublicRouter = (0, express_1.Router)();
// DM 이미지 서빙
exports.dmPublicRouter.get('/images/:companyId/:filename', (req, res) => {
    const { companyId, filename } = req.params;
    const filePath = path_1.default.join(DM_IMAGE_DIR, companyId, filename);
    if (!fs_1.default.existsSync(filePath))
        return res.status(404).send('Not found');
    res.sendFile(filePath);
});
// DM 뷰어 — 공개 페이지
exports.dmPublicRouter.get('/:code', async (req, res) => {
    try {
        const dm = await (0, dm_builder_1.getDmByCode)(req.params.code);
        if (!dm)
            return res.status(404).send((0, dm_viewer_1.renderDmErrorHtml)('존재하지 않는 DM입니다.'));
        // 초기 추적 (phone 파라미터가 있으면)
        const phone = req.query.p || null;
        const pages = Array.isArray(dm.pages) ? dm.pages : JSON.parse(dm.pages || '[]');
        const ip = req.ip || req.socket?.remoteAddress || null;
        const ua = req.headers['user-agent'] || null;
        (0, dm_builder_1.trackDmView)(dm.id, dm.company_id, phone, 1, pages.length, 0, ip, ua).catch(() => { });
        const html = (0, dm_viewer_1.renderDmViewerHtml)(dm, '/api/dm/v');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    }
    catch (err) {
        console.error('[DM뷰어] 오류:', err.message);
        res.status(500).send((0, dm_viewer_1.renderDmErrorHtml)('일시적 오류가 발생했습니다.'));
    }
});
// 열람 추적 API
exports.dmPublicRouter.post('/:code/track', async (req, res) => {
    try {
        const dm = await (0, dm_builder_1.getDmByCode)(req.params.code);
        if (!dm)
            return res.status(404).json({ error: 'Not found' });
        const { phone, page_reached, total_pages, duration } = req.body;
        const ip = req.ip || req.socket?.remoteAddress || null;
        const ua = req.headers['user-agent'] || null;
        await (0, dm_builder_1.trackDmView)(dm.id, dm.company_id, phone || null, page_reached || 1, total_pages || 0, duration || 0, ip, ua);
        res.json({ ok: true });
    }
    catch (err) {
        console.error('[DM추적] 오류:', err.message);
        res.status(500).json({ error: 'Internal error' });
    }
});
// ============================================================
//  인증 라우터 (한줄로 authenticate)
// ============================================================
exports.dmRouter = (0, express_1.Router)();
exports.dmRouter.use(auth_1.authenticate);
// ★ CT-17: mobile_dm 요금제 게이팅 (PRO+) — 인증 직후 전 라우트 적용
exports.dmRouter.use((0, plan_guard_1.requirePlanFeature)('mobile_dm'));
// 이미지 업로드 (2MB, JPG/PNG/WebP)
const dmImageUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 5 },
    fileFilter: (_req, file, cb) => {
        const ext = path_1.default.extname(file.originalname).toLowerCase();
        const mime = file.mimetype.toLowerCase();
        const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
        const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
        if (allowed.includes(ext) && allowedMime.includes(mime)) {
            cb(null, true);
        }
        else {
            cb(new Error('JPG, PNG, WebP 파일만 업로드 가능합니다.'));
        }
    },
});
// POST /api/dm/upload-image
exports.dmRouter.post('/upload-image', (req, res) => {
    const upload = dmImageUpload.array('images', 5);
    upload(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE')
                return res.status(400).json({ error: '파일 크기는 2MB 이하만 가능합니다.' });
            return res.status(400).json({ error: err.message || '업로드 실패' });
        }
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const files = req.files;
        if (!files || files.length === 0)
            return res.status(400).json({ error: '파일이 없습니다.' });
        const companyDir = path_1.default.join(DM_IMAGE_DIR, companyId);
        if (!fs_1.default.existsSync(companyDir))
            fs_1.default.mkdirSync(companyDir, { recursive: true });
        const results = [];
        for (const file of files) {
            const ext = path_1.default.extname(file.originalname).toLowerCase() || '.jpg';
            const filename = `${(0, uuid_1.v4)()}${ext}`;
            const filePath = path_1.default.join(companyDir, filename);
            fs_1.default.writeFileSync(filePath, file.buffer);
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
exports.dmRouter.delete('/delete-image', (req, res) => {
    const companyId = req.user?.companyId;
    if (!companyId)
        return res.status(403).json({ error: '회사 권한이 필요합니다.' });
    const { url } = req.body;
    if (!url)
        return res.status(400).json({ error: 'url 필요' });
    const m = url.match(/\/api\/dm\/images\/([^/]+)\/([^/]+)$/);
    if (!m || m[1] !== companyId)
        return res.status(403).json({ error: '접근 권한 없음' });
    const filePath = path_1.default.join(DM_IMAGE_DIR, m[1], m[2]);
    if (fs_1.default.existsSync(filePath))
        fs_1.default.unlinkSync(filePath);
    return res.json({ success: true });
});
// GET /api/dm — 목록
exports.dmRouter.get('/', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const list = await (0, dm_builder_1.getDmList)(companyId);
        return res.json(list);
    }
    catch (err) {
        console.error('[DM목록] 오류:', err.message);
        return res.status(500).json({ error: '서버 오류' });
    }
});
// POST /api/dm — 생성
exports.dmRouter.post('/', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.userId;
        if (!companyId || !userId)
            return res.status(403).json({ error: '권한이 필요합니다.' });
        if (!req.body.title?.trim())
            return res.status(400).json({ error: '제목을 입력해주세요.' });
        const dm = await (0, dm_builder_1.createDm)(companyId, userId, req.body);
        return res.json(dm);
    }
    catch (err) {
        console.error('[DM생성] 오류:', err.message);
        return res.status(500).json({ error: '서버 오류' });
    }
});
// GET /api/dm/:id — 상세
exports.dmRouter.get('/:id', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const dm = await (0, dm_builder_1.getDmDetail)(req.params.id, companyId);
        if (!dm)
            return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
        return res.json(dm);
    }
    catch (err) {
        console.error('[DM상세] 오류:', err.message);
        return res.status(500).json({ error: '서버 오류' });
    }
});
// PUT /api/dm/:id — 수정
exports.dmRouter.put('/:id', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const updated = await (0, dm_builder_1.updateDm)(req.params.id, companyId, req.body);
        if (!updated)
            return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
        return res.json(updated);
    }
    catch (err) {
        console.error('[DM수정] 오류:', err.message);
        return res.status(500).json({ error: '서버 오류' });
    }
});
// DELETE /api/dm/:id — 삭제
exports.dmRouter.delete('/:id', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const ok = await (0, dm_builder_1.deleteDm)(req.params.id, companyId);
        if (!ok)
            return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
        return res.json({ success: true });
    }
    catch (err) {
        console.error('[DM삭제] 오류:', err.message);
        return res.status(500).json({ error: '서버 오류' });
    }
});
// POST /api/dm/:id/publish — 발행
exports.dmRouter.post('/:id/publish', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const result = await (0, dm_builder_1.publishDm)(req.params.id, companyId);
        if (!result)
            return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
        return res.json({
            short_code: result.short_code,
            short_url: `https://hanjul-flyer.kr/dm-${result.short_code}`,
        });
    }
    catch (err) {
        console.error('[DM발행] 오류:', err.message);
        return res.status(500).json({ error: '서버 오류' });
    }
});
// GET /api/dm/:id/stats — 통계
exports.dmRouter.get('/:id/stats', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const stats = await (0, dm_builder_1.getDmStats)(req.params.id, companyId);
        return res.json(stats);
    }
    catch (err) {
        console.error('[DM통계] 오류:', err.message);
        return res.status(500).json({ error: '서버 오류' });
    }
});
// ============================================================
//  AI 엔진 5종 (D125 §9)
// ============================================================
// POST /api/dm/ai/parse-prompt — 자연어 → CampaignSpec
exports.dmRouter.post('/ai/parse-prompt', async (req, res) => {
    try {
        const prompt = (req.body?.prompt || '').toString().trim();
        if (!prompt)
            return res.status(400).json({ error: '프롬프트가 비어있어요.' });
        if (prompt.length > 2000)
            return res.status(400).json({ error: '프롬프트는 2000자 이내로 입력해주세요.' });
        const spec = await (0, dm_ai_1.parsePrompt)(prompt);
        return res.json({ spec });
    }
    catch (err) {
        console.error('[DM AI parse-prompt] 오류:', err.message);
        return res.status(500).json({ error: err.message || 'AI 파싱 실패' });
    }
});
// POST /api/dm/ai/recommend-layout — CampaignSpec → Section[]
exports.dmRouter.post('/ai/recommend-layout', async (req, res) => {
    try {
        const spec = req.body?.spec;
        if (!spec || typeof spec !== 'object')
            return res.status(400).json({ error: 'spec이 필요해요.' });
        const sections = (0, dm_ai_1.recommendLayout)(spec);
        return res.json({ sections });
    }
    catch (err) {
        console.error('[DM AI recommend-layout] 오류:', err.message);
        return res.status(500).json({ error: err.message || 'AI 레이아웃 추천 실패' });
    }
});
// POST /api/dm/ai/generate-copy — 섹션별 카피 3안
exports.dmRouter.post('/ai/generate-copy', async (req, res) => {
    try {
        const spec = req.body?.spec;
        const section = req.body?.section;
        if (!spec || !section)
            return res.status(400).json({ error: 'spec + section이 필요해요.' });
        const copy = await (0, dm_ai_1.generateCopy)(spec, section);
        return res.json({ copy });
    }
    catch (err) {
        console.error('[DM AI generate-copy] 오류:', err.message);
        return res.status(500).json({ error: err.message || 'AI 카피 생성 실패' });
    }
});
// POST /api/dm/ai/transform-tone — 톤 변환
exports.dmRouter.post('/ai/transform-tone', async (req, res) => {
    try {
        const text = (req.body?.text || '').toString();
        const targetTone = (req.body?.target_tone || 'friendly');
        if (!text.trim())
            return res.status(400).json({ error: '원문이 비어있어요.' });
        if (text.length > 500)
            return res.status(400).json({ error: '500자 이내로 입력해주세요.' });
        const result = await (0, dm_ai_1.transformTone)(text, targetTone);
        return res.json({ text: result });
    }
    catch (err) {
        console.error('[DM AI transform-tone] 오류:', err.message);
        return res.status(500).json({ error: err.message || 'AI 톤 변환 실패' });
    }
});
// ============================================================
//  개인화 변수 + 샘플 렌더링 (D125 §11)
// ============================================================
// GET /api/dm/variables — 회사별 사용 가능 변수 목록
exports.dmRouter.get('/variables', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const variables = await (0, dm_variable_resolver_1.getAvailableVariables)(companyId);
        return res.json({ variables });
    }
    catch (err) {
        console.error('[DM 변수목록] 오류:', err.message);
        return res.status(500).json({ error: err.message || '변수 목록 로드 실패' });
    }
});
// GET /api/dm/sample-customers — 샘플 고객 3종 (VIP/신규/Empty)
exports.dmRouter.get('/sample-customers', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const samples = await (0, dm_sample_customer_1.selectSampleCustomers)(companyId);
        return res.json({ samples });
    }
    catch (err) {
        console.error('[DM 샘플고객] 오류:', err.message);
        return res.status(500).json({ error: err.message || '샘플 로드 실패' });
    }
});
// POST /api/dm/:id/render-sample — 샘플 고객 기준 뷰어 HTML 렌더링
exports.dmRouter.post('/:id/render-sample', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const sampleKey = (req.body?.sample_key || 'vip');
        const dm = await (0, dm_builder_1.getDmDetail)(req.params.id, companyId);
        if (!dm)
            return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
        const sample = await (0, dm_sample_customer_1.selectSampleCustomerByKey)(companyId, sampleKey);
        const html = await (0, dm_viewer_1.renderDmViewerHtmlWithCustomer)(dm, '/api/dm/v', sample.data, companyId);
        return res.json({
            sample: { key: sample.key, label: sample.label, description: sample.description },
            html,
        });
    }
    catch (err) {
        console.error('[DM 샘플렌더] 오류:', err.message);
        return res.status(500).json({ error: err.message || '렌더링 실패' });
    }
});
// ============================================================
//  레거시 → 섹션 변환 (D125 §15)
// ============================================================
// POST /api/dm/:id/convert-to-scroll — slides 모드 DM을 sections 모드로 변환
exports.dmRouter.post('/:id/convert-to-scroll', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const dm = await (0, dm_builder_1.getDmDetail)(req.params.id, companyId);
        if (!dm)
            return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
        if (dm.layout_mode === 'scroll')
            return res.status(400).json({ error: '이미 섹션 모드예요.' });
        const { sections } = (0, dm_legacy_converter_1.convertLegacyToSections)({
            title: dm.title,
            header_template: dm.header_template,
            footer_template: dm.footer_template,
            header_data: dm.header_data,
            footer_data: dm.footer_data,
            pages: dm.pages,
        });
        // D128: 변환 결과를 단일 페이지로 감싸서 저장 (향후 페이지 분할 편집 가능)
        const convertedPages = [{ id: 'p-converted', sections }];
        const updated = await (0, dm_builder_1.updateDm)(req.params.id, companyId, {
            layout_mode: 'scroll',
            sections,
            pages: convertedPages,
            approval_status: 'draft',
        });
        return res.json({ dm: updated, converted_sections: sections.length });
    }
    catch (err) {
        console.error('[DM 레거시변환] 오류:', err.message);
        return res.status(500).json({ error: err.message || '변환 실패' });
    }
});
// ============================================================
//  테스트 발송 (D125 §14)
// ============================================================
// POST /api/dm/:id/test-send — 담당자 번호로 테스트 SMS + DM 링크
exports.dmRouter.post('/:id/test-send', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.id;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const phones = Array.isArray(req.body?.manager_phones) ? req.body.manager_phones : [];
        const cleanPhones = phones.map((p) => String(p).replace(/[^0-9]/g, '')).filter((p) => p.length >= 10 && p.length <= 11);
        if (cleanPhones.length === 0)
            return res.status(400).json({ error: '담당자 번호가 비어있거나 유효하지 않아요.' });
        if (cleanPhones.length > 5)
            return res.status(400).json({ error: '테스트 발송은 최대 5명까지예요.' });
        const sampleKey = (req.body?.sample_key || 'vip');
        let dm = await (0, dm_builder_1.getDmDetail)(req.params.id, companyId);
        if (!dm)
            return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
        // short_code 없으면 자동 발행 (테스트용 링크 생성)
        if (!dm.short_code) {
            await (0, dm_builder_1.publishDm)(req.params.id, companyId);
            dm = await (0, dm_builder_1.getDmDetail)(req.params.id, companyId);
        }
        const baseUrl = process.env.HANJUL_BASE_URL || 'https://hanjul.ai';
        const url = `${baseUrl}/api/dm/v/dm-${dm.short_code}?p=test&s=${sampleKey}`;
        const sampleLabel = sampleKey === 'vip' ? 'VIP 샘플' : sampleKey === 'newbie' ? '신규 샘플' : '데이터없음';
        const body = (0, auto_notify_message_1.sanitizeSmsText)(`[DM 테스트 발송]\n${dm.title || '(제목 없음)'}\n\n미리보기: ${url}\n\n- 샘플: ${sampleLabel}\n- 발송 시각: ${new Date().toLocaleString('ko-KR')}`);
        const testId = `dm-test-${req.params.id}-${Date.now()}`;
        const subject = `[DM 테스트] ${dm.title || ''}`.slice(0, 40);
        const results = [];
        for (const phone of cleanPhones) {
            try {
                await (0, sms_queue_1.insertTestSmsQueue)(phone, '', // callBack — 회사 기본 발신번호 사용 (선택적; 빈 문자열이면 Agent가 처리)
                body, 'L', // LMS (본문 + URL 길이 고려)
                testId, subject, { companyId, billId: userId });
                results.push({ phone, ok: true });
            }
            catch (e) {
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
    }
    catch (err) {
        console.error('[DM 테스트발송] 오류:', err.message);
        return res.status(500).json({ error: err.message || '테스트 발송 실패' });
    }
});
// ============================================================
//  버전 관리 + 승인 (D125 §13)
// ============================================================
// GET /api/dm/:id/versions — 버전 목록
exports.dmRouter.get('/:id/versions', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const versions = await (0, dm_builder_1.listDmVersions)(req.params.id, companyId);
        return res.json({ versions });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/dm/:id/versions — 새 버전 저장
exports.dmRouter.post('/:id/versions', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        const userId = req.user?.id;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const dm = await (0, dm_builder_1.getDmDetail)(req.params.id, companyId);
        if (!dm)
            return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
        const label = (req.body?.label || `수동저장 ${new Date().toLocaleString('ko-KR')}`);
        const note = (req.body?.note || null);
        const sections = (0, dm_builder_1.extractFlatSectionsFromDm)(dm);
        const brandKit = typeof dm.brand_kit === 'string' ? JSON.parse(dm.brand_kit) : (dm.brand_kit || {});
        const version = await (0, dm_builder_1.saveDmVersion)(req.params.id, label, sections, brandKit, note, userId);
        return res.json({ version });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/dm/:id/versions/:vid/restore — 버전 복원
exports.dmRouter.post('/:id/versions/:vid/restore', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const restored = await (0, dm_builder_1.restoreDmVersion)(req.params.id, req.params.vid, companyId);
        if (!restored)
            return res.status(404).json({ error: '버전을 찾을 수 없어요.' });
        return res.json({ dm: restored });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/dm/:id/request-approval — 검수 요청 (draft → review)
exports.dmRouter.post('/:id/request-approval', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const updated = await (0, dm_builder_1.setApprovalStatus)(req.params.id, companyId, 'review');
        if (!updated)
            return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
        return res.json({ dm: updated });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/dm/:id/approve — 승인 (review → approved)
exports.dmRouter.post('/:id/approve', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        const userType = req.user?.userType;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        if (userType !== 'company_admin' && userType !== 'super_admin') {
            return res.status(403).json({ error: '승인 권한이 없어요 (company_admin 이상).' });
        }
        const updated = await (0, dm_builder_1.setApprovalStatus)(req.params.id, companyId, 'approved');
        if (!updated)
            return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
        return res.json({ dm: updated });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/dm/:id/reject — 반려 (review → rejected, reason 기록)
exports.dmRouter.post('/:id/reject', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        const userType = req.user?.userType;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        if (userType !== 'company_admin' && userType !== 'super_admin') {
            return res.status(403).json({ error: '반려 권한이 없어요 (company_admin 이상).' });
        }
        const _reason = (req.body?.reason || '').toString();
        // 반려 사유는 별도 테이블이 없으므로 최근 version에 note로 남기는 방식을 V2로 연기.
        // 현재는 approval_status만 변경.
        const updated = await (0, dm_builder_1.setApprovalStatus)(req.params.id, companyId, 'rejected');
        if (!updated)
            return res.status(404).json({ error: 'DM을 찾을 수 없어요.' });
        return res.json({ dm: updated, reason: _reason });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// ============================================================
//  브랜드 킷 + 템플릿 (D125 §12)
// ============================================================
// GET /api/dm/brand-kit — 회사 브랜드 킷 조회
exports.dmRouter.get('/brand-kit', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const kit = await (0, dm_brand_kit_1.getCompanyBrandKit)(companyId);
        return res.json({ brand_kit: kit, default: dm_brand_kit_1.DEFAULT_BRAND_KIT });
    }
    catch (err) {
        console.error('[DM BrandKit GET] 오류:', err.message);
        return res.status(500).json({ error: err.message });
    }
});
// PUT /api/dm/brand-kit — 회사 브랜드 킷 수정
exports.dmRouter.put('/brand-kit', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const patch = req.body || {};
        const kit = await (0, dm_brand_kit_1.updateCompanyBrandKit)(companyId, patch);
        return res.json({ brand_kit: kit });
    }
    catch (err) {
        console.error('[DM BrandKit PUT] 오류:', err.message);
        return res.status(500).json({ error: err.message });
    }
});
// GET /api/dm/templates — 템플릿 목록 (category/industry 필터)
exports.dmRouter.get('/templates', async (req, res) => {
    try {
        const category = req.query.category;
        const industry = req.query.industry;
        const items = (0, dm_template_registry_1.listTemplates)({ category, industry });
        return res.json({ templates: items });
    }
    catch (err) {
        console.error('[DM Template 목록] 오류:', err.message);
        return res.status(500).json({ error: err.message });
    }
});
// GET /api/dm/templates/:id — 템플릿 상세
exports.dmRouter.get('/templates/:id', async (req, res) => {
    try {
        const t = (0, dm_template_registry_1.getTemplate)(req.params.id);
        if (!t)
            return res.status(404).json({ error: '템플릿을 찾을 수 없어요.' });
        return res.json({ template: t });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/dm/from-template — 템플릿 기반 신규 DM 생성
exports.dmRouter.post('/from-template', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const { template_id, title, store_name } = req.body || {};
        const t = (0, dm_template_registry_1.getTemplate)(template_id);
        if (!t)
            return res.status(404).json({ error: '템플릿을 찾을 수 없어요.' });
        const companyKit = await (0, dm_brand_kit_1.getCompanyBrandKit)(companyId);
        const instance = (0, dm_template_registry_1.instantiateTemplate)(t, { title, storeName: store_name, brandKit: companyKit });
        const created = await (0, dm_builder_1.createDm)(companyId, req.user?.id, {
            title: instance.title,
            store_name: instance.store_name,
            layout_mode: 'scroll',
            sections: instance.sections,
            brand_kit: instance.brand_kit,
            template_id: instance.template_id,
        });
        return res.json({ dm: created });
    }
    catch (err) {
        console.error('[DM from-template] 오류:', err.message);
        return res.status(500).json({ error: err.message });
    }
});
// ============================================================
//  검수 엔진 (D125 §10)
// ============================================================
// POST /api/dm/:id/validate — 10영역 자동 검수
exports.dmRouter.post('/:id/validate', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const dm = await (0, dm_builder_1.getDmDetail)(req.params.id, companyId);
        if (!dm)
            return res.status(404).json({ error: 'DM을 찾을 수 없습니다.' });
        const samples = await (0, dm_sample_customer_1.selectSampleCustomers)(companyId);
        const result = await (0, dm_validate_1.validateDm)({
            sections: (0, dm_builder_1.extractFlatSectionsFromDm)(dm),
            brand_kit: dm.brand_kit,
            scheduled_at: dm.scheduled_at || null,
            publish_mode: req.body?.publish_mode || 'now',
        }, { sampleCustomers: samples.map((s) => ({ key: s.key, data: s.data })) });
        // validation_result 컬럼에 저장
        try {
            await (0, database_1.query)(`UPDATE dm_pages SET validation_result = $1, updated_at = NOW() WHERE id = $2 AND company_id = $3`, [JSON.stringify(result), req.params.id, companyId]);
        }
        catch (e) {
            console.warn('[DM 검수결과 저장] 실패:', e?.message);
        }
        return res.json(result);
    }
    catch (err) {
        console.error('[DM 검수] 오류:', err.message);
        return res.status(500).json({ error: err.message || '검수 실패' });
    }
});
// POST /api/dm/ai/improve — 전체 섹션 카피 개선 제안
exports.dmRouter.post('/ai/improve', async (req, res) => {
    try {
        const sections = req.body?.sections;
        const brandKit = req.body?.brand_kit;
        if (!Array.isArray(sections))
            return res.status(400).json({ error: 'sections 배열이 필요해요.' });
        const suggestions = await (0, dm_ai_1.improveMessage)(sections, brandKit);
        return res.json({ suggestions });
    }
    catch (err) {
        console.error('[DM AI improve] 오류:', err.message);
        return res.status(500).json({ error: err.message || 'AI 개선 제안 실패' });
    }
});
// ============================================================
//  브랜드킷 URL 자동추출 (D126 V2)
// ============================================================
// POST /api/dm/brand-kit/extract — URL에서 og:image/favicon/theme-color 추출
exports.dmRouter.post('/brand-kit/extract', async (req, res) => {
    try {
        const url = (req.body?.url || '').toString().trim();
        if (!url)
            return res.status(400).json({ error: 'url 필요' });
        const result = await (0, dm_brand_kit_2.previewBrandExtract)(url);
        return res.json(result);
    }
    catch (err) {
        console.error('[DM 브랜드추출] 오류:', err.message);
        return res.status(500).json({ error: err.message || '브랜드 추출 실패' });
    }
});
// ============================================================
//  A/B 테스트 CRUD (D126 V2)
// ============================================================
// GET /api/dm/ab-tests — 목록
exports.dmRouter.get('/ab-tests', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const tests = await (0, dm_ab_test_1.listAbTests)(companyId);
        return res.json({ tests });
    }
    catch (err) {
        console.error('[AB목록] 오류:', err.message);
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/dm/ab-tests — 신규 생성
exports.dmRouter.post('/ab-tests', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const body = req.body || {};
        if (!body.name || !body.variant_a_page_id || !body.variant_b_page_id) {
            return res.status(400).json({ error: 'name / variant_a_page_id / variant_b_page_id 필수' });
        }
        const test = await (0, dm_ab_test_1.createAbTest)(companyId, req.user?.id || null, {
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
    }
    catch (err) {
        console.error('[AB생성] 오류:', err.message);
        return res.status(400).json({ error: err.message || '생성 실패' });
    }
});
// GET /api/dm/ab-tests/:id — 상세 + 최신 집계
exports.dmRouter.get('/ab-tests/:id', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const summary = await (0, dm_ab_test_1.aggregateResults)(req.params.id, companyId);
        if (!summary)
            return res.status(404).json({ error: '찾을 수 없습니다.' });
        return res.json(summary);
    }
    catch (err) {
        console.error('[AB상세] 오류:', err.message);
        return res.status(500).json({ error: err.message });
    }
});
// PUT /api/dm/ab-tests/:id — 수정
exports.dmRouter.put('/ab-tests/:id', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const updated = await (0, dm_ab_test_1.updateAbTest)(req.params.id, companyId, req.body || {});
        if (!updated)
            return res.status(404).json({ error: '찾을 수 없습니다.' });
        return res.json({ test: updated });
    }
    catch (err) {
        console.error('[AB수정] 오류:', err.message);
        return res.status(400).json({ error: err.message || '수정 실패' });
    }
});
// POST /api/dm/ab-tests/:id/start — 시작 (short_code 발급 + status='running')
exports.dmRouter.post('/ab-tests/:id/start', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const test = await (0, dm_ab_test_1.startAbTest)(req.params.id, companyId);
        if (!test)
            return res.status(404).json({ error: '찾을 수 없습니다.' });
        return res.json({ test });
    }
    catch (err) {
        console.error('[AB시작] 오류:', err.message);
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/dm/ab-tests/:id/pause — 일시정지
exports.dmRouter.post('/ab-tests/:id/pause', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const test = await (0, dm_ab_test_1.pauseAbTest)(req.params.id, companyId);
        if (!test)
            return res.status(404).json({ error: '실행 중인 테스트가 아닙니다.' });
        return res.json({ test });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// POST /api/dm/ab-tests/:id/complete — 종료 + result_summary 고정
exports.dmRouter.post('/ab-tests/:id/complete', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const test = await (0, dm_ab_test_1.completeAbTest)(req.params.id, companyId);
        if (!test)
            return res.status(404).json({ error: '찾을 수 없습니다.' });
        return res.json({ test });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// DELETE /api/dm/ab-tests/:id
exports.dmRouter.delete('/ab-tests/:id', async (req, res) => {
    try {
        const companyId = req.user?.companyId;
        if (!companyId)
            return res.status(403).json({ error: '회사 권한이 필요합니다.' });
        const ok = await (0, dm_ab_test_1.deleteAbTest)(req.params.id, companyId);
        if (!ok)
            return res.status(404).json({ error: '찾을 수 없습니다.' });
        return res.json({ success: true });
    }
    catch (err) {
        return res.status(500).json({ error: err.message });
    }
});
// ============================================================
//  A/B 테스트 공개 뷰어 (인증 불필요 — dmPublicRouter에 등록)
// ============================================================
// GET /api/dm/v/ab/:code — variant 선택 + 해당 DM 렌더
exports.dmPublicRouter.get('/ab/:code', async (req, res) => {
    try {
        const test = await (0, dm_ab_test_1.getAbTestByShortCode)(req.params.code);
        if (!test)
            return res.status(404).send((0, dm_viewer_1.renderDmErrorHtml)('A/B 테스트를 찾을 수 없어요.'));
        // 쿠키 스티키
        const cookieName = `dm_ab_${test.id.replace(/-/g, '')}`;
        const raw = req.headers.cookie || '';
        const match = raw.match(new RegExp(`${cookieName}=(a|b|c)`));
        const existing = match ? match[1] : undefined;
        const variant = (0, dm_ab_test_1.pickVariant)(test, existing);
        const pageId = (0, dm_ab_test_1.variantToPageId)(test, variant);
        if (!pageId)
            return res.status(404).send((0, dm_viewer_1.renderDmErrorHtml)('선택된 variant DM이 없습니다.'));
        const dmRes = await (0, database_1.query)(`SELECT * FROM dm_pages WHERE id = $1`, [pageId]);
        const dm = dmRes.rows[0];
        if (!dm)
            return res.status(404).send((0, dm_viewer_1.renderDmErrorHtml)('DM을 찾을 수 없어요.'));
        // 첫 진입 추적 (variant 정보 함께)
        const phone = req.query.p || null;
        const ip = req.ip || req.socket?.remoteAddress || null;
        const ua = req.headers['user-agent'] || null;
        const totalPages = (0, dm_builder_1.extractPagesFromDm)(dm).length || 1;
        (0, dm_ab_test_1.trackAbTestView)(test.id, variant, pageId, dm.company_id, phone, 1, totalPages, 0, ip, ua).catch(() => { });
        // 쿠키 발급 (30일)
        if (!existing) {
            res.setHeader('Set-Cookie', `${cookieName}=${variant}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
        }
        const html = (0, dm_viewer_1.renderDmViewerHtml)(dm, '/api/dm/v');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(html);
    }
    catch (err) {
        console.error('[AB뷰어] 오류:', err.message);
        res.status(500).send((0, dm_viewer_1.renderDmErrorHtml)('일시적 오류가 발생했습니다.'));
    }
});
// POST /api/dm/v/ab/:code/track — A/B 열람 진행 추적
exports.dmPublicRouter.post('/ab/:code/track', async (req, res) => {
    try {
        const test = await (0, dm_ab_test_1.getAbTestByShortCode)(req.params.code);
        if (!test)
            return res.status(404).json({ error: 'Not found' });
        const cookieName = `dm_ab_${test.id.replace(/-/g, '')}`;
        const raw = req.headers.cookie || '';
        const match = raw.match(new RegExp(`${cookieName}=(a|b|c)`));
        const variant = match ? match[1] : 'a';
        const pageId = (0, dm_ab_test_1.variantToPageId)(test, variant);
        if (!pageId)
            return res.status(404).json({ error: 'variant page not found' });
        const { phone, page_reached, total_pages, duration } = req.body || {};
        const ip = req.ip || req.socket?.remoteAddress || null;
        const ua = req.headers['user-agent'] || null;
        await (0, dm_ab_test_1.trackAbTestView)(test.id, variant, pageId, test.company_id, phone || null, page_reached || 1, total_pages || 0, duration || 0, ip, ua);
        return res.json({ ok: true, variant });
    }
    catch (err) {
        console.error('[AB추적] 오류:', err.message);
        return res.status(500).json({ error: 'Internal error' });
    }
});
//# sourceMappingURL=dm.js.map