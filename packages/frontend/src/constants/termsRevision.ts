/**
 * 이용약관 개정 시행일 (★2026-11-25 특부가 갱신 · Harold 「약관 수정하고 공지 팝업」)
 *
 * 바뀐 조항 = 제41조 제5항 신설 · 제42조 제3항 수정 · 제42조 제6항 · 제7항 신설(설계 = 대화 1125 · 특부가 5번 서식 예시 · 1-3 서식 고려사항).
 * 약관 제3조 제2항 = 중요한 변경은 「최소한 7일 전」 공시 · 부칙 3 = 「공지 후 7일이 경과한 날」.
 *   공지 = 11/26 배포(낮 시간) → 7일을 시각으로 다 채우는 첫 자정 = 12/4 00:00 KST(Codex 1R · 12/3 00:00 은 11/26 낮 공지부터 7일이 안 된다).
 *   배포가 11/26 을 넘기면 아래 두 줄을 「공지한 날 + 8일 00:00」으로 고친다.
 *
 * 쓰는 곳 = 약관 화면(`pages/TermsPage` · 시행 전 = 현행 조항 + 예고 · 시행일부터 = 개정문) · 로그인 화면 안내 창 1쪽(`components/LoginPolicyNoticeModal`).
 * 날짜를 화면마다 따로 적으면 한쪽만 바뀌는 날이 온다. 화면은 판정을 `useTermsRevisionEffective` 로만 읽는다(열어 둔 화면도 시행 시각에 바뀐다).
 */
import { useEffect, useState } from 'react';

export const TERMS_REVISION_EFFECTIVE_AT_MS = new Date('2026-12-04T00:00:00+09:00').getTime();
export const TERMS_REVISION_EFFECTIVE_DATE_TEXT = '2026년 12월 4일';

/** 개정 약관 시행일이 지났는가(한국 시각 자정 · 그 시각부터 시행) */
export function isTermsRevisionEffective(now: number = Date.now()): boolean {
  return now >= TERMS_REVISION_EFFECTIVE_AT_MS;
}

/** setTimeout 이 받는 가장 긴 대기(약 24.8일) — 넘기면 바로 터지므로 끊어서 기다리고, 터질 때마다 다시 판정한다 */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** 시행 시각까지 기다릴 시간(0 ~ 상한) */
export function termsRevisionTimerDelay(now: number = Date.now()): number {
  return Math.min(MAX_TIMER_MS, Math.max(0, TERMS_REVISION_EFFECTIVE_AT_MS - now));
}

type VisibilityDoc = Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;

/**
 * 시행 시각이 되면 onEffective 를 한 번 부른다 — 시행 시각 타이머 + 숨었던 탭이 다시 보일 때(잠자기 · 백그라운드로 타이머가 늦은 경우) 판정.
 * 돌려준 함수(stop)가 타이머와 듣기를 다 지운다. 화면 효과 밖 함수라 시험이 가짜 시계로 그대로 돌린다(★Codex 3R).
 * 듣기 = 이름 붙은 함수 하나를 옵션 없이 등록 · stop 한 곳에서 같은 인자로 해제(★Codex 4R ~ 7R · 옵션이 없으니 등록과 해제가 어긋날 자리가 없고,
 * 신호(signal) 해제를 못 하는 옛 브라우저에서도 같은 동작 · 시험이 두 줄의 인자를 계약으로 잡는다).
 */
export function watchTermsRevision(onEffective: () => void, doc: VisibilityDoc = document): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const onVisible = () => { if (doc.visibilityState === 'visible') check(); };
  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisible);
  };
  const check = () => {
    if (stopped) return;
    clearTimeout(timer);
    if (isTermsRevisionEffective()) {
      stop();
      onEffective();
      return;
    }
    timer = setTimeout(check, termsRevisionTimerDelay());   // 상한으로 끊긴 대기가 먼저 터져도 다시 판정하고 다시 건다
  };
  doc.addEventListener('visibilitychange', onVisible);
  timer = setTimeout(check, termsRevisionTimerDelay());
  return stop;
}

/**
 * 화면이 쓰는 시행 판정(★Codex 2R — 시행 전에 열어 둔 약관 · 안내 창이 자정이 지나도 옛 상태로 남지 않게).
 * 시행 뒤에는 아무것도 걸지 않는다.
 */
export function useTermsRevisionEffective(): boolean {
  const [effective, setEffective] = useState(() => isTermsRevisionEffective());
  useEffect(() => (effective ? undefined : watchTermsRevision(() => setEffective(true))), [effective]);
  return effective;
}
