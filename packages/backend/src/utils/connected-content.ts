/**
 * CT-53 utils/connected-content.ts (D201 2026-05-22)
 *
 * Phase B-3 Connected Content — 외부 실시간 데이터 통합
 *
 * 본질: 발송 시점 외부 API에서 동적 데이터 조회 → Liquid context 자동 통합 → 100% 개인화 완성
 *  - 날씨 (region 12 매핑 + 기상청 API or OpenWeatherMap fallback)
 *  - 재고 (회사 자사몰 ProviderAdapter)
 *  - 가격 (회사 자사몰 ProviderAdapter)
 *  - 자사몰 신상품 (회사 자사몰 ProviderAdapter)
 *
 * 영구 원칙 정합:
 *  - 외부 API timeout 5초 (옛 운영 영향 0)
 *  - 실패 시 빈 값 fallback + console.warn (발송 차단 X)
 *  - in-memory caching (날씨 5분 / 재고 1시간 / 가격 1시간)
 *  - 회사별 rate limit (ProviderAdapter 영역 정합)
 *  - 매칭된 변수만 외부 API 호출 (불요 API 호출 0건)
 */

const FETCH_TIMEOUT_MS = 5000;
const WEATHER_CACHE_TTL_MS = 5 * 60 * 1000;          // 5분
const INVENTORY_CACHE_TTL_MS = 60 * 60 * 1000;        // 1시간
const PRICE_CACHE_TTL_MS = 60 * 60 * 1000;            // 1시간
const PRODUCT_NEW_CACHE_TTL_MS = 30 * 60 * 1000;      // 30분

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 외부 노출 인터페이스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export interface WeatherInfo {
  region: string;          // '서울' / '부산' / ...
  summary: string;          // '맑음' / '흐림' / '비' / '눈'
  temperature: number | null;  // 섭씨
  // ★ 2026-09-26 한줄로 V2 R1-35 — AI 지시문(journey-ai-generator)과 이미 저장된 여정 문안이 쓰는 이름.
  //   temp = temperature와 같은 값 · condition = 날씨 API 영문 상태('Rain' · 'Clear' · 'Snow' ...) — 분기 조건용.
  temp: number | null;
  condition: string;
  rainProbability: number | null;  // 0~100 (%)
  fetchedAt: Date;
}

export interface InventoryInfo {
  productId: string;
  productName: string | null;
  stock: number | null;
  available: boolean;
  fetchedAt: Date;
}

export interface PriceInfo {
  productId: string;
  productName: string | null;
  price: number | null;
  discountPrice: number | null;
  fetchedAt: Date;
}

export interface ProductNewInfo {
  productId: string;
  productName: string;
  imageUrl: string | null;
  price: number | null;
  fetchedAt: Date;
}

export interface ExternalContext {
  // ★ D209+ (Harold 명시 2026-05-22): weather.store 신규 — 매장 region 매핑 (매장 단독 행사 영역 정합)
  // ★ 2026-09-26 한줄로 V2 R1-35 — summary·temp·condition = 고객 지역(today) 값의 짧은 이름(AI 지시문·저장된 문안이 쓰는 이름)
  weather?: { today?: WeatherInfo; store?: WeatherInfo; summary?: string; temp?: number | null; condition?: string };
  inventory?: Record<string, InventoryInfo>;
  price?: Record<string, PriceInfo>;
  product?: { new?: ProductNewInfo[]; last_viewed?: ProductNewInfo };
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 한국 region 12 매핑 (기상청 API region → 단순 코드)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const REGION_NORMALIZE: Record<string, string> = {
  '서울': '서울', '서울시': '서울', '서울특별시': '서울',
  '부산': '부산', '부산시': '부산', '부산광역시': '부산',
  '대구': '대구', '대구시': '대구', '대구광역시': '대구',
  '인천': '인천', '인천시': '인천', '인천광역시': '인천',
  '광주': '광주', '광주시': '광주', '광주광역시': '광주',
  '대전': '대전', '대전시': '대전', '대전광역시': '대전',
  '울산': '울산', '울산시': '울산', '울산광역시': '울산',
  '세종': '세종', '세종시': '세종', '세종특별자치시': '세종',
  '경기': '경기', '경기도': '경기',
  '강원': '강원', '강원도': '강원',
  '충북': '충북', '충청북도': '충북',
  '충남': '충남', '충청남도': '충남',
  '전북': '전북', '전라북도': '전북',
  '전남': '전남', '전라남도': '전남',
  '경북': '경북', '경상북도': '경북',
  '경남': '경남', '경상남도': '경남',
  '제주': '제주', '제주도': '제주', '제주특별자치도': '제주',
};

// ★ 2026-09-26 한줄로 V2 R1-35 — 못 알아본 지역 = null(옛: '서울'로 간주 = 다른 지역 날씨를 지어냈다)
function normalizeRegion(region: string | null | undefined): string | null {
  if (!region) return null;
  const trimmed = region.trim();
  if (REGION_NORMALIZE[trimmed]) return REGION_NORMALIZE[trimmed];
  // 부분 매칭 (예: "서울시 강남구" → "서울")
  for (const key of Object.keys(REGION_NORMALIZE)) {
    if (trimmed.includes(key)) return REGION_NORMALIZE[key];
  }
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1. fetchWeather — 기상청 또는 OpenWeatherMap fallback
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** ★ 2026-09-26 한줄로 V2 R1-35 후속 — 실시간 날씨 연결(키)이 있는가. 없으면 날씨 값은 늘 null(빈칸)이다. */
export function isWeatherConfigured(): boolean {
  return !!process.env.OPENWEATHER_API_KEY;
}

/**
 * ★ 2026-09-26 한줄로 V2 R1-35 후속 — 여정 AI 생성 지시문의 날씨 블록(날씨 CT 소유).
 * 연결이 있으면 종전 글 그대로(여정 AI 생성기에서 원문 이동) · 없으면 날씨 단어·변수 모두 쓰지 않게 한다
 * (옛: 연결이 없어도 날씨 변수를 "의무"로 쓰게 해 빈칸 문장이 나갔다).
 */
export function buildWeatherPromptBlock(): string {
  if (isWeatherConfigured()) {
    return `[★ ★ ★ 날씨 Liquid 변수: D209+ 신규 (Connected Content 통합) ★ ★ ★]
✗ 날씨 단순 단어 직접 작성 절대 금지 ("맑음" / "비" / "눈" / "흐림" / "쌀쌀해요" / "더워요" / "화창" / "쌀쌀"). 발송 시점 실시간 날씨와 불일치 사고 위험 (예: "오늘 날씨 화창해요" 작성한 메시지가 폭우 영역에 발송 = 신뢰 파괴)
✓ 발송 시점 실시간 자동 분기는 Liquid 변수 의무:
   - {{ weather.summary }}: 고객 region 기준 현재 날씨 한 줄 ("맑음 18°C" 등)
   - {{ weather.store.summary }}: 매장 region 기준 (매장 단독 행사 영역 의무, 예: "강남점 봄 행사")
   - {{ weather.temp }} / {{ weather.condition }}: 온도 / 상태 (분기 조건용)
✓ 분기 예시: 폭우 / 폭염 / 눈 영역 안내:
   {% if weather.condition == 'Rain' %}
   비 오는 오늘, 매장 방문이 어려우신 분들을 위해
   {% elsif weather.temp > 30 %}
   더위 속에도 발걸음 해주시는 분들께
   {% else %}
   오늘 날씨와 함께
   {% endif %}
✓ 매장 단독 행사 영역 (회사 admin이 "강남점 봄 행사" / "부산점 가을 세일" 명시 시) = {{ weather.store.summary }} 의무`;
  }
  return `[★ 날씨 표현]
✗ 날씨 단어("맑음" / "비" / "눈" / "흐림" / "쌀쌀해요" / "더워요" / "화창" 등)와 날씨 변수({{ weather.* }}) 모두 쓰지 않는다.
  이 서버에는 실시간 날씨 연결이 없어 날씨 변수는 빈칸으로 나가고, 직접 쓴 날씨 단어는 발송 시점 실제 날씨와 어긋날 수 있다.`;
}

/** 다듬기 지시의 날씨 한 줄 — 연결이 있으면 종전 줄 그대로 · 없으면 날씨 단어·변수 모두 쓰지 않는다 */
export function buildWeatherRefineRule(): string {
  if (isWeatherConfigured()) {
    return `✗ 날씨 단순 단어 직접 작성 X: {{ weather.summary }} / {{ weather.store.summary }} Liquid 변수 의무 (D209+ Connected Content 정합)`;
  }
  return '✗ 날씨 단어와 날씨 변수({{ weather.* }})는 쓰지 않는다(실시간 날씨 연결 없음 · 원본에 있으면 날씨 없이 다듬는다)';
}

const weatherCache = new Map<string, { data: WeatherInfo | null; expiresAt: number }>();

/**
 * ★ 2026-09-26 한줄로 V2 R1-35 — **모르는 날씨는 null.** 옛: 키 없음·호출 실패·상태 없음이면 '맑음'을 돌려줬다
 *   (비 오는 날 "맑은 오늘" 문자). 이제 null → 템플릿 날씨 자리는 비고 분기는 else로 간다. 실패도 캐시한다(장애 중 반복 호출 방지).
 */
export async function fetchWeather(region: string): Promise<WeatherInfo | null> {
  const normalized = normalizeRegion(region);
  if (!normalized) return null;
  const cacheKey = `weather:${normalized}`;
  const cached = weatherCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  try {
    // 기상청 단기예보 API 또는 OpenWeatherMap fallback
    //   ENV: KMA_API_KEY (기상청) / OPENWEATHER_API_KEY (OpenWeatherMap)
    //   둘 다 미박힘 시 fallback (default 정합)
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!isWeatherConfigured() || !apiKey) {
      // ENV 미설정 — 날씨를 모른다(null · 지어내지 않는다)
      return null;
    }

    const cityCoords: Record<string, { lat: number; lon: number }> = {
      '서울': { lat: 37.5665, lon: 126.9780 },
      '부산': { lat: 35.1796, lon: 129.0756 },
      '대구': { lat: 35.8714, lon: 128.6014 },
      '인천': { lat: 37.4563, lon: 126.7052 },
      '광주': { lat: 35.1595, lon: 126.8526 },
      '대전': { lat: 36.3504, lon: 127.3845 },
      '울산': { lat: 35.5384, lon: 129.3114 },
      '세종': { lat: 36.4801, lon: 127.2890 },
      '경기': { lat: 37.4138, lon: 127.5183 },
      '강원': { lat: 37.8854, lon: 127.7298 },
      '충북': { lat: 36.6357, lon: 127.4912 },
      '충남': { lat: 36.5184, lon: 126.8000 },
      '전북': { lat: 35.8242, lon: 127.1480 },
      '전남': { lat: 34.8161, lon: 126.4630 },
      '경북': { lat: 36.4919, lon: 128.8889 },
      '경남': { lat: 35.4606, lon: 128.2132 },
      '제주': { lat: 33.4996, lon: 126.5312 },
    };

    const coord = cityCoords[normalized] || cityCoords['서울'];
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${coord.lat}&lon=${coord.lon}&appid=${apiKey}&units=metric&lang=kr`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!res.ok) throw new Error(`Weather API HTTP ${res.status}`);
    const json: any = await res.json();

    const main = String(json.weather?.[0]?.main || '');
    // 표에 없는 상태는 받은 한글 설명(lang=kr) · 그것도 없으면 모르는 날씨(null)
    const summary = WEATHER_SUMMARY_KR[main] || String(json.weather?.[0]?.description || '').trim();
    if (!main || !summary) {
      weatherCache.set(cacheKey, { data: null, expiresAt: Date.now() + WEATHER_CACHE_TTL_MS });
      return null;
    }
    const temperature = typeof json.main?.temp === 'number' ? Math.round(json.main.temp) : null;
    const rainProb = typeof json.rain?.['1h'] === 'number' ? Math.min(Math.round(json.rain['1h'] * 10), 100) : null;

    const data: WeatherInfo = {
      region: normalized,
      summary,
      temperature,
      temp: temperature,
      condition: main,
      rainProbability: rainProb,
      fetchedAt: new Date(),
    };
    weatherCache.set(cacheKey, { data, expiresAt: Date.now() + WEATHER_CACHE_TTL_MS });
    return data;
  } catch (err: any) {
    console.warn('[ConnectedContent] fetchWeather 오류 — 날씨 없음(null):', err?.message);
    weatherCache.set(cacheKey, { data: null, expiresAt: Date.now() + WEATHER_CACHE_TTL_MS });
    return null;
  }
}

const WEATHER_SUMMARY_KR: Record<string, string> = {
  'Clear': '맑음',
  'Clouds': '흐림',
  'Rain': '비',
  'Drizzle': '이슬비',
  'Thunderstorm': '천둥번개',
  'Snow': '눈',
  'Mist': '안개',
  'Fog': '안개',
  'Haze': '연무',
};

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 1-A. fetchStoreWeather — 매장 region 매핑 (callback_numbers JOIN) (D209+ Harold 명시 매장 단독 행사 영역 정합)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const storeRegionCache = new Map<string, { region: string | null; expiresAt: number }>();
const STORE_REGION_CACHE_TTL_MS = 60 * 60 * 1000;  // 1시간 (매장 region은 거의 변경 X)

/**
 * fetchStoreWeather — 매장 region 매핑 + 날씨 조회
 *
 * 매트릭스:
 *   1. callback_numbers WHERE (store_name = $1 OR store_code = $1) AND company_id = $2 → region 조회
 *   2. region 매칭 시 fetchWeather(region) 호출
 *   3. 매칭 X 시 null 반환 (customer.region fallback 정합)
 *
 * 의도: 회사 admin이 "강남점 봄 행사" 영역 작성 시, customer.region 무관 매장 영역 날씨 정합.
 *
 * SCHEMA 의존: callback_numbers.region varchar(20) NULL 컬럼 (D209+ ALTER 신규)
 */
export async function fetchStoreWeather(storeName: string, companyId: string): Promise<WeatherInfo | null> {
  if (!storeName || !companyId) return null;
  const cacheKey = `storeRegion:${companyId}:${storeName}`;
  const cached = storeRegionCache.get(cacheKey);

  let region: string | null;
  if (cached && cached.expiresAt > Date.now()) {
    region = cached.region;
  } else {
    try {
      const { query } = await import('../config/database');
      const res = await query(
        `SELECT region FROM callback_numbers
         WHERE company_id = $1::uuid
           AND (store_name = $2 OR store_code = $2)
           AND region IS NOT NULL
         LIMIT 1`,
        [companyId, storeName]
      );
      region = res.rows[0]?.region || null;
      storeRegionCache.set(cacheKey, { region, expiresAt: Date.now() + STORE_REGION_CACHE_TTL_MS });
    } catch (err: any) {
      console.warn('[ConnectedContent] fetchStoreWeather region 조회 오류, fallback:', err?.message);
      region = null;
    }
  }

  if (!region) return null;
  try {
    return await fetchWeather(region);
  } catch (err: any) {
    console.warn('[ConnectedContent] fetchStoreWeather weather 조회 오류, fallback:', err?.message);
    return null;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 2. fetchInventory / fetchPrice — ProviderAdapter 정합 (자사몰별 실 구현)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const inventoryCache = new Map<string, { data: InventoryInfo; expiresAt: number }>();
const priceCache = new Map<string, { data: PriceInfo; expiresAt: number }>();

export async function fetchInventory(productId: string, companyId: string): Promise<InventoryInfo> {
  const cacheKey = `inventory:${companyId}:${productId}`;
  const cached = inventoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    // ProviderAdapter 영역 정합 (D173 신규 박힘)
    //   회사별 자사몰 (cafe24/네이버/imweb 등) inventory API 호출
    //   현재 stub — 자사몰 적용 시점 실 구현 의무
    const data: InventoryInfo = {
      productId,
      productName: null,
      stock: null,
      available: true,  // default
      fetchedAt: new Date(),
    };
    inventoryCache.set(cacheKey, { data, expiresAt: Date.now() + INVENTORY_CACHE_TTL_MS });
    return data;
  } catch (err: any) {
    console.warn('[ConnectedContent] fetchInventory 오류, fallback:', err?.message);
    return { productId, productName: null, stock: null, available: true, fetchedAt: new Date() };
  }
}

export async function fetchPrice(productId: string, companyId: string): Promise<PriceInfo> {
  const cacheKey = `price:${companyId}:${productId}`;
  const cached = priceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    // ProviderAdapter 영역 정합 — stub
    const data: PriceInfo = {
      productId,
      productName: null,
      price: null,
      discountPrice: null,
      fetchedAt: new Date(),
    };
    priceCache.set(cacheKey, { data, expiresAt: Date.now() + PRICE_CACHE_TTL_MS });
    return data;
  } catch (err: any) {
    console.warn('[ConnectedContent] fetchPrice 오류, fallback:', err?.message);
    return { productId, productName: null, price: null, discountPrice: null, fetchedAt: new Date() };
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 3. fetchProductNew — 회사 자사몰 신상품 매트릭스
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const productNewCache = new Map<string, { data: ProductNewInfo[]; expiresAt: number }>();

export async function fetchProductNew(companyId: string, limit = 5): Promise<ProductNewInfo[]> {
  const cacheKey = `productnew:${companyId}:${limit}`;
  const cached = productNewCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    // ProviderAdapter 영역 정합 — stub (자사몰 적용 시점 실 구현)
    const data: ProductNewInfo[] = [];
    productNewCache.set(cacheKey, { data, expiresAt: Date.now() + PRODUCT_NEW_CACHE_TTL_MS });
    return data;
  } catch (err: any) {
    console.warn('[ConnectedContent] fetchProductNew 오류, fallback:', err?.message);
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 4. Liquid 변수 매칭 + 외부 데이터 자동 통합 진입점
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function detectExternalVars(template: string): {
  needsWeather: boolean;
  needsStoreWeather: boolean;  // ★ D209+ (매장 region 강화) — weather.store.* 매칭
  needsInventory: string[];
  needsPrice: string[];
  needsProductNew: boolean;
  needsLastViewed: boolean;
} {
  if (!template) {
    return { needsWeather: false, needsStoreWeather: false, needsInventory: [], needsPrice: [], needsProductNew: false, needsLastViewed: false };
  }

  // weather.* 매칭 (today + store 양쪽 trigger)
  const needsWeather = /\{\{\s*weather\.|\{%[^%]*\bweather\./i.test(template);
  // ★ D209+ weather.store.* 매칭 (매장 region 강화)
  const needsStoreWeather = /\{\{\s*weather\.store\.|\{%[^%]*\bweather\.store\./i.test(template);

  // inventory.X 매칭 (X = product_id 추출)
  const inventoryMatches = template.match(/\{\{\s*inventory\.([a-zA-Z0-9_\-]+)/g) || [];
  const needsInventory = inventoryMatches
    .map(m => m.match(/inventory\.([a-zA-Z0-9_\-]+)/)?.[1])
    .filter((x): x is string => !!x);

  // price.X 매칭
  const priceMatches = template.match(/\{\{\s*price\.([a-zA-Z0-9_\-]+)/g) || [];
  const needsPrice = priceMatches
    .map(m => m.match(/price\.([a-zA-Z0-9_\-]+)/)?.[1])
    .filter((x): x is string => !!x);

  // product.new 매칭
  const needsProductNew = /\{\{\s*product\.new/.test(template);
  const needsLastViewed = /\{\{\s*product\.last_viewed/.test(template);

  return { needsWeather, needsStoreWeather, needsInventory, needsPrice, needsProductNew, needsLastViewed };
}

export async function enrichLiquidContextWithExternal(
  template: string,
  companyId: string,
  customerRegion: string | null,
  // ★ D209+ (Harold 명시 2026-05-22): 매장 region 강화 — customer.recent_purchase_store 또는 registered_store 전달
  customerStore?: string | null,
): Promise<ExternalContext> {
  const needs = detectExternalVars(template);
  const context: ExternalContext = {};

  // 매칭된 변수만 fetch (불요 API 호출 0건)
  if (needs.needsWeather && customerRegion) {
    try {
      const weather = await fetchWeather(customerRegion);
      // ★ 2026-09-26 한줄로 V2 R1-35 — 모르는 날씨는 싣지 않는다 · 짧은 이름(summary·temp·condition)도 고객 지역 값으로
      if (weather) {
        context.weather = {
          ...(context.weather || {}),
          today: weather,
          summary: weather.summary,
          temp: weather.temp,
          condition: weather.condition,
        };
      }
    } catch (err: any) {
      console.warn('[ConnectedContent] weather fetch skip:', err?.message);
    }
  }

  // ★ D209+ 매장 region 강화 — weather.store.* 매칭 + customer.recent_purchase_store 매핑
  if (needs.needsStoreWeather && customerStore) {
    try {
      const storeWeather = await fetchStoreWeather(customerStore, companyId);
      if (storeWeather) {
        context.weather = { ...(context.weather || {}), store: storeWeather };
      }
    } catch (err: any) {
      console.warn('[ConnectedContent] storeWeather fetch skip:', err?.message);
    }
  }

  if (needs.needsInventory.length > 0) {
    context.inventory = {};
    for (const pid of needs.needsInventory) {
      try {
        context.inventory[pid] = await fetchInventory(pid, companyId);
      } catch (err: any) {
        console.warn('[ConnectedContent] inventory fetch skip:', pid, err?.message);
      }
    }
  }

  if (needs.needsPrice.length > 0) {
    context.price = {};
    for (const pid of needs.needsPrice) {
      try {
        context.price[pid] = await fetchPrice(pid, companyId);
      } catch (err: any) {
        console.warn('[ConnectedContent] price fetch skip:', pid, err?.message);
      }
    }
  }

  if (needs.needsProductNew || needs.needsLastViewed) {
    try {
      const newProducts = await fetchProductNew(companyId, 5);
      context.product = {
        new: newProducts,
        last_viewed: newProducts[0] || undefined,
      };
    } catch (err: any) {
      console.warn('[ConnectedContent] product.new fetch skip:', err?.message);
    }
  }

  return context;
}
