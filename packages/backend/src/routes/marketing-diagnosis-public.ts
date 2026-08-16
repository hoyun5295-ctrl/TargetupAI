/**
 * 라우트: AI 마케팅 진단 — 공개 축(퍼널 B · 미인증 잠재고객) (2026-08-16 신설)
 * 설계서 = docs/2026-08-16-marketing-diagnosis-design.md §4-4
 *
 * 원칙
 *   - AI 호출 0 · 크레딧 차감 0(순수 룰만).
 *   - 문항의 단일 진실 = GET /questions(활성 definition) — 프론트 상수 없음. requires는 벗겨서 내보낸다.
 *   - preview = 서버가 추천을 가린 부분 결과(화면 가림 금지 — 화면은 게이트가 아니다) · 저장 없음.
 *   - submit = 서버가 재계산·재검증 후 funnel B 저장. 금액 effect 0(usage 미포함 — §2-8).
 *   - 이메일 중복 = 항상 200 동일 문구 + 새 행 저장(스냅샷 불변 — 묶음은 관리 목록 grouping).
 *   - 본문 파서는 app.ts에서 이 경로 한정 32kb — 413은 400으로 변환(최종 핸들러 500 방지).
 *
 * ⛔ 신규 테이블은 배포 후 DDL(§3) — 그 전에는 503 DB_MIGRATION_PENDING.
 */
import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { query } from '../config/database';
import { handleDbMigrationError } from '../utils/db-migration-error';
import { validateAnswers, recommendPlan } from '../utils/plan-recommend';
import { buildDiagnosisResult, CONVERSION_TASKS } from '../utils/marketing-diagnosis-report';
import {
  loadActiveQuestionSet, handleDefinitionInvalid, DIAGNOSIS_PLAN_ROWS_SQL, projectQuestions,
} from '../utils/marketing-diagnosis-store';
import { CREDIT_COST_MAP } from '../utils/ai-credit-calc';

const router = Router();

/** 리드 4필드 상한 = §3 DDL 컬럼 길이와 1:1. */
const LIMITS = { companyName: 200, contactName: 100, email: 200, phone: 30 } as const;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** 동의문 버전 — 문구 개정 시 여기만 올린다(행에 스냅샷). */
const CONSENT_VERSION = 'v1-2026-08';

/** 공개 POST 리밋 — submit = IP 10분 5회(§4-4). GET(questions·credit-costs)은 조회라 비대상. */
const publicPostLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' },
});

/** preview 전용 리밋 — 저장이 없는 계산 조회라 창을 분리한다(v3 M10 — submit 재시도 소진 차단). */
const previewLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: '요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.', code: 'RATE_LIMITED' },
});

function activeSetMissing(res: Response) {
  return res.status(503).json({
    success: false,
    code: 'DB_MIGRATION_PENDING',
    error: '진단 준비 중입니다. 잠시 후 다시 시도해 주세요.',
  });
}

// ────────────────────────────────────────────────────────────────────
// GET /questions — 활성 문항(단일 진실). requires(내부 룰)는 벗겨서 내보낸다.
// ────────────────────────────────────────────────────────────────────
router.get('/questions', async (_req: Request, res: Response) => {
  try {
    const activeSet = await loadActiveQuestionSet();
    if (!activeSet) return activeSetMissing(res);
    // 인증 라우트와 같은 투영 함수(단일 진실 — v3 M3). requires·level·unknown은 벗겨 내보낸다.
    return res.json({ success: true, version: activeSet.version, ...projectQuestions(activeSet.definition) });
  } catch (err) {
    if (handleDefinitionInvalid(err, res)) return;
    if (handleDbMigrationError(err, res, 'diagnosis_question_sets')) return;
    console.error('[marketing-diagnosis-public] questions 실패:', err);
    return res.status(500).json({ success: false, error: '문항 조회에 실패했습니다.' });
  }
});

// ────────────────────────────────────────────────────────────────────
// GET /credit-costs — CREDIT_COST_MAP 파생 환산 표(단가 원화 제외 — 크레딧 수만)
// ────────────────────────────────────────────────────────────────────
router.get('/credit-costs', (_req: Request, res: Response) => {
  return res.json({
    success: true,
    tasks: CONVERSION_TASKS.map(({ source, label }) => ({
      key: source,
      label,
      credits: CREDIT_COST_MAP[source] ?? 0,
    })),
  });
});

// ────────────────────────────────────────────────────────────────────
// POST /preview — answers만 → 완전 검증 → 룰 계산 → 추천을 가린 부분 결과(저장 없음)
// ────────────────────────────────────────────────────────────────────
router.post('/preview', previewLimiter, async (req: Request, res: Response) => {
  try {
    const activeSet = await loadActiveQuestionSet();
    if (!activeSet) return activeSetMissing(res);
    // 문항 버전 결속(★Codex 1R) — 구 클라이언트(버전 미전송)는 기존 동작 유지
    const requestedVersion = (req.body as any)?.question_set_version;
    if (typeof requestedVersion === 'string' && requestedVersion !== activeSet.version) {
      console.warn(`[marketing-diagnosis-public] preview 409 VERSION_CHANGED: ${requestedVersion} → ${activeSet.version}`);
      return res.status(409).json({
        success: false, code: 'VERSION_CHANGED',
        error: '진단 문항이 갱신되었어요. 처음부터 다시 진행해 주세요.',
      });
    }
    const answers = (req.body as any)?.answers;
    const check = validateAnswers(activeSet.definition, answers);
    if (!check.ok) {
      console.warn(`[marketing-diagnosis-public] preview 400: ${check.error}`);
      return res.status(400).json({ success: false, error: check.error || '답변이 유효하지 않습니다.' });
    }

    const planRes = await query(DIAGNOSIS_PLAN_ROWS_SQL);
    const recommend = recommendPlan(activeSet.definition, answers, planRes.rows);
    const full = buildDiagnosisResult({
      definition: activeSet.definition,
      answers,
      recommend,
      usage: null,                       // 퍼널 B = 금액 0 원칙
      brandVoiceMissing: false,
      grantOutcome: null,
    });
    // 서버가 가린다 — spread가 아니라 **허용 필드만 조립**한다(★Codex 적대 수용: 전체를 펼치고
    // 일부만 덮으면 effects의 크레딧 환산 횟수 × 공개 /credit-costs 제수로 숨긴 요금제가 역산된다).
    // v3 회의 확정 — 진단(표지·관찰·칭찬·판정·병목 인과 3단)은 전부 무료 공개하고,
    // 실행 순서(plan30)·업종 예시·요금제·수치(effects)만 신청 뒤로 남긴다. 흐림·자물쇠 없음(부재가 정직).
    if (full.v === 2) {
      return res.json({
        success: true,
        preview: {
          v: 2,
          summary: full.summary,
          stage: full.stage,
          cover: full.cover,
          observation: full.observation,
          praises: full.praises,
          axes: full.axes,
          insights: full.insights,
          gaps: full.gaps,
          plan_note: '30일 실행 순서와 분야별 예시는 신청 후 담당자가 함께 정리해 드려요.',
        },
      });
    }
    return res.json({
      success: true,
      preview: {
        v: full.v,
        summary: '진단이 준비되었습니다. 요금제 추천은 신청 후 담당자가 함께 확인드립니다.',
        findings: full.findings,
        effects: [],                     // 요금제 파생 수치는 preview에 내보내지 않는다(지문 차단)
        examples: full.examples,
      },
    });
  } catch (err) {
    if (handleDefinitionInvalid(err, res)) return;
    if (handleDbMigrationError(err, res, 'diagnosis_question_sets')) return;
    console.error('[marketing-diagnosis-public] preview 실패:', err);
    return res.status(500).json({ success: false, error: '진단 계산에 실패했습니다.' });
  }
});

// ────────────────────────────────────────────────────────────────────
// POST /submit — answers + 리드 4필드 + 동의 → 서버 재계산·재검증 → funnel B 저장 → 결과 전체 반환
// ────────────────────────────────────────────────────────────────────
router.post('/submit', publicPostLimiter, async (req: Request, res: Response) => {
  try {
    const body = (req.body as any) || {};

    // 허니팟 — 사람은 못 보는 필드가 차 있으면 봇: 저장 없이 성공 위장(패턴 학습 차단)
    if (typeof body.website === 'string' && body.website.trim() !== '') {
      return res.json({ success: true, message: '신청이 접수되었습니다.' });
    }

    const activeSet = await loadActiveQuestionSet();
    if (!activeSet) return activeSetMissing(res);

    // 문항 버전 결속(★Codex 1R) — 구 클라이언트(버전 미전송)는 기존 동작 유지
    const requestedVersion = body.question_set_version;
    if (typeof requestedVersion === 'string' && requestedVersion !== activeSet.version) {
      console.warn(`[marketing-diagnosis-public] submit 409 VERSION_CHANGED: ${requestedVersion} → ${activeSet.version}`);
      return res.status(409).json({
        success: false, code: 'VERSION_CHANGED',
        error: '진단 문항이 갱신되었어요. 처음부터 다시 진행해 주세요.',
      });
    }

    const answers = body.answers;
    const check = validateAnswers(activeSet.definition, answers);
    if (!check.ok) {
      console.warn(`[marketing-diagnosis-public] submit 400: ${check.error}`);
      return res.status(400).json({ success: false, error: check.error || '답변이 유효하지 않습니다.' });
    }

    // 리드 필드 서버 형식 검증(§4-4 — 프론트 검증은 참고일 뿐)
    const companyName = String(body.company_name ?? '').trim();
    const contactName = String(body.contact_name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const phoneRaw = String(body.phone ?? '').replace(/[^\d]/g, '');
    if (!companyName || companyName.length > LIMITS.companyName) {
      return res.status(400).json({ success: false, error: '회사명을 확인해 주세요.' });
    }
    if (!contactName || contactName.length > LIMITS.contactName) {
      return res.status(400).json({ success: false, error: '담당자명을 확인해 주세요.' });
    }
    if (!EMAIL_RE.test(email) || email.length > LIMITS.email) {
      return res.status(400).json({ success: false, error: '이메일 주소를 확인해 주세요.' });
    }
    if (phoneRaw.length < 9 || phoneRaw.length > 15) {
      return res.status(400).json({ success: false, error: '연락처를 확인해 주세요.' });
    }
    if (body.consent !== true) {
      return res.status(400).json({ success: false, error: '개인정보 수집·이용 동의가 필요합니다.' });
    }

    const planRes = await query(DIAGNOSIS_PLAN_ROWS_SQL);
    const recommend = recommendPlan(activeSet.definition, answers, planRes.rows);
    const result = buildDiagnosisResult({
      definition: activeSet.definition,
      answers,
      recommend,
      usage: null,
      brandVoiceMissing: false,
      grantOutcome: null,
    });

    // ?src= 영업 링크 식별 — answers에 넣지 않는다(validator가 거부·§3 컬럼 소유)
    const srcRaw = (req.query?.src ?? body.src ?? '') as string;
    const sourceUtm = String(srcRaw).slice(0, 100) || null;

    // 이메일 중복도 새 행 저장(스냅샷 불변) — 묶음은 관리 목록의 lower(email) grouping이 담당
    await query(
      `INSERT INTO marketing_diagnoses
         (funnel, lead_company_name, lead_contact_name, lead_email, lead_phone,
          consent_agreed, consent_agreed_at, consent_version,
          source_ip, user_agent, source_utm,
          question_set_version, answers, result,
          recommended_plan_id, recommended_plan_code, recommended_monthly_price,
          rule_version, lead_status)
       VALUES ('B', $1, $2, $3, $4,
               true, NOW(), $5,
               $6, $7, $8,
               $9, $10::jsonb, $11::jsonb,
               $12, $13, $14,
               $15, 'new')`,
      [
        companyName,
        contactName,
        email,
        phoneRaw,
        CONSENT_VERSION,
        req.ip || null,
        String(req.headers['user-agent'] || '').slice(0, 1000) || null,
        sourceUtm,
        activeSet.version,
        JSON.stringify(answers),
        JSON.stringify(result),
        recommend.plan?.id ?? null,
        recommend.plan ? String(recommend.plan.plan_code) : null,
        recommend.plan ? Number(recommend.plan.monthly_price) : null,
        activeSet.definition.rule_version,
      ],
    );

    return res.json({ success: true, message: '신청이 접수되었습니다.', result });
  } catch (err) {
    if (handleDefinitionInvalid(err, res)) return;
    if (handleDbMigrationError(err, res, 'marketing_diagnoses')) return;
    console.error('[marketing-diagnosis-public] submit 실패:', err);
    return res.status(500).json({ success: false, error: '신청 처리에 실패했습니다. 잠시 후 다시 시도해 주세요.' });
  }
});

export default router;
