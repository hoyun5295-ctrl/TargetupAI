import { useState, useEffect, useCallback } from 'react';
import './index.css';

// ── 타입 ──
interface FlyerItem {
  name: string;
  originalPrice: number;
  salePrice: number;
  badge?: string;
}

interface FlyerCategory {
  name: string;
  items: FlyerItem[];
}

interface Flyer {
  id: string;
  title: string;
  store_name: string;
  period_start: string | null;
  period_end: string | null;
  categories: FlyerCategory[];
  template: string;
  status: string;
  short_code: string | null;
  click_count: number;
  created_at: string;
}

// ── 카테고리 프리셋 ──
const CATEGORY_PRESETS = ['청과/야채', '공산', '축산', '수산', '냉동', '유제품', '음료/주류', '생활용품'];

// ── 템플릿 옵션 ──
const TEMPLATES = [
  { value: 'grid', label: '가격 강조형', desc: '빨간 테마, 2열 카드' },
  { value: 'list', label: '리스트형', desc: '블랙+골드 프리미엄' },
  { value: 'highlight', label: '특가 하이라이트', desc: '다크 모드, TODAY\'S PICK' },
];

// ── API 베이스 URL ──
const API_BASE = import.meta.env.VITE_API_URL || '';

function getToken(): string {
  return localStorage.getItem('flyer_token') || '';
}

// ============================================================
// 로그인 화면
// ============================================================
function LoginPage({ onLogin }: { onLogin: (token: string, user: any) => void }) {
  const [loginId, setLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginId, password }),
      });

      const data = await res.json();

      if (res.ok && data.token) {
        localStorage.setItem('flyer_token', data.token);
        localStorage.setItem('flyer_user', JSON.stringify(data.user));
        onLogin(data.token, data.user);
      } else {
        setError(data.error || '로그인에 실패했습니다.');
      }
    } catch {
      setError('서버 연결에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg max-w-sm w-full mx-4 p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-gray-800">전단AI</h1>
          <p className="text-sm text-gray-500 mt-1">AI 전단지 솔루션</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">아이디</label>
            <input
              type="text"
              value={loginId}
              onChange={e => setLoginId(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="아이디를 입력하세요"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="비밀번호를 입력하세요"
            />
          </div>

          {error && <p className="text-sm text-red-500 text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading || !loginId || !password}
            className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-6">hanjul-flyer.com</p>
      </div>
    </div>
  );
}

// ============================================================
// 메인 앱
// ============================================================
function App() {
  const [token, setToken] = useState<string>(getToken());
  const [user, setUser] = useState<any>(() => {
    const saved = localStorage.getItem('flyer_user');
    return saved ? JSON.parse(saved) : null;
  });

  const [flyers, setFlyers] = useState<Flyer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingFlyer, setEditingFlyer] = useState<Flyer | null>(null);

  // 폼 state
  const [title, setTitle] = useState('');
  const [storeName, setStoreName] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [template, setTemplate] = useState('grid');
  const [categories, setCategories] = useState<FlyerCategory[]>([
    { name: '청과/야채', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }
  ]);

  // 모달
  const [alertModal, setAlertModal] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({
    show: false, title: '', message: '', type: 'info'
  });
  const [copyModal, setCopyModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState<{ show: boolean; flyerId: string; flyerTitle: string }>({
    show: false, flyerId: '', flyerTitle: ''
  });

  // 로그인 핸들러
  const handleLogin = (t: string, u: any) => {
    setToken(t);
    setUser(u);
  };

  // 로그아웃
  const handleLogout = () => {
    localStorage.removeItem('flyer_token');
    localStorage.removeItem('flyer_user');
    setToken('');
    setUser(null);
  };

  // 전단지 목록 로드
  const loadFlyers = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/flyer/flyers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) { handleLogout(); return; }
      if (res.ok) {
        setFlyers(await res.json());
      }
    } catch (err) {
      console.error('전단지 목록 로드 실패:', err);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { if (token) loadFlyers(); }, [token, loadFlyers]);

  // 로그인 안 된 상태
  if (!token || !user) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // 폼 초기화
  const resetForm = () => {
    setTitle(''); setStoreName(''); setPeriodStart(''); setPeriodEnd('');
    setTemplate('grid');
    setCategories([{ name: '청과/야채', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]);
    setEditingFlyer(null);
  };

  // 전단지 저장
  const handleSave = async () => {
    if (!title.trim()) {
      setAlertModal({ show: true, title: '입력 오류', message: '행사명을 입력해주세요.', type: 'error' });
      return;
    }

    const cleanCategories = categories
      .map(cat => ({ ...cat, items: cat.items.filter(item => item.name.trim()) }))
      .filter(cat => cat.items.length > 0);

    if (cleanCategories.length === 0) {
      setAlertModal({ show: true, title: '입력 오류', message: '최소 1개 상품을 입력해주세요.', type: 'error' });
      return;
    }

    try {
      const body = { title: title.trim(), store_name: storeName.trim(), period_start: periodStart || null, period_end: periodEnd || null, categories: cleanCategories, template };
      const url = editingFlyer ? `${API_BASE}/api/flyer/flyers/${editingFlyer.id}` : `${API_BASE}/api/flyer/flyers`;
      const method = editingFlyer ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        setAlertModal({ show: true, title: editingFlyer ? '수정 완료' : '생성 완료', message: editingFlyer ? '전단지가 수정되었습니다.' : '전단지가 생성되었습니다.', type: 'success' });
        setShowForm(false); resetForm(); loadFlyers();
      } else {
        const err = await res.json();
        setAlertModal({ show: true, title: '오류', message: err.error || '저장에 실패했습니다.', type: 'error' });
      }
    } catch {
      setAlertModal({ show: true, title: '오류', message: '네트워크 오류가 발생했습니다.', type: 'error' });
    }
  };

  // 전단지 발행
  const handlePublish = async (flyerId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/flyer/flyers/${flyerId}/publish`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setAlertModal({ show: true, title: '발행 완료', message: `단축URL: ${data.short_url}`, type: 'success' });
        loadFlyers();
      }
    } catch {
      setAlertModal({ show: true, title: '오류', message: '발행에 실패했습니다.', type: 'error' });
    }
  };

  // 전단지 삭제
  const handleDelete = async (flyerId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/flyer/flyers/${flyerId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setAlertModal({ show: true, title: '삭제 완료', message: '전단지가 삭제되었습니다.', type: 'success' });
        setDeleteModal({ show: false, flyerId: '', flyerTitle: '' });
        loadFlyers();
      }
    } catch {
      setAlertModal({ show: true, title: '오류', message: '삭제에 실패했습니다.', type: 'error' });
    }
  };

  // 수정 모드
  const handleEdit = (flyer: Flyer) => {
    setEditingFlyer(flyer); setTitle(flyer.title); setStoreName(flyer.store_name || '');
    setPeriodStart(flyer.period_start || ''); setPeriodEnd(flyer.period_end || '');
    setTemplate(flyer.template || 'grid');
    const cats = typeof flyer.categories === 'string' ? JSON.parse(flyer.categories) : (flyer.categories || []);
    setCategories(cats.length > 0 ? cats : [{ name: '청과/야채', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]);
    setShowForm(true);
  };

  // URL 복사
  const handleCopyUrl = (code: string) => {
    navigator.clipboard.writeText(`https://hanjul-flyer.kr/${code}`);
    setCopyModal(true);
    setTimeout(() => setCopyModal(false), 2000);
  };

  // 카테고리/상품 헬퍼
  const addCategory = (name?: string) => setCategories([...categories, { name: name || '새 카테고리', items: [{ name: '', originalPrice: 0, salePrice: 0 }] }]);
  const removeCategory = (idx: number) => setCategories(categories.filter((_, i) => i !== idx));
  const updateCategoryName = (idx: number, name: string) => { const u = [...categories]; u[idx].name = name; setCategories(u); };
  const addItem = (catIdx: number) => { const u = [...categories]; u[catIdx].items.push({ name: '', originalPrice: 0, salePrice: 0 }); setCategories(u); };
  const removeItem = (catIdx: number, itemIdx: number) => { const u = [...categories]; u[catIdx].items = u[catIdx].items.filter((_, i) => i !== itemIdx); setCategories(u); };
  const updateItem = (catIdx: number, itemIdx: number, field: keyof FlyerItem, value: string | number) => { const u = [...categories]; (u[catIdx].items[itemIdx] as any)[field] = value; setCategories(u); };

  const formatDate = (d: string | null) => {
    if (!d) return '';
    const date = new Date(d);
    return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold text-gray-800">전단AI</h1>
            <p className="text-sm text-gray-500">{user.companyName || '전단지 솔루션'} · {user.loginId}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => { resetForm(); setShowForm(true); }}
              className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors font-medium"
            >
              + 전단지 만들기
            </button>
            <button onClick={handleLogout} className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700">
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* 전단지 목록 */}
        {!showForm && (
          <>
            {loading ? (
              <div className="text-center py-20 text-gray-400">로딩 중...</div>
            ) : flyers.length === 0 ? (
              <div className="text-center py-20">
                <div className="text-6xl mb-4">📄</div>
                <h2 className="text-xl font-bold text-gray-700 mb-2">아직 전단지가 없습니다</h2>
                <p className="text-gray-500 mb-6">전단지를 만들어 고객에게 SMS로 발송해보세요</p>
                <button onClick={() => { resetForm(); setShowForm(true); }} className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium">
                  첫 전단지 만들기
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {flyers.map(flyer => (
                  <div key={flyer.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className={`px-4 py-3 ${flyer.status === 'published' ? 'bg-green-50 border-b border-green-100' : 'bg-gray-50 border-b border-gray-100'}`}>
                      <div className="flex justify-between items-start">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-gray-800 truncate">{flyer.title}</h3>
                          {flyer.store_name && <p className="text-xs text-gray-500 mt-0.5">{flyer.store_name}</p>}
                        </div>
                        <span className={`ml-2 px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${flyer.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'}`}>
                          {flyer.status === 'published' ? '발행됨' : '임시저장'}
                        </span>
                      </div>
                    </div>
                    <div className="px-4 py-3">
                      {(flyer.period_start || flyer.period_end) && (
                        <p className="text-xs text-gray-500 mb-2">📅 {formatDate(flyer.period_start)} ~ {formatDate(flyer.period_end)}</p>
                      )}
                      <div className="flex items-center gap-4 text-sm">
                        <span className="text-gray-500">템플릿: <span className="font-medium text-gray-700">{TEMPLATES.find(t => t.value === flyer.template)?.label || flyer.template}</span></span>
                        {flyer.status === 'published' && <span className="text-blue-600 font-medium">👆 {flyer.click_count || 0}클릭</span>}
                      </div>
                      {flyer.short_code && (
                        <div className="mt-2 flex items-center gap-2">
                          <code className="text-xs bg-gray-100 px-2 py-1 rounded flex-1 truncate">hanjul-flyer.kr/{flyer.short_code}</code>
                          <button onClick={() => handleCopyUrl(flyer.short_code!)} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex-shrink-0">복사</button>
                        </div>
                      )}
                    </div>
                    <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
                      <span className="text-xs text-gray-400">{formatDate(flyer.created_at)}</span>
                      <div className="flex gap-2">
                        <button onClick={() => handleEdit(flyer)} className="text-xs text-gray-500 hover:text-gray-700">수정</button>
                        {flyer.status !== 'published' && <button onClick={() => handlePublish(flyer.id)} className="text-xs text-green-600 hover:text-green-800 font-medium">발행</button>}
                        {flyer.short_code && <a href={`https://hanjul-flyer.kr/${flyer.short_code}`} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:text-blue-800">미리보기</a>}
                        <button onClick={() => setDeleteModal({ show: true, flyerId: flyer.id, flyerTitle: flyer.title })} className="text-xs text-red-500 hover:text-red-700">삭제</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* 전단지 생성/수정 폼 */}
        {showForm && (
          <div className="max-w-3xl mx-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-gray-800">{editingFlyer ? '전단지 수정' : '새 전단지 만들기'}</h2>
              <button onClick={() => { setShowForm(false); resetForm(); }} className="text-sm text-gray-500 hover:text-gray-700">취소</button>
            </div>

            {/* 기본 정보 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3">기본 정보</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">행사명 *</label>
                  <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="예: 26년 3월 데레사 행사" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">매장명</label>
                  <input type="text" value={storeName} onChange={e => setStoreName(e.target.value)} placeholder="예: 데레사 마트" className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">시작일</label>
                    <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">종료일</label>
                    <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>
            </div>

            {/* 템플릿 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3">디자인 템플릿</h3>
              <div className="grid grid-cols-3 gap-3">
                {TEMPLATES.map(t => (
                  <button key={t.value} onClick={() => setTemplate(t.value)} className={`p-3 rounded-lg border-2 text-left transition-colors ${template === t.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <div className="text-sm font-bold text-gray-800">{t.label}</div>
                    <div className="text-xs text-gray-500 mt-1">{t.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* 상품 등록 */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 mb-4">
              <div className="flex justify-between items-center mb-3">
                <h3 className="text-sm font-bold text-gray-700">상품 등록</h3>
              </div>
              <div className="flex flex-wrap gap-1 mb-3">
                {CATEGORY_PRESETS.filter(p => !categories.some(c => c.name === p)).map(preset => (
                  <button key={preset} onClick={() => addCategory(preset)} className="px-2 py-0.5 text-xs bg-gray-100 hover:bg-gray-200 rounded text-gray-600 transition-colors">+{preset}</button>
                ))}
              </div>

              {categories.map((cat, catIdx) => (
                <div key={catIdx} className="mb-4 border border-gray-100 rounded-lg p-4">
                  <div className="flex justify-between items-center mb-3">
                    <input type="text" value={cat.name} onChange={e => updateCategoryName(catIdx, e.target.value)} className="font-bold text-sm text-gray-800 border-b border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none pb-1" />
                    <button onClick={() => removeCategory(catIdx)} className="text-xs text-red-400 hover:text-red-600">카테고리 삭제</button>
                  </div>
                  <div className="space-y-2">
                    <div className="grid grid-cols-12 gap-2 text-xs text-gray-500 px-1">
                      <div className="col-span-4">상품명</div><div className="col-span-2">원가</div><div className="col-span-2">할인가</div><div className="col-span-3">뱃지</div><div className="col-span-1"></div>
                    </div>
                    {cat.items.map((item, itemIdx) => (
                      <div key={itemIdx} className="grid grid-cols-12 gap-2 items-center">
                        <input type="text" value={item.name} onChange={e => updateItem(catIdx, itemIdx, 'name', e.target.value)} placeholder="상품명" className="col-span-4 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        <input type="number" value={item.originalPrice || ''} onChange={e => updateItem(catIdx, itemIdx, 'originalPrice', Number(e.target.value))} placeholder="원가" className="col-span-2 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        <input type="number" value={item.salePrice || ''} onChange={e => updateItem(catIdx, itemIdx, 'salePrice', Number(e.target.value))} placeholder="할인가" className="col-span-2 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        <input type="text" value={item.badge || ''} onChange={e => updateItem(catIdx, itemIdx, 'badge', e.target.value)} placeholder="뱃지" className="col-span-3 px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-500" />
                        <button onClick={() => removeItem(catIdx, itemIdx)} className="col-span-1 text-red-400 hover:text-red-600 text-center">✕</button>
                      </div>
                    ))}
                    <button onClick={() => addItem(catIdx)} className="w-full py-1.5 text-xs text-blue-600 hover:bg-blue-50 rounded border border-dashed border-blue-300 transition-colors">+ 상품 추가</button>
                  </div>
                </div>
              ))}
              <button onClick={() => addCategory()} className="w-full py-2 text-sm text-gray-600 hover:bg-gray-50 rounded-lg border border-dashed border-gray-300 transition-colors">+ 카테고리 추가</button>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => { setShowForm(false); resetForm(); }} className="px-6 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors">취소</button>
              <button onClick={handleSave} className="px-6 py-2.5 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors font-medium">{editingFlyer ? '수정 저장' : '전단지 저장'}</button>
            </div>
          </div>
        )}
      </div>

      {/* 알림 모달 */}
      {alertModal.show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6">
            <div className="text-center mb-4">
              <div className="text-3xl mb-2">{alertModal.type === 'success' ? '✅' : alertModal.type === 'error' ? '❌' : 'ℹ️'}</div>
              <h3 className="text-lg font-bold text-gray-800">{alertModal.title}</h3>
              <p className="text-sm text-gray-500 mt-1">{alertModal.message}</p>
            </div>
            <button onClick={() => setAlertModal({ ...alertModal, show: false })} className="w-full py-2.5 bg-gray-800 text-white rounded-lg hover:bg-gray-900 transition-colors text-sm font-medium">확인</button>
          </div>
        </div>
      )}

      {/* 복사 토스트 */}
      {copyModal && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2 rounded-lg text-sm shadow-lg z-50">URL이 복사되었습니다</div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteModal.show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full mx-4 p-6">
            <div className="text-center mb-4">
              <div className="text-3xl mb-2">🗑️</div>
              <h3 className="text-lg font-bold text-gray-800">전단지 삭제</h3>
              <p className="text-sm text-gray-500 mt-1">"{deleteModal.flyerTitle}"을(를) 삭제하시겠습니까?</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setDeleteModal({ show: false, flyerId: '', flyerTitle: '' })} className="flex-1 py-2.5 border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors text-sm">취소</button>
              <button onClick={() => handleDelete(deleteModal.flyerId)} className="flex-1 py-2.5 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors text-sm font-medium">삭제</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
