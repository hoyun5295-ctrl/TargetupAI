/**
 * utils/request-context.ts — 요청 단위 컨텍스트 (AsyncLocalStorage)
 *
 * authenticate 미들웨어가 로그인 사용자(userId/companyId)를 담아두면,
 * 깊은 호출 체인(callAIWithFallback 등)이 인자 전달 없이 현재 요청 사용자를 읽는다.
 * 크레딧 차감 created_by 자동 기록용 — 사용자가 한 AI 작업은 그 사용자 ID가 남는다.
 * cron/worker는 요청 컨텍스트가 없으니(undefined) 호출측이 createdBy를 직접 명시한다.
 */
import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  userId?: string;
  companyId?: string;
  userType?: string;
  /** 이번 요청의 마지막 크레딧 차감(사후 토스트용). 응답 미들웨어가 _credit으로 첨부. */
  creditEvent?: { used: number; balance: number; source: string };
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

/** 현재 요청 사용자 ID. 요청 밖(cron/worker)이면 undefined. */
export function currentUserId(): string | undefined {
  return requestContext.getStore()?.userId;
}

/** 크레딧 차감 직후 기록(사후 토스트용). 요청 밖(worker)이면 no-op. */
export function setCreditEvent(e: { used: number; balance: number; source: string }): void {
  const store = requestContext.getStore();
  if (store) store.creditEvent = e;
}

/** 이번 요청의 크레딧 차감 이벤트(응답 미들웨어가 읽어 _credit 첨부). */
export function getCreditEvent(): RequestContext['creditEvent'] {
  return requestContext.getStore()?.creditEvent;
}
