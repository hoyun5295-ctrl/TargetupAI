// PaymentResultPage — 이니시스 결제 결과 fallback 페이지
// 진정 본질: 결제 완료 후 새 창에서 backend HTML이 자동 close 처리.
// 브라우저 영역에서 close 차단 시 본 페이지 영역 표시 (fallback).
// SoT: status/legacy-payment-migration.md (D184)

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

export default function PaymentResultPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const status = (params.get('status') || 'failed') as 'success' | 'failed' | 'cancelled';
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(interval);
          try { window.close(); } catch {}
          setTimeout(() => navigate('/'), 200);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [navigate]);

  const config = {
    success: {
      color: 'emerald',
      icon: '✓',
      title: '결제가 완료되었습니다',
      desc: '잔액이 충전되었습니다. 이 창을 닫고 한줄로로 돌아가주세요.',
    },
    failed: {
      color: 'red',
      icon: '×',
      title: '결제에 실패했습니다',
      desc: '결제가 정상적으로 처리되지 않았습니다. 다시 시도해주세요.',
    },
    cancelled: {
      color: 'gray',
      icon: '–',
      title: '결제가 취소되었습니다',
      desc: '사용자가 결제를 취소했습니다.',
    },
  }[status];

  const colorMap: Record<string, { bg: string; text: string; border: string }> = {
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200' },
    red: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200' },
    gray: { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200' },
  };
  const c = colorMap[config.color];

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full text-center">
        <div className={`w-20 h-20 ${c.bg} ${c.text} rounded-full flex items-center justify-center mx-auto mb-6 text-5xl font-bold border-2 ${c.border}`}>
          {config.icon}
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-3">{config.title}</h1>
        <p className="text-sm text-gray-600 leading-relaxed mb-8">{config.desc}</p>
        <div className="text-xs text-gray-400 mb-6">
          {countdown}초 후 자동으로 창이 닫힙니다.
        </div>
        <button
          onClick={() => {
            try { window.close(); } catch {}
            navigate('/');
          }}
          className="w-full py-3 bg-gray-800 hover:bg-gray-900 text-white rounded-xl font-medium transition-colors text-sm"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
