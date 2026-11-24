// replaces: none
/**
 * 발신번호 조회(lookupCallbackNumber) — 실 PostgreSQL 판(★ 2026-11-24 특부가 갱신 1-1 ④)
 *
 * 지키는 것 = 보낸 계정은 campaigns.created_by 로 찾는다(캠페인을 만드는 길 전부가 채우는 칸 · user_id 는 대부분 비어 있다).
 *   1124 운영에서 user_id 로 찾아 계정 ID · 이용자명이 전부 비었다 → 이 시험은 user_id 가 빈 캠페인으로 계정이 나오는지 본다.
 *   작성 중(draft)은 빠진다 · 번호는 숫자만 맞추면 하이픈이 달라도 같은 번호다.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { lookupCallbackNumber } from '../callback-lookup';

const CO = '00000000-0000-0000-0000-00000001124a';
const U = '00000000-0000-0000-0000-00000001124b';
const SENT = '00000000-0000-0000-0000-00000001124c';
const DRAFT = '00000000-0000-0000-0000-00000001124d';
const CO2 = '00000000-0000-0000-0000-00000001124e';
const U2 = '00000000-0000-0000-0000-00000001124f';
const OTHER = '00000000-0000-0000-0000-000000011250';
const CO3 = '00000000-0000-0000-0000-000000011251';
const U3 = '00000000-0000-0000-0000-000000011252';
const OTHER3 = '00000000-0000-0000-0000-000000011253';
const CO4 = '00000000-0000-0000-0000-000000011254';
const U4 = '00000000-0000-0000-0000-000000011255';
const OTHER4 = '00000000-0000-0000-0000-000000011256';
const CO5 = '00000000-0000-0000-0000-000000011257';
const U5 = '00000000-0000-0000-0000-000000011258';
const OTHER5 = '00000000-0000-0000-0000-000000011259';
const BASE = Date.now(); // 발신일 순서를 한 기준 시각에서 잡는다(Codex 1124 2R)
// 도달 불가 꼴(0000 으로 시작) · 운영 덤프의 어떤 번호와도 겹치지 않게
const PHONE = '0000112499';

beforeAll(async () => {
  await insertMinimalRow(pool, 'companies', { id: CO, company_name: '시험 회사 1124' });
  await insertMinimalRow(pool, 'users', { id: U, company_id: CO, user_type: 'user', is_active: true, login_id: 't-cbl-1124', name: '시험 사용자' });
  await insertMinimalRow(pool, 'campaigns', {
    id: SENT, company_id: CO, created_by: U, user_id: null, status: 'completed', send_type: 'direct',
    callback_number: '0000-1124-99', sent_at: new Date(BASE - 3_600_000), campaign_name: '시험 발송',
  });
  await insertMinimalRow(pool, 'campaigns', {
    id: DRAFT, company_id: CO, created_by: U, user_id: null, status: 'draft', send_type: 'direct', callback_number: PHONE,
  });
  // 다른 회사 계정이 이 회사 캠페인을 만든 경우(슈퍼관리자가 대신 만든 경우 등) — 계정은 그대로 · 소속을 따로 밝힌다
  await insertMinimalRow(pool, 'companies', { id: CO2, company_name: '시험 회사 1124-2' });
  await insertMinimalRow(pool, 'users', { id: U2, company_id: CO2, user_type: 'admin', is_active: true, login_id: 't-cbl-1124-2', name: '다른 회사 사용자' });
  await insertMinimalRow(pool, 'campaigns', {
    id: OTHER, company_id: CO, created_by: U2, user_id: null, status: 'completed', send_type: 'direct',
    callback_number: PHONE, sent_at: new Date(BASE - 7_200_000), campaign_name: '대신 만든 발송',
  });
  // 다른 회사인데 company_name 이 비었다 = 필수 칸 name 으로 소속을 밝힌다(「없음」으로 오인하지 않게)
  await insertMinimalRow(pool, 'companies', { id: CO3, company_name: null, name: '시험 이름 1124-3' });
  await insertMinimalRow(pool, 'users', { id: U3, company_id: CO3, user_type: 'admin', is_active: true, login_id: 't-cbl-1124-3', name: '이름만 있는 회사 사용자' });
  await insertMinimalRow(pool, 'campaigns', {
    id: OTHER3, company_id: CO, created_by: U3, user_id: null, status: 'completed', send_type: 'direct',
    callback_number: PHONE, sent_at: new Date(BASE - 10_800_000), campaign_name: '이름 빈 회사가 만든 발송',
  });
  // company_name 이 탭 · 줄바꿈뿐 = 빈 이름으로 보고 name 으로 · 두 이름이 다 공백뿐 = 「확인 불가」(Codex 1124 3R)
  await insertMinimalRow(pool, 'companies', { id: CO4, company_name: '\t\n ', name: '시험 이름 1124-4' });
  await insertMinimalRow(pool, 'users', { id: U4, company_id: CO4, user_type: 'admin', is_active: true, login_id: 't-cbl-1124-4', name: '공백 이름 회사 사용자' });
  await insertMinimalRow(pool, 'campaigns', {
    id: OTHER4, company_id: CO, created_by: U4, user_id: null, status: 'completed', send_type: 'direct',
    callback_number: PHONE, sent_at: new Date(BASE - 14_400_000), campaign_name: '공백 이름 회사가 만든 발송',
  });
  await insertMinimalRow(pool, 'companies', { id: CO5, company_name: '\t', name: ' \n' });
  await insertMinimalRow(pool, 'users', { id: U5, company_id: CO5, user_type: 'admin', is_active: true, login_id: 't-cbl-1124-5', name: '이름 없는 회사 사용자' });
  await insertMinimalRow(pool, 'campaigns', {
    id: OTHER5, company_id: CO, created_by: U5, user_id: null, status: 'completed', send_type: 'direct',
    callback_number: PHONE, sent_at: new Date(BASE - 18_000_000), campaign_name: '이름 없는 회사가 만든 발송',
  });
});

describe('발신번호 조회 = 보낸 계정은 created_by', () => {
  it('user_id 가 빈 캠페인도 계정 ID · 이용자명 · 발신일이 나온다 · draft 는 빠진다 · 같은 회사 계정은 소속 표시 없음', async () => {
    const r = await lookupCallbackNumber(PHONE, 1);
    expect(r.total).toBe(5);
    expect(r.sends.map((s) => s.campaignId)).toEqual([SENT, OTHER, OTHER3, OTHER4, OTHER5]); // 발신일 최근 순
    expect(r.sends[0]).toMatchObject({
      campaignId: SENT, companyName: '시험 회사 1124', loginId: 't-cbl-1124', userName: '시험 사용자', status: 'completed',
      otherCompany: false, otherCompanyName: null,
    });
    expect(r.sends[0].sentAt).not.toBeNull();
  });

  it('보낸 계정의 소속이 캠페인 고객사와 다르면 계정은 그대로 보이고 그 소속을 밝힌다', async () => {
    const r = await lookupCallbackNumber(PHONE, 1);
    expect(r.sends[1]).toMatchObject({
      campaignId: OTHER, companyName: '시험 회사 1124', loginId: 't-cbl-1124-2', userName: '다른 회사 사용자',
      otherCompany: true, otherCompanyName: '시험 회사 1124-2',
    });
  });

  it('다른 회사의 company_name 이 비어 있으면 name 으로 소속을 밝힌다', async () => {
    const r = await lookupCallbackNumber(PHONE, 1);
    expect(r.sends[2]).toMatchObject({ campaignId: OTHER3, loginId: 't-cbl-1124-3', otherCompany: true, otherCompanyName: '시험 이름 1124-3' });
  });

  it('회사 이름이 탭 · 줄바꿈뿐이면 빈 이름으로 본다 · 두 이름이 다 공백뿐이면 확인 불가', async () => {
    const r = await lookupCallbackNumber(PHONE, 1);
    expect(r.sends[3]).toMatchObject({ campaignId: OTHER4, otherCompany: true, otherCompanyName: '시험 이름 1124-4' });
    expect(r.sends[4]).toMatchObject({ campaignId: OTHER5, otherCompany: true, otherCompanyName: '확인 불가' });
  });
});
