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
import { AlertTriangle, Check, Eye, Loader2, Send, X } from 'lucide-react';
import { useToast } from '../ToastProvider';
import AgencyPreviewModal from './AgencyPreviewModal';
import AgencyEventLog from './AgencyEventLog';
import {
  CUI_BTN_DANGER, CUI_BTN_GHOST, CUI_BTN_OUTLINE, CUI_BTN_PRIMARY, CUI_CELL_META, CUI_DANGER_BOX, CUI_DANGER_ICON,
  CUI_DANGER_TEXT, CUI_HINT, CUI_INFO, CUI_INFO_ICON, CUI_INFO_TEXT, CUI_INPUT, CUI_LABEL, CUI_MODAL,
  CUI_MODAL_BODY, CUI_MODAL_CLOSE, CUI_MODAL_DESC, CUI_MODAL_FOOT, CUI_MODAL_HEAD, CUI_MODAL_TITLE,
  CUI_PILL_BASE, CUI_PILL_TONE, CUI_SEC_TITLE, CUI_TEXTAREA,
} from '../../utils/console-ui';
import {
  approveAgencyRequest, cancelAgencyRequest, fetchAgencyPreview, fetchAgencyRequest, formatWhen,
  isApprovable, isCancelable, isEditableStatus, rescheduleAgencyRequest, SOURCE_LABEL, STATUS_LABEL,
  STATUS_TONE, toLocalInput, updateAgencyContent, type AgencyPreviewSample, type AgencySendEvent,
  type AgencySendRequest,
} from './agency-send-api';

interface Props {
  requestId: string | null;
  onClose: () => void;
  onChanged: (r: AgencySendRequest) => void;
}


export default function AgencySendDetail({ requestId, onClose, onChanged }: Props) {
  const toast = useToast();
  const [req, setReq] = useState<AgencySendRequest | null>(null);
  const [events, setEvents] = useState<AgencySendEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [newWhen, setNewWhen] = useState('');
  // ★2026-08-28 치환 미리보기(서수란 접수) — 펼칠 때 1회 조회(지연). 문안을 고치면 접수를 다시 여는
  //   흐름이라 접수 단위 캐시로 충분하다.
  const [previewOpen, setPreviewOpen] = useState(false);
  const [preview, setPreview] = useState<{ samples: AgencyPreviewSample[]; shown: number; total: number } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    if (!requestId) { setReq(null); setEvents([]); return; }
    let alive = true;
    setLoading(true);
    setPreviewOpen(false); setPreview(null); setPreviewError('');
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

  const openPreview = async () => {
    setPreviewOpen(true);
    if (preview || previewLoading || !requestId) return;
    setPreviewLoading(true);
    setPreviewError('');
    try {
      setPreview(await fetchAgencyPreview(requestId));
    } catch (e: any) {
      setPreviewError(e?.message || '미리보기를 불러오지 못했습니다.');
    } finally { setPreviewLoading(false); }
  };

  // 문안·시각이 바뀌면 미리보기도 낡는다. 비워 두면 다음 펼침에서 새로 읽는다.
  const apply = (r: AgencySendRequest) => { setReq(r); setDraft(r.currentContent); setPreview(null); setPreviewOpen(false); onChanged(r); };

  /**
   * 서버가 거절했을 때 현재 상태를 다시 읽는다.
   * 거절 이유가 "그 사이 내용이 바뀌었다"인 경우가 많아, 화면을 맞춰 줘야 담당자가 무엇이 달라졌는지 본다.
   */
  const refresh = async () => {
    if (!requestId) return;
    try {
      const { request, events: ev } = await fetchAgencyRequest(requestId);
      setReq(request);
      setEvents(ev);
      setNewWhen(toLocalInput(new Date(request.requestedAt)));
    } catch { /* 조회 실패는 이미 뜬 오류 위에 덧씌우지 않는다 */ }
  };

  const doApprove = async () => {
    if (!req || busy) return;
    setBusy(true);
    try {
      apply(await approveAgencyRequest(req.id, req.revision));
      toast.success('승인했습니다. 요청한 시각에 나가도록 예약됩니다.');
    } catch (e: any) {
      toast.error(e?.message || '승인하지 못했습니다.');
      await refresh();
    } finally { setBusy(false); }
  };

  const doSaveContent = async () => {
    if (!req || busy) return;
    setBusy(true);
    try {
      apply(await updateAgencyContent(req.id, draft, req.revision));
      setEditing(false);
      toast.success('문안을 고쳤습니다. 검사를 다시 시작합니다.');
    } catch (e: any) {
      toast.error(e?.message || '문안을 고치지 못했습니다.');
      await refresh();
    } finally { setBusy(false); }
  };

  const doReschedule = async () => {
    if (!req || busy || !newWhen) return;
    setBusy(true);
    try {
      const { request, timeShifted } = await rescheduleAgencyRequest(req.id, new Date(newWhen).toISOString(), req.revision);
      apply(request);
      // ★0826(6) 촉박해서 서버가 뒤로 옮겼으면 그 사실을 그 자리에서 알린다(고른 값과 다른 값이 저장됐다)
      toast.success(timeShifted
        ? `준비 시간이 촉박해 ${formatWhen(request.requestedAt)}으로 잡았습니다.`
        : '시각을 고쳤습니다.');
    } catch (e: any) {
      toast.error(e?.message || '시각을 고치지 못했습니다.');
      await refresh();
    } finally { setBusy(false); }
  };

  const doCancel = async () => {
    if (!req || busy) return;
    setBusy(true);
    try {
      const { request: next, pending } = await cancelAgencyRequest(req.id);
      apply(next);
      toast.success(pending ? '취소를 처리하고 있습니다. 잠시 후 상태가 바뀝니다.' : '취소했습니다.');
    } catch (e: any) {
      toast.error(e?.message || '취소하지 못했습니다.');
      await refresh();
    } finally { setBusy(false); }
  };

  if (!requestId) return null;

  const refined = !!req && req.currentContent !== req.originalContent;

  return (
    <div className="fixed inset-0 z-[60] bg-neutral-900/45 flex items-center justify-center p-4">
      <div className={`${CUI_MODAL} max-w-[780px]`} role="dialog" aria-modal="true" aria-label="대행발송 상세">
        <div className={CUI_MODAL_HEAD}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-indigo-600 text-white grid place-items-center">
              <Send className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h3 className={CUI_MODAL_TITLE}>{req?.fileName || '대행발송'}</h3>
              <p className={CUI_MODAL_DESC}>
                {/* ★0826 §18: 출처는 SOURCE_LABEL 단일표. 발신 이메일 주소 전문은 이력(payload)에서만 보인다 */}
                {/* ★0826(2) 접수 계정 = 관리자 응답에만 실려 온다 */}
                {req ? `${SOURCE_LABEL[req.source] || SOURCE_LABEL.screen} · ${formatWhen(req.requestedAt)} · ${req.recipientCount.toLocaleString()}건 · ${req.messageType}${req.createdByName ? ` · ${req.createdByName}` : ''}` : ''}
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
                    {!req.finalTestRequired
                      ? ' 검사는 이미 통과했으니 승인하시면 요청한 시각에 예약됩니다.'
                      : ' 승인하면 요청한 시각에 예약됩니다. 발송일이 오늘이 아니라서 발송 두 시간 전에 한 번 더 검사합니다.'}
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

              {/* ★2026-08-28(2) 치환 미리보기 = 별도 모달(Harold 지시) — 상세 안에 목록으로 늘어놓지 않고
                  왼쪽 사람 목록·오른쪽 폰 화면으로 본다. 조립은 서버 실물 CT(발송과 같은 함수) */}
              {!editing && (
                <div>
                  <button type="button" onClick={openPreview} className={CUI_BTN_OUTLINE}>
                    <Eye className="w-[15px] h-[15px]" strokeWidth={2} />
                    받는 사람별 발송 내용 보기
                  </button>
                  <p className={CUI_HINT}>
                    실제 발송과 같은 치환으로 만든 문장을 사람마다 확인할 수 있습니다.
                    {req.finalTestRequired ? ' 예약은 발송 두 시간 전 검사를 통과한 뒤 걸립니다.' : ''}
                  </p>
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

              <AgencyEventLog events={events} />
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

      {/* ★2026-08-28(2) 받는 사람별 미리보기 — 별도 모달(portal). 부모 모달의 overflow-hidden에 잘리지 않는다 */}
      {req && (
        <AgencyPreviewModal
          show={previewOpen}
          onClose={() => setPreviewOpen(false)}
          title={req.fileName || '대행발송'}
          subtitle={`${req.recipientCount.toLocaleString()}명 · ${req.messageType}${req.isAd ? ' · 광고' : ''} · ${formatWhen(req.requestedAt)}`}
          samples={preview?.samples || []}
          shown={preview?.shown || 0}
          total={preview?.total || req.recipientCount}
          messageType={req.messageType}
          callbackNumber={req.callbackNumber}
          images={Array.isArray(req.mmsImagePaths) ? req.mmsImagePaths : []}
          loading={previewLoading}
          error={previewError}
        />
      )}
    </div>
  );
}
