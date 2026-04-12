/**
 * ★ 전단AI QR 쿠폰 관리 페이지
 *
 * 기능:
 *   - 쿠폰 캠페인 목록 (발급수/사용수/전환율)
 *   - 쿠폰 생성 모달 (할인유형/금액/만료일/최대수량)
 *   - 쿠폰 사용 처리 (코드 입력 or 전화번호 검색)
 *   - 효과 대시보드 (간단 통계)
 *
 * API: /api/flyer/coupons (CT-F15)
 */

import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, Input } from '../components/ui';
import AlertModal from '../components/AlertModal';

interface CouponCampaign {
  id: string;
  coupon_name: string;
  coupon_type: 'fixed' | 'percent' | 'free_item';
  discount_value: number;
  discount_description: string | null;
  min_purchase: number;
  qr_code: string;
  qr_url: string;
  qr_data_url: string;
  max_issues: number | null;
  issued_count: number;
  redeemed_count: number;
  expires_at: string | null;
  status: string;
  created_at: string;
}

interface Coupon {
  id: string;
  customer_phone: string;
  customer_name: string | null;
  coupon_code: string;
  status: string;
  issued_at: string;
  redeemed_at: string | null;
  purchase_amount: number | null;
}

export default function CouponPage({ token: _token }: { token: string }) {
  const [campaigns, setCampaigns] = useState<CouponCampaign[]>([]);
  const [loading, setLoading] = useState(true);

  // 생성 모달
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    coupon_name: '',
    coupon_type: 'fixed' as 'fixed' | 'percent' | 'free_item',
    discount_value: '',
    discount_description: '',
    min_purchase: '',
    max_issues: '',
    expires_at: '',
  });
  const [saving, setSaving] = useState(false);

  // 상세 모달
  const [selectedCampaign, setSelectedCampaign] = useState<CouponCampaign | null>(null);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  // 사용 처리 모달
  const [showRedeem, setShowRedeem] = useState(false);
  const [redeemCode, setRedeemCode] = useState('');
  const [redeemAmount, setRedeemAmount] = useState('');
  const [redeeming, setRedeeming] = useState(false);

  // 전화번호 조회
  const [lookupPhone, setLookupPhone] = useState('');
  const [lookupResults, setLookupResults] = useState<any[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);

  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({ show: false, title: '', message: '', type: 'info' });

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/coupons`);
      if (res.ok) setCampaigns(await res.json());
    } catch (e) {
      console.error('쿠폰 캠페인 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadCampaigns(); }, [loadCampaigns]);

  // 쿠폰 생성
  const handleCreate = async () => {
    if (!form.coupon_name || !form.discount_value) {
      setAlert({ show: true, title: '입력 오류', message: '쿠폰명과 할인값을 입력해주세요.', type: 'error' });
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/coupons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coupon_name: form.coupon_name,
          coupon_type: form.coupon_type,
          discount_value: Number(form.discount_value),
          discount_description: form.discount_description || undefined,
          min_purchase: form.min_purchase ? Number(form.min_purchase) : undefined,
          max_issues: form.max_issues ? Number(form.max_issues) : undefined,
          expires_at: form.expires_at || undefined,
        }),
      });
      if (res.ok) {
        setAlert({ show: true, title: '생성 완료', message: 'QR 쿠폰이 생성되었습니다.', type: 'success' });
        setShowCreate(false);
        setForm({ coupon_name: '', coupon_type: 'fixed', discount_value: '', discount_description: '', min_purchase: '', max_issues: '', expires_at: '' });
        loadCampaigns();
      } else {
        const err = await res.json();
        setAlert({ show: true, title: '생성 실패', message: err.error || '오류가 발생했습니다.', type: 'error' });
      }
    } catch (e) {
      setAlert({ show: true, title: '오류', message: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // 상세 조회
  const handleDetail = async (campaign: CouponCampaign) => {
    setSelectedCampaign(campaign);
    setDetailLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/coupons/${campaign.id}/coupons`);
      if (res.ok) setCoupons(await res.json());
    } catch (e) {
      console.error('쿠폰 목록 로드 실패:', e);
    } finally {
      setDetailLoading(false);
    }
  };

  // 사용 처리
  const handleRedeem = async () => {
    if (!redeemCode.trim()) {
      setAlert({ show: true, title: '입력 오류', message: '쿠폰 코드를 입력해주세요.', type: 'error' });
      return;
    }
    setRedeeming(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/coupons/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coupon_code: redeemCode.trim(),
          purchase_amount: redeemAmount ? Number(redeemAmount) : undefined,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setAlert({ show: true, title: '사용 완료', message: `${data.discount} 적용\n고객: ${data.customerName || data.customerPhone}`, type: 'success' });
        setShowRedeem(false);
        setRedeemCode('');
        setRedeemAmount('');
        loadCampaigns();
      } else {
        setAlert({ show: true, title: '사용 실패', message: data.error || '오류', type: 'error' });
      }
    } catch (e) {
      setAlert({ show: true, title: '오류', message: '네트워크 오류', type: 'error' });
    } finally {
      setRedeeming(false);
    }
  };

  // 전화번호 조회
  const handleLookup = async () => {
    if (!lookupPhone.trim()) return;
    setLookupLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/coupons/lookup?phone=${encodeURIComponent(lookupPhone.trim())}`);
      if (res.ok) setLookupResults(await res.json());
    } catch (e) {
      console.error('조회 실패:', e);
    } finally {
      setLookupLoading(false);
    }
  };

  // 삭제
  const handleDelete = async (id: string) => {
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/coupons/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setAlert({ show: true, title: '삭제 완료', message: '쿠폰 캠페인이 비활성화되었습니다.', type: 'success' });
        loadCampaigns();
      }
    } catch (e) {
      setAlert({ show: true, title: '오류', message: '삭제 실패', type: 'error' });
    }
  };

  const formatDiscount = (c: CouponCampaign) => {
    if (c.coupon_type === 'percent') return `${c.discount_value}%`;
    if (c.coupon_type === 'free_item') return c.discount_description || '증정';
    return `${Number(c.discount_value).toLocaleString()}원`;
  };

  const conversionRate = (c: CouponCampaign) =>
    c.issued_count > 0 ? Math.round(c.redeemed_count / c.issued_count * 100) : 0;

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">QR 쿠폰</h2>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setShowRedeem(true)}>
            쿠폰 사용 처리
          </Button>
          <Button onClick={() => setShowCreate(true)}>
            + 새 쿠폰 만들기
          </Button>
        </div>
      </div>

      {/* 전화번호 조회 */}
      <SectionCard title="고객 쿠폰 조회">
        <div className="flex gap-2 mb-3">
          <Input
            value={lookupPhone}
            onChange={(e) => setLookupPhone(e.target.value)}
            placeholder="전화번호 입력 (010-0000-0000)"
            className="flex-1"
          />
          <Button onClick={handleLookup} disabled={lookupLoading}>
            {lookupLoading ? '조회 중...' : '조회'}
          </Button>
        </div>
        {lookupResults.length > 0 && (
          <div className="space-y-2">
            {lookupResults.map((c: any) => (
              <div key={c.id} className="flex items-center justify-between bg-surface-secondary rounded-lg px-4 py-3">
                <div>
                  <span className="font-mono font-bold text-primary">{c.coupon_code}</span>
                  <span className="ml-2 text-sm text-text-secondary">{c.coupon_name}</span>
                  <span className="ml-2 text-xs text-text-tertiary">{c.discount_description}</span>
                </div>
                <Button size="sm" onClick={() => { setRedeemCode(c.coupon_code); setShowRedeem(true); }}>
                  사용 처리
                </Button>
              </div>
            ))}
          </div>
        )}
        {lookupResults.length === 0 && lookupPhone && !lookupLoading && (
          <p className="text-sm text-text-tertiary">미사용 쿠폰이 없습니다.</p>
        )}
      </SectionCard>

      {/* 캠페인 목록 */}
      <SectionCard title="쿠폰 캠페인">
        {loading ? (
          <div className="text-center py-8 text-text-secondary">로딩 중...</div>
        ) : campaigns.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-4xl mb-3">🎫</p>
            <p className="text-text-secondary mb-4">아직 쿠폰이 없습니다</p>
            <Button onClick={() => setShowCreate(true)}>첫 쿠폰 만들기</Button>
          </div>
        ) : (
          <div className="space-y-3">
            {campaigns.map(c => (
              <div
                key={c.id}
                className="bg-surface-secondary rounded-xl p-4 cursor-pointer hover:bg-surface-hover transition-colors"
                onClick={() => handleDetail(c)}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-white">{c.coupon_name}</span>
                    <span className={`px-2 py-0.5 text-xs rounded-full ${c.status === 'active' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                      {c.status === 'active' ? '활성' : c.status === 'expired' ? '만료' : '비활성'}
                    </span>
                  </div>
                  <span className="text-lg font-bold text-primary">{formatDiscount(c)}</span>
                </div>
                <div className="flex gap-4 text-sm text-text-secondary">
                  <span>발급 <strong className="text-white">{c.issued_count}</strong></span>
                  <span>사용 <strong className="text-white">{c.redeemed_count}</strong></span>
                  <span>전환율 <strong className={conversionRate(c) > 30 ? 'text-green-400' : 'text-white'}>{conversionRate(c)}%</strong></span>
                  {c.max_issues && <span>잔여 <strong className="text-white">{Math.max(0, c.max_issues - c.issued_count)}</strong>/{c.max_issues}</span>}
                  {c.expires_at && <span className="text-text-tertiary">~{new Date(c.expires_at).toLocaleDateString('ko-KR')}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* ────── 생성 모달 ────── */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowCreate(false)}>
          <div className="bg-surface rounded-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white">새 쿠폰 만들기</h3>

            <div>
              <label className="block text-sm text-text-secondary mb-1">쿠폰명 *</label>
              <Input value={form.coupon_name} onChange={e => setForm({ ...form, coupon_name: e.target.value })} placeholder="예: 5,000원 할인 쿠폰" />
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">할인 유형 *</label>
              <select
                className="w-full bg-surface-secondary border border-border rounded-lg px-3 py-2 text-white"
                value={form.coupon_type}
                onChange={e => setForm({ ...form, coupon_type: e.target.value as any })}
              >
                <option value="fixed">정액 할인 (원)</option>
                <option value="percent">퍼센트 할인 (%)</option>
                <option value="free_item">증정품</option>
              </select>
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">
                {form.coupon_type === 'percent' ? '할인율 (%)' : form.coupon_type === 'free_item' ? '수량 (0)' : '할인 금액 (원)'} *
              </label>
              <Input type="number" value={form.discount_value} onChange={e => setForm({ ...form, discount_value: e.target.value })} placeholder={form.coupon_type === 'percent' ? '10' : '5000'} />
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">할인 설명 (선택)</label>
              <Input value={form.discount_description} onChange={e => setForm({ ...form, discount_description: e.target.value })} placeholder="예: 음료 1잔 증정" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm text-text-secondary mb-1">최소 구매금액</label>
                <Input type="number" value={form.min_purchase} onChange={e => setForm({ ...form, min_purchase: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className="block text-sm text-text-secondary mb-1">최대 발급 수</label>
                <Input type="number" value={form.max_issues} onChange={e => setForm({ ...form, max_issues: e.target.value })} placeholder="무제한" />
              </div>
            </div>

            <div>
              <label className="block text-sm text-text-secondary mb-1">만료일</label>
              <Input type="date" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} />
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setShowCreate(false)}>취소</Button>
              <Button className="flex-1" onClick={handleCreate} disabled={saving}>{saving ? '생성 중...' : '쿠폰 생성'}</Button>
            </div>
          </div>
        </div>
      )}

      {/* ────── 상세 모달 ────── */}
      {selectedCampaign && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => { setSelectedCampaign(null); setCoupons([]); }}>
          <div className="bg-surface rounded-2xl w-full max-w-lg max-h-[80vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white">{selectedCampaign.coupon_name}</h3>
              <button className="text-text-tertiary hover:text-white" onClick={() => { setSelectedCampaign(null); setCoupons([]); }}>X</button>
            </div>

            {/* QR 코드 */}
            <div className="text-center">
              {selectedCampaign.qr_data_url && (
                <img src={selectedCampaign.qr_data_url} alt="QR Code" className="mx-auto w-40 h-40 rounded-lg bg-white p-2" />
              )}
              <p className="text-sm text-text-secondary mt-2">QR 코드: <span className="font-mono font-bold text-primary">{selectedCampaign.qr_code}</span></p>
              <p className="text-xs text-text-tertiary mt-1">{selectedCampaign.qr_url}</p>
            </div>

            {/* 통계 */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-surface-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-white">{selectedCampaign.issued_count}</p>
                <p className="text-xs text-text-secondary">발급</p>
              </div>
              <div className="bg-surface-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-white">{selectedCampaign.redeemed_count}</p>
                <p className="text-xs text-text-secondary">사용</p>
              </div>
              <div className="bg-surface-secondary rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-primary">{conversionRate(selectedCampaign)}%</p>
                <p className="text-xs text-text-secondary">전환율</p>
              </div>
            </div>

            {/* 발급 목록 */}
            <div>
              <h4 className="text-sm font-semibold text-text-secondary mb-2">발급 내역</h4>
              {detailLoading ? (
                <p className="text-sm text-text-tertiary">로딩 중...</p>
              ) : coupons.length === 0 ? (
                <p className="text-sm text-text-tertiary">아직 발급된 쿠폰이 없습니다.</p>
              ) : (
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {coupons.map(c => (
                    <div key={c.id} className="flex items-center justify-between bg-surface-secondary rounded-lg px-3 py-2 text-sm">
                      <div>
                        <span className="font-mono font-bold text-white">{c.coupon_code}</span>
                        <span className="ml-2 text-text-secondary">{c.customer_phone}</span>
                        {c.customer_name && <span className="ml-1 text-text-tertiary">({c.customer_name})</span>}
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${c.status === 'issued' ? 'bg-blue-500/20 text-blue-400' : c.status === 'redeemed' ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'}`}>
                        {c.status === 'issued' ? '미사용' : c.status === 'redeemed' ? '사용' : '만료'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => handleDelete(selectedCampaign.id)}>비활성화</Button>
              <Button className="flex-1" onClick={() => { setSelectedCampaign(null); setCoupons([]); }}>닫기</Button>
            </div>
          </div>
        </div>
      )}

      {/* ────── 사용 처리 모달 ────── */}
      {showRedeem && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setShowRedeem(false)}>
          <div className="bg-surface rounded-2xl w-full max-w-sm p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-white">쿠폰 사용 처리</h3>
            <div>
              <label className="block text-sm text-text-secondary mb-1">쿠폰 코드 *</label>
              <Input
                value={redeemCode}
                onChange={e => setRedeemCode(e.target.value.toUpperCase())}
                placeholder="예: A3K7"
                className="font-mono text-xl text-center tracking-widest"
                maxLength={8}
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">구매 금액 (선택)</label>
              <Input type="number" value={redeemAmount} onChange={e => setRedeemAmount(e.target.value)} placeholder="ROI 측정용" />
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="secondary" className="flex-1" onClick={() => setShowRedeem(false)}>취소</Button>
              <Button className="flex-1" onClick={handleRedeem} disabled={redeeming}>{redeeming ? '처리 중...' : '사용 확인'}</Button>
            </div>
          </div>
        </div>
      )}

      <AlertModal
        isOpen={alert.show}
        onClose={() => setAlert({ ...alert, show: false })}
        title={alert.title}
        message={alert.message}
        type={alert.type}
      />
    </div>
  );
}
