/**
 * 링크 검사 — 발송에 실리는 주소를 화면에서 미리 막아 주는 자리 (★2026-09-22 신설)
 *
 * 백엔드 CT(`utils/normalize.ts`)의 **사본**이다. 판정도 문구도 같아야 한다 —
 * 갈리면 화면은 통과시키고 발송에서 죽는 상태가 되고, 그때 고객은 이유를 모른 채 차감만 당한다.
 * `tld-parity.test.ts`가 목록·문구를 함께 고정한다.
 *
 * 왜 TLD를 보는가 — 0922 접수: 버튼·쿠폰 링크를 `invitocorp.cpm`(`.com` 오타)으로 쳐서 발송 3건이
 * `status_code 9999`로 죽었다. 화면에는 사유가 안 남고 차감은 이미 끝난 뒤였다. 존재하지 않는
 * 최상위 도메인은 100% 오타이므로 네트워크 없이 그 자리에서 잡을 수 있다.
 *
 * ⛔ 주소를 고쳐 주지 않는다. 무엇이 틀렸는지만 알려 주고 고객이 고친다.
 */
import { KNOWN_TLDS } from '../constants/tld-list';

/**
 * 링크 형식 — `http://` 또는 `https://`로 시작해야 한다.
 * 변수(`#{...}`)로 시작하는 값은 치환 뒤에 정해지므로 통과.
 */
export const isWebLink = (raw: string): boolean => {
  const v = String(raw || '').trim();
  return /^https?:\/\/\S+$/i.test(v) || v.startsWith('#{');
};

/**
 * 링크 칸에서 포커스가 빠질 때의 정리 — `www.naver.com` 처럼 **도메인 형태인데 스킴이 없는 값**에만 `https://` 를 붙인다.
 * 규칙은 백엔드 `normalizeWebUrl`(utils/normalize.ts · 0702 이메일 링크 건)의 도메인 판정과 같다.
 * ⛔ 발송할 때 뒤에서 고치지 않는다. **칸에 보이는 값**을 바꾸므로 담당자가 나가는 주소를 그대로 본다.
 * 이미 `http(s)://` 로 시작하는 값 · 변수(`#{...}`)로 시작하는 값 · 도메인 형태가 아닌 값은 건드리지 않는다.
 */
export const normalizeLinkInput = (raw: string): string => {
  const v = String(raw || '').trim();
  if (!v || /^https?:\/\//i.test(v) || v.startsWith('#{')) return v;
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(v) ? `https://${v}` : v;
};

/**
 * 주소 끝의 최상위 도메인이 실존하는가 — 모르는 TLD면 그 값을, 판정 대상이 아니면 빈 문자열을 돌려준다.
 * ⛔ 판정하지 않는 것: 빈 값 · 변수 · 스킴 없는 값 · 파싱 불가 · IP 주소 · 점 없는 호스트.
 *    **막는 쪽이 아니라 모르는 쪽으로 접는다** — 오탐은 멀쩡한 발송을 세운다.
 */
export function unknownTldOf(value: any): string {
  const s = String(value ?? '').trim();
  if (!s || !/^https?:\/\//i.test(s)) return '';
  let host = '';
  try { host = new URL(s).hostname; } catch { return ''; }
  host = host.toLowerCase().replace(/\.$/, '');
  if (!host || /^\[|^[0-9.]+$/.test(host)) return '';
  const parts = host.split('.');
  if (parts.length < 2) return '';
  const tld = parts[parts.length - 1];
  return KNOWN_TLDS.has(tld) ? '' : tld;
}

/**
 * 한 번의 실수로 같아지는가 — 치환·삽입·삭제 1회, 그리고 **인접 두 글자 뒤바뀜**(전치) 1회.
 * ⛔ 전치를 빼면 `cmo`(com의 흔한 오타)가 `com` 대신 `co`로 안내된다 — 손가락이 미끄러지는 대표 형태다.
 */
function withinOneEdit(a: string, b: string): boolean {
  if (a.length === b.length) {
    const diff: number[] = [];
    for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) diff.push(k);
    if (diff.length === 2 && diff[1] === diff[0] + 1
        && a[diff[0]] === b[diff[1]] && a[diff[1]] === b[diff[0]]) return true;
  }
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length === b.length) { i++; j++; }
    else if (a.length > b.length) i++;
    else j++;
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

/** 오타로 보이는 TLD에 가장 가까운 실존 TLD 하나 — 없으면 빈 문자열 */
export function suggestTld(unknown: string): string {
  const u = String(unknown || '').toLowerCase();
  if (!u) return '';
  for (const t of ['com', 'net', 'org', 'kr', 'co', 'io', 'me', 'biz', 'info']) {
    if (KNOWN_TLDS.has(t) && withinOneEdit(u, t)) return t;
  }
  for (const t of KNOWN_TLDS) {
    if (withinOneEdit(u, t)) return t;
  }
  return '';
}

/**
 * **본문 글 속의** 링크를 뽑아 첫 결함 하나를 돌려준다 — 문자(SMS·LMS·MMS)처럼 링크가 별도 칸이
 * 아니라 문장에 섞이는 경우. 백엔드 `findLinkDefectInText`의 사본이다.
 *
 * ⛔ 뽑는 범위를 ASCII URL 문자로 끊고 문장 끝 구두점을 떼어 낸다 — `https://a.com입니다` ·
 *    `https://a.com, 문의는`에서 뒤를 삼키면 **멀쩡한 주소가 오타로 판정된다.**
 */
export function findLinkDefectInText(text: any, at = '본문의 링크는'): string {
  const s = String(text ?? '');
  if (!s.includes('http')) return '';
  const found = s.match(/https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+/gi) || [];
  for (const raw of found) {
    const r = linkReason(raw.replace(/[.,;:!?)\]'"]+$/, ''), at);
    if (r) return r;
  }
  return '';
}

/**
 * 링크 결함 사유 한 줄 — 통과면 빈 문자열. 백엔드 `webLinkReason`과 **같은 문구**를 낸다.
 * @param raw 검사할 주소
 * @param at 사유 앞에 붙는 자리 이름(예: `'버튼 링크는'`)
 */
export const linkReason = (raw: any, at = '링크는'): string => {
  const s = String(raw ?? '').trim();
  if (!s || s.startsWith('#{') || s.includes('{{')) return '';
  if (!isWebLink(s)) {
    return `${at} http:// 또는 https://로 시작해야 합니다 (예: https://www.example.com)`;
  }
  const bad = unknownTldOf(s);
  if (!bad) return '';
  // ⛔ 조사를 붙이지 않는다 — TLD마다 받침이 달라(`.com`=콤 / `.co`=코) 「을/를」이 갈린다.
  const hint = suggestTld(bad);
  return hint
    ? `${at} 주소 끝이 '.${bad}'인데 그런 도메인은 없습니다. 혹시 '.${hint}'인가요?`
    : `${at} 주소 끝이 '.${bad}'인데 그런 도메인은 없습니다. 주소를 다시 확인해 주세요`;
};
