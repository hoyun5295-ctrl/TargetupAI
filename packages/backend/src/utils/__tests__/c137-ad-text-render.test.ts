/**
 * C137 — 저장된 건을 다시 그리는 화면의 광고 표기 = 표기 칸까지 본다(★ 2026-11-16 · 재오픈 cmwd36hnr1corjnscq7xlnim1 · 서 팀장)
 *
 * 기원
 *   C132 는 이메일 대행 접수의 표기 칸(agency_send_requests.ad_text · campaigns.send_config.adText = false)을
 *   글을 조립하는 서버 자리(스팸 검사 · 테스트 문자 · 발송 · 예약 문안 고치기)에만 걸었다.
 *   저장된 글을 다시 그리는 화면은 is_ad 하나로 (광고) · 080 을 그려, 담당자 승인 링크가 「받으신 테스트 문자 그대로 나갑니다」라고
 *   써 놓고 제목 앞에 (광고) 를 붙여 보였다(테스트 문자 · 실제 발송에는 없다).
 *
 * 못 박는 것
 *   1. 화면 판정 adTextOnFront = 서버 판정(adTextOn · agencyAdTextApplies)과 같은 답(값 범위 전부).
 *   2. formatCampaignMessageForDisplay 가 표기 칸을 본다(표기 끔 = 저장된 글 그대로 · 칸 없음 = 종전 글자 그대로).
 *   3. 서버가 화면에 표기 칸을 내보낸다(발송 결과 목록 · 상세 = campaignAdTextSelect · 승인 링크 = adText).
 *   4. 프론트 전 파일에서 기계로 뽑은 「저장된 건의 광고 여부를 표기 인자로 바로 넘기는 자리」 = 0.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { adTextOn, campaignAdTextSelect } from '../direct-send-spec';
import { agencyAdTextApplies } from '../agency-send-optout';
import { adTextOnFront, formatCampaignMessageForDisplay, buildAdMessageFront } from '../../../../frontend/src/utils/formatDate';

const SRC = path.resolve(__dirname, '..', '..');
const FRONT = path.resolve(__dirname, '../../../../frontend/src');
const back = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n');
const front = (rel: string) => fs.readFileSync(path.join(FRONT, rel), 'utf8').replace(/\r\n/g, '\n');
/** 주석을 뺀 글(계약은 실행되는 글만 본다) */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

describe('표기 판정 값 범위 = 서버와 같은 답', () => {
  const IS_AD = [true, false, null, undefined];
  const AD_TEXT = [true, false, null, undefined];
  it('isAd × adText 전부', () => {
    for (const a of IS_AD) for (const t of AD_TEXT) {
      const want = !!a && t !== false;
      expect(adTextOnFront(a, t), `isAd=${a} adText=${t}`).toBe(want);
      expect(agencyAdTextApplies({ isAd: a as any, adText: t as any }), `agency isAd=${a} adText=${t}`).toBe(want);
      if (a === true || a === false) expect(adTextOn(a, t), `spec isAd=${a} adText=${t}`).toBe(want);
    }
  });
});

describe('저장된 캠페인 글 그리기(formatCampaignMessageForDisplay)', () => {
  const body = '광고 표기 자동으로 붙는지';
  const opt = '080-644-9247';
  it('광고 발송 + 표기 끔(이메일 대행) = 저장된 글 그대로 · (광고) · 080 을 그리지 않는다', () => {
    const c = { message_content: body, message_type: 'LMS', is_ad: true, ad_text: false, opt_out_080_number: opt };
    expect(formatCampaignMessageForDisplay(c)).toBe(body);
    expect(formatCampaignMessageForDisplay(c, `${body}\n실제 보낸 글`)).toBe(`${body}\n실제 보낸 글`);
  });
  it('칸 없음 · null · true = 종전 글자 그대로((광고) · 080 부착)', () => {
    const want = buildAdMessageFront(body, 'LMS', true, opt);
    expect(want.startsWith('(광고) ')).toBe(true);
    for (const ad_text of [undefined, null, true]) {
      expect(formatCampaignMessageForDisplay({ message_content: body, message_type: 'LMS', is_ad: true, ad_text, opt_out_080_number: opt }), String(ad_text)).toBe(want);
    }
  });
  it('광고 아님 = 종전대로 그대로', () => {
    expect(formatCampaignMessageForDisplay({ message_content: body, message_type: 'LMS', is_ad: false, ad_text: null })).toBe(body);
  });
  it('판정 자리 = 표기 판정 한 곳', () => {
    const fd = code(front('utils/formatDate.ts'));
    const fn = fd.slice(fd.indexOf('export function formatCampaignMessageForDisplay'), fd.indexOf('export function', fd.indexOf('export function formatCampaignMessageForDisplay') + 10));
    expect(fn).toContain('if (!adTextOnFront(campaign.is_ad, campaign.ad_text)) return source;');
    expect(fn).not.toMatch(/if \(!campaign\.is_ad\)/);
  });
});

describe('서버가 화면에 표기 칸을 내보낸다', () => {
  it('표기 칸 SELECT 한 곳 = send_config.adText 가 false 일 때만 false', () => {
    expect(campaignAdTextSelect('c')).toBe(`CASE WHEN c.send_config->>'adText' = 'false' THEN false END AS ad_text`);
    expect(campaignAdTextSelect('x')).toContain('x.send_config');
  });
  it('발송 결과 목록 · 상세 SELECT 가 그 칸을 싣는다', () => {
    const r = code(back('routes/results.ts'));
    const list = r.slice(r.indexOf("router.get('/campaigns', "), r.indexOf("router.get('/campaigns/export'"));
    expect(list).toContain("${campaignAdTextSelect('c')}");
    const detail = r.slice(r.indexOf("router.get('/campaigns/:id', "), r.indexOf("router.get('/campaigns/:id/callbacks'"));
    expect(detail).toContain("SELECT c.*, ${CAMPAIGN_OPT080_SELECT_EXPR}, ${campaignAdTextSelect('c')}");
  });
  it('캘린더 · 예약 목록(GET /api/campaigns) · 슈퍼관리자 통계 상세가 그 칸을 싣는다(C137-H2)', () => {
    const between = (s: string, head: string) => { const i = s.indexOf(head); expect(i, head).toBeGreaterThan(-1); const j = s.indexOf('\nrouter.', i + head.length); return s.slice(i, j < 0 ? undefined : j); };
    const list = between(code(back('routes/campaigns.ts')), "router.get('/', ");
    expect(list).toContain("${CAMPAIGN_OPT080_SELECT_EXPR},\n        ${campaignAdTextSelect('c')}\n       FROM campaigns c");
    expect(list).toContain('const { send_config: _sendConfig, result_final: _resultFinal, ...rest } = c;');   // ad_text 는 rest 로 응답에 남는다
    const sd = between(code(back('routes/admin.ts')), "router.get('/stats/send/detail'");
    expect(sd).toContain("${CAMPAIGN_OPT080_SELECT_EXPR},\n        ${campaignAdTextSelect('c')},");
    expect(sd).toContain('ad_text: c.ad_text ?? null,');
  });
  it('승인 링크 재료가 표기 칸을 싣는다(이메일 접수 = false · 칸 이전 = null)', () => {
    const a = code(back('routes/agency-approve.ts'));
    const view = a.slice(a.indexOf('function toApprovalView'), a.indexOf('async function loadCallbackKinds'));
    expect(view).toContain('adText: row.ad_text === false ? false : null,');
    expect(a).toContain('SELECT * FROM agency_send_requests WHERE id = $1::uuid');   // ad_text 칸이 행에 실린다
  });
});

/** 프론트 전 파일 */
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
/** `name(` 호출마다 괄호를 맞춰 인자 목록을 뽑는다(문자열 · 템플릿 안 괄호는 건너뜀) */
function callArgs(src: string, name: string): string[][] {
  const res: string[][] = [];
  let i = 0;
  while ((i = src.indexOf(`${name}(`, i)) >= 0) {
    if (/[\w.]/.test(src[i - 1] || '') || /function\s+$/.test(src.slice(Math.max(0, i - 10), i))) { i += name.length; continue; }
    let j = i + name.length + 1; let depth = 1; let cur = ''; const args: string[] = []; let q: string | null = null;
    for (; j < src.length && depth > 0; j++) {
      const ch = src[j];
      if (q) { cur += ch; if (ch === q && src[j - 1] !== '\\') q = null; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { q = ch; cur += ch; continue; }
      if (ch === '(' || ch === '[' || ch === '{') depth++;
      if (ch === ')' || ch === ']' || ch === '}') depth--;
      if (depth === 0) break;
      if (ch === ',' && depth === 1) { args.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    args.push(cur.trim());
    res.push(args);
    i = j;
  }
  return res;
}
/** 저장된 건의 광고 여부를 그대로 넘기는 모양(`x.is_ad` · `x?.is_ad ?? false` · `r.isAd` 류 · 감싼 함수 없음) */
const BARE_STORED_FLAG = /^[\w$]+(\??\.[\w$]+)*\??\.(is_ad|isAd)(\s*\?\?\s*(false|true))?$/;

describe('기계 추출 — 저장된 건을 그리는 자리에서 광고 여부를 표기 인자로 바로 넘기지 않는다', () => {
  const files = walk(FRONT).map((f) => ({ rel: path.relative(FRONT, f).replace(/\\/g, '/'), src: code(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n')) }));
  it('buildAdSubjectFront · buildAdMessageFront 의 광고 인자', () => {
    const bad: string[] = [];
    let seen = 0;
    for (const { rel, src } of files) {
      for (const fn of ['buildAdSubjectFront', 'buildAdMessageFront']) {
        for (const args of callArgs(src, fn)) {
          seen++;
          if (args.length >= 3 && BARE_STORED_FLAG.test(args[2])) bad.push(`${rel}: ${fn}(…, ${args[2]})`);
        }
      }
    }
    expect(seen).toBeGreaterThan(30);   // 뽑는 장치가 살아 있다(호출 자리를 실제로 읽는다)
    expect(bad).toEqual([]);
  });
  it('「(광고)」 앞붙임 표시 · 자동 부착 안내 문장의 조건', () => {
    const bad: string[] = [];
    for (const { rel, src } of files) {
      const re = /([\w$?.]+\??\.(?:is_ad|isAd))\s*(?:&&|\?)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) {
        const ahead = src.slice(m.index, m.index + 320);
        if (/\(광고\) <\/span>|광고 표시와 무료 수신거부 번호는 자동으로/.test(ahead)) bad.push(`${rel}: ${m[1]} → ${ahead.slice(0, 80).replace(/\s+/g, ' ')}`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('고친 자리(접수 · 재오픈 첨부의 화면)', () => {
    const ap = code(front('pages/AgencyApprovePage.tsx'));
    expect(ap).toContain("buildAdSubjectFront(r.subject || '', r.messageType, adTextOnFront(r.isAd, r.adText))");
    expect(ap).toContain("{adTextOnFront(r.isAd, r.adText) ? ' 광고 표시와 무료 수신거부 번호는 자동으로 붙습니다.' : ''}");
    // ★ 2026-11-16 C139 — 상세 창 제목 두 자리(정보 줄 · 미리보기)는 같은 식을 CT campaignSubjectForDisplay 로 옮겼다(값 같음) · 그 CT 가 표기 칸 판정을 지난다
    const cd = code(front('components/CampaignDetailModal.tsx'));
    expect(cd.match(/campaignSubjectForDisplay\(campaign\)/g)).toHaveLength(1);
    expect(cd).not.toMatch(/buildAdSubjectFront\(/);
    const fd = code(front('utils/formatDate.ts'));
    const ct = fd.slice(fd.indexOf('export function campaignSubjectForDisplay'));
    expect(ct.slice(0, ct.indexOf('\n}\n'))).toContain('adTextOnFront(campaign.is_ad, campaign.ad_text)');
    const sc = code(front('components/ScheduledCampaignModal.tsx'));
    expect(sc.match(/adTextOnFront\(selectedScheduled\??\.is_ad, selectedScheduled\??\.ad_text\)/g)).toHaveLength(3);
  });
});
