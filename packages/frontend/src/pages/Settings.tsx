import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState({
    brand_name: '',
    business_type: '',
    reject_number: '',
    monthly_budget: 1000000,
    cost_per_sms: 9.9,
    cost_per_lms: 27,
    cost_per_mms: 50,
    cost_per_kakao: 7.5,
    send_start_hour: 9,
    send_end_hour: 20,
    daily_limit_per_customer: 1,
    holiday_send_allowed: false,
    duplicate_prevention_days: 7,
    target_strategy: 'balanced',
    cross_category_allowed: true,
    approval_required: false,
  });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/companies/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data) setSettings({ ...settings, ...data });
    } catch (error) {
      console.error('설정 로드 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch('/api/companies/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      alert(data.message || '저장 완료');
    } catch (error) {
      alert('저장 실패');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center">로딩 중...</div>;

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">회사 설정</h1>
          <button onClick={() => navigate('/')} className="text-gray-500 hover:text-gray-700">
            ← 대시보드
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {/* 기본 정보 */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">📌 기본 정보</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">브랜드명</label>
              <input
                type="text"
                value={settings.brand_name || ''}
                onChange={(e) => setSettings({ ...settings, brand_name: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="예: 타겟업"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">업종</label>
              <select
                value={settings.business_type || ''}
                onChange={(e) => setSettings({ ...settings, business_type: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="">선택</option>
                <option value="cosmetics">화장품</option>
                <option value="food">식품</option>
                <option value="fashion">패션</option>
                <option value="education">교육</option>
                <option value="healthcare">헬스케어</option>
                <option value="other">기타</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">080 수신거부번호</label>
              <input
                type="text"
                value={settings.reject_number || ''}
                onChange={(e) => setSettings({ ...settings, reject_number: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
                placeholder="예: 080-123-4567"
              />
            </div>
          </div>
        </section>

        {/* 요금 설정 */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">💰 요금 설정</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">월 예산 (원)</label>
              <input
                type="number"
                value={settings.monthly_budget}
                onChange={(e) => setSettings({ ...settings, monthly_budget: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">SMS 단가 <span className="text-gray-400">(원)</span></label>
              <input
                type="number"
                step="0.1"
                value={settings.cost_per_sms}
                disabled
                className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">LMS 단가 <span className="text-gray-400">(원)</span></label>
              <input
                type="number"
                step="0.1"
                value={settings.cost_per_lms}
                disabled
                className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">MMS 단가 <span className="text-gray-400">(원)</span></label>
              <input
                type="number"
                step="0.1"
                value={settings.cost_per_mms}
                disabled
                className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">카카오 단가 <span className="text-gray-400">(원)</span></label>
              <input
                type="number"
                step="0.1"
                value={settings.cost_per_kakao}
                disabled
                className="w-full px-3 py-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed"
              />
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">※ 단가는 관리자가 설정합니다</p>
        </section>

        {/* 발송 정책 */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">📤 발송 정책</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">발송 시작시간</label>
              <select
                value={settings.send_start_hour}
                onChange={(e) => setSettings({ ...settings, send_start_hour: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{i}시</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">발송 종료시간</label>
              <select
                value={settings.send_end_hour}
                onChange={(e) => setSettings({ ...settings, send_end_hour: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                {Array.from({ length: 24 }, (_, i) => (
                  <option key={i} value={i}>{i}시</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">고객당 일일 한도</label>
              <input
                type="number"
                value={settings.daily_limit_per_customer}
                onChange={(e) => setSettings({ ...settings, daily_limit_per_customer: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">중복 방지 기간 (일)</label>
              <input
                type="number"
                value={settings.duplicate_prevention_days}
                onChange={(e) => setSettings({ ...settings, duplicate_prevention_days: Number(e.target.value) })}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.holiday_send_allowed}
                  onChange={(e) => setSettings({ ...settings, holiday_send_allowed: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">휴일 발송 허용</span>
              </label>
            </div>
          </div>
        </section>

        {/* AI 설정 */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">✨ AI 설정</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">타겟 추천 전략</label>
              <select
                value={settings.target_strategy}
                onChange={(e) => setSettings({ ...settings, target_strategy: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg"
              >
                <option value="conservative">보수적 (정확도 우선)</option>
                <option value="balanced">균형</option>
                <option value="aggressive">적극적 (도달률 우선)</option>
              </select>
            </div>
            <div className="flex items-center pt-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.cross_category_allowed}
                  onChange={(e) => setSettings({ ...settings, cross_category_allowed: e.target.checked })}
                  className="rounded"
                />
                <span className="text-sm text-gray-700">교차 카테고리 추천 허용</span>
              </label>
            </div>
          </div>
        </section>

        {/* 승인 설정 */}
        <section className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">✅ 승인 설정</h2>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.approval_required}
              onChange={(e) => setSettings({ ...settings, approval_required: e.target.checked })}
              className="rounded"
            />
            <span className="text-sm text-gray-700">발송 전 승인 필요</span>
          </label>
        </section>

        {/* 저장 버튼 */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 rounded-lg font-medium disabled:opacity-50"
          >
            {saving ? '저장 중...' : '설정 저장'}
          </button>
        </div>
      </main>
    </div>
  );
}