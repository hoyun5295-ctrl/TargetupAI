// SNS 게시 — 계정 연결 화면 (2026-09-20 S1)
// 설계 SoT = docs/2026-09-17-sns-publish-design.md §4-1 · §3-10 · §3-11
//
// S1 범위 = 채널 계정 연결·해제·상태. 작성·예약·이력 구역은 S2·S3에서 이 페이지에 붙는다.
// 다크 slate-950 + violet 액센트 · native dialog 0(ConfirmModal·useToast) · 모델명 0 · 모바일 반응형.
//
// ⛔ 연결 여부는 **서버 상태를 다시 읽은 결과로만** 말한다(§3-10).
//    승인 창이 보내는 메시지는 "다시 읽어라" 신호일 뿐이며 성공 여부를 담고 있지 않다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import {
  ArrowLeft, Share2, Link2, Loader2, RefreshCw, AlertTriangle, CheckCircle2, Unlink, ExternalLink,
} from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';
import {
  OUI_BACK, OUI_CARD, OUI_EMPTY, OUI_EMPTY_DESC, OUI_EMPTY_ICON, OUI_EMPTY_TITLE, OUI_HEADER,
  OUI_HEADER_ROW, OUI_ICON_TILE, OUI_PAGE, OUI_PAGE_CENTER, OUI_SRC, OUI_SUBTITLE, OUI_TITLE,
  OUI_WRAP_NARROW, OUI_BTN_PRIMARY, OUI_BTN_GHOST,
} from '../utils/operator-ui';
import OperatorAura from '../components/operator/OperatorAura';

interface SnsSpec {
  platform: string;
  label: string;
  available: boolean;
  capabilities: { maxCaptionChars: number; maxTags: number; publishCarousel: boolean };
}

interface SnsAccount {
  id: string;
  platform: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  statusReason: string | null;
  connectedAt: string | null;
  lastVerifiedAt: string | null;
  tokenExpiresAt: string | null;
}

/** 계정 카드 배지 사전 — 문구·색을 여기서만 쓴다(§3-5). 사전에 없는 값은 그리지 않는다. */
const ACCOUNT_BADGE: Record<string, { label: string; cls: string }> = {
  active: { label: '연결됨', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
  pending: { label: '확인 중', cls: 'bg-violet-500/15 text-violet-200 border-violet-400/30' },
  ineligible: { label: '계정 확인 필요', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  token_expired: { label: '다시 연결 필요', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  reauth_required: { label: '다시 연결 필요', cls: 'bg-amber-500/15 text-amber-200 border-amber-400/30' },
  revoked: { label: '해제됨', cls: 'bg-white/10 text-white/60 border-white/15' },
  error: { label: '확인 필요', cls: 'bg-rose-500/15 text-rose-300 border-rose-400/30' },
};

export default function SnsPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [accounts, setAccounts] = useState<SnsAccount[]>([]);
  const [specs, setSpecs] = useState<SnsSpec[]>([]);
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [popupBlockedUrl, setPopupBlockedUrl] = useState<string | null>(null);

  /** 이 화면이 연 승인 창의 state. 다른 창이 보낸 메시지를 무시하는 근거. */
  const pendingNonce = useRef<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const token = () => localStorage.getItem('token');
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  // ⛔ `useToast()`는 매 렌더 새 객체를 돌려준다(ToastProvider 에 useMemo 가 없다).
  //    toast 를 `load` 의 의존성에 두면 load 가 매 렌더 새로 만들어지고, 그것을 보는 effect 가 끝없이 돈다.
  //    최신 toast 는 ref 로 잡고 `load` 는 의존성 없이 고정한다.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sns/overview', { headers: auth() });
      const data = await res.json();
      if (res.status === 403 && data?.code === 'PLAN_FEATURE_LOCKED') {
        setEnabled(false);
        setAccounts([]);
        return;
      }
      if (!data?.success) throw new Error(data?.error || '불러오지 못했습니다.');
      setEnabled(!!data.enabled);
      setAccounts(Array.isArray(data.accounts) ? data.accounts : []);
      setSpecs(Array.isArray(data.specs) ? data.specs : []);
    } catch {
      toastRef.current.error('계정 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // 승인 창이 보내는 신호 — **성공 여부를 담고 있지 않다.** 받으면 서버를 다시 읽을 뿐이다(§3-10).
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data as { type?: string; stateNonce?: string } | null;
      if (!d || d.type !== 'hanjullo:sns') return;
      if (!pendingNonce.current || d.stateNonce !== pendingNonce.current) return;
      pendingNonce.current = null;
      setBusyPlatform(null);
      void load();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load]);

  // 사용자가 승인 창을 그냥 닫아도 한 번은 다시 읽는다(신호가 영영 안 오는 경우).
  useEffect(() => {
    if (!busyPlatform) return;
    const timer = setInterval(() => {
      if (popupRef.current && popupRef.current.closed) {
        clearInterval(timer);
        popupRef.current = null;
        pendingNonce.current = null;
        setBusyPlatform(null);
        void load();
      }
    }, 800);
    return () => clearInterval(timer);
  }, [busyPlatform, load]);

  const startConnect = async (platform: string) => {
    setBusyPlatform(platform);
    setPopupBlockedUrl(null);
    try {
      const res = await fetch(`/api/sns/auth/start/${platform}`, { method: 'POST', headers: auth() });
      const data = await res.json();
      if (!data?.success) {
        setBusyPlatform(null);
        toast.error(data?.error || '연결을 시작하지 못했습니다.');
        return;
      }
      pendingNonce.current = data.stateNonce;
      const win = window.open(data.authorizeUrl, 'hanjullo-sns-auth', 'width=600,height=760');
      if (!win) {
        // 팝업 차단 — 링크를 직접 눌러 열 수 있게 남긴다.
        setBusyPlatform(null);
        setPopupBlockedUrl(data.authorizeUrl);
        return;
      }
      popupRef.current = win;
    } catch {
      setBusyPlatform(null);
      toast.error('연결을 시작하지 못했습니다.');
    }
  };

  /**
   * 다시 연결 — 서버에 소유를 먼저 물어본다. 그 사이 계정이 사라졌으면 승인 창을 띄우기 전에 알 수 있다.
   * 화면이 이미 platform 을 알고 있어도 이 왕복을 건너뛰지 않는다(소유 확인은 서버가 한다).
   */
  const reconnect = async (accountId: string) => {
    try {
      const res = await fetch(`/api/sns/accounts/${accountId}/reconnect`, { method: 'POST', headers: auth() });
      const data = await res.json();
      if (!data?.success) {
        toast.error(data?.error || '계정을 찾을 수 없습니다.');
        void load();
        return;
      }
      await startConnect(data.platform);
    } catch {
      toast.error('요청을 처리하지 못했습니다.');
    }
  };

  const askDisconnect = (account: SnsAccount, label: string) => {
    setConfirmState({
      mode: 'danger',
      title: `${label} 연결을 해제할까요?`,
      description: '해제하면 이 채널로 예약된 게시가 더 이상 올라가지 않습니다. 지금까지 올린 기록은 그대로 남습니다.',
      confirmLabel: '연결 해제',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/sns/accounts/${account.id}/disconnect`, { method: 'POST', headers: auth() });
          const data = await res.json();
          if (!data?.success) throw new Error(data?.error || '');
          toast.success('연결을 해제했습니다.');
          void load();
        } catch {
          toast.error('연결을 해제하지 못했습니다.');
        }
      },
    });
  };

  if (loading) {
    return (
      <div className={OUI_PAGE_CENTER}>
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    );
  }

  return (
    <div className={OUI_PAGE}>
      <OperatorAura />

      <header className={OUI_HEADER}>
        <div className={`${OUI_WRAP_NARROW} ${OUI_HEADER_ROW}`}>
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className={OUI_BACK} aria-label="뒤로">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className={`${OUI_ICON_TILE} bg-gradient-to-br from-violet-500 to-fuchsia-500`}>
            <Share2 className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className={OUI_TITLE}>SNS 게시</h1>
            <p className={OUI_SUBTITLE}>회사 SNS 계정을 연결하고 사진과 글을 올립니다.</p>
          </div>
          {enabled && (
            <button onClick={() => void load()} className={OUI_BTN_GHOST}>
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">새로고침</span>
            </button>
          )}
        </div>
      </header>

      <main className={`${OUI_WRAP_NARROW} py-6 md:py-8 relative z-10`}>
        {!enabled ? (
          <section className={`${OUI_CARD} ${OUI_EMPTY}`}>
            <div className={OUI_EMPTY_ICON}>
              <Share2 className="w-6 h-6 text-white/40" />
            </div>
            <p className={OUI_EMPTY_TITLE}>준비 중인 기능이에요</p>
            <p className={OUI_EMPTY_DESC}>
              회사마다 순서대로 열고 있습니다. 열리면 이 화면에서 인스타그램과 Threads 계정을 연결할 수 있어요.
            </p>
          </section>
        ) : (
          <div className="space-y-4">
            <section>
              <h2 className="text-sm font-semibold text-white/80 mb-1">채널 연결</h2>
              <p className="text-xs text-white/50 mb-3">
                연결한 채널에만 글이 올라갑니다. 한 채널에 계정을 여러 개 연결할 수도 있어요.
              </p>

              {popupBlockedUrl && (
                <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-amber-100">새 창이 열리지 않았습니다. 브라우저가 팝업을 막은 것 같아요.</p>
                    <a
                      href={popupBlockedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-200 hover:text-amber-100"
                    >
                      승인 창 직접 열기
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {specs.map((spec) => {
                  const rows = accounts.filter((a) => a.platform === spec.platform);
                  const live = rows.filter((a) => a.status !== 'revoked');
                  const busy = busyPlatform === spec.platform;

                  return (
                    <div key={spec.platform} className={`${OUI_CARD} p-4`}>
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-white">{spec.label}</span>
                            {!spec.available && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/60 border border-white/15">
                                준비 중
                              </span>
                            )}
                          </div>
                          {live.length === 0 && (
                            <p className="text-xs text-white/40 mt-0.5">아직 연결된 계정이 없어요.</p>
                          )}
                        </div>
                        {spec.available && (
                          <button
                            onClick={() => void startConnect(spec.platform)}
                            disabled={busy}
                            className={OUI_BTN_PRIMARY}
                          >
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                            {live.length > 0 ? '계정 추가' : '연결'}
                          </button>
                        )}
                      </div>

                      {rows.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {rows.map((a) => {
                            const badge = ACCOUNT_BADGE[a.status];
                            const needsReconnect = a.status === 'reauth_required' || a.status === 'token_expired';
                            return (
                              <div
                                key={a.id}
                                className="flex items-center gap-3 rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2.5"
                              >
                                <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center overflow-hidden flex-shrink-0">
                                  {a.avatarUrl ? (
                                    <img src={a.avatarUrl} alt="" className="w-full h-full object-cover" />
                                  ) : (
                                    <span className="text-[11px] text-white/50">
                                      {(a.username || a.displayName || '?').slice(0, 2)}
                                    </span>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm text-white truncate">
                                      {a.username ? `@${a.username}` : (a.displayName || '이름 없음')}
                                    </span>
                                    {badge && (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>
                                        {badge.label}
                                      </span>
                                    )}
                                  </div>
                                  {a.statusReason && (
                                    <p className="text-[11px] text-amber-200/80 mt-0.5 break-keep">{a.statusReason}</p>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 flex-shrink-0">
                                  {needsReconnect && (
                                    <button onClick={() => void reconnect(a.id)} className={OUI_BTN_GHOST}>
                                      <RefreshCw className="w-3.5 h-3.5" />
                                      <span className="hidden sm:inline">다시 연결</span>
                                    </button>
                                  )}
                                  {a.status !== 'revoked' && (
                                    <button
                                      onClick={() => askDisconnect(a, spec.label)}
                                      className="p-2 rounded-lg text-white/40 hover:bg-white/10 hover:text-white/80 transition-colors"
                                      aria-label="연결 해제"
                                    >
                                      <Unlink className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <p className={`${OUI_SRC} mt-3`}>Data source: 우리 기록과 채널에서 다시 확인한 결과</p>
            </section>

            <section className={`${OUI_CARD} p-4`}>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-white/30 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-white/50 leading-relaxed break-keep">
                  계정을 연결하면 글과 사진을 올릴 준비가 끝납니다. 작성 화면은 곧 이 자리에 열립니다.
                  인스타그램은 프로페셔널(비즈니스·크리에이터) 계정만 연결됩니다.
                </p>
              </div>
            </section>
          </div>
        )}
      </main>

      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
