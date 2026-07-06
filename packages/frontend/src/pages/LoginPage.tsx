import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authApi } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { COMPANY_NAME, CEO_NAME, BIZ_NUMBER, TRADE_NUMBER, COMPANY_ADDRESS, COMPANY_PHONE } from '../constants/company';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuthStore();

  const isSuperAdminOnly = window.location.hostname === 'sys.hanjullo.com' || window.location.port === '5174';

  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // ★ 슈퍼관리자 2FA(TOTP) state
  const [showTotp, setShowTotp] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [enrollmentData, setEnrollmentData] = useState<{ enrollToken: string; qrDataUrl: string; backupCodes: string[]; loginId: string } | null>(null);
  const [enrollStep, setEnrollStep] = useState<'backup' | 'verify'>('backup');
  const [enrollCode, setEnrollCode] = useState('');
  const [enrollLoading, setEnrollLoading] = useState(false);
  const [enrollError, setEnrollError] = useState('');
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);

  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [tempUser, setTempUser] = useState<any>(null);
  const [tempToken, setTempToken] = useState('');
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPwConfirm, setNewPwConfirm] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  // 강제 로그아웃 모달
  const [showForceLogoutModal, setShowForceLogoutModal] = useState(false);
  const [forceLogoutMessage, setForceLogoutMessage] = useState('');

  // 발송 중 차단 모달
  const [showSendingBlockModal, setShowSendingBlockModal] = useState(false);
  const [sendingBlockMessage, setSendingBlockMessage] = useState('');

  // 페이지 진입 시 강제 로그아웃 사유 확인
  useEffect(() => {
    const reason = sessionStorage.getItem('forceLogoutReason');
    if (reason) {
      setForceLogoutMessage(reason);
      setShowForceLogoutModal(true);
      sessionStorage.removeItem('forceLogoutReason');
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // ★ loginId 앞뒤 공백 제거 — 모바일 자동완성/복붙 시 공백 끼면 backend SELECT 0 row → "계정 없음"
      const response = await authApi.login({
        loginId: loginId.trim(),
        password,
        userType: isSuperAdminOnly ? 'super_admin' : undefined,
        totpCode: showTotp ? totpCode.trim() : undefined,
      } as any);

      const data = response.data;

      // ★ 슈퍼관리자 2FA — enrollment 모드 진입 (QR + 백업 코드)
      if (data.enrollmentRequired) {
        setEnrollmentData({
          enrollToken: data.enrollToken,
          qrDataUrl: data.qrDataUrl,
          backupCodes: data.backupCodes,
          loginId: data.loginId,
        });
        setEnrollStep('backup');
        setBackupAcknowledged(false);
        setEnrollCode('');
        setEnrollError('');
        setLoading(false);
        return;
      }

      const { token, user, sessionTimeoutMinutes } = data;
      localStorage.setItem('sessionTimeoutMinutes', String(sessionTimeoutMinutes || 30));

      if (user.mustChangePassword) {
        setTempUser(user);
        setTempToken(token);
        setCurrentPw(password);
        setShowPasswordModal(true);
        setLoading(false);
        return;
      }

      login(user, token);

      if (user.userType === 'super_admin') {
        navigate('/admin');
      } else if (user.company?.usageType === 'agent') {
        // ★ 2026-07-03 에이전트(QTmsg) 전용 회사 — 카카오&RCS 랜딩 (대시보드 차단)
        navigate('/kakao-rcs');
      } else {
        // ★ 2026-07-03 카페24 앱 실행 랜딩 복귀 — 비로그인으로 /cafe24/launch 진입 시 저장한 mall_id로 복귀
        const cafe24Mall = sessionStorage.getItem('cafe24_return_mall_id');
        if (cafe24Mall) {
          sessionStorage.removeItem('cafe24_return_mall_id');
          navigate(`/cafe24/launch?mall_id=${encodeURIComponent(cafe24Mall)}`);
        } else {
          navigate('/dashboard');
        }
      }
    } catch (err: any) {
      const status = err.response?.status;
      const data = err.response?.data;

      // 발송 진행 중 — 로그인 차단
      if (status === 409 && data?.reason === 'sending_in_progress') {
        setSendingBlockMessage(data.error);
        setShowSendingBlockModal(true);
      } else if (status === 401 && data?.needTotp) {
        // ★ 슈퍼관리자 2FA — OTP 코드 입력 단계로 진입
        setShowTotp(true);
        setTotpCode('');
        setError(data.error || 'OTP 코드를 입력하세요.');
      } else {
        setError(data?.error || '로그인에 실패했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmEnrollment = async () => {
    if (!enrollmentData) return;
    setEnrollError('');
    if (!/^\d{6}$/.test(enrollCode)) {
      setEnrollError('6자리 숫자 코드를 입력하세요.');
      return;
    }
    setEnrollLoading(true);
    try {
      const res = await fetch('/api/auth/super/confirm-totp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enrollToken: enrollmentData.enrollToken, code: enrollCode }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setEnrollError(errData.error || 'OTP 검증에 실패했습니다.');
        return;
      }
      const result = await res.json();
      localStorage.setItem('sessionTimeoutMinutes', String(result.sessionTimeoutMinutes || 30));
      login(result.user, result.token);
      navigate('/admin');
    } catch (err: any) {
      setEnrollError('등록 중 오류가 발생했습니다.');
    } finally {
      setEnrollLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    setPwError('');
    if (newPw.length < 8) { setPwError('비밀번호는 8자 이상이어야 합니다.'); return; }
    if (newPw !== newPwConfirm) { setPwError('새 비밀번호가 일치하지 않습니다.'); return; }
    if (currentPw === newPw) { setPwError('기존 비밀번호와 다른 비밀번호를 입력하세요.'); return; }
    setPwLoading(true);
    try {
      await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: tempUser.id, currentPassword: currentPw, newPassword: newPw }),
      });
      login({ ...tempUser, mustChangePassword: false }, tempToken);
      if (tempUser.userType === 'super_admin') { navigate('/admin'); }
      else if (tempUser.company?.usageType === 'agent') { navigate('/kakao-rcs'); } // ★ 2026-07-03 에이전트 전용 랜딩
      else {
        // ★ 2026-07-03 카페24 앱 실행 랜딩 복귀
        const cafe24Mall = sessionStorage.getItem('cafe24_return_mall_id');
        if (cafe24Mall) { sessionStorage.removeItem('cafe24_return_mall_id'); navigate(`/cafe24/launch?mall_id=${encodeURIComponent(cafe24Mall)}`); }
        else { navigate('/dashboard'); }
      }
    } catch (err: any) { setPwError('비밀번호 변경에 실패했습니다.'); }
    finally { setPwLoading(false); }
  };

  // ===== 모달들 =====

  // 강제 로그아웃 모달 (다른 곳에서 로그인)
  const forceLogoutModal = showForceLogoutModal && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">세션이 종료되었습니다</h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">{forceLogoutMessage}</p>
        </div>
        <div className="px-6 pb-6 pt-4">
          <button
            onClick={() => setShowForceLogoutModal(false)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );

  // 발송 진행 중 차단 모달
  const sendingBlockModalEl = showSendingBlockModal && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">접속할 수 없습니다</h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">{sendingBlockMessage}</p>
        </div>
        <div className="px-6 pb-6 pt-4">
          <button
            onClick={() => setShowSendingBlockModal(false)}
            className="w-full bg-gray-600 hover:bg-gray-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );

  // ★ 슈퍼관리자 2FA(TOTP) 등록 모달 — QR + 백업 코드 + 첫 6자리 확인
  const enrollmentModal = enrollmentData && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        {enrollStep === 'backup' ? (
          <>
            <div className="px-6 pt-8 pb-2 text-center">
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-slate-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900">2단계 인증(OTP) 등록</h3>
              <p className="text-sm text-gray-500 mt-2">Google Authenticator 앱으로 QR 스캔 후 6자리 코드 입력</p>
            </div>
            <div className="px-6 pb-6 pt-2 space-y-4">
              <div className="flex justify-center bg-gray-50 rounded-xl p-4">
                <img src={enrollmentData.qrDataUrl} alt="OTP QR" className="w-48 h-48" />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-700 mb-2">백업 코드 (폰 분실 대비, 1회용 · 안전 보관)</p>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 grid grid-cols-2 gap-1.5 font-mono text-xs">
                  {enrollmentData.backupCodes.map((c, i) => (
                    <div key={i} className="px-2 py-1 bg-white rounded border border-amber-100 text-center">{c}</div>
                  ))}
                </div>
                <button type="button" onClick={() => navigator.clipboard.writeText(enrollmentData.backupCodes.join('\n'))}
                  className="mt-2 text-xs text-slate-600 hover:text-slate-900 underline">전체 복사</button>
              </div>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={backupAcknowledged} onChange={(e) => setBackupAcknowledged(e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-slate-700 focus:ring-slate-700" />
                <span className="text-xs text-gray-600">백업 코드를 안전한 곳에 저장했습니다 (이 화면을 떠나면 다시 볼 수 없음)</span>
              </label>
              <button onClick={() => setEnrollStep('verify')} disabled={!backupAcknowledged}
                className="w-full bg-slate-800 hover:bg-slate-900 disabled:bg-gray-300 text-white font-medium py-2.5 rounded-xl text-sm transition-colors">
                다음 (6자리 코드 입력)
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-6 pt-8 pb-2 text-center">
              <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-7 h-7 text-slate-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-lg font-bold text-gray-900">등록 확인</h3>
              <p className="text-sm text-gray-500 mt-2">{enrollmentData.loginId} · 앱에 표시된 6자리 코드</p>
            </div>
            <div className="px-6 pb-6 pt-4 space-y-3">
              <input type="text" inputMode="numeric" maxLength={6} value={enrollCode}
                onChange={(e) => setEnrollCode(e.target.value.replace(/\D/g, ''))}
                className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:ring-2 focus:ring-slate-700 focus:border-slate-700 outline-none transition text-center text-2xl font-mono tracking-widest"
                placeholder="000000" autoFocus />
              {enrollError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600">{enrollError}</div>}
              <div className="flex gap-2">
                <button onClick={() => setEnrollStep('backup')} disabled={enrollLoading}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-2.5 rounded-xl text-sm transition-colors">
                  이전
                </button>
                <button onClick={handleConfirmEnrollment} disabled={enrollLoading || enrollCode.length !== 6}
                  className="flex-1 bg-slate-800 hover:bg-slate-900 disabled:bg-gray-300 text-white font-medium py-2.5 rounded-xl text-sm transition-colors">
                  {enrollLoading ? '확인 중...' : '등록 확인'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );

  // 비밀번호 변경 모달
  const passwordModal = showPasswordModal && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-orange-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">비밀번호 변경 필요</h3>
          <p className="text-sm text-gray-500 mt-1">보안을 위해 비밀번호를 변경해주세요.</p>
        </div>
        <div className="px-6 pb-6 pt-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 *</label>
            <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-sm"
              placeholder="8자 이상 입력" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">새 비밀번호 확인 *</label>
            <input type="password" value={newPwConfirm} onChange={(e) => setNewPwConfirm(e.target.value)}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition text-sm"
              placeholder="비밀번호 재입력" />
          </div>
          {pwError && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 text-sm text-red-600">{pwError}</div>}
          <button onClick={handlePasswordChange} disabled={pwLoading || !newPw || !newPwConfirm}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-xl text-sm transition-colors">
            {pwLoading ? '변경 중...' : '비밀번호 변경'}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex">
      {/* 좌측: 브랜드 패널 (슈퍼관리자는 다크, 고객사는 그린 그라데이션) */}
      <div className={`hidden lg:flex w-[480px] flex-col justify-between p-12 relative overflow-hidden ${
        isSuperAdminOnly
          ? 'bg-gradient-to-br from-slate-800 via-slate-900 to-gray-900'
          : 'bg-gradient-to-br from-emerald-600 via-teal-700 to-blue-800'
      }`}>
        <div className="relative z-10">
          <img src="/logo.png" alt="한줄로" className="h-9 brightness-0 invert mb-10" />
          <h1 className="text-3xl font-bold text-white leading-snug">
            {isSuperAdminOnly ? (
              <>시스템 관리<br/>콘솔</>
            ) : (
              <><span className="font-black">한줄로 AI</span><br/>비즈메세징 플랫폼</>
            )}
          </h1>
          <p className="text-white/60 mt-4 text-sm leading-relaxed">
            {isSuperAdminOnly ? (
              <>고객사 관리, 발송 현황 모니터링,<br/>요금제 설정을 한 곳에서 관리합니다</>
            ) : (
              <>AI 타겟 분석부터 캠페인 발송까지<br/>기업형 비즈메세징을 한번에</>
            )}
          </p>
          {/* 비로그인 방문자용 서비스 소개 (공개 정적 페이지) — 고객사 로그인 화면에만 */}
          {!isSuperAdminOnly && (
            <a href="/about-ai-operator.html" target="_blank" rel="noopener"
              className="inline-flex items-center gap-1.5 mt-6 text-sm font-medium text-white/90 hover:text-white border border-white/25 hover:border-white/50 rounded-full px-4 py-2 transition">
              서비스 소개 보기
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
            </a>
          )}
        </div>

        <div className="relative z-10 space-y-3">
          <div className="flex gap-2">
            <Link to="/privacy" className="text-white/40 hover:text-white/70 text-xs transition">개인정보처리방침</Link>
            <span className="text-white/20">|</span>
            <Link to="/terms" className="text-white/40 hover:text-white/70 text-xs transition">이용약관</Link>
          </div>
          <div className="text-white/30 text-xs leading-relaxed">
            <p>{COMPANY_NAME} | 대표이사 {CEO_NAME}</p>
            <p>사업자등록번호 {BIZ_NUMBER} | 통신판매신고 {TRADE_NUMBER}</p>
            <p>{COMPANY_ADDRESS}</p>
            <p className="mt-1">© {new Date().getFullYear()} INVITO. All rights reserved.</p>
          </div>
        </div>

        {/* 배경 장식 */}
        <div className="absolute top-[-80px] right-[-80px] w-[250px] h-[250px] bg-white/5 rounded-full" />
        <div className="absolute bottom-[-60px] left-[-60px] w-[200px] h-[200px] bg-white/5 rounded-full" />
        <div className="absolute top-1/3 right-[-30px] w-[120px] h-[120px] bg-white/5 rounded-full" />
      </div>

      {/* 우측: 로그인 폼 */}
      <div className="flex-1 bg-gray-50 flex flex-col">
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="w-full max-w-sm">
            {/* 모바일 로고 */}
            <div className="lg:hidden text-center mb-8">
              <img src="/logo.png" alt="한줄로" className="h-9 mx-auto" />
              <p className="mt-2 text-sm text-gray-500">
                {isSuperAdminOnly ? '시스템 관리' : 'AI 마케팅 자동화'}
              </p>
            </div>

            <h2 className="text-xl font-bold text-gray-900 mb-1">로그인</h2>
            <p className="text-sm text-gray-500 mb-8">
              {isSuperAdminOnly ? '관리자 계정으로 로그인하세요' : <><span className="font-semibold">한줄로 AI</span> 계정으로 로그인하세요</>}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">아이디</label>
                <input type="text" value={loginId} onChange={(e) => setLoginId(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition bg-white"
                  placeholder="아이디를 입력하세요" autoFocus required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">비밀번호</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition bg-white"
                  placeholder="비밀번호를 입력하세요" required />
              </div>

              {isSuperAdminOnly && showTotp && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5">OTP 코드 (6자리)</label>
                  <input type="text" inputMode="numeric" maxLength={6} value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-slate-700 focus:border-slate-700 outline-none transition bg-white tracking-widest text-center font-mono"
                    placeholder="000000" autoFocus required />
                  <p className="text-xs text-gray-400 mt-1.5">Google Authenticator 앱의 6자리 코드. 폰 분실 시 백업 코드(8자 hex)도 사용 가능.</p>
                </div>
              )}

              {error && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading}
                className={`w-full font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-50 ${
                  isSuperAdminOnly
                    ? 'bg-slate-800 hover:bg-slate-900 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                }`}>
                {loading ? '로그인 중...' : '로그인'}
              </button>
            </form>

            {!isSuperAdminOnly && (
              <div className="mt-6 text-center">
                <a href="/about-ai-operator.html" target="_blank" rel="noopener"
                  className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition">
                  한줄로가 처음이신가요? 서비스 소개 보기
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                </a>
              </div>
            )}

            <p className="text-center text-xs text-gray-400 mt-6">
              문의전화 {COMPANY_PHONE}
            </p>
          </div>
        </div>

        {/* 모바일 푸터 */}
        <footer className="lg:hidden bg-gray-100 text-gray-400 py-4 px-4">
          <div className="max-w-4xl mx-auto text-center text-xs leading-relaxed">
            <p>{COMPANY_NAME} | {BIZ_NUMBER}</p>
            <p className="mt-1">
              <Link to="/privacy" className="hover:text-gray-600 transition">개인정보처리방침</Link>
              <span className="mx-2">|</span>
              <Link to="/terms" className="hover:text-gray-600 transition">이용약관</Link>
            </p>
          </div>
        </footer>
      </div>

      {/* 모달들 */}
      {forceLogoutModal}
      {sendingBlockModalEl}
      {passwordModal}
      {enrollmentModal}
    </div>
  );
}
