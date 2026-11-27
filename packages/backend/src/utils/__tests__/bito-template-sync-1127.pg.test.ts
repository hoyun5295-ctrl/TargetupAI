// replaces: none
/**
 * 한줄로 승인 알림톡 템플릿 → 비토 등록부 자동 연결(★2026-11-27 · 설계서 docs/2026-11-27-bito-template-auto-link-design.md §3-1 · §6 한줄로 4) — 실 PostgreSQL 판.
 *   목록 = V 회사만 · 템플릿 0 회사 포함 · 승인만 · 내부 키(Tm · 앞 공백 포함) · 빈 코드 · 빈 키 · 공백뿐인 키 빼기 ·
 *   중지 프로필(is_active false · NULL · status DELETED) 빼기 · 다른 회사 프로필을 가리키는 템플릿 빼기 · 코드 · 키 앞뒤 공백 자름.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'crypto';
import { pool } from '../../config/database';
import { insertMinimalRow } from './pg/fixtures';
import { listBitoTemplateCompanies } from '../bito-template-sync';

const A = randomUUID();     // V 회사 · 템플릿 여럿
const EMPTY = randomUUID(); // V 회사 · 템플릿 0
const OTHER = randomUUID(); // V 회사 · 프로필만(A 의 템플릿이 이 프로필을 가리킴)
const QT = randomUUID();    // B 발송ID 만 = 대상 아님
const tag = String(Math.floor(Math.random() * 10_000)).padStart(4, '0');
const P = { ok: randomUUID(), off: randomUUID(), nul: randomUUID(), del: randomUUID(), blank: randomUUID(), other: randomUUID(), qt: randomUUID() };
const T = {
  ok: randomUUID(), spaced: randomUUID(), requested: randomUUID(), tmp: randomUUID(), tmpSpaced: randomUUID(), empty: randomUUID(),
  off: randomUUID(), nul: randomUUID(), del: randomUUID(), blank: randomUUID(), cross: randomUUID(), qt: randomUUID(),
};

beforeAll(async () => {
  for (const id of [A, EMPTY, OTHER, QT]) await insertMinimalRow(pool, 'companies', { id });
  await insertMinimalRow(pool, 'company_agent_ids', { company_id: A, agent_send_id: `V8${tag}1` });
  await insertMinimalRow(pool, 'company_agent_ids', { company_id: EMPTY, agent_send_id: `V8${tag}2` });
  await insertMinimalRow(pool, 'company_agent_ids', { company_id: OTHER, agent_send_id: `V8${tag}3` });
  await insertMinimalRow(pool, 'company_agent_ids', { company_id: QT, agent_send_id: `B8${tag}4` });
  const prof = (id: string, company_id: string, profile_key: string, is_active: boolean | null, status: string) =>
    insertMinimalRow(pool, 'kakao_sender_profiles', { id, company_id, profile_key, profile_name: `p-${id.slice(0, 4)}`, yellow_id: `@b${id.slice(0, 8)}`, is_active, status });   // 채널 ID 유일(idx_ksp_yellow_id_active)
  await prof(P.ok, A, ' key-ok ', true, 'NORMAL');
  await prof(P.off, A, 'key-off', false, 'NORMAL');
  await prof(P.nul, A, 'key-nul', null, 'NORMAL');
  await prof(P.del, A, 'key-del', true, 'DELETED');
  await prof(P.blank, A, '   ', true, 'NORMAL');
  await prof(P.other, OTHER, 'key-other', true, 'NORMAL');
  await prof(P.qt, QT, 'key-qt', true, 'NORMAL');
  const tplRow = (id: string, company_id: string, profile_id: string, template_code: string, status: string) =>
    insertMinimalRow(pool, 'kakao_templates', { id, company_id, profile_id, template_code, template_name: `t-${id.slice(0, 4)}`, content: 'x', status });
  await tplRow(T.ok, A, P.ok, 'B_IV_1', 'APPROVED');
  await tplRow(T.spaced, A, P.ok, '  B_IV_2 ', 'APPROVED');
  await tplRow(T.requested, A, P.ok, 'B_IV_3', 'REQUESTED');
  await tplRow(T.tmp, A, P.ok, 'Tmp_0004', 'APPROVED');
  await tplRow(T.tmpSpaced, A, P.ok, ' Tmq_0005', 'APPROVED');
  await tplRow(T.empty, A, P.ok, '   ', 'APPROVED');
  await tplRow(T.off, A, P.off, 'B_IV_6', 'APPROVED');
  await tplRow(T.nul, A, P.nul, 'B_IV_7', 'APPROVED');
  await tplRow(T.del, A, P.del, 'B_IV_8', 'APPROVED');
  await tplRow(T.blank, A, P.blank, 'B_IV_9', 'APPROVED');
  await tplRow(T.cross, A, P.other, 'B_IV_10', 'APPROVED');   // A 템플릿이 OTHER 회사 프로필을 가리킴
  await tplRow(T.qt, QT, P.qt, 'B_IV_11', 'APPROVED');
});

describe('listBitoTemplateCompanies (실 PG)', () => {
  it('V 회사만 · 템플릿 0 회사 포함 · 걸러야 할 템플릿 0 · 코드 · 키 앞뒤 공백 자름', async () => {
    const list = (await listBitoTemplateCompanies()).filter((c) => [A, EMPTY, OTHER, QT].includes(c.companyId));
    expect(list.map((c) => c.companyId).sort()).toEqual([A, EMPTY, OTHER].sort());
    const a = list.find((c) => c.companyId === A)!;
    expect(a.agentSendIds).toEqual([`V8${tag}1`]);
    expect([...a.templates].sort((x, y) => x.templateCode.localeCompare(y.templateCode))).toEqual([
      { templateId: T.ok, templateCode: 'B_IV_1', senderKey: 'key-ok', profileLabel: `@b${P.ok.slice(0, 8)}` },
      { templateId: T.spaced, templateCode: 'B_IV_2', senderKey: 'key-ok', profileLabel: `@b${P.ok.slice(0, 8)}` },
    ]);
    expect(list.find((c) => c.companyId === EMPTY)!.templates).toEqual([]);
    expect(list.find((c) => c.companyId === OTHER)!.templates).toEqual([]);   // OTHER 프로필을 가리키는 A 템플릿은 OTHER 몫도 아니다
  });
});
