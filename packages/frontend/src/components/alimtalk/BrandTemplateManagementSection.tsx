/**
 * ★ D150-2 (2026-05-09): 브랜드메시지 템플릿 관리 섹션
 *
 * - KakaoRcsPage > 브랜드 템플릿 탭에 렌더
 * - 목록 / 등록 / 수정 / 삭제 / 상세보기 / 이력(슈퍼관리자만)
 * - chatBubbleType 8종: TEXT / IMAGE / WIDE / WIDE_ITEM_LIST / CAROUSEL_FEED / PREMIUM_VIDEO / COMMERCE / CAROUSEL_COMMERCE
 * - 검수 없음 — 등록 즉시 ACTIVE
 *
 * ★ 2026-08-17 라이트 톤 재작성 — 값은 `utils/kakao-ui.ts`가 소유한다(색·높이를 여기 적지 않는다).
 *   빈 상태의 이모지(📢)를 아이콘 + 시작 버튼으로 교체했고, 관리 열 버튼 4개를 대표 1 + ⋯로 접었다.
 *
 * 백엔드:
 *   GET    /api/alimtalk/brand-templates                              (목록)
 *   POST   /api/alimtalk/brand-templates                              (등록 — company_admin)
 *   GET    /api/alimtalk/brand-templates/:templateKey                 (상세)
 *   PUT    /api/alimtalk/brand-templates/:templateKey                 (수정 — company_admin)
 *   DELETE /api/alimtalk/brand-templates/:templateKey                 (삭제 — company_admin)
 *   GET    /api/alimtalk/brand-templates/:templateKey/history         (이력 — super_admin)
 */

import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Copy, Megaphone, Plus, Search } from 'lucide-react';
import TemplateHistoryModal from './TemplateHistoryModal';
import BrandTemplateForm from './BrandTemplateForm';
import { useAuthStore } from '../../stores/authStore';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import EmptyState from '../kakao/EmptyState';
import RowActions, { type RowAction } from '../kakao/RowActions';
import StatusPill from '../kakao/StatusPill';
import {
  KUI_BTN_PRIMARY,
  KUI_CARD,
  KUI_CARDS,
  KUI_CARD_META,
  KUI_CARD_TITLE,
  KUI_CELL_CODE,
  KUI_CELL_META,
  KUI_CELL_NAME,
  KUI_COPY_BTN,
  KUI_FIELD,
  KUI_FIELD_INPUT,
  KUI_LOADING,
  KUI_ONLY_DESKTOP,
  KUI_PANEL,
  KUI_SCROLL_X,
  KUI_SEC_DESC,
  KUI_SEC_TITLE,
  KUI_SELECT,
  KUI_SPINNER,
  KUI_TD,
  KUI_TD_STICKY,
  KUI_TH,
  KUI_TH_RIGHT,
  KUI_TH_STICKY,
  KUI_THEAD,
  KUI_TOTAL,
  KUI_TOTAL_NUM,
  KUI_TR,
  type KuiPillTone,
} from '../../utils/kakao-ui';

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

const STATUS_LABELS: Record<string, { label: string; tone: KuiPillTone }> = {
  ACTIVE:   { label: '정상', tone: 'green' },
  INACTIVE: { label: '중지', tone: 'neutral' },
};

function getToken(): string {
  return localStorage.getItem('token') || '';
}

interface Props {
  profiles: Profile[];
  setToast: (t: { show: boolean; type: 'success' | 'error'; message: string }) => void;
  /** 상위 탭에 건수를 올려준다(표시 전용) */
  onCount?: (n: number) => void;
}

export default function BrandTemplateManagementSection({ profiles, setToast, onCount }: Props) {
  const authUser = useAuthStore((s) => s.user);
  const [templates, setTemplates] = useState<BrandTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [profileFilter, setProfileFilter] = useState<string>(''); // '' = 전체
  const [search, setSearch] = useState('');

  // 등록/수정/상세보기 모달용 state
  const [editingTarget, setEditingTarget] = useState<BrandTemplate | null>(null);
  const [viewingTarget, setViewingTarget] = useState<BrandTemplate | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // 이력 조회 모달 (슈퍼관리자 전용)
  const [historyTarget, setHistoryTarget] = useState<{
    templateKey: string;
    templateName: string;
  } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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

  const filtered = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (profileFilter && t.profile_id !== profileFilter) return false;
      if (kw) {
        const hay = `${t.manage_name || ''} ${t.template_key || ''}`.toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
  }, [templates, profileFilter, search]);

  // 탭 건수는 **전체**를 올린다(필터 결과가 아니라)
  useEffect(() => {
    onCount?.(templates.length);
  }, [templates.length, onCount]);

  const copyKey = (key: string) => {
    navigator.clipboard
      .writeText(key)
      .then(() => {
        setCopiedKey(key);
        setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
      })
      .catch(() => setToast({ show: true, type: 'error', message: '복사 실패 — 직접 선택 후 복사해주세요' }));
  };

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

  /** 대표(0번)는 모든 사용자가 쓸 수 있는 상세보기 — 파괴적 액션은 ⋯ 안으로 */
  const actionsFor = (t: BrandTemplate): RowAction[] => {
    const list: RowAction[] = [{ label: '상세보기', onClick: () => setViewingTarget(t) }];
    if (canManage) {
      list.push({ label: '수정', onClick: () => setEditingTarget(t) });
      list.push({ label: '삭제', onClick: () => remove(t), danger: true });
    }
    if (isSuperAdmin) {
      list.push({
        label: '변경 이력',
        onClick: () =>
          setHistoryTarget({
            templateKey: t.template_key,
            templateName: t.manage_name || t.template_key,
          }),
      });
    }
    return list;
  };

  return (
    <div className="pt-7">
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

      {/* ── 툴바 ─────────────────────────────── */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className={KUI_SEC_TITLE}>브랜드메시지 템플릿</h2>
          <p className={KUI_SEC_DESC}>8종 유형 · 검수 없이 등록 즉시 사용할 수 있습니다</p>
        </div>

        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          <div className="relative">
            <select
              value={profileFilter}
              onChange={(e) => setProfileFilter(e.target.value)}
              className={`${KUI_SELECT} w-auto min-w-[168px]`}
              aria-label="발신프로필 거르기"
            >
              <option value="">전체 발신프로필</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.profile_name}
                </option>
              ))}
            </select>
            <ChevronDown className="w-[13px] h-[13px] text-neutral-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <div className={`${KUI_FIELD} w-full sm:w-52`}>
            <Search className="w-[14px] h-[14px] text-neutral-400 shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="관리명 · 템플릿키 검색"
              className={KUI_FIELD_INPUT}
            />
          </div>

          {canManage && (
            <button type="button" onClick={() => setShowCreate(true)} className={KUI_BTN_PRIMARY}>
              <Plus className="w-[15px] h-[15px]" />
              템플릿 등록
            </button>
          )}
        </div>
      </div>

      {/* ── 목록 ─────────────────────────────── */}
      {loading ? (
        <div className={`${KUI_LOADING} mt-5`}>
          <span className={KUI_SPINNER} />
          불러오는 중
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={Megaphone}
            title={templates.length === 0 ? '등록된 브랜드메시지 템플릿이 없습니다' : '조건에 맞는 템플릿이 없습니다'}
            description={
              templates.length === 0
                ? '텍스트·이미지·와이드·캐러셀 등 8종 중에서 고르면 검수 없이 바로 쓸 수 있습니다.'
                : '발신프로필이나 검색어를 바꿔보세요.'
            }
            actionLabel={templates.length === 0 && canManage ? '첫 템플릿 등록하기' : undefined}
            onAction={templates.length === 0 && canManage ? () => setShowCreate(true) : undefined}
          />
        </div>
      ) : (
        <>
          {/* 데스크톱 표 */}
          <div className={`${KUI_PANEL} ${KUI_ONLY_DESKTOP} mt-5`}>
            <div className={KUI_SCROLL_X}>
              <table className="w-full min-w-[900px]">
                <thead className={KUI_THEAD}>
                  <tr>
                    <th className={KUI_TH}>관리명</th>
                    <th className={KUI_TH}>발신프로필</th>
                    <th className={KUI_TH}>유형</th>
                    <th className={KUI_TH}>상태</th>
                    <th className={KUI_TH_RIGHT}>최종 수정</th>
                    <th className={KUI_TH_STICKY}>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => {
                    const st = STATUS_LABELS[t.status] || { label: t.status, tone: 'neutral' as KuiPillTone };
                    return (
                      <tr key={t.id} className={KUI_TR}>
                        <td className={KUI_TD}>
                          <div className={KUI_CELL_NAME}>{t.manage_name}</div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className={`${KUI_CELL_CODE} truncate max-w-[240px]`}>{t.template_key}</span>
                            <button
                              type="button"
                              onClick={() => copyKey(t.template_key)}
                              className={KUI_COPY_BTN}
                              title="템플릿키 복사"
                              aria-label="템플릿키 복사"
                            >
                              {copiedKey === t.template_key
                                ? <Check className="w-3 h-3 text-emerald-600" />
                                : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </td>
                        <td className={KUI_TD}>
                          <span className="text-[13.5px] text-neutral-800">{t.profile_name || '-'}</span>
                        </td>
                        <td className={KUI_TD}>
                          <span className="text-[13.5px] text-neutral-800">
                            {CHAT_BUBBLE_LABELS[t.chat_bubble_type] || t.chat_bubble_type}
                          </span>
                        </td>
                        <td className={KUI_TD}>
                          <StatusPill label={st.label} tone={st.tone} />
                        </td>
                        <td className={`${KUI_TD} text-right`}>
                          <span className={KUI_CELL_META}>
                            {t.updated_at ? new Date(t.updated_at).toLocaleString('ko-KR') : '-'}
                          </span>
                        </td>
                        <td className={KUI_TD_STICKY}>
                          <RowActions actions={actionsFor(t)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 모바일 카드 */}
          <div className={`${KUI_CARDS} mt-5`}>
            {filtered.map((t) => {
              const st = STATUS_LABELS[t.status] || { label: t.status, tone: 'neutral' as KuiPillTone };
              return (
                <div key={t.id} className={KUI_CARD}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={KUI_CARD_TITLE}>{t.manage_name}</div>
                      <div className={`${KUI_CELL_CODE} mt-0.5 truncate`}>{t.template_key}</div>
                    </div>
                    <StatusPill label={st.label} tone={st.tone} />
                  </div>
                  <div className={KUI_CARD_META}>
                    <span>{t.profile_name || '-'}</span>
                    <span className="text-neutral-300">·</span>
                    <span>{CHAT_BUBBLE_LABELS[t.chat_bubble_type] || t.chat_bubble_type}</span>
                    <span className="text-neutral-300">·</span>
                    <span className="tabular-nums">
                      {t.updated_at ? new Date(t.updated_at).toLocaleDateString('ko-KR') : '-'}
                    </span>
                  </div>
                  <div className="mt-3">
                    <RowActions actions={actionsFor(t)} align="start" />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4">
            <span className={KUI_TOTAL}>총 <b className={KUI_TOTAL_NUM}>{filtered.length}</b>건</span>
          </div>
        </>
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
