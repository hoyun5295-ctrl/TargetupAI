/**
 * StudioInsertModal — 이미지 스튜디오를 블록 창 위에 겹쳐 띄우고, 만든 그림을 그 자리에 넣는다 (★ 2026-09-16 설계서 §4)
 *
 * 새 생성 엔진을 만들지 않는다. 기존 경로를 그대로 지난다:
 *   GET /api/image-studio/templates → POST /api/image-studio/generate(2크레딧·서버 차감) → POST /api/image-studio/save(라이브러리 보관)
 * 저장된 그림의 공개 주소를 호출부(블록)에 돌려준다. 실패하면 블록은 사진 없는 상태로 남는다(조립이 막히지 않는다).
 *
 * ★ 2026-10-16 스튜디오와 같은 고르기 → 만들기 → 결과 (설계서 2026-10-16-image-studio-picker-channel §2-4)
 *   - 고르기 = 공용 TemplatePicker(검색 · 카테고리 · 세부 · 우리 업종). 첫 장 자동 선택은 폐기(Harold 1016) · 고르기 전엔 만들기 버튼을 그리지 않는다.
 *   - 만들기 = 스튜디오 제작 화면과 같은 부품(문구 · 행사면 위치 기본 위 · 상품 · 장면 힌트).
 *   - 닫기 = 숨김(취소 아님): 단계 · 만드는 중 · 결과는 이 부품에 산다(ModalBase 는 닫히면 null 만 돌려준다).
 *     다시 열면 이어서 보인다 → 2크레딧 낸 그림을 잃지 않는다. 처음 상태로 돌리는 것은 「넣기 성공」 뒤뿐.
 *   - 저장은 공용 saveStudioTemp(저장 공간 가득 · 이미 저장됨을 스튜디오와 같은 방식으로 가른다).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ModalBase, { ModalButton } from '../modals/ModalBase';
import { useToast } from '../../ToastProvider';
import TemplatePicker, { type StudioTemplatePublic } from '../../studio/TemplatePicker';
import { useStudioMake, StudioMakeFields, TemplateExampleCard } from '../../studio/StudioMake';
import StudioWatermark from '../../studio/StudioWatermark';
import AssetLibraryPickerModal from '../../assets/AssetLibraryPickerModal';
import { saveStudioTemp } from '../../../lib/studio-api';

type Step = 'pick' | 'make' | 'result';

export default function StudioInsertModal({
  open, onClose, onInserted, defaultTitle, defaultSubtitle,
}: {
  open: boolean;
  onClose: () => void;
  onInserted: (url: string) => void;
  defaultTitle?: string;
  defaultSubtitle?: string;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('pick');
  const [template, setTemplate] = useState<StudioTemplatePublic | null>(null);
  // 호출부가 넘긴 블록 문구가 먼저다 · 빈 칸만 템플릿 기본 문구로 채운다(lib/studio-texts)
  const initialTexts = useMemo(() => ({ label: '', title: defaultTitle || '', subtitle: defaultSubtitle || '' }), [defaultTitle, defaultSubtitle]);
  const make = useStudioMake(template, initialTexts);
  // ★ 2026-09-23 미리보기는 blob 주소로 띄운다. 만든 그림의 주소(`/api/image-studio/temp/:id`)는 로그인 토큰이
  //   있어야 열리는데 `<img src>` 는 토큰을 못 붙여 결과 화면이 빈칸이었다(0922 남지현 접수 · 「이 그림 넣기」는 tempId 로 저장해 정상).
  //   preview = null 은 미리보기를 못 받은 경우다 — 넣기는 그대로 된다.
  const [made, setMade] = useState<{ tempId: string; preview: string | null } | null>(null);
  const [saving, setSaving] = useState(false);
  const [storageFull, setStorageFull] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const previewUrl = useRef<string | null>(null);
  const dropPreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
  }, []);
  useEffect(() => dropPreview, [dropPreview]);

  const generating = !!make.busyMsg;
  // 처음 상태로 여는 것은 「처음 열 때」와 「넣기 성공 뒤 다음에 열 때」뿐이다. 그 밖의 다시 열기는 쓰던 그대로 이어서(닫기 = 숨김) —
  //   작성 중 · 만드는 중 · 생성 실패 뒤 · 결과 대기 모두 지우지 않는다(Codex 1016 1R · 설계서 §2-4).
  const freshRef = useRef(true);

  useEffect(() => {
    if (!open || !freshRef.current) return;
    freshRef.current = false;
    setStep('pick');
    setTemplate(null);
    setStorageFull(false);
    make.reset(initialTexts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const generate = async () => {
    if (generating) return;
    const r = await make.generate();
    if (!r) return;
    dropPreview();
    previewUrl.current = r.preview;
    setMade({ tempId: r.tempId, preview: r.preview });
    setStorageFull(false);
    setStep('result');
  };

  const insert = async () => {
    if (!made || saving) return;
    setSaving(true);
    try {
      const r = await saveStudioTemp(made.tempId, make.texts.title || '블록 사진');
      if (!r.ok) {
        toast.error(r.error);
        if (r.code === 'STORAGE_FULL') setStorageFull(true);
        if (r.code === 'EXPIRED') { dropPreview(); setMade(null); setStep('make'); }
        return;
      }
      onInserted(r.asset.url);
      toast.success('만든 그림을 블록에 넣었어요. 라이브러리에도 보관했어요.');
      // 처음 상태로 돌리는 것은 넣기 성공 뒤뿐 — 다음에 열 때 그 블록의 문구로 새로 시작한다
      dropPreview();
      setMade(null);
      setStorageFull(false);
      setTemplate(null);
      setStep('pick');
      freshRef.current = true;
    } finally {
      setSaving(false);
    }
  };

  const remake = () => { dropPreview(); setMade(null); setStorageFull(false); setStep('make'); };

  const footer = step === 'make' ? (
    <div className="flex items-center gap-2 flex-wrap justify-end w-full">
      {generating && <span className="flex-1 min-w-[12rem] text-[11.5px] text-slate-500">만드는 중이에요(약 20~30초). 창을 닫아도 다시 열면 이어서 볼 수 있어요.</span>}
      <ModalButton onClick={() => setStep('pick')} disabled={generating}>다른 템플릿</ModalButton>
      <ModalButton variant="primary" onClick={generate} disabled={generating}>{generating ? '만드는 중...' : '만들기 (2크레딧)'}</ModalButton>
    </div>
  ) : step === 'result' ? (
    <div className="flex items-center gap-2 justify-end w-full">
      <ModalButton onClick={remake} disabled={saving}>다시 만들기</ModalButton>
      <ModalButton variant="primary" onClick={insert} disabled={saving}>{saving ? '넣는 중...' : '이 그림 넣기'}</ModalButton>
    </div>
  ) : undefined;

  return (
    <>
      <ModalBase
        open={open}
        onClose={onClose}
        title="✨ 이미지 스튜디오"
        subtitle="템플릿을 고르고 문구를 넣으면 이 블록의 사진 자리에 바로 들어갑니다"
        size="lg"
        closeOnEsc={!libOpen && !make.pickerOpen}
        footer={footer}
      >
        {step === 'pick' && (
          <TemplatePicker
            onPick={(t) => { setTemplate(t); setStep('make'); }}
            autoOpenIndustry
            gridClassName="grid grid-cols-2 sm:grid-cols-3 gap-3"
          />
        )}
        {step === 'make' && template && (
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
            <div className="sm:col-span-2"><TemplateExampleCard template={template} /></div>
            <div className="sm:col-span-3"><StudioMakeFields make={make} /></div>
          </div>
        )}
        {step === 'result' && made && (
          <div className="space-y-3">
            {made.preview ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                <img src={made.preview} alt="만든 그림 미리보기" draggable={false} onContextMenu={(e) => e.preventDefault()} className="w-full max-h-[52vh] object-contain" />
                <StudioWatermark />
              </div>
            ) : (
              <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-[12.5px] text-slate-500">
                미리보기를 불러오지 못했어요. 「이 그림 넣기」를 누르면 만든 그림이 그대로 들어갑니다.
              </div>
            )}
            {storageFull && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800 flex items-center gap-2 flex-wrap">
                <span className="flex-1 min-w-[12rem]">저장 공간이 가득 찼어요. 안 쓰는 소재를 정리한 뒤 「이 그림 넣기」를 다시 눌러 주세요.</span>
                <button type="button" onClick={() => setLibOpen(true)} className="px-3 py-1.5 rounded-lg border border-rose-300 bg-white text-rose-800 text-[11.5px] font-semibold hover:bg-rose-100">저장 소재 정리</button>
              </div>
            )}
          </div>
        )}
      </ModalBase>
      {/* 저장 공간 정리 = 공용 소재 창(검색 · 삭제). 소재를 눌러도 이 블록에는 넣지 않는다(만든 그림이 우선). */}
      <AssetLibraryPickerModal open={libOpen} onClose={() => setLibOpen(false)} onPick={() => { /* 정리 전용 */ }} />
    </>
  );
}
