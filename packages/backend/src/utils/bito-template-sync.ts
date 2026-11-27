/**
 * 한줄로 승인 알림톡 템플릿 → 비토 카카오 발신프로필 등록부 자동 연결(★2026-11-27 · 설계서 docs/2026-11-27-bito-template-auto-link-design.md §3-1)
 *
 * 비토 관리 API 의 동기화 일꾼이 60초마다 V 발송ID 회사의 승인 템플릿(코드 · 발신프로필 키)을 당겨 가 그 발송계정 등록부에 넣고(넣기만),
 * 결과를 돌려준다. 한줄로는 결과를 저장하지 않고 사람이 고쳐야 하는 것만 운영 경보로 알린다(표 0 · DDL 0).
 * 이 파일 = 목록 · 결과 꼴 검사 · 경보 고르기 한 곳(라우트 routes/bito-sync.ts 는 부르기만 · 입구 판정 = bito-sender-sync.ts 그대로).
 * ⛔ V 판정 = isBitoAgentSendId(loadBitoAgentIds) · 내부 키 판정 = isImcInternalTemplateKey · 프로필 중지 = SENDER_PROFILE_DISABLED_STATUS — 다시 만들지 않는다.
 * ⛔ 응답에 발신프로필 키 원문이 실린다(비토가 등록부 키와 맞대야 함) — 로그에 남기지 않는다.
 */
import { query } from '../config/database';
import { loadBitoAgentIds, isBitoAgentSendId } from './bito-sender-sync';
import { isImcInternalTemplateKey } from './kakao-template-guard-core';
import { SENDER_PROFILE_DISABLED_STATUS } from './kakao-sender-profile-admin';
import { alertPassFailures, type PassFailure } from './system-alert';

export interface BitoTemplateItem { templateId: string; templateCode: string; senderKey: string; profileLabel: string }
export interface BitoTemplateCompany { companyId: string; agentSendIds: string[]; templates: BitoTemplateItem[] }

/**
 * 비토가 당겨 가는 목록 = V 회사 전부(템플릿 0 회사도) · 템플릿 = 승인 · 같은 회사의 사용 중 프로필 · 코드 · 키가 비지 않음 · 내부 키 아님.
 *   is_active 가 NULL 인 프로필 = 넣지 않는다(고객이 고르는 프로필 목록 routes/companies.ts 의 is_active = true 와 같음).
 *   다른 회사 프로필을 가리키는 템플릿 = 뺀다(그 회사 키를 내보내지 않는다).
 */
export async function listBitoTemplateCompanies(): Promise<BitoTemplateCompany[]> {
  const vMap = await loadBitoAgentIds();
  if (vMap.size === 0) return [];
  const r = await query(
    `SELECT t.id, t.company_id, t.template_code, p.profile_key, p.yellow_id, p.profile_name
       FROM kakao_templates t
       JOIN kakao_sender_profiles p ON p.id = t.profile_id AND p.company_id = t.company_id
      WHERE t.company_id = ANY($1::uuid[])
        AND t.status = 'APPROVED'
        AND p.is_active IS TRUE
        AND p.status IS DISTINCT FROM $2
      ORDER BY t.company_id, t.template_code, t.id`,
    [[...vMap.keys()], SENDER_PROFILE_DISABLED_STATUS],
  );
  const byCompany = new Map<string, BitoTemplateItem[]>();
  for (const row of r.rows as any[]) {
    const code = String(row.template_code ?? '').trim();
    const key = String(row.profile_key ?? '').trim();
    if (!code || !key || isImcInternalTemplateKey(code)) continue;
    const k = String(row.company_id);
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k)!.push({
      templateId: String(row.id),
      templateCode: code,
      senderKey: key,
      profileLabel: String(row.yellow_id || row.profile_name || '').slice(0, 100),
    });
  }
  return [...vMap].map(([companyId, agentSendIds]) => ({ companyId, agentSendIds, templates: byCompany.get(companyId) || [] }));
}

/** 비토가 돌려주는 V 단위 결과(설계 §3-2 ⑤) */
export const BITO_TEMPLATE_ACCOUNT_OUTCOMES = ['ok', 'unmapped', 'agent_inactive', 'no_sender_account', 'no_registry', 'mapping_conflict'] as const;
/** 비토가 돌려주는 템플릿 단위 결과(설계 §3-2 ⑥ ⑦) */
export const BITO_TEMPLATE_OUTCOMES = [
  'registered', 'same', 'conflict_existing', 'code_ambiguous', 'invalid', 'profile_missing', 'profile_inactive', 'busy', 'sync_error',
] as const;
export type BitoTemplateAccountOutcome = (typeof BITO_TEMPLATE_ACCOUNT_OUTCOMES)[number];
export type BitoTemplateOutcome = (typeof BITO_TEMPLATE_OUTCOMES)[number];

export interface BitoTemplateAccountResult { companyId: string; agentSendId: string; outcome: BitoTemplateAccountOutcome; reason: string | null }
export interface BitoTemplateResult { companyId: string; agentSendId: string; templateId: string; templateCode: string; outcome: BitoTemplateOutcome; reason: string | null }
export interface BitoTemplateResults { accounts: BitoTemplateAccountResult[]; templates: BitoTemplateResult[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const reasonOf = (v: unknown): string | null | undefined => (v == null ? null : typeof v === 'string' ? v.slice(0, 500) : undefined);

/** (순수) 결과 POST 몸통 검사 · 하나라도 틀린 꼴 = null(400 · 경보 0) */
export function parseBitoTemplateResults(body: any): BitoTemplateResults | null {
  if (!Array.isArray(body?.accounts) || !Array.isArray(body?.templates)) return null;
  if (body.accounts.length > 10_000 || body.templates.length > 200_000) return null;
  const accounts: BitoTemplateAccountResult[] = [];
  for (const a of body.accounts) {
    const reason = reasonOf(a?.reason);
    if (!UUID.test(String(a?.companyId ?? '')) || !isBitoAgentSendId(a?.agentSendId)
      || !BITO_TEMPLATE_ACCOUNT_OUTCOMES.includes(a?.outcome) || reason === undefined) return null;
    accounts.push({ companyId: a.companyId, agentSendId: a.agentSendId, outcome: a.outcome, reason });
  }
  const templates: BitoTemplateResult[] = [];
  for (const t of body.templates) {
    const reason = reasonOf(t?.reason);
    if (!UUID.test(String(t?.companyId ?? '')) || !isBitoAgentSendId(t?.agentSendId) || !UUID.test(String(t?.templateId ?? ''))
      || typeof t?.templateCode !== 'string' || t.templateCode.length > 200
      || !BITO_TEMPLATE_OUTCOMES.includes(t?.outcome) || reason === undefined) return null;
    templates.push({ companyId: t.companyId, agentSendId: t.agentSendId, templateId: t.templateId, templateCode: t.templateCode, outcome: t.outcome, reason });
  }
  return { accounts, templates };
}

/**
 * 경보 글 = 고정된 종류 이름 둘(설계 §3-1 · 숫자 · 회사 · 코드 · V 0).
 *   주기 경보는 글의 숫자를 N 으로 바꾸고 60자 · 상위 세 종류만 문자에 싣는다(system-alert.ts flushPassAlert) → 종류를 둘로 고정해 둘 다 실리게.
 *   어느 회사 · V · 코드인지 = 비토 일꾼 로그 줄([hanjul-template-sync]).
 */
export const BITO_TEMPLATE_ALERT_KIND = {
  template: '비토 자동 연결이 막힌 한줄로 승인 템플릿',
  account: '비토 발송계정 주인 판정 실패',
} as const;
const TEMPLATE_ALERT: ReadonlySet<BitoTemplateOutcome> = new Set(['conflict_existing', 'code_ambiguous', 'invalid', 'sync_error', 'profile_missing']);
const ACCOUNT_ALERT: ReadonlySet<BitoTemplateAccountOutcome> = new Set(['mapping_conflict']);

/** (순수) 사람이 고쳐야 하는 결과만 경보 항목으로(항목 키 = 같은 문제는 6시간에 한 번) */
export function bitoTemplateAlertFailures(r: BitoTemplateResults): PassFailure[] {
  const out: PassFailure[] = [];
  for (const a of r.accounts) {
    if (ACCOUNT_ALERT.has(a.outcome)) out.push({ companyId: a.companyId, key: `${a.agentSendId}|-|${a.outcome}`, error: BITO_TEMPLATE_ALERT_KIND.account });
  }
  for (const t of r.templates) {
    if (TEMPLATE_ALERT.has(t.outcome)) out.push({ companyId: t.companyId, key: `${t.agentSendId}|${t.templateId}|${t.outcome}`, error: BITO_TEMPLATE_ALERT_KIND.template });
  }
  return out;
}

/** 결과 받기 = 넣은 수 로그 한 줄 + 경보(응답을 기다리게 하지 않는다 · 라우트가 응답 뒤 부른다) */
export async function reportBitoTemplateResults(r: BitoTemplateResults): Promise<void> {
  const registered = r.templates.filter((t) => t.outcome === 'registered').length;
  if (registered > 0) console.log(`[bito-template-sync] 비토 등록부 자동 연결 ${registered}건`);
  await alertPassFailures({
    pass: 'bito-template-sync',
    title: '한줄로 승인 템플릿을 비토 등록부에 자동 연결하지 못한 것이 있습니다.',
    failures: bitoTemplateAlertFailures(r),
    total: r.accounts.length + r.templates.length,
    action: '비토 관리 API 로그의 [hanjul-template-sync] 줄에 회사 · V · 코드 · 결과가 있습니다. 비토 관리 화면 발송계정의 카카오 발신프로필에서 연결 · 프로필을 정리해 주세요.',
  });
}
