/**
 * EmailEventsModal.tsx — D225+ Email 캠페인 발송 이력 영역 (2026-05-28 Harold 명시)
 *
 * 본질: 옛 영역 = email_events 누적 + 조회 endpoint X + 이력 영역 X 사고 정정.
 *   캠페인 카드 안 "이력 보기" 클릭 → 본 모달 안 = 수신자별 매트릭스 + raw 이벤트 목록 표시.
 *
 * 영구 룰 정합:
 *   - 다크 톤 (bg-slate-900) + violet 액센트 + rounded-2xl + shadow-2xl
 *   - 모바일 반응형
 *   - ConfirmModal/useToast 활용 (native dialog X)
 *   - 박-단어 X
 */

import { useEffect, useState } from 'react';
import {
  X, Loader2, Mail, MailOpen, MousePointerClick, AlertCircle, UserMinus, RefreshCw, ChevronDown, ChevronUp, Download,
} from 'lucide-react';
// ★ 2026-07-06 이력 CSV 다운로드 (Harold 지시) — 공용 CT (BOM + 셀 이스케이프)
import { downloadCsv, safeCsvFilename } from '../../utils/csv-download';

interface CampaignSummary {
  id: string;
  name: string;
  subject: string;
  sentCount: number;
  openCount: number;
  clickCount: number;
  bounceCount: number;
  unsubscribeCount: number;
  sentAt: string | null;
}

interface RecipientRow {
  email: string;
  deliveredAt: string | null;
  openedAt: string | null;
  clickedAt: string | null;
  bouncedAt: string | null;
  unsubscribedAt: string | null;
  openCount: number;
  clickCount: number;
  lastEventAt: string | null;
}

interface EventRow {
  id: string;
  email: string;
  eventType: string;
  url: string | null;
  reason: string | null;
  occurredAt: string;
}

interface EventsResponse {
  success: boolean;
  campaign: CampaignSummary;
  recipients: RecipientRow[];
  recipients_total: number;
  events: EventRow[];
  pagination: { limit: number; offset: number };
}

interface EmailEventsModalProps {
  campaignId: string;
  campaignName: string;
  onClose: () => void;
  token: string;
  onToast: (message: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const EVENT_TYPE_META: Record<string, { label: string; color: string; icon: typeof Mail }> = {
  delivered: { label: '전달 완료', color: 'text-indigo-300', icon: Mail },
  processed: { label: '처리 완료', color: 'text-indigo-300', icon: Mail },
  sent: { label: '발송', color: 'text-indigo-300', icon: Mail },
  open: { label: '오픈', color: 'text-emerald-300', icon: MailOpen },
  click: { label: '클릭', color: 'text-cyan-300', icon: MousePointerClick },
  bounce: { label: '반송', color: 'text-rose-300', icon: AlertCircle },
  dropped: { label: '드롭', color: 'text-rose-300', icon: AlertCircle },
  spam_report: { label: '스팸 신고', color: 'text-rose-400', icon: AlertCircle }, // 실제 기록 값 (recordEmailEvent)
  spamreport: { label: '스팸 신고', color: 'text-rose-400', icon: AlertCircle },  // 옛 웹훅 잔존 행 호환
  unsubscribe: { label: '수신거부', color: 'text-white/50', icon: UserMinus },
};

function formatDate(iso: string | null): string {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '-';
  }
}

export default function EmailEventsModal({ campaignId, campaignName, onClose, token, onToast }: EmailEventsModalProps) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<EventsResponse | null>(null);
  const [activeTab, setActiveTab] = useState<'recipients' | 'events'>('recipients');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 100;

  useEffect(() => {
    loadEvents();
  }, [campaignId, eventTypeFilter, page]);

  async function loadEvents() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (eventTypeFilter !== 'all') params.set('event_type', eventTypeFilter);
      const res = await fetch(`/api/email/campaigns/${campaignId}/events?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json: EventsResponse = await res.json();
      if (!json.success) throw new Error((json as any).error || '이력 조회 실패');
      setData(json);
    } catch (err: any) {
      onToast(err?.message || '이력 조회 실패', 'error');
    } finally {
      setLoading(false);
    }
  }

  // ★ 2026-07-06 CSV 다운로드 — 화면 페이징(100)과 무관하게 전체 수집(서버 상한 500씩 순회) 후 내보내기
  const [exporting, setExporting] = useState(false);
  const fmtCsvDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ko-KR') : '');
  async function handleCsvDownload() {
    if (exporting) return;
    setExporting(true);
    try {
      const LIMIT = 500;
      const MAX_ROWS = 50000; // 폭주 방어 상한 — 초과 시 수집분까지 내보내고 안내
      if (activeTab === 'recipients') {
        const all: RecipientRow[] = [];
        let total = 0;
        for (let offset = 0; offset < MAX_ROWS; offset += LIMIT) {
          const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
          const res = await fetch(`/api/email/campaigns/${campaignId}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
          const json: EventsResponse = await res.json();
          if (!json.success) throw new Error((json as any).error || '이력 조회 실패');
          all.push(...(json.recipients || []));
          total = json.recipients_total || 0;
          if (all.length >= total || (json.recipients || []).length < LIMIT) break;
        }
        downloadCsv(
          safeCsvFilename(campaignName, '이메일_수신자이력'),
          ['이메일', '전달', '오픈', '오픈수', '클릭', '클릭수', '반송', '수신거부', '최근 이벤트'],
          all.map((r) => [r.email, fmtCsvDate(r.deliveredAt), fmtCsvDate(r.openedAt), r.openCount, fmtCsvDate(r.clickedAt), r.clickCount, fmtCsvDate(r.bouncedAt), fmtCsvDate(r.unsubscribedAt), fmtCsvDate(r.lastEventAt)]),
        );
        onToast(`수신자 ${all.length.toLocaleString()}건 CSV 다운로드 완료${all.length < total ? ` (상한 ${MAX_ROWS.toLocaleString()}건 적용)` : ''}`, 'success');
      } else {
        const all: EventRow[] = [];
        for (let offset = 0; offset < MAX_ROWS; offset += LIMIT) {
          const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
          if (eventTypeFilter !== 'all') params.set('event_type', eventTypeFilter);
          const res = await fetch(`/api/email/campaigns/${campaignId}/events?${params}`, { headers: { Authorization: `Bearer ${token}` } });
          const json: EventsResponse = await res.json();
          if (!json.success) throw new Error((json as any).error || '이력 조회 실패');
          all.push(...(json.events || []));
          if ((json.events || []).length < LIMIT) break;
        }
        downloadCsv(
          safeCsvFilename(campaignName, '이메일_이벤트로그'),
          ['이메일', '이벤트', 'URL', '사유', '발생 시각'],
          all.map((e) => [e.email, EVENT_TYPE_META[e.eventType]?.label || e.eventType, e.url || '', e.reason || '', fmtCsvDate(e.occurredAt)]),
        );
        onToast(`이벤트 ${all.length.toLocaleString()}건 CSV 다운로드 완료`, 'success');
      }
    } catch (err: any) {
      onToast(err?.message || 'CSV 다운로드 실패', 'error');
    } finally {
      setExporting(false);
    }
  }

  const campaign = data?.campaign;
  const openRate = campaign && campaign.sentCount > 0 ? ((campaign.openCount / campaign.sentCount) * 100).toFixed(1) : '0';
  const clickRate = campaign && campaign.sentCount > 0 ? ((campaign.clickCount / campaign.sentCount) * 100).toFixed(1) : '0';
  const bounceRate = campaign && campaign.sentCount > 0 ? ((campaign.bounceCount / campaign.sentCount) * 100).toFixed(1) : '0';
  const recipientsTotal = data?.recipients_total || 0;
  const totalPages = Math.ceil(recipientsTotal / PAGE_SIZE);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-3 md:p-6">
      <div
        className="bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between bg-gradient-to-br from-slate-900 via-violet-950/30 to-slate-900">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
              <Mail className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm md:text-base font-semibold text-white truncate">{campaignName}</h3>
              <p className="text-xs text-white/50">발송 이력</p>
            </div>
          </div>
          <button
            onClick={handleCsvDownload}
            disabled={exporting || loading || !data}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 disabled:opacity-40 mr-1.5"
            title={activeTab === 'recipients' ? '수신자 매트릭스 전체를 CSV로 저장' : '이벤트 로그 전체를 CSV로 저장'}
          >
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            CSV
          </button>
          <button
            onClick={loadEvents}
            disabled={loading}
            className="text-white/60 hover:text-white p-1.5 rounded hover:bg-white/5 disabled:opacity-40 mr-1"
            aria-label="새로고침"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1.5 rounded hover:bg-white/5" aria-label="닫기">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 요약 통계 카드 */}
        {campaign && (
          <div className="px-5 py-4 border-b border-white/10 bg-slate-950/40">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <SummaryCard label="총 발송" value={campaign.sentCount.toLocaleString()} sub="-" color="text-indigo-300" />
              <SummaryCard label="오픈" value={campaign.openCount.toLocaleString()} sub={`${openRate}%`} color="text-emerald-300" />
              <SummaryCard label="클릭" value={campaign.clickCount.toLocaleString()} sub={`${clickRate}%`} color="text-cyan-300" />
              <SummaryCard label="반송" value={campaign.bounceCount.toLocaleString()} sub={`${bounceRate}%`} color="text-rose-300" />
              <SummaryCard label="수신거부" value={campaign.unsubscribeCount.toLocaleString()} sub="-" color="text-white/60" />
            </div>
            {campaign.sentAt && (
              <div className="text-[10px] text-white/40 mt-3">발송 일자: {new Date(campaign.sentAt).toLocaleString('ko-KR')}</div>
            )}
          </div>
        )}

        {/* 탭 + 필터 */}
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between flex-wrap gap-2">
          <div className="flex gap-1">
            <TabButton active={activeTab === 'recipients'} onClick={() => { setActiveTab('recipients'); setPage(0); }}>
              수신자 매트릭스 ({recipientsTotal})
            </TabButton>
            <TabButton active={activeTab === 'events'} onClick={() => { setActiveTab('events'); setPage(0); }}>
              이벤트 로그
            </TabButton>
          </div>
          {activeTab === 'events' && (
            <select
              value={eventTypeFilter}
              onChange={(e) => { setEventTypeFilter(e.target.value); setPage(0); }}
              className="px-2 py-1 text-xs bg-slate-800 border border-white/10 rounded text-white focus:border-violet-500 focus:outline-none"
            >
              <option value="all">전체</option>
              <option value="open">오픈</option>
              <option value="click">클릭</option>
              <option value="bounce">반송</option>
              <option value="unsubscribe">수신거부</option>
            </select>
          )}
        </div>

        {/* 내용 */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-12 text-violet-200">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              <span className="text-sm">로딩 중...</span>
            </div>
          )}

          {!loading && data && activeTab === 'recipients' && (
            <div className="overflow-x-auto">
              {data.recipients.length === 0 ? (
                <div className="text-center py-12 text-white/40 text-sm">아직 수신자 이벤트가 없습니다.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-950/60 text-white/60 sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-medium">이메일</th>
                      <th className="px-3 py-2.5 text-center font-medium">전달</th>
                      <th className="px-3 py-2.5 text-center font-medium">오픈</th>
                      <th className="px-3 py-2.5 text-center font-medium">클릭</th>
                      <th className="px-3 py-2.5 text-center font-medium">반송</th>
                      <th className="px-3 py-2.5 text-center font-medium">수신거부</th>
                      <th className="px-3 py-2.5 text-center font-medium">최근 이벤트</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.recipients.map((r) => (
                      <tr key={r.email} className="hover:bg-white/5">
                        <td className="px-3 py-2.5 text-white/90 break-all">{r.email}</td>
                        <td className="px-3 py-2.5 text-center text-white/70">{formatDate(r.deliveredAt)}</td>
                        <td className="px-3 py-2.5 text-center">
                          {r.openedAt ? (
                            <span className="text-emerald-300">{formatDate(r.openedAt)}{r.openCount > 1 && <span className="text-[10px] text-white/40"> ({r.openCount})</span>}</span>
                          ) : (
                            <span className="text-white/30">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          {r.clickedAt ? (
                            <span className="text-cyan-300">{formatDate(r.clickedAt)}{r.clickCount > 1 && <span className="text-[10px] text-white/40"> ({r.clickCount})</span>}</span>
                          ) : (
                            <span className="text-white/30">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-center">{r.bouncedAt ? <span className="text-rose-300">{formatDate(r.bouncedAt)}</span> : <span className="text-white/30">-</span>}</td>
                        <td className="px-3 py-2.5 text-center">{r.unsubscribedAt ? <span className="text-white/60">{formatDate(r.unsubscribedAt)}</span> : <span className="text-white/30">-</span>}</td>
                        <td className="px-3 py-2.5 text-center text-white/50 text-[11px]">{formatDate(r.lastEventAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {!loading && data && activeTab === 'events' && (
            <div className="overflow-x-auto">
              {data.events.length === 0 ? (
                <div className="text-center py-12 text-white/40 text-sm">이벤트 0건.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-950/60 text-white/60 sticky top-0">
                    <tr>
                      <th className="px-3 py-2.5 text-left font-medium">시각</th>
                      <th className="px-3 py-2.5 text-left font-medium">이메일</th>
                      <th className="px-3 py-2.5 text-left font-medium">이벤트</th>
                      <th className="px-3 py-2.5 text-left font-medium">URL / 사유</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {data.events.map((e) => {
                      const meta = EVENT_TYPE_META[e.eventType] || { label: e.eventType, color: 'text-white/60', icon: Mail };
                      const Icon = meta.icon;
                      return (
                        <tr key={e.id} className="hover:bg-white/5">
                          <td className="px-3 py-2.5 text-white/70 whitespace-nowrap">{formatDate(e.occurredAt)}</td>
                          <td className="px-3 py-2.5 text-white/90 break-all">{e.email}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center gap-1 ${meta.color}`}>
                              <Icon className="w-3 h-3" />
                              {meta.label}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-white/60 break-all max-w-md">
                            {e.url ? <a href={e.url} target="_blank" rel="noopener" className="text-cyan-300 hover:underline">{e.url}</a> : e.reason || '-'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        {/* 페이지네이션 */}
        {activeTab === 'recipients' && totalPages > 1 && (
          <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between text-xs text-white/60">
            <span>{page * PAGE_SIZE + 1} ~ {Math.min((page + 1) * PAGE_SIZE, recipientsTotal)} / 총 {recipientsTotal.toLocaleString()}건</span>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(Math.max(0, page - 1))}
                disabled={page === 0 || loading}
                className="px-2 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-30"
              >
                이전
              </button>
              <button
                onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                disabled={page >= totalPages - 1 || loading}
                className="px-2 py-1 rounded border border-white/10 hover:bg-white/5 disabled:opacity-30"
              >
                다음
              </button>
            </div>
          </div>
        )}

        {/* Source caption */}
        <div className="px-5 py-2 border-t border-white/10 text-[10px] text-white/30 italic">
          Data source — email_events 누적 (SMTP relay 직접 트래킹)
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="bg-slate-900/60 border border-white/5 rounded-lg p-2.5">
      <div className="text-[10px] text-white/50 uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-base font-semibold ${color}`}>{value}</div>
      <div className="text-[10px] text-white/40 mt-0.5">{sub}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
        active ? 'bg-violet-500/20 text-violet-200 border border-violet-500/40' : 'text-white/60 hover:text-white hover:bg-white/5 border border-transparent'
      }`}
    >
      {children}
    </button>
  );
}
