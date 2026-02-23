interface RecommendTemplateModalProps {
  show: boolean;
  onClose: () => void;
  onSelectTemplate: (prompt: string) => void;
}

export default function RecommendTemplateModal({ show, onClose, onSelectTemplate }: RecommendTemplateModalProps) {
  if (!show) return null;

  const templates = [
    { emoji: '💎', name: 'VIP 감사 인사', desc: 'VIP 고객에게 감사 메시지 발송', prompt: 'VIP 고객에게 감사 인사 문자 보내줘' },
    { emoji: '🎂', name: '생일 축하', desc: '생일 고객에게 축하 쿠폰 발송', prompt: '생일인 고객에게 축하 쿠폰 문자 보내줘' },
    { emoji: '🆕', name: '신상품 안내', desc: '신상품 출시 소식 전체 발송', prompt: '신상품 출시 안내 문자 전체 고객에게 보내줘' },
    { emoji: '🌸', name: '시즌 할인', desc: '타겟 고객 시즌 프로모션', prompt: '30대 여성 고객에게 봄 시즌 할인 이벤트 문자 보내줘' },
    { emoji: '🔄', name: '재방문 유도', desc: '휴면 고객 활성화', prompt: '3개월 이상 미구매 고객에게 재방문 유도 문자 보내줘' },
    { emoji: '💰', name: '포인트 소멸 안내', desc: '포인트 만료 전 알림', prompt: '포인트 소멸 예정 고객에게 사용 안내 문자 보내줘' },
    { emoji: '📦', name: '배송 안내', desc: '연휴/이벤트 배송 공지', prompt: '설날 연휴 배송 안내 문자 전체 고객에게 보내줘' },
    { emoji: '🎁', name: '1+1 이벤트', desc: '카테고리별 프로모션', prompt: '마스크팩 좋아하는 고객에게 1+1 이벤트 문자 보내줘' },
  ];

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-[700px] max-h-[85vh] overflow-hidden">
        <div className="p-4 border-b bg-purple-50 flex justify-between items-center">
          <h3 className="font-bold text-lg">📝 추천 템플릿</h3>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 text-xl">✕</button>
        </div>
        <div className="p-6 overflow-y-auto max-h-[70vh]">
          <div className="grid grid-cols-2 gap-4">
            {templates.map((t, idx) => (
              <div
                key={idx}
                onClick={() => { onSelectTemplate(t.prompt); onClose(); }}
                className="p-4 border rounded-lg hover:border-purple-400 cursor-pointer transition-all text-center"
              >
                <div className="text-2xl mb-2">{t.emoji}</div>
                <div className="font-semibold text-gray-800 mb-1">{t.name}</div>
                <div className="text-sm text-gray-500">{t.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
