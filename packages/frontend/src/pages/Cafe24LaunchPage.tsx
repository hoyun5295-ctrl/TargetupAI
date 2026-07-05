/**
 * Cafe24LaunchPage — 카페24 "앱 실행" 랜딩 (심사위원 동선 방어).
 *
 * 진입: 카페24 개발자센터 App URL = https://hanjul.ai/cafe24/launch (쿼리 mall_id 등 부착).
 * 공개 라우트(PrivateRoute 아님) — 이 페이지가 로그인 상태 분기를 스스로 판별한다.
 *   1) 로그인 + 회사관리자 + 미연동 → [카페24 연결](기존 /oauth/authorize 재사용)
 *   2) 로그인 + 이미 연동됨 → 현황 보기 / 대시보드
 *   3) 비로그인 → 로그인(토큰) 없으면 즉시 /oauth/install-start로 자동 이동(설치 인증) + 버튼 폴백 + 기존 고객용 로그인 보조.
 *      카페24 앱은 계약 고객의 자사몰 연동 도구 — 설치 동선에서 계정 없이 OAuth만 완료(계정 자동생성·발송 없음).
 *
 * A-0: 최초 진입 시 앱 실행 파라미터를 서버로 fire-and-forget POST → PM2 로그로 실측(저장/부작용 없음).
 */

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Store, ArrowRight, CheckCircle2, LogIn, ShieldCheck, Loader2, RefreshCcw } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useToast } from '../components/ToastProvider';

export default function Cafe24LaunchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isAuthenticated } = useAuthStore();

  const rawMallId = (searchParams.get('mall_id') || '').trim().toLowerCase();
  const mallId = /^[a-z0-9_-]+$/.test(rawMallId) ? rawMallId : '';

  const [statusLoading, setStatusLoading] = useState(false);
  const [connectedMallId, setConnectedMallId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const isCompanyAdmin = isAuthenticated && user?.userType === 'company_admin';
  const alreadyConnected = !!connectedMallId && (!mallId || connectedMallId === mallId);

  // A-0 — 앱 실행 파라미터 서버 로그 (PM2 실측용). 최초 1회, 실패 무시.
  useEffect(() => {
    const params: Record<string, string> = {};
    searchParams.forEach((v, k) => { params[k] = v; });
    fetch('/api/cafe24/launch-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ★ 2026-07-05 카페24 설치·심사 동선 — mall_id 있고 로그인(토큰) 없으면 버튼 없이 즉시 설치 OAuth로.
  //   카페24 반려 #1 "설치 시 인증 자동 수행" 정면 충족. 로그인 사용자(토큰 有)는 아래 분기 흐름 유지.
  //   리다이렉트 차단 등 예외 시 화면의 "카페24 연동 시작" 버튼이 폴백.
  useEffect(() => {
    if (mallId && !localStorage.getItem('token')) {
      window.location.replace(`/api/cafe24/oauth/install-start?mall_id=${encodeURIComponent(mallId)}`);
    }
  }, [mallId]);

  // company_admin이면 현재 카페24 연동 상태 조회
  useEffect(() => {
    if (!isCompanyAdmin) return;
    let alive = true;
    (async () => {
      setStatusLoading(true);
      try {
        const res = await fetch('/api/cafe24/status', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
        });
        const data = await res.json();
        if (alive && data?.success && data?.connected) setConnectedMallId(data.mall_id || null);
      } catch {
        /* 상태 조회 실패는 무시 — 연결 버튼은 그대로 노출 */
      } finally {
        if (alive) setStatusLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [isCompanyAdmin]);

  const handleLoginContinue = () => {
    if (mallId) sessionStorage.setItem('cafe24_return_mall_id', mallId);
    navigate('/login');
  };

  const handleConnect = async () => {
    if (!mallId) { toast.error('몰 정보가 없어 연결을 시작할 수 없습니다.'); return; }
    setConnecting(true);
    try {
      const res = await fetch(`/api/cafe24/oauth/authorize?mall_id=${encodeURIComponent(mallId)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (data?.success && data?.authorize_url) {
        window.open(data.authorize_url, 'cafe24_oauth', 'width=720,height=820');
        toast.info('새 창에서 카페24 로그인·동의를 마친 뒤 [연결 확인]을 눌러주세요.');
      } else {
        toast.error(data?.error || '카페24 연결을 시작하지 못했습니다.');
      }
    } catch (e: any) {
      toast.error(e?.message || '카페24 연결 처리 중 오류가 발생했습니다.');
    } finally {
      setConnecting(false);
    }
  };

  const refreshStatus = async () => {
    setStatusLoading(true);
    try {
      const res = await fetch('/api/cafe24/status', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      const data = await res.json();
      if (data?.success && data?.connected) {
        setConnectedMallId(data.mall_id || null);
        toast.success('연결이 확인되었습니다.');
      } else {
        toast.info('아직 연결이 확인되지 않았습니다. 카페24 동의를 마쳤는지 확인해주세요.');
      }
    } catch {
      toast.error('연결 상태를 조회하지 못했습니다.');
    } finally {
      setStatusLoading(false);
    }
  };

  const primaryBtn = 'w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-semibold text-sm transition-colors bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-400 hover:to-fuchsia-400 text-white shadow-lg shadow-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed';
  const secondaryBtn = 'w-full inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl font-medium text-sm transition-colors bg-white/5 hover:bg-white/10 border border-white/10 text-white/80';

  const renderBranch = () => {
    // mall_id 없음 — 카페24 밖에서 직접 진입한 경우
    if (!mallId) {
      return (
        <div className="text-center">
          <p className="text-white/70 text-sm leading-relaxed mb-6">
            카페24 쇼핑몰 관리자에서 한줄로AI 앱을 실행하면 이 화면에서 몰 연결이 이어집니다.
          </p>
          {isAuthenticated ? (
            <button type="button" className={primaryBtn} onClick={() => navigate('/dashboard')}>
              대시보드로 이동 <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" className={primaryBtn} onClick={handleLoginContinue}>
              <LogIn className="w-4 h-4" /> 한줄로 로그인
            </button>
          )}
        </div>
      );
    }

    // 비로그인 — 계정 없이 바로 카페24 OAuth(설치 인증) 시작. 한줄로 로그인은 기존 고객용 보조 경로.
    if (!isAuthenticated) {
      return (
        <div className="text-center">
          <p className="text-white/70 text-sm leading-relaxed mb-6">
            아래 버튼을 누르면 카페24 권한 동의 후 이 몰의 설치·연동이 완료됩니다.
          </p>
          <button
            type="button"
            className={primaryBtn}
            onClick={() => { window.location.href = `/api/cafe24/oauth/install-start?mall_id=${encodeURIComponent(mallId)}`; }}
          >
            <ShieldCheck className="w-4 h-4" /> 카페24 연동 시작
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/70 text-xs mt-4 transition-colors"
            onClick={handleLoginContinue}
          >
            <LogIn className="w-3 h-3" /> 이미 한줄로를 이용 중이신가요? 로그인
          </button>
        </div>
      );
    }

    // 로그인 O + 회사관리자 아님(company_user)
    if (!isCompanyAdmin) {
      return (
        <div className="text-center">
          <p className="text-white/70 text-sm leading-relaxed mb-6">
            카페24 연동은 회사 관리자 계정에서만 가능합니다. 관리자 계정으로 로그인해주세요.
          </p>
          <button type="button" className={secondaryBtn} onClick={() => navigate('/dashboard')}>
            대시보드로 이동 <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      );
    }

    // 로그인 O + 회사관리자 + 상태 최초 로딩
    if (statusLoading && connectedMallId === null) {
      return (
        <div className="flex flex-col items-center justify-center py-6 text-white/50 text-sm gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-violet-300" />
          연동 상태를 확인하는 중입니다...
        </div>
      );
    }

    // 이미 연동됨
    if (alreadyConnected) {
      return (
        <div className="text-center">
          <div className="flex items-center justify-center gap-2 text-emerald-300 mb-3">
            <CheckCircle2 className="w-6 h-6" />
            <span className="font-semibold text-sm">이미 연결된 몰입니다</span>
          </div>
          <p className="text-white/60 text-sm leading-relaxed mb-6">
            회원·주문·장바구니 데이터가 한줄로에 자동으로 수집되고 있습니다.
          </p>
          <div className="space-y-2">
            <button type="button" className={primaryBtn} onClick={() => navigate('/cdp-settings')}>
              자사몰 연동 현황 보기 <ArrowRight className="w-4 h-4" />
            </button>
            <button type="button" className={secondaryBtn} onClick={() => navigate('/dashboard')}>
              대시보드로 이동
            </button>
          </div>
        </div>
      );
    }

    // 미연동 — 연결
    return (
      <div className="text-center">
        <p className="text-white/70 text-sm leading-relaxed mb-6">
          이 몰을 한줄로에 연결하면 회원·주문·장바구니 데이터 수집과 AI 마케팅 자동화가 시작됩니다.
        </p>
        <button type="button" className={primaryBtn} onClick={handleConnect} disabled={connecting}>
          {connecting ? <><Loader2 className="w-4 h-4 animate-spin" /> 연결 창을 여는 중...</> : <><ShieldCheck className="w-4 h-4" /> 카페24 연결</>}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-white/40 hover:text-white/70 text-xs mt-4 transition-colors disabled:opacity-40"
          onClick={refreshStatus}
          disabled={statusLoading}
        >
          <RefreshCcw className={`w-3 h-3 ${statusLoading ? 'animate-spin' : ''}`} /> 연결 확인
        </button>
        <p className="text-white/30 text-[11px] mt-4 leading-relaxed">
          새 창에서 카페24 로그인 후 권한에 동의하면 연결됩니다.
        </p>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center shadow-lg shadow-violet-500/20">
            <Store className="w-5 h-5 text-white" />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">한줄로<span className="text-violet-300">AI</span></span>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl shadow-2xl p-6 sm:p-8 backdrop-blur-sm">
          <div className="flex items-center justify-center mb-5">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-500/10 border border-violet-400/20 text-violet-200 text-xs font-medium">
              카페24 앱 연동
            </span>
          </div>

          {mallId ? (
            <div className="text-center mb-6">
              <div className="text-white/40 text-xs mb-1">연결 대상 쇼핑몰</div>
              <div className="text-2xl sm:text-3xl font-extrabold text-white break-all">{mallId}</div>
            </div>
          ) : null}

          {renderBranch()}
        </div>

        <p className="text-center text-white/30 text-[11px] mt-5">한줄로AI · 쇼핑몰 데이터 기반 AI 마케팅 자동화</p>
      </div>
    </div>
  );
}
