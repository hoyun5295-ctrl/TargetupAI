import { useState, useEffect } from 'react';
import { formatDate } from '../utils/formatDate';

interface CustomerDBModalProps {
  onClose: () => void;
  token: string | null;
}

export default function CustomerDBModal({ onClose, token }: CustomerDBModalProps) {
  const [customers, setCustomers] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const limit = 20;

  // 검색
  const [searchValue, setSearchValue] = useState('');

  // 필터
  const [filterGender, setFilterGender] = useState('all');
  const [filterGrade, setFilterGrade] = useState('all');
  const [filterRegion, setFilterRegion] = useState('all');
  const [filterSmsOptIn, setFilterSmsOptIn] = useState('all');

  // 필터 옵션 (API에서 가져옴)
  const [gradeOptions, setGradeOptions] = useState<string[]>([]);
  const [regionOptions, setRegionOptions] = useState<string[]>([]);

  // 상세보기
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    fetchFilterOptions();
    fetchCustomers(1);
  }, []);

  const fetchFilterOptions = async () => {
    try {
      const res = await fetch('/api/customers/filter-options', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setGradeOptions(data.grades || []);
      setRegionOptions(data.regions || []);
    } catch (error) {
      console.error('필터 옵션 조회 에러:', error);
    }
  };

  const fetchCustomers = async (p: number, overrides?: { gender?: string; grade?: string; region?: string; smsOptIn?: string; search?: string }) => {
    setLoading(true);
    setSelectedCustomer(null); // 검색/필터 변경 시 상세 패널 초기화
    try {
      const currentGender = overrides?.gender ?? filterGender;
      const currentGrade = overrides?.grade ?? filterGrade;
      const currentRegion = overrides?.region ?? filterRegion;
      const currentSmsOptIn = overrides?.smsOptIn ?? filterSmsOptIn;
      const currentSearch = overrides?.search ?? searchValue;

      const params = new URLSearchParams({ page: String(p), limit: String(limit) });
      if (currentSearch.trim()) params.set('search', currentSearch.trim());
      if (currentGender !== 'all') params.set('gender', currentGender);
      if (currentGrade !== 'all') params.set('grade', currentGrade);
      if (currentSmsOptIn === 'true') params.set('smsOptIn', 'true');
      if (currentSmsOptIn === 'false') params.set('smsOptIn', 'false');
      // 지역은 기존 API에서 search로 처리되므로 별도 처리 불필요시 검색으로 통합
      // 지역 필터가 필요하면 filters JSON 사용
      if (currentRegion !== 'all') {
        const filters = JSON.stringify({ region: { operator: 'contains', value: currentRegion } });
        params.set('filters', filters);
      }

      const res = await fetch(`/api/customers?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setCustomers(data.customers || []);
      setTotal(data.pagination?.total || 0);
      setPage(p);
    } catch (error) {
      console.error('고객 조회 에러:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDetail = async (customerId: number) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/customers/${customerId}`, { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setSelectedCustomer(data.customer || null);
    } catch (error) {
      console.error('고객 상세 조회 에러:', error);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleSearch = () => { setPage(1); fetchCustomers(1); };
  const handleFilterChange = (key: string, value: string) => {
    const overrides: any = {};
    if (key === 'gender') { setFilterGender(value); overrides.gender = value; }
    if (key === 'grade') { setFilterGrade(value); overrides.grade = value; }
    if (key === 'region') { setFilterRegion(value); overrides.region = value; }
    if (key === 'smsOptIn') { setFilterSmsOptIn(value); overrides.smsOptIn = value; }
    setPage(1);
    fetchCustomers(1, overrides);
  };
  const handleReset = () => {
    setSearchValue('');
    setFilterGender('all');
    setFilterGrade('all');
    setFilterRegion('all');
    setFilterSmsOptIn('all');
    setPage(1);
    fetchCustomers(1, { gender: 'all', grade: 'all', region: 'all', smsOptIn: 'all', search: '' });
  };

  const formatPhone = (phone: string) => {
    if (!phone) return '-';
    const cleaned = phone.replace(/\D/g, '');
    if (cleaned.length === 11) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
    if (cleaned.length === 10) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    return phone;
  };

  const totalPages = Math.ceil(total / limit);

  // 상세보기 필드
  const detailFields: { key: string; label: string; format?: (v: any) => string }[] = [
    { key: 'name', label: '이름' },
    { key: 'phone', label: '전화번호', format: formatPhone },
    { key: 'gender', label: '성별', format: (v) => v === 'M' || v === '남' ? '남성' : v === 'F' || v === '여' ? '여성' : v || '-' },
    { key: 'age', label: '나이', format: (v) => v ? `${v}세` : '-' },
    { key: 'birth_date', label: '생년월일', format: (v) => formatDate(v) },
    { key: 'email', label: '이메일' },
    { key: 'grade', label: '등급' },
    { key: 'region', label: '지역' },
    { key: 'store_code', label: '매장코드' },
    { key: 'points', label: '포인트', format: (v) => v != null ? Number(v).toLocaleString() : '-' },
    { key: 'total_purchase_amount', label: '총구매금액', format: (v) => v != null ? `${Number(v).toLocaleString()}원` : '-' },
    { key: 'recent_purchase_date', label: '최근구매일', format: (v) => formatDate(v) },
    { key: 'sms_opt_in', label: '수신동의', format: (v) => v === true || v === 'Y' ? '동의' : '거부' },
    { key: 'created_at', label: '등록일', format: (v) => formatDate(v) },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[50]">
      <div className="bg-white rounded-xl shadow-2xl w-[1100px] max-h-[88vh] overflow-hidden flex flex-col">

        {/* 헤더 */}
        <div className="flex justify-between items-center px-6 py-4 border-b bg-gray-50">
          <div>
            <h3 className="text-lg font-bold text-gray-800">고객 DB 조회</h3>
            <span className="text-sm text-gray-500">총 {total.toLocaleString()}명</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 transition-colors text-lg">&times;</button>
        </div>

        {/* 검색 + 필터 */}
        <div className="px-6 py-3 border-b space-y-2">
          {/* 검색바 */}
          <div className="flex items-center gap-2">
            <input
              type="text" value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
              placeholder="이름 또는 전화번호 검색"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-emerald-200"
            />
            <button onClick={handleSearch} className="px-4 py-1.5 bg-emerald-500 text-white rounded-lg text-sm font-medium hover:bg-emerald-600 transition-colors">검색</button>
            <div className="w-px h-6 bg-gray-200" />
            <button onClick={handleReset} className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 transition-colors">초기화</button>
          </div>
          {/* 필터 */}
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <span className="text-gray-500 font-medium">성별</span>
            {[{ v: 'all', l: '전체' }, { v: 'F', l: '여성' }, { v: 'M', l: '남성' }].map(opt => (
              <button key={opt.v} onClick={() => handleFilterChange('gender', opt.v)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filterGender === opt.v ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {opt.l}
              </button>
            ))}
            <div className="w-px h-5 bg-gray-200" />

            <span className="text-gray-500 font-medium">등급</span>
            <select value={filterGrade} onChange={(e) => handleFilterChange('grade', e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
              <option value="all">전체</option>
              {gradeOptions.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
            <div className="w-px h-5 bg-gray-200" />

            <span className="text-gray-500 font-medium">지역</span>
            <select value={filterRegion} onChange={(e) => handleFilterChange('region', e.target.value)}
              className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-emerald-200">
              <option value="all">전체</option>
              {regionOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <div className="w-px h-5 bg-gray-200" />

            <span className="text-gray-500 font-medium">수신동의</span>
            {[{ v: 'all', l: '전체' }, { v: 'true', l: '동의' }, { v: 'false', l: '거부' }].map(opt => (
              <button key={opt.v} onClick={() => handleFilterChange('smsOptIn', opt.v)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${filterSmsOptIn === opt.v ? 'bg-emerald-100 text-emerald-700 border border-emerald-300' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                {opt.l}
              </button>
            ))}
          </div>
        </div>

        {/* 테이블 + 상세 패널 */}
        <div className="flex-1 overflow-hidden flex">
          {/* 테이블 영역 */}
          <div className={`overflow-y-auto transition-all ${selectedCustomer ? 'flex-[65]' : 'flex-1'}`}>
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500 w-12">#</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">이름</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">전화번호</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">성별</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">나이</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">등급</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-500">지역</th>
                  <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-500">수신</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="py-16 text-center text-gray-400">조회 중...</td></tr>
                ) : customers.length === 0 ? (
                  <tr><td colSpan={8} className="py-16 text-center text-gray-400">
                    {searchValue ? '검색 결과가 없습니다.' : '고객 데이터가 없습니다.'}
                  </td></tr>
                ) : (
                  customers.map((c: any, idx: number) => (
                    <tr key={c.id}
                      onClick={() => fetchDetail(c.id)}
                      className={`border-t cursor-pointer transition-colors ${selectedCustomer?.id === c.id ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-2.5 text-center text-xs text-gray-400">{(page - 1) * limit + idx + 1}</td>
                      <td className="px-3 py-2.5 text-sm font-medium text-gray-800">{c.name || '-'}</td>
                      <td className="px-3 py-2.5 font-mono text-xs text-gray-600">{formatPhone(c.phone)}</td>
                      <td className="px-3 py-2.5 text-center text-xs">{c.gender === 'M' || c.gender === '남' || c.gender === '남성' ? '남' : c.gender === 'F' || c.gender === '여' || c.gender === '여성' ? '여' : '-'}</td>
                      <td className="px-3 py-2.5 text-center text-xs text-gray-600">{c.age || '-'}</td>
                      <td className="px-3 py-2.5 text-center">
                        {c.grade ? (
                          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                            c.grade === 'VIP' ? 'bg-amber-50 text-amber-700' :
                            c.grade === 'VVIP' ? 'bg-purple-50 text-purple-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{c.grade}</span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-600">{c.region || '-'}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-block w-2 h-2 rounded-full ${c.sms_opt_in ? 'bg-green-400' : 'bg-gray-300'}`} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 상세 패널 (우측 슬라이드) */}
          {selectedCustomer && (
            <div className="flex-[35] border-l bg-gray-50 overflow-y-auto p-5">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <div className="text-lg font-bold text-gray-800">{selectedCustomer.name || '-'}</div>
                  {selectedCustomer.grade && (
                    <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      selectedCustomer.grade === 'VIP' ? 'bg-amber-100 text-amber-700' :
                      selectedCustomer.grade === 'VVIP' ? 'bg-purple-100 text-purple-700' :
                      'bg-gray-200 text-gray-600'
                    }`}>{selectedCustomer.grade}</span>
                  )}
                </div>
                <button onClick={() => setSelectedCustomer(null)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-200 text-gray-400 hover:text-gray-600 text-sm">&times;</button>
              </div>

              {detailLoading ? (
                <div className="text-center text-gray-400 py-10">불러오는 중...</div>
              ) : (
                <div className="space-y-0">
                  {detailFields.map(field => {
                    const value = selectedCustomer[field.key];
                    if (value == null && field.key !== 'sms_opt_in') return null;
                    const display = field.format ? field.format(value) : (value || '-');
                    if (display === '-' && field.key !== 'sms_opt_in' && field.key !== 'name') return null;
                    return (
                      <div key={field.key} className="flex items-center py-2.5 border-b border-gray-100">
                        <span className="w-24 flex-shrink-0 text-xs text-gray-400">{field.label}</span>
                        <span className="text-sm text-gray-800 font-medium">{display}</span>
                      </div>
                    );
                  })}

                  {/* custom_fields 표시 */}
                  {selectedCustomer.custom_fields && Object.keys(selectedCustomer.custom_fields).length > 0 && (
                    <>
                      <div className="text-xs text-gray-400 font-medium mt-4 mb-2">추가 정보</div>
                      {Object.entries(selectedCustomer.custom_fields).map(([key, value]) => (
                        <div key={key} className="flex items-center py-2.5 border-b border-gray-100">
                          <span className="w-24 flex-shrink-0 text-xs text-gray-400">{key}</span>
                          <span className="text-sm text-gray-800 font-medium">{String(value) || '-'}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 페이지네이션 */}
        {totalPages > 0 && (
          <div className="flex items-center justify-center gap-1.5 py-3 border-t bg-gray-50">
            <button
              onClick={() => { const p = Math.max(1, page - 1); setPage(p); fetchCustomers(p); }}
              disabled={page <= 1}
              className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              이전
            </button>
            {Array.from({ length: Math.min(totalPages, 10) }, (_, i) => {
              let start = Math.max(1, page - 4);
              if (start + 9 > totalPages) start = Math.max(1, totalPages - 9);
              return start + i;
            }).filter(p => p <= totalPages).map(p => (
              <button key={p} onClick={() => { setPage(p); fetchCustomers(p); }}
                className={`w-8 h-8 text-sm rounded-md border transition-colors ${page === p ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white hover:bg-gray-50'}`}>
                {p}
              </button>
            ))}
            <button
              onClick={() => { const p = Math.min(totalPages, page + 1); setPage(p); fetchCustomers(p); }}
              disabled={page >= totalPages}
              className="px-3 py-1 text-sm rounded-md border bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              다음
            </button>
            <span className="text-xs text-gray-400 ml-2">{page} / {totalPages} 페이지</span>
          </div>
        )}
      </div>
    </div>
  );
}
