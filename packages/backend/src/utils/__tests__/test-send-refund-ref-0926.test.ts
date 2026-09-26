/**
 * 담당자 테스트 발송 — 요청마다 고유 참조로 차감·환불한다 (★2026-09-26 한줄로 V2 F15·F17)
 *
 * 옛 코드는 모든 테스트 발송이 고정 zero-uuid 하나를 reference로 공유했다. 환불은 (reference_type, reference_id, 원인 키)의
 * **누적 목표**와 비교하므로, 그 회사가 과거에 테스트 환불을 받은 만큼이 이번 목표를 삼켜 두 번째 실패부터 0원이 됐다
 * (ok:true라 경보도 없다). 요청마다 새 참조를 쓰면 차감·환불이 그 요청 안에서만 짝을 이룬다.
 * 고정 참조에 기대던 소비처는 월 사용량의 테스트 비용 하나 — 0707부터 테스트 차감은 reference_type='test'로 남으므로 그 축으로 읽는다
 * (옛 행 호환으로 zero-uuid도 함께 본다).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const campaigns = readFileSync(join(__dirname, '..', '..', 'routes', 'campaigns.ts'), 'utf8');
const monthly = readFileSync(join(__dirname, '..', 'monthly-usage.ts'), 'utf8');

describe('테스트 발송 참조', () => {
  it('요청마다 새 참조를 만든다(고정 zero-uuid 금지)', () => {
    expect(campaigns).toContain('const TEST_REF = randomUUID();');
    expect(campaigns).not.toContain("const TEST_REF = '00000000-0000-0000-0000-000000000000';");
  });

  it('월 사용량 테스트 비용은 reference_type=test로 읽는다(옛 zero-uuid 행도 함께)', () => {
    expect(monthly).toMatch(/AND \(reference_type = 'test' OR reference_id = '00000000-0000-0000-0000-000000000000'\)/);
  });
});
