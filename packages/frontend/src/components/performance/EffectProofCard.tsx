/**
 * 효과 증명 카드(★ 2026-11-06 C110 · 설계서 docs/2026-11-06-c110-effect-proof-priority-design.md §6-2)
 * 전체 대조군 한 줄 + 발송별 목록 · 문장 · 판정 띠 = 서버 한 산식(effect-measure-core)이 만든 글자를 그대로 그린다(R56).
 * 서버 칸 준비 전(ready 거짓) = 카드 없음 · 대조군이 없으면 빈 상태 + 설정 이동.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';

type Verdict = 'insufficient' | 'positive' | 'negative' | 'unclear';
interface Lift {
  treated: { n: number; buyers: number; revenue: number };
  control: { n: number; buyers: number; revenue: number };
  rateT: number; rateC: number; incRevenue: number; verdict: Verdict; sentence: string;
}
interface EffectProof {
  ready: boolean;
  global: { pct: number; since: string; lift: Lift } | null;
  campaigns: Array<{ campaignId: string; campaignName: string; sentAt: string; lift: Lift; excluded: { priority: number; global_holdout: number } }>;
  measuring: number;
}

const VERDICT_LABEL: Record<Verdict, string> = { positive: '효과 있음', negative: '효과 낮음', unclear: '차이 뚜렷하지 않음', insufficient: '아직 판단 이름' };
const VERDICT_TONE: Record<Verdict, string> = {
  positive: 'bg-emerald-100 text-emerald-800', negative: 'bg-rose-100 text-rose-800',
  unclear: 'bg-slate-100 text-slate-600', insufficient: 'bg-amber-50 text-amber-700',
};
const won = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(Math.round(n)).toLocaleString()}원`;
const pct = (r: number) => `${(r * 100).toFixed(1)}%`;

export default function EffectProofCard({ days }: { days: number }) {
  const navigate = useNavigate();
  // ★ 2026-11-07 C113 D4 — 대조군 설정은 회사 관리자만 바꾼다(설정 화면 · 서버 저장 문과 같은 판정) · 단추는 관리자에게만
  const isCompanyAdmin = useAuthStore((st) => st.user?.userType === 'company_admin');
  const [data, setData] = useState<EffectProof | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/ai/operator/performance/effect-proof?days=${days}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (alive) setData(ok && j.success ? j : null); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  if (loading) {
    return <div className="rounded-2xl border border-sky-100 bg-sky-50/40 p-4 h-24 animate-pulse" aria-label="효과 증명 불러오는 중" />;
  }
  if (!data || !data.ready) return null;
  const empty = !data.global && data.campaigns.length === 0;

  return (
    <div className="rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-semibold text-slate-600">효과 증명: 대조군과 비교한 늘어난 매출</div>
        {data.measuring > 0 && <span className="text-[11px] text-slate-500">측정 중 발송 {data.measuring.toLocaleString()}건(보낸 지 7일이 지나면 나옵니다)</span>}
      </div>

      {empty ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {isCompanyAdmin ? (
            <>
              <p className="text-[13px] text-slate-600 break-keep">대조군이 있는 발송이 아직 없습니다. 설정에서 대조군을 켜면 다음 광고부터 효과를 잽니다.</p>
              <button type="button" onClick={() => navigate('/settings')}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">대조군 켜러 가기</button>
            </>
          ) : (
            <p className="text-[13px] text-slate-600 break-keep">대조군이 있는 발송이 아직 없습니다. 회사 관리자가 설정에서 대조군을 켜면 다음 광고부터 효과를 잽니다.</p>
          )}
        </div>
      ) : (
        <>
          {data.global && (
            <div className="mt-3 rounded-xl bg-white border border-slate-200 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13px] font-semibold text-slate-800">전체 대조군 {data.global.pct}%</span>
                <span className="text-[11px] text-slate-500">{data.global.since.slice(0, 10)}부터 누적</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT_TONE[data.global.lift.verdict]}`}>{VERDICT_LABEL[data.global.lift.verdict]}</span>
              </div>
              <p className="mt-1.5 text-[13px] text-slate-800 break-keep">{data.global.lift.sentence}</p>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                <Stat label="늘어난 매출(추정)" value={won(data.global.lift.incRevenue)} tone={data.global.lift.incRevenue >= 0 ? 'text-sky-700' : 'text-rose-700'} />
                <Stat label="받는 고객 구매율" value={pct(data.global.lift.rateT)} />
                <Stat label="대조군 구매율" value={pct(data.global.lift.rateC)} />
                <Stat label="대조군" value={`${data.global.lift.control.n.toLocaleString()}명`} />
              </div>
            </div>
          )}

          {data.campaigns.length > 0 && (
            <ul className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
              {data.campaigns.map((c) => (
                <li key={c.campaignId} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-slate-800 truncate max-w-[60%]">{c.campaignName || '이름 없는 발송'}</span>
                    <span className="text-[11px] text-slate-500">{c.sentAt.slice(0, 10)}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${VERDICT_TONE[c.lift.verdict]}`}>{VERDICT_LABEL[c.lift.verdict]}</span>
                    <span className="ml-auto text-[13px] font-semibold tabular-nums text-sky-700">{won(c.lift.incRevenue)}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-slate-600 break-keep">{c.lift.sentence}</p>
                  <div className="mt-1 text-[11px] text-slate-500">
                    대조군 {c.lift.control.n.toLocaleString()}명, 받는 쪽 {c.lift.treated.n.toLocaleString()}명
                    {c.excluded.global_holdout > 0 && `, 전체 대조군으로 뺌 ${c.excluded.global_holdout.toLocaleString()}명`}
                    {c.excluded.priority > 0 && `, 우선순위로 뺌 ${c.excluded.priority.toLocaleString()}명`}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 text-[11px] text-slate-500 break-keep">
            보내기로 한 고객 전부와 보내지 않은 대조군을 비교합니다(발송별은 보낸 뒤 7일, 전체는 시작일부터 누적, 자사몰 결제와 매장 구매). 판단 기준은 각 30명 이상, 유의 수준 5%.
            {' '}문자와 카카오 광고 기준이에요. 이메일과 앱 푸시 광고는 대조군에게도 나가요.
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-2">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-[15px] font-bold tabular-nums ${tone || 'text-slate-900'}`}>{value}</div>
    </div>
  );
}
