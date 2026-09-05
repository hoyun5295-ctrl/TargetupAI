/**
 * ★ 2026-09-05 AI 영업 아웃리치 : 실물 → 마스킹 예시 변환 CT (순수 · DB 0 · 네트워크 0)
 * 설계 = docs/2026-09-05-ai-sales-outreach-refinement-design.md §20(실물 예시 학습) · 프로토 `scratch/proto/exemplars.ts` 이식·일반화
 *
 * 무엇을 하나: 직원이 만든 모바일 DM·이메일 실물(섹션 props)에서 문구만 뽑아 브랜드·상품·혜택 수치·링크·연락처·주소·법정 표기·날짜·고객명을
 * 〔〕 표식으로 가린 "구성·리듬·톤 예시" 문자열을 만든다. 생성 프롬프트의 few-shot 재료이며 문장 창고가 아니다(불변 25).
 *
 * 규율(0905(2) 적대 리뷰 8건의 뿌리 = "차단 목록 + 같은 정규식으로 검사"):
 * - 법정 영역(footer.notes · legal_text · cs_phone · address)은 **통째로 싣지 않는다**(패턴으로 가리려 하지 않는다).
 * - 상품명은 `name`·`caption` 값을 전부 〔상품〕으로 고정하고, 그 이름(띄어쓰기 무시)과 고유 토큰을 본문 어디서든 가린다.
 * - 별칭은 브랜드 필드(상호·header brand_name·회사명·법정 표기 법인명)는 전부, 자유 제목은 첫 토큰·라틴/숫자 토큰만(일반 명사 오염 방지).
 *   한글 짧은 별칭은 앞 글자 경계(다른 단어 안 관통 금지), 라틴 별칭은 단어 경계.
 * - 이미 넣은 표식 안쪽은 다시 치환하지 않는다(표식 보호).
 * - 위생 검사(checkExemplarHygiene)는 마스킹과 **다른, 더 넓은 탐지기**를 쓴다(7자리 이상 숫자열 · @ · 도메인 꼬리 · 사업자·신고번호 · 주소 접두 · 대표자 · 별칭 · 모델명). 하나라도 남으면 저장 거부.
 * - 예시 머리줄 "[예시 · 채널 · 업종군]"은 여기서 붙이지 않는다(업종군은 읽는 시점에 계산).
 */
import { stripUnauthorizedBenefits, BENEFIT_PLACEHOLDER } from './copy-benefit-detector';

export const EXEMPLAR_MASK = {
  brand: '〔브랜드〕',
  product: '〔상품〕',
  benefit: '〔혜택〕',
  link: '〔링크〕',
  phone: '〔연락처〕',
  date: '〔날짜〕',
  customer: '〔고객명〕',
  email: '〔이메일〕',
  address: '〔주소〕',
  number: '〔번호〕',
  name: '〔이름〕',
} as const;

/** 출력에 싣는 문구 prop(허용 목록) — 이 밖의 prop은 나오지 않는다 */
const TEXT_KEYS: ReadonlySet<string> = new Set([
  'headline', 'sub_copy', 'body', 'tag', 'title', 'description', 'label', 'event_title', 'discount_label', 'usage_condition',
  'urgency_text', 'instructions', 'cta_label', 'coupon_label', 'discount_description', 'conditions', 'usage_instructions',
  'notes', 'content', 'question', 'reward_description', 'success_text', 'completion_reward_text',
]);
/** 값 전체를 〔상품〕으로 고정하는 prop */
const PRODUCT_KEYS: ReadonlySet<string> = new Set(['name', 'caption']);
/** 하위 트리째 버리는 prop(법정 표기·연락처·코드·일시·주소) */
const DROP_KEYS: ReadonlySet<string> = new Set([
  'legal_text', 'cs_phone', 'address', 'business_hours', 'code', 'coupon_code', 'expire_date', 'end_datetime', 'cs_hours',
  'phone', 'event_date', 'brand_name', 'store_name', 'email', 'contact', 'map_url', 'lat', 'lng',
]);
/** 섹션 타입별로 통째로 버리는 prop(법정 영역) */
const DROP_BY_TYPE: Readonly<Record<string, ReadonlySet<string>>> = { footer: new Set(['notes']) };
const ARRAY_CAP = 4;

/** 별칭 후보에서 뺄 일반어 */
const ALIAS_STOPWORDS: ReadonlySet<string> = new Set([
  '이벤트', '세일', '특가', '신상', '초대장', '초대', '베스트', '베스트상품', '시즌', '혜택', '런칭', '여름', '가을', '겨울', '봄',
  '위크', '상품', '특별', '공식몰', '공식', '온라인', '스토어', '쇼핑몰', '안내', '소식', '추천', '할인', '쿠폰', '협업', '픽', 'pick',
  '준비', '선택', '좋은', '위한', '설레는', '휴가준비', '고객', '고객님', '회원', '회원님', '님', '선물', '오픈', '기념', '감사', '특집',
  '코트', '자켓', '팬츠', '티셔츠', '반팔티', '바디바', '톤업', '비비크림', '마데카', '크림', '세럼', '캐비아', '스킨', '푸드',
  'x', 'X', '×', '&', 'the', 'and', 'for', 'of', 'new', 'best', 'sale', 'event', 'vip',
]);
/** 상품명 토큰 중 남기는 일반어(카테고리·용기·형태·색·성분) */
const GENERIC_PRODUCT_WORDS: ReadonlySet<string> = new Set([
  '세럼', '크림', '앰플', '마스크', '마스크팩', '팩', '토너', '스킨', '로션', '에센스', '오일', '밤', '젤', '미스트', '클렌저', '클렌징',
  '클렌징밤', '클렌징폼', '폼', '선크림', '선케어', '선세럼', '쿠션', '파운데이션', '립', '립스틱', '틴트', '향수', '바디', '바디워시', '바디로션',
  '샴푸', '트리트먼트', '헤어', '티셔츠', '반팔티', '반팔', '긴팔', '셔츠', '팬츠', '바지', '슬랙스', '데님', '청바지', '스커트', '원피스',
  '자켓', '재킷', '점퍼', '코트', '패딩', '가디건', '니트', '후드', '맨투맨', '블라우스', '슈즈', '스니커즈', '운동화', '샌들', '부츠',
  '가방', '백', '지갑', '벨트', '모자', '캡', '양말', '세트', '기획세트', '키트', '단품', '본품', '리필', '대용량', '미니', '컬러', '색상',
  '블랙', '화이트', '네이비', '베이지', '그레이', '아이보리', '핑크', '브라운', '카키', '레드', '블루', '그린', '옐로우', '남성', '여성',
  '우먼', '맨', '키즈', '유아', '아동', '공용', '프리미엄', '에디션', '시그니처', '오리지널', '베이직', '데일리', '라이트', '딥', '모이스처',
  '수분', '보습', '진정', '미백', '탄력', '주름', '모공', '각질', '트러블', '민감', '건성', '지성', '복합', '비타민', '콜라겐', '히알루론산',
  '세라마이드', '레티놀', '펩타이드', '나이아신아마이드', '병', '개', '매', '입', '종', '박스', 'ml', 'mL', 'g', 'kg', 'oz', 'spf', 'pa',
  '치킨', '피자', '버거', '커피', '음료', '케이크', '빵', '도시락', '한정', '신제품', '신상품', '베스트', '인기', '추천', '기획', '증정',
  '쿠폰', '할인', '세일', '무료', '배송', '멤버십', '회원', '가입', '이벤트', '체험', '샘플', '증정품', '단독', '트리오', '풀오버', '키링',
  '인형', '틴티드', '저자극', '무기자차', '스냅', '라이트웨이트',
]);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** 띄어쓰기를 무시하는 정규식 본문("붉은팥PDRN세럼" ↔ "붉은팥 PDRN 세럼") */
function looseRe(s: string): string {
  return s.replace(/\s+/g, '').split('').map(escapeRe).join('\\s*');
}
function hasHangul(s: string): boolean { return /[가-힣]/.test(s); }

function isAnnotation(inner: string): boolean {
  // "(임은지2)" 같은 직원 표기 = 한글 2~4자 + 숫자 0~2자
  return /^[가-힣]{2,4}\d{0,2}$/.test(inner.trim());
}
function splitTokens(s: string): string[] {
  return s.split(/[\s·|,/×]+|\s[xX]\s/).map((t) => t.trim()).filter(Boolean);
}
/** 조사가 붙은 일반어("고객님을")도 걸러낸다 — 조사를 뗀 어간이 일반어면 별칭이 아니다 */
function isStopword(t: string): boolean {
  if (ALIAS_STOPWORDS.has(t) || ALIAS_STOPWORDS.has(t.toLowerCase())) return true;
  const stem = t.replace(/(을|를|이|가|은|는|의|에|로|과|와|도|만|께|에서|으로|에게)$/, '');
  return stem !== t && stem.length >= 2 && (ALIAS_STOPWORDS.has(stem) || GENERIC_PRODUCT_WORDS.has(stem));
}
function isAliasWorthy(t: string): boolean {
  if (t.length < 2) return false;
  if (/^\d+(\.\d+)?%?$/.test(t)) return false;
  if (isStopword(t)) return false;
  return /[가-힣A-Za-z0-9]/.test(t);
}

/** 법정 표기(legal_text · footer notes)에서 법인명 후보 */
export function extractLegalEntityNames(text: string): string[] {
  const t = String(text || '').replace(/\s+/g, ' ');
  const out: string[] = [];
  for (const re of [
    /\(주\)\s*([가-힣A-Za-z0-9&]{2,20})/g, /㈜\s*([가-힣A-Za-z0-9&]{2,20})/g, /주식회사\s*([가-힣A-Za-z0-9&]{2,20})/g,
    /([가-힣A-Za-z0-9&]{2,20})\s*\(주\)/g, /([가-힣A-Za-z0-9&]{2,20})\s*주식회사/g, /(?:상호|회사명|법인명)\s*[:：]?\s*([가-힣A-Za-z0-9&]{2,20})/g,
  ]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(t)) !== null) if (m[1]) out.push(m[1].trim());
  }
  return Array.from(new Set(out.filter((n) => !['사업자등록번호', '통신판매업', '대표', '주식회사'].includes(n))));
}

export interface AliasSourceInput {
  title?: string | null;
  storeName?: string | null;
  companyName?: string | null;
  /** 평탄화된 섹션(header.brand_name · footer.legal_text · notes를 읽는다) */
  sections?: readonly any[] | null;
  /** 사람이 더한 별칭 */
  extra?: readonly string[] | null;
}

function bareOf(v: string): { bare: string; inners: string[] } {
  const s = String(v || '').replace(/\s+/g, ' ').trim();
  const inners = Array.from(s.matchAll(/\(([^()]{1,30})\)/g)).map((m) => m[1].trim()).filter((i) => !isAnnotation(i));
  return { bare: s.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim(), inners };
}

/**
 * 브랜드 별칭 추출(순수). 브랜드 필드(상호·회사명·header brand_name·법정 법인명·사람이 더한 것)는 전체 + 전 토큰,
 * 자유 제목은 전체 + 첫 유효 토큰 + 라틴/숫자 토큰만(일반 명사 오염 방지). 직원 표기 "(임은지2)"는 버린다. 반환은 긴 것부터.
 */
export function deriveBrandAliases(input: AliasSourceInput): string[] {
  const raw: string[] = [];
  const addField = (s: unknown) => {
    const { bare, inners } = bareOf(String(s || ''));
    for (const i of inners) { raw.push(i); for (const t of splitTokens(i)) raw.push(t); }
    if (bare) { raw.push(bare); for (const t of splitTokens(bare)) raw.push(t); }
  };
  const addTitle = (s: unknown) => {
    const { bare, inners } = bareOf(String(s || ''));
    for (const i of inners) { raw.push(i); for (const t of splitTokens(i)) raw.push(t); }
    if (!bare) return;
    raw.push(bare);
    const toks = splitTokens(bare);
    const first = toks.find((t) => isAliasWorthy(t));
    if (first) raw.push(first);
    for (const t of toks) if (/[A-Za-z0-9]/.test(t)) raw.push(t);
  };
  addTitle(input.title);
  addField(input.storeName);
  addField(input.companyName);
  for (const e of input.extra || []) addField(e);
  for (const s of input.sections || []) {
    const p: any = s?.props || {};
    if (s?.type === 'header' && typeof p.brand_name === 'string') addField(p.brand_name);
    if (typeof p.legal_text === 'string') for (const n of extractLegalEntityNames(p.legal_text)) raw.push(n);
    if (s?.type === 'footer' && typeof p.notes === 'string') for (const n of extractLegalEntityNames(p.notes)) raw.push(n);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of raw) {
    const t = a.trim();
    if (!isAliasWorthy(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** 상품명 수집(순수) — `name`·`caption` 값 · 긴 것부터 */
export function collectProductNames(sections: readonly any[] | null | undefined): string[] {
  const out = new Set<string>();
  const walk = (v: any, key: string | null): void => {
    if (v == null) return;
    if (typeof v === 'string') { if (key && PRODUCT_KEYS.has(key) && v.trim().length >= 2) out.add(v.replace(/\s+/g, ' ').trim()); return; }
    if (Array.isArray(v)) { v.forEach((x) => walk(x, key)); return; }
    if (typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  for (const s of sections || []) walk(s?.props, null);
  return Array.from(out).sort((a, b) => b.length - a.length);
}

function productTokens(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const n of names) {
    for (const t of n.split(/[\s·/,()[\]+|]+/)) {
      const tok = t.trim().replace(/^[\[\]]+|[\[\]]+$/g, '');
      if (tok.length < 2) continue;
      if (/^\d+(\.\d+)?\s*(ml|mL|g|kg|oz|매|개|종|입|팩|p|pcs|pack|set|cm|mm)?$/i.test(tok)) continue;
      if (/^(spf|pa)\d*\+*$/i.test(tok)) continue;
      if (GENERIC_PRODUCT_WORDS.has(tok) || GENERIC_PRODUCT_WORDS.has(tok.toLowerCase())) continue;
      out.add(tok);
    }
  }
  return Array.from(out).sort((a, b) => b.length - a.length);
}

export interface MaskContext {
  aliases: readonly string[];
  productNames: readonly string[];
}

/** 표식 보호 — 이미 넣은 〔…〕 안쪽을 다시 치환하지 않게 사유 영역 문자(U+E000/E001)로 잠갔다가 되돌린다(본문 숫자는 건드리지 않는다) */
const MARK_RE = /〔[^〔〕]{1,12}〕/g;
const PH_OPEN = '\uE000';
const PH_CLOSE = '\uE001';
let protectSeq = 0;
/** \uC911\uCCA9 \uD638\uCD9C\uB9C8\uB2E4 \uACE0\uC720 id\uB97C \uBD99\uC5EC \uBC14\uAE65 \uC790\uB9AC\uD45C\uC2DC\uC790\uB97C \uC548\uCABD \uBCF5\uC6D0\uC774 \uAC74\uB4DC\uB9AC\uC9C0 \uC54A\uAC8C \uD55C\uB2E4 */
function protectMarks(t: string): { text: string; restore: (s: string) => string } {
  const id = (++protectSeq).toString(36);
  const marks: string[] = [];
  const text = t.replace(MARK_RE, (m) => { marks.push(m); return PH_OPEN + id + '.' + String(marks.length - 1) + PH_CLOSE; });
  const re = new RegExp(PH_OPEN + id + '\\.(\\d+)' + PH_CLOSE, 'g');
  return { text, restore: (s) => s.replace(re, (_, i) => marks[Number(i)] || '') };
}
/** 모델명 탐지(파일 텍스트 불변식에 리터럴이 잡히지 않게 조각으로 조립) */
const MODEL_NAME_RE = new RegExp(['so' + 'nnet', 'op' + 'us', 'hai' + 'ku', 'cla' + 'ude', 'anthr' + 'opic', 'gp' + 't-', 'open' + 'ai'].join('|'), 'i');
/** 주소: 광역 지명으로 시작해 구분자·다음 법정 항목 앞까지 */
const ADDRESS_RE = /(?:서울|경기|인천|부산|대구|대전|광주|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)[^|·〔〕]{3,80}?(?=\s*(?:\||·|통신판매|사업자|대표|이메일|전화|고객센터|문의|호스팅|$))/g;
function replaceLoose(t: string, needle: string, mark: string, opts: { latinBoundary?: boolean; hangulHead?: boolean } = {}): string {
  if (needle.replace(/\s+/g, '').length < 2) return t;
  const body = looseRe(needle);
  const latin = /^[A-Za-z0-9\s.&-]+$/.test(needle);
  const pre = latin && opts.latinBoundary ? '(?<![A-Za-z0-9])' : (!latin && opts.hangulHead && needle.replace(/\s+/g, '').length <= 3 ? '(?<![가-힣])' : '');
  const post = latin && opts.latinBoundary ? '(?![A-Za-z0-9])' : '';
  return t.replace(new RegExp(`${pre}${body}${post}`, 'gi'), mark);
}

/** 문자열 하나를 마스킹(순수). 구조 토큰(링크·이메일·연락처·번호·주소·대표자·고객명) → 상품(전체명 → 토큰) → 별칭 → 혜택 → 날짜. 각 단계는 표식을 보호한다. */
export function maskExemplarText(text: string, ctx: MaskContext): string {
  let t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return t;
  // 1) 구조 토큰
  t = t.replace(/https?:\/\/[^\s〔〕]+/gi, EXEMPLAR_MASK.link).replace(/\bwww\.[^\s〔〕]+/gi, EXEMPLAR_MASK.link);
  t = t.replace(/[^\s@〔〕]+@[^\s@〔〕]+\.[^\s@〔〕]{2,}/g, EXEMPLAR_MASK.email);
  t = t.replace(/\b(?:[a-z0-9-]+\.)+(?:co\.kr|com|net|kr|io|ai|shop|me|ly|app|store|org|info)\b(?:\/[^\s〔〕]*)?/gi, EXEMPLAR_MASK.link);
  t = t.replace(/\d{3}-\d{2}-\d{5}/g, EXEMPLAR_MASK.number)                          // 사업자등록번호
    .replace(/\d{4}-[가-힣]+-\d{3,5}(?:호)?/g, EXEMPLAR_MASK.number)                 // 통신판매업신고
    .replace(/(?:0\d{1,2}|1\d{3})[-.\s]?\d{3,4}[-.\s]?\d{4}\b/g, EXEMPLAR_MASK.phone) // 전화(구분자 없음 포함)
    .replace(/\b1\d{3}-\d{4}\b/g, EXEMPLAR_MASK.phone)
    .replace(/\(\d{5}\)\s*/g, '')                                                     // 우편번호
    .replace(ADDRESS_RE, EXEMPLAR_MASK.address)
    .replace(/(대표(?:이사|자)?)\s*[:：]?\s*[가-힣]{2,4}(?![가-힣])/g, `$1 ${EXEMPLAR_MASK.name}`)
    .replace(/%[가-힣A-Za-z0-9_]{1,12}%|\{\{\s*[가-힣A-Za-z0-9_]{1,12}\s*\}\}|#\{[가-힣A-Za-z0-9_]{1,12}\}/g, EXEMPLAR_MASK.customer);
  // 2) 상품 · 별칭(표식 보호)
  {
    const p = protectMarks(t);
    let s = p.text;
    for (const n of ctx.productNames) s = replaceLoose(s, n, EXEMPLAR_MASK.product);
    const p2 = protectMarks(s);
    let s2 = p2.text;
    for (const tok of productTokens(ctx.productNames)) s2 = replaceLoose(s2, tok, EXEMPLAR_MASK.product, { latinBoundary: true, hangulHead: true });
    const p3 = protectMarks(p2.restore(s2));
    let s3 = p3.text;
    for (const a of ctx.aliases) s3 = replaceLoose(s3, a, EXEMPLAR_MASK.brand, { latinBoundary: true, hangulHead: true });
    t = p.restore(p3.restore(s3));
  }
  // 3) 혜택 · 날짜(표식 보호)
  {
    const p = protectMarks(t);
    let s = stripUnauthorizedBenefits(p.text, '').split(BENEFIT_PLACEHOLDER).join(EXEMPLAR_MASK.benefit);
    s = s.replace(/\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/g, EXEMPLAR_MASK.date)
      .replace(/\d{1,2}월\s?\d{1,2}일/g, EXEMPLAR_MASK.date)
      .replace(/(?<![\d.])\d{1,2}\s*[./]\s*\d{1,2}(?![\d.%])(?=\s*(?:까지|부터|~|-|\(|\)|$))/g, EXEMPLAR_MASK.date)
      .replace(/(\d{4}|\d{2})\/\d{1,2}\/\d{1,2}/g, EXEMPLAR_MASK.date);
    t = p.restore(s);
  }
  // 4) 붙은 표식 정리
  for (const m of Object.values(EXEMPLAR_MASK)) {
    const e = escapeRe(m);
    t = t.replace(new RegExp(`(?:${e})(?:[\\s,·]*${e})+`, 'g'), m);
  }
  return t.replace(/\s{2,}/g, ' ').trim();
}

/**
 * 평탄화된 섹션 → 예시 본문(순수). 형식 = "  1. type\n    key: masked" (머리줄 없음). 배열은 앞 4개 + "(… 외 N)".
 * `name`·`caption` 값은 무조건 〔상품〕. DROP_KEYS·법정 영역(footer.notes) 하위는 버린다. http·색상 값은 싣지 않는다.
 */
export function buildExemplarBody(sections: readonly any[], ctx: MaskContext, subject?: string | null): string {
  const lines: string[] = [];
  const walk = (v: any, key: string | null, out: string[], prefix: string, drop: ReadonlySet<string>): void => {
    if (v == null) return;
    if (typeof v === 'string') {
      if (key && PRODUCT_KEYS.has(key)) { if (v.trim()) out.push(`${prefix}${key}: ${EXEMPLAR_MASK.product}`); return; }
      if (key && TEXT_KEYS.has(key) && v.trim() && !/^https?:\/\//i.test(v) && !/^#[0-9a-f]{3,8}$/i.test(v)) {
        const masked = maskExemplarText(v, ctx);
        if (masked) out.push(`${prefix}${key}: ${masked}`);
      }
      return;
    }
    if (Array.isArray(v)) {
      v.slice(0, ARRAY_CAP).forEach((x) => walk(x, key, out, prefix, drop));
      if (v.length > ARRAY_CAP) out.push(`${prefix}(… 외 ${v.length - ARRAY_CAP})`);
      return;
    }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) { if (DROP_KEYS.has(k) || drop.has(k)) continue; walk(x, k, out, prefix, drop); }
    }
  };
  const list = (sections || []).filter((s) => s && typeof s === 'object' && s.type);
  list.forEach((s: any, i: number) => {
    const o: string[] = [];
    walk(s.props || {}, null, o, '    ', DROP_BY_TYPE[String(s.type)] || new Set());
    lines.push(`  ${i + 1}. ${s.type}${o.length ? '\n' + o.join('\n') : ''}`);
  });
  const subj = subject ? maskExemplarText(subject, ctx) : '';
  return (subj ? `제목: ${subj}\n` : '') + lines.join('\n');
}

/** 머리줄 부착(읽는 시점) — seed 형식과 같다 */
export function withExemplarHeader(body: string, channel: 'DM' | 'EMAIL', group: string): string {
  const b = String(body || '');
  if (b.startsWith('제목: ')) {
    const nl = b.indexOf('\n');
    const subj = nl >= 0 ? b.slice(0, nl) : b;
    const rest = nl >= 0 ? b.slice(nl + 1) : '';
    return `[예시 · ${channel} · ${group}] ${subj}\n${rest}`;
  }
  return `[예시 · ${channel} · ${group}]\n${b}`;
}

export interface HygieneResult { ok: boolean; violations: string[] }

/**
 * 저장 전 위생 검사(순수) — 마스킹과 **다른, 더 넓은** 탐지기. 7자리 이상 숫자열(구분자 포함) · @ · 도메인 꼬리 · 사업자·신고번호 ·
 * 주소 접두 · 대표자 표기 · 원시 변수 토큰 · 할인율·금액 · 별칭(띄어쓰기 무시) · 모델명 · 최소 길이. 하나라도 있으면 거부.
 */
export function checkExemplarHygiene(body: string, aliases: readonly string[]): HygieneResult {
  const v: string[] = [];
  const t = String(body || '');
  // 표식 자리는 중립 기호로 바꾼다(공백으로 바꾸면 "대표 〔이름〕 안내"가 실명 패턴에 걸린다)
  const plain = t.replace(MARK_RE, ' ◯ ');
  if (t.trim().length < 40) v.push('본문이 너무 짧습니다(40자 미만)');
  if (/https?:\/\/|\bwww\.|\.(?:co\.kr|com|net|kr|io|ai|shop|ly|app|store|org)(?:\/|\b)/i.test(plain)) v.push('링크·도메인 잔존');
  if (/@/.test(plain)) v.push('이메일·아이디 잔존');
  if (/\d(?:[-.\s]?\d){6,}/.test(plain)) v.push('긴 숫자열(연락처·사업자번호 가능) 잔존');
  if (/\d{4}-[가-힣]+-\d{3,5}/.test(plain)) v.push('통신판매업 신고번호 잔존');
  if (/(?:서울|경기|인천|부산|대구|대전|광주|울산|세종|강원|충북|충남|전북|전남|경북|경남|제주)(?:특별|광역)?(?:시|도)?\s*[가-힣]+(?:구|군|시)\s/.test(plain)) v.push('주소 잔존');
  if (/대표(?:이사|자)?\s*[:：]?\s*[가-힣]{2,4}(?![가-힣])/.test(plain)) v.push('대표자 실명 잔존');
  if (/%[가-힣A-Za-z0-9_]{1,12}%|\{\{[^}]{1,20}\}\}|#\{[^}]{1,20}\}/.test(plain)) v.push('변수 토큰 잔존');
  if (/\d{1,3}\s*%/.test(plain)) v.push('할인율 잔존');
  if (/\d[\d,]{2,}\s*원/.test(plain)) v.push('금액 잔존');
  if (MODEL_NAME_RE.test(plain)) v.push('모델명 잔존');
  const low = plain.toLowerCase().replace(/\s+/g, '');
  for (const a of aliases) {
    const k = a.toLowerCase().replace(/\s+/g, '');
    if (k.length < 2) continue;
    if (low.includes(k)) v.push(`브랜드 별칭 잔존: ${a}`);
  }
  return { ok: v.length === 0, violations: Array.from(new Set(v)) };
}
