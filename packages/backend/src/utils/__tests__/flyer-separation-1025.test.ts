/**
 * ★ 2026-10-25 한줄전단(hanjulDM) 완전 분리 — 한줄로 저장소 쪽 계약
 *   - 'flyer' appSource 는 이 서비스의 값이 아니다: 로그인 입구 3곳이 모두 거절한다(한줄로 세션을 조용히 밀어내지 않게).
 *   - 전단 잔재(flyer-frontend · pos-agent · product-images)는 부활하지 않는다 · 감시 스크립트도 그 폴더를 찾지 않는다.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { normalizeAppSource, isRetiredAppSource } from '../session-manager';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const SRC = join(__dirname, '..', '..');

describe('한줄전단 분리 — appSource', () => {
  it("'flyer' 는 허용 값이 아니고 퇴역 값으로 판정된다", () => {
    expect(normalizeAppSource('flyer')).toBe('hanjul');
    expect(isRetiredAppSource('flyer')).toBe(true);
    expect(isRetiredAppSource('hanjul')).toBe(false);
    expect(normalizeAppSource('super')).toBe('super');
  });
  it('appSource 를 읽는 로그인 경로마다 퇴역 값 거절이 앞선다', () => {
    const src = readFileSync(join(SRC, 'routes', 'auth.ts'), 'utf8');
    const reads = src.match(/normalizeAppSource\(req\.body\.appSource\)/g) || [];
    const guards = src.match(/if \(isRetiredAppSource\(req\.body\.appSource\)\) return res\.status\(400\)/g) || [];
    expect(reads.length).toBeGreaterThan(0);
    expect(guards.length).toBe(reads.length);
  });
});

describe('한줄전단 분리 — 잔재', () => {
  it.each([
    'packages/flyer-frontend', 'packages/pos-agent', 'flyer-templates', 'flyer_image',
    'packages/backend/src/utils/product-images.ts',
  ])('%s 없음', p => expect(existsSync(join(ROOT, p))).toBe(false));
  it('dist 감시 스크립트가 flyer-frontend 를 복구하려 하지 않는다', () => {
    expect(readFileSync(join(ROOT, 'scripts', 'monitor-dist.sh'), 'utf8')).not.toMatch(/check_and_recover\s+"flyer-frontend"/);
  });
});
