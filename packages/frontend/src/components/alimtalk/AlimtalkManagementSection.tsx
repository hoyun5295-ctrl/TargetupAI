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
import { AlertTriangle, Bell, Check, ChevronDown, Copy, Info, LayoutTemplate, Plus, Search, UserRound, X } from 'lucide-react';
import AlimtalkTemplateFormV2, { type TemplateFormData } from './AlimtalkTemplateFormV2';
import AlarmUserManager from './AlarmUserManager';
import SenderRegistrationWizard from './SenderRegistrationWizard';
import TemplateHistoryModal from './TemplateHistoryModal';
import { formatTemplateType } from './alimtalk-types';
import { useAuthStore } from '../../stores/authStore';
import ConfirmModal, { type ConfirmState } from '../ConfirmModal';
import TablePagination from '../common/TablePagination';
import EmptyState from '../console/EmptyState';
import RowActions, { type RowAction } from '../console/RowActions';
import StatusPill from '../console/StatusPill';
import {
  kcx,
  CUI_BTN_OUTLINE,
  CUI_BTN_PRIMARY,
  CUI_BULK,
  CUI_BULK_TEXT,
  CUI_CELL_CODE,
  CUI_CELL_CODE_CHIP,
  CUI_CELL_META,
  CUI_CELL_NAME,
  CUI_CELL_OFF,
  CUI_CHIPS,
  CUI_CHIP_COUNT_OFF,
  CUI_CHIP_COUNT_ON,
  CUI_CHIP_OFF,
  CUI_CHIP_ON,
  CUI_COPY_BTN,
  CUI_DANGER_BOX,
  CUI_DANGER_TEXT,
  CUI_FIELD,
  CUI_FIELD_INPUT,
  CUI_HINT,
  CUI_ICON_BTN,
  CUI_INFO,
  CUI_INFO_ICON,
  CUI_INFO_TEXT,
  CUI_LABEL,
  CUI_LOADING,
  CUI_MODAL,
  CUI_MODAL_BODY,
  CUI_MODAL_CLOSE,
  CUI_MODAL_DESC,
  CUI_MODAL_FOOT,
  CUI_MODAL_HEAD,
  CUI_MODAL_SCRIM,
  CUI_MODAL_TITLE,
  CUI_NOTICE,
  CUI_NOTICE_ICON,
  CUI_NOTICE_TEXT,
  CUI_PANEL,
  CUI_SCROLL_X,
  CUI_SEC_DESC,
  CUI_SEC_SPLIT,
  CUI_SEC_TITLE,
  CUI_SETUP,
  CUI_SETUP_BADGE,
  CUI_SETUP_DESC,
  CUI_SETUP_TITLE,
  CUI_SPINNER,
  CUI_TD,
  CUI_TD_STICKY,
  CUI_TEXTAREA,
  CUI_TH,
  CUI_TH_RIGHT,
  CUI_TH_STICKY,
  CUI_THEAD,
  CUI_TOAST_SUCCESS,
  CUI_TR,
  type CuiPillTone,
} from '../../utils/console-ui';

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
// ★ 2026-08-17 색을 직접 적지 않는다 — 상태 색은 `console-ui.ts`의 5개 tone이 소유한다.
//   전에는 같은 "반려"가 파일마다 red-700 / orange-700으로 갈렸다.
const STATUS_LABELS: Record<string, { label: string; tone: CuiPillTone }> = {
  // 검수 전
  DRAFT:     { label: '등록',           tone: 'neutral' },
  REG:       { label: '등록',           tone: 'neutral' },
  // 검수 진행
  REQUESTED: { label: '검수요청',       tone: 'amber' },
  REQ:       { label: '검수요청',       tone: 'amber' },
  KREQ:      { label: '카카오 검수요청', tone: 'blue' },
  // 종결 (승인)
  APPROVED:  { label: '승인',           tone: 'green' },
  APR:       { label: '승인',           tone: 'green' },
  // 종결 (반려) — IMC 6단계 정확 분리
  HREJ:      { label: '내부 반려',      tone: 'rose' },
  KREJ:      { label: '카카오 반려',    tone: 'rose' },
  // 레거시 호환 (D143 풀네임)
  REJECTED:  { label: '반려',           tone: 'rose' },
  REJ:       { label: '반려',           tone: 'rose' },
  REVIEWING: { label: '검수중',         tone: 'blue' },  // 레거시 — 신규 row는 KREQ 사용
  REV:       { label: '검수중',         tone: 'blue' },
  // 기타
  DORMANT:   { label: '휴면',           tone: 'amber' },
  DELETED:   { label: '삭제',           tone: 'neutral' },
};

const SENDER_STATUS_LABELS: Record<string, { label: string; tone: CuiPillTone }> = {
  PENDING: { label: '승인대기', tone: 'neutral' },
  NORMAL:  { label: '정상',     tone: 'green' },
  DORMANT: { label: '휴면',     tone: 'amber' },
  BLOCKED: { label: '차단',     tone: 'rose' },
  DELETED: { label: '삭제',     tone: 'neutral' },
};

// ★ 2026-06-17: IMC 발신프로필 상태 한글 매핑 (status='A' + block_yn/dormant_yn 조합).
//   휴면/차단은 IMC status만으론 구분 불가 → block/dormant boolean 우선 판정.
function senderStatusBadge(p: Profile): { label: string; tone: CuiPillTone } {
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

const APPROVAL_LABELS: Record<string, { label: string; tone: CuiPillTone }> = {
  PENDING_APPROVAL: { label: '승인 대기', tone: 'amber' },
  APPROVED:         { label: '승인 완료', tone: 'green' },
  REJECTED:         { label: '반려',      tone: 'rose' },
};

/** 상태 필터 탭 — 라벨은 STATUS_LABELS가 소유하고 여기는 순서만 갖는다 */
const FILTER_TABS = ['ALL', 'DRAFT', 'REQUESTED', 'KREQ', 'APPROVED', 'HREJ', 'KREJ'] as const;

interface Props {
  /** 상위 탭에 건수를 올려준다(표시 전용) */
  onCount?: (n: number) => void;
}

export default function AlimtalkManagementSection({ onCount }: Props = {}) {
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
  // ★ 2026-08-17 복사 버튼 피드백 — 토스트를 띄우면 3초간 화면 아래가 가려져 목록 작업이 끊긴다.
  //   버튼 자리에서 체크로 잠깐 바뀌는 편이 덜 방해한다.
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

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
  type SearchType = 'templateName' | 'content' | 'templateCode' | 'customTemplateCode' | 'profile';
  const [searchType, setSearchType] = useState<SearchType>('templateName');
  const [searchKeyword, setSearchKeyword] = useState('');
  // ★ 2026-07-22 발신프로필 검색 + 목록 페이징(재판매사 다량 프로필 대응) + 템플릿 페이징
  const [profileSearch, setProfileSearch] = useState('');
  const [profilePage, setProfilePage] = useState(1);
  const [templatePage, setTemplatePage] = useState(1);
  const PROFILE_PER_PAGE = 10;
  const TEMPLATE_PER_PAGE = 15;

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
    setTemplatePage(1);
  }, [filter, searchType, searchKeyword]);
  // ★ 2026-07-22 검색/데이터 변경 시 페이지 리셋
  useEffect(() => { setProfilePage(1); }, [profileSearch, profiles.length]);
  useEffect(() => { setTemplatePage(1); }, [templates.length]);

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

  // ★ D188 (2026-05-21) 영업팀장 신고 #4: 검색 keyword 합성 — 4 영역 lowercase 부분 일치.
  // ★ 2026-08-17: 검색 단계와 상태 단계를 분리했다(판정식은 그대로).
  //   상태 탭에 건수를 띄우려면 "검색은 걸렸고 상태는 안 걸린" 집합이 필요하다.
  const searched = useMemo(() => {
    const kw = searchKeyword.trim().toLowerCase();
    if (!kw) return templates;
    return templates.filter((t) => {
      const fieldValue =
        searchType === 'templateName'       ? (t.template_name || '') :
        searchType === 'content'            ? (t.content || '') :
        searchType === 'templateCode'       ? (t.template_code || '') :
        searchType === 'customTemplateCode' ? (t.custom_template_code || '') :
        searchType === 'profile'            ? (t.profile_name || '') :
        '';
      return String(fieldValue).toLowerCase().includes(kw);
    });
  }, [templates, searchType, searchKeyword]);

  const filtered = useMemo(
    () =>
      filter === 'ALL'
        ? searched
        : searched.filter((t) => (FILTER_MATCH[filter] || [filter]).includes(t.status)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [searched, filter],
  );

  /** 상태 탭 옆 건수 — 검색 결과 안에서 센다 */
  const statusCounts = useMemo(() => {
    const map: Record<string, number> = { ALL: searched.length };
    for (const s of FILTER_TABS) {
      if (s === 'ALL') continue;
      map[s] = searched.filter((t) => (FILTER_MATCH[s] || [s]).includes(t.status)).length;
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched]);

  // 상위 탭 건수는 **전체**를 올린다(검색·필터 결과가 아니라)
  useEffect(() => {
    onCount?.(templates.length);
  }, [templates.length, onCount]);

  // ★ 2026-07-22 발신프로필 검색(프로필명·채널ID) + 페이징
  const filteredProfiles = useMemo(() => {
    const kw = profileSearch.trim().toLowerCase();
    if (!kw) return profiles;
    return profiles.filter((p) =>
      String(p.profile_name || '').toLowerCase().includes(kw) ||
      String(p.yellow_id || '').toLowerCase().includes(kw));
  }, [profiles, profileSearch]);
  const pagedProfiles = useMemo(
    () => filteredProfiles.slice((profilePage - 1) * PROFILE_PER_PAGE, profilePage * PROFILE_PER_PAGE),
    [filteredProfiles, profilePage],
  );
  const pagedTemplates = useMemo(
    () => filtered.slice((templatePage - 1) * TEMPLATE_PER_PAGE, templatePage * TEMPLATE_PER_PAGE),
    [filtered, templatePage],
  );

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
    <div className="pt-7">
      <ConfirmModal state={confirm} onClose={() => setConfirm(null)} />

      {/* ── 발신프로필 ───────────────────────────── */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-3">
        <div>
          <h2 className={CUI_SEC_TITLE}>발신프로필</h2>
          <p className={CUI_SEC_DESC}>카카오톡 채널을 연결하면 즉시 사용할 수 있습니다</p>
        </div>
        {/* ★ 2026-07-22 발신프로필 검색(좌) + 등록(우) — 재판매사 다량 프로필 대응 */}
        <div className="flex items-center gap-2 shrink-0">
          {profiles.length > 0 && (
            <div className={`${CUI_FIELD} w-48`}>
              <Search className="w-[14px] h-[14px] text-neutral-400 shrink-0" />
              <input
                type="text"
                value={profileSearch}
                onChange={(e) => setProfileSearch(e.target.value)}
                placeholder="프로필 · 채널 ID"
                className={CUI_FIELD_INPUT}
              />
            </div>
          )}
          {/* ★ 권한: 고객사관리자(company_admin/super_admin)만 발신프로필 등록 가능 */}
          {canManage && profiles.length > 0 && (
            <button type="button" onClick={() => setShowWizard(true)} className={CUI_BTN_OUTLINE}>
              <Plus className="w-[15px] h-[15px]" />
              발신프로필 등록
            </button>
          )}
        </div>
      </div>

      {profiles.length === 0 ? (
        // 시작 안내 — 여기서 막히면 템플릿 등록으로 갈 수 없으므로 다음 행동을 붙여둔다
        <div className={CUI_SETUP}>
          <div className={CUI_SETUP_BADGE}>
            <UserRound className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className={CUI_SETUP_TITLE}>아직 연결된 발신프로필이 없습니다</p>
            <p className={CUI_SETUP_DESC}>
              {canManage
                ? '카카오 채널 ID(@로 시작)와 관리자 휴대폰만 있으면 등록됩니다. 템플릿 등록은 발신프로필이 있어야 시작할 수 있습니다.'
                : '고객사관리자에게 발신프로필 등록을 요청해주세요. 발신프로필이 있어야 템플릿을 등록할 수 있습니다.'}
            </p>
          </div>
          {canManage && (
            <button type="button" onClick={() => setShowWizard(true)} className={`${CUI_BTN_PRIMARY} shrink-0`}>
              <Plus className="w-[15px] h-[15px]" />
              발신프로필 등록
            </button>
          )}
        </div>
      ) : filteredProfiles.length === 0 ? (
        <div className={`${CUI_PANEL} py-10 text-center text-[13px] text-neutral-500`}>
          검색 결과가 없습니다
        </div>
      ) : (
        <div className={CUI_PANEL}>
          <div className={CUI_SCROLL_X}>
            <table className="w-full min-w-[780px]">
              <thead className={CUI_THEAD}>
                <tr>
                  <th className={CUI_TH}>프로필</th>
                  <th className={CUI_TH}>채널 ID</th>
                  <th className={CUI_TH}>카테고리</th>
                  <th className={CUI_TH}>승인</th>
                  <th className={CUI_TH}>상태</th>
                  <th className={CUI_TH}>브랜드메시지</th>
                  <th className={CUI_TH_RIGHT}>등록일</th>
                </tr>
              </thead>
              <tbody>
                {pagedProfiles.map((p) => {
                  // ★ 2026-06-17: 080 무료수신거부 컬럼 제거(고객사 화면). 대신 IMC 상태/브랜드메시지/등록일 노출.
                  //   상태 = syncSenderStatusJob이 IMC status+block+dormant를 DB 동기화 → senderStatusBadge로 한글 매핑.
                  const ap = APPROVAL_LABELS[p.approval_status || 'PENDING_APPROVAL'] || {
                    label: p.approval_status || '-',
                    tone: 'neutral' as CuiPillTone,
                  };
                  const sb = senderStatusBadge(p);
                  return (
                    <tr key={p.id} className={CUI_TR}>
                      <td className={CUI_TD}>
                        <div className={CUI_CELL_NAME}>{p.profile_name}</div>
                        {/* ★ D218+ (2026-05-26) PDF 신고 #3: 발신프로필 키값 전체 노출 + 복사 버튼 추가. */}
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`${CUI_CELL_CODE} truncate max-w-[220px]`}>
                            {p.profile_key || '-'}
                          </span>
                          {p.profile_key && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const key = p.profile_key!;
                                navigator.clipboard
                                  .writeText(key)
                                  .then(() => {
                                    setCopiedKey(key);
                                    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
                                  })
                                  .catch(() => setToast('복사 실패 — 직접 선택 후 복사해주세요'));
                              }}
                              className={CUI_COPY_BTN}
                              title="발신프로필 키값 복사"
                              aria-label="발신프로필 키값 복사"
                            >
                              {copiedKey === p.profile_key
                                ? <Check className="w-3 h-3 text-emerald-600" />
                                : <Copy className="w-3 h-3" />}
                            </button>
                          )}
                        </div>
                        {p.approval_status === 'REJECTED' && p.reject_reason && (
                          <div className="text-[12px] text-rose-600 mt-1 whitespace-normal">
                            반려: {p.reject_reason}
                          </div>
                        )}
                      </td>
                      <td className={CUI_TD}>
                        <span className="font-mono text-[13px] text-neutral-700">{p.yellow_id || '-'}</span>
                      </td>
                      <td className={CUI_TD}>
                        <span className="text-[13.5px] text-neutral-800">{p.category_name_cache || '-'}</span>
                      </td>
                      <td className={CUI_TD}>
                        <StatusPill label={ap.label} tone={ap.tone} />
                      </td>
                      {/* 상태 — IMC status + block + dormant */}
                      <td className={CUI_TD}>
                        <StatusPill label={sb.label} tone={sb.tone} />
                      </td>
                      {/* 브랜드메시지 사용 여부 */}
                      <td className={CUI_TD}>
                        {p.brand_message_yn === 'Y' ? (
                          <span className="text-[13.5px] text-neutral-800">사용</span>
                        ) : (
                          <span className={CUI_CELL_OFF}>미사용</span>
                        )}
                      </td>
                      {/* 등록일 — 카카오 채널 생성일 */}
                      <td className={`${CUI_TD} text-right`}>
                        <span className={CUI_CELL_META}>
                          {p.channel_created_at ? p.channel_created_at.slice(0, 10) : '-'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination total={filteredProfiles.length} page={profilePage} perPage={PROFILE_PER_PAGE} onChange={setProfilePage} unit="개" />
        </div>
      )}

      {/* 승인 안내 — 프로필이 있든 없든 대기 건이 있으면 보여야 한다 */}
      {profiles.some((p) => p.approval_status === 'PENDING_APPROVAL') && (
        <div className={CUI_NOTICE}>
          <Info className={`w-[15px] h-[15px] ${CUI_NOTICE_ICON}`} />
          <p className={CUI_NOTICE_TEXT}>
            <b className="font-semibold">승인 대기 중</b>인 발신프로필은 템플릿 등록·발송에 쓸 수 없습니다. 승인이 끝나면 자동으로 켜집니다.
          </p>
        </div>
      )}

      {/* ── 필터 + 버튼 ─────────────────────────── */}
      {/* ★ D152-4 Harold님 지시 (2026-05-12): IMC 6단계 정합 — 직원 5/12 PDF #3/#4/#5 동시 처리.
            #3 "검수중 → 카카오 검수요청 으로 변경" — REVIEWING 폐기, KREQ 신규 탭
            #4 "휴면 삭제" — DORMANT 탭 제거 (라벨은 유지)
            #5 "카카오 반려 메뉴 추가" — KREJ 신규 탭 (HREJ '내부 반려'와 분리)
            filter 시 IMC raw + 한줄로 풀네임 양쪽 매칭으로 호환 (filtered useMemo) */}
      <div className={kcx(CUI_SEC_SPLIT, 'flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3')}>
        <div className={CUI_CHIPS}>
          {FILTER_TABS.map((s) => {
            const on = filter === s;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setFilter(s)}
                className={on ? CUI_CHIP_ON : CUI_CHIP_OFF}
              >
                {s === 'ALL' ? '전체' : STATUS_LABELS[s]?.label || s}
                <span className={on ? CUI_CHIP_COUNT_ON : CUI_CHIP_COUNT_OFF}>{statusCounts[s] ?? 0}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2 items-center flex-wrap shrink-0">
          {/* ★ D188 (2026-05-21) 영업팀장 신고 #4: 검색 UI — 4 영역 select + input. 클라이언트 측 filter. */}
          <div className={`${CUI_FIELD} flex-1 lg:w-[300px] lg:flex-none px-1`}>
            <div className="relative shrink-0">
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as SearchType)}
                className="appearance-none h-7 pl-2 pr-6 bg-transparent border-0 rounded-md text-[13px] text-neutral-700 cursor-pointer outline-none focus:ring-0 hover:bg-neutral-200/50 transition"
                aria-label="검색 대상"
              >
                <option value="templateName">템플릿명</option>
                <option value="content">템플릿 문구</option>
                <option value="templateCode">템플릿코드</option>
                <option value="customTemplateCode">고객사관리코드</option>
                <option value="profile">프로필</option>
              </select>
              <ChevronDown className="w-3 h-3 text-neutral-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
            <span className="w-px h-4 bg-neutral-200 shrink-0" />
            <input
              type="text"
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="검색어를 입력하세요"
              className={CUI_FIELD_INPUT}
            />
            {searchKeyword && (
              <button
                type="button"
                onClick={() => setSearchKeyword('')}
                className="h-6 w-6 grid place-items-center rounded shrink-0 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-200/60 transition"
                aria-label="검색 초기화"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {/* ★ 검수 알림 수신자 관리 + 템플릿 등록: 고객사관리자만 (백엔드 requireCompanyAdmin) */}
          {canManage && (
            <>
              <button
                type="button"
                onClick={() => setShowAlarm(true)}
                className={CUI_ICON_BTN}
                title="검수 알림 수신자"
                aria-label="검수 알림 수신자"
              >
                <Bell className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                disabled={!canRegisterTemplate}
                className={CUI_BTN_PRIMARY}
                title={canRegisterTemplate ? undefined : '발신프로필을 먼저 등록하세요'}
              >
                <Plus className="w-[15px] h-[15px]" />
                템플릿 등록
              </button>
            </>
          )}
        </div>
      </div>

      {/* ★ 2026-07-02 일괄 검수요청 액션 바 — 등록 행을 하나라도 선택하면 노출 */}
      {selectedIds.size > 0 && (
        <div className={CUI_BULK}>
          <span className={CUI_BULK_TEXT}>
            {selectedIds.size}개 선택됨
            {bulkProgress && ` · 처리 중 ${bulkProgress.done}/${bulkProgress.total}`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={bulkSubmitting}
              className={kcx(CUI_BTN_OUTLINE, 'h-8 px-3 text-[13px]')}
            >
              선택 해제
            </button>
            <button
              type="button"
              onClick={confirmBulkInspect}
              disabled={bulkSubmitting}
              className={kcx(CUI_BTN_PRIMARY, 'h-8 px-3 text-[13px]')}
            >
              {bulkSubmitting ? '검수요청 중' : '일괄 검수요청'}
            </button>
          </div>
        </div>
      )}

      {/* ── 목록 ───────────────────────────────── */}
      {loading ? (
        <div className={`${CUI_LOADING} mt-5`}>
          <span className={CUI_SPINNER} />
          불러오는 중
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            icon={LayoutTemplate}
            title={filter === 'ALL' && !searchKeyword ? '등록된 알림톡 템플릿이 없습니다' : '조건에 맞는 템플릿이 없습니다'}
            description={
              filter === 'ALL' && !searchKeyword
                ? '템플릿을 등록하면 카카오 검수를 거쳐 발송에 사용할 수 있습니다.'
                : '상태 필터나 검색어를 바꿔보세요.'
            }
            actionLabel={filter === 'ALL' && !searchKeyword && canManage && canRegisterTemplate ? '첫 템플릿 등록하기' : undefined}
            onAction={filter === 'ALL' && !searchKeyword && canManage && canRegisterTemplate ? () => setEditing(null) : undefined}
          />
        </div>
      ) : (
        // ★ D188-fix2 (2026-05-21) 영업팀장 추가 신고: 템플릿코드 컬럼 추가로 가로 폭 초과 → 헤더/등록일시/관리 줄바꿈 사고.
        //   영구 fix = overflow-x-auto 가로 스크롤 안전망 + 모든 td/th에 whitespace-nowrap + 작은 폰트 (text-xs 통일).
        <div className={`${CUI_PANEL} mt-5`}>
          <div className={CUI_SCROLL_X}>
          <table className="w-full min-w-[1040px]">
            <thead className={CUI_THEAD}>
              <tr>
                {/* ★ 2026-07-02 일괄 검수요청: 등록 행 전체 선택 체크박스 */}
                <th className={`${CUI_TH} w-11`}>
                  <input
                    type="checkbox"
                    aria-label="등록 상태 템플릿 전체 선택"
                    checked={allEligibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allEligibleSelected && someEligibleSelected;
                    }}
                    onChange={toggleSelectAll}
                    disabled={bulkEligible.length === 0}
                    className="w-[15px] h-[15px] cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-30"
                  />
                </th>
                <th className={CUI_TH}>템플릿</th>
                {/* ★ D188 (2026-05-21) 영업팀장 신고 #3: 템플릿코드 컬럼 신규 — 사용자가 발송 매칭/디버그용 표시 정합. */}
                <th className={CUI_TH}>템플릿코드</th>
                <th className={CUI_TH}>프로필</th>
                <th className={CUI_TH}>등록자</th>
                <th className={CUI_TH}>유형</th>
                <th className={CUI_TH}>상태</th>
                <th className={CUI_TH_RIGHT}>등록일시</th>
                <th className={CUI_TH_RIGHT}>업데이트</th>
                {/* ★ 2026-07-04: 관리(액션) 열 우측 고정 — 표가 뷰포트보다 넓어도 액션 버튼이 항상 보이게. */}
                <th className={CUI_TH_STICKY}>관리</th>
              </tr>
            </thead>
            <tbody>
              {pagedTemplates.map((t) => {
                // ★ 2026-08-17 폴백이 옛 `cls` 모양으로 남아 있었다 — 모르는 상태값이 오면
                //   `st.tone`이 undefined가 되어 칩 색이 통째로 빠진다. tone 계약으로 맞춘다.
                const st = STATUS_LABELS[t.status] || {
                  label: t.status,
                  tone: 'neutral' as CuiPillTone,
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
                // ★ 2026-07-04 (Harold 정책): 조회는 회사 전체, 수정/검수요청/삭제는 소유자·관리자만.
                //   company_user가 남의 템플릿 쓰기 버튼을 눌러 백엔드 403을 만나지 않도록 프론트에서 게이팅.
                const isOwner = !!authUser?.id && t.created_by === authUser.id;
                const canEdit = canManage || isOwner;

                // ★ 2026-08-17 액션 묶음 — 대표 하나만 글자로 두고 나머지는 ⋯ 뒤로(RowActions 계약).
                //   0번 = 그 상태에서 사용자가 다음에 할 일. 파괴적 액션은 절대 0번에 두지 않는다.
                //   노출 조건은 아래 원래 분기와 한 글자도 다르지 않다.
                const detailAction: RowAction = { label: '상세보기', onClick: () => setViewing(toFormData(t)) };
                const rowActions: RowAction[] = [];
                if (isDraft && canEdit) {
                  rowActions.push({ label: '검수요청', onClick: () => inspect(t) });
                  rowActions.push({ label: '수정', onClick: () => setEditing(toFormData(t)) });
                  rowActions.push(detailAction);
                  rowActions.push({ label: '삭제', onClick: () => remove(t), danger: true });
                } else if (isReq && canEdit) {
                  rowActions.push({ label: '검수요청 취소', onClick: () => cancelInspect(t) });
                  rowActions.push(detailAction);
                } else if (isRej) {
                  // ★ D162-4 (2026-05-15) 2차: 반려사유는 모달로 — 반려 상태 + 사유가 있을 때만.
                  if (t.reject_reason) {
                    rowActions.push({
                      label: '반려사유',
                      onClick: () =>
                        setRejectReasonTarget({
                          templateName: t.template_name || t.template_code,
                          rejectReason: t.reject_reason || '',
                          status: t.status,
                        }),
                    });
                  }
                  // ★ D162-4 PDF 0515 알림톡 #1: 재검수 = 풀 폼 진입 + 반려사유 노출 + 저장 후 자동 검수요청.
                  if (canEdit) {
                    rowActions.push({
                      label: '재검수',
                      onClick: () => {
                        setEditing(toFormData(t));
                        setEditingMeta({ rejectReason: t.reject_reason, autoInspect: true });
                      },
                    });
                  }
                  rowActions.push(detailAction);
                } else {
                  // KREQ(카카오 검수 중) · APPROVED — 상세보기만
                  rowActions.push(detailAction);
                }
                // ★ D150-2 (2026-05-09): 변경 이력 (슈퍼관리자만, 모든 상태 노출)
                if (authUser?.userType === 'super_admin') {
                  rowActions.push({
                    label: '변경 이력',
                    onClick: () =>
                      setHistoryTarget({
                        templateCode: t.template_code,
                        templateName: t.template_name || t.template_code,
                      }),
                  });
                }

                return (
                  <tr key={t.id} className={CUI_TR}>
                    {/* ★ 2026-07-02 일괄 검수요청: 등록(DRAFT/REG) 행만 선택 가능 */}
                    <td className={`${CUI_TD} w-11`}>
                      {isDraft && canEdit && (
                        <input
                          type="checkbox"
                          aria-label={`${t.template_name} 선택`}
                          checked={selectedIds.has(t.id)}
                          onChange={() => toggleSelect(t.id)}
                          className="w-[15px] h-[15px] cursor-pointer accent-indigo-600"
                        />
                      )}
                    </td>
                    <td className={CUI_TD}>
                      <div className={CUI_CELL_NAME}>{t.template_name}</div>
                      {/* ★ 2026-07-22(접수2): 고객사 관리코드는 코드이므로 템플릿코드 열로 이동 — 템플릿명 아래에는 표시 안 함 */}
                    </td>
                    {/* ★ D188 (2026-05-21) 영업팀장 신고 #3: 템플릿코드 컬럼 row. font-mono + 작은 텍스트 + select-text.
                        ★ 2026-07-22(접수2): 고객사 지정 관리코드도 코드이므로 여기(템플릿코드 열)에 함께 표시 */}
                    <td className={`${CUI_TD} select-text cursor-text`}>
                      <span className={CUI_CELL_CODE}>{t.template_code || '-'}</span>
                      {t.custom_template_code && (
                        <div className="mt-1">
                          <span className={CUI_CELL_CODE_CHIP}>고객사 {t.custom_template_code}</span>
                        </div>
                      )}
                    </td>
                    <td className={CUI_TD}>
                      <span className="text-[13.5px] text-neutral-800">{t.profile_name || '-'}</span>
                    </td>
                    <td className={CUI_TD}>
                      {t.created_by_name ? (
                        <>
                          <div className="text-[13px] text-neutral-800">{t.created_by_name}</div>
                          {t.created_by_login_id && (
                            <div className={CUI_CELL_CODE}>{t.created_by_login_id}</div>
                          )}
                        </>
                      ) : (
                        <span className={CUI_CELL_OFF}>-</span>
                      )}
                    </td>
                    <td className={CUI_TD}>
                      <span className="text-[13px] text-neutral-700">
                        {formatTemplateType(t.message_type, t.emphasize_type)}
                      </span>
                    </td>
                    <td className={CUI_TD}>
                      <StatusPill label={st.label} tone={st.tone} />
                      {/* ★ CT-87 (2026-06-10): 검수 승인이어도 카카오 활성상태가 A가 아니면 발송 불가 — 실상태 병기.
                          (검수 승인인데 활성 대기 R이라 발송이 전부 7300으로 실패하던 사례의 화면 안전망) */}
                      {['APPROVED', 'APR'].includes(t.status) && t.imc_template_status && t.imc_template_status !== 'A' && (
                        <span className="ml-1 inline-flex">
                          <StatusPill
                            label={t.imc_template_status === 'R' ? '활성 대기 · 발송불가' : t.imc_template_status === 'S' ? '중단 · 발송불가' : `${t.imc_template_status} · 발송불가`}
                            tone={t.imc_template_status === 'R' ? 'amber' : 'rose'}
                            title="카카오 측 템플릿 활성상태가 정상이 아니면 발송이 거부됩니다. 카카오 검수팀에 활성 전환을 요청해주세요."
                          />
                        </span>
                      )}
                    </td>
                    <td className={`${CUI_TD} text-right`}>
                      <span className={CUI_CELL_META}>
                        {t.created_at ? new Date(t.created_at).toLocaleString('ko-KR') : '-'}
                      </span>
                    </td>
                    <td className={`${CUI_TD} text-right`}>
                      <span className={CUI_CELL_META}>
                        {t.updated_at ? new Date(t.updated_at).toLocaleString('ko-KR') : '-'}
                      </span>
                    </td>
                    <td className={CUI_TD_STICKY}>
                      <RowActions actions={rowActions} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <TablePagination total={filtered.length} page={templatePage} perPage={TEMPLATE_PER_PAGE} onChange={setTemplatePage} unit="건" />
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
        <div className={CUI_MODAL_SCRIM}>
          <div className={`${CUI_MODAL} max-w-2xl`} role="dialog" aria-modal="true">
            {/* 헤더 */}
            <div className={CUI_MODAL_HEAD}>
              <div className="flex items-start gap-3 min-w-0">
                <span className="w-10 h-10 rounded-xl bg-rose-50 text-rose-600 grid place-items-center shrink-0">
                  <AlertTriangle className="w-[18px] h-[18px]" strokeWidth={1.75} />
                </span>
                <div className="min-w-0">
                  <h3 className={`${CUI_MODAL_TITLE} truncate`}>
                    {STATUS_LABELS[rejectReasonTarget.status]?.label || '반려'} 사유
                  </h3>
                  <p className={`${CUI_MODAL_DESC} truncate`}>
                    템플릿: {rejectReasonTarget.templateName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRejectReasonTarget(null)}
                className={CUI_MODAL_CLOSE}
                aria-label="닫기"
              >
                <X className="w-[17px] h-[17px]" />
              </button>
            </div>

            {/* 본문 — 스크롤 영역 */}
            <div className={CUI_MODAL_BODY}>
              <div className={CUI_DANGER_BOX}>
                <p className={CUI_DANGER_TEXT}>{rejectReasonTarget.rejectReason}</p>
              </div>
              <div className={CUI_INFO}>
                <Info className={`w-[15px] h-[15px] ${CUI_INFO_ICON}`} />
                <p className={CUI_INFO_TEXT}>
                  이 사유는 카카오 검수팀이 전달한 내용입니다. 본문을 고친 뒤 '재검수'로 다시 요청할 수 있습니다.
                </p>
              </div>
            </div>

            {/* 푸터 */}
            <div className={CUI_MODAL_FOOT}>
              <button type="button" onClick={() => setRejectReasonTarget(null)} className={CUI_BTN_OUTLINE}>
                닫기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ★ D142+ F (2026-04-29): 검수요청 시 코멘트 + 증빙자료 입력 모달 (PDF 0428 알림톡 #3) */}
      {inspectionTarget && (
        <div className={CUI_MODAL_SCRIM}>
          <div className={`${CUI_MODAL} max-w-md`} role="dialog" aria-modal="true">
            <div className={CUI_MODAL_HEAD}>
              <div className="min-w-0">
                <h3 className={CUI_MODAL_TITLE}>검수요청</h3>
                <p className={`${CUI_MODAL_DESC} truncate`}>{inspectionTarget.template_name}</p>
              </div>
              <button
                type="button"
                onClick={() => setInspectionTarget(null)}
                disabled={inspectionSubmitting}
                className={CUI_MODAL_CLOSE}
                aria-label="닫기"
              >
                <X className="w-[17px] h-[17px]" />
              </button>
            </div>

            <div className={CUI_MODAL_BODY}>
              {/* ★ D143 F (2026-04-30) PDF 0430 #3: 등록 폼 하단에서 입력한 정보 자동 사용 안내 */}
              {(inspectionTarget.inspection_comment || inspectionTarget.inspection_evidence_filename) && (
                <div className={CUI_INFO}>
                  <Info className={`w-[15px] h-[15px] ${CUI_INFO_ICON}`} />
                  <div className={`${CUI_INFO_TEXT} min-w-0`}>
                    등록할 때 입력한 정보가 그대로 카카오에 전달됩니다.
                    {inspectionTarget.inspection_comment && (
                      <div className="mt-1 truncate">
                        <span className="font-semibold">코멘트</span> {inspectionTarget.inspection_comment.slice(0, 80)}{inspectionTarget.inspection_comment.length > 80 ? '…' : ''}
                      </div>
                    )}
                    {inspectionTarget.inspection_evidence_filename && (
                      <div className="mt-0.5 truncate">
                        <span className="font-semibold">증빙자료</span> {inspectionTarget.inspection_evidence_filename}
                      </div>
                    )}
                    <div className="mt-1 opacity-70">아래에서 더하거나 고칠 수 있습니다.</div>
                  </div>
                </div>
              )}

              <div>
                <label className={CUI_LABEL}>
                  코멘트 <span className="text-neutral-400 font-normal">(생략 가능)</span>
                </label>
                <textarea
                  value={inspectionComment}
                  onChange={(e) => setInspectionComment(e.target.value)}
                  placeholder="정보성 메시지에 대한 근거 정보"
                  rows={4}
                  disabled={inspectionSubmitting}
                  className={CUI_TEXTAREA}
                />
              </div>

              <div>
                <label className={CUI_LABEL}>
                  코멘트 증빙자료 <span className="text-neutral-400 font-normal">(이미지/PDF, 생략 가능)</span>
                </label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setInspectionFile(e.target.files?.[0] || null)}
                  disabled={inspectionSubmitting}
                  className="block w-full text-[12.5px] text-neutral-600 disabled:opacity-50
                             file:mr-2.5 file:h-8 file:px-3 file:rounded-lg file:border-0 file:cursor-pointer
                             file:text-[12.5px] file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                />
                {inspectionFile && (
                  <p className={`${CUI_HINT} truncate`}>
                    선택됨: {inspectionFile.name} ({Math.ceil(inspectionFile.size / 1024)} KB)
                  </p>
                )}
              </div>
            </div>

            <div className={CUI_MODAL_FOOT}>
              <button
                type="button"
                onClick={() => setInspectionTarget(null)}
                disabled={inspectionSubmitting}
                className={CUI_BTN_OUTLINE}
              >
                취소
              </button>
              <button
                type="button"
                onClick={submitInspection}
                disabled={inspectionSubmitting}
                className={CUI_BTN_PRIMARY}
              >
                {inspectionSubmitting ? '요청 중' : '검수요청'}
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
        <div className={CUI_TOAST_SUCCESS} role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}
