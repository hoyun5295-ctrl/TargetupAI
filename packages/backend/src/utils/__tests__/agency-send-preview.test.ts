/**
 * 대행발송 치환 미리보기 계약 (★2026-08-28 서수란 접수 cmtcle8gn04bnjnot641p0fvq)
 *
 *   ① 미리보기 = 실물 한 벌 — 상세 미리보기(buildRenderedSamples)와 검사·테스트 문자(buildRenderedSample)가
 *     같은 조립을 지난다. 첫 행 산출이 서로 다르면 "검사한 문장과 다른 미리보기"다.
 *   ② 행마다 값이 실제로 다르다 — 치환이 죽으면(전부 같은 문장) 미리보기가 있으나 마나가 된다.
 *   ③ 광고 부착 포함 — 실물에는 (광고)·수신거부 문구가 붙는다. 원문만 보여 주면 거짓말이다.
 *   ④ 워커의 buildSample은 CT import 한 벌이다 — 로컬 재정의가 되살아나면 두 벌이 된다(불변 4).
 *
 * DB는 mock이되 조립(buildSlotPlan·toSlotValues·prepareSendMessage)은 **실물 함수**를 그대로 돌린다.
 * fake가 실제보다 관대해지지 않게 recipients SELECT 한 모양만 응답한다(그 외 SQL = 빈 결과).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const recipientsFixture: Array<{ phone: string; vars: Record<string, any> }> = [];

vi.mock('../../config/database', () => ({
  query: vi.fn(async (sql: string, params?: any[]) => {
    if (/FROM agency_send_recipients/.test(sql)) {
      const limit = /LIMIT \$2::int/.test(sql) ? Number(params?.[1]) : (/LIMIT 1/.test(sql) ? 1 : recipientsFixture.length);
      return { rows: recipientsFixture.slice(0, limit) };
    }
    // prepareFieldMappings(customer_schema)·getOpt080Number 등 나머지 조회 = 빈 결과.
    // 슬롯 값은 addressBookFields로 직접 넘어가므로 매핑이 없어도 치환은 돈다(실경로와 같은 구조).
    return { rows: [] };
  }),
  default: {},
}));

import { AGENCY_PREVIEW_LIMIT, buildRenderedSample, buildRenderedSamples } from '../agency-send-preview';

const ROW = {
  id: '00000000-0000-0000-0000-0000000000aa',
  company_id: '00000000-0000-0000-0000-000000000001',
  created_by: '00000000-0000-0000-0000-000000000002',
  current_content: '%고객명%님, %등급% 혜택이 도착했어요.',
  message_type: 'LMS',
  subject: '혜택 안내',
  is_ad: false,
};

beforeEach(() => {
  recipientsFixture.length = 0;
  recipientsFixture.push(
    { phone: '01000010001', vars: { 고객명: '김한줄', 등급: 'VIP' } },
    { phone: '01000010002', vars: { 고객명: '이대행', 등급: '일반' } },
    { phone: '01000010003', vars: { 고객명: '박발송', 등급: '신규' } },
  );
});

describe('미리보기 = 실물 한 벌', () => {
  it('첫 행 산출이 검사·테스트 문자용 1행 조립과 같다', async () => {
    const one = await buildRenderedSample(ROW);
    const many = await buildRenderedSamples(ROW, 3);
    expect(many[0].text).toBe(one.text);
    expect(many[0].subject).toBe(one.subject);
  });

  it('행마다 치환값이 실제로 다르다 (치환이 죽으면 빨간불)', async () => {
    const samples = await buildRenderedSamples(ROW, 3);
    expect(samples).toHaveLength(3);
    expect(samples[0].text).toContain('김한줄');
    expect(samples[1].text).toContain('이대행');
    expect(samples[2].text).toContain('박발송');
    expect(new Set(samples.map((s) => s.text)).size).toBe(3);
    expect(samples.map((s) => s.phone)).toEqual(['01000010001', '01000010002', '01000010003']);
  });

  it('변수 잔여물(%...%)이 문장에 남지 않는다', async () => {
    const samples = await buildRenderedSamples(ROW, 3);
    for (const s of samples) expect(s.text).not.toMatch(/%[^%\s]+%/);
  });

  it('광고 접수는 (광고) 부착까지 실물 그대로다', async () => {
    const samples = await buildRenderedSamples({ ...ROW, is_ad: true }, 1);
    expect(samples[0].text).toContain('(광고)');
    expect(samples[0].subject).toContain('(광고)');
  });

  it('수신자 0건 = 미리보기 빈 배열, 1행 조립은 빈 슬롯으로도 한 벌(검사는 돌아야 한다)', async () => {
    recipientsFixture.length = 0;
    expect(await buildRenderedSamples(ROW, 10)).toEqual([]);
    const one = await buildRenderedSample(ROW);
    expect(one.text.length).toBeGreaterThan(0);
  });

  it('상한을 넘겨 달라고 해도 서버 상한에서 자른다', async () => {
    recipientsFixture.length = 0;
    for (let i = 0; i < AGENCY_PREVIEW_LIMIT + 20; i++) {
      recipientsFixture.push({ phone: `0100002${String(i).padStart(4, '0')}`, vars: { 고객명: `고객${i}`, 등급: '일반' } });
    }
    const samples = await buildRenderedSamples(ROW, AGENCY_PREVIEW_LIMIT + 20);
    expect(samples.length).toBeLessThanOrEqual(AGENCY_PREVIEW_LIMIT);
  });
});

describe('워커·라우트 배선 (불변 4 = 조립은 한 벌)', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, p), 'utf8');

  it('워커의 buildSample = CT import 한 벌 (로컬 재정의 부활 금지)', () => {
    const worker = read('../agency-send-worker.ts');
    expect(worker).toMatch(/import \{ buildRenderedSample as buildSample \} from '\.\/agency-send-preview'/);
    expect(worker, '워커에 buildSample 로컬 정의가 되살아났다').not.toMatch(/async function buildSample/);
    expect(worker, '워커가 prepareSendMessage를 직접 부르면 조립이 두 벌이 된다').not.toMatch(/prepareSendMessage/);
  });

  it('미리보기 라우트는 소유자 술어를 지나고 CT를 부른다 (불변 11 격리)', () => {
    const route = read('../../routes/agency-send.ts');
    const seg = route.slice(route.indexOf("'/:id/preview'"));
    expect(seg.length, '미리보기 라우트가 없다').toBeGreaterThan(10);
    expect(seg.slice(0, 1500)).toMatch(/ownerParam\(auth\)/);
    expect(seg.slice(0, 1500)).toMatch(/buildRenderedSamples\(row, AGENCY_PREVIEW_LIMIT\)/);
  });
});
