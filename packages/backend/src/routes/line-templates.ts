/**
 * routes/line-templates.ts — 한 줄 템플릿 캠페인 목록 · 예시 (★ 2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md §4)
 *
 * AI 0 · DB 0 · 0원. 전 회사(★ 2026-10-21 스위치 삭제 · 회사 권한만).
 * 예시 = 진짜 조립 함수 + 진짜 렌더러 + 가상 업체 고정 재료(보이는 것 = 나오는 것) · 날짜(마감)만 오늘 기준이라 KST 날짜별 메모리 캐시.
 */
import { respondUserError } from '../utils/http-error';
import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { LINE_TEMPLATES, getLineTemplate, type LineChannel, type LineLayout } from '../utils/design-core/line-templates';
import { kstDayOf } from '../utils/one-line-steps';
import { renderLineTemplateExample } from '../utils/line-template-example';
import { pickLineHeadlines } from '../utils/line-headline';
import { tryAcquireInflight, releaseInflight, takeDailyQuota } from '../utils/inflight-lock';

/** 회사당 하루 헤드라인 자동 추천 상한(한 줄 창을 열 때마다 1회 · 넘으면 갤러리에서 고른다) */
const HEADLINE_PICKS_DAILY_MAX = 60;
import { getBrandBasicInfo } from '../utils/brand-basic-info';
import { aiZonePlanBlocked } from '../utils/plan-guard';
import { getLineComposition } from '../utils/line-compositions';
import { previewCards, previewMaterialsOf, renderCompositionPreview } from '../utils/one-line-ct/preview';
import { compositionCatalog, renderCompositionExample } from '../utils/one-line-ct/catalog';
import { sanitizeLineStepsBody } from '../utils/one-line-steps';
import { getCompanyBrandKitRaw } from '../utils/dm/dm-brand-kit';
import { lineTemplateBrand } from '../utils/line-template-run';
import { linePinnedPrimary } from '../utils/line-mall-cards';

export const lineTemplatesRouter = Router();
lineTemplatesRouter.use(authenticate);

const NOT_OPEN = { success: false, error: '이 기능은 아직 열리지 않았습니다.', code: 'FEATURE_DISABLED' };
const isOpen = (companyId: string | undefined) => !!companyId;

lineTemplatesRouter.get('/', (req: any, res: any) => {
  if (!isOpen(req.user?.companyId)) return res.status(404).json(NOT_OPEN);
  // ★ 2026-10-22 한줄 CT 구성 5종(마케팅플래너 · 고르기 화면 · 옛 목록과 같은 모양)
  if (req.query?.set === 'compositions') return res.json({ success: true, templates: compositionCatalog() });
  return res.json({
    success: true,
    templates: LINE_TEMPLATES.map((t) => ({
      id: t.id, label: t.label, desc: t.desc, story: t.story,
      needs: t.needs,
      example: { company: t.example.company, industry: t.example.industry, line: t.example.line },
      design: { primary: t.design.primary, accent: t.design.accent },
    })),
  });
});

// ponytail: 키 = 템플릿 · 채널 · 배치 · KST 날짜(4 × 4 × 하루) · 날이 바뀌면 지난 날짜 키를 비운다
const exampleCache = new Map<string, unknown>();
let exampleCacheDay = '';

lineTemplatesRouter.get('/:id/example', (req: any, res: any) => {
  if (!isOpen(req.user?.companyId)) return res.status(404).json(NOT_OPEN);
  const t = getLineTemplate(req.params.id);
  const comp = t ? null : getLineComposition(req.params.id);
  const channel = String(req.query.channel || 'dm') as LineChannel;
  const layout = String(req.query.layout || 'slides') as LineLayout;
  if ((!t && !comp) || !['dm', 'email', 'inapp'].includes(channel) || !['slides', 'page'].includes(layout)) {
    return res.status(400).json({ success: false, error: '요청 형식이 맞지 않아요.', code: 'INVALID' });
  }
  try {
    const now = Date.now();
    const day = kstDayOf(now);
    if (day !== exampleCacheDay) { exampleCache.clear(); exampleCacheDay = day; }
    const key = `${(t || comp)!.id}:${channel}:${channel === 'dm' ? layout : 'page'}`;
    let out = exampleCache.get(key);
    if (!out) {
      out = t ? renderLineTemplateExample(t, channel, layout, now) : renderCompositionExample(comp!, channel, layout, now);
      exampleCache.set(key, out);
    }
    return res.json({ success: true, ...(out as object) });
  } catch (err: any) {
    console.error('[line-templates example] 오류:', err?.message);
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: '예시를 그리지 못했어요. 잠시 뒤 다시 열어 주세요.' });
  }
});

/**
 * ★ 2026-10-21 전면 헤드라인 = 이미지 스튜디오 템플릿 3안(설계서 docs/2026-10-21-oneline-content-design.md §3-4)
 * POST { line, has_photo, products: string[] } → { picks[3] · title · source } · AI 1회(묶음 안) · 0원 · 그림 생성은 화면이 스튜디오 경로로(2크레딧).
 */
lineTemplatesRouter.post('/headline-picks', async (req: any, res: any) => {
  const companyId = req.user?.companyId;
  if (!isOpen(companyId)) return res.status(404).json(NOT_OPEN);
  // ★ 2026-10-24 R2 — AI 를 부르는 주소 = 서버 요금제 문(비용은 우리 부담이어도 · 한 줄 CT 구조체크 ④)
  if (await aiZonePlanBlocked(req, res)) return;
  const line = typeof req.body?.line === 'string' ? req.body.line.trim().slice(0, 2000) : '';
  if (!line) return res.status(400).json({ success: false, error: '한 줄을 먼저 적어 주세요.', code: 'INVALID' });
  const products = (Array.isArray(req.body?.products) ? req.body.products : [])
    .filter((x: unknown): x is string => typeof x === 'string' && !!x.trim()).map((x: string) => x.trim().slice(0, 60)).slice(0, 6);
  // 0원 경로라 원가만 나간다 → 회사당 동시 1건 · 하루 상한(잠금 안에서 소비 · Codex P2 R1)
  const lockKey = `line-headline-picks:${companyId}`;
  if (!tryAcquireInflight(lockKey)) return res.status(409).json({ success: false, error: '지금 템플릿을 고르는 중이에요. 잠시 뒤 다시 열어 주세요.', code: 'IN_FLIGHT' });
  if (!takeDailyQuota(`line-headline-picks:${companyId}`, HEADLINE_PICKS_DAILY_MAX)) {
    releaseInflight(lockKey);
    return res.status(429).json({ success: false, error: '오늘 받을 수 있는 자동 추천을 다 썼어요. 「다른 템플릿 더 보기」에서 골라 주세요.', code: 'HEADLINE_PICKS_DAILY_LIMIT' });
  }
  try {
    const basic = await getBrandBasicInfo(companyId).catch(() => null);
    const r = await pickLineHeadlines({
      companyId, userId: req.user?.userId,
      companyName: String(basic?.brand_name || basic?.company_name || '').trim().slice(0, 30) || '우리 브랜드',
      industry: String(basic?.industry_code || '').trim() || null,
      line, productNames: products, hasPhoto: req.body?.has_photo === true,
    });
    return res.json({ success: true, ...r });
  } catch (err: any) {
    console.error('[line-templates headline-picks] 오류:', err?.message);
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: '첫 화면 템플릿을 고르지 못했어요. 잠시 뒤 다시 열어 주세요.' });
  } finally {
    releaseInflight(lockKey);
  }
});

/**
 * ★ 2026-10-22 한줄 CT 재료 판 미리보기(설계서 docs/2026-10-22-oneline-ct-design.md §11-5) — 구성 + 지금 재료 · 기본 문구 · 빈 칸 = 점선 자리.
 *   AI 0 · 0원 · 결과물과 같은 조립 · 렌더러. 회사 권한만 · 회사당 하루 600회(칸을 닫을 때마다 한 번).
 * ★ 2026-10-23 본문 = 만들기 요청 본문 그대로(같은 검증 · 같은 재료 변환 · 같은 진단 · 설계서 docs/2026-10-23-oneline-ct-complete-design.md A1-b)
 *   + preview{ cards: 화면이 가진 몰 상품 사진 목록 · page_banner: 읽어 둔 페이지 표지 } · 응답 = 그림 + 칸 판정(slots · 화면은 이것을 그린다).
 */
const PREVIEW_DAILY_MAX = 600;
lineTemplatesRouter.post('/composition-preview', async (req: any, res: any) => {
  const companyId = req.user?.companyId;
  if (!isOpen(companyId)) return res.status(404).json(NOT_OPEN);
  const comp = getLineComposition(req.body?.composition);
  const channel = String(req.body?.channel || 'dm');
  if (!comp || !['dm', 'email', 'inapp'].includes(channel)) return res.status(400).json({ success: false, error: '요청 형식이 맞지 않아요.', code: 'INVALID' });
  const body = sanitizeLineStepsBody(req.body?.body, Date.now());
  if (!body || body === 'invalid' || body.template?.id !== comp.id) return res.status(400).json({ success: false, error: '요청 형식이 맞지 않아요.', code: 'INVALID' });
  if (!takeDailyQuota(`composition-preview:${companyId}`, PREVIEW_DAILY_MAX)) return res.status(429).json({ success: false, error: '오늘 미리보기를 많이 썼어요. 내일 다시 볼 수 있어요.', code: 'PREVIEW_DAILY_LIMIT' });
  try {
    // 결과물과 같은 브랜드 재료(이름 · 로고 · 고객센터 · 회사 주색) · 읽기 실패 = 빈 값(미리보기는 막지 않는다)
    const kitRaw = (await getCompanyBrandKitRaw(companyId).catch(() => null)) as Record<string, unknown> | null;
    const brand = await lineTemplateBrand(companyId, kitRaw).catch(() => ({ brandName: '', logoUrl: null, csPhone: null }));
    const pv = req.body?.preview && typeof req.body.preview === 'object' ? req.body.preview : {};
    const ch = channel as 'dm' | 'email' | 'inapp';
    const { comp: c2, materials } = previewMaterialsOf({
      comp, channel: ch, body, mallCards: previewCards(pv.cards), pageBanner: typeof pv.page_banner === 'string' ? pv.page_banner : null,
      brand, pinnedPrimary: linePinnedPrimary(kitRaw), companyId,
    });
    const r = renderCompositionPreview(c2, ch, materials);
    return res.json({ success: true, ...r, slots: r.slots.map((s) => ({ step: s.step, level: s.level, have: s.have, min: s.min, filled: s.filled })) });
  } catch (err: any) {
    console.error('[composition-preview] 실패:', err?.message);
    if (respondUserError(res, err)) return;   // ★ 2026-10-25 R10 — 사용자 조건 오류 = 그 상태 · 문장 그대로
    return res.status(500).json({ success: false, error: '미리보기를 그리지 못했어요.', code: 'PREVIEW_FAILED' });
  }
});
