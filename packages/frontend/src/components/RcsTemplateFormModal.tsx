/**
 * RcsTemplateFormModal.tsx — RCS 템플릿 등록·수정 폼
 *
 * ★ 2026-08-17 라이트 톤 재작성 — 색·높이·라운드는 `utils/console-ui.ts`가 소유한다.
 *   함께 정리한 것: 텍스트로 그린 닫기(&times;)·버튼 삭제(✕)를 아이콘으로 교체, 인라인 @keyframes 폐기
 *   (tailwind.config.js가 `animate-in`을 이미 제공한다), Esc 닫기 추가.
 *   저장·검증 로직은 한 줄도 바꾸지 않았다.
 */
import { useState, useEffect } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
  CUI_BTN_OUTLINE,
  CUI_BTN_PRIMARY,
  CUI_FIELDSET_TITLE,
  CUI_HINT,
  CUI_INPUT,
  CUI_LABEL,
  CUI_MODAL,
  CUI_MODAL_BODY,
  CUI_MODAL_CLOSE,
  CUI_MODAL_DESC,
  CUI_MODAL_FOOT,
  CUI_MODAL_HEAD,
  CUI_MODAL_SCRIM,
  CUI_MODAL_TITLE,
  CUI_PICK_DESC,
  CUI_PICK_OFF,
  CUI_PICK_ON,
  CUI_PICK_TITLE,
  CUI_REQUIRED,
  CUI_SELECT,
  CUI_TEXTAREA,
  CUI_TOAST_ERROR,
  CUI_TOAST_SUCCESS,
} from '../utils/console-ui';

interface RcsButton {
  buttonType: 'URL' | 'DIAL' | 'MAP' | 'COPY';
  name: string;
  url?: string;
  phoneNumber?: string;
  latitude?: string;
  longitude?: string;
  copyText?: string;
}

interface RcsTemplate {
  id?: string;
  template_name: string;
  message_type: string;
  content: string;
  buttons: RcsButton[];
  media_url?: string;
  brand_id?: string;
  brand_name?: string;
  status?: string;
}

interface Props {
  template: RcsTemplate | null;
  onClose: () => void;
  onSuccess: () => void;
}

const RCS_MESSAGE_TYPES = [
  { value: 'rcs_sms', label: 'RCS SMS', desc: '단문 (100자 이내)' },
  { value: 'rcs_lms', label: 'RCS LMS', desc: '장문 (1,300자 이내)' },
  { value: 'rcs_mms', label: 'RCS MMS', desc: '이미지/동영상 포함' },
  { value: 'rcs_template', label: 'RCS 템플릿', desc: '사전 등록 템플릿' },
];

const BUTTON_TYPES = [
  { value: 'URL', label: '웹링크' },
  { value: 'DIAL', label: '전화걸기' },
  { value: 'MAP', label: '지도표시' },
  { value: 'COPY', label: '클립보드 복사' },
];

function getToken(): string {
  return localStorage.getItem('token') || '';
}

export default function RcsTemplateFormModal({ template, onClose, onSuccess }: Props) {
  const isEdit = !!template?.id;
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, type: '' as 'success' | 'error', message: '' });

  const [templateName, setTemplateName] = useState(template?.template_name || '');
  const [messageType, setMessageType] = useState(template?.message_type || 'rcs_sms');
  const [content, setContent] = useState(template?.content || '');
  const [mediaUrl, setMediaUrl] = useState(template?.media_url || '');
  const [brandId, setBrandId] = useState(template?.brand_id || '');
  const [brandName, setBrandName] = useState(template?.brand_name || '');
  const [buttons, setButtons] = useState<RcsButton[]>(
    (template?.buttons as RcsButton[]) || []
  );

  useEffect(() => {
    if (!toast.show) return;
    const t = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
    return () => clearTimeout(t);
  }, [toast.show]);

  // 저장 중에는 Esc로 닫지 않는다 — 요청이 날아간 뒤 화면만 사라지면 결과를 알 수 없다
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose, saving]);

  const addButton = () => {
    if (buttons.length >= 2) return;
    setButtons([...buttons, { buttonType: 'URL', name: '' }]);
  };

  const removeButton = (idx: number) => {
    setButtons(buttons.filter((_, i) => i !== idx));
  };

  const updateButton = (idx: number, field: string, value: string) => {
    const next = [...buttons];
    (next[idx] as any)[field] = value;
    setButtons(next);
  };

  const handleSave = async () => {
    if (!templateName.trim()) {
      setToast({ show: true, type: 'error', message: '템플릿 이름을 입력하세요' });
      return;
    }
    if (!content.trim()) {
      setToast({ show: true, type: 'error', message: '본문을 입력하세요' });
      return;
    }

    setSaving(true);
    try {
      const endpoint = isEdit
        ? `/api/companies/rcs-templates/${template!.id}`
        : '/api/companies/rcs-templates';

      const res = await fetch(endpoint, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          templateName,
          messageType,
          content,
          mediaUrl: messageType === 'rcs_mms' ? mediaUrl : null,
          buttons,
          brandId: brandId || null,
          brandName: brandName || null,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        setToast({ show: true, type: 'error', message: data.error || '저장 실패' });
        return;
      }

      onSuccess();
    } catch {
      setToast({ show: true, type: 'error', message: '서버 오류' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={CUI_MODAL_SCRIM}>
      <div className={`${CUI_MODAL} max-w-2xl`} role="dialog" aria-modal="true" aria-label={isEdit ? 'RCS 템플릿 수정' : 'RCS 템플릿 등록 요청'}>

        {/* ── 헤더 ─────────────────────────── */}
        <div className={CUI_MODAL_HEAD}>
          <div className="min-w-0">
            <h2 className={CUI_MODAL_TITLE}>
              {isEdit ? 'RCS 템플릿 수정' : 'RCS 템플릿 등록 요청'}
            </h2>
            {/* ★ 2026-08-17 "자동 폴백" 문구 삭제 — 대체 발송은 아직 구현돼 있지 않다. */}
            <p className={CUI_MODAL_DESC}>등록 후 검수를 거쳐 사용할 수 있습니다</p>
          </div>
          <button type="button" onClick={onClose} className={CUI_MODAL_CLOSE} aria-label="닫기">
            <X className="w-[17px] h-[17px]" />
          </button>
        </div>

        {/* ── 본문 ─────────────────────────── */}
        <div className={CUI_MODAL_BODY}>

          {/* 브랜드 정보 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={CUI_LABEL}>브랜드 ID <span className="text-neutral-400 font-normal">(선택)</span></label>
              <input value={brandId} onChange={e => setBrandId(e.target.value)}
                placeholder="RCS Biz Center에서 발급"
                className={CUI_INPUT} />
            </div>
            <div>
              <label className={CUI_LABEL}>브랜드명 <span className="text-neutral-400 font-normal">(선택)</span></label>
              <input value={brandName} onChange={e => setBrandName(e.target.value)}
                placeholder="표시될 브랜드 이름"
                className={CUI_INPUT} />
            </div>
          </div>

          {/* 템플릿 이름 */}
          <div>
            <label className={CUI_LABEL}>템플릿 이름 <span className={CUI_REQUIRED}>*</span></label>
            <input value={templateName} onChange={e => setTemplateName(e.target.value)}
              placeholder="최대 200자" maxLength={200}
              className={CUI_INPUT} />
          </div>

          {/* 메시지 유형 */}
          <div>
            <label className={CUI_LABEL}>메시지 유형</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {RCS_MESSAGE_TYPES.map(t => (
                <button key={t.value} type="button"
                  onClick={() => setMessageType(t.value)}
                  aria-pressed={messageType === t.value}
                  className={messageType === t.value ? CUI_PICK_ON : CUI_PICK_OFF}
                >
                  <div className={CUI_PICK_TITLE}>{t.label}</div>
                  <div className={CUI_PICK_DESC}>{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 본문 */}
          <div>
            <div className="flex items-baseline justify-between">
              <label className={CUI_LABEL}>본문 <span className={CUI_REQUIRED}>*</span></label>
              <span className="text-[12px] text-neutral-400 tabular-nums">{content.length}자</span>
            </div>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              rows={6} placeholder="메시지 내용을 입력하세요"
              className={CUI_TEXTAREA} />
          </div>

          {/* 미디어 URL (MMS) */}
          {messageType === 'rcs_mms' && (
            <div>
              <label className={CUI_LABEL}>미디어 URL</label>
              <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
                placeholder="이미지/동영상 URL (JPG, PNG, MP4)"
                className={CUI_INPUT} />
              <p className={CUI_HINT}>권장: 가로 800px 이상, 1MB 이하</p>
            </div>
          )}

          {/* 버튼 설정 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className={CUI_FIELDSET_TITLE}>
                버튼 <span className="text-neutral-400 font-normal text-[12.5px]">최대 2개</span>
              </h3>
              {buttons.length < 2 && (
                <button type="button" onClick={addButton}
                  className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-[12.5px] font-semibold text-indigo-600 transition hover:bg-indigo-50">
                  <Plus className="w-[13px] h-[13px]" />
                  버튼 추가
                </button>
              )}
            </div>

            {buttons.length === 0 ? (
              <p className="text-[12.5px] text-neutral-400 py-3 px-3.5 rounded-lg border border-dashed border-neutral-200 text-center">
                버튼 없이도 등록할 수 있습니다
              </p>
            ) : (
              <div className="space-y-2">
                {buttons.map((btn, idx) => (
                  <div key={idx} className="rounded-lg border border-neutral-200 bg-neutral-50 p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <select value={btn.buttonType} onChange={e => updateButton(idx, 'buttonType', e.target.value)}
                        className={`${CUI_SELECT} h-8 w-auto min-w-[120px] text-[13px] bg-white`}
                        aria-label={`${idx + 1}번 버튼 종류`}>
                        {BUTTON_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <input value={btn.name} onChange={e => updateButton(idx, 'name', e.target.value)}
                        placeholder="버튼명" maxLength={17}
                        className={`${CUI_INPUT} h-8 flex-1 text-[13px]`} />
                      <button type="button" onClick={() => removeButton(idx)}
                        className="h-8 w-8 grid place-items-center rounded-lg text-neutral-400 shrink-0 transition hover:bg-rose-50 hover:text-rose-600"
                        aria-label={`${idx + 1}번 버튼 삭제`}>
                        <Trash2 className="w-[15px] h-[15px]" />
                      </button>
                    </div>
                    {btn.buttonType === 'URL' && (
                      <input value={btn.url || ''} onChange={e => updateButton(idx, 'url', e.target.value)}
                        placeholder="https://example.com"
                        className={`${CUI_INPUT} h-8 text-[13px] bg-white`} />
                    )}
                    {btn.buttonType === 'DIAL' && (
                      <input value={btn.phoneNumber || ''} onChange={e => updateButton(idx, 'phoneNumber', e.target.value)}
                        placeholder="01012345678"
                        className={`${CUI_INPUT} h-8 text-[13px] bg-white`} />
                    )}
                    {btn.buttonType === 'COPY' && (
                      <input value={btn.copyText || ''} onChange={e => updateButton(idx, 'copyText', e.target.value)}
                        placeholder="복사할 텍스트"
                        className={`${CUI_INPUT} h-8 text-[13px] bg-white`} />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ★ 2026-08-17 대체발송 안내 블록 삭제 — 두 문장 모두 사실이 아니었다.
              ①대체 발송 기능이 아직 없다 ②아이폰은 통합 RCS(iOS 26+)로 수신 가능해졌다.
              대체 발송은 게이트웨이 축과 함께 열린다 — docs/2026-08-17-rcs-integration-design.md §3-5 */}
        </div>

        {/* ── 푸터 ─────────────────────────── */}
        <div className={CUI_MODAL_FOOT}>
          <button type="button" onClick={onClose} disabled={saving} className={CUI_BTN_OUTLINE}>
            취소
          </button>
          <button type="button" onClick={handleSave} disabled={saving} className={CUI_BTN_PRIMARY}>
            {saving ? '저장 중' : isEdit ? '수정 요청' : '등록 요청'}
          </button>
        </div>

        {toast.show && (
          <div className={toast.type === 'success' ? CUI_TOAST_SUCCESS : CUI_TOAST_ERROR} role="status">
            {toast.message}
          </div>
        )}
      </div>
    </div>
  );
}
