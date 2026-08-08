/**
 * 모바일 DM 발행 중지 / 재개 (★ 2026-08-06 · 서수란 접수 "모바일DM 관리에 대한 정지 버튼 생성 요청").
 *
 * 접수 = 업체 사정(행사 종료 등)으로 발행한 DM에 고객이 못 들어오게 막고 싶은데 방법이 없다.
 *   삭제는 답이 아니다 — 접수 그대로 "삭제를 하면 이력 자체가 사라지기 때문에 이력은 남기고 정지".
 *
 * 이 기능이 성립하는 조건은 셋이고, 셋 다 여기서 밟는다.
 *  ① 뷰어가 `published`만 연다 — 이 조건이 사라지면 상태를 옮겨도 고객이 계속 들어온다.
 *  ② 전이는 **조건부 UPDATE 한 문장**이다 — 바뀐 행이 없으면 성공이라 답하지 않는다(6원칙 ②).
 *  ③ 발행 라우트가 중지분을 거른다 — 화면 [발행 주소 복사]가 그 엔드포인트를 부르므로,
 *     막지 않으면 주소를 복사하는 순간 중지가 조용히 풀린다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../../config/database', () => ({ query: vi.fn(async () => ({ rows: [] })) }));
import { query } from '../../config/database';
import { stopDm, resumeDm, isDmStoppedByCode, getDmByCode, DM_TRANSITION_BLOCK_MESSAGES } from './dm-builder';

const qmock = query as unknown as ReturnType<typeof vi.fn>;
const norm = (s: string) => s.replace(/\s+/g, ' ');

describe('DM 발행 중지 / 재개 (2026-08-06)', () => {
  beforeEach(() => {
    qmock.mockClear();
    qmock.mockResolvedValue({ rows: [] });
  });

  describe('① 뷰어는 published만 연다 — 중지가 효력을 갖는 유일한 근거', () => {
    it('getDmByCode에 published 조건이 있다', async () => {
      await getDmByCode('dm-abc1234');
      const [sql] = qmock.mock.calls[0] as [string, any[]];
      expect(
        norm(sql),
        '이 조건이 빠지면 상태를 stopped로 옮겨도 고객이 계속 들어온다',
      ).toContain("status = 'published'");
    });
  });

  describe('② 전이는 조건부 UPDATE — 대상이 아니면 바꾸지 않고 null', () => {
    it('stopDm은 published 행만 stopped로 바꾸고, 충돌 판정까지 한 문장에 담는다', async () => {
      qmock.mockResolvedValue({ rows: [{ updated: { id: 'd1', short_code: 'abc1234', status: 'stopped' }, cur_status: 'stopped', ab_running: false }] });
      const { row, block } = await stopDm('d1', 'c1');
      const [sql, params] = qmock.mock.calls[0] as [string, any[]];
      expect(norm(sql)).toContain("SET status = 'stopped'");
      expect(norm(sql), '발행분만 중지 대상이다(임시저장·이미 중지분 제외)').toContain("AND status = 'published'");
      expect(norm(sql), '회사 격리가 빠지면 남의 회사 DM을 내릴 수 있다').toContain('company_id = $2');
      // ★ Codex 3R high — 판정을 별도 SELECT로 빼면 그 사이 A/B가 시작돼 running 테스트가 중지분을 참조한다.
      expect(norm(sql), '충돌 판정이 UPDATE 밖에 있으면 TOCTOU 창이 생긴다').toContain('NOT EXISTS');
      expect(norm(sql)).toContain('FROM dm_ab_tests');
      expect(qmock.mock.calls.length, '전이·사유 판정은 문장 하나로 끝난다 — 별도 쿼리가 있으면 안 된다').toBe(1);
      expect(params).toEqual(['d1', 'c1']);
      expect(row?.status).toBe('stopped');
      expect(block).toBeNull();
    });

    it('stopDm은 바뀐 행이 없으면 row=null + 같은 스냅샷의 사유 태그 — 호출부가 성공이라 답하지 않는다', async () => {
      qmock.mockResolvedValue({ rows: [{ updated: null, cur_status: 'draft', ab_running: false }] });
      expect(await stopDm('d1', 'c1')).toEqual({ row: null, block: 'not_published' });
    });

    it('resumeDm은 stopped 행만 published로 되돌리고, 추첨 완료 판정을 한 문장에 담는다', async () => {
      qmock.mockResolvedValue({ rows: [{ updated: { id: 'd1', short_code: 'abc1234', status: 'published' }, cur_status: 'published', drawn: false }] });
      const { row, block } = await resumeDm('d1', 'c1');
      const [sql, params] = qmock.mock.calls[0] as [string, any[]];
      expect(norm(sql)).toContain("SET status = 'published'");
      expect(norm(sql), '중지분만 재개 대상이다').toContain("AND status = 'stopped'");
      // 판정이 밖에 있으면 조회와 UPDATE 사이에 5분 워커가 추첨을 claim해 "추첨된 행사가 다시 열린" 상태가 된다.
      expect(norm(sql), '추첨 판정이 UPDATE 밖에 있으면 TOCTOU 창이 생긴다').toContain('FROM dm_draw_runs');
      expect(qmock.mock.calls.length, '전이는 문장 하나로 끝난다').toBe(1);
      expect(params).toEqual(['d1', 'c1']);
      expect(row?.status).toBe('published');
      expect(block).toBeNull();
    });

    it('resumeDm은 바뀐 행이 없으면 row=null + 사유 태그', async () => {
      qmock.mockResolvedValue({ rows: [{ updated: null, cur_status: 'published', drawn: false }] });
      expect(await resumeDm('d1', 'c1')).toEqual({ row: null, block: 'not_stopped' });
    });

    it('재개는 단축코드를 새로 발급하지 않는다 — 주소가 바뀌면 이미 나간 문자가 죽는다', async () => {
      qmock.mockResolvedValue({ rows: [{ updated: { id: 'd1', short_code: 'abc1234', status: 'published' }, cur_status: 'published', drawn: false }] });
      await resumeDm('d1', 'c1');
      const sqls = qmock.mock.calls.map((c: any[]) => norm(String(c[0])));
      expect(sqls.some((s) => s.includes('short_code = $')), '재개가 short_code를 쓰면 안 된다').toBe(false);
      expect(qmock.mock.calls.length, '재개는 문장 하나로 끝난다').toBe(1);
    });
  });

  describe('③ 고객 문구 — 없는 코드와 내린 코드는 다른 말을 한다', () => {
    it('isDmStoppedByCode는 dm- 접두를 벗기고 stopped만 본다', async () => {
      qmock.mockResolvedValue({ rows: [{ '?column?': 1 }] });
      expect(await isDmStoppedByCode('dm-abc1234')).toBe(true);
      const [sql, params] = qmock.mock.calls[0] as [string, any[]];
      expect(norm(sql)).toContain("status = 'stopped'");
      expect(params[0], '공개 URL은 dm- 접두가 붙어 오는데 저장값에는 없다').toBe('abc1234');
    });

    it('중지분이 아니면 false — 없는 코드는 기존 문구로 간다', async () => {
      qmock.mockResolvedValue({ rows: [] });
      expect(await isDmStoppedByCode('dm-zzzz')).toBe(false);
    });
  });

  /**
   * ★ Codex 적대검증 high 3건 (0806) — 뷰어 하나만 막고 **옆문 셋을 열어 뒀다.**
   *   실발송·테스트발송은 DM을 id로 읽어 `short_code`만 쓰고 상태를 안 봤고(중지분으로 잔액이 나가고
   *   고객에게 404 링크가 전송된다), A/B 공개 URL도 id로만 렌더했다.
   *   "이 DM이 지금 공개 중인가"를 묻는 자리가 여럿이라는 것이 뿌리다 — 길목을 세어 전부 막는다.
   */
  describe('④ 링크가 나가는 길목 전수 — 뷰어 하나만 막으면 옆문이 열려 있다', () => {
    const routeSrc = readFileSync(resolve(__dirname, '../../routes/dm.ts'), 'utf8');
    const abSrc = readFileSync(resolve(__dirname, './dm-ab-test.ts'), 'utf8');
    /** 라우트 핸들러 본문만 잘라낸다 — 고정 길이 슬라이스는 남의 코드를 검사한다(0801 교훈). */
    const handlerBody = (marker: string) => {
      const from = routeSrc.indexOf(marker);
      expect(from, `${marker} 라우트가 없다`).toBeGreaterThan(0);
      const next = routeSrc.indexOf('dmRouter.', from + marker.length);
      return routeSrc.slice(from, next > 0 ? next : undefined);
    };

    it('publish 경로에 stopped 가드와 DM_STOPPED 코드가 있다', () => {
      expect(
        handlerBody("dmRouter.post('/:id/publish'"),
        '이 가드가 없으면 화면의 [발행 주소 복사] 한 번으로 중지가 풀린다(그 버튼이 publish를 부른다)',
      ).toContain('DM_STOPPED');
    });

    it('실발송(send-to-target)이 중지분을 거절한다 — 잔액이 나가기 전에', () => {
      const body = handlerBody("dmRouter.post('/:id/send-to-target'");
      expect(body, '중지분 발송이 열려 있으면 고객에게 종료된 404 링크가 실제로 전송된다').toContain('DM_STOPPED');
      const guardAt = body.indexOf('DM_STOPPED');
      const feeAt = body.indexOf('publishFeeGate');
      expect(feeAt, '발행비 게이트를 못 찾았다 — 이 검사가 무효다').toBeGreaterThan(0);
      expect(guardAt, '가드가 발행비 처리보다 뒤면 잔액이 먼저 나간다').toBeLessThan(feeAt);
    });

    it('테스트 발송도 중지분을 거절한다 — short_code는 중지돼도 남는다', () => {
      expect(handlerBody("dmRouter.post('/:id/test-send'")).toContain('DM_STOPPED');
    });

    it('A/B 공개 뷰어가 같은 회사의 published만 렌더한다', () => {
      const body = handlerBody("dmPublicRouter.get('/ab/:code'");
      expect(
        body,
        'id로만 읽으면 중지한 variant가 A/B 주소로 계속 노출된다',
      ).toContain("status = 'published'");
      expect(
        norm(body),
        'variant에 타사 UUID가 들어가면 이 공개 주소가 그 회사 DM을 렌더한다(Codex 2R critical)',
      ).toContain('company_id = $2');
    });

    it('중지·재개 라우트는 전이 문장이 돌려준 사유 태그만 쓴다 — 별도 사유 조회가 없다', () => {
      // ★ Codex 4R medium — 0행 뒤 별도 SELECT로 원인을 다시 물으면 경합 시 엉뚱한 사유를 지목한다.
      //   사유는 전이 문장의 같은 스냅샷이 판정한다(dm-builder). 조회 함수가 되살아나면 회귀다.
      expect(routeSrc, '별도 사유 조회가 되살아났다').not.toContain('findDmTransitionBlock');
      for (const marker of ["dmRouter.post('/:id/stop'", "dmRouter.post('/:id/resume'"]) {
        const body = handlerBody(marker);
        const transitionAt = Math.max(body.indexOf('await stopDm('), body.indexOf('await resumeDm('));
        expect(transitionAt, `${marker}: 전이 호출을 못 찾았다`).toBeGreaterThan(0);
        expect(body, `${marker}: 문구는 CT 메시지 표에서 나온다`).toContain('DM_TRANSITION_BLOCK_MESSAGES');
      }
    });

    it('A/B 시작이 중지분을 거절한다', () => {
      expect(
        abSrc,
        'short_code만 보면 이미 내린 DM으로 새 A/B를 시작할 수 있다',
      ).toContain("AND status = 'published'");
    });

    it('중지·재개 라우트가 소유권 가드를 지난다', () => {
      const stopIdx = routeSrc.indexOf("dmRouter.post('/:id/stop'");
      const resumeIdx = routeSrc.indexOf("dmRouter.post('/:id/resume'");
      expect(stopIdx, '중지 라우트가 없다').toBeGreaterThan(0);
      expect(resumeIdx, '재개 라우트가 없다').toBeGreaterThan(0);
      // 각 핸들러 본문(다음 라우트 선언 전까지)에 canAccessDm이 있어야 한다.
      const stopBody = routeSrc.slice(stopIdx, resumeIdx);
      const resumeBody = routeSrc.slice(resumeIdx, resumeIdx + 1200);
      expect(stopBody, '소유권 가드 없이 중지하면 남의 DM을 내릴 수 있다').toContain('canAccessDm');
      expect(resumeBody, '소유권 가드 없이 재개하면 남의 DM을 다시 열 수 있다').toContain('canAccessDm');
    });
  });

  /**
   * ★ Codex 적대검증 2R — 상태 하나(stopped)를 만들었더니 그것을 소비해야 하는 축이 넷이었다
   *   (공개 노출·발송·A/B 실행·이벤트 수명주기). 축마다 가드를 덧대면 라운드마다 새 구멍이 난다.
   *   **충돌하는 상태에서는 전이 자체를 거절**하는 쪽이 가드를 늘리지 않고 약속도 지킨다.
   */
  describe('⑥ 충돌 상태에서는 전이를 거절한다 — 사유는 전이 문장의 같은 스냅샷이 판정한다(4R medium)', () => {
    it('진행 중 A/B에 포함된 DM은 중지를 막는다', async () => {
      qmock.mockResolvedValue({ rows: [{ updated: null, cur_status: 'published', ab_running: true }] });
      const r = await stopDm('d1', 'c1');
      expect(r.block, 'running A/B variant를 중지하면 그 비율의 방문자만 종료 페이지를 받는다').toBe('ab_running');
      expect(DM_TRANSITION_BLOCK_MESSAGES[r.block!]).toContain('A/B');
      const [sql, params] = qmock.mock.calls[0] as [string, any[]];
      expect(norm(sql)).toContain("status = 'running'");
      expect(norm(sql), 'variant 3칸을 모두 봐야 한다').toContain('t.variant_a_page_id, t.variant_b_page_id, t.variant_c_page_id');
      expect(params).toEqual(['d1', 'c1']);
      expect(qmock.mock.calls.length, '사유 판정에 두 번째 쿼리를 쓰면 스냅샷이 갈려 엉뚱한 사유를 지목한다').toBe(1);
    });

    it('이미 추첨이 끝난 행사는 재개를 막는다 — 당첨될 수 없는 응모를 받게 된다', async () => {
      qmock.mockResolvedValue({ rows: [{ updated: null, cur_status: 'stopped', drawn: true }] });
      const r = await resumeDm('d1', 'c1');
      expect(r.block).toBe('drawn');
      expect(DM_TRANSITION_BLOCK_MESSAGES[r.block!]).toContain('추첨');
      const [sql] = qmock.mock.calls[0] as [string, any[]];
      expect(norm(sql)).toContain('FROM dm_draw_runs');
      expect(qmock.mock.calls.length).toBe(1);
    });

    it('스냅샷상 막을 것이 없는데 0행이면 원인을 단정하지 않는다(race)', async () => {
      qmock.mockResolvedValue({ rows: [{ updated: null, cur_status: 'published', ab_running: false }] });
      expect((await stopDm('d1', 'c1')).block).toBe('race');
    });

    it('행이 없으면 not_found', async () => {
      qmock.mockResolvedValue({ rows: [{ updated: null, cur_status: null, ab_running: false }] });
      expect((await stopDm('d1', 'c1')).block).toBe('not_found');
    });
  });

  /**
   * ★ Codex 적대검증 high — 중지가 **추첨까지 취소하면 안 된다.**
   * 중지의 대표 용도가 행사 종료라서, 마감 직전에 내리면 응모는 이미 받아 두고 당첨자만 안 뽑히는 상태가 된다.
   * 공개 상태와 추첨 생명주기는 다른 축이다.
   */
  describe('⑤ 중지는 접속만 막는다 — 이미 받은 응모의 추첨은 그대로 돈다', () => {
    it('마감 추첨 후보에 stopped가 포함된다', async () => {
      const { loadDrawableLuckyDraws } = await import('./dm-interaction');
      qmock.mockResolvedValue({ rows: [] });
      await loadDrawableLuckyDraws();
      const [sql] = qmock.mock.calls[0] as [string, any[]];
      expect(
        norm(sql),
        '중지분을 후보에서 빼면 마감 직전에 내린 행사의 당첨자가 조용히 선정되지 않는다',
      ).toContain("status IN ('published', 'stopped')");
    });
  });

  /**
   * ★ Codex 4R high (0806 트랙 잔여 · 2026-08-08 반영) — stop·resume·A/B 시작·추첨 claim의 교차 테이블
   *   경쟁을 NOT EXISTS가 원자화하지 못한다는 지적. per-DM 잠금 공사 대신 **실제 피해가 생기는 길목
   *   하나(응모 제출)를 막는다** — 추첨은 1회뿐이라 claim 이후의 응모는 당첨될 수 없다.
   *   판정은 INSERT와 같은 문장 안이다(밖이면 5분 워커 claim과 TOCTOU).
   */
  describe('⑦ 추첨이 끝난 lucky_draw는 응모를 받지 않는다 — 판정은 INSERT와 같은 문장', () => {
    const submitLuckyDraw = async () => {
      const { submitEventResponse } = await import('./dm-interaction');
      return submitEventResponse({
        code: 'dm-abc1234', sectionId: 's1', sectionType: 'lucky_draw',
        data: { consent: true }, anonymousId: 'anon-1', token: null, phone: null, ip: null, ua: null,
      });
    };
    const dispatch = (insertRows: any[]) => {
      qmock.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM dm_pages')) return { rows: [{ id: 'dm1', company_id: 'c1' }] };
        if (sql.includes('INSERT INTO dm_event_responses')) return { rows: insertRows };
        return { rows: [] };
      });
    };

    it('추첨(claim) 이후의 응모는 409 — 받은 척하지 않는다', async () => {
      dispatch([]);
      const r = await submitLuckyDraw();
      expect(r.ok).toBe(false);
      expect(r.status).toBe(409);
      expect(r.error, '고객에게 사실대로 알린다').toContain('추첨');
      const insCall = qmock.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO dm_event_responses'));
      expect(insCall, '제출 INSERT를 못 찾았다').toBeTruthy();
      const [sql, params] = insCall as [string, any[]];
      expect(norm(sql), '판정이 INSERT 밖이면 5분 워커 claim과 TOCTOU').toContain('FROM dm_draw_runs');
      expect(norm(sql), '가드 축은 별도 boolean 파라미터다(한 파라미터 이중 문맥 = 42P08 부류)').toContain('$10::boolean = false');
      expect(params[9], 'lucky_draw는 가드가 켜진다').toBe(true);
    });

    it('추첨 전 응모는 그대로 접수된다', async () => {
      dispatch([{ id: 'r1' }]);
      const r = await submitLuckyDraw();
      expect(r.ok).toBe(true);
    });

    it('lucky_draw가 아니면 가드가 꺼진다 — 같은 캠페인의 다른 섹션 응답이 막히면 안 된다', async () => {
      dispatch([{ id: 'r2' }]);
      const { submitEventResponse } = await import('./dm-interaction');
      const r = await submitEventResponse({
        code: 'dm-abc1234', sectionId: 's2', sectionType: 'survey',
        data: {}, anonymousId: 'anon-1', token: null, phone: null, ip: null, ua: null,
      });
      expect(r.ok).toBe(true);
      const insCall = qmock.mock.calls.find((c: any[]) => String(c[0]).includes('INSERT INTO dm_event_responses'));
      expect((insCall as [string, any[]])[1][9], '다른 섹션 유형은 가드 파라미터가 꺼져 있어야 한다').toBe(false);
    });
  });
});
