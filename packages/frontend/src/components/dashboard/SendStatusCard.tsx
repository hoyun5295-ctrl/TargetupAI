/**
 * SendStatusCard.tsx — 대시보드 「발송 현황」 칸 (★ 2026-10-19 Dashboard.tsx 에서 옮김 · docs/2026-10-19-dashboard-four-cards-design.md §2-2)
 *
 * 이번 달 전송 · 성공 · 실패 · 성공률(2×2) + 채널 4개(2×2 한 줄). 숫자 채우기 · 성공률 표기 = 옛 칸 원본 그대로.
 * 총 사용금액 · 잔액 현황 링크 · 에이전트 발송 잔액은 요금제 칸으로 옮겼다(돈은 한 칸 · Harold 1019).
 */
import CountUp from './CountUp';
import { DASH_CARD, DashCardHead, DashSource, fmtInt } from './dash-card';

export interface SendCardStats {
  monthly_total: number;
  monthly_sent: number;
  monthly_fail: number;
  success_rate: string;
  sms_sent: number;
  lms_sent: number;
  mms_sent: number;
  kakao_sent: number;
}

export default function SendStatusCard({ stats, intro, enterClass }: { stats: SendCardStats | null; intro: boolean; enterClass: string }) {
  const stat = (value: number, label: string, box: string, tone: string) => (
    <div className={`text-center px-2 py-2.5 rounded-lg min-w-0 ${box}`}>
      <div className={`text-base font-bold tabular-nums leading-tight whitespace-nowrap ${tone}`}><CountUp value={value} format={fmtInt} animate={intro} /></div>
      <div className="text-[11px] text-gray-400 mt-0.5">{label}</div>
    </div>
  );
  return (
    <div className={`${DASH_CARD} ${enterClass}`} style={{ animationDelay: '120ms' }} data-card="send">
      <DashCardHead bar="bg-green-600" title="발송 현황" />
      {/* 발송 실적 — 전송/성공/실패/성공률 */}
      <div className="grid grid-cols-2 gap-1.5">
        {stat(stats?.monthly_total || 0, '전송건수', 'bg-gray-50', 'text-gray-800')}
        {stat(stats?.monthly_sent || 0, '성공건수', 'bg-emerald-50/70', 'text-emerald-600')}
        {stat(stats?.monthly_fail || 0, '실패건수', 'bg-rose-50/60', 'text-rose-500')}
        <div className="text-center px-2 py-2.5 bg-gray-50 rounded-lg min-w-0">
          {/* 서버 값 = 소수 한 자리 글자(없으면 '0') — 끝난 뒤 그 글자 그대로 */}
          <div className="text-base font-bold text-gray-800 tabular-nums leading-tight whitespace-nowrap"><CountUp value={Number(stats?.success_rate) || 0} decimals={1} animate={intro} format={(v) => (v === (Number(stats?.success_rate) || 0) ? String(stats?.success_rate || '0') : v.toFixed(1))} /><span className="text-[11px] font-normal text-gray-400">%</span></div>
          <div className="text-[11px] text-gray-400 mt-0.5">성공률</div>
        </div>
      </div>
      {/* 채널별 발송 수량 */}
      <div className="grid grid-cols-2 gap-1.5 mt-1.5">
        {[
          { label: 'SMS', value: stats?.sms_sent },
          { label: 'LMS', value: stats?.lms_sent },
          { label: 'MMS', value: stats?.mms_sent },
          { label: '카카오', value: stats?.kakao_sent },
        ].map((ch) => (
          <div key={ch.label} className="flex items-center justify-between gap-1.5 px-2.5 py-2 bg-white border border-gray-100 rounded-lg min-w-0">
            <span className="text-[11px] font-medium text-gray-400 whitespace-nowrap">{ch.label}</span>
            <span className="text-[13px] font-bold text-gray-700 tabular-nums whitespace-nowrap"><CountUp value={ch.value || 0} format={fmtInt} animate={intro} /></span>
          </div>
        ))}
      </div>
      <div className="mt-auto">
        <DashSource>이번 달 발송 결과(전송 · 성공 · 실패 · 채널)</DashSource>
      </div>
    </div>
  );
}
