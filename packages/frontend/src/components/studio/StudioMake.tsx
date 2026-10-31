/**
 * StudioMake — 이미지 스튜디오 만들기 단계 공용 (2026-10-16 · 설계서 2026-10-16-image-studio-picker-channel §2-4·§2-5)
 *
 * 스튜디오 제작 화면과 DM 삽입 창이 같은 부품을 쓴다. 옛 DM 창은 생성 요청을 따로 짜서 문구 위치(행사 기본 위)·상품·장면 힌트가 빠졌다.
 *   - useStudioMake  = 문구 · 장면 힌트 · 문구 위치 · 상품(누끼) 상태 + 생성 요청
 *   - StudioMakeFields = 그 입력 칸(문구 3칸 · 행사면 위치 · 상품(선택) · 장면 힌트(선택)) · 만들기 버튼은 부르는 쪽이 그린다
 *   - TemplateExampleCard = 고른 템플릿 예시 크게(예시 위에 아무것도 얹지 않는다 · 2026-08-13)
 * 흰 표면 창 안에서도 그려진다 → 다크 전제 색 금지(backend dm-build-light-surface.test.ts).
 * 상태는 이 훅을 부른 부품에 산다 → DM 창은 닫아도(ModalBase 가 null) 만드는 중 · 입력이 살아 있다(닫기 = 숨김).
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { PenLine, ShoppingBag, Upload, Wand2, Check } from 'lucide-react';
import { useToast } from '../ToastProvider';
import MallProductPickerModal, { type PickedMallProduct } from '../dm/MallProductPickerModal';
import { fetchAuthObjectUrl } from '../../lib/auth-download';
import { studioFetch, studioPost, newStudioAttempt } from '../../lib/studio-api';
import { applyAutoTexts, autoStudioTexts, EMPTY_STUDIO_TEXTS, type StudioTexts } from '../../lib/studio-texts';
import type { StudioTemplatePublic } from './TemplatePicker';

const won = (n: number) => `${Math.round(Number(n) || 0).toLocaleString()}원`;
const isEvent = (t: StudioTemplatePublic | null) => (t?.kind || 'product') === 'event';

export interface StudioMade { tempId: string; url: string; preview: string | null; title: string }

export function useStudioMake(template: StudioTemplatePublic | null, initialTexts: StudioTexts = EMPTY_STUDIO_TEXTS) {
  const toast = useToast();
  const [texts, setTexts] = useState<StudioTexts>(initialTexts);
  const [hint, setHint] = useState('');
  // ★ 2026-08-09 행사 포스터 문구 위치(위/중앙/아래) — 기본 위(갤러리 예시와 같은 구도로 시작). 제품 포스터는 미전달(템플릿 기본 배치).
  const [textPosition, setTextPosition] = useState<'top' | 'center' | 'bottom'>('top');
  const [product, setProduct] = useState<PickedMallProduct | null>(null);
  const [cutoutTempId, setCutoutTempId] = useState<string | null>(null);
  const [cutoutBlob, setCutoutBlob] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyMsg, setBusyMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  /** ★ 2026-10-31 상품 준비 차례 — 처음 상태로 돌리면 올려 진행 중 준비의 늦은 응답을 버린다(Codex 1R · 새 제작에 지난 상품이 다시 들어오지 않게) */
  const prepSeq = useRef(0);
  const autoRef = useRef<StudioTexts>(EMPTY_STUDIO_TEXTS);

  // 템플릿·상품이 바뀌면 자동 채움 — 비어 있거나 직전 자동값 그대로인 칸만(사람 값 · 호출부 문구 보존 · lib/studio-texts)
  //   직전 자동값은 지역 상수로 잡아 넘긴다 — 갱신 함수는 늦게 돌 수 있어, 그때 autoRef 를 읽으면 이미 새 값이라
  //   이전 상품명이 사람 값으로 오인돼 남는다(Codex 1016 1R).
  useEffect(() => {
    if (!template) return;
    const prev = autoRef.current;
    const next = autoStudioTexts(template.defaultTexts, product);
    autoRef.current = next;
    setTexts((cur) => applyAutoTexts(cur, prev, next));
  }, [template, product]);

  // 누끼 미리보기 blob 정리
  useEffect(() => () => { if (cutoutBlob) URL.revokeObjectURL(cutoutBlob); }, [cutoutBlob]);

  /** 처음 상태로(DM 창이 넣기 성공 뒤 · 새로 열 때). 다음 템플릿을 고르면 자동 채움이 다시 돈다. */
  const reset = useCallback((next: StudioTexts = EMPTY_STUDIO_TEXTS) => {
    prepSeq.current += 1;
    setBusyMsg('');
    autoRef.current = EMPTY_STUDIO_TEXTS;
    setTexts(next);
    setHint('');
    setTextPosition('top');
    setProduct(null);
    setCutoutTempId(null);
    setCutoutBlob(null);
  }, []);

  /**
   * ★ 2026-10-31 새 제작 시작(이미지 스튜디오 · 포스터를 만든 뒤 템플릿을 다시 고르면) = 처음 상태 + 그 템플릿 기본 문구.
   *   자동 채움 기준(autoRef)도 그 기본 문구로 둔다(같은 템플릿을 다시 골라 효과가 돌지 않아도 · 뒤에 상품을 고르면 기본 문구 칸이 상품으로 바뀐다).
   */
  const restart = useCallback((t: StudioTemplatePublic | null) => {
    const auto = t ? autoStudioTexts(t.defaultTexts, null) : EMPTY_STUDIO_TEXTS;
    reset(auto);
    autoRef.current = auto;
  }, [reset]);

  // ── 상품 준비: 인제스트/업로드 → 누끼 ─────────────────────────
  const prepareProduct = async (imageUrl: string | null, fromUpload?: File) => {
    const seq = ++prepSeq.current;
    const live = () => seq === prepSeq.current;
    setBusyMsg('상품 이미지 준비 중...');
    try {
      let sourceTempId: string | null = null;
      if (fromUpload) {
        const fd = new FormData();
        fd.append('image', fromUpload);
        const { ok, data } = await studioFetch('/api/image-studio/upload-product', { method: 'POST', body: fd });
        if (!ok) throw new Error(data?.error || '업로드 실패');
        sourceTempId = data.source.tempId;
      } else if (imageUrl) {
        const { ok, data } = await studioPost('/api/image-studio/ingest-product', { url: imageUrl });
        if (!ok) throw new Error(data?.error || '상품 이미지를 가져오지 못했어요');
        sourceTempId = data.source.tempId;
      }
      if (!sourceTempId) throw new Error('상품 이미지가 없습니다');
      if (!live()) return;

      setBusyMsg('제품 누끼 따는 중... (배경 자동 제거)');
      const { ok, data } = await studioPost('/api/image-studio/remove-bg', { sourceTempId });
      if (!live()) return;
      if (!ok) throw new Error(data?.error || '누끼에 실패했어요');
      // 누끼 ID 는 미리보기보다 먼저 남긴다(미리보기를 못 받아도 상품은 포스터에 들어간다 · Codex 1031 ①)
      setCutoutTempId(data.cutout.tempId);
      const blob = await fetchAuthObjectUrl(`/api/image-studio/temp/${data.cutout.tempId}`);
      if (!live()) { URL.revokeObjectURL(blob); return; }
      setCutoutBlob(blob);
      toast.success('제품 준비 완료. 원본 그대로 포스터에 들어갑니다');
    } catch (e: any) {
      if (live()) toast.error(e?.message || '상품 준비에 실패했어요');
    } finally {
      if (live()) setBusyMsg('');
    }
  };

  const onPickMall = (products: PickedMallProduct[]) => {
    const p = products[0];
    if (!p) return;
    setProduct(p);
    setCutoutTempId(null); setCutoutBlob(null);
    if (p.imageUrl) prepareProduct(p.imageUrl);
    else toast.error('이 상품은 이미지가 없어요. 다른 상품을 선택해주세요');
  };
  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setProduct(null);
    setCutoutTempId(null); setCutoutBlob(null);
    prepareProduct(null, f);
    e.target.value = '';
  };

  // ── 완성 포스터 생성 (템플릿 + 누끼 + 지정 문구, 2크레딧·1장 · 차감은 서버가 성공 뒤) ──
  // ★ 2026-10-19 B-1016-3② 결과를 못 받은 시도는 같은 표로 다시(서버가 이미 만든 결과를 주고 다시 걷지 않는다)
  const attemptRef = useRef<string | null>(null);
  const generate = async (): Promise<StudioMade | null> => {
    if (!template) { toast.error('템플릿을 먼저 골라주세요'); return null; }
    setBusyMsg('완성 포스터를 만드는 중... (약 20~30초)');
    try {
      if (!attemptRef.current) attemptRef.current = newStudioAttempt();
      const { status, ok, data } = await studioPost('/api/image-studio/generate', {
        templateId: template.id, presetKey: 'poster',
        texts, userHint: hint || null, cutoutTempId,
        textPosition: isEvent(template) ? textPosition : null,
        attemptToken: attemptRef.current,
      });
      if (status === 402) { toast.error('크레딧이 부족합니다. 충전 후 다시 시도해주세요'); return null; }
      if (!ok || !data.images?.[0]) { toast.error(data?.error || '생성에 실패했어요'); return null; }
      attemptRef.current = null;   // 성공 결과를 받았을 때만 표를 버린다(Codex E2)
      if (data.benefitNotice) toast.success(data.benefitNotice);
      const im = data.images[0];
      let preview: string | null = null;
      try { preview = await fetchAuthObjectUrl(im.url); } catch { /* 미리보기만 못 띄운다 · 저장·넣기는 tempId 로 된다 */ }
      // 헤드라인 = 저장 파일명(헤드라인_채널) 스냅샷(생성 시점 문구 고정)
      return { tempId: im.tempId, url: im.url, preview, title: texts.title };
    } finally {
      setBusyMsg('');
    }
  };

  return {
    template, texts, setTexts, hint, setHint, textPosition, setTextPosition,
    product, cutoutTempId, cutoutBlob, pickerOpen, setPickerOpen, fileRef,
    busyMsg, reset, restart, onPickMall, onUpload, generate,
  };
}

export type StudioMakeState = ReturnType<typeof useStudioMake>;

/** 고른 템플릿 예시 — 깨끗한 큰 이미지 하나(★2026-08-13 예시 위 오버레이·슬롯은 실제 타이포를 가려서 접었다). */
export function TemplateExampleCard({ template }: { template: StudioTemplatePublic }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      {template.exampleUrl ? (
        <img src={template.exampleUrl} alt={`${template.name} 예시`} className="w-full aspect-[3/4] object-cover" />
      ) : (
        <div className="w-full aspect-[3/4] relative flex flex-col items-center justify-end p-4" style={{ background: `linear-gradient(160deg, ${template.accent}cc, ${template.accent}55 60%, #0f172a)` }}>
          <div className="absolute top-6 left-0 right-0 text-center px-4">
            <div className="text-lg font-bold text-slate-900 leading-tight">{template.sample?.title || template.name}</div>
            {template.sample?.subtitle && <div className="text-xs text-slate-600 mt-1">{template.sample.subtitle}</div>}
          </div>
          {!isEvent(template) && <div className="w-16 h-24 rounded bg-slate-200 border border-slate-300 mb-6" />}
        </div>
      )}
      <div className="p-3">
        <div className="flex items-baseline gap-2 min-w-0">
          <div className="text-sm font-bold text-slate-900 truncate">{template.name}</div>
          <div className="text-[11px] text-slate-400 truncate">{template.desc}</div>
        </div>
        {template.useCase && (
          <div className="mt-2 rounded-lg bg-violet-50 border border-violet-200 px-2.5 py-1.5">
            <span className="text-[9px] tracking-wider text-violet-700 mr-1.5">이럴 때 좋아요</span>
            <span className="text-[11px] leading-snug text-violet-900">{template.useCase}</span>
          </div>
        )}
        <p className="mt-2 text-[10px] text-slate-400 italic">
          {template.exampleUrl ? '갤러리에서 보신 예시 그대로입니다. 문구와 상품만 바뀝니다.' : '예시 이미지 준비 중. 카드 스타일로 표시됩니다.'}
        </p>
      </div>
    </div>
  );
}

/** 만들기 입력 칸 — 문구 · 문구 위치(행사) · 상품(선택) · 장면 힌트(선택). 만들기 버튼은 부르는 쪽(스튜디오 = 페이지 버튼 · 창 = ModalButton). */
export function StudioMakeFields({ make, disabled = false }: { make: StudioMakeState; disabled?: boolean }) {
  const { template, texts, setTexts } = make;
  if (!template) return null;
  const event = isEvent(template);
  const busy = disabled || !!make.busyMsg;
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-fuchsia-200 bg-gradient-to-br from-fuchsia-50 to-indigo-50 p-4 space-y-2.5">
        <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><PenLine className="w-4 h-4 text-fuchsia-700" /> 포스터에 들어갈 문구</h3>
        {/* ★ 2026-08-13 Tip — 문구·상품 두 줄로 갈라 키워드만 강조. break-keep = 한국어 어절 단위 줄바꿈. */}
        <div className="rounded-xl bg-fuchsia-50 border border-fuchsia-200 px-3.5 py-3 space-y-2">
          <div className="flex items-start gap-2.5">
            <PenLine className="w-3.5 h-3.5 text-fuchsia-700 shrink-0 mt-0.5" />
            <p className="text-[12px] leading-relaxed text-slate-600 break-keep">
              예시 속 글자 자리에 <b className="text-fuchsia-800 font-semibold">아래 입력값이 그대로</b> 새겨져요. 배경·분위기는 예시 그대로.
            </p>
          </div>
          {!event && (
            <div className="flex items-start gap-2.5">
              <ShoppingBag className="w-3.5 h-3.5 text-emerald-700 shrink-0 mt-0.5" />
              <p className="text-[12px] leading-relaxed text-slate-600 break-keep">
                상품 사진은 <b className="text-emerald-800 font-semibold">배경이 자동으로 제거</b>되어 장면에 자연스럽게 들어가요.
              </p>
            </div>
          )}
        </div>
        <input value={texts.label} onChange={(e) => setTexts({ ...texts, label: e.target.value })} placeholder={event ? '작은 라벨 (예: MEMBERSHIP DAY)' : '작은 라벨 (예: ONLINE EXCLUSIVE)'} className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-fuchsia-300" />
        <input value={texts.title} onChange={(e) => setTexts({ ...texts, title: e.target.value })} placeholder={event ? '행사명 (예: 멤버십 데이)' : '헤드라인 (예: 제품명 30% 할인 · 2+1 이벤트)'} className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-fuchsia-300" />
        <input value={texts.subtitle} onChange={(e) => setTexts({ ...texts, subtitle: e.target.value })} placeholder={event ? '안내 문구 (예: 행사 기간·안내를 적어주세요)' : '부제 (예: 한정 수량 특별 혜택)'} className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-fuchsia-300" />
        {event && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[11px] text-slate-400">문구 위치</span>
            {([['top', '위'], ['center', '중앙'], ['bottom', '아래']] as const).map(([k, lbl]) => (
              <button type="button" key={k} onClick={() => make.setTextPosition(k)} className={`px-3 py-1.5 rounded-full border text-[11px] transition ${make.textPosition === k ? 'border-fuchsia-300 bg-fuchsia-100 text-fuchsia-800 font-semibold' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>{lbl}</button>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-400 italic">혜택·수치는 AI가 만들지 않아요. 직접 입력해주세요.</p>
      </div>

      {/* ★ 2026-08-13 상품 이미지 — 우측(좌측은 예시 하나로 고정) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2"><ShoppingBag className="w-4 h-4 text-violet-700" /> {event ? '제품 이미지 (선택)' : '상품 이미지'}</h3>
        <p className="text-[11px] text-slate-400 mb-3">
          {event
            ? '행사 포스터는 제품 없이 완성됩니다. 포스터에 제품을 함께 넣고 싶을 때만 첨부하세요.'
            : '제품 원본은 그대로 보존하고(누끼) 배경·문구만 새로 그립니다.'}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => make.setPickerOpen(true)} disabled={busy} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-indigo-300 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 text-xs font-semibold disabled:opacity-40">
            <ShoppingBag className="w-3.5 h-3.5" /> 연동 몰에서
          </button>
          <button type="button" onClick={() => make.fileRef.current?.click()} disabled={busy} className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 text-xs text-slate-700 hover:bg-slate-100 disabled:opacity-40">
            <Upload className="w-3.5 h-3.5" /> 사진 업로드
          </button>
          <input ref={make.fileRef} type="file" accept="image/*" onChange={make.onUpload} className="hidden" />
        </div>
        {make.cutoutBlob && (
          <div className="mt-3 flex items-center gap-3">
            <img src={make.cutoutBlob} alt="누끼" className="w-20 h-20 object-contain rounded-lg border border-emerald-200 bg-slate-100" />
            <div className="text-[11px] text-emerald-700 flex items-center gap-1"><Check className="w-3.5 h-3.5" /> 배경 제거 완료. 원본 그대로 들어갑니다</div>
          </div>
        )}
        {make.product && <div className="mt-2 text-[11px] text-slate-500 truncate">{make.product.name}{make.product.salePrice ? ` · ${won(make.product.salePrice)}` : ''}</div>}
        {!event && (
          <>
            <p className="text-[10px] text-slate-400 italic mt-2">상품 없이도 생성할 수 있어요(문구 포스터). 단일 제품 사진에서 가장 잘 작동합니다.</p>
            <p className="text-[10px] text-amber-700 italic mt-1">의류는 모델 착용컷 대신 옷 단독컷을 권장해요. 착용컷은 배경과 합성한 티가 나기 쉬워요.</p>
          </>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <label className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 mb-2"><Wand2 className="w-3.5 h-3.5 text-fuchsia-700" /> 장면 힌트 (선택)</label>
        <input value={make.hint} onChange={(e) => make.setHint(e.target.value)} placeholder="예: 대리석 카운터, 은은한 램프 조명" className="w-full px-3 py-2 bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-300" />
      </div>

      <MallProductPickerModal open={make.pickerOpen} onClose={() => make.setPickerOpen(false)} onPick={make.onPickMall} />
    </div>
  );
}
