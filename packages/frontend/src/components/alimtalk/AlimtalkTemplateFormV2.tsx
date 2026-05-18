/**
 * 알림톡 템플릿 등록/수정 모달 V2 (D130)
 *
 * - 16조합 동적 UI: messageType(BA/EX/AD/MI) × emphasizeType(NONE/TEXT/IMAGE/ITEM_LIST)
 * - IMC API 직접 연동 (`/api/alimtalk/templates`)
 * - 실시간 미리보기 (AlimtalkPreview)
 * - 버튼/빠른답장/아이템리스트 에디터 재사용
 *
 * 기존 AlimtalkTemplateFormModal.tsx(레거시 `/api/companies/kakao-templates`)는 그대로 유지.
 */

import { useEffect, useMemo, useState } from 'react';
import ButtonEditor, { type AlimtalkButton } from './ButtonEditor';
import ItemListEditor, {
  type ItemHighlight,
  type ItemListEntry,
  type ItemSummary,
} from './ItemListEditor';
import KakaoChannelImageUpload from './KakaoChannelImageUpload';
import AlimtalkPreview from './AlimtalkPreview';
import {
  MSG_TYPES,
  EMPH_TYPES,
  type MsgType,
  type EmphType,
} from './alimtalk-types';

export interface TemplateFormData {
  id?: string;
  template_code?: string;
  template_key?: string;
  profile_id: string;
  manageName: string;
  customTemplateCode?: string;
  categoryCode: string;
  messageType: MsgType;
  emphasizeType: EmphType;
  content: string;
  previewMessage: string;
  extra: string;
  // TEXT
  templateTitle: string;
  templateSubtitle: string;
  // IMAGE
  imageUrl: string;
  imageName: string;
  // ITEM_LIST
  header: string;
  highlight: ItemHighlight | null;
  itemList: ItemListEntry[];
  summary: ItemSummary | null;
  buttons: AlimtalkButton[];
  securityFlag: boolean;
  // ★ D135+ (B4) 대표링크: 말풍선 전역 클릭 시 이동. 변수 사용 불가, 고정 URL 1조.
  representLinkEnabled: boolean;
  representLinkMobile: string;
  representLinkPc: string;
  representLinkIosScheme: string;
  representLinkAndroidScheme: string;
  // ★ D143 F (2026-04-30) PDF 0430 알림톡 #3: 등록 폼 하단 코멘트(증빙자료는 별도 File state 관리)
  inspectionComment: string;
  inspectionEvidenceFilename: string; // 수정 모달에서 기존 첨부파일명 표시용 (read-only)
}

interface Props {
  template?: Partial<TemplateFormData> & { id?: string; template_code?: string } | null;
  profiles: {
    id: string;
    profile_key: string;
    profile_name: string;
    approval_status?: string | null;
  }[];
  categories: {
    category_code: string;
    name: string;
    group_name?: string | null;
    inclusion?: string | null;
    exclusion?: string | null;
  }[];
  onClose: () => void;
  onSuccess: () => void;
  /** ★ D139 #4-1 (0425): 상세보기 모달용 — 모든 필드 disabled + 저장 버튼 숨김 */
  readOnly?: boolean;
  /** ★ D162-4 (2026-05-15) PDF 0515 알림톡 #1: 반려 상태 재검수 진입 시 헤더 아래 빨간 박스로 반려사유 노출 */
  rejectReason?: string | null;
  /** ★ D162-4 (2026-05-15) PDF 0515 알림톡 #1: 저장(PUT) 완료 후 자동 POST /inspect 호출 (반려 → 본문 수정 → 재검수 요청 단일 플로우) */
  autoInspectAfterSave?: boolean;
}

function getToken() {
  return localStorage.getItem('token') || '';
}

function initialForm(seed?: Partial<TemplateFormData> | null): TemplateFormData {
  return {
    id: seed?.id,
    template_code: seed?.template_code,
    template_key: seed?.template_key,
    profile_id: seed?.profile_id || '',
    manageName: seed?.manageName || '',
    customTemplateCode: seed?.customTemplateCode || '',
    categoryCode: seed?.categoryCode || '',
    messageType: (seed?.messageType as MsgType) || 'BA',
    emphasizeType: (seed?.emphasizeType as EmphType) || 'NONE',
    content: seed?.content || '',
    previewMessage: seed?.previewMessage || '',
    extra: seed?.extra || '',
    templateTitle: seed?.templateTitle || '',
    templateSubtitle: seed?.templateSubtitle || '',
    imageUrl: seed?.imageUrl || '',
    imageName: seed?.imageName || '',
    header: seed?.header || '',
    highlight: (seed?.highlight as ItemHighlight) || null,
    itemList: (seed?.itemList as ItemListEntry[]) || [],
    summary: (seed?.summary as ItemSummary) || null,
    buttons: (seed?.buttons as AlimtalkButton[]) || [],
    securityFlag: seed?.securityFlag || false,
    // ★ D135+ (B4): 기존값이 있으면 활성화 유지
    representLinkEnabled: !!seed?.representLinkEnabled || !!seed?.representLinkMobile,
    representLinkMobile: seed?.representLinkMobile || '',
    representLinkPc: seed?.representLinkPc || '',
    representLinkIosScheme: seed?.representLinkIosScheme || '',
    representLinkAndroidScheme: seed?.representLinkAndroidScheme || '',
    // ★ D143 F (2026-04-30): 등록 폼 하단 코멘트 + 증빙자료 (PDF 0430 #3)
    inspectionComment: seed?.inspectionComment || '',
    inspectionEvidenceFilename: seed?.inspectionEvidenceFilename || '',
  };
}

export default function AlimtalkTemplateFormV2({
  template,
  profiles,
  categories,
  onClose,
  onSuccess,
  readOnly = false,
  rejectReason = null,
  autoInspectAfterSave = false,
}: Props) {
  const isEdit = !!template?.id;
  const [form, setForm] = useState<TemplateFormData>(() => initialForm(template));
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'error' | 'success'; message: string } | null>(null);
  // ★ D143 F (2026-04-30) PDF 0430 알림톡 #3: 등록 폼 하단 증빙자료 (File 객체는 form state 외 별도)
  const [inspectionEvidenceFile, setInspectionEvidenceFile] = useState<File | null>(null);

  // ★ D135+ (B5): 미리보기 메시지 체크박스 — 기존값이 있으면 ON으로 초기화
  const [previewEnabled, setPreviewEnabled] = useState(() => !!template?.previewMessage);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── 채널추가형(AD/MI) 선택 시 "채널 추가" 버튼 자동 고정
  // ★ D153 (2026-05-13): BA/EX 변경 시 AC 버튼 자동 제거 (잔존 차단 — PDF 신고 #2)
  //   AD/MI → BA/EX 전환 시 AC 버튼이 form.buttons에 잔존하여 미리보기/등록에 노출되던 사고.
  //   D152-1 ButtonEditor type 전환 잔존 패턴과 동일 카테고리 — messageType 단위 분기 추가.
  useEffect(() => {
    if (form.messageType === 'AD' || form.messageType === 'MI') {
      const has = form.buttons.some((b) => b.type === 'AC');
      if (!has) {
        setForm((f) => ({
          ...f,
          buttons: [...f.buttons, { type: 'AC', name: '채널 추가' }],
        }));
      }
    } else {
      // BA/EX: AC 버튼 자동 제거 (잔존 차단)
      const hasAc = form.buttons.some((b) => b.type === 'AC');
      if (hasAc) {
        setForm((f) => ({
          ...f,
          buttons: f.buttons.filter((b) => b.type !== 'AC'),
        }));
      }
    }
  }, [form.messageType]);

  // ── D135+ (B5): 보안 템플릿 체크 시 미리보기 메시지 자동 해제 (IMC 정책: 보안 템플릿은 미리보기 불가)
  useEffect(() => {
    if (form.securityFlag && (previewEnabled || form.previewMessage)) {
      setPreviewEnabled(false);
      setForm((f) => ({ ...f, previewMessage: '' }));
    }
  }, [form.securityFlag]);

  const forceChannelAdd = form.messageType === 'AD' || form.messageType === 'MI';

  const profileName = useMemo(
    () => profiles.find((p) => p.id === form.profile_id)?.profile_name,
    [profiles, form.profile_id],
  );

  const contentBytes = new Blob([form.content]).size;
  const contentOver = form.content.length > 1000;

  const validate = (): string | null => {
    if (!form.profile_id) return '발신 프로필을 선택하세요';
    if (!form.manageName.trim()) return '관리 이름을 입력하세요';
    if (form.manageName.length > 30) return '관리 이름은 최대 30자';
    if (!form.categoryCode) return '카테고리를 선택하세요';
    if (!form.content.trim()) return '본문을 입력하세요';
    if (contentOver) return '본문은 최대 1,000자';
    if (form.emphasizeType === 'TEXT' && !form.templateTitle.trim())
      return '강조표기 타이틀을 입력하세요';
    if (form.emphasizeType === 'IMAGE' && !form.imageName)
      return '이미지를 업로드하세요';
    if (form.emphasizeType === 'ITEM_LIST') {
      // ★ D142+ D (2026-04-29) PDF 0428 알림톡 [아이템리스트형] #1: 최소 1개 → 2개 (직원 정책)
      if (!form.itemList || form.itemList.length < 2)
        return '아이템리스트는 최소 2개 이상 항목이 필요합니다';
      // ★ D135+ (B8): 이미지/헤더/하이라이트 중 1개 이상 필수
      const hasImage = !!form.imageUrl;
      const hasHeader = !!form.header.trim();
      const hasHighlight = !!form.highlight;
      if (!hasImage && !hasHeader && !hasHighlight) {
        return '아이템리스트는 이미지·헤더·하이라이트 중 1개 이상을 입력해야 합니다';
      }
      if (hasHeader && form.header.length > 16)
        return '헤더는 최대 16자';
      if (hasHighlight && form.highlight) {
        if (!form.highlight.title.trim())
          return '하이라이트 타이틀을 입력하세요';
      }
    }
    if ((form.messageType === 'EX' || form.messageType === 'MI') && !form.extra.trim())
      return '부가정보형/복합형은 부가정보(extra)가 필수입니다';
    if (form.buttons.length > 5) return '버튼은 최대 5개';
    // ★ D135+ (B4): 대표링크 검증
    if (form.representLinkEnabled) {
      if (!form.representLinkMobile.trim())
        return '대표링크 Mobile URL은 필수입니다';
      if (!/^https?:\/\//i.test(form.representLinkMobile.trim()))
        return '대표링크 Mobile URL은 http:// 또는 https:// 로 시작해야 합니다';
      if (form.representLinkPc && !/^https?:\/\//i.test(form.representLinkPc.trim()))
        return '대표링크 PC URL은 http:// 또는 https:// 로 시작해야 합니다';
      if (form.representLinkMobile.length > 500 || form.representLinkPc.length > 500)
        return '대표링크 URL은 각 500자 이내';
    }
    return null;
  };

  const handleSave = async () => {
    // ★ D142+ A1 (2026-04-29): 재클릭 중복 등록 가드.
    //   PDF 0428 알림톡 #1 신고 — "SUCCESS 피드백 이후 등록창 닫히지 않습니다. 안닫힌 상태로 '등록' 클릭 시 IMC 중복 등록".
    //   원인: handleSave 진행 중 fetch 응답 직후 onSuccess→setEditing(undefined) 사이 unmount까지 시간차 +
    //         finally의 setSaving(false)가 unmount 직전에 실행되면 재클릭 윈도우 발생.
    //   해결: 상단에 `if (saving) return` 가드 + 성공 시 setSaving(true) 유지(모달 unmount까지) + 명시적 onClose fallback.
    if (saving) return;

    const err = validate();
    if (err) {
      setToast({ type: 'error', message: err });
      return;
    }

    // ★ D143 F (2026-04-30) PDF 0430 #3: 증빙자료 5MB 제한 (backend multer fileSize와 동일)
    if (inspectionEvidenceFile && inspectionEvidenceFile.size > 5 * 1024 * 1024) {
      setToast({ type: 'error', message: '증빙자료는 최대 5MB까지 첨부 가능합니다' });
      return;
    }

    setSaving(true);
    try {
      const endpoint = isEdit
        ? `/api/alimtalk/templates/${encodeURIComponent(form.template_code || '')}`
        : `/api/alimtalk/templates`;

      // IMC 스펙에 맞춘 payload 조립
      // - serviceMode: 백엔드에서 'PRD' 기본값 처리 (UI 노출 안 함)
      // - quickReplyList: 템플릿 등록 필수 항목 아님 (UI 제거)
      // - alarmPhoneNumber: 알림수신자 별도 관리 화면 사용 (UI 제거)
      const payload: any = {
        profileId: form.profile_id,
        manageName: form.manageName,
        customTemplateCode: form.customTemplateCode || undefined,
        categoryCode: form.categoryCode,
        templateMessageType: form.messageType,
        templateEmphasizeType: form.emphasizeType,
        templateContent: form.content,
        templatePreviewMessage: form.previewMessage || undefined,
        templateExtra: form.extra || undefined,
        securityFlag: form.securityFlag,
        buttonList: form.buttons,
      };

      if (form.emphasizeType === 'TEXT') {
        payload.templateTitle = form.templateTitle;
        if (form.templateSubtitle) payload.templateSubtitle = form.templateSubtitle;
      }

      if (form.emphasizeType === 'IMAGE') {
        payload.templateImageName = form.imageName;
        payload.templateImageUrl = form.imageUrl;
      }

      if (form.emphasizeType === 'ITEM_LIST') {
        if (form.header) payload.templateHeader = form.header;
        if (form.highlight) payload.templateItemHighlight = form.highlight;
        // ★ D135+ (B8): 대표 이미지 포함
        if (form.imageUrl) {
          payload.templateImageName = form.imageName;
          payload.templateImageUrl = form.imageUrl;
        }
        payload.templateItem = {
          list: form.itemList,
          ...(form.summary ? { summary: form.summary } : {}),
        };
      }

      // ★ D135+ (B4): 대표링크 payload
      // ★ D142+ B (2026-04-29) PDF 0428 알림톡 #3: "대표링크가 IMC로 전달이 안됩니다" 재발 차단.
      //   직원이 체크박스 안 누르고 URL만 입력하면 페이로드 누락되던 사고 → 체크박스 의존 제거.
      //   Mobile URL이 입력되어 있으면 무조건 페이로드 포함 (URL 입력 자체가 enabled 시그널).
      if (form.representLinkMobile.trim()) {
        payload.templateRepresentLink = {
          urlMobile: form.representLinkMobile.trim(),
          ...(form.representLinkPc.trim() ? { urlPc: form.representLinkPc.trim() } : {}),
          ...(form.representLinkIosScheme.trim() ? { schemeIos: form.representLinkIosScheme.trim() } : {}),
          ...(form.representLinkAndroidScheme.trim() ? { schemeAndroid: form.representLinkAndroidScheme.trim() } : {}),
        };
      }

      const res = await fetch(endpoint, {
        method: isEdit ? 'PUT' : 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setToast({
          type: 'error',
          message: data?.error || `저장 실패 (${res.status})`,
        });
        setSaving(false); // 실패 시에만 saving 해제 (재시도 가능)
        return;
      }

      // ★ D143 F (2026-04-30) PDF 0430 알림톡 #3: 등록/수정 직후 코멘트+증빙자료 별도 저장.
      //   템플릿 자체는 application/json. 증빙자료는 multipart/form-data 별도 라우트 호출.
      //   기존 코멘트와 다르거나 새 파일이 있을 때만 호출 (불필요한 PUT 절약).
      const savedTemplateCode: string = data.template?.template_code || form.template_code || '';
      const commentChanged = (form.inspectionComment || '') !== (template?.inspectionComment || '');
      const hasNewFile = !!inspectionEvidenceFile;
      if (savedTemplateCode && (commentChanged || hasNewFile)) {
        try {
          const fd = new FormData();
          fd.append('comment', form.inspectionComment || '');
          if (inspectionEvidenceFile) fd.append('evidenceFile', inspectionEvidenceFile);
          const metaRes = await fetch(
            `/api/alimtalk/templates/${encodeURIComponent(savedTemplateCode)}/inspection-meta`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${getToken()}` },
              body: fd,
            },
          );
          const metaData = await metaRes.json().catch(() => ({}));
          if (!metaRes.ok || !metaData.success) {
            // 코멘트 저장 실패는 치명적이지 않음 — 토스트로 안내하되 등록 자체는 성공 처리
            setToast({
              type: 'error',
              message: `등록은 완료됐지만 코멘트/증빙자료 저장에 실패했습니다: ${metaData?.error || metaRes.status}`,
            });
          }
        } catch (metaErr: any) {
          console.error('[AlimtalkTemplateFormV2] inspection-meta 저장 실패', metaErr);
          setToast({
            type: 'error',
            message: '등록은 완료됐지만 코멘트/증빙자료 저장 중 오류가 발생했습니다',
          });
        }
      }

      // ★ D162-4 (2026-05-15) PDF 0515 알림톡 #1: 반려 상태 재검수 진입 시 저장 후 자동 검수요청.
      //   AlimtalkManagementSection에서 HREJ/KREJ 등 반려 상태 "재검수" 버튼 클릭 시 풀 폼 진입 + 본문 수정 +
      //   저장(PUT) → 여기서 자동으로 POST /inspect 호출 → 재검수 요청 완료. 기존 작은 검수요청 모달(inspectionTarget)에
      //   본문 수정 동선이 없던 사고 영구 종결.
      if (autoInspectAfterSave && savedTemplateCode) {
        try {
          const inspectRes = await fetch(
            `/api/alimtalk/templates/${encodeURIComponent(savedTemplateCode)}/inspect`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${getToken()}`,
              },
              body: JSON.stringify({ comment: form.inspectionComment || '' }),
            },
          );
          const inspectData = await inspectRes.json().catch(() => ({}));
          if (!inspectRes.ok || !inspectData.success) {
            setToast({
              type: 'error',
              message: `수정은 완료됐지만 재검수 요청에 실패했습니다: ${inspectData?.error || inspectRes.status}`,
            });
            setSaving(false);
            return;
          }
        } catch (inspectErr: any) {
          console.error('[AlimtalkTemplateFormV2] auto inspect 실패', inspectErr);
          setToast({
            type: 'error',
            message: '수정은 완료됐지만 재검수 요청 중 오류가 발생했습니다',
          });
          setSaving(false);
          return;
        }
      }

      // ★ D139 #4 (0425): 자동 검수요청 분기 제거 (등록과 검수요청 분리).
      //   템플릿은 DRAFT 상태로 저장 → 목록에서 '검수요청' 버튼으로 명시 액션.
      // ★ D142+ A1+A2 (2026-04-29): 성공 시 setSaving(true) 유지 → 모달 unmount까지 등록 버튼 비활성화.
      //   onSuccess()는 부모 setEditing(undefined) → 모달 unmount. onClose() 명시 호출로 fallback 안전망.
      onSuccess();
      onClose(); // 안전장치: onSuccess가 setEditing(undefined) 못 하는 케이스도 모달 close 보장
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || '서버 오류' });
      setSaving(false); // 예외 시 재시도 가능하게 해제
    }
    // ★ D142+ A1: finally의 setSaving(false) 제거 — 성공 시 모달 unmount까지 saving=true 유지로 재클릭 100% 차단
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[92vh] overflow-hidden flex flex-col"
        style={{ animation: 'zoomIn 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-white flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {readOnly
                ? '알림톡 템플릿 상세보기'
                : isEdit
                  ? '알림톡 템플릿 수정'
                  : '알림톡 템플릿 등록'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {readOnly
                ? '읽기 전용으로 템플릿 내용을 확인할 수 있습니다'
                : '카카오 검수 승인 후 발송할 수 있습니다'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl"
          >
            &times;
          </button>
        </div>

        {/* ★ D162-4 (2026-05-15) PDF 0515 알림톡 #1: 반려 상태 재검수 진입 시 헤더 아래 빨간 박스로 반려사유 노출.
            본문 수정 + 저장하면 autoInspectAfterSave 분기로 자동 재검수 요청 전송. */}
        {rejectReason && (
          <div className="px-6 py-3 bg-red-50 border-b border-red-200">
            <p className="text-xs font-semibold text-red-700 mb-1">
              반려 사유 (본문 수정 후 저장하면 자동으로 재검수 요청됩니다)
            </p>
            <p className="text-sm text-red-700 whitespace-pre-wrap leading-relaxed">
              {rejectReason}
            </p>
          </div>
        )}

        {/* Body: 2-col (폼 / 미리보기).
            ★ D153 (5/13): fieldset 완전 제거 — Chrome/Safari fieldset+grid+contents 호환성 모두 사고.
              D151+ fieldset disabled 의도(readOnly 시 입력 차단)는 wrapper div의 pointer-events-none + opacity로 대체.
              Footer 버튼은 fieldset 외부였어서 readOnly 영향 X 정합.
            ★ D162-4 (2026-05-15) PDF 0515 알림톡 #2 root cause fix:
              기존 wrapper에 `pointer-events-none` 박혀있어 readOnly 상세보기 모달에서 스크롤 휠/터치도 차단 →
              본문 영역 아래로 내릴 수 없는 사고. wrapper에서 pointer-events-none 제거 +
              자식 input/select/textarea/button/label 셀렉터로만 pointer-events-none 적용 →
              스크롤(overflow-y-auto)은 살아있고 입력만 차단되는 정합. */}
        <div className={`grid grid-cols-1 md:grid-cols-[1fr_360px] flex-1 overflow-hidden border-0 p-0 m-0 min-w-0 min-h-0 ${readOnly ? 'opacity-60 [&_input]:pointer-events-none [&_select]:pointer-events-none [&_textarea]:pointer-events-none [&_button]:pointer-events-none [&_label]:pointer-events-none' : ''}`}>
          {/* Left: Form */}
          <div className="px-6 py-4 overflow-y-auto space-y-4 border-r border-gray-100 min-h-0">
            {/* 발신 프로필 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                발신 프로필 <span className="text-red-500">*</span>
              </label>
              {(() => {
                const approvedProfiles = profiles.filter(
                  (p) => (p.approval_status || 'PENDING_APPROVAL') === 'APPROVED',
                );
                const hasAny = profiles.length > 0;
                const hasApproved = approvedProfiles.length > 0;
                return (
                  <>
                    <select
                      value={form.profile_id}
                      onChange={(e) => setForm({ ...form, profile_id: e.target.value })}
                      disabled={!hasApproved}
                      className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      <option value="">선택</option>
                      {approvedProfiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.profile_name} ({p.profile_key.slice(0, 10)}…)
                        </option>
                      ))}
                    </select>
                    {!hasAny && (
                      <p className="mt-1 text-[11px] text-red-600">
                        등록된 발신프로필이 없습니다. 슈퍼관리자에게 등록을 요청해주세요.
                      </p>
                    )}
                    {hasAny && !hasApproved && (
                      <p className="mt-1 text-[11px] text-amber-600">
                        승인된 발신프로필이 없습니다. 슈퍼관리자 승인 후 사용할 수 있습니다.
                      </p>
                    )}
                  </>
                );
              })()}
            </div>

            {/* 관리 이름 + 고객사 코드 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  관리 이름 <span className="text-red-500">*</span>
                </label>
                <input
                  value={form.manageName}
                  onChange={(e) => setForm({ ...form, manageName: e.target.value })}
                  maxLength={30}
                  placeholder="내부 관리용 (최대 30자)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  고객사 관리코드 <span className="text-gray-400">(선택)</span>
                </label>
                <input
                  value={form.customTemplateCode || ''}
                  onChange={(e) =>
                    setForm({ ...form, customTemplateCode: e.target.value })
                  }
                  maxLength={30}
                  placeholder="임의 지정 (ERP 연동 등)"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            {/* 카테고리 (대분류 → 소분류 2단) */}
            <CategoryPicker
              categories={categories}
              value={form.categoryCode}
              onChange={(code) => setForm({ ...form, categoryCode: code })}
            />

            {/* 메시지유형 + 강조유형 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  메시지 유형
                </label>
                <select
                  value={form.messageType}
                  onChange={(e) =>
                    setForm({ ...form, messageType: e.target.value as MsgType })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                >
                  {MSG_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {MSG_TYPES.find((t) => t.value === form.messageType)?.desc}
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  강조 유형
                </label>
                <select
                  value={form.emphasizeType}
                  onChange={(e) =>
                    setForm({ ...form, emphasizeType: e.target.value as EmphType })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                >
                  {EMPH_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* TEXT 강조 */}
            {form.emphasizeType === 'TEXT' && (
              <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                <p className="text-xs font-semibold text-amber-700">강조 텍스트</p>
                <input
                  value={form.templateTitle}
                  onChange={(e) => setForm({ ...form, templateTitle: e.target.value })}
                  maxLength={50}
                  placeholder="강조 타이틀 (최대 50자)"
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                />
                <input
                  value={form.templateSubtitle}
                  onChange={(e) => setForm({ ...form, templateSubtitle: e.target.value })}
                  maxLength={50}
                  placeholder="보조문구 (최대 50자, 선택)"
                  className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                />
              </div>
            )}

            {/* IMAGE 강조 */}
            {form.emphasizeType === 'IMAGE' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                <p className="text-xs font-semibold text-amber-700 mb-2">강조 이미지</p>
                <KakaoChannelImageUpload
                  uploadType="alimtalk_template"
                  value={form.imageUrl}
                  onChange={(url, name) =>
                    setForm({ ...form, imageUrl: url, imageName: name })
                  }
                />
              </div>
            )}

            {/* ITEM_LIST 강조 — D135+ (B8) 이미지 사용 + 헤더/하이라이트 체크박스 */}
            {form.emphasizeType === 'ITEM_LIST' && (
              <ItemListEditor
                imageUrl={form.imageUrl}
                imageName={form.imageName}
                onImageChange={(url, name) =>
                  setForm({ ...form, imageUrl: url, imageName: name })
                }
                header={form.header}
                onHeaderChange={(v) => setForm({ ...form, header: v })}
                highlight={form.highlight}
                onHighlightChange={(v) => setForm({ ...form, highlight: v })}
                list={form.itemList}
                onListChange={(v) => setForm({ ...form, itemList: v })}
                summary={form.summary}
                onSummaryChange={(v) => setForm({ ...form, summary: v })}
              />
            )}

            {/* 본문 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                본문 <span className="text-red-500">*</span>
                <span className="ml-2 text-gray-400">
                  ({form.content.length}/1,000자, {contentBytes} bytes)
                </span>
              </label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={6}
                maxLength={1000}
                placeholder="변수는 #{변수명} 형식 (예: #{고객명}님 주문 확인)"
                className={`w-full border rounded-lg px-3 py-2 text-sm resize-none ${
                  contentOver
                    ? 'border-red-300 focus:ring-red-200'
                    : 'border-gray-300 focus:ring-amber-200'
                }`}
              />
              <VariableChips content={form.content} />
            </div>

            {/* 미리보기 메시지 — D135+ (B5): 체크박스 + 보안템플릿 시 자동 비활성 */}
            <div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="previewMsgToggle"
                  checked={previewEnabled && !form.securityFlag}
                  disabled={form.securityFlag}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setPreviewEnabled(checked);
                    if (!checked) setForm({ ...form, previewMessage: '' });
                  }}
                  className="w-4 h-4 text-amber-600 border-gray-300 rounded disabled:opacity-50"
                />
                <label htmlFor="previewMsgToggle" className="text-sm text-gray-700">
                  미리보기 메시지 설정
                  <span className="ml-2 text-[11px] text-gray-400">
                    (앱 알림 문구, 변수 사용 불가)
                  </span>
                </label>
              </div>
              {form.securityFlag && (
                <p className="mt-1 ml-6 text-[11px] text-gray-500">
                  보안 템플릿은 미리보기 메시지를 설정할 수 없습니다.
                </p>
              )}
              {previewEnabled && !form.securityFlag && (
                <input
                  value={form.previewMessage}
                  onChange={(e) => setForm({ ...form, previewMessage: e.target.value })}
                  maxLength={40}
                  placeholder="최대 40자 (예: 주문이 접수되었습니다)"
                  className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              )}
            </div>

            {/* 부가정보 (EX/MI) */}
            {(form.messageType === 'EX' || form.messageType === 'MI') && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  부가정보 <span className="text-red-500">*</span>
                  <span className="ml-2 text-gray-400">
                    (최대 500자, 변수 불가)
                  </span>
                </label>
                <textarea
                  value={form.extra}
                  onChange={(e) => setForm({ ...form, extra: e.target.value })}
                  rows={3}
                  maxLength={500}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                />
              </div>
            )}

            {/* 버튼 */}
            {/* ★ D152-4 Harold님 지시 (2026-05-12) — 직원 5/12 PDF #1:
                  messageType 전달 → ButtonEditor가 BA/EX에서 AC(채널추가) 옵션 자동 숨김.
                  AD/MI에서만 AC 노출 (카카오 정책 정합). */}
            <ButtonEditor
              buttons={form.buttons}
              onChange={(b) => setForm({ ...form, buttons: b })}
              forceChannelAdd={forceChannelAdd}
              messageType={form.messageType}
            />

            {/* 대표링크 — D135+ (B4) / D139 #2 (0425) UI 가드 강화 */}
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="checkbox"
                  id="representLinkToggle"
                  checked={form.representLinkEnabled}
                  onChange={(e) => setForm({ ...form, representLinkEnabled: e.target.checked })}
                  className="w-4 h-4 text-amber-600 border-gray-300 rounded"
                />
                <label htmlFor="representLinkToggle" className="text-sm text-gray-700 font-medium">
                  대표링크 설정
                  <span className="ml-2 text-[11px] text-gray-400">
                    (말풍선 전역 클릭, 변수 사용 불가)
                  </span>
                </label>
                {/* ★ D146 (2026-05-07) PDF 0506 #5: '체크해야 카카오로 전달됩니다' 가드 안내 제거 (직원 혼선 유발). */}
                {/* ★ D139 #2 (0425): 체크 ON + Mobile URL 입력 시 녹색 확인 인디케이터 (긍정 피드백은 유지) */}
                {form.representLinkEnabled && form.representLinkMobile.trim() && (
                  <span className="text-[11px] text-emerald-600 font-medium">
                    ✓ 카카오 등록 시 대표링크 포함
                  </span>
                )}
              </div>
              {form.representLinkEnabled && (
                <div className="mt-2 space-y-2 rounded-xl border border-amber-200 bg-amber-50/40 p-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">
                        Mobile URL <span className="text-red-500">*</span>
                        {/* ★ D139 #2 (0425): 체크 ON인데 Mobile URL 비어있을 때 빨간 경고 */}
                        {!form.representLinkMobile.trim() && (
                          <span className="ml-1 text-red-500 text-[10px] font-medium">
                            (입력하지 않으면 카카오 등록 시 누락됩니다)
                          </span>
                        )}
                      </label>
                      <input
                        value={form.representLinkMobile}
                        onChange={(e) => {
                          // ★ D142+ B (2026-04-29): URL 입력 시 representLinkEnabled 자동 ON.
                          //   직원이 체크박스 안 누르고 URL만 입력해도 페이로드 누락되지 않도록 UX 안전망.
                          const v = e.target.value;
                          setForm({
                            ...form,
                            representLinkMobile: v,
                            representLinkEnabled: v.trim() ? true : form.representLinkEnabled,
                          });
                        }}
                        placeholder="https://"
                        maxLength={500}
                        className={`w-full border rounded px-2 py-1 text-sm ${
                          !form.representLinkMobile.trim()
                            ? 'border-red-300 bg-red-50/30'
                            : 'border-gray-300'
                        }`}
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">
                        PC URL <span className="text-gray-400">(선택)</span>
                      </label>
                      <input
                        value={form.representLinkPc}
                        onChange={(e) => setForm({ ...form, representLinkPc: e.target.value })}
                        placeholder="https://"
                        maxLength={500}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">
                        iOS scheme <span className="text-gray-400">(선택)</span>
                      </label>
                      <input
                        value={form.representLinkIosScheme}
                        onChange={(e) => setForm({ ...form, representLinkIosScheme: e.target.value })}
                        placeholder="예: myapp://path"
                        maxLength={500}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-gray-600 mb-1">
                        Android scheme <span className="text-gray-400">(선택)</span>
                      </label>
                      <input
                        value={form.representLinkAndroidScheme}
                        onChange={(e) => setForm({ ...form, representLinkAndroidScheme: e.target.value })}
                        placeholder="예: myapp://path"
                        maxLength={500}
                        className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-500">
                    https:// 또는 http:// 로 시작해야 하며, 각 항목 최대 500자. 웹링크/앱링크 버튼 가이드와 동일 기준이 적용됩니다.
                  </p>
                  {/* ★ D146 (2026-05-07) PDF 0506 #5: '체크박스 해제 시...' amber 박스 제거 (직원 혼선 유발). */}
                </div>
              )}
            </div>

            {/* 보안 템플릿 */}
            <div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="secFlag"
                  checked={form.securityFlag}
                  onChange={(e) => setForm({ ...form, securityFlag: e.target.checked })}
                  className="w-4 h-4 text-amber-600 border-gray-300 rounded"
                />
                <label htmlFor="secFlag" className="text-sm text-gray-600">
                  보안 템플릿 (개인정보 포함)
                </label>
              </div>
              <p className="mt-1 ml-6 text-[11px] text-gray-500 leading-relaxed">
                보안 템플릿 체크 시, 메인 디바이스 모바일 외 모든 서브 디바이스에서는 메시지 내용이 노출되지 않습니다.
              </p>
            </div>

            {/* ★ D143 F (2026-04-30) PDF 0430 알림톡 #3: 코멘트 + 증빙자료 (등록 폼 제일 하단)
                 직원 요청: "코멘트 입력칸에는 '정보성 메시지에 대한 근거 정보(생략가능)' 선 입력".
                 등록 시점에 함께 저장되며, 검수요청 시 IMC에 자동 전달됨. */}
            <div className="border-t border-gray-200 pt-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                코멘트 <span className="text-gray-400 font-normal">(생략 가능)</span>
              </label>
              <textarea
                value={form.inspectionComment}
                onChange={(e) => setForm({ ...form, inspectionComment: e.target.value })}
                placeholder="정보성 메시지에 대한 근거 정보(생략가능)"
                rows={3}
                disabled={readOnly}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-amber-300 focus:border-amber-400 outline-none disabled:bg-gray-50"
              />

              <label className="block text-xs font-medium text-gray-600 mt-3 mb-1">
                코멘트 증빙자료 <span className="text-gray-400 font-normal">(이미지/PDF, 생략 가능 · 최대 5MB)</span>
              </label>
              {/* 수정 모달에서 기존 첨부파일명 표시 */}
              {form.inspectionEvidenceFilename && !inspectionEvidenceFile && (
                <p className="text-[11px] text-gray-500 mb-1">
                  기존 첨부: {form.inspectionEvidenceFilename}
                </p>
              )}
              {!readOnly && (
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setInspectionEvidenceFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-gray-600 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-amber-50 file:text-amber-700 hover:file:bg-amber-100"
                />
              )}
              {inspectionEvidenceFile && (
                <p className="text-[11px] text-gray-500 mt-1 truncate">
                  새 첨부: {inspectionEvidenceFile.name} ({Math.ceil(inspectionEvidenceFile.size / 1024)} KB)
                </p>
              )}
              <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                ℹ 등록 시점에 저장되며, 검수요청 시 카카오에 함께 전달됩니다.
              </p>
            </div>
          </div>

          {/* Right: Preview */}
          <div className="p-4 bg-gray-50 overflow-y-auto min-h-0">
            <p className="text-xs font-semibold text-gray-500 mb-2">실시간 미리보기</p>
            <AlimtalkPreview
              messageType={form.messageType}
              emphasizeType={form.emphasizeType}
              templateTitle={form.templateTitle}
              templateSubtitle={form.templateSubtitle}
              imageUrl={form.imageUrl}
              content={form.content}
              extraContent={form.extra}
              header={form.header}
              highlight={form.highlight}
              itemList={form.itemList}
              summary={form.summary}
              buttons={form.buttons}
              profileName={profileName}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm"
          >
            {readOnly ? '닫기' : '취소'}
          </button>
          {!readOnly && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
            >
              {/* ★ D139 #4 (0425): '등록 + 검수요청' → '등록'으로 분리.
                  검수요청은 목록의 '검수요청' 액션 버튼(#4-1)으로 명시 호출.
                  ★ D162-4 (2026-05-15): autoInspectAfterSave=true (반려 상태 재검수 진입)면 라벨 '수정 + 재검수 요청'으로 명시. */}
              {saving
                ? (autoInspectAfterSave ? '재검수 요청 중...' : '저장 중...')
                : isEdit
                  ? (autoInspectAfterSave ? '수정 + 재검수 요청' : '수정 저장')
                  : '등록'}
            </button>
          )}
        </div>

        {toast && (
          <div
            className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg text-sm text-white shadow-lg z-[60]
              ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}
          >
            {toast.message}
          </div>
        )}

        <style>{`
          @keyframes zoomIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
          }
        `}</style>
      </div>
    </div>
  );
}

function VariableChips({ content }: { content: string }) {
  const vars = content.match(/#\{[^}]+\}/g);
  if (!vars || vars.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {Array.from(new Set(vars)).map((v, i) => (
        <span
          key={i}
          className="inline-block bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full"
        >
          {v}
        </span>
      ))}
    </div>
  );
}

/**
 * 템플릿 카테고리 2단 선택기
 *
 * - IMC 응답: `{ code, name, groupName, inclusion, exclusion }`
 *   대분류(groupName) → 소분류(code+name) 2단 구조.
 * - group_name이 비어있는 레거시 데이터가 섞여 있으면 단일 드롭다운으로 안전 폴백.
 * - 소분류 선택 시 inclusion/exclusion 힌트 박스 노출 — 올바른 카테고리 선택 유도.
 */
function CategoryPicker({
  categories,
  value,
  onChange,
}: {
  categories: {
    category_code: string;
    name: string;
    group_name?: string | null;
    inclusion?: string | null;
    exclusion?: string | null;
  }[];
  value: string;
  onChange: (code: string) => void;
}) {
  const hasGroups = categories.some((c) => !!c.group_name);
  const selected = categories.find((c) => c.category_code === value) || null;

  // fallback: group_name 데이터가 없으면 단일 드롭다운
  if (!hasGroups) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          카테고리 <span className="text-red-500">*</span>
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">선택</option>
          {categories.map((c) => (
            <option key={c.category_code} value={c.category_code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    );
  }

  // 대분류 목록 (정렬 유지)
  const groups: string[] = [];
  for (const c of categories) {
    const g = c.group_name || '기타';
    if (!groups.includes(g)) groups.push(g);
  }

  const currentGroup = selected?.group_name || '';
  const subItems = categories.filter(
    (c) => (c.group_name || '기타') === currentGroup,
  );

  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        카테고리 <span className="text-red-500">*</span>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={currentGroup}
          onChange={(e) => {
            const g = e.target.value;
            // 대분류 변경 시 해당 그룹의 첫 소분류로 자동 선택
            const first = categories.find((c) => (c.group_name || '기타') === g);
            onChange(first?.category_code || '');
          }}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">대분류 선택</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={!currentGroup}
          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm disabled:bg-gray-100 disabled:text-gray-400"
        >
          <option value="">소분류 선택</option>
          {subItems.map((c) => (
            <option key={c.category_code} value={c.category_code}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      {selected?.inclusion && (
        <div className="mt-1.5 rounded-md border border-amber-100 bg-amber-50/70 px-2.5 py-1.5 text-[11px] text-amber-800 leading-relaxed">
          <span className="font-semibold">포함:</span> {selected.inclusion}
          {selected.exclusion && (
            <>
              <br />
              <span className="font-semibold">제외:</span> {selected.exclusion}
            </>
          )}
        </div>
      )}
    </div>
  );
}
