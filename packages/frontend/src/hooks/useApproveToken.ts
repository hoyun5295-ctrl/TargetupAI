/**
 * useApproveToken — 무로그인 승인 페이지(충전·대행발송) 전용 토큰 캡처 훅 (★2026-08-30 보안 보강 C6)
 *
 * 문자 속 주소의 fragment(#t=) 토큰을 읽는 즉시 주소에서 지운다. 지우지 않으면 승인권이
 * 토큰 수명 동안 폰 브라우저 기록·주소창에 남는다. 새로고침은 안내 문자의 주소로 다시 연다.
 *
 * ⛔ fragment만 받는다(Codex 2R 수용) — query(?t=)는 JS가 돌기 전에 이미 서버·프록시 접근 로그로
 *   전송되므로 지워도 늦는다. 링크 발급은 0825부터 fragment뿐이라 query 수용은 유출 경로만 남긴다.
 *   query가 붙어 오면 토큰 없음으로 처리하고 주소만 정리한다(무효 화면이 최신 문자로 안내).
 * ⛔ 왜 모듈 1회 캡처 + hashchange 재캡처인가:
 *   - 최초 진입은 모듈 스코프에서 1회 캡처한다. StrictMode가 초기화 함수를 두 번 돌려도
 *     이미 지운 주소를 다시 읽어 빈 값이 되는 일이 없다.
 *   - 같은 탭에 이 경로가 열린 채 새 문자 링크를 열면 fragment만 바뀌는 진입이라 페이지가
 *     새로 로드되지 않는다(모듈 재평가 없음). hashchange에서 다시 캡처·정리한다.
 *   - 재진입 hash에 토큰이 없으면 **빈 값으로 내린다**(Codex 2R 수용 · 옛 승인권을 되살리지 않는다).
 */
import { useEffect, useState } from 'react';

function readAndStrip(): string {
  const t = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('t') || '';
  if (window.location.hash || window.location.search) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  return t;
}

// 최초 페이지 로드 시 1회. 이후 재진입은 hashchange가 갱신한다
let capturedToken = readAndStrip();

export function useApproveToken(): string {
  const [token, setToken] = useState<string>(capturedToken);
  useEffect(() => {
    const onHash = () => {
      const t = readAndStrip();
      capturedToken = t;
      setToken(t);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return token;
}
