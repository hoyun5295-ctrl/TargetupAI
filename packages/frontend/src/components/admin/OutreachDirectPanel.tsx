/**
 * ★ 2026-09-23 AI 영업 검토 화면 — 담당자 직접 발송 패널(설계서 docs/2026-09-23-outreach-direct-send-design.md §5·§12)
 *
 * 담당자 카드(수정 · 도메인 뱃지 · 제휴·문의 페이지 링크) · 네이버 스토어(저장만) · 이 판으로 확인 · 잠금 사유와 바로가기 · 담당자에게 보내기.
 * 잠금·문장·단계·건수는 전부 서버 값(direct)이다. 보내기는 발송 확인 창 1클릭 · 서버가 expectedTo 로 주소가 그대로인지 다시 본다.
 */
import { useEffect, useState } from 'react';
import { Send, Pencil, Check, ExternalLink, Loader2, UserRound, ShieldAlert, RefreshCw } from 'lucide-react';
import type { ConfirmState } from '../ConfirmModal';
import OutreachDirectSendConfirm from './OutreachDirectSendConfirm';
import { outreachFetch, DOMAIN_BADGE, splitEmail, fmtDateTime, type OutreachDirectInfo } from './sales-outreach-shared';

interface Props {
  jobId: string;
  companyName: string;
  stage: string;
  mailResult: string | null | undefined;
  direct: OutreachDirectInfo | null;
  /** 화면에 렌더한 최신 제안 메일 판 id(확인 = 이 판) */
  latestEmailAssetId: string | null;
  basisPresets: string[];
  onRefresh: () => Promise<void> | void;
  onNotice: (msg: string) => void;
  onToast: (msg: string) => void;
  onConfirm: (state: ConfirmState) => void;
  onRebuildEmail: () => void;
  /** 발송 확인 창이 떠 있는가(부모 모달이 ESC 를 넘기도록) */
  onOverlay?: (open: boolean) => void;
}

export default function OutreachDirectPanel({ jobId, companyName, stage, mailResult, direct, latestEmailAssetId, basisPresets, onRefresh, onNotice, onToast, onConfirm, onRebuildEmail, onOverlay }: Props) {
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [basis, setBasis] = useState('');
  const [busy, setBusy] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);

  useEffect(() => { onOverlay?.(sendOpen); return () => onOverlay?.(false); }, [sendOpen, onOverlay]);

  useEffect(() => {
    if (editing) return;
    setEmail(direct?.contact.email || '');
    setName(direct?.contact.name || '');
    setBasis(direct?.contact.basis || '');
  }, [direct?.contact.email, direct?.contact.name, direct?.contact.basis, editing]);

  if (!direct) return null;

  const post = async (path: string, body?: unknown): Promise<{ ok: boolean; data: any }> => {
    setBusy(true);
    try {
      const r = await outreachFetch(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { onNotice(d?.error || '처리에 실패했습니다. 잠시 후 다시 시도해주세요.'); return { ok: false, data: d }; }
      return { ok: true, data: d };
    } catch {
      onNotice('요청에 실패했습니다. 네트워크를 확인해주세요.');
      return { ok: false, data: null };
    } finally {
      setBusy(false);
    }
  };

  const saveContact = async () => {
    const r = await post(`/api/sales-outreach/jobs/${jobId}/contact`, { email: email.trim(), name: name.trim(), basis: basis.trim() });
    if (r.ok) {
      setEditing(false);
      onToast(r.data?.rebuilding ? '담당자를 저장했습니다. 수신거부 링크를 넣어 메일을 다시 조립하고 있습니다.' : '담당자를 저장했습니다.');
      await onRefresh();
    }
  };

  const review = async () => {
    if (!latestEmailAssetId) return;
    const r = await post(`/api/sales-outreach/jobs/${jobId}/review`, { assetId: latestEmailAssetId });
    if (r.ok) { onToast('이 판을 확인했습니다.'); await onRefresh(); }
  };

  const ackDomain = () => {
    onConfirm({
      mode: 'warning',
      title: '다른 회사 도메인 주소로 보내도록 해제합니다',
      description: `담당자 주소(${direct.contact.email})의 도메인이 홈페이지와 다릅니다. 대행사·그룹사 담당자처럼 적어 둔 근거("${direct.contact.basis || ''}")가 맞을 때만 해제하세요. 주소를 바꾸면 다시 잠깁니다.`,
      confirmLabel: '근거 확인했으니 해제',
      onConfirm: async () => {
        const r = await post(`/api/sales-outreach/jobs/${jobId}/domain-ack`);
        if (r.ok) { onToast('도메인 불일치 잠금을 해제했습니다.'); await onRefresh(); }
      },
    });
  };

  const reopen = () => {
    onConfirm({
      mode: 'warning',
      title: '같은 회사 재접촉을 엽니다',
      description: '이 회사에 보낸 기록이 있습니다. 마지막 발송 뒤 90일이 지났을 때만 열립니다. 열면 이 건을 다시 보낼 수 있습니다.',
      confirmLabel: '재접촉 열기',
      onConfirm: async () => {
        const r = await post(`/api/sales-outreach/jobs/${jobId}/reopen-contact`);
        if (r.ok) { onToast('재접촉을 열었습니다.'); await onRefresh(); }
      },
    });
  };

  const send = async () => {
    const r = await post(`/api/sales-outreach/jobs/${jobId}/send-direct`, { expectedTo: direct.contact.email });
    setSendOpen(false);
    if (r.ok) {
      if (r.data?.outcome === 'sent') onToast(`담당자에게 보냈습니다: ${r.data.to}`);
      else if (r.data?.outcome === 'rejected') onNotice('담당자 주소가 거부되었습니다(하드 반송 · 이 주소는 수신거부 원장에 올라갑니다).');
      else onNotice(r.data?.detail || '발송 결과를 확인하지 못했습니다. 이미 도착했을 수 있으니 다시 보내기 전에 확인해주세요.');
    }
    await onRefresh();
  };

  const lockAction = (reason: string) => {
    if (reason === 'DOMAIN_MISMATCH' && stage === 'ready') return <button onClick={ackDomain} disabled={busy} className="text-blue-600 hover:underline shrink-0">근거 확인했으니 해제</button>;
    if (reason === 'NOT_REVIEWED' && stage === 'ready' && latestEmailAssetId) return <button onClick={review} disabled={busy} className="text-blue-600 hover:underline shrink-0">이 판으로 확인</button>;
    if (reason === 'UNSUB_LINK_STALE' && stage === 'ready') return <button onClick={onRebuildEmail} disabled={busy} className="text-blue-600 hover:underline shrink-0">메일 재조립</button>;
    if (reason === 'ALREADY_SENT_COMPANY' && stage === 'ready') return <button onClick={reopen} disabled={busy} className="text-blue-600 hover:underline shrink-0">재접촉 열기</button>;
    if ((reason === 'NO_CONTACT' || reason === 'NO_BASIS') && stage !== 'sent') return <button onClick={() => setEditing(true)} className="text-blue-600 hover:underline shrink-0">담당자 적기</button>;
    return null;
  };

  const badge = DOMAIN_BADGE[direct.domainVerdict];
  const sentDirect = stage === 'sent' && direct.lastSend;
  const inputCls = 'w-full px-2.5 py-1.5 border rounded-lg text-xs outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-gray-500 flex items-center gap-1"><UserRound className="w-3.5 h-3.5" /> 담당자에게 직접 보내기</h4>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600" title={direct.stage.blockers.join(' · ') || undefined}>
          발송 단계 {direct.stage.effective} · 오늘 {direct.today}/{direct.cap}
        </span>
      </div>

      {/* 담당자 카드 */}
      {editing ? (
        <div className="space-y-2">
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="담당자 이메일" className={inputCls} />
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, 40))} placeholder="담당자명(선택 · 메일 첫 줄 호칭)" className={inputCls} />
          <input value={basis} onChange={(e) => setBasis(e.target.value.slice(0, 200))} list={`so-basis-${jobId}`} placeholder="이 주소를 알게 된 근거(명함 · 기존 대화 · 제휴 문의 페이지 등)" className={inputCls} />
          <datalist id={`so-basis-${jobId}`}>{basisPresets.map((b) => <option key={b} value={b} />)}</datalist>
          {direct.contactPages.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {direct.contactPages.map((u) => (
                <a key={u} href={u} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50">
                  <ExternalLink className="w-3 h-3" /> 제휴·문의 페이지 열기
                </a>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400">주소는 사람이 확인한 것만 적습니다. 홈페이지에서 자동으로 가져오지 않습니다.</p>
          <div className="flex items-center gap-2">
            <button onClick={saveContact} disabled={busy} className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs disabled:opacity-40 flex items-center gap-1">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} 저장
            </button>
            <button onClick={() => setEditing(false)} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs text-gray-500 hover:text-gray-800">취소</button>
          </div>
        </div>
      ) : (
        <div className="text-xs space-y-1">
          {direct.contact.email ? (
            <>
              <div className="text-gray-900 break-all">{splitEmail(direct.contact.email).local}<b>{splitEmail(direct.contact.email).domain}</b>{direct.contact.name ? <span className="text-gray-500"> · {direct.contact.name}</span> : null}</div>
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${badge.cls}`}>{badge.label}{direct.domainVerdict === 'other' && direct.domainAcked ? ' · 해제됨' : ''}</span>
                {direct.contact.basis ? <span className="text-[10px] text-gray-500">근거: {direct.contact.basis}</span> : <span className="text-[10px] text-rose-600">근거 없음</span>}
              </div>
            </>
          ) : (
            <p className="text-gray-400">담당자 이메일이 없습니다.</p>
          )}
          {stage !== 'sent' && (
            <button onClick={() => setEditing(true)} className="mt-1 inline-flex items-center gap-1 text-[11px] text-blue-600 hover:underline"><Pencil className="w-3 h-3" /> {direct.contact.email ? '담당자 수정' : '담당자 적기'}</button>
          )}
        </div>
      )}

      {direct.naverStoreUrl && (
        <p className="text-[11px] text-gray-500 break-all">네이버 스토어: <a href={direct.naverStoreUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{direct.naverStoreUrl.replace(/^https:\/\//, '')}</a> · 서버는 읽지 않습니다(행사 문구는 확인 단계에서 북마크 버튼으로)</p>
      )}

      {/* 확인 상태 */}
      {stage === 'ready' && (
        <div className="flex items-center justify-between gap-2 text-xs rounded-lg px-2.5 py-1.5 bg-gray-50">
          {direct.review.reviewed
            ? <span className="text-emerald-700 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> 최신 메일 판을 확인했습니다</span>
            : <span className="text-gray-600">최신 메일 판을 아직 확인하지 않았습니다</span>}
          {!direct.review.reviewed && latestEmailAssetId && (
            <button onClick={review} disabled={busy} className="shrink-0 px-2.5 py-1 rounded-lg bg-gray-900 hover:bg-gray-700 text-white text-[11px] disabled:opacity-40">이 판으로 확인</button>
          )}
        </div>
      )}

      {/* 보내기 */}
      {stage === 'ready' && (
        <>
          <button onClick={() => setSendOpen(true)} disabled={busy || direct.lock.locked || !direct.contact.email}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2">
            <Send className="w-4 h-4 shrink-0" /> <span className="truncate">{direct.contact.email ? `${direct.contact.email}로 보내기` : '담당자에게 보내기'}</span>
          </button>
          {direct.lock.locked && (
            <div className="text-xs text-amber-800 space-y-1">
              {direct.lock.reasons.map((r, i) => (
                <div key={r} className="flex items-start justify-between gap-2">
                  <span className="flex items-start gap-1"><ShieldAlert className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {direct.lock.messages[i] || r}</span>
                  {lockAction(r)}
                </div>
              ))}
            </div>
          )}
          {mailResult && mailResult !== 'sent' && (
            <p className="text-xs text-amber-600">직전 발송이 확인되지 않았습니다({mailResult === 'rejected' ? '수신 거부' : mailResult === 'sending' ? '진행 중' : '결과 미확인 · 이미 도착했을 수 있습니다'}).</p>
          )}
        </>
      )}
      {sentDirect && (
        <p className="text-xs text-emerald-700">담당자에게 보냄 · {fmtDateTime(direct.lastSend!.created_at)} · {direct.lastSend!.outcome === 'sent' ? '도착' : direct.lastSend!.outcome}{direct.lastSend!.mode === 'auto' ? ' · 자동 발송' : direct.lastSend!.mode === 'bulk' ? ' · 묶음 발송' : ''}</p>
      )}
      {direct.directLast && direct.directLast.outcome === 'skipped' && stage === 'ready' && (
        <p className="text-[11px] text-gray-500 flex items-start gap-1"><RefreshCw className="w-3 h-3 mt-0.5 shrink-0" /> {direct.directLast.detail}</p>
      )}

      <OutreachDirectSendConfirm
        open={sendOpen}
        busy={busy}
        today={direct.today}
        cap={direct.cap}
        items={direct.contact.email ? [{ jobId, companyName, to: direct.contact.email, domainVerdict: direct.domainVerdict, directSubject: direct.directSubject, captureUrl: direct.dmCaptureUrl }] : []}
        onConfirm={send}
        onClose={() => setSendOpen(false)}
      />
    </div>
  );
}
