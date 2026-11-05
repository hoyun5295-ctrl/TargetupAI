/**
 * lib/alimtalk-catalog.ts — 알림톡 고르기 재료 · 칸 값 매핑 한 곳(★ 2026-11-05 C103 F10)
 *
 * 부르는 곳 = 여정 목록 화면(JourneysPage 검토 화면 알림톡 칸) · 작업 화면 알림톡 칸(JourneyKakaoStepEditor).
 * 옛: 목록 화면 안에서만 세 주소를 읽고 칸 값 ↔ 패널 값을 바꿔서, 작업 화면은 알림톡 칸을 고칠 길이 없었다.
 */
import type { AlimtalkChannelState, AlimtalkNextType, AlimtalkSenderProfile, AlimtalkTemplate } from '../components/alimtalk/AlimtalkChannelPanel';

export interface AlimtalkCatalog {
  senders: AlimtalkSenderProfile[];
  templates: AlimtalkTemplate[];
  /** 변수 연결에 고르는 고객 칸 */
  fields: { key: string; label: string }[];
}

/** 발신프로필 · 승인 템플릿 · 고객 칸(못 읽은 것 = 빈 목록 · 화면이 안내한다) */
export async function loadAlimtalkCatalog(token: string): Promise<AlimtalkCatalog> {
  const get = (url: string) => fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    .then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [snd, tpl, fld] = await Promise.all([
    get('/api/alimtalk/senders'),
    get('/api/companies/kakao-templates?status=APPROVED'),
    get('/api/customers/enabled-fields'),
  ]);
  return {
    senders: snd?.profiles || [],
    templates: tpl?.templates || [],
    fields: (fld?.fields || []).map((f: any) => ({ key: f.field_key, label: f.display_name || f.field_label || f.field_key })),
  };
}

/** 승인된 발신프로필 판정 한 곳(공용 패널 · 칸 값 매핑이 같이 쓴다 · ★ C103 Codex 구현 1R) */
export const APPROVED_SENDER_STATUSES = new Set(['APPROVED']);
export function isApprovedAlimtalkSender(s: { approval_status?: string | null }): boolean {
  return APPROVED_SENDER_STATUSES.has(String(s.approval_status || '').toUpperCase());
}

/** 칸의 알림톡 값(칸 PATCH 키와 같은 이름) */
export interface AlimtalkStepFields {
  alimtalkProfileId?: string;
  alimtalkTemplateCode?: string;
  alimtalkVariableMap?: Record<string, string>;
  alimtalkNextType?: AlimtalkNextType;
  alimtalkNextContents?: string;
  alimtalkNextSubject?: string;
}

/**
 * 칸의 알림톡 고름 = 한 쌍(발신프로필 · 그 프로필의 템플릿)으로 판정한다(★ C103 Codex 구현 1R · 2R — 프로필만 따로 보면 바꾼 프로필에 옛 프로필의 템플릿이 남았다).
 *   쓸 수 있는 프로필 = 승인 목록에 있음 · 쓸 수 있는 템플릿 = 승인 템플릿 목록(templates)에 있고 그 프로필 소속.
 *   프로필 칸이 비고 템플릿만 있는 칸(옛 칸) = 그 템플릿의 소속 프로필로 본다(옛 패널 동작 = 템플릿 유지).
 */
function usableAlimtalkPair(step: AlimtalkStepFields, templates: AlimtalkTemplate[], senders: AlimtalkSenderProfile[]): { profileId: string; template: AlimtalkTemplate | null } {
  const approved = (id: string) => !!id && senders.some((s) => s.id === id && isApprovedAlimtalkSender(s));
  const code = step.alimtalkTemplateCode || '';
  const pid = step.alimtalkProfileId || '';
  if (!pid) {
    const tpl = templates.find((t) => t.template_code === code) || null;
    return tpl && approved(String(tpl.profile_id || '')) ? { profileId: String(tpl.profile_id), template: tpl } : { profileId: '', template: null };
  }
  if (!approved(pid)) return { profileId: '', template: null };
  return { profileId: pid, template: templates.find((t) => t.template_code === code && t.profile_id === pid) || null };
}

/** 저장 전 검사 = 쓸 수 있는 한 쌍 · 변수 연결(재료를 못 받았으면 고름 여부만 · 나머지는 켜기 검증이 잡는다) — 문구 = 「…」 뒤에 붙일 말 */
export function alimtalkStepSelectionIssue(step: AlimtalkStepFields, catalog: Pick<AlimtalkCatalog, 'templates' | 'senders'> | null): string | null {
  if (!step.alimtalkTemplateCode) return '알림톡 템플릿을 골라 주세요.';
  if (!catalog) return step.alimtalkProfileId ? null : '알림톡 템플릿을 골라 주세요.';
  const { template } = usableAlimtalkPair(step, catalog.templates, catalog.senders);
  if (!template) return '승인된 발신프로필의 승인 템플릿을 다시 골라 주세요.';
  const unfilled = unfilledAlimtalkVars(template.content, step.alimtalkVariableMap);
  return unfilled.length > 0 ? `알림톡 템플릿의 ${unfilled.join(', ')} 에 넣을 값을 연결해 주세요.` : null;
}

/**
 * 칸 값 → 공용 패널 값.
 *   쓸 수 없는 프로필(승인 취소 등) = 프로필 · 템플릿 · 변수 연결을 비운다 · 쓸 수 없는 템플릿(승인 목록 밖 · 다른 프로필 소속) = 템플릿 · 변수 연결을 비운다
 *   → 패널이 승인 프로필 하나면 그것을 고르고 템플릿은 다시 고르게 한다(수동으로 프로필을 바꿀 때와 같은 결과).
 */
export function alimtalkStateOfStep(step: AlimtalkStepFields, templates: AlimtalkTemplate[], senders: AlimtalkSenderProfile[]): AlimtalkChannelState {
  const { profileId, template } = usableAlimtalkPair(step, templates, senders);
  return {
    profileId,
    templateCode: template ? template.template_code : '',
    templateId: template ? template.id : '',
    variableMap: template ? step.alimtalkVariableMap || {} : {},
    nextType: step.alimtalkNextType || 'L',
    nextContents: step.alimtalkNextContents || '',
    nextSubject: step.alimtalkNextSubject || '',
  };
}

/** 공용 패널 값 → 칸 값 */
export function alimtalkStepPatchOf(state: AlimtalkChannelState): AlimtalkStepFields {
  return {
    alimtalkProfileId: state.profileId || undefined,
    alimtalkTemplateCode: state.templateCode || undefined,
    alimtalkVariableMap: state.variableMap,
    alimtalkNextType: state.nextType,
    alimtalkNextContents: state.nextContents,
    alimtalkNextSubject: state.nextSubject,
  };
}

/** 템플릿 본문 #{…} 중 값을 연결하지 않은 것(서버 alimtalk-vars findUnfilledAlimtalkVars 와 같은 규칙 · 짝 시험) */
export function unfilledAlimtalkVars(content: string | null | undefined, map: Record<string, string> | null | undefined): string[] {
  const vars = Array.from(new Set(String(content || '').match(/#\{[^}]+\}/g) || []));
  const m = map && typeof map === 'object' ? map : {};
  return vars.filter((v) => String(m[v] ?? '').trim() === '');
}
