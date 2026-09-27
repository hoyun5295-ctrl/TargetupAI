/**
 * 발송결과 상세·발송내역·엑셀은 **그 캠페인의** 테이블을 읽는다 (★2026-09-26 한줄로 V2 F26)
 *
 * 세 경로(+ 슈퍼관리자 엑셀)가 "지금 기준 당월·전월" 이력만 합친 회사 라인(getCompanySmsTablesWithLogs)을 읽어,
 * 전전월 이전 캠페인은 목록·요약 숫자는 정상인데 수신자별 내역·엑셀·실패 사유가 0건이었다(매달 1일마다 한 달씩 늘어난다).
 * 처방: 관리자 상세가 이미 쓰는 캠페인 기준 CT(getCampaignSmsTables = 기록된 적재 테이블 또는 회사 전 라인 + 발송월 ±1 이력)를
 * 캠페인 행 하나로 부르는 getCampaignSmsTablesFor로 네 경로를 맞춘다. 조회 테이블 수는 종전과 비슷하거나 적다(화면 속도 불변 이상).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';


const results = readFileSync(join(__dirname, '..', '..', 'routes', 'results.ts'), 'utf8');
const csv = readFileSync(join(__dirname, '..', 'campaign-sms-export.ts'), 'utf8');
const admin = readFileSync(join(__dirname, '..', '..', 'routes', 'admin.ts'), 'utf8');
const handler = (route: string, next: string) => results.slice(results.indexOf(route), results.indexOf(next, results.indexOf(route) + route.length));

describe('캠페인 기준 테이블', () => {
  it('상세(/campaigns/:id)는 캠페인 행으로 테이블을 고른다', () => {
    const h = handler("router.get('/campaigns/:id',", "router.get('/campaigns/:id/messages'");
    expect(h).toContain('await getCampaignSmsTablesFor(companyId, campaign)');
    expect(h).not.toContain('getCompanySmsTablesWithLogs(companyId, userId)');
  });

  it('발송내역(/messages)은 소유 확인 뒤 캠페인 행으로 테이블을 고른다', () => {
    const h = handler("router.get('/campaigns/:id/messages'", "router.get('/campaigns/:id/export'");
    expect(h).toContain('await getCampaignSmsTablesFor(companyId, campResult.rows[0])');
    expect(h).not.toContain('getCompanySmsTablesWithLogs(companyId, userId)');
    expect(h).toMatch(/SELECT c\.send_channel, c\.status, c\.created_by, c\.send_config, c\.sent_at, c\.scheduled_at, c\.created_at/);
    expect(h.indexOf('campResult.rows.length === 0')).toBeLessThan(h.indexOf('getCampaignSmsTablesFor('));
  });

  it('엑셀(/export)도 캠페인 행으로', () => {
    const h = handler("router.get('/campaigns/:id/export'", 'router.');
    expect(h).toContain('await getCampaignSmsTablesFor(companyId, campaignResult.rows[0])');
    expect(h).not.toContain('getCompanySmsTablesWithLogs(companyId, userId)');
  });

  it('슈퍼관리자 엑셀(공용 스트리머)은 넘겨받은 캠페인 행으로', () => {
    expect(csv).toContain('await getCampaignSmsTablesFor(companyId, params.campaign)');
    expect(csv).not.toContain('getCompanySmsTablesWithLogs(companyId, userId || undefined)');
    const call = admin.slice(admin.indexOf('await streamCampaignSmsCsv(res, {'), admin.indexOf('});', admin.indexOf('await streamCampaignSmsCsv(res, {')));
    expect(call).toContain('campaign:');
  });
});

describe('getCampaignSmsTablesFor', () => {
  // ★ 2026-09-27 한줄로 V2 m135 — 기준일이 **여럿**(발송·예약·생성)이 됐다(한 날짜 ±1개월이면 먼 예약의 발송 월을 놓쳤다). 작성자·기록 테이블은 그대로 넘긴다.
  it('기준일 = 발송·예약·생성 시각 각각(같은 달은 한 번) · 작성자·기록 테이블을 넘긴다', () => {
    const src = readFileSync(join(__dirname, '..', 'sms-queue.ts'), 'utf8');
    const fn = src.slice(src.indexOf('export async function getCampaignSmsTablesFor('), src.indexOf('export function mergeLineTables('));
    expect(fn).toContain('const dates = [c.sent_at, c.scheduled_at, c.created_at]');
    expect(fn).toContain('getCampaignSmsTables(companyId, d, c.created_by || undefined, c.send_config)');
  });
});
