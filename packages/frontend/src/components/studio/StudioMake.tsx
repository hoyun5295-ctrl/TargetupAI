/**
 * StudioMake — 이미지 스튜디오 만들기 단계 공용 (2026-10-16 · 설계서 2026-10-16-image-studio-picker-channel §2-4·§2-5)
 *
 * 스튜디오 제작 화면과 DM 삽입 창이 같은 부품을 쓴다. 옛 DM 창은 생성 요청을 따로 짜서 문구 위치(행사 기본 위)·상품·장면 힌트가 빠졌다.
 *   - useStudioMake  = 문구 · 장면 힌트 · 문구 위치 · 상품(누끼) 상태 + 생성 요청
 *   - StudioMakeFields = 그 입력 칸(문구 3칸 · 행사면 위치 · 상품(선택) · 장면 힌트(선택)) · 만들기 버튼은 부르는 쪽이 그린다
 *   - TemplateExampleCard = 고른 템플릿 예시 크게(예시 위에 아무것도 얹지 않는다 · 2026-08-13)
 * 흰 표면 창 안에서도 그려진다 → 다크 전제 색 금지(backend dm-build-light-surface.test.ts).
 * 상태는 이 훅을 부른 부품에 산다 → DM 창은 닫아도(ModalBase 가 null) 만드는 중 · 입력이 살아 있다(닫기 = 숨김).
 * ★ 2026-11-02 제품 사진 최대 3장(칸 목록 · 서버가 한 장으로 묶는다) · 칸 수명 = 설계서 docs/2026-11-02-image-studio-multi-product-design.md §2
 * ★ 2026-11-07 브랜드 로고 층 = 생성 뒤 곧바로 미리보기(켜짐 · 0크레딧) · relayer · readLogo 를 두 결과 화면이 같이 쓴다(설계서 docs/2026-11-07-c112-studio-brand-logo-design.md D8 · D10 · D11)
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { PenLine, ShoppingBag, Upload, Wand2, Loader2, X } from 'lucide-react';
import { useToast } from '../ToastProvider';
import MallProductPickerModal, { type PickedMallProduct } from '../dm/MallProductPickerModal';
import { fetchAuthObjectUrl } from '../../lib/auth-download';
import { studioFetch, studioPost, newStudioAttempt } from '../../lib/studio-api';
import { applyAutoTexts, autoStudioTexts, EMPTY_STUDIO_TEXTS, type StudioTexts } from '../../lib/studio-texts';
import { runProductPrep } from '../../lib/studio-products';
import { layerRequest, LOGO_FAILED_TEXT, type LogoCandidate, type LogoCardState, type LogoSettings } from '../../lib/studio-layers';
import { studioTrackOf, type StudioTemplatePublic } from './TemplatePicker';
// ★ 2026-11-08 C114 B 할인 숫자 칸(판정 권한 = 서버 · 이 lib = 같은 규칙으로 미리 보기 · 계약 시험 c114-discount-parity)
import { buildDiscountOffer, autoFillDiscount, EMPTY_DISCOUNT_FIELDS, type DiscountFields, type DiscountOfferKind } from '../../lib/studio-discount';

const isEvent = (t: StudioTemplatePublic | null) => studioTrackOf(t) === 'event';

/** ★ 2026-11-05 인앱 포스터 재구성 §3-8 — texts = 생성에 쓴 글 전체(인앱 통짜 장 글 · 글 없는 판이면 빈 글) */
export interface StudioMade extends LogoCardState {
  tempId: string; url: string; preview: string | null; title: string; texts: StudioTexts; textless: boolean;
  /** ★ C114 D8 할인 포스터 = 서버가 돌려준 「포스터에 들어간 숫자」 한 줄(결과 카드가 그린다) */
  discountCheck?: string | null;
}

/** ★ 2026-11-02 제품 사진 상한 — 서버 STUDIO_MAX_PRODUCTS(utils/image-studio.ts)와 같은 값(계약 시험 S5) · 넘침 판정 권한은 서버 */
export const STUDIO_MAX_PRODUCTS = 3;

/** 제품 사진 한 칸 — 넣은 순서 = 포스터 왼쪽부터. 누끼 id 가 없으면 준비 중, 미리보기가 없으면 「미리보기 없음」 */
export interface StudioProductItem { key: string; product: PickedMallProduct | null; cutoutTempId: string | null; blob: string | null }
type ProductSource = { product: PickedMallProduct | null; imageUrl: string | null; file?: File };

let itemSeq = 0;

export function useStudioMake(template: StudioTemplatePublic | null, initialTexts: StudioTexts = EMPTY_STUDIO_TEXTS) {
  const toast = useToast();
  const [texts, setTexts] = useState<StudioTexts>(initialTexts);
  const [hint, setHint] = useState('');
  // ★ 2026-08-09 행사 포스터 문구 위치(위/중앙/아래) — 기본 위(갤러리 예시와 같은 구도로 시작). 제품 포스터는 미전달(템플릿 기본 배치).
  const [textPosition, setTextPosition] = useState<'top' | 'center' | 'bottom'>('top');
  const [items, setItems] = useState<StudioProductItem[]>([]);
  // ★ 2026-11-08 C114 B 할인 혜택 칸(글 그대로 · 보낼 값 = buildDiscountOffer)
  const [discount, setDiscount] = useState<DiscountFields>(EMPTY_DISCOUNT_FIELDS);
  const discountKind: DiscountOfferKind | null = studioTrackOf(template) === 'discount' ? ((template?.offer || 'price') as DiscountOfferKind) : null;
  const discountBuild = useMemo(() => (discountKind ? buildDiscountOffer(discountKind, discount) : null), [discountKind, discount]);
  /** 정리(처음으로 · 언마운트)와 담기가 지금 칸을 읽는다 — 렌더마다 따라간다 */
  const itemsRef = useRef<StudioProductItem[]>([]);
  itemsRef.current = items;
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busyMsg, setBusyMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  /** ★ 2026-10-31 상품 준비 차례 — 처음 상태로 돌리면 올려 진행 중 준비의 늦은 응답을 버린다(Codex 1R · 새 제작에 지난 상품이 다시 들어오지 않게) */
  const prepSeq = useRef(0);
  const autoRef = useRef<StudioTexts>(EMPTY_STUDIO_TEXTS);
  /** 자동 문구 기준 = 칸 순서상 첫 몰 상품(사진 올리기 칸은 상품 정보가 없다) */
  const product = items.find((i) => i.product)?.product ?? null;
  const remaining = STUDIO_MAX_PRODUCTS - items.length;
  const full = remaining <= 0;

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

  // ★ C114 B 몰 상품 = 비어 있는 혜택 칸만 채운다(사람 값 보존 · 할인 중이 아니면 판매가 칸 비움)
  const productKey = items.map((i) => (i.product ? `${i.product.provider}:${i.product.code}` : i.key)).join('|');
  useEffect(() => {
    if (!discountKind) return;
    const products = items.map((i) => (i.product ? { name: i.product.name, price: Number(i.product.price) || 0, salePrice: Number(i.product.salePrice) || 0 } : null));
    if (!products.some(Boolean)) return;
    setDiscount((cur) => autoFillDiscount(discountKind, cur, products));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountKind, productKey]);

  // 훅 언마운트(스튜디오 화면 떠남 · DM 편집기 닫힘) = 준비 세대를 끝내고(남은 단계 중단 · 늦은 미리보기는 받자마자 해제) 미리보기를 모두 해제.
  //   DM 창 닫기 = 숨김은 언마운트가 아니다(칸 · 준비 그대로 · Codex 설계 1R ④)
  useEffect(() => () => {
    prepSeq.current += 1;
    for (const i of itemsRef.current) if (i.blob) URL.revokeObjectURL(i.blob);
  }, []);

  /** 처음 상태로(DM 창이 넣기 성공 뒤 · 새로 열 때). 다음 템플릿을 고르면 자동 채움이 다시 돈다. */
  const reset = useCallback((next: StudioTexts = EMPTY_STUDIO_TEXTS) => {
    prepSeq.current += 1;
    setBusyMsg('');
    autoRef.current = EMPTY_STUDIO_TEXTS;
    setTexts(next);
    setHint('');
    setTextPosition('top');
    setDiscount(EMPTY_DISCOUNT_FIELDS);
    for (const i of itemsRef.current) if (i.blob) URL.revokeObjectURL(i.blob);
    setItems([]);
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

  const patchItem = (key: string, patch: Partial<StudioProductItem>) =>
    setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  const dropItem = (key: string) => setItems((cur) => cur.filter((i) => i.key !== key));

  // ── 제품 준비: 담은 칸마다 차례로 인제스트/업로드 → 누끼 · 칸 수명은 runProductPrep(lib/studio-products · 동작 시험) 한 곳 ──
  const prepareProducts = async (added: Array<ProductSource & { key: string }>) => {
    const seq = ++prepSeq.current;
    const live = () => seq === prepSeq.current;
    const r = await runProductPrep(added, {
      live,
      setBusy: setBusyMsg,
      upload: async (file) => {
        const fd = new FormData();
        fd.append('image', file);
        const { ok, data } = await studioFetch('/api/image-studio/upload-product', { method: 'POST', body: fd });
        if (!ok) throw new Error(data?.error || '업로드 실패');
        return data.source.tempId;
      },
      ingest: async (imageUrl) => {
        const { ok, data } = await studioPost('/api/image-studio/ingest-product', { url: imageUrl });
        if (!ok) throw new Error(data?.error || '상품 이미지를 가져오지 못했어요');
        return data.source.tempId;
      },
      removeBg: async (sourceTempId) => {
        const { ok, data } = await studioPost('/api/image-studio/remove-bg', { sourceTempId });
        if (!ok) throw new Error(data?.error || '누끼에 실패했어요');
        return data.cutout.tempId;
      },
      preview: (cutoutTempId) => fetchAuthObjectUrl(`/api/image-studio/temp/${cutoutTempId}`),
      revoke: (url) => URL.revokeObjectURL(url),
      onCutout: (key, cutoutTempId) => patchItem(key, { cutoutTempId }),
      onPreview: (key, url) => patchItem(key, { blob: url }),
      onFail: (key, message) => { dropItem(key); toast.error(message); },
    });
    if (!r) return;   // 지난 세대(처음으로 · 언마운트) = 아무것도 건드리지 않는다
    if (r.ready === 1 && added.length === 1) toast.success('제품 준비 완료. 원본 그대로 포스터에 들어갑니다');
    else if (r.ready > 0) toast.success(`제품 ${r.ready}개 준비 완료. 넣은 순서대로 포스터에 들어갑니다`);
  };

  /** 담기 — 남은 칸까지만(넘친 장은 담지 않는다 · 판정 권한은 서버 상한) */
  const addProducts = (sources: ProductSource[]) => {
    const room = Math.max(0, STUDIO_MAX_PRODUCTS - itemsRef.current.length);
    const take = sources.slice(0, room);
    if (sources.length > take.length) {
      toast.error(`제품 사진은 최대 ${STUDIO_MAX_PRODUCTS}개까지 넣을 수 있어요.${take.length ? ` 앞의 ${take.length}장만 넣었어요.` : ''}`);
    }
    if (!take.length) return;
    const added = take.map((s) => ({ ...s, key: `p${++itemSeq}` }));
    setItems((cur) => [...cur, ...added.map((a) => ({ key: a.key, product: a.product, cutoutTempId: null, blob: null }))]);
    void prepareProducts(added);
  };

  const onPickMall = (products: PickedMallProduct[]) => {
    const withImage = products.filter((p) => p.imageUrl);
    if (withImage.length < products.length) toast.error('이미지가 없는 상품은 넣지 않았어요. 다른 상품을 선택해주세요');
    addProducts(withImage.map((p) => ({ product: p, imageUrl: p.imageUrl })));
  };
  const onUpload = (e: ChangeEvent<HTMLInputElement>) => {
    // 한 번에 여러 장 = 파일 이름 순서대로 담는다(브라우저가 주는 순서는 운영체제마다 달라 사람이 예측할 수 없다 · Codex 설계 3R)
    const files = Array.from(e.target.files || []).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
    e.target.value = '';
    if (files.length) addProducts(files.map((f) => ({ product: null, imageUrl: null, file: f })));
  };
  /** 빼기(준비 중이 아닐 때만 눌린다) — 미리보기 해제 */
  const removeItem = (key: string) => {
    const it = itemsRef.current.find((i) => i.key === key);
    if (it?.blob) URL.revokeObjectURL(it.blob);
    dropItem(key);
  };

  // ── 로고 미리보기(★ 2026-11-07 · 서버가 합성한 그림 + 확정 설정 · 0크레딧 · 파일 0) ──
  //   표시값 = 응답의 확정 설정 · 실패하면 지금 카드를 그대로 둔다(보이는 그림 = 저장되는 그림)
  const postLayers = async (baseTempId: string, s: LogoSettings, textless: boolean): Promise<LogoCardState | string> => {
    const { ok, data } = await studioPost('/api/image-studio/layers', layerRequest(baseTempId, s, textless));
    if (!ok || !data.logo) return data?.error || `${LOGO_FAILED_TEXT}. 다시 눌러 주세요.`;
    return { logo: data.logo, layered: typeof data.preview === 'string' ? data.preview : null, logoFailed: false };
  };
  /** 끄고 켜기 · 자리 · 크기 · 다시 얹기 · AI 수정 뒤(같은 확정 설정) — 실패 = 알림 + null(부른 쪽은 카드를 그대로) */
  const relayer = async (baseTempId: string, s: LogoSettings, textless: boolean): Promise<LogoCardState | null> => {
    setBusyMsg('로고를 얹는 중...');
    try {
      const r = await postLayers(baseTempId, s, textless);
      if (typeof r === 'string') { toast.error(r); return null; }
      return r;
    } finally {
      setBusyMsg('');
    }
  };
  /** ★ C113 D9 1단계 — 키트 로고가 없을 때 홈페이지에서 로고 후보를 찾는다(서버 임시 · 키트 쓰기 0) */
  const findLogo = async (url: string): Promise<LogoCandidate | null> => {
    setBusyMsg('홈페이지에서 로고를 찾는 중...');
    try {
      const { ok, data } = await studioPost('/api/image-studio/logo/read', { url });
      if (!ok || !data?.candidate) { toast.error(data?.error || '홈페이지를 읽지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return null; }
      return data.candidate as LogoCandidate;
    } finally {
      setBusyMsg('');
    }
  };
  /** ★ C113 D9 2단계 — 본 후보를 키트 빈 칸에만 저장(서버) → 곧바로 미리보기(켜짐 · 자동) */
  const saveFoundLogo = async (c: LogoCandidate, baseTempId: string, textless: boolean): Promise<LogoCardState | null> => {
    setBusyMsg('로고를 저장하는 중...');
    try {
      const { ok, data } = await studioPost('/api/image-studio/logo/use', { tempId: c.tempId });
      if (!ok) { toast.error(data?.error || '로고를 저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.'); return null; }
    } finally {
      setBusyMsg('');
    }
    return relayer(baseTempId, { on: true, corner: null, size: null }, textless);
  };

  // ── 완성 포스터 생성 (템플릿 + 누끼 + 지정 문구, 2크레딧·1장 · 차감은 서버가 성공 뒤) ──
  // ★ 2026-10-19 B-1016-3② 결과를 못 받은 시도는 같은 표로 다시(서버가 이미 만든 결과를 주고 다시 걷지 않는다)
  const attemptRef = useRef<string | null>(null);
  // ★ 2026-11-05 §3-8 textless = 글 없는 판(인앱 글 얹기 장 · 렌더러가 글을 얹을 아래 자리를 비운다)
  // ★ 2026-11-08 C118 A1 · A2 용도별 제작 — 요청 본문 = 그때 입력을 얼린 사본(용도 칸 · 다시 만들기 = 같은 표 + 같은 본문)
  //   presetKey = 서버 CHANNEL_PRESETS(use-inapp 1:1 · use-dm 3:4 · use-email 4:3 · poster 자유 3:4) · textPosition = 인앱 용도면 모든 템플릿
  const buildGenerateBody = (opts?: { textless?: boolean; presetKey?: string; textPosition?: 'top' | 'bottom' | null }): Record<string, unknown> | null => {
    if (!template) { toast.error('템플릿을 먼저 골라주세요'); return null; }
    const textless = !!opts?.textless;
    // ★ C114 Codex 구현 1R ③ 할인형 = 화면에 보이는 칸(제품명)과 템플릿 기본 라벨만 보낸다(숨긴 라벨 · 부제의 옛 값이 그림에 들어가지 않게)
    const sendTexts = textless ? EMPTY_STUDIO_TEXTS
      : discountKind ? { label: template.defaultTexts?.label || '', title: texts.title, subtitle: '' }
      : texts;
    // ★ C114 B 할인 포스터 = 제품명 · 혜택 숫자를 미리 본다(판정 권한 = 서버 · 같은 규칙)
    if (discountKind && !textless) {
      if (!String(texts.title || '').trim()) { toast.error('제품명을 넣어 주세요. 포스터 맨 위에 들어가요.'); return null; }
      if (!discountBuild || !discountBuild.ok) { toast.error(discountBuild && !discountBuild.ok ? discountBuild.error : '혜택 숫자를 넣어 주세요.'); return null; }
    }
    const inappUse = opts?.presetKey === 'use-inapp';
    return {
      templateId: template.id, presetKey: opts?.presetKey || 'poster',
      texts: { ...sendTexts }, userHint: hint || null,
      // ★ 2026-11-02 제품 사진 목록(넣은 순서 = 포스터 왼쪽부터 · 준비 중엔 만들기가 막혀 있다)
      cutoutTempIds: items.flatMap((i) => (i.cutoutTempId ? [i.cutoutTempId] : [])),
      // ★ C118 A3 인앱 용도 = 고른 글 자리(위 · 아래)를 모든 템플릿에 · 글 없는 판 = 아래(글을 얹을 자리)
      // ★ C118 E3 할인 템플릿 = 글 자리 위 고정(서버도 위)
      textPosition: textless ? 'bottom' : (inappUse ? (discountKind ? 'top' : (opts?.textPosition || 'top')) : (isEvent(template) ? textPosition : null)),
      ...(discountKind && !textless && discountBuild?.ok ? { offer: discountBuild.offer } : {}),
    };
  };

  /** 얼린 본문 + 표 하나로 만든다(표는 부른 쪽이 들고 성공 결과를 받은 뒤에만 버린다 · Codex E2 · C118 Codex 설계 1R ①) */
  const runGenerateBody = async (body: Record<string, unknown>, attemptToken: string, textless: boolean, label?: string): Promise<StudioMade | null> => {
    setBusyMsg(label || '완성 포스터를 만드는 중... (약 20~30초)');
    try {
      const { status, ok, data } = await studioPost('/api/image-studio/generate', { ...body, attemptToken });
      if (status === 402) { toast.error('크레딧이 부족합니다. 충전 후 다시 시도해주세요'); return null; }
      if (!ok || !data.images?.[0]) { toast.error(data?.error || '생성에 실패했어요'); return null; }
      if (data.benefitNotice) toast.success(data.benefitNotice);
      const im = data.images[0];
      let preview: string | null = null;
      try { preview = await fetchAuthObjectUrl(im.url); } catch { /* 미리보기만 못 띄운다 · 저장·넣기는 tempId 로 된다 */ }
      // ★ 2026-11-07 로고 기본 켜짐(D8) — 실패 = 바탕 + 「로고를 얹지 못했어요 · 다시 얹기」(확정 설정 없음 = 보이는 그대로 바탕 저장)
      setBusyMsg('로고를 얹는 중...');
      // ★ C118 E2 로고 = 기본 꺼짐(Harold 1108 「로고 겁나 거슬리네」 · 켜기 · 모서리 · 크기 줄은 그대로 · 켜면 지금 갈래)
      const lay = await postLayers(im.tempId, { on: false, corner: null, size: null }, textless);
      const logoState: LogoCardState = typeof lay === 'string' ? { logo: null, layered: null, logoFailed: true } : lay;
      // 헤드라인 = 저장 파일명(헤드라인_채널) 스냅샷(생성 시점 문구 고정 · 얼린 본문의 문구)
      const bt = (body.texts || {}) as StudioTexts;
      return { tempId: im.tempId, url: im.url, preview, title: bt.title, texts: { ...bt }, textless, ...logoState, discountCheck: typeof data.discountCheck === 'string' ? data.discountCheck : null };
    } finally {
      setBusyMsg('');
    }
  };

  const generate = async (opts?: { textless?: boolean; presetKey?: string; textPosition?: 'top' | 'bottom' | null }): Promise<StudioMade | null> => {
    const body = buildGenerateBody(opts);
    if (!body) return null;
    if (!attemptRef.current) attemptRef.current = newStudioAttempt();
    const r = await runGenerateBody(body, attemptRef.current, !!opts?.textless);
    if (r) attemptRef.current = null;   // 성공 결과를 받았을 때만 표를 버린다(Codex E2)
    return r;
  };

  return {
    template, texts, setTexts, hint, setHint, textPosition, setTextPosition,
    discount, setDiscount, discountBuild, discountKind,
    items, remaining, full, removeItem, pickerOpen, setPickerOpen, fileRef,
    busyMsg, reset, restart, onPickMall, onUpload, generate, relayer, findLogo, saveFoundLogo,
    buildGenerateBody, runGenerateBody,
  };
}

export type StudioMakeState = ReturnType<typeof useStudioMake>;

/** 고른 템플릿 예시 — 깨끗한 큰 이미지 하나(★2026-08-13 예시 위 오버레이·슬롯은 실제 타이포를 가려서 접었다) · ★ C114 C 9 · 10px 글자 0 */
export function TemplateExampleCard({ template }: { template: StudioTemplatePublic }) {
  const discount = studioTrackOf(template) === 'discount';
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
        <div className="text-sm font-bold text-slate-900 break-keep">{template.name}</div>
        {template.useCase && <p className="mt-1 text-[12px] leading-snug text-slate-500 break-keep">{template.useCase}</p>}
        {discount && template.exampleUrl && <p className="mt-1.5 text-[11px] text-slate-400 break-keep">예시 가격이에요. 넣은 숫자로 바뀌어요.</p>}
        {!template.exampleUrl && <p className="mt-1.5 text-[11px] text-slate-400 break-keep">예시 그림을 준비하고 있어요.</p>}
      </div>
    </div>
  );
}

const FIELD = 'w-full h-10 px-3 rounded-lg border border-slate-200 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-400 disabled:opacity-50';
const LABEL = 'block text-[11px] font-semibold text-slate-500 mb-1';
const NOTE = 'text-[12px] leading-relaxed text-slate-500 break-keep';

function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="px-4 py-4">
      <div className="flex items-center gap-2 mb-3">
        <h3 className="text-[13px] font-bold text-slate-900">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

/** ★ C114 B 할인 혜택 칸(템플릿 혜택 꼴 = 가격 할인 · 하나 더 · 세트) — 판정 = 서버 · 미리 보기 = lib/studio-discount */
function DiscountFieldsBlock({ make, busy }: { make: StudioMakeState; busy: boolean }) {
  const kind = (make.template?.offer || 'price') as DiscountOfferKind;
  const f = make.discount;
  const set = (patch: Partial<DiscountFields>) => make.setDiscount({ ...f, ...patch });
  const built = make.discountBuild;
  const NPLUS: Array<[number, number]> = [[1, 1], [2, 1], [3, 1]];
  return (
    <Section title="혜택" right={<span className="text-[12px] text-slate-400">숫자는 넣은 값 그대로 찍혀요</span>}>
      {kind === 'price' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={LABEL}>할인 전 가격</label>
            <input inputMode="numeric" value={f.before} onChange={(e) => set({ before: e.target.value })} disabled={busy} placeholder="38,000" className={FIELD} />
          </div>
          <div>
            <label className={LABEL}>판매가</label>
            <input inputMode="numeric" value={f.sale} onChange={(e) => set({ sale: e.target.value })} disabled={busy} placeholder="29,900" className={FIELD} />
          </div>
          <p className={`${NOTE} col-span-2`}>할인율은 두 가격에서 자동으로 계산해요. 할인 전 가격은 실제로 팔던 가격이어야 해요.</p>
        </div>
      )}
      {kind === 'nplus' && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {NPLUS.map(([n, m]) => (
              <button key={`${n}+${m}`} type="button" disabled={busy} onClick={() => set({ n, m })}
                className={`h-9 px-4 rounded-lg border text-sm font-bold ${f.n === n && f.m === m ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                {n}+{m}
              </button>
            ))}
            <div className="flex items-center gap-1 text-sm text-slate-600">
              <select aria-label="사는 개수" value={f.n} disabled={busy} onChange={(e) => set({ n: Number(e.target.value) })} className="h-9 px-2 rounded-lg border border-slate-200 bg-white">
                {Array.from({ length: 9 }, (_, i) => i + 1).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
              <span>+</span>
              <select aria-label="더 주는 개수" value={f.m} disabled={busy} onChange={(e) => set({ m: Number(e.target.value) })} className="h-9 px-2 rounded-lg border border-slate-200 bg-white">
                {Array.from({ length: 9 }, (_, i) => i + 1).map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={LABEL}>1개 가격</label>
            <input inputMode="numeric" value={f.unit} onChange={(e) => set({ unit: e.target.value })} disabled={busy} placeholder="6,500" className={FIELD} />
          </div>
        </div>
      )}
      {kind === 'set' && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="grid grid-cols-[1fr_8rem] gap-2">
              <div>
                {i === 0 && <label className={LABEL}>구성 이름</label>}
                <input value={f.items[i]} onChange={(e) => { const items = [...f.items]; items[i] = e.target.value; set({ items }); }} disabled={busy} placeholder={i < 2 ? `구성 ${i + 1}` : '구성 3 (선택)'} className={FIELD} />
              </div>
              <div>
                {i === 0 && <label className={LABEL}>판매가</label>}
                <input inputMode="numeric" value={f.prices[i]} onChange={(e) => { const prices = [...f.prices]; prices[i] = e.target.value; set({ prices }); }} disabled={busy} placeholder="0" className={FIELD} />
              </div>
            </div>
          ))}
          <div>
            <label className={LABEL}>세트가</label>
            <input inputMode="numeric" value={f.setSale} onChange={(e) => set({ setSale: e.target.value })} disabled={busy} placeholder="59,000" className={FIELD} />
          </div>
          <p className={NOTE}>따로 사면 합계와 할인율은 자동으로 계산해요.</p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 mt-3">
        <div>
          <label className={LABEL}>기간 (선택)</label>
          <input value={f.period} onChange={(e) => set({ period: e.target.value })} disabled={busy} maxLength={20} placeholder="11.10 ~ 11.16" className={FIELD} />
        </div>
        <div>
          <label className={LABEL}>증정 (선택)</label>
          <input value={f.gift} onChange={(e) => set({ gift: e.target.value })} disabled={busy} maxLength={20} placeholder="미니 앰플" className={FIELD} />
        </div>
      </div>
      <div className={`mt-3 rounded-lg px-3 py-2 text-[12px] break-keep ${built?.ok ? 'bg-rose-50 text-rose-800' : 'bg-slate-50 text-slate-500'}`}>
        {built?.ok ? <>포스터에 들어갈 숫자: <b className="font-bold">{built.line}</b></> : built ? built.error : '숫자를 넣으면 포스터에 들어갈 글이 여기에 보여요.'}
      </div>
    </Section>
  );
}

/**
 * 만들기 입력 칸 — ★ 2026-11-08 C114 C(회의 합의 §C) 흰 카드 한 장 · 머리 안내 한 줄 · 칸 위 이름 · 9 · 10px 글자 0.
 *   구역 순서 = 제품 · 할인: 상품 → 혜택(할인) → 문구 → 장면 힌트(접힘) / 행사: 문구(+ 위치) → 제품(접힘) → 장면 힌트(접힘).
 *   만들기 버튼은 부르는 쪽(스튜디오 = 아래 고정 바 · 창 = ModalButton).
 */
export function StudioMakeFields({ make, disabled = false, textless = false }: { make: StudioMakeState; disabled?: boolean; textless?: boolean }) {
  const { template, texts, setTexts } = make;
  if (!template) return null;
  // ★ 2026-11-05 인앱 글 얹기 장 = 글 없는 판(글은 메시지 위에 얹는다 · 문구 칸 대신 한 줄 안내)
  if (textless) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <h3 className="text-[13px] font-bold text-slate-900 flex items-center gap-2"><PenLine className="w-4 h-4 text-violet-700" /> 글 없는 그림으로 만들어요</h3>
        <p className={`${NOTE} mt-2`}>이 장의 글은 그림 위에 따로 얹어요. 그림 아래쪽은 글이 잘 보이게 비워 둡니다.</p>
      </div>
    );
  }
  const track = studioTrackOf(template);
  const event = track === 'event';
  const discount = track === 'discount';
  const busy = disabled || !!make.busyMsg;

  const textSection = (
    <Section title={discount ? '제품명' : '문구'}>
      <div className="space-y-2.5">
        {!discount && (
          <div>
            <label className={LABEL}>작은 라벨</label>
            <input value={texts.label} onChange={(e) => setTexts({ ...texts, label: e.target.value })} disabled={busy} placeholder={event ? 'MEMBERSHIP DAY' : 'ONLINE EXCLUSIVE'} className={FIELD} />
          </div>
        )}
        <div>
          <label className={LABEL}>{discount ? '제품명 (포스터 맨 위)' : event ? '행사명' : '헤드라인'}</label>
          <input value={texts.title} onChange={(e) => setTexts({ ...texts, title: e.target.value })} disabled={busy} placeholder={discount ? '결온 앰버 세럼' : event ? '멤버십 데이' : '제품명, 시즌 한정'} className={`${FIELD} font-semibold`} />
        </div>
        {!discount && (
          <div>
            <label className={LABEL}>{event ? '안내 문구' : '부제'}</label>
            <input value={texts.subtitle} onChange={(e) => setTexts({ ...texts, subtitle: e.target.value })} disabled={busy} placeholder={event ? '행사 기간과 안내' : '한정 수량'} className={FIELD} />
          </div>
        )}
        {event && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[12px] text-slate-500">문구 위치</span>
            <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
              {([['top', '위'], ['center', '중앙'], ['bottom', '아래']] as const).map(([k, lbl]) => (
                <button type="button" key={k} disabled={busy} onClick={() => make.setTextPosition(k)} className={`h-9 px-4 text-[13px] ${make.textPosition === k ? 'bg-violet-100 text-violet-800 font-semibold' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>{lbl}</button>
              ))}
            </div>
            <span className="text-[12px] text-slate-400 break-keep">위치를 바꾸면 장면도 함께 바뀌어요</span>
          </div>
        )}
        {!event && !discount && <p className={NOTE}>가격과 할인은 할인 포스터에서 정확히 넣어요.</p>}
      </div>
    </Section>
  );

  const productBody = (
    <>
      <p className={`${NOTE} mb-3`}>배경을 지우고 원본 그대로 넣어요.</p>
      <div className="flex flex-wrap items-start gap-3">
        {make.items.map((it, i) => (
          <div key={it.key} className="relative w-20">
            <div className="w-20 h-20 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden">
              {it.blob
                ? <img src={it.blob} alt={`제품 ${i + 1}`} className="w-full h-full object-contain" />
                : it.cutoutTempId
                  ? <span className="text-[11px] text-slate-400 text-center px-1 break-keep">미리보기 없음</span>
                  : <Loader2 className="w-5 h-5 text-slate-400 animate-spin" />}
            </div>
            <span className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-violet-100 border border-violet-300 text-violet-800 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
            <button type="button" onClick={() => make.removeItem(it.key)} disabled={busy} aria-label={`제품 ${i + 1} 빼기`} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-slate-300 text-slate-500 hover:text-rose-600 hover:border-rose-300 flex items-center justify-center disabled:opacity-40">
              <X className="w-3 h-3" />
            </button>
            {it.product && <div className="mt-1 text-[11px] text-slate-500 truncate">{it.product.name}</div>}
          </div>
        ))}
        {(
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => make.setPickerOpen(true)} disabled={busy || make.full} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100 text-[13px] font-semibold disabled:opacity-40">
              <ShoppingBag className="w-3.5 h-3.5" /> 몰에서
            </button>
            <button type="button" onClick={() => make.fileRef.current?.click()} disabled={busy || make.full} className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <Upload className="w-3.5 h-3.5" /> 사진
            </button>
          </div>
        )}
        <input ref={make.fileRef} type="file" accept="image/*" multiple onChange={make.onUpload} className="hidden" />
      </div>
      {make.full && <p className={`${NOTE} mt-2`}>{STUDIO_MAX_PRODUCTS}개를 다 넣었어요. 바꾸려면 하나를 빼 주세요.</p>}
      {make.items.length === 0 && !event && <p className={`${NOTE} mt-2`}>상품 없이도 만들 수 있어요. 의류는 착용컷보다 옷 단독컷이 잘 나와요.</p>}
      {make.items.length > 1 && <p className="text-[12px] leading-relaxed text-amber-700 mt-2 break-keep">여러 개를 넣으면 제품이 작아져 라벨의 아주 작은 글씨가 바뀔 수 있어요. 만든 뒤 꼭 확인해 주세요.</p>}
    </>
  );
  const count = <span className="text-[12px] font-semibold text-slate-400 tabular-nums">{make.items.length}/{STUDIO_MAX_PRODUCTS}</span>;
  const productSection = event ? (
    <details className="px-4 py-4 group" open={make.items.length > 0}>
      <summary className="list-none cursor-pointer flex items-center gap-2 text-[13px] font-bold text-slate-900">
        제품 함께 넣기 (선택) {count}
      </summary>
      <div className="mt-3">{productBody}</div>
    </details>
  ) : (
    <Section title="상품" right={count}>{productBody}</Section>
  );

  const hintSection = (
    <details className="px-4 py-4" open={!!make.hint}>
      <summary className="list-none cursor-pointer flex items-center gap-1.5 text-[13px] font-bold text-slate-900"><Wand2 className="w-3.5 h-3.5 text-violet-700" /> 장면 힌트 (선택)</summary>
      <input value={make.hint} onChange={(e) => make.setHint(e.target.value)} disabled={busy} placeholder="대리석 카운터, 은은한 램프 조명" className={`${FIELD} mt-3`} />
    </details>
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white divide-y divide-slate-100">
      <p className="px-4 py-3 text-[12px] text-slate-600 break-keep">입력한 글자가 그대로 새겨져요. 혜택과 숫자는 직접 넣어요.</p>
      {event ? (
        <>{textSection}{productSection}{hintSection}</>
      ) : (
        <>{productSection}{discount && <DiscountFieldsBlock make={make} busy={busy} />}{textSection}{hintSection}</>
      )}
      <MallProductPickerModal open={make.pickerOpen} onClose={() => make.setPickerOpen(false)} onPick={make.onPickMall} max={make.remaining} />
    </div>
  );
}
