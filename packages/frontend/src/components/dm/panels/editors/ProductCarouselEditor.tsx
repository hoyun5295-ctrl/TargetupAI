import type { ProductCarouselProps, ProductCarouselItem } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Toggle, ImageUploader, Select, ColorOverride } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';
import { useState } from 'react';
import MallProductPickerModal, { type PickedMallProduct } from '../../MallProductPickerModal';
// ★ 2026-07-14 Harold 지시 — 상품 정보 붙여넣기(이름/가격→할인/URL 블록) = 결정적 파서·크레딧 0 (이메일·DM 공용)
import { parsePastedProducts } from '../../../../utils/product-paste';

export default function ProductCarouselEditor({ props, onUpdate }: EditorProps<ProductCarouselProps>) {
  const products = props.products || [];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [matchingIdx, setMatchingIdx] = useState<number | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  // ★ 2026-07-16 M3 — 이미지 후보(네이버 쇼핑 검색, 원탭 확정 전용 — 자동 삽입 금지·오매칭 구조적 0)
  const [candIdx, setCandIdx] = useState<number | null>(null);
  const [candLoading, setCandLoading] = useState(false);
  const [candidates, setCandidates] = useState<Array<{ title: string; image: string; mallName: string }>>([]);
  const [candNote, setCandNote] = useState<string | null>(null);
  // ★ 2026-07-19: 스샷 판독 상품명이 말줄임으로 잘린 경우 — 후보의 전체 이름을 "제안"(자동 교체 금지, 원탭 확정)
  const [nameSuggest, setNameSuggest] = useState<{ idx: number; title: string } | null>(null);

  const loadCandidates = async (i: number) => {
    const nm = (products[i]?.name || '').trim();
    if (!nm || candLoading) return;
    if (candIdx === i) { setCandIdx(null); return; } // 다시 누르면 닫기
    setCandIdx(i);
    setCandidates([]);
    setCandNote(null);
    setCandLoading(true);
    try {
      const res = await fetch('/api/dm/products/image-candidates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
        // ★ 브랜드+제품명 검색 — 스샷 조립 시 캐러셀 제목=브랜드(적중률 향상)
        // ★ 2026-07-22 상품명 줄바꿈 허용 → 검색 쿼리는 줄바꿈을 공백으로 평탄화(네이버 후보 검색 깨짐 방지). 표시용 이름엔 \n 유지.
        body: JSON.stringify({ name: nm.replace(/\s+/g, ' ').trim(), brand: (props.title || '').trim() }),
      });
      const data = await res.json();
      if (data?.configured === false) {
        setCandNote('이미지 후보 검색이 아직 설정되지 않았어요. 직접 업로드하거나 연동 몰 매칭을 이용해주세요.');
      } else if (Array.isArray(data?.candidates) && data.candidates.length > 0) {
        setCandidates(data.candidates);
        setCandNote('후보를 탭하면 그 이미지로 확정돼요. 내 상품이 맞는지 확인해주세요.');
      } else {
        setCandNote('후보를 찾지 못했어요. 직접 업로드해주세요.');
      }
    } catch {
      setCandNote('후보 검색에 실패했어요. 직접 업로드해주세요.');
    } finally {
      setCandLoading(false);
    }
  };

  const applyPaste = () => {
    const parsed = parsePastedProducts(pasteText, 8);
    if (parsed.length === 0) {
      setPasteNote('상품을 찾지 못했어요. "상품명 / 가격 / 링크"를 줄로 나눠 붙여넣어 주세요.');
      return;
    }
    const items: ProductCarouselItem[] = parsed.map((p) => ({
      image_url: '',
      name: p.name,
      price: p.price || 0,
      ...(p.discount_price ? { discount_price: p.discount_price } : {}),
      link_url: p.link_url || '',
    }));
    onUpdate({ products: [...products, ...items] });
    setPasteText('');
    setPasteOpen(false);
    setPasteNote(`상품 ${items.length}개를 추가했어요. 이미지는 각 상품의 [연동 몰 매칭]으로 채울 수 있어요.`);
  };
  // 연동 몰 상품 → 슬라이드 항목 매핑 (정가=price, 할인가는 판매가<정가일 때만)
  const applyPicked = (picked: PickedMallProduct[]) => {
    const items: ProductCarouselItem[] = picked.map((p) => ({
      image_url: p.imageUrl || '',
      name: p.name,
      price: p.price,
      discount_price: p.salePrice > 0 && p.salePrice < p.price ? p.salePrice : undefined,
      link_url: p.productUrl || '',
    }));
    onUpdate({ products: [...products, ...items] });
  };
  const setItem = (i: number, patch: Partial<ProductCarouselItem>) =>
    onUpdate({ products: products.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  const move = (from: number, to: number) => { const a = [...products]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ products: a }); };
  // 상품명 → 연동 몰 정확 일치 → 이미지·정가·할인가·링크 자동 채움(빈 값만). 일치 없으면 조용히 무변경.
  const matchOne = async (i: number) => {
    const nm = (products[i]?.name || '').trim();
    if (!nm || matchingIdx !== null) return;
    setMatchingIdx(i);
    try {
      // ★ 2026-07-16 M3 — 상품 링크가 있으면 함께 전달 → 몰 상품번호 ID 확정 매칭 (이름 표기 달라도 그 상품)
      const linkParam = (products[i]?.link_url || '').trim();
      const res = await fetch(`/api/mall-products/match?name=${encodeURIComponent(nm.replace(/\s+/g, ' ').trim())}${linkParam ? `&link=${encodeURIComponent(linkParam)}` : ''}`, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      const data = await res.json();
      const p = data?.product;
      if (p) {
        const cur = products[i] || ({} as ProductCarouselItem);
        setItem(i, {
          image_url: p.imageUrl || cur.image_url || '',
          price: p.price > 0 ? p.price : cur.price,
          discount_price: (p.salePrice > 0 && p.salePrice < p.price) ? p.salePrice : cur.discount_price,
          link_url: p.productUrl || cur.link_url || '',
        });
      }
    } catch {
      // 조용히 무변경 (일치 없거나 오류)
    } finally {
      setMatchingIdx(null);
    }
  };
  return (
    <>
      <Field label="제목 (선택)"><TextInput value={props.title} onChange={(v) => onUpdate({ title: v })} placeholder="이번 주 추천 상품" /></Field>
      {/* ★ 2026-08-26 제목 크기·색(임은지 신고) — 미지정 = 현행(보통·본문색). DM SSR·이메일 렌더러 양쪽이 함께 소비한다. */}
      {props.title ? (
        <>
          <Field label="제목 크기">
            <Select
              value={props.title_size || 'md'}
              onChange={(v) => onUpdate({ title_size: v as 'sm' | 'md' | 'lg' })}
              options={[{ value: 'sm', label: '작게' }, { value: 'md', label: '보통' }, { value: 'lg', label: '크게' }]}
            />
          </Field>
          <Field label="제목 색" hint="미지정 = 본문색">
            <ColorOverride value={props.title_color} onChange={(v) => onUpdate({ title_color: v })} />
          </Field>
        </>
      ) : null}
      {/* ★ 2026-07-14 상품 이미지 맞춤(남지현 신고) — 첨부 이미지가 잘려 보이는 문제. 맞추기=전체 보이기(잘림 X). */}
      <Field label="이미지 맞춤" hint="맞추기 = 잘리지 않고 전체 보이기">
        <Select
          value={props.image_fit || 'cover'}
          onChange={(v) => onUpdate({ image_fit: v })}
          options={[{ value: 'cover', label: '채우기 (꽉 차게)' }, { value: 'contain', label: '맞추기 (전체 보이기)' }]}
        />
      </Field>
      {(props.image_fit || 'cover') === 'cover' && (
        <Field label="이미지 정렬" hint="채우기일 때 보일 위치">
          <Select
            value={props.image_focus || 'center'}
            onChange={(v) => onUpdate({ image_focus: v })}
            options={[{ value: 'top', label: '위' }, { value: 'center', label: '가운데' }, { value: 'bottom', label: '아래' }]}
          />
        </Field>
      )}
      {/* ★ 2026-07-15 이미지 높이·배경색·글씨공간 색(서수란 신고) — 미지정 = 현행(md 높이·회색 여백·흰 카드) */}
      <Field label="이미지 높이" hint="상품 이미지 크기가 제각각일 때 조정">
        <Select
          value={props.image_height || 'md'}
          onChange={(v) => onUpdate({ image_height: v as 'sm' | 'md' | 'lg' })}
          options={[{ value: 'sm', label: '작게' }, { value: 'md', label: '보통' }, { value: 'lg', label: '크게' }]}
        />
      </Field>
      <Field label="배경색" hint="맞추기 여백·섹션 배경 (미지정 = 기본, 회색 여백)">
        <ColorOverride value={props.background_color} onChange={(v) => onUpdate({ background_color: v })} />
      </Field>
      <Field label="글씨공간 색" hint="상품명·가격 카드 배경 (미지정 = 흰색)">
        <ColorOverride value={props.caption_bg_color} onChange={(v) => onUpdate({ caption_bg_color: v })} />
      </Field>
      <Field label="상품 목록">
        {/* ★ 2026-07-14 — 명시 단색(emerald-600+white). 옛 text-emerald-100+워시 배경은 흰 패널(DM 우측/아이템 카드)
            위에서 글자가 사라짐(Harold 신고 — 이메일·DM 공용 컴포넌트라 두 채널 동시 결함). 테마 경계 안전색 의무. */}
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="w-full mb-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500 bg-emerald-600 text-white text-[13px] font-semibold py-2 hover:bg-emerald-500 transition-colors"
        >
          연동 몰에서 상품 불러오기
        </button>
        {/* ★ 2026-07-14 Harold 지시 — 상품 정보 붙여넣기(크레딧 0, 붙여넣은 숫자·URL 그대로) */}
        <button
          type="button"
          onClick={() => { setPasteOpen((v) => !v); setPasteNote(null); }}
          className="w-full mb-2 inline-flex items-center justify-center gap-1.5 rounded-lg border border-sky-500 bg-sky-600 text-white text-[13px] font-semibold py-2 hover:bg-sky-500 transition-colors"
        >
          상품 정보 붙여넣기
        </button>
        {pasteOpen && (
          <div className="mb-2 space-y-1.5">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              rows={6}
              placeholder={'상품명·가격·링크를 줄로 나눠 붙여넣기\n예)\n글로우 파운데이션 30ml\n85,000원 → 15% 72,250원\nhttps://store.example.com/products/123\n\n(빈 줄로 상품 구분, 최대 8개)'}
              className="w-full text-[12px] border border-gray-300 rounded-lg px-2.5 py-2 leading-relaxed focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              onClick={applyPaste}
              disabled={!pasteText.trim()}
              className="w-full text-[12px] font-semibold text-white border border-sky-500 bg-sky-600 hover:bg-sky-500 rounded-lg py-1.5 disabled:opacity-40 transition-colors"
            >
              붙여넣은 상품 추가
            </button>
          </div>
        )}
        {pasteNote && <div className="mb-2 text-[11px] text-gray-500 leading-relaxed">{pasteNote}</div>}
        <RepeatableList
          items={products}
          addLabel="+ 상품 추가"
          onAdd={() => onUpdate({ products: [...products, { image_url: '', name: '', price: 0 }] })}
          onRemove={(i) => onUpdate({ products: products.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(it, i) => (
            <>
              <ImageUploader label="상품 이미지" value={it.image_url} onChange={(url) => setItem(i, { image_url: url })} />
              <div style={{ height: 6 }} />
              <TextArea value={it.name} onChange={(v) => setItem(i, { name: v })} placeholder="상품명 (원하는 위치에서 엔터로 줄바꿈)" rows={2} />
              <div style={{ height: 6 }} />
              <button
                type="button"
                onClick={() => matchOne(i)}
                disabled={matchingIdx !== null || !it.name?.trim()}
                className="w-full text-[12px] font-semibold text-white border border-emerald-500 bg-emerald-600 hover:bg-emerald-500 rounded-lg py-1.5 disabled:opacity-40 transition-colors"
              >
                {matchingIdx === i ? '몰에서 찾는 중...' : '연동 몰에서 이미지 자동 채우기'}
              </button>
              <div style={{ height: 6 }} />
              {/* ★ 2026-07-16 M3 — 미연동 폴백: 이미지 후보 5장 + 원탭 확정 (사용자 선택 = 확정 근거) */}
              <button
                type="button"
                onClick={() => loadCandidates(i)}
                disabled={candLoading || !it.name?.trim()}
                className="w-full text-[12px] font-semibold text-sky-700 border border-sky-300 bg-sky-50 hover:bg-sky-100 rounded-lg py-1.5 disabled:opacity-40 transition-colors"
              >
                {candLoading && candIdx === i ? '후보 찾는 중...' : candIdx === i ? '이미지 후보 닫기' : '이미지 후보 보기'}
              </button>
              {candIdx === i && (
                <div className="mt-1.5">
                  {candidates.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 4 }}>
                      {candidates.map((c, ci) => (
                        <button
                          key={ci}
                          type="button"
                          title={`${c.title}${c.mallName ? ` · ${c.mallName}` : ''}`}
                          onClick={() => {
                            setItem(i, { image_url: c.image });
                            setCandIdx(null);
                            setCandNote(null);
                            // 현재 이름이 후보 전체 이름의 일부(스샷 말줄임 잘림 패턴)면 전체 이름 교체를 "제안"만 (자동 교체 금지)
                            const curName = (products[i]?.name || '').replace(/\s+/g, '');
                            const candTitle = (c.title || '').trim();
                            if (curName && candTitle && candTitle.replace(/\s+/g, '').includes(curName) && candTitle.replace(/\s+/g, '').length > curName.length) {
                              setNameSuggest({ idx: i, title: candTitle });
                            } else {
                              setNameSuggest(null);
                            }
                          }}
                          style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 0, cursor: 'pointer', flexShrink: 0, overflow: 'hidden', background: '#fff' }}
                        >
                          <img src={c.image} alt={c.title} style={{ width: 64, height: 64, objectFit: 'cover', display: 'block' }} />
                        </button>
                      ))}
                    </div>
                  )}
                  {candNote && <div className="text-[11px] text-gray-500 leading-relaxed mt-1">{candNote}</div>}
                </div>
              )}
              {/* ★ 잘린 상품명 보정 제안 — 후보 전체 이름으로 교체(사용자 확정 시에만) */}
              {nameSuggest?.idx === i && (
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => { setItem(i, { name: nameSuggest.title }); setNameSuggest(null); }}
                    style={{ border: '1px solid var(--dm-primary)', borderRadius: 6, background: 'var(--dm-bg)', color: 'var(--dm-primary)', fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}
                    title="스크린샷에서 잘린 상품명을 검색 결과의 전체 이름으로 바꿉니다"
                  >
                    상품명 전체 이름으로: “{nameSuggest.title.slice(0, 40)}{nameSuggest.title.length > 40 ? '…' : ''}”
                  </button>
                  <button
                    type="button"
                    onClick={() => setNameSuggest(null)}
                    style={{ border: '1px solid var(--dm-neutral-300)', borderRadius: 6, background: 'var(--dm-bg)', color: 'var(--dm-neutral-700)', fontSize: 11, padding: '4px 8px', cursor: 'pointer' }}
                  >
                    유지
                  </button>
                </div>
              )}
              <div style={{ height: 6 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <TextInput type="number" value={it.price} onChange={(v) => setItem(i, { price: v ? Number(v) : 0 })} placeholder="정가" />
                <TextInput type="number" value={it.discount_price} onChange={(v) => setItem(i, { discount_price: v ? Number(v) : undefined })} placeholder="할인가" />
              </div>
              <div style={{ height: 6 }} />
              <TextInput type="url" value={it.link_url} onChange={(v) => setItem(i, { link_url: v })} placeholder="상품 링크 https://" />
            </>
          )}
        />
      </Field>
      {/* ★ 2026-07-21 (#4a 임은지) 상품 3개 이상이면 좌우 스와이프 슬라이드로 자동 표시(수동 넘김). 인디케이터=하단 위치 점. 자동 전환(auto_slide)은 미도입. */}
      <Field label="인디케이터" hint="상품 3개 이상이면 좌우로 넘기는 슬라이드 · 켜면 하단에 위치 점 표시"><Toggle value={props.show_indicator ?? true} onChange={(v) => onUpdate({ show_indicator: v })} /></Field>
      <MallProductPickerModal open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={applyPicked} />
    </>
  );
}
