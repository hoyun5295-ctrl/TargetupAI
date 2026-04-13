/**
 * DmBuilderPage.tsx — 모바일 DM 빌더
 *
 * 한줄로 AI 프로 요금제 이상.
 * 본사 → 고객에게 보내는 브랜드 이벤트/프로모션 모바일 DM 제작.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use(c => {
  const t = localStorage.getItem('token');
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

// ────────────── 타입 ──────────────

interface DmSlide {
  order: number;
  layout: 'full-image' | 'text-card' | 'cta-card' | 'video';
  imageUrl?: string;
  videoUrl?: string;
  videoType?: 'youtube' | 'direct';
  caption?: string;
  // text-card 전용
  bgColor?: string;
  textColor?: string;
  heading?: string;
  // cta-card 전용
  ctaText?: string;
  ctaUrl?: string;
}

interface DmDetail {
  id: string;
  title: string;
  store_name?: string;
  header_template: string;
  footer_template: string;
  header_data: Record<string, any>;
  footer_data: Record<string, any>;
  pages: DmSlide[];
  settings: Record<string, any>;
  status: string;
  short_code?: string;
  view_count: number;
}

type Toast = { show: boolean; type: 'success' | 'error'; message: string };

// ────────────── 템플릿 정의 ──────────────

const HEADER_TEMPLATES = [
  { value: 'logo', label: '브랜드 로고', icon: '🏷️', desc: '로고 + 브랜드명' },
  { value: 'banner', label: '풀 배너', icon: '🖼️', desc: '캠페인 키비주얼 이미지' },
  { value: 'countdown', label: '카운트다운', icon: '⏰', desc: 'D-Day 이벤트 카운트' },
  { value: 'coupon', label: '쿠폰 헤더', icon: '🎟️', desc: '할인 쿠폰 코드 강조' },
];

const FOOTER_TEMPLATES = [
  { value: 'cs', label: '고객센터', icon: '📞', desc: '전화 + 이메일 + 홈페이지' },
  { value: 'cta', label: 'CTA 버튼', icon: '👆', desc: '구매하기 / 매장찾기 / 앱 다운' },
  { value: 'social', label: 'SNS', icon: '📱', desc: '인스타 / 유튜브 / 카카오' },
  { value: 'promo', label: '프로모 코드', icon: '🎁', desc: '프로모션 코드 + 사용하기' },
];

const PAGE_LAYOUTS = [
  { value: 'full-image', label: '풀 이미지', icon: '🖼️', desc: '이미지만 꽉 채움' },
  { value: 'text-card', label: '텍스트 카드', icon: '📝', desc: '배경색 + 큰 텍스트' },
  { value: 'cta-card', label: 'CTA 카드', icon: '🔗', desc: '이미지 + 버튼 + 링크' },
  { value: 'video', label: '동영상', icon: '🎬', desc: 'CF / 브랜드 필름' },
];

export default function DmBuilderPage() {
  const navigate = useNavigate();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [brandName, setBrandName] = useState('');
  const [headerTemplate, setHeaderTemplate] = useState('logo');
  const [footerTemplate, setFooterTemplate] = useState('cs');
  const [headerData, setHeaderData] = useState<Record<string, any>>({});
  const [footerData, setFooterData] = useState<Record<string, any>>({});
  const [pages, setPages] = useState<DmSlide[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(0);
  const [stats, setStats] = useState<any>(null);
  const [showStats, setShowStats] = useState(false);
  const [toast, setToast] = useState<Toast>({ show: false, type: 'success', message: '' });
  const [uploading, setUploading] = useState(false);
  const [addPageMode, setAddPageMode] = useState<string | null>(null);
  const [videoInput, setVideoInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ show: true, type, message });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  }, []);

  // ── API ──
  const resetForm = () => {
    setEditingId(null); setTitle(''); setBrandName('');
    setHeaderTemplate('logo'); setFooterTemplate('cs');
    setHeaderData({}); setFooterData({});
    setPages([]); setShortCode(null); setPreviewPage(0);
    setShowStats(false); setStats(null);
  };

  const handleSave = async () => {
    if (!title.trim()) { showToast('error', 'DM 제목을 입력해주세요.'); return; }
    if (pages.length === 0) { showToast('error', '페이지를 1개 이상 추가해주세요.'); return; }
    setSaving(true);
    try {
      const body = {
        title: title.trim(), store_name: brandName.trim() || null,
        header_template: headerTemplate, footer_template: footerTemplate,
        header_data: headerData, footer_data: footerData,
        pages, settings: {},
      };
      if (editingId) {
        await api.put(`/dm/${editingId}`, body);
        showToast('success', 'DM이 저장되었습니다.');
      } else {
        const res = await api.post('/dm', body);
        setEditingId(res.data.id);
        showToast('success', 'DM이 생성되었습니다.');
      }
    } catch (err: any) {
      showToast('error', err.response?.data?.error || '저장 실패');
    } finally { setSaving(false); }
  };

  const handlePublish = async () => {
    if (!editingId) { await handleSave(); return; }
    setPublishing(true);
    try {
      const res = await api.post(`/dm/${editingId}/publish`);
      setShortCode(res.data.short_code);
      showToast('success', '발행 완료!');
    } catch (err: any) {
      showToast('error', err.response?.data?.error || '발행 실패');
    } finally { setPublishing(false); }
  };

  const loadStats = async () => {
    if (!editingId) return;
    try {
      const res = await api.get(`/dm/${editingId}/stats`);
      setStats(res.data); setShowStats(true);
    } catch { showToast('error', '통계 로드 실패'); }
  };

  // ── 이미지 업로드 → 슬라이드 추가 ──
  const handleImageUpload = async (files: FileList, layout: 'full-image' | 'cta-card' = 'full-image') => {
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('images', f));
      const res = await api.post('/dm/upload-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const newSlides: DmSlide[] = res.data.images.map((img: any, i: number) => ({
        order: pages.length + i + 1, layout, imageUrl: img.url, caption: '',
        ...(layout === 'cta-card' ? { ctaText: '자세히 보기', ctaUrl: '' } : {}),
      }));
      setPages(prev => [...prev, ...newSlides]);
      showToast('success', `${res.data.images.length}장 업로드 완료`);
    } catch (err: any) {
      showToast('error', err.response?.data?.error || '업로드 실패');
    } finally { setUploading(false); setAddPageMode(null); }
  };

  const handleRemoveSlide = async (idx: number) => {
    const slide = pages[idx];
    if (slide.imageUrl) {
      try { await api.delete('/dm/delete-image', { data: { url: slide.imageUrl } }); } catch { /* */ }
    }
    setPages(prev => prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, order: i + 1 })));
    if (previewPage >= pages.length - 1) setPreviewPage(Math.max(0, pages.length - 2));
  };

  const moveSlide = (idx: number, dir: -1 | 1) => {
    const t = idx + dir;
    if (t < 0 || t >= pages.length) return;
    const n = [...pages];
    [n[idx], n[t]] = [n[t], n[idx]];
    setPages(n.map((p, i) => ({ ...p, order: i + 1 })));
  };

  const updateSlide = (idx: number, field: string, value: any) => {
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  const addTextCard = () => {
    setPages(prev => [...prev, {
      order: prev.length + 1, layout: 'text-card',
      bgColor: '#1a1a2e', textColor: '#ffffff',
      heading: '', caption: '',
    }]);
    setAddPageMode(null);
  };

  const addVideoSlide = () => {
    if (!videoInput.trim()) return;
    const isYt = /youtube\.com|youtu\.be/.test(videoInput);
    setPages(prev => [...prev, {
      order: prev.length + 1, layout: 'video',
      videoUrl: videoInput.trim(), videoType: isYt ? 'youtube' : 'direct', caption: '',
    }]);
    setVideoInput(''); setAddPageMode(null);
  };

  const youtubeEmbed = (url: string): string | null => {
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}?rel=0`;
    if (url.includes('youtube.com/embed/')) return url;
    return null;
  };

  const copyUrl = () => {
    if (!shortCode) return;
    navigator.clipboard.writeText(`https://hanjul-flyer.kr/dm-${shortCode}`);
    showToast('success', 'URL이 복사되었습니다.');
  };

  // ── 헤더 데이터 입력 필드 ──
  const renderHeaderFields = () => {
    switch (headerTemplate) {
      case 'logo': return (
        <input value={headerData.phone || ''} onChange={e => setHeaderData(p => ({ ...p, phone: e.target.value }))}
          className="w-full border rounded-lg px-3 py-1.5 text-xs mt-2" placeholder="고객센터 번호 (선택)" />
      );
      case 'banner': return (
        <p className="text-xs text-gray-400 mt-2">첫 번째 페이지 이미지가 배너로 사용됩니다</p>
      );
      case 'countdown': return (
        <div className="space-y-2 mt-2">
          <input value={headerData.eventDate || ''} onChange={e => setHeaderData(p => ({ ...p, eventDate: e.target.value }))}
            type="date" className="w-full border rounded-lg px-3 py-1.5 text-xs" />
          <input value={headerData.eventTitle || ''} onChange={e => setHeaderData(p => ({ ...p, eventTitle: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="이벤트명 (예: 봄 세일 오픈)" />
        </div>
      );
      case 'coupon': return (
        <div className="space-y-2 mt-2">
          <input value={headerData.couponCode || ''} onChange={e => setHeaderData(p => ({ ...p, couponCode: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs font-mono" placeholder="쿠폰 코드 (예: SPRING2026)" />
          <input value={headerData.discount || ''} onChange={e => setHeaderData(p => ({ ...p, discount: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="할인 내용 (예: 전 품목 20% OFF)" />
        </div>
      );
      default: return null;
    }
  };

  // ── 푸터 데이터 입력 필드 ──
  const renderFooterFields = () => {
    switch (footerTemplate) {
      case 'cs': return (
        <div className="space-y-2 mt-2">
          <input value={footerData.phone || ''} onChange={e => setFooterData(p => ({ ...p, phone: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="고객센터 번호" />
          <input value={footerData.email || ''} onChange={e => setFooterData(p => ({ ...p, email: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="문의 이메일" />
          <input value={footerData.website || ''} onChange={e => setFooterData(p => ({ ...p, website: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="공식 홈페이지 URL" />
        </div>
      );
      case 'cta': return (
        <div className="space-y-2 mt-2">
          <input value={footerData.ctaText || ''} onChange={e => setFooterData(p => ({ ...p, ctaText: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="버튼 텍스트 (예: 지금 구매하기)" />
          <input value={footerData.ctaUrl || ''} onChange={e => setFooterData(p => ({ ...p, ctaUrl: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="버튼 링크 URL" />
          <input value={footerData.ctaColor || ''} onChange={e => setFooterData(p => ({ ...p, ctaColor: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="버튼 색상 (#ff4444)" />
        </div>
      );
      case 'social': return (
        <div className="space-y-2 mt-2">
          <input value={footerData.instagram || ''} onChange={e => setFooterData(p => ({ ...p, instagram: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="공식 Instagram URL" />
          <input value={footerData.youtube || ''} onChange={e => setFooterData(p => ({ ...p, youtube: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="공식 YouTube URL" />
          <input value={footerData.kakao || ''} onChange={e => setFooterData(p => ({ ...p, kakao: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="카카오 채널 URL" />
        </div>
      );
      case 'promo': return (
        <div className="space-y-2 mt-2">
          <input value={footerData.promoCode || ''} onChange={e => setFooterData(p => ({ ...p, promoCode: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs font-mono" placeholder="프로모션 코드" />
          <input value={footerData.promoDesc || ''} onChange={e => setFooterData(p => ({ ...p, promoDesc: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="혜택 설명 (예: 첫 구매 15% 할인)" />
          <input value={footerData.promoUrl || ''} onChange={e => setFooterData(p => ({ ...p, promoUrl: e.target.value }))}
            className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="사용하기 링크 URL" />
        </div>
      );
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-[1440px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/dashboard')} className="text-gray-400 hover:text-gray-700 transition" title="대시보드로 돌아가기">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-xl">📱</span>
            <h1 className="text-lg font-bold text-gray-800">모바일 DM 제작</h1>
            <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">브랜드 → 고객 이벤트 DM</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={resetForm} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">초기화</button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-1.5 text-sm bg-gray-800 text-white rounded-lg hover:bg-gray-900 disabled:opacity-50 font-medium">
              {saving ? '저장중...' : '💾 저장'}
            </button>
            <button onClick={handlePublish} disabled={publishing}
              className="px-4 py-1.5 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 font-medium">
              {publishing ? '발행중...' : '🚀 발행'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1440px] mx-auto px-6 py-6">
        <div className="flex gap-6">

          {/* ════════ 좌측: 설정 ════════ */}
          <div className="w-[280px] flex-shrink-0 space-y-4 sticky top-20 self-start max-h-[calc(100vh-120px)] overflow-y-auto pb-4">
            {/* 기본 정보 */}
            <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-800">📋 DM 기본 정보</h3>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">DM 제목 *</label>
                <input value={title} onChange={e => setTitle(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                  placeholder="2026 Spring Collection" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">브랜드명</label>
                <input value={brandName} onChange={e => setBrandName(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-400 focus:border-indigo-400"
                  placeholder="SHISEIDO" />
              </div>
            </div>

            {/* 상단 디자인 */}
            <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-800">🔝 상단 디자인</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {HEADER_TEMPLATES.map(t => (
                  <button key={t.value} onClick={() => setHeaderTemplate(t.value)}
                    className={`px-2 py-2 text-xs rounded-lg border transition text-left ${headerTemplate === t.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    <div className="font-medium">{t.icon} {t.label}</div>
                    <div className={`text-[10px] mt-0.5 ${headerTemplate === t.value ? 'text-indigo-200' : 'text-gray-400'}`}>{t.desc}</div>
                  </button>
                ))}
              </div>
              {renderHeaderFields()}
            </div>

            {/* 하단 디자인 */}
            <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
              <h3 className="text-sm font-bold text-gray-800">🔚 하단 디자인</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {FOOTER_TEMPLATES.map(t => (
                  <button key={t.value} onClick={() => setFooterTemplate(t.value)}
                    className={`px-2 py-2 text-xs rounded-lg border transition text-left ${footerTemplate === t.value ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                    <div className="font-medium">{t.icon} {t.label}</div>
                    <div className={`text-[10px] mt-0.5 ${footerTemplate === t.value ? 'text-indigo-200' : 'text-gray-400'}`}>{t.desc}</div>
                  </button>
                ))}
              </div>
              {renderFooterFields()}
            </div>

            {/* 발행 URL */}
            {shortCode && (
              <div className="bg-green-50 rounded-xl border border-green-200 p-4 space-y-2">
                <div className="text-xs font-bold text-green-700">✅ 발행됨</div>
                <div className="flex items-center gap-1.5">
                  <input readOnly value={`https://hanjul-flyer.kr/dm-${shortCode}`}
                    className="flex-1 border rounded px-2 py-1.5 text-xs bg-white text-gray-700 font-mono" />
                  <button onClick={copyUrl} className="px-2 py-1.5 bg-green-600 text-white text-xs rounded hover:bg-green-700">복사</button>
                </div>
              </div>
            )}
          </div>

          {/* ════════ 중앙: 페이지 편집 ════════ */}
          <div className="flex-1 space-y-4">
            {/* 페이지 추가 */}
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-800">📄 DM 페이지 ({pages.length}p)</h3>
              </div>
              {!addPageMode ? (
                <div className="grid grid-cols-4 gap-2">
                  {PAGE_LAYOUTS.map(l => (
                    <button key={l.value} onClick={() => {
                      if (l.value === 'text-card') { addTextCard(); return; }
                      setAddPageMode(l.value);
                    }}
                      className="py-3 border-2 border-dashed rounded-xl text-center hover:border-indigo-400 hover:bg-indigo-50 transition">
                      <div className="text-lg">{l.icon}</div>
                      <div className="text-xs font-medium text-gray-600 mt-1">{l.label}</div>
                    </button>
                  ))}
                </div>
              ) : addPageMode === 'video' ? (
                <div className="flex items-center gap-2">
                  <input value={videoInput} onChange={e => setVideoInput(e.target.value)}
                    className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="YouTube 또는 동영상 URL 입력" />
                  <button onClick={addVideoSlide} disabled={!videoInput.trim()}
                    className="px-4 py-2 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600 disabled:opacity-40 font-medium">추가</button>
                  <button onClick={() => setAddPageMode(null)} className="px-3 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">취소</button>
                </div>
              ) : (
                <div>
                  <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" multiple className="hidden"
                    onChange={e => { if (e.target.files?.length) handleImageUpload(e.target.files, addPageMode as any); e.target.value = ''; }} />
                  <div className="flex items-center gap-2">
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                      className="flex-1 py-3 border-2 border-dashed border-indigo-300 rounded-xl text-indigo-600 font-medium text-sm hover:bg-indigo-50 transition disabled:opacity-50">
                      {uploading ? '업로드중...' : `📷 ${addPageMode === 'cta-card' ? 'CTA 카드' : '풀 이미지'} 파일 선택 (2MB 이하)`}
                    </button>
                    <button onClick={() => setAddPageMode(null)} className="px-3 py-3 text-sm text-gray-500 hover:bg-gray-100 rounded-lg">취소</button>
                  </div>
                </div>
              )}
            </div>

            {/* 페이지 목록 */}
            {pages.length === 0 ? (
              <div className="bg-white rounded-xl border shadow-sm p-16 text-center">
                <div className="text-5xl mb-4">📱</div>
                <p className="text-gray-500 font-medium">위에서 페이지 유형을 선택하여</p>
                <p className="text-gray-500">브랜드 모바일 DM을 만들어보세요</p>
                <p className="text-xs text-gray-400 mt-3">이미지, 동영상, 텍스트 카드, CTA 버튼을 조합할 수 있습니다</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pages.map((slide, idx) => (
                  <div key={idx} className="bg-white rounded-xl border shadow-sm p-4 group hover:shadow-md transition">
                    <div className="flex gap-4">
                      {/* 썸네일 */}
                      <div className="w-28 h-28 flex-shrink-0 rounded-lg overflow-hidden border"
                        style={slide.layout === 'text-card' ? { background: slide.bgColor || '#1a1a2e' } : { background: '#f3f4f6' }}>
                        {slide.imageUrl ? (
                          <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : slide.layout === 'text-card' ? (
                          <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold p-2 text-center" style={{ color: slide.textColor || '#fff' }}>
                            {slide.heading || 'TEXT'}
                          </div>
                        ) : slide.layout === 'video' ? (
                          <div className="w-full h-full flex items-center justify-center bg-black text-white text-2xl">▶</div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300 text-2xl">📷</div>
                        )}
                      </div>

                      {/* 편집 */}
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{idx + 1}p</span>
                          <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                            {PAGE_LAYOUTS.find(l => l.value === slide.layout)?.label || slide.layout}
                          </span>
                        </div>

                        {/* text-card 전용 */}
                        {slide.layout === 'text-card' && (
                          <div className="grid grid-cols-2 gap-2">
                            <input value={slide.heading || ''} onChange={e => updateSlide(idx, 'heading', e.target.value)}
                              className="border rounded px-2 py-1.5 text-sm" placeholder="헤드라인 텍스트" />
                            <div className="flex gap-1">
                              <input value={slide.bgColor || '#1a1a2e'} onChange={e => updateSlide(idx, 'bgColor', e.target.value)}
                                type="color" className="w-8 h-8 rounded border cursor-pointer" />
                              <input value={slide.textColor || '#ffffff'} onChange={e => updateSlide(idx, 'textColor', e.target.value)}
                                type="color" className="w-8 h-8 rounded border cursor-pointer" />
                            </div>
                          </div>
                        )}

                        {/* cta-card 전용 */}
                        {slide.layout === 'cta-card' && (
                          <div className="grid grid-cols-2 gap-2">
                            <input value={slide.ctaText || ''} onChange={e => updateSlide(idx, 'ctaText', e.target.value)}
                              className="border rounded px-2 py-1.5 text-sm" placeholder="버튼 텍스트 (예: 지금 구매하기)" />
                            <input value={slide.ctaUrl || ''} onChange={e => updateSlide(idx, 'ctaUrl', e.target.value)}
                              className="border rounded px-2 py-1.5 text-sm" placeholder="버튼 링크 URL" />
                          </div>
                        )}

                        {/* 동영상 */}
                        {slide.layout === 'video' && slide.videoUrl && (
                          <input value={slide.videoUrl} onChange={e => updateSlide(idx, 'videoUrl', e.target.value)}
                            className="w-full border rounded px-2 py-1 text-xs text-gray-600" />
                        )}

                        {/* 공통: 캡션 */}
                        <input value={slide.caption || ''} onChange={e => updateSlide(idx, 'caption', e.target.value)}
                          className="w-full border rounded px-2 py-1.5 text-sm" placeholder="설명 텍스트 (선택)" />
                      </div>

                      {/* 순서/삭제 */}
                      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition">
                        <button onClick={() => moveSlide(idx, -1)} disabled={idx === 0}
                          className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-30">↑</button>
                        <button onClick={() => moveSlide(idx, 1)} disabled={idx === pages.length - 1}
                          className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-30">↓</button>
                        <button onClick={() => handleRemoveSlide(idx)}
                          className="w-7 h-7 rounded bg-red-50 hover:bg-red-100 text-red-500 text-sm">✕</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ════════ 우측: 미리보기 + 통계 ════════ */}
          <div className="w-[300px] flex-shrink-0 space-y-4 sticky top-20 self-start">
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">미리보기</h3>
              <div className="mx-auto" style={{ width: 252, borderRadius: 24, border: '3px solid #222', overflow: 'hidden', background: '#fff' }}>
                <div style={{ height: 24, background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#888', fontSize: 10 }}>{brandName || 'Mobile DM'}</span>
                </div>
                <div style={{ height: 440, overflow: 'hidden', position: 'relative' }}>
                  {pages.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ccc', fontSize: 12 }}>
                      페이지를 추가하세요
                    </div>
                  ) : (
                    <>
                      {pages[previewPage] && (() => {
                        const s = pages[previewPage];
                        return (
                          <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                            {s.layout === 'text-card' ? (
                              <div style={{ flex: 1, background: s.bgColor || '#1a1a2e', color: s.textColor || '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                                {s.heading && <div style={{ fontSize: 18, fontWeight: 800, textAlign: 'center', lineHeight: 1.4 }}>{s.heading}</div>}
                                {s.caption && <div style={{ fontSize: 11, marginTop: 8, opacity: 0.8, textAlign: 'center' }}>{s.caption}</div>}
                              </div>
                            ) : (
                              <>
                                {s.imageUrl && <img src={s.imageUrl} alt="" style={{ width: '100%', objectFit: 'cover', flex: 1, minHeight: 0 }} />}
                                {s.videoUrl && (
                                  <div style={{ flex: s.imageUrl ? 0 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', minHeight: s.imageUrl ? 0 : '100%' }}>
                                    {youtubeEmbed(s.videoUrl) ? (
                                      <iframe src={youtubeEmbed(s.videoUrl)!} style={{ width: '100%', height: 142, border: 0 }} />
                                    ) : <div style={{ color: '#fff', fontSize: 11 }}>▶ 동영상</div>}
                                  </div>
                                )}
                                {s.caption && <div style={{ padding: '8px 12px', fontSize: 11, color: '#333' }}>{s.caption}</div>}
                                {s.layout === 'cta-card' && s.ctaText && (
                                  <div style={{ padding: '8px 16px 12px' }}>
                                    <div style={{ background: '#4f46e5', color: '#fff', textAlign: 'center', padding: '8px', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>
                                      {s.ctaText}
                                    </div>
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        );
                      })()}
                      {pages.length > 1 && (
                        <>
                          <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 4 }}>
                            {pages.map((_, i) => (
                              <span key={i} onClick={() => setPreviewPage(i)}
                                style={{ width: i === previewPage ? 16 : 6, height: 6, borderRadius: 3, background: i === previewPage ? '#4f46e5' : '#ddd', cursor: 'pointer', transition: 'all 0.2s' }} />
                            ))}
                          </div>
                          <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
                            <button onClick={() => setPreviewPage(p => Math.max(0, p - 1))}
                              style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.3)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, opacity: previewPage === 0 ? 0 : 1 }}>‹</button>
                            <button onClick={() => setPreviewPage(p => Math.min(pages.length - 1, p + 1))}
                              style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.3)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, opacity: previewPage === pages.length - 1 ? 0 : 1 }}>›</button>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
                <div style={{ height: 20, background: '#222' }} />
              </div>
              <div className="text-center text-xs text-gray-400 mt-2">
                {pages.length > 0 ? `${previewPage + 1} / ${pages.length} 페이지` : ''}
              </div>
            </div>

            {/* 통계 */}
            {editingId && shortCode && (
              <div className="bg-white rounded-xl border shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">📊 열람 통계</h3>
                  <button onClick={loadStats} className="text-xs text-indigo-600 hover:underline">새로고침</button>
                </div>
                {!showStats ? (
                  <button onClick={loadStats} className="w-full py-2 text-sm text-gray-500 hover:bg-gray-50 rounded-lg border border-dashed">통계 보기</button>
                ) : stats ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-indigo-50 rounded-lg p-2.5 text-center">
                        <div className="text-lg font-bold text-indigo-700">{stats.summary?.total_views || 0}</div>
                        <div className="text-[10px] text-indigo-500">총 열람</div>
                      </div>
                      <div className="bg-green-50 rounded-lg p-2.5 text-center">
                        <div className="text-lg font-bold text-green-700">{stats.summary?.unique_viewers || 0}</div>
                        <div className="text-[10px] text-green-500">순 열람자</div>
                      </div>
                      <div className="bg-purple-50 rounded-lg p-2.5 text-center">
                        <div className="text-lg font-bold text-purple-700">{stats.summary?.avg_page_reached || '-'}</div>
                        <div className="text-[10px] text-purple-500">평균 도달</div>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-2.5 text-center">
                        <div className="text-lg font-bold text-amber-700">{stats.summary?.completed_views || 0}</div>
                        <div className="text-[10px] text-amber-500">완독</div>
                      </div>
                    </div>
                    {stats.viewers?.length > 0 && (
                      <div className="max-h-[180px] overflow-y-auto border rounded-lg mt-2">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr><th className="px-2 py-1 text-left">전화번호</th><th className="px-2 py-1 text-center">도달</th><th className="px-2 py-1 text-center">시간</th></tr>
                          </thead>
                          <tbody>
                            {stats.viewers.map((v: any, i: number) => (
                              <tr key={i} className="border-t">
                                <td className="px-2 py-1 font-mono">{v.phone}</td>
                                <td className="px-2 py-1 text-center">{v.max_page}/{v.total_pages}p</td>
                                <td className="px-2 py-1 text-center text-gray-400">{v.total_duration}초</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>

      {toast.show && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
