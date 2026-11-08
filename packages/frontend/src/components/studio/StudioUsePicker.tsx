/**
 * StudioUsePicker — ★ 2026-11-08 C118 A1 「어디에 쓸 그림인가요?」(설계서 docs/2026-11-08-c118-studio-per-use-inapp-app-design.md).
 *   템플릿을 고르고 「만들기」를 누르면 연다 · 여러 개 고르기(처음 = 아무것도 안 고름) · 인앱 메시지 = 글 자리 위 / 아래 ·
 *   고른 수 × 단가표 값 = 아래 줄(크레딧 숫자 = creditText 한 곳) · 용도 크기 = 서버 CHANNEL_PRESETS 와 같은 값(계약 시험 대조).
 */
import { useEffect, useState } from 'react';
import { Check, Layers, Mail, Smartphone, Image as ImageIcon, type LucideIcon } from 'lucide-react';
import ModalBase, { ModalButton } from '../dm/modals/ModalBase';
import { creditCost } from '../../constants/credit';

export type StudioUseKey = 'inapp' | 'dm' | 'email' | 'free';
export interface StudioUse { key: StudioUseKey; presetKey: string; label: string; size: string; desc: string; icon: LucideIcon; adminOnly?: boolean; ratio: string; /** ★ C118 E1 만드는 것 = 그 용도의 포스터(안내 · 실패 칸 문구) */ poster: string }
/** 용도 넷 = 서버 CHANNEL_PRESETS(use-inapp 1:1 · use-dm 2:3 · use-email 4:3 · poster 3:4) */
export const STUDIO_USES: readonly StudioUse[] = [
  { key: 'inapp', presetKey: 'use-inapp', label: '인앱 메시지', size: '정사각 1:1', ratio: '1 / 1', desc: '앱 팝업 칸에 꽉 차게 · 글 자리를 비워 둔 그림', icon: Layers, adminOnly: true, poster: '인앱 메시지용 포스터' },
  { key: 'dm', presetKey: 'use-dm', label: '모바일 DM', size: '세로 2:3', ratio: '2 / 3', desc: '휴대폰 화면을 길게 채우는 세로 그림', icon: Smartphone, poster: '모바일 DM용 포스터' },
  { key: 'email', presetKey: 'use-email', label: '이메일 마케팅', size: '가로 4:3', ratio: '4 / 3', desc: '메일 첫 화면에 제목과 함께 보이는 그림', icon: Mail, poster: '이메일 마케팅용 포스터' },
  { key: 'free', presetKey: 'poster', label: '자유 형태', size: '세로 3:4 · 기본', ratio: '3 / 4', desc: '어디에나 쓰는 기본 포스터', icon: ImageIcon, poster: '자유 형태 포스터' },
];
export function studioUseOfPreset(presetKey: string): StudioUse | null {
  return STUDIO_USES.find((u) => u.presetKey === presetKey) || null;
}

export interface StudioUsePick { uses: StudioUseKey[]; zone: 'top' | 'bottom' }

/** ★ C119 할인 템플릿 글 자리 고정 문구 한 곳(고르기 창 · 편집기 안 스튜디오 창) — 배치대로 */
export function discountZoneText(layout: 'stack' | 'side'): string {
  return layout === 'side'
    ? '왼쪽에 글 · 이 템플릿은 글이 왼쪽, 제품이 오른쪽 아래로 정해져 있어요.'
    : '위쪽에 글 · 이 템플릿은 글이 위, 제품이 아래로 정해져 있어요.';
}

export default function StudioUsePicker({ open, isAdmin, onClose, onConfirm, zoneLocked = null }: {
  open: boolean;
  isAdmin: boolean;
  /** ★ C118 E3 · C119 할인 템플릿 = 글 자리 = 템플릿 배치 고정(stack = 위 · side = 왼쪽 · 서버도 같음) — 고를 수 없는 칸을 내지 않는다 · null = 고르기 */
  zoneLocked?: 'stack' | 'side' | null;
  onClose: () => void;
  onConfirm: (pick: StudioUsePick) => void;
}) {
  const [picked, setPicked] = useState<StudioUseKey[]>([]);
  const [zone, setZone] = useState<'top' | 'bottom'>('top');
  useEffect(() => { if (open) { setPicked([]); setZone('top'); } }, [open]);
  const uses = STUDIO_USES.filter((u) => !u.adminOnly || isAdmin);
  const toggle = (k: StudioUseKey) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));
  const unit = creditCost('image-studio-generate');
  const total = picked.length * unit;
  return (
    <ModalBase open={open} onClose={onClose} title="어디에 쓸 그림인가요?" subtitle="쓸 곳에 맞는 크기로 따로 만들어요. 여러 개를 고르면 고른 수만큼 만들어요." size="md"
      footer={(
        <div className="flex items-center gap-3 w-full flex-wrap">
          <span className="flex-1 min-w-[10rem] text-[13px] text-slate-600">
            {picked.length > 0 ? <><b className="text-slate-900">{picked.length}개</b> × {unit}크레딧 = <b className="text-violet-800">{total}크레딧</b></> : '하나 이상 골라 주세요'}
          </span>
          <ModalButton onClick={onClose}>취소</ModalButton>
          <ModalButton variant="primary" disabled={picked.length === 0} onClick={() => onConfirm({ uses: STUDIO_USES.filter((u) => picked.includes(u.key)).map((u) => u.key), zone: zoneLocked ? 'top' : zone })}>
            {picked.length > 0 ? `${picked.length}장 만들기` : '만들기'}
          </ModalButton>
        </div>
      )}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {uses.map((u) => {
          const on = picked.includes(u.key);
          return (
            <div key={u.key} className={`rounded-2xl border transition-colors ${on ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-200' : 'border-slate-200 bg-white hover:border-violet-300'}`}>
              <button type="button" onClick={() => toggle(u.key)} aria-pressed={on} className="w-full text-left p-3 flex items-start gap-3">
                <span className="shrink-0 w-14 flex items-center justify-center">
                  <span className={`block w-12 rounded-md border-2 ${on ? 'border-violet-500 bg-violet-100' : 'border-slate-300 bg-slate-50'}`} style={{ aspectRatio: u.ratio, maxHeight: 56 }} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-[14px] font-bold text-slate-900"><u.icon className="w-4 h-4 text-violet-700 shrink-0" />{u.label}</span>
                  <span className="block text-[12px] font-semibold text-violet-800 mt-0.5">{u.size}</span>
                  <span className="block text-[11.5px] text-slate-500 mt-0.5 leading-snug break-keep">{u.desc}</span>
                </span>
                <span className={`shrink-0 w-5 h-5 rounded-md border flex items-center justify-center ${on ? 'bg-violet-600 border-violet-600' : 'border-slate-300 bg-white'}`}>{on && <Check className="w-3.5 h-3.5 text-white" />}</span>
              </button>
              {u.key === 'inapp' && on && (
                <div className="px-3 pb-3 -mt-1">
                  <div className="text-[11.5px] font-semibold text-slate-600 mb-1">글 자리</div>
                  {zoneLocked ? (
                    <p className="text-[12px] text-slate-700 leading-snug break-keep rounded-lg border border-slate-200 bg-white px-3 py-2">{discountZoneText(zoneLocked)}</p>
                  ) : (<>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['top', 'bottom'] as const).map((z) => (
                      <button key={z} type="button" onClick={() => setZone(z)} aria-pressed={zone === z}
                        className={`h-9 rounded-lg border text-[12.5px] font-semibold ${zone === z ? 'border-violet-500 bg-white text-violet-800' : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300'}`}>
                        {z === 'top' ? '위쪽에 글' : '아래쪽에 글'}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5 leading-snug break-keep">고른 쪽을 그림과 같은 색감으로 비워 두고 그 자리에 글을 넣어요. 상품과 장면은 반대쪽에 둬요.</p>
                  </>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ModalBase>
  );
}
