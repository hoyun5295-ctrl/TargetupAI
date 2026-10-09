/**
 * CompanyCustomerDbTab — 슈퍼관리자 CompanyDetailModal 에서 옮긴 화면(★ 2026-10-09 파일 분리 E · 설계서 docs/2026-10-03-admin-dashboard-split-design.md §5)
 * 옮긴 방법 = 스크립트(원문 그대로 · 글자 대조). 상태(use*)는 본체에 남고 props 로 받는다 — 탭을 옮겨 다녀도 값이 그대로다(동작 변경 0).
 */
import type { Dispatch, SetStateAction } from 'react';

export interface CompanyCustomerDbTabProps {
  adminCustPage: { total: number; page: number; totalPages: number; };
  setCustomerDeleteConfirmName: Dispatch<SetStateAction<string>>;
  setShowCustomerDeleteAll: Dispatch<SetStateAction<boolean>>;
  setShowEditCompanyModal: Dispatch<SetStateAction<boolean>>;
}

export default function CompanyCustomerDbTab(props: CompanyCustomerDbTabProps) {
  const { adminCustPage, setCustomerDeleteConfirmName, setShowCustomerDeleteAll, setShowEditCompanyModal } = props;

  return (
    <>
    {(
                <div className="space-y-3">
                  {/* 안내 + 총 고객 수만 표시 (정보 출력 없음) */}
                  <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="text-sm font-medium text-gray-700 mb-1">고객 DB 관리</div>
                    <p className="text-xs text-gray-500">
                      등록된 고객: <span className="font-semibold text-gray-800">{adminCustPage.total.toLocaleString()}명</span>
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      개별 고객 데이터 조회/삭제는 고객사관리자가 자기 화면에서 수행합니다. 슈퍼관리자는 전체 초기화만 가능합니다.
                    </p>
                  </div>

                  {/* 전체 삭제 (P10 정정 — 유지) */}
                  <div className="pt-3 border-t border-red-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-medium text-red-600">⚠️ 전체 삭제</div>
                        <p className="text-[11px] text-gray-400">이 회사의 모든 고객 및 구매내역 영구 삭제</p>
                      </div>
                      <button type="button"
                        onClick={() => { setCustomerDeleteConfirmName(''); setShowCustomerDeleteAll(true); }}
                        className="whitespace-nowrap px-3 py-1.5 bg-red-50 text-red-600 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition">
                        전체 삭제
                      </button>
                    </div>
                  </div>

                  {/* 닫기 버튼 */}
                  <div className="flex pt-4 mt-4 border-t">
                    <button type="button" onClick={() => setShowEditCompanyModal(false)}
                      className="whitespace-nowrap w-full px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50">
                      닫기
                    </button>
                  </div>
                </div>
              )}
    </>
  );
}
