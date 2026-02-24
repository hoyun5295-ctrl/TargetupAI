import { Rocket } from 'lucide-react';

interface RecommendTemplateModalProps {
  show: boolean;
  onClose: () => void;
  onSelectTemplate: (prompt: string) => void;
}

export default function RecommendTemplateModal({ show, onClose, onSelectTemplate }: RecommendTemplateModalProps) {
  if (!show) return null;

  const templates = [
    { emoji: '🎯', name: 'VIP 재구매 유도', prompt: '최근 3개월 미구매 VIP 고객에게 봄 신상품 할인 안내 보내줘' },
    { emoji: '🎂', name: '생일 축하 발송', prompt: '이번 달 생일인 고객에게 생일 축하 쿠폰 발송해줘' },
    { emoji: '🛍️', name: '첫 구매 감사', prompt: '최근 1주일 내 첫 구매 고객에게 감사 메시지 + 재방문 쿠폰 보내줘' },
    { emoji: '📢', name: '전체 프로모션', prompt: '전체 고객 대상 주말 특가 세일 안내 보내줘' },
  ];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] overflow-hidden animate-in fade-in zoom-in duration-200">
        <div className="px-6 py-4 border-b bg-gray-50 flex justify-between items-center">
          <div className="flex items-center gap-2.5">
            <Rocket className="w-5 h-5 text-green-600" />
            <h3 className="text-lg font-bold text-gray-800">빠른 발송 예시</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl transition-colors">✕</button>
        </div>
        <div className="p-6">
          <p className="text-sm text-gray-500 mb-4">클릭하면 AI 한줄로가 바로 실행됩니다.</p>
          <div className="flex flex-col gap-3">
            {templates.map((t, idx) => (
              <div
                key={idx}
                onClick={() => onSelectTemplate(t.prompt)}
                className="p-4 border border-gray-200 rounded-xl hover:border-green-400 hover:bg-green-50/50 cursor-pointer transition-all group"
              >
                <div className="flex items-center gap-3 mb-1.5">
                  <span className="text-xl">{t.emoji}</span>
                  <span className="font-semibold text-gray-800 group-hover:text-green-700 transition-colors">{t.name}</span>
                </div>
                <div className="text-sm text-gray-500 pl-9 leading-relaxed">"{t.prompt}"</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-start gap-2 text-xs text-gray-400">
            <span className="mt-0.5">💡</span>
            <span>예시를 선택하면 AI 한줄로가 자동으로 시작됩니다. 프롬프트는 실행 전 수정할 수 있습니다.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
