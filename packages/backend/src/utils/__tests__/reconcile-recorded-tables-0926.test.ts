/**
 * 재대조 워커 — 캠페인이 실제로 적재된 테이블을 읽는다 (★2026-09-26 한줄로 V2 F36)
 *
 * 재대조(reconcileFinalizedCampaigns)가 회사의 **현재 라인**만 읽어, 발송 뒤 라인이 빠지거나(비활성·재배정)
 * 사용자 전용 라인으로 보낸 캠페인은 일부만 보이는 실측으로 sent_count를 낮춰 덮었다. 선불 스위퍼는 그 차이를
 * "미적재"로 보고 NOT_LOADED 환불을 냈다(실제로 나간 문자 값). 0건만 막는 가드(B-0914-1)로는 부분 누락을 못 막는다.
 * 처방: 통계 화면과 같은 테이블 해석 CT(resolveCampaignTableGroups — 기록된 sentTables + 그 라인의 전 LOG,
 * 기록이 없으면 (회사, 작성자) 라인)를 쓴다. 조회 테이블도 줄어 MySQL 부하가 준다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const worker = readFileSync(join(__dirname, '..', 'campaign-sync-worker.ts'), 'utf8');
const stats = readFileSync(join(__dirname, '..', 'stats-aggregation.ts'), 'utf8');
const fn = () => worker.slice(worker.indexOf('async function reconcileFinalizedCampaigns('), worker.indexOf('export function startCampaignSyncWorker('));

describe('재대조 테이블 해석', () => {
  it('통계와 같은 테이블 해석 CT를 공개한다', () => {
    expect(stats).toContain('export async function resolveCampaignTableGroups(');
  });

  it('재대조는 그 CT로 캠페인별 테이블을 고른다(회사 현재 라인 합집합을 직접 읽지 않는다)', () => {
    const f = fn();
    expect(f).toContain('await resolveCampaignTableGroups([');
    expect(f).not.toContain('getCompanySmsTablesWithLogs(camp.company_id)');
  });

  it('작성자·원본 send_config를 함께 읽는다(사용자 전용 라인 · sentTables 해석)', () => {
    const f = fn();
    expect(f).toMatch(/SELECT id, company_id, created_by, status/);
  });
});
