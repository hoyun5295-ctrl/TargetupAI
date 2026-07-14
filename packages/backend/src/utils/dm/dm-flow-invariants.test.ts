/**
 * DM 위험 동작 불변식 테스트 — 재발 방지책 2 (2026-07-14 신설).
 *
 * 렌더가 아니라 "동작이 옳은가"를 밟는다. 스냅샷·파리티 테스트가 못 잡는 동작/흐름 결함(#4 권한, #7 저장 시점)을
 * 배포 전 자동 차단한다.
 *  - #4: 일반 사용자는 본인 생성 DM만 (getDmList 스코프) — DB를 목으로 실제 발행 SQL·파라미터를 검증.
 *  - #7: 발행 DM 자동저장이 라이브 URL을 안 바꾼다 (편집기 save 가드 상주) — 프론트 테스트 러너 부재로 소스 계약으로 가드.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
import { query } from '../../config/database';
import { getDmList } from './dm-builder';

const qmock = query as unknown as ReturnType<typeof vi.fn>;

describe('DM 위험 동작 불변식 (재발 방지책 2)', () => {
  beforeEach(() => {
    qmock.mockClear();
    qmock.mockResolvedValue({ rows: [] });
  });

  describe('#4 사용자별 노출 스코프 — 일반 사용자는 본인 생성분만', () => {
    it('일반 사용자(ownerUserId 지정) = created_by 필터 + 본인 id 파라미터', async () => {
      await getDmList('company-1', 'user-9');
      const [sql, params] = qmock.mock.calls[0] as [string, any[]];
      expect(sql, '일반 사용자 목록에 created_by 스코프가 빠지면 회사 전원 DM이 노출된다').toContain('created_by');
      expect(params).toEqual(['company-1', 'user-9']);
    });
    it('관리자(ownerUserId 미지정) = created_by 필터 없음 + 회사 전체', async () => {
      await getDmList('company-1');
      const [sql, params] = qmock.mock.calls[0] as [string, any[]];
      expect(sql).not.toContain('created_by');
      expect(params).toEqual(['company-1']);
    });
  });

  describe('#7 발행 DM 저장 시점 — 자동저장이 라이브 URL 불변', () => {
    it('dmBuilderStore.save 에 발행 DM 자동저장(silent) 차단 가드 상주', () => {
      // 프론트는 아직 테스트 러너(vitest)가 없어(rolldown-vite) 동작 테스트 대신 소스 계약으로 가드 상주를 강제한다.
      // 가드가 리팩터링으로 사라지면 발행 콘텐츠가 저장 없이 덮어써진다(임은지 #7 재발).
      const src = readFileSync(resolve(process.cwd(), '../frontend/src/stores/dmBuilderStore.ts'), 'utf8');
      const saveBody = src.slice(src.indexOf('save: async'));
      expect(
        /silent\s*&&\s*[\w.]*isPublished/.test(saveBody),
        'save()의 발행 DM 자동저장 차단 가드(silent && isPublished)가 사라짐',
      ).toBe(true);
    });
  });
});
