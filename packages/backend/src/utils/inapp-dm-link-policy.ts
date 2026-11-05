/**
 * ★ 2026-11-05 인앱 포스터 재구성 §3-6 — DM 참여 연결 판정 CT(인앱 = 문 · DM 참여 페이지 = 방).
 *   설계서 docs/2026-11-05-inapp-poster-function-redesign-design.md §3-6 · §3-13.
 *
 *   인앱 버튼 · 사진 링크가 DM 참여 페이지를 가리키면 그 DM 의 섹션을 읽는다.
 *     경품 · 재고 섹션(lucky_draw · roulette · limited_quantity)이 든 DM = 1차 연결 불가(앱 회원 확인이 붙은 뒤 2차).
 *     다른 회사 DM · 게시 안 된 DM = 연결 불가.  그 밖 주소 = 판정 밖(지금과 같음).
 *   읽기는 부르는 쪽 트랜잭션 연결(run)로만 한다 — 트랜잭션 연결을 쥔 채 풀에서 연결을 하나 더 기다리면
 *   동시 요청이 풀을 채우는 순간 서로 막힌다(뿌리 R41 · 계약 시험 CT-IA12 = 이 파일에 풀 query 직접 호출 0).
 *   판정 행 = 저장 결과 행(snake_case DB 행 · §3-13). 새 SQL 0(재사용 세 함수).
 */
import type { TxRun } from '../config/database';
import type { InAppPublishDefect } from './inapp-message';

/** 1차에서 막는 DM 섹션(경품 · 재고 · 선착순) — DM 섹션 표(dm-section-registry PARTICIPATION_TYPES)의 부분집합 */
export const INAPP_DM_PRIZE_SECTIONS: readonly string[] = ['lucky_draw', 'roulette', 'limited_quantity'];

/** 판정 행의 모든 링크 자리(메시지 action_url · buttons · image_link_url · 장 cta · 장 link_url). slide = 장 번호(0부터). */
export function inAppRowLinks(row: Record<string, any>): Array<{ url: string; slide?: number }> {
  const out: Array<{ url: string; slide?: number }> = [];
  const push = (v: any, slide?: number) => {
    const s = typeof v === 'string' ? v.trim() : '';
    if (s) out.push(slide === undefined ? { url: s } : { url: s, slide });
  };
  if (!row || typeof row !== 'object') return out;
  push(row.action_url);
  for (const b of Array.isArray(row.buttons) ? row.buttons : []) if (b && typeof b === 'object') push(b.action_url);
  push(row.image_link_url);
  const slides = Array.isArray(row.poster_slides) ? row.poster_slides : [];
  slides.forEach((s: any, i: number) => {
    if (!s || typeof s !== 'object') return;
    if (s.cta && typeof s.cta === 'object') push(s.cta.action_url, i);
    push(s.link_url, i);
  });
  return out;
}

function dmShortBase(): string {
  return String(process.env.DM_SHORT_LINK_BASE || '').trim().replace(/\/+$/, '');
}

/**
 * 주소 → DM 가리킴(순수). 정식 = /api/dm/v/dm-<code> · 짧은 주소 = /api/dm/v/s/<code> 또는 DM_SHORT_LINK_BASE/<code>.
 *   대괄호 채울 자리 · 그 밖 주소 = null(판정 밖).
 */
export function dmRefOfUrl(url: string, shortBase: string = dmShortBase()): { kind: 'code' | 'short'; code: string } | null {
  const s = String(url || '').trim();
  if (!s || s.startsWith('[')) return null;
  let u: URL;
  try { u = new URL(s, 'https://mall.example/'); } catch { return null; }
  const dec = (v: string) => { try { return decodeURIComponent(v); } catch { return v; } };
  const m = u.pathname.match(/^\/api\/dm\/v\/(?:s\/([^/]+)|(dm-[^/]+))\/?$/);
  if (m) return m[1] ? { kind: 'short', code: dec(m[1]) } : { kind: 'code', code: dec(m[2]) };
  if (shortBase) {
    try {
      const b = new URL(shortBase);
      const basePath = b.pathname.replace(/\/+$/, '');
      if (u.host === b.host && u.pathname.startsWith(`${basePath}/`)) {
        const rest = u.pathname.slice(basePath.length + 1);
        if (rest && !rest.includes('/')) return { kind: 'short', code: dec(rest) };
      }
    } catch { /* 바탕 값이 주소가 아니면 짧은 주소 판정 없음 */ }
  }
  return null;
}

/**
 * 편집기 [내 DM 참여 페이지 연결] 고르기 창 목록 — 이 회사의 게시된 DM 중 참여 섹션이 있는 것 · 정식 주소(식별값 0).
 *   blocked = 경품 · 재고 섹션이 든 DM(고르기 창에서 흐리게 · 게시 판정이 같은 표로 막는다). 읽기만 · 기존 칸만.
 */
export async function listInAppDmLinkCandidates(companyId: string): Promise<Array<{
  id: string; title: string; url: string; participation: string[]; blocked: boolean;
}>> {
  const { query } = await import('../config/database');
  const { extractFlatSectionsFromDm } = await import('./dm/dm-builder');
  const { PARTICIPATION_TYPES } = await import('./dm/dm-section-registry');
  const base = String(process.env.HANJUL_BASE_URL || 'https://hanjul.ai').replace(/\/+$/, '');
  const r = await query(
    `SELECT id, title, short_code, sections, pages FROM dm_pages
      WHERE company_id = $1 AND status = 'published' AND short_code IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT 100`,
    [companyId],
  );
  const out: Array<{ id: string; title: string; url: string; participation: string[]; blocked: boolean }> = [];
  for (const dm of r.rows as any[]) {
    const types = Array.from(new Set(extractFlatSectionsFromDm(dm).map((s: any) => String(s?.type || ''))));
    const participation = types.filter((t) => (PARTICIPATION_TYPES as readonly string[]).includes(t));
    if (participation.length === 0) continue;
    out.push({
      id: String(dm.id),
      title: String(dm.title || '제목 없는 DM'),
      url: `${base}/api/dm/v/dm-${dm.short_code}`,
      participation,
      blocked: participation.some((t) => INAPP_DM_PRIZE_SECTIONS.includes(t)),
    });
  }
  return out;
}

/**
 * 판정 한 곳. null = 통과. run = 지금 트랜잭션 연결(필수 · 풀로 새 연결을 받지 않는다).
 *   짧은 주소 = 수신자 · 발행 짧은 주소(lookupDmShortLink) → 없으면 고객사 자체 짧은 주소(lookupCustomShortLink)의 목적 주소를
 *   한 번 더 같은 판정(정식 주소 · DM 짧은 주소까지) · 그 이상 따라가지 않는다.
 */
export async function inAppDmLinkPolicyDefect(run: TxRun, companyId: string, row: Record<string, any>): Promise<InAppPublishDefect | null> {
  const links = inAppRowLinks(row);
  if (links.length === 0) return null;
  const { getDmByCode, extractFlatSectionsFromDm } = await import('./dm/dm-builder');
  const { lookupDmShortLink } = await import('./dm/dm-recipient-token');
  const { lookupCustomShortLink } = await import('./dm/dm-custom-short-link');
  const at = (slide?: number) => (slide === undefined ? {} : { slide });
  for (const { url, slide } of links) {
    const ref = dmRefOfUrl(url);
    if (!ref) continue;
    let code: string | null = ref.kind === 'code' ? ref.code : null;
    if (ref.kind === 'short') {
      const found = await lookupDmShortLink(ref.code, run);
      if (found) code = found.dmCode;
      else {
        const custom = await lookupCustomShortLink(ref.code, run);
        const ref2 = custom ? dmRefOfUrl(custom.targetUrl) : null;
        if (ref2?.kind === 'code') code = ref2.code;
        else if (ref2?.kind === 'short') code = (await lookupDmShortLink(ref2.code, run))?.dmCode ?? null;
      }
    }
    if (!code) continue;   // DM 이 아닌 짧은 주소 = 판정 밖
    const dm = await getDmByCode(code, run);
    if (!dm || String(dm.company_id) !== String(companyId)) {
      return { message: '연결할 수 없는 DM 이에요. 이 회사에서 게시한 DM 만 연결할 수 있어요.', field: 'link', ...at(slide) };
    }
    const sections = extractFlatSectionsFromDm(dm);
    if (sections.some((sec: any) => sec && INAPP_DM_PRIZE_SECTIONS.includes(String(sec.type)))) {
      return { message: '경품이나 선착순 DM 은 아직 인앱에 연결할 수 없어요. 투표나 설문 DM 을 연결해 주세요.', field: 'link', ...at(slide) };
    }
  }
  return null;
}
