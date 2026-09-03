/**
 * planner-production.ts — 소재 대행 제작 (★ 2026-08-13 Phase 3 · 인계 §4-②)
 *
 * 승인 직후 이메일·모바일 DM·인앱 소재를 **AX가 만들어 둔다**(문자·알림톡은 실행 축이 소유).
 * 제작 = 자유 생성이 아니라 실데이터 조립이다 — 행사 원문(제목·기간·혜택 verbatim·상품)을
 * 기존 생성 CT에 그대로 넣고, 이미지·정가는 연동 몰 매칭 CT가 채운다(설계서 §4).
 *
 * ⛔ 불변
 *   - **미승인 = 미제작 = 미차감.** 후보는 승인된 행사의 터치포인트뿐(planner-touchpoint가 그 조건을 소유).
 *   - 제작비는 **제작 성공 뒤** 차감한다(6원칙 ② 효과 검증 후 과금). 멱등키 = 터치포인트 고정.
 *   - 승인 트랜잭션과 결속하지 않는다 — 고객 확정 경로에 부가 작업을 얹지 않는다(0808 교훈).
 *     승인 라우트가 best-effort로 부르고, 놓친 건은 이 워커(그물)가 다음 주기에 집는다.
 *   - 재료가 없으면(SMTP 미설정·생성 계정 없음) **잠그고 사유를 말한다.** 조용히 넘기지 않는다.
 *   - 크레딧 부족은 보류(hold_credit) + 즉시 통지 + 재개 경로. 마이너스·자동충전 금지.
 *   - ★ 2026-09-02 **모바일 DM은 초안까지만 만든다 — 발행하지 않는다.** AI 초안은 이미지·문구 자리가 비어 있고 그것은
 *     고객사 재료다(혜택 verbatim의 소재 판). 담당자가 DM 빌더에서 완성·발행하면(발행비는 그 라우트가 `dm-publish:{id}`로 걷는다)
 *     발행 감지 sync가 **완성(빈 자리 0)** 까지 확인한 뒤에만 접점을 `ready`로 올리고, 그 주소가 같은 시점 문자에 실린다.
 *     초안 대기 접점은 `planned` + `exec_meta.dm_stage='drafted'`이며 **어떤 워커도 그 행을 producing으로 옮기지 않는다**
 *     (접수 cmtibk3d50694jnottwllnrbg — 미완성 DM 링크가 고객에게 나간 사고).
 */
import { checkCredit, deductCreditSafe, InsufficientCreditError } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { runInCreditBundle } from './ai-credit-context';
import { generateEmailSections, hasUneditedPlaceholder } from './email-ai';
import { renderEmailSections } from './email/email-section-renderer';
import { createEmailCampaign } from './email-channel';
import { getCompanyBrandKit } from './dm/dm-brand-kit';
import { getBrandBasicInfo } from './brand-basic-info';
import { attachMallImagesToProductCarousels } from './mall-product-match';
import { oneShotGenerate } from './dm/dm-ai';
import { createDm, extractPagesFromDm, getDmDetail } from './dm/dm-builder';
import { renderDmViewerHtml } from './dm/dm-viewer';
import { generateInAppMessagePackage } from './inapp-ai-generator';
import { createInAppMessage } from './inapp-message';
import { query } from '../config/database';
import {
  PlannerTouchpointRow,
  claimTouchpointUnderPlanLock,
  guardExecMetaOrSkip,
  isPlannerPlanLive,
  loadLiveTouchpoints,
  loadTouchpointById,
  notifyPlanner,
  setEventStatus,
  setTouchpointState,
  stampExecMeta,
  stampExecMetaIfChanged,
} from './planner-touchpoint';
import {
  DM_RESIDUE_NO_CONTENT,
  DmPlaceholderResidue,
  PLANNER_MATERIAL_CHANNELS,
  addDays,
  buildDmEditPath,
  buildPlannerEventText,
  buildPlannerExtraMaterial,
  carrierKey,
  describeDmResidue,
  describeTiming,
  dmStageOf,
  findDmDataResidue,
  findDmPlaceholderResidue,
  insertParticipationSection,
  isMaterialChannel,
  kstDateString,
  kstMonthString,
  mergeDmResidue,
  plannerProduceGenKey,
} from './planner-execution';
import { buildJoinToken, buildJoinUrl, joinTokenExpiry } from './planner-participation';

/**
 * 제작 결과 — 상태와 통지 문구를 호출부가 판단할 수 있게 사유를 함께 돌려준다.
 * `unresumable` = 재개가 아무 효과도 내지 못했다(전이 0행·되살릴 수 없는 단계). **성공으로 답하지 않기 위한 값**이다.
 * `awaiting` = 모바일 DM 초안이 준비돼 **담당자 완성·발행을 기다린다**(★ 2026-09-02). ready가 아니다 — 실행부는 보내지 않는다.
 */
export type ProduceOutcome = 'ready' | 'hold_credit' | 'locked' | 'retry' | 'already' | 'unresumable' | 'awaiting';

/** 발행 주소 — DM 라우트 `/publish`가 돌려주는 값과 같은 규칙(단축 도메인 있으면 그것, 없으면 뷰어 주소). */
export function buildDmPublicUrl(shortCode: string): string {
  const shortBase = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
  return shortBase
    ? `${shortBase}/${shortCode}`
    : `${String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '')}/api/dm/v/dm-${shortCode}`;
}

/** 담당자 편집 화면 절대 주소(통지 문자용). 화면 버튼은 상대 경로(`buildDmEditPath`)를 쓴다. */
function buildDmEditUrl(dmId: string): string {
  return `${String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '')}${buildDmEditPath(dmId)}`;
}

interface ProducedAsset {
  assetRef: string;
  /** 제작물 요약 — 통지·브리핑 문구. */
  label: string;
  execMeta: Record<string, any>;
}

// ── 채널별 제작 ──────────────────────────────────────────────────────

/**
 * ★ 2026-09-03 소재 제작 재료 = 행사 원문 4줄 + 회사 사실(브랜드 기본정보·발송 시점) — 참조 골격 설계서 §6-4 묶음 ④.
 * 플래너 산출물이 빈약했던 1차 원인은 재료가 4줄뿐이고 그마저 한 줄 요약으로 줄던 것이다. 공용 `buildPlannerEventText`는 그대로 두고
 * 제작 호출부만 넓힌다. 기본정보 조회 실패 = 원문 4줄만(제작을 막지 않는다).
 */
async function buildPlannerProductionEventText(tp: PlannerTouchpointRow): Promise<string> {
  const base = buildPlannerEventText(tp);
  let basic: Awaited<ReturnType<typeof getBrandBasicInfo>> | null = null;
  try { basic = await getBrandBasicInfo(tp.companyId); } catch { basic = null; }
  const extra = buildPlannerExtraMaterial(basic, tp.timing);
  return extra ? `${base}\n${extra}` : base;
}

/** 이메일 브로마이드 — 섹션 생성 → 몰 상품 이미지 매칭 → 참여 버튼 → 렌더 → 캠페인(초안) 저장. */
async function produceEmail(tp: PlannerTouchpointRow, userId: string): Promise<ProducedAsset> {
  const eventText = await buildPlannerProductionEventText(tp);
  // 내부 생성 호출은 묶음(차감 0) — 과금은 아래 단일 지점(완성 50)뿐이다.
  const gen = await runInCreditBundle(() =>
    generateEmailSections({ companyId: tp.companyId, userId, isAd: true, eventText }),
  );
  const sections: any[] = Array.isArray((gen as any).sections) ? (gen as any).sections : [];
  // 상품 이미지·정가는 연동 몰에서 채운다(빈 값만·실패 skip — 생성 결과 후처리).
  try { await attachMallImagesToProductCarousels(tp.companyId, sections); } catch { /* best-effort */ }
  // 참여 동의 체인의 입구 — [참여하기] 버튼(Phase 4). 행사 단위 공개 주소.
  const joinUrl = buildJoinUrl(buildJoinToken(tp.companyId, tp.eventId, joinTokenExpiry(tp.endsOn)));
  const withJoin = insertParticipationSection(sections, joinUrl);
  const brandKit = await getCompanyBrandKit(tp.companyId);
  const html = renderEmailSections(withJoin as any, { brandKit, design: null, publicBase: process.env.PUBLIC_BASE_URL });
  const subject = (Array.isArray((gen as any).subjects) ? (gen as any).subjects[0] : '') || tp.title;
  // ⛔ 혜택 미입력 출구 가드를 **제작 단계에서** 본다. 발송 엔진에도 같은 가드가 있지만(마지막 방어선),
  //   거기서 걸리면 예정일마다 실패를 되풀이한다. 여기서 잠그면 담당자가 혜택을 채워 [다시 시작]할 수 있다.
  if (hasUneditedPlaceholder(subject, html)) {
    throw new Error('직접 입력이 필요한 자리(혜택 등)가 남아 소재를 완성하지 못했습니다. 행사 혜택 칸을 채운 뒤 다시 시작해 주세요.');
  }
  const campaign = await createEmailCampaign({
    companyId: tp.companyId,
    createdBy: userId,
    name: `[플래너] ${tp.title}`.slice(0, 200),
    subject: String(subject).slice(0, 200),
    htmlBody: html,
    isAd: true,
    aiGenerated: true,
    sections: withJoin,
  });
  return {
    assetRef: campaign.id,
    label: '이메일 소재',
    execMeta: { email_campaign_id: campaign.id, join_url: joinUrl, produced_at: new Date().toISOString() },
  };
}

/**
 * 모바일 DM — 섹션 생성 → **초안 저장까지**. 발행하지 않는다(★ 2026-09-02).
 * 발행·완성은 담당자가 DM 빌더에서 한다. 그 뒤 `syncDmPublishState`가 발행·완성을 확인해 접점을 ready로 올리고,
 * 그때 확정된 주소가 같은 시점 문자에 실린다. 초안 단계에서는 `dm_url`을 기록하지 않는다(미리보기 주소가 문자에 실리면 사고 재현).
 */
async function produceDm(tp: PlannerTouchpointRow, userId: string): Promise<ProducedAsset> {
  const eventText = await buildPlannerProductionEventText(tp);
  const gen = await runInCreditBundle(() =>
    oneShotGenerate({ prompt: `${tp.title} 행사 안내 모바일 페이지`, companyId: tp.companyId, eventText }),
  );
  const dm = await createDm(tp.companyId, userId, {
    title: `[플래너] ${tp.title}`.slice(0, 200),
    sections: (gen as any).sections || [],
    pages: (gen as any).pages || [],
    layout_mode: (gen as any).layoutMode,
    brand_kit: (gen as any).brandKit || null,
    ai_prompt: eventText.slice(0, 2000),
    approval_status: 'draft',
  } as any);
  return {
    assetRef: String(dm.id),
    label: '모바일 DM 초안',
    execMeta: {
      dm_id: String(dm.id),
      dm_stage: 'drafted',
      dm_drafted_at: new Date().toISOString(),
      dm_edit_path: buildDmEditPath(String(dm.id)),
      produced_at: new Date().toISOString(),
    },
  };
}

// ── DM 발행·완성 감지 (★ 2026-09-02) ──────────────────────────────
export interface DmCarryState {
  /** dm_pages 행이 있는가(없으면 삭제됨). */
  exists: boolean;
  /** 발행됨(status='published' AND short_code). 중지(stopped)는 발행이 아니다 — 뷰어가 열리지 않는다. */
  published: boolean;
  stopped: boolean;
  /** 발행 주소(발행됐을 때만). */
  url: string | null;
  /** 고객 화면에 남은 빈 자리 — 비어 있어야 문자에 실을 수 있다. */
  residue: DmPlaceholderResidue[];
  /** 완성 확인 자체가 실패했다(렌더 예외) — 담당자가 채울 자리가 아니라 시스템 확인 대상. 실을 수 없다(fail-closed). */
  checkError: string | null;
}

/** 실을 수 있는가 — 발행 + 빈 자리 0 + 확인 오류 없음. */
export function isDmCarryable(state: DmCarryState | null | undefined): boolean {
  return !!state && state.published && !state.checkError && state.residue.length === 0;
}

/**
 * DM 1건이 문자에 실릴 수 있는가 — **발행 + 완성(빈 자리 0)** 둘 다여야 한다.
 * 완성 판정 두 축 = ①고객이 보는 뷰어 렌더 결과의 빈 자리 문구 ②섹션 데이터의 빈 이미지 자리(렌더러가 문구를 찍지 않는 자리 — 적대 검토 critical).
 * 섹션이 0개면 빈 페이지다(`DM_RESIDUE_NO_CONTENT`).
 * ⛔ dm_pages는 읽기만 한다(플래너가 DM 원장을 쓰지 않는다). 컬럼 = id·company_id·status·short_code(+뷰어 렌더 입력).
 */
export async function inspectDmForCarry(companyId: string, dmId: string): Promise<DmCarryState> {
  const dm = await getDmDetail(dmId, companyId);
  if (!dm) return { exists: false, published: false, stopped: false, url: null, residue: [], checkError: null };
  const status = String(dm.status || '');
  const shortCode = dm.short_code ? String(dm.short_code) : '';
  const published = status === 'published' && !!shortCode;
  let residue: DmPlaceholderResidue[] = [];
  let checkError: string | null = null;
  if (published) {
    try {
      const sections = extractPagesFromDm(dm).flatMap((p) => (Array.isArray(p.sections) ? p.sections : []));
      if (sections.length === 0) residue = [{ label: DM_RESIDUE_NO_CONTENT, count: 1 }];
      else residue = mergeDmResidue(findDmPlaceholderResidue(renderDmViewerHtml(dm, '/api/dm/v')), findDmDataResidue(sections));
    } catch (e: any) {
      // 렌더가 죽으면 완성을 확인할 수 없다 — 못 확인한 것을 완성으로 두지 않는다(fail-closed). 담당자 몫이 아니라 시스템 확인 대상.
      console.error(`[planner-production] DM 완성 확인 실패 dm=${dmId}:`, e?.message || e);
      checkError = String(e?.message || e).slice(0, 200);
    }
  }
  return {
    exists: true,
    published,
    stopped: status === 'stopped',
    url: published ? buildDmPublicUrl(shortCode) : null,
    residue,
    checkError,
  };
}

/**
 * 초안 대기 접점의 발행·완성 감지 — **planned → ready 단일 CAS**만 한다(producing을 지나지 않는다).
 * 호출처 = 제작 패스(1시간) · 실행 워커(당일 10분) · 화면은 events 응답 조립 시 `readDmPublishStates`로 live 표시.
 * 반환 ready=true면 exec_meta에 dm_url·dm_stage='published'가 기록돼 있다.
 */
export async function syncDmPublishState(tp: PlannerTouchpointRow): Promise<{ ready: boolean; url: string | null; state: DmCarryState | null }> {
  if (tp.channel !== 'dm' || !tp.assetRef) return { ready: false, url: null, state: null };
  if (dmStageOf(tp.execMeta) === 'published' && tp.execMeta?.dm_url && tp.status === 'ready') {
    return { ready: true, url: String(tp.execMeta.dm_url), state: null };
  }
  const state = await inspectDmForCarry(tp.companyId, tp.assetRef);
  if (!isDmCarryable(state)) {
    // 발행됐지만 빈 자리가 남았거나 확인이 실패했으면 그 사실을 표식으로 남긴다(화면·통지가 읽는다). 상태는 그대로 planned.
    // ⛔ 통지는 **표식이 바뀐 호출 하나만** 보낸다(조건부 UPDATE RETURNING = 선점) — 화면 조립·워커가 동시에 보아도 한 통.
    const residueText = state.published && !state.checkError ? describeDmResidue(state.residue) : '';
    const changed = await stampExecMetaIfChanged(tp.companyId, tp.id, 'dm_residue', residueText, {
      dm_checked_at: new Date().toISOString(),
      ...(state.checkError ? { dm_check_error: state.checkError } : {}),
    });
    if (changed && residueText) {
      const noContent = state.residue.some((r) => r.label === DM_RESIDUE_NO_CONTENT);
      await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 모바일 DM 마무리 필요',
        noContent
          ? `'${tp.title}' 모바일 DM이 발행됐지만 내용이 비어 있어 문자에 실을 수 없습니다. 내용을 채워 다시 발행하면 ${tp.scheduledOn} 문자에 실립니다.\n${buildDmEditUrl(tp.assetRef)}`
          : `'${tp.title}' 모바일 DM이 발행됐지만 아직 채워지지 않은 자리가 있습니다: ${residueText}. 채운 뒤 다시 발행하면 ${tp.scheduledOn} 문자에 실립니다.\n${buildDmEditUrl(tp.assetRef)}`);
    }
    if (state.checkError) {
      const flagged = await stampExecMetaIfChanged(tp.companyId, tp.id, 'dm_check_error_notified', state.checkError);
      if (flagged) {
        await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 확인 필요',
          `'${tp.title}' 모바일 DM의 발행 상태를 확인하는 중 오류가 나 문자에 싣지 못하고 있습니다. 운영팀 확인이 필요합니다.`);
      }
    }
    return { ready: false, url: null, state };
  }
  const ok = await setTouchpointState({
    companyId: tp.companyId, touchpointId: tp.id, status: 'ready', fromStatuses: ['planned'], lockReason: null,
    execMetaPatch: { dm_stage: 'published', dm_url: state.url, dm_residue: '', dm_published_seen_at: new Date().toISOString() },
  });
  if (ok) {
    console.log(`[planner-production] DM 발행 확인 tp=${tp.id} dm=${tp.assetRef}`);
    return { ready: true, url: state.url, state };
  }
  // ★ CAS 0행 = 다른 호출이 먼저 올렸거나(정상) 상태가 바뀌었다(취소·생략). "발행 안 됨"과 갈라야 한다 — 재조회로 판정(Codex 1R).
  const fresh = await loadTouchpointById(tp.companyId, tp.id);
  if (fresh && fresh.status === 'ready' && dmStageOf(fresh.execMeta) === 'published') {
    return { ready: true, url: String(fresh.execMeta?.dm_url || state.url || ''), state };
  }
  return { ready: false, url: null, state };
}

/** 화면이 그리는 DM 단계 — 내부 상태값이 아니라 담당자가 할 일 기준이다. */
export interface TouchpointDmInfo {
  /**
   * pending = 초안 전(승인 뒤 제작 대기) · drafted = 초안 대기(담당자 완성·발행 필요) · incomplete = 발행됐지만 빈 자리 남음 ·
   * published = 발행·완성 확인(문자에 실린다) · stopped = 발행 중지됨(재개 전에는 실리지 않는다)
   */
  stage: 'pending' | 'drafted' | 'incomplete' | 'published' | 'stopped';
  dmId: string | null;
  /** 담당자 편집 화면 상대 경로(1클릭 진입). 초안이 없으면 null. */
  editPath: string | null;
  url: string | null;
  /** 남은 빈 자리 요약(있을 때만). */
  residue: string | null;
}

export interface MessagingTouchpointInfo {
  dm?: TouchpointDmInfo;
  dmLinked?: boolean;
  carriedBySms?: boolean;
  /** 같은 날 문자 형제가 이미 끝났다(발송·생략) — 지금 DM을 완성해도 실을 문자가 없다(화면이 그 사실을 말한다). */
  carrierDone?: boolean;
}

/** 아직 발송 축이 살아 있는 문자 상태(실행 판정 CARRIER_ALIVE와 같은 집합). */
const SMS_CARRIER_ALIVE = ['planned', 'ready', 'producing', 'scheduled', 'hold_credit', 'locked'];

/**
 * 화면 응답 조립 — 문자·DM 접점에 "DM 단계"와 "문자 1통에 실림" 표시를 붙인다(캘린더 목록·결재 브리핑 공용).
 * 발행 상태는 dm_pages를 **live**로 읽는다 — 담당자가 방금 발행하고 돌아왔을 때 화면이 그것을 알아야 한다.
 * ⛔ **읽기만 한다**(Codex 1R·적대 검토) — 조회가 상태를 올리거나 통지를 보내면 지난 달 캘린더를 여는 것만으로 옛 접점이 ready가 되고
 *   동시 조회가 같은 통지를 두 번 보낸다. 승격·통지는 제작 패스(1시간)·실행 워커(당일 10분)만 한다. 여기서는 실물을 읽어 그리기만.
 */
export async function describeMessagingTouchpoints(
  companyId: string,
  rows: Array<{ id: string; eventId: string; channel: string; timing: any; scheduledOn: string; status: string; assetRef: string | null; execMeta: Record<string, any> }>,
): Promise<Map<string, MessagingTouchpointInfo>> {
  const out = new Map<string, MessagingTouchpointInfo>();
  const messaging = rows.filter((r) => r.channel === 'sms' || r.channel === 'dm');
  if (messaging.length === 0) return out;
  const groups = new Map<string, Array<typeof messaging[number]>>();
  for (const r of messaging) {
    const k = `${r.eventId}:${carrierKey(r.scheduledOn, r.timing)}`;
    const arr = groups.get(k) || [];
    arr.push(r);
    groups.set(k, arr);
  }
  const dmRows = messaging.filter((r) => r.channel === 'dm');
  const live = await readDmPublishStates(companyId, dmRows.map((r) => String(r.assetRef || r.execMeta?.dm_id || '')).filter(Boolean));

  for (const [, group] of groups) {
    const sms = group.find((r) => r.channel === 'sms');
    const hasDm = group.some((r) => r.channel === 'dm');
    const smsAlive = !!sms && SMS_CARRIER_ALIVE.includes(sms.status);
    const smsDone = !!sms && !smsAlive;
    for (const r of group) {
      const info: MessagingTouchpointInfo = {};
      if (r.channel === 'sms') info.dmLinked = hasDm;
      if (r.channel === 'dm') {
        info.carriedBySms = smsAlive;
        if (smsDone && !['sent', 'skipped'].includes(r.status)) info.carrierDone = true;
        const dmId = String(r.assetRef || r.execMeta?.dm_id || '') || null;
        const stage = dmStageOf(r.execMeta);
        const liveState = dmId ? live.get(dmId) : undefined;
        let display: TouchpointDmInfo['stage'] = 'pending';
        let residue: string | null = String(r.execMeta?.dm_residue || '') || null;
        let url: string | null = r.execMeta?.dm_url ? String(r.execMeta.dm_url) : null;
        if (dmId) {
          if (liveState?.status === 'stopped') display = 'stopped';
          // 끝난 접점(발송·생략)은 그때 실렸는지만 말한다 — 배포 전 데이터(dm_stage 없이 dm_url·sent)도 여기로 온다.
          else if (r.status === 'sent' || r.status === 'skipped') display = (url || liveState?.url) ? 'published' : 'drafted';
          // 실행 대기·진행 중인 행은 발행 실물이 있으면 발행 완료다(옛 데이터 = dm_stage 없이 dm_url·ready).
          else if (['ready', 'producing'].includes(r.status) && (stage === 'published' || liveState?.url)) display = 'published';
          else if (liveState?.url && r.status === 'planned') {
            // 초안 대기인데 live로는 발행돼 있다 — 완성까지 **읽어서** 그린다(상태는 워커가 올린다).
            const state = await inspectDmForCarry(companyId, dmId).catch(() => null);
            if (isDmCarryable(state)) { display = 'published'; url = state!.url; residue = null; }
            else {
              residue = state?.checkError ? '시스템 확인 필요' : state && state.residue.length > 0 ? describeDmResidue(state.residue) : residue;
              display = 'incomplete';
            }
          } else if (stage === 'drafted' || r.assetRef) display = 'drafted';
        }
        info.dm = {
          stage: display,
          dmId,
          editPath: dmId && !['sent', 'skipped'].includes(r.status) ? buildDmEditPath(dmId) : null,
          url: display === 'published' ? (url || liveState?.url || null) : null,
          residue: display === 'incomplete' ? residue : null,
        };
      }
      out.set(r.id, info);
    }
  }
  return out;
}

/** 화면용 — 여러 DM의 발행 상태를 한 번에 읽는다(events·brief 응답 조립). 렌더 검사는 하지 않는다(표식 `dm_residue`를 쓴다). */
export async function readDmPublishStates(companyId: string, dmIds: string[]): Promise<Map<string, { status: string; url: string | null }>> {
  const out = new Map<string, { status: string; url: string | null }>();
  const ids = Array.from(new Set(dmIds.filter(Boolean)));
  if (ids.length === 0) return out;
  const r = await query(
    `SELECT id, status, short_code FROM dm_pages WHERE company_id = $1::uuid AND id = ANY($2::uuid[])`,
    [companyId, ids],
  );
  for (const row of r.rows as any[]) {
    const status = String(row.status || '');
    const shortCode = row.short_code ? String(row.short_code) : '';
    out.set(String(row.id), { status, url: status === 'published' && shortCode ? buildDmPublicUrl(shortCode) : null });
  }
  return out;
}

/** 인앱 — 패키지 생성 → 정지 상태로 저장. 게시(활성)는 실행 축이 예정일에 켠다. */
async function produceInapp(tp: PlannerTouchpointRow, userId: string): Promise<ProducedAsset> {
  const pkg = await runInCreditBundle(() =>
    generateInAppMessagePackage({
      companyId: tp.companyId,
      createdBy: userId,
      objective: `${tp.title} 행사 안내`,
      eventText: buildPlannerEventText(tp),
    }),
  );
  const m = pkg.message;
  const created = await createInAppMessage(tp.companyId, userId, {
    title: m.title,
    body: m.body,
    template: m.template,
    image_url: m.image_url,
    badge_text: m.badge_text,
    buttons: m.buttons as any,
    backgroundColor: m.background_color,
    textColor: m.text_color,
    segment_conditions: m.segment_conditions,
    trigger_conditions: m.trigger_conditions,
    personalization_vars: m.personalization_vars as any,
    displayFrequency: m.display_frequency,
    auto_dismiss_seconds: m.auto_dismiss_seconds,
    max_displays_per_user: m.max_displays_per_user,
    send_start_hour: m.send_start_hour,
    send_end_hour: m.send_end_hour,
    allowed_weekdays: m.allowed_weekdays,
    animation: m.animation,
    content_blocks: m.content_blocks,
    theme: m.theme,
    accent_color: m.accent_color,
    card_style: m.card_style,
    design: m.design,
    channel: 'web',
    // ⛔ 제작 시점에 켜지 않는다 — 게시는 예정일에 실행 축이 한다(미승인·조기 노출 0).
    status: 'paused',
  } as any);
  return {
    assetRef: created.id,
    label: '인앱 메시지',
    execMeta: { inapp_message_id: created.id, produced_at: new Date().toISOString() },
  };
}

// ── 과금 ─────────────────────────────────────────────────────────────
/**
 * 채널별 제작비 — 단가·소스의 진실은 CREDIT_COST_MAP 하나다.
 *
 * ⛔ **멱등키는 그 채널이 원래 쓰는 키를 그대로 쓴다**(제작물 id 기준):
 *   `email-campaign-complete:{캠페인}` · `inapp-publish:{메시지}`.
 *   플래너 전용 키를 따로 만들면, 나중에 담당자가 그 제작물을 화면에서 발행·완성할 때
 *   같은 제작물에 **두 번 과금**된다(각 라우트는 자기 키로만 중복을 판정한다).
 *   생성(dm-ai-generate)만 라우트에 대응 키가 없어 터치포인트 키를 쓴다.
 * ★ 2026-09-02 **DM 발행비(100·인터랙션 120)는 플래너가 걷지 않는다.** 발행은 담당자가 DM 빌더에서 하고 그 라우트가
 *   `dm-publish:{DM}` 키로 걷는다(단가 분기도 그쪽이 정확하다). 플래너가 초안 단계에서 100을 먼저 걷으면
 *   발행되지 않은 DM에 돈이 남고 담당자 발행은 영구 무과금이 된다. 플래너 몫 = 생성비 5뿐.
 */
function productionCharges(tp: PlannerTouchpointRow, assetRef: string): Array<{ source: string; cost: number; key: string }> {
  switch (tp.channel) {
    case 'email':
      return [{ source: 'email-campaign-complete', cost: getCreditCost('email-campaign-complete'), key: `email-campaign-complete:${assetRef}` }];
    case 'dm':
      return [{ source: 'dm-ai-generate', cost: getCreditCost('dm-ai-generate'), key: plannerProduceGenKey(tp.id) }];
    case 'inapp':
      return [{ source: 'inapp-publish', cost: getCreditCost('inapp-publish'), key: `inapp-publish:${assetRef}` }];
    default:
      return [];
  }
}

/** 제작 전 사전 확인용 예상 총액 — 실제 청구는 제작물이 생긴 뒤 productionCharges가 한다. */
function estimateProductionCost(tp: PlannerTouchpointRow): number {
  return productionCharges(tp, '00000000-0000-0000-0000-000000000000').reduce((s, c) => s + c.cost, 0);
}

/** 제작비 정산 — 전부 확정되면 true. 하나라도 미확정이면 false(호출부가 보류로 내린다). */
async function settleProductionCharges(tp: PlannerTouchpointRow, userId: string | null, assetRef: string): Promise<boolean> {
  let ok = true;
  for (const c of productionCharges(tp, assetRef)) {
    if (c.cost <= 0) continue;
    const settled = await deductCreditSafe({
      companyId: tp.companyId, cost: c.cost, source: c.source, createdBy: userId, idempotencyKey: c.key,
    });
    if (!settled) ok = false;
  }
  return ok;
}

// ── 제작 1건 ─────────────────────────────────────────────────────────
/**
 * 터치포인트 1건 제작. 선점(CAS)으로 소유권을 잡고, 성공 뒤에만 ready로 올린다.
 * ⛔ 이미 제작물이 있으면 다시 만들지 않는다 — 같은 행사에 소재가 둘 생기면 어느 것이 나갈지 갈린다.
 */
export async function produceTouchpoint(tp: PlannerTouchpointRow): Promise<ProduceOutcome> {
  const userId = tp.createdBy;
  if (!userId) {
    await setTouchpointState({
      companyId: tp.companyId, touchpointId: tp.id, status: 'locked', fromStatuses: ['planned', 'producing'],
      lockReason: '행사를 만든 계정을 확인할 수 없어 소재를 제작하지 못했습니다.',
    });
    await notifyPlanner(tp.companyId, null, '[마케팅 플래너] 소재 제작 보류',
      `'${tp.title}' ${tp.channelLabel} 소재를 만들 계정을 확인하지 못해 보류했습니다. 담당자 확인이 필요합니다.`);
    return 'locked';
  }
  // ★ 2026-09-02 초안 대기 DM은 제작 경로에 들이지 않는다 — **잠금 앞에서** 돌려보낸다.
  //   producing 왕복·claimed_at 갱신 자체가 없어야 고아 회수가 정상 초안을 회수하지 않고 취소 집계도 흔들리지 않는다.
  //   여기서 하는 일은 발행·완성 감지(planned → ready 단일 CAS)뿐이다.
  if (tp.channel === 'dm' && dmStageOf(tp.execMeta) === 'drafted') {
    const synced = await syncDmPublishState(tp);
    return synced.ready ? 'ready' : 'awaiting';
  }
  // ⛔ 제작 선점은 승인 원장 행 잠금 안에서 — 취소와 직렬화된다(제작비가 나간 뒤 환불되는 창 차단).
  //   **빠른 경로(이미 제작물이 있는 행)도 이 잠금 뒤에 둔다** — 잠금 앞에서 차감하면 취소된 달에 돈이 나간다.
  if (!(await claimTouchpointUnderPlanLock(tp, ['planned']))) return 'already';
  if (tp.assetRef) {
    // ⛔ **제작물 참조가 있다고 과금이 끝난 것은 아니다.** 참조 기록과 차감 사이에 프로세스가 끊기면
    //   여기로 다시 들어오는데, 그때 그냥 ready로 올리면 그 제작물은 영구 무과금이 된다.
    //   같은 멱등키라 이미 냈으면 duplicate로 끝난다(재차감 0).
    const paid = await settleProductionCharges(tp, userId, tp.assetRef);
    if (!paid) {
      await setTouchpointState({
        companyId: tp.companyId, touchpointId: tp.id, status: 'hold_credit', fromStatuses: ['producing'],
        lockReason: '제작비 차감이 확정되지 않아 발송을 보류했습니다.',
        execMetaPatch: { hold_reason: 'charge_unsettled', held_at: new Date().toISOString() },
      });
      await notifyPlanner(tp.companyId, userId, '[마케팅 플래너] 제작 보류',
        `'${tp.title}' ${tp.channelLabel} 제작비 차감이 확인되지 않아 발송을 보류했습니다. 크레딧 확인 후 [재개]를 눌러주세요.`);
      return 'hold_credit';
    }
    if (tp.channel === 'dm') {
      // 초안은 있는데 단계 표식이 없는 행(참조 기록 직후 끊긴 경우) — 초안 대기로 되돌린다. ready는 발행 감지만 만든다.
      await setTouchpointState({
        companyId: tp.companyId, touchpointId: tp.id, status: 'planned', fromStatuses: ['producing'], lockReason: null,
        execMetaPatch: { dm_stage: 'drafted', dm_edit_path: buildDmEditPath(tp.assetRef) },
      });
      return 'awaiting';
    }
    await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'ready', fromStatuses: ['producing'] });
    return 'already';
  }
  await setEventStatus(tp.companyId, tp.eventId, 'producing', ['approved']);

  // 사전 잔액 확인 — 만들고 나서 못 내는 상황을 줄인다(그래도 동시 소진은 아래 정산이 잡는다).
  const total = estimateProductionCost(tp);
  try {
    if (total > 0) await checkCredit(tp.companyId, total);
  } catch (err) {
    if (err instanceof InsufficientCreditError) {
      await setTouchpointState({
        companyId: tp.companyId, touchpointId: tp.id, status: 'hold_credit', fromStatuses: ['producing'],
        lockReason: '크레딧이 부족해 소재 제작을 보류했습니다.',
        execMetaPatch: { hold_reason: 'insufficient_credit', held_at: new Date().toISOString() },
      });
      await notifyPlanner(tp.companyId, userId, '[마케팅 플래너] 제작 보류',
        `'${tp.title}' ${tp.channelLabel} 소재 제작이 크레딧 부족으로 보류됐습니다. 충전 후 플래너에서 [재개]를 눌러주세요.`);
      return 'hold_credit';
    }
    throw err;
  }

  let asset: ProducedAsset;
  try {
    asset = tp.channel === 'email' ? await produceEmail(tp, userId)
      : tp.channel === 'dm' ? await produceDm(tp, userId)
      : await produceInapp(tp, userId);
  } catch (err: any) {
    const msg = String(err?.message || err);
    // 재료가 없어 못 만드는 것(설정 부재)과 일시 오류를 가른다 — 앞은 잠그고 알리고, 뒤는 다음 주기 재시도.
    const permanent = /SMTP|fromEmail|설정|직접 입력|column|does not exist/i.test(msg);
    if (permanent) {
      await setTouchpointState({
        companyId: tp.companyId, touchpointId: tp.id, status: 'locked', fromStatuses: ['producing'],
        lockReason: `소재 제작 불가: ${msg.slice(0, 200)}`,
      });
      await notifyPlanner(tp.companyId, userId, '[마케팅 플래너] 소재 제작 보류',
        `'${tp.title}' ${tp.channelLabel} 소재를 만들지 못했습니다. 사유: ${msg.slice(0, 120)}`);
      console.error(`[planner-production] 영구 실패 tp=${tp.id}:`, msg);
      return 'locked';
    }
    await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'planned', fromStatuses: ['producing'] });
    console.warn(`[planner-production] 일시 실패(다음 주기 재시도) tp=${tp.id}:`, msg);
    return 'retry';
  }

  // 제작물이 생겼다 — 참조를 먼저 붙인다(과금 실패로 소재가 미아가 되지 않게).
  await setTouchpointState({
    companyId: tp.companyId, touchpointId: tp.id, status: 'producing', assetRef: asset.assetRef, execMetaPatch: asset.execMeta,
  });
  const paid = await settleProductionCharges(tp, userId, asset.assetRef);
  if (!paid) {
    await setTouchpointState({
      companyId: tp.companyId, touchpointId: tp.id, status: 'hold_credit', fromStatuses: ['producing'],
      lockReason: '제작비 차감이 확정되지 않아 발송을 보류했습니다.',
      execMetaPatch: { hold_reason: 'charge_unsettled', held_at: new Date().toISOString() },
    });
    await notifyPlanner(tp.companyId, userId, '[마케팅 플래너] 제작 보류',
      `'${tp.title}' ${tp.channelLabel} ${asset.label} 제작비 차감이 확인되지 않아 발송을 보류했습니다. 크레딧 확인 후 [재개]를 눌러주세요.`);
    return 'hold_credit';
  }
  if (tp.channel === 'dm') {
    // ★ 2026-09-02 DM은 초안 대기로 돌아간다 — 담당자가 완성·발행해야 ready가 된다(발행 감지 sync가 유일한 승격 경로).
    await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'planned', fromStatuses: ['producing'], lockReason: null });
    await notifyPlanner(tp.companyId, userId, '[마케팅 플래너] 모바일 DM 초안 준비',
      buildDmDraftNotice(tp, asset.assetRef));
    console.log(`[planner-production] dm 초안 생성 tp=${tp.id} dm=${asset.assetRef} — 담당자 발행 대기`);
    return 'awaiting';
  }
  await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'ready', fromStatuses: ['producing'], lockReason: null });
  console.log(`[planner-production] ${tp.channel} 제작 완료 tp=${tp.id} asset=${asset.assetRef}`);
  return 'ready';
}

/** 초안 준비 통지 문구 — 어디에 실리는지·발행 전에는 나가지 않는다는 사실을 함께 말한다. */
function buildDmDraftNotice(tp: PlannerTouchpointRow, dmId: string): string {
  return [
    `'${tp.title}' ${describeTiming(tp.timing)}(${tp.scheduledOn}) 문자에 실을 모바일 DM 초안이 준비됐습니다.`,
    '사진과 문구를 채우고 [발행]을 누르면 그날 문자 1통에 링크로 함께 나갑니다. 발행 전에는 그 문자가 나가지 않습니다.',
    buildDmEditUrl(dmId),
  ].join('\n');
}

// ── 워커 ─────────────────────────────────────────────────────────────
/**
 * 제작 패스 — 승인 직후 호출(best-effort)과 주기 워커(그물)가 공유한다.
 * 한 주기에 몰아서 만들지 않는다(AI 호출이라 상한을 둔다) — 남은 건은 다음 주기가 집는다.
 */
export async function runPlannerProductionPass(opts?: { companyId?: string; limit?: number }): Promise<{ produced: number; held: number; locked: number; awaiting: number }> {
  if (!(await guardExecMetaOrSkip('planner-production'))) return { produced: 0, held: 0, locked: 0, awaiting: 0 };
  const rows = await loadLiveTouchpoints({
    statuses: ['planned'],
    channels: PLANNER_MATERIAL_CHANNELS,
    monthFrom: kstMonthString(),
    companyId: opts?.companyId,
    limit: opts?.limit || 20,
  });
  let produced = 0, held = 0, locked = 0, awaiting = 0;
  for (const tp of rows) {
    try {
      // ★ 2026-09-02 초안 대기 DM은 제작이 아니라 **발행 감지**만 한다(잠금·선점 없음 — produceTouchpoint도 같은 분기로 돌려보낸다).
      const r = await produceTouchpoint(tp);
      if (r === 'ready') produced++;
      else if (r === 'hold_credit') held++;
      else if (r === 'locked') locked++;
      else if (r === 'awaiting') awaiting++;
    } catch (e: any) {
      console.error(`[planner-production] tp=${tp.id} 제작 오류:`, e?.message || e);
      // ⛔ dm_stage는 지우지 않는다 — exec_meta 병합만 하므로 planned로 돌아가도 초안 단계 표식은 남는다(계약).
      await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'planned', fromStatuses: ['producing'] }).catch(() => { /* 다음 주기 */ });
    }
  }
  if (produced + held + locked > 0) {
    console.log(`[planner-production] 제작 ${produced} · 보류 ${held} · 잠금 ${locked} · 발행 대기 ${awaiting}`);
  }
  return { produced, held, locked, awaiting };
}

/**
 * 초안 대기 DM 리마인드 — **예정일 하루 전 1회**(★ 2026-09-02). 대조 워커(1시간)가 부른다.
 * 발행 전에는 그 시점 문자가 나가지 않으므로, 담당자가 모른 채 예정일을 넘기는 일을 막는 마지막 통지다.
 * 발행비 잔액이 모자라면 그 사실도 함께 말한다 — 담당자 발행이 402로 막히면 플래너는 그것을 알 길이 없다.
 */
export async function runPlannerDmReminderPass(today = kstDateString()): Promise<{ reminded: number }> {
  if (!(await guardExecMetaOrSkip('planner-dm-reminder'))) return { reminded: 0 };
  const tomorrow = addDays(today, 1);
  // 예정일은 계산값이라 SQL로 못 거른다 — 페이지로 **전 행**을 순회한다(상한으로 자르면 뒤쪽 내일 예정분이 영구히 굶는다 · Codex 2R).
  const PAGE = 2000;
  const rows: PlannerTouchpointRow[] = [];
  for (let offset = 0; offset < 50 * PAGE; offset += PAGE) {
    const page = await loadLiveTouchpoints({ statuses: ['planned'], channels: ['dm'], monthFrom: kstMonthString(), limit: PAGE, offset });
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  let reminded = 0;
  for (const tp of rows) {
    if (dmStageOf(tp.execMeta) !== 'drafted' || !tp.assetRef) continue;
    if (tp.scheduledOn !== tomorrow) continue;
    if (tp.execMeta?.dm_reminded_at) continue;
    // 발행됐는데 감지가 아직이면 여기서 올린다(리마인드 대신).
    const synced = await syncDmPublishState(tp).catch(() => ({ ready: false }));
    if (synced.ready) continue;
    let creditLine = '';
    try {
      await checkCredit(tp.companyId, getCreditCost('dm-builder'));
    } catch (err) {
      if (err instanceof InsufficientCreditError) creditLine = ' 발행비 크레딧이 부족해 발행이 막힐 수 있으니 충전도 확인해 주세요.';
    }
    const residue = String(tp.execMeta?.dm_residue || '');
    const body = [
      `내일(${tp.scheduledOn}) 나갈 '${tp.title}' 문자에 실을 모바일 DM이 아직 마무리되지 않았습니다${residue ? ` (남은 자리: ${residue})` : ''}.`,
      `오늘 안에 완성·발행하지 않으면 내일 그 문자는 보내지 않고 건너뜁니다.${creditLine}`,
      buildDmEditUrl(tp.assetRef),
    ].join('\n');
    const sent = await notifyPlanner(tp.companyId, tp.createdBy, '[마케팅 플래너] 모바일 DM 발행 필요', body);
    if (!sent) continue;
    await stampExecMeta(tp.companyId, tp.id, { dm_reminded_at: new Date().toISOString() }).catch(() => { /* 다음 주기 재알림 */ });
    reminded++;
  }
  if (reminded > 0) console.log(`[planner-production] DM 발행 리마인드 ${reminded}건`);
  return { reminded };
}

/**
 * 보류 재개 — 화면 [다시 시작] 1클릭. 같은 멱등키라 이미 낸 돈이 다시 빠지지 않는다.
 *
 * ★ 2026-08-13(2) 정정 — 결함 둘이 한 뿌리였다: **재개를 제작 경로 재진입으로 만든 것.**
 *   ① 전이 대상이 `hold_credit`뿐이라 `locked`(080 미등록·스팸 미통과·발송 접수 실패·고아 회수)는
 *      한 줄도 움직이지 않는데 **반환값을 보지 않아 성공을 돌려줬다** — 화면은 "다시 시작했습니다"를 띄우고
 *      행은 잠긴 채 남는다(6원칙 ② 위반).
 *   ② 채널을 보지 않고 `produceTouchpoint`를 불러, 소재 채널이 아닌 문자·알림톡이 **인앱 제작 분기로** 떨어졌다.
 *      엉뚱한 인앱 메시지가 생기고 그 `asset_ref`가 취소 환불 판정에서 "제작 있음"이 되어 환불까지 막는다.
 *
 * 그래서 재개는 **상태 복원**이다 — 전이 효과(RETURNING)로만 성공을 판정하고, 제작은 소재 채널에만 태운다.
 */
export async function resumeHeldTouchpoint(tp: PlannerTouchpointRow): Promise<ProduceOutcome> {
  const RESUMABLE_FROM = ['hold_credit', 'locked'];

  // ⛔ 알림톡 2회 반려(검수 상한)는 되살릴 수 없다 — 상태만 돌려놓으면 검수 패스도 실행 패스도 집지 않아
  //   또 조용한 무효과가 된다. 되살릴 수 없다고 답하고 화면의 사유를 읽게 한다.
  if (tp.channel === 'alimtalk' && String(tp.execMeta?.alimtalk_stage || '') === 'blocked') return 'unresumable';

  // ⛔ ★ 2026-09-02 "보냈는지 모르는" 행(발송 시도 표식은 있는데 실행 참조가 없다)은 되살리지 않는다.
  //   되돌리면 그 행이 다시 발송 후보가 되어 **이미 나갔을 수도 있는 문자가 한 번 더** 나간다(§3-9-1).
  //   발송 내역을 확인해 사람이 판정할 문제다 — 화면의 사유가 그것을 말한다.
  if (tp.execMeta?.send_started_at && !tp.execRef) return 'unresumable';
  // 취소된 달은 되살릴 것이 없다 — 되돌려도 어떤 워커도 집지 않아 "다시 시작했습니다"만 남는 조용한 무효과가 된다(§3-16).
  if (!(await isPlannerPlanLive(tp.companyId, tp.eventId))) return 'unresumable';

  // 문자·알림톡 — 실행 축이 예정일에 다시 집도록 planned로만 되돌린다(제작 경로에 넣지 않는다).
  if (!isMaterialChannel(tp.channel)) {
    const ok = await setTouchpointState({
      companyId: tp.companyId, touchpointId: tp.id, status: 'planned', fromStatuses: RESUMABLE_FROM, lockReason: null,
    });
    return ok ? 'retry' : 'unresumable';
  }

  // 소재가 이미 있으면 미결 제작비만 정산하고 실행 대기로 올린다(같은 멱등키 = 재차감 0).
  if (tp.assetRef) {
    const paid = await settleProductionCharges(tp, tp.createdBy, tp.assetRef);
    if (!paid) return 'hold_credit';
    // ★ 2026-09-02 DM은 발행·완성 확인 없이 ready가 되지 않는다 — 초안 대기(planned+drafted)로 복원하고 감지에 맡긴다.
    if (tp.channel === 'dm' && dmStageOf(tp.execMeta) !== 'published') {
      const restoredDm = await setTouchpointState({
        companyId: tp.companyId, touchpointId: tp.id, status: 'planned', fromStatuses: RESUMABLE_FROM, lockReason: null,
        execMetaPatch: { dm_stage: 'drafted', dm_edit_path: buildDmEditPath(tp.assetRef) },
      });
      if (!restoredDm) return 'unresumable';
      const synced = await syncDmPublishState({ ...tp, status: 'planned', execMeta: { ...tp.execMeta, dm_stage: 'drafted' } });
      return synced.ready ? 'ready' : 'awaiting';
    }
    const ok = await setTouchpointState({
      companyId: tp.companyId, touchpointId: tp.id, status: 'ready', fromStatuses: RESUMABLE_FROM, lockReason: null,
    });
    return ok ? 'ready' : 'unresumable';
  }

  // 제작 전에 멈춘 건 — planned로 되돌린 뒤 제작 경로를 다시 탄다(선점은 그 안에서 잠금·CAS로).
  const restored = await setTouchpointState({
    companyId: tp.companyId, touchpointId: tp.id, status: 'planned', fromStatuses: RESUMABLE_FROM, lockReason: null,
  });
  if (!restored) return 'unresumable';
  return produceTouchpoint({ ...tp, status: 'planned' });
}

// 그 달 제작·실행 실적(취소 환불 자격의 근거)은 원장 접근 CT가 소유한다 — `planner-touchpoint.countMonthWork`.
