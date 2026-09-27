/**
 * 다회차 환불 항아리 (★ 2026-09-27 한줄로 V2 차수 1 MULTIRUN 묶음 — m070 · m058 · m071)
 *
 * m070 AI 발송(POST /campaigns/:id/send) 게이트가 'sending'만 막아 완료·취소·실패·예약 캠페인을 API로 다시 보낼 수 있었다.
 *      환불 항아리(미적재·실패·취소)가 캠페인 단위 누적이라 두 번째 실행의 환불이 앞 실행 누적에 삼켜진다.
 * m058 같은 캠페인 id를 두 달 넘게 지나 다시 보내면 앞 회차 이력이 집계 창(당월·전월) 밖이라 환불이 더 틀어진다.
 * m071 완료 캠페인 재발송은 대상 수 보호 트리거에 막혀 오류 응답만 났다.
 * → 뿌리 = 같은 캠페인 id로 여러 회차를 도는 문. 같은 id로 여러 회차를 도는 곳은 이 문뿐이다(자동발송은 회차마다 새 캠페인).
 *   발송 뒤 상태(예약·발송 중·완료·취소·실패)의 캠페인은 이 문으로 다시 보내지 않는다(★ 정책 추천안 · Harold 확인 필요).
 *   화면은 늘 새 캠페인을 만들어 보내고, 막혔던 발송을 다시 보낼 때(발신 인증·잔액 부족)는 캠페인이 아직 발송 전 상태라 그대로 된다.
 *   생성 INSERT가 상태 칸을 DB 기본값에 맡겨(기본값 미검증) 허용 목록(draft) 대신 발송 뒤 상태 목록으로 막는다 — 기본값이 무엇이든 새 캠페인 발송은 깨지지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const camp = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
const at = camp.indexOf("router.post('/:id/send'");
const route = camp.slice(at, camp.indexOf('INSERT INTO campaign_runs', at));

describe('m070 발송 뒤 상태의 캠페인은 다시 보내지 않는다', () => {
  it('캠페인 조회 직후(실행 행 INSERT보다 앞) 발송 뒤 상태 목록으로 409', () => {
    const i = route.indexOf('if (CAMPAIGN_POST_SEND_STATUSES.includes(String(campaign.status))) {');
    expect(i).toBeGreaterThan(route.indexOf('const campaign = campaignResult.rows[0];'));
    expect(route).toContain("code: 'CAMPAIGN_ALREADY_SENT'");
  });
  it('목록 = 예약·발송 중·완료·취소·실패(캠페인 상태 축 CT 소유)', async () => {
    const { CAMPAIGN_POST_SEND_STATUSES } = await import('../campaign-sweep-scope');
    expect([...CAMPAIGN_POST_SEND_STATUSES]).toEqual(['scheduled', 'sending', 'completed', 'cancelled', 'failed']);
    expect(camp).toContain('CAMPAIGN_POST_SEND_STATUSES');
  });
  it('발송 시작 잠금 안에서 최신 상태·실패 아닌 실행 행을 다시 본다(Codex MULTIRUN 1R high — 동시 요청)', () => {
    const lockAt = route.indexOf('const startGate = await withCampaignStartLock(id, async () => {');
    const lockBody = route.slice(lockAt, route.indexOf('INSERT INTO campaign_runs', lockAt));
    expect(lockBody).toContain("SELECT status FROM campaigns WHERE id = $1 AND company_id = $2");
    expect(lockBody).toContain("if (CAMPAIGN_POST_SEND_STATUSES.includes(String(alive.rows[0].status))) return { run: null, blocked: 'sent' as const };");
    expect(lockBody).toContain("WHERE campaign_id = $1 AND status <> 'failed' LIMIT 1");
    expect(camp).toContain("if (startGate.blocked === 'sent') {");
  });
  it("옛 'sending'만 막던 게이트와 「완료 재발송 가능」 주석이 남지 않는다", () => {
    expect(route).not.toContain('// draft 또는 completed 상태에서 재발송 가능');
    expect(route).not.toMatch(/if \(campaign\.status === 'sending'\) \{\s*return res\.status\(400\)/);
  });
});
