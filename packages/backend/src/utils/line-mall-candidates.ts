/**
 * line-mall-candidates.ts — 한 줄 단계 모달의 몰 후보 CT (★ 2026-10-17 · 설계서 docs/2026-10-17-oneline-steps-modal-design.md §4-2)
 *
 * 옛(10-10): 화면이 몰마다 · 낱말마다 `/search` 를 순서대로 불러 한 목록(최대 6)으로 합쳤다 → 어느 낱말이 0건인지 몰랐고,
 *   상한에 잘린 낱말이 「못 찾았어요」로 보였다. 이제 서버가 낱말마다 묶어 「있음 · 없음 · 확인하지 못함」을 따로 돌려준다.
 *
 * ⛔ 불변
 *   - 검색어 = 판정과 같은 함수(`lineProductTerms`) · 몰 = 재조회 가능한 몰만(`listMallProviders` relookupOnly).
 *   - 몰마다 · 낱말마다 **순서대로** 부른다(카페24 토큰 동시 재발급 회피) · 전체 시간 상한을 넘기면 그 뒤는 부르지 않는다
 *     (늦은 요청이 다음 요청과 겹치지 않게) · 남은 낱말 = 'unknown'.
 *   - 후보 값은 **표시용**이다. 확정 값은 생성 직전 상품번호 재조회로만 정해진다(10-10 불변 그대로).
 *   - 한 줄 속 몰 상품 주소 = 그 몰 기본 주소(카페24 `{몰}.cafe24.com` · 우커머스 연결 주소)일 때만 상품번호로 찾는다(남의 몰 주소의 같은 번호를 우리 상품으로 오인 0).
 */
import { lineProductTerms } from './one-line-facts';
import { lineUrls } from './one-line-steps';
import { listMallProviders, type MallProviderEntry } from './mall-providers';
import { mallProductNoFrom, normalizeNameForMatch, type MallProduct } from './mall-product-normalize';
import type { IntegrationActor } from './integration-scope';

export interface LineMallCandidateOut {
  provider: string;
  no: string;
  name: string;
  price: number;
  salePrice: number;
  imageUrl: string | null;
  /** 검색어와 정규화 후 같은 이름(화면은 표식만 · 미리 체크하지 않는다) */
  exact: boolean;
}
export interface LineMallTermResult { term: string; status: 'ok' | 'none' | 'unknown'; candidates: LineMallCandidateOut[] }

export const LINE_CANDIDATES_TIMEOUT_MS = 5000;
export const LINE_CANDIDATES_PER_TERM = 3;

/** (순수) 검색 상품 하나의 한 줄 칸 — 재조회 상품번호(없으면 null) · 검색어와 정규화 일치(/search 응답 칸과 같은 판정 한 벌) */
export function lineMatchFieldsOf(p: MallProduct, q: string | undefined): { no: string | null; exact: boolean } {
  const target = q ? normalizeNameForMatch(q) : '';
  return { no: mallProductNoFrom(p), exact: !!target && normalizeNameForMatch(p.name) === target };
}

/** 검색 결과 → 후보(재조회 상품번호가 없는 상품은 한 줄 확정에 못 쓴다) */
export function toLineCandidates(provider: string, products: readonly MallProduct[], term: string): LineMallCandidateOut[] {
  const out: LineMallCandidateOut[] = [];
  for (const p of products) {
    const { no, exact } = lineMatchFieldsOf(p, term);
    if (!no || !/^\d+$/.test(no)) continue;
    out.push({ provider, no, name: String(p.name || ''), price: Number(p.price) || 0, salePrice: Number(p.salePrice) || 0, imageUrl: p.imageUrl ? String(p.imageUrl) : null, exact });
  }
  return out;
}

/**
 * (순수) 한 줄 속 주소가 이 몰의 상품 주소면 그 상품번호(카페24 = `{몰}.cafe24.com` + product_no · 우커머스 = 연결 주소 + `?p=`). 아니면 null.
 */
export function mallProductNoFromLineUrl(url: string, entry: MallProviderEntry): string | null {
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const home = entry.home ? (() => { try { return new URL(entry.home!).hostname.replace(/^www\./, ''); } catch { return null; } })() : null;
  const host = u.hostname.replace(/^www\./, '');
  if (!home || host !== home) return null;
  if (entry.provider === 'cafe24') {
    const m = /[?&]product_no=(\d+)/.exec(u.search) || /\/product\/[^/]+\/(\d+)(?:[/?#]|$)/.exec(u.pathname + u.search);
    return m ? m[1] : null;
  }
  if (entry.provider.startsWith('woocommerce:')) {
    const m = /[?&](?:p|product_id)=(\d+)/.exec(u.search);
    return m ? m[1] : null;
  }
  return null;
}

export interface LineMallSearchDeps {
  search(entry: MallProviderEntry, term: string, limit: number): Promise<MallProduct[]>;
  lookup(entry: MallProviderEntry, no: string): Promise<LineMallCandidateOut | null>;
  now(): number;
}

/** 실제 배선(무거운 모듈은 부를 때 읽는다) */
export function defaultLineMallSearchDeps(companyId: string): LineMallSearchDeps {
  return {
    search: async (entry, term, limit) => {
      if (entry.provider === 'cafe24') {
        const { getCafe24Integration, getCafe24ByoCredentials, fetchCafe24Products } = await import('./cafe24-client');
        const integ = await getCafe24Integration(companyId);
        if (!integ || integ.status !== 'active') return [];
        const creds = await getCafe24ByoCredentials(companyId, integ.mallId).catch(() => undefined);
        return fetchCafe24Products(integ, { q: term, limit }, creds);
      }
      if (entry.provider.startsWith('woocommerce:')) {
        const [{ normalizeWooMallId }, { getWooIntegration, fetchWooStoreProducts }] = await Promise.all([import('./woocommerce-core'), import('./woocommerce-client')]);
        const mallId = normalizeWooMallId(entry.provider.slice('woocommerce:'.length));
        const integ = mallId ? await getWooIntegration(companyId, mallId) : undefined;
        if (!integ) return [];
        return fetchWooStoreProducts(integ.siteUrl, { q: term, limit }, integ.mallId);
      }
      return [];
    },
    lookup: async (entry, no) => {
      const { defaultBuildDeps } = await import('./campaign-quick');
      const r = await defaultBuildDeps().lookupMall(companyId, entry.provider as never, [no]);
      const hit = r.failed ? null : r.byCode[no];
      if (!hit || hit.status !== 'ok') return null;
      return { provider: entry.provider, no, name: hit.name, price: hit.price, salePrice: hit.salePrice, imageUrl: hit.imageUrl, exact: true };
    },
    now: () => Date.now(),
  };
}

/**
 * 한 줄 → 낱말별 몰 후보 + 주소로 찾은 상품. 몰이 없으면 전부 'none'(화면은 직접 넣기 · 넣을까요 줄로).
 * 몰 목록 조회가 실패하면 전부 'unknown'(「없음」으로 말하지 않는다).
 */
export async function findLineMallCandidates(
  companyId: string,
  actor: IntegrationActor,
  line: string,
  opts: { maxTerms: number; timeoutMs?: number; deps?: LineMallSearchDeps; providers?: { list: MallProviderEntry[]; failed: boolean } },
): Promise<{ mall: boolean; by_term: LineMallTermResult[]; by_url: LineMallCandidateOut[] }> {
  const deps = opts.deps ?? defaultLineMallSearchDeps(companyId);
  const terms = lineProductTerms(line).slice(0, Math.max(0, opts.maxTerms));
  const providers = opts.providers ?? await listMallProviders(companyId, actor, { relookupOnly: true }).catch(() => ({ list: [] as MallProviderEntry[], failed: true }));
  const list = providers.list.filter((p) => p.relookup);
  if (list.length === 0) {
    const status: LineMallTermResult['status'] = providers.failed ? 'unknown' : 'none';
    return { mall: false, by_term: terms.map((term) => ({ term, status, candidates: [] })), by_url: [] };
  }
  const deadline = deps.now() + (opts.timeoutMs ?? LINE_CANDIDATES_TIMEOUT_MS);
  let timedOut = false;
  /** 남은 시간 안에서만 부른다 · 넘기면 그 뒤로는 부르지 않는다(늦은 요청과 다음 요청이 겹치지 않게) */
  const within = async <T>(fn: () => Promise<T>): Promise<T | 'timeout' | 'error'> => {
    const left = deadline - deps.now();
    if (timedOut || left <= 0) { timedOut = true; return 'timeout'; }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), left); }),
      ]).then((r) => { if (r === 'timeout') timedOut = true; return r; });
    } catch {
      return 'error';
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const byTerm: LineMallTermResult[] = [];
  for (const term of terms) {
    const seen = new Set<string>();
    const candidates: LineMallCandidateOut[] = [];
    let anyAnswered = false;
    let anyFailed = false;
    for (const entry of list) {
      if (candidates.length >= LINE_CANDIDATES_PER_TERM) break;
      // eslint-disable-next-line no-await-in-loop
      const r = await within(() => deps.search(entry, term, LINE_CANDIDATES_PER_TERM));
      if (r === 'timeout' || r === 'error') { anyFailed = true; continue; }
      anyAnswered = true;
      for (const c of toLineCandidates(entry.provider, r, term)) {
        const key = `${c.provider}:${c.no}`;
        if (seen.has(key) || candidates.length >= LINE_CANDIDATES_PER_TERM) continue;
        seen.add(key);
        candidates.push(c);
      }
    }
    const status: LineMallTermResult['status'] = candidates.length > 0 ? 'ok' : (anyFailed || !anyAnswered) ? 'unknown' : 'none';
    byTerm.push({ term, status, candidates });
  }

  const byUrl: LineMallCandidateOut[] = [];
  for (const url of lineUrls(line)) {
    for (const entry of list) {
      const no = mallProductNoFromLineUrl(url, entry);
      if (!no) continue;
      // eslint-disable-next-line no-await-in-loop
      const r = await within(() => deps.lookup(entry, no));
      if (r && r !== 'timeout' && r !== 'error' && !byUrl.some((x) => x.provider === r.provider && x.no === r.no)) byUrl.push(r);
      break;
    }
  }
  return { mall: true, by_term: byTerm, by_url: byUrl };
}
