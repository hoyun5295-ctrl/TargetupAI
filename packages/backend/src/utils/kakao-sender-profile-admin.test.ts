/**
 * 발신 프로필 사용 중지 — 슈퍼관리자 관리 기능 (★2026-09-12 직원 접수 4번)
 *
 * 왜 삭제가 아니라 사용 중지인가
 *   `campaigns.kakao_profile_id`가 ON DELETE 없이 이 표를 참조한다(0912 pg_constraint 실측).
 *   그 프로필로 발송한 캠페인이 하나라도 있으면 **하드 삭제는 영원히 불가능**하고,
 *   억지로 지우려면 발송·정산 원장인 캠페인을 지워야 한다. 게다가 `brand_message_templates`는
 *   CASCADE라 경고 없이 함께 사라진다.
 *
 * 못 박는 것:
 *   1. 하드 삭제를 하지 않는다. 캠페인·템플릿·브랜드 템플릿은 그대로 남는다.
 *   2. 중지하면 목록에서 사라진다 — 그래야 "삭제해달라"는 접수가 실제로 닫힌다.
 *   3. 누가 중지했는지 남는다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn(), mysqlQuery: vi.fn(), pool: { connect: vi.fn() } }));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { query } from '../config/database';
import { disableSenderProfile } from './kakao-sender-profile-admin';

const q = query as unknown as ReturnType<typeof vi.fn>;
const REQ: any = { ip: '119.203.154.248', headers: { 'user-agent': 'vitest-agent' } };
const ACTOR = '33333333-3333-3333-3333-333333333333';
const PROFILE = '44444444-4444-4444-4444-444444444444';

const ROW = {
  id: PROFILE, company_id: 'c1', company_name: '티앤비소프트',
  profile_name: '한빛주택종합관리', yellow_id: '@hanbit2022',
  profile_key: 'a5c477aa13f663ffa2a6f04e012c3a30997a69151',
  status: 'A', is_active: true, template_count: 2, brand_template_count: 0,
};

function wire(row: any = ROW) {
  q.mockReset();
  q.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (/FROM kakao_sender_profiles/i.test(s)) return { rows: row ? [row] : [] };
    if (/UPDATE kakao_sender_profiles/i.test(s)) return { rows: [{ id: PROFILE }], rowCount: 1 };
    return { rows: [] };
  });
}

describe('발신 프로필 사용 중지', () => {
  beforeEach(() => wire());

  it('없는 프로필이면 아무것도 바꾸지 않는다', async () => {
    wire(null);
    const r = await disableSenderProfile({ profileId: PROFILE, actorUserId: ACTOR, req: REQ });
    expect(r).toEqual({ ok: false, reason: 'not_found' });
    expect(q.mock.calls.some(([sql]: any[]) => /UPDATE|DELETE/i.test(String(sql)))).toBe(false);
  });

  it('★하드 삭제를 하지 않는다 — 캠페인·템플릿 원장을 건드리지 않는다', async () => {
    await disableSenderProfile({ profileId: PROFILE, actorUserId: ACTOR, req: REQ });
    expect(q.mock.calls.some(([sql]: any[]) => /DELETE\s+FROM/i.test(String(sql)))).toBe(false);
  });

  it('★중지하면 상태와 활성 플래그를 함께 내린다', async () => {
    const r: any = await disableSenderProfile({ profileId: PROFILE, actorUserId: ACTOR, req: REQ });
    expect(r.ok).toBe(true);
    const upd = q.mock.calls.find(([sql]: any[]) => /UPDATE kakao_sender_profiles/i.test(String(sql)));
    expect(String(upd[0])).toMatch(/status\s*=/);
    expect(String(upd[0])).toMatch(/is_active\s*=\s*false/);
  });

  it('★누가 어느 프로필을 중지했는지 남는다', async () => {
    await disableSenderProfile({ profileId: PROFILE, actorUserId: ACTOR, req: REQ });
    const audit = q.mock.calls.find(([sql]: any[]) => /INSERT INTO audit_logs/i.test(String(sql)));
    expect(audit, '감사 기록이 없다').toBeTruthy();
    const p = audit[1];
    expect(p[0]).toBe(ACTOR);
    expect(p[1]).toBe('kakao_profile_disabled');
    const detail = JSON.parse(p[4]);
    expect(detail.profile_name).toBe('한빛주택종합관리');
    expect(detail.company_name).toBe('티앤비소프트');
    expect(detail.yellow_id).toBe('@hanbit2022');
    expect(detail.template_count).toBe(2);
  });

  it('이미 중지된 프로필은 다시 중지하지 않는다', async () => {
    wire({ ...ROW, is_active: false, status: 'DELETED' });
    const r = await disableSenderProfile({ profileId: PROFILE, actorUserId: ACTOR, req: REQ });
    expect(r).toEqual({ ok: false, reason: 'already_disabled' });
    expect(q.mock.calls.some(([sql]: any[]) => /UPDATE kakao_sender_profiles/i.test(String(sql)))).toBe(false);
  });
});

describe('[소스 스캔] 하드 삭제 경로와 목록 필터', () => {
  const ROOT = resolve(__dirname, '..');
  const admin = readFileSync(resolve(ROOT, 'routes/admin.ts'), 'utf8');
  const alimtalk = readFileSync(resolve(ROOT, 'routes/alimtalk.ts'), 'utf8');
  const companies = readFileSync(resolve(ROOT, 'routes/companies.ts'), 'utf8');

  it('★슈퍼관리자 경로에 프로필 하드 삭제가 남아 있지 않다', () => {
    expect(admin).not.toMatch(/DELETE FROM kakao_sender_profiles/);
  });

  it('★슈퍼관리자 중지는 판정 CT를 부른다 — 라우트가 직접 UPDATE하지 않는다', () => {
    expect(admin).toMatch(/disableSenderProfile\(/);
  });

  /**
   * 중지해도 목록에 그대로 보이면 "삭제해달라"는 접수가 닫히지 않는다.
   * ⛔ 중복 연결 가드(profile_key·yellow_id 조회)에는 이 조건을 넣지 않는다 —
   *   중지된 프로필의 키를 다른 고객사가 다시 연결하면 안 되기 때문이다.
   */
  /**
   * 박성용 과장 0912: "이력 아예 삭제가 아닌 **관리를 위해서 사용불가 표기**".
   *   슈퍼 화면에서까지 사라지면 그건 삭제와 같다 — 슈퍼는 보이고, 고객사에서만 숨긴다.
   */
  it('★고객사 프로필 목록은 중지된 것을 숨긴다', () => {
    const companyScoped = alimtalk.slice(
      alimtalk.indexOf('SELECT p.* FROM kakao_sender_profiles p'),
      alimtalk.indexOf('SELECT p.* FROM kakao_sender_profiles p') + 250);
    expect(companyScoped, '고객사 목록이 중지분을 그대로 보여준다').toMatch(/is_active/);
    const companyList = companies.slice(
      companies.indexOf('SELECT id, profile_key, profile_name, is_active, created_at'),
      companies.indexOf('SELECT id, profile_key, profile_name, is_active, created_at') + 250);
    expect(companyList, '고객사 화면 목록이 중지분을 그대로 보여준다').toMatch(/WHERE company_id = \$1 AND COALESCE\(is_active/);
  });

  it('★슈퍼 목록은 중지된 것도 보여준다 — 관리하려면 보여야 한다', () => {
    const superScoped = alimtalk.slice(
      alimtalk.indexOf('SELECT p.*, c.company_name'),
      alimtalk.indexOf('SELECT p.*, c.company_name') + 250);
    expect(superScoped, '슈퍼 목록에서 중지분이 사라진다').not.toMatch(/is_active/);
  });

  /**
   * 접수 2단계 = 사용불가 표기 **뒤에 재등록**(박성용 과장 0912).
   * 중지된 옛 프로필이 채널ID를 붙들고 있으면 같은 채널을 다시 등록할 수 없다.
   * ⛔ 발신키(profile_key) 전역 가드는 좁히지 않는다 — 재등록은 새 키를 받으므로 충돌하지 않는다.
   */
  it('★채널ID 중복 검사는 활성 프로필만 본다 — 중지 뒤 같은 채널 재등록이 막히지 않는다', () => {
    const dup = alimtalk.slice(alimtalk.indexOf('const dup = await query('), alimtalk.indexOf('const dup = await query(') + 400);
    expect(dup, '채널ID 중복 검사를 못 찾았다').toMatch(/yellow_id/);
    expect(dup, '중지된 프로필까지 중복으로 본다').toMatch(/is_active/);
  });
});

/**
 * [소스 스캔] 화면 배선 — 슈퍼 발신프로필 화면에서 사용 중지를 누를 수 있어야 접수가 닫힌다.
 * 못 박는 것: 중지된 프로필은 버튼 대신 '사용불가'로 표기된다(관리 목적 · 박성용 과장 0912).
 */
describe('[소스 스캔] 발신프로필 화면 배선', () => {
  const fe = readFileSync(
    resolve(__dirname, '../../../frontend/src/components/alimtalk/AlimtalkSendersSection.tsx'), 'utf8');

  it('★사용 중지 버튼이 슈퍼 관리 endpoint를 부른다', () => {
    expect(fe).toMatch(/disableSender\(/);
    expect(fe).toMatch(/\/api\/admin\/kakao-profiles\/\$\{s\.id\}/);
    expect(fe).toMatch(/method: 'DELETE'/);
  });

  it('★중지된 프로필은 사용불가로 표기된다 — 화면에서 사라지지 않는다', () => {
    expect(fe).toMatch(/사용불가/);
    expect(fe).toMatch(/s\.is_active === false/);
  });

  it('네이티브 확인창을 쓰지 않는다 — 공용 확인 모달만', () => {
    expect(fe).not.toMatch(/window\.confirm|[^.\w]confirm\(['"`]/);
    expect(fe).toMatch(/setConfirm\(\{/);
  });
});
