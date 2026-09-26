/**
 * 게이트웨이 매핑 대조 — 실존 확인 시각을 한 번에 찍는다 (★2026-09-26 한줄로 V2 P-10)
 *
 * 대조(6시간)가 게이트웨이와 일치한 매핑마다 `UPDATE ... SET last_seen_at = now() WHERE id = $1`을 따로 보내
 * 매 회 약 5,600번 왕복했다(70일 누적 86만 회 · M-26 실측). 값의 의미(마지막 실존 확인)는 목록 API가 내보내므로 지킨다 —
 * 행마다 쓰던 것을 bill 대조 끝에 한 문장(id = ANY)으로 묶는다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'gateway-template-mapping-worker.ts'), 'utf8');

describe('대조의 실존 확인 시각', () => {
  it('행마다 시각만 찍는 UPDATE가 남아 있지 않다', () => {
    expect(src).not.toContain('`UPDATE gateway_template_mappings SET last_seen_at = now() WHERE id = $1`');
  });

  it('일치·대기 행의 id를 모아 bill 대조 끝에 한 문장으로 찍는다', () => {
    expect((src.match(/seenIds\.push\(desired\.id\);/g) || []).length).toBe(2);
    expect(src).toContain('UPDATE gateway_template_mappings SET last_seen_at = now() WHERE id = ANY($1::uuid[])');
    // 게이트웨이에 없는 행 판정(아래 루프)보다 앞이든 뒤든 한 번 — 원격 루프가 끝난 뒤
    const iLoopEnd = src.indexOf('// desired에 있는데 게이트웨이에 없는 행');
    expect(src.indexOf('WHERE id = ANY($1::uuid[])')).toBeGreaterThan(src.lastIndexOf('seenIds.push(desired.id);'));
    expect(src.indexOf('WHERE id = ANY($1::uuid[])')).toBeLessThan(iLoopEnd);
  });
});
