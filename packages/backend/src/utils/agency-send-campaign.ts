/**
 * agency-send-campaign.ts — 대행발송 접수와 캠페인의 대조 (★ 2026-08-23 신설 · 08-23 재설계)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §12-F.
 *
 * **진실은 캠페인 쪽 하나다.**
 *
 * 처음에는 원장이 `campaign_id`를 들고 "연결"했다. 그런데 캠페인 생성과 원장 기록이 서로 다른 순간에
 * 일어나므로, 그 사이의 모든 조합(크래시·소유권 상실·취소 경합·복구·중화 실패)을 조건으로 막아야 했고
 * 막을 때마다 새 조합이 생겼다(Codex 적대 검토 4·5·6라운드가 전부 그 자리였다).
 *
 * 그래서 근거를 하나로 줄인다: **캠페인이 `staging_id`로 접수의 시도 키를 들고 있다.** 그 하나만 본다.
 *   · 시도 키는 캠페인을 만들기 **전에** 원장에 적힌다. 그래서 "만들었는데 아무도 모르는" 캠페인이 없다.
 *   · 원장의 `campaign_id`는 **화면 표시용 캐시**다. 비어 있어도 판정은 흔들리지 않는다.
 *   · 연결·고아 판정·중화 재시도가 사라지고, 그 자리를 **대조 한 곳**(워커 D)이 대신한다.
 *
 * ⛔ 이 파일의 함수로 판정할 때 `campaign_id`를 근거로 쓰지 마라. 시도 키로 물어라.
 */
import { query } from '../config/database';
import { sendSystemAlert } from './system-alert';

/**
 * 이 시도가 만든 캠페인을 찾는다. **근거는 시도 키 하나다.**
 * @returns 캠페인 id. 아직 없으면 null
 */
export async function findAttemptCampaignId(
  companyId: string, dispatchKey: string | null,
): Promise<string | null> {
  if (!dispatchKey) return null;
  const found = await query(
    `SELECT id FROM campaigns
      WHERE staging_id = $1::uuid AND company_id = $2::uuid
      ORDER BY created_at DESC LIMIT 1`,
    [dispatchKey, companyId],
  );
  return found.rows[0]?.id || null;
}

export type CampaignKind = 'live' | 'stopped' | 'missing';

/**
 * 이 시도의 캠페인이 지금 어떤가. **id와 분류를 한 번에** 돌려준다(따로 물으면 그 사이가 또 창이 된다).
 *
 * ⛔ `stopped`는 "안 나갔다"가 아니라 **"더 나가지는 않는다"**는 뜻이다. `failed`는 적재 도중 예외로
 *   종결된 상태라 **일부는 이미 나갔을 수 있고**, `cancelled`도 픽업된 몫은 남는다.
 */
export async function inspectAttemptCampaign(
  companyId: string, dispatchKey: string | null,
  // ★2026-09-13(3) status·phase도 함께 돌려준다(이미 취소된 캠페인을 가려 취소가 갇히지 않게 · 한 통이라도 나갔을 수 있는지 가르게 ·
  //   기존 소비처는 id·kind만 읽는다)
): Promise<{ id: string | null; kind: CampaignKind; status: string | null; phase: string | null }> {
  if (!dispatchKey) return classifyAttemptCampaign(undefined);
  const r = await query(
    `SELECT id, status, send_phase FROM campaigns
      WHERE staging_id = $1::uuid AND company_id = $2::uuid
      ORDER BY created_at DESC LIMIT 1`,
    [dispatchKey, companyId],
  );
  return classifyAttemptCampaign(r.rows[0]);
}

/**
 * 캠페인 행 → 분류(★2026-09-13(3) · 조회와 멈춘 시도 인수 트랜잭션이 같은 규칙 한 벌을 쓴다).
 * 배관은 `send_phase='queued'`만 집는다. `preparing`·`failed`는 더 나가지 않는다.
 */
export function classifyAttemptCampaign(
  row: { id: string; status: string | null; send_phase: string | null } | undefined,
): { id: string | null; kind: CampaignKind; status: string | null; phase: string | null } {
  if (!row) return { id: null, kind: 'missing', status: null, phase: null };
  const { id, status, send_phase: phase } = row;
  if (status === 'cancelled' || phase === 'failed' || phase === 'preparing') return { id, kind: 'stopped', status: status ?? null, phase: phase ?? null };
  return { id, kind: 'live', status: status ?? null, phase: phase ?? null };
}

/**
 * 이 캠페인이 한 통이라도 나갔을 수 있는가(★2026-09-13(3) · Codex 적대 1R medium).
 * `preparing`만 아니다(차감 완료 전 · 활성화 전이라 워커가 집지 않는다). `failed`는 적재 도중 종결이라 **일부가 나갔을 수 있다**.
 * ⛔ `kind === 'live'`로 대신하지 마라: `stopped`에는 일부 발송된 `failed`가 들어 있어, 막을 것이 없을 때 취소로 확정하면 화면이 거짓말을 한다.
 */
export function campaignMayHaveSent(found: { id: string | null; phase: string | null }): boolean {
  return !!found.id && found.phase !== 'preparing';
}

/**
 * 나가면 안 되는 캠페인을 중화한다.
 *
 * ⛔ 실패해도 여기서 재시도 장치를 만들지 않는다. **대조(워커 D)가 매 tick 같은 것을 다시 본다** —
 *   접수가 이미 종결 상태여도 시도 키로 캠페인을 계속 조회하므로, 성공할 때까지 저절로 재시도된다.
 * ⛔ 경보 전송은 따로 감싼다. 경보가 던지면 결과를 못 돌려주고 그 위의 배치가 같은 행에서 멈춘다.
 */
export async function neutralizeCampaign(
  requestId: string, companyId: string, campaignId: string, why: string,
): Promise<{ ok: boolean; error: string; alreadySent?: boolean; stoppedEarlier?: boolean }> {
  let ok = false;
  let error = '';
  let alreadySent = false;
  // ★2026-09-26 F10·F31·F32 — 앞선 취소가 이미 적재를 멈춘 캠페인(취소 CT가 알려 준다). 대조의 반복 기록을 건너뛰는 데 쓴다.
  let stoppedEarlier = false;
  try {
    // ★2026-09-13(3) 이미 취소된 캠페인은 막을 것이 없다(큐는 그 취소가 지웠다). 캠페인 취소 CT는 이 경우를 실패로 돌려줘
    //   (중복 환불 방지) 취소 마무리가 영원히 재시도하며 경보를 보냈다 → 성공으로 보고, "이미 발송"으로도 보지 않는다.
    const current = await query(`SELECT status FROM campaigns WHERE id = $1::uuid AND company_id = $2::uuid`, [campaignId, companyId]);
    if (current.rows[0]?.status === 'cancelled') return { ok: true, error: '', alreadySent: false };
    const { cancelCampaign } = await import('./campaign-lifecycle');
    // ⛔ `skipTimeCheck` — 15분 게이트는 사용자 정책이지 안전장치가 아니다. 여기서 멈추면 나가면 안 되는 발송이 나간다.
    // ⛔ `queueOnly` — 대행발송은 캠페인 생성 직후 적재를 끝내고 `completed`가 된다(예약 시각은 큐 행이 든다).
    //   상태 게이트(`scheduled`·`draft`)를 그대로 두면 **예약이 잡힌 건을 영영 못 막는다**(0828 확정).
    //   상태를 바꾸지 않는 이유는 청구 축이다 — `cancelCampaign`의 옵션 주석이 소유한다.
    const undone = await cancelCampaign(campaignId, companyId, {
      skipTimeCheck: true, queueOnly: true, reason: why,
    });
    ok = undone.success;
    error = undone.error || '';
    alreadySent = !!undone.alreadySent;
    stoppedEarlier = !!undone.stoppedEarlier;
  } catch (err: any) {
    error = String(err?.message || err);
  }
  if (!ok) {
    try {
      // ⛔ UUID를 싣지 않는다 — 받는 사람이 그 값으로 할 수 있는 일이 없고 본문만 채운다.
      //   찾는 자리는 슈퍼관리자 화면이고, 문자는 무슨 일이 있었고 무엇을 보면 되는지만 전한다.
      await sendSystemAlert({
        dedupKey: `agency-orphan:${campaignId}`,
        title: '대행발송 예약을 되돌리지 못했습니다.',
        details: [`사유: ${why}`, `오류: ${error || '미상'}`],
        action: '발송 큐가 살아 있을 수 있습니다. 대행발송 접수 화면에서 확인해 주세요.',
      });
    } catch (alertErr: any) {
      console.error('[agency-send] 경보 전송 실패(중화 결과는 그대로 돌려준다):', alertErr?.message || alertErr);
    }
  }
  return { ok, error, alreadySent, stoppedEarlier };
}
