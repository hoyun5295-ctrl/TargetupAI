/**
 * 대행발송 취소 축 불변 (★2026-08-28 서수란 접수 `cmtcgacmr03o8jnothzxrtrf6`)
 *
 * 무엇이 문제였나
 *   대행발송은 캠페인 생성 **51밀리초 뒤** 적재를 끝내고 `completed`가 된다(예약 시각은 큐 행이 든다).
 *   그런데 `cancelCampaign`의 1번 게이트가 `scheduled`·`draft`만 통과시켜
 *   **예약이 잡힌 대행발송은 아무도 취소할 수 없었다.** 취소를 누르면 접수가 `cancelling`에 갇히고
 *   워커가 매 tick 영원히 재시도했다(성공할 수 없는 조건인데 "성공할 때까지 재시도"로 설계돼 있었다).
 *
 * 못 박는 것 — 값이 아니라 **구조**다. 이 셋이 깨지면 같은 사고가 되돌아온다.
 *   1. `queueOnly`는 캠페인 상태를 바꾸지 않는다(청구 축이 `status='completed'`를 요구한다).
 *   2. 대행발송 두 입구(사용자 취소·워커 중화)가 모두 `queueOnly`로 부른다.
 *   3. 큐에 막을 것이 없었으면(`alreadySent`) 「취소됨」으로 확정하지 않는다.
 *
 * ⚠ DB·MySQL을 타는 경로라 단위 실행이 불가능하다. 소스를 텍스트로 읽어 구조를 고정한다
 *   (선례 = `brand-spec-parity.test.ts` · `admin-role-label-parity.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

const LIFECYCLE = read('../campaign-lifecycle.ts');
const AGENCY_CANCEL = read('../agency-send-cancel.ts');
const AGENCY_CAMPAIGN = read('../agency-send-campaign.ts');
const AGENCY_WORKER = read('../agency-send-worker.ts');
const BILLING_AGG = read('../send-usage-aggregation.ts');

describe('1. queueOnly는 캠페인 상태를 바꾸지 않는다', () => {
  it('청구 선택기는 여전히 status=completed를 요구한다 (이 전제가 깨지면 아래 계약의 이유가 사라진다)', () => {
    expect(BILLING_AGG).toMatch(/status = 'completed'/);
  });

  it('queueOnly는 상태 변경 UPDATE 앞에서 빠져나간다', () => {
    const idxReturn = LIFECYCLE.indexOf('if (queueOnly) {');
    const idxUpdate = LIFECYCLE.indexOf("status = 'cancelled',");
    expect(idxReturn, 'queueOnly 조기 return이 없다').toBeGreaterThan(0);
    expect(idxUpdate, "status='cancelled' UPDATE를 찾지 못했다").toBeGreaterThan(0);
    expect(idxReturn, 'queueOnly return이 상태 변경보다 뒤에 있으면 청구가 사라진다').toBeLessThan(idxUpdate);
  });

  it('큐 삭제·잔존 검증은 queueOnly도 그대로 지난다 (건너뛰는 것은 상태 변경뿐)', () => {
    const idxDelete = LIFECYCLE.indexOf('DELETE FROM SMSQ_SEND WHERE app_etc1 = ? AND status_code = 100');
    const idxVerify = LIFECYCLE.indexOf('const remainingPending');
    const idxReturn = LIFECYCLE.indexOf('if (queueOnly) {');
    expect(idxDelete).toBeGreaterThan(0);
    expect(idxDelete, '큐 삭제가 queueOnly return 뒤면 아무것도 안 막힌다').toBeLessThan(idxReturn);
    expect(idxVerify, '잔존 검증이 queueOnly return 뒤면 안전장치가 빠진다').toBeLessThan(idxReturn);
  });

  it('이미 취소된 캠페인은 queueOnly로도 다시 취소되지 않는다 (환불 이중 계상 방지)', () => {
    expect(LIFECYCLE).toMatch(/camp\.status === 'cancelled'[\s\S]{0,200}이미 취소된 캠페인입니다/);
  });
});

describe('2. 대행발송 두 입구가 모두 queueOnly로 부른다', () => {
  it('사용자·관리자 취소 경로', () => {
    expect(AGENCY_CANCEL).toMatch(/cancelCampaign\([\s\S]{0,300}queueOnly: true/);
  });

  it('워커 중화 경로', () => {
    expect(AGENCY_CAMPAIGN).toMatch(/cancelCampaign\([\s\S]{0,300}queueOnly: true/);
  });

  it('워커 중화는 15분 게이트도 지난다 (그건 사용자 정책이지 안전장치가 아니다)', () => {
    expect(AGENCY_CAMPAIGN).toMatch(/skipTimeCheck: true/);
  });

  it('사용자 입구는 15분 게이트를 켜 둔다 (정책은 사용자에게 그대로 적용된다)', () => {
    const call = AGENCY_CANCEL.slice(AGENCY_CANCEL.indexOf('cancelCampaign('));
    expect(call.slice(0, 300)).not.toMatch(/skipTimeCheck/);
  });
});

describe('3. 이미 나간 건을 취소됨으로 확정하지 않는다', () => {
  it('alreadySent 판정은 대기와 픽업이 모두 0일 때다', () => {
    expect(LIFECYCLE).toMatch(/alreadySent:\s*totalCancelCount === 0 && alreadyPickedUp === 0/);
  });

  it('사용자 경로는 되돌리고 사실을 알린다', () => {
    expect(AGENCY_CANCEL).toMatch(/result\.success && result\.alreadySent/);
    expect(AGENCY_CANCEL).toMatch(/ALREADY_SENT/);
    expect(AGENCY_CANCEL).toMatch(/이미 발송이 끝나 취소할 수 없습니다/);
  });

  it('워커 경로는 예약 완료로 되돌린다 (cancelled로 확정하지 않는다)', () => {
    const seg = AGENCY_WORKER.slice(AGENCY_WORKER.indexOf('담당자 취소(마무리)'));
    expect(seg).toMatch(/ok && alreadySent/);
    expect(seg.slice(0, 900)).toMatch(/status = 'queued'/);
  });

  it('워커는 되돌린 뒤 그 회차를 끝낸다 (아래 cancelled 확정으로 흘러가면 안 된다)', () => {
    const start = AGENCY_WORKER.indexOf('ok && alreadySent');
    const seg = AGENCY_WORKER.slice(start, start + 700);
    const idxContinue = seg.indexOf('continue;');
    expect(idxContinue, 'alreadySent 분기에 continue가 없다').toBeGreaterThan(0);
  });
});

describe('4. 발송 완료 상태는 백엔드와 프론트가 같다', () => {
  const FE_API = read('../../../../frontend/src/components/agency/agency-send-api.ts');
  const STATE = read('../agency-send-state.ts');

  it('상태 집합이 같다', () => {
    const be = (STATE.match(/export const AGENCY_SEND_STATUSES[\s\S]*?\];/)?.[0] || '')
      .match(/'([a-z_]+)'/g)?.map((x) => x.replace(/'/g, '')) || [];
    const fe = (FE_API.match(/export type AgencySendStatus =[\s\S]*?;/)?.[0] || '')
      .match(/'([a-z_]+)'/g)?.map((x) => x.replace(/'/g, '')) || [];
    expect(be.length, '백엔드 상태 추출 0건').toBeGreaterThan(0);
    expect(fe.length, '프론트 상태 추출 0건').toBeGreaterThan(0);
    expect([...fe].sort()).toEqual([...be].sort());
  });

  it('취소 불가 집합이 같다 — 화면이 켠 버튼을 서버가 거절하면 안 된다', () => {
    const beFn = STATE.slice(STATE.indexOf('export function canCancel'), STATE.indexOf('NOT_CANCELABLE_SQL'));
    const feFn = FE_API.slice(FE_API.indexOf('export function isCancelable'));
    for (const st of ['cancelled', 'cancelling', 'testing', 'final_testing', 'sent']) {
      expect(beFn, `백엔드 canCancel이 ${st}를 막지 않는다`).toContain(`'${st}'`);
      expect(feFn.slice(0, 500), `프론트 isCancelable이 ${st}를 막지 않는다`).toContain(`'${st}'`);
    }
  });

  it('SQL 리터럴이 판정 함수와 같은 집합이다', () => {
    const sql = STATE.match(/NOT_CANCELABLE_SQL = "([^"]+)"/)?.[1] || '';
    expect(sql).toContain("'sent'");
    for (const st of ['cancelled', 'cancelling', 'testing', 'final_testing']) {
      expect(sql, `${st}가 SQL 집합에 없다`).toContain(`'${st}'`);
    }
  });

  it('발송 완료 판정은 함수와 SQL이 같은 축을 쓴다', () => {
    expect(STATE).toMatch(/DELIVERED_BY_TIME_SQL = "status = 'queued' AND requested_at <= NOW\(\)"/);
    expect(STATE).toMatch(/function isDeliveredByTime[\s\S]{0,400}status !== 'queued'/);
  });

  it('워커가 그 SQL로 전이시킨다 (자기 시각 규칙을 만들지 않는다)', () => {
    expect(AGENCY_WORKER).toMatch(/SET status = 'sent'[\s\S]{0,120}\$\{DELIVERED_BY_TIME_SQL\}/);
  });

  /**
   * ★2026-08-28 실측으로 잡은 회귀 — `sent`를 만들자 **워커 D가 매 tick 되돌렸다.**
   * ②번이 "`live`인데 원장이 `queued`가 아니다"를 예약 완료로 맞추는데 `sent`가 그 조건에 걸렸다.
   * 적재 완료 캠페인은 `inspectAttemptCampaign`이 `live`로 보므로, 막지 않으면 `sent`가 영영 남지 못한다.
   */
  it('대조 워커가 종결 상태를 되돌리지 않는다 — 조회에서 뺀다', () => {
    expect(AGENCY_WORKER).toMatch(/status NOT IN \('cancelling', 'sent'\)/);
  });

  it('대조 워커가 종결 상태를 되돌리지 않는다 — 되맞춤 UPDATE에서도 뺀다(이중 방어)', () => {
    expect(AGENCY_WORKER).toMatch(/status NOT IN \('cancelled','cancelling','sent'\)/);
  });

  it("⛔ cancelled는 대조 대상에서 빼면 안 된다 (①번 예약 회수가 그 상태를 쓴다)", () => {
    expect(AGENCY_WORKER).toMatch(/row\.status === 'cancelled'/);
    // 조회 조건에 cancelled가 들어가면 ①번이 죽는다
    expect(AGENCY_WORKER).not.toMatch(/status NOT IN \([^)]*'cancelled'[^)]*\)\s*\n\s*AND updated_at/);
  });
});

describe('5. 알림 문구에 내부 식별자를 싣지 않는다', () => {
  it('대행발송 경보가 UUID 보간을 하지 않는다', () => {
    for (const [name, src] of [['agency-send-campaign', AGENCY_CAMPAIGN], ['agency-send-worker', AGENCY_WORKER]] as const) {
      const alerts = src.match(/sendSystemAlert\(\{[\s\S]{0,400}?\}\)/g) || [];
      for (const a of alerts) {
        // dedupKey는 내부용이라 id를 써도 된다. 본문(title·details·action·message)만 본다.
        const body = a.replace(/dedupKey:[^\n]*\n/, '');
        expect(body, `${name}: 경보 본문에 id 보간이 있다`).not.toMatch(/\$\{(requestId|campaignId|row\.id|found\.id)\}/);
      }
    }
  });
});
