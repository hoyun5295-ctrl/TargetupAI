/**
 * SenderAuthModal — 문자 발송 추가 인증(발신 인증) 팝업 (★2026-08-27 전송자격인증 3.5)
 *
 * 심사 기준 원문 —
 *   "문자 발송 시 해당 발신번호와 계정의 연계성 확인을 위한 OTP 추가 인증"
 *   "동일 세션/일정 시간 유지 조건 및 재인증(대량발송, 접속환경 변경 시) 로직 적용"
 *
 * ⛔ 화면 규율
 *  1. **로그인 인증번호 화면(LoginPage `mfaModal`)을 미러링한다.** 같은 인증 체계로 보여야 심사에서
 *     "인증수단이 하나로 관리된다"가 성립한다. 새 톤을 만들지 않는다.
 *  2. **인증 상태를 숨기지 않는다.** 24시간 안에 이미 인증했으면 그 사실과 남은 시간을 보여주고 통과시킨다.
 *     매번 6자리를 묻지 않는 것이 기준 위반이 아니라, 기준이 명시한 "일정 시간 유지"다.
 *  3. **네이티브 dialog를 쓰지 않는다.**
 *
 * ⚠ 2026-08-27 현재 이 컴포넌트는 **발송 경로에 배선되어 있지 않다.**
 *   OTP 발급·검증과 발송 preflight 연결은 별도 작업이다(발송 파이프라인은 영향표 없이 손대지 않는다).
 *   지금은 `?senderAuthPreview=1`로만 열린다.
 */
import React from 'react';

export type SenderAuthState =
  /** 24시간 인증이 살아 있다 — 통과. 남은 시간을 보여주고 발송으로 넘어간다 */
  | { kind: 'verified'; callback: string; verifiedAt: string; remainingHours: number }
  /** 인증이 필요하다 — 6자리 입력 */
  | { kind: 'required'; callback: string; maskedPhone: string; expiresInMinutes: number; reason: SenderAuthReason };

/** 재인증을 요구한 이유 — 기준 3.5가 요구하는 재인증 조건을 화면이 그대로 밝힌다 */
export type SenderAuthReason = 'first' | 'expired' | 'bulk' | 'environment';

const REASON_TEXT: Record<SenderAuthReason, string> = {
  first: '오늘 첫 발송이라 발신번호 담당자 확인이 필요합니다.',
  expired: '인증 후 24시간이 지나 다시 확인이 필요합니다.',
  bulk: '대량 발송이라 발신번호 담당자 확인이 필요합니다.',
  environment: '접속 환경이 바뀌어 다시 확인이 필요합니다.',
};

interface Props {
  state: SenderAuthState;
  code: string;
  onCodeChange: (v: string) => void;
  error?: string;
  notice?: string;
  busy?: boolean;
  onVerify: () => void;
  onResend: () => void;
  onProceed: () => void;
  onCancel: () => void;
}

export default function SenderAuthModal({
  state, code, onCodeChange, error, notice, busy,
  onVerify, onResend, onProceed, onCancel,
}: Props) {
  const verified = state.kind === 'verified';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4 ${verified ? 'bg-emerald-100' : 'bg-blue-100'}`}>
            {verified ? (
              <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
              </svg>
            )}
          </div>
          <h3 className="text-lg font-bold text-gray-900">
            {verified ? '발신번호 인증 완료' : '발신번호 추가 인증'}
          </h3>

          <div className="mt-3 mx-auto inline-flex items-center gap-1.5 rounded-lg bg-gray-50 border border-gray-200 px-3 py-1.5">
            <span className="text-[11px] text-gray-500">발신번호</span>
            <span className="text-sm font-semibold text-gray-900 font-mono">{state.callback}</span>
          </div>

          {verified ? (
            <p className="text-sm text-gray-500 mt-3 leading-relaxed">
              <span className="font-medium text-gray-700">{state.verifiedAt}</span> 에 담당자 확인을 마쳤습니다.<br />
              앞으로 <span className="font-medium text-gray-700">{state.remainingHours}시간</span> 동안 다시 묻지 않습니다.
            </p>
          ) : (
            <>
              <p className="text-sm text-gray-500 mt-3 leading-relaxed">
                <span className="font-medium text-gray-700">{state.maskedPhone}</span> 으로 인증번호를 보냈습니다.<br />
                {state.expiresInMinutes}분 안에 6자리를 입력해주세요.
              </p>
              <p className="mt-2 text-[11px] text-gray-400">{REASON_TEXT[state.reason]}</p>
            </>
          )}
        </div>

        {!verified && (
          <div className="px-6 pt-4">
            <input
              type="text"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              value={code}
              onChange={(e) => onCodeChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter' && code.length === 6) onVerify(); }}
              placeholder="000000"
              className="w-full text-center text-2xl tracking-[0.4em] font-semibold border border-gray-200 rounded-xl py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {error && <p className="text-xs text-red-600 mt-2 text-center">{error}</p>}
            {notice && <p className="text-xs text-gray-500 mt-2 text-center">{notice}</p>}
          </div>
        )}

        <div className="px-6 pb-6 pt-4 space-y-2">
          {verified ? (
            <button
              onClick={onProceed}
              disabled={busy}
              className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              발송 계속하기
            </button>
          ) : (
            <button
              onClick={onVerify}
              disabled={busy || code.length !== 6}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              {busy ? '확인 중…' : '인증하고 발송'}
            </button>
          )}
          <div className="flex gap-2">
            {!verified && (
              <button
                onClick={onResend}
                disabled={busy}
                className="flex-1 bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm transition-colors"
              >
                인증번호 재발송
              </button>
            )}
            <button
              onClick={onCancel}
              disabled={busy}
              className="flex-1 bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
