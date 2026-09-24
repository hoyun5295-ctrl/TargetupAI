// SNS 채널 (2026-09-20 S1 · ★ 2026-09-24 가장 편리한 채널 관리)
// 설계 SoT = docs/2026-09-24-sns-channel-design.md §5(C1~C6) · §7 화면 순서 · 이전 = 0917 §4-1 · §3-10 · §3-11
//
// 화면 순서(§7) = 확인할 것 띠 → 올리기 → 예약과 기록 → 채널 카드.
//   연결된 계정(끊긴 것 포함)이 하나도 없으면 채널 카드가 맨 위이고 올리기는 그리지 않는다.
// 화면 규칙
//   - 채널 카드 배지 = 그 채널에서 **가장 나쁜 계정**(둘째 계정이 끊겨도 '연결됨'이던 것 · K7).
//   - 지면은 slate-950, 버튼·배지 액센트는 violet·emerald 그대로. 브랜드 색은 카드 배경에만 번진다.
//   - 채널 목록·규격은 **서버가 준 specs 만** 그린다. 화면이 채널을 추론하지 않는다(§3-3).
//   - native dialog 0(커스텀 모달 · ConfirmModal · useToast).
//
// ⛔ 연결 여부는 **서버 상태를 다시 읽은 결과로만** 말한다(§3-10).
//    승인 창이 보내는 메시지는 "다시 읽어라" 신호일 뿐 성공 여부를 담고 있지 않다.
// ★ 2026-09-24 C2 다시 연결 1탭 — 누르는 순간 빈 창을 먼저 열고(팝업 차단을 피한다) 서버가 준 승인 주소로 보낸다.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { ArrowLeft, Share2, Link2, Loader2, RefreshCw, AlertTriangle, ExternalLink, Plus, ChevronRight, Eye } from 'lucide-react';
import ConfirmModal, { ConfirmState } from '../components/ConfirmModal';
import { useToast } from '../components/ToastProvider';
import SnsChannelLogo from '../components/sns/SnsChannelLogo';
import SnsChannelModal from '../components/sns/SnsChannelModal';
import SnsComposer, { type SnsComposeRequest } from '../components/sns/SnsComposer';
import SnsHistory from '../components/sns/SnsHistory';
import { snsBrandColor } from '../constants/sns-brand';
import { useAuthStore } from '../stores/authStore';
import {
  liveSnsAccounts, snsAccountAbility, snsAccountName, snsChannelSummary, snsNeedsReconnect,
  type SnsAccount, type SnsSpec, type SnsAttention, type SnsAttentionItem, type SnsComposeDefaults, type SnsPostView,
} from '../utils/sns-view';
import {
  OUI_BACK, OUI_CARD, OUI_EMPTY, OUI_EMPTY_DESC, OUI_EMPTY_ICON, OUI_EMPTY_TITLE, OUI_HEADER,
  OUI_HEADER_ROW, OUI_ICON_TILE, OUI_PAGE, OUI_PAGE_CENTER, OUI_SRC, OUI_SUBTITLE, OUI_TITLE,
  OUI_WRAP_WIDE, OUI_BTN_PRIMARY, OUI_BTN_GHOST, OUI_BTN_OUTLINE,
} from '../utils/operator-ui';
import OperatorAura from '../components/operator/OperatorAura';

function daysLeft(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(1, Math.round(ms / 86400000));
}

export default function SnsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const user = useAuthStore((s) => s.user);

  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [accounts, setAccounts] = useState<SnsAccount[]>([]);
  const [specs, setSpecs] = useState<SnsSpec[]>([]);
  const [attention, setAttention] = useState<SnsAttention | null>(null);
  const [defaults, setDefaults] = useState<SnsComposeDefaults | null>(null);
  const [busyPlatform, setBusyPlatform] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [popupBlockedUrl, setPopupBlockedUrl] = useState<string | null>(null);
  const [openChannel, setOpenChannel] = useState<string | null>(null);
  /** 게시 뒤 이력을 다시 읽게 하는 신호. 값이 바뀌는 것만 의미가 있다. */
  const [historyKey, setHistoryKey] = useState(0);
  const [composeRequest, setComposeRequest] = useState<SnsComposeRequest | null>(null);
  const [focusPostId, setFocusPostId] = useState<string | null>(null);

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
      if (data.attention) setAttention(data.attention);
      if (data.defaults) setDefaults(data.defaults);
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
      setHistoryKey((k) => k + 1);
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

  /**
   * 승인 창 열기 — **누르는 순간 빈 창부터 연다**(await 뒤에 열면 브라우저가 팝업으로 막는다).
   * 서버 응답이 실패면 그 창을 닫고 사유를 토스트로 알린다.
   */
  const beginAuth = async (platformHint: string, request: () => Promise<Response>) => {
    const win = window.open('', 'hanjullo-sns-auth', 'width=600,height=760');
    setBusyPlatform(platformHint);
    setPopupBlockedUrl(null);
    try {
      const res = await request();
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.authorizeUrl) {
        if (win && !win.closed) win.close();
        setBusyPlatform(null);
        toast.error(data?.error || '연결을 시작하지 못했습니다.');
        void load();
        return;
      }
      pendingNonce.current = data.stateNonce;
      if (!win || win.closed) {
        setBusyPlatform(null);
        setPopupBlockedUrl(data.authorizeUrl);   // 팝업 차단 — 직접 열 수 있게 남긴다
        return;
      }
      win.location.href = data.authorizeUrl;
      popupRef.current = win;
      if (data.platform) setBusyPlatform(String(data.platform));
    } catch {
      if (win && !win.closed) win.close();
      setBusyPlatform(null);
      toast.error('연결을 시작하지 못했습니다.');
    }
  };

  const startConnect = (platform: string) =>
    void beginAuth(platform, () => fetch(`/api/sns/auth/start/${platform}`, { method: 'POST', headers: auth() }));

  /** 다시 연결 1탭(C2) — 소유 확인과 승인 주소를 한 번에 받는다. */
  const reconnect = (accountId: string) => {
    const acc = accounts.find((a) => a.id === accountId);
    setOpenChannel(null);
    void beginAuth(acc?.platform ?? 'reconnect', () => fetch(`/api/sns/accounts/${accountId}/reconnect`, { method: 'POST', headers: auth() }));
  };

  const askDisconnect = (account: SnsAccount, label: string) => {
    const waiting = account.waitingScheduled ?? 0;
    setConfirmState({
      mode: 'danger',
      title: `${label} ${snsAccountName(account, accounts)} 연결을 해제할까요?`,
      description: waiting > 0
        ? `이 계정으로 기다리는 예약 ${waiting}건도 함께 취소돼요. 지금까지 올린 기록은 그대로 남아요.`
        : '해제하면 이 계정으로는 더 올라가지 않아요. 지금까지 올린 기록은 그대로 남아요.',
      confirmLabel: '연결 해제',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/sns/accounts/${account.id}/disconnect`, { method: 'POST', headers: auth() });
          const data = await res.json();
          if (!data?.success) throw new Error(data?.error || '');
          const n = Number(data.cancelledScheduled || 0);
          toast.success(n > 0 ? `연결을 해제했어요. 예약 ${n}건을 함께 취소했어요.` : '연결을 해제했어요.');
          setOpenChannel(null);
          void load();
          setHistoryKey((k) => k + 1);
        } catch {
          toast.error('연결을 해제하지 못했습니다.');
        }
      },
    });
  };

  const labelOf = (platform: string) => specs.find((s) => s.platform === platform)?.label || platform;

  /** 띠 한 줄의 문장 */
  const attentionText = (it: SnsAttentionItem): string => {
    const acc = accounts.find((a) => a.id === it.accountId);
    const who = `${labelOf(it.platform)} ${acc ? snsAccountName(acc, accounts) : (it.accountUsername ? `@${it.accountUsername}` : it.accountDisplayName || '')}`.trim();
    const waiting = it.waitingScheduled ? ` 예약 ${it.waitingScheduled}건이 다시 연결을 기다려요.` : '';
    switch (it.kind) {
      case 'reconnect': return `${who} 연결이 끊겼어요.${waiting}`;
      case 'stuck': return `${who} 연결 확인이 끝나지 않았어요. 다시 연결해 주세요.`;
      case 'ineligible': return `${who}: 지금 올릴 수 없는 계정이에요.${it.reason ? ` ${it.reason}` : ''}`;
      case 'renew_failing': {
        const left = daysLeft(it.expiresAt);
        return `${who} 연결 연장이 안 되고 있어요.${left ? ` ${left}일 안에` : ''} 다시 연결해 주세요.`;
      }
      case 'failed': return `${who}에 올리지 못한 글이 있어요.${it.reason ? ` ${it.reason}` : ''}`;
      case 'unknown': return `${who}에 올라갔는지 확인이 필요해요. 채널에서 먼저 확인해 주세요.`;
      default: return who;
    }
  };

  const showPost = (postId: string) => {
    setFocusPostId(null);
    requestAnimationFrame(() => setFocusPostId(postId));
  };

  const requestCompose = (req: { kind: 'edit' | 'reuse'; post: SnsPostView }) => {
    setComposeRequest({ ...req, nonce: Date.now() });
  };

  if (loading) {
    return (
      <div className={OUI_PAGE_CENTER}>
        <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
      </div>
    );
  }

  const openSpec = specs.find((s) => s.platform === openChannel);
  const liveCount = accounts.filter((a) => a.status !== 'revoked').length;
  const hasActive = accounts.some((a) => a.status === 'active');

  const attentionBand = attention && attention.items.length > 0 && (
    <section className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.06] p-3.5 sm:p-4" aria-label="확인할 것">
      <div className="flex items-center gap-2 mb-2.5">
        <AlertTriangle className="w-4 h-4 text-amber-300" />
        <h2 className="text-sm font-semibold text-amber-100">확인할 것 {attention.total}</h2>
      </div>
      <ul className="space-y-2">
        {attention.items.map((it, i) => {
          const needsLink = it.kind === 'reconnect' || it.kind === 'stuck' || it.kind === 'ineligible' || it.kind === 'renew_failing';
          return (
            <li key={`${it.kind}-${it.accountId}-${it.targetId ?? i}`} className="flex items-center gap-2.5 flex-wrap">
              <SnsChannelLogo platform={it.platform} size={15} />
              <span className="text-xs text-white/80 flex-1 min-w-[12rem] break-keep">{attentionText(it)}</span>
              <div className="flex items-center gap-1.5">
                {needsLink && (
                  <button onClick={() => reconnect(it.accountId)} disabled={!!busyPlatform} className={`${OUI_BTN_OUTLINE} !h-8`}>
                    {busyPlatform === it.platform ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                    다시 연결
                  </button>
                )}
                {it.kind === 'unknown' && it.checkUrl && (
                  <a href={it.checkUrl} target="_blank" rel="noreferrer" className={`${OUI_BTN_OUTLINE} !h-8`}>
                    채널에서 확인 <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {(it.kind === 'failed' || it.kind === 'unknown') && it.postId && (
                  <button onClick={() => showPost(it.postId!)} className={`${OUI_BTN_GHOST} !h-8`}>
                    <Eye className="w-3.5 h-3.5" /> 보기
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {attention.total > attention.items.length && (
        <p className="mt-2.5 text-[11px] text-white/45">외 {attention.total - attention.items.length}건은 아래 기록과 채널 카드에서 볼 수 있어요.</p>
      )}
    </section>
  );

  const channelCards = (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-white/80">채널 연결</h2>
        <p className="text-xs text-white/50 mt-0.5">연결한 채널에만 글이 올라갑니다. 한 채널에 계정을 여러 개 연결할 수도 있어요.</p>
      </div>

      {popupBlockedUrl && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 flex items-start gap-2">
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

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {specs.map((spec) => {
          const live = liveSnsAccounts(accounts, spec.platform);
          const sum = snsChannelSummary(live);
          const busy = busyPlatform === spec.platform;
          const soon = !spec.available;
          const color = snsBrandColor(spec.platform);
          const worst = sum.worst;
          const worstBroken = !!worst && (snsNeedsReconnect(worst) || !!worst.renewFailing || worst.status === 'ineligible');

          return (
            <div
              key={spec.platform}
              className={`relative overflow-hidden rounded-2xl p-3.5 sm:p-4 flex flex-col transition-colors ${
                soon ? 'border border-dashed border-white/15 bg-white/[0.02]'
                  : sum.connected ? 'bg-white/5 border border-transparent' : `${OUI_CARD} border`
              }`}
            >
              {/* 연결된 채널만 브랜드 색이 번진다. 지면 규칙을 깨지 않도록 배경에만, 옅게. */}
              {sum.connected && !soon && (
                <>
                  <span aria-hidden className="absolute inset-0 pointer-events-none"
                    style={{ background: `radial-gradient(120% 90% at 0% 0%, ${color} 0%, transparent 62%)`, opacity: 0.2 }} />
                  <span aria-hidden className="absolute inset-0 pointer-events-none rounded-2xl"
                    style={{ border: `1px solid ${color}`, opacity: 0.45 }} />
                </>
              )}

              {/* 머리 = 채널 창 열기(계정이 있을 때) · 아래 = 주 동작 1개. 버튼을 겹치지 않는다(형제). */}
              {live.length > 0 && !soon ? (
                <button onClick={() => setOpenChannel(spec.platform)}
                  className="relative text-left rounded-xl -m-1 p-1 hover:bg-white/[0.04] transition-colors" aria-label={`${spec.label} 연결 계정 보기`}>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border ${
                      sum.connected ? 'bg-white/[0.12] border-white/20' : 'bg-white/[0.06] border-white/10'
                    }`}>
                      <SnsChannelLogo platform={spec.platform} size={22} />
                    </div>
                    {sum.badge && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${sum.badge.cls}`}>
                        {sum.badge.label}{sum.count > 1 ? ` · ${sum.count}` : ''}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-white inline-flex items-center gap-1">
                    {spec.label}<ChevronRight className="w-3.5 h-3.5 text-white/35" />
                  </p>
                  <p className="text-[11px] text-white/50 mt-1 truncate">
                    {worst ? snsAccountName(worst, accounts) : ''}{sum.count > 1 ? ` 외 ${sum.count - 1}` : ''}
                  </p>
                </button>
              ) : (
                <div className="relative">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 border bg-white/[0.06] border-white/10">
                      <SnsChannelLogo platform={spec.platform} size={22} muted={soon} />
                    </div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/[0.08] text-white/55 border border-white/15 whitespace-nowrap">
                      {soon ? '준비 중' : '연결 안 됨'}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white">{spec.label}</p>
                  <p className="text-[11px] text-white/50 mt-1 truncate">{snsAccountAbility(spec.capabilities)}</p>
                </div>
              )}

              <div className="relative mt-3.5 pt-0 flex-1 flex items-end">
                {soon ? (
                  <p className="text-[11px] text-white/40 break-keep">지금은 연결할 수 없어요</p>
                ) : live.length === 0 ? (
                  <button onClick={() => startConnect(spec.platform)} disabled={!!busyPlatform}
                    className={`${OUI_BTN_PRIMARY} w-full justify-center`}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
                    연결
                  </button>
                ) : worstBroken && worst ? (
                  <button onClick={() => reconnect(worst.id)} disabled={!!busyPlatform}
                    className={`${OUI_BTN_OUTLINE} w-full justify-center !text-amber-100 !border-amber-400/40 hover:!bg-amber-500/15`}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    다시 연결
                  </button>
                ) : (
                  <button onClick={() => startConnect(spec.platform)} disabled={!!busyPlatform}
                    className={`${OUI_BTN_OUTLINE} w-full justify-center`}>
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    계정 추가
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className={OUI_SRC}>Data source: 우리 기록과 채널에서 다시 확인한 결과</p>

      {!hasActive && (
        <div className={`${OUI_CARD} p-4`}>
          <p className="text-xs text-white/50 leading-relaxed break-keep">
            채널을 하나 연결하면 바로 올릴 수 있어요. 인스타그램은 프로페셔널(비즈니스·크리에이터) 계정만, 페이스북은 관리하는 페이지가 연결됩니다.
          </p>
        </div>
      )}
    </section>
  );

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
            <button onClick={() => { void load(); setHistoryKey((k) => k + 1); }} className={OUI_BTN_GHOST}>
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
        ) : liveCount === 0 ? (
          // 연결된 계정이 없으면 채널 카드가 맨 위 · 올리기는 그리지 않는다(§7)
          <div className="space-y-8">
            {channelCards}
            <SnsHistory specs={specs} accounts={accounts} reloadKey={historyKey} focusPostId={focusPostId}
              onAttention={setAttention} onCompose={requestCompose} onReconnect={reconnect} />
          </div>
        ) : (
          <div className="space-y-8">
            {attentionBand}
            <SnsComposer
              specs={specs}
              accounts={accounts}
              defaults={defaults}
              companyId={user?.company?.id ?? null}
              userId={user?.id ?? null}
              request={composeRequest}
              onRequestHandled={() => setComposeRequest(null)}
              onPublished={() => { setHistoryKey((k) => k + 1); void load(); }}
              onReconnect={reconnect}
              onAccountsChanged={() => void load()}
              onShowPost={showPost}
            />
            <SnsHistory specs={specs} accounts={accounts} reloadKey={historyKey} focusPostId={focusPostId}
              onAttention={setAttention} onCompose={requestCompose} onReconnect={reconnect} />
            {channelCards}
          </div>
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
          onReconnect={(id) => reconnect(id)}
          onDisconnect={(a) => askDisconnect(a, openSpec.label)}
        />
      )}

      <ConfirmModal state={confirmState} onClose={() => setConfirmState(null)} />
    </div>
  );
}
