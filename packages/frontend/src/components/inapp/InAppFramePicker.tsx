/**
 * InAppFramePicker — 이미지 스튜디오 그림 → 인앱 「틀 고르기」 판(★ 2026-11-05 인앱 포스터 재구성 설계서 §3-8)
 *
 * 내 그림을 바닥 시트 · 떠 있는 카드에 끼운 실물 썸네일 한 판 · 채널(웹/앱) 고르기 · 한 번 누르면 편집기.
 *   글이 든 그림(스튜디오 포스터) = 통짜(그림 속 글 = 넘어온 글) · 글 없는 그림(라이브러리 사진) = 사진 위 글.
 *   썸네일 = 몰 화면과 같은 부품(새 틀 = 그리는 부품 · 사진 위 글 바닥 시트 = 지금 포스터 미리보기).
 *   앱 채널 = 지금 앱에 어떻게 보이는지 그 자리에 한 줄(appCapsNote · 게시비를 내도 안 보일 수 있음을 미리 말한다).
 */
import { useState } from 'react';
import { Globe, Smartphone } from 'lucide-react';
import ModalBase, { ModalButton } from '../dm/modals/ModalBase';
import { MessageShapePreview } from './InAppExampleGallery';
import { appCapsNote, designForKey, type LayoutKey } from './inappSlides';

const PHONE_W = 375;
const PHONE_H = 667;

export default function InAppFramePicker({ open, imageUrl, textInImage, title, onClose, onPick }: {
  open: boolean;
  imageUrl: string;
  textInImage: boolean;
  title: string;
  onClose: () => void;
  onPick: (key: LayoutKey, channel: 'web' | 'app') => void;
}) {
  const [channel, setChannel] = useState<'web' | 'app'>('web');
  const keys: LayoutKey[] = textInImage ? ['baked_sheet', 'baked_card'] : ['overlay', 'live_card'];
  const name: Record<string, string> = { baked_sheet: '아래에서 올라오는 시트', baked_card: '화면 가운데 카드', overlay: '아래에서 올라오는 시트', live_card: '화면 가운데 카드' };
  return (
    <ModalBase open={open} onClose={onClose} title="틀 고르기" size="lg"
      subtitle={textInImage ? '그림에 든 글이 그대로 메시지가 돼요. 모양을 누르면 바로 편집 화면이 열려요.' : '사진 위에 글을 얹어요. 모양을 누르면 바로 편집 화면이 열려요.'}
      footer={<div className="flex justify-end w-full"><ModalButton onClick={onClose}>닫기</ModalButton></div>}>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-[12px] font-bold text-slate-600">채널</span>
        {(['web', 'app'] as const).map((c) => (
          <button key={c} type="button" onClick={() => setChannel(c)} aria-pressed={channel === c}
            className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border text-[12.5px] font-semibold ${channel === c ? 'bg-violet-100 border-violet-300 text-violet-900' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-100'}`}>
            {c === 'web' ? <Globe className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}{c === 'web' ? '웹(쇼핑몰)' : '앱'}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {keys.map((k) => {
          const design = designForKey(k, { dismiss_mode: 'snooze_day' });
          const note = channel === 'app' ? appCapsNote(design, 1) : null;
          return (
            <button key={k} type="button" onClick={() => onPick(k, channel)}
              className="text-left rounded-2xl border border-slate-200 bg-white hover:border-violet-300 hover:bg-slate-50 p-3 flex flex-col items-center transition-colors">
              <div style={{ width: Math.round(PHONE_W * 0.56), height: Math.round(PHONE_H * 0.56) }} className="relative">
                <div style={{ width: PHONE_W, height: PHONE_H, transform: 'scale(.56)', transformOrigin: 'top left' }}
                  className="relative overflow-hidden rounded-[34px] border-[6px] border-slate-200 bg-slate-100">
                  <MessageShapePreview m={{ template: 'full_image', design, poster_slides: [{ image_url: imageUrl, title }] }} height={PHONE_H} />
                </div>
              </div>
              <b className="self-stretch block text-[13.5px] text-slate-900 mt-2.5">{name[k]}</b>
              {note && <span className="self-stretch block text-[11.5px] text-amber-800 mt-0.5">{note.text}</span>}
            </button>
          );
        })}
      </div>
    </ModalBase>
  );
}
