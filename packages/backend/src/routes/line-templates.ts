/**
 * routes/line-templates.ts — 한 줄 템플릿 캠페인 목록 · 예시 (★ 2026-10-17 · 설계서 docs/2026-10-17-line-template-campaign-design.md §4)
 *
 * AI 0 · DB 0(스위치 판정만) · 0원. 스위치(`LINE_TEMPLATES_COMPANY_IDS` · 한 줄 단계 스위치 안) 켠 회사만 — 밖 = 404.
 * 예시 = 진짜 조립 함수 + 진짜 렌더러 + 가상 업체 고정 재료(보이는 것 = 나오는 것) · 날짜(마감)만 오늘 기준이라 KST 날짜별 메모리 캐시.
 */
import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import { LINE_TEMPLATES, getLineTemplate, lineTemplatesEnabled, type LineChannel, type LineLayout } from '../utils/design-core/line-templates';
import { oneLineStepsEnabled, kstDayOf } from '../utils/one-line-steps';
import { renderLineTemplateExample } from '../utils/line-template-example';

export const lineTemplatesRouter = Router();
lineTemplatesRouter.use(authenticate);

const NOT_OPEN = { success: false, error: '이 기능은 아직 열리지 않았습니다.', code: 'FEATURE_DISABLED' };
const isOpen = (companyId: string | undefined) => !!companyId && lineTemplatesEnabled(companyId, oneLineStepsEnabled(companyId));

lineTemplatesRouter.get('/', (req: any, res: any) => {
  if (!isOpen(req.user?.companyId)) return res.status(404).json(NOT_OPEN);
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
  const channel = String(req.query.channel || 'dm') as LineChannel;
  const layout = String(req.query.layout || 'slides') as LineLayout;
  if (!t || !['dm', 'email', 'inapp'].includes(channel) || !['slides', 'page'].includes(layout)) {
    return res.status(400).json({ success: false, error: '요청 형식이 맞지 않아요.', code: 'INVALID' });
  }
  try {
    const now = Date.now();
    const day = kstDayOf(now);
    if (day !== exampleCacheDay) { exampleCache.clear(); exampleCacheDay = day; }
    const key = `${t.id}:${channel}:${channel === 'dm' ? layout : 'page'}`;
    let out = exampleCache.get(key);
    if (!out) {
      out = renderLineTemplateExample(t, channel, layout, now);
      exampleCache.set(key, out);
    }
    return res.json({ success: true, ...(out as object) });
  } catch (err: any) {
    console.error('[line-templates example] 오류:', err?.message);
    return res.status(500).json({ success: false, error: '예시를 그리지 못했어요. 잠시 뒤 다시 열어 주세요.' });
  }
});
