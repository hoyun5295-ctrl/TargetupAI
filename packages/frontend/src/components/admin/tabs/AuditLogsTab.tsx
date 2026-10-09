/**
 * AuditLogsTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import { AUDIT_ACTION_LABEL, formatAuditDetail, AUDIT_ACTION_COLOR } from '../../../constants/audit-action-labels';
import { formatDateTime } from '../../../utils/formatDate';
import type { Company } from '../admin-types';

export interface AuditLogsTabProps {
  auditActionFilter: string;
  auditActions: string[];
  auditCompanyFilter: string;
  auditFromDate: string;
  auditLogs: any[];
  auditLogsLoading: boolean;
  auditLogsPage: number;
  auditLogsTotal: number;
  auditLogsTotalPages: number;
  auditToDate: string;
  companies: Company[];
  loadAuditLogs: (page: number) => Promise<void>;
  setAuditActionFilter: Dispatch<SetStateAction<string>>;
  setAuditCompanyFilter: Dispatch<SetStateAction<string>>;
  setAuditFromDate: Dispatch<SetStateAction<string>>;
  setAuditToDate: Dispatch<SetStateAction<string>>;
}

export default function AuditLogsTab(props: AuditLogsTabProps) {
  const { auditActionFilter, auditActions, auditCompanyFilter, auditFromDate, auditLogs, auditLogsLoading, auditLogsPage, auditLogsTotal, auditLogsTotalPages, auditToDate, companies, loadAuditLogs, setAuditActionFilter, setAuditCompanyFilter, setAuditFromDate, setAuditToDate } = props;
  return (
    <>
    {(
        <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
          <div className="px-5 py-3.5 border-b border-gray-100">
            <h2 className="text-base font-semibold">감사 로그</h2>
            <p className="text-xs text-gray-500 mt-1">로그인, 삭제, 설정 변경 등 주요 활동 기록</p>
          </div>

          {/* 필터 */}
          <div className="px-6 py-3 border-b bg-gray-50 flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-500 font-medium">기간</span>
            <input type="date" value={auditFromDate} onChange={(e) => setAuditFromDate(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <span className="text-gray-400">~</span>
            <input type="date" value={auditToDate} onChange={(e) => setAuditToDate(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200" />
            <div className="w-px h-6 bg-gray-200" />
            <span className="text-sm text-gray-500 font-medium">액션</span>
            <select value={auditActionFilter} onChange={(e) => setAuditActionFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">전체</option>
              {auditActions.map(a => <option key={a} value={a}>{AUDIT_ACTION_LABEL[a] || a}</option>)}
            </select>
            <span className="text-sm text-gray-500 font-medium">고객사</span>
            <select value={auditCompanyFilter} onChange={(e) => setAuditCompanyFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-200">
              <option value="all">전체</option>
              {companies.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
            <button onClick={() => loadAuditLogs(1)}
              className="whitespace-nowrap px-4 py-1.5 bg-emerald-600 text-white rounded-lg text-[13px] font-medium hover:bg-emerald-700 transition-colors">
              조회
            </button>
          </div>

          {/* 총 건수 */}
          <div className="px-6 py-2 text-xs text-gray-500">
            총 {auditLogsTotal.toLocaleString()}건 · {auditLogsPage} / {auditLogsTotalPages} 페이지
          </div>

          {/* 테이블 */}
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">일시</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">사용자</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">고객사</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">액션</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">상세</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditLogsLoading ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">불러오는 중...</td></tr>
                ) : auditLogs.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center text-gray-500">조회된 로그가 없습니다.</td></tr>
                ) : (
                  auditLogs.map((log) => {
                    // ★ 2026-08-24 라벨·상세 조립 = constants/audit-action-labels.ts CT 소유(인라인 맵 금지)
                    const detailText = formatAuditDetail(log.action, log.details);

                    return (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-center text-gray-600 whitespace-nowrap text-xs">
                          {formatDateTime(log.created_at)}
                        </td>
                        <td className="px-4 py-2 text-left">
                          <div className="font-medium text-gray-800 text-xs">{log.user_name || '-'}</div>
                          <div className="text-[10px] text-gray-400">{log.login_id || ''}</div>
                        </td>
                        <td className="px-4 py-2 text-left text-xs text-gray-600">
                          {log.company_name || '-'}
                        </td>
                        <td className="px-4 py-2 text-center">
                          <span className={`px-2 py-1 rounded-full text-[11px] font-medium ${AUDIT_ACTION_COLOR[log.action] || 'bg-gray-100 text-gray-600'}`}>
                            {AUDIT_ACTION_LABEL[log.action] || log.action}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-left text-xs text-gray-500 max-w-[300px] truncate" title={detailText}>
                          {detailText || '-'}
                        </td>
                        <td className="px-4 py-2 text-center text-xs text-gray-400 whitespace-nowrap">
                          {log.ip_address || '-'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 페이지네이션 */}
          {auditLogsTotalPages > 1 && (
            <div className="px-6 py-3 border-t flex justify-center gap-1">
              <button onClick={() => loadAuditLogs(1)} disabled={auditLogsPage === 1}
                className="whitespace-nowrap px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-30">«</button>
              <button onClick={() => loadAuditLogs(auditLogsPage - 1)} disabled={auditLogsPage === 1}
                className="whitespace-nowrap px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-30">‹</button>
              {Array.from({ length: auditLogsTotalPages }, (_, i) => i + 1)
                .filter(p => Math.abs(p - auditLogsPage) <= 2 || p === 1 || p === auditLogsTotalPages)
                .map((p, idx, arr) => (
                  <span key={p}>
                    {idx > 0 && arr[idx - 1] !== p - 1 && <span className="px-1 text-gray-400">…</span>}
                    <button onClick={() => loadAuditLogs(p)}
                      className={`whitespace-nowrap px-3 py-1 text-xs border rounded ${p === auditLogsPage ? 'bg-emerald-600 text-white' : 'hover:bg-gray-50'}`}>{p}</button>
                  </span>
                ))}
              <button onClick={() => loadAuditLogs(auditLogsPage + 1)} disabled={auditLogsPage === auditLogsTotalPages}
                className="whitespace-nowrap px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-30">›</button>
              <button onClick={() => loadAuditLogs(auditLogsTotalPages)} disabled={auditLogsPage === auditLogsTotalPages}
                className="whitespace-nowrap px-2 py-1 text-xs border rounded hover:bg-gray-50 disabled:opacity-30">»</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
