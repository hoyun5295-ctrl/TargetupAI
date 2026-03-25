import { useState, useEffect } from 'react';

interface RcsTemplate {
  id?: string;
  template_name: string;
  message_type: string;
  content: string;
  buttons: any[];
  media_url?: string;
  status?: string;
}

interface Props {
  template: RcsTemplate | null;
  onClose: () => void;
  onSuccess: () => void;
}

const RCS_MESSAGE_TYPES = [
  { value: 'rcs_sms', label: 'RCS SMS' },
  { value: 'rcs_lms', label: 'RCS LMS' },
  { value: 'rcs_mms', label: 'RCS MMS' },
  { value: 'rcs_template', label: 'RCS 템플릿' },
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

  useEffect(() => {
    if (!toast.show) return;
    const t = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
    return () => clearTimeout(t);
  }, [toast.show]);

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
        body: JSON.stringify({ templateName, messageType, content, mediaUrl: mediaUrl || null, buttons: [] }),
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
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
           style={{ animation: 'zoomIn 0.2s ease-out' }}>

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-purple-50 to-white flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {isEdit ? 'RCS 템플릿 수정' : 'RCS 템플릿 등록 요청'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">RCS 미지원 단말은 SMS로 자동 폴백됩니다</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">템플릿 이름 <span className="text-red-500">*</span></label>
            <input value={templateName} onChange={e => setTemplateName(e.target.value)}
              placeholder="최대 200자" maxLength={200}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">메시지 유형</label>
            <select value={messageType} onChange={e => setMessageType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200">
              {RCS_MESSAGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              본문 <span className="text-red-500">*</span>
              <span className="ml-2 text-gray-400">({content.length}자)</span>
            </label>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              rows={6} placeholder="메시지 내용을 입력하세요"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200 resize-none" />
          </div>

          {messageType === 'rcs_mms' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">미디어 URL</label>
              <input value={mediaUrl} onChange={e => setMediaUrl(e.target.value)}
                placeholder="이미지/동영상 URL"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-200" />
            </div>
          )}
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
