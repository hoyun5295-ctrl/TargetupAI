/**
 * 고객사 격리 재발 방지 계약 (★2026-09-25 한줄로 전수점검 C-06 · C-09)
 *
 * C-06 DM 원클릭 개선·자가진단·다음 섹션 제안이 dm_pages를 id만으로 읽고 고쳤다(다른 회사 DM 수정·원문 노출).
 * C-09 고객 360 이메일 원천이 이메일 주소만으로 email_events를 찾아 다른 고객사 캠페인 기록이 보였다.
 * 라우트·SQL 모양이 바뀌면 조용히 풀리는 부류라 소스 스캔으로 고정한다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8');

function routeBlock(src: string, marker: string): string {
  const at = src.indexOf(marker);
  expect(at).toBeGreaterThan(-1);
  const next = src.indexOf('dmRouter.', at + marker.length);
  return src.slice(at, next > -1 ? next : undefined);
}

describe('C-06 DM 소유 가드', () => {
  const dm = read('routes/dm.ts');
  for (const [marker, ctCall] of [
    ["dmRouter.post('/:id/self-diagnose'", 'selfDiagnoseDm('],
    ["dmRouter.post('/:id/quick-action'", 'applyQuickAction('],
    ["dmRouter.get('/:id/section-suggest'", 'suggestNextSection('],
  ] as const) {
    it(`${marker} — CT 호출 전에 canAccessDm`, () => {
      const block = routeBlock(dm, marker);
      const guard = block.indexOf('canAccessDm(');
      expect(guard).toBeGreaterThan(-1);
      expect(guard).toBeLessThan(block.indexOf(ctCall));
    });
  }
});

describe('C-09 고객 360 이메일 원천', () => {
  it('캠페인을 INNER JOIN하고 회사로 가둔다', () => {
    const src = read('utils/customer-timeline.ts');
    const at = src.indexOf('async function fetchEmails(');
    const body = src.slice(at, src.indexOf('\nasync function', at + 10));
    expect(body).toContain('fetchEmails(companyId: string');
    expect(body).toMatch(/\bJOIN email_campaigns c ON c\.id = e\.campaign_id AND c\.company_id = \$6::uuid/);
    expect(body).not.toContain('LEFT JOIN email_campaigns');
  });
});
