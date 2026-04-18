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
import QuickReplyEditor, { type AlimtalkQuickReply } from './QuickReplyEditor';
import ItemListEditor, {
  type ItemHighlight,
  type ItemListEntry,
  type ItemSummary,
} from './ItemListEditor';
import KakaoChannelImageUpload from './KakaoChannelImageUpload';
import AlimtalkPreview from './AlimtalkPreview';

export type MsgType = 'BA' | 'EX' | 'AD' | 'MI';
export type EmphType = 'NONE' | 'TEXT' | 'IMAGE' | 'ITEM_LIST';

export interface TemplateFormData {
  id?: string;
  template_code?: string;
  template_key?: string;
  profile_id: string;
  manageName: string;
  customTemplateCode?: string;
  serviceMode: 'PRD' | 'STG';
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
  quickReplies: AlimtalkQuickReply[];
  securityFlag: boolean;
  alarmPhoneNumber: string;
}

interface Props {
  template?: Partial<TemplateFormData> & { id?: string; template_code?: string } | null;
  profiles: {
    id: string;
    profile_key: string;
    profile_name: string;
    approval_status?: string | null;
  }[];
  categories: { category_code: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

const MSG_TYPES: { value: MsgType; label: string; desc: string }[] = [
  { value: 'BA', label: '기본형',       desc: '본문만' },
  { value: 'EX', label: '부가정보형',   desc: '본문 + 부가정보' },
  { value: 'AD', label: '채널추가형',   desc: '본문 + 채널 추가 버튼' },
  { value: 'MI', label: '복합형',       desc: '본문 + 부가정보 + 채널 추가' },
];

const EMPH_TYPES: { value: EmphType; label: string }[] = [
  { value: 'NONE',      label: '없음' },
  { value: 'TEXT',      label: '강조표기 (TEXT)' },
  { value: 'IMAGE',     label: '이미지' },
  { value: 'ITEM_LIST', label: '아이템리스트' },
];

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
    serviceMode: seed?.serviceMode || 'PRD',
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
    quickReplies: (seed?.quickReplies as AlimtalkQuickReply[]) || [],
    securityFlag: seed?.securityFlag || false,
    alarmPhoneNumber: seed?.alarmPhoneNumber || '',
  };
}

export default function AlimtalkTemplateFormV2({
  template,
  profiles,
  categories,
  onClose,
  onSuccess,
}: Props) {
  const isEdit = !!template?.id;
  const [form, setForm] = useState<TemplateFormData>(() => initialForm(template));
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ type: 'error' | 'success'; message: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // ── 채널추가형(AD/MI) 선택 시 "채널 추가" 버튼 자동 고정
  useEffect(() => {
    if (form.messageType === 'AD' || form.messageType === 'MI') {
      const has = form.buttons.some((b) => b.type === 'AC');
      if (!has) {
        setForm((f) => ({
          ...f,
          buttons: [...f.buttons, { type: 'AC', name: '채널 추가' }],
        }));
      }
    }
  }, [form.messageType]);

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
      if (!form.itemList || form.itemList.length === 0)
        return '아이템리스트에 최소 1개 이상 항목이 필요합니다';
    }
    if ((form.messageType === 'EX' || form.messageType === 'MI') && !form.extra.trim())
      return '부가정보형/복합형은 부가정보(extra)가 필수입니다';
    if (form.buttons.length > 5) return '버튼은 최대 5개';
    if (form.quickReplies.length > 10) return '빠른답장은 최대 10개';
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      setToast({ type: 'error', message: err });
      return;
    }

    setSaving(true);
    try {
      const endpoint = isEdit
        ? `/api/alimtalk/templates/${encodeURIComponent(form.template_code || '')}`
        : `/api/alimtalk/templates`;

      // IMC 스펙에 맞춘 payload 조립
      const payload: any = {
        profileId: form.profile_id,
        manageName: form.manageName,
        customTemplateCode: form.customTemplateCode || undefined,
        serviceMode: form.serviceMode,
        categoryCode: form.categoryCode,
        templateMessageType: form.messageType,
        templateEmphasizeType: form.emphasizeType,
        templateContent: form.content,
        templatePreviewMessage: form.previewMessage || undefined,
        templateExtra: form.extra || undefined,
        securityFlag: form.securityFlag,
        buttonList: form.buttons,
        quickReplyList: form.quickReplies,
        alarmPhoneNumber: form.alarmPhoneNumber || undefined,
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
        payload.templateItem = {
          list: form.itemList,
          ...(form.summary ? { summary: form.summary } : {}),
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
        return;
      }
      onSuccess();
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || '서버 오류' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col"
        style={{ animation: 'zoomIn 0.2s ease-out' }}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-white flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {isEdit ? '알림톡 템플릿 수정 (D130)' : '알림톡 템플릿 등록'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              휴머스온 IMC 검수 후 승인되면 발송 가능합니다
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

        {/* Body: 2-col (폼 / 미리보기) */}
        <div className="grid grid-cols-1 md:grid-cols-[1fr_360px] flex-1 overflow-hidden">
          {/* Left: Form */}
          <div className="px-6 py-4 overflow-y-auto space-y-4 border-r border-gray-100">
            {/* 발신 프로필 + 서비스모드 */}
            <div className="grid grid-cols-2 gap-3">
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
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  서비스 모드
                </label>
                <select
                  value={form.serviceMode}
                  onChange={(e) =>
                    setForm({ ...form, serviceMode: e.target.value as 'PRD' | 'STG' })
                  }
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="PRD">운영 (PRD)</option>
                  <option value="STG">스테이징 (STG)</option>
                </select>
              </div>
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

            {/* 카테고리 + 메시지유형 + 강조유형 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  카테고리 <span className="text-red-500">*</span>
                </label>
                <select
                  value={form.categoryCode}
                  onChange={(e) => setForm({ ...form, categoryCode: e.target.value })}
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

            {/* ITEM_LIST 강조 */}
            {form.emphasizeType === 'ITEM_LIST' && (
              <ItemListEditor
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

            {/* 미리보기 메시지 */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">
                미리보기 메시지 <span className="text-gray-400">(앱 알림 문구, 최대 40자)</span>
              </label>
              <input
                value={form.previewMessage}
                onChange={(e) => setForm({ ...form, previewMessage: e.target.value })}
                maxLength={40}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
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
            <ButtonEditor
              buttons={form.buttons}
              onChange={(b) => setForm({ ...form, buttons: b })}
              forceChannelAdd={forceChannelAdd}
            />

            {/* 빠른답장 */}
            <QuickReplyEditor
              replies={form.quickReplies}
              onChange={(r) => setForm({ ...form, quickReplies: r })}
            />

            {/* 보안 + 알림번호 */}
            <div className="grid grid-cols-2 gap-3 items-end">
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
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  검수 완료 알림 번호 <span className="text-gray-400">(콤마 구분, 최대 10개)</span>
                </label>
                <input
                  value={form.alarmPhoneNumber}
                  onChange={(e) => setForm({ ...form, alarmPhoneNumber: e.target.value })}
                  placeholder="01012345678,01098765432"
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                />
              </div>
            </div>
          </div>

          {/* Right: Preview */}
          <div className="p-4 bg-gray-50 overflow-y-auto">
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
              quickReplies={form.quickReplies}
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
            취소
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            {saving ? '저장 중...' : isEdit ? '수정 저장' : '등록 + 검수요청'}
          </button>
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
