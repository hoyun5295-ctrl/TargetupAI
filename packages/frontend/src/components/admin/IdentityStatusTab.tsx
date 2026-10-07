/**
 * IdentityStatusTab — 본인인증 현황 (★ 2026-10-07 · Harold 명시 · ceo 전용 · 읽기만)
 *
 * 계정 담당자 본인인증(한국모바일인증)의 시행 상태 · 명단 계정별 인증 여부 · 인증 이력 · 실패 기록.
 * 전송자격인증 3.4 · 3.5 증빙 캡처 화면이라 이름 · 번호는 서버가 가린 값만 온다(Harold 1007 「가림 적용」).
 * 조회 = 서버(utils/identity-status.ts). 이 화면은 받은 값을 그린다.
 * 노출 게이팅은 부모(AdminDashboard)가 /api/admin/identity-status/access 로 한다 — 기능 관심 업체와 같은 규약.
 * 톤 = 부모 화면(슈퍼관리자 라이트) · 강조색 = 보안 · 인증 묶음색(rose).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type RowStatus = 'verified' | 'pending' | 'lapsed' | 'superseded';

interface StatusData {
  rollout: { enforceFrom: string | null; enforced: boolean; allAccounts: boolean; pilotCount: number; provider: string | null };
  summary: { targetAccounts: number; targetVerified: number; verifiedAccounts: number; changes: number; failures: number };
  pilot: {
    loginId: string; found: boolean; companyName: string; accountName: string; active: boolean;
    verifiedAt: string | null; contactPhone: string | null; phoneMatches: boolean | null;
  }[];
  history: {
    id: string; at: string; companyName: string; loginId: string; accountName: string; purpose: string; status: RowStatus;
    provider: string; verifiedName: string; verifiedPhone: string; requestNo: string; ip: string;
  }[];
  historyTotal: number;
  failures: {
    at: string; companyName: string; loginId: string; purpose: string; result: string; reason: string; detail: string; requestNo: string; ip: string;
  }[];
}

const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem('token')}` });
const fmt = (iso: string) => new Date(iso).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const fmtDay = (raw: string) => {
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
};
const PURPOSE_LABEL: Record<string, string> = { first_login: '첫 로그인', change: '번호 변경' };
const PROVIDER_LABEL: Record<string, string> = { kmc: '한국모바일인증', stub: '시험용' };
const STATUS_CHIP: Record<RowStatus, { label: string; cls: string }> = {
  verified: { label: '인증 완료', cls: 'bg-emerald-50 text-emerald-700' },
  pending: { label: '진행 중', cls: 'bg-sky-50 text-sky-700' },
  lapsed: { label: '중단(시간 지남)', cls: 'bg-gray-100 text-gray-500' },
  superseded: { label: '다시 시작함', cls: 'bg-gray-100 text-gray-500' },
};
/** 실패 결과 — routes/auth.ts 의 identity_verify_fail details(result · reason) */
const failLabel = (result: string, reason: string) => {
  if (result === 'expired') return '시간 지남';
  if (result === 'already_verified') return '이미 인증된 계정';
  if (result === 'unavailable') return '인증기관 연결 없음';
  if (result === 'rejected') return reason === 'invalid_identity' ? '이름 · 번호 확인 안 됨' : '인증기관 거절';
  return result || '알 수 없음';
};

const th = 'text-left font-medium px-3 py-2 whitespace-nowrap';
const td = 'px-3 py-2.5 whitespace-nowrap';

export default function IdentityStatusTab() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 새로고침을 빨리 두 번 눌렀을 때 늦게 온 옛 응답이 새 화면을 덮지 않게
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mySeq = ++seq.current;
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/admin/identity-status', { headers: authHeaders() });
      const d = await r.json();
      if (mySeq !== seq.current) return;
      if (!r.ok || !d?.success) throw new Error(d?.error || '본인인증 현황을 불러오지 못했습니다.');
      setData(d as StatusData);
    } catch (e: any) {
      if (mySeq !== seq.current) return;
      setError(e?.message || '본인인증 현황을 불러오지 못했습니다.');
      setData(null);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const ro = data?.rollout;
  const s = data?.summary;
  const live = !!ro && ro.enforced && !!ro.provider && (ro.allAccounts || ro.pilotCount > 0);
  const stateLabel = !ro ? '-' : !live ? '꺼짐' : ro.allAccounts ? '전 계정 시행 중' : '시범 시행 중';
  const stateNote = !ro ? '' : [
    ro.enforceFrom ? `시행일 ${fmtDay(ro.enforceFrom)}` : '시행일 없음',
    ro.provider ? PROVIDER_LABEL[ro.provider] || ro.provider : '인증기관 연결 없음',
    ro.allAccounts ? '전 계정' : `명단 ${ro.pilotCount}계정`,
  ].join(' · ');

  return (
    <div className="bg-white rounded-2xl border border-gray-200/70 shadow-sm">
      <div className="px-6 py-4 border-b flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">본인인증 현황</h2>
          <p className="text-xs text-gray-500 mt-1">계정 담당자 본인인증(한국모바일인증)의 시행 상태 · 계정별 인증 여부 · 인증 이력 · 실패 기록입니다. 이름과 번호는 가린 값입니다</p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading}
          className="px-3 py-1.5 border rounded-lg text-sm bg-white hover:bg-gray-50 disabled:opacity-40">{loading ? '불러오는 중' : '새로고침'}</button>
      </div>

      {error && <div className="px-6 py-4 text-sm text-rose-600">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-6 py-5">
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">시행 상태</div>
          <div className={`text-xl font-bold tracking-tight mt-1 ${live ? 'text-rose-700' : 'text-gray-400'}`}>{stateLabel}</div>
          <div className="text-[11px] text-gray-500 mt-1 leading-snug">{stateNote}</div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">{ro?.allAccounts ? '사용 중 계정 중 인증 완료' : '명단 중 인증 완료'}</div>
          <div className="text-2xl font-bold tracking-tight text-gray-900 mt-1 tabular-nums">
            {s ? s.targetVerified.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold"> / {s ? s.targetAccounts.toLocaleString() : '-'}명</span>
          </div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">인증 완료 계정(전체)</div>
          <div className="text-2xl font-bold tracking-tight text-emerald-600 mt-1 tabular-nums">{s ? s.verifiedAccounts.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">개</span></div>
          <div className="text-[11px] text-gray-500 mt-1">번호 변경 인증 {s ? s.changes.toLocaleString() : '-'}건</div>
        </div>
        <div className="rounded-xl border border-gray-200/70 p-4">
          <div className="text-xs font-medium text-gray-500">최근 30일 실패</div>
          <div className={`text-2xl font-bold tracking-tight mt-1 tabular-nums ${s && s.failures > 0 ? 'text-rose-600' : 'text-gray-900'}`}>{s ? s.failures.toLocaleString() : '-'}<span className="text-sm text-gray-400 font-semibold">건</span></div>
        </div>
      </div>

      {data && !data.rollout.allAccounts && data.pilot.length > 0 && (
        <div className="px-6 pb-5">
          <div className="rounded-xl border border-gray-200/70 overflow-hidden">
            <div className="px-4 py-3 text-sm font-semibold border-b">시범 명단 계정별 <span className="text-xs text-gray-400 font-normal">· 담당자 번호 = 그 계정의 연락처와 로그인 인증번호를 받는 번호</span></div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500">
                  <tr>
                    <th className={th}>아이디</th><th className={th}>고객사</th><th className={th}>계정 이름</th><th className={th}>본인인증</th>
                    <th className={th}>인증 시각</th><th className={th}>담당자 번호</th><th className={th}>인증 번호와</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pilot.map((p) => (
                    <tr key={p.loginId} className="border-t border-gray-100">
                      <td className={`${td} font-medium`}>{p.loginId}</td>
                      {!p.found ? (
                        <td colSpan={6} className={`${td} text-amber-700 text-xs`}>이 아이디의 계정이 없습니다(명단 값 확인)</td>
                      ) : (
                        <>
                          <td className={td}>{p.companyName || '-'}{!p.active && <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">사용 중지</span>}</td>
                          <td className={td}>{p.accountName || '-'}</td>
                          <td className={td}>
                            {p.verifiedAt
                              ? <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-emerald-50 text-emerald-700">인증 완료</span>
                              : <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-amber-50 text-amber-700">인증 전</span>}
                          </td>
                          <td className={`${td} tabular-nums`}>{p.verifiedAt ? fmt(p.verifiedAt) : '-'}</td>
                          <td className={`${td} tabular-nums`}>{p.contactPhone || '-'}</td>
                          <td className={td}>
                            {p.phoneMatches === null ? <span className="text-gray-400">-</span>
                              : p.phoneMatches ? <span className="text-emerald-700 font-medium">일치</span>
                              : <span className="text-rose-600 font-medium">다름</span>}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="px-6 pb-5">
        <div className="rounded-xl border border-gray-200/70 overflow-hidden">
          <div className="px-4 py-3 text-sm font-semibold border-b">
            인증 이력 <span className="text-xs text-gray-400 font-normal">· 최근 {data ? data.history.length.toLocaleString() : '-'}건 / 전체 {data ? data.historyTotal.toLocaleString() : '-'}건 · 요청번호 = 한국모바일인증 관리 화면 인증내역의 요청번호</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className={th}>시각</th><th className={th}>고객사</th><th className={th}>아이디</th><th className={th}>계정 이름</th><th className={th}>구분</th>
                  <th className={th}>상태</th><th className={th}>인증 이름</th><th className={th}>인증 번호</th><th className={th}>요청번호</th><th className={th}>접속 IP</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data && <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">불러오는 중</td></tr>}
                {data && data.history.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">아직 본인인증 기록이 없습니다</td></tr>}
                {(data?.history || []).map((h) => (
                  <tr key={h.id} className="border-t border-gray-100">
                    <td className={`${td} tabular-nums`}>{fmt(h.at)}</td>
                    <td className={td}>{h.companyName || '-'}</td>
                    <td className={`${td} font-medium`}>{h.loginId || '-'}</td>
                    <td className={td}>{h.accountName || '-'}</td>
                    <td className={td}>{PURPOSE_LABEL[h.purpose] || h.purpose}</td>
                    <td className={td}><span className={`inline-flex px-2 py-0.5 rounded-full text-xs ${STATUS_CHIP[h.status].cls}`}>{STATUS_CHIP[h.status].label}</span></td>
                    <td className={td}>{h.verifiedName || '-'}</td>
                    <td className={`${td} tabular-nums`}>{h.verifiedPhone || '-'}</td>
                    <td className={`${td} font-mono text-[11px] text-gray-600`}>{h.requestNo || '-'}</td>
                    <td className={`${td} tabular-nums text-gray-500`}>{h.ip || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="px-6 pb-5">
        <div className="rounded-xl border border-gray-200/70 overflow-hidden">
          <div className="px-4 py-3 text-sm font-semibold border-b">실패 기록 <span className="text-xs text-gray-400 font-normal">· 최근 30일 · 거절 코드 = 서버가 그 인증을 받지 않은 이유</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className={th}>시각</th><th className={th}>고객사</th><th className={th}>아이디</th><th className={th}>구분</th>
                  <th className={th}>결과</th><th className={th}>거절 코드</th><th className={th}>요청번호</th><th className={th}>접속 IP</th>
                </tr>
              </thead>
              <tbody>
                {data && data.failures.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">최근 30일 실패가 없습니다</td></tr>}
                {(data?.failures || []).map((f, i) => (
                  <tr key={`${f.at}-${i}`} className="border-t border-gray-100">
                    <td className={`${td} tabular-nums`}>{fmt(f.at)}</td>
                    <td className={td}>{f.companyName || '-'}</td>
                    <td className={`${td} font-medium`}>{f.loginId || '-'}</td>
                    <td className={td}>{PURPOSE_LABEL[f.purpose] || f.purpose || '-'}</td>
                    <td className={`${td} text-rose-700`}>{failLabel(f.result, f.reason)}</td>
                    <td className={`${td} font-mono text-[11px] text-gray-600`}>{f.detail || '-'}</td>
                    <td className={`${td} font-mono text-[11px] text-gray-600`}>{f.requestNo || '-'}</td>
                    <td className={`${td} tabular-nums text-gray-500`}>{f.ip || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <p className="px-6 pb-4 text-[10px] italic text-gray-400">Data source: 본인인증 이력 · 실패는 감사 기록(최근 30일) · 시행 상태는 지금 서버 설정 · 이름과 번호는 가린 값</p>
    </div>
  );
}
