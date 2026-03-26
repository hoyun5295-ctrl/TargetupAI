import { useState, useEffect } from 'react';

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
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
           style={{ animation: 'zoomIn 0.2s ease-out' }}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-white flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {isEdit ? 'RCS 템플릿 수정' : 'RCS 템플릿 등록 요청'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">RCS 미지원 단말은 SMS/LMS로 자동 폴백됩니다</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">

          {/* 브랜드 정보 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">브랜드 ID <span className="text-gray-400">(선택)</span></label>
              <input value={brandId} onChange={e => setBrandId(e.target.value)}
                placeholder="RCS Biz Center에서 발급"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">브랜드명 <span className="text-gray-400">(선택)</span></label>
              <input value={brandName} onChange={e => setBrandName(e.target.value)}
                placeholder="표시될 브랜드 이름"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
            </div>
          </div>

          {/* 템플릿 이름 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">템플릿 이름 <span className="text-red-500">*</span></label>
            <input value={templateName} onChange={e => setTemplateName(e.target.value)}
              placeholder="최대 200자" maxLength={200}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
          </div>

          {/* 메시지 유형 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">메시지 유형</label>
            <div className="grid grid-cols-2 gap-2">
              {RCS_MESSAGE_TYPES.map(t => (
                <button key={t.value}
                  onClick={() => setMessageType(t.value)}
                  className={`p-2.5 border rounded-lg text-left transition-colors ${
                    messageType === t.value
                      ? 'border-purple-500 bg-purple-50'
                      : 'border-gray-200 hover:border-purple-300'
                  }`}
                >
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* 본문 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              본문 <span className="text-red-500">*</span>
              <span className="ml-2 text-gray-400">({content.length}자)</span>
            </label>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              rows={6} placeholder="메시지 내용을 입력하세요"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 resize-none" />
          </div>

          {/* 미디어 URL (MMS) */}
          {messageType === 'rcs_mms' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">미디어 URL</label>
              <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
                placeholder="이미지/동영상 URL (JPG, PNG, MP4)"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
              <p className="text-xs text-gray-400 mt-1">권장: 가로 800px 이상, 1MB 이하</p>
            </div>
          )}

          {/* 버튼 설정 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">버튼 <span className="text-gray-400">(최대 2개)</span></label>
              {buttons.length < 2 && (
                <button onClick={addButton} className="text-xs text-purple-600 hover:text-purple-800 font-medium">+ 버튼 추가</button>
              )}
            </div>
            {buttons.length === 0 && (
              <p className="text-xs text-gray-400 py-2">버튼 없음 (선택사항)</p>
            )}
            {buttons.map((btn, idx) => (
              <div key={idx} className="border border-gray-200 rounded-lg p-3 mb-2 bg-gray-50">
                <div className="flex items-center gap-2 mb-2">
                  <select value={btn.buttonType} onChange={e => updateButton(idx, 'buttonType', e.target.value)}
                    className="border border-gray-300 rounded px-2 py-1 text-xs">
                    {BUTTON_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <input value={btn.name} onChange={e => updateButton(idx, 'name', e.target.value)}
                    placeholder="버튼명" maxLength={17}
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-xs" />
                  <button onClick={() => removeButton(idx)} className="text-red-400 hover:text-red-600 text-sm">✕</button>
                </div>
                {btn.buttonType === 'URL' && (
                  <input value={btn.url || ''} onChange={e => updateButton(idx, 'url', e.target.value)}
                    placeholder="https://example.com"
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                )}
                {btn.buttonType === 'DIAL' && (
                  <input value={btn.phoneNumber || ''} onChange={e => updateButton(idx, 'phoneNumber', e.target.value)}
                    placeholder="01012345678"
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                )}
                {btn.buttonType === 'COPY' && (
                  <input value={btn.copyText || ''} onChange={e => updateButton(idx, 'copyText', e.target.value)}
                    placeholder="복사할 텍스트"
                    className="w-full border border-gray-300 rounded px-2 py-1 text-xs" />
                )}
              </div>
            ))}
          </div>

          {/* 대체발송 안내 */}
          <div className="bg-purple-50 rounded-lg p-3">
            <p className="text-xs font-medium text-purple-700 mb-1">📱 대체발송 안내</p>
            <p className="text-xs text-purple-600">RCS 미지원 단말(아이폰, 채팅+ 미활성화)에는 SMS/LMS로 자동 대체 발송됩니다.</p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose}
            className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition">
            취소
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            {saving ? '저장 중...' : isEdit ? '수정 요청' : '등록 요청'}
          </button>
        </div>

        {toast.show && (
          <div className={`fixed bottom-6 right-6 px-4 py-2 rounded-lg text-sm text-white shadow-lg z-[60]
            ${toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'}`}>
            {toast.message}
          </div>
        )}
      </div>

      <style>{`
        @keyframes zoomIn {
          from { opacity: 0; transform: scale(0.92); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
