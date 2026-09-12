/**
 * 알림톡 검수 동기화 안전망 — 30분 목록 동기화 (★2026-09-12 직원 접수 4번 재발 방지)
 *
 * 무엇이 문제였나 (0912 실측)
 *   한빛주택종합관리 프로필이 휴머스온에서 휴면삭제되면서 발신키가 바뀌었다. 그러자
 *   5분 폴링의 **단건 조회**가 옛 키로 4011을 받고 그것을 아무 기록 없이 건너뛰었다.
 *   그 공백을 메워야 할 30분 목록 동기화는 **없는 컬럼(`imc_template_status`)을 첫 SELECT에 넣어
 *   함수 전체가 멎어 있었다.** 로그는 "활성상태 동기화 skip"이라 적어 축소 보고했다.
 *   살아 있었어도 목록 항목의 `inspectionStatus`를 읽지 않아 검수상태는 영원히 미반영이었다.
 *
 * 못 박는 것:
 *   1. 활성상태 컬럼이 없어도 **검수상태·반려사유 동기화는 돈다**. 한 컬럼이 함수를 통째로 멈추지 않는다.
 *   2. 목록으로 검수상태를 메운다 — 단, **진행 중인 행만**. 이미 종결된 행을 목록이 뒤집지 않는다.
 *   3. 단건 조회 실패는 기록에 남는다. 침묵이 6일을 만들었다.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/database', () => ({ query: vi.fn() }));
vi.mock('./alimtalk-api', () => ({ listAlimtalkTemplates: vi.fn() }));

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { query } from '../config/database';
import * as imc from './alimtalk-api';
import { syncTemplateStatuses } from './kakao-template-sync';

const q = query as unknown as ReturnType<typeof vi.fn>;
const list = imc.listAlimtalkTemplates as unknown as ReturnType<typeof vi.fn>;

/** 운영 실측 형태 — 진행 중 1행 + 종결 1행 */
const ROWS = [
  { id: 'r1', template_key: 'K1', template_code: 'B_HB_019_02_83850', status: 'REQUESTED', imc_template_status: null, reject_reason: null },
  { id: 'r2', template_key: 'K2', template_code: 'B_AA_001_02_10000', status: 'APPROVED', imc_template_status: 'A', reject_reason: null },
];

function wire(opts: { columnMissing?: boolean; items?: any[] } = {}) {
  q.mockReset();
  list.mockReset();
  q.mockImplementation(async (sql: string) => {
    const s = String(sql);
    if (/FROM kakao_templates/i.test(s)) {
      if (opts.columnMissing && /imc_template_status/.test(s)) {
        const err: any = new Error('column "imc_template_status" does not exist');
        err.code = '42703';
        throw err;
      }
      return { rows: ROWS.map((r) => ({ ...r })) };
    }
    if (/UPDATE kakao_templates/i.test(s)) return { rows: [{ id: 'x' }], rowCount: 1 };
    return { rows: [] };
  });
  list.mockResolvedValue({
    code: '0000',
    data: { list: opts.items ?? [] },
  });
}

const updates = () => q.mock.calls.filter(([sql]: any[]) => /UPDATE kakao_templates/i.test(String(sql)));

describe('30분 목록 동기화', () => {
  beforeEach(() => wire());

  it('★활성상태 컬럼이 없어도 검수상태 동기화는 계속 돈다', async () => {
    wire({ columnMissing: true, items: [{ templateKey: 'K1', inspectionStatus: 'HREJ', rejectReason: '가이드 위반' }] });
    const r = await syncTemplateStatuses();
    expect(r.skipped, '컬럼 하나 때문에 함수 전체가 멎었다').toBe(false);
    expect(updates().length).toBeGreaterThan(0);
  });

  it('★목록의 검수상태로 진행 중 행을 메운다 — 단건 조회가 실패해도 여기서 잡힌다', async () => {
    wire({ items: [{ templateKey: 'K1', inspectionStatus: 'HREJ', rejectReason: '가이드 위반', status: 'A' }] });
    await syncTemplateStatuses();
    const upd = updates().find(([, p]: any[]) => p.includes('r1'));
    expect(upd, '진행 중 행이 갱신되지 않았다').toBeTruthy();
    expect(String(upd[0])).toMatch(/status\s*=/);
    // IMC 6단계 어휘를 그대로 쓴다(D152-4) — HREJ는 HREJ로 남는다
    expect(upd[1]).toContain('HREJ');
  });

  it('★이미 종결된 행은 목록이 뒤집지 않는다', async () => {
    wire({ items: [{ templateKey: 'K2', inspectionStatus: 'REQ', status: 'A' }] });
    await syncTemplateStatuses();
    const upd = updates().find(([, p]: any[]) => p.includes('r2'));
    if (upd) expect(String(upd[0]), '종결 행의 검수상태를 건드렸다').not.toMatch(/status\s*=\s*\$1/);
  });

  it('검수상태가 목록에 없으면 검수상태를 건드리지 않는다', async () => {
    wire({ items: [{ templateKey: 'K1', status: 'S' }] });
    await syncTemplateStatuses();
    const upd = updates().find(([, p]: any[]) => p.includes('r1'));
    if (upd) expect(String(upd[0]), '검수상태를 건드렸다').not.toMatch(/(^|[\s,])status = \$/);
  });
});

describe('[소스 스캔] 조용한 건너뜀 제거', () => {
  const jobs = readFileSync(resolve(__dirname, './alimtalk-jobs.ts'), 'utf8');
  const sync = readFileSync(resolve(__dirname, './kakao-template-sync.ts'), 'utf8');

  it('★단건 조회 실패를 기록 없이 건너뛰지 않는다 (템플릿·발신프로필 두 경로)', () => {
    expect(jobs.match(/if \(res\.code !== '0000' \|\| !res\.data\) continue;/g) || [],
      '아무 기록 없이 건너뛰는 한 줄이 남아 있다').toHaveLength(0);
    // 두 경로 모두 건수를 센다 — 한쪽만 세면 그쪽만 보인다
    expect(jobs.match(/skippedByCode\.set\(/g) || [], '건너뛴 건수를 세지 않는 경로가 있다').toHaveLength(2);
  });

  it('★사이클마다 건너뛴 건수를 남긴다 — 침묵이 6일을 만들었다', () => {
    expect(jobs.match(/건너뜀 \$\{/g) || [], '사이클 요약에 건너뜀이 빠진 경로가 있다').toHaveLength(2);
    expect(jobs, '첫 건 상세가 없다').toMatch(/키 변경·삭제 가능성/);
  });

  it('★활성상태 컬럼이 없으면 그 컬럼 없이 다시 읽는다 — 함수가 멎지 않는다', () => {
    const seg = sync.slice(sync.indexOf('export async function syncTemplateStatuses'), sync.indexOf('// 1) IMC 전체 목록'));
    expect(seg, '컬럼 부재 폴백 조회가 없다').toMatch(/hasActiveCol = false[\s\S]{0,400}SELECT id, template_key, template_code, status, reject_reason/);
    expect(seg, '컬럼 하나로 함수 전체를 멈추는 경로가 남아 있다').not.toMatch(/skipped: true/);
  });
});

/**
 * ★ Codex 적대검토 1R(high 수용) — 진행 중 판정과 UPDATE 사이의 경쟁.
 * 진행 중 여부는 목록 페이지를 돌기 **전** SELECT 값으로 정한다. 그 사이 몇 분 동안
 * 5분 폴링이 APPROVED를 저장하면, 이 UPDATE가 id만 보고 다시 KREQ로 덮어쓴다.
 * 승인된 템플릿의 발송이 막히는 자리다 — 조건을 UPDATE 시점에도 건다.
 */
describe('목록 안전망 — 진행 중 조건을 UPDATE에도 건다 (Codex 1R)', () => {
  it('★검수상태 갱신은 원래 진행 상태일 때만 적용된다', async () => {
    wire({ items: [{ templateKey: 'K1', inspectionStatus: 'HREJ', rejectReason: '가이드 위반' }] });
    await syncTemplateStatuses();
    const upd = updates().find(([, p]: any[]) => p.includes('r1'))!;
    expect(String(upd[0]), 'UPDATE가 id만 보고 덮어쓴다').toMatch(/WHERE id = \$\d+::uuid AND status = \$\d+/);
    expect(upd[1], '원래 상태를 조건 값으로 넘기지 않는다').toContain('REQUESTED');
  });

  it('★그 사이 상태가 바뀌어 한 행도 못 바꾸면 갱신으로 세지 않는다', async () => {
    wire({ items: [{ templateKey: 'K1', inspectionStatus: 'HREJ' }] });
    q.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (/FROM kakao_templates/i.test(s)) return { rows: ROWS.map((r) => ({ ...r })) };
      if (/UPDATE kakao_templates/i.test(s)) return { rows: [], rowCount: 0 };
      return { rows: [] };
    });
    const r = await syncTemplateStatuses();
    expect(r.updated, '못 바꾼 행을 갱신으로 셌다').toBe(0);
  });
});
