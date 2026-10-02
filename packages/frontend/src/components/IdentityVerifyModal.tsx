/**
 * IdentityVerifyModal — 담당자 본인인증 창 (★2026-10-02 전송자격인증 2.1 ①-1 · 3.4 ② · ③)
 *
 * 두 곳에서 쓴다
 *   로그인  : 최초 1회. 통과하면 인증된 이름·휴대폰이 계정 담당자로 등록되고 그대로 로그인된다.
 *   설정    : 담당자가 바뀔 때. 새 담당자가 본인 휴대폰으로 인증해야 바뀐다.
 *
 * ⛔ 화면 규율
 *  1. 로그인 인증번호 창(LoginPage `mfaModal`)과 같은 틀을 쓴다. 인증 체계가 하나로 보여야 한다.
 *  2. 이름·번호를 손으로 받지 않는다. 인증기관이 확인한 값만 저장된다(시험 환경 입력 화면은 운영에서 뜨지 않는다).
 *  3. 네이티브 dialog를 쓰지 않는다.
 */
import { useState } from 'react';
import { launchIdentityProvider } from '../utils/identityProvider';

export type IdentityVerifyMode = { kind: 'login'; ticket: string } | { kind: 'change' };

interface Props {
  mode: IdentityVerifyMode;
  /** 로그인 경로 — 인증이 끝나 세션을 받았다 */
  onLoginSuccess?: (data: any) => void;
  /** 로그인 경로 — 인증은 끝났는데 같은 아이디가 접속 중이다(인계 창으로 넘긴다) */
  onTakeover?: (data: any) => void;
  /** 설정 경로 — 담당자가 바뀌었다 */
  onChanged?: (info: { name: string; maskedPhone: string }) => void;
  /** 인증 대기 시간이 끝났다 — 창을 닫고 사유를 남긴다 */
  onExpired?: (message: string) => void;
  onClose: () => void;
}

interface Started {
  verificationId: string;
  provider: string;
  start: Record<string, any>;
}

export default function IdentityVerifyModal({ mode, onLoginSuccess, onTakeover, onChanged, onExpired, onClose }: Props) {
  const isLogin = mode.kind === 'login';
  const [started, setStarted] = useState<Started | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stubName, setStubName] = useState('');
  const [stubPhone, setStubPhone] = useState('');

  const post = async (path: string, body: Record<string, any>) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isLogin) headers.Authorization = `Bearer ${localStorage.getItem('token') || ''}`;
    const res = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({} as any));
    return { res, data };
  };

  const finish = async (s: Started, result: any) => {
    const path = isLogin ? '/api/auth/identity/complete' : '/api/auth/identity/change/complete';
    const body = isLogin
      ? { identityTicket: mode.ticket, verificationId: s.verificationId, result, appSource: 'hanjul' }
      : { verificationId: s.verificationId, result };
    const { res, data } = await post(path, body);
    if (res.ok) {
      if (isLogin) onLoginSuccess?.(data);
      else onChanged?.({ name: data.name, maskedPhone: data.maskedPhone });
      return;
    }
    // 인증은 끝났는데 같은 아이디가 접속 중이다 — 인증번호 창과 같은 인계 흐름으로 넘긴다
    if (isLogin && res.status === 409 && data?.code === 'SESSION_IN_USE') { onTakeover?.(data); return; }
    if (data?.code === 'IDENTITY_TICKET_INVALID' || data?.code === 'IDENTITY_ALREADY_VERIFIED') {
      onExpired?.(data?.error || '다시 로그인해주세요.');
      return;
    }
    // 대기 시간이 끝났으면 처음 단계로 돌아가 다시 시작한다
    if (data?.code === 'IDENTITY_EXPIRED') setStarted(null);
    setError(data?.error || '본인인증을 완료하지 못했습니다.');
  };

  const begin = async () => {
    setBusy(true);
    setError('');
    try {
      const path = isLogin ? '/api/auth/identity/start' : '/api/auth/identity/change/start';
      const { res, data } = await post(path, isLogin ? { identityTicket: mode.ticket } : {});
      if (!res.ok) {
        // 티켓이 죽었거나, 그사이 이 계정의 본인인증이 이미 끝났다 — 창을 닫고 다시 로그인하게 한다
        if (data?.code === 'IDENTITY_TICKET_INVALID' || data?.code === 'IDENTITY_ALREADY_VERIFIED') {
          onExpired?.(data?.error || '다시 로그인해주세요.');
          return;
        }
        setError(data?.error || '본인인증을 시작하지 못했습니다.');
        return;
      }
      const s: Started = { verificationId: data.verificationId, provider: data.provider, start: data.start || {} };
      setStarted(s);
      // 시험 환경은 아래 입력 화면으로 이어진다. 그 밖에는 인증기관 창을 연다
      if (s.provider === 'stub') return;
      const result = await launchIdentityProvider(s.provider, s.start);
      await finish(s, result);
    } catch {
      setStarted(null);
      setError('본인인증 창을 열지 못했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  };

  const submitStub = async () => {
    if (!started) return;
    setBusy(true);
    setError('');
    try {
      await finish(started, { name: stubName.trim(), phone: stubPhone.replace(/\D/g, '') });
    } catch {
      setError('본인인증 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const stubStep = started?.provider === 'stub';

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">{isLogin ? '담당자 본인인증' : '담당자 변경'}</h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            {isLogin
              ? '이 계정을 사용하는 담당자 본인의 휴대폰으로 한 번만 인증해 주세요.'
              : '새 담당자 본인의 휴대폰으로 인증하면 담당자가 바뀝니다.'}
          </p>
        </div>

        <div className="px-6 pt-4">
          {!stubStep && (
            <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 space-y-1.5">
              <p className="text-xs text-gray-600 leading-relaxed">
                · 인증된 <span className="font-medium text-gray-800">이름과 휴대폰번호</span>가 이 계정의 담당자로 등록됩니다.
              </p>
              <p className="text-xs text-gray-600 leading-relaxed">
                · 다음 로그인부터 이 번호로 <span className="font-medium text-gray-800">인증번호</span>가 발송됩니다.
              </p>
              <p className="text-xs text-gray-500 leading-relaxed">· 계정 하나에 담당자 휴대폰번호는 하나만 등록됩니다.</p>
            </div>
          )}

          {stubStep && (
            <div className="space-y-2">
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                시험 환경에서만 보이는 입력 화면입니다. 운영에서는 인증기관 창이 열립니다.
              </p>
              <input
                type="text"
                autoFocus
                value={stubName}
                onChange={(e) => setStubName(e.target.value)}
                placeholder="이름"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                inputMode="numeric"
                value={stubPhone}
                onChange={(e) => setStubPhone(e.target.value.replace(/[^\d-]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter' && stubName.trim() && stubPhone) submitStub(); }}
                placeholder="휴대폰번호"
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          )}

          {error && <p className="text-xs text-red-600 mt-2 text-center">{error}</p>}
        </div>

        <div className="px-6 pb-6 pt-4 space-y-2">
          {!stubStep ? (
            <button
              onClick={begin}
              disabled={busy}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              {busy ? '여는 중…' : '본인인증 하기'}
            </button>
          ) : (
            <button
              onClick={submitStub}
              disabled={busy || !stubName.trim() || !stubPhone}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              {busy ? '확인 중…' : isLogin ? '인증하고 로그인' : '인증하고 변경'}
            </button>
          )}
          <button
            onClick={onClose}
            disabled={busy}
            className="w-full bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
