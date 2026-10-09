/**
 * TemplatesTab — 슈퍼관리자 AdminDashboard 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';
import AlimtalkSendersSection from '../../alimtalk/AlimtalkSendersSection';
import { getAlimtalkTemplateStatus } from '../../../utils/formatDate';
import TablePagination from '../../common/TablePagination';
import type { ModalState } from '../admin-types';

export interface TemplatesTabProps {
  adminRcsTemplates: any[];
  adminTemplates: any[];
  filteredAlimtalkTemplates: any[];
  filteredRcsTemplates: any[];
  loadAdminRcsTemplates: () => Promise<void>;
  loadAdminTemplates: () => Promise<void>;
  loadPendingBadges: () => Promise<void>;
  setModal: Dispatch<SetStateAction<ModalState>>;
  setRejectModal: Dispatch<SetStateAction<{ show: boolean; id: string; reason: string; }>>;
  setShowImcTemplateImport: Dispatch<SetStateAction<boolean>>;
  setShowManualTemplateForm: Dispatch<SetStateAction<boolean>>;
  setTemplateDetail: Dispatch<any>;
  setTemplateFilter: Dispatch<SetStateAction<'all' | 'pending' | 'approved' | 'rejected'>>;
  setTemplatePage: Dispatch<SetStateAction<number>>;
  setTemplateSearch: Dispatch<SetStateAction<string>>;
  setTemplateSubTab: Dispatch<SetStateAction<'alimtalk' | 'rcs'>>;
  showAlert: (title: string, message: string, variant?: 'success' | 'error' | 'warning' | 'info') => void;
  templateFilter: 'all' | 'pending' | 'approved' | 'rejected';
  templatePage: number;
  templateSearch: string;
  templateSubTab: 'alimtalk' | 'rcs';
  templatesLoading: boolean;
}

export default function TemplatesTab(props: TemplatesTabProps) {
  const { adminRcsTemplates, adminTemplates, filteredAlimtalkTemplates, filteredRcsTemplates, loadAdminRcsTemplates, loadAdminTemplates, loadPendingBadges, setModal, setRejectModal, setShowImcTemplateImport, setShowManualTemplateForm, setTemplateDetail, setTemplateFilter, setTemplatePage, setTemplateSearch, setTemplateSubTab, showAlert, templateFilter, templatePage, templateSearch, templateSubTab, templatesLoading } = props;
  const templatePerPage = 10;

// ★ 2026-08-17 RCS 분기 제거 — 알림톡 전용으로 좁혔다.
//   RCS 검수 주체는 외부(RCS Biz Center)라 우리 DB status를 손으로 바꾸는 것은 승인이 아니었다.
//   그 상태로 "승인"이 보이면 발송 가능으로 읽히는데 실제로는 아니다(설계서 §2-2 fail-closed).
const handleTemplateApprove = async (id: string) => {
  try {
    const tk = localStorage.getItem('token');
    const res = await fetch(`/api/admin/kakao-templates/${id}/approve`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tk}` }, body: JSON.stringify({}) });
    const data = await res.json();
    if (data.success) { loadAdminTemplates(); loadAdminRcsTemplates(); setModal({ type: 'alert', title: '승인 완료', message: '템플릿이 승인되었습니다', variant: 'success' }); }
    else setModal({ type: 'alert', title: '승인 실패', message: data.error, variant: 'error' });
  } catch { setModal({ type: 'alert', title: '오류', message: '서버 오류', variant: 'error' }); }
};

// ★ D96: prompt() → 커스텀 모달로 변경
const handleTemplateReject = (id: string) => {
  setRejectModal({ show: true, id, reason: '' });
};
  return (
    <>
    {(
        <div className="space-y-4">
        {/* 발신 프로필 관리 — D130 AlimtalkSendersSection (IMC 연동 + 승인 워크플로우) */}
        <AlimtalkSendersSection onChanged={loadPendingBadges} />

        {/* 템플릿 관리 */}
        <div className="bg-white rounded-xl border border-gray-200/80 shadow-sm">
          <div className="px-5 py-3.5 border-b border-gray-100 flex flex-wrap justify-between items-center gap-3">
            <div>
              <h2 className="text-base font-semibold">템플릿 관리</h2>
              <p className="text-xs text-gray-500 mt-1">고객사 알림톡/RCS 템플릿 승인·반려 및 수동 등록</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* ★ 2026-08-04 딜러 이관은 발신프로필이 먼저 끝나고 템플릿이 뒤따르는 일이 잦아,
                  프로필 연결 뒤 템플릿만 다시 받아야 한다. 그 진입점을 템플릿 화면에도 둔다. */}
              <button onClick={() => setShowImcTemplateImport(true)}
                className="whitespace-nowrap bg-violet-100 hover:bg-violet-200 text-violet-700 px-4 py-2 rounded-lg text-[13px] font-medium">
                IMC에서 가져오기
              </button>
              <button onClick={() => setShowManualTemplateForm(true)}
                className="whitespace-nowrap bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-[13px] font-medium">
                + 수동 등록 (기존 템플릿)
              </button>
            </div>
          </div>

          {/* 서브탭 + 검색 + 필터 */}
          <div className="px-6 py-3 border-b flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2 flex-shrink-0">
              <button onClick={() => setTemplateSubTab('alimtalk')}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${templateSubTab === 'alimtalk' ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                알림톡
              </button>
              <button onClick={() => setTemplateSubTab('rcs')}
                className={`whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition ${templateSubTab === 'rcs' ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                RCS
              </button>
            </div>
            <input
              type="text"
              value={templateSearch}
              onChange={(e) => setTemplateSearch(e.target.value)}
              placeholder="고객사·템플릿명·템플릿코드·관리코드 검색"
              className="flex-1 min-w-0 max-w-sm px-3 py-1.5 border border-gray-200 rounded-lg text-[13px]"
            />
            <div className="flex gap-1 flex-shrink-0">
              {(['all', 'pending', 'approved', 'rejected'] as const).map(f => (
                <button key={f} onClick={() => setTemplateFilter(f)}
                  className={`whitespace-nowrap px-2.5 py-1 rounded text-xs transition ${templateFilter === f ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>
                  {f === 'all' ? '전체' : f === 'pending' ? '승인대기' : f === 'approved' ? '승인' : '반려'}
                </button>
              ))}
            </div>
          </div>

          {/* 알림톡 목록 */}
          {templateSubTab === 'alimtalk' && (
            <>
            <div className="overflow-x-auto">
              {templatesLoading ? (
                <div className="text-center py-12 text-gray-400">로딩 중...</div>
              ) : filteredAlimtalkTemplates.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  {adminTemplates.length === 0 ? '템플릿이 없습니다' : '검색 결과가 없습니다'}
                </div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2 text-left font-medium text-gray-500">고객사</th>
                      {/* ★ 2026-08-04 채널 컬럼 — 대행사는 한 회사 밑에 여러 브랜드 채널을 갖는다.
                          회사명만 보이면 어느 채널 템플릿인지 상세를 열어야 알 수 있었다. */}
                      <th className="whitespace-nowrap px-4 py-2 text-left font-medium text-gray-500">채널</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left font-medium text-gray-500">템플릿명</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left font-medium text-gray-500">카테고리</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center font-medium text-gray-500">상태</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left font-medium text-gray-500">요청일</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center font-medium text-gray-500">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredAlimtalkTemplates
                      .slice((templatePage - 1) * templatePerPage, templatePage * templatePerPage)
                      .map((t: any) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-900 font-medium">{t.company_name || '-'}</td>
                        <td className="px-4 py-2">
                          {t.profile_name || t.yellow_id ? (
                            <>
                              <div className="text-gray-700">{t.profile_name || '-'}</div>
                              {t.yellow_id && <div className="text-xs text-gray-400">{t.yellow_id}</div>}
                            </>
                          ) : (
                            <span className="text-gray-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <div className="text-gray-900">{t.template_name}</div>
                          {t.template_code && (
                            <div
                              className="text-xs text-gray-400 hover:text-blue-600 cursor-pointer inline-block"
                              style={{ userSelect: 'text' }}
                              title="클릭하면 복사"
                              onClick={() => { navigator.clipboard.writeText(t.template_code); showAlert('복사 완료', '템플릿코드를 복사했습니다.', 'success'); }}
                            >{t.template_code}</div>
                          )}
                          {/* ★ 2026-07-22(접수2): 고객사 지정 관리코드 표시 + 검색 대상 */}
                          {t.custom_template_code && (
                            <div className="text-[11px] text-gray-400" style={{ userSelect: 'text' }}>관리코드: {t.custom_template_code}</div>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-600">{t.category || '-'}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getAlimtalkTemplateStatus(t.status).badgeClass}`}>
                            {getAlimtalkTemplateStatus(t.status).label}
                          </span>
                          {/* ★ CT-87 (2026-06-10): 검수 승인이어도 카카오 활성상태(A 외)면 발송 거부 — 실상태 병기 */}
                          {getAlimtalkTemplateStatus(t.status).label === '승인' && t.imc_template_status && t.imc_template_status !== 'A' && (
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ml-1 ${t.imc_template_status === 'R' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}
                              title="카카오 측 템플릿 활성상태가 A(정상)가 아니면 발송이 거부됩니다."
                            >
                              {t.imc_template_status === 'R' ? '활성 대기 · 발송불가' : t.imc_template_status === 'S' ? '중단 · 발송불가' : `${t.imc_template_status} · 발송불가`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{t.requested_at ? new Date(t.requested_at).toLocaleDateString('ko-KR') : '-'}</td>
                        <td className="px-4 py-2 text-center">
                          <div className="flex gap-1 justify-center items-center">
                            <button onClick={() => setTemplateDetail(t)}
                              className="whitespace-nowrap text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100">상세</button>
                            {getAlimtalkTemplateStatus(t.status).label === '검수중' && (
                              <>
                                <button onClick={() => handleTemplateApprove(t.id)}
                                  className="whitespace-nowrap text-xs px-2 py-1 bg-green-50 text-green-700 rounded hover:bg-green-100">승인</button>
                                <button onClick={() => handleTemplateReject(t.id)}
                                  className="whitespace-nowrap text-xs px-2 py-1 bg-red-50 text-red-700 rounded hover:bg-red-100">반려</button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <TablePagination
              total={filteredAlimtalkTemplates.length}
              page={templatePage}
              perPage={templatePerPage}
              onChange={setTemplatePage}
              unit="건"
            />
            </>
          )}

          {/* RCS 목록 */}
          {templateSubTab === 'rcs' && (
            <>
            <div className="overflow-x-auto">
              {filteredRcsTemplates.length === 0 ? (
                <div className="text-center py-12 text-gray-400">
                  {adminRcsTemplates.length === 0 ? 'RCS 템플릿이 없습니다' : '검색 결과가 없습니다'}
                </div>
              ) : (
                <table className="w-full text-[13px]">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="whitespace-nowrap px-4 py-2 text-left font-medium text-gray-500">고객사</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left font-medium text-gray-500">템플릿명</th>
                      <th className="whitespace-nowrap px-4 py-2 text-left font-medium text-gray-500">유형</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center font-medium text-gray-500">상태</th>
                      <th className="whitespace-nowrap px-4 py-2 text-center font-medium text-gray-500">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredRcsTemplates
                      .slice((templatePage - 1) * templatePerPage, templatePage * templatePerPage)
                      .map((t: any) => (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-gray-900 font-medium">{t.company_name || '-'}</td>
                        <td className="px-4 py-2 text-gray-900">{t.template_name}</td>
                        <td className="px-4 py-2 text-gray-600">{t.message_type}</td>
                        <td className="px-4 py-2 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${getAlimtalkTemplateStatus(t.status).badgeClass}`}>
                            {getAlimtalkTemplateStatus(t.status).label}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-center">
                          {/* ★ 2026-08-17 RCS 승인·반려 버튼 제거 — 이 버튼은 우리 DB의 status만 바꿨고
                              실제 검수 주체(RCS Biz Center)와 아무 관계가 없었다. 그 상태로 "승인"을 보면
                              발송 가능으로 읽히지만 실제로는 그렇지 않다. 검수 상태는 연동 동기화로만 채운다
                              (설계 = docs/2026-08-17-rcs-integration-design.md §2-2). 상세 보기는 유지. */}
                          <div className="flex gap-1 justify-center items-center">
                            <button onClick={() => setTemplateDetail(t)}
                              className="whitespace-nowrap text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100">상세</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <TablePagination
              total={filteredRcsTemplates.length}
              page={templatePage}
              perPage={templatePerPage}
              onChange={setTemplatePage}
              unit="건"
            />
            </>
          )}
        </div>
        </div>
      )}
    </>
  );
}
