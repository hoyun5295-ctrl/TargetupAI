// 자동 마케팅 [제안 받기] = 첫 제안 미리보기 창 (★ 2026-10-05 · 설계서 docs/2026-10-05-automarketing-preview-design.md §3)
//   등록 전에 첫 회차(대상 · 문안 3안 · 주기 · 1회 예상 비용)를 보여 주고, 돈이 나가는 [시작]은 그다음에 한 번.
//   흰 판 · 모바일 아래로 쌓임 · 백드롭 닫힘 없음 · 만드는 중에도 닫을 수 있다(닫기 = 결과 버림 · 부모가 세대로 무시).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Sparkles, X, Users, Info, AlertTriangle } from 'lucide-react';
import { MK_MODAL, MK_MODAL_BACKDROP, MK_BTN_AI, MK_BTN_OUTLINE, MK_BTN_GHOST } from '../../utils/make-ui';
import { CONFIRM_CREDIT_COSTS } from '../../constants/credit';
import ZoneSegmented from '../zone/ZoneSegmented';
import { ContinuousOperator, ProposalJson, won } from './types';

export interface OperatorPreviewData {
  /** proposal = 시작 가능 · baseline = 변화 축(첫 회차는 기준만) · zero = 대상 0명(시작 불가 · 차감 0) */
  kind: 'proposal' | 'baseline' | 'zero';
  previewId: string | null;
  proposal: ProposalJson | null;
  reason: string | null;
  appliedSegment: { key: string; label: string } | null;
  segment: { key: string | null; params: Record<string, number> | null };
}

const SCHEDULE_LABEL: Record<string, string> = { daily: '매일', weekly: '매주', monthly: '매월', yearly: '매년' };

export default function OperatorPreviewModal({ open, loading, objective, config, data, starting, onClose, onEdit, onStart }: {
  open: boolean;
  loading: boolean;
  objective: string;
  config: Partial<ContinuousOperator> | null;
  data: OperatorPreviewData | null;
  starting: boolean;
  onClose: () => void;
  onEdit: () => void;
  onStart: () => void;
}) {
  const messages = data?.proposal?.messages || [];
  const recommendedIdx = useMemo(() => {
    const rec = data?.proposal?.recommendation;
    const i = rec ? messages.findIndex((m) => m.variantId === rec) : -1;
    return i >= 0 ? i : 0;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tab, setTab] = useState('0');
  useEffect(() => { setTab(String(recommendedIdx)); }, [recommendedIdx]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !starting) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, starting, onClose]);
  if (!open) return null;

  const startCost = CONFIRM_CREDIT_COSTS['continuous-operator'] ?? 0;
  const p = data?.proposal;
  const channel = (p?.channel?.recommended || config?.channel || 'lms').toUpperCase();
  const longType = channel === 'LMS' || channel === 'MMS';
  const sel = messages[Number(tab)] || messages[0];
  const body = sel?.body || sel?.message || '';
  const time = config?.scheduleTime || '09:00';
  const scheduleText = `${SCHEDULE_LABEL[config?.schedule || 'daily'] || '매일'} ${time}`;
  const canStart = !loading && !!data && data.kind !== 'zero' && !!data.previewId;

  return createPortal(
    <div className={MK_MODAL_BACKDROP} role="dialog" aria-modal="true" aria-label="첫 제안 미리보기">
      <div className={`${MK_MODAL} w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden`}>
        <div className="flex items-start gap-3 px-5 pt-5 pb-4 border-b border-slate-200 shrink-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white flex items-center justify-center shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold text-slate-900">첫 제안 미리보기</div>
            <p className="text-[12.5px] text-slate-500 mt-0.5 line-clamp-2 break-words">{objective}</p>
          </div>
          <button type="button" onClick={onClose} disabled={starting} aria-label="닫기" className="p-1.5 rounded-lg hover:bg-slate-100 shrink-0 disabled:opacity-40">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading || !data ? (
            <div className="py-12 flex flex-col items-center text-center gap-3">
              <Loader2 className="w-7 h-7 text-indigo-600 animate-spin" />
              <div className="text-[14px] font-semibold text-slate-800">대상 고객을 세고 문안 3안을 만들고 있어요</div>
              <div className="text-[12.5px] text-slate-500">아직 자동 마케팅은 시작되지 않았어요. 제안을 보고 시작할지 정하시면 됩니다.</div>
              <div className="text-[11.5px] text-slate-400 max-w-sm">지금 닫으면 이 결과는 받지 않아요. 이미 시작한 분석은 끝까지 진행되고, 대상 고객이 있으면 제안 받기 크레딧이 차감돼요.</div>
            </div>
          ) : data.kind === 'zero' ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
              <div className="flex items-center gap-2 text-[14px] font-bold text-amber-900"><AlertTriangle className="w-4 h-4" />지금 조건에 맞는 고객이 없어요</div>
              {data.reason && <p className="text-[13px] text-amber-900 mt-2 break-words">{data.reason}</p>}
              <p className="text-[12.5px] text-amber-800 mt-2 leading-relaxed">조건을 임의로 넓혀서 보내지 않아요. 세부 설정에서 대상이나 목표를 고쳐 주세요.</p>
              <p className="text-[12px] text-amber-700 mt-2">이번 제안 받기는 크레딧이 차감되지 않았어요.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {data.appliedSegment && (
                <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-[12.5px] text-indigo-900 leading-relaxed">
                  발송 대상을 <b className="font-semibold">'{data.appliedSegment.label}'</b> 기준으로 고정해요. 매 회차 같은 기준으로 나가고, 세부 설정에서 바꿀 수 있어요.
                </div>
              )}
              {data.kind === 'baseline' ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 flex gap-3">
                  <Info className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  <div className="text-[13px] text-slate-700 leading-relaxed">
                    이 목표는 지난번과 달라진 고객을 찾아 보내는 조건이에요. 비교할 지난 회차가 아직 없어서 첫 회차는 비교 기준을 잡고, 다음 회차부터 대상이 잡혀요.
                    그래서 미리 보여 드릴 제안이 없고, 이번 제안 받기는 크레딧이 차감되지 않았어요.
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    <Cell label="대상" value={`${(p?.target?.count || 0).toLocaleString()}명`} icon={<Users className="w-3.5 h-3.5" />} />
                    <Cell label="채널" value={channel} />
                    <Cell label="주기" value={scheduleText} />
                    <Cell label="발송 1회 예상 비용" value={won(p?.cost?.estimated)} />
                  </div>
                  {p?.target?.criteria && (
                    <div className="text-[12.5px] text-slate-600 break-words"><span className="font-semibold text-slate-800">대상 기준</span> · {p.target.criteria}</div>
                  )}
                  {messages.length > 0 && (
                    <div>
                      <ZoneSegmented
                        ariaLabel="문안 안 고르기"
                        items={messages.map((m, i) => ({
                          id: String(i),
                          label: `${String.fromCharCode(65 + i)}${m.variantName ? ` · ${m.variantName}` : ''}`,
                          count: i === recommendedIdx ? '추천' : null,
                        }))}
                        value={tab}
                        onChange={setTab}
                      />
                      <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 max-h-72 overflow-y-auto">
                        {longType && sel?.subject && <div className="text-[13.5px] font-bold text-slate-900 mb-2 break-words">{sel.subject}</div>}
                        <div className="text-[13.5px] text-slate-800 whitespace-pre-wrap break-words leading-relaxed">{body}</div>
                      </div>
                      <p className="text-[12px] text-slate-500 mt-2">시작한 뒤 제안 카드에서 안을 고르고 문안을 고칠 수 있어요.</p>
                    </div>
                  )}
                </>
              )}
              <div className="text-[10px] text-slate-400 italic">
                Data source: {data.kind === 'baseline' ? '목표 문장 → 대상 기준 매핑(문안 생성 없음)' : '고객 DB 실측 대상 수 · AI 문안 3안 · 회사 발송 단가'} (등록 전 미리보기 · 발송 0건)
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-200 px-5 py-4 shrink-0">
          {canStart && (
            <p className="text-[12px] text-slate-500 mb-3">
              시작하면 {startCost}크레딧이 차감되고{data?.kind === 'baseline' ? ' 첫 회차에 비교 기준을 잡아요.' : ' 방금 본 제안이 승인할 제안으로 저장돼요. 승인하면 발송돼요.'}
            </p>
          )}
          <div className="flex flex-col-reverse sm:flex-row sm:items-center gap-2">
            <button type="button" className={`${MK_BTN_GHOST} !h-10`} onClick={onClose} disabled={starting}>닫기</button>
            <div className="sm:ml-auto flex flex-col-reverse sm:flex-row gap-2">
              <button type="button" className={`${MK_BTN_OUTLINE} !h-10`} onClick={onEdit} disabled={loading || !data || starting}>세부 설정에서 고치기</button>
              {data?.kind !== 'zero' && (
                <button type="button" className={MK_BTN_AI} onClick={onStart} disabled={!canStart || starting}>
                  {starting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  이대로 자동 마케팅 시작<span className="font-normal opacity-70 text-[12.5px]">· {startCost}크레딧</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Cell({ label, value, icon }: { label: string; value: string; icon?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 min-w-0">
      <div className="text-[11.5px] text-slate-500 flex items-center gap-1">{icon}{label}</div>
      <div className="text-[15px] font-bold text-slate-900 mt-0.5 truncate tabular-nums">{value}</div>
    </div>
  );
}
