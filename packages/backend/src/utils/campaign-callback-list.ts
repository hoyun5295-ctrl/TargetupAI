/**
 * campaign-callback-list.ts — 캠페인의 회신번호 표시 컨트롤타워 (★2026-10-01 B-1001-6 · 임은지 접수 cmup5zrqd089kjnn43rj9tel0)
 *
 * 경위: 수신자별 회신번호로 나간 대행 메일 접수 건이 발송결과·예약 상세의 회신번호 칸에 대표 번호 하나로 보였다
 *   (대행은 번호 빈 행이 떨어지는 폴백으로 대표 번호를 캠페인에 넣는다 — agency-send-worker · 발송에 쓰이는 값이라 저장값은 그대로).
 * 처방(Harold 설계): 수신자별이면 칸 = "고객별 회신번호 {가장 많이 쓰인 번호} 외 N개" · 누르면 실제 발신된 회신번호 목록 창.
 *   목록의 진실 = MySQL 발송 표의 call_back(캠페인 app_etc1 · getCampaignSmsTablesFor = 결과 엑셀과 같은 표·같은 키).
 */
import { getCampaignSmsTablesFor, smsGroupByAll } from './sms-queue';

/**
 * 수신자별 회신번호 캠페인인가 — campaigns 별칭 c 기준 SELECT 식. 응답 칸 이름 = individual_callback.
 *   ⛔ 표시는 **실제 발송 판정과 같아야 한다**(Codex 1001 R1):
 *   - AI 캠페인 = routes/campaigns.ts 발송(D100) `use_individual_callback && !!individual_callback_column` — 칸이 없으면 공통번호로 낮춰 보낸다.
 *   - 직접발송 배관(직접발송·대행·DM 등) = send_config.useIndividualCallback — 호출부가 알림톡 등을 이미 false 로 확정해 싣는다.
 */
export const INDIVIDUAL_CALLBACK_SELECT_EXPR =
  `((COALESCE(c.use_individual_callback, false) AND COALESCE(c.individual_callback_column, '') <> '')`
  + ` OR (c.send_config->>'useIndividualCallback') = 'true') AS individual_callback`;

export interface CampaignCallbackItem { callback: string; count: number }

/**
 * 그 캠페인에서 실제 발송 표에 실린 회신번호 목록 — 많이 쓰인 순(같으면 번호순). 빈 번호는 뺀다.
 * @param campaign campaigns 행(id · send_config · created_at 등 getCampaignSmsTablesFor 가 읽는 칸)
 */
export async function listCampaignCallbacks(companyId: string, campaign: any): Promise<CampaignCallbackItem[]> {
  const tables = await getCampaignSmsTablesFor(companyId, campaign);
  const grouped = await smsGroupByAll(tables, 'call_back', 'WHERE app_etc1 = ?', [String(campaign.id)]);
  return Object.entries(grouped)
    .map(([callback, count]) => ({ callback: String(callback).replace(/\D/g, ''), count: Number(count) || 0 }))
    .filter((x) => x.callback.length > 0)
    .reduce((acc, x) => {
      // 표마다 같은 번호가 따로 묶여 올 수 있다(하이픈 섞임 등) — 숫자만으로 합친다
      const hit = acc.find((y) => y.callback === x.callback);
      if (hit) hit.count += x.count; else acc.push({ ...x });
      return acc;
    }, [] as CampaignCallbackItem[])
    .sort((a, b) => b.count - a.count || a.callback.localeCompare(b.callback));
}
