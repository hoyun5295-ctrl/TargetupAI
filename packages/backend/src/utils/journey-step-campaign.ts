/**
 * 여정 묶음 발송 — (journey, step, KST 발송날짜)당 campaign 1건 공유.
 *
 * 목적: 고객 1명당 campaign 1건(500명=500줄 폭주) 폐기 → step+날짜 단위 1건.
 *   발송결과 목록은 step당 1줄, 상세는 기존 app_etc1=campaignId + 전화번호 검색 경로로 N명 표시.
 *   개인화(Liquid·예측·variant·단축URL)는 executor가 고객별 렌더 그대로 — 여기선 "그릇"만 공유.
 *
 * 정산 안전: 여정은 campaign_runs를 만들지 않아 campaign_runs 월정산 경로 밖이고,
 *   발송 시 prepaidDeduct로 즉시 차감된다. 따라서 campaign 공유·app_etc1 변경이 billing에 영향 0.
 */

import { query } from '../config/database';
import { sendSystemAlert } from './system-alert';

export interface StepCampaignSpec {
  companyId: string;
  journeyId: string;
  stepId: string;
  stepOrder: number;
  msgType: string;                 // SMS | LMS | MMS | KAKAO
  representativeMessage: string;   // 대표 본문(목록 표시용 — 실제 본문은 고객별 큐에 렌더됨)
  subject: string | null;
  isAd: boolean;
  createdBy: string | null;
  sendChannel: string;             // 'sms' | 'alimtalk'
  callbackNumber: string;
  kakaoTemplateId: string | null;
  mmsImagePaths: string | null;    // JSON 문자열 또는 null
  /**
   * ★ 2026-11-11 C129(D10) — 원장 꼴(선불 알림톡 칸만 넘긴다 = prepaid resolveKakaoCharge 의 shape · 차감 단가와 결과별 단가 전부).
   *   한 단계 캠페인 = 한 과금 방식 · 한 차감 꼴: 넘겨받은 값(없음 포함)이 오늘 마지막 순번 캠페인의 값(없음 포함)과 다르면 순번 + 1.
   *   정산기는 과금 차감 행 전부가 같은 결과별 단가일 때만 결과별 차액을 돌려주고(deduct-reference resolveAlimtalkLedgerUnits),
   *   월 예산은 꼴 있는 캠페인을 잔액 원장으로 센다(journey-executor JOURNEY_MONTH_COST_SQL) — 섞이면 둘 다 틀린다.
   */
  ledgerShape?: string | null;
}

/** KST 기준 오늘 날짜(YYYY-MM-DD). */
export function kstDateString(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * ★ 2026-09-26 한줄로 V2 F05·F06·F11 — 새 원장 표식.
 * 이 코드부터 여정 차감은 (journey, **단계 캠페인 id**)로 남는다(옛: 여정 id). 정산 스위퍼는 이 표식이 있는
 * 단계 캠페인만 새 원장으로 정산한다 — 배포 당일처럼 오전은 옛 참조·오후는 새 참조로 섞인 캠페인을 정산하면
 * 원장과 결과의 경계가 어긋난다(Codex 1R). 표식 없는 옛 캠페인은 종전 그대로(정산 없음).
 */
export const JOURNEY_LEDGER_CONFIG = { journeyLedger: 'campaign' } as const;

/**
 * (순수) 단계 캠페인의 하루가 끝났는가 — 발송 기준 시각의 KST 날짜가 지금의 KST 날짜보다 앞이면 참.
 * 단계 캠페인은 (여정, 단계, KST 날짜)당 1건이라 그날이 지나면 새 적재·차감이 붙지 않는다.
 * 여정은 적재 → 결과 → 차감 순서라 진행 중인 날에 초과 환불 회수를 걸면 다음 발송의 결과가 차감보다 먼저 잡혀
 * 정상 환불을 빼간다(Codex 1R high). 회수·불변식은 하루가 닫힌 집합에만 건다.
 */
export function isStepCampaignDayClosed(sendBase: Date | string | null | undefined, now: Date = new Date()): boolean {
  if (!sendBase) return false;
  const t = new Date(sendBase).getTime();
  if (!Number.isFinite(t)) return false;
  const kstDay = (ms: number) => new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return kstDay(t) < kstDay(now.getTime());
}

/**
 * `campaigns.message_type` CHECK 제약이 허용하는 값 — 2026-07-27 `pg_constraint` 실측.
 * 이 목록 밖 값을 넣으면 INSERT가 통째로 깨진다(값이 조용히 무시되는 게 아니다).
 */
const CAMPAIGN_MESSAGE_TYPES = new Set(['SMS', 'LMS', 'MMS', 'KMS', 'FMS', 'GMS']);

/**
 * (순수) 발송 유형 → `campaigns.message_type` 저장값.
 *
 * ★ 2026-07-27 여정 알림톡 전건 실패 정정.
 * 여정 실행기가 알림톡 step에서 `'KAKAO'`를 넣어 `campaigns_message_type_check` 위반으로
 * INSERT가 깨졌고, 6건이 5분마다 재시도하며 발송이 하나도 안 나갔다(step_logs 0건).
 *
 * 이 시스템은 **카카오를 `message_type`이 아니라 `send_channel`로 구분**한다 —
 * 운영 실측: 알림톡 102건이 전부 `message_type='LMS'` + `send_channel='alimtalk'`,
 * 브랜드메시지도 `'LMS'` + `'kakao_brand'`. 여정만 다른 축을 쓰고 있었다.
 *
 * 과금·큐·학습 축의 `'KAKAO'`는 그대로 둔다 — 바뀌는 건 campaigns에 저장하는 값 하나뿐이다.
 * 허용값 밖은 `'LMS'`로 안전 변환한다(이미지 불필요한 유형 — `toQtmsgType`의 안전 기본값과 같은 정신).
 */
export function toCampaignMessageType(msgType: string): string {
  const t = String(msgType ?? '').trim().toUpperCase();
  return CAMPAIGN_MESSAGE_TYPES.has(t) ? t : 'LMS';
}

/**
 * (journey, step, 오늘 KST)당 campaign find-or-create. 매핑 테이블 ON CONFLICT로 동시 진입에도 1건만.
 */
/**
 * ★ 2026-11-02 적재 증명 계약(설계서 docs/2026-11-02-journey-batch-send-design.md 3-8 · Codex 설계 7R approve).
 *   I5 새 규약 표식 = 이 표식이 있는 캠페인의 'sending' 표식만 「단위 기록 없음 = 안 들어감」으로 읽는다(옛 표식은 다시 보내지 않는다).
 *   I3 봉인 = 증명 못 해 닫은 단위가 생긴 캠페인 · 새 단위 0 · 그날 그 칸 다음 단위는 이어 붙임(순번 + 1).
 */
export const LOAD_PROTOCOL_UNIT = 'unit';

// ── 순번 칸(C96-DDL-1) · 4열 기본 키(C96-DDL-2) 확인 — 참은 기억 · 거짓은 5분 뒤 다시(journey-lineage 와 같은 규약) ──
const SEQ_RECHECK_MS = 5 * 60 * 1000;
const _seq = { column: false, continuation: false, columnAbsentUntil: 0, continuationAbsentUntil: 0, alertedAt: 0 };

/** 순번 칸이 있는가 · 이어 붙임(순번 > 0)이 열렸는가(기본 키 = 4열 · DDL-2 뒤 · I6). */
export async function stepCampaignSeqState(): Promise<{ seqColumn: boolean; continuation: boolean }> {
  const now = Date.now();
  if (!_seq.column && now >= _seq.columnAbsentUntil) {
    const r = await query(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns WHERE table_name = 'journey_step_campaigns' AND column_name = 'seq'`,
    );
    if (Number(r.rows[0]?.n || 0) === 1) _seq.column = true;
    else {
      _seq.columnAbsentUntil = now + SEQ_RECHECK_MS;
      // 설계서 I6 — 배포 앞 DDL-1 이 빠졌다(발송은 계속 · 순번 칸 없는 같은 대상 없는 문장 · 이어 붙임 0)
      void sendSystemAlert({
        companyId: null, dedupKey: 'journey-step-campaign-seq-missing', cooldownMs: 60 * 60 * 1000,
        message: '여정 단계 캠페인 순번 칸(C96-DDL-1)이 없습니다. 배포 앞 DDL 이 빠졌습니다(발송은 계속 · 같은 날 이어 붙임 0).',
      }).catch(() => undefined);
    }
  }
  if (_seq.column && !_seq.continuation && now >= _seq.continuationAbsentUntil) {
    const r = await query(
      `SELECT COALESCE(array_length(i.indkey::int2[], 1), 0) AS n
         FROM pg_index i WHERE i.indrelid = 'journey_step_campaigns'::regclass AND i.indisprimary`,
    );
    if (Number(r.rows[0]?.n || 0) === 4) _seq.continuation = true;
    else _seq.continuationAbsentUntil = now + SEQ_RECHECK_MS;
  }
  return { seqColumn: _seq.column, continuation: _seq.continuation };
}
/** 시험 전용. */
export function resetStepCampaignSeqCache(): void {
  Object.assign(_seq, { column: false, continuation: false, columnAbsentUntil: 0, continuationAbsentUntil: 0, alertedAt: 0 });
}

export type StepCampaignPick = { campaignId: string; sendDate: string } | { blocked: 'continuation_unavailable' };

/**
 * ★ 2026-11-02 묶음 발송이 쓸 오늘 단계 캠페인(설계서 3-8 · 옛 getOrCreateStepCampaign 자리 · 부르는 곳 = 실행기 묶음 하나).
 *   1. 오늘 (여정 · 칸)의 가장 큰 순번 행을 읽는다.
 *   2. 봉인 안 됨 + 새 규약 표식 = 그대로 쓴다.
 *   3. 봉인 안 됨 + 표식 없음(배포 전에 만든 옛 캠페인) = 미확정 · 증명 못 해 닫은 표식이 0 이면 그 자리에서 표식을 달고 쓴다(I5) · 아니면 이어 붙임.
 *   4. 봉인됨 · 넘겨 쓸 수 없음 = 이어 붙임(순번 + 1) · 이어 붙임이 아직 닫혀 있으면(DDL-2 전) blocked = 그 (여정 · 칸)은 오늘 새 단위 0(I6).
 *   5. 행이 없으면 순번 0 으로 만든다.
 *   만들기 = 캠페인 INSERT → 매핑 INSERT … ON CONFLICT DO NOTHING(대상 없음 = 유일 제약 전부가 중재 · DDL 세 상태 같은 문장 · Codex 설계 5R)
 *     → 졌으면 방금 만든 캠페인 지우고 다시 읽기 · 매핑 문장이 던지면 방금 만든 캠페인 지우고 던짐(고아 0).
 */
export async function pickStepCampaignForUnits(spec: StepCampaignSpec): Promise<StepCampaignPick> {
  const sendDate = kstDateString();
  for (let attempt = 0; attempt < 3; attempt++) {
    const st = await stepCampaignSeqState();
    const cur = await query(
      `SELECT jsc.campaign_id, ${st.seqColumn ? 'jsc.seq' : '0'}::int AS seq,
              (c.send_config->>'loadProtocol') AS protocol,
              COALESCE((c.send_config->>'loadSealed')::boolean, false) AS sealed,
              (c.send_config->>'ledgerShape') AS ledger_shape
         FROM journey_step_campaigns jsc JOIN campaigns c ON c.id = jsc.campaign_id
        WHERE jsc.journey_id = $1::uuid AND jsc.step_id = $2::uuid AND jsc.send_date = $3
        ORDER BY ${st.seqColumn ? 'jsc.seq DESC' : 'jsc.created_at DESC'} LIMIT 1`,
      [spec.journeyId, spec.stepId, sendDate],
    );
    const row = cur.rows[0];
    let nextSeq = 0;
    if (row) {
      // ★ 2026-11-11 C129(D10) — 원장 꼴이 다르면(한쪽만 있는 것 포함) 봉인된 것과 같은 길 = 이어 붙임(문자 칸 · 후불 · 옛 캠페인 = 양쪽 다 없음 = 같음)
      const sameShape = (row.ledger_shape ?? null) === (spec.ledgerShape ?? null);
      if (!row.sealed && sameShape && row.protocol === LOAD_PROTOCOL_UNIT) return { campaignId: String(row.campaign_id), sendDate };
      if (!row.sealed && sameShape && row.protocol !== LOAD_PROTOCOL_UNIT) {
        const conv = await query(
          `UPDATE campaigns SET send_config = jsonb_set(COALESCE(send_config, '{}'::jsonb), '{loadProtocol}', to_jsonb($2::text))
            WHERE id = $1::uuid AND NOT (COALESCE(send_config, '{}'::jsonb) ? 'loadProtocol')
              AND NOT EXISTS (SELECT 1 FROM journey_step_logs l WHERE l.campaign_id = $1::uuid
                                AND (l.status = 'sending' OR (l.status = 'failed' AND l.error_reason = 'load_unprovable')))
            RETURNING id`,
          [row.campaign_id, LOAD_PROTOCOL_UNIT],
        );
        if (conv.rows.length > 0) return { campaignId: String(row.campaign_id), sendDate };
        const again = await query(`SELECT send_config->>'loadProtocol' AS protocol FROM campaigns WHERE id = $1::uuid`, [row.campaign_id]);
        if (again.rows[0]?.protocol === LOAD_PROTOCOL_UNIT) continue;   // 다른 자리가 먼저 달았다 = 다시 읽기
      }
      if (!st.continuation) {
        if (Date.now() - _seq.alertedAt > 60 * 60 * 1000) {
          _seq.alertedAt = Date.now();
          console.warn(`[journey-step-campaign] 이어 붙임 닫힘(C96-DDL-2 전) — journey=${spec.journeyId} step=${spec.stepId} 오늘 새 단위 0(다음날 새 캠페인)`);
        }
        return { blocked: 'continuation_unavailable' };
      }
      nextSeq = Number(row.seq) + 1;
    }
    const created = await createStepCampaignRow(spec, sendDate, nextSeq, st.seqColumn);
    if (created) return { campaignId: created, sendDate };
    // 졌다 = 다시 읽기(이긴 쪽 행)
  }
  throw new Error(`단계 캠페인을 정하지 못했다 journey=${spec.journeyId} step=${spec.stepId}`);
}

async function createStepCampaignRow(spec: StepCampaignSpec, sendDate: string, seq: number, seqColumn: boolean): Promise<string | null> {
  // 신규 campaign (target/sent 0 — 발송마다 +n 누적). 원본 INSERT 컬럼 매핑 1:1.
  const camp = await query(
    // ★ 2026-07-31 `send_type='journey'` 명시. 안 넣으면 컬럼 DEFAULT 'ai'가 들어가,
    //   여정이 보낸 캠페인이 발송결과·통계에서 **AI 추천 발송**으로 표시된다(0731 Harold 지적 —
    //   `[여정] step 1` 알림톡 3건이 전부 'ai'였다). `campaigns`의 CHECK는 message_type·status
    //   2건뿐이라(2026-07-31 pg_constraint 실측) 새 값이 INSERT를 깨지 않는다.
    `INSERT INTO campaigns (
       company_id, campaign_name, message_type, message_content, subject, message_subject, message_template,
       is_ad, target_count, sent_count, created_by, send_channel, callback_number, status, scheduled_at, sent_at, kakao_template_id, mms_image_paths, send_type, send_config
     ) VALUES (
       $1::uuid, $2, $3, $4, $5, $5, $4,
       $6, 0, 0, $7::uuid, $9, $8, 'sending', NOW(), NOW(), $10::uuid, $11, 'journey', $12::jsonb
     ) RETURNING id`,
    [
      spec.companyId,
      `[여정] step ${spec.stepOrder}`,
      // 알림톡(KAKAO)은 CHECK 허용값이 아니다 — 카카오 구분은 아래 send_channel이 담당한다.
      toCampaignMessageType(spec.msgType),
      spec.representativeMessage,
      spec.subject,
      spec.isAd,
      spec.createdBy,
      spec.callbackNumber,
      spec.sendChannel,
      spec.kakaoTemplateId,
      spec.mmsImagePaths,
      // ★ 2026-09-26 새 원장 표식(위 JOURNEY_LEDGER_CONFIG) · ★ 2026-11-02 새 규약 표식(I5) — 이후 sentTables 기록은 jsonb_set이라 표식이 보존된다.
      JSON.stringify({ ...JOURNEY_LEDGER_CONFIG, loadProtocol: LOAD_PROTOCOL_UNIT, ...(spec.ledgerShape ? { ledgerShape: spec.ledgerShape } : {}) }),
    ],
  );
  const newId = camp.rows[0].id as string;
  let claim: Awaited<ReturnType<typeof query>>;
  try {
    // 매핑 claim — 대상 없는 DO NOTHING(옛 3열 기본 키 · 새 4열 기본 키 어느 쪽이든 · Codex 설계 5R · 6R)
    claim = seqColumn
      ? await query(
          `INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id, seq)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid, $5::smallint)
           ON CONFLICT DO NOTHING
           RETURNING campaign_id`,
          [spec.journeyId, spec.stepId, sendDate, newId, seq],
        )
      : await query(
          `INSERT INTO journey_step_campaigns (journey_id, step_id, send_date, campaign_id)
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid)
           ON CONFLICT DO NOTHING
           RETURNING campaign_id`,
          [spec.journeyId, spec.stepId, sendDate, newId],
        );
  } catch (e) {
    await query(`DELETE FROM campaigns WHERE id = $1::uuid`, [newId]).catch(() => undefined);
    throw e;
  }
  if (claim.rows.length > 0) return newId;
  // 경쟁 패배 — 방금 만든 orphan campaign 삭제 후 호출부가 다시 읽는다
  await query(`DELETE FROM campaigns WHERE id = $1::uuid`, [newId]);
  return null;
}

