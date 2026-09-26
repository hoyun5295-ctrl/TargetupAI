/**
 * 예약 문안·시각 수정이 적재 전·중 직접발송에 반영된다 (★2026-09-26 한줄로 V2 F24)
 *
 * 대량 직접발송(commit → 워커)은 선점할 때 읽은 send_config(message·subject·scheduledAt)로 적재한다.
 * 적재 전(queued)에 문안·시각을 고치면 PG 컬럼만 바뀌고 send_config는 그대로라 전원이 옛 문안·옛 시각으로 나갔고,
 * 적재 중(preparing·processing)이면 적재된 행만 새 값·나머지 청크는 옛 값으로 갈라졌다.
 * 처방: queued = send_config까지 함께 고친다(send_phase='queued' 조건으로 워커 선점과 원자적 · 이미 선점됐으면 409)
 *       · preparing·processing = 409(적재가 끝난 뒤 다시) · 그 밖(적재 뒤·워커 밖)은 종전 흐름.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
const route = (name: string, next: string) => src.slice(src.indexOf(name), src.indexOf(next, src.indexOf(name) + name.length));

describe('예약 문안 수정(PUT /:id/message)', () => {
  const r = () => route("router.put('/:id/message'", 'router.');

  it('적재 중(preparing·processing)은 큐를 보기 전에 409', () => {
    const h = r();
    expect(h).toContain("isLoadingSendPhase(campaign.rows[0].send_phase) && campaign.rows[0].send_phase !== 'queued'");
    expect(h).toContain("code: 'LOADING_IN_PROGRESS'");
    expect(h.indexOf("code: 'LOADING_IN_PROGRESS'")).toBeLessThan(h.indexOf('getCampaignQueueTables('));
  });

  it('처음 읽은 상태가 queued면 수신자 수와 상관없이 조건부 UPDATE로 간다(그사이 첫 청크가 적재돼도 우회 못 함 · Codex 4차 1R)', () => {
    const h = r();
    expect(h).toContain("if (campaign.rows[0].send_phase === 'queued') {");
    expect(h).not.toContain("recipients.length === 0 && campaign.rows[0].send_phase === 'queued'");
    // 수신자(큐) 조회보다 앞에서 끝난다
    expect(h.indexOf("if (campaign.rows[0].send_phase === 'queued') {")).toBeLessThan(h.indexOf('getCampaignQueueTables('));
  });

  it('적재 전(queued)은 send_config의 message·subject까지 함께 · send_phase=queued 조건 · 0행이면 409', () => {
    const h = r();
    expect(h).toContain("jsonb_build_object('message', $3::text, 'subject', $2::text)");
    expect(h).toMatch(/WHERE id = \$4 AND send_phase = 'queued'`/);
    expect(h).toMatch(/if \(queuedUpd\.rowCount === 0\) \{\s*return res\.status\(409\)/);
  });
});

describe('예약 시각 변경(PUT /:id/reschedule)', () => {
  const r = () => route("router.put('/:id/reschedule'", '// 예약 캠페인 문안 수정');

  it('적재 중(preparing·processing)은 409', () => {
    const h = r();
    expect(h).toContain("isLoadingSendPhase(campaign.rows[0].send_phase) && campaign.rows[0].send_phase !== 'queued'");
    expect(h).toContain("code: 'LOADING_IN_PROGRESS'");
  });

  it('적재 전(queued)은 send_config.scheduledAt까지 함께 · send_phase=queued 조건 · 큐 조정보다 앞', () => {
    const h = r();
    expect(h).toContain("jsonb_set(COALESCE(send_config, '{}'::jsonb), '{scheduledAt}', to_jsonb($2::text))");
    expect(h).toMatch(/WHERE id = \$3 AND send_phase = 'queued'`/);
    expect(h.indexOf("'{scheduledAt}'")).toBeLessThan(h.indexOf('smsMinAll('));
  });
});
