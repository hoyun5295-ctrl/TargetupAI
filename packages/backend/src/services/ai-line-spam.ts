/**
 * services/ai-line-spam.ts — AI 한줄로 자동 스팸 검사(★ 2026-10-18 · 설계서 docs/2026-10-18-ai-line-design.md §7)
 *
 * 비용 = 고객사(수동 검사와 같은 선불 경로 · enqueueSpamTest · Harold 1018 결정). 발송은 막지 않는다(칩 · 확인 창 한 줄).
 * 입구 순서: 시연 회사 → 요금제에 스팸 검사 없음(체험 횟수를 쓰지 않는다) → 등록 발신번호 → 같은 글 24시간 재사용 → 사용자당 줄 1건 → 등록.
 * 검사 글 = 발송과 같은 표기((광고) + 본문 + 무료거부 080 · LMS 제목 (광고)) · 1위 고객 = 서버가 매장 범위 안 원본 행으로 치환.
 */
import { UserFacingError } from '../utils/http-error';
import { pool, query } from '../config/database';
import { isDemoCompany } from '../utils/demo-company';
import { getRegisteredCallbackSet } from '../utils/callback-filter';
import { buildAdMessage, buildAdSubject, getOpt080Number, prepareFieldMappings, replaceVariables } from '../utils/messageUtils';
import { enqueueSpamTest, computeMessageHash, loadDefaultSpamFirstRecipient, spamCheckFor, type SpamCheckKey } from '../utils/spam-test-queue';
import { eucKrByteLength, smsRowOverLimit, smsTooLongText } from '../utils/message-byte';
import { isAutoSpamSource, spamCustomerTestSql } from '../utils/spam-trial';
import { resolveHubStoreScope } from '../utils/store-scope';
import { SPAM_FILTER_OPEN_SQL } from '../utils/plan-guard';
import type { AiLineViewer } from './ai-line';
// ★ 2026-11-05 C103 F1 — 검사 한 건 보기 = 공용 CT(여정 칸 검사 창과 같은 함수 · 원본을 옮김)
import { spamCheckView as verdictOf } from '../utils/spam-test-view';

/** 칩 상태 — 화면은 이 값만 그린다 */
export type LineSpamState =
  | 'queued' | 'running' | 'pass' | 'blocked' | 'checking' | 'warn'
  | 'demo' | 'unavailable' | 'unregistered' | 'no_balance' | 'busy' | 'charset' | 'no_device' | 'too_long';

export interface LineSpamStart {
  state: LineSpamState;
  testId?: string;
  reused?: boolean;
  message?: string;
  /** ★ C153 결과 없음이지만 늦은 보고를 아직 받는 검사를 이어 본다(화면이 이어 읽는다) */
  lateOpen?: boolean;
}

export interface LineSpamRead {
  state: LineSpamState;
  carriers: Array<{ carrier: string; result: 'pass' | 'blocked' | 'checking' | 'none' }>;
  aheadCount: number;
  elapsedSec: number;
  lateOpen: boolean;
  /** ★ 2026-11-22 C159 — 접수 거절 반려 문장(칩이 「보내지 못했어요 · 사유」로 그린다) */
  rejection?: string;
}

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** 1위 고객 원본 행(매장 범위 안) — 없으면 null(등록 함수가 이름순 첫 고객을 쓴다) */
async function loadFirstRecipient(v: AiLineViewer, customerId: string | null, mappingCols: string[]): Promise<Record<string, any> | null> {
  if (!customerId || !/^[0-9a-f-]{36}$/i.test(customerId)) return null;
  const scope = await resolveHubStoreScope(v.companyId, v.userId, v.userType);
  if (scope.blocked) return null;
  const params = [...scope.baseParams, customerId];
  const cols = [...new Set(['phone', 'custom_fields', ...mappingCols])].join(', ');
  const r = await query(
    `SELECT ${cols} FROM customers WHERE company_id = $1 AND id = $${params.length}::uuid AND is_active = true${scope.storeFilter} LIMIT 1`,
    params,
  );
  return r.rows[0] || null;
}

/**
 * ★ 2026-11-22 C153 — 같은 글의 검사를 이어 볼 것인가(이어 볼 것이 없으면 null = 새로 건다). 판정 한 곳(시작 주소가 잠금 안에서 부른다).
 *   오늘 검사: 통과 · 막힘 · 진행 중 · 확인 중 = 이어 본다 · 결과 없음 = 늦은 보고를 아직 받는 때(lateOpen)면 이어 본다 · 그때가 지났으면 새로 건다.
 *     (통신사가 늦게 전달하는 중에 같은 글을 또 보내면 돈만 더 들고 앞 문자의 늦은 도착이 뒤 검사로 붙는다 · spam-test-queue 「가를 수 없는 경우」)
 *   오늘 검사가 없다(날짜가 바뀌었을 수 있다): 어제 검사가 결과 없음 + lateOpen 일 때만 이어 본다(자정 직전에 닫힌 검사 · Codex 설계 2R).
 *     그 밖 = 날짜 규칙 그대로 새 검사(통신사 필터는 날마다 바뀐다).
 */
export async function reusableLineSpamTest(key: SpamCheckKey): Promise<LineSpamStart | null> {
  const same = await spamCheckFor(key);
  if (same) {
    const read = await verdictOf(same.testId, same.status, same.createdAt, key.msgType);
    if (read.state !== 'warn' || read.lateOpen) return { state: read.state, testId: same.testId, reused: true, ...(read.lateOpen ? { lateOpen: true } : {}) };
    return null;
  }
  const prev = await spamCheckFor(key, undefined, 2);
  if (!prev) return null;
  const read = await verdictOf(prev.testId, prev.status, prev.createdAt, key.msgType);
  return read.state === 'warn' && read.lateOpen ? { state: 'warn', testId: prev.testId, reused: true, lateOpen: true } : null;
}

export async function startLineSpamTest(v: AiLineViewer, input: {
  body: string; subject: string; channel: 'SMS' | 'LMS' | 'MMS'; isAd: boolean; callback: string; sampleCustomerId: string | null;
}): Promise<LineSpamStart> {
  if (await isDemoCompany(v.companyId)) return { state: 'demo' };
  const plan = await query(
    `SELECT ${SPAM_FILTER_OPEN_SQL} AS spam_filter_enabled FROM companies c LEFT JOIN plans p ON c.plan_id = p.id WHERE c.id = $1`,
    [v.companyId],
  );
  if (!plan.rows[0]?.spam_filter_enabled) return { state: 'unavailable' };
  const cb = digits(input.callback);
  if (!cb || !(await getRegisteredCallbackSet(v.companyId, v.userId || undefined)).has(cb)) return { state: 'unregistered' };
  if (!v.userId) return { state: 'unavailable' };
  const userId: string = v.userId;   // 안쪽 함수(startLocked)에서도 좁힌 값을 쓴다

  // 검사 글 = 발송과 같은 표기(MMS 는 글만 · 장문으로 검사)
  const opt080 = await getOpt080Number(v.userId, v.companyId);
  const longType = input.channel !== 'SMS';
  const msgType: 'SMS' | 'LMS' = longType ? 'LMS' : 'SMS';
  const content = buildAdMessage(input.body, input.channel, input.isAd, opt080 || '');
  const subject = longType ? buildAdSubject(input.subject || '', input.channel, input.isAd) : '';

  const fieldMappings = await prepareFieldMappings(v.companyId);
  const mappingCols = Object.values(fieldMappings).filter((m: any) => m.storageType !== 'custom_fields').map((m: any) => m.column);
  // ★ Codex 2R — 1위 고객이 없으면 등록 함수와 같은 기본 고객으로(재사용 해시와 등록 해시가 같은 고객을 본다 · 같은 글 재과금 0)
  const first = (await loadFirstRecipient(v, input.sampleCustomerId, mappingCols)) || await loadDefaultSpamFirstRecipient(v.companyId, userId, fieldMappings);
  const checked = replaceVariables(content, first, fieldMappings, { callback: cb, extra1: '', extra2: '', extra3: '', name: '' } as any);
  const hash = computeMessageHash(checked);
  // ★ 2026-11-18 C143 E3(Codex 구현 1R #3 같은 뿌리) — 90바이트를 넘는 SMS 검사 글 = 같은 검사 이어 보기 · 등록 0(해시는 공백을 지워 91바이트 글이 90바이트 글의 통과를 이어 받았다)
  if (msgType === 'SMS' && smsRowOverLimit('S', checked)) return { state: 'too_long', message: smsTooLongText(eucKrByteLength(checked)) };

  // ★ Codex 1R high — 재사용 확인 · 진행 중 확인 · 등록(선불 차감)을 회사 잠금 하나 안에서 한다.
  //   두 탭 · 재전송이 둘 다 「없음」을 보고 각각 차감하던 경쟁을 막는다(뒤 요청은 앞 요청이 등록한 검사를 재사용 · busy 로 받는다).
  //   잠금은 별도 연결의 세션 잠금 — 등록 함수는 자기 트랜잭션으로 커밋한 뒤 돌아오므로 잠금을 놓기 전에 다음 요청이 그 행을 본다.
  //   ★ Codex 2R — 기다리지 않는 잠금(pg_try_advisory_lock): 못 잡으면 연결을 붙들고 기다리지 않고 바로 줄 대기(busy)로 돌려준다
  //   (기다리는 요청이 공용 연결 풀을 채워 잠금 주인의 다음 조회까지 막던 길 · 화면은 잠시 뒤 다시 보낸다).
  const lockClient = await pool.connect();
  const lockKey = `ai-line-spam:${v.companyId}`;
  let locked = false;
  try {
    const got = await lockClient.query('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [lockKey]);
    locked = got.rows[0]?.ok === true;
    if (!locked) return { state: 'busy' };
    return await startLocked();
  } finally {
    if (locked) await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined);
    lockClient.release();
  }

  async function startLocked(): Promise<LineSpamStart> {
  // 같은 회사 · 발신번호 · 유형 · 제목 · 치환 뒤 글 = 같은 검사 이어 보기(통과 · 막힘 · 진행 중 · 확인 중 · 결과 없음은 다시)
  //   ★ Codex 1R medium — 유형(결과 행 · 큐 검사도 등록 때 결과 행이 생긴다)과 제목까지 같아야 한다. 제목을 모르는 옛 검사는 장문 재사용에서 빠진다.
  //   ★ 2026-11-01 B1-4 — 찾기 = 공용 spamCheckFor 한 곳(같은 한국 날짜 · 옛 24시간 창 대신)
  const reuse = hash ? await reusableLineSpamTest({ companyId: v.companyId, callback: cb, hash, msgType, subject: subject || null }) : null;
  if (reuse) return reuse;

  // 사용자당 줄에 선 자동 검사 1건(끝나면 화면이 다음 카드를 보낸다)
  //   ★ 1124 확인 판(우리 쪽 진단 · 자동 목록에 들지만 사람의 줄이 아니다)은 점유로 치지 않는다(설계서 §10-1)
  const busy = await query(
    `SELECT id, source FROM spam_filter_tests t WHERE t.user_id = $1 AND t.status IN ('queued', 'active') AND ${spamCustomerTestSql('t')} ORDER BY t.created_at ASC`,
    [userId],
  );
  const busyAuto = busy.rows.find((r: any) => isAutoSpamSource(r.source));
  if (busyAuto) return { state: 'busy', testId: String(busyAuto.id) };

  const out = await enqueueSpamTest({
    companyId: v.companyId,
    userId,
    callbackNumber: cb,
    ...(longType ? { messageContentLms: content } : { messageContentSms: content }),
    messageType: msgType,
    subject: subject || undefined,
    ...(Object.keys(first).length > 0 ? { firstRecipient: first } : {}),
    source: 'auto_ai',
  });
  if (!out.ok) {
    if (out.insufficientBalance) return { state: 'no_balance', message: out.error };
    if (out.errorCode === 'SMS_UNSUPPORTED_CHARS') return { state: 'charset', message: out.error };
    if (out.errorCode === 'SMS_TOO_LONG') return { state: 'too_long', message: out.error };   // ★ C143 — 등록의 길이 반려(옛 갈래 없음 = 503 「시작하지 못했어요」)
    // ★ 2026-10-25 원장 #114 — 사유마다 다른 답(옛: 전부 일반 Error → 500 「처리 중 문제」)
    if (out.errorCode === 'NO_TEST_DEVICE') return { state: 'no_device' };
    if (out.errorCode === 'DB_MIGRATION_PENDING') throw new UserFacingError(503, 'DB_MIGRATION_PENDING', 'DB 마이그레이션 필요: spam_filter_tests ALTER 실행 요청');
    console.error('[ai-line-spam] 검사 등록 실패:', out.error);
    throw new UserFacingError(503, 'SPAM_ENQUEUE_FAILED', '스팸 검사를 시작하지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  }
  return { state: 'queued', testId: out.testId };
  }
}

/**
 * 칩 조회 — 회사 범위(같은 글 재사용으로 다른 담당자의 검사에 붙을 수 있다). 판정 · 통신사 · 대기 수만 돌려준다
 * (첫 수신자 고객 정보 · 본문은 내보내지 않는다 = 수동 단건 조회의 본인 제한이 지키는 것과 같은 것을 지킨다).
 */
export async function readLineSpamTest(v: AiLineViewer, testId: string, msgType: 'SMS' | 'LMS'): Promise<LineSpamRead | null> {
  if (!/^[0-9a-f-]{36}$/i.test(testId)) return null;
  const r = await query(
    `SELECT id, status, created_at FROM spam_filter_tests WHERE id = $1::uuid AND company_id = $2`,
    [testId, v.companyId],
  );
  const t = r.rows[0];
  if (!t) return null;
  // ★ Codex 1R medium — 이 카드가 보낼 유형의 결과 행으로만 판정한다(SMS 검사로 LMS 통과를 보이지 않게)
  return verdictOf(String(t.id), String(t.status), t.created_at, msgType);
}
