// 최근 30일 자동마케팅 성과(★ 2026-07-12 C-3③ · 발송 실적이 있을 때만)
// ★ 2026-09-30 AI 존 대개편: 런처(2×2 시작 타일)가 명령 카드로 흡수되면서 이 카드만 옮겼다(원본 JSX 그대로 · 설계서 §4-2 오른쪽 레일).
import { TrendingUp } from 'lucide-react';
import { AutoMarketingRoi, won } from './types';

export default function AutoMarketingRoiCard({ roi }: { roi: AutoMarketingRoi | null }) {
  if (!roi || roi.campaigns <= 0) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_12px_32px_-16px_rgba(15,23,42,0.25)]">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-emerald-700" />
        <span className="text-[13px] font-semibold text-slate-900">최근 30일 자동마케팅 성과</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <RoiStat label="발송 캠페인" value={`${roi.campaigns.toLocaleString()}건`} tone="text-indigo-800" />
        <RoiStat label="발송" value={`${roi.totalSent.toLocaleString()}명`} tone="text-cyan-800" />
        <RoiStat label="비용" value={won(roi.spendKrw)} tone="text-slate-700" />
        {roi.hasCdpData
          ? <RoiStat label="귀속 매출 (7일)" value={won(roi.revenue7dKrw)} tone="text-emerald-800" />
          : <RoiStat label="귀속 매출" value="연동 후 표시" tone="text-slate-400" />}
      </div>
      {roi.hasCdpData && roi.purchases7d > 0 && (
        <div className="mt-2 text-[11px] text-slate-500">발송 후 7일 안 구매 {roi.purchases7d.toLocaleString()}건이 귀속된 실측 매출입니다.</div>
      )}
      {!roi.hasCdpData && (
        <div className="mt-2 text-[11px] text-slate-500">매출 귀속은 자사몰 연동(구매 데이터 수집) 후 표시됩니다.</div>
      )}
      <div className="text-[10px] text-slate-400 italic mt-2">Data source: 발송 후 7일 구매 귀속 · 최근 30일 실측</div>
    </div>
  );
}

function RoiStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="p-2.5 bg-slate-50 rounded-lg">
      <div className="text-[11px] text-slate-500">{label}</div>
      <div className={`text-[15px] font-bold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}
