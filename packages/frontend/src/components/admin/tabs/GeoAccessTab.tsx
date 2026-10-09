/**
 * GeoAccessTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { formatDateTime, kstTodayStr, formatDate } from '../../../utils/formatDate';
import ListPager, { pageSlice } from '../../shared/ListPager';

export interface GeoAccessTabProps {
  geoBusy: boolean;
  geoExPage: number;
  geoExceptions: any[];
  geoForm: { scope: string; target: string; cidr: string; reason: string; expiresAt: string; };
  geoHits: any[];
  geoHitsDenied: boolean;
  geoHitsPage: number;
  geoHitsTotal: number;
  geoStatus: any;
  loadGeoAccess: () => Promise<void>;
  loadGeoHits: (page: number) => Promise<void>;
  setGeoBusy: Dispatch<SetStateAction<boolean>>;
  setGeoExPage: Dispatch<SetStateAction<number>>;
  setGeoForm: Dispatch<SetStateAction<{ scope: string; target: string; cidr: string; reason: string; expiresAt: string; }>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
}

export default function GeoAccessTab(props: GeoAccessTabProps) {
  const { geoBusy, geoExPage, geoExceptions, geoForm, geoHits, geoHitsDenied, geoHitsPage, geoHitsTotal, geoStatus, loadGeoAccess, loadGeoHits, setGeoBusy, setGeoExPage, setGeoForm, showAlert } = props;

  const geoPost = async (url: string, body: any, method: string = 'POST') => {
    const token = localStorage.getItem('token');
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({} as any));
    return { ok: res.ok, data };
  };

  const handleGeoExceptionCreate = async () => {
    setGeoBusy(true);
    try {
      const payload: any = { scope: geoForm.scope, cidr: geoForm.cidr.trim(), reason: geoForm.reason.trim() };
      if (geoForm.scope === 'user') payload.userId = geoForm.target.trim();
      else if (geoForm.scope !== 'global') payload.companyId = geoForm.target.trim();
      if (geoForm.expiresAt) payload.expiresAt = geoForm.expiresAt;
      const { ok, data } = await geoPost('/api/admin/geo/exceptions', payload);
      if (!ok) { showAlert('오류', data?.error || '예외 등록에 실패했습니다.', 'error'); return; }
      setGeoForm({ scope: 'user', target: '', cidr: '', reason: '', expiresAt: '' });
      await loadGeoAccess();
      showAlert('성공', '예외가 승인되었습니다. 승인자 · 사유 · 허용 기간이 이력에 남습니다.', 'success');
    } finally { setGeoBusy(false); }
  };

  const handleGeoExceptionRevoke = async (id: string) => {
    const { ok, data } = await geoPost(`/api/admin/geo/exceptions/${id}`, {}, 'DELETE');
    if (!ok) { showAlert('오류', data?.error || '회수에 실패했습니다.', 'error'); return; }
    await loadGeoAccess();
  };
  return (
    <>
    {(
          <div className="space-y-6">
            {/* ★0827 차단 정책 선언 — 심사(2.2)는 "국외 IP 대역을 차단하는 정책"이 화면에서 읽히는지를 본다.
                판정 로직은 무변경이다. 허용 대역은 그 차단 정책의 예외 목록이지 정책 자체가 아니다. */}
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-white">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="text-[11px] font-semibold tracking-wide text-gray-400">접근제어 정책</div>
                  <h3 className="mt-1 text-base font-bold">국외 IP 대역 전면 차단</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-300">
                    기본 정책은 <span className="font-semibold text-white">차단</span>입니다.
                    아래 허용 대역(화이트리스트)에 드는 IP와 관리자가 수동 승인한 예외만 통과하고,
                    그 밖의 모든 국외 IP는 로그인·세션 발급 단계에서 차단됩니다.
                  </p>
                </div>
                {/* ★0827 시행 상태 3단 — 「시행일이 안 잡힘」과 「시행일이 잡혔는데 아직 안 옴」은 다른 상태다.
                    둘을 똑같이 '미시행'으로 그리면 시행일을 정해 둔 통제가 통제 없음으로 읽힌다. */}
                {(() => {
                  const enforced = geoStatus?.enforced === true;
                  const rawFrom = String(geoStatus?.enforceFrom || '').trim();
                  const fromDate = rawFrom ? new Date(rawFrom) : null;
                  const validFrom = fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null;
                  const fromText = validFrom
                    ? `${validFrom.getFullYear()}년 ${validFrom.getMonth() + 1}월 ${validFrom.getDate()}일`
                    : rawFrom;
                  const scheduled = !enforced && !!validFrom;
                  const tone = enforced
                    ? 'bg-rose-500/20 border border-rose-400/40'
                    : scheduled
                      ? 'bg-amber-500/15 border border-amber-400/40'
                      : 'bg-gray-800 border border-gray-700';
                  const titleTone = enforced ? 'text-rose-300' : scheduled ? 'text-amber-200' : 'text-gray-400';
                  return (
                    <div className={`shrink-0 rounded-lg px-4 py-2.5 text-center ${tone}`}>
                      <div className="text-[10px] text-gray-400">정책 시행</div>
                      <div className={`text-base font-bold ${titleTone}`}>
                        {enforced ? '시행 중' : scheduled ? '시행 예정' : '시행일 미지정'}
                      </div>
                      <div className="mt-0.5 text-[10px] text-gray-500">
                        {enforced ? `${fromText}부터` : scheduled ? `${fromText}부터 차단` : '탐지·기록만'}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="text-xs text-gray-500">차단 예외 · 허용 대역</div>
                <div className="mt-1.5 text-2xl font-bold text-gray-900 tabular-nums">
                  {Number(geoStatus?.cidrCount || 0).toLocaleString()}<span className="ml-1 text-sm font-semibold text-gray-400">개</span>
                </div>
                <div className="mt-1 text-[11px] text-gray-400">
                  {geoStatus?.cidrUpdatedAt ? `갱신 ${formatDateTime(geoStatus.cidrUpdatedAt)}` : '아직 등록되지 않았습니다'}
                </div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="text-xs text-gray-500">차단 예외 · 수동 승인</div>
                <div className="mt-1.5 text-2xl font-bold text-gray-900 tabular-nums">
                  {Number(geoStatus?.exceptionCount || 0).toLocaleString()}<span className="ml-1 text-sm font-semibold text-gray-400">건</span>
                </div>
                <div className="mt-1 text-[11px] text-gray-400">해외 근무자 · 해외 본사 서버</div>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <div className="text-xs text-gray-500">차단 시 이용자 안내</div>
                <div className="mt-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] leading-relaxed text-rose-800">
                  {geoStatus?.blockNotice || '차단 안내 문구를 불러오지 못했습니다'}
                </div>
                <div className="mt-1 text-[10px] text-gray-400 italic">Data source: 서버 차단 응답 문구</div>
              </div>
            </div>

            {/* ★ 2026-10-07 「국내 대역 일괄 등록」 카드 삭제(Harold) — 한국 IP 기준표는 직원이 바꾸는 값이 아니다(1007 IP 하나로 덮여 국내 로그인 전부 차단). 갱신 = 서버 명령 · OPS §2-2-F */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-base font-semibold text-gray-900">관리자 수동 승인 (예외 IP 허용)</h3>
              <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                차단 정책에서 개별로 빼줄 대상을 등록합니다. <span className="font-medium">사유 없이는 등록되지 않습니다</span>. 이 기록이 심사에 내는 예외 승인 대장입니다.
                <br />
                SDK·싱크에이전트는 국가로 막지 않습니다. 해외 본사를 둔 고객사는 <span className="font-medium">회사 API · 회사 에이전트</span> 범위로 그 대역을 등록해주세요.
              </p>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-5 gap-2">
                <select
                  value={geoForm.scope}
                  onChange={(e) => setGeoForm({ ...geoForm, scope: e.target.value })}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] outline-none focus:border-emerald-500"
                >
                  <option value="user">계정 (해외 근무 담당자)</option>
                  <option value="company_api">회사 API (SDK·자사몰)</option>
                  <option value="company_agent">회사 에이전트 (사내 서버)</option>
                  <option value="global">전역</option>
                </select>
                <input
                  value={geoForm.target}
                  onChange={(e) => setGeoForm({ ...geoForm, target: e.target.value })}
                  placeholder={geoForm.scope === 'user' ? '대상 계정 아이디 또는 UUID' : geoForm.scope === 'global' ? '전역 (비워둠)' : '대상 고객사 이름 또는 UUID'}
                  disabled={geoForm.scope === 'global'}
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] outline-none focus:border-emerald-500 disabled:bg-gray-50"
                />
                <input
                  value={geoForm.cidr}
                  onChange={(e) => setGeoForm({ ...geoForm, cidr: e.target.value })}
                  placeholder="203.0.113.0/24 (단일 IP는 /32)"
                  className="px-3 py-1.5 border border-gray-200 rounded-lg font-mono text-xs outline-none focus:border-emerald-500"
                />
                <input
                  value={geoForm.reason}
                  onChange={(e) => setGeoForm({ ...geoForm, reason: e.target.value })}
                  placeholder="승인 사유 (필수)"
                  className="px-3 py-1.5 border border-gray-200 rounded-lg text-[13px] outline-none focus:border-emerald-500"
                />
                {/* ★ 2026-10-02 허용 만료일 — 비우면 기한 없음. 그 날짜 끝까지 유효하다 */}
                <label className="flex items-center gap-2 px-3 py-2 border border-gray-200 rounded-lg text-[13px] focus-within:border-indigo-500">
                  <span className="shrink-0 text-xs text-gray-500">허용 만료일</span>
                  <input
                    type="date"
                    value={geoForm.expiresAt}
                    min={kstTodayStr()}
                    onChange={(e) => setGeoForm({ ...geoForm, expiresAt: e.target.value })}
                    className="min-w-0 flex-1 bg-transparent text-xs text-gray-700 outline-none"
                  />
                </label>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-400">허용 만료일을 비우면 기한 없이 유지됩니다. 넣으면 그 날짜가 지난 뒤 자동으로 통과가 끊깁니다.</p>
              <div className="mt-2 flex justify-end">
                <button
                  onClick={handleGeoExceptionCreate}
                  disabled={geoBusy || !geoForm.cidr.trim() || !geoForm.reason.trim()}
                  className="whitespace-nowrap px-4 py-2 rounded-lg bg-emerald-600 text-white text-[13px] font-semibold hover:bg-emerald-700 disabled:opacity-40"
                >
                  예외 승인
                </button>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="whitespace-nowrap px-3 py-2 text-left">범위</th>
                      <th className="whitespace-nowrap px-3 py-2 text-left">대상</th>
                      <th className="whitespace-nowrap px-3 py-2 text-left">대역</th>
                      <th className="whitespace-nowrap px-3 py-2 text-left">사유</th>
                      <th className="whitespace-nowrap px-3 py-2 text-left">승인자</th>
                      <th className="whitespace-nowrap px-3 py-2 text-left">승인 일시</th>
                      <th className="whitespace-nowrap px-3 py-2 text-left">허용 기간</th>
                      <th className="whitespace-nowrap px-3 py-2 text-right">회수</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {geoExceptions.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-400 text-xs">등록된 예외가 없습니다.</td></tr>
                    )}
                    {pageSlice(geoExceptions, geoExPage).map((x) => (
                      <tr key={x.id} className={x.is_active && !x.is_expired ? '' : 'opacity-45'}>
                        <td className="px-3 py-2 text-xs text-gray-700">
                          {x.scope === 'user' ? '계정' : x.scope === 'company_api' ? '회사 API' : x.scope === 'company_agent' ? '회사 에이전트' : '전역'}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-900">{x.login_id || x.company_name || '-'}</td>
                        <td className="px-3 py-2 font-mono text-xs text-gray-700">{x.cidr}</td>
                        <td className="px-3 py-2 text-xs text-gray-600 max-w-xs truncate">{x.reason}</td>
                        <td className="px-3 py-2 text-xs text-gray-900 whitespace-nowrap">{x.approver_name || x.approver_login_id || '-'}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-400 whitespace-nowrap">{formatDateTime(x.approved_at)}</td>
                        <td className="px-3 py-2 text-xs text-gray-700 whitespace-nowrap">
                          {formatDate(x.approved_at)} ~ {x.expires_at ? formatDate(x.expires_at) : '기한 없음'}
                          {x.is_expired && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-gray-100 text-[10px] text-gray-500">만료</span>}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {x.is_active ? (
                            <button
                              onClick={() => handleGeoExceptionRevoke(x.id)}
                              className="whitespace-nowrap px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              회수
                            </button>
                          ) : (
                            <span className="text-[11px] text-gray-400">회수됨</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListPager page={geoExPage} total={geoExceptions.length} onPage={setGeoExPage} />
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100">
                <h3 className="text-base font-semibold text-gray-900">국외 IP 탐지 · 차단 결과 로그</h3>
                <p className="text-[10px] text-gray-500 mt-0.5 italic">Data source: 감사 로그 (foreign_access_detected · foreign_access_blocked)</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2 text-left">시각</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">계정</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">고객사</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">IP</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left">처리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {geoHits.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-xs">
                        {geoHitsDenied ? '접근 이력은 허용된 계정에서만 볼 수 있습니다.' : '국외 접근 기록이 없습니다.'}
                      </td></tr>
                    )}
                    {geoHits.map((h) => (
                      <tr key={h.id}>
                        <td className="px-4 py-2 text-xs text-gray-500">{formatDateTime(h.created_at)}</td>
                        <td className="px-4 py-2 text-xs text-gray-900">{h.login_id || '-'}</td>
                        <td className="px-4 py-2 text-xs text-gray-700">{h.company_name || '-'}</td>
                        <td className="px-4 py-2 font-mono text-xs text-gray-700">{h.ip_address || '-'}</td>
                        <td className="px-4 py-2">
                          {/* ★1005 전송자격인증 2.2 — 시행 뒤 예외 승인으로 통과한 감지(details.exempted)를 「기록만」으로 그리면 사실과 다르다 */}
                          <span className={`px-2 py-0.5 text-[11px] rounded ${h.action === 'foreign_access_blocked' ? 'bg-rose-100 text-rose-700' : h.details?.exempted === true ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                            {h.action === 'foreign_access_blocked' ? '차단' : h.details?.exempted === true ? '예외 통과' : '기록만'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ListPager page={geoHitsPage} total={geoHitsTotal} onPage={(p) => { void loadGeoHits(p); }} />
            </div>
          </div>
        )}
    </>
  );
}
