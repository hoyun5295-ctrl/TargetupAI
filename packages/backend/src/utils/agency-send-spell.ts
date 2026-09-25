/**
 * agency-send-spell.ts — 대행발송 맞춤법 검사 층 (2026-09-25)
 * 설계 SoT = docs/2026-09-25-agency-spell-check-design.md (불변 8개 · §3-2~§3-4).
 *
 * 검사기 = 문자 층 `sms-spell-check.ts`(보호 구간·단문 바이트) → 채널 중립 엔진 `spell-check.ts`.
 * 이 파일은 대행발송 전용 세 가지만 가진다: 20초 상한 · 문안 버전에 묶인 저장값 · 워커 A 훅.
 *
 * ⛔ 자동 교정 0 — 여기서 `current_content`를 쓰는 코드는 없다. 고치기는 담당자가 [고치기] 후 **저장**할 때뿐이다.
 * ⛔ 검사는 흐름을 막지 않는다 — 실패·20초 초과·컬럼 없음이면 결과 없이 원래 흐름 그대로(안내 줄도 없다).
 * ⛔ 크레딧 0 — source `agency-send-spell`은 단가표에 없다.
 */
import pool, { query } from '../config/database';
import { hasAgencyColumn } from './agency-send-intake';
import { checkSmsSpelling, loadSmsSpellProtectedWords, SMS_SPELL_BYTE_LIMIT } from './sms-spell-check';
import type { SpellIssue } from './spell-check';
import { AGENCY_SPELL_AI_SOURCE } from './ai-rate-limit';

/** 검사 상한(설계 불변 4). 넘으면 결과 없이 흐름을 잇는다. */
export const AGENCY_SPELL_TIMEOUT_MS = 20_000;
/** AI 호출 source(이름 소유 = CT-55 · 월 AI 호출 한도 면제 목록에 있다 — 우리 워커가 돌리는 검사가 고객사 한도를 깎지 않게) */
export const AGENCY_SPELL_SOURCE = AGENCY_SPELL_AI_SOURCE;
/** 이력 표(`agency_send_events.kind`) — 화면 `AgencyEventLog.tsx EVENT_LABEL`에 같은 커밋으로 등재한다. */
export const AGENCY_SPELL_EVENT = 'spell_checked';

/** `agency_send_requests.spell_check` 저장값. `version` = 검사한 문안의 `content_version`. */
export interface AgencySpellStored {
  version: number;
  checkedAt: string;
  issues: SpellIssue[];
  failed: boolean;
}

function messageByteLimit(messageType: unknown): number | null {
  return String(messageType || '').toUpperCase() === 'SMS' ? SMS_SPELL_BYTE_LIMIT : null;
}

/**
 * 문안 검사 — 20초 상한. 넘거나 실패하면 `failed=true`·빈 목록(가짜 "고칠 곳 없음" 금지).
 * 저장하지 않는다(접수 화면 사전 검사도 이 함수를 쓴다).
 */
export async function checkAgencySpelling(input: {
  companyId: string;
  userId?: string | null;
  content: string;
  messageType: string;
  protectedWords?: string[];
}): Promise<{ issues: SpellIssue[]; failed: boolean }> {
  const content = String(input.content ?? '');
  if (!content.trim()) return { issues: [], failed: false };
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    // 20초 상한은 보호 낱말 조회까지 포함한다(조회가 늦어도 흐름을 붙잡지 않게)
    const run = (async () => {
      const words = input.protectedWords ?? await loadSmsSpellProtectedWords(input.companyId);
      const r = await checkSmsSpelling({
        companyId: input.companyId,
        userId: input.userId,
        text: content,
        protectedWords: words,
        source: AGENCY_SPELL_SOURCE,
        smsByteLimit: messageByteLimit(input.messageType),
      });
      return { issues: r.issues, failed: r.failed };
    })();
    const timeout = new Promise<{ issues: SpellIssue[]; failed: boolean }>((resolve) => {
      timer = setTimeout(() => resolve({ issues: [], failed: true }), AGENCY_SPELL_TIMEOUT_MS);
    });
    return await Promise.race([run, timeout]);
  } catch (err: any) {
    console.warn('[agency-send][spell] 검사 실패(흐름은 계속):', err?.message);
    return { issues: [], failed: true };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 저장값 → 지금 문안의 결과(화면·승인 링크·안내 공용). 버전이 다르면 null(설계 불변 3).
 * 실패로 끝난 검사도 null — "확인할 곳 0"과 구분이 안 되는 값을 내보내지 않는다.
 */
export function readAgencySpell(row: { spell_check?: unknown; content_version?: unknown } | null | undefined): SpellIssue[] | null {
  if (!row) return null;
  const raw: any = row.spell_check;
  if (!raw || typeof raw !== 'object') return null;
  if (raw.failed === true) return null;
  if (Number(raw.version) !== Number(row.content_version)) return null;
  return Array.isArray(raw.issues) ? (raw.issues as SpellIssue[]) : null;
}

/** 컬럼 탐지 — 접수 코어와 같은 한 벌(`hasAgencyColumn`). 탐지 자체가 실패하면 없는 것으로 보고 건너뛴다. */
export async function hasAgencySpellColumn(): Promise<boolean> {
  try {
    return await hasAgencyColumn(pool, 'spell_check');
  } catch (err: any) {
    console.warn('[agency-send][spell] 컬럼 탐지 실패(검사 건너뜀):', err?.message);
    return false;
  }
}

/**
 * 워커 A 훅 — 테스트 문자 뒤·승인 안내 앞(설계 §3-4). 검사하고 저장만 한다(안내 건수는 `readAgencySpellCount`).
 * ⛔ 20초 상한 = **바깥 AI 호출**(보호 낱말 조회 포함 · `checkAgencySpelling`). 넘거나 실패하면 결과 없이 흐름을 잇는다.
 * ⛔ DB 읽기·쓰기는 워커 A의 다른 DB 단계(`saveTestResult`·`setStatus`·`freshLinkFields`)와 같은 취급이다 — 같은 행·같은 풀을
 *   쓰는 이웃 단계가 기한 없이 기다리므로, 이 단계만 기한으로 묶어도 최악 시간은 같다(★Codex 1R·2R 판단 · 설계서 §2 불변 4).
 * ⛔ 어떤 실패도 던지지 않는다. 이력 기록은 기다리지 않는다.
 */
export async function runAgencySpellAfterTest(input: {
  requestId: string;
  companyId: string;
  userId?: string | null;
  content: string;
  messageType: string;
  version: number;
  logEvent: (requestId: string, kind: string, payload?: Record<string, any>) => Promise<void>;
}): Promise<void> {
  try {
    if (!await hasAgencySpellColumn()) return;
    const r = await checkAgencySpelling({
      companyId: input.companyId, userId: input.userId, content: input.content, messageType: input.messageType,
    });
    const stored: AgencySpellStored = {
      version: input.version, checkedAt: new Date().toISOString(), issues: r.issues, failed: r.failed,
    };
    // 버전 조건 — 그 사이 담당자가 문안을 고쳤으면(버전이 올랐으면) 옛 결과를 싣지 않는다.
    const u = await query(
      `UPDATE agency_send_requests SET spell_check = $1::jsonb
        WHERE id = $2::uuid AND content_version = $3`,
      [JSON.stringify(stored), input.requestId, input.version],
    );
    void input.logEvent(input.requestId, AGENCY_SPELL_EVENT, { count: r.issues.length, failed: r.failed, saved: (u.rowCount ?? 0) > 0 });
  } catch (err: any) {
    console.warn(`[agency-send][spell] 워커 검사 건너뜀 request=${input.requestId}:`, err?.message);
  }
}

/**
 * 승인 안내에 실을 "확인할 곳" 수 — **안내 직전 최신 행**의 저장값에서 센다(`readAgencySpell` 한 벌).
 * 그 사이 문안이 바뀌었으면(버전이 다르거나 수정 라우트가 지웠으면) 0 = 안내 줄 없음. 화면 목록과 문자의 숫자가 늘 같다.
 * ⛔ 던지지 않는다 · 컬럼 전이면 0.
 */
export async function readAgencySpellCount(requestId: string): Promise<number> {
  try {
    if (!await hasAgencySpellColumn()) return 0;
    const r = await query(`SELECT spell_check, content_version FROM agency_send_requests WHERE id = $1::uuid`, [requestId]);
    return readAgencySpell(r.rows[0])?.length ?? 0;
  } catch (err: any) {
    console.warn(`[agency-send][spell] 안내 건수 조회 건너뜀 request=${requestId}:`, err?.message);
    return 0;
  }
}
