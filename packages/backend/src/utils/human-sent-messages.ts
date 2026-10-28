/**
 * 「사람이 보낸 발송」 CT (★ 2026-10-28 AI 메모리 설계 K8-1 · I7 · docs/2026-10-28-ai-memory-brand-voice-design.md)
 *
 * 목소리 학습 후보 = 직접 발송(send_type='direct') − 허브 3안을 그대로 보낸 것 · 채널 문자 · 완료 · 10건 이상 · 본문 30자 이상.
 * 범위 = 회사 관리자 전체 · 담당자 = 자기 발송 · 매장 범위가 있는 담당자 = 그 매장 사용자들이 만든 발송.
 * 정규화(모양 CT) · 휴대폰 꼴 · 쿠폰 코드 꼴(영숫자 8자 이상) 든 글 제외 · 같은 글 하나로.
 * 화면이 고른 것만 대표 문안으로 들어간다(미리 체크는 코드가 최근 · 채널이 겹치지 않게 최대 10).
 */
import { query } from '../config/database';
import { getSourceRef } from './training-logger';
import { normalizeForShape } from './copy-shape';

export interface HumanSentViewer { userId: string | null; userType: string | null }

export interface HumanSentCandidate {
  campaignId: string;
  channel: 'SMS' | 'LMS' | 'MMS';
  subject: string;
  text: string;
  isAd: boolean;
  sentAt: string | null;
  sentCount: number;
  preselected: boolean;
}

const PHONE_RE = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/;
const COUPON_RE = /(?=[A-Za-z0-9]*[A-Za-z])(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{8,}/;
export const PRESELECT_MAX = 10;

/** (순수) 후보 거름 · 같은 글 하나 · 미리 체크(최근 · 채널이 겹치지 않게 돌아가며 최대 10) */
export function shapeHumanSentCandidates(rows: ReadonlyArray<{
  id: string; message_type: string; subject: string | null; message_content: string; is_ad: boolean; sent_at: string | null; sent_count: number;
}>): HumanSentCandidate[] {
  const seen = new Set<string>();
  const out: HumanSentCandidate[] = [];
  for (const r of rows) {
    const text = normalizeForShape(String(r.message_content || ''));
    if (Array.from(text).length < 30) continue;
    if (PHONE_RE.test(text) || COUPON_RE.test(text)) continue;
    const key = text.replace(/\s+/g, ' ').trim();
    if (seen.has(key)) continue;
    seen.add(key);
    const ch = String(r.message_type || '').toUpperCase();
    out.push({
      campaignId: String(r.id),
      channel: ch === 'SMS' ? 'SMS' : ch === 'MMS' ? 'MMS' : 'LMS',
      subject: String(r.subject || ''),
      text,
      isAd: r.is_ad === true,
      sentAt: r.sent_at ? String(r.sent_at) : null,
      sentCount: Number(r.sent_count) || 0,
      preselected: false,
    });
  }
  // 미리 체크 = 최근 순으로 채널을 돌아가며(한 채널만 10건이 되지 않게)
  const byCh: Record<string, HumanSentCandidate[]> = {};
  for (const c of out) (byCh[c.channel] ||= []).push(c);
  const queues = Object.values(byCh);
  let picked = 0;
  for (let round = 0; picked < PRESELECT_MAX && queues.some((q) => q.length > round); round++) {
    for (const q of queues) {
      if (picked >= PRESELECT_MAX) break;
      if (q[round]) { q[round].preselected = true; picked++; }
    }
  }
  return out;
}

/**
 * 회사 · 보는 사람 범위의 「사람이 보낸 발송」 후보(최근 순 · 최대 60).
 * 완료 상태 값 = 'completed'(같은 저장소의 최근 발송 문안 조회 관례 · 설계서 §3 Q-D3 실측으로 확정).
 */
export async function listHumanSentCandidates(companyId: string, viewer: HumanSentViewer, opts: { days?: number } = {}): Promise<HumanSentCandidate[]> {
  const days = Math.max(1, Math.min(365, Math.floor(opts.days ?? 180)));
  const params: unknown[] = [companyId, days];
  let scope = '';
  if (viewer.userType === 'company_user' && viewer.userId) {
    params.push(viewer.userId);
    // 매장 범위가 있는 담당자 = 같은 매장을 가진 사용자들이 만든 발송 · 없으면 자기 발송
    scope = `AND (c.created_by = $3::uuid OR c.created_by IN (
               SELECT u2.id FROM users u2, users me
                WHERE me.id = $3::uuid AND me.company_id = $1::uuid AND u2.company_id = $1::uuid
                  AND COALESCE(array_length(me.store_codes, 1), 0) > 0 AND u2.store_codes && me.store_codes))`;
  }
  const r = await query(
    `SELECT c.id, c.message_type, COALESCE(c.message_subject, c.subject) AS subject, c.message_content, c.is_ad, c.sent_at, c.sent_count
       FROM campaigns c
      WHERE c.company_id = $1::uuid
        AND c.send_type = 'direct'
        AND UPPER(c.message_type) IN ('SMS', 'LMS', 'MMS')
        AND c.status = 'completed'
        AND COALESCE(c.sent_count, 0) >= 10
        AND c.message_content IS NOT NULL AND LENGTH(c.message_content) >= 30
        AND COALESCE(c.sent_at, c.created_at) >= NOW() - ($2::int * INTERVAL '1 day')
        ${scope}
      ORDER BY COALESCE(c.sent_at, c.created_at) DESC
      LIMIT 120`,
    params,
  );
  const rows = r.rows as any[];
  if (rows.length === 0) return [];
  // 허브 3안을 그대로 보낸 발송 제외(학습 원장 · 앱에서 해시한 source_ref)
  const refOf = new Map<string, string>(rows.map((x) => [getSourceRef(String(x.id)), String(x.id)]));
  const hub = await query(
    `SELECT source_ref FROM ai_training_logs
      WHERE source_ref = ANY($1::text[])
        AND (model_params->>'authorship' = 'hub_as_is'
             OR (final_source = 'selected_as_is' AND model_params ? 'hubVariants'))`,
    [Array.from(refOf.keys())],
  );
  const asIs = new Set<string>(hub.rows.map((h: any) => refOf.get(String(h.source_ref)) || ''));
  return shapeHumanSentCandidates(rows.filter((x) => !asIs.has(String(x.id)))).slice(0, 60);
}

/**
 * ★ 2026-10-28 K8-4 — 생성 프롬프트의 「최근 발송 문안」(문자 생성 · 다듬기 · 허브 오케스트레이터) = 이 CT 하나.
 * 회사 전체 · 최근 30일 · 최대 10 · 같은 거름(직접 발송 − 허브 3안 그대로 · 휴대폰 · 쿠폰 꼴 제외). 목소리 회사는 생성기가 싣지 않는다(K2-3).
 */
export async function listRecentHumanSentTexts(companyId: string, opts: { days?: number; limit?: number } = {}): Promise<string[]> {
  const rows = await listHumanSentCandidates(companyId, { userId: null, userType: 'company_admin' }, { days: opts.days ?? 30 });
  return rows.slice(0, opts.limit ?? 10).map((c) => c.text);
}
