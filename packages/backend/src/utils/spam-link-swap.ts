/**
 * spam-link-swap.ts — 스팸 확인 판의 「주소 바꾸기」 CT (★ 2026-11-26 C164 · 설계서 docs/2026-11-25-spam-diag-rewrite-design.md §7)
 *
 * 막힌 글의 주소를 빼지 않는다. 고칠 줄 속 주소를 **고객이 쓴 원래 주소를 그대로 가리키는** 한줄로 짧은 주소로 바꾼다.
 *   목적지를 알아내지 않는다(바깥 호출 0) — 누르면 짧은 주소 → 원래 주소 → 그 뒤는 원래 주소가 하던 그대로.
 *   만들기 = 기존 「내 단축 주소」 CT(createCustomShortLink · 회사 하루 상한 · 입구 검증)를 그대로 쓴다. 라우트를 거치지 않아 크레딧 0.
 *   링크는 판 등록 트랜잭션 안에서 만든다(run = 그 연결) → 판을 못 만들면 같은 되돌림으로 링크도 사라진다.
 *
 * ⛔ 직접발송은 고객이 [주소도 바꿔서 확인]을 누른 뒤에만 부른다 · 대행은 자동이되 바뀐 글은 승인 문자 1클릭 뒤에만 나간다(설계서 §5-1).
 */
import type { TxRun } from '../config/database';
import { validateCustomShortLinkUrl } from './dm/dm-custom-short-link-core';
import { createCustomShortLink, customShortLinkUrl } from './dm/dm-custom-short-link';
import { listUrlsForTracking } from './short-url';
import type { EditableLine } from './spam-block-hint';

export const SPAM_SWAP_LINK_TITLE = '스팸 검사에서 바꾼 주소';
export interface SwappedUrl { from: string; to: string; linkId: string }

/**
 * 글 한 줄 속 주소(글자 · 자리) — 주소 판정은 short-url CT 의 규칙(listUrlsForTracking)이고, 문장 끝에 붙은 부호만 뗀다.
 *   떼는 이유 = 휴대폰은 「…/a.」의 마침표를 주소로 보지 않는데 그것까지 원래 주소로 저장하면 짧은 주소가 다른 곳을 가리킨다.
 *   ponytail: 한글 조사가 주소에 바로 붙은 글(「…/a에서」)은 가르지 못한다(주소 경로에 한글이 올 수 있다 · short-url CT 와 같은 한계)
 */
function urlSpots(line: string): Array<{ url: string; start: number }> {
  return listUrlsForTracking(line).map((s) => {
    let url = s.url.replace(/[.,!?;:]+$/, '');
    if (url.endsWith(')') && !url.includes('(')) url = url.slice(0, -1).replace(/[.,!?;:]+$/, '');
    return { url, start: s.start };
  });
}

/** (순수) 고칠 줄 속 바꿀 수 있는 주소 — http(s) 로 시작하고 단축 링크 입구 검증을 통과하는 것만(스킴 없는 주소 · 한줄로 자기 주소 · 내부망 · IP · 인증 정보 = 대상 아님) */
export function swappableUrls(text: string, editable: ReadonlyArray<EditableLine>): string[] {
  const lines = String(text || '').split('\n');
  const out: string[] = [];
  for (const e of editable) {
    for (const s of urlSpots(lines[e.sentLine] || '')) {
      if (validateCustomShortLinkUrl(s.url).ok && !out.includes(s.url)) out.push(s.url);
    }
  }
  return out;
}

/**
 * 판 글의 고칠 줄에서 바꿀 수 있는 주소를 전부 짧은 주소로 — 판 등록 트랜잭션 안에서 부른다.
 *   known = 이 부모의 앞 판이 이미 만든 것(같은 원래 주소는 그 짧은 주소를 다시 쓴다 · 새로 만들지 않는다).
 *   create = 새 링크를 만들어도 되는가(주소 판만 참 · 거짓이면 known 에 없는 주소가 하나라도 있을 때 null = 고객이 누르지 않은 길에서 링크가 생기지 않는다).
 *   돌려줌 = 바꾼 글 + 주소 목록 · 못 바꾸면 null(바꿀 주소 0 · 단축 도메인 미설정 · 회사 하루 상한) — 부르는 쪽은 그 등록을 되돌린다(앞서 만든 링크도 함께 사라진다).
 *   코드 충돌(23505)은 던진다 = 등록 되돌림(난수 코드라 드물다).
 */
export async function swapUrlsInPlate(i: {
  companyId: string; userId: string | null; text: string; editable: ReadonlyArray<EditableLine>;
  known: ReadonlyArray<SwappedUrl>; create: boolean; run: TxRun;
}): Promise<{ text: string; urls: SwappedUrl[] } | null> {
  const targets = swappableUrls(i.text, i.editable);
  if (targets.length === 0) return null;
  const urls: SwappedUrl[] = [];
  for (const from of targets) {
    const had = i.known.find((k) => k.from === from);
    if (had) { urls.push(had); continue; }
    if (!i.create) return null;
    const link = await createCustomShortLink({ companyId: i.companyId, userId: i.userId, targetUrl: from, title: SPAM_SWAP_LINK_TITLE, run: i.run });
    const to = link ? customShortLinkUrl(link.code) : null;
    if (!link || !to) return null;
    urls.push({ from, to, linkId: link.id });
  }
  const lines = String(i.text || '').split('\n');
  for (const e of i.editable) {
    let line = lines[e.sentLine] || '';
    // 뒤에서부터 바꾼다(앞 자리가 밀리지 않는다)
    for (const s of urlSpots(line).reverse()) {
      const u = urls.find((x) => x.from === s.url);
      if (u) line = line.slice(0, s.start) + u.to + line.slice(s.start + s.url.length);
    }
    lines[e.sentLine] = line;
  }
  return { text: lines.join('\n'), urls };
}
