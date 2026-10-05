// 시나리오로 시작 — 검증된 목표·세그먼트형 시나리오 선택 (2026-06-27 · 2026-07-02 5차 확장)
// 여정 경계: 개인 이벤트 당일 대응(가입 직후·장바구니)은 여정 몫. 회사가 정한 날짜에 일괄 발송하는
// 월간 축(그 달 생일자·VIP 지정일)은 자동마케팅 몫 — Harold 2026-07-02 스펙.
// 카드는 설명이 들어가니 좌측 정렬.
import { LucideIcon, Crown, Moon, UserPlus, TrendingUp, Sun, Package, Lock, Cake, Coins, Star } from 'lucide-react';

export interface ScenarioPick {
  key: string;
  name: string;
  objective: string;
  // ★ 2026-07-02 5차: 월간형 시나리오(생일·VIP 데이)는 주기 프리필 동반
  schedule?: 'daily' | 'weekly' | 'monthly';
  scheduleDayOfMonth?: number;
  // ★ 2026-08-04 계약 필수화 — 대상이 축 하나와 정확히 맞는 시나리오는 계약을 프리필한다(모달에서 확인·변경).
  //   회사에 근거가 없어 잠긴 축이면 SegmentPicker가 잠금·사유를 보여주고 저장 검증이 막는다 — 여기서 판정하지 않는다.
  segmentKey?: string;
  segmentParams?: Record<string, number>;
}

// ★ 2026-10-05 상태 조건 시나리오 = 매월 1일 기본(신뢰 설계 Q9 — 매일 · 매주 + 상태 조건은 같은 고객이 회차마다 다시 받아 등록이 막힌다)
const SCENARIOS: Array<ScenarioPick & { icon: LucideIcon; desc: string }> = [
  // 두 조건의 결합(VIP+휴면)·축에 없는 대상(승급 근접·상품 관심·포인트)은 프리필 없음 — 등록 시 AI 매핑 또는 자유 해석.
  { key: 'vip_repurchase', icon: Crown, name: 'VIP 재구매 유도', desc: '90일 이상 구매 없는 VIP에게 재구매 제안', objective: 'VIP 등급 고객 중 최근 90일 구매가 없는 고객에게 재구매를 유도', schedule: 'monthly', scheduleDayOfMonth: 1 },
  { key: 'dormant', icon: Moon, name: '휴면 고객 회복', desc: '60일 넘게 잠든 고객을 복귀 유도', objective: '최근 60일 이상 구매가 없는 휴면 고객을 복귀 유도', segmentKey: 'dormant', segmentParams: { days: 60 }, schedule: 'monthly', scheduleDayOfMonth: 1 },
  // ⛔ first_purchase 시나리오는 프리필 없음(Codex) — new_customers 축은 "미구매" 조건이 없어 이미 산
  //   신규 고객에게 첫구매 문안이 나간다. 축 하나로 표현이 안 되는 대상은 자유 해석에 맡긴다.
  { key: 'first_purchase', icon: UserPlus, name: '신규 첫구매 전환', desc: '가입 후 아직 안 산 고객 첫 구매 유도', objective: '가입 후 아직 구매하지 않은 신규 고객의 첫 구매 유도', schedule: 'monthly', scheduleDayOfMonth: 1 },
  { key: 'tier_up', icon: TrendingUp, name: '등급 상승 유도', desc: 'VIP 근접 고객에게 한 걸음 더 제안', objective: 'VIP 승급에 근접한 일반 고객의 추가 구매 유도', schedule: 'monthly', scheduleDayOfMonth: 1 },
  { key: 'seasonal', icon: Sun, name: '계절 프로모션', desc: '이번 시즌에 맞춰 전체 활성 고객 안내', objective: '이번 시즌에 맞춰 전체 활성 고객에게 시즌 프로모션 안내', segmentKey: 'all', schedule: 'monthly', scheduleDayOfMonth: 1 },
  { key: 'inventory', icon: Package, name: '재고 소진', desc: '재고가 남은 상품의 구매 유도', objective: '재고 소진이 필요한 상품에 관심을 보인 고객의 구매 유도', schedule: 'monthly', scheduleDayOfMonth: 1 },
  // ★ 2026-07-02 5차 확장 (Harold 스펙): 생일·포인트·VIP 지정일
  { key: 'birthday_monthly', icon: Cake, name: '생일 축하 (매월)', desc: '매월 정한 날, 그 달 생일 고객에게 축하 인사', objective: '이번 달 생일인 고객에게 생일 축하 인사', schedule: 'monthly', scheduleDayOfMonth: 1, segmentKey: 'birthday' },
  { key: 'points_use', icon: Coins, name: '포인트 사용 유도', desc: '포인트 보유 고객에게 사용 안내', objective: '포인트를 보유한 고객에게 포인트 사용을 유도', schedule: 'monthly', scheduleDayOfMonth: 1 },
  { key: 'vip_day', icon: Star, name: 'VIP 데이 (매월)', desc: '매월 정한 날, VIP에게 감사 안내', objective: 'VIP 등급 고객에게 이번 달 VIP 감사 안내', schedule: 'monthly', scheduleDayOfMonth: 1, segmentKey: 'vip' },
];

// ★ 2026-09-30 AI 존 보정(Harold "너무 단조롭다"): 시나리오마다 다른 색 타일(글자 그대로 · Tailwind 가 읽는다)
const SCENARIO_TINTS = ['from-amber-400 to-orange-500', 'from-indigo-400 to-violet-500', 'from-emerald-400 to-teal-500', 'from-sky-400 to-blue-500', 'from-orange-400 to-pink-500', 'from-slate-400 to-slate-600', 'from-fuchsia-400 to-purple-500', 'from-rose-400 to-pink-500', 'from-cyan-400 to-sky-500'];

export default function ScenarioStart({ onSelect }: { onSelect: (s: ScenarioPick) => void }) {
  return (
    <div>
      <h2 className="text-lg md:text-xl font-semibold text-slate-900">검증된 시나리오로 바로 시작</h2>
      <p className="text-[13px] text-slate-500 mt-1.5 mb-4">고르면 타겟·문안·발송 시각이 미리 채워집니다. 가동 전 한 번 확인합니다.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {SCENARIOS.map((s, i) => {
          const Icon = s.icon;
          return (
            <button
              key={s.key}
              onClick={() => onSelect({ key: s.key, name: s.name, objective: s.objective, schedule: s.schedule, scheduleDayOfMonth: s.scheduleDayOfMonth, segmentKey: s.segmentKey, segmentParams: s.segmentParams })}
              className="group text-left bg-white border border-slate-200 hover:border-slate-300 rounded-2xl p-5 flex items-start gap-4 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_-16px_rgba(15,23,42,0.25)] hover:-translate-y-0.5 transition-all duration-200"
            >
              <span className={`w-11 h-11 rounded-xl bg-gradient-to-br ${SCENARIO_TINTS[i % SCENARIO_TINTS.length]} text-white flex items-center justify-center shrink-0 shadow-md`}>
                <Icon className="w-5 h-5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold text-slate-900">{s.name}</span>
                <span className="block mt-1 text-[12.5px] text-slate-500 leading-snug">{s.desc}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5 text-xs text-slate-400">
        <Lock className="w-3 h-3" />가동 전 한 번 확인합니다. 발송은 그 다음입니다
      </div>
    </div>
  );
}
