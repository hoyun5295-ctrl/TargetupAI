/**
 * routes/image-studio.ts — P4 AI 이미지 스튜디오 API (2026-07-19)
 *
 * 흐름: 상품 누끼(픽셀 보존) → AI 배경 생성 → 서버 합성(/compose) → 정제 타이포 → 저장(라이브러리).
 * 크레딧: checkCredit(사전 402) → Gemini 성공 → settleCreditAfterSuccess(멱등키 = 시도 키 · 없으면 image-studio:{uuid} · 동시 소진 = 402 · Codex E1).
 * 에러: Gemini/py 원문 미노출(StudioError 코드 매핑만) — 모델명 노출 차단(§5-1-11).
 *
 * endpoint:
 *   GET  /status                       — 준비 여부 + temp 사용량
 *   POST /generate                     — 완성 포스터 1장(2크레딧) ★2026-07-30 후보 2장→1장(같은 프롬프트 무작위 2회였음·레시피 차이 없음), 크레딧 2 유지(Harold 확정)
 *   POST /ingest-product {url}         — 연동몰 CDN 이미지 SSRF 가드 fetch → source temp
 *   POST /upload-product (multipart)   — 제품 이미지 업로드 → source temp
 *   POST /remove-bg {sourceTempId}     — 누끼(무료) → cutout temp
 *   POST /edit {tempId, instruction}  — AI 수정 지시(1크레딧) ★2026-09-30 4K 격상 제거(targetSize 4K = 410 · 차감 없음)
 *   POST /compose {...}                — 서버 합성(무료) → composite temp
 *   POST /save {tempId, channelSpec?}  — 영구 저장 + cdp_assets 등재(tempId 1회성)
 *   GET  /temp/:tempId                 — 인증 서빙(프론트 fetch+blob)
 */

import { Router, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
// ★ 2026-09-27 R126 — 가드 이미지 CT
import { fetchImageGuarded, studioIndustryCategories } from '../utils/sales-outreach-produce';
import { resolveCompanyIndustry } from '../utils/copy-prompt-composer';
import { authenticate } from '../middlewares/auth';
import { resolveOwnerScope } from '../utils/owner-scope';
import { LIMITS } from '../config/defaults';
import { checkCredit, settleCreditAfterSuccess, InsufficientCreditError, isChargedByKey } from '../utils/ai-credit';
import { runSerial } from '../utils/inflight-lock';
import { studioAttemptKey, rememberStudioResult, recallStudioResult } from '../utils/image-studio-attempt';
import { loadPlanContext, isAiOperatorAllowed } from '../utils/plan-guard';
import { registerAsset, getStorageUsage, isAssetsTableMissing, getAsset, getAssetByUrl } from '../utils/assets';
import {
  isStudioReady, StudioError, CREDIT_SOURCE,
  resolvePreset, buildPosterPrompt, hasBenefitPattern, buildAssetDisplayName,
  generatePoster, editOrUpscale, buildEditInstruction, studioImageEngine,
  removeBackground, composeImage,
  writeTempBuffer, allocTempPath, writeTempMeta, readTempMeta, clearTempMeta, findTempFile, moveTempToPermanent, restorePermanentToTemp, findPermanentByTempId,
  companyTempUsageBytes, isValidTempId, newTempId,
  tryAcquireGenerateLock, releaseGenerateLock,
  findTemplateSample, writeTemplateSample,
  isStudioTempFull,
  STUDIO_TEMP_CAP_BYTES, STUDIO_TEMP_TTL_DAYS,
  type ComposeTypography, type TempMeta,
} from '../utils/image-studio';
import { getTemplate, listTemplatesPublic, findUnfilledTemplateText } from '../utils/image-studio-templates';
import { SUB_ORDER } from '../utils/image-studio-template-subs';

export const imageStudioRouter = Router();

// ── GET /template-sample/:id — 템플릿 예시 실샘플 서빙 (★인증 미들웨어 앞 = 공개) ──
//   갤러리 카드가 <img src>로 직접 로드(인증 헤더 없음). 은닉 정보 없음(완성 목업 이미지뿐).
//   경로는 카탈로그 실존 id로만 조립(getTemplate 검증) — 임의 경로 조작 차단.
imageStudioRouter.get('/template-sample/:id', (req: any, res: Response) => {
  const id = String(req.params.id || '');
  if (!getTemplate(id)) return res.status(404).json({ success: false, error: '템플릿을 찾을 수 없습니다.' });
  const sample = findTemplateSample(id);
  if (!sample) return res.status(404).json({ success: false, error: '예시 이미지가 아직 없습니다.' });
  res.setHeader('Content-Type', sample.mime);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  // ★ 2026-09-09 아웃리치 공개 샘플 페이지가 PUBLIC_BASE 와 다른 호스트에서 <img> 로 불러온다 —
  //   helmet 기본 Cross-Origin-Resource-Policy(same-origin)가 교차 로드를 막으므로 명시 허용(cdp.ts 인앱 이미지 서빙과 동일).
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  return res.sendFile(sample.absPath);
});

imageStudioRouter.use(authenticate);

const FONT_DIR = process.env.STUDIO_FONT_DIR || path.resolve('./uploads/fonts');
// 라이브러리 자산 실물 경로 — utils/assets.ts와 동일 정의 미러(단일 env 소스)
const INAPP_IMAGE_BASE = process.env.INAPP_IMAGE_PATH || path.resolve('./uploads/inapp');
// MMS 이미지 저장소 — routes/mms-images.ts와 동일 정의 미러(변환 산출물을 기존 발송 계약 저장소로)
const MMS_IMAGE_BASE = process.env.MMS_IMAGE_PATH || path.resolve('./uploads/mms');

// StudioError / 크레딧 부족 → 표준 응답. 그 외 = 로그 후 GEN_FAILED.
function respondStudioError(res: Response, err: any): Response {
  if (err instanceof StudioError) {
    return res.status(err.httpStatus).json({ success: false, error: err.userMessage, code: err.code });
  }
  if (err instanceof InsufficientCreditError) {
    return res.status(402).json({ success: false, error: '크레딧이 부족합니다. 충전 후 다시 시도해주세요.', code: 'INSUFFICIENT_CREDIT' });
  }
  console.error('[image-studio] 처리 오류:', err?.message || err);
  return res.status(502).json({ success: false, error: '이미지 생성에 실패했어요. 잠시 후 다시 시도해주세요.', code: 'GEN_FAILED' });
}

/**
 * ★ 2026-10-19 B-1016-3① 서버 쪽 요금제 검사 — 화면 PlanGate(image-studio = AI 오퍼레이터 이용 가능)와 같은 판정.
 *   크레딧을 쓰는 생성 · 수정에만 건다(라이브러리 그림 MMS 넣기 · 임시 그림 보기는 다른 발송 화면도 쓰므로 그대로).
 */
async function studioPlanBlocked(req: any, res: Response): Promise<boolean> {
  const plan = await loadPlanContext(req.user?.companyId);
  if (plan && isAiOperatorAllowed(plan, req.user)) return false;
  res.status(403).json({ success: false, error: '이 기능은 요금제 가입 후 이용할 수 있어요.', code: 'PLAN_GATED' });
  return true;
}

// ── GET /status ──────────────────────────────────────────────
imageStudioRouter.get('/status', (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const usageBytes = companyId ? companyTempUsageBytes(companyId) : 0;
  return res.json({
    success: true,
    ready: isStudioReady(),
    tempCapBytes: STUDIO_TEMP_CAP_BYTES,
    tempUsageBytes: usageBytes,
    tempTtlDays: STUDIO_TEMP_TTL_DAYS,
  });
});

// ── GET /templates — 갤러리 공개 목록(★은닉 스캐폴드 미포함) ─────────
//   ★2026-07-31 exampleUrl 폴백 — 카탈로그 미지정이어도 배치 생성 실샘플 파일이 있으면 카드에 표시.
//   ★2026-10-16 industryCategories = 이 회사 업종(뷰티·의류·요식만)의 제품 카테고리 · 그 밖·미설정·조회 실패 = null.
//     ⛔ 회사별 값이 섞인 응답이다 · 공용 캐시(Cache-Control public 등)를 붙이지 않는다(다른 회사로 샌다).
imageStudioRouter.get('/templates', async (req: any, res: Response) => {
  const templates = listTemplatesPublic().map((t) => ({
    ...t,
    exampleUrl: t.exampleUrl || (findTemplateSample(t.id) ? `/api/image-studio/template-sample/${t.id}` : null),
  }));
  const companyId = req.user?.companyId;
  const industryCategories = companyId ? studioIndustryCategories(await resolveCompanyIndustry(companyId)) : null;
  // ★ 2026-10-06 subOrder = 카테고리별 세부 칩 순서(화면이 이 순서로 칩을 그린다)
  return res.json({ success: true, templates, subOrder: SUB_ORDER, industryCategories });
});

// ── POST /template-samples/generate — 예시 실샘플 배치 생성 (★슈퍼관리자 전용·내부 원가) ──
//   템플릿 sample 카피(무드별 실카피·혜택 수치 0)로 제품 없이 1장씩 생성해 영구 저장.
//   크레딧 미차감(고객 과금 아님 — Gemini 원가만). HTTP 타임아웃 대비 호출당 limit장(기본 2·최대 5)씩 진행,
//   remaining이 0이 될 때까지 재호출. 동시 실행 1회(모듈 잠금).
let sampleGenInFlight = false;
imageStudioRouter.post('/template-samples/generate', async (req: any, res: Response) => {
  if (req.user?.userType !== 'super_admin') {
    return res.status(403).json({ success: false, error: '슈퍼관리자만 실행할 수 있습니다.' });
  }
  if (!isStudioReady()) return respondStudioError(res, new StudioError('STUDIO_NOT_READY', 503));
  if (sampleGenInFlight) return res.status(409).json({ success: false, error: '샘플 생성이 이미 진행 중입니다.' });
  sampleGenInFlight = true;
  try {
    const limit = Math.max(1, Math.min(5, Number(req.body?.limit) || 2));
    const publicList = listTemplatesPublic();
    const missing = publicList.filter((t) => !t.exampleUrl && !findTemplateSample(t.id));
    const targets = missing.slice(0, limit);
    const preset = resolvePreset('poster');
    // 토큰({productName})·placeholder([...]) 포함 기본값은 샘플에 쓰지 않는다 — sample 카피가 항상 우선.
    const clean = (s?: string) => (s && !s.includes('{') && !s.includes('[') ? s : '');
    const generated: string[] = [];
    const failed: string[] = [];
    for (const pub of targets) {
      const t = getTemplate(pub.id);
      if (!t) continue;
      try {
        const prompt = buildPosterPrompt({
          template: t,
          preset,
          texts: {
            label: clean(t.defaultTexts.label),
            title: t.sample?.title || clean(t.defaultTexts.title) || t.name,
            subtitle: t.sample?.subtitle || '',
          },
          userHint: null,
          hasProduct: false,
        });
        const img = await generatePoster(prompt, preset, null);
        writeTemplateSample(t.id, Buffer.from(img.base64, 'base64'), img.mime);
        generated.push(t.id);
      } catch (err: any) {
        console.error(`[image-studio] 템플릿 샘플 생성 실패(${t.id}):`, err?.message || err);
        failed.push(t.id);
      }
    }
    return res.json({
      success: true,
      generated,
      failed,
      remaining: missing.length - generated.length,
      total: publicList.length,
    });
  } finally {
    sampleGenInFlight = false;
  }
});

// ── POST /generate — 템플릿 + 누끼 + 지정 문구 → 완성 포스터 1장 (2크레딧 고정) ──
imageStudioRouter.post('/generate', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  if (!isStudioReady()) return respondStudioError(res, new StudioError('STUDIO_NOT_READY', 503));

  if (await studioPlanBlocked(req, res)) return;
  const { templateId, presetKey, userHint, texts, cutoutTempId, textPosition } = req.body || {};
  // ★ 2026-10-19 B-1016-3② 시도 키(화면이 보낼 때만) — 같은 시도 = 기억한 결과 · 이미 걷혔으면 다시 걷지 않는다
  const attemptKey = studioAttemptKey('gen', companyId, req.body?.attemptToken, { templateId, presetKey, userHint, texts, cutoutTempId, textPosition });
  // 회사당 동시 생성 1건 (fork 단일 = in-memory)
  // ★ Codex E2 — 같은 시도의 결과 돌려주기 · 납부 확인 = 이 잠금 안에서 · 새 작업 검사(입력 · 잔액 · 임시 용량)보다 먼저
  //   (옛: 잠금 밖 · 잔액 확인 앞이라, 원요청이 막 걷은 뒤의 재요청이 402 · 409 를 받고 다시 걷힐 수 있었다)
  if (!tryAcquireGenerateLock(companyId)) return respondStudioError(res, new StudioError('BUSY', 409));
  try {
  if (attemptKey) {
    const hit = recallStudioResult<Record<string, unknown>>(attemptKey);
    if (hit) return res.json(hit);
  }
  let alreadyPaid = false;
  if (attemptKey) {
    try { alreadyPaid = await isChargedByKey(companyId, attemptKey); } catch {
      return res.status(503).json({ success: false, error: '크레딧 내역을 확인하지 못했어요. 잠시 뒤 다시 시도해주세요.', code: 'CREDIT_STATE_UNKNOWN' });
    }
  }
  const template = getTemplate(String(templateId || ''));
  if (!template) return res.status(400).json({ success: false, error: '템플릿을 선택해주세요.' });
  const preset = resolvePreset(presetKey);

  // 누끼 첨부(선택) — 있으면 제품 포함 완성 포스터, 없으면 문구 포함 배경 포스터
  let cutout: { base64: string; mime: string } | null = null;
  if (cutoutTempId) {
    const cf = findTempFile(companyId, String(cutoutTempId));
    const cm = readTempMeta(companyId, String(cutoutTempId));
    if (!cf || !cm || (cm.kind !== 'cutout' && cm.kind !== 'source')) {
      return res.status(404).json({ success: false, error: '제품 이미지를 찾을 수 없습니다. 다시 준비해주세요.' });
    }
    cutout = { base64: fs.readFileSync(cf.absPath).toString('base64'), mime: cf.mime };
  }

  // ★ 2026-09-27 한줄로 V2 R242 — 템플릿 예시 문구가 그대로면 만들지 않는다(포스터에 그려진 채 2크레딧이 빠졌다 · 화면은 미리 채워 둔다)
  const unfilledField = findUnfilledTemplateText(texts);
  if (unfilledField) {
    return res.status(400).json({ success: false, error: '문구 칸에 예시 문구가 그대로 있습니다. 실제 문구로 바꾼 뒤 만들어 주세요.', code: 'PLACEHOLDER_TEXT', field: unfilledField });
  }

  // 사전 차단(최대 2크레딧 기준) — 이미 낸 시도는 걷지 않으므로 보지 않는다
  if (!alreadyPaid) { try { await checkCredit(companyId, 2); } catch (err) { return respondStudioError(res, err); } }

    // temp 상한 검사(200MB) — ★ 2026-09-27 R125 CT(모든 임시 쓰기 라우트가 같은 판정)
    if (isStudioTempFull(companyId)) return respondStudioError(res, new StudioError('TEMP_FULL', 409));

    const benefitInHint = hasBenefitPattern(userHint);
    // ★ 2026-08-09 문구 위치(행사 포스터 위/중앙/아래) — 화이트리스트 밖 값은 무시(템플릿 기본 배치)
    const textPos = textPosition === 'top' || textPosition === 'center' || textPosition === 'bottom' ? textPosition : null;
    const prompt = buildPosterPrompt({
      template, preset,
      texts: { label: texts?.label, title: texts?.title, subtitle: texts?.subtitle },
      userHint: benefitInHint ? null : userHint,
      hasProduct: !!cutout,
      textPosition: textPos,
    });

    // ★ 2026-07-30 1장 생성 (Harold 확정) — 옛 후보 2장은 같은 prompt·preset 무작위 2회 호출이라 레시피 차이가 없었다.
    //   1회 호출로 줄이고 크레딧은 2 유지 → 크레딧당 Gemini 호출 0.5회(원가 절반). 실패 = 미차감(throw → respondStudioError).
    //   ★ 2026-09-30 생성 엔진 = 스위치(STUDIO_IMAGE_ENGINE · 기본 gemini) — 원장 docs/2026-09-30-ai-model-prompt-upgrade.md §2-4
    const oks = [await generatePoster(prompt, preset, cutout, { engine: studioImageEngine() })];

    // temp 기록
    const images = oks.map((img) => {
      const buf = Buffer.from(img.base64, 'base64');
      const ext = (img.mime.split('/')[1] || 'jpeg').replace('jpg', 'jpeg');
      const tempId = writeTempBuffer(companyId, buf, {
        kind: 'poster', ext, mime: img.mime, prompt, presetKey: preset.key,
        channelSpec: preset.channelSpec, aspectRatio: preset.aspectRatio, width: null, height: null,
      });
      return { tempId, url: `/api/image-studio/temp/${tempId}`, presetKey: preset.key };
    });

    // 성공 후 차감 — 생성 1회 = 2크레딧 고정(★2026-07-30 Harold 확정: 1장 생성이어도 2). 멱등키 = 생성 요청 uuid.
    const cost = 2;
    if (!alreadyPaid) {
      // ★ Codex E1 — 사전 확인 뒤 다른 기능이 잔액을 먼저 쓰면 여기서 402(무과금 결과를 내주지도 기억하지도 않는다)
      await settleCreditAfterSuccess({
        companyId, cost, source: CREDIT_SOURCE.generate, createdBy: userId,
        idempotencyKey: attemptKey || `image-studio:${newTempId()}`,
      });
    }

    const body = {
      success: true,
      images,
      benefitNotice: benefitInHint ? '혜택 문구는 문구 칸(라벨·헤드라인·부제)에 입력해주세요. 장면 힌트에는 장면 묘사만 들어가요.' : null,
    };
    if (attemptKey) rememberStudioResult(attemptKey, body);
    return res.json(body);
  } catch (err) {
    return respondStudioError(res, err);
  } finally {
    releaseGenerateLock(companyId);
  }
});

// ── POST /edit (AI 수정 지시) ─────────────────────
imageStudioRouter.post('/edit', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

  if (await studioPlanBlocked(req, res)) return;
  const { tempId, instruction, targetSize } = req.body || {};
  // ★ 2026-09-30 4K 격상 제거(Harold 확정) — 생성 모델이 "같은 그림 4K"를 새로 그려 다른 포스터가 나왔다(운영 실측 · 원장 docs/2026-09-30-ai-model-prompt-upgrade.md §2-4).
  //   캐시된 옛 화면이 보내면 차감 없이 안내만 돌려준다(검사 · 잠금 · 차감 전).
  if (String(targetSize || '') === '4K') {
    return res.status(410).json({ success: false, error: '4K 격상은 더 이상 제공하지 않아요. 만든 포스터를 그대로 저장해 쓰시면 됩니다.', code: 'UPSCALE_REMOVED' });
  }
  if (!isStudioReady()) return respondStudioError(res, new StudioError('STUDIO_NOT_READY', 503));

  // ★ Codex E2 — /generate 와 같은 순서: 회사 잠금 → 같은 시도의 기억 결과 → 납부 확인 → 새 작업 검사(임시 용량 · 대상 · 잔액)
  const attemptKey = studioAttemptKey('edit', companyId, req.body?.attemptToken, { tempId, instruction });
  if (!tryAcquireGenerateLock(companyId)) return respondStudioError(res, new StudioError('BUSY', 409));
  try {
  if (attemptKey) {
    const hit = recallStudioResult<Record<string, unknown>>(attemptKey);
    if (hit) return res.json(hit);
  }
  let alreadyPaid = false;
  if (attemptKey) {
    try { alreadyPaid = await isChargedByKey(companyId, attemptKey); } catch {
      return res.status(503).json({ success: false, error: '크레딧 내역을 확인하지 못했어요. 잠시 뒤 다시 시도해주세요.', code: 'CREDIT_STATE_UNKNOWN' });
    }
  }
  if (isStudioTempFull(companyId)) return respondStudioError(res, new StudioError('TEMP_FULL', 409));  // ★ 2026-09-27 R125

  if (!isValidTempId(tempId)) return res.status(400).json({ success: false, error: '대상 이미지를 찾을 수 없습니다.' });
  const found = findTempFile(companyId, tempId);
  const meta = readTempMeta(companyId, tempId);
  if (!found || !meta || (meta.kind !== 'background' && meta.kind !== 'poster')) {
    return res.status(404).json({ success: false, error: '편집 가능한 생성 이미지가 아닙니다.', code: 'NOT_EDITABLE' });
  }

  const cost = 1;
  const source = CREDIT_SOURCE.edit;
  if (!(instruction && String(instruction).trim())) {
    return res.status(400).json({ success: false, error: '어떻게 바꿀지 알려주세요.' });
  }

  if (!alreadyPaid) { try { await checkCredit(companyId, cost); } catch (err) { return respondStudioError(res, err); } }

    const base = fs.readFileSync(found.absPath).toString('base64');
    const result = await editOrUpscale({
      baseImageBase64: base, baseMime: found.mime,
      basePrompt: meta.prompt || 'A clean product-staging background scene.',
      instruction: buildEditInstruction(instruction),
      imageSize: '2K',
      aspectRatio: meta.aspectRatio || resolvePreset(meta.presetKey || undefined).aspectRatio,
      engine: studioImageEngine(),  // ★0930 생성 엔진 스위치
    });

    const buf = Buffer.from(result.base64, 'base64');
    const ext = (result.mime.split('/')[1] || 'jpeg').replace('jpg', 'jpeg');
    const newTemp = writeTempBuffer(companyId, buf, {
      kind: meta.kind, ext, mime: result.mime,
      prompt: meta.prompt, presetKey: meta.presetKey, channelSpec: meta.channelSpec,
      aspectRatio: meta.aspectRatio, width: null, height: null,
    });

    if (!alreadyPaid) {
      await settleCreditAfterSuccess({ companyId, cost, source, createdBy: userId, idempotencyKey: attemptKey || `image-studio:${newTempId()}` });   // ★ Codex E1 동시 소진 = 402
    }
    const body = { success: true, image: { tempId: newTemp, url: `/api/image-studio/temp/${newTemp}` } };
    if (attemptKey) rememberStudioResult(attemptKey, body);
    return res.json(body);
  } catch (err) {
    return respondStudioError(res, err);
  } finally {
    releaseGenerateLock(companyId);
  }
});

// ── POST /ingest-product (SSRF 가드 fetch) ──────────────────────
// ★ 2026-09-27 한줄로 V2 R126 — 가드 이미지 CT(sales-outreach-produce fetchImageGuarded)로 통일:
//   https만 · 계정 정보 URL 거부 · 사설·예약 주소 차단 · **검증한 DNS 주소로 연결 고정**(재바인딩 창 제거) ·
//   리다이렉트 거부 · image/* · 10MB · 시간 상한. 옛: 조회 뒤 fetch가 호스트를 다시 해석했고(재바인딩 창)
//   라우트 안의 사설 판정이 CT보다 약했다(::ffff:169.254 등 누락).
imageStudioRouter.post('/ingest-product', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  if (isStudioTempFull(companyId)) return respondStudioError(res, new StudioError('TEMP_FULL', 409));  // ★ 2026-09-27 R125
  const rawUrl = String(req.body?.url || '').trim();

  try {
    const img = await fetchImageGuarded(rawUrl);
    if (!img) return respondStudioError(res, new StudioError('INGEST_FAILED', 400));
    const ext = img.mime.includes('png') ? 'png' : img.mime.includes('webp') ? 'webp' : 'jpeg';
    const tempId = writeTempBuffer(companyId, img.buffer, { kind: 'source', ext, mime: img.mime, width: null, height: null });
    return res.json({ success: true, source: { tempId, url: `/api/image-studio/temp/${tempId}` } });
  } catch (err) {
    return respondStudioError(res, err);
  }
});

// ── POST /upload-product (multipart) ───────────────────────────
const productUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.toLowerCase().startsWith('image/')) cb(null, true);
    else cb(new Error('이미지 파일만 업로드할 수 있습니다.'));
  },
});
imageStudioRouter.post('/upload-product', (req: any, res: Response) => {
  productUpload.single('image')(req, res, (err: any) => {
    if (err) return res.status(400).json({ success: false, error: err.message || '업로드 실패' });
    const companyId = req.user?.companyId;
    if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
    if (isStudioTempFull(companyId)) return respondStudioError(res, new StudioError('TEMP_FULL', 409));  // ★ 2026-09-27 R125
    const file = req.file as Express.Multer.File | undefined;
    if (!file) return res.status(400).json({ success: false, error: '이미지를 선택해주세요.' });
    const ctype = file.mimetype.toLowerCase();
    const ext = ctype.includes('png') ? 'png' : ctype.includes('webp') ? 'webp' : 'jpeg';
    const tempId = writeTempBuffer(companyId, file.buffer, { kind: 'source', ext, mime: ctype, width: null, height: null });
    return res.json({ success: true, source: { tempId, url: `/api/image-studio/temp/${tempId}` } });
  });
});

// ── POST /remove-bg (누끼 — 무료) ───────────────────────────────
imageStudioRouter.post('/remove-bg', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  if (isStudioTempFull(companyId)) return respondStudioError(res, new StudioError('TEMP_FULL', 409));  // ★ 2026-09-27 R125
  const { sourceTempId } = req.body || {};
  const src = findTempFile(companyId, sourceTempId);
  if (!src) return res.status(404).json({ success: false, error: '원본 이미지를 찾을 수 없습니다.' });

  try {
    const { tempId, absPath } = allocTempPath(companyId, 'png');
    const { width, height } = await removeBackground(src.absPath, absPath);
    writeTempMeta(companyId, tempId, { kind: 'cutout', ext: 'png', mime: 'image/png', width, height });
    return res.json({ success: true, cutout: { tempId, url: `/api/image-studio/temp/${tempId}`, width, height } });
  } catch (err) {
    return respondStudioError(res, err);
  }
});

// ── POST /compose (서버 합성 — 무료) ────────────────────────────
imageStudioRouter.post('/compose', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  if (isStudioTempFull(companyId)) return respondStudioError(res, new StudioError('TEMP_FULL', 409));  // ★ 2026-09-27 R125

  const { bgTempId, cutoutTempId, layout, typography, presetKey } = req.body || {};
  const bg = findTempFile(companyId, bgTempId);
  const bgMeta = readTempMeta(companyId, bgTempId);
  if (!bg || !bgMeta) return res.status(404).json({ success: false, error: '배경 이미지를 찾을 수 없습니다.' });
  const cutout = cutoutTempId ? findTempFile(companyId, cutoutTempId) : null;
  if (cutoutTempId && !cutout) return res.status(404).json({ success: false, error: '누끼 이미지를 찾을 수 없습니다.' });

  const preset = resolvePreset(presetKey || bgMeta.presetKey || undefined);
  const isMms = preset.track === 'mms';

  // 타이포 폰트 키 → 서버 폰트 경로(있으면). 없으면 python이 기본 폰트 폴백.
  const typo: ComposeTypography[] = Array.isArray(typography)
    ? typography.slice(0, 5).map((t: any) => {
        const key = String(t.font || '').replace(/[^a-zA-Z0-9_-]/g, '');
        const fp = key ? path.join(FONT_DIR, `${key}.ttf`) : '';
        return {
          text: String(t.text || '').slice(0, 200),
          fontPath: fp && fs.existsSync(fp) ? fp : null,
          size: Math.min(0.3, Math.max(0.01, Number(t.size) || 0.06)),
          color: /^#[0-9a-fA-F]{6}$/.test(t.color) ? t.color : '#ffffff',
          align: ['left', 'center', 'right'].includes(t.align) ? t.align : 'center',
          x: Math.min(1, Math.max(0, Number(t.x) || 0.5)),
          y: Math.min(1, Math.max(0, Number(t.y) || 0.1)),
        } as ComposeTypography;
      }).filter((t) => t.text)
    : [];

  try {
    const { tempId, absPath } = allocTempPath(companyId, 'jpeg');
    const r = await composeImage({
      bgPath: bg.absPath,
      cutoutPath: cutout?.absPath || null,
      outPath: absPath,
      layout: layout && typeof layout === 'object' ? {
        x: Math.min(1, Math.max(0, Number(layout.x) || 0.5)),
        y: Math.min(1, Math.max(0, Number(layout.y) || 0.72)),
        scale: Math.min(1, Math.max(0.1, Number(layout.scale) || 0.5)),
      } : null,
      typography: typo,
      mmsMaxBytes: isMms ? LIMITS.mmsImageSize : null,
      format: 'jpeg',
    });
    writeTempMeta(companyId, tempId, {
      kind: 'composite', ext: 'jpeg', mime: r.mime, prompt: bgMeta.prompt,
      presetKey: preset.key, channelSpec: preset.channelSpec, width: r.width, height: r.height,
      aspectRatio: preset.aspectRatio,
    });
    return res.json({ success: true, composite: { tempId, url: `/api/image-studio/temp/${tempId}`, bytes: r.bytes, width: r.width, height: r.height } });
  } catch (err) {
    return respondStudioError(res, err);
  }
});

// ── POST /save (영구 저장 + cdp_assets 등재) ─────────────────────
imageStudioRouter.post('/save', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  const userId = req.user?.userId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });

  const { tempId, channelSpec, title } = req.body || {};
  if (!isValidTempId(tempId)) return res.status(400).json({ success: false, error: '저장할 이미지를 찾을 수 없습니다.' });
  // ★ 2026-10-19 Codex E8 — 같은 임시 id 의 저장 전체를 줄 세운다(첫 저장이 옮긴 뒤 · 등재 커밋 전의 재저장이 0행을 보고 만료로 끝나던 경합).
  //   줄 선 뒤 파일 · 사이드카를 읽으므로 뒤 차례는 앞 저장이 끝난 상태(소재 있음 · 마무리 대기 · 되돌림)를 본다. 프로세스 1개 전제 = 다른 잠금과 같다.
  await runSerial(`studio-save:${companyId}:${tempId}`, async () => {
  let meta = readTempMeta(companyId, tempId);
  let found = findTempFile(companyId, tempId);
  // ★ Codex E3 — 지난 저장이 등재 여부를 확인하지 못하고 남긴 그림 = 다시 확인해 마무리(있으면 그 소재 · 없으면 등재 · 또 모르면 503 그대로)
  //   ★ Codex E4 · E8 — 겹친 재저장은 바깥 줄(같은 임시 id)이 막는다 · 여기서 사이드카를 다시 읽는다
  if (meta && !found && meta.pendingAsset) {
    const outcome = await (async (): Promise<{ id: string; pa: NonNullable<TempMeta['pendingAsset']> } | 'gone' | 'unknown'> => {
      const cur = readTempMeta(companyId, tempId);
      const pa = cur?.pendingAsset;
      if (!pa) return 'gone';
      try {
        const existing = await getAssetByUrl(companyId, pa.url);
        const id = existing?.id || await registerAsset({
          companyId, createdBy: userId, kind: 'generated', origin: 'studio',
          url: pa.url, filename: pa.displayName, bytes: pa.bytes, format: pa.filename.endsWith('.png') ? 'png' : 'jpg',
          prompt: null, channelSpec: pa.channelSpec, width: cur?.width ?? null, height: cur?.height ?? null,
        }) || (await getAssetByUrl(companyId, pa.url))?.id;
        if (!id) return 'unknown';
        clearTempMeta(companyId, tempId);
        return { id, pa };
      } catch { return 'unknown'; }
    })();
    if (outcome === 'unknown') return res.status(503).json({ success: false, error: '라이브러리에 올렸는지 확인하지 못했어요. 잠시 뒤 같은 그림으로 다시 저장해 주세요.', code: 'ASSET_REGISTER_UNKNOWN' });
    if (outcome !== 'gone') return res.json({ success: true, asset: { id: outcome.id, url: outcome.pa.url, bytes: outcome.pa.bytes, channelSpec: outcome.pa.channelSpec } });
    // gone = 앞 차례가 마무리했다 → 아래 「임시 파일 없음」 판정(영구 파일 + 소재 단건)으로
  }
  if (!found) {
    // 임시 파일 없음 = 이미 옮겼다(저장됨 · 겹친 재저장 · 마무리됨) 또는 만료.
    // ★ Codex E7 — 그 임시 id 의 영구 파일이 있으면 그 주소의 소재를 단건으로 찾아 돌려준다(옛: 409 → 화면이 최신 200건 목록에서 못 찾으면 만료로 오판).
    //   조회 장애 = 503(모른다) · 영구 파일이 없거나 소재 0행이 확인될 때만 409(더블클릭 중복 등재 차단 M-2 는 그대로 = 새 행을 만들지 않는다).
    const perm = findPermanentByTempId(companyId, tempId) || (meta?.savedAs ? { url: meta.savedAs.url, bytes: meta.savedAs.bytes } : null);
    if (perm) {
      let ex: Awaited<ReturnType<typeof getAssetByUrl>>;
      try { ex = await getAssetByUrl(companyId, perm.url); } catch {
        return res.status(503).json({ success: false, error: '라이브러리에 올렸는지 확인하지 못했어요. 잠시 뒤 같은 그림으로 다시 저장해 주세요.', code: 'ASSET_REGISTER_UNKNOWN' });
      }
      if (ex) return res.json({ success: true, asset: { id: ex.id, url: perm.url, bytes: perm.bytes, channelSpec: (ex as any).channel_spec ?? null } });
    }
    return res.status(409).json({ success: false, error: '이미 저장됐거나 만료된 이미지입니다.', code: 'ALREADY_SAVED' });
  }
  if (!meta) {
    return res.status(409).json({ success: false, error: '이미 저장됐거나 만료된 이미지입니다.', code: 'ALREADY_SAVED' });
  }

  try {
    const effectiveSpec = channelSpec || meta.channelSpec || null;
    let effTempId: string = tempId;
    // ★ 2026-09-27 한줄로 V2 R127 — 원본 임시 파일은 용량 한도를 통과한 뒤에 소비한다(옛: 먼저 지우고 한도 초과면 화면이 든 원본 id로 다시 저장할 수 없었다)
    let consumeOriginal: ((savedUrl: string, savedBytes: number) => void) | null = null;

    // ★ MMS 트랙 = 서버가 저장 직전 1080px + JPEG ≤300KB 압축 보장(§4-4 — 사용자가 오버사이즈를 만들 수 없음)
    if (effectiveSpec === 'mms') {
      const alloc = allocTempPath(companyId, 'jpeg');
      const r = await composeImage({
        bgPath: found.absPath, cutoutPath: null, outPath: alloc.absPath,
        layout: null, typography: [], mmsMaxBytes: LIMITS.mmsImageSize, format: 'jpeg',
      });
      writeTempMeta(companyId, alloc.tempId, {
        kind: 'composite', ext: 'jpeg', mime: 'image/jpeg', prompt: meta.prompt || null,
        presetKey: meta.presetKey || null, channelSpec: 'mms', width: r.width, height: r.height,
        aspectRatio: meta.aspectRatio || null,
      });
      // 원본 temp 1회성 소비(중복 저장 차단) — 실행은 용량 한도 통과 뒤(R127)
      const origPath = found.absPath;
      const origDir = path.dirname(origPath);
      // ★ 2026-10-19 Codex E8 범위 밖 — 원본 그림은 지우되 사이드카는 「저장 주소」로 남긴다(같은 원본 id 재저장 = 그 소재를 단건으로 찾는다 · 옛: 409 → 목록 200건에 없으면 만료 오판)
      const origMeta = meta;
      consumeOriginal = (savedUrl: string, savedBytes: number) => {
        try { fs.unlinkSync(origPath); } catch { /* noop */ }
        const { companyId: _c, createdAt: _t, ...rest } = origMeta as any;
        try { writeTempMeta(companyId, tempId, { ...rest, pendingAsset: null, savedAs: { url: savedUrl, bytes: savedBytes } }); } catch {
          try { fs.unlinkSync(path.join(origDir, `${tempId}.json`)); } catch { /* noop */ }
        }
      };
      effTempId = alloc.tempId;
      meta = readTempMeta(companyId, effTempId);
      found = findTempFile(companyId, effTempId);
      if (!meta || !found) return respondStudioError(res, new StudioError('GEN_FAILED', 502));
    }

    // 플랜 용량 한도 검사(P3 CT 재사용) — 실제 산출물 크기로 판정
    const usage = await getStorageUsage(companyId);
    const projected = usage.usedBytes + (fs.existsSync(found.absPath) ? fs.statSync(found.absPath).size : 0);
    if (projected > usage.limitBytes) {
      // 한도 초과 = 원본은 남긴다(정리 뒤 같은 id로 다시 저장). MMS 변환본만 치운다.
      if (consumeOriginal) {
        const convPath = found.absPath;
        try { fs.unlinkSync(convPath); } catch { /* noop */ }
        try { fs.unlinkSync(path.join(path.dirname(convPath), `${effTempId}.json`)); } catch { /* noop */ }
      }
      return res.status(409).json({ success: false, error: '저장 용량 한도를 초과했습니다. 라이브러리에서 정리 후 다시 저장해주세요.', code: 'STORAGE_FULL' });
    }
    const metaForRestore = meta;
    const moved = moveTempToPermanent(companyId, effTempId);
    if (!moved) return res.status(409).json({ success: false, error: '이미 저장됐거나 만료된 이미지입니다.', code: 'ALREADY_SAVED' });

    const format = moved.ext === 'png' ? 'png' : 'jpg';
    // ★ 2026-07-21 표시명 = "헤드라인_채널.ext" (랜덤 UUID 대신 — 용도 체킹 동시). 실제 파일(moved.url)은 tempId 유지.
    const displayName = buildAssetDisplayName(title, effectiveSpec, moved.ext);
    // registerAsset 은 던지지 않는다(실패 = null · Codex E1) — null 도 등재 실패로 본다.
    const assetId = await registerAsset({
      companyId, createdBy: userId, kind: 'generated', origin: 'studio',
      url: moved.url, filename: displayName, bytes: moved.bytes, format,
      // ★ 2026-09-27 한줄로 V2 R241 — 최종 프롬프트는 숨긴 템플릿 골격을 담고 있어 소재 기록에 싣지 않는다(목록 API로 나갔다)
      prompt: null,
      channelSpec: effectiveSpec,
      width: metaForRestore.width ?? null, height: metaForRestore.height ?? null,
    });
    // ★ Codex E2 — null 은 「커밋됐는데 응답만 끊김」일 수 있다(storeAssetFile 과 같은 재확인). 있으면 성공 · 없음이 확인될 때만 되돌린다 ·
    //   재확인마저 실패하면 영구 파일을 그대로 둔다(행이 있을 수 있는데 파일을 옮기면 깨진 소재가 된다).
    let savedId: string | null = assetId;
    let registered: 'yes' | 'no' | 'unknown' = assetId ? 'yes' : 'no';
    if (!assetId) {
      try {
        const committed = await getAssetByUrl(companyId, moved.url);
        if (committed) { savedId = committed.id; registered = 'yes'; }
      } catch { registered = 'unknown'; }
    }
    if (registered === 'unknown') {
      // ★ Codex E3 — 영구 파일은 그대로(행이 있을 수 있다) · 같은 임시 id 사이드카에 마무리 대기를 남겨 다음 저장이 확인 · 등재로 끝낸다(MMS 변환 경로 = 원본이 남아 다시 변환된다)
      if (!consumeOriginal) {
        const { companyId: _c, createdAt: _t, ...rest } = metaForRestore as any;
        try { writeTempMeta(companyId, effTempId, { ...rest, pendingAsset: { url: moved.url, filename: moved.filename, bytes: moved.bytes, displayName, channelSpec: effectiveSpec } }); } catch { /* noop */ }
      }
      return res.status(503).json({ success: false, error: '라이브러리에 올렸는지 확인하지 못했어요. 잠시 뒤 같은 그림으로 다시 저장해 주세요.', code: 'ASSET_REGISTER_UNKNOWN' });
    }
    if (registered === 'no') {
      // ★ 2026-10-19 B-1016-3③ — 등재 실패 = 되돌린다. MMS 변환본은 지우고 원본(아직 소비 전)을 남긴다 · 그 밖은 임시 자리로 되돌린다.
      //   그래서 화면이 든 같은 임시 id 로 다시 저장할 수 있다(옛: 옮긴 뒤라 같은 그림으로 다시 저장도 라이브러리 복구도 못 했다).
      if (consumeOriginal) {
        try { fs.unlinkSync(path.join(INAPP_IMAGE_BASE, companyId, moved.filename)); } catch { /* noop */ }
      } else {
        const { companyId: _c, createdAt: _t, ...rest } = metaForRestore as any;
        restorePermanentToTemp(companyId, effTempId, moved.ext, rest);
      }
      return res.status(503).json({ success: false, error: '라이브러리에 올리지 못했어요. 잠시 뒤 같은 그림으로 다시 저장해 주세요.', code: 'ASSET_REGISTER_FAILED' });
    }
    // 원본 임시 파일 소비 = 등재까지 성공한 뒤(MMS 변환 경로 · R127 · B-1016-3③)
    consumeOriginal?.(moved.url, moved.bytes);

    return res.json({ success: true, asset: { id: savedId, url: moved.url, bytes: moved.bytes, channelSpec: effectiveSpec } });
  } catch (err: any) {
    if (isAssetsTableMissing(err)) {
      return res.status(503).json({ success: false, error: '이미지 보관함을 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    return respondStudioError(res, err);
  }
  });
});

// ── POST /mms-from-asset — 라이브러리 소재 → MMS 규격(≤300KB JPG) 변환 (무료) ──
//   ★ 2026-07-19 Harold 확정: 스튜디오는 고품질만 생성·저장하고, MMS는 발송 시점에 기존 소재를 변환.
//   산출물 = 기존 MMS 저장소(MMS_IMAGE_BASE) + 업로드 응답 계약 동일 {serverPath,url,filename,size}
//   → 발송 경로(mms_image_paths·QTmsg 절대경로 계약) 무수정 접속. 300KB는 서버 실측 보장.
imageStudioRouter.post('/mms-from-asset', async (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ success: false, error: '회사 권한이 필요합니다.' });
  const assetId = String(req.body?.assetId || '');
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return res.status(400).json({ success: false, error: '소재를 찾을 수 없습니다.' });

  try {
    const asset = await getAsset(companyId, assetId, resolveOwnerScope(req));
    if (!asset) return res.status(404).json({ success: false, error: '소재를 찾을 수 없습니다.' });
    // 우리 서빙 URL(인앱 이미지 저장소)만 로컬 변환 대상 — deleteAsset과 동일 패턴
    const m = String(asset.url || '').match(/^\/api\/cdp\/inapp\/image\/([^/]+)\/([^/?#]+)$/);
    if (!m || m[1] !== companyId) {
      return res.status(400).json({ success: false, error: '이 소재는 MMS로 변환할 수 없습니다. 스튜디오·업로드 소재를 사용해주세요.' });
    }
    const srcPath = path.join(INAPP_IMAGE_BASE, companyId, m[2]);
    if (!fs.existsSync(srcPath)) return res.status(404).json({ success: false, error: '소재 원본 파일을 찾을 수 없습니다.' });

    const destDir = path.join(MMS_IMAGE_BASE, companyId);
    fs.mkdirSync(destDir, { recursive: true });
    const filename = `${newTempId()}.jpg`;
    const outPath = path.join(destDir, filename);
    const r = await composeImage({
      bgPath: srcPath, cutoutPath: null, outPath,
      layout: null, typography: [], mmsMaxBytes: LIMITS.mmsImageSize, format: 'jpeg',
    });
    return res.json({
      success: true,
      image: {
        serverPath: path.resolve(outPath),
        url: `/api/mms-images/${companyId}/${filename}`,
        filename,
        originalName: asset.filename || filename,
        size: r.bytes,
      },
    });
  } catch (err: any) {
    if (isAssetsTableMissing(err)) {
      return res.status(503).json({ success: false, error: '이미지 보관함을 준비 중입니다. 잠시 후 다시 시도해 주세요.', code: 'DB_MIGRATION_PENDING' });
    }
    return respondStudioError(res, err);
  }
});

// ── GET /temp/:tempId (인증 서빙 — 프론트 fetch+blob) ────────────
imageStudioRouter.get('/temp/:tempId', (req: any, res: Response) => {
  const companyId = req.user?.companyId;
  if (!companyId) return res.status(403).json({ error: '권한 없음' });
  const { tempId } = req.params;
  if (!isValidTempId(tempId)) return res.status(400).json({ error: '잘못된 요청' });
  const found = findTempFile(companyId, tempId); // 회사 dir 안에서만 조회 = 소유 검증
  if (!found) return res.status(404).json({ error: '이미지를 찾을 수 없습니다.' });
  res.setHeader('Content-Type', found.mime || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=600');
  return res.sendFile(found.absPath);
});

export default imageStudioRouter;
