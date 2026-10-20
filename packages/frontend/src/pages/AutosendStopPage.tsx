/**
 * AutosendStopPage — 자동마케팅 발송 예고 문자 속 주소가 여는 멈춤 화면(★ 2026-10-18 · 로그인 없음 · 설계서 docs/2026-10-18-planner-v2-design.md §3-8)
 *
 *   - 주소 = /autosend-stop#t=토큰 · API = /api/autosend-stop/{view,skip,pause} · 토큰은 헤더(X-Autosend-Stop-Token)로만
 *   - 버튼 2 = [이번 회차 건너뛰기](이번 발송만 · 다음 회차는 그대로) · [자동마케팅 일시정지](예약 발송 함께 취소)
 *     누르면 확인 창(Harold 1018 「클릭하면 모달로 다시 확인」) · 멈추는 쪽이라 인증번호 없음 · 담당자 전원에게 문자로 알린다
 *   - 다시 켜기 · 승인 · 문안 고치기는 로그인 화면(이 화면은 멈추는 일만)
 * ⛔ native dialog 0 · 줄표 0 · 내부 식별자 0(고객 화면) · 모델명 0.
 */
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, MessageSquare, PauseCircle, SkipForward } from 'lucide-react';
import { useApproveToken } from '../hooks/useApproveToken';
import { LinkShell, LinkLoading, LinkInvalid, LinkNotice, LinkRow } from '../components/link/LinkShell';
import LinkConfirmSheet from '../components/link/LinkConfirmSheet';

interface StopView {
  operatorName: string;
  operatorStatus: string;
  proposalStatus: string;
  sendAt: string | null;
  recipientCount: number;
  body: string;
  canSkip: boolean;
  canPause: boolean;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function whenLabel(iso: string | null): string {
  if (!iso) return '정해지지 않음';
  const k = new Date(Date.parse(iso) + 9 * 3600 * 1000);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일(${WEEK[k.getUTCDay()]}) ${String(k.getUTCHours()).padStart(2, '0')}:${String(k.getUTCMinutes()).padStart(2, '0')}`;
}

export default function AutosendStopPage() {
  const token = useApproveToken();
  const [view, setView] = useState<StopView | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'invalid' | 'error'>('loading');
  const [ask, setAsk] = useState<'skip' | 'pause' | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<'skip' | 'pause' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headers = { 'X-Autosend-Stop-Token': token };

  const load = useCallback(async () => {
    if (!token) { setPhase('invalid'); return; }
    try {
      const res = await fetch('/api/autosend-stop/view', { headers, referrerPolicy: 'no-referrer' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) { setPhase('invalid'); return; }
      if (!res.ok || !data?.success) { setPhase('error'); return; }
      setView(data.view as StopView);
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
      const res = await fetch(`/api/autosend-stop/${ask}`, { method: 'POST', headers, referrerPolicy: 'no-referrer' });
      const data = await res.json().catch(() => ({}));
      if (res.status === 404) { setAsk(null); setPhase('invalid'); return; }
      if (data?.view) setView(data.view as StopView);
      if (!res.ok || !data?.success) { setNotice(data?.error || '처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'); setAsk(null); return; }
      setDone(ask);
      setAsk(null);
    } catch {
      setNotice('처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <LinkShell title="자동마케팅 발송 멈춤" subtitle="곧 나갈 자동 발송을 여기서 멈출 수 있어요" icon={PauseCircle} tone="amber" service="한줄로 AI 자동마케팅">
      {children}
    </LinkShell>
  );

  if (phase === 'loading') return shell(<LinkLoading />);
  if (phase === 'invalid') return shell(<LinkInvalid title="유효하지 않거나 만료된 주소입니다" body="멈춤 주소는 발송 예정 시각 뒤 1시간까지 열립니다. 가장 최근에 받으신 안내 문자의 주소로 다시 열어 주세요." />);
  if (phase === 'error' || !view) {
    return shell(
      <div className="space-y-3">
        <LinkInvalid title="내용을 불러오지 못했습니다" body="잠시 후 다시 열어 주세요." />
        <button type="button" onClick={() => { setPhase('loading'); void load(); }}
          className="w-full h-11 rounded-xl border border-slate-300 bg-white text-[14px] font-semibold text-slate-700">다시 불러오기</button>
      </div>,
    );
  }

  return (
    <>
      {shell(
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <p className="text-[15px] font-bold tracking-[-0.01em] text-slate-900 break-words">{view.operatorName}</p>
              <p className="mt-0.5 text-[12.5px] text-slate-500">{view.operatorStatus === 'active' ? '자동마케팅 켜짐' : '자동마케팅 꺼짐'}</p>
            </div>
            <div className="px-5 py-4 space-y-2">
              <LinkRow label="보낼 시각" value={whenLabel(view.sendAt)} />
              <LinkRow label="받는 사람" value={`${view.recipientCount.toLocaleString()}명`} />
              <LinkRow label="이번 회차" value={view.canSkip ? '나가기 전' : '이미 나갔거나 멈춤'} />
            </div>
            {view.body && (
              <div className="px-5 pb-5">
                <div className="rounded-xl bg-slate-100 px-4 py-3.5 text-[13px] leading-relaxed text-slate-900">
                  <p className="flex items-center gap-1.5 text-[11.5px] text-slate-500 mb-1.5"><MessageSquare className="w-3.5 h-3.5" />나갈 문안</p>
                  <p className="whitespace-pre-wrap break-words">{view.body}</p>
                </div>
              </div>
            )}
          </div>

          {/* ★ 2026-10-20 조작 결과 안내 = 누른 자리(버튼 바로 위) · 옛: 내용 카드 위라 긴 문안 아래에서 누르면 안 보였다(대행 링크 cmvgfv8r51 와 같은 모양) */}
          {notice && <LinkNotice tone="rose">{notice}</LinkNotice>}
          {done === 'skip' && (
            <LinkNotice tone="emerald" icon={CheckCircle2}>
              <b>이번 회차 발송을 건너뛰었습니다.</b> 다음 회차는 그대로 진행합니다. 담당자 모두에게 문자로 알렸어요.
            </LinkNotice>
          )}
          {done === 'pause' && (
            <LinkNotice tone="emerald" icon={CheckCircle2}>
              <b>자동마케팅을 일시정지했습니다.</b> 예약된 발송도 함께 취소했어요. 다시 켜려면 한줄로 자동마케팅 화면에서 켜 주세요.
            </LinkNotice>
          )}

          <div className="space-y-2">
            {view.canSkip && done !== 'skip' && (
              <button type="button" onClick={() => setAsk('skip')}
                className="w-full h-12 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-900 text-[15px] font-bold inline-flex items-center justify-center gap-2">
                <SkipForward className="w-[17px] h-[17px]" />이번 회차 건너뛰기
              </button>
            )}
            {view.canPause && done !== 'pause' && (
              <button type="button" onClick={() => setAsk('pause')}
                className="w-full h-11 rounded-xl border border-slate-300 bg-white text-[14px] font-semibold text-slate-700">
                자동마케팅 일시정지
              </button>
            )}
          </div>
        </div>,
      )}

      <LinkConfirmSheet
        open={ask !== null}
        title={ask === 'pause' ? '자동마케팅을 일시정지할까요?' : '이번 회차를 건너뛸까요?'}
        rows={ask === 'pause'
          ? [{ label: '자동마케팅', value: view.operatorName }]
          : [{ label: '보낼 시각', value: whenLabel(view.sendAt) }, { label: '받는 사람', value: `${view.recipientCount.toLocaleString()}명` }]}
        notes={ask === 'pause'
          ? [{ tone: 'warn', text: '다음 회차부터 자동 발송이 멈추고, 이미 예약된 발송도 함께 취소됩니다.' }, { tone: 'info', text: '다시 켜기는 한줄로 자동마케팅 화면에서 합니다. 담당자 모두에게 문자로 알립니다.' }]
          : [{ tone: 'info', text: '이번 발송만 멈춥니다. 다음 회차는 그대로 진행합니다.' }, { tone: 'info', text: '담당자 모두에게 문자로 알립니다.' }]}
        confirmLabel={ask === 'pause' ? '일시정지' : '건너뛰기'}
        tone="amber"
        busy={busy}
        onConfirm={() => { void run(); }}
        onCancel={() => setAsk(null)}
      />
    </>
  );
}
