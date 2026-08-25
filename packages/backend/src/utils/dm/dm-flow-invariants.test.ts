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
import { getDmList, restoreDmVersion, buildDmSnapshot, planDmRestore, DM_SNAPSHOT_KEYS } from './dm-builder';
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

  /**
   * ★ 2026-08-24 신설 — 접수 cmt6qug4s00v1jnotsqeaf12g(임은지) "버전 복원이 오류로 실패한다".
   * jsonb를 JS로 꺼냈다가 그대로 다시 파라미터로 넣으면, 드라이버가 **배열**을 PG 배열 리터럴 `{…}`로
   * 직렬화해 jsonb 컬럼이 거절한다(`invalid input syntax for type json`). `sections`가 배열이라 100% 실패했다.
   */
  describe('버전 복원은 jsonb를 문자열로 되돌린다', () => {
    it('sections 배열이 PG 배열 리터럴로 나가지 않는다', async () => {
      const sections = [{ id: 'a', type: 'header', order: 0 }, { id: 'b', type: 'hero', order: 1 }];
      const brandKit = { accent_color: '#C6A15B' };
      qmock.mockReset();
      qmock
        .mockResolvedValueOnce({ rows: [{ id: 'dm-1' }] })                       // 소유 확인
        .mockResolvedValueOnce({ rows: [{ sections, brand_kit: brandKit }] })    // 버전 읽기
        .mockResolvedValueOnce({ rows: [{ id: 'dm-1', sections }] });            // 되돌리기

      await restoreDmVersion('dm-1', 'v-1', 'co-1');

      const [sql, params] = qmock.mock.calls[2];
      expect(/UPDATE dm_pages SET /.test(String(sql))).toBe(true);
      // 되돌리는 순서는 DM_SNAPSHOT_KEYS 순서다(pages → sections → brand_kit)
      const idx = { pages: 0, sections: 1, brand_kit: 2 };
      expect(typeof params[idx.sections], 'sections를 배열 그대로 넘기면 jsonb가 거절한다').toBe('string');
      expect(JSON.parse(params[idx.sections])).toEqual(sections);
      expect(typeof params[idx.brand_kit], 'brand_kit도 같은 규약을 따른다').toBe('string');
      expect(JSON.parse(params[idx.brand_kit])).toEqual(brandKit);
    });

    it('값이 없던 버전은 없는 채로 되돌린다(빈 배열을 지어내지 않는다)', async () => {
      qmock.mockReset();
      qmock
        .mockResolvedValueOnce({ rows: [{ id: 'dm-1' }] })
        .mockResolvedValueOnce({ rows: [{ sections: null, brand_kit: null }] })
        .mockResolvedValueOnce({ rows: [{ id: 'dm-1' }] });

      await restoreDmVersion('dm-1', 'v-1', 'co-1');

      const [, params] = qmock.mock.calls[2];
      expect(params[0]).toBeNull();
      expect(params[1]).toBeNull();
    });
  });

  /**
   * ★ 2026-08-25 재오픈 — 같은 접수(임은지)가 "오류는 사라졌는데 화면이 안 바뀐다"로 돌아왔다.
   *
   * **뿌리**: 화면이 DM을 읽을 때는 `pages`를 우선한다(`extractPagesFromDm`). `pages`에 내용이 있으면
   * `sections` 컬럼은 아예 안 본다. 그런데 복원은 `sections`·`brand_kit`만 되돌렸다.
   * 운영 실측(2026-08-25) = DM 5건이 **전부** `pages`를 갖고 있어(scroll도 1페이지) 복원이 전 건 무효였다.
   * 어제 고친 직렬화는 붉은 오류만 없앴을 뿐 복원 자체는 아무 일도 하지 않았다.
   *
   * 그래서 스냅샷이 **화면을 만드는 상태 전부**를 담고, 복원이 그 전부를 되돌린다.
   */
  describe('버전 복원은 화면이 읽는 컬럼까지 되돌린다 (재오픈 회귀)', () => {
    const FULL_SNAPSHOT = {
      pages: [{ id: 'p1', sections: [{ id: 'a' }] }, { id: 'p2', sections: [{ id: 'b' }] }],
      sections: [{ id: 'a' }, { id: 'b' }],
      brand_kit: { accent_color: '#111111' },
      layout_mode: 'slides',
      header_data: { logo: 'x' },
      footer_data: {},
      header_template: 'v2',
      footer_template: 'default',
      settings: { theme: 'dark' },
    };

    it('새 스냅샷은 pages와 layout_mode까지 되돌린다', async () => {
      qmock.mockReset();
      qmock
        .mockResolvedValueOnce({ rows: [{ id: 'dm-1' }] })
        .mockResolvedValueOnce({ rows: [{ sections: FULL_SNAPSHOT.sections, brand_kit: FULL_SNAPSHOT.brand_kit, snapshot: FULL_SNAPSHOT }] })
        .mockResolvedValueOnce({ rows: [{ id: 'dm-1' }] });

      const out = await restoreDmVersion('dm-1', 'v-1', 'co-1');

      const [sql, params] = qmock.mock.calls[2];
      expect(String(sql), 'pages를 안 되돌리면 화면은 그대로다').toContain('pages = $1');
      expect(String(sql), '페이지 구조를 되돌리면 레이아웃 모드도 함께 가야 짝이 맞는다').toContain('layout_mode');
      expect(JSON.parse(params[0])).toEqual(FULL_SNAPSHOT.pages);
      expect(out?.mergedPages).toBe(false);
    });

    it('옛 스냅샷은 sections를 한 페이지로 감싸 pages에도 쓴다 — 안 그러면 화면에 안 보인다', async () => {
      const sections = [{ id: 'a' }, { id: 'b' }];
      qmock.mockReset();
      qmock
        .mockResolvedValueOnce({ rows: [{ id: 'dm-1' }] })
        .mockResolvedValueOnce({ rows: [{ sections, brand_kit: null, snapshot: null }] })
        .mockResolvedValueOnce({ rows: [{ id: 'dm-1' }] });

      const out = await restoreDmVersion('dm-1', 'v-1', 'co-1');

      const [sql, params] = qmock.mock.calls[2];
      expect(String(sql)).toContain('pages = $1');
      const pages = JSON.parse(params[0]);
      expect(pages).toHaveLength(1);
      expect(pages[0].sections).toEqual(sections);
      expect(out?.mergedPages, '페이지 경계가 없던 스냅샷은 합쳐졌다고 알려야 한다').toBe(true);
    });

    it('내용이 없던 옛 버전은 pages를 덮지 않는다 — 정보가 없는데 화면을 비우지 않는다', async () => {
      qmock.mockReset();
      qmock
        .mockResolvedValueOnce({ rows: [{ id: 'dm-1' }] })
        .mockResolvedValueOnce({ rows: [{ sections: null, brand_kit: null, snapshot: null }] })
        .mockResolvedValueOnce({ rows: [{ id: 'dm-1' }] });

      const out = await restoreDmVersion('dm-1', 'v-1', 'co-1');

      const [sql] = qmock.mock.calls[2];
      // 테이블명이 `dm_pages`라 단순 포함 검사는 늘 참이 된다 — 대입 형태로 본다
      expect(String(sql)).not.toMatch(/\bpages = \$/);
      expect(String(sql)).toMatch(/\bsections = \$/);
      expect(out?.mergedPages).toBe(false);
    });
  });

  /**
   * ★ Codex 적대 1R high — 버전 저장·복원 라우트만 사용자별 소유 가드(`canAccessDm`, 0714 서수란 신고 정책)를
   * 빠뜨리고 있었다. 회사 격리는 "같은 회사 남의 DM"을 막지 못한다. 복원은 화면 상태를 통째로 덮는다.
   * 프론트 러너가 없어 소스 계약으로 가드 상주를 강제한다.
   */
  describe('버전 저장·복원도 사용자별 소유 가드를 지난다', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/routes/dm.ts'), 'utf8');
    const routeBody = (marker: string): string => {
      const at = src.indexOf(marker);
      expect(at, `${marker} 라우트가 사라졌다`).toBeGreaterThan(-1);
      const next = src.indexOf('\ndmRouter.', at + 10);
      return src.slice(at, next > -1 ? next : at + 2000);
    };

    /**
     * 가드는 **있기만 해서는 안 된다** — 결과를 보고 막아야 하고, 효과를 내는 호출보다 앞에 와야 한다.
     * (문자열 존재만 보는 단언은 가드를 뒤로 밀거나 반환값을 버려도 통과한다 · LESSONS_BACKEND 소스 스캔 한계)
     */
    const expectGuardedBefore = (marker: string, effectCall: string) => {
      const body = routeBody(marker);
      const guardAt = body.indexOf('if (!(await canAccessDm(');
      const denyAt = body.indexOf("res.status(403)", guardAt > -1 ? guardAt : 0);
      const effectAt = body.indexOf(effectCall);
      expect(guardAt, `${marker}: 결과를 보는 형태의 canAccessDm 가드가 없다`).toBeGreaterThan(-1);
      expect(denyAt, `${marker}: 가드가 막지 않고 통과시킨다`).toBeGreaterThan(guardAt);
      expect(effectAt, `${marker}: ${effectCall} 호출이 사라졌다`).toBeGreaterThan(-1);
      expect(effectAt, `${marker}: 가드가 ${effectCall} 뒤에 있으면 이미 늦었다`).toBeGreaterThan(guardAt);
    };

    it('목록 라우트가 조회 전에 막는다 — 목록도 sections·brand_kit을 돌려준다', () => {
      expectGuardedBefore(`dmRouter.get('/:id/versions'`, 'listDmVersions(');
    });

    it('스냅샷 저장 라우트가 읽기·쓰기 전에 막는다', () => {
      expectGuardedBefore(`dmRouter.post('/:id/versions'`, 'getDmDetail(');
    });

    it('복원 라우트가 덮어쓰기 전에 막는다', () => {
      expectGuardedBefore(`dmRouter.post('/:id/versions/:vid/restore'`, 'restoreDmVersion(');
    });

    it('저장 응답에 스냅샷·본문 컬럼을 싣지 않는다', () => {
      const body = routeBody(`dmRouter.post('/:id/versions'`);
      const jsonAt = body.indexOf('return res.json(');
      expect(jsonAt).toBeGreaterThan(-1);
      const responded = body.slice(jsonAt, jsonAt + 120);
      expect(responded, 'RETURNING * 를 그대로 돌려주면 화면 상태 전부가 매 저장마다 나간다').not.toMatch(/\bversion\s*\}/);
      // 응답 직전에 본문 세 컬럼을 덜어내는 구조 분해가 있어야 한다
      expect(body).toMatch(/snapshot:\s*_\w+[\s\S]*sections:\s*_\w+[\s\S]*brand_kit:\s*_\w+/);
    });
  });

  describe('스냅샷은 화면을 만드는 상태만 담는다', () => {
    it('메타(승인 상태·템플릿 참조·제목)는 담지 않는다 — 되돌리면 안 되는 값이다', () => {
      const snap = buildDmSnapshot({
        pages: [], sections: [], brand_kit: {}, layout_mode: 'scroll',
        header_data: {}, footer_data: {}, header_template: 'default', footer_template: 'default', settings: {},
        approval_status: 'published', template_id: 't1', ai_prompt: 'x', title: 'T', view_count: 9,
      });
      expect(Object.keys(snap).sort()).toEqual([...DM_SNAPSHOT_KEYS].sort());
      expect('approval_status' in snap).toBe(false);
      expect('view_count' in snap).toBe(false);
    });

    it('문자열로 온 jsonb는 파싱해서 담는다', () => {
      const snap = buildDmSnapshot({ pages: '[{"id":"p1","sections":[]}]', settings: '{"a":1}' });
      expect(snap.pages).toEqual([{ id: 'p1', sections: [] }]);
      expect(snap.settings).toEqual({ a: 1 });
    });

    it('스냅샷이 비어 있으면 옛 방식으로 내려간다 — 빈 객체를 새 스냅샷으로 오인하지 않는다', () => {
      const plan = planDmRestore({ snapshot: {}, sections: [{ id: 'a' }], brand_kit: null });
      expect(plan.values.pages, '빈 스냅샷을 믿으면 아무것도 안 되돌린다').toBeTruthy();
      expect(plan.mergedPages).toBe(true);
    });

    /**
     * ★ Codex 적대 1R medium — 키 하나만 보고 새 형식으로 받으면 부분 객체가 옛 방식 합성을 건너뛰어
     * **원래 결함(복원해도 화면이 안 바뀜)이 그대로 재현**된다. 전 키가 있어야 새 형식으로 믿는다.
     */
    it('부분 스냅샷은 새 형식으로 믿지 않는다 — sections만 든 객체가 pages 합성을 건너뛰면 안 된다', () => {
      const plan = planDmRestore({ snapshot: { sections: [{ id: 'a' }] }, sections: [{ id: 'a' }], brand_kit: null });
      expect(plan.values.pages, 'pages 없이 sections만 되돌리면 화면은 그대로다').toBeTruthy();
      expect(plan.mergedPages).toBe(true);
    });

    it('값이 null이어도 pages·sections 키가 있으면 새 형식이다', () => {
      const full: Record<string, any> = {};
      for (const k of DM_SNAPSHOT_KEYS) full[k] = null;
      full.sections = [{ id: 'a' }];
      const plan = planDmRestore({ snapshot: full, sections: [{ id: 'a' }] });
      expect(plan.mergedPages).toBe(false);
      expect(plan.values.pages).toBeNull();
    });

    /**
     * ★ Codex 적대 2R high — 1R 정정(전 키 존재 검사)이 만든 회귀. `DM_SNAPSHOT_KEYS`는 늘어나게 돼 있는데
     * 전수로 판정하면 키를 하나 더한 순간 **기존 스냅샷 전부가 옛 형식으로 떨어져** 이번에 고친 결함이 재현된다.
     * 그래서 판정 근거를 `pages`·`sections` 두 축으로 줄였다. 이 fixture가 그 계약을 고정한다.
     */
    it('키가 늘어난 뒤에도 옛 9키 스냅샷을 새 형식으로 읽는다 — 확장이 회귀가 되지 않는다', () => {
      const NINE_KEYS = ['pages', 'sections', 'brand_kit', 'layout_mode',
        'header_data', 'footer_data', 'header_template', 'footer_template', 'settings'];
      const old9: Record<string, any> = {};
      for (const k of NINE_KEYS) old9[k] = null;
      old9.pages = [{ id: 'p1', sections: [{ id: 'a' }] }];
      old9.layout_mode = 'slides';

      const plan = planDmRestore({ snapshot: old9, sections: [{ id: 'a' }] });
      expect(plan.mergedPages, '옛 형식으로 떨어지면 페이지 경계를 잃는다').toBe(false);
      expect(plan.values.pages).toEqual(old9.pages);
      expect(plan.values.layout_mode).toBe('slides');
      // 나중에 목록에 키가 더해져도, 그 키가 없는 옛 스냅샷은 그 컬럼만 안 건드린다
      for (const k of Object.keys(plan.values)) expect(NINE_KEYS).toContain(k);
    });

    it('pages·sections만 든 스냅샷도 새 형식이다 — 판정이 목록 길이에 매이지 않는다', () => {
      // 이 단언이 전 키 존재 검사(2R high의 회귀 형태)를 직접 막는다
      const plan = planDmRestore({
        snapshot: { pages: [{ id: 'p1', sections: [] }], sections: [] },
        sections: [{ id: 'a' }],
      });
      expect(plan.mergedPages).toBe(false);
      expect(Object.keys(plan.values).sort()).toEqual(['pages', 'sections']);
    });

    it('pages가 배열이 아니면 새 형식으로 믿지 않는다 — 되돌릴 물건이 아니다', () => {
      const broken: Record<string, any> = { pages: { id: 'p1' }, sections: [{ id: 'a' }] };
      const plan = planDmRestore({ snapshot: broken, sections: [{ id: 'a' }] });
      expect(plan.mergedPages, '옛 방식으로 내려가 안전한 값으로 되돌린다').toBe(true);
      expect(Array.isArray(plan.values.pages)).toBe(true);
    });
  });
});
