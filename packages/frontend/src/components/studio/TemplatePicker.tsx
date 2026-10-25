/**
 * TemplatePicker — 이미지 스튜디오 템플릿 고르기 (2026-10-16 · 설계서 2026-10-16-image-studio-picker-channel §2-2)
 *
 * 스튜디오 화면(ImageStudioPage)과 DM 삽입 창(StudioInsertModal)이 같은 부품을 쓴다.
 * 옛날엔 찾는 길(트랙 → 카테고리 → 세부 칩 → 검색 → 10장 쪽)이 스튜디오 화면 안에만 있어 DM 창은 502종을 한 판에 깔았다.
 * 갤러리 상태 · 계산 · 화면은 ImageStudioPage 에서 로직 수정 없이 옮겼다.
 *
 * ⛔ 보던 쪽 유지(Harold 2026-08-11): 쪽 초기화는 카테고리 · 트랙 · 세부 · 검색어가 바뀔 때만이다.
 *   스튜디오는 이 부품을 언마운트하지 않고 hidden 감싸개로 숨긴다(감싸개에 display 클래스 금지) · 계약 테스트가 지킨다.
 * ★ 우리 업종 먼저: /templates 의 industryCategories(뷰티·의류·요식만 · 그 밖 null)를 제품 트랙 카테고리 맨 앞에 둔다.
 *   자동 진입은 창(autoOpenIndustry)에서 업종 카테고리가 하나일 때만 한다(요식 = 셋이라 카페·식당 추측 금지).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { creditText } from '../../constants/credit';
import { ShoppingBag, Sparkles, ChevronLeft, Search, X } from 'lucide-react';
import ZoneSegmented from '../zone/ZoneSegmented';
import { studioFetch } from '../../lib/studio-api';

export interface StudioTemplatePublic {
  id: string; name: string; category: string; desc: string; accent: string;
  /** ★ 2026-08-11 추천 용도 — "어떤 제품라인·행사에 쓰면 좋은가". desc가 그림이면 이쪽은 고르는 기준이다. */
  useCase?: string;
  /** ★ 2026-07-31 트랙 축 — 'product'(제품 포스터) / 'event'(행사 포스터·제품 없이 성립). 서버 미제공 시 product */
  kind?: 'product' | 'event';
  exampleUrl: string | null;
  defaultTexts: { label?: string; title?: string; subtitle?: string };
  /** 카드 목업 예시 카피(템플릿 무드별 실카피). */
  sample?: { title: string; subtitle?: string };
  /** ★ 2026-10-06 세부 카테고리(20종 이상 카테고리만 · 없으면 null) — 갤러리 걸러보기 축. */
  sub?: string | null;
}

const TPL_PAGE_SIZE = 10;
const DEFAULT_GRID = 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4';

export default function TemplatePicker({
  onPick, rootExtra, autoOpenIndustry = false, gridClassName = DEFAULT_GRID,
}: {
  onPick: (t: StudioTemplatePublic) => void;
  /** 첫 화면(카테고리 미선택 · 검색어 없음)에만 위에 붙는 것 — 스튜디오의 「내 라이브러리」 띠 */
  rootExtra?: ReactNode;
  /** 창 전용 — 업종 카테고리가 하나면 처음부터 그 카테고리 10장으로 연다 */
  autoOpenIndustry?: boolean;
  /** 격자 열 수는 화면 폭 기준이라, 좁은 창은 열을 줄여 카드를 키운다 */
  gridClassName?: string;
}) {
  // 템플릿 — 카테고리 우선 탐색(카테고리 목록 → 템플릿 목록 2단)
  const [templates, setTemplates] = useState<StudioTemplatePublic[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [industryCategories, setIndustryCategories] = useState<string[] | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  // ★ 2026-07-31 트랙 축 — 제품 포스터(누끼) / 행사 포스터(멤버십데이·오픈·시즌 행사, 제품 없이 성립)
  const [trackKind, setTrackKind] = useState<'product' | 'event'>('product');
  // ★ 2026-10-06 (Harold) 세부 카테고리 칩 · 템플릿 검색 — 502종을 카테고리 한 겹으로는 못 고른다.
  //   sub = '' 이면 카테고리 전체. 검색어가 있으면 트랙 · 카테고리와 무관하게 전부에서 찾는다.
  const [subOrder, setSubOrder] = useState<Record<string, string[]>>({});
  const [sub, setSub] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    studioFetch('/api/image-studio/templates').then(({ data }) => {
      if (!alive) return;
      const list: StudioTemplatePublic[] = Array.isArray(data?.templates) ? data.templates : [];
      const ic: string[] | null = Array.isArray(data?.industryCategories) && data.industryCategories.length ? data.industryCategories : null;
      setTemplates(list);
      setSubOrder(data?.subOrder && typeof data.subOrder === 'object' ? data.subOrder : {});
      setIndustryCategories(ic);
      if (autoOpenIndustry && ic && ic.length === 1 && list.some((t) => (t.kind || 'product') === 'product' && t.category === ic[0])) {
        setTrackKind('product');
        setCategory(ic[0]);
      }
      setLoaded(true);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 카테고리 카드 = 트랙별 · 카탈로그 순서. ★ 2026-10-16 제품 트랙은 우리 업종 카테고리를 표 순서로 맨 앞에(나머지는 그대로).
  const industryOn = trackKind === 'product' && !!industryCategories;
  const categories = useMemo(() => {
    const map = new Map<string, { count: number; accents: string[] }>();
    for (const t of templates) {
      if ((t.kind || 'product') !== trackKind) continue;
      const e = map.get(t.category) || { count: 0, accents: [] };
      e.count++;
      if (e.accents.length < 3) e.accents.push(t.accent);
      map.set(t.category, e);
    }
    const list = Array.from(map.entries()).map(([name, v]) => ({ name, ...v, mine: industryOn && industryCategories!.includes(name) }));
    if (!industryOn) return list;
    const rank = (n: string) => { const i = industryCategories!.indexOf(n); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
    return list.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c.name) - rank(b.c.name) || a.i - b.i).map((x) => x.c);
  }, [templates, trackKind, industryOn, industryCategories]);
  // 검색 — 공백을 지우고 대소문자를 무시해 이름 · 카테고리 · 세부 · 추천 용도 · 설명 · 예시 문구에서 찾는다.
  //   순서 = 카테고리 · 세부 이름이 맞는 것 → 템플릿 이름이 맞는 것 → 설명 · 용도 · 예시 문구만 맞는 것(같은 순위 안은 카탈로그 순서).
  const searchKey = query.replace(/\s+/g, '').toLowerCase();
  const searchResults = useMemo(() => {
    if (!searchKey) return [];
    const has = (s?: string | null) => (s || '').replace(/\s+/g, '').toLowerCase().includes(searchKey);
    const rank = (t: StudioTemplatePublic) => {
      if (has(t.category) || has(t.sub)) return 0;
      if (has(t.name)) return 1;
      if (has(t.useCase) || has(t.desc) || has(t.sample?.title) || has(t.sample?.subtitle)) return 2;
      return -1;
    };
    return templates
      .map((t) => ({ t, r: rank(t) }))
      .filter((x) => x.r >= 0)
      .sort((a, b) => a.r - b.r)
      .map((x) => x.t);
  }, [templates, searchKey]);
  const inCategory = useMemo(
    () => (category ? templates.filter((t) => (t.kind || 'product') === trackKind && t.category === category) : []),
    [templates, category, trackKind],
  );
  // 세부 칩 = 서버가 준 순서 · 그 카테고리에 실제 있는 것만 · 맨 앞 「전체」.
  const subItems = useMemo(() => {
    const order = (category && subOrder[category]) || [];
    const items = order
      .map((s) => ({ id: s, label: s, count: inCategory.filter((t) => t.sub === s).length }))
      .filter((it) => it.count > 0);
    return items.length ? [{ id: '', label: '전체', count: inCategory.length }, ...items] : [];
  }, [category, subOrder, inCategory]);
  const visibleTemplates = useMemo(
    () => (searchKey ? searchResults : sub ? inCategory.filter((t) => t.sub === sub) : inCategory),
    [searchKey, searchResults, sub, inCategory],
  );

  // ★ 2026-08-11 갤러리 페이징 (Harold 지시) — 한 페이지 10개, 카드를 키워 예시가 실제로 보이게 한다.
  //   카탈로그가 249종이라 한 카테고리가 30종을 넘는다. 나열하면 카드를 줄여야 하고, 줄이면 예시를 못 본다.
  const [tplPage, setTplPage] = useState(1);
  const tplTotalPages = Math.max(1, Math.ceil(visibleTemplates.length / TPL_PAGE_SIZE));
  const pagedTemplates = useMemo(
    () => visibleTemplates.slice((tplPage - 1) * TPL_PAGE_SIZE, tplPage * TPL_PAGE_SIZE),
    [visibleTemplates, tplPage],
  );
  // ⛔ 페이지 초기화는 **카테고리·트랙을 바꿀 때만**이다(Harold 지시).
  //   템플릿을 골랐다가 돌아올 때 1페이지로 되돌리면, 3페이지에서 고른 사람은 매번 그 페이지를 다시 찾아가야 한다.
  //   부르는 쪽 단계 전환은 이 의존성에 없으므로 갤러리로 돌아와도 보던 페이지가 그대로 남는다.
  useEffect(() => { setTplPage(1); }, [category, trackKind, sub, searchKey]);
  // 카테고리 · 트랙을 바꾸면 세부는 「전체」로 — 다른 카테고리에 없는 세부가 남아 빈 목록이 뜨는 것을 막는다.
  useEffect(() => { setSub(''); }, [category, trackKind]);
  // 목록이 줄어 현재 페이지가 비면(예: 검색·데이터 갱신) 마지막 페이지로 당긴다 — 빈 화면 방지.
  useEffect(() => { if (tplPage > tplTotalPages) setTplPage(tplTotalPages); }, [tplPage, tplTotalPages]);

  const isRoot = !category && !searchKey;

  return (
    <div className="space-y-6">
      {isRoot && rootExtra}

      {/* ★ 2026-10-06 템플릿 검색(Harold) — 제품 · 행사 · 모든 카테고리를 한 번에 찾는다. 지우면 보던 화면으로 돌아간다. */}
      <div className="relative mb-4">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="템플릿 찾기 (예: 오픈, 립, 국물, 멤버십)"
          aria-label="템플릿 찾기"
          className="w-full h-10 pl-9 pr-9 rounded-xl border border-slate-200 bg-white text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-violet-300"
        />
        {query && (
          <button type="button" onClick={() => setQuery('')} aria-label="검색어 지우기" className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {!loaded && (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">템플릿을 불러오는 중이에요</div>
      )}

      {/* 1단계-a — 카테고리 선택 */}
      {loaded && isRoot && (
        <section>
          {/* ★ 2026-07-31 트랙 축 — 제품 포스터 / 행사 포스터 명확 분리 (Harold) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
            <button
              type="button"
              onClick={() => { setTrackKind('product'); setCategory(null); }}
              className={`rounded-2xl border p-4 text-left transition ${trackKind === 'product' ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <ShoppingBag className={`w-4 h-4 ${trackKind === 'product' ? 'text-violet-700' : 'text-slate-400'}`} />
                <span className="text-sm font-bold text-slate-900">제품 포스터</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">내 상품이 주인공: 제품 사진을 넣으면 원본 그대로 보존하고 배경·문구를 새로 그립니다.</p>
            </button>
            <button
              type="button"
              onClick={() => { setTrackKind('event'); setCategory(null); }}
              className={`rounded-2xl border p-4 text-left transition ${trackKind === 'event' ? 'border-fuchsia-300 bg-fuchsia-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Sparkles className={`w-4 h-4 ${trackKind === 'event' ? 'text-fuchsia-700' : 'text-slate-400'}`} />
                <span className="text-sm font-bold text-slate-900">행사 포스터</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">멤버십데이·오픈·시즌 행사 안내: 제품 없이 행사명과 문구만으로 완성됩니다.</p>
            </button>
          </div>
          <h2 className="text-sm font-bold text-slate-800 mb-3">{trackKind === 'event' ? '어떤 행사인가요?' : '어떤 종류의 포스터인가요?'}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {categories.map((c) => (
              <button type="button" key={c.name} onClick={() => setCategory(c.name)} className="rounded-2xl border border-slate-200 bg-white p-4 text-left hover:border-violet-300 hover:bg-slate-100 transition">
                <div className="flex gap-1.5 mb-3">
                  {c.accents.map((a, i) => (
                    <span key={i} className="w-6 h-6 rounded-lg border border-slate-200" style={{ background: a }} />
                  ))}
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-sm font-semibold text-slate-900">{c.name}</span>
                  {c.mine && <span className="px-1.5 py-px rounded-full bg-violet-100 text-violet-800 text-[10px] font-bold">우리 업종</span>}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">템플릿 {c.count}종</div>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 italic mt-3">
            {industryOn
              ? `브랜드 기본 정보의 업종 기준으로 우리 업종 카테고리를 앞에 놓았어요. 생성 1회 ${creditText('image-studio-generate')}.`
              : `카테고리를 고르면 템플릿 목록으로 이동합니다. 생성 1회 ${creditText('image-studio-generate')}.`}
          </p>
        </section>
      )}

      {/* 1단계-b — 템플릿 선택 (컴팩트 카드) */}
      {loaded && !isRoot && (
        <section>
          {searchKey ? (
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <button type="button" onClick={() => setQuery('')} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100">
                <ChevronLeft className="w-3.5 h-3.5" /> {category ? category : '카테고리'}
              </button>
              <h2 className="text-sm font-bold text-slate-800">「{query.trim()}」 검색 결과</h2>
              <span className="text-[11px] text-slate-400">총 {visibleTemplates.length}종 · 제품 · 행사 전체</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-3">
                <button type="button" onClick={() => setCategory(null)} className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-900 hover:bg-slate-100">
                  <ChevronLeft className="w-3.5 h-3.5" /> 카테고리
                </button>
                <h2 className="text-sm font-bold text-slate-800">{category}</h2>
                <span className="text-[11px] text-slate-400">총 {visibleTemplates.length}종</span>
              </div>
              {/* ★ 2026-10-06 세부 카테고리 — 누르면 그 세부만. 20종 이상 카테고리만 칩이 있다. */}
              {subItems.length > 0 && (
                <div className="mb-4">
                  <ZoneSegmented items={subItems} value={sub} onChange={setSub} ariaLabel={`${category} 세부 카테고리`} />
                </div>
              )}
            </>
          )}
          {searchKey && visibleTemplates.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              「{query.trim()}」에 맞는 템플릿이 없어요. 다른 말로 찾아보세요 (예: 오픈 · 립 · 국물 · 멤버십)
            </div>
          )}
          {/* ★ 2026-08-11 5열 × 2행 = 한 페이지 10개. 열을 줄여 카드가 커지고 예시가 실제로 읽힌다. */}
          <div className={gridClassName}>
            {pagedTemplates.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => onPick(t)}
                className="group relative rounded-2xl border border-slate-200 overflow-hidden text-left hover:border-violet-300 hover:bg-white transition bg-slate-100"
              >
                {/* ★ 2026-10-06 제품 · 행사 칩 — 검색 결과처럼 두 트랙이 섞여도 바로 구분된다. */}
                <span className={`absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm ${(t.kind || 'product') === 'event' ? 'bg-fuchsia-100 text-fuchsia-800' : 'bg-violet-100 text-violet-800'}`}>
                  {(t.kind || 'product') === 'event' ? '행사' : '제품'}
                </span>
                {t.exampleUrl ? (
                  <img src={t.exampleUrl} alt={t.name} loading="lazy" className="w-full aspect-[3/4] object-cover" />
                ) : (
                  <div className="w-full aspect-[3/4] relative flex flex-col items-center justify-end p-3" style={{ background: `linear-gradient(160deg, ${t.accent}cc, ${t.accent}55 60%, #0f172a)` }}>
                    <div className="absolute top-4 left-0 right-0 text-center space-y-1 px-3">
                      {t.defaultTexts.label ? <div className="text-[8px] tracking-[0.2em] text-slate-600 truncate">{t.defaultTexts.label.slice(0, 18)}</div> : null}
                      <div className="text-[13px] font-bold text-slate-900 leading-tight">{t.sample?.title || t.name}</div>
                      {t.sample?.subtitle ? <div className="text-[10px] text-slate-500 truncate">{t.sample.subtitle}</div> : null}
                    </div>
                    {(t.kind || 'product') === 'product' && <div className="w-9 h-12 rounded bg-slate-200 border border-slate-300 mb-4" title="상품 자리" />}
                  </div>
                )}
                <div className="p-3">
                  <div className="text-[13px] font-semibold text-slate-900 truncate">{t.name}</div>
                  {searchKey && <div className="text-[10px] text-violet-700 truncate mt-0.5">{t.category}{t.sub ? ` · ${t.sub}` : ''}</div>}
                  <div className="text-[10px] text-slate-400 truncate mt-0.5">{t.desc}</div>
                  {/* 추천 용도 — 하나씩 열어 보지 않고 고르게 하는 축(2줄까지 보여준다). */}
                  {t.useCase && (
                    <div className="mt-2 pt-2 border-t border-slate-100 text-[10px] leading-snug text-violet-800 line-clamp-2">
                      {t.useCase}
                    </div>
                  )}
                </div>
              </button>
            ))}
          </div>

          {tplTotalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                disabled={tplPage <= 1}
                onClick={() => setTplPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                이전
              </button>
              <span className="text-xs text-slate-500 tabular-nums px-1">{tplPage} / {tplTotalPages}</span>
              <button
                type="button"
                disabled={tplPage >= tplTotalPages}
                onClick={() => setTplPage((p) => Math.min(tplTotalPages, p + 1))}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                다음
              </button>
            </div>
          )}
          <p className="text-[10px] text-slate-400 italic mt-3">템플릿을 고르면 상품과 문구를 넣는 단계로 이동합니다. 돌아오면 보던 페이지{searchKey ? '와 검색 결과' : ''}가 유지됩니다.</p>
        </section>
      )}
    </div>
  );
}
