/**
 * /api/alimtalk/* — IMC 연동 라우트
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
import { ImcApiError, extractImageFromAnyShape } from '../utils/alimtalk-api';
import {
  processKakaoWebhook,
  verifyWebhookSignature,
  isAllowedWebhookIp,
  getRecentWebhookEvents,
} from '../utils/alimtalk-webhook-handler';
import { resolveImcCode } from '../utils/alimtalk-result-map';
// ★ D217+ (2026-05-26 Harold 명시 진단 영역 정정): 옛 Tmp_xxx 영역 = 진정 카카오 templateCode 영역 동기화
import { syncTemplateCodes, syncSingleTemplateCode } from '../utils/kakao-template-sync';
import { normalizeImcTemplateStatus } from '../utils/alimtalk-jobs';
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
      error: mapped.userMessage || sanitizeImcMessageForUser(err.message, err.code),
      kind: mapped.kind,
    });
  }
  console.error('[alimtalk] 처리 실패', err);
  return res.status(500).json({
    success: false,
    error: sanitizeImcMessageForUser(err?.message, undefined, '알 수 없는 오류'),
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
// 1) 공개: POST /webhook — IMC 리포트 수신
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
      // D131: customSenderKey 파라미터 폐지. IMC가 senderKey를 API로 자동 발급.

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
        return res.status(400).json({
          success: false,
          code: r.code,
          error: sanitizeImcMessageForUser(r.message, r.code, '발신프로필 등록에 실패했습니다'),
        });
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

// ── 슈퍼관리자 디버그: 우리 IMC 계정의 발신프로필 "목록" raw 조회 (채널명 검색)
//    ★2026-07-30 신설 — 옛 senderKey로 getSender를 부르면 4011만 나와서 "이관 때 키가 새로 발급된 것"과
//    "이관이 우리 계정에 반영되지 않은 것"을 가릴 수 없다(아이올리 다우 4키 전부 4011 실측).
//    계정에 실제로 무엇이 있는지는 목록으로만 확인된다. listSenders CT는 있었는데 소비처가 0이었다.
//    DB 무접촉(read-only)·응답은 계정 판별용이라 IMC 원문 그대로(super_admin 전용).
//    `/senders/:id`보다 앞에 배치 — 뒤에 두면 id='imc'로 가로채인다 (D162-4 교훈).
router.get('/senders/imc', requireSuperAdmin as any, async (req: Request, res: Response) => {
  const nameRaw = typeof req.query.name === 'string' ? req.query.name.trim() : '';
  const pageNum = Number(req.query.page);
  const sizeNum = Number(req.query.size);
  const params: { name?: string; page?: number; size?: number } = {};
  if (nameRaw) params.name = nameRaw;
  if (Number.isFinite(pageNum) && pageNum > 0) params.page = Math.floor(pageNum);
  // 목록이 커도 터미널에서 잘라 보므로 상한을 둔다(운영 조회용 디버그 endpoint).
  if (Number.isFinite(sizeNum) && sizeNum > 0) params.size = Math.min(Math.floor(sizeNum), 100);
  try {
    const r = await imc.listSenders(params);
    console.log(
      `[alimtalk][debug-listSenders] name=${nameRaw || '-'} code=${r.code} total=${r.data?.total} count=${r.data?.list?.length ?? 0}`,
    );
    return res.json({ success: true, imc: r });
  } catch (err: any) {
    if (err instanceof ImcApiError) {
      console.log(
        `[alimtalk][debug-listSenders] name=${nameRaw || '-'} 실패 code=${err.code} http=${err.httpStatus}`,
      );
      return res.json({
        success: false,
        imcCode: err.code,
        httpStatus: err.httpStatus,
        responseBody: err.responseBody ?? null,
        message: err.message,
      });
    }
    return handleImcError(res, err);
  }
});

// ── 슈퍼관리자 디버그: 임의 senderKey IMC 발신프로필 raw 1콜 조회
//    Track B 관문 1 실측용 (docs/2026-07-14-template-migration-track-bc-design.md §5-1).
//    kakao_sender_profiles 미등록 키도 IMC에 직접 조회 — 우리 IMC 계정에서 보이는지(같은 계정 소속)를 확인한다.
//    DB 무접촉(read-only). 응답은 계정 판별에 필요하므로 sanitize 없이 IMC 원문 그대로(super_admin 전용).
//    `/senders/:id`보다 앞에 배치 — 명시 path가 param 라우트에 가로채이지 않도록 (D162-4 교훈).
router.get(
  '/senders/imc/:senderKey',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    const senderKey = String(req.params.senderKey || '').trim();
    // URL path 세그먼트로 들어가므로 영숫자·-·_만 허용 (슬래시/점 주입 차단, 레거시 짧은 키 허용)
    if (!/^[0-9A-Za-z_-]{8,64}$/.test(senderKey)) {
      return res
        .status(400)
        .json({ success: false, error: 'senderKey 형식 오류: 영숫자 8~64자' });
    }
    try {
      const r = await imc.getSender(senderKey);
      console.log(
        `[alimtalk][debug-getSender] key=${senderKey} code=${r.code} status=${r.data?.status} name=${r.data?.name} uuid=${r.data?.uuid}`,
      );
      return res.json({ success: true, imc: r });
    } catch (err: any) {
      if (err instanceof ImcApiError) {
        console.log(
          `[alimtalk][debug-getSender] key=${senderKey} 실패 code=${err.code} http=${err.httpStatus}`,
        );
        return res.json({
          success: false,
          imcCode: err.code,
          httpStatus: err.httpStatus,
          responseBody: err.responseBody ?? null,
          message: err.message,
        });
      }
      return handleImcError(res, err);
    }
  },
);

// ── 슈퍼관리자 import ①: 기존 IMC 발신프로필을 한줄로 회사에 연결 (Track B-1)
//    카톡인증 신규 등록(POST /senders)과 달리, IMC에 이미 존재·승인된 프로필의 "연결"만 수행.
//    IMC 실조회(0000) 확인 후에만 INSERT — 컬럼은 기존 등록 경로·1h 워커에서 운영 검증된 집합만 사용(DDL 0).
router.post(
  '/senders/import',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const companyId = String(req.body?.companyId || '').trim();
      const senderKey = String(req.body?.senderKey || '').trim();
      const profileNameInput = String(req.body?.profileName || '').trim();

      if (!/^[0-9a-f-]{36}$/i.test(companyId)) {
        return res.status(400).json({ success: false, error: 'companyId(uuid) 필요' });
      }
      if (!/^[0-9A-Za-z_-]{8,64}$/.test(senderKey)) {
        return res
          .status(400)
          .json({ success: false, error: 'senderKey 형식 오류: 영숫자 8~64자' });
      }

      const comp = await query(
        `SELECT id, company_name FROM companies WHERE id = $1::uuid LIMIT 1`,
        [companyId],
      );
      if (comp.rows.length === 0) {
        return res.status(404).json({ success: false, error: '회사 없음' });
      }

      // 중복 연결 가드 — profile_key는 전역 1회만 연결 (unique 제약이 없어 코드 가드)
      const dupKey = await query(
        `SELECT p.id, p.company_id, c.company_name
           FROM kakao_sender_profiles p
           LEFT JOIN companies c ON c.id = p.company_id
          WHERE p.profile_key = $1
          LIMIT 1`,
        [senderKey],
      );
      if (dupKey.rows.length > 0) {
        return res.status(409).json({
          success: false,
          error: `이미 연결된 senderKey입니다 (회사: ${dupKey.rows[0].company_name || dupKey.rows[0].company_id})`,
          existingProfileId: dupKey.rows[0].id,
        });
      }

      // IMC 실조회 — 존재·우리 계정 소속 확인 후에만 연결
      const r = await imc.getSender(senderKey);
      if (r.code !== '0000' || !r.data?.senderKey) {
        return res.status(400).json({
          success: false,
          code: r.code,
          error: 'IMC 조회 실패: 우리 계정에서 보이지 않는 senderKey',
          imc: r,
        });
      }
      const d = r.data;

      // 동일 회사+채널 중복 가드 (idx_ksp_yellow_id unique 선방어 — 신규 등록 경로와 동일 정책)
      if (d.uuid) {
        const dupChannel = await query(
          `SELECT id FROM kakao_sender_profiles
            WHERE company_id = $1 AND yellow_id = $2
            LIMIT 1`,
          [companyId, d.uuid],
        );
        if (dupChannel.rows.length > 0) {
          return res.status(409).json({
            success: false,
            error: `같은 회사에 이미 등록된 채널입니다 (${d.uuid})`,
            existingProfileId: dupChannel.rows[0].id,
          });
        }
      }

      // 카테고리 이름 캐시 (신규 등록 경로와 동일 — 실패 무시)
      let categoryNameCache: string | null = null;
      if (d.categoryCode) {
        try {
          const cat = await imc.getSenderCategory(String(d.categoryCode));
          if (cat.code === '0000' && cat.data) categoryNameCache = cat.data.name;
        } catch {
          /* 카테고리 조회 실패 무시 */
        }
      }

      const ins = await query(
        `INSERT INTO kakao_sender_profiles
           (company_id, profile_key, profile_name, is_active,
            yellow_id, category_code, category_name_cache,
            top_sender_yn, custom_sender_key, status,
            block_yn, dormant_yn, brand_message_yn, channel_created_at,
            approval_status, approval_requested_at, approved_at, approved_by,
            registered_at, updated_at)
         VALUES ($1,$2,$3,true,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 'APPROVED', now(), now(), $14,
                 now(), now())
         RETURNING *`,
        [
          companyId,
          d.senderKey,
          profileNameInput || d.name || d.uuid || senderKey,
          d.uuid || null,
          d.categoryCode ? String(d.categoryCode) : null,
          categoryNameCache,
          d.topSenderKeyYn || 'N',
          d.customSenderKey || null,
          d.status || 'NORMAL',
          d.block === true ? 'Y' : 'N',
          d.dormant === true ? 'Y' : 'N',
          d.brandMessage === true ? 'Y' : 'N',
          d.createdAt || null,
          req.user?.userId || null,
        ],
      );

      console.log(
        `[alimtalk][senders-import] company=${comp.rows[0].company_name} key=${d.senderKey} uuid=${d.uuid} status=${d.status} → id=${ins.rows[0].id}`,
      );
      return res.status(201).json({ success: true, profile: ins.rows[0], imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// ── 슈퍼관리자 디버그: IMC 계정 전체 템플릿 목록 probe (Track B-1 ② 템플릿 pull 사전 실측)
//    목록 item에 senderKey 필드가 있는지 raw 확인용 — 외부 API 응답 구조 추측 금지 (D217+ 교훈).
//    DB 무접촉(read-only).
router.get(
  '/templates/imc/probe',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const page = Math.max(0, parseInt(String(req.query.page ?? '0'), 10) || 0);
      const count = Math.min(100, Math.max(1, parseInt(String(req.query.count ?? '5'), 10) || 5));
      const r = await imc.listAlimtalkTemplates({ page, count });
      const data: any = r.data || {};
      const items: any[] = data.templateList || data.list || [];
      const senderKeyPresent = items.filter((it) => it?.senderKey || it?.sender_key).length;
      console.log(
        `[alimtalk][imc-list-probe] page=${page} count=${count} code=${r.code} keys=[${Object.keys(data).join(',')}] items=${items.length} senderKeyPresent=${senderKeyPresent}`,
      );
      return res.json({
        success: true,
        code: r.code,
        topLevelKeys: Object.keys(data),
        total: data.total ?? null,
        hasNext: data.hasNext ?? null,
        itemCount: items.length,
        senderKeyPresentCount: senderKeyPresent,
        firstItemKeys: items[0] ? Object.keys(items[0]) : [],
        sample: items.slice(0, 2),
      });
    } catch (err: any) {
      if (err instanceof ImcApiError) {
        return res.json({
          success: false,
          imcCode: err.code,
          httpStatus: err.httpStatus,
          responseBody: err.responseBody ?? null,
          message: err.message,
        });
      }
      return handleImcError(res, err);
    }
  },
);

// ── 슈퍼관리자 import ②: 특정 senderKey의 IMC 템플릿 → kakao_templates 행 생성 (Track B-1)
//    CT-91 sync(기존 행 백필 전용·행 생성 X)와 별개의 신설 경로. 검수상태·템플릿코드 = IMC 원본 그대로(재검수 없음).
//    멱등 = 회사 내 template_key/template_code 기존 행 skip. dryRun 기본 true(명시 false일 때만 INSERT).
//    buttons/대표링크 = CT-16 fromImc* 역변환으로 DB 규약(camelCase) 저장 — 발송 CT(toAttachmentLink)가 camel만 읽음.
//    imc_template_status는 운영 ALTER 미실행 가능성(SCHEMA.md 2026-06-11 실측)으로 INSERT 제외 — 30분 워커가 백필.
//    created_by = NULL(='자동' 관례) — super_admins id는 users FK와 다른 테이블이라 미기록.
router.post(
  '/templates/import',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const companyId = String(req.body?.companyId || '').trim();
      const senderKey = String(req.body?.senderKey || '').trim();
      const dryRun = req.body?.dryRun !== false;

      if (!/^[0-9a-f-]{36}$/i.test(companyId)) {
        return res.status(400).json({ success: false, error: 'companyId(uuid) 필요' });
      }
      if (!/^[0-9A-Za-z_-]{8,64}$/.test(senderKey)) {
        return res
          .status(400)
          .json({ success: false, error: 'senderKey 형식 오류: 영숫자 8~64자' });
      }

      const prof = await query(
        `SELECT id FROM kakao_sender_profiles
          WHERE company_id = $1::uuid AND profile_key = $2
          LIMIT 1`,
        [companyId, senderKey],
      );
      if (prof.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: '해당 회사에 연결된 senderKey가 없습니다. 먼저 POST /senders/import(연결)를 실행하세요',
        });
      }
      const profileId: string = prof.rows[0].id;

      // 1) IMC 계정 전체 목록 페이지네이션 → senderKey 필터
      //    (2026-07-15 probe 실측: 최상위 [hasNext,total,templateList], item에 senderKey+profile.senderKey 존재)
      const PAGE_SIZE = 100;
      const MAX_PAGES = 100;
      const matched: any[] = [];
      let imcScanned = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await imc.listAlimtalkTemplates({ page, count: PAGE_SIZE });
        if (r.code !== '0000') {
          // 부분 스캔으로 진행하면 누락 import가 "완료"로 보임 — 전체 스캔 실패 시 중단이 정답
          return res.status(502).json({
            success: false,
            error: `IMC 목록 조회 실패 (page=${page}, code=${r.code}). 전체 스캔 불가로 중단`,
            imcMessage: r.message,
          });
        }
        const data: any = r.data || {};
        const items: any[] = data.templateList || [];
        imcScanned += items.length;
        for (const it of items) {
          const itemKey = it?.senderKey || it?.profile?.senderKey;
          if (itemKey === senderKey) matched.push(it);
        }
        if (data.hasNext !== true || items.length === 0) break;
      }

      if (matched.length === 0) {
        return res.json({
          success: true,
          dryRun,
          imcScanned,
          matchedForSender: 0,
          message: 'IMC 목록에 해당 senderKey 템플릿이 없습니다',
        });
      }

      // 2) 기존 행 dedup (멱등 — 재실행 안전)
      const existing = await query(
        `SELECT template_key, template_code FROM kakao_templates WHERE company_id = $1::uuid`,
        [companyId],
      );
      const existingKeys = new Set<string>();
      for (const row of existing.rows) {
        if (row.template_key) existingKeys.add(String(row.template_key));
        if (row.template_code) existingKeys.add(String(row.template_code));
      }
      const toCreate = matched.filter((it) => {
        const k = it?.templateKey ? String(it.templateKey) : '';
        const c = it?.templateCode ? String(it.templateCode) : '';
        return !(k && existingKeys.has(k)) && !(c && existingKeys.has(c));
      });
      const skippedExisting = matched.length - toCreate.length;
      const summary = (arr: any[]) =>
        arr.slice(0, 5).map((it) => ({
          templateCode: it.templateCode,
          templateKey: it.templateKey,
          templateName: it.templateName,
          inspectionStatus: it.inspectionStatus,
          imcStatus: it.status,
        }));

      if (dryRun) {
        console.log(
          `[alimtalk][templates-import][dryRun] key=${senderKey} imcScanned=${imcScanned} matched=${matched.length} wouldCreate=${toCreate.length} skippedExisting=${skippedExisting}`,
        );
        return res.json({
          success: true,
          dryRun: true,
          imcScanned,
          matchedForSender: matched.length,
          wouldCreate: toCreate.length,
          skippedExisting,
          sample: summary(toCreate),
        });
      }

      // 3) INSERT — 컬럼 집합 = 운영 등록 INSERT + 운영 UPDATE 검증분(approved_at·reject_reason)만
      let created = 0;
      const failures: Array<{ templateCode: string; error: string }> = [];
      for (const it of toCreate) {
        const status = normalizeImcTemplateStatus(it.inspectionStatus || '');
        const approvedAt =
          status === 'APPROVED' && it.inspectionStatusUpdate ? it.inspectionStatusUpdate : null;
        const representLink = imc.fromImcRepresentLink(it.templateRepresentLink);
        try {
          await query(
            `INSERT INTO kakao_templates
               (company_id, profile_id, template_code, template_key, template_name,
                content, buttons, variables, status,
                category, message_type, emphasize_type, emphasize_title, emphasize_subtitle, emphasize_sub_title,
                image_name, extra_content, ad_content, security_flag, quick_replies,
                template_header, item_highlight, item_list, item_summary, represent_link,
                preview_message, alarm_phone_numbers, service_mode, custom_template_code,
                reject_reason, approved_at,
                created_by, created_at, updated_at, last_synced_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text[],$9,
                     $10,$11,$12,$13,$14,$14,
                     $15,$16,$17,$18,$19::jsonb,
                     $20,$21::jsonb,$22::jsonb,$23::jsonb,$24::jsonb,
                     $25,$26,$27,$28,
                     $29,$30::timestamp,
                     NULL, COALESCE($31::timestamp, now()), now(), now())`,
            [
              companyId,
              profileId,
              String(it.templateCode || it.templateKey),
              it.templateKey ? String(it.templateKey) : null,
              String(it.templateName || it.manageName || '').slice(0, 100),
              it.templateContent || '',
              JSON.stringify(imc.fromImcButtons(it.buttonList)),
              imc.extractAlimtalkVariables(it.templateContent),
              status,
              it.categoryCode ? String(it.categoryCode) : null,
              it.templateMessageType || 'BA',
              it.templateEmphasizeType || 'NONE',
              it.templateTitle ? String(it.templateTitle).slice(0, 50) : null,
              it.templateSubtitle || null,
              it.templateImageName || null,
              it.templateExtra || null,
              it.templateAd ? String(it.templateAd).slice(0, 100) : null,
              it.securityFlag === true,
              JSON.stringify(imc.fromImcButtons(it.quickReplyList)),
              it.templateHeader || null,
              it.templateItemHighlight ? JSON.stringify(it.templateItemHighlight) : null,
              it.templateItem?.list ? JSON.stringify(it.templateItem.list) : null,
              it.templateItem?.summary ? JSON.stringify(it.templateItem.summary) : null,
              representLink ? JSON.stringify(representLink) : null,
              it.templatePreviewMessage || null,
              it.alarmPhoneNumber || null,
              it.serviceMode || 'PRD',
              it.customTemplateCode || null,
              it.rejectReason || null,
              approvedAt,
              it.createdAt || null,
            ],
          );
          created++;
        } catch (insErr: any) {
          failures.push({
            templateCode: String(it.templateCode || it.templateKey),
            error: insErr?.message || String(insErr),
          });
        }
      }

      // 4) 효과 검증 — 실제 잔존 재카운트 후에만 성공 표시 (6원칙 ②)
      const recount = await query(
        `SELECT COUNT(*)::int AS cnt FROM kakao_templates
          WHERE company_id = $1::uuid AND profile_id = $2::uuid`,
        [companyId, profileId],
      );
      const finalCount = recount.rows[0]?.cnt ?? null;

      console.log(
        `[alimtalk][templates-import] key=${senderKey} matched=${matched.length} created=${created} skipped=${skippedExisting} failed=${failures.length} finalCount=${finalCount}`,
      );
      return res.status(failures.length === 0 ? 201 : 207).json({
        success: failures.length === 0,
        dryRun: false,
        imcScanned,
        matchedForSender: matched.length,
        created,
        skippedExisting,
        failed: failures.length,
        failures: failures.slice(0, 5),
        finalCountForProfile: finalCount,
      });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

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

// ★ 2026-07-22 이관 템플릿명 복원 — 이관(IMC pull) 시 체계형 자동명(예: 아난티_81880)만 왔고, 고객사 원본 관리명은
//   레거시 event_admin `kakao_alim_talk_template.title`에 있었다(IMC 경로라 미포함). 이를 template_code 매칭으로 로컬 복원.
//   ★ 순수 로컬 라벨(template_name)만 UPDATE — IMC/게이트웨이/발송/재승인 무접촉. kakao-template-sync는 template_name을
//   절대 덮지 않음(template_code·status만 갱신) → 복원이 되돌려지지 않음. IMC에도 template_name은 전송 안 됨(리스트 검색 파라미터일 뿐).
//   dryRun 기본 true·멱등(현재값과 다른 것만). seed = migrate-legacy/data/legacy-template-titles.json (code→title 맵).
//   신규 DB 컬럼/JOIN 없음(기존 kakao_templates.template_name/template_code만).
router.post(
  '/templates/restore-legacy-names',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const src = (body.titles && typeof body.titles === 'object' && !Array.isArray(body.titles)) ? body.titles : body;
      const dryRun = body.dryRun !== false && req.query.dryRun !== 'false';

      const codes: string[] = [];
      const titles: string[] = [];
      for (const [code, t] of Object.entries(src)) {
        if (code === 'dryRun' || code === 'titles') continue;
        const c = String(code).trim();
        const title = String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 100);
        if (!c || !title) continue;
        codes.push(c);
        titles.push(title);
      }
      if (codes.length === 0) {
        return res.status(400).json({ success: false, error: 'titles(code→title) 맵이 비어 있습니다.' });
      }

      // ★ 2026-07-22 재오픈 정정(서수란): 옛 다우(bizp) 이관분은 레거시코드(bizp_)가 우리 custom_template_code에 있고
      //   template_code는 새 IMC 코드(B_...)라, template_code 매칭만으로는 안 잡혔다. → template_code 우선 + custom_template_code
      //   보조 매칭. seed 코드는 유니크(JSON dedup)라 각 LEFT JOIN 최대 1행 → 중복 행 0, COALESCE로 template_code 제목 우선.
      const RESOLVED = `WITH seed AS (SELECT unnest($1::text[]) AS code, unnest($2::text[]) AS title),
        resolved AS (
          SELECT t.id, t.template_code, t.custom_template_code, t.template_name AS old_name,
                 COALESCE(sc.title, cc.title) AS title
            FROM kakao_templates t
            LEFT JOIN seed sc ON t.template_code = sc.code
            LEFT JOIN seed cc ON COALESCE(t.custom_template_code, '') <> '' AND t.custom_template_code = cc.code
           WHERE COALESCE(sc.title, cc.title) IS NOT NULL
        )`;

      // 매칭 건수 + 현재 이름과 다른(=복원 대상) 건수 (멱등: 다른 것만).
      const cnt = await query(
        `${RESOLVED}
         SELECT count(*) AS matched,
                count(*) FILTER (WHERE old_name IS DISTINCT FROM title) AS to_change
           FROM resolved`,
        [codes, titles],
      );
      const matched = Number(cnt.rows[0]?.matched || 0);
      const toChange = Number(cnt.rows[0]?.to_change || 0);

      if (dryRun) {
        const preview = await query(
          `${RESOLVED}
           SELECT template_code, custom_template_code, old_name, title AS new_name
             FROM resolved WHERE old_name IS DISTINCT FROM title
            ORDER BY template_code LIMIT 20`,
          [codes, titles],
        );
        return res.json({ success: true, dryRun: true, seedCodes: codes.length, matched, toChange, samples: preview.rows });
      }

      const upd = await query(
        `${RESOLVED}
         UPDATE kakao_templates t
            SET template_name = r.title, updated_at = now()
           FROM resolved r
          WHERE t.id = r.id AND t.template_name IS DISTINCT FROM r.title`,
        [codes, titles],
      );
      const changed = upd.rowCount || 0;
      // 효과 검증(6원칙 ②) — 복원 후 남은 diff 재카운트(멱등 확인)
      const remain = await query(
        `${RESOLVED}
         SELECT count(*) AS cnt FROM resolved WHERE old_name IS DISTINCT FROM title`,
        [codes, titles],
      );
      console.log(`[alimtalk restore-legacy-names] seedCodes=${codes.length} matched=${matched} changed=${changed} remainDiff=${remain.rows[0]?.cnt}`);
      return res.json({ success: true, dryRun: false, seedCodes: codes.length, matched, changed, remainingDiff: Number(remain.rows[0]?.cnt || 0) });
    } catch (err: any) {
      console.error('[alimtalk restore-legacy-names] 오류:', err);
      return res.status(500).json({ success: false, error: err?.message || '복원 실패' });
    }
  },
);

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
      if (r.code === '0000') {
        await query(
          `UPDATE kakao_sender_profiles SET brand_targeting_yn='Y', updated_at=now() WHERE id=$1`,
          [req.params.id],
        );
      }
      // ★ D140 #C (0425): IMC raw 메시지 사용자 노출 방지 (D139 IMC 단어 정책)
      return sendImcManagedResponse(res, r, { fallback: '브랜드메시지 타겟팅 신청에 실패했습니다' });
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
      // ★ D140 #C (0425): 매뉴얼 정합 응답 + IMC raw 메시지 사용자 노출 방지
      return sendImcManagedResponse(res, r, { fallback: '타겟팅 가능 여부 확인에 실패했습니다' });
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
    // ★ 2026-07-04 (Harold 정책): 조회는 회사 전체 노출. 등록·수정·삭제만 소유자/관리자 제한.
    //   기존 company_user는 created_by=본인 필터로 목록이 늘 0건이었다(등록은 requireCompanyAdmin 전용이라
    //   company_user가 만든 템플릿이 존재할 수 없음). 사용자 계정도 회사가 등록한 템플릿을 모두 볼 수 있게 필터 제거.
    //   쓰기(수정/삭제/검수요청 등)는 requireTemplateAccess의 소유권 검사(company_user=소유자, admin=전체)로 별도 게이팅.
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
    // ★ D143 F (2026-04-30) PDF 0430 알림톡 #3: BYTEA(증빙자료 data)는 목록 응답에서 제외.
    //   클라이언트로 base64 변환되어 전송되면 페이로드 폭증 + 보안 노출 위험. 파일명만 전달하여 UI 표시.
    const rows = r.rows.map((row: any) => {
      const { inspection_evidence_data, ...rest } = row;
      void inspection_evidence_data;
      return rest;
    });
    res.json({ success: true, templates: rows });
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
      // D131: IMC 실제 제한은 templateKey **최대 20자** (공식 문서 오표기 128자 → IMC 측 확인됨 2026-04-21).
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

      // ─────────────────────────────────────────
      // 1) IMC 등록
      //    D135+ (B3 복구): IMC는 성공했는데 DB INSERT 실패로 한줄로 DB에만 없는 상태
      //    → 재등록 시 IMC가 4014 반환 → listAlimtalkTemplates로 templateCode 복구 후 DB INSERT
      // ─────────────────────────────────────────
      // ★ D146 (2026-05-07) PDF 0506 #2 진단 보강: createTemplate 라우트 진입 + IMC 호출 시점 명시 로그.
      //   "IMC에는 등록되나 한줄로 PG에 안 들어감" 재신고 시 PM2 grep으로 어느 단계에서 끊겼는지 즉시 파악.
      console.log(
        `[alimtalk][createTemplate 진입] companyId=${companyId} templateKey=${templateKey} manageName=${body.manageName}`,
      );
      let r = await imc.createAlimtalkTemplate(senderKey, {
        ...body,
        templateKey,
      });
      // ★ D147 (2026-05-08) PDF 0508 #2/#3 root cause fix:
      //   IMC 등록 응답에 templateCode=null + inspectionStatus="REG"로 회신 (검수요청 전에는 templateCode 미발급 정상 동작).
      //   D135부터 r.data.templateCode만 의존 → null이면 라인 708 `!templateCode` 분기에서 400 반환 → PG INSERT 차단.
      //   IMC는 등록 성공(templateKey 발급)인데 한줄로 PG에 안 들어가 "관리화면 등록 안됨" 신고 반복.
      //   3단계 fallback: IMC응답 templateCode → IMC응답 templateKey → 로컬 templateKey(한줄로가 IMC에 보낸 키).
      //   PG `template_code` = templateKey 박힘 → 다른 라우트(GET/PUT/DELETE/inspect 등) `template_code` WHERE 식별 정상 작동 (IMC가 templateKey로 식별).
      let templateCode: string | null =
        r.data?.templateCode || (r.data as any)?.templateKey || templateKey || null;

      // B3 복구 경로: 4014 템플릿키 중복 → IMC에서 기존 템플릿 조회
      if (r.code === '4014' && !templateCode) {
        try {
          const lst = await imc.listAlimtalkTemplates({ page: 0, count: 100 });
          // ★ D217+ fix v3 (2026-05-26 Harold 명시 진단 영역 확정):
          //   IMC 안 응답 필드명 = `templateList` 영구 정합 (Harold raw 정독 = total 4,849건 + templateList 영역).
          //   옛 영역 = `list` / `data.list` 영역 영구 X = 빈 배열 영역 = B3 fallback 영구 영역 영영 사고 잠재.
          //   본 영역 정정 = 옛 영역 + `templateList` 영역 영구 추가 (옛 호환 영구 영구 유지).
          const items: any[] =
            (lst.data as any)?.templateList ||
            (lst.data as any)?.list ||
            (lst.data as any)?.data?.list ||
            (lst.data as any)?.data?.templateList ||
            [];
          const found = items.find((t: any) => t.templateKey === templateKey);
          if (found?.templateCode) {
            templateCode = found.templateCode;
            r = { code: '0000', message: 'OK (B3 복구: 기존 IMC 템플릿 연결)', data: found };
            console.log(
              `[alimtalk][B3 복구] templateKey=${templateKey} → templateCode=${templateCode}`,
            );
          }
        } catch (lookupErr: any) {
          console.error('[alimtalk][B3 복구 실패]', lookupErr?.message || lookupErr);
        }
      }

      if (r.code !== '0000' || !templateCode) {
        return res.status(400).json({
          success: false,
          code: r.code,
          error: sanitizeImcMessageForUser(r.message, r.code, '템플릿 등록에 실패했습니다'),
        });
      }

      // ─────────────────────────────────────────
      // 2) DB INSERT — status는 DRAFT로 시작. B9 자동 검수요청 성공 시 REQUESTED로 승격.
      //    (기존에는 'REQUESTED'로 하드코딩 → 실제 IMC는 '등록' 상태라 불일치 — D135+ 교정)
      //
      // ★ D139 #1+#3 (0425): PG INSERT 실패 시 IMC 등록 롤백.
      //    기존엔 IMC 등록 성공 + PG INSERT 실패 시 IMC에는 templateKey가 남아 있어
      //    사용자 재시도 마다 IMC 4014(templateKey 중복) 응답 → "재클릭 시 IMC 중복 등록" 인식 유발.
      //    + DB에는 영원히 안 들어가서 관리 화면 빈 상태 유지(#3).
      //    아래 try/catch로 실패 시 IMC deleteAlimtalkTemplate으로 롤백 + 명확한 error 메시지 노출.
      // ─────────────────────────────────────────
      let ins;
      try {
        // ★ D146 (2026-05-07): emphasize_subtitle + emphasize_sub_title 두 컬럼 동시 INSERT (V1/V2 호환).
        //   V1 routes/companies.ts SELECT(emphasize_sub_title)에서도 V2 등록 데이터 보이도록.
        ins = await query(
        `INSERT INTO kakao_templates
           (company_id, profile_id, template_code, template_key, template_name,
            content, buttons, variables, status,
            category, message_type, emphasize_type, emphasize_title, emphasize_subtitle, emphasize_sub_title,
            image_name, extra_content, ad_content, security_flag, quick_replies,
            template_header, item_highlight, item_list, item_summary, represent_link,
            preview_message, alarm_phone_numbers, service_mode, custom_template_code,
            created_by, created_at, updated_at, last_synced_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::text[],'DRAFT',
                 $9,$10,$11,$12,$13,$13,$14,$15,$16,$17,$18::jsonb,
                 $19,$20::jsonb,$21::jsonb,$22::jsonb,$23::jsonb,
                 $24,$25,$26,$27,$28,now(),now(),now())
         RETURNING *`,
        [
          companyId,
          profileId,
          templateCode,
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
      } catch (insertErr: any) {
        // ★ D139 #1+#3: PG INSERT 실패 시 IMC 등록 롤백
        const errDetail = insertErr?.message || insertErr?.detail || '알 수 없는 DB 오류';
        console.error(
          `[alimtalk][DB INSERT 실패] templateCode=${templateCode} templateKey=${templateKey} → IMC 롤백 시도. detail=${errDetail}`,
        );
        try {
          await imc.deleteAlimtalkTemplate(senderKey, templateCode);
          console.log(`[alimtalk][롤백] IMC 템플릿 삭제 완료: ${templateCode}`);
        } catch (rollbackErr: any) {
          console.error(
            `[alimtalk][롤백 실패] ${templateCode}: ${rollbackErr?.message || rollbackErr}`,
          );
        }
        return res.status(500).json({
          success: false,
          error: `DB 저장에 실패했습니다 (${errDetail}). IMC 등록은 자동 롤백되었습니다. 다시 시도해주세요.`,
          dbError: errDetail,
        });
      }

      // ─────────────────────────────────────────
      // ★ D139 #4 (0425): 등록과 검수요청 분리 — 자동 검수요청 제거.
      //    이전(D135 B9)엔 등록 성공 직후 자동 검수요청 호출 → IMC 스펙·직원 요청과 부합 안 함.
      //    이제 status='DRAFT' 유지. 검수요청은 별도 엔드포인트 POST /templates/:code/inspect (기존 존재) 호출.
      //    프론트는 목록에서 '검수요청' 액션 버튼으로 명시 호출 (D139 #4-1).
      // ─────────────────────────────────────────
      // ★ D146 (2026-05-07) PDF 0506 #2 진단 보강: PG INSERT 성공 시점 명시 로그.
      console.log(
        `[alimtalk][createTemplate 성공] id=${ins.rows[0].id} templateCode=${templateCode} status=DRAFT`,
      );

      res.status(201).json({
        success: true,
        template: ins.rows[0],
        imc: r,
      });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// 공용 헬퍼: templateCode → {senderKey, id, createdBy} 찾기
// user 정보가 전달되면 company_user는 본인 소유만 접근 허용 (소유자 체크 D130)
// imcTemplateKey = IMC 경로 식별자(templateKey 기준). D217이 template_code를 카카오 코드(B_XX)로
//   덮어쓴 뒤 IMC 조회/수정/삭제/검수요청은 여전히 templateKey(=한줄로가 발급해 보낸 로컬 키, template_key 컬럼)로만
//   식별된다. template_key가 있으면 그것을, 없으면(옛 데이터) URL의 template_code로 폴백.
type TemplateCtx = { senderKey: string; id: string; createdBy: string | null; templateKey: string | null; imcTemplateKey: string };

async function resolveTemplateContext(
  companyId: string,
  templateCode: string,
  user?: { userId: string; userType: string } | undefined,
  // ★ 2026-07-04: 조회(목록/상세/이력)는 회사 전체 허용, 쓰기(수정/삭제/검수요청)만 소유자 검사.
  //   requireOwnership=false면 같은 회사(companyId 일치)이기만 하면 접근 허용(소유자 아니어도 조회 OK).
  requireOwnership: boolean = true,
): Promise<TemplateCtx | null | 'forbidden'> {
  const r = await query(
    `SELECT t.id, t.created_by, t.template_key, p.profile_key
       FROM kakao_templates t
       JOIN kakao_sender_profiles p ON p.id = t.profile_id
      WHERE t.template_code = $1 AND t.company_id = $2`,
    [templateCode, companyId],
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  if (requireOwnership && user?.userType === 'company_user' && row.created_by !== user.userId) {
    return 'forbidden';
  }
  return {
    senderKey: row.profile_key,
    id: row.id,
    createdBy: row.created_by,
    templateKey: row.template_key || null,
    imcTemplateKey: row.template_key || templateCode,
  };
}

// 컨트롤타워: 템플릿 접근 체크 + companyId 확보 + 404/403 응답 일원화 (D130)
// 호출부에서 companyId 추출 + resolveTemplateContext 2단계 반복을 단일 호출로 통합
async function requireTemplateAccess(
  req: Request,
  res: Response,
  opts?: { requireOwnership?: boolean },
): Promise<({ companyId: string } & TemplateCtx) | null> {
  const companyId = requireCompany(req, res);
  if (!companyId) return null;
  const ctx = await resolveTemplateContext(
    companyId,
    req.params.templateCode,
    req.user,
    opts?.requireOwnership !== false, // 기본 true(쓰기 소유권 검사). 조회 라우트만 false 전달.
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
    // 조회(상세)는 회사 전체 허용 (Harold 정책 2026-07-04) — 같은 회사면 소유자 아니어도 열람 가능.
    const ctx = await requireTemplateAccess(req, res, { requireOwnership: false });
    if (!ctx) return;

    // IMC 최신 상태 동기화
    // ★ 2026-06-10 정정 2건:
    //   1) IMC GET 경로 파라미터 = templateKey — D217이 template_code를 카카오 코드로 바꾼 뒤
    //      code로 호출하면 4013으로 조용히 실패해 단건 동기화가 죽어 있었다.
    //   2) 기존엔 IMC의 "활성상태(status A/R/S)"를 검수상태 컬럼(status)에 그대로 덮어써
    //      상태 어휘가 섞였다 → 검수상태는 inspectionStatus 정규화로, 활성상태는 imc_template_status로 분리.
    try {
      const r = await imc.getAlimtalkTemplate(ctx.senderKey, ctx.imcTemplateKey);
      if (r.code === '0000' && r.data) {
        const d: any = r.data;
        const inspection = d.inspectionStatus ? normalizeImcTemplateStatus(String(d.inspectionStatus)) : null;
        const imcTemplateStatus = d.status ? String(d.status) : null;
        const rejectReason = d.rejectReason ?? null;
        try {
          await query(
            `UPDATE kakao_templates
                SET status = COALESCE($1, status),
                    imc_template_status = $2,
                    reject_reason = COALESCE($3, reject_reason),
                    last_synced_at = now()
              WHERE id = $4`,
            [inspection, imcTemplateStatus, rejectReason, ctx.id],
          );
        } catch (colErr: any) {
          const msg = colErr?.message || '';
          if (msg.includes('column') && msg.includes('does not exist')) {
            // imc_template_status ALTER 전 — 검수상태만 갱신
            await query(
              `UPDATE kakao_templates
                  SET status = COALESCE($1, status), last_synced_at = now()
                WHERE id = $2`,
              [inspection, ctx.id],
            );
          } else {
            throw colErr;
          }
        }

        // ★ D217+ (2026-05-26 Harold 명시 진단 영역 정정):
        //   옛 D147 영역 = 검수 통과 후 IMC 안 진정 카카오 templateCode (B_XX_xxx_xx_xxxxx) 영역
        //   영구 발급 영역 → 한줄로 안 영역 = 옛 Tmp_xxx 영구 유지 사고 영역 (운영 환경 8건 100% 사고).
        //   본 분기 = IMC 응답 영역 안 진정 templateCode 영역 = 옛 Tmp_xxx 영역 영구 정정.
        //   syncSingleTemplateCode 영역 안 idempotent (이미 카카오 코드 영역 = skip).
        const syncResult = await syncSingleTemplateCode(ctx.id, r.data);
        if (syncResult.updated) {
          console.log(
            `[alimtalk][templateCode 정합] id=${ctx.id} ${syncResult.oldCode} → ${syncResult.newCode}`,
          );
        }
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

// ★ D150-2 (2026-05-09): 알림톡 템플릿 이력 조회 — 직원 잠금(슈퍼관리자 전용)
//   매뉴얼:
//     GET /sender/{senderKey}/alimtalk/template/{templateKey}/history
//     GET /sender/{senderKey}/alimtalk/template/{templateKey}/history/{histId}
//   슈퍼관리자는 회사 무관하게 모든 템플릿 이력 조회 가능 → companyId 제약 없이 PG 직접 조회.
router.get(
  '/templates/:templateCode/history',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const tpl = await query(
        `SELECT p.profile_key, t.template_key
           FROM kakao_templates t
           LEFT JOIN kakao_sender_profiles p ON p.id = t.profile_id
          WHERE t.template_code = $1
          LIMIT 1`,
        [req.params.templateCode],
      );
      if (tpl.rows.length === 0 || !tpl.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '템플릿 없음' });
      }
      const r = await imc.getAlimtalkTemplateHistory(
        tpl.rows[0].profile_key,
        tpl.rows[0].template_key || req.params.templateCode,
      );
      return sendImcManagedResponse(res, r, { fallback: '이력 조회에 실패했습니다' });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.get(
  '/templates/:templateCode/history/:histId',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const tpl = await query(
        `SELECT p.profile_key, t.template_key
           FROM kakao_templates t
           LEFT JOIN kakao_sender_profiles p ON p.id = t.profile_id
          WHERE t.template_code = $1
          LIMIT 1`,
        [req.params.templateCode],
      );
      if (tpl.rows.length === 0 || !tpl.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '템플릿 없음' });
      }
      const r = await imc.getAlimtalkTemplateHistoryDetail(
        tpl.rows[0].profile_key,
        tpl.rows[0].template_key || req.params.templateCode,
        req.params.histId,
      );
      return sendImcManagedResponse(res, r, { fallback: '이력 상세 조회에 실패했습니다' });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// 템플릿 수정: 본인 소유 + company_admin/super_admin (D130 §2-2, requireTemplateAccess 내 체크)
// ★ D149-#A (2026-05-08) PDF 0508 후속 직원 카톡 신고: "수정 시 IMC에 수정반영 되고 한줄로에선 수정 반영이 안돼요"
//   D146/D147 메모리에 별건으로 명시한 사항 — IMC만 갱신하고 PG 본문(content/emphasize/buttons/represent_link 등) 미갱신.
//   PG 0행이라 D147까지 발현 안 됐지만 D147 #2 자연 해결 후 즉시 발현. INSERT 패턴(라인 729~) 미러로 모든 본문 컬럼 UPDATE.
router.put(
  '/templates/:templateCode',
  async (req: Request, res: Response) => {
    try {
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const body = req.body || {};
      const r = await imc.updateAlimtalkTemplate(
        ctx.senderKey,
        ctx.imcTemplateKey,
        body,
      );
      if (r.code !== '0000') {
        return res.status(400).json({
          success: false,
          code: r.code,
          error: sanitizeImcMessageForUser(r.message, r.code, '템플릿 수정에 실패했습니다'),
          imc: r,
        });
      }
      // ★ D149-#A: PG 본문 컬럼 동시 갱신 (emphasize_subtitle/sub_title 둘 다 — D146 정합화 미러).
      //   COALESCE 패턴 — body에 명시된 필드만 갱신. 미명시 필드는 기존 값 유지.
      await query(
        `UPDATE kakao_templates SET
           template_name        = COALESCE($2, template_name),
           content              = COALESCE($3, content),
           buttons              = COALESCE($4::jsonb, buttons),
           variables            = COALESCE($5::text[], variables),
           category             = COALESCE($6, category),
           message_type         = COALESCE($7, message_type),
           emphasize_type       = COALESCE($8, emphasize_type),
           emphasize_title      = COALESCE($9, emphasize_title),
           emphasize_subtitle   = COALESCE($10, emphasize_subtitle),
           emphasize_sub_title  = COALESCE($10, emphasize_sub_title),
           image_name           = COALESCE($11, image_name),
           extra_content        = COALESCE($12, extra_content),
           security_flag        = COALESCE($13, security_flag),
           quick_replies        = COALESCE($14::jsonb, quick_replies),
           template_header      = COALESCE($15, template_header),
           item_highlight       = COALESCE($16::jsonb, item_highlight),
           item_list            = COALESCE($17::jsonb, item_list),
           item_summary         = COALESCE($18::jsonb, item_summary),
           represent_link       = COALESCE($19::jsonb, represent_link),
           preview_message      = COALESCE($20, preview_message),
           service_mode         = COALESCE($21, service_mode),
           custom_template_code = COALESCE($22, custom_template_code),
           updated_at           = now(),
           last_synced_at       = now()
         WHERE id = $1`,
        [
          ctx.id,
          body.manageName || null,
          body.templateContent || null,
          body.buttonList ? JSON.stringify(body.buttonList) : null,
          body.variables || null,
          body.categoryCode || null,
          body.templateMessageType || null,
          body.templateEmphasizeType || null,
          body.templateTitle || null,
          body.templateSubtitle || null,
          body.templateImageName || null,
          body.templateExtra || null,
          typeof body.securityFlag === 'boolean' ? body.securityFlag : null,
          body.quickReplyList ? JSON.stringify(body.quickReplyList) : null,
          body.templateHeader || null,
          body.templateItemHighlight ? JSON.stringify(body.templateItemHighlight) : null,
          body.templateItem?.list ? JSON.stringify(body.templateItem.list) : null,
          body.templateItem?.summary ? JSON.stringify(body.templateItem.summary) : null,
          body.templateRepresentLink ? JSON.stringify(body.templateRepresentLink) : null,
          body.templatePreviewMessage || null,
          body.serviceMode || null,
          body.customTemplateCode || null,
        ],
      );
      console.log(`[alimtalk][updateTemplate 성공] templateCode=${req.params.templateCode} (PG 본문+IMC 갱신)`);
      res.json({ success: true, imc: r });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

// ★ D149-#B 검증 라우트 (2026-05-08): IMC 측 저장 binary와 PG inspection_evidence_data hex 비교.
//   목적: 검수요청 첨부파일 IMC 화면 다운로드 시 깨짐 → PG 100% 정상(magic ffd8ffe0) 확인됨 →
//         IMC 측 저장 단계 손상인지 / 한줄로→IMC 전송 단계 손상인지 가르는 검증.
//   응답: { imc: {size, magic_4, first_16, content_type}, pg: {size, magic_4, first_16}, match: bool }
//   호출: GET /api/alimtalk/templates/:templateCode/_debug-evidence-binary (운영 영향 0, 검증 전용)
router.get(
  '/templates/:templateCode/_debug-evidence-binary',
  async (req: Request, res: Response) => {
    try {
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      // PG 데이터
      const pgRow = await query(
        `SELECT inspection_evidence_data, inspection_evidence_filename, inspection_evidence_mimetype,
                LENGTH(inspection_evidence_data) AS size
           FROM kakao_templates WHERE id = $1`,
        [ctx.id],
      );
      const pgRowData = pgRow.rows[0] || {};
      const pgBuffer: Buffer | null =
        pgRowData.inspection_evidence_data && Buffer.isBuffer(pgRowData.inspection_evidence_data)
          ? pgRowData.inspection_evidence_data
          : null;
      // IMC 측 binary 가져오기
      let imcResult: any = null;
      let imcError: any = null;
      try {
        const imcDownload = await imc.getAlimtalkCommentFile(ctx.senderKey, ctx.imcTemplateKey);
        imcResult = {
          size: imcDownload.size,
          content_type: imcDownload.contentType,
          magic_4: imcDownload.buffer.slice(0, 4).toString('hex'),
          first_16: imcDownload.buffer.slice(0, 16).toString('hex'),
          last_8: imcDownload.buffer.slice(-8).toString('hex'),
        };
      } catch (e: any) {
        imcError = { message: e?.message, status: e?.response?.status, body: e?.response?.data ? String(e.response.data).slice(0, 300) : null };
      }
      const pgInfo = pgBuffer ? {
        size: pgBuffer.length,
        filename: pgRowData.inspection_evidence_filename,
        mimetype: pgRowData.inspection_evidence_mimetype,
        magic_4: pgBuffer.slice(0, 4).toString('hex'),
        first_16: pgBuffer.slice(0, 16).toString('hex'),
        last_8: pgBuffer.slice(-8).toString('hex'),
      } : null;
      res.json({
        success: true,
        templateCode: req.params.templateCode,
        senderKey: ctx.senderKey,
        pg: pgInfo,
        imc: imcResult,
        imcError: imcError,
        match: pgInfo && imcResult
          ? (pgInfo.size === imcResult.size && pgInfo.first_16 === imcResult.first_16)
          : null,
      });
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
      const r = await imc.deleteAlimtalkTemplate(ctx.senderKey, ctx.imcTemplateKey);
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

/**
 * ★ D143 F (2026-04-30) PDF 0430 알림톡 #3: 등록/수정 폼 하단 코멘트+증빙자료 별도 저장.
 *
 *  직원 요청: "템플릿 등록 제일 하단에 '코멘트' 입력 칸, '코멘트 증빙자료' 추가 해야 합니다."
 *
 *  설계:
 *    - 템플릿 등록 자체는 application/json (POST /templates).
 *    - 코멘트+증빙자료는 multipart/form-data로 본 라우트에 별도 호출 (frontend handleSave가 등록 직후 자동 호출).
 *    - DB 컬럼: inspection_comment TEXT, inspection_evidence_filename/_mimetype/_data BYTEA
 *    - 검수요청(POST /inspect) 시점에 DB 값을 자동으로 IMC에 전달 → 직원 입장에서 "등록 폼 하단" 한 번 입력으로 종결.
 *
 *  DB 마이그레이션 (Harold님 직접 실행):
 *    ALTER TABLE kakao_templates
 *      ADD COLUMN IF NOT EXISTS inspection_comment TEXT,
 *      ADD COLUMN IF NOT EXISTS inspection_evidence_filename TEXT,
 *      ADD COLUMN IF NOT EXISTS inspection_evidence_mimetype TEXT,
 *      ADD COLUMN IF NOT EXISTS inspection_evidence_data BYTEA;
 */
router.post(
  '/templates/:templateCode/inspection-meta',
  requireCompanyAdmin as any,
  upload.single('evidenceFile'),
  async (req: Request, res: Response) => {
    try {
      const ctx = await requireTemplateAccess(req, res);
      if (!ctx) return;
      const file = (req as any).file as Express.Multer.File | undefined;
      const decodedFile = file ? decodeOriginalName(file) : undefined;
      const comment = (req.body?.comment ?? '').toString();

      if (decodedFile) {
        await query(
          `UPDATE kakao_templates
              SET inspection_comment = $1,
                  inspection_evidence_filename = $2,
                  inspection_evidence_mimetype = $3,
                  inspection_evidence_data = $4,
                  updated_at = now()
            WHERE id = $5`,
          [comment, decodedFile.originalname, decodedFile.mimetype, decodedFile.buffer, ctx.id],
        );
      } else {
        // 파일 미첨부 시 기존 evidence는 유지하고 코멘트만 갱신
        await query(
          `UPDATE kakao_templates
              SET inspection_comment = $1,
                  updated_at = now()
            WHERE id = $2`,
          [comment, ctx.id],
        );
      }
      res.json({
        success: true,
        inspection_comment: comment,
        inspection_evidence_filename: decodedFile?.originalname || null,
      });
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

      // ★ D143 F (2026-04-30) PDF 0430 #3: 등록 폼에서 저장한 코멘트+증빙자료를 자동으로 IMC에 전달.
      //   body.comment가 명시되면 우선 사용 (재검수 모달에서 추가 입력 가능).
      //   evidence가 DB에 있으면 IMC requestInspectionWithFile, 없으면 requestInspection.
      // ★ D149-#B (2026-05-08) PDF 0508 후속 "IMC 이미지 깨짐" fix: mimetype 컬럼도 SELECT.
      const meta = await query(
        `SELECT inspection_comment,
                inspection_evidence_filename,
                inspection_evidence_mimetype,
                inspection_evidence_data
           FROM kakao_templates WHERE id = $1`,
        [ctx.id],
      );
      const row = meta.rows[0] || {};
      const finalComment: string =
        (req.body?.comment as string) || row.inspection_comment || '';
      const evidenceBuffer: Buffer | null =
        row.inspection_evidence_data && Buffer.isBuffer(row.inspection_evidence_data)
          ? row.inspection_evidence_data
          : null;
      const evidenceFilename: string = row.inspection_evidence_filename || 'evidence';
      const evidenceMimetype: string | undefined = row.inspection_evidence_mimetype || undefined;

      let r;
      if (evidenceBuffer) {
        r = await imc.requestInspectionWithFile(
          ctx.senderKey,
          ctx.imcTemplateKey,
          finalComment,
          evidenceBuffer,
          evidenceFilename,
          evidenceMimetype,
        );
      } else {
        r = await imc.requestInspection(
          ctx.senderKey,
          ctx.imcTemplateKey,
          finalComment || undefined,
        );
      }
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
      // ★ D143 F (2026-04-30): 파일이 직접 첨부되지 않아도 DB의 inspection_evidence_data로 폴백.
      //   기존엔 첨부 필수였지만, 등록 폼 하단에서 이미 저장된 증빙자료를 검수요청 모달에서 재사용 가능.
      // ★ D149-#B (2026-05-08): mimetype도 함께 추출 (IMC FormData contentType 명시 — 이미지 깨짐 fix).
      let buffer: Buffer | undefined;
      let filename: string | undefined;
      let mimetype: string | undefined;
      if (file) {
        const decoded = decodeOriginalName(file);
        buffer = decoded.buffer;
        filename = decoded.originalname;
        mimetype = decoded.mimetype;
      } else {
        const meta = await query(
          `SELECT inspection_evidence_filename, inspection_evidence_mimetype, inspection_evidence_data
             FROM kakao_templates WHERE id = $1`,
          [ctx.id],
        );
        const row = meta.rows[0] || {};
        if (row.inspection_evidence_data && Buffer.isBuffer(row.inspection_evidence_data)) {
          buffer = row.inspection_evidence_data;
          filename = row.inspection_evidence_filename || 'evidence';
          mimetype = row.inspection_evidence_mimetype || undefined;
        }
      }
      if (!buffer || !filename) {
        return res.status(400).json({ success: false, error: '첨부파일이 필요합니다' });
      }
      const r = await imc.requestInspectionWithFile(
        ctx.senderKey,
        ctx.imcTemplateKey,
        req.body?.comment || '',
        buffer,
        filename,
        mimetype,
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
      const r = await imc.cancelInspection(ctx.senderKey, ctx.imcTemplateKey);
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
      const r = await imc.releaseTemplateDormant(ctx.senderKey, ctx.imcTemplateKey);
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
        ctx.imcTemplateKey,
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
        ctx.imcTemplateKey,
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
        ctx.imcTemplateKey,
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
        // ★ D140 #C (0425): IMC raw 메시지 정제 후 반환
        return res.status(400).json({
          success: false,
          code: r.code,
          error: sanitizeImcMessageForUser(r.message, r.code, '브랜드메시지 템플릿 등록에 실패했습니다'),
          imc: r,
        });
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

// ★ D150-2 (2026-05-09): 브랜드메시지 템플릿 이력 조회 — 직원 잠금(슈퍼관리자 전용)
//   매뉴얼:
//     GET /sender/{senderKey}/brand-message/template/{templateKey}/history
//     GET /sender/{senderKey}/brand-message/template/{templateKey}/history/{histId}
router.get(
  '/brand-templates/:templateKey/history',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const tpl = await query(
        `SELECT p.profile_key
           FROM brand_message_templates b
           LEFT JOIN kakao_sender_profiles p ON p.id = b.profile_id
          WHERE b.template_key = $1
          LIMIT 1`,
        [req.params.templateKey],
      );
      if (tpl.rows.length === 0 || !tpl.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '템플릿 없음' });
      }
      const r = await imc.getBrandTemplateHistory(
        tpl.rows[0].profile_key,
        req.params.templateKey,
      );
      return sendImcManagedResponse(res, r, { fallback: '이력 조회에 실패했습니다' });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

router.get(
  '/brand-templates/:templateKey/history/:histId',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const tpl = await query(
        `SELECT p.profile_key
           FROM brand_message_templates b
           LEFT JOIN kakao_sender_profiles p ON p.id = b.profile_id
          WHERE b.template_key = $1
          LIMIT 1`,
        [req.params.templateKey],
      );
      if (tpl.rows.length === 0 || !tpl.rows[0].profile_key) {
        return res.status(404).json({ success: false, error: '템플릿 없음' });
      }
      const r = await imc.getBrandTemplateHistoryDetail(
        tpl.rows[0].profile_key,
        req.params.templateKey,
        req.params.histId,
      );
      return sendImcManagedResponse(res, r, { fallback: '이력 상세 조회에 실패했습니다' });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

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
      if (imcRes.code === '0000') {
        await query(
          `UPDATE brand_message_templates SET updated_at=now() WHERE id=$1`,
          [r.rows[0].id],
        );
      }
      // ★ D140 #C (0425): IMC raw 메시지 사용자 노출 방지
      return sendImcManagedResponse(res, imcRes, { fallback: '브랜드메시지 템플릿 수정에 실패했습니다' });
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
      if (imcRes.code === '0000') {
        await query(
          `UPDATE brand_message_templates
              SET status='DELETED', deleted_at=now(), updated_at=now()
            WHERE id=$1`,
          [r.rows[0].id],
        );
      }
      // ★ D140 #C (0425): IMC raw 메시지 사용자 노출 방지
      return sendImcManagedResponse(res, imcRes, { fallback: '브랜드메시지 템플릿 삭제에 실패했습니다' });
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
  // ★ D143 E (2026-04-30): 어떤 래핑이든 imageUrl/imageName 추출 (extractImageFromAnyShape 재사용).
  //   D131/D142+의 부분 unwrap이 새 응답 구조에서 깨지면 DB INSERT가 silent skip되어 있던 문제 차단.
  const { imageUrl, imageName } = extractImageFromAnyShape(r);
  if (!imageName || !imageUrl) {
    console.warn(
      `[alimtalk][persistImage] skip — imageName/Url 추출 실패. uploadType=${uploadType} raw=${JSON.stringify(r).slice(0, 400)}`,
    );
    return;
  }
  await query(
    `INSERT INTO kakao_image_uploads
       (company_id, user_id, upload_type, image_name, image_url,
        original_filename, file_size, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
    [
      req.user?.companyId || null,
      req.user?.userId || null,
      uploadType,
      imageName,
      imageUrl,
      file?.originalname || null,
      file?.size || null,
    ],
  );
}

/**
 * ★ D139 #7+#6-1 (0425): 이미지 업로드 응답 통합 헬퍼.
 *   기존 9개 라우트가 `res.json({ success: r.code === '0000', imc: r })`만 반환 →
 *   IMC가 HTTP 200 + body code≠'0000' (예: 4000 BAD_REQUEST)으로 거부 시 axios catch 미진입,
 *   `error` 필드 없이 응답 → 프론트 KakaoChannelImageUpload는 `'업로드 실패 (200)'` fallback 표시 →
 *   직원이 "오류코드 200"으로 오해 + 실제 거부 사유(사이즈 초과/형식 불일치 등) 노출 안 됨.
 *   본 헬퍼는 실패 시 메시지를 사용자 친화적으로 정제 후 `error` 필드로 노출.
 *
 * ★ D139 추가 (0425): 사용자 노출 텍스트에 'IMC'/영문 ExceptionName/깨진 한글 파일명 금지 정책 반영.
 *   sanitizeImageErrorForUser()로 한글 메시지만 추출하여 노출.
 */

/**
 * 카카오(IMC) 이미지 업로드 에러 메시지를 사용자 친화적으로 정제.
 *
 * 입력 예: `InvalidImageShapeException(가로:세로 비율은 2:1여야 합니다, ë틀ɑì틀´.jpg)`
 * 출력 예: `이미지 가로:세로 비율은 2:1이어야 합니다`
 *
 * 처리:
 *  - 영문 ExceptionName/ErrorName 제거
 *  - 괄호 안 첫 번째 콤마까지를 메시지로 추출 (그 뒤는 파일명 등 부가 정보 → 제거)
 *  - 'IMC'/'humuson' 등 라우터 명칭 제거
 *  - 메시지 못 추출 시 "이미지 업로드에 실패했습니다" + 코드 fallback
 */
function sanitizeImcMessageForUser(
  rawMsg: string | undefined,
  code: string | undefined,
  fallback: string = '요청 처리에 실패했습니다',
): string {
  const msg = (rawMsg || '').trim();
  if (!msg) return code ? `${fallback} (코드 ${code})` : fallback;
  // 1) 영문 ExceptionName/ErrorName(...) 패턴 → 괄호 안 첫 콤마 이전만 추출
  const m = msg.match(/^[A-Za-z][A-Za-z0-9_]*(?:Exception|Error|Failure)\s*\((.+)\)\s*$/);
  let inner = m ? m[1] : msg;
  // 괄호 안에 콤마가 있으면 첫 콤마까지만 (이후는 파일명/부가정보)
  const commaIdx = inner.indexOf(',');
  if (commaIdx > 0) inner = inner.slice(0, commaIdx);
  // 2) 라우터 명칭 제거 (사용자 노출 금지 정책)
  inner = inner.replace(/\bIMC\b/gi, '').replace(/humuson/gi, '').trim();
  // 3) 잔여 정리
  inner = inner.replace(/\s{2,}/g, ' ').trim();
  return inner || (code ? `${fallback} (코드 ${code})` : fallback);
}

// 이미지 업로드 전용 폴백 메시지 (기존 호출 호환)
function sanitizeImageErrorForUser(rawMsg: string | undefined, code: string | undefined): string {
  return sanitizeImcMessageForUser(rawMsg, code, '이미지 업로드에 실패했습니다');
}

/**
 * ★ D140 (0425): 브랜드메시지/알림톡 관리 API 응답 통합 헬퍼.
 *   IMC 응답을 받아 success 시 그대로 + extra, 실패 시 정제된 사용자 친화적 error 필드로 응답.
 *   기존 `res.json({ success: r.code === '0000', imc: r })` 패턴이 14곳 라우트에 분산 →
 *   IMC raw 메시지가 사용자에게 노출되는 문제(D139 IMC 단어 노출 사고와 동일 패턴) 해결.
 */
function sendImcManagedResponse(
  res: Response,
  r: imc.ImcResponse<any>,
  opts: {
    /** 실패 시 사용자에게 보여줄 폴백 (예: '템플릿 등록에 실패했습니다') */
    fallback?: string;
    /** 실패 시 HTTP status (default 400) */
    statusOnFail?: number;
    /** 성공 시 응답 객체에 추가할 extra 필드 (예: { template: row }) */
    extra?: Record<string, any>;
  } = {},
) {
  const ok = r?.code === '0000';
  if (ok) {
    return res.json({ success: true, ...(opts.extra || {}), imc: r });
  }
  const fallback = opts.fallback || '요청 처리에 실패했습니다';
  console.warn(`[alimtalk][imc-managed 실패] code=${r?.code || 'N/A'} rawMsg=${r?.message || 'N/A'}`);
  return res.status(opts.statusOnFail || 400).json({
    success: false,
    code: r?.code,
    error: sanitizeImcMessageForUser(r?.message, r?.code, fallback),
    imc: r,
  });
}

/**
 * ★ D143 E (2026-04-30) PDF 0430 알림톡 #1-2/#2: "규격 맞춰서 넣어도 카카오 응답에 이미지가 없습니다" 근본 종결.
 *
 *  D131이 sender/template unwrap만 처리, D142+가 image 이중래핑(`data.data.data.imageUrl`)까지 처리했지만,
 *  IMC가 또 다른 응답 구조(예: `data.imageUrl`/`data.list[0].imageUrl`/wrapper 변종)를 반환하면 frontend의
 *  `data.imc?.data?.imageUrl` 깊은 경로 접근이 또 깨짐 → "카카오 응답에 이미지가 없습니다" 재발.
 *
 *  해결: backend가 어떤 래핑이든 imageUrl/imageName을 추출해 응답 최상단에 평탄화.
 *        frontend는 `data.imageUrl`/`data.imageName`만 신뢰 → 미래의 새 래핑 케이스에도 자동 견고.
 *
 *  단일 이미지: `{ success, imageUrl, imageName, imc }`
 *  다중 이미지: `{ success, list: [{imageUrl,imageName}], imc }`
 */
// ★2026-09-02 `extractImageFromAnyShape`는 `utils/alimtalk-api.ts`로 이동했다(브랜드 발송
//   경로가 같은 추출을 필요로 하는데, 라우트에 두면 utils→routes 역방향 의존이 된다).
//   상단에서 named import 한다 — 여기에 const로 두면 위쪽 호출부(persistImage)가 TDZ에 걸린다.

function extractImageListFromAnyShape(r: any): { imageUrl: string; imageName: string }[] {
  if (!r) return [];
  const cands = [
    r?.data?.list,
    r?.data?.data?.list,
    r?.data?.images,
    r?.data?.data?.images,
    Array.isArray(r?.data) ? r.data : null,
  ];
  // ★ D146 (2026-05-07): list element 변종 수용 — {imageUrl,imageName} / {image:"url"} / "url"(string)
  const fromUrl = (url: string) => {
    const tail = url.split('/').pop() || '';
    return { imageUrl: url, imageName: (tail.split('?')[0] || 'image').slice(0, 200) };
  };
  for (const c of cands) {
    if (Array.isArray(c) && c.length > 0) {
      const out = c
        .map((it: any): { imageUrl: string; imageName: string } | null => {
          if (!it) return null;
          if (typeof it === 'string' && it.startsWith('http')) return fromUrl(it);
          if (typeof it === 'object') {
            if (it.imageUrl && it.imageName) return { imageUrl: it.imageUrl, imageName: it.imageName };
            if (typeof it.image === 'string' && it.image.startsWith('http')) return fromUrl(it.image);
          }
          return null;
        })
        .filter((it): it is { imageUrl: string; imageName: string } => !!it);
      if (out.length > 0) return out;
    }
  }
  return [];
}

function sendImageUploadResponse(
  res: Response,
  r: imc.ImcResponse<imc.ImageUploadResult>,
) {
  const ok = r?.code === '0000';
  if (ok) {
    // ★ D143 E (2026-04-30): 평탄화 — 어떤 래핑이든 최상단 imageUrl/imageName 보장.
    const { imageUrl, imageName } = extractImageFromAnyShape(r);
    if (!imageUrl || !imageName) {
      // 응답 자체가 비정상(IMC가 0000 코드 + 빈 데이터) — 운영 진단 로그 + 사용자 명확 안내
      console.error(
        `[alimtalk][image-upload 비정상응답] code=0000인데 imageUrl/Name 추출 불가. raw=${JSON.stringify(r).slice(0, 800)}`,
      );
      return res.status(502).json({
        success: false,
        code: '0000',
        error: '이미지 업로드는 처리됐으나 응답에서 이미지 정보를 추출하지 못했습니다. 다시 시도해주세요.',
        imc: r,
      });
    }
    return res.json({ success: true, imageUrl, imageName, imc: r });
  }
  // 운영 진단용 로그는 실제 IMC 코드/메시지 그대로 (사용자에게는 안 보임)
  console.warn(`[alimtalk][image-upload 실패] code=${r?.code || 'N/A'} rawMsg=${r?.message || 'N/A'}`);
  // 사용자 응답은 정제된 한글 메시지만
  const userMsg = sanitizeImageErrorForUser(r?.message, r?.code);
  return res.status(400).json({
    success: false,
    code: r?.code,
    error: userMsg,
    imc: r,
  });
}

/**
 * ★ D143 E (2026-04-30): 다중 이미지 업로드 응답 평탄화 (brand wide-list/carousel-feed/carousel-commerce).
 *  단일과 동일하게 list를 응답 최상단에 평탄화하여 frontend가 깊은 경로 의존하지 않도록.
 */
function sendImageUploadMultiResponse(
  res: Response,
  r: imc.ImcResponse<{ list: imc.ImageUploadResult[] }>,
) {
  const ok = r?.code === '0000';
  if (ok) {
    const list = extractImageListFromAnyShape(r);
    if (list.length === 0) {
      console.error(
        `[alimtalk][image-upload(multi) 비정상응답] code=0000인데 list 추출 불가. raw=${JSON.stringify(r).slice(0, 800)}`,
      );
      return res.status(502).json({
        success: false,
        code: '0000',
        error: '이미지 업로드는 처리됐으나 응답에서 이미지 목록을 추출하지 못했습니다. 다시 시도해주세요.',
        imc: r,
      });
    }
    return res.json({ success: true, list, imc: r });
  }
  console.warn(`[alimtalk][image-upload(multi) 실패] code=${r?.code || 'N/A'} rawMsg=${r?.message || 'N/A'}`);
  const userMsg = sanitizeImageErrorForUser(r?.message, r?.code);
  return res.status(400).json({
    success: false,
    code: r?.code,
    error: userMsg,
    imc: r,
  });
}

/**
 * ★ D139 (0425): multer가 multipart/form-data의 filename을 latin1로 디코딩 →
 *   한글 파일명 깨짐 (`행사이미지.jpg` → `ë틀ɑì틀´ë²틀(틀틀틀´.jpg`).
 *   이를 utf-8로 재해석해 정상 한글로 복원. 9개 업로드 라우트 + persistImage(DB INSERT) 자동 정상화.
 */
function decodeOriginalName(file: Express.Multer.File): Express.Multer.File {
  if (file && typeof file.originalname === 'string') {
    try {
      file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    } catch {
      /* noop — 원본 유지 */
    }
  }
  return file;
}

function requireFile(req: Request, res: Response): Express.Multer.File | null {
  const file = (req as any).file;
  if (!file) {
    res.status(400).json({ success: false, error: '파일이 필요합니다' });
    return null;
  }
  return decodeOriginalName(file);
}

function requireFiles(req: Request, res: Response): Express.Multer.File[] | null {
  const files = (req as any).files;
  if (!files || !Array.isArray(files) || files.length === 0) {
    res.status(400).json({ success: false, error: '파일이 필요합니다' });
    return null;
  }
  return files.map(decodeOriginalName);
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
      return sendImageUploadResponse(res, r);
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
      return sendImageUploadResponse(res, r);
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
      return sendImageUploadResponse(res, r);
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
      return sendImageUploadResponse(res, r);
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
      return sendImageUploadResponse(res, r);
    } catch (err) { return handleImcError(res, err); }
  },
);

// (6) 브랜드 와이드 리스트 (최대 3장)
// ★ D143 E (2026-04-30): 다중 이미지도 sendImageUploadMultiResponse로 평탄화 + extractImageListFromAnyShape로 어떤 래핑이든 list 추출
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
      if (r.code === '0000') {
        const list = extractImageListFromAnyShape(r);
        for (let i = 0; i < list.length && i < files.length; i++) {
          await persistImage(
            req,
            'brand_wide_list',
            { code: '0000', message: 'OK', data: list[i] },
            files[i],
          );
        }
      }
      return sendImageUploadMultiResponse(res, r as any);
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
      if (r.code === '0000') {
        const list = extractImageListFromAnyShape(r);
        for (let i = 0; i < list.length && i < files.length; i++) {
          await persistImage(
            req,
            'brand_carousel_feed',
            { code: '0000', message: 'OK', data: list[i] },
            files[i],
          );
        }
      }
      return sendImageUploadMultiResponse(res, r as any);
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
      if (r.code === '0000') {
        const list = extractImageListFromAnyShape(r);
        for (let i = 0; i < list.length && i < files.length; i++) {
          await persistImage(
            req,
            'brand_carousel_commerce',
            { code: '0000', message: 'OK', data: list[i] },
            files[i],
          );
        }
      }
      return sendImageUploadMultiResponse(res, r as any);
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
      // ★ D143 E (2026-04-30): IMC 래핑 변종에도 imageName 견고하게 추출
      const { imageName: marketingImgName } = extractImageFromAnyShape(r);
      await query(
        `UPDATE kakao_sender_profiles
            SET marketing_agree_file_key = $1, updated_at = now()
          WHERE id = $2`,
        [marketingImgName || null, req.params.senderId],
      );
      await persistImage(req, 'marketing_agree', r, file);
      return sendImageUploadResponse(res, r);
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
      if (!name || !String(name).trim()) {
        return res.status(400).json({ success: false, error: '수신자 이름은 필수입니다' });
      }
      // 회사당 3명 제한 (한줄로 자체 정책)
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
      // ★ D135+: IMC createAlarmUser 호출 제거 (4032 AUTH 이슈).
      //   검수 결과 알림은 한줄로가 직접 `syncPendingTemplatesJob`에서 SMS로 발송.
      //   imc_alarm_user_id는 내부 식별자로만 유지 (향후 IMC 전환 대비).
      const alarmUserKey = `${companyId.replace(/-/g, '').slice(0, 12)}_${phoneNumber}`;
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
      res.status(201).json({ success: true, user: ins.rows[0] });
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
        `SELECT id FROM kakao_alarm_users
          WHERE id = $1 AND company_id = $2`,
        [req.params.id, companyId],
      );
      if (row.rows.length === 0) {
        return res.status(404).json({ success: false, error: '수신자 없음' });
      }
      // ★ D135+: IMC updateAlarmUser 호출 제거. DB UPDATE만.
      const { name, phoneNumber, activeYn } = req.body || {};
      // 활성 전환 시 3명 제한 재검증 (본인 제외)
      if (activeYn === 'Y') {
        const cnt = await query(
          `SELECT COUNT(*)::int AS c FROM kakao_alarm_users
            WHERE company_id = $1 AND COALESCE(active_yn,'Y') = 'Y' AND id <> $2`,
          [companyId, req.params.id],
        );
        if ((cnt.rows[0]?.c ?? 0) >= 3) {
          return res.status(400).json({
            success: false,
            error: '활성 알림 수신자는 최대 3명까지 등록 가능합니다',
          });
        }
      }
      const upd = await query(
        `UPDATE kakao_alarm_users
            SET name = COALESCE($1,name),
                phone_number = COALESCE($2,phone_number),
                active_yn = COALESCE($3,active_yn),
                updated_at = now()
          WHERE id = $4
          RETURNING *`,
        [name, phoneNumber, activeYn, req.params.id],
      );
      res.json({ success: true, user: upd.rows[0] });
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
        `SELECT id FROM kakao_alarm_users
          WHERE id = $1 AND company_id = $2`,
        [req.params.id, companyId],
      );
      if (row.rows.length === 0) {
        return res.status(404).json({ success: false, error: '수신자 없음' });
      }
      // ★ D135+: IMC deleteAlarmUser 호출 제거. DB DELETE만.
      await query(`DELETE FROM kakao_alarm_users WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
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

// ★ D217+ (2026-05-26 Harold 명시 진단 영역 정정):
//   옛 D147 영역 = 검수 통과 후 IMC 안 진정 카카오 templateCode (B_XX_xxx_xx_xxxxx) 영역 영구 발급 →
//   한줄로 안 = 옛 Tmp_xxx 영구 유지 사고 (운영 환경 8건 100% 사고 영역).
//   본 endpoint = 옛 Tmp_xxx 영역 = 진정 카카오 templateCode 영역 일괄 백필.
//
//   Phase 1 — 1회성 백필 (옛 사고 영역 즉시 정정).
//   Phase 3 — 30분 cron 영역 (kakao-template-sync-worker) = 향후 영구 안전망.
//   Phase 2 — getAlimtalkTemplate 영역 (사용자 조회 시점 자동 정합) = 옛 routes/alimtalk.ts:891 영역.
//
//   슈퍼관리자 전용 영역. dryRun=true 시 시뮬레이션 영역 (UPDATE X).
//   companyId 지정 시 본 회사 영역만 sync.
router.post(
  '/jobs/sync-template-codes',
  requireSuperAdmin as any,
  async (req: Request, res: Response) => {
    try {
      const dryRun = req.body?.dryRun === true;
      const companyId = req.body?.companyId ? String(req.body.companyId) : undefined;
      const startedAt = Date.now();
      console.log(
        `[alimtalk][jobs/sync-template-codes] 진입 — dryRun=${dryRun} companyId=${companyId || '(all)'}`,
      );
      const result = await syncTemplateCodes({ dryRun, companyId });
      const elapsedMs = Date.now() - startedAt;
      console.log(
        `[alimtalk][jobs/sync-template-codes] 종결 — scanned=${result.scanned} matched=${result.matched} updated=${result.updated} skipped=${result.skipped} failed=${result.failed} (${elapsedMs}ms)`,
      );
      res.json({ success: true, dryRun, elapsedMs, ...result });
    } catch (err) {
      return handleImcError(res, err);
    }
  },
);

export default router;
