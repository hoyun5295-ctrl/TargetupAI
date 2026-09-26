/**
 * CT: 여정 발송 '적재 중' 표식 판정 — ★ 2026-09-26 한줄로 V2 m105 (Codex 1R ④ · 2R ③④⑤ · 3R ②③④⑤ · 4R ①②)
 *
 * 여정 실행기는 [차감 → step_log 'sending'(적재 중 표식) → 큐 적재 → 'sent' 확정] 순서로 보낸다.
 * 적재 결과가 불확정(응답 유실 · 중단 · 확정 실패)이면 표식은 'sending'으로 남고, 그 시도가 큐에 들어갔는지는 여기서 판정한다.
 * 판정 규칙이 두 곳(다음 실행의 가드 · 재시도 소진 분기)에서 갈리지 않게 이 한 곳에 둔다.
 *
 * ★ 4R 구조 정정 — **추정하지 않고 증명될 때만 판정한다.**
 *   MySQL 행에는 시도 식별자가 없다(app_etc1 = 하루 단계 캠페인을 여러 실행이 공유 · 29컬럼에 남는 칸 없음: bill_id = 사용자·발신자 ·
 *   sender_code = 중계 에이전트 사용). 2R(표식 시각 창)·3R(장부 건수 + 지금 번호)의 추정은 조회 대기 · 번호 변경 · 라이브·이력 이동 중복에서 샜다.
 *   그래서 부풀 수만 있는 상한과 모자랄 수만 있는 하한으로 **증명되는 쪽만** 판정하고, 증명되지 않으면 보류한다.
 *   보류가 1시간을 넘으면 다시 보내지 않고 닫는다(★ 0926 Harold 결정 — 두 번 보내는 일은 없게 · 그 1건 요금은 정산이 미적재로 돌려준다).
 *
 * 확정은 표식 'sent'와 단계 캠페인 발송 수 +1을 **한 문장**으로 한다. 발송 수는 정산 스위퍼가 여정의 적재 수로 읽는다 —
 * 확정만 되고 발송 수가 빠지면 보낸 1건을 미적재로 환불하고, 발송 수만 오르면 적재 실패분을 환불하지 않는다.
 */
import { query } from '../config/database';
import { getCampaignSmsTablesWide, smsCountAll, smsCampaignCountsSafe, smsMsgTypeScopeSql } from './sms-queue';
/** 증명을 기다리는 상한 — 넘으면 다시 보내지 않고 닫는다(★ 0926 Harold 결정) */
export const CLAIM_PROOF_LIMIT_SEC = 60 * 60;

export interface JourneyClaimOwner {
  company_id: string;
  created_by?: string | null;
  customer_id: string;
}

export type ClaimLoadVerdict = 'loaded' | 'not_loaded' | 'unprovable';

/**
 * 표식이 가리키는 시도가 큐에 들어갔는가 — 하루 단계 캠페인 전체 장부로 **증명되는 쪽만** 답한다.
 *   확정('sent') 발송 하나는 원 행 하나를 가진다(적재 성공 뒤에만 확정). 미확정('sending') 표식에는 이 표식 자신이 들어 있다.
 *   증명 못 해 닫은 표식('failed' · load_unprovable)은 원 행을 가졌을 수도 없을 수도 있다(★ 5R ②).
 *   · 상한(원 행을 라이브 + 이력 그대로 합산 · 옮기는 순간 중복은 있어도 누락은 없다) − 확정 ≤ 0
 *       → 미확정·닫힌 표식 어느 것도 안 들어갔다 = **not_loaded**(다시 보내도 두 번이 아니다)
 *   · 하한(원 행만 안전 집계 한 번 · 이력 먼저 라이브 나중 · 중복 없음 · 통신사 결과를 기다리는 행은 빠질 수 있다)
 *       − 확정 − 닫힌 표식 ≥ 미확정 표식 수 → 닫힌 표식이 전부 원 행을 가졌다 쳐도 미확정 표식 전부 들어갔다 = **loaded**
 *       (★ 5R ③ 전체 − 대체 행을 두 번 조회해 빼면 사이에 옮겨진 행 때문에 하한이 부푼다 → 원 행 범위 한 번으로 센다)
 *   · 그 밖 = **unprovable**(보류) — 번호·시각으로 가리지 않는다.
 * 테이블 = 그 캠페인의 발송 기록 테이블 ∪ 회사 전 라인, 각각 캠페인 날짜 기준월 전후 이력(getCampaignSmsTablesWide).
 * PG 장부를 MySQL보다 **먼저** 읽는다 — 사이에 끼어든 적재·확정은 상한·하한을 모두 키우는 쪽이라 "안 들어갔다"를 거짓으로 만들지 못한다.
 * 캠페인 id가 없으면 적재 전에 멈춘 것이다(not_loaded). 캠페인 행·테이블이 없거나 조회가 실패하면 던진다.
 */
export async function attributeClaimLoad(owner: JourneyClaimOwner, campaignId: string | null): Promise<ClaimLoadVerdict> {
  if (!campaignId) return 'not_loaded';
  const camp = await query(
    `SELECT created_by, send_config, sent_at, scheduled_at, created_at FROM campaigns WHERE id = $1::uuid`,
    [campaignId],
  );
  if (!camp.rows[0]) throw new Error('단계 캠페인을 찾지 못해 적재 여부를 확인할 수 없다');
  const tables = await getCampaignSmsTablesWide(owner.company_id, camp.rows[0]);
  if (tables.length === 0) throw new Error('발송 테이블을 찾지 못해 적재 여부를 확인할 수 없다');

  const ledger = await query(
    `SELECT COUNT(*) FILTER (WHERE status = 'sent')::int AS confirmed,
            COUNT(*) FILTER (WHERE status = 'sending')::int AS unresolved,
            COUNT(*) FILTER (WHERE status = 'failed' AND error_reason = 'load_unprovable')::int AS closed
       FROM journey_step_logs WHERE campaign_id = $1::uuid`,
    [campaignId],
  );
  const confirmed = Number(ledger.rows[0]?.confirmed || 0);
  const unresolved = Math.max(1, Number(ledger.rows[0]?.unresolved || 0));   // 이 표식 자신은 늘 미확정이다
  const closed = Number(ledger.rows[0]?.closed || 0);

  const upper = await smsCountAll(tables, `app_etc1 = ? AND ${smsMsgTypeScopeSql('primary')}`, [campaignId]);
  if (upper - confirmed <= 0) return 'not_loaded';

  const safe = (await smsCampaignCountsSafe(tables, [campaignId], 'app_etc1', 'primary')).get(campaignId);
  const lower = Number(safe?.total || 0);
  if (lower - confirmed - closed >= unresolved) return 'loaded';
  return 'unprovable';
}

/**
 * 표식 'sending' → 'sent' 확정 + 단계 캠페인 발송 수 +1(bumpStepCampaignCount와 같은 증가) — 한 문장이라 둘 중 하나만 남지 않는다.
 * 표식이 이미 'sending'이 아니면 아무것도 바꾸지 않고 false. DB 오류는 던진다(★ 2R ⑤ — 삼키지 않는다).
 */
export async function confirmJourneyClaimSent(claimId: string): Promise<boolean> {
  const r = await query(
    `WITH confirmed AS (
       UPDATE journey_step_logs SET status = 'sent' WHERE id = $1::uuid AND status = 'sending' RETURNING campaign_id
     )
     UPDATE campaigns SET target_count = target_count + 1, sent_count = sent_count + 1, updated_at = NOW()
      WHERE id = (SELECT campaign_id FROM confirmed)`,
    [claimId],
  );
  return r.rowCount === 1;
}

/**
 * 'sending' 표식 하나를 판정한다.
 *   sent    = 들어갔다 → 확정(+발송 수). cost = 표식의 발송 비용(실행 통계에 더할 몫 · 다른 쪽이 먼저 확정했으면 0) ·
 *             sentAt = 표식 시각(운영 크레딧 멱등키의 날짜 = 원 발송일 · 3R ⑤)
 *   cleared = 안 들어갔다 → 표식을 지운다(다시 보내도 된다 · 차감분은 정산 스위퍼가 미적재로 돌려준다)
 *   held    = 증명 안 됨 · 표식 나이 1시간 전 → 아무것도 바꾸지 않는다(호출부가 나중에 다시 본다)
 *   closed  = 증명 안 됨 · 1시간 넘음(또는 closeNow) → 다시 보내지 않고 닫는다: 실패 · 비용 0 · 발송 수 안 올림
 *             (그 1건 차감은 정산이 미적재로 돌려준다 · 호출부가 경보)
 *   gone    = 표식이 이미 없다(다른 쪽이 판정했다)
 * MySQL 조회 실패도 증명 안 됨으로 다룬다(셀 수 없으면 판정할 수 없다). 표식·캠페인 조회(PG) 실패는 던진다.
 */
export async function resolveJourneyClaim(
  owner: JourneyClaimOwner, claimId: string, opts: { closeNow?: boolean } = {},
): Promise<
  | { result: 'sent'; cost: number; sentAt: Date }
  | { result: 'cleared' } | { result: 'held' } | { result: 'closed' } | { result: 'gone' }
> {
  const c = await query(
    `SELECT campaign_id, cost, sent_at, EXTRACT(EPOCH FROM (NOW() - sent_at)) AS age_sec
       FROM journey_step_logs WHERE id = $1::uuid AND status = 'sending'`,
    [claimId],
  );
  const claim = c.rows[0];
  if (!claim) return { result: 'gone' };

  let verdict: ClaimLoadVerdict;
  try {
    verdict = await attributeClaimLoad(owner, claim.campaign_id || null);
  } catch (e: any) {
    console.error(`[journey-send-claim] 적재 판정 조회 실패 표식=${claimId} — 증명 안 됨으로 다룬다:`, e?.message || e);
    verdict = 'unprovable';
  }

  if (verdict === 'loaded') {
    const confirmed = await confirmJourneyClaimSent(claimId);
    return { result: 'sent', cost: confirmed ? Number(claim.cost) || 0 : 0, sentAt: new Date(claim.sent_at) };
  }
  if (verdict === 'not_loaded') {
    await query(`DELETE FROM journey_step_logs WHERE id = $1::uuid AND status = 'sending'`, [claimId]);
    return { result: 'cleared' };
  }
  if (!opts.closeNow && Number(claim.age_sec) < CLAIM_PROOF_LIMIT_SEC) return { result: 'held' };
  await query(
    `UPDATE journey_step_logs SET status = 'failed', error_reason = 'load_unprovable', cost = 0
      WHERE id = $1::uuid AND status = 'sending'`,
    [claimId],
  );
  return { result: 'closed' };
}
