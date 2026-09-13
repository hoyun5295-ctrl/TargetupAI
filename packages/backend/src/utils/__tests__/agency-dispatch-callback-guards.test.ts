/**
 * ★2026-09-13 대행발송 적대검토(Codex high 3건) 회귀 계약.
 *
 * ① 컬럼 탐지 조회가 실패하면 "컬럼 없음"으로 굳히지 않는다. 굳히면 컬럼이 있어도 고객별 회신번호를 빼고 접수·적재한다.
 * ② 재접수용 수신자 조회가 고객별 회신번호를 싣는다. 빼면 재접수가 대표 번호 하나로 나간다.
 * ③ 같은 시도 키의 조회·적재·캠페인 생성은 advisory lock 을 쥔 채로만 돈다. lock 만료 뒤 다음 tick이
 *    앞 실행의 캠페인이 읽는 staging 을 지우고 다시 쓰던 경합을 막는다.
 */
import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('hasAgencyColumn: 조회 실패를 "컬럼 없음"으로 캐시하지 않는다', () => {
  it('실패는 던지고, 다음 호출이 다시 조회해 컬럼이 있음을 본다', async () => {
    vi.resetModules();
    const { hasAgencyColumn } = await import('../agency-send-intake');
    let calls = 0;
    const client = {
      async query() {
        calls++;
        if (calls === 1) throw new Error('connection timeout');
        return { rows: [{ ok: 1 }] };
      },
    };
    await expect(hasAgencyColumn(client, 'callback', 'agency_send_recipients')).rejects.toThrow('connection timeout');
    await expect(hasAgencyColumn(client, 'callback', 'agency_send_recipients')).resolves.toBe(true);
    expect(calls).toBe(2);
  });

  it('컬럼이 정말 없으면 없음이다(DDL 후행 안전은 그대로)', async () => {
    vi.resetModules();
    const { hasAgencyColumn } = await import('../agency-send-intake');
    const client = { async query() { return { rows: [] }; } };
    await expect(hasAgencyColumn(client, 'callback', 'agency_send_recipients')).resolves.toBe(false);
  });
});

describe('재접수 수신자 조회가 고객별 회신번호를 싣는다', () => {
  const route = fs.readFileSync(path.join(__dirname, '../../routes/agency-send.ts'), 'utf8');
  const seg = route.slice(route.indexOf("router.get('/:id/recipients'"), route.indexOf("router.get('/:id/preview'"));

  it('컬럼 탐지 뒤 callback 을 SELECT 에 넣는다', () => {
    expect(seg.length).toBeGreaterThan(0);
    expect(seg).toMatch(/hasAgencyColumn\(pool, 'callback', 'agency_send_recipients'\)/);
    expect(seg).toMatch(/SELECT phone, vars\$\{hasCallback \? ', callback' : ''\}/);
  });
});

describe('시도 키 잠금: 조회·적재·캠페인 생성은 잠금 안에서만 돈다', () => {
  const src = fs.readFileSync(path.join(__dirname, '../agency-send-worker.ts'), 'utf8');
  const wrapStart = src.indexOf('async function dispatchToPipeline(');
  const attemptStart = src.indexOf('async function dispatchAttempt(');
  const attemptEnd = src.indexOf('// ────────────── C. 만료');

  it('감싸는 함수는 잠금을 잡은 뒤에만 시도 본문을 부르고 반드시 푼다', () => {
    expect(wrapStart).toBeGreaterThan(0);
    expect(attemptStart).toBeGreaterThan(wrapStart);
    const wrapper = src.slice(wrapStart, attemptStart);
    expect(wrapper).toMatch(/pg_try_advisory_lock/);
    expect(wrapper.indexOf('pg_try_advisory_lock')).toBeLessThan(wrapper.indexOf('await dispatchAttempt('));
    expect(wrapper).toMatch(/finally \{[\s\S]*pg_advisory_unlock[\s\S]*lockClient\.release\(/);
  });

  it('staging 쓰기·캠페인 생성·시도 캠페인 조회는 시도 본문 안에만 있다', () => {
    const attempt = src.slice(attemptStart, attemptEnd);
    const wrapper = src.slice(wrapStart, attemptStart);
    for (const needle of ['INSERT INTO campaign_send_staging', 'createDirectSendCampaign(', 'inspectAttemptCampaign(row.company_id, stagingId)']) {
      expect(attempt).toContain(needle);
      expect(wrapper).not.toContain(needle);
    }
  });
});
