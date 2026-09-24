// SnsChannelModal — 채널 하나의 연결된 계정 상세 (2026-09-20 S1)
//
// 카드의 상태 배지를 누르면 열린다. 한 채널에 계정이 여러 개일 수 있어 목록 형태다.
// 커스텀 모달 — native dialog 0(디자인 최소 기준). 해제는 여기서 바로 하지 않고 부모가 ConfirmModal 로 한 번 더 묻는다.
import { X, Unlink, RefreshCw, AlertTriangle } from 'lucide-react';
import SnsChannelLogo from './SnsChannelLogo';
import type { SnsAccount } from '../../utils/sns-view';
import { SNS_ACCOUNT_BADGE, snsAccountAbility, snsAccountName, snsNeedsReconnect } from '../../utils/sns-view';

interface Props {
  open: boolean;
  label: string;
  platform: string;
  accounts: SnsAccount[];
  /** 채널 규격 한 줄(캡션 길이·여러 장 여부) */
  abilityText: string;
  onClose: () => void;
  onReconnect: (accountId: string) => void;
  onDisconnect: (account: SnsAccount) => void;
}

function fmt(iso: string | null): string {
  if (!iso) return '기록 없음';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '기록 없음';
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 토큰 만료까지 남은 날. 지났거나 값이 없으면 null */
function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(1, Math.round(ms / 86400000));
}

export default function SnsChannelModal({
  open, label, platform, accounts, abilityText, onClose, onReconnect, onDisconnect,
}: Props) {
  if (!open) return null;

  return (
    // ★ 2026-09-24 바깥을 눌러 닫지 않는다(설계 0924 · 닫기는 X 버튼)
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
          <div className="w-10 h-10 rounded-xl bg-white/[0.08] border border-white/15 flex items-center justify-center flex-shrink-0">
            <SnsChannelLogo platform={platform} size={22} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">{label}</p>
            <p className="text-[11px] text-white/50 mt-0.5">{abilityText}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg text-white/50 hover:bg-white/10 hover:text-white transition-colors" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {accounts.length === 0 && (
            <p className="text-xs text-white/50 py-6 text-center">연결된 계정이 없습니다.</p>
          )}

          {accounts.map((a) => {
            const badge = SNS_ACCOUNT_BADGE[a.status];
            const left = daysLeft(a.tokenExpiresAt);
            const needsReconnect = snsNeedsReconnect(a);
            return (
              <div key={a.id} className="rounded-xl bg-white/[0.04] border border-white/10 p-3.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full bg-white/10 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {a.avatarUrl
                      ? <img src={a.avatarUrl} alt="" className="w-full h-full object-cover" />
                      : <span className="text-[11px] text-white/50">{(a.username || a.displayName || '?').slice(0, 2)}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white truncate">{snsAccountName(a, accounts)}</p>
                    {a.displayName && a.username && <p className="text-[11px] text-white/45 truncate">{a.displayName}</p>}
                  </div>
                  {badge && <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${badge.cls}`}>{badge.label}</span>}
                </div>

                {a.statusReason && (
                  <div className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-amber-500/10 border border-amber-400/25 px-2.5 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-300 flex-shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-100 leading-relaxed break-keep">{a.statusReason}</p>
                  </div>
                )}

                <dl className="mt-3 space-y-1.5">
                  <div className="flex justify-between gap-3 text-[11.5px]">
                    <dt className="text-white/45">연결한 날</dt>
                    <dd className="text-white/80">{fmt(a.connectedAt)}</dd>
                  </div>
                  <div className="flex justify-between gap-3 text-[11.5px]">
                    <dt className="text-white/45">마지막 확인</dt>
                    <dd className="text-white/80">{fmt(a.lastVerifiedAt)}</dd>
                  </div>
                  {left !== null && (
                    <div className="flex justify-between gap-3 text-[11.5px]">
                      <dt className="text-white/45">연결 유지</dt>
                      {/* ★ 2026-09-24 C4 — 연장이 실패하고 있으면 '자동 연장'이라고 말하지 않는다 · Threads 에는 쓰지 않는다 */}
                      <dd className={a.renewFailing ? 'text-amber-200' : 'text-white/80'}>
                        {left}일 남음{a.renewFailing ? ' · 연장이 안 되고 있어요. 다시 연결해 주세요.' : platform !== 'threads' ? ' · 자동 연장' : ''}
                      </dd>
                    </div>
                  )}
                  {(a.waitingScheduled ?? 0) > 0 && (
                    <div className="flex justify-between gap-3 text-[11.5px]">
                      <dt className="text-white/45">기다리는 예약</dt>
                      <dd className="text-white/80">{a.waitingScheduled}건</dd>
                    </div>
                  )}
                </dl>

                <div className="mt-3 flex items-center gap-2 justify-end">
                  {(needsReconnect || a.renewFailing || a.status === 'ineligible') && (
                    <button
                      onClick={() => onReconnect(a.id)}
                      className="h-8 px-2.5 rounded-lg text-[11.5px] font-medium text-violet-200 border border-violet-400/30 hover:bg-violet-500/15 inline-flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      다시 연결
                    </button>
                  )}
                  {a.status !== 'revoked' && (
                    <button
                      onClick={() => onDisconnect(a)}
                      className="h-8 px-2.5 rounded-lg text-[11.5px] font-medium text-rose-200 bg-rose-500/10 border border-rose-400/25 hover:bg-rose-500/20 inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Unlink className="w-3.5 h-3.5" />
                      연결 해제
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { snsAccountAbility };
