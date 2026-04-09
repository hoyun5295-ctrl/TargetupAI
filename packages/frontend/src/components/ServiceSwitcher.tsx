/**
 * ★ D112: 슈퍼관리자 서비스 스위처 컴포넌트
 *
 * 상단에 [한줄로 AI] | [전단AI] 탭 표시.
 * 클릭 시 /api/admin/switch-service 호출 → 새 JWT 발급 → 리다이렉트.
 */

import { useState } from 'react';

interface ServiceSwitcherProps {
  currentService: 'hanjullo' | 'flyer';
  onSwitch: (to: 'hanjullo' | 'flyer') => void;
}

export default function ServiceSwitcher({ currentService, onSwitch }: ServiceSwitcherProps) {
  const [switching, setSwitching] = useState(false);

  const handleClick = async (to: 'hanjullo' | 'flyer') => {
    if (to === currentService || switching) return;
    setSwitching(true);
    try {
      onSwitch(to);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
      <button
        onClick={() => handleClick('hanjullo')}
        disabled={switching}
        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
          currentService === 'hanjullo'
            ? 'bg-blue-500 text-white shadow-sm'
            : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200'
        }`}
      >
        🔵 한줄로 AI
      </button>
      <button
        onClick={() => handleClick('flyer')}
        disabled={switching}
        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
          currentService === 'flyer'
            ? 'bg-orange-500 text-white shadow-sm'
            : 'text-gray-600 hover:text-gray-800 hover:bg-gray-200'
        }`}
      >
        🟠 전단AI
      </button>
      {switching && <span className="ml-2 text-xs text-gray-400">전환 중...</span>}
    </div>
  );
}
