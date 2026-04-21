/**
 * /api/alimtalk/* — 휴머스온 IMC 연동 라우트
 *
 * ALIMTALK-DESIGN.md §5-5 기준. 총 33개 엔드포인트.
 *
 * 기존 `/api/companies/kakao-profiles`, `/api/companies/kakao-templates` 라우트는
 * 로컬 DB CRUD 호환용으로 유지. 본 라우트는 IMC 직접 연동 전용.
 *
 * 권한 정책:
 *   - 발신프로필 CRUD         → super_admin
 *   - 카테고리 동기화         → super_admin
 *   - 카테고리 조회           → 로그인 사용자 전원
 *   - 템플릿/알림수신자/이미지 → company_admin 또는 super_admin
 *   - 웹훅                    → 공개 (HMAC + IP 화이트리스트)
 */

import { Request, Response, NextFunction, Router, raw } from 'express';
import multer from 'multer';
import {
  authenticate,
  requireSuperAdmin,
  requireCompanyAdmin,
} from '../middlewares/auth';
import { query } from '../config/database';
import * as imc from '../utils/alimtalk-api';
import { ImcApiError } from '../utils/alimtalk-api';
import {
  processKakaoWebhook,
  verifyWebhookSignature,
  isAllowedWebhookIp,
  getRecentWebhookEvents,
} from '../utils/alimtalk-webhook-handler';
import { resolveImcCode } from '../utils/alimtalk-result-map';
import {
  syncCategoriesJob,
  syncPendingTemplatesJob,
  syncSenderStatusJob,
} from '../utils/alimtalk-jobs';

const router = Router();

// 메모리 스토리지 multer — 파일은 IMC로 즉시 스트림
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB 기본 (ALIMTALK-DESIGN.md §3-7 규격 참조)
});

// ════════════════════════════════════════════════════════════
// 공통 유틸
// ════════════════════════════════════════════════════════════

function handleImcError(res: Response, err: any): Response {
  if (err instanceof ImcApiError) {
    const mapped = resolveImcCode(err.code);
    const statusHttp =
      mapped.kind === 'user_error' || mapped.kind === 'inspect' ? 400
      : mapped.kind === 'retryable' ? 503
      : 500;
    // D131: IMC 에러 진단 — 실제 응답 body + httpStatus를 서버 로그에 찍어 원인 추적.
    // 기존에는 ImcApiError일 때 console 출력이 없어 pm2 로그로 원인 파악 불가.
    try {
      const bodyPreview =
        err.responseBody !== undefined
          ? JSON.stringify(err.responseBody).slice(0, 2000)
          : 'n/a';
      console.error(
        `[alimtalk][IMC ${err.code}] ${err.message} http=${err.httpStatus} kind=${mapped.kind} body=${bodyPreview}`,
      );
    } catch {
      console.error(`[alimtalk][IMC ${err.code}] ${err.message} http=${err.httpStatus}`);
    }
    return res.status(statusHttp).json({
      success: false,
      code: err.code,
      error: mapped.userMessage || err.message,
      kind: mapped.kind,
    });
  }
  console.error('[alimtalk] 처리 실패', err);
  return res.status(500).json({
    success: false,
    error: err?.message || '알 수 없는 오류',
  });
}

function requireCompany(req: Request, res: Response): string | null {
  const companyId = req.user?.companyId;
  if (!companyId) {
    res.status(401).json({ success: false, error: '인증 필요' });
    return null;
  }
  return companyId;
}

// ════════════════════════════════════════════════════════════
// 1) 공개: POST /webhook — 휴머스온 리포트 수신
// ════════════════════════════════════════════════════════════
// raw body parser가 HMAC 검증용으로 필요.

router.post(
  '/webhook',
  raw({ type: '*/*', limit: '10mb' }),
  async (req: Request, res: Response) => {
    try {
      const clientIp = (req.ip || req.socket?.remoteAddress || '').trim();
      if (!isAllowedWebhookIp(clientIp)) {
        console.warn('[alimtalk-webhook] IP 거부', clientIp);
        return res.status(403).json({ code: '403', message: 'FORBIDDEN_IP' });
      }

      const headerSig =
        (req.headers['x-imc-signature'] as string | undefined) ||
        (req.headers['x-signature'] as string | undefined) ||
        (req.headers['x-humuson-signature'] as string | undefined);

      const rawBuf: Buffer = req.body instanceof Buffer ? req.body : Buffer.from('');
      const rawStr = rawBuf.toString('utf8');

      const secret = process.env.IMC_WEBHOOK_HMAC_SECRET;
      // HMAC은 secret 설정된 경우에만 강제 (Phase 0 미수령 시 통과)
      if (secret) {
        const ok = verifyWebhookSignature(rawStr, headerSig, secret);
        if (!ok) {
          console.warn('[alimtalk-webhook] HMAC 불일치', clientIp);
          return res.status(401).json({ code: '401', message: 'INVALID_SIGNATURE' });
        }
      }

      const payload = JSON.parse(rawStr);
      const result = await processKakaoWebhook(payload);
      return res.json({ code: '0000', message: 'OK', ...result });
    } catch (err: any) {
      console.error('[alimtalk-webhook] 예외', err);
      return res.status(400).json({
        code: '400',
        message: err?.message || 'BAD_REQUEST',
      });
    }
  },
);

// ════════════════════════════════════════════════════════════
// 2) 이하 모든 경로 인증 필요
// ════════════════════════════════════════════════════════════

router.use(authenticate as any);

// ──────────────────────────────────────────────────────────
// 발신프로필 (Sender) — 11개, 슈퍼관리자 전용
// ──────────────────────────────────────────────────────────

// 인증번호 요청 — 고객사 관리자 OK (IMC가 카톡 인증으로 본인확인 보장)
router.post(
  '/senders/token',
  requireCompanyAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const { yellowId, phoneNumber } = req.body || {};
      if (!yellowId || !phoneNumber) {
        return res
          .status(400)
          .json({ success: false, error: 'yellowId와 phoneNumber는 필수입니다' });
      }
      const r = await imc.requestSenderToken({ yellowId, phoneNumber });
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// 발신프로필 등록 — 고객사 관리자 OK
// IMC 카톡 인증이 이미 본인확인 처리하므로, 고객사가 자체 등록 가능.
// targetCompanyId는 슈퍼관리자만 지정 가능 (다른 회사 귀속). 고객사는 본인 회사 자동 귀속.
router.post(
  '/senders',
  requireCompanyAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const {
        token,
        yellowId,
        phoneNumber,
        categoryCode,
        topSenderKeyYn,
        companyId: targetCompanyIdInBody,
        profileName,
      } = req.body || {};
      // D131: customSenderKey 파라미터 폐지. 휴머스온 IMC가 senderKey를 API로 자동 발급.

      if (!token || !yellowId || !phoneNumber || !categoryCode) {
        return res.status(400).json({
          success: false,
          error: 'token/yellowId/phoneNumber/categoryCode는 필수입니다',
        });
      }

      // 슈퍼관리자만 다른 회사 귀속 가능. 일반 고객사는 본인 회사 고정.
      const isSuperAdmin = req.user?.userType === 'super_admin';
      const targetCompanyId = isSuperAdmin
        ? targetCompanyIdInBody || req.user?.companyId
        : req.user?.companyId;

      if (!targetCompanyId) {
        return res.status(400).json({ success: false, error: 'companyId 필요' });
      }

      // D131: 동일 회사 내 동일 yellow_id 발신프로필 중복 등록 방지 (Harold님 지시).
      //       IMC 측에서 동일 채널로 재등록 시도해도 key가 바뀌어 DB에 row만 늘어나는 문제 방지.
      const dup = await query(
        `SELECT id, profile_key, approval_status, status
           FROM kakao_sender_profiles
          WHERE company_id = $1 AND yellow_id = $2
          LIMIT 1`,
        [targetCompanyId, yellowId],
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: `이미 등록된 발신프로필입니다 (${yellowId}). 기존 프로필을 사용하거나 삭제 후 재등록 하세요.`,
          existingProfileId: dup.rows[0].id,
        });
      }

      const r = await imc.createSender({
        token,
        yellowId,
        phoneNumber,
        categoryCode,
        topSenderKeyYn,
      });
      if (r.code !== '0000' || !r.data?.senderKey) {
        return res.status(400).json({ success: false, code: r.code, error: r.message });
      }

      // 카테고리 이름 캐시
      let categoryNameCache: string | null = null;
      try {
        const cat = await imc.getSenderCategory(categoryCode);
        if (cat.code === '0000' && cat.data) categoryNameCache = cat.data.name;
      } catch {
        /* 카테고리 조회 실패 무시 */
      }

      // 슈퍼관리자가 직접 등록한 경우 즉시 APPROVED, 고객사 등록은 PENDING_APPROVAL.
      const approvalStatus = isSuperAdmin ? 'APPROVED' : 'PENDING_APPROVAL';

      const ins = await query(
        `INSERT INTO kakao_sender_profiles
           (company_id, profile_key, profile_name, is_active,
            yellow_id, admin_phone_number, category_code, category_name_cache,
            top_sender_yn, custom_sender_key, status,
            approval_status, approval_requested_at,
            approved_at, approved_by,
            registered_at, updated_at)
         VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,
                 $11, now(),
                 $12, $13,
                 now(), now())
         RETURNING *`,
        [
          targetCompanyId,
          r.data.senderKey,
          profileName || yellowId,
          yellowId,
          phoneNumber,
          categoryCode,
          categoryNameCache,
          topSenderKeyYn || 'N',
          null, // D131: custom_sender_key 폐지 — IMC가 자동 발급
          r.data.status || 'NORMAL',
          approvalStatus,
          isSuperAdmin ? new Date() : null,
          isSuperAdmin ? req.user?.userId || null : null,
        ],
      );

      res.status(201).json({ success: true, profile: ins.rows[0], imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// ── 승인/반려 (슈퍼관리자 전용) ─────────────────────
router.put(
  '/senders/:id/approve',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const r = await query(
        `UPDATE kakao_sender_profiles
            SET approval_status = 'APPROVED',
                approved_at = now(),
                approved_by = $1,
                reject_reason = NULL,
                updated_at = now()
          WHERE id = $2
          RETURNING *`,
        [req.user?.userId || null, req.params.id],
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ success: false, error: '발신프로필 없음' });
      }
      res.json({ success: true, profile: r.rows[0] });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.put(
  '/senders/:id/reject',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const { rejectReason } = req.body || {};
      if (!rejectReason || String(rejectReason).trim().length < 3) {
        return res.status(400).json({
          success: false,
          error: '반려 사유(3자 이상)를 입력하세요',
        });
      }
      const r = await query(
        `UPDATE kakao_sender_profiles
            SET approval_status = 'REJECTED',
                reject_reason = $1,
                approved_at = NULL,
                approved_by = NULL,
                updated_at = now()
          WHERE id = $2
          RETURNING *`,
        [String(rejectReason).slice(0, 500), req.params.id],
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ success: false, error: '발신프로필 없음' });
      }
      res.json({ success: true, profile: r.rows[0] });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.get('/senders', async (req: Request, res: Response) => {
  try {
    const userType = req.user?.userType;
    let rows;
    if (userType === 'super_admin') {
      // 전체 목록 + 회사명 조인
      const r = await query(
        `SELECT p.*, c.company_name
           FROM kakao_sender_profiles p
           LEFT JOIN companies c ON c.id = p.company_id
          ORDER BY p.created_at DESC`,
      );
      rows = r.rows;
    } else {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      const r = await query(
        `SELECT p.* FROM kakao_sender_profiles p
          WHERE p.company_id = $1
          ORDER BY p.created_at DESC`,
        [companyId],
      );
      rows = r.rows;
    }
    res.json({ success: true, profiles: rows });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.get('/senders/:id', async (req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT * FROM kakao_sender_profiles WHERE id = $1`,
      [req.params.id],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: '발신프로필 없음' });
    }
    res.json({ success: true, profile: r.rows[0] });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.put(
  '/senders/:id/unsubscribe',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const { unsubscribePhoneNumber, unsubscribeAuthNumber } = req.body || {};
      if (!unsubscribePhoneNumber || !unsubscribeAuthNumber) {
        return res.status(400).json({
          success: false,
          error: '080번호와 인증번호가 필요합니다',
        });
      }
      const row = await query(
        `SELECT profile_key FROM kakao_sender_profiles WHERE id = $1`,
        [req.params.id],
      );
      if (row.rows.length === 0 || !row.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '발신프로필 없음' });
      }
      const r = await imc.updateSenderUnsubscribe(row.rows[0].profile_key, {
        unsubscribePhoneNumber,
        unsubscribeAuthNumber,
      });
      await query(
        `UPDATE kakao_sender_profiles
            SET unsubscribe_phone = $1,
                unsubscribe_auth  = $2,
                updated_at        = now()
          WHERE id = $3`,
        [unsubscribePhoneNumber, unsubscribeAuthNumber, req.params.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.put(
  '/senders/:id/custom-key',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const { customSenderKey } = req.body || {};
      if (!customSenderKey) {
        return res
          .status(400)
          .json({ success: false, error: 'customSenderKey는 필수입니다' });
      }
      const row = await query(
        `SELECT profile_key FROM kakao_sender_profiles WHERE id = $1`,
        [req.params.id],
      );
      if (row.rows.length === 0 || !row.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '발신프로필 없음' });
      }
      const r = await imc.updateCustomSenderKey(
        row.rows[0].profile_key,
        customSenderKey,
      );
      await query(
        `UPDATE kakao_sender_profiles
            SET custom_sender_key = $1, updated_at = now()
          WHERE id = $2`,
        [customSenderKey, req.params.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.put(
  '/senders/:id/release',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const row = await query(
        `SELECT profile_key FROM kakao_sender_profiles WHERE id = $1`,
        [req.params.id],
      );
      if (row.rows.length === 0 || !row.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '발신프로필 없음' });
      }
      const r = await imc.releaseSenderDormant(row.rows[0].profile_key);
      await query(
        `UPDATE kakao_sender_profiles SET status='NORMAL', updated_at=now() WHERE id=$1`,
        [req.params.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.post(
  '/senders/:id/brand-targeting',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const row = await query(
        `SELECT profile_key FROM kakao_sender_profiles WHERE id = $1`,
        [req.params.id],
      );
      if (row.rows.length === 0 || !row.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '발신프로필 없음' });
      }
      const r = await imc.applyBrandTargeting(row.rows[0].profile_key, req.body || {});
      await query(
        `UPDATE kakao_sender_profiles SET brand_targeting_yn='Y', updated_at=now() WHERE id=$1`,
        [req.params.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.get(
  '/senders/:id/brand-targeting-check',
  async (req: Request, res: Response) => {
    try {
      const row = await query(
        `SELECT profile_key FROM kakao_sender_profiles WHERE id = $1`,
        [req.params.id],
      );
      if (row.rows.length === 0 || !row.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '발신프로필 없음' });
      }
      const r = await imc.checkBrandTargeting(row.rows[0].profile_key);
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// ──────────────────────────────────────────────────────────
// 카테고리 (3개)
// ──────────────────────────────────────────────────────────

router.get('/categories/sender', async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT category_code, parent_code, level, name
         FROM kakao_sender_categories
        WHERE active_yn = 'Y'
        ORDER BY level ASC, category_code ASC`,
    );
    res.json({ success: true, categories: r.rows });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.get('/categories/template', async (_req: Request, res: Response) => {
  try {
    const r = await query(
      `SELECT category_code, name, group_name, inclusion, exclusion
         FROM kakao_template_categories
        WHERE active_yn = 'Y'
        ORDER BY group_name NULLS LAST, category_code ASC`,
    );
    res.json({ success: true, categories: r.rows });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.post(
  '/categories/sync',
  requireSuperAdmin as any,
  async (_req: Request, res: Response) => {
    try {
      await syncCategoriesJob();
      res.json({ success: true, message: '카테고리 동기화 요청 완료' });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// ──────────────────────────────────────────────────────────
// 알림톡 템플릿 (고객사) — 13개
// ──────────────────────────────────────────────────────────

router.get('/templates', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const { status, profileId } = req.query as any;
    const where = ['t.company_id = $1'];
    const params: any[] = [companyId];
    if (status) {
      params.push(status);
      where.push(`t.status = $${params.length}`);
    }
    if (profileId) {
      params.push(profileId);
      where.push(`t.profile_id = $${params.length}`);
    }
    // 소유자 필터: company_user는 본인 등록 템플릿만 (D130 §2-2)
    if (req.user?.userType === 'company_user') {
      params.push(req.user.userId);
      where.push(`t.created_by = $${params.length}`);
    }
    const r = await query(
      `SELECT t.*, p.profile_key, p.profile_name,
              u.name AS created_by_name, u.login_id AS created_by_login_id
         FROM kakao_templates t
         LEFT JOIN kakao_sender_profiles p ON p.id = t.profile_id
         LEFT JOIN users u ON u.id = t.created_by
        WHERE ${where.join(' AND ')}
        ORDER BY t.updated_at DESC NULLS LAST, t.created_at DESC`,
      params,
    );
    res.json({ success: true, templates: r.rows });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// 템플릿 등록: 고객사관리자(admin)만 허용 (Harold님 지시 2026-04-21)
//   기존 D130 §2-2 "모든 로그인 사용자 허용" 정책 폐기.
//   사유: 발신프로필과 동일한 관리 단위로 통일 (/senders/token, /senders = requireCompanyAdmin).
//   기존에 company_user가 등록한 템플릿은 소유자 체크(requireTemplateAccess)로 조회/수정/삭제만 가능.
router.post(
  '/templates',
  requireCompanyAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      const userId = req.user?.userId;
      if (!userId) {
        return res.status(401).json({ success: false, error: '인증 필요' });
      }
      const { profileId, ...body } = req.body || {};
      if (!profileId) {
        return res.status(400).json({ success: false, error: 'profileId는 필수입니다' });
      }

      // 승인된 발신프로필만 사용 허용 (D130 §2-1)
      const prof = await query(
        `SELECT profile_key, approval_status FROM kakao_sender_profiles
          WHERE id = $1 AND company_id = $2`,
        [profileId, companyId],
      );
      if (prof.rows.length === 0 || !prof.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '발신프로필 없음' });
      }
      if (prof.rows[0].approval_status !== 'APPROVED') {
        return res.status(400).json({
          success: false,
          error: '승인 완료된 발신프로필만 사용할 수 있습니다',
        });
      }
      const senderKey = prof.rows[0].profile_key;
      // D131: IMC 실제 제한은 templateKey **최대 20자** (공식 문서 오표기 128자 → 휴머스온 확인됨 2026-04-21).
      //       과거 생성 규칙(`TPL_${companyId12}_${timestamp}` = 29자)이 IMC 6005 유발.
      //       `T{base36 timestamp(~9)}{base36 random(10)}` = 20자 고정, 충돌 가능성 사실상 0.
      const rawKey = typeof body.templateKey === 'string' ? body.templateKey.trim() : '';
      if (rawKey && rawKey.length > 20) {
        return res.status(400).json({
          success: false,
          error: 'templateKey는 최대 20자까지 허용됩니다 (IMC 제한)',
        });
      }
      const templateKey: string =
        rawKey ||
        `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.slice(0, 20);

      const r = await imc.createAlimtalkTemplate(senderKey, {
        ...body,
        templateKey,
      });
      if (r.code !== '0000' || !r.data?.templateCode) {
        return res.status(400).json({ success: false, code: r.code, error: r.message });
      }

      const ins = await query(
        `INSERT INTO kakao_templates
           (company_id, profile_id, template_code, template_key, template_name,
            content, buttons, variables, status,
            category, message_type, emphasize_type, emphasize_title, emphasize_subtitle,
            image_name, extra_content, ad_content, security_flag, quick_replies,
            template_header, item_highlight, item_list, item_summary, represent_link,
            preview_message, alarm_phone_numbers, service_mode, custom_template_code,
            created_by, created_at, updated_at, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text[],'REQUESTED',
                 $9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,
                 $19,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,
                 $24,$25,$26,$27,$28,now(),now(),now())
         RETURNING *`,
        [
          companyId,
          profileId,
          r.data.templateCode,
          templateKey,
          body.manageName,
          body.templateContent,
          JSON.stringify(body.buttonList || []),
          body.variables || [],
          body.categoryCode,
          body.templateMessageType,
          body.templateEmphasizeType,
          body.templateTitle || null,
          body.templateSubtitle || null,
          body.templateImageName || null,
          body.templateExtra || null,
          body.adContent || null,
          body.securityFlag || false,
          JSON.stringify(body.quickReplyList || []),
          body.templateHeader || null,
          body.templateItemHighlight
            ? JSON.stringify(body.templateItemHighlight)
            : null,
          body.templateItem?.list ? JSON.stringify(body.templateItem.list) : null,
          body.templateItem?.summary
            ? JSON.stringify(body.templateItem.summary)
            : null,
          body.templateRepresentLink
            ? JSON.stringify(body.templateRepresentLink)
            : null,
          body.templatePreviewMessage || null,
          body.alarmPhoneNumber || null,
          body.serviceMode || 'PRD',
          body.customTemplateCode || null,
          userId,
        ],
      );

      res.status(201).json({ success: true, template: ins.rows[0], imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// 공용 헬퍼: templateCode → {senderKey, id, createdBy} 찾기
// user 정보가 전달되면 company_user는 본인 소유만 접근 허용 (소유자 체크 D130)
type TemplateCtx = { senderKey: string; id: string; createdBy: string | null };

async function resolveTemplateContext(
  companyId: string,
  templateCode: string,
  user?: { userId: string; userType: string } | undefined,
): Promise<TemplateCtx | null | 'forbidden'> {
  const r = await query(
    `SELECT t.id, t.created_by, p.profile_key
       FROM kakao_templates t
       JOIN kakao_sender_profiles p ON p.id = t.profile_id
      WHERE t.template_code = $1 AND t.company_id = $2`,
    [templateCode, companyId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (user?.userType === 'company_user' && row.created_by !== user.userId) {
    return 'forbidden';
  }
  return { senderKey: row.profile_key, id: row.id, createdBy: row.created_by };
}

// 컨트롤타워: 템플릿 접근 체크 + companyId 확보 + 404/403 응답 일원화 (D130)
// 호출부에서 companyId 추출 + resolveTemplateContext 2단계 반복을 단일 호출로 통합
async function requireTemplateAccess(
  req: Request,
  res: Response,
): Promise<({ companyId: string } & TemplateCtx) | null> {
  const companyId = requireCompany(req, res);
  if (!companyId) return null;
  const ctx = await resolveTemplateContext(
    companyId,
    req.params.templateCode,
    req.user,
  );
  if (ctx === null) {
    res.status(404).json({ success: false, error: '템플릿 없음' });
    return null;
  }
  if (ctx === 'forbidden') {
    res.status(403).json({
      success: false,
      error: '본인이 등록한 템플릿만 접근할 수 있습니다',
    });
    return null;
  }
  return { companyId, ...ctx };
}

router.get('/templates/:templateCode', async (req: Request, res: Response) => {
  try {
    const ctx = await requireTemplateAccess(req, res);
    if (!ctx) return;

    // IMC 최신 상태 동기화
    try {
      const r = await imc.getAlimtalkTemplate(ctx.senderKey, req.params.templateCode);
      if (r.code === '0000' && r.data) {
        await query(
          `UPDATE kakao_templates
              SET status = $1, last_synced_at = now()
            WHERE id = $2`,
          [(r.data as any).status || 'UNKNOWN', ctx.id],
        );
      }
    } catch {
      /* IMC 실패 시 DB 값으로 폴백 */
    }

    const row = await query(
      `SELECT t.*, p.profile_key, p.profile_name,
              u.name AS created_by_name, u.login_id AS created_by_login_id
         FROM kakao_templates t
         LEFT JOIN kakao_sender_profiles p ON p.id = t.profile_id
         LEFT JOIN users u ON u.id = t.created_by
        WHERE t.id = $1`,
      [ctx.id],
    );
    res.json({ success: true, template: row.rows[0] });
  } catch (err) {
    return handleImcError(res, err);
  }
});

// 템플릿 수정: 본인 소유 + company_admin/super_admin (D130 §2-2, requireTemplateAccess 내 체크)
router.put(
  '/templates/:templateCode',
  async (req: Request, res: Response) => {
    try {
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const r = await imc.updateAlimtalkTemplate(
        ctx.senderKey,
        req.params.templateCode,
        req.body || {},
      );
      await query(
        `UPDATE kakao_templates SET updated_at=now(), last_synced_at=now() WHERE id=$1`,
        [ctx.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.delete(
  '/templates/:templateCode',
  async (req: Request, res: Response) => {
    try {
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const r = await imc.deleteAlimtalkTemplate(ctx.senderKey, req.params.templateCode);
      await query(
        `UPDATE kakao_templates SET status='DELETED', updated_at=now() WHERE id=$1`,
        [ctx.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.post(
  '/templates/:templateCode/inspect',
  async (req: Request, res: Response) => {
    try {
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const r = await imc.requestInspection(
        ctx.senderKey,
        req.params.templateCode,
        req.body?.comment,
      );
      await query(
        `UPDATE kakao_templates
            SET status='REQUESTED', requested_at=now(), updated_at=now()
          WHERE id=$1`,
        [ctx.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.post(
  '/templates/:templateCode/inspect-with-file',
  upload.single('file'),
  async (req: Request, res: Response) => {
    try {
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const file = (req as any).file;
      if (!file) {
        return res.status(400).json({ success: false, error: '첨부파일이 필요합니다' });
      }
      const r = await imc.requestInspectionWithFile(
        ctx.senderKey,
        req.params.templateCode,
        req.body?.comment || '',
        file.buffer,
        file.originalname,
      );
      await query(
        `UPDATE kakao_templates
            SET status='REQUESTED', requested_at=now(), updated_at=now()
          WHERE id=$1`,
        [ctx.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.put(
  '/templates/:templateCode/cancel-inspect',
  async (req: Request, res: Response) => {
    try {
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const r = await imc.cancelInspection(ctx.senderKey, req.params.templateCode);
      await query(
        `UPDATE kakao_templates SET status='DRAFT', updated_at=now() WHERE id=$1`,
        [ctx.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.put(
  '/templates/:templateCode/release',
  async (req: Request, res: Response) => {
    try {
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const r = await imc.releaseTemplateDormant(ctx.senderKey, req.params.templateCode);
      await query(
        `UPDATE kakao_templates SET status='APPROVED', updated_at=now() WHERE id=$1`,
        [ctx.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.patch(
  '/templates/:templateCode/custom-code',
  async (req: Request, res: Response) => {
    try {
      const { customTemplateCode } = req.body || {};
      if (!customTemplateCode) {
        return res.status(400).json({
          success: false,
          error: 'customTemplateCode는 필수입니다',
        });
      }
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const r = await imc.updateCustomCode(
        ctx.senderKey,
        req.params.templateCode,
        customTemplateCode,
      );
      await query(
        `UPDATE kakao_templates SET custom_template_code=$1, updated_at=now() WHERE id=$2`,
        [customTemplateCode, ctx.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.patch(
  '/templates/:templateCode/exposure',
  async (req: Request, res: Response) => {
    try {
      const { exposureYn } = req.body || {};
      if (exposureYn !== 'Y' && exposureYn !== 'N') {
        return res.status(400).json({ success: false, error: 'exposureYn는 Y/N' });
      }
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const r = await imc.updateExposure(
        ctx.senderKey,
        req.params.templateCode,
        exposureYn,
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.patch(
  '/templates/:templateCode/service-mode',
  async (req: Request, res: Response) => {
    try {
      const { serviceMode } = req.body || {};
      if (serviceMode !== 'PRD' && serviceMode !== 'STG') {
        return res.status(400).json({ success: false, error: 'serviceMode는 PRD/STG' });
      }
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const r = await imc.updateServiceMode(
        ctx.senderKey,
        req.params.templateCode,
        serviceMode,
      );
      await query(
        `UPDATE kakao_templates SET service_mode=$1, updated_at=now() WHERE id=$2`,
        [serviceMode, ctx.id],
      );
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// ──────────────────────────────────────────────────────────
// 브랜드메시지 템플릿 — 5개
// ──────────────────────────────────────────────────────────

router.get('/brand-templates', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const r = await query(
      `SELECT b.*, p.profile_key, p.profile_name
         FROM brand_message_templates b
         LEFT JOIN kakao_sender_profiles p ON p.id = b.profile_id
        WHERE b.company_id = $1 AND b.status = 'ACTIVE'
        ORDER BY b.updated_at DESC`,
      [companyId],
    );
    res.json({ success: true, templates: r.rows });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.post(
  '/brand-templates',
  requireCompanyAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      const { profileId, ...body } = req.body || {};
      const prof = await query(
        `SELECT profile_key FROM kakao_sender_profiles
          WHERE id = $1 AND company_id = $2`,
        [profileId, companyId],
      );
      if (prof.rows.length === 0 || !prof.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '발신프로필 없음' });
      }

      const templateKey: string =
        body.templateKey ||
        `BRT_${companyId.replace(/-/g, '').slice(0, 12)}_${Date.now()}`;

      const r = await imc.createBrandTemplate(prof.rows[0].profile_key, {
        ...body,
        templateKey,
      });
      if (r.code !== '0000') {
        return res.status(400).json({ success: false, code: r.code, error: r.message });
      }

      const ins = await query(
        `INSERT INTO brand_message_templates
           (company_id, profile_id, template_key, custom_template_code,
            manage_name, chat_bubble_type, adult_yn,
            header, content, additional_content,
            attachment, carousel, buttons, coupon, variables,
            status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,
                 $13::jsonb,$14::jsonb,$15::text[],'ACTIVE',now(),now())
         RETURNING *`,
        [
          companyId,
          profileId,
          templateKey,
          body.customTemplateCode || null,
          body.manageName,
          body.chatBubbleType,
          body.adult || 'N',
          body.header || null,
          body.content || null,
          body.additionalContent || null,
          body.attachment ? JSON.stringify(body.attachment) : null,
          body.carousel ? JSON.stringify(body.carousel) : null,
          JSON.stringify(body.buttons || []),
          body.coupon ? JSON.stringify(body.coupon) : null,
          body.variables || [],
        ],
      );

      res.status(201).json({ success: true, template: ins.rows[0], imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.get('/brand-templates/:templateKey', async (req: Request, res: Response) => {
  try {
    const companyId = requireCompany(req, res);
    if (!companyId) return;
    const r = await query(
      `SELECT b.*, p.profile_key FROM brand_message_templates b
         LEFT JOIN kakao_sender_profiles p ON p.id = b.profile_id
        WHERE b.template_key = $1 AND b.company_id = $2`,
      [req.params.templateKey, companyId],
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ success: false, error: '템플릿 없음' });
    }
    res.json({ success: true, template: r.rows[0] });
  } catch (err) {
    return handleImcError(res, err);
  }
});

router.put(
  '/brand-templates/:templateKey',
  requireCompanyAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      const r = await query(
        `SELECT b.id, p.profile_key FROM brand_message_templates b
           JOIN kakao_sender_profiles p ON p.id = b.profile_id
          WHERE b.template_key = $1 AND b.company_id = $2`,
        [req.params.templateKey, companyId],
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ success: false, error: '템플릿 없음' });
      }
      const imcRes = await imc.updateBrandBasicTemplate(r.rows[0].profile_key, {
        templateKey: req.params.templateKey,
        ...(req.body || {}),
      });
      await query(
        `UPDATE brand_message_templates SET updated_at=now() WHERE id=$1`,
        [r.rows[0].id],
      );
      res.json({ success: imcRes.code === '0000', imc: imcRes });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.delete(
  '/brand-templates/:templateKey',
  requireCompanyAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      const r = await query(
        `SELECT b.id, p.profile_key FROM brand_message_templates b
           JOIN kakao_sender_profiles p ON p.id = b.profile_id
          WHERE b.template_key = $1 AND b.company_id = $2`,
        [req.params.templateKey, companyId],
      );
      if (r.rows.length === 0) {
        return res.status(404).json({ success: false, error: '템플릿 없음' });
      }
      const imcRes = await imc.deleteBrandTemplate(
        r.rows[0].profile_key,
        req.params.templateKey,
      );
      await query(
        `UPDATE brand_message_templates
            SET status='DELETED', deleted_at=now(), updated_at=now()
          WHERE id=$1`,
        [r.rows[0].id],
      );
      res.json({ success: imcRes.code === '0000', imc: imcRes });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// ──────────────────────────────────────────────────────────
// 이미지 업로드 — 9개
// ──────────────────────────────────────────────────────────

async function persistImage(
  req: Request,
  uploadType: string,
  r: imc.ImcResponse<imc.ImageUploadResult>,
  file?: Express.Multer.File,
) {
  if (!r?.data?.imageName) return;
  await query(
    `INSERT INTO kakao_image_uploads
       (company_id, user_id, upload_type, image_name, image_url,
        original_filename, file_size, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
    [
      req.user?.companyId || null,
      req.user?.userId || null,
      uploadType,
      r.data.imageName,
      r.data.imageUrl,
      file?.originalname || null,
      file?.size || null,
    ],
  );
}

function requireFile(req: Request, res: Response): Express.Multer.File | null {
  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ success: false, error: '파일이 필요합니다' });
    return null;
  }
  return file;
}

function requireFiles(req: Request, res: Response): Express.Multer.File[] | null {
  const files = (req as any).files;
  if (!files || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ success: false, error: '파일이 필요합니다' });
    return null;
  }
  return files;
}

// (1) 알림톡 기본 이미지
router.post(
  '/images/alimtalk/template',
  requireCompanyAdmin as any,
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const file = requireFile(req, res); if (!file) return;
      const r = await imc.uploadAlimtalkTemplateImage(file.buffer, file.originalname);
      await persistImage(req, 'alimtalk_template', r, file);
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) { return handleImcError(res, err); }
  },
);

// (2) 알림톡 하이라이트 이미지
router.post(
  '/images/alimtalk/highlight',
  requireCompanyAdmin as any,
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const file = requireFile(req, res); if (!file) return;
      const r = await imc.uploadAlimtalkHighlightImage(file.buffer, file.originalname);
      await persistImage(req, 'alimtalk_highlight', r, file);
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) { return handleImcError(res, err); }
  },
);

// (3) 브랜드 기본 이미지
router.post(
  '/images/brand/default',
  requireCompanyAdmin as any,
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const file = requireFile(req, res); if (!file) return;
      const r = await imc.uploadBrandDefaultImage(file.buffer, file.originalname);
      await persistImage(req, 'brand_default', r, file);
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) { return handleImcError(res, err); }
  },
);

// (4) 브랜드 와이드
router.post(
  '/images/brand/wide',
  requireCompanyAdmin as any,
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const file = requireFile(req, res); if (!file) return;
      const r = await imc.uploadBrandWideImage(file.buffer, file.originalname);
      await persistImage(req, 'brand_wide', r, file);
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) { return handleImcError(res, err); }
  },
);

// (5) 브랜드 와이드 리스트 첫 이미지
router.post(
  '/images/brand/wide-list/first',
  requireCompanyAdmin as any,
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const file = requireFile(req, res); if (!file) return;
      const r = await imc.uploadBrandWideListFirstImage(file.buffer, file.originalname);
      await persistImage(req, 'brand_wide_list_first', r, file);
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) { return handleImcError(res, err); }
  },
);

// (6) 브랜드 와이드 리스트 (최대 3장)
router.post(
  '/images/brand/wide-list',
  requireCompanyAdmin as any,
  upload.array('images', 3),
  async (req: Request, res: Response) => {
    try {
      const files = requireFiles(req, res); if (!files) return;
      const r = await imc.uploadBrandWideListImages(
        files.map((f) => ({ buffer: f.buffer, name: f.originalname })),
      );
      if (r.code === '0000' && r.data?.list) {
        for (let i = 0; i < r.data.list.length; i++) {
          await persistImage(
            req,
            'brand_wide_list',
            { code: '0000', message: 'OK', data: r.data.list[i] },
            files[i],
          );
        }
      }
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) { return handleImcError(res, err); }
  },
);

// (7) 브랜드 캐러셀 피드 (최대 10장)
router.post(
  '/images/brand/carousel-feed',
  requireCompanyAdmin as any,
  upload.array('images', 10),
  async (req: Request, res: Response) => {
    try {
      const files = requireFiles(req, res); if (!files) return;
      const r = await imc.uploadBrandCarouselFeedImages(
        files.map((f) => ({ buffer: f.buffer, name: f.originalname })),
      );
      if (r.code === '0000' && r.data?.list) {
        for (let i = 0; i < r.data.list.length; i++) {
          await persistImage(
            req,
            'brand_carousel_feed',
            { code: '0000', message: 'OK', data: r.data.list[i] },
            files[i],
          );
        }
      }
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) { return handleImcError(res, err); }
  },
);

// (8) 브랜드 캐러셀 커머스 (최대 11장)
router.post(
  '/images/brand/carousel-commerce',
  requireCompanyAdmin as any,
  upload.array('images', 11),
  async (req: Request, res: Response) => {
    try {
      const files = requireFiles(req, res); if (!files) return;
      const r = await imc.uploadBrandCarouselCommerceImages(
        files.map((f) => ({ buffer: f.buffer, name: f.originalname })),
      );
      if (r.code === '0000' && r.data?.list) {
        for (let i = 0; i < r.data.list.length; i++) {
          await persistImage(
            req,
            'brand_carousel_commerce',
            { code: '0000', message: 'OK', data: r.data.list[i] },
            files[i],
          );
        }
      }
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) { return handleImcError(res, err); }
  },
);

// (9) 마케팅 동의 증적자료
router.post(
  '/images/marketing-agree/:senderId',
  requireSuperAdmin as any,
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      const file = requireFile(req, res); if (!file) return;
      const row = await query(
        `SELECT profile_key FROM kakao_sender_profiles WHERE id = $1`,
        [req.params.senderId],
      );
      if (row.rows.length === 0 || !row.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '발신프로필 없음' });
      }
      const r = await imc.uploadMarketingAgreeFile(
        row.rows[0].profile_key,
        file.buffer,
        file.originalname,
      );
      await query(
        `UPDATE kakao_sender_profiles
            SET marketing_agree_file_key = $1, updated_at = now()
          WHERE id = $2`,
        [r?.data?.imageName || null, req.params.senderId],
      );
      await persistImage(req, 'marketing_agree', r, file);
      res.json({ success: r.code === '0000', imc: r });
    } catch (err) { return handleImcError(res, err); }
  },
);

// ──────────────────────────────────────────────────────────
// 검수 알림 수신자 (Alarm Users) — 4개
// ──────────────────────────────────────────────────────────

router.get(
  '/alarm-users',
  requireCompanyAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      // DB 1차 조회 + IMC 싱크는 추후
      const r = await query(
        `SELECT * FROM kakao_alarm_users
          WHERE company_id = $1
          ORDER BY created_at DESC`,
        [companyId],
      );
      res.json({ success: true, users: r.rows });
    } catch (err) { return handleImcError(res, err); }
  },
);

router.post(
  '/alarm-users',
  requireCompanyAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      const { name, phoneNumber, activeYn } = req.body || {};
      if (!phoneNumber) {
        return res.status(400).json({ success: false, error: 'phoneNumber 필수' });
      }
      // D131: IMC 스펙상 name은 required (10_56_14_문자 관리.txt).
      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, error: '수신자 이름은 필수입니다' });
      }
      // D131: 회사당 3명 제한 (Harold님 지시, IMC 정책 10명 대비 한줄로는 3명으로 제한)
      const cnt = await query(
        `SELECT COUNT(*)::int AS c FROM kakao_alarm_users
          WHERE company_id = $1 AND COALESCE(active_yn,'Y') = 'Y'`,
        [companyId],
      );
      if ((cnt.rows[0]?.c ?? 0) >= 3 && (activeYn || 'Y') === 'Y') {
        return res.status(400).json({
          success: false,
          error: '활성 알림 수신자는 최대 3명까지 등록 가능합니다',
        });
      }
      // ★ IMC 실제 스펙 검증 (10_56_14_문자 관리.txt):
      //   등록 body 필수: alarmUserKey(고객사 발번) + name + phoneNumber + activeYn
      //   alarmUserKey를 고객사가 지정해서 보내야 함. 우리 DB company_id + phone_number로 생성.
      const alarmUserKey = `${companyId.replace(/-/g, '').slice(0, 12)}_${phoneNumber}`;
      const imcRes = await imc.createAlarmUser({
        alarmUserKey,
        name,
        phoneNumber,
        activeYn: activeYn || 'Y',
      });
      if (imcRes.code !== '0000') {
        return res.status(400).json({
          success: false,
          code: imcRes.code,
          error: imcRes.message,
        });
      }
      const ins = await query(
        `INSERT INTO kakao_alarm_users
           (company_id, name, phone_number, active_yn, imc_alarm_user_id)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (company_id, phone_number) DO UPDATE SET
           name = EXCLUDED.name,
           active_yn = EXCLUDED.active_yn,
           imc_alarm_user_id = EXCLUDED.imc_alarm_user_id,
           updated_at = now()
         RETURNING *`,
        [companyId, name || null, phoneNumber, activeYn || 'Y', alarmUserKey],
      );
      res.status(201).json({ success: true, user: ins.rows[0], imc: imcRes });
    } catch (err) { return handleImcError(res, err); }
  },
);

router.put(
  '/alarm-users/:id',
  requireCompanyAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      const row = await query(
        `SELECT imc_alarm_user_id FROM kakao_alarm_users
          WHERE id = $1 AND company_id = $2`,
        [req.params.id, companyId],
      );
      if (row.rows.length === 0 || !row.rows[0].imc_alarm_user_id) {
        return res.status(404).json({ success: false, error: '수신자 없음' });
      }
      const imcRes = await imc.updateAlarmUser(
        row.rows[0].imc_alarm_user_id,
        req.body || {},
      );
      const { name, phoneNumber, activeYn } = req.body || {};
      await query(
        `UPDATE kakao_alarm_users
            SET name = COALESCE($1,name),
                phone_number = COALESCE($2,phone_number),
                active_yn = COALESCE($3,active_yn),
                updated_at = now()
          WHERE id = $4`,
        [name, phoneNumber, activeYn, req.params.id],
      );
      res.json({ success: imcRes.code === '0000', imc: imcRes });
    } catch (err) { return handleImcError(res, err); }
  },
);

router.delete(
  '/alarm-users/:id',
  requireCompanyAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const companyId = requireCompany(req, res);
      if (!companyId) return;
      const row = await query(
        `SELECT imc_alarm_user_id FROM kakao_alarm_users
          WHERE id = $1 AND company_id = $2`,
        [req.params.id, companyId],
      );
      if (row.rows.length === 0 || !row.rows[0].imc_alarm_user_id) {
        return res.status(404).json({ success: false, error: '수신자 없음' });
      }
      const imcRes = await imc.deleteAlarmUser(row.rows[0].imc_alarm_user_id);
      await query(`DELETE FROM kakao_alarm_users WHERE id = $1`, [req.params.id]);
      res.json({ success: imcRes.code === '0000', imc: imcRes });
    } catch (err) { return handleImcError(res, err); }
  },
);

// ──────────────────────────────────────────────────────────
// 운영 진단 — 슈퍼관리자
// ──────────────────────────────────────────────────────────

router.get(
  '/webhook-events',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
      const rows = await getRecentWebhookEvents(limit);
      res.json({ success: true, events: rows });
    } catch (err) { return handleImcError(res, err); }
  },
);

router.post(
  '/jobs/sync-pending-templates',
  requireSuperAdmin as any,
  async (_req: Request, res: Response) => {
    try {
      await syncPendingTemplatesJob();
      res.json({ success: true });
    } catch (err) { return handleImcError(res, err); }
  },
);

router.post(
  '/jobs/sync-sender-status',
  requireSuperAdmin as any,
  async (_req: Request, res: Response) => {
    try {
      await syncSenderStatusJob();
      res.json({ success: true });
    } catch (err) { return handleImcError(res, err); }
  },
);

export default router;
