/**
 * JourneyPausePage — 여정 발송 2시간 전 안내 문자 속 주소가 여는 정지 화면(로그인 없음)
 * D218+ (2026-05-26) 신설 · ★ 2026-10-18 정지 링크 결함 정정(설계서 docs/2026-10-18-planner-v2-design.md §3-1)
 *
 *   - 주소 = /journey-pause#t=토큰(새 문자) · /journey-pause/:token(이미 나간 24시간 링크 · 읽자마자 주소에서 지운다)
 *   - API = /api/journey-pause/{info,pause,pause-journey} · 토큰은 헤더(X-Journey-Pause-Token)로만
 *   - 버튼 2 = [이 발송 정지](그 단계 · 그날 대상 전부) · [여정 전체 일시정지] · 누르면 확인 창(Harold 1018 「클릭하면 모달로 다시 확인」)
 *   - 결과는 서버가 센 사실대로(멈춘 수 · 이미 보내기 시작한 수) · 번호 입력칸 없음(토큰에 받은 번호가 실려 있다)
 *
 * ⛔ native dialog 0 · 줄표 0 · 내부 식별자 0(고객 화면).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, MessageSquare, PauseCircle } from 'lucide-react';
import { useApproveToken } from '../hooks/useApproveToken';
import { LinkShell, LinkLoading, LinkInvalid, LinkNotice, LinkRow } from '../components/link/LinkShell';
import LinkConfirmSheet from '../components/link/LinkConfirmSheet';

interface PauseInfo {
  journeyName: string;
  journeyStatus: string;
  stepOrder: number;
  channel: string;
  messageSubject: string | null;
  messageBody: string;
  sendDate: string;
  dueCount: number;
  startedCount: number;
}

type Done =
  | { kind: 'step'; paused: number; startedCount: number | null; sendDate: string }
  | { kind: 'journey'; changed: boolean };

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function dayLabel(d: string): string {
  const [y, m, dd] = d.split('-').map(Number);
  if (!y || !m || !dd) return d;
  return `${m}월 ${dd}일(${WEEK[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]})`;
}

/** 옛 주소(/journey-pause/:token)의 토큰을 읽고 주소에서 지운다(브라우저 기록에 정지권을 남기지 않는다) */
function usePathToken(): string {
  const { token } = useParams<{ token?: string }>();
  const ref = useRef<string>(token || '');
  useEffect(() => {
    if (token) window.history.replaceState(null, '', '/journey-pause');
  }, [token]);
  return ref.current;
}

export default function JourneyPausePage() {
  const fragmentToken = useApproveToken();
  const pathToken = usePathToken();
  const token = fragmentToken || pathToken;
  const [info, setInfo] = useState<PauseInfo | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  const [ask, setAsk] = useState<'step' | 'journey' | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headers = { 'X-Journey-Pause-Token': token };

  const load = useCallback(async () => {
    if (!token) { setPhase('invalid'); return; }
    try {
      const res = await fetch('/api/journey-pause/info', { headers, referrerPolicy: 'no-referrer' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) { setPhase('invalid'); return; }
      if (!res.ok || !data?.success) { setPhase('error'); return; }
      setInfo(data as PauseInfo);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  const run = async () => {
    if (!ask || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(ask === 'step' ? '/api/journey-pause/pause' : '/api/journey-pause/pause-journey', {
        method: 'POST', headers, referrerPolicy: 'no-referrer',
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) { setAsk(null); setPhase('invalid'); return; }
      if (!res.ok || !data?.success) { setNotice(data?.error || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); return; }
      setDone(ask === 'step'
        ? { kind: 'step', paused: Number(data.paused) || 0, startedCount: data.startedCount === null || data.startedCount === undefined ? null : Number(data.startedCount) || 0, sendDate: String(data.sendDate || info?.sendDate || '') }
        : { kind: 'journey', changed: !!data.changed });
      setAsk(null);
    } catch {
      setNotice('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <LinkShell title="여정 발송 정지" subtitle="곧 나갈 자동 발송을 여기서 멈출 수 있어요" icon={PauseCircle} tone="amber" service="한줄로 마케팅 여정">
      {children}
    </LinkShell>
  );

  if (phase === 'loading') return shell(<LinkLoading />);
  if (phase === 'invalid') return shell(<LinkInvalid title="유효하지 않거나 만료된 주소입니다" body="정지 주소는 24시간 동안 열립니다. 가장 최근에 받으신 안내 문자의 주소로 다시 열어 주세요." />);
  if (phase === 'error' || !info) {
    return shell(
      <div className="space-y-3">
        <LinkInvalid title="내용을 불러오지 못했습니다" body="잠시 후 다시 열어 주세요." />
        <button type="button" onClick={() => { setPhase('loading'); void load(); }}
          className="w-full h-11 rounded-xl border border-slate-300 bg-white text-[14px] font-semibold text-slate-700">다시 불러오기</button>
      </div>,
    );
  }

  const journeyPaused = info.journeyStatus !== 'active';
  return (
    <>
      {shell(
        <div className="space-y-4">
          {notice && <LinkNotice tone="rose">{notice}</LinkNotice>}
          {done?.kind === 'step' && (
            <LinkNotice tone={done.paused > 0 ? 'emerald' : 'amber'} icon={CheckCircle2}>
              <b>{dayLabel(done.sendDate)} 이 단계 발송 {done.paused.toLocaleString()}건을 멈췄습니다.</b>
              {done.startedCount === null ? <> 이미 보내기 시작한 건수는 확인하지 못했습니다.</> : done.startedCount > 0 && <> 이미 보내기 시작한 {done.startedCount.toLocaleString()}건은 멈추지 못했습니다.</>}
              {' '}지금 뒤로 새로 들어오는 고객은 이 정지로 막지 못합니다. 모두 막으려면 아래 [여정 전체 일시정지]를 눌러 주세요.
            </LinkNotice>
          )}
          {done?.kind === 'journey' && (
            <LinkNotice tone="emerald" icon={CheckCircle2}>
              <b>{done.changed ? '여정 전체를 일시정지했습니다.' : '이 여정은 이미 멈춰 있습니다.'}</b> 다시 켜려면 한줄로 여정 화면에서 문안을 확인한 뒤 재개해 주세요.
            </LinkNotice>
          )}

          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <p className="text-[15px] font-bold tracking-[-0.01em] text-slate-900 break-words">{info.journeyName}</p>
              <p className="mt-0.5 text-[12.5px] text-slate-500">{info.stepOrder}번째 단계 · {journeyPaused ? '여정이 멈춰 있어요' : '진행 중'}</p>
            </div>
            <div className="px-5 py-4 space-y-2">
              <LinkRow label="보낼 날" value={dayLabel(info.sendDate)} />
              <LinkRow label="지금 멈출 수 있는 발송" value={`${info.dueCount.toLocaleString()}건`} />
              {info.startedCount > 0 && <LinkRow label="이미 보내기 시작함" value={`${info.startedCount.toLocaleString()}건`} />}
            </div>
            <div className="px-5 pb-5">
              <div className="rounded-xl bg-slate-100 px-4 py-3.5 text-[13px] leading-relaxed text-slate-900">
                <p className="flex items-center gap-1.5 text-[11.5px] text-slate-500 mb-1.5"><MessageSquare className="w-3.5 h-3.5" />나갈 문안</p>
                {info.messageSubject && <p className="font-extrabold mb-1">{info.messageSubject}</p>}
                <p className="whitespace-pre-wrap break-words">{info.messageBody}</p>
              </div>
              <p className="mt-2 text-[10px] text-slate-400 italic">Data source: 여정 발송 기록 · 지금 기준 실조회</p>
            </div>
          </div>

          {!journeyPaused && !done && (
            <div className="space-y-2">
              <button type="button" onClick={() => setAsk('step')} disabled={info.dueCount === 0}
                className="w-full h-12 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 text-[15px] font-bold inline-flex items-center justify-center gap-2 disabled:opacity-40">
                <PauseCircle className="w-[17px] h-[17px]" />이 발송 정지 · {info.dueCount.toLocaleString()}건
              </button>
              <button type="button" onClick={() => setAsk('journey')}
                className="w-full h-11 rounded-xl border border-slate-300 bg-white text-[14px] font-semibold text-slate-700">
                여정 전체 일시정지
              </button>
            </div>
          )}
          {!journeyPaused && done?.kind === 'step' && (
            <button type="button" onClick={() => setAsk('journey')}
              className="w-full h-11 rounded-xl border border-slate-300 bg-white text-[14px] font-semibold text-slate-700">
              여정 전체 일시정지
            </button>
          )}
        </div>,
      )}

      <LinkConfirmSheet
        open={ask !== null}
        title={ask === 'journey' ? '여정 전체를 일시정지할까요?' : '이 발송을 멈출까요?'}
        rows={ask === 'journey'
          ? [{ label: '여정', value: info.journeyName }]
          : [{ label: '보낼 날', value: dayLabel(info.sendDate) }, { label: '멈출 발송', value: `${info.dueCount.toLocaleString()}건(누르는 순간 다시 셉니다)` }]}
        notes={ask === 'journey'
          ? [{ tone: 'warn', text: '이 여정의 모든 단계 발송이 멈춥니다. 새 고객도 들어오지 않습니다.' }, { tone: 'info', text: '다시 켜기는 한줄로 여정 화면에서 합니다.' }]
          : [{ tone: 'info', text: '이 단계의 그날 발송만 멈춥니다. 다른 단계와 다른 날은 그대로 갑니다.' }, { tone: 'warn', text: '이미 보내기 시작한 건은 멈추지 못합니다.' }]}
        confirmLabel={ask === 'journey' ? '여정 일시정지' : '이 발송 정지'}
        tone="amber"
        busy={busy}
        onConfirm={() => { void run(); }}
        onCancel={() => setAsk(null)}
      />
    </>
  );
}
