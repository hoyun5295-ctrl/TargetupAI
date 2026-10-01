/**
 * ★ 2026-10-01 B-1001-6 수신자별 회신번호 캠페인의 회신번호 칸·목록 창 (임은지 접수 cmup5zrqd089kjnn43rj9tel0 · Harold 설계)
 *   칸 = 「고객별 회신번호 {가장 많이 쓰인 번호} 외 N개」 · 누르면 실제 발신된 회신번호 목록(가로 4 × 세로 5 · 검색).
 *   목록의 진실 = 발송 표 call_back(CT campaign-callback-list · 결과 엑셀과 같은 표·같은 키 app_etc1).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const groupMock = vi.fn();
const tablesMock = vi.fn(async () => ['SMSQ_SEND_1', 'SMSQ_SEND_1_202610']);
vi.mock('../sms-queue', () => ({
  smsGroupByAll: (...a: any[]) => groupMock(...a),
  getCampaignSmsTablesFor: (...a: any[]) => (tablesMock as any)(...a),
}));

import { INDIVIDUAL_CALLBACK_SELECT_EXPR, listCampaignCallbacks } from '../campaign-callback-list';

const SRC = resolve(__dirname, '../..');
const FE = resolve(__dirname, '../../../../frontend/src');
const read = (p: string) => readFileSync(p, 'utf8');

beforeEach(() => { groupMock.mockReset(); });

describe('목록 CT — 실제 실린 회신번호 · 많이 쓰인 순 · 숫자만으로 합침', () => {
  it('캠페인 표 전부에서 call_back 을 app_etc1 = 캠페인으로 묶는다', async () => {
    groupMock.mockResolvedValue({ '0232770171': 5, '0552793773': 9 });
    const items = await listCampaignCallbacks('co', { id: 'camp-1', created_at: '2026-10-01' });
    expect(tablesMock).toHaveBeenCalledWith('co', { id: 'camp-1', created_at: '2026-10-01' });
    expect(groupMock).toHaveBeenCalledWith(['SMSQ_SEND_1', 'SMSQ_SEND_1_202610'], 'call_back', 'WHERE app_etc1 = ?', ['camp-1']);
    expect(items).toEqual([{ callback: '0552793773', count: 9 }, { callback: '0232770171', count: 5 }]);
  });
  it('하이픈 섞인 같은 번호는 합치고 빈 번호는 뺀다 · 같은 건수면 번호순', async () => {
    groupMock.mockResolvedValue({ '02-327-7017': 2, '023277017': 3, '': 7, '0101112222': 5, '0101110000': 5 });
    const items = await listCampaignCallbacks('co', { id: 'c' });
    expect(items).toEqual([
      { callback: '023277017', count: 5 },
      { callback: '0101110000', count: 5 },
      { callback: '0101112222', count: 5 },
    ].sort((a, b) => b.count - a.count || a.callback.localeCompare(b.callback)));
    expect(items.find((x) => x.callback === '')).toBeUndefined();
  });
});

describe('API — 수신자별 여부 칸 · 목록 API 권한', () => {
  it('수신자별 판정 = 실제 발송 판정과 같다 — AI(D100: 컬럼 AND 칸) OR 직접발송 배관 send_config(문자열 true)', () => {
    expect(INDIVIDUAL_CALLBACK_SELECT_EXPR).toBe(
      "((COALESCE(c.use_individual_callback, false) AND COALESCE(c.individual_callback_column, '') <> '')"
      + " OR (c.send_config->>'useIndividualCallback') = 'true') AS individual_callback",
    );
    // 발송 쪽 규칙이 바뀌면 이 표시도 같이 봐야 한다 — 두 규칙을 한 테스트로 묶는다(Codex 1001 R1)
    const campaigns = read(resolve(SRC, 'routes/campaigns.ts'));
    expect(campaigns).toContain('const individualCallbackColumn = campaign.individual_callback_column || undefined;');
    expect(campaigns).toContain('const useIndividualCallback = (campaign.use_individual_callback || false) && !!individualCallbackColumn;');
  });
  it('결과 목록(발송결과 상세의 원천)과 예약 목록(예약 상세의 원천)이 같은 식을 싣는다', () => {
    const results = read(resolve(SRC, 'routes/results.ts'));
    const campaigns = read(resolve(SRC, 'routes/campaigns.ts'));
    expect(results).toMatch(/c\.callback_number, c\.kakao_targeting,\n\s+\$\{INDIVIDUAL_CALLBACK_SELECT_EXPR\},/);
    expect(campaigns).toMatch(/c\.is_ad, c\.callback_number,\n\s+\$\{INDIVIDUAL_CALLBACK_SELECT_EXPR\},/);
  });
  it('목록 API = 회사 + 사용자는 본인 캠페인만(단건 조회와 같은 권한)', () => {
    const results = read(resolve(SRC, 'routes/results.ts'));
    const at = results.indexOf("router.get('/campaigns/:id/callbacks'");
    expect(at).toBeGreaterThan(-1);
    const body = results.slice(at, results.indexOf('\nrouter.', at + 10));
    expect(body).toContain('WHERE c.id = $1 AND c.company_id = $2');
    expect(body).toMatch(/userType === 'company_user' && userId\) \{\s+sql \+= ` AND c\.created_by = \$3`;/);
    expect(body).toContain('listCampaignCallbacks(companyId, found.rows[0])');
  });
});

describe('화면 — 두 창이 같은 칸 컴포넌트 · 한 쪽 = 가로 4 × 세로 5', () => {
  it('발송결과 상세·예약 상세가 CampaignCallbackField 를 쓴다(옛 callback_number 직접 표시 0)', () => {
    const detail = read(resolve(FE, 'components/CampaignDetailModal.tsx'));
    expect(detail).toContain("{ label: '회신번호', value: <CampaignCallbackField campaign={campaign} /> }");
    expect(detail).not.toContain("value: campaign.callback_number || '-'");
    const sched = read(resolve(FE, 'components/ScheduledCampaignModal.tsx'));
    expect(sched).toContain('<CampaignCallbackField campaign={selectedScheduled} fallback="" refreshKey={selectedScheduled.target_count} />');
    // 수신자 삭제가 인원 수를 갱신한다 = 목록 재조회 열쇠(Codex 1001 R1)
    expect(sched).toContain('setSelectedScheduled({ ...selectedScheduled, target_count: data.remainingCount });');
    const field = read(resolve(FE, 'components/shared/CampaignCallbackField.tsx'));
    expect(field).toContain('}, [individual, campaignId, refreshKey]);');
    expect(sched).toContain("selectedScheduled.individual_callback === true");
  });
  it('목록 창: 쪽당 4 × 5 · 검색 · 쪽 이동 · 커스텀 창(native dialog 0) · 데이터 출처 표기', () => {
    const f = read(resolve(FE, 'components/shared/CampaignCallbackField.tsx'));
    expect(f).toContain('export const CALLBACK_LIST_COLUMNS = 4;');
    expect(f).toContain('export const CALLBACK_LIST_ROWS = 5;');
    expect(f).toContain('grid grid-cols-2 sm:grid-cols-4');
    expect(f).toContain('/api/v1/results/campaigns/${campaignId}/callbacks');
    expect(f).toMatch(/placeholder="번호 검색/);
    expect(f).toContain('aria-label="다음 쪽"');
    expect(f).toContain('Data source:');
    expect(f).not.toMatch(/\balert\(|\bconfirm\(|\bprompt\(/);
  });
});
