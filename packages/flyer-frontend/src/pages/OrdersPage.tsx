/**
 * 전단AI 주문 관리 페이지
 *
 * 기능:
 *   - 주문 요약 카드 4개 (접수대기 / 확인중 / 준비완료 / 오늘완료)
 *   - 상태 탭 필터 (전체 / 접수대기 / 확인중 / 준비완료 / 완료 / 취소)
 *   - 주문 카드 리스트 (모바일 최적화)
 *   - 주문 상태 변경 + 취소
 *   - 페이지네이션
 *
 * API: /api/flyer/orders
 */

import { useState, useEffect, useCallback } from 'react';
import { API_BASE, apiFetch } from '../App';
import { SectionCard, Button, EmptyState } from '../components/ui';
import AlertModal from '../components/AlertModal';

// ── 타입 ──────────────────────────────────────
interface OrderItem {
  product_name: string;
  quantity: number;
  price: number;
}

interface Order {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  items: OrderItem[];
  total_amount: number;
  pickup_method: string;     // 'pickup' | 'delivery' 등
  status: OrderStatus;
  created_at: string;
  updated_at: string;
}

interface OrderSummary {
  pending_count: number;
  confirmed_count: number;
  ready_count: number;
  today_completed_count: number;
  today_completed_amount: number;
}

type OrderStatus = 'pending' | 'confirmed' | 'ready' | 'completed' | 'cancelled';
type TabKey = 'all' | OrderStatus;

// ── 상수 ──────────────────────────────────────
const STATUS_CONFIG: Record<OrderStatus, { label: string; color: string; bgColor: string }> = {
  pending:    { label: '접수대기', color: '#fbbf24', bgColor: 'rgba(251,191,36,0.15)' },
  confirmed:  { label: '확인중',   color: '#3b82f6', bgColor: 'rgba(59,130,246,0.15)' },
  ready:      { label: '준비완료', color: '#10b981', bgColor: 'rgba(16,185,129,0.15)' },
  completed:  { label: '완료',     color: '#6b7280', bgColor: 'rgba(107,114,128,0.15)' },
  cancelled:  { label: '취소',     color: '#ef4444', bgColor: 'rgba(239,68,68,0.15)' },
};

const TAB_LIST: { key: TabKey; label: string }[] = [
  { key: 'all',       label: '전체' },
  { key: 'pending',   label: '접수대기' },
  { key: 'confirmed', label: '확인중' },
  { key: 'ready',     label: '준비완료' },
  { key: 'completed', label: '완료' },
  { key: 'cancelled', label: '취소' },
];

/** 다음 상태 전환 버튼 텍스트 */
const NEXT_ACTION: Partial<Record<OrderStatus, { nextStatus: OrderStatus; label: string }>> = {
  pending:   { nextStatus: 'confirmed', label: '주문 확인' },
  confirmed: { nextStatus: 'ready',     label: '준비 완료' },
  ready:     { nextStatus: 'completed', label: '완료 처리' },
};

const PAGE_SIZE = 20;

// ── 헬퍼 ──────────────────────────────────────
function formatPhone(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.length === 11) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 7)}-${cleaned.slice(7)}`;
  if (cleaned.length === 10) return `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  return phone;
}

function formatAmount(amount: number): string {
  return Number(amount).toLocaleString() + '원';
}

function shortOrderNumber(orderNumber: string): string {
  if (!orderNumber) return '-';
  // 뒤 8자리만 표시 (또는 전체가 짧으면 그대로)
  return orderNumber.length > 8 ? '...' + orderNumber.slice(-8) : orderNumber;
}

function formatTime(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} ${formatTime(dateStr)}`;
}

function summarizeItems(items: OrderItem[]): string {
  if (!items || items.length === 0) return '-';
  const first = items[0].product_name;
  if (items.length === 1) return first;
  return `${first} 외 ${items.length - 1}건`;
}

const pickupLabel: Record<string, string> = {
  pickup: '매장수령',
  delivery: '배달',
};

// ── 컴포넌트 ──────────────────────────────────
export default function OrdersPage({ token: _token }: { token: string }) {
  // 주문 목록
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // 요약 통계
  const [summary, setSummary] = useState<OrderSummary | null>(null);

  // 상태 탭
  const [activeTab, setActiveTab] = useState<TabKey>('all');

  // 상태 변경 중 (orderId)
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // 주문 상세 모달
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  // 알림
  const [alert, setAlert] = useState<{ show: boolean; title: string; message: string; type: 'success' | 'error' | 'info' }>({
    show: false, title: '', message: '', type: 'info',
  });

  // ── 데이터 로드 ──
  const loadOrders = useCallback(async (p: number, status: TabKey) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      if (status !== 'all') params.set('status', status);
      const res = await apiFetch(`${API_BASE}/api/flyer/orders?${params}`);
      if (res.ok) {
        const data = await res.json();
        // API가 { orders, total, page, pageSize } 또는 배열 반환 가능
        if (Array.isArray(data)) {
          setOrders(data);
          setTotalPages(1);
        } else {
          setOrders(data.orders || []);
          const total = data.total || 0;
          setTotalPages(Math.max(1, Math.ceil(total / PAGE_SIZE)));
        }
      }
    } catch (e) {
      console.error('주문 목록 로드 실패:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSummary = useCallback(async () => {
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/orders/summary`);
      if (res.ok) setSummary(await res.json());
    } catch (e) {
      console.error('주문 요약 로드 실패:', e);
    }
  }, []);

  useEffect(() => {
    loadOrders(page, activeTab);
  }, [loadOrders, page, activeTab]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  // ── 탭 변경 ──
  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setPage(1);
  };

  // ── 상태 변경 ──
  const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    setUpdatingId(orderId);
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const statusLabel = STATUS_CONFIG[newStatus].label;
        setAlert({ show: true, title: '상태 변경', message: `주문이 "${statusLabel}" 상태로 변경되었습니다.`, type: 'success' });
        loadOrders(page, activeTab);
        loadSummary();
        if (selectedOrder?.id === orderId) {
          setSelectedOrder(prev => prev ? { ...prev, status: newStatus } : null);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        setAlert({ show: true, title: '변경 실패', message: err.error || '상태 변경에 실패했습니다.', type: 'error' });
      }
    } catch (e) {
      setAlert({ show: true, title: '오류', message: '네트워크 오류가 발생했습니다.', type: 'error' });
    } finally {
      setUpdatingId(null);
    }
  };

  // ── 취소 ──
  const handleCancel = async (orderId: string) => {
    handleStatusChange(orderId, 'cancelled');
  };

  // ── 상세 조회 ──
  const handleDetail = async (order: Order) => {
    try {
      const res = await apiFetch(`${API_BASE}/api/flyer/orders/${order.id}`);
      if (res.ok) {
        setSelectedOrder(await res.json());
      } else {
        // fallback: 목록 데이터 사용
        setSelectedOrder(order);
      }
    } catch {
      setSelectedOrder(order);
    }
  };

  // ── 렌더 ──
  return (
    <div className="space-y-5">
      {/* ────── 헤더 ────── */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-text">주문 관리</h2>
        <Button variant="ghost" size="sm" onClick={() => { loadOrders(page, activeTab); loadSummary(); }}>
          새로고침
        </Button>
      </div>

      {/* ────── 요약 카드 2x2 ────── */}
      {summary && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-surface border border-border rounded-xl p-4 shadow-card">
            <p className="text-xs font-medium text-text-secondary mb-1">접수대기</p>
            <p className="text-2xl font-bold" style={{ color: STATUS_CONFIG.pending.color }}>
              {summary.pending_count}
            </p>
            <p className="text-xs text-text-muted mt-0.5">건</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 shadow-card">
            <p className="text-xs font-medium text-text-secondary mb-1">확인중</p>
            <p className="text-2xl font-bold" style={{ color: STATUS_CONFIG.confirmed.color }}>
              {summary.confirmed_count}
            </p>
            <p className="text-xs text-text-muted mt-0.5">건</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 shadow-card">
            <p className="text-xs font-medium text-text-secondary mb-1">준비완료</p>
            <p className="text-2xl font-bold" style={{ color: STATUS_CONFIG.ready.color }}>
              {summary.ready_count}
            </p>
            <p className="text-xs text-text-muted mt-0.5">건</p>
          </div>
          <div className="bg-surface border border-border rounded-xl p-4 shadow-card">
            <p className="text-xs font-medium text-text-secondary mb-1">오늘 완료</p>
            <p className="text-2xl font-bold" style={{ color: STATUS_CONFIG.completed.color }}>
              {summary.today_completed_count}
            </p>
            <p className="text-xs text-text-muted mt-0.5">
              {formatAmount(summary.today_completed_amount || 0)}
            </p>
          </div>
        </div>
      )}

      {/* ────── 상태 탭 ────── */}
      <div className="flex bg-bg rounded-lg p-1 gap-0.5 overflow-x-auto">
        {TAB_LIST.map(tab => (
          <button
            key={tab.key}
            onClick={() => handleTabChange(tab.key)}
            className={`flex-shrink-0 px-3 py-2 text-xs font-semibold rounded-md transition-all whitespace-nowrap ${
              activeTab === tab.key
                ? 'bg-surface shadow-sm text-primary-600'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ────── 주문 목록 ────── */}
      <SectionCard>
        {loading ? (
          <div className="text-center py-12 text-text-secondary">로딩 중...</div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon="📦"
            title="아직 주문이 없습니다"
            description={activeTab !== 'all' ? `"${TAB_LIST.find(t => t.key === activeTab)?.label}" 상태의 주문이 없습니다.` : undefined}
          />
        ) : (
          <div className="space-y-3">
            {orders.map(order => {
              const cfg = STATUS_CONFIG[order.status];
              const nextAction = NEXT_ACTION[order.status];
              const isUpdating = updatingId === order.id;
              const canCancel = order.status === 'pending' || order.status === 'confirmed';

              return (
                <div
                  key={order.id}
                  className="bg-bg rounded-xl p-4 border border-border/50 hover:border-border transition-colors"
                >
                  {/* 상단: 주문번호 + 상태 배지 + 시간 */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="font-mono text-xs font-bold cursor-pointer hover:underline"
                        style={{ color: cfg.color }}
                        onClick={() => handleDetail(order)}
                      >
                        #{shortOrderNumber(order.order_number)}
                      </span>
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                        style={{ backgroundColor: cfg.bgColor, color: cfg.color }}
                      >
                        {cfg.label}
                      </span>
                    </div>
                    <span className="text-xs text-text-muted">{formatDate(order.created_at)}</span>
                  </div>

                  {/* 중단: 고객 + 상품 + 금액 */}
                  <div
                    className="mb-3 cursor-pointer"
                    onClick={() => handleDetail(order)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-text">{order.customer_name || '고객'}</span>
                      <span className="text-xs text-text-muted">{formatPhone(order.customer_phone)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-text-secondary">{summarizeItems(order.items)}</span>
                      <span className="text-sm font-bold text-text">{formatAmount(order.total_amount)}</span>
                    </div>
                    {order.pickup_method && (
                      <span className="inline-block mt-1 px-2 py-0.5 bg-surface rounded text-[10px] text-text-muted">
                        {pickupLabel[order.pickup_method] || order.pickup_method}
                      </span>
                    )}
                  </div>

                  {/* 하단: 액션 버튼 */}
                  <div className="flex gap-2">
                    {nextAction && (
                      <Button
                        size="sm"
                        className="flex-1"
                        disabled={isUpdating}
                        onClick={() => handleStatusChange(order.id, nextAction.nextStatus)}
                      >
                        {isUpdating ? '처리 중...' : nextAction.label}
                      </Button>
                    )}
                    {canCancel && (
                      <Button
                        variant="danger"
                        size="sm"
                        className={nextAction ? '' : 'flex-1'}
                        disabled={isUpdating}
                        onClick={() => handleCancel(order.id)}
                      >
                        취소
                      </Button>
                    )}
                    {!nextAction && !canCancel && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="flex-1"
                        onClick={() => handleDetail(order)}
                      >
                        상세보기
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ────── 페이지네이션 ────── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 mt-5 pt-4 border-t border-border/50">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              이전
            </Button>
            <span className="text-xs text-text-secondary px-3">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              다음
            </Button>
          </div>
        )}
      </SectionCard>

      {/* ────── 주문 상세 모달 ────── */}
      {selectedOrder && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-[2px]"
          onClick={() => setSelectedOrder(null)}
        >
          <div
            className="bg-surface rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto shadow-modal"
            onClick={e => e.stopPropagation()}
          >
            {/* 모달 헤더 */}
            <div className="sticky top-0 bg-surface border-b border-border px-5 py-4 flex items-center justify-between rounded-t-2xl">
              <div>
                <h3 className="text-base font-bold text-text">주문 상세</h3>
                <p className="text-xs text-text-muted font-mono mt-0.5">#{selectedOrder.order_number}</p>
              </div>
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-bg text-text-muted hover:text-text transition-colors"
                onClick={() => setSelectedOrder(null)}
              >
                X
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* 상태 + 시간 */}
              <div className="flex items-center justify-between">
                <span
                  className="px-3 py-1 rounded-full text-xs font-bold"
                  style={{
                    backgroundColor: STATUS_CONFIG[selectedOrder.status].bgColor,
                    color: STATUS_CONFIG[selectedOrder.status].color,
                  }}
                >
                  {STATUS_CONFIG[selectedOrder.status].label}
                </span>
                <span className="text-xs text-text-muted">{formatDate(selectedOrder.created_at)}</span>
              </div>

              {/* 고객 정보 */}
              <div className="bg-bg rounded-xl p-4">
                <p className="text-xs font-medium text-text-secondary mb-2">고객 정보</p>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-text">{selectedOrder.customer_name || '-'}</span>
                  <span className="text-sm text-text-secondary">{formatPhone(selectedOrder.customer_phone)}</span>
                </div>
                {selectedOrder.pickup_method && (
                  <p className="text-xs text-text-muted mt-2">
                    수령 방법: {pickupLabel[selectedOrder.pickup_method] || selectedOrder.pickup_method}
                  </p>
                )}
              </div>

              {/* 상품 목록 */}
              <div>
                <p className="text-xs font-medium text-text-secondary mb-2">주문 상품</p>
                <div className="space-y-2">
                  {(selectedOrder.items || []).map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-bg rounded-lg px-4 py-3">
                      <div>
                        <span className="text-sm text-text">{item.product_name}</span>
                        <span className="text-xs text-text-muted ml-2">x{item.quantity}</span>
                      </div>
                      <span className="text-sm font-semibold text-text">
                        {formatAmount(item.price * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/50">
                  <span className="text-sm font-semibold text-text-secondary">합계</span>
                  <span className="text-lg font-bold text-text">{formatAmount(selectedOrder.total_amount)}</span>
                </div>
              </div>

              {/* 모달 액션 버튼 */}
              <div className="flex gap-2 pt-2">
                {(() => {
                  const nextAction = NEXT_ACTION[selectedOrder.status];
                  const canCancel = selectedOrder.status === 'pending' || selectedOrder.status === 'confirmed';
                  const isUpdating = updatingId === selectedOrder.id;

                  return (
                    <>
                      {canCancel && (
                        <Button
                          variant="danger"
                          className="flex-1"
                          disabled={isUpdating}
                          onClick={() => handleCancel(selectedOrder.id)}
                        >
                          주문 취소
                        </Button>
                      )}
                      {nextAction && (
                        <Button
                          className="flex-1"
                          disabled={isUpdating}
                          onClick={() => handleStatusChange(selectedOrder.id, nextAction.nextStatus)}
                        >
                          {isUpdating ? '처리 중...' : nextAction.label}
                        </Button>
                      )}
                      {!nextAction && !canCancel && (
                        <Button
                          variant="secondary"
                          className="flex-1"
                          onClick={() => setSelectedOrder(null)}
                        >
                          닫기
                        </Button>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ────── AlertModal ────── */}
      <AlertModal
        alert={alert}
        onClose={() => setAlert({ ...alert, show: false })}
      />
    </div>
  );
}
