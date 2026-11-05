/**
 * InAppDmLinkPicker — [내 DM 참여 페이지 연결] 고르기 창(★ 2026-11-05 인앱 포스터 재구성 설계서 §3-6 · 인앱 = 문 · DM 참여 페이지 = 방)
 *
 * 이 회사의 게시된 DM 중 참여 섹션이 있는 것(GET /api/cdp/inapp/dm-links) · 정식 주소(식별값 0)를 버튼 · 사진 링크 칸에 넣는다.
 *   경품 · 선착순 DM = 흐리게 + 이유 한 줄(게시 판정이 같은 표로 막는다 · 화면은 고르게 두지 않는다).
 *   원장 · 1인 1회 · 동의 · 선착순 잠금 = DM 그대로.
 */
import { useEffect, useState } from 'react';
import { Loader2, Link2 } from 'lucide-react';
import ModalBase, { ModalButton } from '../dm/modals/ModalBase';
import { studioFetch } from '../../lib/studio-api';

interface DmLink { id: string; title: string; url: string; participation: string[]; blocked: boolean }

const PARTICIPATION_LABEL: Record<string, string> = {
  poll: '투표', survey: '설문', email_capture: '이메일 받기', click_rewards: '참여 보상',
  instant_coupon: '즉석 쿠폰', lucky_draw: '경품 추첨', roulette: '룰렛', limited_quantity: '선착순',
};

export default function InAppDmLinkPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (url: string) => void }) {
  const [list, setList] = useState<DmLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setList(null);
    setError(null);
    studioFetch('/api/cdp/inapp/dm-links').then(({ ok, data }) => {
      if (!alive) return;
      if (!ok) { setError(data?.error || 'DM 목록을 불러오지 못했어요'); setList([]); return; }
      setList(Array.isArray(data?.dms) ? data.dms : []);
    });
    return () => { alive = false; };
  }, [open]);

  return (
    <ModalBase open={open} onClose={onClose} title="내 DM 참여 페이지 연결" subtitle="게시한 DM 중 투표 · 설문 같은 참여 페이지로 이어요. 참여 기록은 DM 에 그대로 남아요." size="md"
      footer={<div className="flex justify-end w-full"><ModalButton onClick={onClose}>닫기</ModalButton></div>}>
      {list === null ? (
        <div className="py-10 flex items-center justify-center text-slate-500 text-[13px] gap-2"><Loader2 className="w-4 h-4 animate-spin" />불러오는 중</div>
      ) : list.length === 0 ? (
        <div className="py-8 text-center text-[13px] text-slate-500">{error || '참여 섹션이 있는 게시된 DM 이 아직 없어요. 모바일 DM 에서 투표나 설문 페이지를 먼저 만들어 게시해 주세요.'}</div>
      ) : (
        <div className="space-y-2">
          {list.map((d) => (
            <button key={d.id} type="button" disabled={d.blocked} onClick={() => { onPick(d.url); onClose(); }}
              className={`w-full text-left rounded-xl border px-3.5 py-3 ${d.blocked ? 'border-slate-200 bg-slate-50 opacity-60 cursor-not-allowed' : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50'}`}>
              <span className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-violet-800 shrink-0" />
                <b className="text-[13px] text-slate-900 truncate flex-1">{d.title}</b>
              </span>
              <span className="flex flex-wrap gap-1 mt-1.5">
                {d.participation.map((t) => (
                  <span key={t} className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{PARTICIPATION_LABEL[t] || t}</span>
                ))}
              </span>
              {d.blocked && <span className="block text-[11.5px] text-amber-800 mt-1.5">경품이나 선착순 DM 은 앱 회원 확인이 붙은 뒤 연결돼요</span>}
            </button>
          ))}
        </div>
      )}
    </ModalBase>
  );
}
