/**
 * 광고는 서버가 항상 수신거부 번호를 뺀다 (★ 2026-09-27 한줄로 V2 차수 1 GATE — S5-05 · Harold 결정 「광고는 서버가 항상 켬 · 화면 체크박스는 광고일 때 잠금」)
 *
 * 직접발송 창의 "수신거부제거" 체크박스(D102 · 기본 켬 · 해제 가능)를 광고 발송에서도 끌 수 있었고, 서버는 unsubFilterEnabled=false를
 * 그대로 따라 수신거부 번호를 빼지 않았다(정보통신망법상 수신 거부한 사람에게 광고 금지). DM 타겟·대행·AI 운영자 경로는 서버가 항상 켠다.
 * 판정 CT 하나(effectiveUnsubFilter: 광고면 켬 · 아니면 사용자 선택)를 필터가 실제로 도는 네 자리에 건다:
 *   건수 CT(countStagingFiltered · 미리보기·확정 공용) · 대량 확정 스펙 · 직접발송 동기 · 대량 적재 워커(배포 전에 걸린 예약 광고도 여기서 걸린다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { effectiveUnsubFilter } from '../direct-send-core';

describe('판정 CT', () => {
  it('광고면 사용자 선택과 무관하게 켬 · 광고가 아니면 선택(기본 켬)', () => {
    expect(effectiveUnsubFilter(true, false)).toBe(true);
    expect(effectiveUnsubFilter(true, true)).toBe(true);
    expect(effectiveUnsubFilter(true, undefined)).toBe(true);
    expect(effectiveUnsubFilter(false, false)).toBe(false);
    expect(effectiveUnsubFilter(false, undefined)).toBe(true);
    expect(effectiveUnsubFilter(false, true)).toBe(true);
  });
});

describe('배선', () => {
  const core = readFileSync(join(__dirname, '..', 'direct-send-core.ts'), 'utf8');
  const worker = readFileSync(join(__dirname, '..', 'direct-send-worker.ts'), 'utf8');
  const camp = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
  const fe = readFileSync(join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'DirectSendPanel.tsx'), 'utf8');

  it('건수 CT는 광고 여부를 필수로 받아 CT 안에서 판정한다', () => {
    expect(core).toMatch(/export async function countStagingFiltered\(\s*stagingId: string, companyId: string, userId: string,\s*dedupEnabled: boolean, unsubFilterEnabled: boolean, adEnabled: boolean,/);
    expect(core).toContain('if (effectiveUnsubFilter(adEnabled, unsubFilterEnabled)) {');
    expect(core).not.toContain('  if (unsubFilterEnabled !== false) {');
  });

  it('미리보기·확정 호출이 광고 여부를 넘기고, 확정 스펙에는 판정값을 싣는다', () => {
    expect(camp).toContain('countStagingFiltered(stagingId, companyId, userId, dedupEnabled, unsubFilterEnabled, adEnabled === true)');
    expect(camp.split('countStagingFiltered(stagingId, companyId, userId, dedupEnabled, unsubFilterEnabled, adEnabled === true)').length - 1).toBe(2);
    expect(camp).toContain('dedupEnabled, unsubFilterEnabled: effectiveUnsubFilter(adEnabled === true, unsubFilterEnabled),');
  });

  it('직접발송 동기·대량 적재 워커도 같은 CT', () => {
    expect(camp).toContain('if (effectiveUnsubFilter(adEnabled === true, unsubFilterEnabled)) {');
    expect(camp).not.toMatch(/\n    if \(unsubFilterEnabled !== false\) \{/);
    expect(worker).toContain('if (effectiveUnsubFilter(cfg.adEnabled === true, cfg.unsubFilterEnabled)) {');
    expect(worker).not.toContain('if (cfg.unsubFilterEnabled !== false) {');
  });

  it('화면: 광고면 수신거부제거를 켠 채 잠그고, 건수 요청에 광고 여부를 싣는다', () => {
    expect(fe).toContain('checked={unsubFilterEnabled || adTextEnabled}');
    expect(fe).toContain('disabled={adTextEnabled}');
    expect(fe).toContain('body: JSON.stringify({ stagingId, dedupEnabled, unsubFilterEnabled: unsubFilterEnabled || adTextEnabled, adEnabled: adTextEnabled }),');
  });
});

/**
 * m125 중복제거를 끈 채 수신거부 번호가 여러 줄이면, 건수 CT가 수신거부를 번호 수(DISTINCT)로 빼서 확인 창·차감이 실제보다 컸다
 *      (워커는 그 번호의 줄을 전부 지운다 · 미적재 환불로 보정은 됐다) → 중복제거를 끄면 줄 수로 센다.
 * m119 직접발송 대량 확정(commit)에 본문 링크 결함 검사가 없었다(동기·AI 발송은 있음) → 같은 CT(findLinkDefectInText).
 */
describe('m125 · m119 링크', () => {
  const core = readFileSync(join(__dirname, '..', 'direct-send-core.ts'), 'utf8');
  const camp = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
  it('수신거부 수는 중복제거를 켰으면 번호 수, 껐으면 줄 수', () => {
    expect(core).toContain("`SELECT COUNT(${dedupEnabled !== false ? 'DISTINCT s.phone' : '*'})::int AS c");
  });
  it('대량 확정도 본문·제목 링크 결함을 차감 전에 막는다', () => {
    const at = camp.indexOf("const commitChannel = resolveSendChannel('direct', sendChannel);");
    const seg = camp.slice(at, camp.indexOf('const stagedCount = await query(', at));
    expect(seg).toMatch(/for \(const t of \[message, subject\]\) \{\s*const r = findLinkDefectInText\(t, '본문의 링크는'\);\s*if \(r\) return res\.status\(400\)\.json\(\{ success: false, error: r, code: 'LINK_DEFECT' \}\);/);
  });
});
