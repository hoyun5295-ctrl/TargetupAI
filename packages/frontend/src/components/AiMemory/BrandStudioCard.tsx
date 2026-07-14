/**
 * ★ 디자인 4.0 — 브랜드 학습 카드 (2026-07-14 Harold 지시)
 *
 * "브랜드를 한 번 학습시키면 DM·이메일·인앱이 전부 참고해서 생성"의 입구.
 * 저장소 신설 없음 — 검증된 companies.brand_kit(JSONB) 하나에 저장(이중 진실 차단, DDL 0):
 *   조회 GET /api/dm/brand-kit · 저장 PUT /api/dm/brand-kit · 자동 추출 POST /api/dm/brand-kit/extract
 * 문안 톤·대표 문안 학습은 아래 Brand Voice 카드가 담당(같은 페이지 — 여긴 정체성: 로고·색·서체·고객센터).
 * 1클릭 원칙: 홈페이지 링크 1개 → AI 자동 추출 → 확인 후 저장.
 */
import { useEffect, useState } from 'react';
import { Palette, Sparkles, Loader2, X, Globe, Phone, Mail, Check } from 'lucide-react';

interface BrandKitState {
  logo_url?: string;
  primary_color?: string;
  accent_color?: string;
  background_color?: string;
  font_family?: string;
  font_display?: string;
  tone?: string;
  contact?: { phone?: string; email?: string; website?: string };
}

interface BrandStudioCardProps {
  apiBase: string;
  token: string;
  onToast: (msg: string, type: 'success' | 'error' | 'info') => void;
}

const TONES: Array<{ value: string; label: string }> = [
  { value: 'friendly', label: '친근한' },
  { value: 'premium', label: '프리미엄' },
  { value: 'elegant', label: '우아한' },
  { value: 'urgent', label: '긴박한(세일)' },
  { value: 'playful', label: '발랄한' },
];

export default function BrandStudioCard({ apiBase, token, onToast }: BrandStudioCardProps) {
  const [kit, setKit] = useState<BrandKitState | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [siteUrl, setSiteUrl] = useState('');
  const [form, setForm] = useState<BrandKitState>({});

  const authHeaders = { Authorization: `Bearer ${token}` };

  const load = async () => {
    try {
      const res = await fetch(`${apiBase}/api/dm/brand-kit`, { headers: authHeaders });
      const data = await res.json();
      if (res.ok) setKit(data.brand_kit || {});
    } catch {
      // 조회 실패 = 카드 요약만 비움 (페이지 동작 영향 0)
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const openModal = () => {
    setForm({
      logo_url: kit?.logo_url || '',
      primary_color: kit?.primary_color || '#4f46e5',
      accent_color: kit?.accent_color || '#f59e0b',
      background_color: kit?.background_color || '#ffffff',
      tone: kit?.tone || 'friendly',
      contact: { phone: kit?.contact?.phone || '', email: kit?.contact?.email || '', website: kit?.contact?.website || '' },
    });
    setSiteUrl(kit?.contact?.website || '');
    setOpen(true);
  };

  const extract = async () => {
    const url = siteUrl.trim();
    if (!url) { onToast('홈페이지 주소를 입력해 주세요', 'info'); return; }
    setExtracting(true);
    try {
      const res = await fetch(`${apiBase}/api/dm/brand-kit/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '추출에 실패했어요');
      const patch = data.patch || {};
      setForm((f) => ({
        ...f,
        ...(patch.logo_url ? { logo_url: patch.logo_url } : {}),
        ...(patch.primary_color ? { primary_color: patch.primary_color } : {}),
        ...(patch.accent_color ? { accent_color: patch.accent_color } : {}),
        ...(patch.background_color ? { background_color: patch.background_color } : {}),
        contact: { ...f.contact, website: url },
      }));
      onToast('홈페이지에서 브랜드 정보를 가져왔어요. 확인 후 저장해 주세요.', 'success');
    } catch (e: any) {
      onToast(e?.message || '추출에 실패했어요', 'error');
    } finally {
      setExtracting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const patch: BrandKitState = {
        logo_url: form.logo_url || undefined,
        primary_color: form.primary_color,
        accent_color: form.accent_color,
        background_color: form.background_color,
        tone: form.tone,
        contact: {
          ...(form.contact?.phone ? { phone: form.contact.phone } : {}),
          ...(form.contact?.email ? { email: form.contact.email } : {}),
          ...(form.contact?.website ? { website: form.contact.website } : {}),
        },
      };
      const res = await fetch(`${apiBase}/api/dm/brand-kit`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(patch),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || '저장에 실패했어요');
      setKit(data.brand_kit || patch);
      setOpen(false);
      onToast('브랜드 학습이 저장됐어요. DM·이메일·인앱 생성이 이 정보를 참고합니다.', 'success');
    } catch (e: any) {
      onToast(e?.message || '저장에 실패했어요', 'error');
    } finally {
      setSaving(false);
    }
  };

  const learned = !!(kit?.primary_color || kit?.logo_url || kit?.contact?.phone);

  return (
    <>
      {/* ───────── 카드 ───────── */}
      <div className="p-4 bg-gradient-to-br from-sky-500/15 via-indigo-500/10 to-violet-500/15 border border-sky-400/25 rounded-2xl">
        <div className="flex flex-wrap items-start gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-sky-500/30">
            <Palette className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-base font-bold text-white">브랜드 학습</h2>
              <span className="text-[10px] bg-sky-500/30 text-sky-100 px-2 py-0.5 rounded-full font-medium">NEW</span>
            </div>
            <p className="text-sm text-white/80 leading-relaxed">
              로고·브랜드 색·톤·고객센터를 한 번 학습시키면 DM·이메일·인앱 메시지가 전부 이 정보를 참고해서 만들어져요.
            </p>
            {!loading && (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                {learned ? (
                  <>
                    {kit?.primary_color && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-white/70 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                        <span className="w-3 h-3 rounded-full border border-white/20" style={{ background: kit.primary_color }} />
                        브랜드 색
                      </span>
                    )}
                    {kit?.logo_url && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-white/70 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                        <Check className="w-3 h-3 text-emerald-300" /> 로고
                      </span>
                    )}
                    {kit?.contact?.phone && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-white/70 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                        <Phone className="w-3 h-3" /> 고객센터
                      </span>
                    )}
                    {kit?.tone && (
                      <span className="text-[11px] text-white/70 bg-white/5 border border-white/10 rounded-full px-2 py-0.5">
                        톤 · {TONES.find((t) => t.value === kit.tone)?.label || kit.tone}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-[11px] text-amber-200/90">아직 학습 전이에요 — 홈페이지 주소 하나면 시작돼요.</span>
                )}
              </div>
            )}
            <div className="text-[10px] text-white/30 italic mt-2">Data source — companies.brand_kit (DM·이메일·인앱 생성기 공용)</div>
          </div>
          <button
            onClick={openModal}
            className="px-4 py-2.5 bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 text-white text-sm font-semibold rounded-xl shadow-lg shadow-sky-500/25 transition-all flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            {learned ? '브랜드 학습 수정' : '브랜드 학습하기'}
          </button>
        </div>
      </div>

      {/* ───────── 모달 ───────── */}
      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm overflow-y-auto">
          <div className="relative w-full max-w-2xl bg-slate-900 border border-white/10 rounded-2xl shadow-2xl my-8">
            {(saving || extracting) && (
              <div className="absolute inset-0 z-10 bg-slate-950/80 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-8 h-8 text-sky-300 animate-spin" />
                <div className="text-sm text-white/80">{extracting ? '홈페이지에서 브랜드 정보를 읽는 중...' : '저장 중...'}</div>
                <div className="text-xs text-white/50">창을 닫지 마세요</div>
              </div>
            )}
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-sky-400 to-indigo-500 flex items-center justify-center">
                  <Palette className="w-4.5 h-4.5 text-white" />
                </div>
                <div>
                  <div className="text-sm font-bold text-white">브랜드 학습</div>
                  <div className="text-[11px] text-white/50">DM · 이메일 · 인앱 생성이 공통으로 참고합니다</div>
                </div>
              </div>
              <button onClick={() => { if (!saving && !extracting) setOpen(false); }} disabled={saving || extracting} className="p-2 hover:bg-white/10 rounded-lg transition-colors disabled:opacity-40" aria-label="닫기">
                <X className="w-4 h-4 text-white/70" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* 1클릭 자동 추출 */}
              <div className="p-4 bg-gradient-to-br from-fuchsia-500/10 via-purple-500/10 to-indigo-500/10 border border-fuchsia-400/20 rounded-xl">
                <div className="text-xs font-semibold text-fuchsia-200 mb-2 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" /> 홈페이지 주소 하나로 자동 학습
                </div>
                <div className="flex flex-col md:flex-row gap-2">
                  <input
                    value={siteUrl}
                    onChange={(e) => setSiteUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') extract(); }}
                    placeholder="https://내쇼핑몰.co.kr"
                    className="flex-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-fuchsia-400/50"
                  />
                  <button onClick={extract} disabled={extracting} className="px-4 py-2.5 bg-fuchsia-500/80 hover:bg-fuchsia-500 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-40 flex items-center justify-center gap-1.5">
                    <Sparkles className="w-4 h-4" /> AI 자동 추출
                  </button>
                </div>
              </div>

              {/* 색 · 로고 */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-white/60">브랜드 색감</div>
                  {([
                    ['primary_color', '메인 색'],
                    ['accent_color', '강조 색'],
                    ['background_color', '배경 색'],
                  ] as const).map(([key, label]) => (
                    <div key={key} className="flex items-center gap-2">
                      <input
                        type="color"
                        value={(form as any)[key] || '#ffffff'}
                        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                        className="w-9 h-9 rounded-lg border border-white/10 bg-transparent cursor-pointer"
                        aria-label={label}
                      />
                      <div className="flex-1">
                        <div className="text-xs text-white/80">{label}</div>
                        <div className="text-[10px] text-white/40 font-mono">{(form as any)[key]}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="space-y-3">
                  <div className="text-xs font-semibold text-white/60">로고</div>
                  <div className="h-20 bg-white/5 border border-dashed border-white/15 rounded-xl flex items-center justify-center overflow-hidden">
                    {form.logo_url ? (
                      <img src={form.logo_url} alt="브랜드 로고 미리보기" className="max-h-16 max-w-[80%] object-contain" />
                    ) : (
                      <span className="text-[11px] text-white/30">자동 추출 또는 주소 입력</span>
                    )}
                  </div>
                  <input
                    value={form.logo_url || ''}
                    onChange={(e) => setForm((f) => ({ ...f, logo_url: e.target.value }))}
                    placeholder="로고 이미지 주소"
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white placeholder-white/30 focus:outline-none focus:border-sky-400/50"
                  />
                </div>
              </div>

              {/* 톤 */}
              <div>
                <div className="text-xs font-semibold text-white/60 mb-2">브랜드 톤</div>
                <div className="flex flex-wrap gap-2">
                  {TONES.map((t) => (
                    <button
                      key={t.value}
                      onClick={() => setForm((f) => ({ ...f, tone: t.value }))}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                        form.tone === t.value
                          ? 'bg-sky-500/30 border-sky-400/50 text-sky-100'
                          : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="text-[10px] text-white/40 mt-1.5">문안 말투·대표 문안 학습은 아래 "Brand Voice 학습" 카드에서 이어집니다.</div>
              </div>

              {/* 고객센터 */}
              <div>
                <div className="text-xs font-semibold text-white/60 mb-2">고객센터</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg">
                    <Phone className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                    <input
                      value={form.contact?.phone || ''}
                      onChange={(e) => setForm((f) => ({ ...f, contact: { ...f.contact, phone: e.target.value } }))}
                      placeholder="1544-0000"
                      className="w-full bg-transparent text-xs text-white placeholder-white/30 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg">
                    <Mail className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                    <input
                      value={form.contact?.email || ''}
                      onChange={(e) => setForm((f) => ({ ...f, contact: { ...f.contact, email: e.target.value } }))}
                      placeholder="cs@brand.co.kr"
                      className="w-full bg-transparent text-xs text-white placeholder-white/30 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 px-3 py-2 bg-white/5 border border-white/10 rounded-lg">
                    <Globe className="w-3.5 h-3.5 text-white/40 flex-shrink-0" />
                    <input
                      value={form.contact?.website || ''}
                      onChange={(e) => setForm((f) => ({ ...f, contact: { ...f.contact, website: e.target.value } }))}
                      placeholder="https://brand.co.kr"
                      className="w-full bg-transparent text-xs text-white placeholder-white/30 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="text-[10px] text-white/40 mt-1.5">DM 매장 정보 · 이메일 푸터 · 인앱 안내에 자동으로 채워져요.</div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/10">
              <button onClick={() => setOpen(false)} disabled={saving || extracting} className="px-4 py-2 text-sm text-white/60 hover:bg-white/5 rounded-lg transition-colors disabled:opacity-40">
                취소
              </button>
              <button onClick={save} disabled={saving || extracting} className="px-5 py-2 bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 text-white text-sm font-semibold rounded-lg shadow-lg shadow-sky-500/25 transition-all disabled:opacity-40">
                브랜드 학습 저장
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
