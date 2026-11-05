/**
 * InAppExampleGallery — 「예시로 보고 시작」(★ 2026-11-05 인앱 포스터 재구성 설계서 §3-9)
 *
 * 가상 업체(결온 · 소요웨어 · 오후담) 예시 = 서버가 미리 그려 둔 그림 + 편집기 시작 상태(GET /api/cdp/inapp/examples).
 *   카드 = 흐린 앱 화면 위 휴대폰 틀 안에 실제 그리는 부품 정적 렌더 · 화면에 보이는 카드만 그린다 · 그림 미준비 예시는 서버가 뺀다.
 *   준비된 예시 0 = 섹션을 그리지 않는다(빈 틀 · 빈 섹션 0). 업종 칩 = 회사 업종 자동(없으면 전체).
 *   누르면 상세 창(실제 부품 · 장 넘김 · 복사 · 남은 시간 동작) → [이 모양으로 시작] = 같은 시작 상태로 편집기.
 *   남은 시간 예시의 마감 = 그 화면을 연 시각 + 2일(고정 숫자 아님 · seed 끝 시각은 비워 둔다 · 게시 때 판정이 묻는다).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Sparkles } from 'lucide-react';
import ModalBase, { ModalButton } from '../dm/modals/ModalBase';
import { studioFetch } from '../../lib/studio-api';
import { PosterFramePreview, frameSlidesOf } from './PosterFramePreview';
import { PosterSheetPreview, resolvePosterLayout } from './PosterSheetPreview';
import { usesPosterFrame } from './generated/poster-frame';

export interface InAppExampleItem {
  id: string;
  industry: 'beauty' | 'fashion' | 'commerce' | 'cafe';
  brand: string;
  title: string;
  seed: Record<string, any>;
  studio: Array<{ studioTemplateId: string; texts: { label?: string; title?: string; subtitle?: string } }>;
}

const INDUSTRY_LABEL: Record<InAppExampleItem['industry'], string> = { beauty: '뷰티', fashion: '의류', commerce: '커머스', cafe: '카페' };
const PHONE_W = 375;
const PHONE_H = 667;
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

/** 예시 · 저장 칸 하나를 몰 화면과 같은 부품으로 그린다(새 틀 = 그리는 부품 · 지금 3모양 = 지금 미리보기) */
export function MessageShapePreview({ m, height, active, onActive, endAt, copyable }: {
  m: Record<string, any>;
  height: number;
  active?: number;
  onActive?: (i: number) => void;
  endAt?: string | number | null;
  copyable?: boolean;
}) {
  const design = m.design && typeof m.design === 'object' ? m.design : null;
  if (usesPosterFrame(design)) {
    return (
      <PosterFramePreview slides={frameSlidesOf(m)} design={design} accentColor={m.accent_color} badge={m.badge_text}
        endAt={endAt ?? null} height={height} active={active} onActive={onActive} copyable={copyable} />
    );
  }
  const layout = resolvePosterLayout(design);
  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0" style={{ background: 'rgba(15,23,42,.45)' }} />
      <div className="absolute inset-x-0 bottom-0 flex justify-center" style={{ top: 0, alignItems: 'flex-end' }}>
        <div style={{ width: '100%', maxHeight: '100%', display: 'flex' }}>
          <PosterSheetPreview layout={layout} slides={frameSlidesOf(m) as any} design={design} badge={m.badge_text} active={active} onActiveChange={onActive}
            scale={1} radius="22px 22px 0 0" shadow="0 -10px 40px rgba(0,0,0,.25)" arrows />
        </div>
      </div>
    </div>
  );
}

/** 흐린 앱 화면 + 휴대폰 틀(실물 크기 375×667 을 scale 로 줄인다) */
function Phone({ scale, children }: { scale: number; children: ReactNode }) {
  return (
    <div style={{ width: Math.round(PHONE_W * scale), height: Math.round(PHONE_H * scale) }} className="relative shrink-0">
      <div style={{ width: PHONE_W, height: PHONE_H, transform: `scale(${scale})`, transformOrigin: 'top left' }}
        className="relative overflow-hidden rounded-[34px] border-[6px] border-slate-200 bg-slate-100 shadow-[0_18px_40px_-18px_rgba(0,0,0,.55)]">
        <div aria-hidden style={{ position: 'absolute', inset: 0, padding: '38px 14px 0', background: '#f5f5f7', filter: 'blur(1.5px)' }}>
          <div style={{ height: 14, width: 80, borderRadius: 6, background: '#cbd5e1' }} />
          <div style={{ height: 34, borderRadius: 999, background: '#fff', margin: '10px 0 12px' }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 9 }}>
            {Array.from({ length: 8 }).map((_, i) => <div key={i} style={{ height: 50, borderRadius: 12, background: '#e2e8f0' }} />)}
          </div>
          <div style={{ height: 120, borderRadius: 14, background: 'linear-gradient(135deg,#cbd5e1,#e2e8f0)', marginTop: 14 }} />
        </div>
        {children}
      </div>
    </div>
  );
}

/** 화면에 들어온 카드만 그린다(그리는 부품 · 그림 열 장 이상을 한꺼번에 띄우지 않게) */
function useVisible<T extends HTMLElement>(): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

function ExampleCard({ ex, onOpen, endAt }: { ex: InAppExampleItem; onOpen: () => void; endAt: number }) {
  const [ref, seen] = useVisible<HTMLButtonElement>();
  return (
    <button ref={ref} type="button" onClick={onOpen}
      className="text-left rounded-2xl border border-slate-200 bg-white hover:border-violet-300 hover:bg-slate-50 p-3 transition-colors flex flex-col items-center">
      <Phone scale={0.5}>{seen && <MessageShapePreview m={ex.seed} height={PHONE_H} endAt={endAt} />}</Phone>
      <span className="self-stretch mt-2.5 flex items-center gap-1.5">
        <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{INDUSTRY_LABEL[ex.industry]}</span>
        <b className="text-[13px] text-slate-900 truncate">{ex.brand}</b>
      </span>
      <span className="self-stretch block text-[12px] text-slate-500 mt-0.5 truncate">{ex.title}</span>
    </button>
  );
}

export default function InAppExampleGallery({ onStart }: {
  /** [이 모양으로 시작] — 편집기 시작 상태(seed) + 장마다 스튜디오 재료(같은 템플릿으로 「AI로 내 그림 만들기」) */
  onStart: (seed: Record<string, any>, studio: InAppExampleItem['studio']) => void;
}) {
  const [items, setItems] = useState<InAppExampleItem[] | null>(null);
  const [industry, setIndustry] = useState<InAppExampleItem['industry'] | 'all'>('all');
  const [open, setOpen] = useState<InAppExampleItem | null>(null);
  const [active, setActive] = useState(0);
  // 남은 시간 예시의 마감 = 이 화면을 연 시각 + 2일(매번 계산)
  const endAt = useMemo(() => Date.now() + TWO_DAYS, []);
  useEffect(() => {
    let alive = true;
    studioFetch('/api/cdp/inapp/examples').then(({ ok, data }) => {
      if (!alive) return;
      const list: InAppExampleItem[] = ok && Array.isArray(data?.examples) ? data.examples : [];
      setItems(list);
      const mine = data?.industry;
      if (mine && list.some((e) => e.industry === mine)) setIndustry(mine);
    });
    return () => { alive = false; };
  }, []);
  if (!items || items.length === 0) return null;   // 준비된 예시 0 = 섹션 없음
  const chips = (['all', ...(['beauty', 'fashion', 'commerce', 'cafe'] as const).filter((k) => items.some((e) => e.industry === k))] as const);
  const shown = industry === 'all' ? items : items.filter((e) => e.industry === industry);

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <h2 className="text-[15px] font-bold inline-flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-violet-700" />예시로 보고 시작</h2>
        <span className="text-[12px] text-slate-400">가상 업체로 그려 둔 실제 모습 · 누르면 크게 보고 그 모양으로 시작해요</span>
      </div>
      <div className="flex gap-1.5 flex-wrap mb-3" role="tablist" aria-label="업종">
        {chips.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={industry === k} onClick={() => setIndustry(k)}
            className={`h-9 px-3.5 rounded-lg border text-[12.5px] font-semibold ${industry === k ? 'bg-violet-100 border-violet-300 text-violet-900' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
            {k === 'all' ? '전체' : INDUSTRY_LABEL[k]}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
        {shown.map((ex) => <ExampleCard key={ex.id} ex={ex} endAt={endAt} onOpen={() => { setActive(0); setOpen(ex); }} />)}
      </div>

      <ModalBase
        open={!!open}
        onClose={() => setOpen(null)}
        title={open ? `${open.brand} · ${open.title}` : ''}
        subtitle="몰 화면에 뜨는 모습 그대로예요. 넘기기 · 복사 · 남은 시간이 실제처럼 움직여요."
        size="lg"
        footer={open ? (
          <div className="flex items-center gap-2 justify-end w-full flex-wrap">
            <span className="flex-1 min-w-[12rem] text-[11.5px] text-slate-500">예시 그림은 게시할 수 없어요. 시작한 뒤 내 그림으로 바꿔 주세요.</span>
            <ModalButton onClick={() => setOpen(null)}>닫기</ModalButton>
            <ModalButton variant="primary" onClick={() => { const ex = open; setOpen(null); onStart(ex.seed, ex.studio); }}>이 모양으로 시작</ModalButton>
          </div>
        ) : undefined}
      >
        {open && (
          <div className="flex justify-center py-2">
            <Phone scale={0.86}><MessageShapePreview m={open.seed} height={PHONE_H} active={active} onActive={setActive} endAt={endAt} copyable /></Phone>
          </div>
        )}
      </ModalBase>
    </section>
  );
}
