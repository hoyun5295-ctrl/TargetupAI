/**
 * access-log.ts — 서비스 페이지 접속 기록 컨트롤타워 (★2026-09-11 전송자격인증 4.1)
 *
 * 무엇을 남기나
 *   인증기준 4.1이 "이용자 서비스 페이지 접속 로그"를 요구한다. 로그인·세션 기록은 있었지만
 *   **어느 화면에 들어왔는가**는 남지 않았다(서버 요청 기록은 사용자·IP 없는 형식으로 서버 파일에만).
 *   로그인한 이용자가 화면에 들어올 때 **누가·언제·어느 화면·어디서(IP·브라우저)** 를 남긴다.
 *
 * 저장 = `audit_logs`(action `page_view`) — 신규 테이블 0. 조회 = 슈퍼관리자 감사 로그 화면(종류 필터).
 *
 * ⛔ 경로만 남긴다 — 쿼리·해시는 버린다. 검색어·토큰이 실릴 수 있어 남기는 순간 로그가 개인정보 사본이 된다.
 *    허용 문자 밖의 경로는 고치지 않고 **기록하지 않는다**(허용 목록 방식 — 차단 목록은 샌다).
 * ⛔ 같은 사람이 같은 화면을 짧은 시간 안에 다시 열면 1건으로 묶는다(재렌더·새로고침 소음).
 *    묶음 기억은 프로세스 메모리다 — 프로세스가 여럿이면 프로세스마다 따로 센다(최대 프로세스 수만큼 중복, 수용).
 * 기록 실패는 화면 이용을 막지 않는다(`recordAuditLog`가 흡수).
 */
import type { Request } from 'express';
import { recordAuditLog } from './audit-log';

/** 같은 사람·같은 화면을 1건으로 묶는 창(ms) */
export const PAGE_VIEW_DEDUP_WINDOW_MS = 60_000;
/** 경로 최대 길이 — 넘으면 기록하지 않는다 */
const MAX_PATH_LENGTH = 200;
/** 묶음 기억 상한 — 넘으면 창이 지난 항목부터 비운다 */
const DEDUP_MAX_ENTRIES = 5_000;
/** 허용 문자 = 영숫자 / _ - . ~ %(퍼센트 인코딩) */
const PATH_ALLOWED = /^\/[A-Za-z0-9/_\-.~%]*$/;

const lastRecordedAt = new Map<string, number>();

/** 화면 경로 정규화 — 쿼리·해시를 버리고 허용 문자만 통과. 기록할 수 없으면 null */
export function normalizePagePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const path = raw.split('?')[0].split('#')[0].trim();
  if (!path || path.length > MAX_PATH_LENGTH) return null;
  if (path.startsWith('//')) return null;
  if (!PATH_ALLOWED.test(path)) return null;
  return path;
}

/** 이번 진입을 기록할지 — 같은 사람·같은 화면이 창 안에서 이미 기록됐으면 false */
export function shouldRecordPageView(userId: string, path: string, now: number = Date.now()): boolean {
  const key = `${userId}|${path}`;
  const last = lastRecordedAt.get(key);
  if (last !== undefined && now - last <= PAGE_VIEW_DEDUP_WINDOW_MS) return false;
  if (lastRecordedAt.size >= DEDUP_MAX_ENTRIES) {
    for (const [k, t] of lastRecordedAt) {
      if (now - t > PAGE_VIEW_DEDUP_WINDOW_MS) lastRecordedAt.delete(k);
    }
    if (lastRecordedAt.size >= DEDUP_MAX_ENTRIES) lastRecordedAt.clear();
  }
  lastRecordedAt.set(key, now);
  return true;
}

/** 화면 접속 기록 — 로그인 사용자만. 정규화된 경로를 받는다(호출부가 normalizePagePath를 먼저 지난다) */
export async function recordPageView(params: { req: Request; path: string }): Promise<void> {
  const user = (params.req as any).user || {};
  if (!user.userId) return;
  if (!shouldRecordPageView(String(user.userId), params.path)) return;
  await recordAuditLog({
    actorUserId: user.userId,
    action: 'page_view',
    targetType: 'page',
    details: {
      path: params.path,
      companyId: user.companyId || null,
      userType: user.userType || null,
    },
    req: params.req,
  });
}

/** 테스트 전용 — 묶음 기억 초기화 */
export function __resetPageViewDedupForTest(): void {
  lastRecordedAt.clear();
}
