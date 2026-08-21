/**
 * BrandKitTab — 브랜드 학습 ②브랜드킷 탭 (2026-07-21 통합).
 *
 * 로고(직접 업로드만), 색(메인/강조/배경 피커), 서체(한글/영문 드롭다운 각각), 톤.
 * 자동추출 제거(Harold 지시 — 신뢰 불가). companies.brand_kit 저장(연락처·SNS는 서버 merge 보존).
 * BrandStudioCard 시각 편집 로직 계승 — 추출 카드·서체 그리드 폐기, 서체 드롭다운(brand-fonts) 신설.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { BRAND_FONT_KO_OPTIONS, BRAND_FONT_EN_OPTIONS } from '../../utils/brand-fonts';

type KitForm = {
  logo_url?: string; primary_color?: string; accent_color?: string; background_color?: string;
  font_ko?: string; font_en?: string; tone?: string;
};
interface Props { apiBase: string; token: string; onToast: (msg: string, type?: 'success' | 'error' | 'info') => void; }

const TONES = [
  { value: 'friendly', label: '친근한' }, { value: 'premium', label: '프리미엄' },
  { value: 'elegant', label: '우아한' }, { value: 'urgent', label: '긴박한(세일)' }, { value: 'playful', label: '발랄한' },
];
const IN = 'w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-sky-400/50 [&>option]:bg-slate-800';
const LB = 'text-[11px] font-semibold text-white/55 mb-1 block';

export default function BrandKitTab({ apiBase, token, onToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [form, setForm] = useState<KitForm>({});
  const logoRef = useRef<HTMLInputElement>(null);
  const authHeaders = useRef({ Authorization: `Bearer ${token}` }).current;

  useEffect(() => {
    (async () => {
      try {
        const k = await fetch(`${apiBase}/api/dm/brand-kit`, { headers: authHeaders }).then((r) => r.json()).catch(() => ({}));
        const kit = k?.brand_kit || {};
        setForm({
          logo_url: kit.logo_url || '',
          primary_color: kit.primary_color || '#4f46e5',
          accent_color: kit.accent_color || '#f59e0b',
          background_color: kit.background_color || '#ffffff',
          // normalizeBrandKit이 구키 폴백 → font_ko/en 채워져 옴
          font_ko: kit.font_ko || '',
          font_en: kit.font_en || '',
          tone: kit.tone || 'friendly',
        });
      } finally { setLoading(false); }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const uploadLogo = async (file: File) => {
    setUploadingLogo(true);
    try {
      const fd = new FormData();
      fd.append('images', file);
      const res = await fetch(`${apiBase}/api/dm/upload-image`, { method: 'POST', headers: authHeaders, body: fd });
      const data = await res.json();
      if (!res.ok || !data?.images?.[0]?.url) throw new Error(data?.error || '업로드에 실패했어요');
      setForm((f) => ({ ...f, logo_url: data.images[0].url }));
      onToast('로고를 업로드했어요. 저장하면 3채널 생성에 반영됩니다.', 'success');
    } catch (e: any) {
      onToast(e?.message || '로고 업로드에 실패했어요', 'error');
    } finally {
      setUploadingLogo(false);
      if (logoRef.current) logoRef.current.value = '';
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      // ★ Codex High — 서체를 font_family에도 미러: 에디터 캔버스·이메일·인앱 등 font_family 소비 경로가 발행 렌더와 같은 서체를 쓰게(편집=발송).
      //   스택 = 영문(라틴) + 한글. ★ Codex Medium — 클리어(로고 지우기·영문=한글과 동일)는 null로 전송(undefined면 JSON 키 누락 → 서버 merge가 기존값 보존해 안 지워짐).
      const koFont = form.font_ko || '';
      const enFont = form.font_en || '';
      const fontFamily = koFont ? (enFont ? `${enFont}, ${koFont}` : koFont) : null;
      // 연락처·SNS·기타 brand_kit 필드는 서버 merge로 보존 — 시각 필드만 전송
      const patch = {
        logo_url: form.logo_url || null,
        primary_color: form.primary_color, accent_color: form.accent_color, background_color: form.background_color,
        font_ko: koFont || null, font_en: enFont || null,
        font_family: fontFamily, // font_ko/en과 동기 — 레거시 font_family 소비 경로 정합
        tone: form.tone,
      };
      const res = await fetch(`${apiBase}/api/dm/brand-kit`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('저장에 실패했어요');
      onToast('브랜드킷이 저장됐어요. DM·이메일·인앱 생성이 이 정보를 참고합니다.', 'success');
    } catch (e: any) {
      onToast(e?.message || '저장에 실패했어요', 'error');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 text-sky-300 animate-spin" /></div>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* 색 */}
        <section className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
          <div className="text-xs font-semibold text-white/70">브랜드 색감</div>
          {([['primary_color', '메인 색'], ['accent_color', '강조 색'], ['background_color', '배경 색']] as const).map(([key, label]) => (
            <div key={key} className="flex items-center gap-2">
              <input type="color" value={(form[key] as string) || '#ffffff'} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} className="w-9 h-9 rounded-lg border border-white/10 bg-transparent cursor-pointer" aria-label={label} />
              <div className="flex-1"><div className="text-xs text-white/80">{label}</div><div className="text-[10px] text-white/40 font-mono">{form[key]}</div></div>
            </div>
          ))}
        </section>
        {/* 로고 */}
        <section className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
          <div className="text-xs font-semibold text-white/70">로고 <span className="text-white/35 font-normal">· 직접 업로드</span></div>
          <div className="h-20 bg-white border border-dashed border-white/30 rounded-xl flex items-center justify-center overflow-hidden">
            {form.logo_url ? <img src={form.logo_url} alt="브랜드 로고 미리보기" className="max-h-16 max-w-[80%] object-contain" /> : <span className="text-[11px] text-gray-400">로고 파일을 업로드하세요</span>}
          </div>
          <input ref={logoRef} type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); }} />
          <div className="flex gap-2">
            <button onClick={() => logoRef.current?.click()} disabled={uploadingLogo} className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-sky-500/20 hover:bg-sky-500/30 border border-sky-400/30 rounded-lg text-xs font-semibold text-sky-100 transition-colors disabled:opacity-40">
              {uploadingLogo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} 로고 파일 업로드
            </button>
            {form.logo_url && <button onClick={() => setForm((f) => ({ ...f, logo_url: '' }))} disabled={uploadingLogo} className="px-3 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-xs text-white/60 transition-colors disabled:opacity-40">지우기</button>}
          </div>
          <div className="text-[10px] text-white/35">JPG · PNG · WebP, 5MB 이하</div>
        </section>
      </div>

      {/* 서체 한/영 */}
      <section className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
        <div className="text-xs font-semibold text-white/70">서체 <span className="text-white/35 font-normal">· 한글·영문 각각 선택</span></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={LB}>한글 서체</label>
            <select className={IN} value={form.font_ko || ''} onChange={(e) => setForm((f) => ({ ...f, font_ko: e.target.value }))}>
              {BRAND_FONT_KO_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div>
            <label className={LB}>영문 서체</label>
            <select className={IN} value={form.font_en || ''} onChange={(e) => setForm((f) => ({ ...f, font_en: e.target.value }))}>
              {BRAND_FONT_EN_OPTIONS.map((o) => <option key={o.label} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* 톤 */}
      <section className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
        <div className="text-xs font-semibold text-white/70">브랜드 톤</div>
        <div className="flex flex-wrap gap-2">
          {TONES.map((t) => (
            <button key={t.value} onClick={() => setForm((f) => ({ ...f, tone: t.value }))} className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${form.tone === t.value ? 'bg-sky-500/30 border-sky-400/50 text-sky-100' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}>{t.label}</button>
          ))}
        </div>
      </section>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 text-white text-sm font-semibold rounded-xl shadow-lg shadow-sky-500/25 transition-all disabled:opacity-40 flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} 브랜드킷 저장
        </button>
      </div>
      <div className="text-[10px] text-white/30 italic">Data source: companies.brand_kit · 전 채널 생성 공용 참조</div>
    </div>
  );
}
