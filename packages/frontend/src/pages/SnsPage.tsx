// SNS 채널 — 계정 연결 화면 (2026-09-20 S1 · C안 확정)
// 설계 SoT = docs/2026-09-17-sns-publish-design.md §4-1 · §3-10 · §3-11
//
// 화면 규칙
//   - 채널 카드 4칸 1줄. **연결된 채널은 브랜드 색이 살아나고 아직인 채널은 가라앉는다** — 상태를 색으로 먼저 읽는다.
//   - 지면은 slate-950, 버튼·배지 액센트는 violet·emerald 그대로. 브랜드 색은 카드 배경에만 번진다(정합성).
//   - 상태 배지를 누르면 채널 상세 창. native dialog 0(커스텀 모달 · ConfirmModal · useToast).
//   - 채널 목록·규격은 **서버가 준 specs 만** 그린다. 화면이 채널을 추론하지 않는다(§3-3).
//
// ⛔ 연결 여부는 **서버 상태를 다시 읽은 결과로만** 말한다(§3-10).
//    승인 창이 보내는 메시지는 "다시 읽어라" 신호일 뿐 성공 여부를 담고 있지 않다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { ArrowLeft, Share2, Link2, Loader2, RefreshCw, AlertTriangle, ExternalLink, Plus } from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';
import SnsChannelLogo from '../components/sns/SnsChannelLogo';
import SnsChannelModal from '../components/sns/SnsChannelModal';
import SnsComposer from '../components/sns/SnsComposer';
import SnsHistory from '../components/sns/SnsHistory';
import { snsBrandColor } from '../constants/sns-brand';
import {
  SNS_ACCOUNT_BADGE, liveSnsAccounts, snsAccountAbility,
  type SnsAccount, type SnsSpec,
} from '../utils/sns-view';
import {
  OUI_BACK, OUI_CARD, OUI_EMPTY, OUI_EMPTY_DESC, OUI_EMPTY_ICON, OUI_EMPTY_TITLE, OUI_HEADER,
  OUI_HEADER_ROW, OUI_ICON_TILE, OUI_PAGE, OUI_PAGE_CENTER, OUI_SRC, OUI_SUBTITLE, OUI_TITLE,
  OUI_WRAP_WIDE, OUI_BTN_PRIMARY, OUI_BTN_GHOST, OUI_BTN_OUTLINE,
} from '../utils/operator-ui';
import OperatorAura from '../components/operator/OperatorAura';

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
  const [openChannel, setOpenChannel] = useState<string | null>(null);
  /** 게시 뒤 이력을 다시 읽게 하는 신호. 값이 바뀌는 것만 의미가 있다. */
  const [historyKey, setHistoryKey] = useState(0);

  /** 이 화면이 연 승인 창의 state. 다른 창이 보낸 메시지를 무시하는 근거. */
  const pendingNonce = useRef<string | null>(null);
  const popupRef = useRef<Window | null>(null);

  const token = () => localStorage.getItem('token');
  const auth = () => ({ Authorization: `Bearer ${token()}` });

  // ⛔ `useToast()`는 매 렌더 새 객체를 돌려준다(ToastProvider 에 useMemo 가 없다).
  //    toast 를 `load` 의 의존성에 두면 load 가 매 렌더 새로 만들어지고 그것을 보는 effect 가 끝없이 돈다.
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sns/overview', { headers: auth() });
      const data = await res.json();
      if (res.status === 403) { setEnabled(false); setAccounts([]); return; }
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

  // 승인 창이 보내는 신호 — 성공 여부가 아니라 "다시 읽어라"다(§3-10).
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
        setBusyPlatform(null);
        setPopupBlockedUrl(data.authorizeUrl);   // 팝업 차단 — 직접 열 수 있게 남긴다
        return;
      }
      popupRef.current = win;
    } catch {
      setBusyPlatform(null);
      toast.error('연결을 시작하지 못했습니다.');
    }
  };

  /** 다시 연결 — 서버에 소유를 먼저 물어본다. 그 사이 계정이 사라졌으면 창을 띄우기 전에 안다. */
  const reconnect = async (accountId: string) => {
    try {
      const res = await fetch(`/api/sns/accounts/${accountId}/reconnect`, { method: 'POST', headers: auth() });
      const data = await res.json();
      if (!data?.success) {
        toast.error(data?.error || '계정을 찾을 수 없습니다.');
        void load();
        return;
      }
      setOpenChannel(null);
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
          setOpenChannel(null);
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

  const openSpec = specs.find((s) => s.platform === openChannel);

  return (
    <div className={OUI_PAGE}>
      <OperatorAura />

      <header className={OUI_HEADER}>
        <div className={`${OUI_WRAP_WIDE} ${OUI_HEADER_ROW}`}>
          <button onClick={() => goBackOr(navigate, '/ai-operator')} className={OUI_BACK} aria-label="뒤로">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className={`${OUI_ICON_TILE} bg-gradient-to-br from-sky-400 to-violet-500`}>
            <Share2 className="w-5 h-5 text-white" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className={OUI_TITLE}>SNS 채널</h1>
            <p className={OUI_SUBTITLE}>회사 SNS 계정을 연결하고 사진·영상과 글을 올립니다.</p>
          </div>
          {enabled && (
            <button onClick={() => void load()} className={OUI_BTN_GHOST}>
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">새로고침</span>
            </button>
          )}
        </div>
      </header>

      <main className={`${OUI_WRAP_WIDE} py-6 md:py-8 relative z-10`}>
        {!enabled ? (
          <section className={`${OUI_CARD} ${OUI_EMPTY} max-w-xl mx-auto`}>
            <div className={OUI_EMPTY_ICON}>
              <Share2 className="w-6 h-6 text-white/40" />
            </div>
            <p className={OUI_EMPTY_TITLE}>준비 중인 기능이에요</p>
            <p className={OUI_EMPTY_DESC}>
              회사마다 순서대로 열고 있습니다. 열리면 이 화면에서 회사 SNS 계정을 연결할 수 있어요.
            </p>
          </section>
        ) : (
          <>
            <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h2 className="text-sm font-semibold text-white/80">채널 연결</h2>
                <p className="text-xs text-white/50 mt-0.5">연결한 채널에만 글이 올라갑니다. 한 채널에 계정을 여러 개 연결할 수도 있어요.</p>
              </div>
            </div>

            {popupBlockedUrl && (
              <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-300 flex-shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-amber-100">새 창이 열리지 않았습니다. 브라우저가 팝업을 막은 것 같아요.</p>
                  <a href={popupBlockedUrl} target="_blank" rel="noreferrer"
                    className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-amber-200 hover:text-amber-100">
                    승인 창 직접 열기
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {specs.map((spec) => {
                const live = liveSnsAccounts(accounts, spec.platform);
                const head = live[0];
                const connected = live.some((a) => a.status === 'active');
                const busy = busyPlatform === spec.platform;
                const soon = !spec.available;
                const color = snsBrandColor(spec.platform);
                const badge = head ? SNS_ACCOUNT_BADGE[head.status] : null;

                return (
                  <div
                    key={spec.platform}
                    className={`relative overflow-hidden rounded-2xl p-4 transition-colors ${
                      connected ? 'bg-white/5 border border-transparent' : `${OUI_CARD} border`
                    } ${soon ? 'opacity-45' : ''}`}
                  >
                    {/* 연결된 채널만 브랜드 색이 번진다. 지면 규칙을 깨지 않도록 배경에만, 옅게. */}
                    {connected && (
                      <>
                        <span aria-hidden className="absolute inset-0 pointer-events-none"
                          style={{ background: `radial-gradient(120% 90% at 0% 0%, ${color} 0%, transparent 62%)`, opacity: 0.2 }} />
                        <span aria-hidden className="absolute inset-0 pointer-events-none rounded-2xl"
                          style={{ border: `1px solid ${color}`, opacity: 0.45 }} />
                      </>
                    )}

                    <div className="relative">
                      <div className="flex items-start justify-between gap-2 mb-3.5">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                          connected ? 'bg-white/[0.12] border-white/20' : 'bg-white/[0.06] border-white/10'
                        }`}>
                          <SnsChannelLogo platform={spec.platform} size={22} muted={soon} />
                        </div>
                        {soon ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.06] text-white/40 border border-white/10 whitespace-nowrap">
                            준비 중
                          </span>
                        ) : badge ? (
                          <button
                            onClick={() => setOpenChannel(spec.platform)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap transition-opacity hover:opacity-80 ${badge.cls}`}
                          >
                            {badge.label}{live.length > 1 ? ` · ${live.length}` : ''}
                          </button>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.08] text-white/55 border border-white/15 whitespace-nowrap">
                            연결 안 됨
                          </span>
                        )}
                      </div>

                      <p className="text-sm font-semibold text-white">{spec.label}</p>
                      <p className="text-[11px] text-white/50 mt-1 mb-3.5 truncate">
                        {soon
                          ? '곧 열립니다'
                          : head
                            ? (head.username ? `@${head.username}` : (head.displayName || '이름 없음'))
                            : snsAccountAbility(spec.capabilities)}
                      </p>

                      {!soon && (
                        head ? (
                          <button onClick={() => void startConnect(spec.platform)} disabled={busy}
                            className={`${OUI_BTN_OUTLINE} w-full justify-center`}>
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                            계정 추가
                          </button>
                        ) : (
                          <button onClick={() => void startConnect(spec.platform)} disabled={busy}
                            className={`${OUI_BTN_PRIMARY} w-full justify-center`}>
                            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                            연결
                          </button>
                        )
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <p className={`${OUI_SRC} mt-3`}>Data source: 우리 기록과 채널에서 다시 확인한 결과</p>

            {/* 세로 스택 2·3구역 — 작성 · 이력(§4-1) */}
            <div className="mt-8 space-y-8">
              <SnsComposer
                specs={specs}
                accounts={accounts}
                onPublished={() => setHistoryKey((k) => k + 1)}
              />
              <SnsHistory specs={specs} reloadKey={historyKey} />
            </div>

            {accounts.every((a) => a.status !== 'active') && (
              <section className={`${OUI_CARD} p-4 mt-6`}>
                <p className="text-xs text-white/50 leading-relaxed break-keep">
                  채널을 하나 연결하면 바로 올릴 수 있어요. 인스타그램은 프로페셔널(비즈니스·크리에이터) 계정만, 페이스북은 관리하는 페이지가 연결됩니다.
                </p>
              </section>
            )}
          </>
        )}
      </main>

      {openSpec && (
        <SnsChannelModal
          open
          label={openSpec.label}
          platform={openSpec.platform}
          accounts={accounts.filter((a) => a.platform === openSpec.platform)}
          abilityText={snsAccountAbility(openSpec.capabilities)}
          onClose={() => setOpenChannel(null)}
          onReconnect={(id) => void reconnect(id)}
          onDisconnect={(a) => askDisconnect(a, openSpec.label)}
        />
      )}

      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
