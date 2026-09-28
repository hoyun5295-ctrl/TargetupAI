/**
 * PrecheckUsageDetailModal — 스팸 검사·맞춤법 사용 기록 상세 (★ 2026-09-28 Harold 지시 · 목업 승인 · ceo 전용 · 읽기만)
 *
 * "최근 사용 기록" 한 줄 → 어떤 문안을 썼고, 스팸 검사는 통신사별로 어떻게 나왔고, 맞춤법은 무엇을 어떻게 고치라고 했는지.
 * 조립·이름표 = 서버(utils/precheck-usage.ts `loadPrecheckDetail` · 스팸 결과 이름표 = 결과 CT). 이 창은 받은 값을 그린다.
 * ⛔ 직접발송 맞춤법의 문안·고칠 곳은 0928부터 저장한다 — 그 전 기록은 개수만 있다(stored=false 안내).
 * ⛔ 닫기 = X·[닫기]·ESC 만(배경 클릭으로 닫지 않는다 · LESSONS_FRONTEND 0704). 톤 = 부모(슈퍼관리자 라이트) · 자매 = AgencySendLedgerPanel 상세 창.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, ShieldCheck, SpellCheck, X } from 'lucide-react';
import { calculateSmsBytes, formatDateTimeShort, formatPhoneNumber } from '../../utils/formatDate';
import { carrierLabel, type SpellIssue } from '../../utils/send-checks';

export interface PrecheckDetailTarget {
  createdAt: string;
  companyName: string;
  userName: string | null;
  userLogin: string | null;
  kindLabel: string;
  subLabel: string;
  trial: boolean;
  resultLabel: string;
  detailType: 'spam' | 'spell_direct' | 'spell_agency';
  ref: string | null;
}

interface SpamCell { label: string; tone: 'pass' | 'blocked' | 'fail' | 'pending'; receivedAt: string | null }
interface SpamDetail {
  type: 'spam';
  callbackNumber: string | null;
  sms: string | null;
  lms: string | null;
  subject: string | null;
  status: string;
  grid: { types: string[]; rows: { carrier: string; cells: Record<string, SpamCell | null> }[]; total: number; pass: number; blocked: number };
}
interface SpellDirectDetail {
  type: 'spell_direct';
  status: string;
  issueCount: number;
  stored: boolean;
  text: string | null;
  issues: SpellIssue[] | null;
}
interface SpellAgencyDetail {
  type: 'spell_agency';
  messageType: string;
  subject: string | null;
  text: string;
  state: 'ok' | 'changed' | 'failed' | 'missing';
  issues: SpellIssue[] | null;
  checkedAt: string | null;
}
type Detail = SpamDetail | SpellDirectDetail | SpellAgencyDetail;

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });

const TONE: Record<SpamCell['tone'], { text: string; dot: string }> = {
  pass: { text: 'text-emerald-700', dot: 'bg-emerald-500' },
  blocked: { text: 'text-rose-700', dot: 'bg-rose-500' },
  fail: { text: 'text-gray-600', dot: 'bg-gray-400' },
  pending: { text: 'text-amber-700', dot: 'bg-amber-400' },
};

/** (순수) 문안을 고칠 곳 기준으로 나눈다. 자리가 원문과 안 맞거나 겹치는 항목은 표시하지 않는다(글은 그대로). */
function spellSegments(text: string, issues: readonly SpellIssue[]): { text: string; issue?: SpellIssue }[] {
  const out: { text: string; issue?: SpellIssue }[] = [];
  let at = 0;
  for (const i of [...issues].sort((a, b) => a.start - b.start)) {
    if (i.start < at || text.slice(i.start, i.end) !== i.before) continue;
    if (i.start > at) out.push({ text: text.slice(at, i.start) });
    out.push({ text: i.before, issue: i });
    at = i.end;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

function SubChip({ target }: { target: PrecheckDetailTarget }) {
  const cls = target.trial
    ? 'bg-blue-50 text-blue-700'
    : target.subLabel === '자동'
      ? 'bg-violet-50 text-violet-700'
      : 'bg-gray-100 text-gray-600';
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>{target.subLabel}</span>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'em' | 'ro' }) {
  const color = tone === 'em' ? 'text-emerald-600' : tone === 'ro' ? 'text-rose-600' : 'text-gray-900';
  return (
    <div className="flex-1 min-w-[120px] rounded-xl border border-gray-200 px-3 py-2.5">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`text-base font-bold mt-0.5 tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function MessageBox({ label, text, subject, bytes }: { label: string; text: string; subject?: string | null; bytes?: boolean }) {
  return (
    <div>
      <h4 className="text-[12.5px] font-semibold text-gray-500 mb-1.5 flex items-center gap-1.5">
        검사한 문안
        <span className="px-1.5 py-px rounded-md border border-gray-200 bg-white text-[11px] text-gray-600 font-medium">{label}</span>
      </h4>
      <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-[13px] text-gray-800 whitespace-pre-wrap break-all leading-relaxed">
        {subject && <div className="font-semibold text-gray-900 mb-1">{subject}</div>}
        {text}
      </div>
      {bytes && <div className="mt-1 text-right text-[11px] text-gray-400 tabular-nums">{calculateSmsBytes(text).toLocaleString()} byte</div>}
    </div>
  );
}

function SpamBody({ d }: { d: SpamDetail }) {
  const g = d.grid;
  return (
    <>
      <div className="flex flex-wrap gap-2.5">
        <Stat label="회신번호" value={d.callbackNumber ? formatPhoneNumber(d.callbackNumber) || d.callbackNumber : '-'} />
        <Stat label="정상 수신" value={`${g.pass} / ${g.total}`} tone={g.total > 0 && g.pass === g.total ? 'em' : undefined} />
        <Stat label="차단" value={String(g.blocked)} tone={g.blocked > 0 ? 'ro' : undefined} />
      </div>
      {d.status === 'active' && (
        <p className="text-[12px] text-amber-700 bg-amber-50 rounded-lg px-3 py-2">아직 진행 중인 검사입니다. 결과가 다 모이면 바뀝니다.</p>
      )}
      <div>
        <h4 className="text-[12.5px] font-semibold text-gray-500 mb-1.5">통신사별 결과</h4>
        {g.rows.length === 0 ? (
          <p className="text-[12.5px] text-gray-400">통신사별 결과가 없습니다.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-xs text-gray-500">
                  <th className="px-3 py-2 font-medium whitespace-nowrap">통신사</th>
                  {g.types.map((t) => (
                    <th key={t} className="px-3 py-2 font-medium whitespace-nowrap">{t === 'SMS' ? '단문(SMS)' : t === 'LMS' ? '장문(LMS)' : t}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {g.rows.map((row) => (
                  <tr key={row.carrier}>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-gray-800">{carrierLabel(row.carrier)}</td>
                    {g.types.map((t) => {
                      const c = row.cells[t];
                      if (!c) return <td key={t} className="px-3 py-2 text-gray-300">-</td>;
                      return (
                        <td key={t} className="px-3 py-2 whitespace-nowrap">
                          <span className={`inline-flex items-center gap-1.5 text-[13px] font-medium ${TONE[c.tone].text}`}>
                            <i className={`w-1.5 h-1.5 rounded-full ${TONE[c.tone].dot}`} />
                            {c.label}
                            {c.receivedAt && <span className="text-[11.5px] font-normal text-gray-400 tabular-nums">{formatDateTimeShort(c.receivedAt)}</span>}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {d.sms && <MessageBox label="SMS" text={d.sms} bytes />}
      {d.lms && <MessageBox label="LMS" text={d.lms} subject={d.subject} />}
      {!d.sms && !d.lms && <p className="text-[12.5px] text-gray-400">저장된 문안이 없습니다.</p>}
    </>
  );
}

function SpellIssues({ text, issues }: { text: string; issues: SpellIssue[] }) {
  return (
    <>
      <div>
        <h4 className="text-[12.5px] font-semibold text-gray-500 mb-1.5">
          검사한 문안{issues.length > 0 && <span className="font-normal text-gray-400"> · 빨간 곳이 고칠 곳</span>}
        </h4>
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-[13px] text-gray-800 whitespace-pre-wrap break-all leading-relaxed">
          {spellSegments(text, issues).map((s, i) => s.issue
            ? <mark key={i} className="bg-rose-100 text-rose-700 rounded px-0.5 underline decoration-wavy decoration-rose-500 underline-offset-[3px]">{s.text}</mark>
            : <span key={i}>{s.text}</span>)}
        </div>
      </div>
      <div>
        <h4 className="text-[12.5px] font-semibold text-gray-500 mb-1.5">고칠 곳 {issues.length}</h4>
        {issues.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-300 py-6 text-center text-[13px] text-gray-500">고칠 곳이 없었습니다.</div>
        ) : (
          <ol className="divide-y divide-gray-100">
            {issues.map((i, n) => (
              <li key={i.id || n} className="flex gap-3 py-2.5 first:pt-0">
                <span className="shrink-0 w-[22px] h-[22px] rounded-full bg-gray-100 text-gray-600 text-xs font-semibold grid place-items-center">{n + 1}</span>
                <div className="min-w-0">
                  <div className="text-[13.5px] break-all">
                    <span className="text-rose-600 line-through">{i.before}</span>
                    <span className="text-gray-400 mx-1.5">→</span>
                    <b className="text-emerald-700">{i.after}</b>
                    <span className="ml-1.5 px-1.5 rounded-md border border-gray-200 text-[11px] text-gray-500">{i.kind === 'spacing' ? '띄어쓰기' : '맞춤법'}</span>
                  </div>
                  {i.reason && <div className="text-[12px] text-gray-500 mt-0.5">{i.reason}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <p className="text-[12px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">검사가 제안한 내용입니다. 고객이 [고치기]를 눌러 실제로 바꿔 보냈는지는 기록하지 않습니다.</p>
    </>
  );
}

function SpellDirectBody({ d, target }: { d: SpellDirectDetail; target: PrecheckDetailTarget }) {
  return (
    <>
      <div className="flex flex-wrap gap-2.5">
        <Stat
          label="고칠 곳"
          value={d.status === 'done' ? (d.issueCount > 0 ? String(d.issueCount) : '없음') : '-'}
          tone={d.status !== 'done' ? undefined : d.issueCount > 0 ? 'ro' : 'em'}
        />
        <Stat label="검사 결과" value={target.resultLabel} />
      </div>
      {d.status === 'failed' ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-7 px-3 text-center text-[13px] text-gray-500">검사가 끝나지 못한 기록이라 남은 내용이 없습니다.</div>
      ) : d.status === 'reserved' ? (
        <div className="rounded-xl border border-dashed border-gray-300 py-7 px-3 text-center text-[13px] text-gray-500">아직 검사 중인 기록입니다.</div>
      ) : d.stored && d.text != null ? (
        <SpellIssues text={d.text} issues={d.issues || []} />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-300 py-7 px-3 text-center text-[13px] text-gray-500 leading-relaxed">
          이 기록은 검사 내용을 저장하기 전에 남은 기록이라<br />문안과 고칠 곳을 볼 수 없습니다. 고칠 곳 개수만 남아 있습니다.
        </div>
      )}
    </>
  );
}

const AGENCY_STATE_NOTE: Record<Exclude<SpellAgencyDetail['state'], 'ok'>, string> = {
  changed: '검사 뒤 담당자가 문안을 고쳐 이 검사 결과는 남아 있지 않습니다. 아래는 지금 문안입니다.',
  failed: '이 접수의 마지막 맞춤법 검사가 실패했습니다. 아래는 지금 문안입니다.',
  missing: '이 접수에 남은 맞춤법 검사 결과가 없습니다. 아래는 지금 문안입니다.',
};

function SpellAgencyBody({ d }: { d: SpellAgencyDetail }) {
  const isSms = d.messageType.toUpperCase() === 'SMS';
  return (
    <>
      <div className="flex flex-wrap gap-2.5">
        <Stat
          label="고칠 곳"
          value={d.state === 'ok' ? ((d.issues?.length ?? 0) > 0 ? String(d.issues!.length) : '없음') : '-'}
          tone={d.state === 'ok' ? ((d.issues?.length ?? 0) > 0 ? 'ro' : 'em') : undefined}
        />
        <Stat label="문안 종류" value={d.messageType || '-'} />
        {d.checkedAt && <Stat label="검사 시각" value={formatDateTimeShort(d.checkedAt)} />}
      </div>
      {d.state === 'ok' ? (
        <>
          {d.subject && <p className="text-[12.5px] text-gray-500">제목: <span className="text-gray-800">{d.subject}</span></p>}
          <SpellIssues text={d.text} issues={d.issues || []} />
        </>
      ) : (
        <>
          <p className="text-[12px] text-gray-500 bg-gray-50 rounded-lg px-3 py-2">{AGENCY_STATE_NOTE[d.state]}</p>
          <MessageBox label={d.messageType || '문안'} text={d.text} subject={isSms ? null : d.subject} bytes={isSms} />
        </>
      )}
    </>
  );
}

const SOURCE_CAPTION: Record<PrecheckDetailTarget['detailType'], string> = {
  spam: '자료: 스팸 검사 기록 · 통신사별 수신 결과',
  spell_direct: '자료: 직접발송 맞춤법 기록',
  spell_agency: '자료: 대행 접수 문안 · 대행 맞춤법 결과',
};

export default function PrecheckUsageDetailModal({ target, onClose }: { target: PrecheckDetailTarget; onClose: () => void }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) { e.stopPropagation(); onCloseRef.current(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    // 창을 닫거나 다른 줄로 바뀌면 늦게 온 응답은 버린다
    const ctrl = new AbortController();
    setDetail(null); setError(null); setLoading(true);
    (async () => {
      try {
        if (!target.ref) throw new Error('이 기록은 상세를 볼 수 없습니다.');
        const params = new URLSearchParams({ type: target.detailType, ref: target.ref });
        const r = await fetch(`/api/admin/precheck-usage/detail?${params}`, { headers: authHeaders(), signal: ctrl.signal });
        const d = await r.json().catch(() => null);
        if (!r.ok || !d?.success) throw new Error(d?.error || '상세를 불러오지 못했습니다.');
        setDetail(d.detail as Detail);
      } catch (e: any) {
        if (ctrl.signal.aborted) return;
        setError(e?.message || '상세를 불러오지 못했습니다.');
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [target.detailType, target.ref]);

  const isSpam = target.detailType === 'spam';
  const Icon = isSpam ? ShieldCheck : SpellCheck;

  return (
    <div className="fixed inset-0 z-[70] bg-gray-900/45 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl w-full max-w-[640px] max-h-[88vh] flex flex-col" role="dialog" aria-modal="true" aria-label={`${target.kindLabel} 상세`}>
        <div className="px-5 py-4 border-b flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSpam ? 'bg-blue-50' : 'bg-emerald-50'}`}>
              <Icon className={`w-4 h-4 ${isSpam ? 'text-blue-600' : 'text-emerald-600'}`} />
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-gray-900 flex items-center gap-2">
                <span className="truncate">{target.kindLabel} 상세</span>
                <SubChip target={target} />
              </h3>
              <p className="text-[12px] text-gray-500 truncate">
                {target.companyName}
                {target.userName ? ` · ${target.userName}` : ''}
                {target.userLogin ? ` (${target.userLogin})` : ''}
                {' · '}{formatDateTimeShort(target.createdAt)}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 shrink-0" aria-label="닫기">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-4">
          {loading && <div className="py-10 grid place-items-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>}
          {error && !loading && <p className="text-[13px] text-rose-600">{error}</p>}
          {detail && !loading && (
            detail.type === 'spam' ? <SpamBody d={detail} />
              : detail.type === 'spell_direct' ? <SpellDirectBody d={detail} target={target} />
                : <SpellAgencyBody d={detail} />
          )}
        </div>

        <div className="px-5 py-3 border-t flex items-center justify-between gap-3 shrink-0">
          <span className="text-[10px] text-gray-400 italic">{SOURCE_CAPTION[target.detailType]}</span>
          <button type="button" onClick={onClose} className="px-3.5 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50">닫기</button>
        </div>
      </div>
    </div>
  );
}
