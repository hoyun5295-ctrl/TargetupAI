// 캠페인 대행 요청 폼 — 고객사(다크)·슈퍼관리자(화이트) 공용 필드 컴포넌트 (2026-07-09 웹 폼 전환)
// 스펙: docs/superpowers/specs/2026-07-09-crm-agency-webform-redesign-design.md
// 서버 스키마(AgencyRequestParsed·buildParsedFromForm)와 필드 구조 일치 — payload는 buildAgencyPayload로 생성.
import { useEffect, useMemo, type ReactNode } from 'react';
import { Plus, Trash2, ImagePlus, X, CalendarRange, Gift, Megaphone, Package, FileText, Images, Sparkles, Loader2 } from 'lucide-react';

export interface AgencyProductRow { name: string; price: string; salePrice: string }

export interface AgencyFormValue {
  title: string;
  periodStart: string;
  periodEnd: string;
  description: string;
  benefit: string;
  channels: string[];
  budget: string;
  note: string;
  products: AgencyProductRow[];
}

export const EMPTY_AGENCY_FORM: AgencyFormValue = {
  title: '', periodStart: '', periodEnd: '', description: '', benefit: '',
  channels: [], budget: '', note: '', products: [],
};

export const AGENCY_CHANNEL_OPTIONS = ['문자', '알림톡', '모바일DM', '이메일', '인앱', '여정'];
export const AGENCY_MAX_IMAGES = 5;
export const AGENCY_MAX_IMAGE_MB = 5;

const REQUIRED: Array<[keyof AgencyFormValue & string, string]> = [
  ['title', '행사명'], ['periodStart', '행사 시작일'], ['periodEnd', '행사 종료일'],
  ['description', '행사 내용'], ['benefit', '혜택 내용'],
];

export function agencyMissingLabels(v: AgencyFormValue): string[] {
  return REQUIRED.filter(([k]) => !String(v[k] || '').trim()).map(([, label]) => label);
}

/** 서버 접수 payload(JSON) — backend buildParsedFromForm 입력 형식 */
export function buildAgencyPayload(v: AgencyFormValue) {
  return {
    title: v.title.trim(),
    periodStart: v.periodStart.trim(),
    periodEnd: v.periodEnd.trim(),
    description: v.description.trim(),
    benefit: v.benefit.trim(),
    channels: v.channels,
    budget: v.budget.trim(),
    note: v.note.trim(),
    products: v.products
      .filter((p) => p.name.trim())
      .map((p) => ({ name: p.name.trim(), price: p.price.trim(), salePrice: p.salePrice.trim() })),
  };
}

/** 이미지 자동 입력 결과를 폼에 병합 — 이미 입력된 필드는 유지(빈 필드만 채움), 상품은 이름 중복 없이 추가 */
export function mergeAnalyzedIntoForm(current: AgencyFormValue, analyzed: any): AgencyFormValue {
  const pick = (cur: string, next: any) => (cur.trim() ? cur : String(next ?? '').trim());
  const products = [...current.products];
  for (const p of (Array.isArray(analyzed?.products) ? analyzed.products : [])) {
    const name = String(p?.name || '').trim();
    if (!name || products.some((x) => x.name.trim() === name)) continue;
    products.push({
      name,
      price: p?.price != null ? String(p.price) : '',
      salePrice: p?.salePrice != null ? String(p.salePrice) : '',
    });
  }
  return {
    ...current,
    title: pick(current.title, analyzed?.title),
    periodStart: pick(current.periodStart, analyzed?.periodStart),
    periodEnd: pick(current.periodEnd, analyzed?.periodEnd),
    description: pick(current.description, analyzed?.description),
    benefit: pick(current.benefit, analyzed?.benefit),
    products,
  };
}

/** 저장된 parsed_json → 폼 값 (관리자 보정·상세 표시) */
export function parsedToFormValue(p: any): AgencyFormValue {
  return {
    title: p?.title || '',
    periodStart: p?.periodStart || '',
    periodEnd: p?.periodEnd || '',
    description: p?.description || '',
    benefit: p?.benefit || '',
    channels: Array.isArray(p?.channels) ? p.channels.map((c: any) => String(c)) : [],
    budget: p?.budget != null ? String(p.budget) : '',
    note: p?.note || '',
    products: (Array.isArray(p?.products) ? p.products : []).map((pr: any) => ({
      name: pr?.name || '', price: pr?.price != null ? String(pr.price) : '', salePrice: pr?.salePrice != null ? String(pr.salePrice) : '',
    })),
  };
}

type Theme = 'dark' | 'light';

const STYLES: Record<Theme, Record<string, string>> = {
  dark: {
    input: 'w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-violet-400/60',
    label: 'block text-[12px] font-medium text-white/60 mb-1.5',
    required: 'text-violet-300',
    section: 'bg-white/5 border border-white/10 rounded-2xl p-4',
    sectionTitle: 'text-[13px] font-semibold text-white',
    sectionIcon: 'text-violet-300',
    sectionDesc: 'text-[11px] text-white/40',
    chipOn: 'bg-violet-500/30 border-violet-400/60 text-violet-100',
    chipOff: 'bg-slate-950/60 border-white/10 text-white/50 hover:border-white/30',
    productRow: 'bg-slate-950/40 border border-white/10 rounded-xl p-2.5',
    addBtn: 'inline-flex items-center gap-1.5 text-[12px] text-violet-300 hover:text-violet-200 border border-violet-400/30 hover:bg-violet-500/10 px-3 py-1.5 rounded-lg transition-colors',
    removeBtn: 'text-white/40 hover:text-rose-300 p-1.5 rounded-lg hover:bg-white/5 shrink-0',
    dropzone: 'border border-dashed border-white/20 hover:border-violet-400/50 bg-slate-950/40 rounded-xl px-4 py-6 text-center cursor-pointer transition-colors',
    dropTitle: 'text-[13px] text-white/70',
    dropSub: 'text-[11px] text-white/35',
    thumbWrap: 'relative group border border-white/10 rounded-xl overflow-hidden',
    thumbRemove: 'absolute top-1 right-1 bg-slate-950/80 text-white/80 hover:text-rose-300 rounded-full p-1',
    hint: 'text-[11px] text-white/35',
    analyzeBtn: 'w-full inline-flex items-center justify-center gap-2 bg-gradient-to-r from-violet-500/60 to-fuchsia-500/60 hover:from-violet-500/80 hover:to-fuchsia-500/80 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors',
  },
  light: {
    input: 'w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-violet-400',
    label: 'block text-[12px] font-medium text-gray-500 mb-1.5',
    required: 'text-violet-600',
    section: 'bg-gray-50/70 border border-gray-200 rounded-2xl p-4',
    sectionTitle: 'text-[13px] font-semibold text-gray-900',
    sectionIcon: 'text-violet-600',
    sectionDesc: 'text-[11px] text-gray-400',
    chipOn: 'bg-violet-100 border-violet-400 text-violet-700',
    chipOff: 'bg-white border-gray-200 text-gray-500 hover:border-gray-300',
    productRow: 'bg-white border border-gray-200 rounded-xl p-2.5',
    addBtn: 'inline-flex items-center gap-1.5 text-[12px] text-violet-700 hover:text-violet-800 border border-violet-300 hover:bg-violet-50 px-3 py-1.5 rounded-lg transition-colors',
    removeBtn: 'text-gray-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-gray-100 shrink-0',
    dropzone: 'border border-dashed border-gray-300 hover:border-violet-400 bg-white rounded-xl px-4 py-6 text-center cursor-pointer transition-colors',
    dropTitle: 'text-[13px] text-gray-600',
    dropSub: 'text-[11px] text-gray-400',
    thumbWrap: 'relative group border border-gray-200 rounded-xl overflow-hidden',
    thumbRemove: 'absolute top-1 right-1 bg-white/90 text-gray-500 hover:text-rose-500 rounded-full p-1 shadow',
    hint: 'text-[11px] text-gray-400',
    analyzeBtn: 'w-full inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors',
  },
};

interface AgencyRequestFormProps {
  theme: Theme;
  value: AgencyFormValue;
  onChange: (v: AgencyFormValue) => void;
  disabled?: boolean;
  /** 전달 시 이미지 업로드 섹션 표시 (신규 접수/직접 설계 전용 — 보정 폼에서는 생략) */
  images?: File[];
  onImagesChange?: (files: File[]) => void;
  onImageError?: (msg: string) => void;
  /** 전달 시 이미지 섹션에 [AI로 자동 입력] 버튼 노출 — 부모가 endpoint 호출 후 mergeAnalyzedIntoForm으로 병합 */
  onAnalyzeImages?: () => void;
  analyzing?: boolean;
}

export default function AgencyRequestForm({
  theme, value, onChange, disabled, images, onImagesChange, onImageError, onAnalyzeImages, analyzing,
}: AgencyRequestFormProps) {
  const S = STYLES[theme];
  const set = (patch: Partial<AgencyFormValue>) => onChange({ ...value, ...patch });
  const dateStyle = theme === 'dark' ? { colorScheme: 'dark' as const } : undefined;

  const previews = useMemo(
    () => (images || []).map((f) => ({ key: `${f.name}-${f.size}-${f.lastModified}`, name: f.name, url: URL.createObjectURL(f) })),
    [images],
  );
  useEffect(() => () => { previews.forEach((p) => URL.revokeObjectURL(p.url)); }, [previews]);

  const addImages = (list: FileList | null) => {
    if (!list || !onImagesChange) return;
    const current = images || [];
    const next = [...current];
    for (const f of Array.from(list)) {
      if (next.length >= AGENCY_MAX_IMAGES) { onImageError?.(`이미지는 최대 ${AGENCY_MAX_IMAGES}장까지 올릴 수 있습니다.`); break; }
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { onImageError?.(`${f.name} — JPG/PNG/WebP만 가능합니다.`); continue; }
      if (f.size > AGENCY_MAX_IMAGE_MB * 1024 * 1024) { onImageError?.(`${f.name} — 장당 ${AGENCY_MAX_IMAGE_MB}MB 이하만 가능합니다.`); continue; }
      next.push(f);
    }
    onImagesChange(next);
  };

  const section = (icon: ReactNode, title: string, desc: string, body: ReactNode) => (
    <div className={S.section}>
      <div className="flex items-center gap-2 mb-0.5">
        <span className={S.sectionIcon}>{icon}</span>
        <span className={S.sectionTitle}>{title}</span>
      </div>
      <div className={`${S.sectionDesc} mb-3`}>{desc}</div>
      {body}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* 행사 이미지 — 최상단: 올리면 AI가 아래 필드 자동 입력 (2026-07-09 Harold) */}
      {onImagesChange && (
        section(<Images className="w-4 h-4" />, `행사 이미지 (선택, 최대 ${AGENCY_MAX_IMAGES}장)`,
          '행사 포스터·상품 이미지를 올리면 AI가 아래 내용을 자동으로 채워 드립니다 — 확인·수정만 하시면 됩니다.', (
          <div className="space-y-3">
            <label
              className={`${S.dropzone} block`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (!disabled && !analyzing) addImages(e.dataTransfer.files); }}
            >
              <ImagePlus className={`w-6 h-6 mx-auto mb-1.5 ${S.sectionIcon}`} />
              <div className={S.dropTitle}>클릭 또는 드래그로 이미지 추가</div>
              <div className={S.dropSub}>JPG · PNG · WebP, 장당 {AGENCY_MAX_IMAGE_MB}MB 이하</div>
              <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" disabled={disabled || analyzing}
                onChange={(e) => { addImages(e.target.files); e.target.value = ''; }} />
            </label>
            {previews.length > 0 && (
              <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                {previews.map((p, i) => (
                  <div key={p.key} className={`${S.thumbWrap} aspect-square`}>
                    <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                    <button type="button" disabled={disabled || analyzing} onClick={() => onImagesChange((images || []).filter((_, j) => j !== i))}
                      className={S.thumbRemove} aria-label="이미지 삭제">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {onAnalyzeImages && (images || []).length > 0 && (
              <button type="button" onClick={onAnalyzeImages} disabled={disabled || analyzing} className={S.analyzeBtn}>
                {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {analyzing ? '이미지 판독 중 — 잠시만 기다려주세요' : 'AI로 자동 입력 (행사명·기간·내용·혜택·상품)'}
              </button>
            )}
          </div>
        ))
      )}

      {/* 행사 정보 */}
      {section(<Megaphone className="w-4 h-4" />, '행사 정보', '어떤 행사인지 알려주시면 그대로 분석에 사용됩니다.', (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <label className={S.label}>행사명 <span className={S.required}>*</span></label>
            <input value={value.title} onChange={(e) => set({ title: e.target.value })} maxLength={200} disabled={disabled}
              placeholder="예: 7월 신제품 런칭 프로모션" className={S.input} />
          </div>
          <div>
            <label className={S.label}><span className="inline-flex items-center gap-1"><CalendarRange className="w-3.5 h-3.5" />행사 시작일 <span className={S.required}>*</span></span></label>
            <input type="date" value={value.periodStart} onChange={(e) => set({ periodStart: e.target.value })} disabled={disabled}
              className={S.input} style={dateStyle} />
          </div>
          <div>
            <label className={S.label}><span className="inline-flex items-center gap-1"><CalendarRange className="w-3.5 h-3.5" />행사 종료일 <span className={S.required}>*</span></span></label>
            <input type="date" value={value.periodEnd} onChange={(e) => set({ periodEnd: e.target.value })} disabled={disabled}
              className={S.input} style={dateStyle} />
          </div>
          <div className="md:col-span-2">
            <label className={S.label}>행사 내용 <span className={S.required}>*</span></label>
            <textarea value={value.description} onChange={(e) => set({ description: e.target.value })} rows={5} disabled={disabled}
              placeholder={'행사 내용을 자유롭게 적어주세요.\n예: 여름 신제품 3종 출시 기념, 전 구매 고객 대상 프로모션. 온라인몰과 매장 동시 진행.'}
              className={`${S.input} resize-y leading-relaxed`} />
          </div>
        </div>
      ))}

      {/* 혜택 */}
      {section(<Gift className="w-4 h-4" />, '고객 혜택', '제안서의 발송 문안은 여기 적어주신 혜택과 이미지에 보이는 내용만 사용합니다 — 없는 혜택은 만들지 않습니다.', (
        <textarea value={value.benefit} onChange={(e) => set({ benefit: e.target.value })} rows={2} disabled={disabled}
          placeholder="예: 전 구매 고객 10% 할인 + 5만원 이상 구매 시 사은품 증정" className={`${S.input} resize-y`} />
      ))}

      {/* 채널 · 예산 */}
      {section(<FileText className="w-4 h-4" />, '희망 채널 · 예산 (선택)', '비워두시면 데이터 기반으로 추천해 드립니다.', (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {AGENCY_CHANNEL_OPTIONS.map((ch) => {
              const on = value.channels.includes(ch);
              return (
                <button key={ch} type="button" disabled={disabled}
                  onClick={() => set({ channels: on ? value.channels.filter((c) => c !== ch) : [...value.channels, ch] })}
                  className={`text-[12px] px-3 py-1.5 rounded-full border transition-colors ${on ? S.chipOn : S.chipOff}`}>
                  {ch}
                </button>
              );
            })}
          </div>
          <div className="max-w-xs">
            <label className={S.label}>예산 (원)</label>
            <input value={value.budget} onChange={(e) => set({ budget: e.target.value })} disabled={disabled}
              placeholder="예: 500000" inputMode="numeric" className={S.input} />
          </div>
        </div>
      ))}

      {/* 대상 상품 */}
      {section(<Package className="w-4 h-4" />, '대상 상품 · 신제품 (선택)', '행사 대상 상품이 있으면 추가해 주세요 — 가격은 문안·제안서에 그대로 사용됩니다.', (
        <div className="space-y-2">
          {value.products.map((p, i) => (
            <div key={i} className={`${S.productRow} flex items-center gap-2 flex-wrap md:flex-nowrap`}>
              <input value={p.name} onChange={(e) => set({ products: value.products.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })}
                placeholder="상품명" disabled={disabled} className={`${S.input} md:flex-1`} />
              <input value={p.price} onChange={(e) => set({ products: value.products.map((x, j) => j === i ? { ...x, price: e.target.value } : x) })}
                placeholder="정가(원)" disabled={disabled} inputMode="numeric" className={`${S.input} md:w-32`} />
              <input value={p.salePrice} onChange={(e) => set({ products: value.products.map((x, j) => j === i ? { ...x, salePrice: e.target.value } : x) })}
                placeholder="할인가(원)" disabled={disabled} inputMode="numeric" className={`${S.input} md:w-32`} />
              <button type="button" disabled={disabled} onClick={() => set({ products: value.products.filter((_, j) => j !== i) })}
                className={S.removeBtn} aria-label="상품 삭제">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button type="button" disabled={disabled || value.products.length >= 30}
            onClick={() => set({ products: [...value.products, { name: '', price: '', salePrice: '' }] })} className={S.addBtn}>
            <Plus className="w-3.5 h-3.5" />상품 추가
          </button>
        </div>
      ))}

      {/* 참고사항 */}
      {section(<FileText className="w-4 h-4" />, '참고사항 (선택)', '운영팀에 전달하고 싶은 내용을 자유롭게 적어주세요.', (
        <textarea value={value.note} onChange={(e) => set({ note: e.target.value })} rows={2} disabled={disabled}
          placeholder="예: 주말 오전 발송 선호, VIP 고객 우선" className={`${S.input} resize-y`} />
      ))}
    </div>
  );
}
