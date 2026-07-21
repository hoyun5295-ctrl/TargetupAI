/**
 * BrandBasicInfoTab — 브랜드 학습 ①기본정보 탭 (2026-07-21 통합).
 *
 * 브랜드명·상호·사업자등록번호·업태·종목·업종 = companies 컬럼 (PUT /api/dm/brand-basic-info).
 * 연락처(대표전화·고객센터·이메일)·홈페이지·주소·공식 SNS = companies.brand_kit jsonb (PUT /api/dm/brand-kit).
 * 심플·모던·시인성: 섹션 그룹 + 라벨 + 있는 것만 채우는 선택 입력. native dialog 0 (useToast).
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Building2, Phone, Share2 } from 'lucide-react';

type BasicInfo = {
  brand_name?: string; company_name?: string; business_number?: string;
  business_type?: string; business_category?: string; industry_code?: string; // 업태=business_type, 종목=business_category
};
type Contact = { phone?: string; cs_phone?: string; email?: string; website?: string; address?: string };
type Sns = { instagram?: string; youtube?: string; naver?: string; facebook?: string };

interface Props { apiBase: string; token: string; onToast: (msg: string, type?: 'success' | 'error' | 'info') => void; }

const IN = 'w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-sky-400/50';
const LB = 'text-[11px] font-semibold text-white/55 mb-1 block';

export default function BrandBasicInfoTab({ apiBase, token, onToast }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [info, setInfo] = useState<BasicInfo>({});
  const [contact, setContact] = useState<Contact>({});
  const [sns, setSns] = useState<Sns>({});
  const [industries, setIndustries] = useState<Array<{ code: string; label: string }>>([]);
  // ★ brand-kit 조회 성공 여부 — 실패 시 저장이 기존 contact/sns를 빈값으로 덮어쓰는 데이터 손실 방지(Codex High)
  const [kitOk, setKitOk] = useState(false);
  const authHeaders = useRef({ Authorization: `Bearer ${token}` }).current;

  useEffect(() => {
    (async () => {
      const [bRes, kRes, indRes] = await Promise.allSettled([
        fetch(`${apiBase}/api/dm/brand-basic-info`, { headers: authHeaders }),
        fetch(`${apiBase}/api/dm/brand-kit`, { headers: authHeaders }),
        fetch(`${apiBase}/api/dm/industry-codes`, { headers: authHeaders }),
      ]);
      try {
        if (bRes.status === 'fulfilled' && bRes.value.ok) setInfo((await bRes.value.json())?.basic_info || {});
        if (kRes.status === 'fulfilled' && kRes.value.ok) {
          const k = await kRes.value.json();
          setContact(k?.brand_kit?.contact || {});
          setSns(k?.brand_kit?.sns || {});
          setKitOk(true); // 성공적으로 불러온 경우에만 저장 시 contact/sns 전송 허용
        }
        if (indRes.status === 'fulfilled' && indRes.value.ok) {
          const ind = await indRes.value.json();
          setIndustries(Array.isArray(ind?.industries) ? ind.industries : []);
        }
      } finally { setLoading(false); }
    })();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, []);

  const save = async () => {
    setSaving(true);
    let basicSaved = false; // 부분 성공(기본정보 저장 후 연락처 요청 reject) 시 정직 표시용
    try {
      const r1 = await fetch(`${apiBase}/api/dm/brand-basic-info`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify(info),
      });
      if (!r1.ok) { onToast('기본정보 저장에 실패했어요', 'error'); return; }
      basicSaved = true;
      // ★ 연락처·SNS는 정상 로드된 경우에만 저장(로드 실패 시 빈값 덮어쓰기 방지). 서버 merge로 다른 brand_kit 필드 보존.
      if (!kitOk) {
        onToast('기본정보는 저장됐어요. (연락처·SNS는 불러오지 못해 이번엔 건너뜀 — 다시 열어 저장해주세요)', 'info');
        return;
      }
      const r2 = await fetch(`${apiBase}/api/dm/brand-kit`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders }, body: JSON.stringify({ contact, sns }),
      });
      if (!r2.ok) { onToast('기본정보는 저장됐지만 연락처·SNS 저장에 실패했어요.', 'error'); return; }
      onToast('기본정보가 저장됐어요. DM·이메일·인앱 생성이 이 정보를 참고합니다.', 'success');
    } catch (e: any) {
      // 기본정보 저장 후 연락처 요청이 reject된 경우 = 기본정보 저장 사실을 숨기지 않는다(Codex R2 #3).
      onToast(basicSaved ? '기본정보는 저장됐지만 연락처·SNS 저장 중 오류가 났어요.' : (e?.message || '저장에 실패했어요'), 'error');
    } finally { setSaving(false); }
  };

  if (loading) return <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 text-sky-300 animate-spin" /></div>;

  return (
    <div className="space-y-5">
      {/* 회사·사업자 */}
      <section className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/70"><Building2 className="w-4 h-4 text-sky-300" /> 회사·사업자 정보</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label className={LB}>브랜드명</label><input className={IN} value={info.brand_name || ''} onChange={(e) => setInfo((s) => ({ ...s, brand_name: e.target.value }))} placeholder="예: 폴라초이스" /></div>
          <div><label className={LB}>상호(법인명)</label><input className={IN} value={info.company_name || ''} onChange={(e) => setInfo((s) => ({ ...s, company_name: e.target.value }))} placeholder="예: (주)폴라초이스코리아" /></div>
          <div><label className={LB}>사업자등록번호</label><input className={IN} value={info.business_number || ''} onChange={(e) => setInfo((s) => ({ ...s, business_number: e.target.value }))} placeholder="000-00-00000" /></div>
          <div>
            <label className={LB}>업종 (문안 생성 참조)</label>
            <select className={IN + ' [&>option]:bg-slate-800'} value={info.industry_code || ''} onChange={(e) => setInfo((s) => ({ ...s, industry_code: e.target.value }))}>
              <option value="">선택 안 함</option>
              {industries.map((i) => <option key={i.code} value={i.code}>{i.label}</option>)}
            </select>
          </div>
          <div><label className={LB}>업태</label><input className={IN} value={info.business_type || ''} onChange={(e) => setInfo((s) => ({ ...s, business_type: e.target.value }))} placeholder="예: 도소매" /></div>
          <div><label className={LB}>종목</label><input className={IN} value={info.business_category || ''} onChange={(e) => setInfo((s) => ({ ...s, business_category: e.target.value }))} placeholder="예: 화장품" /></div>
        </div>
      </section>

      {/* 연락처 */}
      <section className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/70"><Phone className="w-4 h-4 text-sky-300" /> 연락처 · 주소 (DM·이메일 푸터 자동 기입)</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label className={LB}>대표전화</label><input className={IN} value={contact.phone || ''} onChange={(e) => setContact((s) => ({ ...s, phone: e.target.value }))} placeholder="02-000-0000" /></div>
          <div><label className={LB}>고객센터 번호</label><input className={IN} value={contact.cs_phone || ''} onChange={(e) => setContact((s) => ({ ...s, cs_phone: e.target.value }))} placeholder="1544-0000" /></div>
          <div><label className={LB}>이메일</label><input className={IN} value={contact.email || ''} onChange={(e) => setContact((s) => ({ ...s, email: e.target.value }))} placeholder="cs@brand.co.kr" /></div>
          <div><label className={LB}>홈페이지</label><input className={IN} value={contact.website || ''} onChange={(e) => setContact((s) => ({ ...s, website: e.target.value }))} placeholder="https://www.brand.co.kr" /></div>
          <div className="md:col-span-2"><label className={LB}>주소</label><input className={IN} value={contact.address || ''} onChange={(e) => setContact((s) => ({ ...s, address: e.target.value }))} placeholder="서울시 ..." /></div>
        </div>
      </section>

      {/* 공식 SNS */}
      <section className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-white/70"><Share2 className="w-4 h-4 text-sky-300" /> 공식 SNS <span className="text-white/35 font-normal">· 있는 것만</span></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div><label className={LB}>인스타그램</label><input className={IN} value={sns.instagram || ''} onChange={(e) => setSns((s) => ({ ...s, instagram: e.target.value }))} placeholder="https://instagram.com/..." /></div>
          <div><label className={LB}>유튜브</label><input className={IN} value={sns.youtube || ''} onChange={(e) => setSns((s) => ({ ...s, youtube: e.target.value }))} placeholder="https://youtube.com/@..." /></div>
          <div><label className={LB}>네이버</label><input className={IN} value={sns.naver || ''} onChange={(e) => setSns((s) => ({ ...s, naver: e.target.value }))} placeholder="https://blog.naver.com/..." /></div>
          <div><label className={LB}>페이스북</label><input className={IN} value={sns.facebook || ''} onChange={(e) => setSns((s) => ({ ...s, facebook: e.target.value }))} placeholder="https://facebook.com/..." /></div>
        </div>
      </section>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="px-5 py-2.5 bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-400 hover:to-indigo-400 text-white text-sm font-semibold rounded-xl shadow-lg shadow-sky-500/25 transition-all disabled:opacity-40 flex items-center gap-2">
          {saving && <Loader2 className="w-4 h-4 animate-spin" />} 기본정보 저장
        </button>
      </div>
      <div className="text-[10px] text-white/30 italic">Data source — companies(기본정보) + companies.brand_kit(연락처·SNS) · 전 채널 생성 공용 참조</div>
    </div>
  );
}
