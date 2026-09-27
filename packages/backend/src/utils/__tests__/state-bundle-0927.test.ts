/**
 * 상태 UPDATE 조건·고착 (★ 2026-09-27 한줄로 V2 차수 1 STATE 묶음 — m074 · m096 · R081 · R123 · R316)
 *
 * 뿌리 = 상태를 바꿀 때 **현재 상태 조건 없이 id만으로 덮었다**(읽고 판단한 뒤 그 사이 바뀐 상태를 못 본다).
 * m074 결과 동기화(AI·직접)가 캠페인 상태를 completed/failed로 덮어 그 사이 취소된 캠페인을 되살렸다 → 취소는 덮지 않는다.
 * m096 예약 정리가 예약 후보를 고른 뒤 id만으로 덮어 그 사이 취소된 캠페인을 completed로 되돌렸다 → 예약 상태일 때만 · 못 바꿨으면 환불도 안 함.
 * R081 담당자 정지가 상태 확인 뒤 id만으로 admin_stopped로 덮어, 그 사이 발송 패스가 선점하면 화면은 정지인데 실제 발송 → 조건부 · 건수 확인.
 * R123 이메일 즉시 발송 선점이 조건 없이 sending → 동시 요청 둘 다 통과해 같은 메일 두 번 · 미오픈 재발송은 원본당 1회 검사와 생성 사이 경합.
 * R316 브랜드 발송 CT가 던지면 라우트가 만든 'sending'이 영영 남았다 → 큐 행이 있으면 completed · 없으면 failed(조회 실패면 그대로).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('m074 결과 동기화는 취소를 덮지 않는다', () => {
  it('AI·직접 두 동기화의 캠페인 UPDATE', () => {
    const l = src('campaign-lifecycle.ts');
    expect((l.match(/WHERE id = \$4 AND status <> 'cancelled'`/g) || []).length).toBe(2);
  });
});

describe('m096 예약 정리 = 예약 상태일 때만', () => {
  it('조건부 UPDATE · 못 바꿨으면 환불하지 않고 다음', () => {
    const l = src('campaign-lifecycle.ts');
    const fn = l.slice(l.indexOf('export async function cleanupScheduledCampaigns('), l.indexOf('export async function failCampaignRun('));
    expect(fn).toContain("sent_at = COALESCE(sent_at, scheduled_at, NOW()), updated_at = NOW() WHERE id = $5 AND status = 'scheduled'`");
    expect(fn).toMatch(/if \(\(moved\.rowCount \?\? 0\) === 0\) continue;/);
    expect(fn.indexOf('if ((moved.rowCount ?? 0) === 0) continue;')).toBeLessThan(fn.indexOf('await prepaidRefund('));
  });
});

describe('R081 담당자 정지 = 조건부 · 건수 확인', () => {
  it('정지 가능한 상태일 때만 바꾸고, 못 바꿨으면 false(학습도 안 함)', () => {
    const c = src('continuous-operator.ts');
    const fn = c.slice(c.indexOf('export async function adminStopProposal('), c.indexOf('async function updateOperatorAfterRun('));
    expect(fn).toMatch(/WHERE id = \$1::uuid AND company_id = \$3::uuid AND status IN \('pending', 'admin_review', 'scheduled'\)\s*RETURNING id/);
    expect(fn.indexOf('if (stopped.rows.length === 0) return false;')).toBeLessThan(fn.indexOf('await recordAdminStopLearning('));
  });
});

describe('R123 이메일 발송 선점 = 조건부', () => {
  const e = src('..', 'routes', 'email.ts');
  it('즉시 발송은 발송 중이 아닐 때만 선점하고, 못 잡으면 409', () => {
    expect(e).toMatch(/UPDATE email_campaigns SET status = 'sending', updated_at = NOW\(\) WHERE id = \$1::uuid AND company_id = \$2::uuid AND status <> 'sending'\s*RETURNING id/);
    expect(e).toContain("code: 'ALREADY_SENDING'");
  });
  it('미오픈 재발송은 원본 단위 잠금 안에서 1회 검사와 자식 생성', () => {
    const at = e.indexOf("router.post('/campaigns/:id/resend-non-openers'");
    const body = e.slice(at, e.indexOf('setImmediate(', at));
    const iLock = body.indexOf("await withKeyedLock('email-resend', parent.id, async () => {");
    expect(iLock).toBeGreaterThan(-1);
    expect(iLock).toBeLessThan(body.indexOf('countResendChildren('));
    expect(body.indexOf('countResendChildren(')).toBeLessThan(body.indexOf('createResendChildCampaign('));
  });
});

describe('R316 브랜드 발송 예외 = 상태 수습', () => {
  it('라우트가 발송 CT 예외에서 수습 CT를 부른다', () => {
    const c = src('..', 'routes', 'campaigns.ts');
    expect(c).toContain('await settleBrandSendCrash(campaignId, companyId, userId);');
    const b = src('brand-message.ts');
    const fn = b.slice(b.indexOf('export async function settleBrandSendCrash('));
    expect(fn).toContain("WHERE id = $1 AND status = 'sending'");
    expect(fn).toContain("loaded > 0 ? 'completed' : 'failed'");
  });
});
