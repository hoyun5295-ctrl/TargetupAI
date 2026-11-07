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
 * ★ 2026-11-07 브랜드 로고 층(설계서 docs/2026-11-07-c112-studio-brand-logo-design.md) — 결과 단계 = 스튜디오와 같은 StudioLogoControls ·
 *   넣기 = 보이는 그대로(확정 설정 layers) · 글 없는 판이면 서버가 위 두 모서리만 준다.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { creditText } from '../../../constants/credit';
import ModalBase, { ModalButton } from '../modals/ModalBase';
import { useToast } from '../../ToastProvider';
import TemplatePicker, { ALL_STUDIO_TRACKS, studioTrackOf, type StudioTemplatePublic, type StudioTrackKind } from '../../studio/TemplatePicker';
import { useStudioMake, StudioMakeFields, TemplateExampleCard } from '../../studio/StudioMake';
import StudioWatermark from '../../studio/StudioWatermark';
import StudioLogoControls from '../../studio/StudioLogoControls';
import { layersForSave, logoSettingsOf, type LogoCandidate, type LogoCardState, type LogoSettings } from '../../../lib/studio-layers';
import AssetLibraryPickerModal from '../../assets/AssetLibraryPickerModal';
import { saveStudioTemp, studioFetch } from '../../../lib/studio-api';
import type { StudioTexts } from '../../../lib/studio-texts';

type Step = 'pick' | 'make' | 'result';

export default function StudioInsertModal({
  open, onClose, onInserted, defaultTitle, defaultSubtitle, defaultLabel, textless = false, initialTemplateId,
}: {
  open: boolean;
  onClose: () => void;
  /** ★ 2026-11-05 인앱 포스터 재구성 §3-8 — texts = 그림에 그린 글(인앱 통짜 장 글 · DM 호출부는 둘째 인자를 쓰지 않는다) */
  onInserted: (url: string, texts?: StudioTexts) => void;
  defaultTitle?: string;
  defaultSubtitle?: string;
  /** ★ 2026-11-05 작은 라벨 문구(인앱 통짜 장 · 예시에서 시작) */
  defaultLabel?: string;
  /** ★ 2026-11-05 글 없는 판(인앱 글 얹기 장 · 글은 렌더러가 얹는다) */
  textless?: boolean;
  /** ★ 2026-11-05 시작본 · 예시가 정한 템플릿 — 고르기를 건너뛰고 만들기 단계로 연다(누름 한 번 + 2크레딧 확인 · 없으면 고르기부터) */
  initialTemplateId?: string | null;
}) {
  const toast = useToast();
  const [step, setStep] = useState<Step>('pick');
  const [template, setTemplate] = useState<StudioTemplatePublic | null>(null);
  // 호출부가 넘긴 블록 문구가 먼저다 · 빈 칸만 템플릿 기본 문구로 채운다(lib/studio-texts)
  const initialTexts = useMemo(() => ({ label: defaultLabel || '', title: defaultTitle || '', subtitle: defaultSubtitle || '' }), [defaultLabel, defaultTitle, defaultSubtitle]);
  const make = useStudioMake(template, initialTexts);
  // ★ 2026-09-23 미리보기는 blob 주소로 띄운다. 만든 그림의 주소(`/api/image-studio/temp/:id`)는 로그인 토큰이
  //   있어야 열리는데 `<img src>` 는 토큰을 못 붙여 결과 화면이 빈칸이었다(0922 남지현 접수 · 「이 그림 넣기」는 tempId 로 저장해 정상).
  //   preview = null 은 미리보기를 못 받은 경우다 — 넣기는 그대로 된다.
  const [made, setMade] = useState<({ tempId: string; preview: string | null; texts: StudioTexts; textless: boolean; discountCheck?: string | null } & LogoCardState) | null>(null);
  // ★ 2026-11-08 C114 K6 글 없는 장(인앱 글 얹기) = 제품 · 행사만(할인 포스터는 숫자가 그림에 들어간다) · 그 밖 = 셋 다
  const allowedKinds: readonly StudioTrackKind[] = textless ? ['product', 'event'] : ALL_STUDIO_TRACKS;
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
    // ★ 2026-11-05 §3-8 정해 둔 템플릿 = 고르기를 건너뛴다(목록에서 못 찾으면 고르기 그대로)
    if (initialTemplateId) {
      let alive = true;
      studioFetch('/api/image-studio/templates').then(({ data }) => {
        if (!alive) return;
        const list: StudioTemplatePublic[] = Array.isArray(data?.templates) ? data.templates : [];
        const hit = list.find((t) => t.id === initialTemplateId && allowedKinds.includes(studioTrackOf(t)));
        if (hit) { setTemplate(hit); setStep('make'); }
      }).catch(() => { /* 고르기부터 */ });
      return () => { alive = false; };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const generate = async () => {
    if (generating) return;
    const r = await make.generate({ textless });
    if (!r) return;
    dropPreview();
    previewUrl.current = r.preview;
    setMade({ tempId: r.tempId, preview: r.preview, texts: r.texts, textless: r.textless, logo: r.logo, layered: r.layered, logoFailed: r.logoFailed, discountCheck: r.discountCheck ?? null });
    setStorageFull(false);
    setStep('result');
  };

  const insert = async () => {
    if (!made || saving) return;
    setSaving(true);
    try {
      const r = await saveStudioTemp(made.tempId, make.texts.title || '블록 사진', layersForSave(made.logo, made.logoFailed, made.textless));
      if (!r.ok) {
        toast.error(r.error);
        if (r.code === 'STORAGE_FULL') setStorageFull(true);
        if (r.code === 'EXPIRED') { dropPreview(); setMade(null); setStep('make'); }
        // 키트 로고가 바뀜 · 못 쓰게 됨 = 미리보기를 다시 받는다(자리 그대로 · 크기는 새 로고 기준 자동)
        if (r.code === 'LOGO_CHANGED') await applyLogo({ ...logoSettingsOf(made.logo), size: null });
        return;
      }
      onInserted(r.asset.url, made.texts);
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

  // ── 로고 줄(★ 2026-11-07 · 0크레딧 · 응답의 확정 설정이 표시값 · 늦은 응답은 그 그림이 아직 결과일 때만 · 글 없는 판 = 결과의 값) ──
  const patchLogo = (tempId: string, st: LogoCardState) => setMade((cur) => (cur && cur.tempId === tempId ? { ...cur, ...st } : cur));
  const applyLogo = async (s: LogoSettings) => {
    if (!made) return;
    const st = await make.relayer(made.tempId, s, made.textless);
    if (st) patchLogo(made.tempId, st);
  };
  const saveLogoFor = async (lc: LogoCandidate) => {
    if (!made) return;
    const st = await make.saveFoundLogo(lc, made.tempId, made.textless);
    if (st) patchLogo(made.tempId, st);
  };

  const footer = step === 'make' ? (
    <div className="flex items-center gap-2 flex-wrap justify-end w-full">
      {generating && <span className="flex-1 min-w-[12rem] text-[12px] text-slate-500">만드는 중이에요(약 20~30초). 창을 닫아도 다시 열면 이어서 볼 수 있어요.</span>}
      {!generating && make.discountBuild && (
        <span className={`flex-1 min-w-[12rem] text-[12px] break-keep ${make.discountBuild.ok ? 'text-rose-700 font-semibold' : 'text-slate-400'}`}>{make.discountBuild.ok ? make.discountBuild.line : make.discountBuild.error}</span>
      )}
      <ModalButton onClick={() => setStep('pick')} disabled={generating}>다른 템플릿</ModalButton>
      <ModalButton variant="primary" onClick={generate} disabled={generating || (!!make.discountBuild && !make.discountBuild.ok)}>{generating ? '만드는 중...' : `만들기 (${creditText('image-studio-generate')})`}</ModalButton>
    </div>
  ) : step === 'result' ? (
    <div className="flex items-center gap-2 flex-wrap justify-end w-full">
      {generating && <span className="flex-1 min-w-[10rem] text-[12px] text-slate-500">{make.busyMsg}</span>}
      <ModalButton onClick={remake} disabled={saving || generating}>다시 만들기</ModalButton>
      <ModalButton variant="primary" onClick={insert} disabled={saving || generating}>{saving ? '넣는 중...' : '이 그림 넣기'}</ModalButton>
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
            allowedKinds={allowedKinds}
          />
        )}
        {step === 'make' && template && (
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
            <div className="sm:col-span-2"><TemplateExampleCard template={template} /></div>
            <div className="sm:col-span-3"><StudioMakeFields make={make} textless={textless} /></div>
          </div>
        )}
        {step === 'result' && made && (
          <div className="space-y-3">
            {(made.layered || made.preview) ? (
              <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                <img src={made.layered || made.preview || ''} alt="만든 그림 미리보기" draggable={false} onContextMenu={(e) => e.preventDefault()} className="w-full max-h-[52vh] object-contain" />
                <StudioWatermark />
              </div>
            ) : (
              <div className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-10 text-center text-[12.5px] text-slate-500">
                미리보기를 불러오지 못했어요. 「이 그림 넣기」를 누르면 만든 그림이 그대로 들어갑니다.
              </div>
            )}
            {made.discountCheck && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-[12px] text-rose-800 break-keep">포스터에 들어간 숫자: <b className="font-bold">{made.discountCheck}</b>. 그림 속 숫자가 같은지 꼭 확인해 주세요.</p>
            )}
            <StudioLogoControls logo={made.logo} failed={made.logoFailed} saved={false} disabled={saving || generating} onChange={(s) => void applyLogo(s)} onFind={make.findLogo} onUse={(lc) => void saveLogoFor(lc)} />
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
