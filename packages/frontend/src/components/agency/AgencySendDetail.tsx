/**
 * AgencySendDetail — 대행발송 접수 상세 (★ 2026-08-22 신설)
 *
 * 설계 = docs/2026-08-22-agency-send-design.md §4-2(목록·상세). 여기서 담당자가 **승인**한다.
 *
 * 보여 줄 것: 지금 문안(승인 대상) · 원문과 달라졌는지 · 검사 이력 · 시각 · 건수.
 * ⛔ 승인 버튼은 서버가 준 상태와 문안 버전으로만 켜진다. 화면이 자격을 다시 계산하지 않는다.
 * ⛔ 문구에 줄표 0. 톤 = 인디고 콘솔.
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock, History, Loader2, Send, X } from 'lucide-react';
import { useToast } from '../ToastProvider';
import {
  CUI_BTN_DANGER, CUI_BTN_GHOST, CUI_BTN_PRIMARY, CUI_CELL_META, CUI_DANGER_BOX, CUI_DANGER_ICON,
  CUI_DANGER_TEXT, CUI_HINT, CUI_INFO, CUI_INFO_ICON, CUI_INFO_TEXT, CUI_INPUT, CUI_LABEL, CUI_MODAL,
  CUI_MODAL_BODY, CUI_MODAL_CLOSE, CUI_MODAL_DESC, CUI_MODAL_FOOT, CUI_MODAL_HEAD, CUI_MODAL_TITLE,
  CUI_PILL_BASE, CUI_PILL_TONE, CUI_SEC_TITLE, CUI_TEXTAREA,
} from '../../utils/console-ui';
import {
  approveAgencyRequest, cancelAgencyRequest, fetchAgencyRequest, formatWhen, isApprovable,
  isCancelable, isEditableStatus, rescheduleAgencyRequest, STATUS_LABEL, STATUS_TONE,
  toLocalInput, updateAgencyContent, type AgencySendEvent, type AgencySendRequest,
} from './agency-send-api';

interface Props {
  requestId: string | null;
  onClose: () => void;
  onChanged: (r: AgencySendRequest) => void;
}

/** 검사 이력을 담당자 언어로 */
const EVENT_LABEL: Record<string, string> = {
  received: '접수했습니다',
  spam_blocked: '스팸 검사에 걸렸습니다',
  refined: '문안을 다듬었습니다',
  refine_failed: '문안을 다듬지 못했습니다',
  awaiting_approval: '검사를 통과해 승인을 기다립니다',
  approved: '승인했습니다',
  reapproval: '발송 직전 검사에 걸려 다시 승인을 기다립니다',
  queued: '예약을 마쳤습니다',
  test_failed: '문안 확인이 필요합니다',
  final_test_failed: '발송 직전 검사를 통과하지 못했습니다',
  expired: '시각이 지나 발송하지 않았습니다',
  cancelled: '취소했습니다',
  content_edited: '문안을 고쳤습니다',
  rescheduled: '시각을 고쳤습니다',
  lock_recovered: '멈춘 작업을 되돌렸습니다',
  notify_failed: '안내 문자를 보내지 못했습니다',
  reconciled_cancelled: '예약이 취소되어 반영했습니다',
  queued_already: '예약을 이미 마친 건입니다',
  queue_failed: '예약을 만드는 중 문제가 있었습니다',
  dispatch_rejected: '예약을 넣지 못했습니다',
  dispatch_no_recipient: '보낼 번호가 남지 않았습니다',
  dispatch_zero_after_filter: '수신거부를 빼고 나니 보낼 번호가 없습니다',
  dispatch_var_overflow: '문안에 넣을 항목이 너무 많습니다',
  dispatch_no_owner: '접수자 정보를 찾지 못했습니다',
  dispatch_error: '예약을 만들지 못해 다시 시도합니다',
  dispatch_incomplete: '예약이 끝나지 않아 발송하지 않았습니다',
  dispatch_unapproved_version: '승인한 문안과 달라 다시 승인을 기다립니다',
  first_test_error: '검사 중 문제가 있어 다시 시도합니다',
  final_test_error: '발송 전 검사 중 문제가 있어 다시 시도합니다',
};

export default function AgencySendDetail({ requestId, onClose, onChanged }: Props) {
  const toast = useToast();
  const [req, setReq] = useState<AgencySendRequest | null>(null);
  const [events, setEvents] = useState<AgencySendEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [newWhen, setNewWhen] = useState('');

  useEffect(() => {
    if (!requestId) { setReq(null); setEvents([]); return; }
    let alive = true;
    setLoading(true);
    fetchAgencyRequest(requestId)
      .then(({ request, events: ev }) => {
        if (!alive) return;
        setReq(request);
        setEvents(ev);
        setDraft(request.currentContent);
        setNewWhen(toLocalInput(new Date(request.requestedAt)));
        setEditing(false);
      })
      .catch((e) => { if (alive) toast.error(e?.message || '접수를 불러오지 못했습니다.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [requestId]);

  const apply = (r: AgencySendRequest) => { setReq(r); setDraft(r.currentContent); onChanged(r); };

  const doApprove = async () => {
    if (!req || busy) return;
    setBusy(true);
    try {
      apply(await approveAgencyRequest(req.id, req.contentVersion));
      toast.success('승인했습니다. 요청한 시각에 나가도록 예약됩니다.');
    } catch (e: any) {
      toast.error(e?.message || '승인하지 못했습니다.');
      if (requestId) fetchAgencyRequest(requestId).then(({ request }) => setReq(request)).catch(() => {});
    } finally { setBusy(false); }
  };

  const doSaveContent = async () => {
    if (!req || busy) return;
    setBusy(true);
    try {
      apply(await updateAgencyContent(req.id, draft));
      setEditing(false);
      toast.success('문안을 고쳤습니다. 검사를 다시 시작합니다.');
    } catch (e: any) {
      toast.error(e?.message || '문안을 고치지 못했습니다.');
    } finally { setBusy(false); }
  };

  const doReschedule = async () => {
    if (!req || busy || !newWhen) return;
    setBusy(true);
    try {
      apply(await rescheduleAgencyRequest(req.id, new Date(newWhen).toISOString()));
      toast.success('시각을 고쳤습니다.');
    } catch (e: any) {
      toast.error(e?.message || '시각을 고치지 못했습니다.');
    } finally { setBusy(false); }
  };

  const doCancel = async () => {
    if (!req || busy) return;
    setBusy(true);
    try {
      apply(await cancelAgencyRequest(req.id));
      toast.success('취소했습니다.');
    } catch (e: any) {
      toast.error(e?.message || '취소하지 못했습니다.');
    } finally { setBusy(false); }
  };

  if (!requestId) return null;

  const refined = !!req && req.currentContent !== req.originalContent;

  return (
    <div className="fixed inset-0 z-[60] bg-neutral-900/45 flex items-center justify-center p-4">
      <div className={`${CUI_MODAL} max-w-[680px]`} role="dialog" aria-modal="true" aria-label="대행발송 상세">
        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
              <Send className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>{req?.fileName || '대행발송'}</h3>
              <p className={CUI_MODAL_DESC}>
                {req ? `${formatWhen(req.requestedAt)} · ${req.recipientCount.toLocaleString()}건 · ${req.messageType}` : ''}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className={CUI_MODAL_CLOSE} aria-label="닫기">
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className={CUI_MODAL_BODY}>
          {loading && <div className="py-10 grid place-items-center text-neutral-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}

          {req && !loading && (
            <>
              <div className="flex items-center gap-2">
                <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE[STATUS_TONE[req.status]]}`}>{STATUS_LABEL[req.status]}</span>
                {req.reapprovalCount > 0 && <span className={CUI_CELL_META}>재승인 {req.reapprovalCount}회</span>}
              </div>

              {isApprovable(req.status) && (
                <div className={CUI_INFO}>
                  <Check className={CUI_INFO_ICON} size={16} strokeWidth={2} />
                  <p className={CUI_INFO_TEXT}>
                    담당자 번호로 보내 드린 문자를 확인하셨나요? 아래 문안 그대로 나갑니다.
                    {req.status === 'reapproval'
                      ? ' 검사는 이미 통과했으니 승인하시면 곧바로 예약됩니다.'
                      : ' 승인하면 요청한 시각에 예약됩니다. 발송 두 시간 전에 한 번 더 검사합니다.'}
                  </p>
                </div>
              )}

              {req.status === 'test_failed' && (
                <div className={CUI_DANGER_BOX}>
                  <AlertTriangle className={CUI_DANGER_ICON} size={16} strokeWidth={2} />
                  <p className={CUI_DANGER_TEXT}>
                    문안이 스팸 검사를 통과하지 못했습니다. 아래에서 문안을 고치면 검사를 다시 시작합니다.
                  </p>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h4 className={CUI_SEC_TITLE}>{isApprovable(req.status) ? '승인할 문안' : '지금 문안'}</h4>
                  {isEditableStatus(req.status) && !editing && (
                    <button type="button" onClick={() => setEditing(true)} className={CUI_BTN_GHOST}>고치기</button>
                  )}
                </div>
                {editing ? (
                  <>
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={7} className={CUI_TEXTAREA} />
                    <p className={CUI_HINT}>고치면 승인이 지워지고 검사를 처음부터 다시 합니다.</p>
                    <div className="mt-2 flex items-center gap-2">
                      <button type="button" onClick={doSaveContent} disabled={busy} className={CUI_BTN_PRIMARY}>저장하고 다시 검사</button>
                      <button type="button" onClick={() => { setEditing(false); setDraft(req.currentContent); }} className={CUI_BTN_GHOST}>그만두기</button>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-3.5 text-[13px] text-neutral-800 whitespace-pre-wrap leading-relaxed">
                    {req.subject && <div className="font-semibold text-neutral-900 mb-1.5">{req.subject}</div>}
                    {req.currentContent}
                  </div>
                )}
              </div>

              {refined && !editing && (
                <div>
                  <h4 className={CUI_SEC_TITLE}>처음 접수한 문안</h4>
                  <div className="mt-1.5 rounded-lg border border-neutral-200 bg-white p-3.5 text-[13px] text-neutral-500 whitespace-pre-wrap leading-relaxed">
                    {req.originalContent}
                  </div>
                  <p className={CUI_HINT}>스팸 검사에 걸려 표현을 다듬었습니다. 날짜와 번호, 링크는 그대로입니다.</p>
                </div>
              )}

              {isEditableStatus(req.status) && (
                <div>
                  <label className={CUI_LABEL}>보낼 시각</label>
                  <div className="flex items-center gap-2">
                    <input type="datetime-local" value={newWhen} onChange={(e) => setNewWhen(e.target.value)} className={CUI_INPUT} />
                    <button type="button" onClick={doReschedule} disabled={busy} className={CUI_BTN_GHOST}>바꾸기</button>
                  </div>
                </div>
              )}

              {events.length > 0 && (
                <div>
                  <h4 className={`${CUI_SEC_TITLE} flex items-center gap-1.5`}>
                    <History className="w-4 h-4 text-neutral-400" strokeWidth={2} />진행 기록
                  </h4>
                  <ul className="mt-2 space-y-1.5">
                    {events.map((e, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-[12.5px]">
                        <Clock className="w-3.5 h-3.5 text-neutral-300 mt-0.5 shrink-0" strokeWidth={2} />
                        <span className="text-neutral-500 tabular-nums shrink-0">{formatWhen(e.created_at)}</span>
                        <span className="text-neutral-800">
                          {/* ⛔ 모르는 항목에 내부 이름을 그대로 쓰지 않는다(고객 화면이다) */}
                          {EVENT_LABEL[e.kind] || '진행 상황을 기록했습니다'}
                          {e.payload?.round ? ` (${e.payload.round}번째)` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className={CUI_MODAL_FOOT}>
          {req && isCancelable(req.status) ? (
            <button type="button" onClick={doCancel} disabled={busy} className={CUI_BTN_DANGER}>취소하기</button>
          ) : <span />}
          {req && isApprovable(req.status) && !editing && (
            <button type="button" onClick={doApprove} disabled={busy} className={CUI_BTN_PRIMARY}>
              {busy ? <Loader2 className="w-[15px] h-[15px] animate-spin" /> : <Check className="w-[15px] h-[15px]" />}
              승인하고 예약하기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
