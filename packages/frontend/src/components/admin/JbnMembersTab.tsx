/**
 * JbnMembersTab — 슈퍼관리자 「JBN 회원」 (★ 2026-11-18 C144 · Harold · ceo · suran 만 · 설계서 docs/2026-11-18-c144-jbn-special-price-design.md §4-2)
 *
 * JBN 전용 페이지(/jbn) 신청 → 단톡방 닉네임으로 회원 확인 → 한줄로 회사 연결. 목업 = docs/mockups/2026-11-18-jbn-admin-mockup.html.
 *   단계 넷(확인 전 · 회원 확인됨 · 특별가 적용 중 · 회원 아님)은 서버가 셈한다(utils/jbn.ts) · 이 화면은 그리기만.
 *   ⛔ 요금제를 바꾸지 않는다 — 고객사 상세의 요금제 칸에서 JBN 판을 고르면 「특별가 적용 중」으로 넘어온다(돈 규칙 = 회사 수정 경로 한 길).
 *   ⛔ 발송 단가를 넣지 않는다(Harold 1118 「그때그때 직접 · 선불 후불 다름」) · 기본 대화상자 0(지우기 확인 = 창 안의 확인 줄).
 * 노출 게이팅 = 부모(AdminDashboard)가 /api/admin/jbn/access 로 한다.
 * 상세 창 닫기 = X · ESC 만(배경 클릭으로 닫지 않는다 · 자매 = FeatureInterestTab 상세 창).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Search, X } from 'lucide-react';
import { companiesApi } from '../../api/client';
import { formatKstMonthDayTime, formatPhoneNumber } from '../../utils/formatDate';
import { ADMIN_TABLE_ONELINE } from './ui/admin-ui'; // ★ 1020 표 칸 한 줄

type Stage = 'pending' | 'verified' | 'on' | 'rejected';
type Status = 'pending' | 'verified' | 'rejected';

interface AppRow {
  id: string; createdAt: string; companyName: string; ownerName: string; nickname: string; phone: string;
  interestPlanCode: string | null; interestPlanName: string | null; consultMethod: 'phone' | 'visit' | 'video'; memo: string;
  status: Status; statusReason: string | null; statusBy: string | null; statusAt: string | null;
  companyId: string | null; linkedCompanyName: string | null; linkedPlanName: string | null; linkedBy: string | null; linkedAt: string | null;
  stage: Stage;
}
interface CompanyRow { companyId: string; companyName: string; planName: string; price: number; applications: AppRow[] }
interface Overview {
  counts: Record<Stage, number>;
  applications: AppRow[];
  companies: CompanyRow[];
  plans: Array<{ name: string; basePrice: number; price: number; active: boolean; companies: number }>;
  recent: Array<{ at: string; action: string; to: string | null; by: string; companyName: string | null }>;
  truncated: boolean;
}

const STAGES: Array<{ key: Stage; title: string; desc: string }> = [
  { key: 'pending', title: '확인 전', desc: '단톡방에서 닉네임을 찾아 회원인지 볼 신청' },
  { key: 'verified', title: '회원 확인됨', desc: '상담하고 고객사 상세에서 JBN 요금제를 걸 차례' },
  { key: 'on', title: '특별가 적용 중', desc: '지금 요금제가 JBN 판인 회사' },
  { key: 'rejected', title: '회원 아님', desc: '단톡방에서 찾지 못한 신청' },
];
const METHOD: Record<AppRow['consultMethod'], string> = { phone: '전화 상담', visit: '방문 상담', video: '화상 상담' };
const STATUS_TAG: Record<Stage, { label: string; cls: string }> = {
  pending: { label: '확인 전', cls: 'bg-[#FDF1EC] text-[#A8380B]' },
  verified: { label: '회원 확인됨', cls: 'bg-[#E9F5EE] text-[#1F7A4D]' },
  on: { label: '특별가 적용 중', cls: 'bg-gray-900 text-white' },
  rejected: { label: '회원 아님', cls: 'bg-gray-100 text-gray-500' },
};
const RECENT: Record<string, (to: string | null) => string> = {
  jbn_status: (to) => (to === 'verified' ? '회원 확인' : to === 'rejected' ? '회원 아님 처리' : '확인 전으로 되돌림'),
  jbn_link: (to) => (to === 'unlinked' ? '회사 연결 끊음' : '회사 연결'),
  jbn_delete: () => '신청 지움',
  jbn_purge: () => '보관 기한 정리',
};
const won = (n: number) => n.toLocaleString('ko-KR');
const auth = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const JBN_PAGE_URL = 'hanjul.ai/jbn';

/** 서버 쓰기 하나(상한 15초) — 409 면 서버가 준 지금 행을 돌려준다 */
async function write(url: string, method: 'POST' | 'DELETE', body?: unknown): Promise<{ ok: boolean; status: number; error: string; row: AppRow | null }> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch(url, { method, headers: { ...auth(), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    const d = await r.json().catch(() => null);
    return { ok: r.ok && d?.success === true, status: r.status, error: d?.error || '저장하지 못했습니다.', row: d?.row ?? null };
  } catch {
    return { ok: false, status: 0, error: '연결이 끊겼습니다. 다시 눌러 주세요(이미 저장됐으면 지금 상태로 다시 그립니다).', row: null };
  } finally {
    window.clearTimeout(timer);
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1200); }); }}
      className="inline-flex items-center gap-1 h-8 px-2.5 rounded-lg bg-white border border-gray-200 text-[12.5px] font-semibold text-gray-800 hover:bg-gray-50 shrink-0">
      {done ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}{done ? '복사됨' : label}
    </button>
  );
}

export default function JbnMembersTab() {
  const [stage, setStage] = useState<Stage>('pending');
  const [q, setQ] = useState('');
  const [qApplied, setQApplied] = useState('');
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<AppRow | null>(null);
  const turn = useRef(0);

  useEffect(() => { const t = window.setTimeout(() => setQApplied(q.trim()), 300); return () => window.clearTimeout(t); }, [q]);

  const load = useCallback(async () => {
    const my = ++turn.current;
    setLoading(true);
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), 15_000);
    try {
      const r = await fetch(`/api/admin/jbn/overview?stage=${stage}&q=${encodeURIComponent(qApplied)}`, { headers: auth(), signal: ctl.signal });
      const d = await r.json().catch(() => null);
      if (my !== turn.current) return;
      if (!r.ok || !d?.success) { setError(d?.error || 'JBN 회원을 불러오지 못했습니다.'); return; }
      setError('');
      setData(d);
    } catch {
      if (my === turn.current) setError('JBN 회원을 불러오지 못했습니다.');
    } finally {
      window.clearTimeout(timer);
      if (my === turn.current) setLoading(false);
    }
  }, [stage, qApplied]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { turn.current += 1; }, []);

  const counts = data?.counts;
  const s = STAGES.find((x) => x.key === stage)!;
  const listCount = stage === 'on' ? data?.companies.length ?? 0 : data?.applications.length ?? 0;

  return (
    <div className="max-w-[1180px] mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3 mb-4">
        <div>
          <h1 className="text-[22px] font-extrabold tracking-tight text-gray-900">JBN 회원</h1>
          <p className="text-[13.5px] text-gray-500 mt-0.5">JBN 전용 페이지로 들어온 신청, 단톡방 닉네임으로 회원 확인, 한줄로 회사 연결</p>
        </div>
        <label className="relative w-full sm:w-[260px]">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="회사명, 성함, 닉네임, 번호"
            className="w-full h-10 pl-9 pr-3 rounded-[10px] border border-gray-200 bg-white text-[13.5px] focus:outline-none focus:border-gray-900" />
        </label>
      </div>

      <div className="grid grid-cols-1 min-[561px]:grid-cols-2 lg:grid-cols-4 gap-3">
        {STAGES.map((x) => {
          const n = counts?.[x.key];
          const on = stage === x.key;
          return (
            <button key={x.key} type="button" aria-pressed={on} onClick={() => setStage(x.key)}
              className={`text-left bg-white rounded-[14px] shadow-sm px-[18px] pt-4 pb-3.5 border-2 ${on ? 'border-gray-900' : 'border-transparent'}`}>
              <h2 className="text-[14px] font-bold text-gray-500">{x.title}</h2>
              <p className={`text-[30px] font-extrabold leading-tight tracking-tight tabular-nums ${x.key === 'pending' && (n ?? 0) > 0 ? 'text-[#A8380B]' : 'text-gray-900'}`}>
                {n === undefined ? '?' : n}<small className="text-[14px] font-semibold text-gray-500 ml-0.5">곳</small>
              </p>
              <p className="text-[12.5px] text-gray-500 mt-1.5 leading-snug break-keep">{x.desc}</p>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_330px] gap-4 mt-4 items-start">
        <section className="bg-white rounded-[14px] shadow-sm overflow-hidden">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-[18px] pt-[15px] pb-[13px] border-b border-gray-200">
            <b className="text-[16px] font-extrabold">{s.title}</b>
            <span className="text-[13px] text-gray-500">{loading ? '불러오는 중' : `${listCount}곳, 새 신청이 위`}</span>
          </div>
          {error && <p className="px-[18px] py-3 text-[13.5px] font-semibold text-red-600">{error}</p>}
          {data?.truncated && <p className="px-[18px] py-2 text-[12.5px] text-[#A8380B] bg-[#FDF1EC]">신청이 2,000건을 넘어 오래된 신청은 이 목록에 빠져 있습니다.</p>}
          {stage !== 'on' && (data?.applications ?? []).map((r) => (
            <button key={r.id} type="button" onClick={() => setOpen(r)}
              className="w-full text-left grid grid-cols-1 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)_128px] gap-x-[18px] gap-y-1 px-[18px] py-3.5 border-t border-gray-100 first:border-t-0 hover:bg-[#FAFAF8]">
              <div className="min-w-0">
                <p className="text-[15px] font-bold leading-snug break-keep">{r.companyName}</p>
                <p className="text-[13px] text-gray-500">{r.ownerName} 대표<br /><span className="tabular-nums">{formatPhoneNumber(r.phone)}</span></p>
              </div>
              <div className="min-w-0 space-y-1">
                <p><span className="inline-flex items-center gap-1.5 bg-[#F1F1EE] rounded-lg px-2.5 py-0.5 text-[14px] font-bold break-all"><small className="text-[11.5px] text-gray-500">닉네임</small>{r.nickname}</span></p>
                <p className="text-[13px] text-gray-500 break-keep">
                  관심 {r.interestPlanName ?? r.interestPlanCode ?? '아직 모름'}, {METHOD[r.consultMethod]}
                  {r.status === 'verified' && r.statusAt ? `, 확인 ${formatKstMonthDayTime(r.statusAt)} ${r.statusBy ?? ''}` : ''}
                  {r.status === 'verified' && r.linkedCompanyName ? `, 연결 ${r.linkedCompanyName}(${r.linkedPlanName ?? '요금제 없음'})` : ''}
                  {r.status === 'rejected' && r.statusReason ? `, ${r.statusReason}` : ''}
                </p>
                {r.memo && r.status === 'pending' && <p className="text-[13px] text-gray-500 break-keep line-clamp-2">「{r.memo}」</p>}
              </div>
              <div className="md:text-right text-[13px] text-gray-500">
                <span className="tabular-nums">{formatKstMonthDayTime(r.createdAt)}</span><br />
                <span className={`inline-block mt-1 text-[12px] font-bold px-2 py-0.5 rounded-full ${STATUS_TAG[r.stage].cls}`}>{STATUS_TAG[r.stage].label}</span>
              </div>
            </button>
          ))}
          {/* 적용 중 = 회사 한 줄 · 그 회사에 연결된 신청은 전부 단추로(여러 건이면 하나씩 열어 지울 수 있다 · Codex 구현 1R) */}
          {stage === 'on' && (data?.companies ?? []).map((c) => (
            <div key={c.companyId} className="grid grid-cols-1 md:grid-cols-[minmax(0,200px)_minmax(0,1fr)_128px] gap-x-[18px] gap-y-1 px-[18px] py-3.5 border-t border-gray-100 first:border-t-0">
              <div className="min-w-0">
                <p className="text-[15px] font-bold leading-snug break-keep">{c.companyName}</p>
                <p className="text-[13px] text-gray-500">{c.planName}, 월 {won(c.price)}원</p>
              </div>
              <div className="min-w-0 text-[13px] text-gray-500 break-keep flex flex-col items-start gap-1.5">
                {c.applications.length === 0 && '이 페이지로 들어온 신청이 연결돼 있지 않습니다'}
                {c.applications.map((a) => (
                  <button key={a.id} type="button" onClick={() => setOpen(a)}
                    className="max-w-full inline-flex flex-wrap items-baseline gap-x-1.5 bg-[#F1F1EE] hover:bg-gray-200 rounded-lg px-2.5 py-1 text-[14px] font-bold text-gray-900 text-left">
                    <small className="text-[11.5px] text-gray-500 whitespace-nowrap">닉네임</small>
                    <span className="break-all">{a.nickname}</span>
                    <small className="text-[11.5px] font-semibold text-gray-500 tabular-nums whitespace-nowrap">{formatKstMonthDayTime(a.createdAt)} 신청</small>
                  </button>
                ))}
              </div>
              <div className="md:text-right"><span className={`inline-block text-[12px] font-bold px-2 py-0.5 rounded-full ${STATUS_TAG.on.cls}`}>{STATUS_TAG.on.label}</span></div>
            </div>
          ))}
          {data && !loading && listCount === 0 && (
            <p className="px-[18px] py-9 text-center text-[14px] text-gray-500">{qApplied ? '찾는 신청이 없습니다.' : '이 단계에 있는 신청이 없습니다.'}</p>
          )}
        </section>

        <aside className="grid gap-3">
          <div className="bg-white rounded-[14px] shadow-sm px-[18px] py-4">
            <h2 className="text-[14px] font-extrabold mb-2 flex justify-between items-baseline gap-2">전용 페이지 주소<span className="text-[12.5px] text-gray-500 font-semibold">단톡방에 붙이는 주소</span></h2>
            <div className="flex items-center gap-2 bg-[#F1F1EE] rounded-[10px] py-2 pl-3 pr-2 text-[13.5px] font-bold">
              <span className="flex-1 min-w-0 truncate">{JBN_PAGE_URL}</span><CopyButton text={`https://${JBN_PAGE_URL}`} label="복사" />
            </div>
            <p className="text-[12.5px] text-gray-500 mt-2">검색에 걸리지 않게 했고, 다른 화면 어디에도 걸지 않습니다.</p>
          </div>
          <div className="bg-white rounded-[14px] shadow-sm px-[18px] py-4">
            <h2 className="text-[14px] font-extrabold mb-2 flex justify-between items-baseline gap-2">JBN 요금제<span className="text-[12.5px] text-gray-500 font-semibold">월, VAT 별도</span></h2>
            {data && data.plans.length === 0 && <p className="text-[13px] text-gray-500">JBN 요금제가 아직 없습니다(배포 원장 C144-DML-1).</p>}
            <div className="overflow-x-auto">
            <table className={`w-full text-[13px] tabular-nums ${ADMIN_TABLE_ONELINE}`}>
              <tbody>
                {(data?.plans ?? []).map((p) => (
                  <tr key={p.name} className="border-t border-gray-100 first:border-t-0">
                    <td className="py-1.5">{p.name}{!p.active && <span className="text-gray-400"> (꺼짐)</span>}</td>
                    <td className="py-1.5 text-right whitespace-nowrap"><s className="block text-[12px] text-gray-400 leading-tight">{won(p.basePrice)}</s><b className="font-extrabold">{won(p.price)}</b></td>
                    <td className="py-1.5 text-right whitespace-nowrap">{p.companies}곳</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <p className="text-[12.5px] text-gray-500 mt-2">가격을 바꾸려면 요금제 관리에서 JBN 요금제 줄을 고칩니다.</p>
          </div>
          <div className="bg-white rounded-[14px] shadow-sm px-[18px] py-4">
            <h2 className="text-[14px] font-extrabold mb-1 flex justify-between items-baseline gap-2">최근 처리<span className="text-[12.5px] text-gray-500 font-semibold">누가, 언제</span></h2>
            {(data?.recent ?? []).length === 0 && <p className="text-[13px] text-gray-500 py-1">아직 처리한 신청이 없습니다.</p>}
            {(data?.recent ?? []).map((l, i) => (
              <div key={`${l.at}-${i}`} className="grid grid-cols-[86px_minmax(0,1fr)] gap-2.5 py-2 text-[13px] border-t border-gray-100 first:border-t-0">
                <time className="text-gray-500 tabular-nums">{formatKstMonthDayTime(l.at)}</time>
                <span className="break-keep">{l.companyName ? `${l.companyName} ` : ''}{(RECENT[l.action] ?? (() => l.action))(l.to)} <span className="text-gray-500">{l.by}</span></span>
              </div>
            ))}
          </div>
        </aside>
      </div>

      {open && <DetailModal row={open} onClose={() => setOpen(null)} onChanged={(row) => { setOpen(row); void load(); }} onDeleted={() => { setOpen(null); void load(); }} />}
    </div>
  );
}

function DetailModal({ row, onClose, onChanged, onDeleted }: {
  row: AppRow; onClose: () => void; onChanged: (row: AppRow) => void; onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [reason, setReason] = useState('');
  const [askReject, setAskReject] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [search, setSearch] = useState('');
  const [found, setFound] = useState<Array<{ id: string; company_name: string; plan_name: string | null }>>([]);
  const searchTurn = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.isComposing && !busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  useEffect(() => {
    const t = search.trim();
    const my = ++searchTurn.current;
    if (t.length < 2) { setFound([]); return; }
    const timer = window.setTimeout(async () => {
      try {
        const r = await companiesApi.list({ search: t, limit: 10 });
        if (my === searchTurn.current) setFound((r.data?.companies ?? []).map((c: any) => ({ id: String(c.id), company_name: String(c.company_name || ''), plan_name: c.plan_name ?? null })));
      } catch {
        if (my === searchTurn.current) setFound([]);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  /** 쓰기 하나 — 성공 = 서버가 준 행으로 다시 그림 · 409 = 서버가 준 지금 행 + 그 까닭 */
  const run = async (url: string, method: 'POST' | 'DELETE', body?: unknown) => {
    if (busy) return;
    setBusy(true);
    setMsg('');
    const out = await write(url, method, body);
    setBusy(false);
    if (method === 'DELETE') {
      if (out.ok) { onDeleted(); return; }
      setMsg(out.error);
      return;
    }
    if (out.row) onChanged(out.row);
    if (!out.ok) setMsg(out.error);
    setAskReject(false);
    setReason('');
  };
  const status = (to: Status, extra: Record<string, unknown> = {}) =>
    run(`/api/admin/jbn/applications/${row.id}/status`, 'POST', { from: row.status, to, ...extra });
  const link = (companyId: string | null) =>
    run(`/api/admin/jbn/applications/${row.id}/link`, 'POST', { companyId, expectedCompanyId: row.companyId });

  const verified = row.status === 'verified';
  return (
    <div className="fixed inset-0 z-[70] bg-gray-900/45 flex items-start justify-center p-4 sm:pt-12 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[640px] max-w-[calc(100vw-2rem)]" role="dialog" aria-modal="true" aria-labelledby="jbn-md-title">
        <div className="flex items-start gap-3 px-[22px] pt-5 pb-4 border-b border-gray-200">
          <div className="flex-1 min-w-0">
            <h2 id="jbn-md-title" className="text-[19px] font-extrabold tracking-tight break-keep">{row.companyName}</h2>
            <p className="text-[13px] text-gray-500 mt-0.5">{formatKstMonthDayTime(row.createdAt)} 신청, JBN 전용 페이지</p>
          </div>
          <span className={`text-[12px] font-bold px-2 py-0.5 rounded-full mt-1 shrink-0 ${STATUS_TAG[row.stage].cls}`}>{STATUS_TAG[row.stage].label}</span>
          <button type="button" onClick={onClose} disabled={busy} aria-label="닫기" className="w-[34px] h-[34px] rounded-[9px] grid place-items-center text-gray-500 hover:bg-gray-100 shrink-0"><X className="w-[18px] h-[18px]" /></button>
        </div>
        <div className="px-[22px] pb-[22px]">
          <dl className="grid grid-cols-1 sm:grid-cols-[110px_minmax(0,1fr)] gap-x-4 gap-y-1 py-3.5 text-[14px]">
            <dt className="text-[13px] text-gray-500">대표자</dt><dd className="font-semibold mb-1.5 sm:mb-0">{row.ownerName}</dd>
            <dt className="text-[13px] text-gray-500">휴대폰</dt><dd className="font-semibold tabular-nums mb-1.5 sm:mb-0">{formatPhoneNumber(row.phone)}</dd>
            <dt className="text-[13px] text-gray-500">관심 요금제</dt><dd className="font-semibold mb-1.5 sm:mb-0">{row.interestPlanName ?? row.interestPlanCode ?? '아직 모름'}</dd>
            <dt className="text-[13px] text-gray-500">상담 방식</dt><dd className="font-semibold mb-1.5 sm:mb-0">{METHOD[row.consultMethod]}</dd>
            {row.memo && (<><dt className="text-[13px] text-gray-500">궁금한 점</dt><dd className="leading-relaxed break-keep">{row.memo}</dd></>)}
          </dl>

          <section className="border-t border-gray-200 pt-4">
            <h3 className="text-[15px] font-extrabold flex items-center gap-2">
              <i className={`not-italic w-[22px] h-[22px] rounded-full text-white text-[12px] grid place-items-center ${row.status === 'verified' ? 'bg-[#1F7A4D]' : 'bg-gray-900'}`}>1</i>JBN 회원 확인
            </h3>
            <p className="text-[13px] text-gray-500 mt-1.5 leading-relaxed break-keep">JBN 단톡방에서 아래 닉네임을 찾아 주세요. 대표자 성함, 회사명과 맞는지도 함께 봅니다.</p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2.5 bg-[#F1F1EE] rounded-xl px-3.5 py-3">
              <b className="flex-1 min-w-0 text-[18px] font-extrabold break-all">{row.nickname}</b>
              <CopyButton text={row.nickname} label="닉네임 복사" />
            </div>
            {row.status === 'pending' && !askReject && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                <button type="button" disabled={busy} onClick={() => void status('verified')} className="h-11 rounded-[11px] bg-gray-900 text-white text-[14px] font-bold inline-flex items-center justify-center gap-1.5 disabled:opacity-60"><Check className="w-4 h-4" />JBN 회원 맞음</button>
                <button type="button" disabled={busy} onClick={() => setAskReject(true)} className="h-11 rounded-[11px] bg-white border border-gray-300 text-[14px] font-bold disabled:opacity-60">단톡방에 없음</button>
              </div>
            )}
            {row.status === 'pending' && askReject && (
              <div className="mt-3 space-y-2">
                <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="까닭(선택) 예) 같은 닉네임이 없음, 전화로 다시 확인하기로"
                  className="w-full h-[42px] px-3 rounded-[10px] border border-gray-300 text-[14px] focus:outline-none focus:border-gray-900" />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button type="button" disabled={busy} onClick={() => void status('rejected', { reason })} className="h-11 rounded-[11px] bg-gray-900 text-white text-[14px] font-bold disabled:opacity-60">회원 아님으로 두기</button>
                  <button type="button" disabled={busy} onClick={() => { setAskReject(false); setReason(''); }} className="h-11 rounded-[11px] bg-white border border-gray-300 text-[14px] font-bold">취소</button>
                </div>
              </div>
            )}
            {row.status === 'verified' && (
              <p className="mt-2.5 text-[13.5px] font-bold text-[#1F7A4D] flex flex-wrap items-center gap-1.5">
                <Check className="w-4 h-4" />JBN 회원 확인 {row.statusAt ? formatKstMonthDayTime(row.statusAt) : ''} {row.statusBy ?? ''}
                {!row.companyId && <button type="button" disabled={busy} onClick={() => void status('pending')} className="ml-1 h-7 px-2 rounded-lg border border-gray-200 bg-white text-[12px] font-semibold text-gray-700">확인 전으로 되돌리기</button>}
              </p>
            )}
            {row.status === 'rejected' && (
              <p className="mt-2.5 text-[13.5px] font-bold text-[#9A3412] flex flex-wrap items-center gap-1.5">
                회원 아님 {row.statusAt ? formatKstMonthDayTime(row.statusAt) : ''} {row.statusBy ?? ''}{row.statusReason ? `, ${row.statusReason}` : ''}
                <button type="button" disabled={busy} onClick={() => void status('pending')} className="ml-1 h-7 px-2 rounded-lg border border-gray-200 bg-white text-[12px] font-semibold text-gray-700">확인 전으로 되돌리기</button>
              </p>
            )}
          </section>

          <section className={`border-t border-gray-200 pt-4 mt-[18px] ${verified ? '' : 'opacity-45 pointer-events-none'}`} aria-disabled={!verified}>
            <h3 className="text-[15px] font-extrabold flex items-center gap-2">
              <i className={`not-italic w-[22px] h-[22px] rounded-full text-white text-[12px] grid place-items-center ${row.stage === 'on' ? 'bg-[#1F7A4D]' : 'bg-gray-900'}`}>2</i>한줄로 회사 연결
            </h3>
            <p className="text-[13px] text-gray-500 mt-1.5 leading-relaxed break-keep">상담을 마친 뒤 이 신청을 한줄로 회사에 연결합니다. 특별가는 고객사 상세의 요금제 칸에서 JBN 요금제를 골라 겁니다. 발송 단가는 단가 설정에서 선불, 후불에 맞춰 따로 넣습니다.</p>
            {row.companyId ? (
              <div className="mt-3 rounded-xl border border-gray-200 px-3.5 py-3 text-[14px]">
                <p className="font-bold break-keep">{row.linkedCompanyName ?? '연결된 회사'}<span className="font-semibold text-gray-500">, 지금 요금제 {row.linkedPlanName ?? '없음'}</span></p>
                <p className={`text-[13px] mt-1 ${row.stage === 'on' ? 'text-[#1F7A4D] font-bold' : 'text-[#A8380B] font-semibold'}`}>
                  {row.stage === 'on' ? '특별가 적용 중입니다.' : '아직 JBN 요금제가 아닙니다. 고객사 상세에서 요금제를 JBN 판으로 바꾸면 특별가 적용 중으로 넘어옵니다.'}
                </p>
                <p className="text-[12.5px] text-gray-500 mt-1">연결 {row.linkedAt ? formatKstMonthDayTime(row.linkedAt) : ''} {row.linkedBy ?? ''}</p>
                <button type="button" disabled={busy} onClick={() => void link(null)} className="mt-2 h-8 px-2.5 rounded-lg border border-gray-200 bg-white text-[12.5px] font-semibold text-gray-700">연결 끊기</button>
              </div>
            ) : (
              <div className="mt-3">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="회사명으로 찾기(두 글자 이상)"
                  className="w-full h-[42px] px-3 rounded-[10px] border border-gray-300 text-[14px] focus:outline-none focus:border-gray-900" />
                {found.length > 0 && (
                  <ul className="mt-2 border border-gray-200 rounded-xl overflow-hidden">
                    {found.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 px-3 py-2 border-t border-gray-100 first:border-t-0 text-[13.5px]">
                        <span className="flex-1 min-w-0 break-keep"><b className="font-bold">{c.company_name}</b><span className="text-gray-500">, {c.plan_name ?? '요금제 없음'}</span></span>
                        <button type="button" disabled={busy} onClick={() => void link(c.id)} className="h-8 px-2.5 rounded-lg bg-gray-900 text-white text-[12.5px] font-bold shrink-0">이 회사로 연결</button>
                      </li>
                    ))}
                  </ul>
                )}
                {search.trim().length >= 2 && found.length === 0 && <p className="text-[12.5px] text-gray-500 mt-2">찾는 회사가 없으면 고객사 관리에서 회사를 먼저 등록합니다.</p>}
              </div>
            )}
          </section>

          {msg && <p className="mt-4 text-[13.5px] font-semibold text-red-600 break-keep" role="alert">{msg}</p>}

          <div className="border-t border-gray-200 mt-5 pt-4">
            {!askDelete ? (
              <button type="button" disabled={busy} onClick={() => setAskDelete(true)} className="text-[13px] font-semibold text-gray-500 underline underline-offset-2">신청 지우기(본인 요청 등)</button>
            ) : (
              <div className="rounded-xl bg-[#FDF1EC] px-3.5 py-3">
                <p className="text-[13.5px] font-bold text-[#A8380B] break-keep">이 신청의 회사명, 성함, 닉네임, 번호를 지웁니다. 되돌릴 수 없습니다.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2.5">
                  <button type="button" disabled={busy} onClick={() => void run(`/api/admin/jbn/applications/${row.id}`, 'DELETE')} className="h-10 rounded-[10px] bg-[#A8380B] text-white text-[13.5px] font-bold disabled:opacity-60">지우기</button>
                  <button type="button" disabled={busy} onClick={() => setAskDelete(false)} className="h-10 rounded-[10px] bg-white border border-gray-300 text-[13.5px] font-bold">취소</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
