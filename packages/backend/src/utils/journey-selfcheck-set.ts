/**
 * 합성 회사 여정 세트 — 서버가 만들고 켠다(★ 2026-11-15 C134 S3 · 설계서 docs/2026-11-14-journey-step-campaign-owner-design.md §12)
 *
 * 왜 있나
 *   여정 자동 판정(journey-selfcheck · 「여정 결함 0」을 사람 없이 매일 잰다)은 켜져 있는 여정이 지나는 길만 본다.
 *   합성 회사에 손으로 켠 여정 몇 개가 표본의 전부라 「한 번도 안 탄 시작 종류」가 길게 남았다.
 *   → 합성 회사에 시작 종류 11개의 여정 세트가 켜져 있게 한다. 사람이 화면에서 하는 순서(만들기 → 발송 전 검증 → 켜기 관문)를 같은 함수로 지난다.
 *
 * 지키는 것
 *   · 대상 = 스위치 ENV(JOURNEY_SELFCHECK_SET_COMPANY_IDS)에 적힌 회사 ∩ 합성 회사(부르는 쪽 demo-data 가 합성 회사 목록을 넘긴다). ENV 가 비면 아무것도 안 한다.
 *   · 여정 표에 직접 쓰지 않는다. 워커가 직접 쓰는 표는 자기 원장(journey_selfcheck_set · C134-DDL-2) 하나.
 *   · 세트 여정의 신원 = 원장 행(회사 · 세트 키)이 가리키는 여정 id 하나. 이름과 무관하다.
 *   · 여정은 다 만들고 칸 알림까지 끈 뒤에만 원장에 잇는다. 워커는 이어진 여정만 검증 · 켠다(만들다 죽은 초안은 안 이어진 채 남는다).
 *   · 워커는 여정을 지우지 · 멈추지 · 끝내지 · 다시 켜지 않는다(멈춤 · 끝 · 보관 · 사람이 지움 = 그대로 둔다).
 *   · 돈이 들 수 있는 시도(만들기 · 검증)는 시도를 시작하는 UPDATE 한 문장이 근거(횟수 · 다음 시도 시각)를 함께 쓰고, 그 문장이 행을 돌려줄 때만 한다.
 *     (LESSONS_BACKEND 1102 「재시도 상한의 근거는 사전 · 원자」 — 재기동해도 횟수가 이어진다)
 */
import crypto from 'crypto';
import type { PoolClient } from 'pg';
import { query, pool } from '../config/database';
import { createJourneyFromTemplate, updateJourneyStep, type JourneyTemplateCode } from './journey-builder';
import { listJourneyCallbackNumbers } from './journey-callback';
import { defaultCallbackOf } from './journey-draft-save';
import { pretestAndMark, type PretestMark } from './journey-pretest-mark';
import { activateJourneysInOrder, unresolvedOverlapPairs } from './journey-activation';
import { getTriggerContract } from './journey-trigger-capability';
import { pickOwnerContact } from './owner-contact';
import { sendSystemAlert } from './system-alert';
import { uuidListOf } from './demo-data';
import type { StepSpamParams, StepSpamTestResult } from './journey-pretest-validator';

// ───── 세트 정의 ─────

export interface SetStepDef {
  channel: 'lms' | 'sms';
  /** 앞 칸 뒤 기다리는 시간(첫 칸 = 0) */
  delayHours: number;
  /** LMS 만 */
  subject?: string;
  body: string;
}
export interface SetDef {
  /** 원장의 세트 키(바꾸지 않는다) */
  key: string;
  /** 판 번호 — 글 · 칸 · 시작 조건을 고치면 올린다(계약 시험이 지문과 함께 고정한다) */
  rev: number;
  /** 이름의 뒷부분(「자동 점검 · 」 뒤) */
  label: string;
  triggerEvent: string;
  triggerFilters: Record<string, unknown>;
  allowReentry: boolean;
  reentryCooldownDays: number | null;
  steps: SetStepDef[];
}

/**
 * 세트 11개(설계서 §12-4 · §12-5). 글 = 혜택 · 링크 · 지어낸 값 0 · 변수는 %고객명% 하나 · 광고(나갈 때 (광고) · 무료수신거부가 붙는다).
 *   SMS 는 광고 표기가 붙어도 한 통(90바이트)에 들게 짧게 쓴다.
 */
export const SELFCHECK_SET: readonly SetDef[] = [
  {
    key: 'signup', rev: 1, label: '신규 가입', triggerEvent: 'customer.created', triggerFilters: { recent_hours: 24 }, allowReentry: false, reentryCooldownDays: null,
    steps: [
      { channel: 'lms', delayHours: 0, subject: '가입 감사 인사', body: '%고객명%님, 회원으로 가입해 주셔서 감사합니다. 매장과 온라인 몰에서 편하게 둘러보세요.' },
      { channel: 'sms', delayHours: 24, body: '%고객명%님, 가입을 환영합니다.' },
    ],
  },
  {
    key: 'first_purchase', rev: 1, label: '첫 구매', triggerEvent: 'purchase.first', triggerFilters: {}, allowReentry: false, reentryCooldownDays: null,
    steps: [{ channel: 'lms', delayHours: 0, subject: '첫 구매 감사 인사', body: '%고객명%님, 첫 구매를 해 주셔서 감사합니다. 사용하시다 궁금한 점은 매장으로 문의해 주세요.' }],
  },
  {
    key: 'purchase', rev: 1, label: '주문 완료', triggerEvent: 'cdp.purchase', triggerFilters: {}, allowReentry: true, reentryCooldownDays: 0,
    steps: [{ channel: 'lms', delayHours: 0, subject: '구매 감사 인사', body: '%고객명%님, 구매해 주셔서 감사합니다. 다음에도 좋은 제품으로 찾아뵙겠습니다.' }],
  },
  {
    key: 'product', rev: 1, label: '상품 구매', triggerEvent: 'purchase.product',
    triggerFilters: { product_keys: ['SK-101'], product_names: ['수분 진정 토너'], door: 'ledger' }, allowReentry: true, reentryCooldownDays: 0,
    steps: [{ channel: 'lms', delayHours: 0, subject: '구매 감사 인사', body: '%고객명%님, 수분 진정 토너를 구매해 주셔서 감사합니다. 사용하시다 궁금한 점은 매장으로 문의해 주세요.' }],
  },
  {
    key: 'dormant', rev: 1, label: '휴면 전환', triggerEvent: 'customer.dormant', triggerFilters: { dormant_days: 30 }, allowReentry: true, reentryCooldownDays: 90,
    steps: [{ channel: 'lms', delayHours: 0, subject: '오랜만에 인사드립니다', body: '%고객명%님, 오랜만에 인사드립니다. 매장과 온라인 몰에서 다시 뵙기를 기다리겠습니다.' }],
  },
  {
    key: 'dormant_return', rev: 1, label: '휴면 복귀', triggerEvent: 'customer.dormant_return', triggerFilters: {}, allowReentry: true, reentryCooldownDays: 0,
    steps: [{ channel: 'lms', delayHours: 0, subject: '다시 찾아 주셔서 감사합니다', body: '%고객명%님, 다시 찾아 주셔서 감사합니다. 앞으로도 자주 뵙겠습니다.' }],
  },
  {
    key: 'cycle_lapsed', rev: 1, label: '구매 주기 이탈', triggerEvent: 'customer.cycle_lapsed', triggerFilters: {}, allowReentry: true, reentryCooldownDays: 30,
    steps: [{ channel: 'lms', delayHours: 0, subject: '안부 인사', body: '%고객명%님, 잘 지내고 계신가요. 쓰시던 제품이 떨어질 때가 되어 안부 인사드립니다.' }],
  },
  {
    key: 'birthday', rev: 1, label: '생일', triggerEvent: 'customer.birthday_approaching', triggerFilters: { days_before: 7 }, allowReentry: true, reentryCooldownDays: 365,
    steps: [
      { channel: 'lms', delayHours: 0, subject: '생일 축하 인사', body: '%고객명%님, 곧 다가오는 생일을 미리 축하드립니다.' },
      { channel: 'sms', delayHours: 168, body: '%고객명%님, 생일을 축하드립니다.' },
    ],
  },
  {
    key: 'points', rev: 1, label: '포인트 소멸', triggerEvent: 'customer.points_expiring',
    triggerFilters: { expiry_mode: 'inactivity', points_min: 1000, inactive_days: 180 }, allowReentry: true, reentryCooldownDays: 90,
    steps: [{ channel: 'lms', delayHours: 0, subject: '포인트 안내', body: '%고객명%님, 보유하신 포인트가 있습니다. 매장과 온라인 몰에서 사용하실 수 있습니다.' }],
  },
  {
    key: 'cart', rev: 1, label: '장바구니', triggerEvent: 'cdp.cart_abandon', triggerFilters: { abandon_hours: 24 }, allowReentry: true, reentryCooldownDays: 7,
    steps: [
      { channel: 'lms', delayHours: 0, subject: '장바구니 안내', body: '%고객명%님, 장바구니에 담아 두신 상품이 있습니다. 온라인 몰에서 확인해 보세요.' },
      { channel: 'sms', delayHours: 24, body: '%고객명%님, 장바구니를 확인해 보세요.' },
    ],
  },
  {
    key: 'browse', rev: 1, label: '조회 후 미구매', triggerEvent: 'cdp.browse_no_purchase', triggerFilters: {}, allowReentry: true, reentryCooldownDays: 7,
    steps: [{ channel: 'lms', delayHours: 0, subject: '상품 안내', body: '%고객명%님, 보고 가신 상품이 마음에 드셨다면 온라인 몰에서 다시 확인해 보세요.' }],
  },
];

/** 만들 수 있는 시작 종류 가운데 세트에서 뺀 것 → 뺀 이유(계약 시험이 등록부 전부를 「넣음」 또는 여기와 대조한다) */
export const SELFCHECK_SET_EXCLUDED: Readonly<Record<string, string>> = {
  'customer.grade_changed': '등급 순서를 등록할 화면이 없어 켜기 관문이 막는다(합성 회사 설계서 §9)',
  'custom_order_shipped': '합성 데이터가 배송 사건을 보내지 않는다',
  'cdp.reservation_created': '예약 연동이 없어 모든 회사에서 잠겨 있다',
  'custom': '고른 고객에게 · 날짜 예약 · 한 번 보내기 = 매일 돌지 않거나 대상 조건을 따로 정해야 한다',
};

/** 여정마다 한 회차 최대 인원(넘는 회차 = 그 여정이 스스로 멈춘다) */
export const SET_CAP = 200;
/** 세트 행 하나 · 판 하나에 검증 시도 상한(유료 검사 등록 ≤ 이 값 × 문자 칸 수) */
export const MAX_VALIDATIONS = 5;
/** 검사 중 · 확인 중 · 검증하는 사이 판 바뀜 = 다음 시도까지 */
export const RETRY_SOON_MINUTES = 30;
const NAME_PREFIX = '자동 점검 · ';

/** (순수) 여정 이름 — 판이 2 이상이면 끝에 (판 N)(옛 판의 안 이어진 초안과 화면에서 가려지게) */
export function setJourneyName(def: Pick<SetDef, 'label' | 'rev'>): string {
  return `${NAME_PREFIX}${def.label}${def.rev > 1 ? ` (판 ${def.rev})` : ''}`;
}

/** (순수) 세트 정의 지문 — 여정의 모양을 정하는 값 전부(판 번호 · 이름 제외). 계약 시험이 판 번호와 함께 고정한다. */
export function setDefFingerprint(def: SetDef): string {
  const shape = [
    def.triggerEvent, JSON.stringify(Object.entries(def.triggerFilters).sort(([a], [b]) => (a < b ? -1 : 1))), def.allowReentry, def.reentryCooldownDays,
    def.steps.map((s) => [s.channel, s.delayHours, s.subject ?? null, s.body]),
  ];
  return crypto.createHash('sha1').update(JSON.stringify(shape)).digest('hex').slice(0, 10);
}

/** (순수) 스위치 ENV 에 적힌 회사 — 비면 0곳(꺼짐) */
export function setCompanyIds(env: Record<string, string | undefined> = process.env): Set<string> {
  return uuidListOf(env.JOURNEY_SELFCHECK_SET_COMPANY_IDS);
}

/** (순수) 때 = 09:00 ~ 18:00 KST(검사 · 첫 발송이 낮에 일어나게) */
export function inSetWindow(now: Date): boolean {
  const h = new Date(now.getTime() + 9 * 3600_000).getUTCHours();
  return h >= 9 && h < 18;
}

/** 글 · 칸 문제 = 기다려도 안 풀린다(판을 올려야 한다) */
const COPY_REASONS = new Set(['spam_filter_failed', 'copy_issue', 'placeholder_unedited', 'subject_missing', 'variable_mapping_invalid', 'alimtalk_template_unusable']);

/**
 * (순수) 검증 결과 → 다음 시도.
 *   passed = 표식을 찍었다(켜기로) · soon = 검사 중 · 확인 중 · 검증하는 사이 판이 바뀜(30분 뒤) ·
 *   tomorrow = 검사 장애 · 모르는 사유(시도 잡기가 써 둔 하루 뒤 그대로) · never = 글 · 칸 문제 · 문자 칸 없음(판 올림으로만 풀린다)
 */
export function classifyValidation(m: PretestMark): 'passed' | 'soon' | 'tomorrow' | 'never' {
  if (m.result.ok) return m.marked ? 'passed' : 'soon';
  const reasons = m.result.failedSteps.map((f) => String(f.reason));
  if (reasons.length === 0 || reasons.some((r) => COPY_REASONS.has(r))) return 'never';
  return reasons.every((r) => r === 'spam_check_pending') ? 'soon' : 'tomorrow';
}

// ───── 원장 문장 ─────

const ENSURE_SQL =
  `INSERT INTO journey_selfcheck_set (company_id, set_key, def_rev) VALUES ($1::uuid, $2, $3::int)
   ON CONFLICT (company_id, set_key) DO NOTHING`;
const READ_SQL =
  `SELECT journey_id, def_rev, validations, last_reason,
          (next_validate_at IS NULL OR next_validate_at <= NOW()) AS due
     FROM journey_selfcheck_set WHERE company_id = $1::uuid AND set_key = $2`;
/**
 * 판 올림 — 원장 한 문장. 이어진 여정이 없거나 보관하지 않은 초안일 때만 연결을 끊고 새 판 · 횟수 0 으로.
 *   켜짐 · 멈춤 · 끝 · 보관 · 사람이 지운 여정이 이어져 있으면 0행(원장도 여정도 그대로 · 켠 적 있는 여정의 글은 워커가 바꾸지 않는다).
 *   옛 초안은 지우지 않는다(안 이어진 초안으로 남는다 · 설계 Codex 2R #1).
 */
export const RAISE_REV_SQL =
  `UPDATE journey_selfcheck_set s
      SET journey_id = NULL, def_rev = $3::int, validations = 0, next_validate_at = NULL, last_reason = NULL, updated_at = NOW()
    WHERE s.company_id = $1::uuid AND s.set_key = $2 AND s.def_rev < $3::int
      AND (s.journey_id IS NULL OR EXISTS (SELECT 1 FROM journeys j WHERE j.id = s.journey_id AND j.status = 'draft' AND j.archived_at IS NULL))
   RETURNING s.def_rev`;
/**
 * 만들기 시도 잡기 — 만들기는 돈이 들지 않지만 만든 뒤 실패(칸 알림 끄기 등)가 되풀이되면 안 이어진 초안이 tick 마다 쌓인다.
 *   시도를 시작하는 문장이 다음 시도 시각(하루 뒤)을 먼저 쓴다 = 실패해도 그 행은 하루에 한 번만 만든다. 성공하면 잇는 문장이 시각을 비운다.
 */
export const CLAIM_CREATE_SQL =
  `UPDATE journey_selfcheck_set
      SET next_validate_at = NOW() + INTERVAL '1 day', updated_at = NOW()
    WHERE company_id = $1::uuid AND set_key = $2 AND journey_id IS NULL AND def_rev = $3::int
      AND (next_validate_at IS NULL OR next_validate_at <= NOW())
   RETURNING def_rev`;
/** 잇기 — 여정이 아직 없고 원장 판이 **그 여정을 만든 정의의 판**과 같을 때만(설계 Codex 3R · 옛 판 글로 만든 초안이 새 판 원장에 이어지지 않는다) */
export const LINK_SQL =
  `UPDATE journey_selfcheck_set
      SET journey_id = $3::uuid, next_validate_at = NULL, last_reason = NULL, updated_at = NOW()
    WHERE company_id = $1::uuid AND set_key = $2 AND journey_id IS NULL AND def_rev = $4::int
   RETURNING journey_id`;
/**
 * 검증 시도 잡기 — 횟수(+1 · 상한 미만일 때만)와 다음 시도 시각(하루 뒤)을 시도 시작이 함께 쓴다. 이 문장이 행을 돌려줄 때만 검증한다.
 *   검사 중 · 확인 중이면 끝난 뒤 30분 뒤로 당긴다(그 쓰기가 실패하면 하루 뒤로 남는다 = 덜 쓰는 쪽).
 */
export const CLAIM_VALIDATION_SQL =
  `UPDATE journey_selfcheck_set
      SET validations = validations + 1, next_validate_at = NOW() + INTERVAL '1 day', updated_at = NOW()
    WHERE company_id = $1::uuid AND set_key = $2 AND journey_id = $3::uuid AND def_rev = $4::int AND validations < $5::int
      AND (next_validate_at IS NULL OR next_validate_at <= NOW())
   RETURNING validations`;
const RETRY_SOON_SQL =
  `UPDATE journey_selfcheck_set SET next_validate_at = NOW() + ($4::int * INTERVAL '1 minute'), last_reason = $5, updated_at = NOW()
    WHERE company_id = $1::uuid AND set_key = $2 AND journey_id = $3::uuid`;
const RETRY_NEVER_SQL =
  `UPDATE journey_selfcheck_set SET next_validate_at = 'infinity', last_reason = $4, updated_at = NOW()
    WHERE company_id = $1::uuid AND set_key = $2 AND journey_id = $3::uuid`;
const REASON_SQL =
  `UPDATE journey_selfcheck_set SET last_reason = $3, updated_at = NOW()
    WHERE company_id = $1::uuid AND set_key = $2 AND last_reason IS DISTINCT FROM $3`;
/** 켜기 직전 원장 행 잠금 — 판 올림(같은 행을 쓰는 UPDATE)이 켜기가 끝날 때까지 기다린다 */
export const LOCK_ROW_SQL =
  `SELECT journey_id, def_rev FROM journey_selfcheck_set WHERE company_id = $1::uuid AND set_key = $2 FOR UPDATE`;

interface LedgerRow { journeyId: string | null; defRev: number; validations: number; due: boolean; lastReason: string | null }

async function readLedger(companyId: string, key: string): Promise<LedgerRow | null> {
  const r = (await query(READ_SQL, [companyId, key])).rows[0];
  if (!r) return null;
  return { journeyId: r.journey_id ? String(r.journey_id) : null, defRev: Number(r.def_rev), validations: Number(r.validations), due: r.due === true, lastReason: r.last_reason ?? null };
}

async function noteReason(companyId: string, def: SetDef, reason: string | null): Promise<void> {
  const r = await query(REASON_SQL, [companyId, def.key, reason]);
  if ((r.rowCount ?? 0) > 0 && reason) console.log(`[journey-set] company=${companyId.slice(0, 8)} ${def.key}: ${reason}`);
}

function alertOnce(companyId: string, def: SetDef, kind: 'blocked' | 'exhausted', text: string): void {
  void sendSystemAlert({
    companyId: null, dedupKey: `journey-set-${kind}:${companyId}:${def.key}:${def.rev}`, cooldownMs: 7 * 24 * 60 * 60 * 1000,
    message: `여정 세트(합성 회사 ${companyId.slice(0, 8)}) 「${setJourneyName(def)}」: ${text}`,
  }).catch(() => undefined);
}

// ───── 한 행 진행 ─────

export interface SetContext {
  /** 만든 계정 · 켜는 계정(그 회사의 활성 · 시스템 아닌 관리자 중 번호가 유효한 첫 계정 = 담당자 알림을 받는 계정과 같은 판정) */
  actor: string;
  /** 보내는 번호(기본 번호가 있거나 번호가 하나뿐일 때 · 없으면 만들지 않는다) */
  callback: string | null;
  /** 실 PG 시험이 스팸 결과를 넣는 자리(안 주면 검증기의 기본 = 검사를 걸고 기다림) */
  spam?: (p: StepSpamParams) => Promise<StepSpamTestResult | null>;
}

/**
 * 여정을 다 만든다(만들기 → 문자 칸마다 담당자 알림 끔).
 *   돌려주는 것 = 다 만든 여정 id 또는 어긋난 사유(잇지 않는다). 만들기 함수가 던지는 입력 오류는 부르는 쪽이 받는다.
 */
async function createSetJourney(companyId: string, def: SetDef, ctx: SetContext): Promise<{ journeyId: string } | { why: string }> {
  const { journeyId } = await createJourneyFromTemplate({
    companyId,
    createdBy: ctx.actor,
    templateCode: (getTriggerContract(def.triggerEvent)?.templateCode ?? 'custom') as JourneyTemplateCode,
    name: setJourneyName(def),
    callbackNumber: ctx.callback as string,
    callbackMode: 'fixed',
    steps: def.steps.map((s, i) => ({
      stepOrder: i + 1, stepType: 'message' as const, delayHours: s.delayHours, channel: s.channel, messageTemplate: s.body, subject: s.subject, isAd: true,
    })),
    triggerEvent: def.triggerEvent,
    triggerFilters: def.triggerFilters,
    allowReentry: def.allowReentry,
    reentryCooldownDays: def.reentryCooldownDays,
  });
  const steps = await query(
    `SELECT id FROM journey_steps WHERE journey_id = $1::uuid AND COALESCE(step_type, 'message') = 'message' ORDER BY step_order`,
    [journeyId],
  );
  // 칸 알림 기본값이면 보내기 전 안내 · 보낸 결과 안내가 만든 계정의 실제 휴대폰으로 간다(owner-contact) → 끄고 나서야 잇는다
  for (const s of steps.rows) {
    const ok = await updateJourneyStep(companyId, journeyId, String(s.id), { notifyManagerOnPretest: false });
    if (!ok) return { why: `칸 알림을 끄지 못했다 journey=${journeyId} step=${s.id}` };
  }
  return { journeyId };
}

/**
 * 세트 행 하나를 갈 수 있는 데까지 진행한다(만들기 → 검증 → 켜기).
 *   돌려주는 것 = 'worked'(만들었거나 · 검증을 시도했거나 · 켰다 = 이번 tick 의 일) · 'idle'(기다림 · 거절 · 할 일 없음 = 다음 행으로).
 *   거절만 되풀이하는 행이 뒤 행을 굶기지 않게, 읽기뿐인 거절은 일로 치지 않는다.
 */
export async function advanceSetRow(companyId: string, def: SetDef, ctx: SetContext): Promise<'worked' | 'idle'> {
  await query(ENSURE_SQL, [companyId, def.key, def.rev]);
  let row = await readLedger(companyId, def.key);
  if (!row) return 'idle';
  // 원장 판 > 이 코드의 판 = 옛 코드가 돈다(되돌린 배포) → 그 행 전체를 쉰다(새 판 코드가 만든 것을 옛 판 코드가 건드리지 않는다)
  if (row.defRev > def.rev) return 'idle';
  if (row.defRev < def.rev) {
    // 원장 행을 잠근 뒤에 낸다(켜기와 직렬 · 켜기가 끝난 뒤의 여정 상태로 판정한다)
    const raised = await withRowLock(companyId, def.key, async (client) => (await client.query(RAISE_REV_SQL, [companyId, def.key, def.rev])).rowCount ?? 0);
    if (raised === 0) return 'idle';   // 켠 적 있는 여정 · 사람이 지운 여정이 이어져 있다 = 그대로
    console.log(`[journey-set] company=${companyId.slice(0, 8)} ${def.key} 판 ${row.defRev} → ${def.rev}(옛 초안은 안 이어진 채 남는다)`);
    row = await readLedger(companyId, def.key);
    if (!row || row.defRev !== def.rev) return 'idle';
  }

  let worked = false;
  let journeyId = row.journeyId;
  if (!journeyId) {
    if (!ctx.callback) { await noteReason(companyId, def, '보내는 번호를 정하지 못했다(기본 번호가 없고 번호가 여럿이거나 없다)'); return 'idle'; }
    const claimed = await query(CLAIM_CREATE_SQL, [companyId, def.key, def.rev]);
    if ((claimed.rowCount ?? 0) === 0) return 'idle';   // 오늘 이미 만들다 실패했다(하루 뒤 다시)
    worked = true;
    let made: { journeyId: string } | { why: string };
    try {
      made = await createSetJourney(companyId, def, ctx);
    } catch (err: any) {
      made = { why: String(err?.message || err) };
    }
    if ('why' in made) {
      await noteReason(companyId, def, `만들지 못했다: ${made.why.slice(0, 200)}`);
      return 'worked';
    }
    const linked = await query(LINK_SQL, [companyId, def.key, made.journeyId, def.rev]);
    if ((linked.rowCount ?? 0) === 0) {
      console.log(`[journey-set] company=${companyId.slice(0, 8)} ${def.key} 만든 초안 ${made.journeyId} 을 잇지 못했다(그사이 원장이 바뀌었다 · 안 이어진 채 둔다)`);
      return 'worked';
    }
    journeyId = made.journeyId;
  }

  const j = (await query(
    `SELECT status, archived_at, last_pretest_passed_at FROM journeys WHERE id = $1::uuid AND company_id = $2::uuid`,
    [journeyId, companyId],
  )).rows[0];
  // 사람이 지움 · 켜짐 · 멈춤 · 끝 · 보관 = 아무것도 안 한다(다시 켜지 않는다 · 다시 만들지 않는다)
  if (!j || j.archived_at || String(j.status) !== 'draft') return worked ? 'worked' : 'idle';

  if (!j.last_pretest_passed_at) {
    const claim = await query(CLAIM_VALIDATION_SQL, [companyId, def.key, journeyId, def.rev, MAX_VALIDATIONS]);
    if ((claim.rowCount ?? 0) === 0) {
      const cur = await readLedger(companyId, def.key);
      if (cur && cur.journeyId === journeyId && cur.validations >= MAX_VALIDATIONS) {
        alertOnce(companyId, def, 'exhausted', `검증을 ${MAX_VALIDATIONS}번 시도했지만 켜지 못했습니다. 마지막 사유: ${cur.lastReason || '없음'}. 글을 고치고 판 번호를 올리면 다시 시도합니다.`);
      }
      return worked ? 'worked' : 'idle';
    }
    worked = true;
    const mark = await pretestAndMark(companyId, journeyId, ctx.actor, ctx.spam ? { spam: ctx.spam } : {});
    const next = classifyValidation(mark);
    if (next !== 'passed') {
      const why = mark.result.ok
        ? '검증하는 사이에 여정이 바뀌었다'
        : (mark.result.failedSteps.map((f) => `${f.reason}: ${f.details}`).join(' / ') || '문자 칸이 없다').slice(0, 300);
      if (next === 'soon') await query(RETRY_SOON_SQL, [companyId, def.key, journeyId, RETRY_SOON_MINUTES, why]);
      else if (next === 'never') {
        await query(RETRY_NEVER_SQL, [companyId, def.key, journeyId, why]);
        alertOnce(companyId, def, 'blocked', `발송 전 검증에 걸렸습니다(${why}). 글을 고치고 판 번호를 올려 배포해야 다시 시도합니다.`);
      } else await noteReason(companyId, def, why);
      console.log(`[journey-set] company=${companyId.slice(0, 8)} ${def.key} 검증 ${claim.rows[0].validations}/${MAX_VALIDATIONS}: ${next} · ${why}`);
      return 'worked';
    }
  }

  return (await activateLinked(companyId, def, journeyId, ctx.actor)) === 'on' || worked ? 'worked' : 'idle';
}

/**
 * 켜기 — 원장 행을 잠근 채(판 올림 RAISE_REV_SQL 과 직렬) 이어진 여정 · 판을 다시 확인하고, 초안일 때만 켠다(Codex 구현 1R).
 *   · 잠금 = 원장 행 FOR UPDATE 를 켜기가 끝날 때까지 쥔다 → 그사이 판 올림은 기다렸다가 「이어진 여정이 초안인가」를 다시 본다(켜졌으면 0행).
 *     잠금 전에 판이 올라 연결이 끊겼으면(검증을 기다리는 사이 새 판 워커가 지나감) 여기서 걸러 옛 여정을 켜지 않는다.
 *   · 초안일 때만 = draftOnly 를 켜는 트랜잭션이 잠근 여정 행의 상태로 판정한다(읽은 뒤 사람이 켰다 멈춘 여정을 다시 켜지 않는다).
 *   · [모두 켜기]와 같은 함수(겹침 확인 · 크레딧 합계 · 관문 전부) · 겹침 쌍은 「같이 받기」로 · 최대 인원 200.
 *   · 사유 기록은 잠금을 쥔 이 연결로 쓴다(다른 연결로 같은 행을 쓰면 자기 잠금을 기다린다).
 *   읽기뿐인 거절('refused')은 부르는 쪽이 일로 치지 않는다(뒤 행이 굶지 않게).
 */
async function activateLinked(companyId: string, def: SetDef, journeyId: string, actor: string): Promise<'on' | 'refused' | 'stale'> {
  const tag = companyId.slice(0, 8);
  return withRowLock(companyId, def.key, async (client, cur) => {
    if (!cur || cur.journeyId !== journeyId || cur.defRev !== def.rev) {
      console.log(`[journey-set] company=${tag} ${def.key} 켜기 직전 원장이 바뀌어 있다(이어진 여정 · 판이 다르다) · 켜지 않는다 journey=${journeyId}`);
      return 'stale';
    }
    const pairs = await unresolvedOverlapPairs(companyId, [journeyId], []);
    const act = await activateJourneysInOrder(companyId, actor, [journeyId], {
      acknowledgedOverlaps: pairs, caps: new Map([[journeyId, SET_CAP]]), draftOnly: true,
    });
    const item = act.ok ? act.items.find((x) => x.journeyId === journeyId) : null;
    const done = item && item.result.ok ? item.result : null;
    const refusal = done ? null : !act.ok ? act.message : item ? (item.result as { message: string }).message : '켜기 결과가 없다';
    const reason = refusal === null ? null : `켜지 못했다: ${String(refusal).slice(0, 200)}`;
    const wrote = await client.query(REASON_SQL, [companyId, def.key, reason]);
    if (done) console.log(`[journey-set] company=${tag} ${def.key} 켰다 journey=${journeyId} 크레딧 ${done.charged}`);
    else if ((wrote.rowCount ?? 0) > 0) console.log(`[journey-set] company=${tag} ${def.key}: ${reason}`);
    return done ? 'on' : 'refused';
  });
}

/**
 * 원장 행 하나를 잠근 채 일한다(BEGIN → 행 FOR UPDATE → work → COMMIT). 판 올림과 켜기가 이 잠금으로 직렬이 된다.
 *   work 안의 문장은 잠금을 얻은 **뒤에** 시작하므로 그 시점에 커밋된 값(켜진 여정)을 본다 —
 *   판 올림을 잠금 없이 한 문장으로 내면, 기다리다 풀린 문장이 「여정이 초안인가」를 기다리기 전 시점의 값으로 읽는다(READ COMMITTED 의 다시 보기는 잠근 행만 새로 읽는다).
 *   work 가 같은 원장 행에 쓰려면 넘겨받은 client 로 쓴다(다른 연결로 쓰면 자기 잠금을 기다린다).
 */
async function withRowLock<T>(
  companyId: string, key: string,
  work: (client: PoolClient, cur: { journeyId: string | null; defRev: number } | null) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = (await client.query(LOCK_ROW_SQL, [companyId, key])).rows[0];
    const out = await work(client, r ? { journeyId: r.journey_id ? String(r.journey_id) : null, defRev: Number(r.def_rev) } : null);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ───── 하루 한 줄 ─────

export interface SetSummary {
  total: number;
  active: number; draft: number; paused: number; ended: number; archived: number;
  /** 사람이 지운 여정(원장은 가리키는데 여정 행이 없다) */
  deleted: number;
  /** 아직 여정이 없다 */
  missing: number;
  /** 검증 횟수를 다 쓴 초안 */
  exhausted: number;
  /** 원장에 안 이어진 세트 이름의 초안(만들다 죽었거나 옛 판) */
  unlinkedDrafts: number;
  reasons: string[];
}

export async function summarizeSet(companyId: string, defs: readonly SetDef[] = SELFCHECK_SET): Promise<SetSummary> {
  const r = await query(
    `SELECT s.set_key, s.journey_id, s.validations, s.last_reason, j.id AS jid, j.status, j.archived_at
       FROM journey_selfcheck_set s LEFT JOIN journeys j ON j.id = s.journey_id AND j.company_id = s.company_id
      WHERE s.company_id = $1::uuid AND s.set_key = ANY($2::text[])`,
    [companyId, defs.map((d) => d.key)],
  );
  const out: SetSummary = { total: defs.length, active: 0, draft: 0, paused: 0, ended: 0, archived: 0, deleted: 0, missing: 0, exhausted: 0, unlinkedDrafts: 0, reasons: [] };
  const byKey = new Map<string, any>(r.rows.map((x: any) => [String(x.set_key), x]));
  for (const d of defs) {
    const x = byKey.get(d.key);
    if (!x || !x.journey_id) out.missing++;
    else if (!x.jid) out.deleted++;
    else if (x.archived_at) out.archived++;
    else if (x.status === 'active') out.active++;
    else if (x.status === 'paused') out.paused++;
    else if (x.status === 'ended') out.ended++;
    else {
      out.draft++;
      if (Number(x.validations) >= MAX_VALIDATIONS) out.exhausted++;
    }
    // 켜진 여정의 사유는 싣지 않는다(켠 직후 사유를 비우기 전에 죽으면 옛 사유가 남는다 = 줄에 낡은 사유가 뜨지 않게)
    const on = !!x?.jid && !x.archived_at && x.status === 'active';
    if (x?.last_reason && !on) out.reasons.push(`${d.key}=${String(x.last_reason).slice(0, 80)}`);
  }
  const u = await query(
    `SELECT COUNT(*)::int AS n FROM journeys j
      WHERE j.company_id = $1::uuid AND j.status = 'draft' AND j.archived_at IS NULL AND LEFT(j.name, ${NAME_PREFIX.length}) = $2
        AND NOT EXISTS (SELECT 1 FROM journey_selfcheck_set s WHERE s.company_id = j.company_id AND s.journey_id = j.id)`,
    [companyId, NAME_PREFIX],
  );
  out.unlinkedDrafts = Number(u.rows[0]?.n || 0);
  return out;
}

// ───── 합성 데이터 워커가 부르는 tick ─────

/** 회사마다 마지막으로 하루 줄을 찍은 날 · 원장 표 없음을 알린 날(재기동하면 한 번 더 = 로그뿐) */
const lastLineDay = new Map<string, string>();
const lastNoteDay = new Map<string, string>();
/** 시험 전용. */
export function resetJourneySetState(): void { lastLineDay.clear(); lastNoteDay.clear(); }

function oncePerDay(map: Map<string, string>, key: string, day: string): boolean {
  if (map.get(key) === day) return false;
  map.set(key, day);
  return true;
}

/** 한 회사 — 일이 남은 첫 행 하나를 진행한다(한 tick 에 행 하나 = 검사 폰과 tick 을 오래 잡지 않는다). */
export async function runSetCompany(
  companyId: string, now: Date = new Date(),
  opts: { defs?: readonly SetDef[]; spam?: SetContext['spam'] } = {},
): Promise<'worked' | 'idle' | 'no_actor'> {
  const defs = opts.defs ?? SELFCHECK_SET;
  const contact = await pickOwnerContact(companyId, null);
  if (!contact) return 'no_actor';
  const ctx: SetContext = { actor: contact.userId, callback: defaultCallbackOf(await listJourneyCallbackNumbers(companyId)), spam: opts.spam };
  for (const def of defs) {
    if ((await advanceSetRow(companyId, def, ctx)) === 'worked') return 'worked';
  }
  return 'idle';
}

/**
 * 합성 회사 가운데 스위치 ENV 에 적힌 회사만 · 낮(09 ~ 18시)에만 · 회사마다 행 하나.
 *   한 회사의 오류는 그 회사의 이번 tick 만 멈춘다. 원장 표가 없으면(C134-DDL-2 전) 쉰다.
 */
export async function journeySetTick(
  realismCompanyIds: readonly string[], now: Date = new Date(),
  /** 실 PG 시험 자리(운영은 주지 않는다 = 진짜 세트 · 검증기의 기본 스팸 검사) */
  opts: { defs?: readonly SetDef[]; spam?: SetContext['spam'] } = {},
): Promise<void> {
  const allow = setCompanyIds();
  if (allow.size === 0 || !inSetWindow(now)) return;
  const today = new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  for (const companyId of realismCompanyIds.map((x) => String(x).toLowerCase()).filter((x) => allow.has(x))) {
    const tag = companyId.slice(0, 8);
    try {
      const did = await runSetCompany(companyId, now, opts);
      if (did === 'no_actor' && oncePerDay(lastNoteDay, companyId, today)) {
        console.log(`[journey-set] company=${tag} 만들 계정이 없다(활성 관리자 가운데 휴대폰 번호가 유효한 계정) · 쉰다`);
      }
      if (oncePerDay(lastLineDay, companyId, today)) {
        const s = await summarizeSet(companyId, opts.defs ?? SELFCHECK_SET);
        console.log(
          `[journey-set] ${today} company=${tag} 세트 ${s.total} · 켜짐 ${s.active} · 초안 ${s.draft}(검증 횟수 다 씀 ${s.exhausted}) · 멈춤 ${s.paused} · 끝 ${s.ended} · 보관 ${s.archived}` +
          ` · 사람이 지움 ${s.deleted} · 아직 없음 ${s.missing} · 안 이어진 초안 ${s.unlinkedDrafts}${s.reasons.length ? ` · 사유: ${s.reasons.join(' ; ')}` : ''}`,
        );
      }
    } catch (err: any) {
      if (err?.code === '42P01') {
        if (oncePerDay(lastNoteDay, companyId, today)) console.log(`[journey-set] company=${tag} 원장 표 없음(C134-DDL-2) · 쉰다`);
      } else {
        console.error(`[journey-set] company=${tag} 실패(다음 tick 에 다시):`, err?.message || err);
      }
    }
  }
}
