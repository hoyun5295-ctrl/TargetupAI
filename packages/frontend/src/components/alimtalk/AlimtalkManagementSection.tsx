/**
 * 알림톡 통합 관리 섹션 (KakaoRcsPage 내 "알림톡 템플릿" 탭에 렌더)
 *
 * 포함:
 *   1) 발신프로필: 고객사 관리자가 직접 Wizard로 IMC 인증 후 등록
 *   2) 템플릿 CRUD + 상태 배지 + 검수요청/취소 플로우
 *   3) 검수 알림 수신자 관리
 *   4) 16조합 동적 폼 (AlimtalkTemplateFormV2) + 실시간 미리보기
 *
 * D130 IMC 연동 백엔드: `/api/alimtalk/*`
 */

import { useEffect, useMemo, useState } from 'react';
import AlimtalkTemplateFormV2, { type TemplateFormData } from './AlimtalkTemplateFormV2';
import AlarmUserManager from './AlarmUserManager';
import SenderRegistrationWizard from './SenderRegistrationWizard';
import TemplateHistoryModal from './TemplateHistoryModal';
import { formatTemplateType } from './alimtalk-types';
import { useAuthStore } from '../../stores/authStore';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';

interface Template {
  id: string;
  template_code: string;
  template_key: string | null;
  template_name: string;
  profile_id: string;
  profile_key: string | null;
  profile_name: string | null;
  category: string | null;
  category_code?: string | null;
  message_type: string;
  emphasize_type: string;
  content: string;
  buttons: any[];
  quick_replies: any[];
  status: string;
  /** ★ CT-87 (2026-06-10): IMC 템플릿 활성상태 (A=정상/R=활성 대기/S=중단/D=삭제) — A 아니면 발송 거부됨 */
  imc_template_status?: string | null;
  reject_reason: string | null;
  extra_content: string | null;
  emphasize_title: string | null;
  emphasize_subtitle: string | null;
  image_url: string | null;
  image_name: string | null;
  template_header: string | null;
  item_highlight: any;
  item_list: any;
  item_summary: any;
  represent_link: {
    urlMobile?: string;
    urlPc?: string;
    schemeAndroid?: string;
    schemeIos?: string;
  } | null;
  preview_message: string | null;
  alarm_phone_numbers: string | null;
  service_mode: string;
  custom_template_code: string | null;
  security_flag: boolean;
  // ★ D143 F (2026-04-30) PDF 0430 알림톡 #3: 등록 폼 하단 코멘트+증빙자료
  inspection_comment: string | null;
  inspection_evidence_filename: string | null;
  created_at: string;
  updated_at: string;
  last_synced_at: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_by_login_id: string | null;
}

interface Profile {
  id: string;
  profile_key: string;
  profile_name: string;
  yellow_id: string | null;
  admin_phone_number: string | null;
  category_name_cache: string | null;
  status: string;
  // ★ 2026-06-17: IMC 동기화 필드 (syncSenderStatusJob). 휴면/차단/브랜드메시지/채널 등록일.
  block_yn: string | null;
  dormant_yn: string | null;
  brand_message_yn: string | null;
  channel_created_at: string | null;
  approval_status: string | null;
  approval_requested_at: string | null;
  approved_at: string | null;
  reject_reason: string | null;
}

interface CategoryOption {
  category_code: string;
  name: string;
  group_name?: string | null;
  inclusion?: string | null;
  exclusion?: string | null;
}

function getToken() {
  return localStorage.getItem('token') || '';
}

// ★ D152-4 Harold님 지시 (2026-05-12): IMC 6단계 정합 (kakao_alimtalk.md 매뉴얼 기반).
//   IMC 정의: REG → REQ → HREJ(내부 반려) | KREQ(카카오 검수요청) → KREJ(카카오 반려) | APR
//   기존 5단계(DRAFT/REQUESTED/REVIEWING/APPROVED/REJECTED) → 6단계 완전 정합.
//   - REVIEWING/REV 폐기 (IMC 정의에 없음 — REQ 다음은 바로 KREQ)
//   - HREJ(내부 반려) / KREQ(카카오 검수요청) / KREJ(카카오 반려) 신규 추가
//   - DORMANT 라벨 유지하되 filter 탭에서는 제거(직원 #4 요청)
const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  // 검수 전
  DRAFT:     { label: '등록',           cls: 'bg-gray-100 text-gray-600' },
  REG:       { label: '등록',           cls: 'bg-gray-100 text-gray-600' },
  // 검수 진행
  REQUESTED: { label: '검수요청',       cls: 'bg-amber-100 text-amber-700' },
  REQ:       { label: '검수요청',       cls: 'bg-amber-100 text-amber-700' },
  KREQ:      { label: '카카오 검수요청', cls: 'bg-blue-100 text-blue-700' },
  // 종결 (승인)
  APPROVED:  { label: '승인',           cls: 'bg-emerald-100 text-emerald-700' },
  APR:       { label: '승인',           cls: 'bg-emerald-100 text-emerald-700' },
  // 종결 (반려) — IMC 6단계 정확 분리
  HREJ:      { label: '내부 반려',      cls: 'bg-orange-100 text-orange-700' },
  KREJ:      { label: '카카오 반려',    cls: 'bg-red-100 text-red-700' },
  // 레거시 호환 (D143 풀네임)
  REJECTED:  { label: '반려',           cls: 'bg-red-100 text-red-700' },
  REJ:       { label: '반려',           cls: 'bg-red-100 text-red-700' },
  REVIEWING: { label: '검수중',         cls: 'bg-blue-100 text-blue-700' },  // 레거시 — 신규 row는 KREQ 사용
  REV:       { label: '검수중',         cls: 'bg-blue-100 text-blue-700' },
  // 기타
  DORMANT:   { label: '휴면',           cls: 'bg-amber-100 text-amber-700' },
  DELETED:   { label: '삭제',           cls: 'bg-gray-200 text-gray-500' },
};

const SENDER_STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING: { label: '승인대기', cls: 'bg-gray-100 text-gray-600' },
  NORMAL:  { label: '정상',     cls: 'bg-emerald-100 text-emerald-700' },
  DORMANT: { label: '휴면',     cls: 'bg-amber-100 text-amber-700' },
  BLOCKED: { label: '차단',     cls: 'bg-red-100 text-red-700' },
  DELETED: { label: '삭제',     cls: 'bg-gray-200 text-gray-500' },
};

// ★ 2026-06-17: IMC 발신프로필 상태 한글 매핑 (status='A' + block_yn/dormant_yn 조합).
//   휴면/차단은 IMC status만으론 구분 불가 → block/dormant boolean 우선 판정.
function senderStatusBadge(p: Profile): { label: string; cls: string } {
  const key =
    p.status === 'D' || p.status === 'DELETED'
      ? 'DELETED'
      : p.block_yn === 'Y'
        ? 'BLOCKED'
        : p.dormant_yn === 'Y'
          ? 'DORMANT'
          : 'NORMAL';
  return SENDER_STATUS_LABELS[key];
}

const APPROVAL_LABELS: Record<string, { label: string; cls: string }> = {
  PENDING_APPROVAL: { label: '슈퍼관리자 승인대기', cls: 'bg-amber-100 text-amber-700' },
  APPROVED:         { label: '승인 완료',           cls: 'bg-emerald-100 text-emerald-700' },
  REJECTED:         { label: '반려',                cls: 'bg-red-100 text-red-700' },
};

export default function AlimtalkManagementSection() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('ALL');

  const [editing, setEditing] = useState<Partial<TemplateFormData> | null | undefined>(undefined);
  // ★ D162-4 (2026-05-15) PDF 0515 알림톡 #1: 반려 상태 재검수 진입 시 메타 정보(반려사유 + 자동 검수요청).
  //   editing state와 분리해 type 영향 최소화. 모달 close/onSuccess 시 editingMeta도 null로 리셋.
  const [editingMeta, setEditingMeta] = useState<{
    rejectReason: string | null;
    autoInspect: boolean;
  } | null>(null);
  // ★ D139 #4-1 (0425): 상세보기(read-only) 전용 state — 수정 모달과 분리.
  //   동일 폼 컴포넌트 AlimtalkTemplateFormV2를 readOnly prop으로 재사용.
  const [viewing, setViewing] = useState<Partial<TemplateFormData> | null>(null);
  const [showAlarm, setShowAlarm] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  // ★ D142+ F (2026-04-29): 검수요청 시 코멘트 + 증빙자료 입력 모달용 state
  const [inspectionTarget, setInspectionTarget] = useState<Template | null>(null);
  const [inspectionComment, setInspectionComment] = useState('');
  const [inspectionFile, setInspectionFile] = useState<File | null>(null);
  const [inspectionSubmitting, setInspectionSubmitting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  // ★ 2026-07-02 (직원 서수란 신고): 여러 템플릿 일괄 검수요청 — 등록(DRAFT/REG) 행 다중 선택 + 한 번에 요청.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);

  // ★ D150-2 (2026-05-09): 슈퍼관리자 전용 변경 이력 조회 모달
  const [historyTarget, setHistoryTarget] = useState<{
    templateCode: string;
    templateName: string;
  } | null>(null);

  // ★ D162-4 (2026-05-15) 2차: 반려사유 상세 모달 — Harold님 명시 정합.
  //   row에 반려사유 펼쳐 표시하던 영역 제거 → 관리 컬럼 '반려사유' 버튼 클릭 시 적정 사이즈 모달 노출 (스크롤 가능).
  const [rejectReasonTarget, setRejectReasonTarget] = useState<{
    templateName: string;
    rejectReason: string;
    status: string;
  } | null>(null);

  // ★ D188 (2026-05-21) 영업팀장 신고 #4: 템플릿 검색 UI — 4 영역 선택(templateName/content/templateCode/customTemplateCode) + 검색어 input.
  //   클라이언트 측 filter (templates useMemo 합성) — 서버 API 추가 호출 X. 운영 환경 템플릿 수 수십~수백 건 = 클라이언트 filter 정합.
  type SearchType = 'templateName' | 'content' | 'templateCode' | 'customTemplateCode';
  const [searchType, setSearchType] = useState<SearchType>('templateName');
  const [searchKeyword, setSearchKeyword] = useState('');

  // 내 회사 정보 (Wizard에 전달) — authStore에서 직접 참조 (별도 API 호출 불필요)
  const authUser = useAuthStore((s) => s.user);
  const myCompany = useMemo(
    () =>
      authUser?.company?.id
        ? { id: authUser.company.id, company_name: authUser.company.name || '' }
        : null,
    [authUser],
  );
  // ★ 2026-04-21 Harold님 지시: 발신프로필/템플릿 등록은 고객사관리자(admin)만.
  //   백엔드 requireCompanyAdmin(company_admin || super_admin)과 완전 동일한 조건.
  const canManage =
    authUser?.userType === 'company_admin' || authUser?.userType === 'super_admin';

  const load = async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const [tRes, pRes, cRes] = await Promise.all([
        fetch('/api/alimtalk/templates', { headers }),
        fetch('/api/alimtalk/senders', { headers }),
        fetch('/api/alimtalk/categories/template', { headers }),
      ]);
      const tData = await tRes.json();
      if (tRes.ok && tData.success) setTemplates(tData.templates || []);

      const pData = await pRes.json();
      if (pRes.ok && pData.success) setProfiles(pData.profiles || []);

      const cData = await cRes.json();
      if (cRes.ok && cData.success) setCategories(cData.categories || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ★ 2026-07-02 일괄 검수요청: 필터/검색 변경 시 선택 초기화 — 숨겨진 행이 선택에 남지 않도록.
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter, searchType, searchKeyword]);

  // ★ D152-4 Harold님 지시 (2026-05-12): IMC 6단계 정합 — filter 탭 ↔ DB status 매핑.
  //   IMC raw(REG/REQ/KREQ/KREJ/HREJ/APR) + 한줄로 풀네임(DRAFT/REQUESTED/REVIEWING/APPROVED/REJECTED) 양쪽 호환.
  //   레거시 REJECTED/REJ는 "카카오 반려"(KREJ) 탭에 흡수 — 운영 데이터 손실 없이 6단계 UI 정합.
  const FILTER_MATCH: Record<string, string[]> = {
    DRAFT:     ['DRAFT', 'REG'],
    REQUESTED: ['REQUESTED', 'REQ', 'REVIEWING', 'REV'],  // 내부 검수 중
    KREQ:      ['KREQ'],                                   // 카카오 검수 중 (내부 검수 통과 후)
    APPROVED:  ['APPROVED', 'APR'],
    HREJ:      ['HREJ'],                                   // 내부 반려
    KREJ:      ['KREJ', 'REJECTED', 'REJ'],                // 카카오 반려 (레거시 REJ 흡수)
  };

  const filtered = useMemo(() => {
    const byStatus =
      filter === 'ALL'
        ? templates
        : templates.filter((t) => (FILTER_MATCH[filter] || [filter]).includes(t.status));
    // ★ D188 (2026-05-21) 영업팀장 신고 #4: 검색 keyword 합성 — 4 영역 lowercase 부분 일치.
    const kw = searchKeyword.trim().toLowerCase();
    if (!kw) return byStatus;
    return byStatus.filter((t) => {
      const fieldValue =
        searchType === 'templateName'       ? (t.template_name || '') :
        searchType === 'content'            ? (t.content || '') :
        searchType === 'templateCode'       ? (t.template_code || '') :
        searchType === 'customTemplateCode' ? (t.custom_template_code || '') :
        '';
      return String(fieldValue).toLowerCase().includes(kw);
    });
  }, [templates, filter, searchType, searchKeyword]);

  // ★ 2026-07-02 일괄 검수요청 — 현재 목록 중 검수요청 가능(등록 DRAFT/REG) 행만 대상.
  //   개별 '검수요청' 버튼 노출 기준(isDraft)과 동일. 반려 건은 본문 수정이 필요해 '재검수' 개별 흐름 유지.
  const bulkEligible = useMemo(
    () => filtered.filter((t) => ['DRAFT', 'REG'].includes(t.status)),
    [filtered],
  );
  const allEligibleSelected =
    bulkEligible.length > 0 && bulkEligible.every((t) => selectedIds.has(t.id));
  const someEligibleSelected = bulkEligible.some((t) => selectedIds.has(t.id));

  // ★ D142+ F (2026-04-29) PDF 0428 알림톡 #3: 검수요청 시 코멘트 + 증빙자료 입력 모달.
  //   "코멘트 입력칸 + 코멘트 증빙자료 추가" — 직원 요구. backend는 이미 /inspect-with-file 보유.
  // ★ D152-4 (2026-05-12): IMC 매뉴얼 정합 — 검수요청 가능 = REG/HREJ/KREJ + 레거시 DRAFT/REJECTED/REJ.
  //   "검수요청은 검수상태가 등록(REG), 내부 반려(HREJ), 카카오 반려(KREJ) 상태에서만 가능합니다."
  const inspect = (t: Template) => {
    if (!['DRAFT', 'REG', 'REJECTED', 'REJ', 'HREJ', 'KREJ'].includes(t.status)) {
      setToast('등록/반려 상태에서만 검수요청 가능');
      return;
    }
    setInspectionTarget(t);
    setInspectionComment('');
    setInspectionFile(null);
  };

  const submitInspection = async () => {
    if (!inspectionTarget) return;
    setInspectionSubmitting(true);
    try {
      let res;
      if (inspectionFile) {
        const fd = new FormData();
        fd.append('file', inspectionFile);
        fd.append('comment', inspectionComment || '');
        res = await fetch(
          `/api/alimtalk/templates/${inspectionTarget.template_code}/inspect-with-file`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${getToken()}` },
            body: fd,
          },
        );
      } else {
        res = await fetch(
          `/api/alimtalk/templates/${inspectionTarget.template_code}/inspect`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${getToken()}`,
            },
            body: JSON.stringify({ comment: inspectionComment || '' }),
          },
        );
      }
      const data = await res.json();
      setToast(data.success ? '검수요청 완료' : data?.error || '실패');
      if (data.success) {
        setInspectionTarget(null);
        setInspectionComment('');
        setInspectionFile(null);
        load();
      }
    } catch (e: any) {
      setToast(e?.message || '검수요청 중 오류');
    } finally {
      setInspectionSubmitting(false);
    }
  };

  const cancelInspect = (t: Template) => {
    setConfirm({
      mode: 'warning',
      title: '검수요청 취소',
      description: '검수요청을 취소할까요?',
      confirmLabel: '취소 요청',
      onConfirm: async () => {
        const res = await fetch(
          `/api/alimtalk/templates/${t.template_code}/cancel-inspect`,
          { method: 'PUT', headers: { Authorization: `Bearer ${getToken()}` } },
        );
        const data = await res.json();
        setToast(data.success ? '검수요청 취소' : data?.error || '실패');
        load();
      },
    });
  };

  // ★ 2026-07-02 일괄 검수요청 선택 토글 (개별/전체).
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected =
        bulkEligible.length > 0 && bulkEligible.every((t) => prev.has(t.id));
      if (allSelected) bulkEligible.forEach((t) => next.delete(t.id));
      else bulkEligible.forEach((t) => next.add(t.id));
      return next;
    });
  };

  // 선택된 등록 행에 순차로 POST /inspect. 진행률 표시 + 성공/실패 요약 토스트.
  const runBulkInspect = async () => {
    const targets = bulkEligible.filter((t) => selectedIds.has(t.id));
    if (targets.length === 0) return;
    setBulkSubmitting(true);
    setBulkProgress({ done: 0, total: targets.length });
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      try {
        const res = await fetch(
          `/api/alimtalk/templates/${t.template_code}/inspect`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${getToken()}`,
            },
            body: JSON.stringify({ comment: '' }),
          },
        );
        const data = await res.json();
        if (res.ok && data.success) ok++;
        else fail++;
      } catch {
        fail++;
      }
      setBulkProgress({ done: i + 1, total: targets.length });
    }
    setBulkSubmitting(false);
    setBulkProgress(null);
    setSelectedIds(new Set());
    setToast(fail === 0 ? `${ok}건 검수요청 완료` : `${ok}건 완료 · ${fail}건 실패`);
    load();
  };
  const confirmBulkInspect = () => {
    const count = bulkEligible.filter((t) => selectedIds.has(t.id)).length;
    if (count === 0) return;
    setConfirm({
      mode: 'default',
      title: '일괄 검수요청',
      description: `선택한 ${count}개 템플릿을 카카오 검수요청 합니다. 계속할까요?`,
      confirmLabel: `${count}개 검수요청`,
      onConfirm: runBulkInspect,
    });
  };

  const remove = (t: Template) => {
    // ★ D139 #4-1 (0425): 삭제는 등록(DRAFT) 상태에서만 허용 (직원 검수 요청 정책).
    // ★ D152-4 (2026-05-12): IMC 6단계 정합 — DRAFT + REG(IMC raw) 둘 다 허용.
    if (!['DRAFT', 'REG'].includes(t.status)) {
      setToast('등록 상태에서만 삭제할 수 있습니다.');
      return;
    }
    setConfirm({
      mode: 'danger',
      title: '템플릿 삭제',
      description: `'${t.template_name || t.template_code}' 템플릿을 삭제할까요?`,
      confirmLabel: '삭제',
      onConfirm: async () => {
        const res = await fetch(`/api/alimtalk/templates/${t.template_code}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        const data = await res.json();
        setToast(data.success ? '삭제 완료' : data?.error || '실패');
        load();
      },
    });
  };

  const toFormData = (t: Template): Partial<TemplateFormData> => ({
    id: t.id,
    template_code: t.template_code,
    template_key: t.template_key || undefined,
    profile_id: t.profile_id,
    manageName: t.template_name,
    customTemplateCode: t.custom_template_code || '',
    categoryCode: t.category_code || t.category || '',
    messageType: t.message_type as any,
    emphasizeType: t.emphasize_type as any,
    content: t.content || '',
    previewMessage: t.preview_message || '',
    extra: t.extra_content || '',
    templateTitle: t.emphasize_title || '',
    templateSubtitle: t.emphasize_subtitle || '',
    imageUrl: t.image_url || '',
    imageName: t.image_name || '',
    header: t.template_header || '',
    highlight: t.item_highlight || null,
    itemList: Array.isArray(t.item_list) ? t.item_list : [],
    summary: t.item_summary || null,
    buttons: Array.isArray(t.buttons) ? t.buttons : [],
    securityFlag: t.security_flag || false,
    // ★ D135+ (B4): 대표링크 복원 (JSONB represent_link)
    representLinkEnabled: !!t.represent_link?.urlMobile,
    representLinkMobile: t.represent_link?.urlMobile || '',
    representLinkPc: t.represent_link?.urlPc || '',
    representLinkIosScheme: t.represent_link?.schemeIos || '',
    representLinkAndroidScheme: t.represent_link?.schemeAndroid || '',
    // ★ D143 F (2026-04-30) PDF 0430 #3: 등록 폼 하단 코멘트+증빙자료 (수정/상세보기 시 복원)
    inspectionComment: t.inspection_comment || '',
    inspectionEvidenceFilename: t.inspection_evidence_filename || '',
  });

  const canRegisterTemplate = profiles.length > 0;

  return (
    <div className="space-y-5">
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />
      {/* ── 발신프로필 ───────────────────────────── */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">👤</span>
            <h3 className="text-sm font-bold text-gray-800">발신프로필</h3>
            <span className="text-xs text-gray-400">
              카카오톡 채널을 연결하면 즉시 사용 가능합니다
            </span>
          </div>
          {/* ★ 권한: 고객사관리자(company_admin/super_admin)만 발신프로필 등록 가능 */}
          {canManage && (
            <button
              type="button"
              onClick={() => setShowWizard(true)}
              className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg text-xs font-medium transition"
            >
              + 발신프로필 등록
            </button>
          )}
        </div>

        {profiles.length === 0 ? (
          <div className="text-center py-4 text-gray-400 text-sm">
            {canManage ? (
              <>
                등록된 발신프로필이 없습니다. 카카오 채널 ID(@시작)와 관리자 휴대폰을 준비하신 후
                <strong className="text-amber-600"> "+ 발신프로필 등록"</strong>을 눌러주세요.
              </>
            ) : (
              <>등록된 발신프로필이 없습니다. 고객사관리자에게 발신프로필 등록을 요청해주세요.</>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="text-left px-3 py-2">프로필</th>
                  <th className="text-left px-3 py-2">채널ID</th>
                  <th className="text-left px-3 py-2">카테고리</th>
                  <th className="text-center px-3 py-2">승인</th>
                  <th className="text-center px-3 py-2">상태</th>
                  <th className="text-center px-3 py-2">브랜드메시지</th>
                  <th className="text-center px-3 py-2">등록일</th>
                </tr>
              </thead>
              <tbody>
                {profiles.map((p) => {
                  // ★ 2026-06-17: 080 무료수신거부 컬럼 제거(고객사 화면). 대신 IMC 상태/브랜드메시지/등록일 노출.
                  //   상태 = syncSenderStatusJob이 IMC status+block+dormant를 DB 동기화 → senderStatusBadge로 한글 매핑.
                  const ap = APPROVAL_LABELS[p.approval_status || 'PENDING_APPROVAL'] || {
                    label: p.approval_status || '-',
                    cls: 'bg-gray-100 text-gray-500',
                  };
                  const sb = senderStatusBadge(p);
                  return (
                    <tr key={p.id} className="border-t border-gray-100">
                      <td className="px-3 py-2">
                        <div className="font-medium text-gray-800">{p.profile_name}</div>
                        {/* ★ D218+ (2026-05-26) PDF 신고 #3: 발신프로필 키값 전체 노출 + 복사 버튼 추가. */}
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <div className="text-[10px] text-gray-400 font-mono break-all flex-1 min-w-0">
                            {p.profile_key || '-'}
                          </div>
                          {p.profile_key && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard
                                  .writeText(p.profile_key!)
                                  .then(() => setToast('발신프로필 키값 복사 완료'))
                                  .catch(() => setToast('복사 실패 — 직접 선택 후 복사해주세요'));
                              }}
                              className="px-1.5 py-0.5 text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-600 rounded transition shrink-0"
                              title="발신프로필 키값 복사"
                            >
                              복사
                            </button>
                          )}
                        </div>
                        {p.approval_status === 'REJECTED' && p.reject_reason && (
                          <div className="text-[11px] text-red-500 mt-0.5">
                            반려: {p.reject_reason}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-600">
                        {p.yellow_id || '-'}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {p.category_name_cache || '-'}
                      </td>
                      <td className="text-center px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded ${ap.cls}`}>
                          {ap.label}
                        </span>
                      </td>
                      {/* 상태 — IMC status + block + dormant */}
                      <td className="text-center px-3 py-2">
                        <span className={`inline-block px-2 py-0.5 rounded ${sb.cls}`}>
                          {sb.label}
                        </span>
                      </td>
                      {/* 브랜드메시지 사용 여부 */}
                      <td className="text-center px-3 py-2">
                        {p.brand_message_yn === 'Y' ? (
                          <span className="text-emerald-600">사용</span>
                        ) : (
                          <span className="text-gray-300">미사용</span>
                        )}
                      </td>
                      {/* 등록일 — 카카오 채널 생성일 */}
                      <td className="text-center px-3 py-2 text-gray-600">
                        {p.channel_created_at ? p.channel_created_at.slice(0, 10) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* 승인 안내 */}
            {profiles.some((p) => p.approval_status === 'PENDING_APPROVAL') && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                ℹ️ <strong>슈퍼관리자 승인 대기 중</strong>인 발신프로필은 템플릿 등록·발송에 사용할 수 없습니다. 승인 완료 후 자동으로 활성화됩니다.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── 필터 + 버튼 ─────────────────────────── */}
      {/* ★ D152-4 Harold님 지시 (2026-05-12): IMC 6단계 정합 — 직원 5/12 PDF #3/#4/#5 동시 처리.
            #3 "검수중 → 카카오 검수요청 으로 변경" — REVIEWING 폐기, KREQ 신규 탭
            #4 "휴면 삭제" — DORMANT 탭 제거 (라벨은 유지)
            #5 "카카오 반려 메뉴 추가" — KREJ 신규 탭 (HREJ '내부 반려'와 분리)
            filter 시 IMC raw + 한줄로 풀네임 양쪽 매칭으로 호환 (filtered useMemo) */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex flex-wrap gap-1 text-xs">
          {(['ALL', 'DRAFT', 'REQUESTED', 'KREQ', 'APPROVED', 'HREJ', 'KREJ'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-full font-medium transition ${
                filter === s
                  ? 'bg-amber-600 text-white'
                  : 'bg-white border border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {s === 'ALL' ? '전체' : STATUS_LABELS[s]?.label || s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* ★ D188 (2026-05-21) 영업팀장 신고 #4: 검색 UI — 4 영역 select + input. 클라이언트 측 filter. */}
          <div className="flex items-center gap-1 bg-white border border-gray-300 rounded-lg overflow-hidden text-xs">
            <select
              value={searchType}
              onChange={(e) => setSearchType(e.target.value as SearchType)}
              className="px-2 py-1.5 text-xs bg-white border-0 focus:outline-none focus:ring-0 text-gray-700"
            >
              <option value="templateName">템플릿명</option>
              <option value="content">템플릿 문구</option>
              <option value="templateCode">템플릿코드</option>
              <option value="customTemplateCode">고객사관리코드</option>
            </select>
            <div className="w-px h-4 bg-gray-200" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="검색어"
              className="px-2 py-1.5 text-xs w-36 border-0 focus:outline-none focus:ring-0 placeholder:text-gray-400"
            />
            {searchKeyword && (
              <button
                type="button"
                onClick={() => setSearchKeyword('')}
                className="px-2 py-1.5 text-xs text-gray-400 hover:text-gray-600"
                aria-label="검색 초기화"
              >
                ×
              </button>
            )}
          </div>
          {/* ★ 검수 알림 수신자 관리 + 템플릿 등록: 고객사관리자만 (백엔드 requireCompanyAdmin) */}
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setShowAlarm(true)}
                className="px-3 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg"
              >
                검수 알림 수신자
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={!canRegisterTemplate}
                className="px-4 py-1.5 text-sm bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium transition disabled:opacity-50"
                title={canRegisterTemplate ? undefined : '발신프로필을 먼저 등록하세요'}
              >
                + 템플릿 등록
              </button>
            </>
          )}
        </div>
      </div>

      {/* ★ 2026-07-02 일괄 검수요청 액션 바 — 등록 행을 하나라도 선택하면 노출 */}
      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <span className="text-xs font-medium text-amber-800">
            {selectedIds.size}개 선택됨
            {bulkProgress && ` · 처리 중 ${bulkProgress.done}/${bulkProgress.total}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkSubmitting}
              className="px-3 py-1.5 text-xs bg-white border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              선택 해제
            </button>
            <button
              type="button"
              onClick={confirmBulkInspect}
              disabled={bulkSubmitting}
              className="px-4 py-1.5 text-xs bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-medium disabled:opacity-50"
            >
              {bulkSubmitting ? '검수요청 중...' : '일괄 검수요청'}
            </button>
          </div>
        </div>
      )}

      {/* ── 목록 ───────────────────────────────── */}
      {loading ? (
        <div className="text-center py-10 text-sm text-gray-400">로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
          <div className="text-4xl mb-2">💬</div>
          <p className="text-sm text-gray-500">
            {filter === 'ALL'
              ? '등록된 알림톡 템플릿이 없습니다'
              : '해당 상태의 템플릿이 없습니다'}
          </p>
          {filter === 'ALL' && (
            <p className="text-xs text-gray-400 mt-1">
              템플릿을 등록하면 카카오 검수 후 발송에 사용할 수 있습니다
            </p>
          )}
        </div>
      ) : (
        // ★ D188-fix2 (2026-05-21) 영업팀장 추가 신고: 템플릿코드 컬럼 추가로 가로 폭 초과 → 헤더/등록일시/관리 줄바꿈 사고.
        //   영구 fix = overflow-x-auto 가로 스크롤 안전망 + 모든 td/th에 whitespace-nowrap + 작은 폰트 (text-xs 통일).
        <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-[11px] text-gray-500">
              <tr>
                {/* ★ 2026-07-02 일괄 검수요청: 등록 행 전체 선택 체크박스 */}
                <th className="px-3 py-2 whitespace-nowrap w-8">
                  <input
                    type="checkbox"
                    aria-label="등록 상태 템플릿 전체 선택"
                    checked={allEligibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allEligibleSelected && someEligibleSelected;
                    }}
                    onChange={toggleSelectAll}
                    disabled={bulkEligible.length === 0}
                    className="cursor-pointer accent-amber-600 disabled:cursor-not-allowed disabled:opacity-30"
                  />
                </th>
                <th className="text-left px-3 py-2 whitespace-nowrap">템플릿</th>
                {/* ★ D188 (2026-05-21) 영업팀장 신고 #3: 템플릿코드 컬럼 신규 — 사용자가 발송 매칭/디버그용 표시 정합. */}
                <th className="text-left px-3 py-2 whitespace-nowrap">템플릿코드</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">프로필</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">등록자</th>
                <th className="text-center px-3 py-2 whitespace-nowrap">유형</th>
                <th className="text-center px-3 py-2 whitespace-nowrap">상태</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">등록일시</th>
                <th className="text-left px-3 py-2 whitespace-nowrap">업데이트</th>
                <th className="text-right px-3 py-2 whitespace-nowrap">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const st = STATUS_LABELS[t.status] || {
                  label: t.status,
                  cls: 'bg-gray-100 text-gray-500',
                };
                // ★ D139 #4-1 (0425) + D152-4 (2026-05-12): 상태별 액션 버튼 노출 분기.
                //   IMC 6단계 정합 (kakao_alimtalk.md 매뉴얼):
                //     DRAFT/REG(등록): 수정 / 검수요청 / 삭제 / 상세보기
                //     REQUESTED/REQ/REVIEWING/REV(내부 검수 중): 검수요청 취소 / 상세보기
                //     KREQ(카카오 검수 중): 상세보기만 (카카오 측 검수 진행 — 취소/수정 불가)
                //     HREJ(내부 반려) / KREJ(카카오 반려) / REJECTED/REJ: 재검수 / 상세보기
                //     APPROVED/APR(승인): 상세보기만
                const isDraft = ['DRAFT', 'REG'].includes(t.status);
                const isReq   = ['REQUESTED', 'REQ', 'REVIEWING', 'REV'].includes(t.status);
                const isKreq  = t.status === 'KREQ';
                const isRej   = ['REJECTED', 'REJ', 'HREJ', 'KREJ'].includes(t.status);
                void isKreq; // KREQ는 액션 버튼 미노출(상세보기만) — 상태 라벨로만 표시
                return (
                  <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                    {/* ★ 2026-07-02 일괄 검수요청: 등록(DRAFT/REG) 행만 선택 가능 */}
                    <td className="px-3 py-2 whitespace-nowrap w-8">
                      {isDraft && (
                        <input
                          type="checkbox"
                          aria-label={`${t.template_name} 선택`}
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          className="cursor-pointer accent-amber-600"
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <div className="font-medium text-gray-900 text-xs">{t.template_name}</div>
                      {/* ★ D162-4 (2026-05-15) 2차: Harold님 명시 정합 — 반려사유 펼침 영역 제거.
                          row에 길게 펼쳐지던 사유 글씨가 화면 어지러움 유발. 관리 컬럼의 '반려사유' 버튼 클릭 시 모달로 상세 노출. */}
                      {t.custom_template_code && (
                        <div className="text-[10px] text-gray-400 font-mono mt-0.5">
                          고객사: {t.custom_template_code}
                        </div>
                      )}
                    </td>
                    {/* ★ D188 (2026-05-21) 영업팀장 신고 #3: 템플릿코드 컬럼 row. font-mono + 작은 텍스트 + select-text. */}
                    <td className="px-3 py-2 font-mono text-[10px] text-gray-500 select-text cursor-text whitespace-nowrap">
                      {t.template_code || '-'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-600 whitespace-nowrap">
                      {t.profile_name || '-'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-600 whitespace-nowrap">
                      {t.created_by_name ? (
                        <>
                          <div>{t.created_by_name}</div>
                          {t.created_by_login_id && (
                            <div className="text-[10px] text-gray-400 font-mono">
                              {t.created_by_login_id}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
                    </td>
                    <td className="text-center px-3 py-2 text-[11px] text-gray-600 whitespace-nowrap">
                      {formatTemplateType(t.message_type, t.emphasize_type)}
                    </td>
                    <td className="text-center px-3 py-2 whitespace-nowrap">
                      <span
                        className={`inline-block text-[10px] px-2 py-0.5 rounded ${st.cls}`}
                      >
                        {st.label}
                      </span>
                      {/* ★ CT-87 (2026-06-10): 검수 승인이어도 카카오 활성상태가 A가 아니면 발송 불가 — 실상태 병기.
                          (검수 승인인데 활성 대기 R이라 발송이 전부 7300으로 실패하던 사례의 화면 안전망) */}
                      {['APPROVED', 'APR'].includes(t.status) && t.imc_template_status && t.imc_template_status !== 'A' && (
                        <span
                          className={`inline-block text-[10px] px-2 py-0.5 rounded ml-1 ${
                            t.imc_template_status === 'R' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'
                          }`}
                          title="카카오 측 템플릿 활성상태가 A(정상)가 아니면 발송이 거부됩니다. 카카오 검수팀에 활성 전환을 요청해주세요."
                        >
                          {t.imc_template_status === 'R' ? '활성 대기 · 발송불가' : t.imc_template_status === 'S' ? '중단 · 발송불가' : `${t.imc_template_status} · 발송불가`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-500 whitespace-nowrap">
                      {t.created_at
                        ? new Date(t.created_at).toLocaleString('ko-KR')
                        : '-'}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-gray-500 whitespace-nowrap">
                      {t.updated_at
                        ? new Date(t.updated_at).toLocaleString('ko-KR')
                        : '-'}
                    </td>
                    <td className="text-right px-3 py-2 whitespace-nowrap">
                      <div className="inline-flex flex-nowrap gap-1 items-center">
                      {/* 상세보기: 모든 상태에서 노출 (read-only 모달) */}
                      <button
                        type="button"
                        onClick={() => setViewing(toFormData(t))}
                        className="text-[11px] px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded"
                      >
                        상세보기
                      </button>
                      {/* 수정: DRAFT(등록)에서만 */}
                      {isDraft && (
                        <button
                          type="button"
                          onClick={() => setEditing(toFormData(t))}
                          className="text-[11px] px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded"
                        >
                          수정
                        </button>
                      )}
                      {/* 검수요청: DRAFT 전용 */}
                      {isDraft && (
                        <button
                          type="button"
                          onClick={() => inspect(t)}
                          className="text-[11px] px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded"
                        >
                          검수요청
                        </button>
                      )}
                      {/* 검수요청 취소: REQUESTED/REVIEWING */}
                      {isReq && (
                        <button
                          type="button"
                          onClick={() => cancelInspect(t)}
                          className="text-[11px] px-2 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded"
                        >
                          검수요청 취소
                        </button>
                      )}
                      {/* ★ D162-4 (2026-05-15) 2차: 반려사유 확인 버튼 — Harold님 명시 정합.
                          반려 상태 + 사유가 있을 때만 노출. 클릭 시 적정 사이즈 모달(스크롤 가능)로 상세 노출. */}
                      {isRej && t.reject_reason && (
                        <button
                          type="button"
                          onClick={() =>
                            setRejectReasonTarget({
                              templateName: t.template_name || t.template_code,
                              rejectReason: t.reject_reason || '',
                              status: t.status,
                            })
                          }
                          className="text-[11px] px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-600 rounded"
                        >
                          반려사유
                        </button>
                      )}
                      {/* ★ D162-4 (2026-05-15) PDF 0515 알림톡 #1: 재검수 버튼 = 풀 폼 진입 + 반려사유 노출 + 저장 후 자동 검수요청.
                          기존엔 inspect(t) → 작은 검수요청 모달(코멘트+증빙자료만)로 본문 수정 동선이 없던 사고.
                          이제 setEditing + setEditingMeta로 풀 폼(AlimtalkTemplateFormV2 editing mode)에 들어가 본문 수정 후
                          저장하면 autoInspectAfterSave 분기로 자동 POST /inspect 호출 → 재검수 요청 완료. */}
                      {isRej && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(toFormData(t));
                            setEditingMeta({
                              rejectReason: t.reject_reason,
                              autoInspect: true,
                            });
                          }}
                          className="text-[11px] px-2 py-0.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded"
                        >
                          재검수
                        </button>
                      )}
                      {/* 삭제: DRAFT 전용 (remove 함수 내 이중 가드) */}
                      {isDraft && (
                        <button
                          type="button"
                          onClick={() => remove(t)}
                          className="text-[11px] px-2 py-0.5 bg-red-50 hover:bg-red-100 text-red-600 rounded"
                        >
                          삭제
                        </button>
                      )}
                      {/* ★ D150-2 (2026-05-09): 변경 이력 (슈퍼관리자만, 모든 상태 노출) */}
                      {authUser?.userType === 'super_admin' && (
                        <button
                          type="button"
                          onClick={() =>
                            setHistoryTarget({
                              templateCode: t.template_code,
                              templateName: t.template_name || t.template_code,
                            })
                          }
                          className="text-[11px] px-2 py-0.5 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded"
                        >
                          이력
                        </button>
                      )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 모달들 */}
      {editing !== undefined && (
        <AlimtalkTemplateFormV2
          template={editing}
          profiles={profiles}
          categories={categories}
          rejectReason={editingMeta?.rejectReason ?? null}
          autoInspectAfterSave={editingMeta?.autoInspect ?? false}
          onClose={() => {
            setEditing(undefined);
            setEditingMeta(null);
          }}
          onSuccess={() => {
            const wasAutoInspect = editingMeta?.autoInspect;
            setEditing(undefined);
            setEditingMeta(null);
            setToast(wasAutoInspect ? '수정 + 재검수 요청 완료' : '저장 완료');
            load();
          }}
        />
      )}

      {/* ★ D139 #4-1 (0425): 상세보기 read-only 모달 — 모든 상태에서 노출 */}
      {viewing && (
        <AlimtalkTemplateFormV2
          template={viewing}
          profiles={profiles}
          categories={categories}
          readOnly
          onClose={() => setViewing(null)}
          onSuccess={() => setViewing(null)}
        />
      )}

      {/* ★ D150-2 (2026-05-09): 슈퍼관리자 전용 변경 이력 조회 모달 */}
      {historyTarget && (
        <TemplateHistoryModal
          type="alimtalk"
          templateRef={historyTarget.templateCode}
          templateName={historyTarget.templateName}
          onClose={() => setHistoryTarget(null)}
        />
      )}

      {/* ★ D162-4 (2026-05-15) 2차: 반려사유 상세 모달 — Harold님 명시 정합.
          row에 펼쳐 표시하던 사유를 별도 모달로 분리. max-w-2xl + max-h 80vh + overflow-y-auto로 긴 사유도 스크롤 안정. */}
      {rejectReasonTarget && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden"
            style={{ animation: 'zoomIn 0.2s ease-out' }}
          >
            {/* 헤더 */}
            <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-red-50 to-white flex justify-between items-center shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <span className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center text-lg shrink-0">
                  ⚠
                </span>
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-gray-900 truncate">
                    {STATUS_LABELS[rejectReasonTarget.status]?.label || '반려'} 사유
                  </h3>
                  <p className="text-xs text-gray-500 mt-0.5 truncate">
                    템플릿: {rejectReasonTarget.templateName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRejectReasonTarget(null)}
                className="text-gray-400 hover:text-gray-600 text-2xl shrink-0 ml-2"
                aria-label="닫기"
              >
                &times;
              </button>
            </div>

            {/* 본문 — 스크롤 영역 */}
            <div className="px-6 py-5 overflow-y-auto flex-1">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-900 leading-relaxed whitespace-pre-wrap">
                {rejectReasonTarget.rejectReason}
              </div>
              <p className="mt-3 text-[11px] text-gray-500 leading-relaxed">
                ℹ 본 사유는 카카오 검수팀이 전달한 내용입니다. 본문 수정 후 '재검수' 버튼으로 다시 검수 요청할 수 있습니다.
              </p>
            </div>

            {/* 푸터 */}
            <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setRejectReasonTarget(null)}
                className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
              >
                닫기
              </button>
            </div>
          </div>
          <style>{`
            @keyframes zoomIn {
              from { opacity: 0; transform: scale(0.96); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>
        </div>
      )}

      {/* ★ D142+ F (2026-04-29): 검수요청 시 코멘트 + 증빙자료 입력 모달 (PDF 0428 알림톡 #3) */}
      {inspectionTarget && (
        <div
          className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center animate-in fade-in duration-150"
        >
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 p-6 animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">검수요청</h3>
            <p className="text-xs text-gray-500 mb-2 truncate">
              {inspectionTarget.template_name}
            </p>

            {/* ★ D143 F (2026-04-30) PDF 0430 #3: 등록 폼 하단에서 입력한 정보 자동 사용 안내 */}
            {(inspectionTarget.inspection_comment || inspectionTarget.inspection_evidence_filename) && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 leading-relaxed">
                💡 등록 시 입력한 정보가 자동으로 카카오에 전달됩니다.
                {inspectionTarget.inspection_comment && (
                  <div className="mt-1 truncate">
                    <span className="font-medium">코멘트:</span> {inspectionTarget.inspection_comment.slice(0, 80)}{inspectionTarget.inspection_comment.length > 80 ? '…' : ''}
                  </div>
                )}
                {inspectionTarget.inspection_evidence_filename && (
                  <div className="mt-0.5 truncate">
                    <span className="font-medium">증빙자료:</span> {inspectionTarget.inspection_evidence_filename}
                  </div>
                )}
                <div className="mt-1 text-amber-600">아래에서 추가/수정도 가능합니다.</div>
              </div>
            )}

            <label className="block text-xs font-semibold text-gray-700 mb-1">
              코멘트 <span className="text-gray-400 font-normal">(생략 가능)</span>
            </label>
            <textarea
              value={inspectionComment}
              onChange={(e) => setInspectionComment(e.target.value)}
              placeholder="정보성 메시지에 대한 근거 정보(생략가능)"
              rows={4}
              disabled={inspectionSubmitting}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 outline-none disabled:bg-gray-50"
            />

            <label className="block text-xs font-semibold text-gray-700 mt-3 mb-1">
              코멘트 증빙자료 <span className="text-gray-400 font-normal">(이미지/PDF, 생략 가능)</span>
            </label>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={(e) => setInspectionFile(e.target.files?.[0] || null)}
              disabled={inspectionSubmitting}
              className="block w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100"
            />
            {inspectionFile && (
              <p className="text-[11px] text-gray-500 mt-1 truncate">
                선택됨: {inspectionFile.name} ({Math.ceil(inspectionFile.size / 1024)} KB)
              </p>
            )}

            <div className="flex gap-2 justify-end mt-5">
              <button
                type="button"
                onClick={() => setInspectionTarget(null)}
                disabled={inspectionSubmitting}
                className="px-4 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitInspection}
                disabled={inspectionSubmitting}
                className="px-4 py-1.5 text-sm bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-50"
              >
                {inspectionSubmitting ? '요청 중...' : '검수요청'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAlarm && <AlarmUserManager onClose={() => setShowAlarm(false)} />}

      {showWizard && (
        <SenderRegistrationWizard
          companies={myCompany ? [myCompany] : []}
          onClose={() => setShowWizard(false)}
          onSuccess={() => {
            setShowWizard(false);
            setToast('발신프로필 등록 완료');
            load();
          }}
        />
      )}


      {toast && (
        <div
          className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-[10000]"
          onClick={() => setToast(null)}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
