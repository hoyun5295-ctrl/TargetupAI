/**
 * sms-notice.ts — 안내 문자 적재 CT(★ 2026-11-06 C109 D6 · 설계서 docs/2026-11-06-b1106-1-unsupported-char-design.md §3 D6)
 *
 * 담당자 안내 · 운영 경보 · 결과 안내 · 승인 통보처럼 **우리가 보내는 안내**를 인증 라인(getAuthSmsTable)에 적재한다.
 *   본문(row[2]) · 제목(row[4])을 cleanSmsTextAll 로 정리한 뒤 적재한다(효과 자리 정리 · P2).
 *   왜: 안내 문장에는 고객 문안 · 캠페인 이름 · 반려 사유가 끼어 들어간다 — 그 안의 보낼 수 없는 글자가 그대로 큐에 들어가
 *       통신사가 반려하거나 깨져 도착했다. 호출부마다 정리하면 한 곳만 빠져도 남는다 → 적재 입구 한 곳.
 *   표 = 이 CT 안에서 고른다(부르는 쪽이 미리 고른 표를 들고 있다가 설정이 바뀌는 틈 0).
 *   행 꼴 · 반환(성공 건수) = bulkInsertSmsQueue 그대로(그 안의 시연 막기 · 금칙어 스냅숏 · 라인 분배는 정리된 행을 본다).
 *   boundedMs = 상한 있는 MySQL 연결(여정 안내 셋 · ★ Codex 구현 1R #4) — 표 조회(PG 캐시) · 정리를 끝낸 **뒤에** 연결을 받는다
 *     (옛 호출부 꼴 = 연결을 받은 채 표를 조회 → PG 가 느리면 MySQL 연결을 쥔 채 상한 밖으로 기다렸다).
 * ⛔ 고객 발송 표(회사 · 사용자 라인)는 이 CT 를 타지 않는다(고객 글 불변) · 예외 = account-action 인증번호(숫자 · 고정 글 · 직접 INSERT).
 * 파일을 sms-queue 와 나눈 이유: 적재 배관(sms-queue)을 흉내 내는 시험이 이 CT 를 진짜로 돌리고 그 안의 적재 호출을 그대로 관찰한다.
 */
import { getAuthSmsTable, bulkInsertSmsQueue, type SpamBlockContext } from './sms-queue';
import { withBoundedMysql } from '../config/database';
import { cleanSmsTextAll } from './message-sanitizer';

export async function insertNoticeSms(
  rows: any[][],
  useNow: boolean = true,
  ctx?: SpamBlockContext,
  opts?: { boundedMs?: number },
): Promise<number> {
  const table = await getAuthSmsTable();
  const cleaned = rows.map((r) => {
    const c = r.slice();
    c[2] = cleanSmsTextAll(String(c[2] ?? ''));
    if (c[4] != null) c[4] = cleanSmsTextAll(String(c[4]));
    return c;
  });
  if (opts?.boundedMs != null) return withBoundedMysql(opts.boundedMs, (run) => bulkInsertSmsQueue([table], cleaned, useNow, ctx, { run }));
  return bulkInsertSmsQueue([table], cleaned, useNow, ctx);
}
