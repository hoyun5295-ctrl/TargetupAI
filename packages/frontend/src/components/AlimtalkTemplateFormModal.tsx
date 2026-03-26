import { useState, useEffect } from 'react';

interface AlimtalkButton {
  linkType: 'WL' | 'AL' | 'DS' | 'BK' | 'MD' | 'AC';
  name: string;
  linkM?: string;
  linkP?: string;
  schemeAndroid?: string;
  schemeIos?: string;
}

interface AlimtalkTemplate {
  id?: string;
  profile_id?: string;
  template_code?: string;
  template_name: string;
  category: string;
  message_type: string;
  emphasize_type: string;
  emphasize_title?: string;
  content: string;
  image_url?: string;
  extra_content?: string;
  ad_content?: string;
  security_flag: boolean;
  buttons: AlimtalkButton[];
  quick_replies: any[];
  status?: string;
}

interface Props {
  template: AlimtalkTemplate | null; // null = 신규
  profiles: { id: string; profile_name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}

const CATEGORIES = [
  '결제/입금', '배송/물류', '예약/일정', '회원가입/인증',
  '공지/안내', '주문/구매', '이벤트/프로모션', '고객관리', '기타',
];

const MESSAGE_TYPES = [
  { value: 'BA', label: '기본형' },
  { value: 'EX', label: '부가정보형' },
  { value: 'AD', label: '채널추가형' },
  { value: 'MI', label: '복합형' },
];

const EMPHASIZE_TYPES = [
  { value: 'NONE', label: '없음' },
  { value: 'TEXT', label: '강조표기' },
  { value: 'IMAGE', label: '이미지' },
  { value: 'ITEM_LIST', label: '아이템리스트' },
];

const BUTTON_TYPES = [
  { value: 'WL', label: '웹링크' },
  { value: 'AL', label: '앱링크' },
  { value: 'DS', label: '배송조회' },
  { value: 'AC', label: '채널추가' },
  { value: 'BK', label: '봇키워드' },
  { value: 'MD', label: '메시지전달' },
];

function getToken(): string {
  return localStorage.getItem('token') || '';
}

export default function AlimtalkTemplateFormModal({ template, profiles, onClose, onSuccess }: Props) {
  const isEdit = !!template?.id;
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState({ show: false, type: '' as 'success' | 'error', message: '' });

  // form state
  const [profileId, setProfileId] = useState(template?.profile_id || '');
  const [templateCode, setTemplateCode] = useState(template?.template_code || '');
  const [templateName, setTemplateName] = useState(template?.template_name || '');
  const [category, setCategory] = useState(template?.category || '');
  const [messageType, setMessageType] = useState(template?.message_type || 'BA');
  const [emphasizeType, setEmphasizeType] = useState(template?.emphasize_type || 'NONE');
  const [emphasizeTitle, setEmphasizeTitle] = useState(template?.emphasize_title || '');
  const [emphasizeSubTitle, setEmphasizeSubTitle] = useState('');
  const [content, setContent] = useState(template?.content || '');
  const [imageUrl, setImageUrl] = useState(template?.image_url || '');
  const [extraContent, setExtraContent] = useState(template?.extra_content || '');
  const [adContent, setAdContent] = useState(template?.ad_content || '');
  const [securityFlag, setSecurityFlag] = useState(template?.security_flag || false);
  const [buttons, setButtons] = useState<AlimtalkButton[]>(template?.buttons || []);

  // 변수 추출
  const variables = content.match(/#\{[^}]+\}/g) || [];

  useEffect(() => {
    if (!toast.show) return;
    const t = setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
    return () => clearTimeout(t);
  }, [toast.show]);

  // ★ 채널추가형 선택 시 "채널추가" 버튼 자동 삽입
  useEffect(() => {
    if (messageType === 'AD') {
      const hasChannelBtn = buttons.some(b => b.linkType === 'AC');
      if (!hasChannelBtn) {
        setButtons(prev => [...prev, { linkType: 'AC', name: '채널 추가' }]);
      }
    }
  }, [messageType]);

  const addButton = () => {
    if (buttons.length >= 5) return;
    setButtons([...buttons, { linkType: 'WL', name: '' }]);
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
    if (content.length > 1000) {
      setToast({ show: true, type: 'error', message: '본문은 1,000자 이내로 입력하세요' });
      return;
    }
    if (emphasizeType === 'TEXT' && !emphasizeTitle.trim()) {
      setToast({ show: true, type: 'error', message: '강조표기 제목을 입력하세요' });
      return;
    }

    setSaving(true);
    try {
      const endpoint = isEdit
        ? `/api/companies/kakao-templates/${template!.id}`
        : '/api/companies/kakao-templates';

      const res = await fetch(endpoint, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({
          profileId: profileId || null,
          templateCode: templateCode || null,
          templateName,
          category,
          messageType,
          emphasizeType,
          emphasizeTitle: emphasizeType === 'TEXT' ? emphasizeTitle : null,
          emphasizeSubTitle: emphasizeType === 'TEXT' ? emphasizeSubTitle : null,
          content,
          imageUrl: emphasizeType === 'IMAGE' ? imageUrl : null,
          extraContent: ['EX', 'MI'].includes(messageType) ? extraContent : null,
          adContent: ['AD', 'MI'].includes(messageType) ? adContent : null,
          securityFlag,
          buttons,
          quickReplies: [],
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
        <div className="px-6 py-4 border-b border-gray-200 bg-gradient-to-r from-amber-50 to-white flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {isEdit ? '알림톡 템플릿 수정' : '알림톡 템플릿 등록 요청'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">카카오 검수 후 승인되면 발송 가능합니다</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">&times;</button>
        </div>

        {/* Body */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-4">

          {/* 발신 프로필 + 템플릿 코드 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">발신 프로필</label>
              <select value={profileId} onChange={e => setProfileId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200">
                <option value="">선택 안 함</option>
                {profiles.map(p => <option key={p.id} value={p.id}>{p.profile_name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">템플릿 코드 <span className="text-gray-400">(선택)</span></label>
              <input value={templateCode} onChange={e => setTemplateCode(e.target.value)}
                placeholder="자동 생성 또는 직접 입력"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200" />
            </div>
          </div>

          {/* 템플릿 이름 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">템플릿 이름 <span className="text-red-500">*</span></label>
            <input value={templateName} onChange={e => setTemplateName(e.target.value)}
              placeholder="최대 200자" maxLength={200}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200" />
          </div>

          {/* 카테고리 + 메시지 유형 + 강조 유형 */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">카테고리 <span className="text-red-500">*</span></label>
              <select value={category} onChange={e => setCategory(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200">
                <option value="">선택</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">메시지 유형</label>
              <select value={messageType} onChange={e => setMessageType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200">
                {MESSAGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">강조 유형</label>
              <select value={emphasizeType} onChange={e => setEmphasizeType(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200">
                {EMPHASIZE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {/* 강조 제목 + 보조문구 (TEXT) */}
          {emphasizeType === 'TEXT' && (
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">강조표기 타이틀 <span className="text-red-500">*</span></label>
                <input value={emphasizeTitle} onChange={e => setEmphasizeTitle(e.target.value)}
                  placeholder="말풍선 상단에 표시될 강조 텍스트" maxLength={50}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">강조표기 보조문구</label>
                <input value={emphasizeSubTitle} onChange={e => setEmphasizeSubTitle(e.target.value)}
                  placeholder="강조 텍스트 하단 보조 설명 (선택)" maxLength={50}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200" />
              </div>
            </div>
          )}

          {/* 이미지 URL (IMAGE) */}
          {emphasizeType === 'IMAGE' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">이미지 URL <span className="text-red-500">*</span></label>
              <input value={imageUrl} onChange={e => setImageUrl(e.target.value)}
                placeholder="800x400px, JPG/PNG, 500KB 이하"
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200" />
            </div>
          )}

          {/* 본문 */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              본문 <span className="text-red-500">*</span>
              <span className="ml-2 text-gray-400">({content.length}/1,000자)</span>
            </label>
            <textarea value={content} onChange={e => setContent(e.target.value)}
              rows={6} maxLength={1000}
              placeholder="변수는 #{변수명} 형식으로 입력 (예: #{고객명}님 주문 확인)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 resize-none" />
            {variables.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {variables.map((v, i) => (
                  <span key={i} className="inline-block bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full">{v}</span>
                ))}
              </div>
            )}
          </div>

          {/* 부가정보 (EX, MI) */}
          {['EX', 'MI'].includes(messageType) && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">부가정보 <span className="text-gray-400">(최대 500자, 변수 불가)</span></label>
              <textarea value={extraContent} onChange={e => setExtraContent(e.target.value)}
                rows={3} maxLength={500}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200 resize-none" />
            </div>
          )}

          {/* 광고문구 (AD, MI) */}
          {['AD', 'MI'].includes(messageType) && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">광고문구 <span className="text-gray-400">(최대 80자, 변수/URL 불가)</span></label>
              <input value={adContent} onChange={e => setAdContent(e.target.value)}
                maxLength={80}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-200" />
            </div>
          )}

          {/* 보안 템플릿 */}
          <div className="flex items-center gap-2">
            <input type="checkbox" id="securityFlag" checked={securityFlag}
              onChange={e => setSecurityFlag(e.target.checked)}
              className="w-4 h-4 text-amber-600 border-gray-300 rounded focus:ring-amber-500" />
            <label htmlFor="securityFlag" className="text-sm text-gray-600">보안 템플릿 (개인정보 포함)</label>
          </div>

          {/* 버튼 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">버튼 (최대 5개)</label>
              <button onClick={addButton} disabled={buttons.length >= 5}
                className="text-xs text-amber-600 hover:text-amber-700 disabled:text-gray-300">
                + 버튼 추가
              </button>
            </div>
            {buttons.map((btn, idx) => (
              <div key={idx} className="flex flex-wrap gap-2 mb-2 items-start bg-gray-50 p-2 rounded-lg">
                <select value={btn.linkType} onChange={e => updateButton(idx, 'linkType', e.target.value)}
                  className="border border-gray-300 rounded px-2 py-1 text-xs w-24">
                  {BUTTON_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                <input value={btn.name} onChange={e => updateButton(idx, 'name', e.target.value)}
                  placeholder="버튼명 (최대 14자)" maxLength={14}
                  className="border border-gray-300 rounded px-2 py-1 text-xs flex-1" />
                {btn.linkType === 'WL' && (
                  <>
                    <input value={btn.linkM || ''} onChange={e => updateButton(idx, 'linkM', e.target.value)}
                      placeholder="모바일 URL"
                      className="border border-gray-300 rounded px-2 py-1 text-xs flex-1" />
                    <input value={btn.linkP || ''} onChange={e => updateButton(idx, 'linkP', e.target.value)}
                      placeholder="PC URL"
                      className="border border-gray-300 rounded px-2 py-1 text-xs flex-1" />
                  </>
                )}
                {btn.linkType === 'AL' && (
                  <>
                    <input value={btn.schemeAndroid || ''} onChange={e => updateButton(idx, 'schemeAndroid', e.target.value)}
                      placeholder="Android scheme"
                      className="border border-gray-300 rounded px-2 py-1 text-xs flex-1" />
                    <input value={btn.schemeIos || ''} onChange={e => updateButton(idx, 'schemeIos', e.target.value)}
                      placeholder="iOS scheme"
                      className="border border-gray-300 rounded px-2 py-1 text-xs flex-1" />
                  </>
                )}
                <button onClick={() => removeButton(idx)} className="text-red-400 hover:text-red-600 text-sm px-1">&times;</button>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex justify-end gap-3">
          <button onClick={onClose}
            className="px-5 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm transition">
            취소
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
            {saving ? '저장 중...' : isEdit ? '수정 요청' : '등록 요청'}
          </button>
        </div>

        {/* Toast */}
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
