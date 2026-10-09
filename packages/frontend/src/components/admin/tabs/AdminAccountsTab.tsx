/**
 * AdminAccountsTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import ListPager, { pageSlice } from '../../shared/ListPager';
import { formatDateTime } from '../../../utils/formatDate';

export interface AdminAccountsTabProps {
  adminAccounts: any[];
  adminAccountsAllowed: boolean;
  adminAccountsCanWrite: boolean;
  adminAccountsPage: number;
  adminLevelLabels: Record<string, string>;
  adminMatrix: any[];
  adminRoleHistory: any[];
  adminRoleHistoryPage: number;
  adminRoleOptions: any[];
  setAdminAccountsPage: Dispatch<SetStateAction<number>>;
  setAdminActiveEdit: Dispatch<SetStateAction<{ id: string; login_id: string; isActive: boolean; reason: string; } | null>>;
  setAdminCreate: Dispatch<SetStateAction<{ loginId: string; name: string; email: string; role: string; password: string; reason: string; } | null>>;
  setAdminRoleEdit: Dispatch<SetStateAction<{ id: string; login_id: string; role: string; reason: string; } | null>>;
  setAdminRoleHistoryPage: Dispatch<SetStateAction<number>>;
}

export default function AdminAccountsTab(props: AdminAccountsTabProps) {
  const { adminAccounts, adminAccountsAllowed, adminAccountsCanWrite, adminAccountsPage, adminLevelLabels, adminMatrix, adminRoleHistory, adminRoleHistoryPage, adminRoleOptions, setAdminAccountsPage, setAdminActiveEdit, setAdminCreate, setAdminRoleEdit, setAdminRoleHistoryPage } = props;
  return (
    <>
    {(
          <div className="space-y-6">
            {!adminAccountsAllowed ? (
              <div className="bg-white rounded-xl border border-gray-200 px-5 py-10 text-center text-sm text-gray-500">
                직원 계정·권한은 대표 · 지원팀장 등급 계정에서만 볼 수 있습니다.
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 text-white">
                  <div className="text-[11px] font-semibold tracking-wide text-gray-400">접근권한 관리</div>
                  <h3 className="mt-1 text-base font-bold">직원 계정 등급 · 권한분류표</h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-300">
                    등급마다 접근할 수 있는 영역과 권한 수준(조회 · 변경 · 삭제)이 정해져 있습니다.
                    등급을 바꾸려면 사유를 남겨야 하고, 그 기록이 아래 변경 이력 대장에 남습니다.
                  </p>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">계정 목록</h3>
                      <p className="text-[10px] text-gray-500 mt-0.5 italic">Data source: 관리자 계정 원장</p>
                    </div>
                    {/* ★ 2026-10-03 지원팀장은 조회만 — 계정 추가 · 등급 · 중지는 대표만(서버 canWrite) */}
                    {adminAccountsCanWrite ? (
                      <button
                        onClick={() => setAdminCreate({ loginId: '', name: '', email: '', role: 'support', password: '', reason: '' })}
                        className="whitespace-nowrap px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
                      >
                        계정 추가
                      </button>
                    ) : (
                      <span className="text-[11px] text-gray-400">조회 전용 · 변경은 대표 등급만</span>
                    )}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-gray-50 text-xs text-gray-500">
                        <tr>
                          <th className="whitespace-nowrap px-4 py-2 text-left">계정 ID</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">이름</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">소속</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">등급</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">상태</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">최종 접속</th>
                          <th className="whitespace-nowrap px-4 py-2 text-right">등급 변경</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {adminAccounts.length === 0 && (
                          <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-xs">계정이 없습니다.</td></tr>
                        )}
                        {pageSlice(adminAccounts, adminAccountsPage).map((a) => {
                          const opt = adminRoleOptions.find((o) => o.value === a.role);
                          return (
                            <tr key={a.id} className={a.is_active ? '' : 'opacity-45'}>
                              <td className="px-4 py-2 font-mono text-xs text-gray-900">{a.login_id}</td>
                              <td className="px-4 py-2 text-xs text-gray-900">{a.name || '-'}</td>
                              <td className="px-4 py-2 text-xs text-gray-600">{a.role === 'super' ? '대표' : '모바일 지원팀'}</td>
                              <td className="px-4 py-2">
                                <span className={`px-2 py-0.5 text-[11px] rounded ${a.role === 'super' ? 'bg-indigo-100 text-indigo-700' : a.role === 'lead' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                                  {opt?.label || a.role}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-xs text-gray-600">{a.is_active ? '사용 중' : '비활성'}</td>
                              <td className="px-4 py-2 text-[11px] text-gray-400">{a.last_login_at ? formatDateTime(a.last_login_at) : '-'}</td>
                              <td className="px-4 py-2 text-right whitespace-nowrap">
                                {adminAccountsCanWrite ? (
                                  <>
                                    <button
                                      onClick={() => setAdminRoleEdit({ id: a.id, login_id: a.login_id, role: a.role, reason: '' })}
                                      className="whitespace-nowrap px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
                                    >
                                      등급
                                    </button>
                                    <button
                                      onClick={() => setAdminActiveEdit({ id: a.id, login_id: a.login_id, isActive: !a.is_active, reason: '' })}
                                      className="whitespace-nowrap ml-1.5 px-2.5 py-1 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-gray-50"
                                    >
                                      {a.is_active ? '중지' : '재개'}
                                    </button>
                                  </>
                                ) : (
                                  <span className="text-[11px] text-gray-300">-</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <ListPager page={adminAccountsPage} total={adminAccounts.length} onPage={setAdminAccountsPage} />
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100">
                    <h3 className="text-base font-semibold text-gray-900">권한분류표</h3>
                    <p className="text-[10px] text-gray-500 mt-0.5 italic">Data source: 권한 판정 컨트롤타워 (화면이 표를 만들지 않는다)</p>
                  </div>
                  <div className="px-5 py-3 flex flex-wrap gap-3 border-b border-gray-100">
                    {adminRoleOptions.map((o) => (
                      <div key={o.value} className="text-[11px] text-gray-600">
                        <span className="font-semibold text-gray-900">{o.label}</span>
                        <span className="ml-1.5 text-gray-400">{o.desc}</span>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-gray-50 text-xs text-gray-500">
                        <tr>
                          <th className="whitespace-nowrap px-4 py-2 text-left">영역</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">해당 화면</th>
                          {adminRoleOptions.map((o) => (
                            <th key={o.value} className="whitespace-nowrap px-4 py-2 text-center">{o.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {adminMatrix.map((row) => (
                          <tr key={row.key}>
                            <td className="px-4 py-2 text-xs font-medium text-gray-900">{row.area}</td>
                            <td className="px-4 py-2 text-[11px] text-gray-500">{row.screens}</td>
                            {adminRoleOptions.map((o) => {
                              const lv = row.levels?.[o.value] || 'NONE';
                              return (
                                <td key={o.value} className="px-4 py-2 text-center">
                                  <span className={`inline-block px-2 py-0.5 text-[11px] rounded ${
                                    lv === 'NONE' ? 'bg-gray-100 text-gray-400'
                                      : lv === 'R' ? 'bg-sky-50 text-sky-700'
                                      : lv === 'RW' ? 'bg-emerald-50 text-emerald-700'
                                      : 'bg-indigo-50 text-indigo-700'}`}>
                                    {adminLevelLabels[lv] || lv}
                                  </span>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100">
                    <h3 className="text-base font-semibold text-gray-900">접근권한 변경 이력 대장</h3>
                    <p className="text-[10px] text-gray-500 mt-0.5 italic">Data source: 감사 로그 (admin_role_changed 외)</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[13px]">
                      <thead className="bg-gray-50 text-xs text-gray-500">
                        <tr>
                          <th className="whitespace-nowrap px-4 py-2 text-left">일시</th>
                          {/* ★ 2026-10-02 승인자 열(전송자격인증 3.2 ③ · 3.3 ②) — 이 대장의 변경은 대표 등급만 할 수 있어
                              승인과 처리가 같은 사람이다. 심사 확인사항이 두 항목을 따로 적으므로 열도 따로 둔다 */}
                          <th className="whitespace-nowrap px-4 py-2 text-left">승인자</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">처리자</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">대상 계정</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">변경</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">사유</th>
                          <th className="whitespace-nowrap px-4 py-2 text-left">접속 IP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {adminRoleHistory.length === 0 && (
                          <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-xs">변경 이력이 없습니다.</td></tr>
                        )}
                        {pageSlice(adminRoleHistory, adminRoleHistoryPage).map((h) => {
                          const d = h.details || {};
                          const roleName = (v: any) => adminRoleOptions.find((o) => o.value === v)?.label || v || '-';
                          // ★0827 등급 변경 말고도 생성·중지·재개가 같은 대장에 쌓인다.
                          //   before/after만 보면 그 행들이 「- → -」가 되어 심사 제출물에 빈칸이 남는다.
                          const change =
                            h.action === 'admin_role_changed'
                              ? `${roleName(d.before)} → ${roleName(d.after)}`
                              : h.action === 'admin_account_created'
                                ? `계정 생성 · ${roleName(d.role)}`
                                : h.action === 'admin_account_disabled'
                                  ? '사용 중지'
                                  : h.action === 'admin_account_enabled'
                                    ? '사용 재개'
                                    : '-';
                          return (
                            <tr key={h.id}>
                              <td className="px-4 py-2 text-xs text-gray-500">{formatDateTime(h.created_at)}</td>
                              <td className="px-4 py-2 text-xs text-gray-900">{h.actor_name || h.actor_login_id || '-'}</td>
                              <td className="px-4 py-2 text-xs text-gray-900">{h.actor_name || h.actor_login_id || '-'}</td>
                              <td className="px-4 py-2 font-mono text-xs text-gray-700">{d.login_id || '-'}</td>
                              <td className="px-4 py-2 text-xs text-gray-700 whitespace-nowrap">{change}</td>
                              <td className="px-4 py-2 text-xs text-gray-600 max-w-xs truncate">{d.reason || '-'}</td>
                              <td className="px-4 py-2 font-mono text-[11px] text-gray-500">{h.ip_address || '-'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <ListPager page={adminRoleHistoryPage} total={adminRoleHistory.length} onPage={setAdminRoleHistoryPage} />
                </div>
              </>
            )}
          </div>
        )}
    </>
  );
}
