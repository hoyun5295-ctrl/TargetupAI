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

  // 서비스 이용신청 문의 모달 (비로그인 방문자용 — 공개 endpoint /api/companies/inquiry 재사용)
  const [showInquiryModal, setShowInquiryModal] = useState(false);
  const [inquiryForm, setInquiryForm] = useState({
    companyName: '', contactName: '', phone: '', email: '', subject: '', message: '',
  });
  const [inquirySubmitting, setInquirySubmitting] = useState(false);
  const [inquiryError, setInquiryError] = useState('');
  const [inquirySuccess, setInquirySuccess] = useState(false);
  const [inquiryHoneypot, setInquiryHoneypot] = useState('');

  // 발송 중 차단 모달
  const [showSendingBlockModal, setShowSendingBlockModal] = useState(false);
  const [sendingBlockMessage, setSendingBlockMessage] = useState('');

  // ★ 2026-08-18 접속 인계 — 이미 접속 중인 아이디일 때 끊을지 말지 사용자가 고른다.
  //   retry = 이 동의를 받은 뒤 다시 실행할 요청(일반/슈퍼 로그인 · 슈퍼관리자 최초 2FA 등록)
  const [takeover, setTakeover] = useState<{
    ticket: string;
    session: { deviceLabel: string; ipMasked: string; loginAtText: string; lastActivityText: string };
    retry: 'login' | 'enroll';
  } | null>(null);
  const [takeoverLoading, setTakeoverLoading] = useState(false);

  // ★ 2026-08-18 다중 인증(MFA) — 등록된 담당자 번호로 받은 6자리를 입력한다
  const [mfa, setMfa] = useState<{ ticket: string; maskedPhone: string; expiresInMinutes: number } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [mfaLoading, setMfaLoading] = useState(false);
  const [mfaResendMsg, setMfaResendMsg] = useState('');

  // 로그인 보안 강화 사전 고지 — 시행일(9/1) 전까지, 확인 전까지만 노출
  const [showSecurityNotice, setShowSecurityNotice] = useState(
    () => Date.now() < new Date('2026-09-01T00:00:00+09:00').getTime()
      && localStorage.getItem('securityNotice20260901') !== 'seen'
  );

  // 페이지 진입 시 강제 로그아웃 사유 확인
  useEffect(() => {
    const reason = sessionStorage.getItem('forceLogoutReason');
    if (reason) {
      setForceLogoutMessage(reason);
      setShowForceLogoutModal(true);
      sessionStorage.removeItem('forceLogoutReason');
    }
  }, []);

  /**
   * 로그인 성공 처리 — 일반 로그인과 MFA 통과가 같은 것을 쓴다.
   * 두 벌이 되면 한쪽만 고쳐지는 날이 온다(비밀번호 변경·에이전트 랜딩·카페24 복귀 분기가 조용히 갈린다).
   */
  const applyLoginSuccess = (data: any) => {
    const { token, user, sessionTimeoutMinutes, mfaDeviceToken } = data;
    localStorage.setItem('sessionTimeoutMinutes', String(sessionTimeoutMinutes || 30));
    // 이 기기를 24시간 신뢰 — 다음 로그인 때 인증번호를 묻지 않는다
    if (mfaDeviceToken) localStorage.setItem('mfaDeviceToken', mfaDeviceToken);

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
  };

  // takeoverTicket이 있으면 "기존 접속을 끊고 로그인"에 동의한 재시도다 (사용자는 다시 입력하지 않는다)
  const doLogin = async (takeoverTicket?: string) => {
    setError('');
    setLoading(true);

    try {
      // ★ loginId 앞뒤 공백 제거 — 모바일 자동완성/복붙 시 공백 끼면 backend SELECT 0 row → "계정 없음"
      const response = await authApi.login({
        loginId: loginId.trim(),
        password,
        userType: isSuperAdminOnly ? 'super_admin' : undefined,
        totpCode: showTotp ? totpCode.trim() : undefined,
        takeoverTicket,
        // 이 기기가 24시간 신뢰 안이면 서버가 인증번호를 묻지 않는다
        mfaDeviceToken: localStorage.getItem('mfaDeviceToken') || undefined,
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

      applyLoginSuccess(data);
    } catch (err: any) {
      const status = err.response?.status;
      const data = err.response?.data;

      // ★ 이미 접속 중인 아이디 — 끊을지 말지 사용자에게 묻는다 (여기서 서버 세션은 아직 그대로다)
      if (status === 409 && data?.code === 'SESSION_IN_USE') {
        setTakeover({ ticket: data.takeoverTicket, session: data.activeSession, retry: 'login' });
      } else if (status === 409 && data?.reason === 'sending_in_progress') {
        // 발송 진행 중 — 로그인 차단
        setSendingBlockMessage(data.error);
        setShowSendingBlockModal(true);
      } else if (status === 401 && data?.mfaRequired) {
        // ★ 다중 인증 — 등록된 담당자 번호로 6자리가 갔다. 아직 로그인 토큰은 받지 않았다
        setMfa({ ticket: data.mfaTicket, maskedPhone: data.maskedPhone, expiresInMinutes: data.expiresInMinutes || 5 });
        setMfaCode('');
        setMfaError('');
        setMfaResendMsg(data.resent === false ? '이미 보낸 인증번호를 입력해주세요.' : '');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await doLogin();
  };

  const handleMfaVerify = async () => {
    if (!mfa) return;
    if (!/^\d{6}$/.test(mfaCode)) { setMfaError('6자리 숫자를 입력해주세요.'); return; }
    setMfaLoading(true);
    setMfaError('');
    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaTicket: mfa.ticket, code: mfaCode, appSource: 'hanjul' }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        // 티켓이 죽었거나 계정이 잠겼으면 처음부터 다시 — 입력창을 닫고 사유를 로그인 화면에 남긴다
        if (data?.code === 'MFA_TICKET_INVALID' || data?.code === 'ACCOUNT_LOCKED') {
          setMfa(null);
          setError(data?.error || '다시 로그인해주세요.');
          return;
        }
        setMfaError(data?.error || '인증에 실패했습니다.');
        return;
      }
      setMfa(null);
      applyLoginSuccess(data);
    } catch {
      setMfaError('인증 중 오류가 발생했습니다.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleMfaResend = async () => {
    if (!mfa) return;
    setMfaLoading(true);
    setMfaError('');
    setMfaResendMsg('');
    try {
      const res = await fetch('/api/auth/mfa/resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfaTicket: mfa.ticket }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        if (data?.code === 'MFA_COOLDOWN') { setMfaResendMsg(data.error); return; }
        setMfaError(data?.error || '재발송에 실패했습니다.');
        return;
      }
      // 새 챌린지가 생겼으므로 티켓을 교체한다(옛 티켓은 옛 인증번호를 가리킨다)
      setMfa({ ticket: data.mfaTicket, maskedPhone: data.maskedPhone, expiresInMinutes: data.expiresInMinutes || 5 });
      setMfaCode('');
      setMfaResendMsg('인증번호를 다시 보냈습니다.');
    } catch {
      setMfaError('재발송 중 오류가 발생했습니다.');
    } finally {
      setMfaLoading(false);
    }
  };

  const handleConfirmEnrollment = async (takeoverTicket?: string) => {
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
        body: JSON.stringify({ enrollToken: enrollmentData.enrollToken, code: enrollCode, takeoverTicket }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        // ★ 이미 접속 중인 아이디 — 등록은 끝났고 세션만 남았다. 끊을지 여기서 고른다
        if (res.status === 409 && errData?.code === 'SESSION_IN_USE') {
          setTakeover({ ticket: errData.takeoverTicket, session: errData.activeSession, retry: 'enroll' });
          return;
        }
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
  const openInquiry = () => {
    setInquiryError('');
    setInquirySuccess(false);
    setShowInquiryModal(true);
  };

  const closeInquiry = () => {
    setShowInquiryModal(false);
  };

  const handleInquirySubmit = async () => {
    // 허니팟(봇 차단) — 사용자 비노출 필드가 채워지면 조용히 종료
    if (inquiryHoneypot) { setShowInquiryModal(false); return; }
    const f = inquiryForm;
    if (!f.contactName.trim() || !f.phone.trim() || !f.email.trim() || !f.subject.trim() || !f.message.trim()) {
      setInquiryError('담당자명, 연락처, 이메일, 제목, 문의 내용을 모두 입력해주세요.');
      return;
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(f.email.trim())) {
      setInquiryError('이메일 형식을 확인해주세요.');
      return;
    }
    setInquirySubmitting(true);
    setInquiryError('');
    try {
      const res = await fetch('/api/companies/inquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: f.companyName.trim(),
          contactName: f.contactName.trim(),
          phone: f.phone.trim(),
          email: f.email.trim(),
          subject: f.subject.trim(),
          message: f.message.trim(),
        }),
      });
      const data = await res.json().catch(() => ({} as any));
      if (res.ok) {
        setInquirySuccess(true);
        setInquiryForm({ companyName: '', contactName: '', phone: '', email: '', subject: '', message: '' });
      } else {
        setInquiryError((data && data.error) || '문의 전송에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } catch {
      setInquiryError('문의 전송 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setInquirySubmitting(false);
    }
  };

  // ★ 접속 인계 동의 — 누르면 그 자리에서 다시 요청한다(아이디·비밀번호 재입력 없음)
  const handleTakeoverConfirm = async () => {
    if (!takeover) return;
    const consumed = takeover;
    setTakeoverLoading(true);
    try {
      if (consumed.retry === 'enroll') {
        await handleConfirmEnrollment(consumed.ticket);
      } else {
        await doLogin(consumed.ticket);
      }
    } finally {
      setTakeoverLoading(false);
      // 재시도 사이에 또 다른 접속이 생겨 새 티켓이 들어왔으면 그것은 남긴다 — 소비한 동의만 지운다
      setTakeover((prev) => (prev && prev.ticket === consumed.ticket ? null : prev));
    }
  };

  // ★ 2026-08-18 로그인 보안 강화 사전 고지 — 시행 전까지 로그인 화면에서 1회 안내
  const securityNoticeModal = showSecurityNotice && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-40 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">로그인 보안 강화 안내</h3>
          <p className="text-sm text-blue-600 font-medium mt-1">2026년 9월 1일 시행</p>
        </div>
        <div className="px-6 pt-4 text-sm text-gray-600 leading-relaxed space-y-3">
          <p>
            방송미디어통신위원회 「전송자격인증 기준 등에 관한 고시」에 따라 문자 발송 서비스는
            로그인 시 담당자 휴대폰 인증을 적용해야 합니다.
          </p>
          <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 space-y-2">
            <p className="text-gray-700"><span className="font-medium">9월 1일부터</span> 로그인 시 담당자 휴대폰으로 발송되는 <span className="font-medium">6자리 인증번호</span> 입력이 추가됩니다.</p>
            <p className="text-xs text-gray-500">· 인증 후 <span className="font-medium text-gray-700">24시간</span> 동안은 같은 기기에서 다시 묻지 않습니다.</p>
            <p className="text-xs text-gray-500">· 담당자 휴대폰번호는 계약 담당자 기준으로 등록됩니다. 변경이 필요하시면 담당자에게 연락 주세요.</p>
          </div>
        </div>
        <div className="px-6 pb-6 pt-4">
          <button
            onClick={() => { localStorage.setItem('securityNotice20260901', 'seen'); setShowSecurityNotice(false); }}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            확인했습니다
          </button>
        </div>
      </div>
    </div>
  );

  // ★ 다중 인증 입력 — 등록된 담당자 번호로 받은 6자리
  const mfaModal = mfa && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-blue-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 1.5H8.25A2.25 2.25 0 006 3.75v16.5a2.25 2.25 0 002.25 2.25h7.5A2.25 2.25 0 0018 20.25V3.75a2.25 2.25 0 00-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">휴대폰 인증</h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            <span className="font-medium text-gray-700">{mfa.maskedPhone}</span> 으로 인증번호를 보냈습니다.<br />
            {mfa.expiresInMinutes}분 안에 6자리를 입력해주세요.
          </p>
        </div>
        <div className="px-6 pt-4">
          <input
            type="text"
            inputMode="numeric"
            autoFocus
            maxLength={6}
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter' && mfaCode.length === 6) handleMfaVerify(); }}
            placeholder="000000"
            className="w-full text-center text-2xl tracking-[0.4em] font-semibold border border-gray-200 rounded-xl py-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {mfaError && <p className="text-xs text-red-600 mt-2 text-center">{mfaError}</p>}
          {mfaResendMsg && <p className="text-xs text-gray-500 mt-2 text-center">{mfaResendMsg}</p>}
        </div>
        <div className="px-6 pb-6 pt-4 space-y-2">
          <button
            onClick={handleMfaVerify}
            disabled={mfaLoading || mfaCode.length !== 6}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            {mfaLoading ? '확인 중…' : '인증하고 로그인'}
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleMfaResend}
              disabled={mfaLoading}
              className="flex-1 bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              인증번호 재발송
            </button>
            <button
              onClick={() => { setMfa(null); setMfaCode(''); setMfaError(''); }}
              disabled={mfaLoading}
              className="flex-1 bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm transition-colors"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  // z-[60] — 슈퍼관리자 2FA 등록 모달(z-50) 위에서도 이 선택이 보여야 한다
  const takeoverModal = takeover && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-[60] animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden animate-[zoomIn_0.25s_ease-out]">
        <div className="px-6 pt-8 pb-2 text-center">
          <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-amber-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-gray-900">이미 접속 중인 아이디입니다</h3>
          <p className="text-sm text-gray-500 mt-2 leading-relaxed">
            이 아이디로 지금 다른 곳에서 사용 중입니다.<br />계속하면 그곳의 접속은 종료됩니다.
          </p>
        </div>
        <div className="px-6 pt-4">
          <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 text-left space-y-1.5">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-gray-400 shrink-0">기기</span>
              <span className="text-gray-700 font-medium text-right">{takeover.session.deviceLabel}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-gray-400 shrink-0">접속 시각</span>
              <span className="text-gray-700 font-medium text-right">{takeover.session.loginAtText}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-gray-400 shrink-0">마지막 활동</span>
              <span className="text-gray-700 font-medium text-right">{takeover.session.lastActivityText}</span>
            </div>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="text-gray-400 shrink-0">IP</span>
              <span className="text-gray-700 font-medium text-right">{takeover.session.ipMasked}</span>
            </div>
          </div>
        </div>
        <div className="px-6 pb-6 pt-4 space-y-2">
          <button
            onClick={handleTakeoverConfirm}
            disabled={takeoverLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            {takeoverLoading ? '로그인 중…' : '기존 접속 종료하고 로그인'}
          </button>
          <button
            onClick={() => setTakeover(null)}
            disabled={takeoverLoading}
            className="w-full bg-white hover:bg-gray-50 disabled:opacity-50 border border-gray-200 text-gray-600 font-medium py-2.5 rounded-xl text-sm transition-colors"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );

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
                <button onClick={() => handleConfirmEnrollment()} disabled={enrollLoading || enrollCode.length !== 6}
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

  // 서비스 이용신청 문의 모달
  const inquiryModal = showInquiryModal && (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-[fadeIn_0.2s_ease-out]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-[zoomIn_0.25s_ease-out] max-h-[92vh] flex flex-col">
        {/* 헤더 */}
        <div className="relative bg-gradient-to-br from-emerald-600 via-teal-600 to-blue-700 px-6 py-5 flex-shrink-0">
          <button type="button" onClick={closeInquiry} aria-label="닫기"
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg text-white/80 hover:text-white hover:bg-white/15 transition">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <h3 className="text-lg font-bold text-white">서비스 이용신청 문의</h3>
          <p className="text-sm text-white/80 mt-1">도입 상담을 남겨주시면 담당자가 빠르게 연락드립니다.</p>
        </div>

        {inquirySuccess ? (
          <div className="px-6 py-10 text-center">
            <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
            </div>
            <h4 className="text-lg font-bold text-gray-900">문의가 접수되었습니다</h4>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">담당자가 확인 후 빠르게 연락드리겠습니다.<br />감사합니다.</p>
            <button type="button" onClick={closeInquiry}
              className="mt-6 w-full bg-emerald-600 hover:bg-emerald-700 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors">
              확인
            </button>
          </div>
        ) : (
          <div className="px-6 py-5 overflow-y-auto">
            {/* 허니팟(봇 차단) — 사용자 비노출 */}
            <input type="text" value={inquiryHoneypot} onChange={(e) => setInquiryHoneypot(e.target.value)}
              tabIndex={-1} autoComplete="off" aria-hidden="true"
              className="absolute -left-[9999px] w-px h-px opacity-0" />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">회사명</label>
                <input value={inquiryForm.companyName} onChange={(e) => setInquiryForm(f => ({ ...f, companyName: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition bg-white"
                  placeholder="회사명 (선택)" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">담당자명 <span className="text-emerald-600">*</span></label>
                <input value={inquiryForm.contactName} onChange={(e) => setInquiryForm(f => ({ ...f, contactName: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition bg-white"
                  placeholder="이름" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">연락처 <span className="text-emerald-600">*</span></label>
                <input value={inquiryForm.phone} onChange={(e) => setInquiryForm(f => ({ ...f, phone: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition bg-white"
                  placeholder="010-0000-0000" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1.5">이메일 <span className="text-emerald-600">*</span></label>
                <input type="email" value={inquiryForm.email} onChange={(e) => setInquiryForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition bg-white"
                  placeholder="name@company.com" />
              </div>
            </div>

            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">문의 제목 <span className="text-emerald-600">*</span></label>
              <input value={inquiryForm.subject} onChange={(e) => setInquiryForm(f => ({ ...f, subject: e.target.value }))}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition bg-white"
                placeholder="예) 도입 상담 및 견적 문의" />
            </div>

            <div className="mt-3">
              <label className="block text-xs font-medium text-gray-500 mb-1.5">문의 내용 <span className="text-emerald-600">*</span></label>
              <textarea value={inquiryForm.message} onChange={(e) => setInquiryForm(f => ({ ...f, message: e.target.value }))}
                rows={4}
                className="w-full px-3.5 py-2.5 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition bg-white resize-none"
                placeholder="문의하실 내용을 자유롭게 작성해주세요." />
            </div>

            {inquiryError && (
              <div className="mt-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                <p className="text-sm text-red-600">{inquiryError}</p>
              </div>
            )}

            <button type="button" onClick={handleInquirySubmit} disabled={inquirySubmitting}
              className="mt-5 w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl text-sm transition-colors">
              {inquirySubmitting ? '전송 중...' : '문의 전송'}
            </button>
            <p className="mt-3 text-center text-[11px] text-gray-400">문의 내용은 담당자 이메일로 전달됩니다.</p>
          </div>
        )}
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
          {/* 비로그인 방문자용 서비스 소개 + 이용신청 문의 — 고객사 로그인 화면에만 */}
          {!isSuperAdminOnly && (
            <div className="mt-6 flex flex-col items-start gap-3">
              {/* ?v= 캐시 버스터 — 소개 페이지 내용/연출 갱신 시 3곳(LoginPage 2·DashboardHeader 1) 동시에 올릴 것 (Cache-Control 미설정 휴리스틱 캐시가 옛 버전을 재검증 없이 표시하는 문제 차단) */}
              <a href="/about-ai-operator.html?v=4" target="_blank" rel="noopener"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90 hover:text-white border border-white/25 hover:border-white/50 rounded-full px-4 py-2 transition">
                서비스 소개 보기
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
              </a>
              <button type="button" onClick={openInquiry}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 bg-white hover:bg-white/90 rounded-full px-4 py-2 shadow-sm transition">
                서비스 이용신청 문의
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
              </button>
              {/* ★ 2026-08-16 AI 마케팅 진단(퍼널 B) 진입 — 영업 링크 없이도 방문자가 닿는 상시 문 */}
              <Link to="/diagnosis"
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 rounded-full px-4 py-2 shadow-sm transition">
                무료 마케팅 진단 받아보기
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
              </Link>
            </div>
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
              <div className="mt-6 text-center space-y-2.5">
                <a href="/about-ai-operator.html?v=4" target="_blank" rel="noopener"
                  className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600 hover:text-emerald-700 transition">
                  한줄로가 처음이신가요? 서비스 소개 보기
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                </a>
                <div>
                  <button type="button" onClick={openInquiry}
                    className="inline-flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl px-4 py-2.5 transition">
                    서비스 이용신청 문의
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </button>
                </div>
                {/* ★ 2026-08-16 AI 마케팅 진단(퍼널 B) — 모바일 진입(좌측 패널은 hidden lg:flex) */}
                <div>
                  <Link to="/diagnosis"
                    className="inline-flex items-center justify-center gap-1.5 w-full text-sm font-semibold text-white bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 rounded-xl px-4 py-2.5 transition">
                    무료 마케팅 진단 받아보기
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2.2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
                  </Link>
                </div>
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
      {securityNoticeModal}
      {mfaModal}
      {takeoverModal}
      {forceLogoutModal}
      {sendingBlockModalEl}
      {passwordModal}
      {enrollmentModal}
      {inquiryModal}
    </div>
  );
}
