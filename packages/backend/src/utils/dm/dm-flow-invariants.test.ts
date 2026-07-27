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
import { validateDm } from './dm-validate';

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

  // ────────────────────────────────────────────────────────────────────────
  // 검수 치명 "확인 후 발행" 경계 (2026-07-28 서수란 접수)
  //
  // 이미지만 올린 DM이 footer 부재로 영구히 막히던 것을 풀면서, **무엇을 넘길 수 있는가**의
  // 경계를 코드로 고정한다. 이 경계가 조용히 넓어지면 URL이 빈 CTA나 지나간 카운트다운까지
  // 넘기고 발행돼 고객이 깨진 DM을 그대로 발송한다.
  // ────────────────────────────────────────────────────────────────────────
  describe('검수 치명 무시 경계 — 법정 고지 판단만 넘길 수 있다', () => {
    const sec = (type: string, props: any = {}, id = `s-${type}`) =>
      ({ id, type, visible: true, props } as any);

    it('footer 부재(required_info) = 치명이지만 넘길 수 있다 → blocking 0', async () => {
      const r = await validateDm({ sections: [sec('text', { text: '안내문' })] });
      const footerItem = r.items.find((i) => i.area === 'required_info' && i.message.includes('Footer'));
      expect(footerItem, 'footer 부재 치명이 사라짐').toBeTruthy();
      expect(footerItem!.severity).toBe('fatal');
      expect(footerItem!.overridable, 'footer 부재를 넘길 수 없게 되면 이미지 전용 DM이 다시 영구 차단된다').toBe(true);
      expect(r.stats.blocking, '넘길 수 있는 치명만 있는데 blocking이 잡히면 확인 후 발행 버튼이 안 뜬다').toBe(0);
      expect(r.can_publish, 'can_publish 의미는 그대로 — 치명이 있으면 false').toBe(false);
    });

    it('CTA URL 빈칸(link) = 넘길 수 없다 → blocking 1 이상', async () => {
      const r = await validateDm({
        sections: [sec('cta', { buttons: [{ label: '자세히', url: '' }] })],
      });
      const linkItem = r.items.find((i) => i.area === 'link' && i.severity === 'fatal');
      expect(linkItem, 'CTA URL 빈칸 치명이 사라짐').toBeTruthy();
      expect(linkItem!.overridable, '오작동을 넘길 수 있게 되면 고객이 깨진 DM을 발송한다').not.toBe(true);
      expect(r.stats.blocking).toBeGreaterThan(0);
    });

    it('넘길 수 없는 치명이 섞이면 blocking > 0 — 부분 무시를 허용하지 않는다', async () => {
      const r = await validateDm({
        sections: [sec('cta', { buttons: [{ label: 'x', url: '' }] })], // footer 부재(넘김 가능) + CTA 빈 URL(불가)
      });
      expect(r.items.some((i) => i.overridable === true), '넘길 수 있는 치명도 함께 있어야 하는 시나리오').toBe(true);
      expect(r.stats.blocking, '하나라도 넘길 수 없으면 확인 후 발행이 막혀야 한다').toBeGreaterThan(0);
    });

    it('넘길 수 있는 치명은 required_info 영역뿐 — 다른 영역으로 번지지 않았는가', async () => {
      const r = await validateDm({
        sections: [
          sec('cta', { buttons: [{ label: 'x', url: '' }] }),
          sec('coupon', { discount_label: '' }, 's-coupon'),
          sec('countdown', { ends_at: '' }, 's-cd'),
        ],
      });
      const overridableAreas = [...new Set(r.items.filter((i) => i.overridable === true).map((i) => i.area))];
      expect(overridableAreas, '무시 허용 영역이 required_info 밖으로 번졌다').toEqual(['required_info']);
    });

    it('검수 모달은 blocking이 0일 때만 "확인 후 발행"을 띄운다 (소스 계약)', () => {
      const src = readFileSync(
        resolve(process.cwd(), '../frontend/src/components/dm/modals/ValidationModal.tsx'),
        'utf8',
      );
      expect(
        /blockingCount\s*===\s*0/.test(src),
        'blocking 0 조건이 사라지면 넘길 수 없는 치명까지 무시하고 발행된다',
      ).toBe(true);
      expect(
        /overridable\s*!==\s*true/.test(src),
        'overridable 미지정을 넘길 수 있는 것으로 취급하면 기본값이 위험한 쪽으로 뒤집힌다',
      ).toBe(true);
    });

    it('무시 기록은 발행 시 서버가 남긴다 (소스 계약)', () => {
      const src = readFileSync(resolve(process.cwd(), 'src/routes/dm.ts'), 'utf8');
      const publishBody = src.slice(src.indexOf("dmRouter.post('/:id/publish'"));
      expect(
        /validation_override/.test(publishBody) && /overridden_by/.test(publishBody),
        '무시 기록이 빠지면 "고객이 확인하고 발행했다"는 근거가 남지 않는다',
      ).toBe(true);
    });
  });
});
