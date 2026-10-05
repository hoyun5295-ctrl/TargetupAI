/**
 * ZoneCompletion.tsx — 완성도 줄(★ 2026-10-05 한줄로 시그니처 · 설계서 docs/2026-10-05-hanjul-signature-design.md §3-5)
 *
 * 완성본 위 한 줄: 머리 = make-flow `fixHeadline` 3단(「보내기 전에 N곳만 채워 주세요 / 보낼 수 있어요 · 더 좋게 할 곳 N / 보낼 준비가 됐어요」).
 * 줄 = must(그 입구의 발송 관문과 같은 판정) · suggest(입력 판정) · ok · info(반영 검산). % 숫자 금지 · 펼치면 최대 3줄 + 그 밖에 N.
 * `FixRow` 는 만들기 결과 화면과 같은 부품이다(같은 모양을 두 벌 두지 않는다).
 * ⛔ 모델명 0 · 줄표 0.
 */
import { useState } from 'react';
import { Check, AlertCircle, Sparkles, ShoppingBag, ChevronDown, ChevronUp, X } from 'lucide-react';
import { fixHeadline, type FixItem } from '../../utils/make-flow';

export function FixRow({ item, onClick }: { item: FixItem; onClick: () => void }) {
  if (item.kind === 'ok') return <div className="flex items-center gap-2 text-[13px] text-slate-700"><Check className="w-4 h-4 text-emerald-600 shrink-0" />{item.title}</div>;
  if (item.kind === 'info') return <div className="flex gap-2 rounded-xl bg-white px-3 py-2.5 text-[12px] text-slate-500"><ShoppingBag className="w-4 h-4 text-violet-700 shrink-0 mt-0.5" />{item.title}</div>;
  const must = item.kind === 'must';
  return (
    <button type="button" onClick={onClick} className={`w-full text-left flex items-start gap-2.5 rounded-xl border px-3 py-3 ${must ? 'border-amber-300 bg-amber-50 hover:bg-amber-50' : 'border-violet-300 bg-violet-50 hover:bg-violet-50'}`}>
      {must ? <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" /> : <Sparkles className="w-4 h-4 text-violet-700 shrink-0 mt-0.5" />}
      <span className="flex-1 min-w-0">
        <b className="block text-[13px] text-slate-900 leading-snug">{item.title}</b>
        {item.sub && <span className="block text-[11.5px] text-slate-500 mt-0.5">{item.sub}</span>}
      </span>
      {item.action && <em className={`not-italic shrink-0 text-[11.5px] font-bold rounded-md px-2 py-1 ${must ? 'bg-amber-400 text-amber-950' : 'bg-violet-100 text-violet-900'}`}>{item.action}</em>}
    </button>
  );
}

const VISIBLE = 3;

export default function ZoneCompletion({ items, onItem, action, onDismiss, checking = false }: {
  items: FixItem[];
  /** 줄을 누르면(고칠 블록으로 · 시트 열기) */
  onItem: (item: FixItem) => void;
  /** 오른쪽 채움 버튼 1개(예: [채우기]) — 없으면 그리지 않는다 */
  action?: { label: string; onClick: () => void } | null;
  onDismiss?: () => void;
  /** 다시 확인하는 중(저장 뒤 검수) */
  checking?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState(false);
  const head = fixHeadline(items);
  // 첫 검수가 오기 전에는 판정하지 않는다(빈 목록을 「보낼 준비가 됐어요」로 말하지 않는다)
  const pending = checking && items.length === 0;
  const rows = items.filter((i) => i.kind === 'must' || i.kind === 'suggest' || i.kind === 'info');
  const fixCount = items.filter((i) => i.kind === 'must' || i.kind === 'suggest').length;
  const shown = all ? rows : rows.slice(0, VISIBLE);
  const hidden = rows.length - shown.length;
  const chipTone = head.tone === 'warn' ? 'border-amber-300 text-amber-900 bg-amber-50' : head.tone === 'good' ? 'border-emerald-200 text-emerald-900 bg-emerald-50' : 'border-violet-300 text-violet-900 bg-violet-50';
  return (
    <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="px-3 md:px-4 py-2 flex items-center gap-2 flex-wrap">
        {pending ? (
          <span className="text-[13px] font-bold text-slate-500">보낼 준비를 확인하는 중</span>
        ) : (
          <span className={`text-[13px] font-bold ${head.tone === 'good' ? 'text-emerald-700' : 'text-slate-900'}`}>
            {head.tone === 'warn' ? <>보내기 전에 <b className="text-amber-700">{head.count}곳</b>만 채워 주세요</> : head.text}
          </span>
        )}
        {checking && !pending && <span className="text-[11.5px] text-slate-400">다시 확인하는 중</span>}
        {rows.length > 0 && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            className={`inline-flex items-center gap-1 h-8 px-3 rounded-full text-[12px] font-semibold border ${chipTone}`}>
            {fixCount > 0 ? `고칠 곳 ${fixCount}` : '확인할 것'} {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1">
          {action && (
            <button type="button" onClick={action.onClick} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-semibold text-violet-900 border border-violet-200 bg-white hover:bg-violet-50 transition-colors">
              <Sparkles className="w-3.5 h-3.5" />{action.label}
            </button>
          )}
          {onDismiss && (
            <button type="button" onClick={onDismiss} aria-label="완성도 줄 닫기" className="h-8 w-8 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center"><X className="w-4 h-4" /></button>
          )}
        </div>
      </div>
      {open && rows.length > 0 && (
        <div className="px-3 md:px-4 pb-3 space-y-2">
          {shown.map((it, i) => <FixRow key={i} item={it} onClick={() => onItem(it)} />)}
          {hidden > 0 && <button type="button" onClick={() => setAll(true)} className="text-[12px] font-semibold text-slate-500 hover:text-slate-900">그 밖에 {hidden}</button>}
          <p className="text-[10px] text-slate-400 italic">Data source: 보내기 전 관문과 같은 기준으로 셉니다 · 혜택 숫자는 적어 주신 것만 씁니다</p>
        </div>
      )}
    </div>
  );
}
