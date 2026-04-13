/**
 * DmBuilderPage.tsx — 모바일 DM 빌더
 *
 * 한줄로 AI 프로 요금제 이상.
 * 3컬럼 레이아웃: 좌측(설정) + 중앙(편집) + 우측(미리보기)
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import axios from 'axios';

const api = axios.create({ baseURL: '/api' });
api.interceptors.request.use(c => {
  const t = localStorage.getItem('token');
  if (t) c.headers.Authorization = `Bearer ${t}`;
  return c;
});

interface DmSlide {
  order: number;
  type: 'image' | 'video' | 'mixed';
  imageUrl?: string;
  videoUrl?: string;
  videoType?: 'youtube' | 'direct';
  caption?: string;
}

interface DmItem {
  id: string;
  title: string;
  store_name?: string;
  status: string;
  short_code?: string;
  view_count: number;
  page_count: number;
  created_at: string;
  updated_at: string;
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

const HEADER_TEMPLATES = [
  { value: 'default', label: '기본', desc: '로고 + 매장명 + 전화번호' },
  { value: 'brand', label: '브랜드', desc: '대형 배경 + 슬로건' },
  { value: 'minimal', label: '미니멀', desc: '매장명만' },
];
const FOOTER_TEMPLATES = [
  { value: 'default', label: '기본', desc: '주소 + 전화번호' },
  { value: 'contact', label: '연락처', desc: '영업시간 + 지도 링크' },
  { value: 'social', label: 'SNS', desc: 'SNS 아이콘 링크' },
];

export default function DmBuilderPage() {
  // ── 목록 ──
  const [dmList, setDmList] = useState<DmItem[]>([]);
  const [listLoading, setListLoading] = useState(true);

  // ── 편집 상태 ──
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [storeName, setStoreName] = useState('');
  const [headerTemplate, setHeaderTemplate] = useState('default');
  const [footerTemplate, setFooterTemplate] = useState('default');
  const [headerData, setHeaderData] = useState<Record<string, any>>({});
  const [footerData, setFooterData] = useState<Record<string, any>>({});
  const [pages, setPages] = useState<DmSlide[]>([]);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [shortCode, setShortCode] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState(0);

  // ── 통계 ──
  const [stats, setStats] = useState<any>(null);
  const [showStats, setShowStats] = useState(false);

  // ── UI ──
  const [toast, setToast] = useState<Toast>({ show: false, type: 'success', message: '' });
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── 유틸 ──
  const showToast = useCallback((type: 'success' | 'error', message: string) => {
    setToast({ show: true, type, message });
    setTimeout(() => setToast(prev => ({ ...prev, show: false })), 3000);
  }, []);

  // ── API ──
  const loadList = useCallback(async () => {
    try {
      const res = await api.get('/dm');
      setDmList(res.data);
    } catch { /* ignore */ } finally { setListLoading(false); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const res = await api.get(`/dm/${id}`);
      const d: DmDetail = res.data;
      setEditingId(d.id);
      setTitle(d.title);
      setStoreName(d.store_name || '');
      setHeaderTemplate(d.header_template || 'default');
      setFooterTemplate(d.footer_template || 'default');
      setHeaderData(typeof d.header_data === 'string' ? JSON.parse(d.header_data) : d.header_data || {});
      setFooterData(typeof d.footer_data === 'string' ? JSON.parse(d.footer_data) : d.footer_data || {});
      setPages(Array.isArray(d.pages) ? d.pages : (typeof d.pages === 'string' ? JSON.parse(d.pages) : []));
      setShortCode(d.short_code || null);
      setPreviewPage(0);
      setShowStats(false);
    } catch (err: any) {
      showToast('error', 'DM 불러오기 실패');
    }
  }, [showToast]);

  const resetForm = () => {
    setEditingId(null); setTitle(''); setStoreName('');
    setHeaderTemplate('default'); setFooterTemplate('default');
    setHeaderData({}); setFooterData({});
    setPages([]); setShortCode(null); setPreviewPage(0);
    setShowStats(false); setStats(null);
  };

  const handleSave = async () => {
    if (!title.trim()) { showToast('error', '제목을 입력해주세요.'); return; }
    if (pages.length === 0) { showToast('error', '페이지를 1개 이상 추가해주세요.'); return; }
    setSaving(true);
    try {
      const body = {
        title: title.trim(), store_name: storeName.trim() || null,
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
      loadList();
    } catch (err: any) {
      showToast('error', err.response?.data?.error || '저장 실패');
    } finally { setSaving(false); }
  };

  const handlePublish = async () => {
    if (!editingId) { showToast('error', '먼저 저장해주세요.'); return; }
    setPublishing(true);
    try {
      const res = await api.post(`/dm/${editingId}/publish`);
      setShortCode(res.data.short_code);
      showToast('success', `발행 완료! ${res.data.short_url}`);
      loadList();
    } catch (err: any) {
      showToast('error', err.response?.data?.error || '발행 실패');
    } finally { setPublishing(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return;
    try {
      await api.delete(`/dm/${id}`);
      if (editingId === id) resetForm();
      showToast('success', '삭제되었습니다.');
      loadList();
    } catch { showToast('error', '삭제 실패'); }
  };

  const loadStats = async () => {
    if (!editingId) return;
    try {
      const res = await api.get(`/dm/${editingId}/stats`);
      setStats(res.data);
      setShowStats(true);
    } catch { showToast('error', '통계 로드 실패'); }
  };

  // ── 이미지 업로드 ──
  const handleImageUpload = async (files: FileList) => {
    setUploading(true);
    try {
      const fd = new FormData();
      Array.from(files).forEach(f => fd.append('images', f));
      const res = await api.post('/dm/upload-image', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const newSlides: DmSlide[] = res.data.images.map((img: any, i: number) => ({
        order: pages.length + i + 1,
        type: 'image' as const,
        imageUrl: img.url,
        caption: '',
      }));
      setPages(prev => [...prev, ...newSlides]);
      showToast('success', `${res.data.images.length}장 업로드 완료`);
    } catch (err: any) {
      showToast('error', err.response?.data?.error || '업로드 실패');
    } finally { setUploading(false); }
  };

  // ── 이미지 삭제 ──
  const handleRemoveImage = async (idx: number) => {
    const slide = pages[idx];
    if (slide.imageUrl) {
      try { await api.delete('/dm/delete-image', { data: { url: slide.imageUrl } }); } catch { /* ignore */ }
    }
    setPages(prev => prev.filter((_, i) => i !== idx).map((p, i) => ({ ...p, order: i + 1 })));
    if (previewPage >= pages.length - 1) setPreviewPage(Math.max(0, pages.length - 2));
  };

  // ── 순서 변경 ──
  const moveSlide = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= pages.length) return;
    const newPages = [...pages];
    [newPages[idx], newPages[target]] = [newPages[target], newPages[idx]];
    setPages(newPages.map((p, i) => ({ ...p, order: i + 1 })));
  };

  // ── 동영상 URL 추가 ──
  const addVideoSlide = (url: string) => {
    if (!url.trim()) return;
    const isYoutube = /youtube\.com|youtu\.be/.test(url);
    setPages(prev => [...prev, {
      order: prev.length + 1,
      type: 'video',
      videoUrl: url.trim(),
      videoType: isYoutube ? 'youtube' : 'direct',
      caption: '',
    }]);
  };

  // ── YouTube embed URL 변환 (미리보기용) ──
  const youtubeEmbed = (url: string): string | null => {
    if (!url) return null;
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m) return `https://www.youtube.com/embed/${m[1]}?rel=0`;
    if (url.includes('youtube.com/embed/')) return url;
    return null;
  };

  // ── 슬라이드 필드 업데이트 ──
  const updateSlide = (idx: number, field: keyof DmSlide, value: any) => {
    setPages(prev => prev.map((p, i) => i === idx ? { ...p, [field]: value } : p));
  };

  // ── 복사 ──
  const copyUrl = () => {
    if (!shortCode) return;
    navigator.clipboard.writeText(`https://hanjul-flyer.kr/d/${shortCode}`);
    showToast('success', 'URL이 복사되었습니다.');
  };

  const [videoInput, setVideoInput] = useState('');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <div className="bg-white border-b sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-xl">📱</span>
            <h1 className="text-lg font-bold text-gray-800">모바일 DM 제작</h1>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={resetForm} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">새 DM</button>
            <button onClick={handleSave} disabled={saving} className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium">
              {saving ? '저장중...' : '저장'}
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="flex gap-6">
          {/* ──────── 좌측: 설정 + 목록 ──────── */}
          <div className="w-[260px] flex-shrink-0 space-y-4 sticky top-20 self-start max-h-[calc(100vh-120px)] overflow-y-auto">
            {/* DM 목록 */}
            <div className="bg-white rounded-xl border shadow-sm">
              <div className="px-4 py-3 border-b">
                <h3 className="text-sm font-semibold text-gray-700">내 DM 목록</h3>
              </div>
              <div className="max-h-[200px] overflow-y-auto">
                {listLoading ? (
                  <div className="p-4 text-center text-sm text-gray-400">로딩중...</div>
                ) : dmList.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-400">저장된 DM이 없습니다</div>
                ) : dmList.map(d => (
                  <div key={d.id}
                    onClick={() => loadDetail(d.id)}
                    className={`px-4 py-2.5 border-b last:border-0 cursor-pointer hover:bg-blue-50 transition text-sm ${editingId === d.id ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''}`}>
                    <div className="font-medium text-gray-800 truncate">{d.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${d.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {d.status === 'published' ? '발행' : '임시'}
                      </span>
                      <span className="text-xs text-gray-400">{d.page_count}p</span>
                      {d.view_count > 0 && <span className="text-xs text-gray-400">👁 {d.view_count}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 설정 */}
            <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700">DM 설정</h3>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">제목 *</label>
                <input value={title} onChange={e => setTitle(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  placeholder="4월 신상품 안내" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1 block">매장명</label>
                <input value={storeName} onChange={e => setStoreName(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-400 focus:border-blue-400"
                  placeholder="한줄마트 강남점" />
              </div>

              {/* 헤더 템플릿 */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">헤더 템플릿</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {HEADER_TEMPLATES.map(t => (
                    <button key={t.value} onClick={() => setHeaderTemplate(t.value)}
                      className={`px-2 py-1.5 text-xs rounded-lg border transition font-medium ${headerTemplate === t.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 헤더 데이터 */}
              {headerTemplate === 'default' && (
                <div className="space-y-2">
                  <input value={headerData.phone || ''} onChange={e => setHeaderData(p => ({ ...p, phone: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="전화번호 (선택)" />
                </div>
              )}
              {headerTemplate === 'brand' && (
                <div className="space-y-2">
                  <input value={headerData.slogan || ''} onChange={e => setHeaderData(p => ({ ...p, slogan: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="슬로건 (선택)" />
                  <input value={headerData.bgColor || ''} onChange={e => setHeaderData(p => ({ ...p, bgColor: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="배경색 (#1a1a1a)" />
                </div>
              )}

              {/* 푸터 템플릿 */}
              <div>
                <label className="text-xs font-medium text-gray-500 mb-1.5 block">푸터 템플릿</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {FOOTER_TEMPLATES.map(t => (
                    <button key={t.value} onClick={() => setFooterTemplate(t.value)}
                      className={`px-2 py-1.5 text-xs rounded-lg border transition font-medium ${footerTemplate === t.value ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 푸터 데이터 */}
              {footerTemplate === 'default' && (
                <div className="space-y-2">
                  <input value={footerData.address || ''} onChange={e => setFooterData(p => ({ ...p, address: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="주소 (선택)" />
                  <input value={footerData.phone || ''} onChange={e => setFooterData(p => ({ ...p, phone: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="전화번호 (선택)" />
                </div>
              )}
              {footerTemplate === 'contact' && (
                <div className="space-y-2">
                  <input value={footerData.hours || ''} onChange={e => setFooterData(p => ({ ...p, hours: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="영업시간 (예: 09:00~22:00)" />
                  <input value={footerData.phone || ''} onChange={e => setFooterData(p => ({ ...p, phone: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="전화번호" />
                  <input value={footerData.mapUrl || ''} onChange={e => setFooterData(p => ({ ...p, mapUrl: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="지도 링크 (선택)" />
                </div>
              )}
              {footerTemplate === 'social' && (
                <div className="space-y-2">
                  <input value={footerData.instagram || ''} onChange={e => setFooterData(p => ({ ...p, instagram: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="Instagram URL" />
                  <input value={footerData.kakao || ''} onChange={e => setFooterData(p => ({ ...p, kakao: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="카카오채널 URL" />
                  <input value={footerData.blog || ''} onChange={e => setFooterData(p => ({ ...p, blog: e.target.value }))}
                    className="w-full border rounded-lg px-3 py-1.5 text-xs" placeholder="블로그 URL" />
                </div>
              )}
            </div>
          </div>

          {/* ──────── 중앙: 페이지 편집 ──────── */}
          <div className="flex-1 space-y-4">
            {/* 추가 버튼 */}
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <div className="flex items-center gap-3">
                <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp" multiple className="hidden"
                  onChange={e => { if (e.target.files?.length) handleImageUpload(e.target.files); e.target.value = ''; }} />
                <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                  className="flex-1 py-3 border-2 border-dashed border-blue-300 rounded-xl text-blue-600 font-medium text-sm hover:bg-blue-50 transition disabled:opacity-50">
                  {uploading ? '업로드중...' : '📷 이미지 추가 (JPG/PNG/WebP, 2MB 이하)'}
                </button>
              </div>
              <div className="flex items-center gap-2 mt-3">
                <input value={videoInput} onChange={e => setVideoInput(e.target.value)}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm" placeholder="동영상 URL (YouTube, CF링크 등)" />
                <button onClick={() => { addVideoSlide(videoInput); setVideoInput(''); }}
                  disabled={!videoInput.trim()}
                  className="px-4 py-2 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600 disabled:opacity-40 font-medium">
                  🎬 추가
                </button>
              </div>
            </div>

            {/* 페이지 목록 */}
            {pages.length === 0 ? (
              <div className="bg-white rounded-xl border shadow-sm p-12 text-center text-gray-400">
                <div className="text-4xl mb-3">📱</div>
                <p className="text-sm">이미지나 동영상을 추가하여 모바일 DM을 만들어보세요</p>
              </div>
            ) : (
              <div className="space-y-3">
                {pages.map((slide, idx) => (
                  <div key={idx} className="bg-white rounded-xl border shadow-sm p-4 flex gap-4 items-start group hover:shadow-md transition">
                    {/* 썸네일 */}
                    <div className="w-24 h-24 flex-shrink-0 rounded-lg bg-gray-100 overflow-hidden border">
                      {slide.imageUrl ? (
                        <img src={slide.imageUrl} alt="" className="w-full h-full object-cover" />
                      ) : slide.videoUrl ? (
                        <div className="w-full h-full flex items-center justify-center text-2xl bg-red-50">🎬</div>
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300">📷</div>
                      )}
                    </div>

                    {/* 내용 */}
                    <div className="flex-1 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                          {idx + 1}페이지
                        </span>
                        <span className="text-xs text-gray-400">
                          {slide.type === 'video' ? '동영상' : slide.type === 'mixed' ? '이미지+동영상' : '이미지'}
                        </span>
                      </div>
                      {slide.videoUrl && (
                        <input value={slide.videoUrl} onChange={e => updateSlide(idx, 'videoUrl', e.target.value)}
                          className="w-full border rounded px-2 py-1 text-xs text-gray-600" placeholder="동영상 URL" />
                      )}
                      <input value={slide.caption || ''} onChange={e => updateSlide(idx, 'caption', e.target.value)}
                        className="w-full border rounded px-2 py-1.5 text-sm" placeholder="캡션 (선택)" />
                    </div>

                    {/* 액션 */}
                    <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition">
                      <button onClick={() => moveSlide(idx, -1)} disabled={idx === 0}
                        className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-30">↑</button>
                      <button onClick={() => moveSlide(idx, 1)} disabled={idx === pages.length - 1}
                        className="w-7 h-7 rounded bg-gray-100 hover:bg-gray-200 text-sm disabled:opacity-30">↓</button>
                      <button onClick={() => handleRemoveImage(idx)}
                        className="w-7 h-7 rounded bg-red-50 hover:bg-red-100 text-red-500 text-sm">✕</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ──────── 우측: 미리보기 + 발행 ──────── */}
          <div className="w-[300px] flex-shrink-0 space-y-4 sticky top-20 self-start">
            {/* 모바일 미리보기 */}
            <div className="bg-white rounded-xl border shadow-sm p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">미리보기</h3>
              <div className="mx-auto" style={{ width: 252, borderRadius: 24, border: '3px solid #222', overflow: 'hidden', background: '#fff' }}>
                {/* 상태바 모킹 */}
                <div style={{ height: 24, background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#888', fontSize: 10 }}>모바일 미리보기</span>
                </div>
                {/* 컨텐츠 */}
                <div style={{ height: 440, overflow: 'hidden', position: 'relative' }}>
                  {pages.length === 0 ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ccc', fontSize: 12 }}>
                      페이지를 추가하세요
                    </div>
                  ) : (
                    <>
                      {/* 현재 페이지 */}
                      {pages[previewPage] && (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                          {pages[previewPage].imageUrl && (
                            <img src={pages[previewPage].imageUrl} alt="" style={{ width: '100%', objectFit: 'cover', flex: 1, minHeight: 0 }} />
                          )}
                          {pages[previewPage].videoUrl && (
                            <div style={{ flex: pages[previewPage].imageUrl ? 0 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
                              {youtubeEmbed(pages[previewPage].videoUrl!) ? (
                                <iframe src={youtubeEmbed(pages[previewPage].videoUrl!)!} style={{ width: '100%', height: 160, border: 0 }} />
                              ) : (
                                <div style={{ color: '#fff', fontSize: 11 }}>🎬 동영상</div>
                              )}
                            </div>
                          )}
                          {pages[previewPage].caption && (
                            <div style={{ padding: '8px 12px', fontSize: 11, color: '#333' }}>{pages[previewPage].caption}</div>
                          )}
                        </div>
                      )}
                      {/* 페이지 인디케이터 + 네비게이션 */}
                      <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 4 }}>
                        {pages.map((_, i) => (
                          <span key={i} onClick={() => setPreviewPage(i)}
                            style={{ width: i === previewPage ? 16 : 6, height: 6, borderRadius: 3, background: i === previewPage ? '#333' : '#ddd', cursor: 'pointer', transition: 'all 0.2s' }} />
                        ))}
                      </div>
                      {pages.length > 1 && (
                        <div style={{ position: 'absolute', top: '50%', left: 0, right: 0, transform: 'translateY(-50%)', display: 'flex', justifyContent: 'space-between', padding: '0 4px' }}>
                          <button onClick={() => setPreviewPage(p => Math.max(0, p - 1))} disabled={previewPage === 0}
                            style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.3)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, opacity: previewPage === 0 ? 0 : 1 }}>‹</button>
                          <button onClick={() => setPreviewPage(p => Math.min(pages.length - 1, p + 1))} disabled={previewPage === pages.length - 1}
                            style={{ width: 24, height: 24, borderRadius: '50%', background: 'rgba(0,0,0,0.3)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, opacity: previewPage === pages.length - 1 ? 0 : 1 }}>›</button>
                        </div>
                      )}
                    </>
                  )}
                </div>
                {/* 하단 바 */}
                <div style={{ height: 20, background: '#222' }} />
              </div>
              <div className="text-center text-xs text-gray-400 mt-2">
                {pages.length > 0 ? `${previewPage + 1} / ${pages.length} 페이지` : ''}
              </div>
            </div>

            {/* 발행 + 링크 */}
            <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
              {shortCode ? (
                <>
                  <div className="flex items-center gap-2">
                    <input readOnly value={`https://hanjul-flyer.kr/d/${shortCode}`}
                      className="flex-1 border rounded-lg px-3 py-2 text-xs bg-gray-50 text-gray-700" />
                    <button onClick={copyUrl}
                      className="px-3 py-2 bg-gray-800 text-white text-xs rounded-lg hover:bg-gray-700 font-medium">복사</button>
                  </div>
                  <p className="text-xs text-green-600 font-medium">✅ 발행됨 — 이 URL로 모바일 DM을 공유하세요</p>
                </>
              ) : (
                <button onClick={handlePublish} disabled={!editingId || publishing}
                  className="w-full py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg text-sm font-medium hover:from-blue-700 hover:to-indigo-700 disabled:opacity-50 transition">
                  {publishing ? '발행중...' : '🚀 발행하기 (단축URL 생성)'}
                </button>
              )}
            </div>

            {/* 열람 통계 */}
            {editingId && shortCode && (
              <div className="bg-white rounded-xl border shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-700">열람 통계</h3>
                  <button onClick={loadStats} className="text-xs text-blue-600 hover:underline">새로고침</button>
                </div>
                {!showStats ? (
                  <button onClick={loadStats} className="w-full py-2 text-sm text-gray-500 hover:bg-gray-50 rounded-lg border border-dashed">
                    통계 보기
                  </button>
                ) : stats ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-blue-50 rounded-lg p-2.5 text-center">
                        <div className="text-lg font-bold text-blue-700">{stats.summary?.total_views || 0}</div>
                        <div className="text-xs text-blue-500">총 열람</div>
                      </div>
                      <div className="bg-green-50 rounded-lg p-2.5 text-center">
                        <div className="text-lg font-bold text-green-700">{stats.summary?.unique_viewers || 0}</div>
                        <div className="text-xs text-green-500">순 열람자</div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-purple-50 rounded-lg p-2.5 text-center">
                        <div className="text-lg font-bold text-purple-700">{stats.summary?.avg_page_reached || '-'}</div>
                        <div className="text-xs text-purple-500">평균 페이지</div>
                      </div>
                      <div className="bg-orange-50 rounded-lg p-2.5 text-center">
                        <div className="text-lg font-bold text-orange-700">{stats.summary?.completed_views || 0}</div>
                        <div className="text-xs text-orange-500">완독</div>
                      </div>
                    </div>
                    {/* 열람자 목록 */}
                    {stats.viewers && stats.viewers.length > 0 && (
                      <div className="mt-3">
                        <div className="text-xs font-medium text-gray-500 mb-1.5">열람자 상세 (최근 200명)</div>
                        <div className="max-h-[200px] overflow-y-auto border rounded-lg">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="px-2 py-1.5 text-left">전화번호</th>
                                <th className="px-2 py-1.5 text-center">도달</th>
                                <th className="px-2 py-1.5 text-center">시간</th>
                              </tr>
                            </thead>
                            <tbody>
                              {stats.viewers.map((v: any, i: number) => (
                                <tr key={i} className="border-t">
                                  <td className="px-2 py-1.5 font-mono">{v.phone}</td>
                                  <td className="px-2 py-1.5 text-center">{v.max_page}/{v.total_pages}p</td>
                                  <td className="px-2 py-1.5 text-center text-gray-500">{v.total_duration}초</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center text-sm text-gray-400 py-4">로딩중...</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 토스트 */}
      {toast.show && (
        <div className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
