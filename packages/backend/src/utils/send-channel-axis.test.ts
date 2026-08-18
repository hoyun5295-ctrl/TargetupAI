/**
 * 발송 채널·과금 유형 축 불변식 — 2026-08-17 신설 (Codex 적대검토 후 재작성)
 *
 * 막는 사고: **차감은 값을 안 보고 먼저 일어나는데, 적재는 값으로 분기한다.**
 * 그래서 그 문이 처리하지 못하는 값이 들어오면 캠페인 생성 + 선불 차감 + 발송 0건으로 끝나고
 * 응답은 성공이 된다.
 *
 * 1차 시도가 이 부류를 다 못 막았고, 그 실패가 이 파일의 형태를 정했다:
 *   · 전역 목록 하나로는 못 막는다 — 같은 채널도 **문마다 처리 능력이 다르다**
 *     (`alimtalk`은 직접발송에만, `kakao_brand`는 브랜드 전용 문에만 적재 분기가 있다)
 *   · 불리언 검사만 하고 호출부가 원본을 계속 쓰면 `['sms']`가 강제변환으로 통과한 뒤 적재에서 빗나간다
 *   · **소스에 그 문자열이 있는지**만 보는 테스트는 다른 라우트의 리터럴에 걸려 거짓 통과한다
 *     (`kakao_brand`가 브랜드 전용 INSERT에 있다는 이유로 직접발송 분기 부재를 못 잡았다)
 *
 * 그래서 판정을 셋으로 나눈다 — ①resolver의 실제 동작 ②라우트 **구간별** 분기와 목록의 일치
 * ③실행 행을 만든 뒤의 조기 return이 그 행을 종결하는가.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  PIPELINE_SEND_CHANNELS,
  SEND_CHANNELS,
  resolveSendChannel,
  resolveChargeMessageType,
  CHARGEABLE_MESSAGE_TYPES,
  type SendPipeline,
} from './billing-types';

const ROUTE_SRC_RAW = readFileSync(join(__dirname, '../routes/campaigns.ts'), 'utf8');
const WORKER_SRC_RAW = readFileSync(join(__dirname, './direct-send-processor.ts'), 'utf8');
const CORE_SRC_RAW = readFileSync(join(__dirname, './direct-send-core.ts'), 'utf8');

/** 주석 제거 — 주석에 적힌 채널값이 스캔을 통과시키는 구멍을 막는다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const ROUTE_SRC = stripComments(ROUTE_SRC_RAW);
const WORKER_SRC = stripComments(WORKER_SRC_RAW);
const CORE_SRC = stripComments(CORE_SRC_RAW);

/**
 * 라우트 하나의 본문만 잘라낸다. **파일 전체를 훑으면 다른 문의 리터럴에 걸려 거짓 통과한다**
 * (1차 시도의 결함이 정확히 이것이었다).
 */
function routeBody(src: string, marker: string): string {
  const start = src.indexOf(marker);
  if (start < 0) throw new Error(`라우트를 찾지 못했다: ${marker} — 마커가 낡았으면 이 테스트는 무의미하다`);
  const rest = src.slice(start + marker.length);
  const end = rest.search(/\nrouter\.(post|get|put|delete)\(/);
  return end < 0 ? rest : rest.slice(0, end);
}

/** `sendChannel === 'x'` / `directChannel === 'x'` / `p.sendChannel === 'x'` 비교 리터럴 수집. */
function channelLiterals(src: string): Set<string> {
  const out = new Set<string>();
  const re = /(?:sendChannel|directChannel|send_channel)\s*===\s*'([a-z_]+)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) out.add(m[1]);
  return out;
}

/** 파이프라인 → 그 채널을 실제로 적재하는 소스 구간(라우트 본문 + 그 라우트가 위임하는 워커). */
const PIPELINE_SOURCES: Record<SendPipeline, () => string> = {
  direct: () =>
    `${routeBody(ROUTE_SRC, "router.post('/direct-send',")}\n` +
    `${routeBody(ROUTE_SRC, "router.post('/direct-send/commit',")}\n${WORKER_SRC}`,
  campaign: () => routeBody(ROUTE_SRC, "router.post('/:id/send',"),
  brand: () => routeBody(ROUTE_SRC, "router.post('/brand-send',"),
};

describe('파이프라인별 채널 목록 ↔ 실제 적재 분기', () => {
  it('선언한 채널은 그 파이프라인 구간에 실제로 등장한다 (적재 없는 채널을 목록에 넣으면 차감만 남는다)', () => {
    for (const [pipeline, channels] of Object.entries(PIPELINE_SEND_CHANNELS) as [SendPipeline, readonly string[]][]) {
      const src = PIPELINE_SOURCES[pipeline]();
      const missing = channels.filter((ch) => !src.includes(`'${ch}'`));
      expect(
        missing,
        `[${pipeline}] 적재 경로가 확인되지 않는 채널: ${missing.join(', ')} — ` +
          '목록에 먼저 넣으면 그 채널은 차감만 되고 큐에는 한 건도 안 들어간다.',
      ).toEqual([]);
    }
  });

  it('구간이 분기하는 채널은 그 파이프라인 목록 안에 있다 (목록 밖 값으로 분기하면 게이트가 막아 도달 불가)', () => {
    for (const pipeline of ['direct', 'campaign'] as const) {
      const allowed = PIPELINE_SEND_CHANNELS[pipeline] as readonly string[];
      const found = [...channelLiterals(PIPELINE_SOURCES[pipeline]())];
      expect(found.length, `[${pipeline}] 채널 분기를 하나도 못 찾았다 — 정규식이 낡았다`).toBeGreaterThan(0);
      const unknown = found.filter((ch) => !allowed.includes(ch));
      expect(
        unknown,
        `[${pipeline}] 목록에 없는 채널로 분기한다: ${unknown.join(', ')} — 게이트가 400으로 막으므로 ` +
          '그 분기는 영원히 도달하지 않는다. 채널을 여는 커밋에서 목록·게이트·적재를 함께 연다.',
      ).toEqual([]);
    }
  });

  it('브랜드 전용 채널은 범용 문에 들어 있지 않다 (1차 시도가 놓친 critical)', () => {
    expect(PIPELINE_SEND_CHANNELS.direct as readonly string[]).not.toContain('kakao_brand');
    expect(PIPELINE_SEND_CHANNELS.campaign as readonly string[]).not.toContain('kakao_brand');
  });

  it('AI 캠페인 문에는 알림톡 적재 분기가 없으므로 목록에도 없다', () => {
    expect(PIPELINE_SEND_CHANNELS.campaign as readonly string[]).not.toContain('alimtalk');
  });

  it('전역 목록은 파이프라인 목록의 합집합이다 (두 벌을 두면 한쪽만 늘어난다)', () => {
    const union = new Set(Object.values(PIPELINE_SEND_CHANNELS).flat());
    expect([...SEND_CHANNELS].sort()).toEqual([...union].sort());
  });
});

describe('게이트가 차감·실행 행보다 앞에 있다', () => {
  const CAMPAIGN_SEND = routeBody(ROUTE_SRC, "router.post('/:id/send',");

  it('AI 캠페인 발송 — 채널·유형 게이트가 campaign_runs INSERT보다 앞이다', () => {
    const gate = CAMPAIGN_SEND.indexOf('resolveSendChannel(');
    const typeGate = CAMPAIGN_SEND.indexOf('resolveChargeMessageType(');
    const runInsert = CAMPAIGN_SEND.indexOf('INSERT INTO campaign_runs');
    expect(gate, '채널 게이트가 없다').toBeGreaterThan(-1);
    expect(typeGate, '유형 게이트가 없다').toBeGreaterThan(-1);
    expect(runInsert, 'run INSERT를 못 찾았다 — 마커가 낡았다').toBeGreaterThan(-1);
    expect(gate, '게이트가 run INSERT 뒤면 거절 시 실행 행이 남아 캠페인이 영구히 잠긴다').toBeLessThan(runInsert);
    expect(typeGate).toBeLessThan(runInsert);
  });

  it('AI 캠페인 발송 — 카카오 활성 검사도 campaign_runs INSERT보다 앞이다', () => {
    const kakaoGate = CAMPAIGN_SEND.indexOf('kakao_enabled');
    const runInsert = CAMPAIGN_SEND.indexOf('INSERT INTO campaign_runs');
    expect(kakaoGate).toBeGreaterThan(-1);
    expect(kakaoGate, '뒤에 두면 거절 시 실행 행이 남는다(2026-08-17 정정)').toBeLessThan(runInsert);
  });

  it('run INSERT 뒤의 거절 응답은 **각각** 실행 행을 종결한다', () => {
    const runInsert = CAMPAIGN_SEND.indexOf('INSERT INTO campaign_runs');
    const after = CAMPAIGN_SEND.slice(runInsert);
    const rejects = [...after.matchAll(/return res\.status\([45]\d\d\)/g)].map((m) => m.index ?? 0);
    expect(rejects.length, '거절 경로를 하나도 못 찾았다 — 정규식이 낡았다').toBeGreaterThan(0);

    // ⛔ "앞에 종결 호출이 하나라도 있으면 통과"로 만들면 **앞 분기의 호출이 뒤 분기를 가려 준다**
    //   (Codex 2R medium 지적). 그래서 **직전 거절과 이번 거절 사이**에 종결이 있는지를 본다.
    let prev = 0;
    for (const at of rejects) {
      const between = after.slice(prev, at);
      expect(
        between.includes('failCampaignRun('),
        `run INSERT 뒤 거절(offset ${at})이 실행 행을 종결하지 않는다 — ` +
          '그 행이 남으면 중복 발송 방지 검사가 이후 발송을 영구히 막는다(충전해도 못 보낸다).',
      ).toBe(true);
      prev = at;
    }
  });

  it('예외 경로(catch)도 실행 행을 종결한다 — 조기 return만 고치면 throw로 같은 사고가 난다', () => {
    const runInsert = CAMPAIGN_SEND.indexOf('INSERT INTO campaign_runs');
    const catchAt = CAMPAIGN_SEND.indexOf('catch (sendError)');
    expect(catchAt, '발송 catch를 못 찾았다 — 마커가 낡았다').toBeGreaterThan(runInsert);
    expect(
      CAMPAIGN_SEND.slice(catchAt).includes('failCampaignRun('),
      '예외로 빠지면 실행 행이 sending으로 남아 그 캠페인이 영구히 잠긴다.',
    ).toBe(true);
  });

  it('환불 결과를 버리지 않는다 — 조용한 실패가 재시도 이중 청구가 된다', () => {
    // prepaidRefund는 실패를 던지지 않고 `ok:false`로 돌려주기도 한다(반환 타입 `{refunded, ok}`).
    // 잠금을 푼 뒤라 재시도가 가능해지므로, 미수를 원장에 남기지 않으면 두 번 걷힌다.
    const refundCalls = (CAMPAIGN_SEND.match(/prepaidRefund\(/g) || []).length;
    // ★ 2026-08-18 배치 판(markRefundPendingAxes)도 센다 — 축을 한 번에 기록하는 형태가 추가됐다.
    const pendingCalls = (CAMPAIGN_SEND.match(/markRefundPending(?:Axes)?\(/g) || []).length;
    expect(refundCalls, '환불 호출을 못 찾았다').toBeGreaterThan(0);
    expect(
      pendingCalls,
      '환불 호출마다 실패 시 미수 등재가 있어야 한다 — 결과를 버리면 이중 청구가 열린다.',
    ).toBeGreaterThanOrEqual(refundCalls);
  });

  it('직접발송 두 문 모두 차감 앞에 채널·유형 게이트가 있다', () => {
    for (const marker of ["router.post('/direct-send',", "router.post('/direct-send/commit',"]) {
      const body = routeBody(ROUTE_SRC, marker);
      const chGate = body.indexOf('resolveSendChannel(');
      const tyGate = body.indexOf('resolveChargeMessageType(');
      const deduct = body.indexOf('prepaidDeduct(');
      const spec = body.indexOf('createDirectSendCampaign(');
      expect(chGate, `${marker} 채널 게이트 없음`).toBeGreaterThan(-1);
      expect(tyGate, `${marker} 유형 게이트 없음 — 목록 밖 유형은 0원으로 통과한다`).toBeGreaterThan(-1);
      // 차감(또는 차감 CT 위임)보다 앞이어야 한다.
      const firstCharge = [deduct, spec].filter((i) => i > -1).sort((a, b) => a - b)[0];
      expect(firstCharge, `${marker} 차감 지점을 못 찾았다`).toBeGreaterThan(-1);
      expect(chGate, `${marker} 채널 게이트가 차감보다 뒤다`).toBeLessThan(firstCharge);
      expect(tyGate, `${marker} 유형 게이트가 차감보다 뒤다`).toBeLessThan(firstCharge);
    }
  });

  it('차감 유형은 게이트가 확정한 값을 쓴다 — 원본 msgType을 다시 읽지 않는다', () => {
    const body = routeBody(ROUTE_SRC, "router.post('/direct-send',");
    expect(
      /directDeductType\s*=\s*isBrandOnlyChannel\([^)]*\)\s*\?\s*'BRAND'\s*:\s*msgType\b/.test(body),
      '차감 유형이 원본 msgType을 그대로 쓴다 — 게이트를 우회한 값이 과금 축이 된다.',
    ).toBe(false);
  });

  it('차감 CT(direct-send-core)는 스스로 채널을 열지 않는다 — 판정은 호출부 게이트가 소유한다', () => {
    expect(CORE_SRC).not.toContain('PIPELINE_SEND_CHANNELS');
    expect(CORE_SRC).not.toContain('resolveSendChannel');
  });
});

describe('resolveSendChannel', () => {
  it('파이프라인이 처리할 수 있는 채널만 통과시킨다', () => {
    for (const [pipeline, channels] of Object.entries(PIPELINE_SEND_CHANNELS) as [SendPipeline, readonly string[]][]) {
      for (const ch of channels) {
        const r = resolveSendChannel(pipeline, ch);
        expect(r.ok, `${pipeline}/${ch}`).toBe(true);
        if (r.ok) expect(r.channel).toBe(ch);
      }
    }
  });

  it('다른 파이프라인의 채널은 거절한다 (전역 목록이었을 때 통과하던 자리)', () => {
    expect(resolveSendChannel('direct', 'kakao_brand').ok).toBe(false);
    expect(resolveSendChannel('campaign', 'kakao_brand').ok).toBe(false);
    expect(resolveSendChannel('campaign', 'alimtalk').ok).toBe(false);
    expect(resolveSendChannel('brand', 'sms').ok).toBe(false);
  });

  it('미지원·미지의 값은 거절한다 — 계기가 된 rcs 포함', () => {
    for (const ch of ['rcs', 'rcs_lms', 'xyz', 'SMS', 'Alimtalk']) {
      expect(resolveSendChannel('direct', ch).ok, `${ch}가 통과하면 차감 후 적재 0건이 열린다`).toBe(false);
    }
  });

  it('공백이 섞인 값은 거절한다 — 적재 분기는 원문을 비교한다', () => {
    for (const ch of [' sms', 'sms ', ' sms ', '\tsms', '  ']) {
      expect(resolveSendChannel('direct', ch).ok, `"${ch}"`).toBe(false);
    }
  });

  it('문자열이 아닌 값은 강제변환하지 않고 거절한다 (배열이 게이트를 통과하던 자리)', () => {
    for (const raw of [['sms'], [], ['sms', 'kakao'], {}, { channel: 'sms' }, 0, 1, true, false, () => 'sms']) {
      expect(
        resolveSendChannel('direct', raw as unknown).ok,
        `${JSON.stringify(raw)}가 통과하면 적재 분기의 === 비교에서만 빗나가 차감만 남는다`,
      ).toBe(false);
    }
  });

  it('미지정은 sms로 확정한다 — 기본값을 호출부에 맡기지 않는다', () => {
    for (const raw of [undefined, null, '']) {
      const r = resolveSendChannel('direct', raw as unknown);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.channel).toBe('sms');
    }
  });
});

describe('resolveChargeMessageType', () => {
  it('과금 가능한 유형만 통과시킨다', () => {
    for (const t of CHARGEABLE_MESSAGE_TYPES) {
      const r = resolveChargeMessageType(t);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.messageType).toBe(t);
    }
  });

  it('단가표에 없는 유형은 거절한다 — 통과하면 0원으로 나간다', () => {
    for (const t of ['RCS', 'KAKAO', 'BRAND', 'sms', 'lms', '카카오', '', ' SMS']) {
      expect(resolveChargeMessageType(t).ok, `${t}가 통과하면 무료 발송이 된다`).toBe(false);
    }
  });

  it('문자열이 아니면 거절한다 (기본값 없음 — 유형은 필수 입력이다)', () => {
    for (const raw of [undefined, null, ['SMS'], { t: 'SMS' }, 1, true]) {
      expect(resolveChargeMessageType(raw as unknown).ok).toBe(false);
    }
  });
});
