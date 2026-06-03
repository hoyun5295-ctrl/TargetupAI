/**
 * ★ D150-2 (2026-05-09): 브랜드메시지 템플릿 관리 섹션
 *
 * - KakaoRcsPage > 브랜드메시지 탭 > "템플릿 관리" sub-tab에 렌더
 * - 목록 / 등록 / 수정 / 삭제 / 상세보기 / 이력(슈퍼관리자만)
 * - chatBubbleType 8종: TEXT / IMAGE / WIDE / WIDE_ITEM_LIST / CAROUSEL_FEED / PREMIUM_VIDEO / COMMERCE / CAROUSEL_COMMERCE
 * - 검수 없음 — 등록 즉시 ACTIVE
 *
 * 백엔드:
 *   GET    /api/alimtalk/brand-templates                              (목록)
 *   POST   /api/alimtalk/brand-templates                              (등록 — company_admin)
 *   GET    /api/alimtalk/brand-templates/:templateKey                 (상세)
 *   PUT    /api/alimtalk/brand-templates/:templateKey                 (수정 — company_admin)
 *   DELETE /api/alimtalk/brand-templates/:templateKey                 (삭제 — company_admin)
 *   GET    /api/alimtalk/brand-templates/:templateKey/history         (이력 — super_admin)
 *
 * 등록/수정 폼은 Step 2-B의 BrandTemplateForm.tsx에서 본체 작성 후 stub 모달 교체.
 */

import { useEffect, useState } from 'react';
import TemplateHistoryModal from './TemplateHistoryModal';
import BrandTemplateForm from './BrandTemplateForm';
import { useAuthStore } from '../../stores/authStore';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';

interface Profile {
  id: string;
  profile_key: string;
  profile_name: string;
}

interface BrandTemplate {
  id: string;
  template_key: string;
  manage_name: string;
  chat_bubble_type: string;
  status: string;
  profile_id: string;
  profile_key: string | null;
  profile_name: string | null;
  custom_template_code: string | null;
  content: string | null;
  header: string | null;
  additional_content: string | null;
  buttons: any[] | null;
  attachment_json: any;
  carousel_json: any;
  coupon: any;
  adult: 'Y' | 'N' | null;
  created_at: string;
  updated_at: string;
}

const CHAT_BUBBLE_LABELS: Record<string, string> = {
  TEXT:              '텍스트',
  IMAGE:             '이미지',
  WIDE:              '와이드',
  WIDE_ITEM_LIST:    '와이드 리스트',
  CAROUSEL_FEED:     '캐러셀 피드',
  PREMIUM_VIDEO:     '프리미엄 동영상',
  COMMERCE:          '커머스',
  CAROUSEL_COMMERCE: '캐러셀 커머스',
};

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  ACTIVE:   { label: '정상', cls: 'bg-emerald-100 text-emerald-700' },
  INACTIVE: { label: '중지', cls: 'bg-gray-100 text-gray-500' },
};

function getToken(): string {
  return localStorage.getItem('token') || '';
}

interface Props {
  profiles: Profile[];
  setToast: (t: { show: boolean; type: 'success' | 'error'; message: string }) => void;
}

export default function BrandTemplateManagementSection({ profiles, setToast }: Props) {
  const authUser = useAuthStore((s) => s.user);
  const [templates, setTemplates] = useState<BrandTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [profileFilter, setProfileFilter] = useState<string>(''); // '' = 전체

  // 등록/수정/상세보기 모달용 state — Step 2-B에서 BrandTemplateForm 연결
  const [editingTarget, setEditingTarget] = useState<BrandTemplate | null>(null);
  const [viewingTarget, setViewingTarget] = useState<BrandTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // 이력 조회 모달 (슈퍼관리자 전용)
  const [historyTarget, setHistoryTarget] = useState<{
    templateKey: string;
    templateName: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const isSuperAdmin = authUser?.userType === 'super_admin';
  const canManage =
    authUser?.userType === 'company_admin' || authUser?.userType === 'super_admin';

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alimtalk/brand-templates', {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await res.json();
      if (data.success) {
        setTemplates(data.templates || []);
      } else {
        setToast({
          show: true,
          type: 'error',
          message: data.error || '브랜드메시지 템플릿 조회에 실패했습니다',
        });
      }
    } catch (e: any) {
      setToast({
        show: true,
        type: 'error',
        message: e?.message || '조회 중 오류가 발생했습니다',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = profileFilter
    ? templates.filter((t) => t.profile_id === profileFilter)
    : templates;

  const remove = (t: BrandTemplate) => {
    setConfirm({
      mode: 'danger',
      title: '템플릿 삭제',
      description: `'${t.manage_name || t.template_key}' 템플릿을 삭제할까요?\n\n발송 중인 캠페인이 있다면 영향받을 수 있습니다.`,
      confirmLabel: '삭제',
      onConfirm: async () => {
        try {
          const res = await fetch(
            `/api/alimtalk/brand-templates/${encodeURIComponent(t.template_key)}`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${getToken()}` },
            },
          );
          const data = await res.json();
          if (data.success) {
            setToast({ show: true, type: 'success', message: '삭제 완료' });
            load();
          } else {
            setToast({
              show: true,
              type: 'error',
              message: data.error || '삭제 실패',
            });
          }
        } catch (e: any) {
          setToast({
            show: true,
            type: 'error',
            message: e?.message || '삭제 중 오류',
          });
        }
      },
    });
  };

  return (
    <div className="space-y-4">
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-bold text-gray-900">브랜드메시지 템플릿</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            카카오 브랜드메시지 8종 유형 — 검수 없이 등록 즉시 사용 가능
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg"
          >
            + 신규 등록
          </button>
        )}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2">
        <select
          value={profileFilter}
          onChange={(e) => setProfileFilter(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">전체 발신프로필</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.profile_name}
            </option>
          ))}
        </select>
        <span className="text-xs text-gray-400">총 {filtered.length}건</span>
      </div>

      {/* 목록 */}
      {loading ? (
        <div className="text-center py-12 text-sm text-gray-400">불러오는 중…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-3xl mb-2">📢</div>
          <p className="text-sm text-gray-500">등록된 브랜드메시지 템플릿이 없습니다</p>
          {canManage && (
            <p className="text-xs text-gray-400 mt-1">
              상단 + 신규 등록 버튼으로 시작하세요
            </p>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-2 text-left font-medium text-gray-600">관리명</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">발신프로필</th>
                <th className="px-4 py-2 text-center font-medium text-gray-600">유형</th>
                <th className="px-4 py-2 text-center font-medium text-gray-600">상태</th>
                <th className="px-4 py-2 text-left font-medium text-gray-600">최종 수정</th>
                <th className="px-4 py-2 text-right font-medium text-gray-600">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const st = STATUS_LABELS[t.status] || {
                  label: t.status,
                  cls: 'bg-gray-100 text-gray-500',
                };
                return (
                  <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">{t.manage_name}</div>
                      <div className="text-[11px] text-gray-400 font-mono truncate max-w-[240px]">
                        {t.template_key}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-600">
                      {t.profile_name || '-'}
                    </td>
                    <td className="text-center px-4 py-2 text-xs text-gray-600">
                      {CHAT_BUBBLE_LABELS[t.chat_bubble_type] || t.chat_bubble_type}
                    </td>
                    <td className="text-center px-4 py-2">
                      <span
                        className={`inline-block text-[11px] px-2 py-0.5 rounded ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-gray-500">
                      {t.updated_at
                        ? new Date(t.updated_at).toLocaleString('ko-KR')
                        : '-'}
                    </td>
                    <td className="text-right px-4 py-2 space-x-1">
                      {/* 상세보기 — 모든 사용자 */}
                      <button
                        type="button"
                        onClick={() => setViewingTarget(t)}
                        className="text-[11px] px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded"
                      >
                        상세보기
                      </button>
                      {/* 수정 — canManage */}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setEditingTarget(t)}
                          className="text-[11px] px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded"
                        >
                          수정
                        </button>
                      )}
                      {/* 삭제 — canManage */}
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => remove(t)}
                          className="text-[11px] px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-600 rounded"
                        >
                          삭제
                        </button>
                      )}
                      {/* 이력 — 슈퍼관리자만 */}
                      {isSuperAdmin && (
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryTarget({
                              templateKey: t.template_key,
                              templateName: t.manage_name || t.template_key,
                            })
                          }
                          className="text-[11px] px-2 py-0.5 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded"
                        >
                          이력
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 등록/수정/상세보기 모달 — D150-2 Step 2-B BrandTemplateForm 통합 */}
      {(editingTarget || viewingTarget || showCreate) && (
        <BrandTemplateForm
          mode={showCreate ? 'create' : viewingTarget ? 'view' : 'edit'}
          template={editingTarget || viewingTarget || null}
          profiles={profiles}
          setToast={setToast}
          onClose={() => {
            setEditingTarget(null);
            setViewingTarget(null);
            setShowCreate(false);
          }}
          onSuccess={() => {
            setEditingTarget(null);
            setViewingTarget(null);
            setShowCreate(false);
            load();
          }}
        />
      )}

      {/* 이력 조회 모달 (슈퍼관리자 전용) */}
      {historyTarget && (
        <TemplateHistoryModal
          type="brand"
          templateRef={historyTarget.templateKey}
          templateName={historyTarget.templateName}
          onClose={() => setHistoryTarget(null)}
        />
      )}
    </div>
  );
}
