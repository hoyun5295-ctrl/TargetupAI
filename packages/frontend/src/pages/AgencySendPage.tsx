/**
 * AgencySendPage — 대행발송 (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md. 진입 = 헤더 "대행발송"(모든 회사에 보인다).
 *   못 쓰는 회사는 안내 모달(§4-8), 쓸 수 있는 회사는 접수 목록을 본다.
 *
 * ⛔ 자격 판정은 서버 my-plan의 `agency_send_allowed` 하나만 믿는다(프론트가 요금제를 조합하지 않는다).
 * ⛔ 문구에 줄표 0. 톤 = 인디고 콘솔(`CUI_*`).
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Plus, RefreshCw, Send } from 'lucide-react';
import { goBackOr } from '../lib/scroll-restoration';
import { useToast } from '../components/ToastProvider';
import AgencySendIntroModal from '../components/agency/AgencySendIntroModal';
import AgencySendComposer from '../components/agency/AgencySendComposer';
import AgencySendDetail from '../components/agency/AgencySendDetail';
import {
  fetchAgencyRequests, formatWhen, isApprovable, STATUS_LABEL, STATUS_TONE,
  type AgencySendRequest,
} from '../components/agency/agency-send-api';
import {
  CUI_BTN_GHOST, CUI_BTN_PRIMARY, CUI_CELL_META, CUI_CELL_NAME, CUI_EMPTY, CUI_EMPTY_BADGE,
  CUI_EMPTY_DESC, CUI_EMPTY_TITLE, CUI_INFO, CUI_INFO_ICON, CUI_INFO_TEXT, CUI_PANEL,
  CUI_PILL_BASE, CUI_PILL_TONE, CUI_TD, CUI_TH, CUI_THEAD, CUI_TR, CUI_WRAP,
} from '../utils/console-ui';

interface PlanSnapshot {
  planCode: string;
  allowed: boolean;
}

export default function AgencySendPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [plan, setPlan] = useState<PlanSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [introOpen, setIntroOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [requests, setRequests] = useState<AgencySendRequest[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      setRequests(await fetchAgencyRequests());
    } catch (e: any) {
      if (e?.code !== 'AGENCY_SEND_NOT_ALLOWED') toast.error(e?.message || '목록을 불러오지 못했습니다.');
    } finally {
      setListLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/companies/my-plan', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
        });
        const data = await res.json();
        if (!alive) return;
        const snapshot: PlanSnapshot = {
          planCode: String(data?.plan_code || 'FREE'),
          allowed: !!data?.agency_send_allowed,
        };
        setPlan(snapshot);
        if (snapshot.allowed) loadList();
        else setIntroOpen(true);
      } catch {
        // 판정을 못 받으면 열지 않는다. 안내를 띄우고 사용자가 다시 시도하게 둔다
        if (alive) { setPlan({ planCode: 'FREE', allowed: false }); setIntroOpen(true); }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [loadList]);

  const upsert = (r: AgencySendRequest) => {
    setRequests((prev) => {
      const i = prev.findIndex((x) => x.id === r.id);
      if (i < 0) return [r, ...prev];
      const next = [...prev];
      next[i] = r;
      return next;
    });
  };

  const waiting = requests.filter((r) => isApprovable(r.status)).length;

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-40">
        <div className={`${CUI_WRAP} py-3.5 flex items-center gap-3`}>
          <button
            type="button"
            onClick={() => goBackOr(navigate, '/dashboard')}
            className="h-8 w-8 grid place-items-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 transition-colors"
            aria-label="뒤로"
          >
            <ArrowLeft className="w-5 h-5" strokeWidth={2} />
          </button>
          <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
            <Send className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h1 className="text-[16px] font-bold tracking-[-0.02em] text-neutral-900">대행발송</h1>
            <p className="text-[12.5px] text-neutral-500">양식만 채우면, 나머지는 한줄로가 합니다</p>
          </div>
          {plan?.allowed && (
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={loadList} className={CUI_BTN_GHOST} aria-label="새로고침">
                <RefreshCw className={`w-[15px] h-[15px] ${listLoading ? 'animate-spin' : ''}`} />
              </button>
              <button type="button" onClick={() => setComposerOpen(true)} className={CUI_BTN_PRIMARY}>
                <Plus className="w-[15px] h-[15px]" />새 접수
              </button>
            </div>
          )}
        </div>
      </header>

      <div className={`${CUI_WRAP} py-6`}>
        {loading ? (
          <div className="rounded-xl border border-neutral-200 bg-white p-12 grid place-items-center text-neutral-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : !plan?.allowed ? (
          <div className={CUI_EMPTY}>
            <div className={CUI_EMPTY_BADGE}><Send className="w-5 h-5 text-neutral-400" strokeWidth={2} /></div>
            <p className={CUI_EMPTY_TITLE}>아직 열려 있지 않은 기능입니다</p>
            <p className={CUI_EMPTY_DESC}>명단과 문안만 맡기면 검사와 예약까지 대신 해 드립니다.</p>
            <button type="button" onClick={() => setIntroOpen(true)} className={`${CUI_BTN_PRIMARY} mt-4`}>
              무엇을 해 주는지 보기
            </button>
          </div>
        ) : (
          <>
            {waiting > 0 && (
              <div className={`${CUI_INFO} mb-4`}>
                <Send className={CUI_INFO_ICON} size={16} strokeWidth={2} />
                <p className={CUI_INFO_TEXT}>
                  승인을 기다리는 접수가 <b className="tabular-nums">{waiting}</b>건 있습니다.
                  담당자 번호로 보내 드린 문자를 확인하고 승인해 주세요.
                </p>
              </div>
            )}

            {requests.length === 0 ? (
              <div className={CUI_EMPTY}>
                <div className={CUI_EMPTY_BADGE}><Send className="w-5 h-5 text-neutral-400" strokeWidth={2} /></div>
                <p className={CUI_EMPTY_TITLE}>아직 접수한 건이 없습니다</p>
                <p className={CUI_EMPTY_DESC}>
                  명단 파일과 문안, 보낼 시각을 넣으면 스팸 검사부터 예약까지 이어서 처리합니다.
                </p>
                <button type="button" onClick={() => setComposerOpen(true)} className={`${CUI_BTN_PRIMARY} mt-4`}>
                  <Plus className="w-[15px] h-[15px]" />첫 접수 하기
                </button>
              </div>
            ) : (
              <div className={CUI_PANEL}>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className={CUI_THEAD}>
                      <tr>
                        <th className={CUI_TH}>건</th>
                        <th className={CUI_TH}>상태</th>
                        <th className={CUI_TH}>보낼 시각</th>
                        <th className={CUI_TH}>건수</th>
                        <th className={CUI_TH}>형식</th>
                        <th className={CUI_TH}> </th>
                      </tr>
                    </thead>
                    <tbody>
                      {requests.map((r) => (
                        <tr key={r.id} className={CUI_TR} onClick={() => setDetailId(r.id)} style={{ cursor: 'pointer' }}>
                          <td className={CUI_TD}>
                            <div className={`${CUI_CELL_NAME} max-w-[240px] truncate`}>
                              {r.fileName || r.currentContent.slice(0, 24)}
                            </div>
                          </td>
                          <td className={CUI_TD}>
                            <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE[STATUS_TONE[r.status]]}`}>{STATUS_LABEL[r.status]}</span>
                          </td>
                          <td className={`${CUI_TD} ${CUI_CELL_META}`}>{formatWhen(r.requestedAt)}</td>
                          <td className={`${CUI_TD} ${CUI_CELL_META}`}>{r.recipientCount.toLocaleString()}</td>
                          <td className={`${CUI_TD} ${CUI_CELL_META}`}>{r.messageType}</td>
                          <td className={CUI_TD}>
                            {isApprovable(r.status) && (
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); setDetailId(r.id); }}
                                className={CUI_BTN_PRIMARY}
                              >
                                승인하기
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            <p className="mt-3 text-[10px] text-neutral-400 italic">Data source: 대행발송 접수 원장</p>
          </>
        )}
      </div>

      <AgencySendIntroModal
        show={introOpen}
        isPaidPlan={!!plan && plan.planCode !== 'FREE'}
        onClose={() => setIntroOpen(false)}
      />
      <AgencySendComposer
        show={composerOpen}
        onClose={() => setComposerOpen(false)}
        onCreated={(r) => upsert(r)}
      />
      <AgencySendDetail
        requestId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={(r) => upsert(r)}
      />
    </div>
  );
}
