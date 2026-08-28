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
): Promise<{ id: string | null; kind: CampaignKind }> {
  if (!dispatchKey) return { id: null, kind: 'missing' };
  const r = await query(
    `SELECT id, status, send_phase FROM campaigns
      WHERE staging_id = $1::uuid AND company_id = $2::uuid
      ORDER BY created_at DESC LIMIT 1`,
    [dispatchKey, companyId],
  );
  if (r.rows.length === 0) return { id: null, kind: 'missing' };
  const { id, status, send_phase: phase } = r.rows[0];
  // 배관은 `send_phase='queued'`만 집는다. `preparing`·`failed`는 더 나가지 않는다.
  if (status === 'cancelled' || phase === 'failed' || phase === 'preparing') return { id, kind: 'stopped' };
  return { id, kind: 'live' };
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
): Promise<{ ok: boolean; error: string; alreadySent?: boolean }> {
  let ok = false;
  let error = '';
  let alreadySent = false;
  try {
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
  return { ok, error, alreadySent };
}
