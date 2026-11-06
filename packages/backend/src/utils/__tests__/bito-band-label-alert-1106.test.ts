/**
 * ★ 2026-11-06 비토엔진 오류접수(결과코드 매핑 · 설계서 docs/2026-11-06-bito-console-tickets-design.md A-4 · D-A6 뿌리)
 *   게이트웨이가 돌려준 실패 대역 코드 중 한줄로 라벨 파일에 없는 것 = 결과 판정 자리(bandStatusInfo)에서 모이고 감시 워커가 코드별 하루 한 번
 *   알린다(감지 · 통지만 · 발송 표 질의 0). 1106 젬텍 재매핑 18 이 라벨 없이 들어와 「실패(코드 n)」로만 보이고 스팸 몰림 목록에서
 *   40052 · 40053 이 빠졌던 자리.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const mysqlMock = vi.fn();
const alertMock = vi.fn(async (_a: any) => 1);
vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })), mysqlQuery: (...a: any[]) => mysqlMock(...a) }));
vi.mock('../system-alert', () => ({ sendSystemAlert: (a: any) => alertMock(a) }));
vi.mock('../sms-queue', () => ({ getQueueTableSets: vi.fn() }));

import { checkUnknownBandCodes } from '../system-monitor-worker';
import { HANJUL_BAND_CODES } from '../result-code-hanjul-band.generated';
import { SPAM_BLOCK_STATUS_CODES, getStatusLabel, takeUnknownBandCodes } from '../sms-result-map';

let now = 1_800_000_000_000;
const at = (ms: number) => { now = ms; vi.spyOn(Date, 'now').mockReturnValue(now); };
beforeEach(() => {
  alertMock.mockClear();
  mysqlMock.mockReset();
  takeUnknownBandCodes();
  at(now + 2 * 24 * 60 * 60 * 1000); // 앞 시험의 코드별 쿨다운을 넘긴다
});

describe('라벨 없는 대역 코드 = 판정 자리에서 모이고 감시 워커가 알린다', () => {
  it('판정 자리를 지난 라벨 없는 대역만 모인다(라벨 있는 대역 · 대역 밖 = 0) · 꺼내면 비운다', () => {
    getStatusLabel(40052);
    getStatusLabel(1800);
    getStatusLabel(59998);
    getStatusLabel(59998);
    getStatusLabel(29997);
    expect(takeUnknownBandCodes()).toEqual([29997, 59998]);
    expect(takeUnknownBandCodes()).toEqual([]);
  });

  it('새 코드 묶음 = 경보 한 통 · 같은 코드는 하루 안에 다시 알리지 않는다 · 다른 새 코드는 바로 알린다 · 발송 표 질의 0', async () => {
    getStatusLabel(59998);
    await checkUnknownBandCodes();
    expect(alertMock).toHaveBeenCalledTimes(1);
    expect(alertMock.mock.calls[0][0].dedupKey).toBe('band-label-missing:59998');
    expect(alertMock.mock.calls[0][0].details[0]).toBe('1종 · 59998');
    expect(alertMock.mock.calls[0][0].companyId).toBeNull();

    // 10분 뒤: 같은 코드가 다시 판정 자리를 지나도 경보 0 · 처음 보는 코드(A 를 알린 뒤 처음)는 바로
    at(now + 10 * 60 * 1000);
    getStatusLabel(59998);
    getStatusLabel(59997);
    await checkUnknownBandCodes();
    expect(alertMock).toHaveBeenCalledTimes(2);
    expect(alertMock.mock.calls[1][0].dedupKey).toBe('band-label-missing:59997');

    // 하루 뒤에도 계속 오면 다시
    at(now + 25 * 60 * 60 * 1000);
    getStatusLabel(59998);
    await checkUnknownBandCodes();
    expect(alertMock).toHaveBeenCalledTimes(3);
    expect(mysqlMock).not.toHaveBeenCalled();
  });

  it('보냄이 확인되지 않으면(0 = 적재 실패 · 수신자 없음 · 쿨다운) 코드가 남아 다음 패스에 다시 · 판정 자리를 다시 안 지나도', async () => {
    getStatusLabel(59996);
    alertMock.mockResolvedValueOnce(0);
    await checkUnknownBandCodes();
    expect(alertMock).toHaveBeenCalledTimes(1);
    at(now + 5 * 60 * 1000);
    await checkUnknownBandCodes(); // 59996 은 다시 판정 자리를 지나지 않았다
    expect(alertMock).toHaveBeenCalledTimes(2);
    expect(alertMock.mock.calls[1][0].dedupKey).toBe('band-label-missing:59996');
    at(now + 5 * 60 * 1000);
    await checkUnknownBandCodes(); // 보냄 확인 뒤 = 대기 0
    expect(alertMock).toHaveBeenCalledTimes(2);
  });

  it('모인 코드가 없으면 경보 0', async () => {
    await checkUnknownBandCodes();
    expect(alertMock).not.toHaveBeenCalled();
  });

  it('감시 패스 첫 줄 = 대역 경보(발송 표 점검이 실패해도 돈다) · 이상 상태값 = 전 표 그대로', () => {
    const src = readFileSync(join(__dirname, '..', 'system-monitor-worker.ts'), 'utf8').replace(/\r\n/g, '\n');
    expect(src).toMatch(/async function runPass\(\): Promise<void> \{\n  await checkUnknownBandCodes\(\);\n  await checkDelayedQueueRows\(\);/);
    expect(src).toContain('await checkAbnormalStatusRows(all);');
    expect(src).not.toMatch(/status_code BETWEEN 20000 AND 59999/);
  });
});

describe('1106 라벨 파일 = 젬텍 재매핑 18 + 마이그레이션 103 신설', () => {
  it('운영에서 빠졌던 대역 · 103 신설 대역이 라벨에 있다 · 스팸 두 코드는 스팸 몰림 목록에 든다', () => {
    for (const k of [27102, 27104, 27106, 27107, 27108, 27109, 27110, 39078, 40002, 40004, 40011, 40013, 40052, 40053, 40055, 40056, 40057, 40090,
      21033, 23000, 28000, 28001, 28003, 28004, 28007, 28008, 28100, 28101, 28102, 28103, 28200, 28201, 29000, 29999, 52850, 59150]) {
      expect((HANJUL_BAND_CODES as any)[k], String(k)).toBeTruthy();
    }
    expect(SPAM_BLOCK_STATUS_CODES).toEqual(expect.arrayContaining([40052, 40053]));
    expect(HANJUL_BAND_CODES[52850].standard).toBe('V2850_GATEWAY_CONFIG');
    expect(HANJUL_BAND_CODES[59150].standard).toBe('V9150_UNCERTAIN_AFTER_WRITE');
    // 라벨 없는 대역 = 채널 이름 + 코드(설계서 §3-4)
    expect(getStatusLabel(59998)).toBe('발송: 실패(코드 9998)');
    expect(getStatusLabel(40052)).toBe('SMS: SMS 스팸 메시지');
  });
});
