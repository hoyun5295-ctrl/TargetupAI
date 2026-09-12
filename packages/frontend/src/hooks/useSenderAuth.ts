/**
 * useSenderAuth — 발신 인증(추가 인증) 화면 흐름 (★2026-09-12 전송자격인증 3.5)
 *
 * 무엇을 하나
 *   발송 응답이 인증 요구(`SENDER_AUTH_REQUIRED`)면 팝업 상태를 만들고, 6자리를 확인한 뒤
 *   **눌렀던 발송을 그대로 다시 실행한다.** 사용자는 화면을 처음부터 다시 채우지 않는다.
 *
 * ⛔ 판정은 서버가 소유한다
 *   화면은 응답 코드만 본다. 시행일·명단·세션 조건을 프론트에서 다시 조립하지 않는다
 *   (조립하면 서버와 화면의 판정이 갈려 "묻지도 않고 막히는" 상태가 생긴다).
 *
 * 발송 경로가 여럿이라(직접발송·타겟발송·AI 오퍼레이터 승인) 화면마다 상태를 복제하지 않도록 훅 하나가 갖는다.
 */
import { useRef, useState } from 'react';
import type { SenderAuthReason, SenderAuthState } from '../components/SenderAuthModal';

export interface SenderAuthChallenge {
  challengeId: string;
  callback: string;
  maskedPhone: string;
  expiresInMinutes: number;
  reason: SenderAuthReason;
}

export function useSenderAuth() {
  const [challenge, setChallenge] = useState<SenderAuthChallenge | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  /** 인증을 통과하면 다시 실행할 발송 — 인증 때문에 세운 바로 그 동작이다 */
  const retryRef = useRef<null | (() => void)>(null);

  const state: SenderAuthState | null = challenge
    ? {
        kind: 'required',
        callback: challenge.callback,
        maskedPhone: challenge.maskedPhone,
        expiresInMinutes: challenge.expiresInMinutes,
        reason: challenge.reason,
      }
    : null;

  /** 응답이 인증 요구면 팝업을 띄우고 true를 돌려준다(호출부는 거기서 멈춘다) */
  const handleResponse = (data: any, retry: () => void): boolean => {
    if (data?.code !== 'SENDER_AUTH_REQUIRED' || !data?.senderAuth) return false;
    retryRef.current = retry;
    setCode('');
    setError('');
    setChallenge(data.senderAuth as SenderAuthChallenge);
    return true;
  };

  /**
   * axios 오류에서 인증 요구를 꺼낸다 — 발송 API를 axios로 부르는 경로용(403 본문이 오류 안에 들어온다).
   * 인증 요구가 아니면 false를 돌려주므로 호출부는 원래 오류 처리를 이어가면 된다.
   */
  const handleError = (err: any, retry: () => void): boolean => handleResponse(err?.response?.data, retry);

  const verify = async () => {
    if (!challenge || code.length !== 6) return;
    setBusy(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/auth/sender-auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ challengeId: challenge.challengeId, code }),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || '인증에 실패했습니다.');
        return;
      }
      const retry = retryRef.current;
      retryRef.current = null;
      setChallenge(null);
      setCode('');
      retry?.();
    } catch {
      setError('인증 처리 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  };

  /** 재발송 = 세워둔 발송을 한 번 더 시도한다. 재사용·재발급 판단은 서버 쿨다운이 한다 */
  const resend = () => {
    const retry = retryRef.current;
    setCode('');
    setError('');
    setChallenge(null);
    retry?.();
  };

  const cancel = () => {
    retryRef.current = null;
    setChallenge(null);
    setCode('');
    setError('');
  };

  return { state, code, setCode, error, busy, handleResponse, handleError, verify, resend, cancel };
}
