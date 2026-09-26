/**
 * 발송내역(/results/campaigns/:id/messages)은 그 회사 캠페인만 (★2026-09-26 한줄로 V2 F27)
 *
 * 같은 라우터의 상세(/campaigns/:id)·엑셀(/campaigns/:id/export)은 회사 캠페인이 아니면 404인데, 발송내역만 0행이어도 진행해
 * 다른 회사 캠페인 UUID로 수신번호·본문·결과를 페이지 단위로 읽을 수 있었다(조회 합집합에 전 bulk·bito 라인이 들어 있다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', '..', 'routes', 'results.ts'), 'utf8');

describe('발송내역 소유 확인', () => {
  it('캠페인 조회(회사 조건)가 0행이면 큐를 읽기 전에 404', () => {
    const h = src.slice(src.indexOf("router.get('/campaigns/:id/messages'"), src.indexOf('// ===== UNION ALL 서브쿼리 빌드 =====', src.indexOf("router.get('/campaigns/:id/messages'")));
    expect(h).toContain('WHERE c.id = $1 AND c.company_id = $2');
    expect(h).toMatch(/if \(campResult\.rows\.length === 0\) \{\s*return res\.status\(404\)\.json\(\{ error: '캠페인을 찾을 수 없습니다\.' \}\);\s*\}/);
    expect(h.indexOf('campResult.rows.length === 0')).toBeLessThan(h.indexOf('const sendChannel = campResult.rows[0]'));
  });
});
