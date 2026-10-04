/**
 * 1.7.2 정규화·설정 계약 (2026-10-04 싱크·자사몰 전수점검)
 *
 * - S14 MSSQL 구매일은 UTC 성분이 원본 벽시계다(tedious useUTC) — 로컬로 읽으면 +9시간.
 * - S15 수신동의 칸 값을 못 알아보면 그 글자를 sms_opt_in_unknown 에 싣는다(빈 값·아는 값은 싣지 않는다).
 * - S12 주기는 cron 이 같은 간격으로 지킬 수 있는 값으로 맞춘다.
 * - S9 배치는 서버 상한(5000)을 넘지 않는다.
 * - S8 옛 로컬 큐 파일은 다시 보내지 않고 보관 처리한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeTimestamp, normalizePurchase, normalizeCustomer } from './index';
import { snapToSchedulableInterval, SCHEDULABLE_INTERVALS_MIN } from '../scheduler';
import { clampBatchSize } from '../config/schema';
import { retireLegacyQueueFile } from '../queue';
import { validateCustomers } from '../types/customer';

describe('S14 MSSQL 구매일', () => {
  // tedious useUTC: 원본 2026-10-04 20:30:00 이 Date(UTC 20:30)로 온다
  const d = new Date(Date.UTC(2026, 9, 4, 20, 30, 0));
  it('mssql 이면 UTC 성분 그대로(날짜가 하루 밀리지 않는다)', () => {
    expect(normalizePurchase({ customer_phone: '01000000001', purchase_date: d }, { dbType: 'mssql' }).purchase_date)
      .toBe('2026-10-04 20:30:00');
  });
  it('utcWallClock 옵션 없는 기존 동작은 그대로(로컬 포맷)', () => {
    expect(normalizeTimestamp(d)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('S15 수신동의 값 해석 불가 표시', () => {
  it('낱말표 밖 값은 null + 그 글자를 sms_opt_in_unknown 에', () => {
    const r = normalizeCustomer({ phone: '01000000001', sms_opt_in: '수신안함' });
    expect(r.sms_opt_in).toBeNull();
    expect(r.sms_opt_in_unknown).toBe('수신안함');
    // 스키마가 표시를 지우지 않는다(서버까지 간다)
    expect(validateCustomers([r]).valid[0]).toMatchObject({ sms_opt_in_unknown: '수신안함' });
  });
  it('아는 값·빈 값·값 없음·불리언은 표시하지 않는다', () => {
    for (const v of ['Y', '거부', '', undefined, true, false]) {
      const r = normalizeCustomer({ phone: '01000000001', ...(v === undefined ? {} : { sms_opt_in: v }) });
      expect(r.sms_opt_in_unknown, String(v)).toBeUndefined();
    }
  });
});

describe('S12 주기 맞춤', () => {
  it('cron 이 같은 간격으로 지키는 값만 남긴다', () => {
    for (const v of SCHEDULABLE_INTERVALS_MIN) {
      const ok = v < 60 ? 60 % v === 0 : v % 60 === 0 && 24 % (v / 60) === 0;
      expect(ok, String(v)).toBe(true);
    }
  });
  it('가장 가까운 값 · 같은 거리면 더 긴 쪽', () => {
    expect(snapToSchedulableInterval(60)).toBe(60);
    expect(snapToSchedulableInterval(45)).toBe(60);
    expect(snapToSchedulableInterval(90)).toBe(120);
    expect(snapToSchedulableInterval(7)).toBe(6);
    expect(snapToSchedulableInterval(300)).toBe(360);
    expect(snapToSchedulableInterval(0)).toBe(60);
  });
});

describe('S9 배치 상한', () => {
  it('5000 을 넘지 않는다', () => {
    expect(clampBatchSize(8000)).toBe(5000);
    expect(clampBatchSize(4000)).toBe(4000);
    expect(clampBatchSize(NaN)).toBe(4000);
  });
});

describe('S8 옛 로컬 큐', () => {
  it('queue.db 를 보관 이름으로 바꾸고 다시 읽지 않는다', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hjl-queue-'));
    fs.writeFileSync(path.join(dir, 'queue.db'), 'x');
    const retired = retireLegacyQueueFile(dir);
    expect(retired).toMatch(/queue\.db\.retired-\d+$/);
    expect(fs.existsSync(path.join(dir, 'queue.db'))).toBe(false);
    expect(retireLegacyQueueFile(dir)).toBeNull(); // 없으면 아무 일도 하지 않는다
  });
});
