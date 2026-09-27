/**
 * QuickCampaignPage — 만들기(★ 2026-09-27 만들기 개편 · 설계서 docs/2026-09-27-make-redesign-design.md §2 · 목업 (가)(나)(다) ②③)
 *
 * 입구 하나. 담당자가 가진 재료 무엇이든: 홈페이지·행사 페이지 주소(있으면 · AI 0 가드 크롤) · 사진·글 판 · 상품(연동 = 몰 후보 줄 / 미연동 = 글줄) · 브랜드 칩.
 * 하단 바 [만들기] → 크레딧 확인 창 1회(주소 읽기 재료면 도메인 실명 고지 · 감사 기록은 서버) → 서버 단계 진행 → 결과 화면(`/quick-campaign/result`).
 * 재료 계약·금액·시도 토큰은 그대로(AI 자동제작 v1 · 서버 견적 단일 출처 · attemptToken 누름마다 · 같은 재료 재시도 = 같은 토큰).
 * 신규 ENV 미개방 회사 = 옛 화면(QuickCampaignLegacyPage). native dialog 0 · 모델명 0 · 하드코딩 금액 0.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { goBackOr } from '../lib/scroll-restoration';
import { ArrowLeft, Sparkles, Loader2, Lock, Check, Smartphone, Mail, BookOpen, RotateCcw, AlertTriangle, ChevronDown, Plus, Type, ShieldCheck, ShoppingBag } from 'lucide-react';
import { OUI_PAGE, OUI_PAGE_CENTER } from '../utils/operator-ui';
import OperatorAura from '../components/operator/OperatorAura';
import { BUILD_CARD_IMAGES_MAX, BUILD_CARDS_MAX } from '../components/ai-build/BuildCardsInput';
import CatalogPagesInput from '../components/ai-build/CatalogPagesInput';
import { AI_BUILD_PRODUCTS_MAX } from '../components/ai-build/ProductPickList';
import AssetLibraryPickerModal, { type PickedAsset } from '../components/assets/AssetLibraryPickerModal';
import CreditConfirmModal from '../components/credit/CreditConfirmModal';
import { useToast } from '../components/ToastProvider';
import QuickCampaignLegacyPage from './QuickCampaignLegacyPage';
import EventCampaignModal from '../components/EventCampaignModal';
import EventCampaignResumeBar from '../components/EventCampaignResumeBar';
import {
  AddressField, BrandChip, Field, ManualProducts, MallStrip, PhotoTextBoard, ReadMaterialsCard, useMallCandidates,
  type MallCandidate, type ReadState,
} from '../components/make/MakeInputs';
import {
  buildErrorMessage, buildMaterialsPayload, clearBuildDraft, loadBuildDraft, newAttemptToken,
  saveBuildDraft, saveBuildResult,
  type BuildCardValue, type BuildChannel, type BuildImageRole, type BuildImageValue, type BuildProductValue,
} from '../utils/ai-build';
import { makeResultPath } from '../utils/make-flow';
import { MK_BTN_AI, MK_HEADER, MK_HEADER_ROW, MK_BACK, MK_TILE, MK_TITLE, MK_SUB, MK_CARD } from '../utils/make-ui';

interface ServerQuote {
  total: number;
  parts: Array<{ key: string; label: string; cost: number }>;
  gate: { ok: boolean; missing?: string[] };
  imageRoles: Array<{ url: string; role: BuildImageRole }>;
  creditEnabled: boolean;
  smtpConfigured: boolean | null;
  planLocked: boolean;
}
interface ReadResult {
  readId: string;
  host: string;
  mallDomain: boolean;
  cards: Array<{ id: string; title: string; text: string; periodRaw: string | null; imageUrl: string | null; imageWidth: number | null; imageHeight: number | null; link: string; hash: string }>;
  images: Array<{ url: string; width: number; height: number }>;
  products: Array<{ name: string; url: string; imageUrl: string; width: number | null; height: number | null }>;
  logoUrl: string | null;
  brandColor: string | null;
}
type Phase = 'idle' | 'running' | 'done';

const BOARD_ID = 'board';
const token = () => localStorage.getItem('token');
const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });
const emptyBoard = (): BuildCardValue => ({ id: BOARD_ID, title: '', text: '', link: '', licensed: true, images: [] });
const CHANNEL_NOUN: Record<BuildChannel, string> = { dm: '모바일 DM', email: '이메일', catalog: '카탈로그 DM' };

export default function QuickCampaignPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [entry] = useState(() => ({
    channel: (['email', 'catalog', 'dm'].includes(String(searchParams.get('channel'))) ? searchParams.get('channel') : null) as BuildChannel | null,
    regen: searchParams.get('regen') === '1',
  }));

  // 노출 스위치(신규 ENV) — 서버가 정한다. 미개방 = 옛 화면 그대로.
  const [flag, setFlag] = useState<'loading' | 'on' | 'off'>('loading');
  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch('/api/event-campaigns/materials/quote?images=0&has_text=1', { headers: jsonHeaders(), signal: ctrl.signal });
        const d = await r.json().catch(() => ({}));
        setFlag(r.ok && d?.auto_build_enabled === true ? 'on' : 'off');
      } catch { setFlag('off'); }
    })();
    return () => ctrl.abort();
  }, []);

  // 재료(로컬 초안 복구 = 사진·글 판 · 상품 · 카탈로그 · 채널) — 주소 읽기 결과는 10분 캐시라 복구하지 않는다
  const [restored] = useState(() => loadBuildDraft());
  const [channel, setChannel] = useState<BuildChannel>(entry.channel || restored?.channel || 'dm');
  const [isAd, setIsAd] = useState<boolean>(restored ? restored.isAd : true);
  const [board, setBoard] = useState<BuildCardValue>(() => {
    const b = restored?.cards?.find((c) => !c.readId);
    return b ? { ...b, id: BOARD_ID, text: [b.title, b.text].filter((v, i, a) => v && a.indexOf(v) === i).join('\n').trim() || b.text, title: '' } : emptyBoard();
  });
  const [products, setProducts] = useState<BuildProductValue[]>((restored?.products || []).filter((p) => p.source !== 'site'));
  const [catalogImages, setCatalogImages] = useState<BuildImageValue[]>(restored?.catalogImages || []);
  const [catalogTitle, setCatalogTitle] = useState<string>(restored?.catalogTitle || '');
  const [address, setAddress] = useState('');
  const [readState, setReadState] = useState<ReadState>({ kind: 'idle' });
  const [read, setRead] = useState<ReadResult | null>(null);
  // 지난번 주소 읽기 카드(다시 만들기 = 같은 재료) — 새로 읽기 전까지 그대로 싣는다(면허 = 지난번 "그대로 쓰기" 체크 그대로)
  const [carriedRead, setCarriedRead] = useState<BuildCardValue[]>(() => (restored?.cards || []).filter((c) => !!c.readId));
  const [offCards, setOffCards] = useState<Set<string>>(new Set());
  // 읽어 온 카드 중 "이 문구 그대로 쓰기"를 켠 것(기본 꺼짐 · 면허 = 담당자 체크 · 서버 추측 0)
  const [onCards, setOnCards] = useState<Set<string>>(new Set());
  const [offImages, setOffImages] = useState<Set<string>>(new Set());
  const [offSite, setOffSite] = useState<Set<string>>(new Set());
  const [boardOpen, setBoardOpen] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [libraryFor, setLibraryFor] = useState<'board' | 'catalog' | null>(null);
  const [brand, setBrand] = useState<{ logo?: string | null; name?: string | null; color?: string | null } | null>(null);
  const [quote, setQuote] = useState<ServerQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [regenPending, setRegenPending] = useState(entry.regen && !!restored);
  const [otherOpen, setOtherOpen] = useState(false);
  const [chanOpen, setChanOpen] = useState(false);
  const [setOpen, setSetOpen] = useState(false);
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null);
  const [resumeRefresh, setResumeRefresh] = useState(0);
  const attemptRef = useRef<string | null>(null);
  const skipPersist = useRef(true);
  const busy = phase !== 'idle';
  const isCatalog = channel === 'catalog';

  useEffect(() => { if (entry.channel || entry.regen) setSearchParams({}, { replace: true }); }, [entry.channel, entry.regen, setSearchParams]);

  // 몰 후보(연동 회사만) · 브랜드 킷(회사 설정)
  const mall = useMallCandidates(flag === 'on');
  const [mallQ, setMallQ] = useState('');
  useEffect(() => {
    if (flag !== 'on') return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch('/api/dm/brand-kit', { headers: jsonHeaders() });
        const d = await r.json().catch(() => ({}));
        const k = d?.brand_kit || {};
        if (alive) setBrand({ logo: k.logo_url || null, name: k.brand_name || k.name || null, color: k.primary_color || null });
      } catch { /* 칩만 못 그린다 */ }
    })();
    return () => { alive = false; };
  }, [flag]);

  // ── 재료 → 서버 계약 카드(주소 읽기 카드 = readId+지문 동봉 · 사진·글 판 = 첫 줄이 제목) ──
  const readCards: BuildCardValue[] = useMemo(() => {
    if (!read) return carriedRead;
    const kept = read.cards.filter((c) => !offCards.has(c.id));
    const used = new Set<string>();
    const out = kept.map((c) => {
      const imgs: BuildImageValue[] = [];
      if (c.imageUrl && !offImages.has(c.imageUrl)) { imgs.push({ url: c.imageUrl, width: c.imageWidth, height: c.imageHeight }); used.add(c.imageUrl); }
      return { id: `r${c.hash.slice(0, 10)}`, title: c.title, text: c.text, link: c.link, licensed: onCards.has(c.id), images: imgs, readId: read.readId, readHash: c.hash } as BuildCardValue;
    });
    // 페이지 사진(카드에 안 붙은 것) = 첫 카드에 채운다(카드당 상한까지)
    const extra = read.images.filter((im) => !used.has(im.url) && !offImages.has(im.url));
    if (out.length > 0) {
      for (const im of extra) {
        if (out[0].images.length >= BUILD_CARD_IMAGES_MAX) break;
        out[0].images.push({ url: im.url, width: im.width, height: im.height });
      }
    }
    return out;
  }, [read, offCards, onCards, offImages, carriedRead]);

  const boardCard: BuildCardValue | null = useMemo(() => {
    const text = board.text.trim();
    if (!text && board.images.length === 0) return null;
    const first = text.split('\n').map((l) => l.trim()).find(Boolean) || '';
    return { ...board, title: first.slice(0, 60), text };
  }, [board]);

  // 사진이 있는 판이 먼저(첫 화면 = 첫 카드 첫 사진) · 글만 있으면 읽은 카드 뒤 · 서버 상한 3장
  const cards: BuildCardValue[] = useMemo(() => {
    const list = boardCard && boardCard.images.length > 0 ? [boardCard, ...readCards] : [...readCards, ...(boardCard ? [boardCard] : [])];
    return list.slice(0, BUILD_CARDS_MAX);
  }, [boardCard, readCards]);
  const cardsCut = (readCards.length + (boardCard ? 1 : 0)) - cards.length;

  const siteProducts: BuildProductValue[] = useMemo(() => (read ? read.products.filter((p) => !offSite.has(p.imageUrl)).map((p) => ({
    key: `site:${p.imageUrl}`, source: 'site' as const, provider: null, code: null, name: p.name, price: null, salePrice: null, discountRate: null, url: p.url, imageUrl: p.imageUrl,
  })) : []), [read, offSite]);
  // 몰 연동 회사 = 몰 상품(확인한 가격)이 우선 · 홈페이지 상품(가격 없음)은 화면에도 안 보이므로 싣지 않는다
  const allProducts = useMemo(() => [...products, ...(mall.provider ? [] : siteProducts)].slice(0, AI_BUILD_PRODUCTS_MAX), [products, siteProducts, mall.provider]);
  const draftState = useMemo(() => ({ channel, isAd, cards, products: allProducts, features: null, catalogImages, catalogTitle }), [channel, isAd, cards, allProducts, catalogImages, catalogTitle]);

  const imageCount = isCatalog ? catalogImages.length : cards.reduce((a, c) => a + c.images.length, 0);
  const planLocked = !!quote?.planLocked;
  const canRun = !!quote && quote.gate.ok && !planLocked && !busy;
  const readUsed = !!read && readCards.length > 0;

  // 로컬 초안 보관(새로고침 복구) — 재료가 바뀌면 다른 시도(토큰 초기화)
  useEffect(() => {
    if (flag !== 'on') return;
    if (skipPersist.current) { skipPersist.current = false; return; }
    if (!busy) attemptRef.current = null;
    const t = setTimeout(() => saveBuildDraft({ channel, isAd, cards: [board, ...readCards], products: allProducts, features: null, catalogImages, catalogTitle }), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag, channel, isAd, board, readCards, allProducts, catalogImages, catalogTitle]);

  // 서버 견적(단일 출처) — 게이트·첫 화면 판정·요금제 잠금까지 한 번에
  const [quoteSeq, setQuoteSeq] = useState(0);
  useEffect(() => {
    if (flag !== 'on') return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const materials = buildMaterialsPayload(draftState, attemptRef.current || newAttemptToken(), 0);
        const r = await fetch('/api/event-campaigns/materials/quote', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ materials }), signal: ctrl.signal });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || d?.success === false) {
          if (d?.code === 'FEATURE_DISABLED') { setFlag('off'); return; }
          setQuote(null);
          setQuoteError(buildErrorMessage(d?.code, d?.error, '견적을 계산하지 못했어요.'));
          return;
        }
        setQuoteError(null);
        setQuote({
          total: Number(d.total) || 0,
          parts: Array.isArray(d.parts) ? d.parts : [],
          gate: d.gate && typeof d.gate === 'object' ? { ok: d.gate.ok === true, missing: Array.isArray(d.gate.missing) ? d.gate.missing : [] } : { ok: false, missing: [] },
          imageRoles: Array.isArray(d.image_roles) ? d.image_roles : [],
          creditEnabled: d.credit_enabled !== false,
          smtpConfigured: typeof d.smtp_configured === 'boolean' ? d.smtp_configured : null,
          planLocked: !!d.plan_locked,
        });
      } catch { /* 취소·네트워크 = 이전 견적 유지 */ }
    }, 350);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [flag, draftState, quoteSeq]);

  const roles = useMemo(() => new Map<string, BuildImageRole>((quote?.imageRoles || []).map((r) => [r.url, r.role])), [quote?.imageRoles]);
  const heroUrl = useMemo(() => {
    for (const [url, role] of roles) if (role === 'hero') return url;
    return cards[0]?.images[0]?.url || null;
  }, [roles, cards]);

  // 만드는 중 = 경과 초 + 이탈 확인
  useEffect(() => {
    if (!busy) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed((v) => v + 1), 1000);
    const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onLeave);
    return () => { clearInterval(t); window.removeEventListener('beforeunload', onLeave); };
  }, [busy]);

  const upload = useCallback(async (files: File[]): Promise<BuildImageValue[]> => {
    const fd = new FormData();
    files.forEach((f, i) => fd.append('images', f, f.name || `image_${i + 1}`));
    fd.append('read', '0');
    const r = await fetch('/api/event-campaigns/materials', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.success === false) throw new Error(String(d?.error || '사진을 올리지 못했어요.'));
    return (Array.isArray(d.images) ? d.images : []).map((im: any) => ({ url: String(im.url), width: im.width ?? null, height: im.height ?? null }));
  }, []);

  const addBoardFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      const got = await upload(files);
      setBoard((b) => ({ ...b, images: [...b.images, ...got.filter((g) => !b.images.some((x) => x.url === g.url))].slice(0, BUILD_CARD_IMAGES_MAX) }));
    } catch (e: any) {
      toast.error(e?.message || '사진을 올리지 못했어요.');
    } finally {
      setUploading(false);
    }
  };

  const addLibrary = (assets: PickedAsset[]) => {
    if (libraryFor === 'catalog') {
      setCatalogImages((cur) => [...cur, ...assets.filter((a) => a.url && !cur.some((im) => im.url === a.url)).map((a) => ({ url: a.url, width: null, height: null }))]);
    } else {
      setBoard((b) => {
        const room = BUILD_CARD_IMAGES_MAX - b.images.length;
        const add = assets.filter((a) => a.url && !b.images.some((im) => im.url === a.url)).slice(0, Math.max(0, room)).map((a) => ({ url: a.url, width: null, height: null }));
        if (assets.length > add.length) toast.warning(`사진은 ${BUILD_CARD_IMAGES_MAX}장까지 넣을 수 있어요.`);
        return { ...b, images: [...b.images, ...add] };
      });
    }
    setLibraryFor(null);
  };

  // 주소 읽기(S12) — AI 0 · 차감 0 · 사진은 회사 저장소 사본 · 같은 주소 10분 캐시
  const readUrl = async (url: string) => {
    if (busy || readState.kind === 'reading') return;
    setReadState({ kind: 'reading' });
    try {
      const r = await fetch('/api/event-campaigns/materials/read-url', { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ url }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.success) { setReadState({ kind: 'failed', message: d?.error || '페이지를 읽지 못했어요. 사진·글을 직접 넣어 주세요.' }); return; }
      const res = d as ReadResult;
      setRead(res);
      setCarriedRead([]);
      setOffCards(new Set()); setOnCards(new Set()); setOffImages(new Set()); setOffSite(new Set());
      const bits = [
        res.cards.length ? `행사 ${res.cards.length}` : null,
        res.images.length ? `사진 ${res.images.length}` : null,
        res.logoUrl || res.brandColor ? '로고·색' : null,
        res.products.length ? `상품 ${res.products.length}` : null,
      ].filter(Boolean);
      setReadState({ kind: 'done', summary: bits.length ? bits.join(' · ') : '읽을 재료가 적어요. 사진·글을 더 넣어 주세요.' });
      if (!board.text.trim() && board.images.length === 0) setBoardOpen(false);
    } catch (e: any) {
      setReadState({ kind: 'failed', message: e?.message || '페이지를 읽지 못했어요.' });
    }
  };

  const toggleMall = (c: MallCandidate) => {
    const key = `${c.provider}:${c.code}`;
    setProducts((cur) => {
      if (cur.some((p) => p.key === key)) return cur.filter((p) => p.key !== key);
      if (cur.length >= AI_BUILD_PRODUCTS_MAX) { toast.warning(`상품은 ${AI_BUILD_PRODUCTS_MAX}개까지 담을 수 있어요.`); return cur; }
      return [...cur, { key, source: 'mall', provider: c.provider, code: c.code, name: c.name, price: c.price || null, salePrice: c.salePrice || null, discountRate: c.discountRate || null, url: c.productUrl, imageUrl: c.imageUrl }];
    });
  };

  const run = useCallback(async () => {
    setConfirmOpen(false);
    if (!quote) return;
    const attempt = attemptRef.current || newAttemptToken();
    attemptRef.current = attempt;
    setPhase('running');
    setError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      const materials = buildMaterialsPayload(draftState, attempt, quote.total);
      const url = channel === 'email' ? '/api/email/ai/generate-sections' : '/api/dm/ai/one-shot-generate';
      const r = await fetch(url, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ materials }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.success === false) {
        const code = String(d?.code || '');
        if (code === 'QUOTE_CHANGED') setQuoteSeq((v) => v + 1);
        throw Object.assign(new Error(buildErrorMessage(code, d?.error, '완성본을 만들지 못했어요. 잠시 후 다시 시도해 주세요.')), { code });
      }
      const data = d?.data || {};
      const draftId = String(data.draft_id || '');
      if (!draftId) throw new Error('완성본은 만들었지만 초안을 찾지 못했어요. 목록에서 확인해 주세요.');
      saveBuildResult({ channel, draftId, materials: data.materials || {}, quoteTotal: quote.total, heroFallback: data.heroFallback === true, benefitStripped: Number(data.benefitStripped) || 0, createdAt: Date.now() });
      attemptRef.current = null;
      setPhase('done');
      navigate(makeResultPath(channel === 'email' ? 'email' : 'dm', draftId));
    } catch (e: any) {
      setError({ message: e?.message || '완성본을 만들지 못했어요. 잠시 후 다시 시도해 주세요.', code: String(e?.code || '') });
      setPhase('idle');
    }
  }, [quote, channel, draftState, navigate]);

  // 수정 화면 [다시 만들기] → 같은 재료 · 새 시도 토큰 · 확인은 그 화면이 이미 받았다(1회)
  useEffect(() => {
    if (!regenPending || !quote || busy) return;
    if (!quote.gate.ok || planLocked) { setRegenPending(false); return; }
    setRegenPending(false);
    attemptRef.current = newAttemptToken();
    void run();
  }, [regenPending, quote, busy, planLocked, run]);

  const resetAll = () => {
    clearBuildDraft();
    attemptRef.current = null;
    setBoard(emptyBoard()); setProducts([]); setCatalogImages([]); setCatalogTitle(''); setError(null);
    setRead(null); setCarriedRead([]); setAddress(''); setReadState({ kind: 'idle' }); setBoardOpen(true);
  };

  if (flag === 'off') return <QuickCampaignLegacyPage />;
  if (flag === 'loading') {
    return <div className={OUI_PAGE_CENTER}><Loader2 className="w-6 h-6 animate-spin text-violet-300" /></div>;
  }

  const missing = new Set(quote?.gate.missing || []);
  const gateText = !quote || quote.gate.ok ? null
    : missing.has('pages') ? '카탈로그 쪽 사진을 2장 이상 올려 주세요'
      : missing.has('text') && missing.has('hero') ? '행사 내용 40자 이상 또는 첫 화면이 될 사진 1장이 필요해요'
        : missing.has('hero') ? '첫 화면이 될 사진 1장이 필요해요(로고·세로형은 첫 화면이 되지 않아요)' : '행사 내용을 40자 이상 적어 주세요';
  const readPart = quote?.parts.find((p) => p.key === 'event-image-extract') || null;
  const genPart = quote?.parts.find((p) => p.key !== 'event-image-extract') || null;
  const mallProducts = products.filter((p) => p.source === 'mall');
  const noun = CHANNEL_NOUN[channel];
  const steps: Array<{ label: string; state: 'done' | 'now' | 'todo' }> = isCatalog
    ? [{ label: '쪽 사진 확인', state: 'done' }, { label: '쪽 순서대로 카탈로그 구성', state: 'now' }, { label: '초안 저장', state: 'todo' }]
    : [
      { label: '재료 확인', state: 'done' },
      ...(readUsed ? [{ label: '홈페이지 사진 담기', state: 'done' as const }] : []),
      ...(mallProducts.length ? [{ label: '몰 가격 다시 확인', state: 'done' as const }] : []),
      ...(readPart ? [{ label: '사진 속 글자 읽기', state: 'now' as const }] : []),
      { label: '구성과 문구 만들기', state: readPart ? 'todo' : 'now' },
      { label: '완성도 점검', state: 'todo' },
      { label: '초안 저장', state: 'todo' },
    ];
  const summaryBits = isCatalog
    ? [`쪽 ${imageCount}장`]
    : [readUsed ? `행사 ${readCards.length}` : null, `사진 ${imageCount}장`, allProducts.length ? `${mallProducts.length ? '몰 ' : ''}상품 ${allProducts.length}개` : null].filter(Boolean);
  const domainNotice = readUsed && read && !read.mallDomain;

  return (
    <div className={OUI_PAGE}>
      <OperatorAura />
      <div className={MK_HEADER}>
        <div className={`${MK_HEADER_ROW} max-w-[1280px] mx-auto`}>
          <button onClick={() => goBackOr(navigate, '/dm-builder')} className={MK_BACK} aria-label="돌아가기"><ArrowLeft className="w-5 h-5" /></button>
          <div className={`${MK_TILE} bg-gradient-to-br from-amber-400 to-fuchsia-500`}><Sparkles className="w-5 h-5 text-white" /></div>
          <div className="min-w-0">
            <h1 className={MK_TITLE}>만들기</h1>
            <p className={MK_SUB}>재료만 넣으면 모바일 DM·이메일 완성본까지</p>
          </div>
          <div className="ml-auto relative">
            <button type="button" onClick={() => setOtherOpen((v) => !v)} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-[13px] font-semibold text-white/85 hover:bg-white/10 disabled:opacity-40" aria-haspopup="menu" aria-expanded={otherOpen}>
              다른 방법으로 만들기<ChevronDown className="w-4 h-4" />
            </button>
            {otherOpen && (
              <div role="menu" className="absolute right-0 top-11 z-40 w-[260px] p-1.5 rounded-xl bg-slate-900 border border-white/10 shadow-2xl" onMouseLeave={() => setOtherOpen(false)}>
                {[
                  { l: '한 줄로 자동 생성', d: '만들 내용을 한 줄로 적으면 AI가 구성', to: channel === 'email' ? '/email-campaigns?other=1' : '/dm-builder?other=1' },
                  { l: '질문 몇 개로 만들기', d: '답하면 그 답으로 DM을 만들어요', to: '/dm-builder?other=onestep' },
                  { l: '이미지로 불러오기 · 저장 소재에서', d: '기획전 캡처·저장 소재로 시작', to: channel === 'email' ? '/email-campaigns?other=1' : '/dm-builder?other=1' },
                  { l: '블록으로 직접 만들기', d: '빈 화면에서 블록을 골라 쌓아요', to: channel === 'email' ? '/email-campaigns?other=blank' : '/dm-builder?other=blocks' },
                ].map((it) => (
                  <button key={it.l} type="button" role="menuitem" onClick={() => { setOtherOpen(false); navigate(it.to); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[0.07]">
                    <div className="text-[13px] font-semibold text-white">{it.l}</div>
                    <div className="text-[11.5px] text-white/45">{it.d}</div>
                  </button>
                ))}
                <div className="h-px bg-white/10 my-1" />
                <button type="button" role="menuitem" onClick={() => { setOtherOpen(false); setResumeDraftId(null); setSetOpen(true); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/[0.07]">
                  <div className="text-[13px] font-semibold text-white">DM·이메일·인앱 세트 한 번에</div>
                  <div className="text-[11.5px] text-white/45">옛 방식 · 세 채널을 같이 만들어요</div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-[780px] mx-auto px-4 md:px-6 pt-4 pb-32 space-y-3">
        {/* 채널 한 줄 */}
        <div className="relative flex items-center gap-2 text-[12.5px] text-white/60 flex-wrap">
          {channel === 'email' ? <Mail className="w-3.5 h-3.5 text-violet-300" /> : isCatalog ? <BookOpen className="w-3.5 h-3.5 text-violet-300" /> : <Smartphone className="w-3.5 h-3.5 text-violet-300" />}
          <span>
            {channel === 'email' ? '이메일로 만들어요 · 모바일 DM은 완성본 옆에서 한 번에 만들 수 있어요'
              : isCatalog ? '카탈로그 DM으로 만들어요 · 휴대폰은 슬라이드, PC는 책처럼 펼쳐 보여요'
                : '모바일 DM으로 만들어요 · 이메일은 완성본 옆에서 한 번에 만들 수 있어요'}
          </span>
          <button type="button" disabled={busy} onClick={() => setChanOpen((v) => !v)} className="text-violet-300 hover:text-violet-200 font-semibold disabled:opacity-40">바꾸기</button>
          {chanOpen && (
            <div className="absolute left-0 top-7 z-30 p-1 rounded-xl bg-slate-900 border border-white/10 shadow-2xl flex gap-1" onMouseLeave={() => setChanOpen(false)}>
              {([['dm', '모바일 DM', Smartphone], ['email', '이메일', Mail], ['catalog', '카탈로그 DM', BookOpen]] as const).map(([k, l, Icon]) => (
                <button key={k} type="button" onClick={() => { setChannel(k); setChanOpen(false); }} className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12.5px] font-semibold ${channel === k ? 'bg-violet-600 text-white' : 'text-white/70 hover:bg-white/10'}`}><Icon className="w-3.5 h-3.5" />{l}</button>
              ))}
            </div>
          )}
        </div>

        {planLocked && (
          <div className="rounded-xl bg-amber-500/10 border border-amber-400/30 px-4 py-3 text-[12.5px] text-amber-100 inline-flex items-center gap-2 w-full"><Lock className="w-4 h-4" /> {channel === 'email' ? '이메일은 유료 요금제에서 열려요.' : '모바일 DM 요금제에서 열려요.'}</div>
        )}

        {busy && (
          <div className={`${MK_CARD} p-5 space-y-3 border-violet-400/30`} aria-live="polite">
            <div className="text-[15px] font-bold text-white flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-violet-300" />완성본을 만들고 있어요</div>
            <ul className="space-y-2">
              {steps.map((s) => (
                <li key={s.label} className="flex items-center gap-2.5 text-[13px]">
                  {s.state === 'done' ? <Check className="w-4 h-4 text-emerald-400" /> : s.state === 'now' ? <Loader2 className="w-4 h-4 animate-spin text-violet-300" /> : <span className="w-4 h-4 inline-flex items-center justify-center"><span className="w-1.5 h-1.5 rounded-full bg-white/25" /></span>}
                  <span className={s.state === 'todo' ? 'text-white/40' : 'text-white/90 font-semibold'}>{s.label}</span>
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-white/50">보통 20~40초 걸려요 · 이 창을 닫지 말고 잠시만 기다려 주세요{elapsed >= 40 ? ' · 조금 더 걸리고 있어요' : ''}</p>
            <p className="text-[12px] text-white/55 border-t border-white/10 pt-3"><b className="text-white">완성도 점검</b>에서 첫 화면이 비었거나 구성이 모자라면 크레딧을 쓰지 않고 멈춘 뒤 <span className="text-amber-300">"이것 하나만 더 넣어 주세요"</span>를 알려 드려요.</p>
          </div>
        )}

        {isCatalog ? (
          <Field icon={<BookOpen className="w-4 h-4" />} label="카탈로그 쪽 사진" hint="올린 순서가 쪽 순서예요 · 글자 읽기나 문구 생성은 하지 않아요">
            <CatalogPagesInput value={catalogImages} onChange={setCatalogImages} title={catalogTitle} onTitleChange={setCatalogTitle} disabled={busy || planLocked} onUpload={upload} onOpenLibrary={() => setLibraryFor('catalog')} onReject={(m) => toast.warning(m)} />
            <p className="text-[11.5px] text-white/40 mt-2">쓸 사진이 없으면 <button type="button" onClick={() => navigate('/image-studio')} className="underline underline-offset-2 hover:text-white/80">이미지 스튜디오에서 만들기</button></p>
          </Field>
        ) : (<>
          <AddressField
            value={address}
            onChange={(v) => { setAddress(v); if (readState.kind !== 'reading') setReadState({ kind: 'idle' }); }}
            onRead={(u) => { void readUrl(u); }}
            state={readState}
            disabled={busy || planLocked}
            label={mall.provider ? '행사 페이지 주소' : '홈페이지·행사 페이지 주소'}
          />

          {read && (readCards.length > 0 || read.cards.length > 0 || read.images.length > 0) && (
            <ReadMaterialsCard
              cards={read.cards.map((c) => ({ id: c.id, title: c.title, text: c.text, periodRaw: c.periodRaw, included: !offCards.has(c.id), licensed: onCards.has(c.id) }))}
              images={read.images.filter((im) => !offImages.has(im.url)).concat(read.cards.filter((c) => c.imageUrl && !offImages.has(c.imageUrl) && !read.images.some((im) => im.url === c.imageUrl)).map((c) => ({ url: c.imageUrl as string, width: c.imageWidth || 0, height: c.imageHeight || 0 })))}
              heroUrl={heroUrl}
              host={read.host}
              onToggleCard={(id) => setOffCards((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })}
              onLicensed={(id, v) => setOnCards((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; })}
              onRemoveImage={(u) => setOffImages((s) => new Set(s).add(u))}
              siteProducts={mall.provider ? [] : siteProducts}
              onRemoveProduct={(k) => setOffSite((s) => new Set(s).add(k.replace(/^site:/, '')))}
              disabled={busy}
            />
          )}

          {!read && carriedRead.length > 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 flex items-center gap-3 text-[12.5px] text-white/70">
              <span className="flex-1">지난번 읽은 행사 {carriedRead.length}개를 함께 써요 · {carriedRead.map((c) => c.title || '행사').join(' · ')}</span>
              <button type="button" onClick={() => setCarriedRead([])} disabled={busy} className="text-[12px] font-semibold text-violet-300 hover:text-violet-200">빼기</button>
            </div>
          )}

          {mall.provider && (
            <MallStrip
              providerLabel={mall.provider.label}
              candidates={mall.candidates}
              loading={mall.loading}
              error={mall.error}
              selectedKeys={new Set(mallProducts.map((p) => p.key))}
              onToggle={toggleMall}
              query={mallQ}
              onQuery={setMallQ}
              onSearch={() => mall.search(mallQ)}
              count={mallProducts.length}
              disabled={busy || planLocked}
            />
          )}

          {boardOpen ? (
            <PhotoTextBoard
              images={board.images}
              roles={roles}
              onAddFiles={(f) => { void addBoardFiles(f); }}
              onRemoveImage={(u) => setBoard((b) => ({ ...b, images: b.images.filter((im) => im.url !== u) }))}
              onOpenLibrary={() => setLibraryFor('board')}
              text={board.text}
              onText={(v) => setBoard((b) => ({ ...b, text: v }))}
              licensed={board.licensed}
              onLicensed={(v) => setBoard((b) => ({ ...b, licensed: v }))}
              maxImages={BUILD_CARD_IMAGES_MAX}
              disabled={busy || planLocked}
              uploading={uploading}
              compact={!!mall.provider}
            />
          ) : (
            <button type="button" onClick={() => setBoardOpen(true)} disabled={busy} className="w-full h-11 rounded-[14px] border border-dashed border-white/20 text-[13px] text-white/60 hover:text-white hover:border-white/35 inline-flex items-center justify-center gap-2"><Plus className="w-4 h-4" />사진·글 더 넣기</button>
          )}

          {!mall.provider && mall.checked && (
            <ManualProducts products={products} onChange={setProducts} max={AI_BUILD_PRODUCTS_MAX} onNotice={(m) => toast.warning(m)} onConnect={() => navigate('/cdp-settings')} disabled={busy || planLocked} />
          )}

          {cardsCut > 0 && <p className="text-[12px] text-amber-300 px-1">행사는 {BUILD_CARDS_MAX}개까지 실려요. 뒤쪽 {cardsCut}개는 이번에 빠져요.</p>}
        </>)}

        {channel === 'email' && (
          <section className={`${MK_CARD} px-4 py-3 space-y-2`}>
            <label className="inline-flex items-center gap-2 text-[12.5px] text-white/80 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-violet-600" checked={isAd} disabled={busy} onChange={(e) => setIsAd(e.target.checked)} />
              광고 메일로 보내기 <span className="text-white/45">(보낼 때 "(광고)" 표기와 수신거부가 자동으로 붙어요)</span>
            </label>
            {quote?.smtpConfigured === false && (
              <div className="text-[12px] text-amber-200 inline-flex items-center gap-1.5 w-full"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />보내려면 회사 메일 연결이 필요해요. 만들기와 미리보기는 지금 돼요.</div>
            )}
          </section>
        )}

        <BrandChip logoUrl={brand?.logo} name={brand?.name} color={brand?.color} note="로고·브랜드 색: 회사 설정에서 가져왔어요" />

        {error && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-400/30 px-4 py-3 text-[13px] text-rose-100 flex items-start gap-2 flex-wrap">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span className="flex-1 min-w-[200px]">{error.message}</span>
            {error.code !== 'FEATURE_DISABLED' && error.code !== 'INSUFFICIENT_CREDIT' && (
              <button type="button" onClick={() => { if (canRun) void run(); }} disabled={!canRun} className="inline-flex items-center gap-1 h-8 px-3 rounded-lg text-[12px] font-semibold text-white bg-white/10 hover:bg-white/15 disabled:opacity-50"><RotateCcw className="w-3.5 h-3.5" />다시 시도</button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
          <p className="text-[10px] text-white/30 italic">Data source: 넣어 주신 재료 · 서버 견적 · 만든 초안은 {channel === 'email' ? '이메일' : '모바일 DM'} 목록에 저장돼요</p>
          <button type="button" onClick={resetAll} disabled={busy} className="inline-flex items-center gap-1 text-[11px] text-white/45 hover:text-white/80 disabled:opacity-50"><RotateCcw className="w-3 h-3" />새로 시작</button>
        </div>
        <EventCampaignResumeBar refreshKey={resumeRefresh} onResume={(id) => { setResumeDraftId(id); setSetOpen(true); }} />
      </div>

      <EventCampaignModal open={setOpen} resumeDraftId={resumeDraftId || undefined} onClose={() => { setSetOpen(false); setResumeDraftId(null); setResumeRefresh((v) => v + 1); }} />

      {/* 하단 바 — 서버 견적 한 줄 + [만들기] */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-slate-950/90 backdrop-blur">
        <div className="max-w-[780px] mx-auto px-4 md:px-6 py-3.5 flex items-center justify-between gap-3">
          <div className="min-w-0 text-[12px] text-white/55">
            {busy ? <span>재료를 잠그고 만드는 중이에요</span> : quote ? (
              <>
                <b className="block text-[14px] text-white mb-0.5">{noun} 생성 {quote.creditEnabled ? `${quote.total} 크레딧` : '(요금제 포함)'}</b>
                <span>{summaryBits.join(' · ')} · 발행 비용은 보낼 때{readPart ? ` · 사진 글자 읽기 ${readPart.cost} 포함` : ''}</span>
                {gateText && <span className="block text-amber-200 mt-0.5">{gateText}</span>}
              </>
            ) : (quoteError || '견적을 계산하는 중이에요')}
          </div>
          <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canRun} className={`${MK_BTN_AI} shrink-0`}>
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Sparkles className="w-5 h-5" />}{busy ? '만드는 중' : '만들기'}
          </button>
        </div>
      </div>

      <AssetLibraryPickerModal open={!!libraryFor} onClose={() => setLibraryFor(null)} onPick={(a) => addLibrary([a])} multiSelect onPickMany={addLibrary} />
      <CreditConfirmModal
        open={confirmOpen}
        source={channel === 'email' ? 'email-ai-generate' : isCatalog ? 'catalog-dm-build' : 'dm-ai-generate'}
        costOverride={quote ? quote.total : undefined}
        description={`${noun}을 만들까요? ${summaryBits.join(' · ')}. 완성본은 결과 화면에 바로 열리고 목록에 저장돼요. 보내는 비용은 보낼 때 따로예요.`}
        extraContent={domainNotice ? (
          <div className="rounded-xl border border-violet-400/40 bg-violet-500/10 px-3.5 py-3 flex gap-2.5 text-left">
            <ShieldCheck className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] font-bold text-white"><b>{read?.host}</b>의 문구·사진을 우리 회사 것으로 씁니다</div>
              <div className="text-[12px] text-white/60 mt-0.5">만들기를 누르면 이 확인이 기록돼요 · 원문과 맞는 행사 문구만 그대로 실려요</div>
            </div>
          </div>
        ) : mallProducts.length > 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 flex gap-2.5 text-left">
            <ShoppingBag className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" />
            <div><div className="text-[13px] font-bold text-white">상품 가격·링크는 몰에서 다시 확인해 실어요</div><div className="text-[12px] text-white/60 mt-0.5">품절 상품은 빼고 이유를 알려 드려요</div></div>
          </div>
        ) : board.licensed && board.text.trim() ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 flex gap-2.5 text-left">
            <Type className="w-4 h-4 text-violet-300 shrink-0 mt-0.5" />
            <div><div className="text-[13px] font-bold text-white">적어 주신 문구와 사진으로 만들어요</div><div className="text-[12px] text-white/60 mt-0.5">할인율·기간은 적어 주신 그대로만 실려요</div></div>
          </div>
        ) : undefined}
        onConfirm={run}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
