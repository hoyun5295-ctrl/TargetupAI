/**
 * 야간 광고 · 발송 시간 (★ 2026-09-27 한줄로 V2 차수 1 NIGHT 묶음 — m109 · m072 · m126)
 *
 * m109 여정 발송 시간이 8~21 하드코딩 — 플랫폼 창(SEND_HOURS · ENV)과 기본값이 같아 지금은 차이 없지만 ENV를 바꾸면 갈린다 → SEND_HOURS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('m109 여정 발송 시간 = 플랫폼 창', () => {
  const src = readFileSync(join(__dirname, '..', 'journey-executor.ts'), 'utf8');
  it('하드코딩 8·21 없음 · SEND_HOURS를 쓴다', () => {
    const f1 = src.slice(src.indexOf('function isWithinSendHours('), src.indexOf('function computeNextSendWindow('));
    const f2 = src.slice(src.indexOf('function computeNextSendWindow('), src.indexOf('function computeNextSendWindow(') + 700);
    expect(f1).toContain('return kstHour >= SEND_HOURS.start && kstHour < SEND_HOURS.end;');
    expect(f2).toContain('if (kstHour >= SEND_HOURS.end) {');
    expect(f2).toContain('kstTarget.setUTCHours(SEND_HOURS.start, 0, 0, 0);');
  });
});

/**
 * m072 예약 시각 변경이 새 시각의 야간 광고 제한·브랜드 발송 가능 시간(08:00~20:50)을 다시 보지 않았다
 *      → 광고를 야간으로, 브랜드를 창 밖으로 옮기면 그대로 나갔다(브랜드는 카카오가 3022로 버리는데 이미 차감된 뒤) → 접수 때와 같은 CT.
 */
describe('m072 예약 시각 변경 재검사', () => {
  const camp = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
  const at = camp.indexOf("router.put('/:id/reschedule'");
  const body = camp.slice(at, camp.indexOf("router.put('/:id/message'", at));
  it('새 시각에 야간 광고 판정 CT', () => {
    expect(body).toContain('nightAdRestrictionMessage(rsCamp.is_ad === true, true, newScheduledAt, SEND_HOURS.start, SEND_HOURS.end)');
    expect(body).toMatch(/code: 'NIGHT_AD_RESTRICTED'/);
  });
  it('브랜드 채널이면 브랜드 발송 가능 시간 CT', () => {
    expect(body).toContain("['kakao', 'both', 'kakao_brand'].includes(String(rsCamp.send_channel || '')) && !isWithinBrandSendWindow(newScheduledAt)");
  });
  it('두 판정은 값을 바꾸기 전(적재 전 갱신·MySQL 이동보다 앞)', () => {
    const iCheck = body.indexOf('nightAdRestrictionMessage(');
    expect(iCheck).toBeLessThan(body.indexOf("if (campaign.rows[0].send_phase === 'queued') {"));
    expect(iCheck).toBeLessThan(body.indexOf('UPDATE SMSQ_SEND SET sendreq_time'));
  });
});

/**
 * m126 야간 광고 게이트가 시작 시각만 봐, 20:5x에 확정한 대량 즉시 광고의 뒤 묶음이 21시를 넘겨 적재·발송됐다.
 *      분할 발송은 분할 시각 CT(calcSplitSendTime)가 창 끝을 넘는 묶음을 다음 날 시작으로 넘겨 이미 안전하다.
 *      → 대량 워커가 광고(분할 아님)의 묶음마다 실제 나갈 시각(예약이면 max(지금, 예약 시각) · 즉시면 지금)을 창과 대조해,
 *        창 밖이면 적재를 멈춘다. 남은 분량 = 종결 블록의 미적재 환불(★ 0927 Harold 결정 「멈추고 남은 분량 환불」).
 */
describe('m126 대량 광고 적재 중 창이 닫히면 멈춘다', () => {
  const w = readFileSync(join(__dirname, '..', 'direct-send-worker.ts'), 'utf8');
  const loop = w.slice(w.indexOf('while (processed < total) {'), w.indexOf('const chunkLimit = Math.min(CHUNK, total - processed);'));
  it('광고·분할 아님이면 묶음마다 실제 나갈 시각을 창과 대조하고, 밖이면 멈춘다(환불은 종결 블록)', () => {
    expect(loop).toContain('if (isNightStopDue(cfg, new Date(), SEND_HOURS.start, SEND_HOURS.end, NIGHT_AD_LOAD_LEAD_MS)) {');
    expect(loop).toMatch(/nightStopped = total - processed;[\s\S]*?failureReason = [\s\S]*?break;/);
  });
  it('판정 CT: 광고 아님·분할 = 항상 계속 · 예약이면 max(지금, 예약) · 즉시면 지금', async () => {
    const { isNightStopDue } = await import('../autosend-policy');
    const at = (h: number) => new Date(Date.UTC(2026, 8, 27, h - 9, 30));   // KST h:30
    const W = [8, 21] as const;
    expect(isNightStopDue({ adEnabled: false }, at(21), ...W)).toBe(false);
    expect(isNightStopDue({ adEnabled: true, splitEnabled: true, splitCount: 100 }, at(21), ...W)).toBe(false);
    expect(isNightStopDue({ adEnabled: true }, at(20), ...W)).toBe(false);
    expect(isNightStopDue({ adEnabled: true }, at(21), ...W)).toBe(true);
    expect(isNightStopDue({ adEnabled: true, scheduled: true, scheduledAt: at(20).toISOString() }, at(21), ...W)).toBe(true);   // 지난 예약 = 지금
    expect(isNightStopDue({ adEnabled: true, scheduled: true, scheduledAt: at(20).toISOString() }, at(19), ...W)).toBe(false);
  });
  // ★ Codex NIGHT 1R high — 묶음 시작 판정은 21시 전에 통과해도 조회·적재(1만 건 = 5천 건씩 순차 INSERT)가 21시를 넘길 수 있다.
  //   → 즉시 쪽은 여유 시간(NIGHT_AD_LOAD_LEAD_MS)을 더한 시각으로 잰다(예약은 max(지금+여유, 예약 시각)).
  //   그래도 한 묶음이 창을 넘겨 끝났으면 조용히 두지 않는다(경보 · 사람이 확인).
  it('여유 시간: 즉시는 지금+여유로 · 예약이 그보다 늦으면 예약 시각으로', async () => {
    const { isNightStopDue } = await import('../autosend-policy');
    const kst = (h: number, m: number, s = 0) => new Date(Date.UTC(2026, 8, 27, h - 9, m, s));
    const W = [8, 21] as const;
    const LEAD = 60_000;
    expect(isNightStopDue({ adEnabled: true }, kst(20, 59, 30), ...W)).toBe(false);
    expect(isNightStopDue({ adEnabled: true }, kst(20, 59, 30), ...W, LEAD)).toBe(true);
    expect(isNightStopDue({ adEnabled: true }, kst(20, 58, 59), ...W, LEAD)).toBe(false);
    // 미리 적재하는 예약(20:58 예약 · 20:50 적재) = 예약 시각으로 잰다
    expect(isNightStopDue({ adEnabled: true, scheduled: true, scheduledAt: kst(20, 58).toISOString() }, kst(20, 50), ...W, LEAD)).toBe(false);
    // 예약 시각이 지금+여유보다 이르면 지금+여유로(적재가 예약 시각을 넘겨 끝나면 그때 나간다)
    expect(isNightStopDue({ adEnabled: true, scheduled: true, scheduledAt: kst(20, 59, 30).toISOString() }, kst(20, 59, 10), ...W, LEAD)).toBe(true);
  });
  // ★ Codex NIGHT 2R high — 여유를 더한 끝만 보면 07:59:30 즉시 적재가 08:00:30으로 보여 창 안으로 판정됐다(08시 전 광고).
  //   적재 구간 = [max(지금, 예약), max(지금+여유, 예약)] · 시작·끝 둘 다 창 안이어야 한다.
  it('적재 구간의 시작도 창 안이어야 한다(아침 경계)', async () => {
    const { isNightStopDue } = await import('../autosend-policy');
    const kst = (h: number, m: number, s = 0) => new Date(Date.UTC(2026, 8, 27, h - 9, m, s));
    const W = [8, 21] as const;
    const LEAD = 60_000;
    expect(isNightStopDue({ adEnabled: true }, kst(7, 59, 30), ...W, LEAD)).toBe(true);
    expect(isNightStopDue({ adEnabled: true, scheduled: true, scheduledAt: kst(7, 0).toISOString() }, kst(7, 59, 30), ...W, LEAD)).toBe(true);   // 지난 예약
    expect(isNightStopDue({ adEnabled: true, scheduled: true, scheduledAt: kst(8, 0).toISOString() }, kst(7, 50), ...W, LEAD)).toBe(false);    // 08:00 예약 미리 적재
    expect(isNightStopDue({ adEnabled: true }, kst(8, 0, 0), ...W, LEAD)).toBe(false);
  });
  it('한 묶음이 창을 넘겨 끝났으면 경보(마지막 묶음이어도)', () => {
    const tail = w.slice(w.indexOf('const result = await processSendChunk({'), w.indexOf('} catch (loopErr: any) {'));
    expect(tail).toContain('isNightStopDue(cfg, new Date(), SEND_HOURS.start, SEND_HOURS.end)');
    expect(tail).toContain('dedupKey: `night-ad-overrun:${campaignId}`');
  });
  it('제외 사유에 야간 중단 건수를 남긴다', () => {
    expect(w).toContain('unsub: unsubRemoved, dup: dupRemoved, skipped: chunkSkipped, callbackExcluded, nightStopped,');
  });
});
