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
 */
import { checkCredit, deductCreditSafe, InsufficientCreditError } from './ai-credit';
import { getCreditCost } from './ai-credit-calc';
import { runInCreditBundle } from './ai-credit-context';
import { generateEmailSections, hasUneditedPlaceholder } from './email-ai';
import { renderEmailSections } from './email/email-section-renderer';
import { createEmailCampaign } from './email-channel';
import { getCompanyBrandKit } from './dm/dm-brand-kit';
import { attachMallImagesToProductCarousels } from './mall-product-match';
import { oneShotGenerate } from './dm/dm-ai';
import { createDm, publishDm } from './dm/dm-builder';
import { generateInAppMessagePackage } from './inapp-ai-generator';
import { createInAppMessage } from './inapp-message';
import {
  PlannerTouchpointRow,
  claimTouchpointUnderPlanLock,
  guardExecMetaOrSkip,
  loadLiveTouchpoints,
  notifyPlanner,
  setEventStatus,
  setTouchpointState,
} from './planner-touchpoint';
import {
  PLANNER_MATERIAL_CHANNELS,
  buildPlannerEventText,
  insertParticipationSection,
  isMaterialChannel,
  kstMonthString,
  plannerProduceGenKey,
} from './planner-execution';
import { buildJoinToken, buildJoinUrl, joinTokenExpiry } from './planner-participation';

/**
 * 제작 결과 — 상태와 통지 문구를 호출부가 판단할 수 있게 사유를 함께 돌려준다.
 * `unresumable` = 재개가 아무 효과도 내지 못했다(전이 0행·되살릴 수 없는 단계). **성공으로 답하지 않기 위한 값**이다.
 */
export type ProduceOutcome = 'ready' | 'hold_credit' | 'locked' | 'retry' | 'already' | 'unresumable';

interface ProducedAsset {
  assetRef: string;
  /** 제작물 요약 — 통지·브리핑 문구. */
  label: string;
  execMeta: Record<string, any>;
}

// ── 채널별 제작 ──────────────────────────────────────────────────────

/** 이메일 브로마이드 — 섹션 생성 → 몰 상품 이미지 매칭 → 참여 버튼 → 렌더 → 캠페인(초안) 저장. */
async function produceEmail(tp: PlannerTouchpointRow, userId: string): Promise<ProducedAsset> {
  const eventText = buildPlannerEventText(tp);
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

/** 모바일 DM — 섹션 생성 → 저장 → 발행(단축 주소). 당일 문자에 그 주소를 싣는다. */
async function produceDm(tp: PlannerTouchpointRow, userId: string): Promise<ProducedAsset> {
  const eventText = buildPlannerEventText(tp);
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
  const published = await publishDm(String(dm.id), tp.companyId);
  if (!published?.short_code) throw new Error('DM 발행 주소를 만들지 못했습니다.');
  const shortBase = String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
  const url = shortBase
    ? `${shortBase}/${published.short_code}`
    : `${String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '')}/api/dm/v/dm-${published.short_code}`;
  return {
    assetRef: String(dm.id),
    label: '모바일 DM',
    execMeta: { dm_id: String(dm.id), dm_url: url, produced_at: new Date().toISOString() },
  };
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
 * DM은 생성(5)·발행(100)이 서로 다른 원가라 원장에도 갈라 남긴다(라벨이 정확해야 이력이 읽힌다).
 *
 * ⛔ **멱등키는 그 채널이 원래 쓰는 키를 그대로 쓴다**(제작물 id 기준):
 *   `email-campaign-complete:{캠페인}` · `dm-publish:{DM}` · `inapp-publish:{메시지}`.
 *   플래너 전용 키를 따로 만들면, 나중에 담당자가 그 제작물을 화면에서 발행·완성할 때
 *   같은 제작물에 **두 번 과금**된다(각 라우트는 자기 키로만 중복을 판정한다).
 *   생성(dm-ai-generate)만 라우트에 대응 키가 없어 터치포인트 키를 쓴다.
 */
function productionCharges(tp: PlannerTouchpointRow, assetRef: string): Array<{ source: string; cost: number; key: string }> {
  switch (tp.channel) {
    case 'email':
      return [{ source: 'email-campaign-complete', cost: getCreditCost('email-campaign-complete'), key: `email-campaign-complete:${assetRef}` }];
    case 'dm':
      return [
        { source: 'dm-ai-generate', cost: getCreditCost('dm-ai-generate'), key: plannerProduceGenKey(tp.id) },
        { source: 'dm-builder', cost: getCreditCost('dm-builder'), key: `dm-publish:${assetRef}` },
      ];
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
  await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'ready', fromStatuses: ['producing'], lockReason: null });
  console.log(`[planner-production] ${tp.channel} 제작 완료 tp=${tp.id} asset=${asset.assetRef}`);
  return 'ready';
}

// ── 워커 ─────────────────────────────────────────────────────────────
/**
 * 제작 패스 — 승인 직후 호출(best-effort)과 주기 워커(그물)가 공유한다.
 * 한 주기에 몰아서 만들지 않는다(AI 호출이라 상한을 둔다) — 남은 건은 다음 주기가 집는다.
 */
export async function runPlannerProductionPass(opts?: { companyId?: string; limit?: number }): Promise<{ produced: number; held: number; locked: number }> {
  if (!(await guardExecMetaOrSkip('planner-production'))) return { produced: 0, held: 0, locked: 0 };
  const rows = await loadLiveTouchpoints({
    statuses: ['planned'],
    channels: PLANNER_MATERIAL_CHANNELS,
    monthFrom: kstMonthString(),
    companyId: opts?.companyId,
    limit: opts?.limit || 20,
  });
  let produced = 0, held = 0, locked = 0;
  for (const tp of rows) {
    try {
      const r = await produceTouchpoint(tp);
      if (r === 'ready') produced++;
      else if (r === 'hold_credit') held++;
      else if (r === 'locked') locked++;
    } catch (e: any) {
      console.error(`[planner-production] tp=${tp.id} 제작 오류:`, e?.message || e);
      await setTouchpointState({ companyId: tp.companyId, touchpointId: tp.id, status: 'planned', fromStatuses: ['producing'] }).catch(() => { /* 다음 주기 */ });
    }
  }
  if (produced + held + locked > 0) {
    console.log(`[planner-production] 제작 ${produced} · 보류 ${held} · 잠금 ${locked}`);
  }
  return { produced, held, locked };
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
