/**
 * ★ D150-2 (2026-05-09): 알림톡 / 브랜드메시지 템플릿 변경 이력 조회 모달
 *
 * - 직원 잠금 (슈퍼관리자만 호출 — backend 라우트 `requireSuperAdmin`)
 * - 카카오 측 이력 API 응답을 그대로 활용 (한줄로 자체 audit 테이블 없음)
 * - 알림톡 + 브랜드 동일 모달 재사용 (type prop 분기)
 * - 좌측 목록(최신순) → 행 클릭 → 우측 상세 (그 시점 변경 필드 diff)
 *
 * 휴머스온/IMC 키워드 노출 0:
 *   - backend `sendImcManagedResponse`가 raw 메시지 sanitize
 *   - 본 컴포넌트의 `INSPECTION_LABELS.HREJ`는 '내부 반려'로 표기
 */

import { useEffect, useState } from 'react';

type TemplateType = 'alimtalk' | 'brand';

interface HistoryChange {
  field: string;
  label: string;
  before: string | null;
  after: string | null;
  truncated: boolean;
  complex: boolean;
}

interface HistoryListItem {
  histId: number;
  changeType: string;
  inspectionStatus?: string;
  templateStatus?: string;
  status?: string;
  modifiedAt: string;
  modifiedBy: string;
  changedCount: number;
  changes: HistoryChange[];
}

interface HistoryDetail {
  histId: number;
  changeType: string;
  changes: HistoryChange[];
  modifiedAt: string;
  modifiedBy: string;
  [key: string]: any;
}

interface Props {
  type: TemplateType;
  /** alimtalk → templateCode, brand → templateKey */
  templateRef: string;
  templateName: string;
  onClose: () => void;
}

const CHANGE_TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  CREATE:     { label: '등록',      cls: 'bg-emerald-50 text-emerald-700' },
  UPDATE:     { label: '수정',      cls: 'bg-blue-50 text-blue-700' },
  STATUS:     { label: '상태 변경', cls: 'bg-violet-50 text-violet-700' },
  INSPECTION: { label: '검수 진행', cls: 'bg-amber-50 text-amber-700' },
  DELETE:     { label: '삭제',      cls: 'bg-rose-50 text-rose-700' },
};

// 검수 상태 (알림톡만). HREJ는 사용자 노출 시 휴머스온 키워드 차폐(→ '내부 반려').
const INSPECTION_LABELS: Record<string, string> = {
  REG:  '등록',
  REQ:  '검수요청',
  HREJ: '내부 반려',
  KREQ: '카카오 검수요청',
  KREJ: '카카오 반려',
  APR:  '승인완료',
};

const TEMPLATE_STATUS_LABELS: Record<string, string> = {
  S: '중지',
  A: '정상',
  R: '대기(발송전)',
};

function getToken(): string {
  return localStorage.getItem('token') || '';
}

export default function TemplateHistoryModal({
  type,
  templateRef,
  templateName,
  onClose,
}: Props) {
  const [histories, setHistories] = useState<HistoryListItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const baseUrl =
    type === 'alimtalk'
      ? `/api/alimtalk/templates/${encodeURIComponent(templateRef)}/history`
      : `/api/alimtalk/brand-templates/${encodeURIComponent(templateRef)}/history`;

  // 목록 fetch
  useEffect(() => {
    let canceled = false;
    setLoading(true);
    setError(null);
    fetch(baseUrl, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (canceled) return;
        if (data?.success === false) {
          setError(data?.error || '이력 조회에 실패했습니다');
          return;
        }
        const imcData = data?.imc?.data || data?.data;
        setHistories(imcData?.histories || []);
        setTotalCount(imcData?.totalCount || 0);
      })
      .catch((e) => {
        if (canceled) return;
        setError(e?.message || '이력 조회 중 오류가 발생했습니다');
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [baseUrl]);

  // 상세 fetch
  useEffect(() => {
    if (selectedId === null) {
      setDetail(null);
      return;
    }
    let canceled = false;
    setDetailLoading(true);
    setDetailError(null);
    fetch(`${baseUrl}/${selectedId}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
      .then((r) => r.json())
      .then((data) => {
        if (canceled) return;
        if (data?.success === false) {
          setDetailError(data?.error || '이력 상세 조회에 실패했습니다');
          return;
        }
        const imcData = data?.imc?.data || data?.data;
        setDetail(imcData || null);
      })
      .catch((e) => {
        if (canceled) return;
        setDetailError(e?.message || '이력 상세 조회 중 오류가 발생했습니다');
      })
      .finally(() => {
        if (!canceled) setDetailLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [selectedId, baseUrl]);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <div>
            <div className="text-sm text-gray-500">
              {type === 'alimtalk' ? '알림톡 템플릿' : '브랜드메시지 템플릿'} 변경 이력
            </div>
            <div className="text-base font-semibold text-gray-900 mt-0.5">
              {templateName || templateRef}
            </div>
            <div className="text-[11px] text-gray-400 font-mono mt-0.5">
              {templateRef}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none px-2"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* 본문 — 좌측 목록 / 우측 상세 */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 overflow-hidden">
          {/* 좌측 목록 */}
          <div className="border-r border-gray-100 overflow-y-auto p-4">
            {loading && (
              <div className="text-sm text-gray-400 text-center py-8">불러오는 중…</div>
            )}
            {error && (
              <div className="text-sm text-red-500 bg-red-50 p-3 rounded">{error}</div>
            )}
            {!loading && !error && histories.length === 0 && (
              <div className="text-sm text-gray-400 text-center py-8">
                기록된 이력이 없습니다.
              </div>
            )}
            {!loading && !error && histories.length > 0 && (
              <>
                <div className="text-[11px] text-gray-500 mb-2">
                  총 {totalCount}건 (최신순)
                </div>
                <ul className="space-y-1">
                  {histories.map((h) => {
                    const ct = CHANGE_TYPE_LABELS[h.changeType] || {
                      label: h.changeType,
                      cls: 'bg-gray-100 text-gray-600',
                    };
                    const isSelected = selectedId === h.histId;
                    return (
                      <li key={h.histId}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(h.histId)}
                          className={`w-full text-left rounded-lg p-3 border transition ${
                            isSelected
                              ? 'border-emerald-300 bg-emerald-50/50'
                              : 'border-gray-100 hover:bg-gray-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`inline-block text-[11px] px-2 py-0.5 rounded ${ct.cls}`}
                            >
                              {ct.label}
                            </span>
                            <span className="text-[11px] text-gray-400">
                              {h.modifiedAt || '-'}
                            </span>
                          </div>
                          <div className="mt-1.5 text-xs text-gray-700 flex items-center gap-2 flex-wrap">
                            {h.changeType === 'INSPECTION' && h.inspectionStatus && (
                              <span className="text-amber-700">
                                {INSPECTION_LABELS[h.inspectionStatus] || h.inspectionStatus}
                              </span>
                            )}
                            {h.changeType === 'STATUS' && (h.templateStatus || h.status) && (
                              <span className="text-violet-700">
                                {TEMPLATE_STATUS_LABELS[(h.templateStatus || h.status) as string] ||
                                  h.templateStatus ||
                                  h.status}
                              </span>
                            )}
                            {h.changedCount > 0 && (
                              <span className="text-gray-500">
                                · {h.changedCount}개 필드 변경
                              </span>
                            )}
                          </div>
                          {h.modifiedBy && (
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              by {h.modifiedBy}
                            </div>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>

          {/* 우측 상세 */}
          <div className="overflow-y-auto p-4 bg-gray-50/50">
            {selectedId === null && !loading && (
              <div className="text-sm text-gray-400 text-center py-8">
                좌측 이력 항목을 선택하세요.
              </div>
            )}
            {detailLoading && (
              <div className="text-sm text-gray-400 text-center py-8">불러오는 중…</div>
            )}
            {detailError && (
              <div className="text-sm text-red-500 bg-red-50 p-3 rounded">
                {detailError}
              </div>
            )}
            {!detailLoading && !detailError && detail && (
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-gray-500">변경 시점</div>
                  <div className="text-sm font-medium text-gray-900">
                    {detail.modifiedAt || '-'}
                  </div>
                  {detail.modifiedBy && (
                    <div className="text-[11px] text-gray-500 mt-0.5">
                      by {detail.modifiedBy}
                    </div>
                  )}
                </div>

                {detail.changes && detail.changes.length > 0 ? (
                  <div>
                    <div className="text-xs font-semibold text-gray-700 mb-2">
                      직전 대비 변경된 필드 ({detail.changes.length}개)
                    </div>
                    <ul className="space-y-2">
                      {detail.changes.map((c, idx) => (
                        <li
                          key={`${c.field}_${idx}`}
                          className="bg-white border border-gray-100 rounded-lg p-3"
                        >
                          <div className="text-xs font-semibold text-gray-700">
                            {c.label || c.field}
                          </div>
                          <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            <div>
                              <div className="text-[10px] text-gray-400 mb-0.5">이전</div>
                              <div className="bg-rose-50 text-rose-800 rounded p-2 break-words whitespace-pre-wrap">
                                {c.before ?? <span className="text-rose-300">(없음)</span>}
                              </div>
                            </div>
                            <div>
                              <div className="text-[10px] text-gray-400 mb-0.5">변경 후</div>
                              <div className="bg-emerald-50 text-emerald-800 rounded p-2 break-words whitespace-pre-wrap">
                                {c.after ?? <span className="text-emerald-300">(없음)</span>}
                              </div>
                            </div>
                          </div>
                          {c.complex && (
                            <div className="text-[10px] text-amber-600 mt-1">
                              ※ 복합 데이터 (JSON 직렬화 표시)
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">변경된 필드가 없습니다.</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
