/**
 * planner-alimtalk.ts — 알림톡 검수 대행 오케스트레이션 (★ 2026-08-13 Phase 3 · 인계 §4-③)
 *
 * "등록하러 가라"는 가드는 대행이 아니다(기능 문서 §4-5). 흐름 =
 *   정보성 문안 조립 → 템플릿 등록 → **검수 자동 제출** → 상태 추적 → 반려 시 재제출 1회 + 사유 통지 →
 *   승인(APR) 후 발송 예약 편입.
 *
 * ⛔ 새 API를 만들지 않는다 — 전 구간이 이미 있다(`alimtalk-api.ts`). 신규는 오케스트레이션뿐.
 * ⛔ **상태 추적·담당자 결과 통지는 기존 5분 job이 소유한다**(`alimtalk-jobs` pendingTemplateSync:
 *    진행 중 상태를 폴링해 status·reject_reason을 갱신하고 종결 시 담당자에게 알린다).
 *    그래서 이 파일은 **그 표를 읽기만** 한다 — 같은 것을 또 폴링하면 IMC 호출이 두 배가 되고
 *    두 진실이 생긴다.
 * ⛔ `alarm_notified_status`는 **비운 채로 넣는다.** 0720 이관 함정은 *이미 종결된* 상태(APPROVED 등)를
 *    NULL로 넣어 5분 job이 과거 건을 새 알림으로 집었던 것이다. 여기서 넣는 행은 항상 **진행 중**
 *    (REG→REQUESTED)이라 그 창에 걸리지 않고, 승인·반려가 오면 그때 정상 통지가 나가는 것이 맞다.
 * ⛔ 알림톡은 정보성 전용이라 **AI 생성을 쓰지 않는다** — 담을 사실이 정해져 있고(행사명·기간),
 *    자유 생성은 혜택 표현이 섞여 반려만 부른다. 원가도 0이다.
 */
import { query } from '../config/database';
import * as imc from './alimtalk-api';
import {
  PlannerTouchpointRow,
  claimAlimtalkStage,
  guardExecMetaOrSkip,
  loadLiveTouchpoints,
  notifyPlanner,
  setTouchpointState,
  stampExecMeta,
} from './planner-touchpoint';
import {
  ALIMTALK_MAX_RESUBMIT,
  buildAlimtalkNoticeBody,
  buildAlimtalkTemplateName,
  canMeetInspectionLeadTime,
  classifyExecutionWindow,
  hasAdToneForAlimtalk,
  kstDateString,
  kstMonthString,
  PLANNER_CLAIM_LEASE_MINUTES,
} from './planner-execution';

interface SenderProfile { id: string; profileKey: string }

/** 검수 선점 lease — 원격 호출 중 끊긴 'submitting'을 재진입시키는 기준(실행 lease와 같은 값). */
function isAlimtalkClaimStale(execMeta: Record<string, any>, now: Date = new Date()): boolean {
  const raw = execMeta?.alimtalk_claimed_at;
  if (!raw) return true;
  const t = new Date(String(raw)).getTime();
  if (Number.isNaN(t)) return true;
  return now.getTime() - t > PLANNER_CLAIM_LEASE_MINUTES * 60 * 1000;
}

/** 회사 발신프로필 — 알림톡 게이트(planner-channel-gate)가 이미 보유를 확인한 축과 같은 표. */
async function loadSenderProfile(companyId: string): Promise<SenderProfile | null> {
  const r = await query(
    `SELECT id, profile_key FROM kakao_sender_profiles
      WHERE company_id = $1::uuid AND profile_key IS NOT NULL
        AND COALESCE(is_active, true) = true AND COALESCE(status, 'NORMAL') = 'NORMAL'
      ORDER BY id ASC LIMIT 1`,
    [companyId],
  );
  const row = r.rows[0];
  return row ? { id: String(row.id), profileKey: String(row.profile_key) } : null;
}

/**
 * 카테고리 코드 — **회사가 이미 통과시킨 값을 먼저 쓴다**(그 회사에서 통했다는 증거가 있는 값).
 * 없으면 IMC 카테고리 목록의 첫 값. 둘 다 없으면 null → 제출하지 않고 사유를 남긴다(추측 금지).
 */
async function resolveCategoryCode(companyId: string): Promise<string | null> {
  const own = await query(
    `SELECT category FROM kakao_templates
      WHERE company_id = $1::uuid AND COALESCE(category, '') <> ''
      ORDER BY created_at DESC LIMIT 1`,
    [companyId],
  );
  if (own.rows[0]?.category) return String(own.rows[0].category);
  try {
    const res = await imc.listTemplateCategories();
    // IMC 카테고리 항목의 코드 필드명은 `code`다(TemplateCategoryItem 실측 정의).
    const first = Array.isArray(res?.data) ? res.data[0] : null;
    return first?.code ? String(first.code) : null;
  } catch (e: any) {
    console.warn('[planner-alimtalk] 카테고리 목록 조회 실패:', e?.message || e);
    return null;
  }
}

/**
 * ⛔ **재사용 APR 템플릿 폴백은 기각했다(★2026-08-13 구현 중 정정 — 설계서 §5-6의 그 항목).**
 * 이유: 우리가 만드는 정보성 문안은 **행사별**이다(행사명·기간이 본문에 들어간다).
 * 승인된 옛 템플릿을 재사용하면 **다른 행사 정보를 고객에게 보내게 된다** — 리드타임을 맞추려고
 * 틀린 안내를 보내는 것은 대행이 아니다. 리드타임을 못 맞추면 그 터치포인트만 사유와 함께 제외한다.
 * (행사와 무관한 범용 문안으로 바꾸면 재사용이 성립하지만, 그 문안은 안내로서 알맹이가 없다.)
 */

/** 새 템플릿 키 — IMC는 클라이언트가 키를 준다(식별 축이 template_key다 · D146). */
function buildTemplateKey(touchpointId: string, attempt: number): string {
  return `PLN${touchpointId.replace(/-/g, '').slice(0, 20)}${attempt}`.slice(0, 30);
}

/**
 * 검수 제출 — 등록 → kakao_templates 적재 → 검수 요청 → 진행 중 상태로 남긴다.
 * 실패 지점마다 사유를 남기고 **열어주지 않는다**(제출 못 한 터치포인트를 ready로 올리지 않는다).
 */
async function submitForInspection(tp: PlannerTouchpointRow, attempt: number): Promise<'submitted' | 'blocked'> {
  // ⛔ **원격 호출 전에 단계를 선점한다.** 상태는 planned로 두고 단계만 옮긴다(검수와 실행 상태 분리 —
  //   producing을 공유하면 실행이 선점한 행을 검수가 되돌려 두 번 발송된다).
  const fromStages = ['', 'registered', 'rejected', 'submitting'];
  if (!(await claimAlimtalkStage(tp.companyId, tp.id, fromStages, 'submitting'))) return 'blocked';
  const profile = await loadSenderProfile(tp.companyId);
  if (!profile) {
    await lock(tp, '카카오 발신프로필이 없어 알림톡 검수를 진행할 수 없습니다.');
    return 'blocked';
  }
  const categoryCode = await resolveCategoryCode(tp.companyId);
  if (!categoryCode) {
    await lock(tp, '알림톡 템플릿 카테고리를 확인하지 못해 검수를 진행하지 못했습니다.');
    return 'blocked';
  }
  const nameRes = await query(`SELECT company_name FROM companies WHERE id = $1::uuid`, [tp.companyId]);
  const companyName = String(nameRes.rows[0]?.company_name || '').trim() || '안내';
  const body = buildAlimtalkNoticeBody(tp, companyName, attempt + 1);
  // 통과 조건 자가 검사 — 광고 표현이 섞이면 제출 자체를 하지 않는다(검수 반려를 우리가 만들지 않는다).
  if (hasAdToneForAlimtalk(body)) {
    await lock(tp, '알림톡은 정보성 안내 전용이라 이 내용으로는 검수를 제출할 수 없습니다.');
    return 'blocked';
  }
  const templateKey = buildTemplateKey(tp.id, attempt);
  const templateName = buildAlimtalkTemplateName(tp, tp.planMonth);

  // ⛔ **재진입 안전** — 원격 등록은 성공했는데 우리 표 적재나 검수 요청이 실패한 다음 주기를 위해,
  //   같은 templateKey의 우리 행이 이미 있으면 **다시 등록하지 않는다**(templateKey는 터치포인트·회차로 결정적이다).
  //   그 창을 막지 않으면 재시도가 매번 원격 중복 등록으로 실패하거나 고아 템플릿을 쌓는다.
  const existing = await query(
    `SELECT id, template_code FROM kakao_templates
      WHERE company_id = $1::uuid AND template_key = $2 LIMIT 1`,
    [tp.companyId, templateKey],
  );
  if (existing.rows[0]) {
    const rowId0 = String(existing.rows[0].id);
    const code0 = existing.rows[0].template_code ? String(existing.rows[0].template_code) : templateKey;
    return await requestInspectionAndMark(tp, profile, rowId0, templateKey, code0, attempt);
  }

  let templateCode: string | null = null;
  try {
    const created = await imc.createAlimtalkTemplate(profile.profileKey, {
      templateKey,
      manageName: templateName,
      serviceMode: 'PRD',
      templateMessageType: 'BA' as any,
      templateEmphasizeType: 'NONE' as any,
      templateContent: body,
      categoryCode,
    });
    if (String(created?.code) !== '0000') {
      await lock(tp, `알림톡 템플릿 등록이 거절됐습니다: ${String(created?.message || '').slice(0, 120)}`);
      return 'blocked';
    }
    templateCode = created?.data?.templateCode ? String(created.data.templateCode) : null;
  } catch (e: any) {
    console.warn(`[planner-alimtalk] 템플릿 등록 실패 tp=${tp.id}:`, e?.message || e);
    // ⛔ 원격 등록 성공 여부를 단정하지 않는다(응답 유실 = 원격에는 생겼을 수 있다).
    //   결정적 키로 원격을 조회해 실존을 확인한 뒤 진행하고, 없으면 단계를 풀어 다음 주기가 다시 본다.
    const remote = await imc.getAlimtalkTemplate(profile.profileKey, templateKey).catch(() => null);
    if (String(remote?.code) === '0000' && remote?.data) {
      const code = (remote.data as any)?.templateCode ? String((remote.data as any).templateCode) : templateKey;
      const rowIdR = await insertLocalTemplateRow(tp, profile, templateKey, templateName, body, categoryCode, code);
      if (!rowIdR) return 'blocked';
      return await requestInspectionAndMark(tp, profile, rowIdR, templateKey, code, attempt);
    }
    await stampExecMeta(tp.companyId, tp.id, { alimtalk_stage: attempt === 0 ? '' : 'rejected' })
      .catch(() => { /* 다음 주기 */ });
    return 'blocked';
  }

  // 우리 표에 적재 — 식별은 template_key 축(등록 직후 template_code가 null인 것이 정상 · D146).
  const rowId = await insertLocalTemplateRow(tp, profile, templateKey, templateName, body, categoryCode, templateCode || templateKey);
  if (!rowId) return 'blocked';

  return await requestInspectionAndMark(tp, profile, rowId, templateKey, templateCode || templateKey, attempt);
}

/**
 * 우리 표(kakao_templates) 적재 — 실패하면 사유를 남기고 null.
 * 원격에는 템플릿이 생겼는데 우리 표에 못 남기면 다음 주기 선조회가 그것을 못 찾는다 → 사람을 부른다.
 */
async function insertLocalTemplateRow(
  tp: PlannerTouchpointRow,
  profile: SenderProfile,
  templateKey: string,
  templateName: string,
  body: string,
  categoryCode: string,
  templateCode: string,
): Promise<string | null> {
  try {
    const ins = await query(
      `INSERT INTO kakao_templates
         (company_id, profile_id, template_code, template_key, template_name, content,
          buttons, variables, status, category, message_type, emphasize_type, security_flag,
          service_mode, created_by, created_at, updated_at)
       VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6,
               '[]'::jsonb, '{}'::text[], 'REG', $7, 'BA', 'NONE', false,
               'PRD', $8, NOW(), NOW())
       RETURNING id`,
      [tp.companyId, profile.id, templateCode, templateKey, templateName, body, categoryCode, tp.createdBy],
    );
    return String(ins.rows[0].id);
  } catch (e: any) {
    console.error(`[planner-alimtalk] 템플릿 적재 실패(원격 등록됨) tp=${tp.id} key=${templateKey}:`, e?.message || e);
    await lock(tp, `알림톡 템플릿 기록에 실패했습니다(등록 키 ${templateKey}). 담당자 확인이 필요합니다.`);
    return null;
  }
}

/** 검수 요청 + 진행 상태 표식 — 신규 등록과 재진입(이미 등록된 키)이 공유한다. */
async function requestInspectionAndMark(
  tp: PlannerTouchpointRow,
  profile: SenderProfile,
  rowId: string,
  templateKey: string,
  templateCode: string,
  attempt: number,
): Promise<'submitted' | 'blocked'> {
  try {
    const insp = await imc.requestInspection(profile.profileKey, templateCode, '행사 안내(정보성) 템플릿 검수 요청');
    if (String(insp?.code) !== '0000') {
      await query(
        `UPDATE kakao_templates SET status = 'REG', updated_at = NOW()
          WHERE id = $1::uuid AND company_id = $2::uuid`,
        [rowId, tp.companyId],
      );
      await lock(tp, `알림톡 검수 요청이 거절됐습니다: ${String(insp?.message || '').slice(0, 120)}`);
      return 'blocked';
    }
  } catch (e: any) {
    console.warn(`[planner-alimtalk] 검수 요청 실패 tp=${tp.id}:`, e?.message || e);
    // 템플릿은 등록됐고 검수 요청만 실패했다 — 참조를 남기고 단계를 'registered'로 되돌려
    //   다음 주기가 **등록을 건너뛰고 검수 요청만** 다시 하게 한다(주석만 남기고 실제로는 안 도는 재개 금지).
    await stampExecMeta(tp.companyId, tp.id, {
      alimtalk_template_row: rowId, alimtalk_template_key: templateKey,
      alimtalk_template_code: templateCode, alimtalk_attempt: attempt, alimtalk_stage: 'registered',
    }).catch(() => { /* 다음 주기 */ });
    return 'blocked';
  }
  // 진행 중 상태로 올려 5분 job의 폴링 대상에 넣는다(상태·반려사유·담당자 통지는 그 job이 소유).
  await query(
    `UPDATE kakao_templates SET status = 'REQUESTED', updated_at = NOW()
      WHERE id = $1::uuid AND company_id = $2::uuid`,
    [rowId, tp.companyId],
  );
  // ⛔ 터치포인트 상태는 planned 그대로 — 검수 단계는 exec_meta가 갖는다(실행 상태와 분리).
  await stampExecMeta(tp.companyId, tp.id, {
    alimtalk_template_row: rowId,
    alimtalk_template_key: templateKey,
    alimtalk_template_code: templateCode,
    alimtalk_attempt: attempt,
    alimtalk_stage: 'inspecting',
    alimtalk_submitted_at: new Date().toISOString(),
  });
  console.log(`[planner-alimtalk] 검수 제출 tp=${tp.id} key=${templateKey} attempt=${attempt}`);
  return 'submitted';
}

async function lock(tp: PlannerTouchpointRow, reason: string): Promise<void> {
  await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'locked', lockReason: reason });
  await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 알림톡 보류',
    `'${tp.title}' 알림톡 안내를 진행하지 못했습니다. 사유: ${reason}`);
}

async function skip(tp: PlannerTouchpointRow, reason: string): Promise<void> {
  await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'skipped', lockReason: reason });
  await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 알림톡 제외',
    `'${tp.title}' 알림톡 안내는 이번 행사에서 제외했습니다. 사유: ${reason}`);
}

/**
 * 제출 단계 — 리드타임 판정 → 단계별 재개.
 * ⛔ **단계는 exhaustive하게 처리한다.** 하나를 빼먹으면 그 단계에 멈춘 행이 영구 정지한다(예정일 지나 생략).
 *   '' = 신규 등록 / 'registered' = 등록은 됐고 검수 요청만 재시도 / 'rejected' = 다음 attempt로 재제출 /
 *   'submitting' = 원격 호출 중 끊긴 것 — lease를 넘겼으면 결정적 키로 재진입(선조회·원격 조회가 중복을 막는다).
 */
async function processPending(tp: PlannerTouchpointRow, today: string): Promise<void> {
  if (!canMeetInspectionLeadTime(today, tp.scheduledOn)) {
    await skip(tp, '알림톡 검수에 필요한 기간(영업일 5일)이 남지 않아 이번 행사에서는 제외했습니다.');
    return;
  }
  const stage = String(tp.execMeta?.alimtalk_stage || '');
  const savedAttempt = Number(tp.execMeta?.alimtalk_attempt || 0);
  if (stage === 'submitting') {
    // 원격 호출 중 끊긴 흔적 — lease 안이면 그 실행이 살아 있을 수 있으니 기다린다.
    if (!isAlimtalkClaimStale(tp.execMeta)) return;
    await submitForInspection(tp, savedAttempt);
    return;
  }
  if (stage === 'rejected') {
    if (savedAttempt >= ALIMTALK_MAX_RESUBMIT) {
      await setTouchpointState({
        companyId: tp.companyId, touchpointId: tp.id, status: 'locked', fromStatuses: ['planned'],
        lockReason: '알림톡 검수가 반려돼 보류했습니다.',
        execMetaPatch: { alimtalk_stage: 'blocked' },
      });
      return;
    }
    await submitForInspection(tp, savedAttempt + 1);
    return;
  }
  // '' | 'registered' — 같은 attempt로 진행(선조회가 재등록을 막고 검수 요청만 다시 한다).
  await submitForInspection(tp, savedAttempt);
}

/** 추적 단계 — 5분 job이 갱신한 status를 읽어 편입·재제출·보류를 결정한다. */
async function processInspecting(tp: PlannerTouchpointRow, today: string): Promise<void> {
  // ⛔ 이미 발송된 건은 손대지 않는다 — 실행 참조가 있는 행을 ready로 되돌리면 같은 안내가 두 번 나간다.
  if (tp.execRef) return;
  const rowId = tp.execMeta?.alimtalk_template_row;
  if (!rowId) {
    // 제출 기록이 없다 = 추적할 근거가 없다. 단계를 비워 제출 단계로 되돌린다(상태는 planned 그대로).
    await stampExecMeta(tp.companyId, tp.id, { alimtalk_stage: '' });
    return;
  }
  const r = await query(
    `SELECT status, reject_reason, template_code FROM kakao_templates
      WHERE id = $1::uuid AND company_id = $2::uuid`,
    [String(rowId), tp.companyId],
  );
  const row = r.rows[0];
  if (!row) {
    await stampExecMeta(tp.companyId, tp.id, { alimtalk_stage: '' });
    return;
  }
  // 검수를 기다리는 동안 예정일이 지나면 그 터치포인트는 끝났다 — 검수 대기로 영원히 남기지 않는다.
  if (classifyExecutionWindow(tp.scheduledOn, today) === 'missed') {
    await skip(tp, `검수가 끝나기 전에 예정일(${tp.scheduledOn})이 지나 발송하지 않았습니다.`);
    return;
  }
  const status = String(row.status || '').toUpperCase();
  if (status === 'APPROVED' || status === 'APR') {
    await setTouchpointState({
      companyId: tp.companyId, touchpointId: tp.id, status: 'ready', fromStatuses: ['planned'], lockReason: null,
      execMetaPatch: {
        alimtalk_template_code: row.template_code ? String(row.template_code) : tp.execMeta?.alimtalk_template_code || null,
        alimtalk_approved_at: new Date().toISOString(),
        alimtalk_stage: 'approved',
      },
    });
    console.log(`[planner-alimtalk] 검수 승인 → 발송 예약 편입 tp=${tp.id}`);
    return;
  }
  const rejected = status === 'REJECTED' || status === 'KREJ' || status === 'REJ' || status === 'HREJ';
  if (!rejected) return;   // 진행 중 — 다음 주기에 다시 본다

  const attempt = Number(tp.execMeta?.alimtalk_attempt || 0);
  const reason = String(row.reject_reason || '').slice(0, 200);
  if (attempt >= ALIMTALK_MAX_RESUBMIT) {
    if (!(await claimAlimtalkStage(tp.companyId, tp.id, ['inspecting'], 'blocked'))) return;
    await setTouchpointState({
      companyId: tp.companyId, touchpointId: tp.id, status: 'locked', fromStatuses: ['planned'],
      lockReason: `알림톡 검수 반려(재제출 후에도 반려): ${reason}`,
    });
    await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 알림톡 보류',
      `'${tp.title}' 알림톡 템플릿이 두 번 반려돼 보류했습니다. 반려 사유: ${reason || '사유 미기재'}`);
    return;
  }
  // ⛔ 반려 전이도 **CAS**다 — 무조건 stamp면 다른 실행이 이미 집은 submitting을 rejected로 되돌려
  //   둘이 같은 키로 동시에 등록·검수 요청한다. 승자만 통지하고 재제출한다.
  if (!(await claimAlimtalkStage(tp.companyId, tp.id, ['inspecting'], 'rejected'))) return;
  await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 알림톡 재검수',
    `'${tp.title}' 알림톡 템플릿이 반려돼 문안을 고쳐 다시 검수를 요청합니다. 반려 사유: ${reason || '사유 미기재'}`);
  await submitForInspection(tp, attempt + 1);
}

/**
 * 알림톡 검수 대행 패스 — 제출·추적 두 단계를 한 주기에 돈다.
 * 승인된 행사의 알림톡 터치포인트만 대상이다(미승인 = 아무 것도 하지 않는다).
 */
export async function runPlannerAlimtalkPass(opts?: { companyId?: string }): Promise<{ submitted: number; approved: number }> {
  if (!(await guardExecMetaOrSkip('planner-alimtalk'))) return { submitted: 0, approved: 0 };
  const today = kstDateString();
  const monthFrom = kstMonthString();
  let submitted = 0;
  let approved = 0;

  const all = await loadLiveTouchpoints({ statuses: ['planned'], channels: ['alimtalk'], monthFrom, companyId: opts?.companyId, limit: 60 });
  const stageOf = (tp: PlannerTouchpointRow) => String(tp.execMeta?.alimtalk_stage || '');
  const pending = all.filter((tp) => ['', 'registered', 'rejected', 'submitting'].includes(stageOf(tp))).slice(0, 20);
  for (const tp of pending) {
    try {
      await processPending(tp, today);
      submitted++;
    } catch (e: any) {
      console.error(`[planner-alimtalk] 제출 오류 tp=${tp.id}:`, e?.message || e);
    }
  }

  const inspecting = all.filter((tp) => stageOf(tp) === 'inspecting');
  for (const tp of inspecting) {
    try {
      await processInspecting(tp, today);
      approved++;
    } catch (e: any) {
      console.error(`[planner-alimtalk] 추적 오류 tp=${tp.id}:`, e?.message || e);
    }
  }
  if (pending.length + inspecting.length > 0) {
    console.log(`[planner-alimtalk] 제출 대상 ${pending.length} · 추적 대상 ${inspecting.length}`);
  }
  return { submitted, approved };
}
