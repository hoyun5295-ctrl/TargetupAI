/**
 * ★ D219+ Part 2 (2026-05-27 신설) — Onboarding Wizard endpoints
 *
 * 🎯 Wizard 7 step 흐름:
 *   1. 환영 + 회사 정보 확인
 *   2. 발신번호 + 서류 업로드 (기존 sender-registration 흐름 활용)
 *   3. customer 임포트 + AI 자동 매핑 (CT-96 ai-column-mapper)
 *   4. 세그먼트 자연어 + 매칭 수 + saved_segments INSERT (CT-97 ai-segment-generator + CT-01 customer-filter)
 *   5. 본문 자연어 → 즉시 본문 생성 + 편집 모드 (기존 routes/ai 흐름 재활용)
 *   6. 샘플 발송 (admin 본인 phone + 인증 라인 — 기존 direct-send 흐름)
 *   7. 매일 9시 자동 인사이트 메일 기본 ON (CT-98 daily-insight-mailer)
 *
 * 🔒 게이팅: AI 오퍼레이션 무료체험 활성 + 회사 admin 권한 (super_admin 진입 가능).
 */

import { Request, Response, Router } from 'express';
import { authenticate } from '../middlewares/auth';
import {
  getOnboardingState,
  saveOnboardingStep,
  completeOnboardingStep,
  completeOnboarding,
} from '../utils/onboarding-wizard';
import {
  generateSegmentFromNaturalLanguage,
  previewMatching,
  saveSegmentFromWizard,
  SegmentGenerationError,
} from '../utils/ai-segment-generator';
import { mapColumnsWithAi, ColumnMappingError } from '../utils/ai-column-mapper';
// ★ D219+ Part 2 후속 (2026-05-27) Task 7: isAiOperatorTrialActive duplicate 폐기 — plan-guard 단일 진입점 통합
import { loadPlanContext } from '../utils/plan-guard';

const router = Router();
router.use(authenticate);

// ════════════════════════════════════════════════════════════════════
// 무료체험 활성 검증 미들웨어 (plan-guard 단일 진입점 정합)
// ════════════════════════════════════════════════════════════════════

async function requireAiOperatorTrialActive(req: Request, res: Response, next: () => void) {
  const companyId = req.user?.companyId;
  if (!companyId) {
    return res.status(401).json({ success: false, error: '인증 필요' });
  }
  // 슈퍼관리자 = 항상 허용 (검증 영역)
  if (req.user?.userType === 'super_admin') {
    return next();
  }
  const ctx = await loadPlanContext(companyId);
  if (!ctx?.isAiOperatorTrialActive) {
    return res.status(403).json({
      success: false,
      code: 'AI_OPERATOR_TRIAL_INACTIVE',
      error: 'AI 오퍼레이션 무료체험이 활성화되지 않았습니다. 슈퍼관리자에게 부여 요청하세요.',
    });
  }
  next();
}

// ════════════════════════════════════════════════════════════════════
// 1. GET /api/onboarding/state — Wizard 진행률 조회
// ════════════════════════════════════════════════════════════════════

router.get('/state', requireAiOperatorTrialActive, async (req: Request, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const userId = req.user!.userId;
    // ★ D219+ Part 2 후속 Task 7: plan-guard loadPlanContext 단일 진입점 활용
    const ctx = await loadPlanContext(companyId);
    const trial = {
      active: !!ctx?.isAiOperatorTrialActive,
      startedAt: ctx?.aiOperatorTrialStartedAt ? ctx.aiOperatorTrialStartedAt.toISOString() : null,
      until: ctx?.aiOperatorTrialUntil ? ctx.aiOperatorTrialUntil.toISOString() : null,
    };
    const state = await getOnboardingState(companyId, userId);
    return res.json({
      success: true,
      state,
      trial,
    });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return res.status(503).json({
        success: false,
        code: 'DB_MIGRATION_PENDING',
        error: 'DB 마이그레이션이 필요합니다. 운영자에게 onboarding_wizard_state 테이블 신설을 요청하세요.',
      });
    }
    console.error('[onboarding/state] 실패:', err);
    return res.status(500).json({ success: false, error: 'Wizard 상태 조회 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 2. POST /api/onboarding/step-save — 단계 진행 데이터 저장
// ════════════════════════════════════════════════════════════════════

router.post('/step-save', requireAiOperatorTrialActive, async (req: Request, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const userId = req.user!.userId;
    const { stepNum, data } = req.body as { stepNum: number; data: any };
    if (!stepNum || stepNum < 1 || stepNum > 7) {
      return res.status(400).json({ success: false, error: 'stepNum (1~7) 필수' });
    }
    const state = await saveOnboardingStep(companyId, userId, stepNum, data || {});
    return res.json({ success: true, state });
  } catch (err: any) {
    console.error('[onboarding/step-save] 실패:', err);
    return res.status(500).json({ success: false, error: '단계 저장 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 3. POST /api/onboarding/step-complete — 단계 완성 표시
// ════════════════════════════════════════════════════════════════════

router.post('/step-complete', requireAiOperatorTrialActive, async (req: Request, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const userId = req.user!.userId;
    const { stepNum } = req.body as { stepNum: number };
    if (!stepNum || stepNum < 1 || stepNum > 7) {
      return res.status(400).json({ success: false, error: 'stepNum (1~7) 필수' });
    }
    const state = await completeOnboardingStep(companyId, userId, stepNum);
    return res.json({ success: true, state });
  } catch (err: any) {
    console.error('[onboarding/step-complete] 실패:', err);
    return res.status(500).json({ success: false, error: '단계 완성 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 4. POST /api/onboarding/import-analyze — CT-96 AI 컬럼 매핑 미리보기
//    Frontend가 파일 파싱 후 columnNames + sampleRows를 직접 전달.
//    (file upload + multer + xlsx 파싱 = Frontend가 처리하거나 별도 endpoint 분리)
// ════════════════════════════════════════════════════════════════════

router.post('/import-analyze', requireAiOperatorTrialActive, async (req: Request, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const { columnNames, sampleRows } = req.body as {
      columnNames: string[];
      sampleRows: any[][];
    };
    if (!Array.isArray(columnNames) || columnNames.length === 0) {
      return res.status(400).json({ success: false, error: 'columnNames 배열 필수' });
    }
    const result = await mapColumnsWithAi({
      companyId,
      columnNames,
      sampleRows: Array.isArray(sampleRows) ? sampleRows : [],
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    if (err instanceof ColumnMappingError) {
      return res.status(400).json({ success: false, code: err.code, error: err.message });
    }
    console.error('[onboarding/import-analyze] 실패:', err);
    return res.status(500).json({ success: false, error: 'AI 컬럼 매핑 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 5. POST /api/onboarding/segment-generate — CT-97 자연어 → segment
// ════════════════════════════════════════════════════════════════════

router.post('/segment-generate', requireAiOperatorTrialActive, async (req: Request, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const { naturalLanguage, customFieldKeys } = req.body as {
      naturalLanguage: string;
      customFieldKeys?: string[];
    };
    if (!naturalLanguage?.trim()) {
      return res.status(400).json({ success: false, error: 'naturalLanguage 필수' });
    }
    const result = await generateSegmentFromNaturalLanguage({
      companyId,
      naturalLanguage,
      customFieldKeys,
    });
    return res.json({ success: true, ...result });
  } catch (err: any) {
    if (err instanceof SegmentGenerationError) {
      // ZERO_MATCH 등 사용자 안내 오류 = 400
      return res.status(400).json({ success: false, code: err.code, error: err.message });
    }
    console.error('[onboarding/segment-generate] 실패:', err);
    return res.status(500).json({ success: false, error: 'AI 세그먼트 생성 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 6. POST /api/onboarding/segment-preview — 사용자 정정한 filter 재 미리보기
// ════════════════════════════════════════════════════════════════════

router.post('/segment-preview', requireAiOperatorTrialActive, async (req: Request, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const { filter } = req.body as { filter: any };
    if (!filter || typeof filter !== 'object') {
      return res.status(400).json({ success: false, error: 'filter 객체 필수' });
    }
    const result = await previewMatching(companyId, filter);
    return res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[onboarding/segment-preview] 실패:', err);
    return res.status(500).json({ success: false, code: 'PREVIEW_FAILED', error: err?.message || '미리보기 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 7. POST /api/onboarding/segment-confirm — saved_segments INSERT + step 4 완성
// ════════════════════════════════════════════════════════════════════

router.post('/segment-confirm', requireAiOperatorTrialActive, async (req: Request, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const userId = req.user!.userId;
    const { name, filter, naturalLanguage } = req.body as {
      name: string;
      filter: any;
      naturalLanguage: string;
    };
    if (!name?.trim()) {
      return res.status(400).json({ success: false, error: '세그먼트 이름 필수' });
    }
    if (!filter || typeof filter !== 'object') {
      return res.status(400).json({ success: false, error: 'filter 객체 필수' });
    }

    const { id: segmentId } = await saveSegmentFromWizard({
      companyId,
      userId,
      name: name.trim(),
      filter,
      naturalLanguage: naturalLanguage || '',
    });

    // step 4 완성 + state 갱신
    await saveOnboardingStep(companyId, userId, 4, { savedSegmentId: segmentId });
    const state = await completeOnboardingStep(companyId, userId, 4);

    return res.json({ success: true, segmentId, state });
  } catch (err: any) {
    const msg = err?.message || '';
    if (msg.includes('column') && msg.includes('filter_jsonb')) {
      return res.status(503).json({
        success: false,
        code: 'DB_MIGRATION_PENDING',
        error: 'DB 마이그레이션이 필요합니다. 운영자에게 saved_segments ALTER ADD filter_jsonb 실행을 요청하세요.',
      });
    }
    console.error('[onboarding/segment-confirm] 실패:', err);
    return res.status(500).json({ success: false, error: '세그먼트 저장 실패' });
  }
});

// ════════════════════════════════════════════════════════════════════
// 8. POST /api/onboarding/complete — Wizard 종결 + ROI 메일 활성
// ════════════════════════════════════════════════════════════════════

router.post('/complete', requireAiOperatorTrialActive, async (req: Request, res: Response) => {
  try {
    const companyId = req.user!.companyId!;
    const userId = req.user!.userId;
    const { dailyInsightEnabled } = req.body as { dailyInsightEnabled?: boolean };

    // daily_insight_enabled 옵션 저장
    await saveOnboardingStep(companyId, userId, 7, {
      dailyInsightEnabled: dailyInsightEnabled !== false,
    });
    const state = await completeOnboarding(companyId, userId);

    return res.json({
      success: true,
      message: 'Wizard가 종결되었습니다. 매일 9시 인사이트 메일이 자동 발송됩니다.',
      state,
    });
  } catch (err: any) {
    console.error('[onboarding/complete] 실패:', err);
    return res.status(500).json({ success: false, error: 'Wizard 종결 실패' });
  }
});

export default router;
