/**
 * ★ 디자인 4.0 M4 — 정예 골든 템플릿 조회 API (2026-07-14)
 *
 * 채널 중립 코어(design-core/template-registry)를 채널 산출물로 컴파일해 제공(읽기 전용).
 * FE는 이 API만 소비 — 10종을 FE에 복제하지 않는다(미러 드리프트 표면 추가 금지).
 * 브랜드 학습 파이프: resolveBrandProfile로 고객센터·브랜드명을 골격에 자동 주입.
 * 발송 파이프라인 무접촉 — 캠페인·발송·정산 어디에도 닿지 않는 조회 전용 라우트.
 */
import { Router } from 'express';
import { authenticate } from '../middlewares/auth';
import {
  CORE_GOLDEN_TEMPLATES, validateAllGoldenTemplates, getCorePalette,
  compileTemplateForDm, compileTemplateForEmail, compileTemplateForInapp,
} from '../utils/design-core';
import { resolveBrandProfile } from '../utils/design-core/brand-profile';

export const designTemplatesRouter = Router();
designTemplatesRouter.use(authenticate);

const CHANNELS = new Set(['dm', 'email', 'inapp']);

// GET /api/design/golden-templates?channel=dm|email|inapp
designTemplatesRouter.get('/golden-templates', async (req: any, res: any) => {
  try {
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    const channel = String(req.query.channel || '');
    if (!CHANNELS.has(channel)) {
      return res.status(400).json({ success: false, error: 'channel은 dm/email/inapp 중 하나여야 합니다.' });
    }

    // 품질 게이트 상시 검증 — 위반 템플릿은 노출하지 않는다(fail-closed)
    const violations = validateAllGoldenTemplates();
    const blockedIds = new Set(violations.map((v) => v.templateId));

    // 브랜드 학습 파이프 — 고객센터·브랜드명 자동 주입(미학습 = 빈 골격 그대로)
    const profile = await resolveBrandProfile(companyId).catch(() => null);
    const opts = {
      contact: profile?.contact,
      brandName: undefined as string | undefined,
    };

    const templates = CORE_GOLDEN_TEMPLATES
      .filter((t) => !blockedIds.has(t.id) && t.channels[channel as 'dm' | 'email' | 'inapp'].include)
      .map((t) => {
        const pal = getCorePalette(t.design.palette)!;
        const base = {
          id: t.id,
          label: t.label,
          purpose: t.purpose,
          difference: t.difference,
          hint: t.story.logic,
          trigger_hint: t.triggerHint,
          palette: { id: pal.id, name: pal.name },
          swatches: pal.swatches,
          adjust: t.channels[channel as 'dm' | 'email' | 'inapp'].adjust || null,
        };
        if (channel === 'dm') {
          const c = compileTemplateForDm(t, opts);
          return { ...base, sections: c.sections, brand_kit_patch: c.brandKitPatch };
        }
        if (channel === 'email') {
          const c = compileTemplateForEmail(t, opts);
          return { ...base, sections: c.sections, design: c.design };
        }
        const c = compileTemplateForInapp(t);
        return { ...base, template: c.template, card_style: c.card_style, theme: c.theme, design: c.design, is_ad: c.is_ad, content_blocks: c.content_blocks };
      });

    return res.json({ success: true, channel, templates });
  } catch (err: any) {
    console.error('[Design4 골든템플릿] 오류:', err?.message);
    return res.status(500).json({ success: false, error: '정예 템플릿 조회에 실패했어요.' });
  }
});
