/**
 * 예약 수신자 목록 — 페이지 전용 CT로 조회 (★2026-09-26 한줄로 V2 F21)
 *
 * GET /campaigns/:id/recipients 가 smsSelectAll(`SELECT * FROM (UNION ALL …) ORDER BY … LIMIT … OFFSET`)을 써서,
 * 페이지를 넘길 때마다 일치 행 전체(본문 mediumtext 포함)를 임시 테이블에 모은 뒤 잘랐다. 0613 예약 상세 10초 병목과 같은 모양이고
 * 그때 만든 페이지 전용 CT(smsSelectPagedAll · 테이블별 상위 K 먼저 자르고 병합 · 결과 동일)를 이 목록만 안 쓰고 있었다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
const h = src.slice(src.indexOf("router.get('/:id/recipients'"), src.indexOf('router.', src.indexOf("router.get('/:id/recipients'") + 10));

describe('예약 수신자 목록 페이지 조회', () => {
  it('페이지 전용 CT로 조회한다(정렬 = seqno 오름차순 · limit·offset)', () => {
    expect(h).toContain('const mysqlRecipients = await smsSelectPagedAll(recipientTables,');
    // ★ 2026-09-27 m140 — 동률은 테이블로 가른다(seqno는 테이블마다 독립 · 여러 라인 캠페인의 페이지 경계 중복·누락)
    expect(h).toMatch(/'seqno ASC, _sms_table ASC', limit, offset\s*\)/);
  });

  it('전체 실체화 뒤 자르는 옛 조회가 남아 있지 않다', () => {
    expect(h).not.toContain('`ORDER BY seqno LIMIT ${limit} OFFSET ${offset}`');
  });
});
