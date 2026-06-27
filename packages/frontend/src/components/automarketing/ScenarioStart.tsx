// 시나리오로 시작 — 검증된 목표·세그먼트형 시나리오 선택 (2026-06-27)
// 여정 경계: 개인 이벤트형(생일·장바구니 등)은 여정 몫 → 여기엔 두지 않는다.
// 카드는 설명이 들어가니 좌측 정렬.
import { LucideIcon, Crown, Moon, UserPlus, TrendingUp, Sun, Package, Lock } from 'lucide-react';

export interface ScenarioPick {
  key: string;
  name: string;
  objective: string;
}

const SCENARIOS: Array<ScenarioPick & { icon: LucideIcon; desc: string }> = [
  { key: 'vip_repurchase', icon: Crown, name: 'VIP 재구매 유도', desc: '90일 이상 구매 없는 VIP에게 재구매 제안', objective: 'VIP 등급 고객 중 최근 90일 구매가 없는 고객에게 재구매를 유도' },
  { key: 'dormant', icon: Moon, name: '휴면 고객 회복', desc: '60일 넘게 잠든 고객을 복귀 유도', objective: '최근 60일 이상 구매가 없는 휴면 고객을 복귀 유도' },
  { key: 'first_purchase', icon: UserPlus, name: '신규 첫구매 전환', desc: '가입 후 아직 안 산 고객 첫 구매 유도', objective: '가입 후 아직 구매하지 않은 신규 고객의 첫 구매 유도' },
  { key: 'tier_up', icon: TrendingUp, name: '등급 상승 유도', desc: 'VIP 근접 고객에게 한 걸음 더 제안', objective: 'VIP 승급에 근접한 일반 고객의 추가 구매 유도' },
  { key: 'seasonal', icon: Sun, name: '계절 프로모션', desc: '이번 시즌에 맞춰 전체 활성 고객 안내', objective: '이번 시즌에 맞춰 전체 활성 고객에게 시즌 프로모션 안내' },
  { key: 'inventory', icon: Package, name: '재고 소진', desc: '재고가 남은 상품의 구매 유도', objective: '재고 소진이 필요한 상품에 관심을 보인 고객의 구매 유도' },
];

export default function ScenarioStart({ onSelect }: { onSelect: (s: ScenarioPick) => void }) {
  return (
    <div>
      <h2 className="text-lg md:text-xl font-semibold text-white">검증된 시나리오로 바로 시작</h2>
      <p className="text-[13px] text-white/60 mt-1.5 mb-4">고르면 타겟·문안·발송 시각이 미리 채워집니다. 가동 전 한 번 확인합니다.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SCENARIOS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => onSelect({ key: s.key, name: s.name, objective: s.objective })}
              className="text-left bg-white/5 hover:bg-white/10 border border-white/10 hover:border-indigo-400/30 rounded-xl p-4 min-h-[118px] transition-colors"
            >
              <div className="w-9 h-9 rounded-xl bg-indigo-500/15 text-indigo-300 flex items-center justify-center">
                <Icon className="w-5 h-5" />
              </div>
              <div className="mt-3 text-sm font-medium text-white">{s.name}</div>
              <div className="mt-1 text-xs text-white/55 leading-relaxed">{s.desc}</div>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-white/40">
        <Lock className="w-3 h-3" />가동 전 한 번 확인합니다 — 발송은 그 다음입니다
      </div>
    </div>
  );
}
