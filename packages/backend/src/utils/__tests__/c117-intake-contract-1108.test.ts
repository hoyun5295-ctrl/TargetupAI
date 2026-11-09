/**
 * ★ 2026-11-08 C117 오류접수 다섯 계약 시험(설계 = docs/2026-11-08-c117-intake-five-design.md · 흐름 표 = …-flow-ledger.md)
 *   J1 = 뿌리 R84(같은 이름 variantId 의 다른 식별자가 이름표 칸에) · D2 등록 실패 문장
 *   B1 = 인증번호 칸 삭제 · B2 = 뿌리 R85(칸 안 최소 크기를 그릇이 못 받음) · 이름 칸
 *   B3 = 뿌리 R65(화면 쪽 · 받는 사람 실제 친구가 줄에서 멈춤) · 캠페인 이름 = 고른 대상(Harold H1)
 * 대상은 소스에서 기계로 뽑는다(손 등재 표 0).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const sqlSeen: string[] = [];
vi.mock('../../config/database', () => ({
  query: vi.fn(async () => ({ rows: [] })),
  pool: { query: vi.fn(async () => ({ rows: [] })), connect: vi.fn() },
  mysqlPool: {},
  mysqlQuery: vi.fn(async (sql: string) => {
    if (/information_schema\.COLUMNS/i.test(sql)) return [{ TABLE_NAME: 'SMSQ_SEND_12' }];
    sqlSeen.push(sql);
    return [];
  }),
}));

import { getSendTypeLabel, getCampaignChannelLabel, BRAND_TARGETING_NAMES } from '../sms-result-map';
import { withFriendYnField, smsSelectPagedAll, smsSelectAll } from '../sms-queue';
import { billingTypeLabelOf } from '../billing-types';
import { TARGETING_OPTIONS } from '../brand-message';
import { FIELD_MAP } from '../standard-field-map';
import { BRAND_TARGETING_NAMES as FRONT_NAMES, resolveChannelChipClass } from '../../../../frontend/src/utils/campaign-axis';
import { RECIPIENT_NAME_HEADERS, pickNameColumn, recipientFieldLabels, fieldsByPhone, columnPhoneOf } from '../../../../frontend/src/utils/recipient-paste';

const PKG = join(__dirname, '..', '..', '..', '..');   // packages/
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['__tests__', 'node_modules', 'dist'].includes(f)) walk(p, out); }
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};
const backend = walk(join(PKG, 'backend', 'src')).map((p) => ({ rel: relative(PKG, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }));
const readPkg = (rel: string) => readFileSync(join(PKG, rel), 'utf8').replace(/\r\n/g, '\n');
/** 줄 주석을 걷은 글(글자 위치 유지 · 문자열 안 // 는 그대로 두기 위해 줄 머리 주석 · 공백 뒤 주석만) */
const strip = (t: string) => t.split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l.replace(/\s\/\/ .*$/, ''))).join('\n');
/** 여는 괄호 위치부터 짝 괄호까지 인자 글 */
const argsAt = (text: string, openIdx: number): string => {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
  }
  return '';
};
/** 최상위 쉼표로 자른 인자 */
const splitTop = (a: string): string[] => {
  const out: string[] = []; let depth = 0; let cur = ''; let q: string | null = null;
  for (const ch of a) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
    if ('([{'.includes(ch)) depth++;
    if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};
const callSites = (name: string) => backend.flatMap((f) => {
  const code = strip(f.text);
  return [...code.matchAll(new RegExp(`\\b${name}\\(`, 'g'))]
    .filter((m) => !/function\s+$/.test(code.slice(Math.max(0, m.index! - 12), m.index!)))
    .map((m) => ({ rel: f.rel, at: m.index!, args: argsAt(code, m.index! + name.length), code }));
});
/** 위치를 감싼 최상위 함수 · 라우터 처리기 몸통 */
const enclosing = (text: string, idx: number): string => {
  const heads = [...text.matchAll(/^(?:export )?(?:async )?function \w+|^router\.\w+\(/gm)].map((m) => m.index!);
  const start = heads.filter((x) => x <= idx).pop() ?? 0;
  const end = heads.find((x) => x > idx) ?? text.length;
  return text.slice(start, end);
};

describe('J1 · R84 — 검사 등록 이름표 칸에 다른 축 식별자 0', () => {
  it('enqueueSpamTest 에 variantId 를 싣는 곳 = 자동마케팅 묶음 runOneTest 한 곳(spam-test-queue)', () => {
    const sites = callSites('enqueueSpamTest');
    expect(sites.length).toBeGreaterThanOrEqual(4);
    const withVariant = sites.filter((s) => /\bvariantId\b/.test(s.args));
    expect(withVariant.map((s) => s.rel)).toEqual(['backend/src/utils/spam-test-queue.ts']);
  });
  it('D2 — 등록 실패 문장에 오류 원문 0 · ENQUEUE_FAILED', () => {
    const t = readPkg('backend/src/utils/spam-test-queue.ts');
    const tail = t.slice(t.indexOf("console.log('[SpamTestQueue] 큐 등록 오류(상세):'"));
    const ret = tail.slice(0, tail.indexOf('\n  }\n'));
    expect(ret).toContain("errorCode: 'ENQUEUE_FAILED'");
    expect(ret.split('\n').filter((l) => l.includes('return {')).join('\n')).not.toMatch(/\$\{err/);
  });
});

describe('B1 — 브랜드 인증번호 손 입력 0', () => {
  it('편집기 소스에 인증번호 칸 · payload 키 0', () => {
    const t = strip(readPkg('frontend/src/components/BrandMessageEditor.tsx'));
    expect(t).not.toContain('인증번호');
    expect(t).not.toMatch(/unsubscribeAuth|unsubAuth/);
  });
});

describe('B2 · R85 — 그릇이 칸 안 최소 크기를 받는다', () => {
  const css = readPkg('frontend/src/styles/direct-send.css');
  it('B2-a ks-body 스크롤 열마다 자식 flex-shrink 0 규칙(기계 추출)', () => {
    const scrollCols = [...css.matchAll(/(\.ks-body > section\.[\w-]+)\s*\{[^}]*overflow-y:\s*auto/g)].map((m) => m[1]);
    expect(scrollCols.length).toBeGreaterThanOrEqual(2);
    for (const sel of scrollCols) {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(css, sel).toMatch(new RegExp(`${esc} > \\*[^{]*\\{[^}]*flex-shrink:\\s*0`));
    }
  });
  it('B2-b 발송 바 오른쪽 = 줄바꿈 · 채널 칩 = 꺾지 않음(모든 갈래)', () => {
    expect(css).toMatch(/\.ks-foot \.ds-foot-send \{[^}]*flex-wrap:\s*wrap/);
    for (const c of [{ send_channel: 'alimtalk' }, { send_channel: 'kakao_brand' }, { send_channel: 'both' }, { message_type: 'LMS' }, { message_type: 'SMS' }]) {
      expect(resolveChannelChipClass(c)).toContain('whitespace-nowrap');
    }
  });
  it('B2-c 이름 칸 목록 = 표준 필드 name 의 이름 · 별칭 · 키', () => {
    const f = FIELD_MAP.find((x) => x.fieldKey === 'name')!;
    expect(new Set(RECIPIENT_NAME_HEADERS)).toEqual(new Set([f.displayName, ...(f.aliases || []), f.fieldKey]));
    expect(pickNameColumn(['휴대폰', '성함'])).toBe('성함');
    // ★1109 R86 — 이름 칸 = 보기 칸 「이름」(namesByPhone → 칸 CT · brand-recipient-fields-1109)
    const rows = [{ 휴대폰: '010-0000-0001', 이름: ' 가 ' }, { 휴대폰: '0100000002', 이름: '' }];
    expect(fieldsByPhone(rows, columnPhoneOf('휴대폰'), recipientFieldLabels(rows, { phoneKey: '휴대폰', nameKey: pickNameColumn(['휴대폰', '이름']) })))
      .toEqual({ '01000000001': { 이름: '가' }, '0100000002': {} });   // 이름이 빈 줄 = 칸 없음(빈 묶음)
  });
  it('B2-d · B2-e 이름은 보기용 · 인계 = 번호 · 보기 칸 한 행(★1109 R86 = 이름 → 칸 전체)', () => {
    const modal = strip(readPkg('frontend/src/components/BrandSendModal.tsx'));
    expect(modal).toContain('await onSend({ ...payload, phones: sendPhones });');
    expect(modal).toMatch(/initialRecipients\?: BrandRecipientSeed\[\]/);
    const dash = strip(readPkg('frontend/src/pages/Dashboard.tsx'));
    expect(dash).toContain('useState<BrandRecipientSeed[]>([])');
    expect(dash).not.toMatch(/setBrandInitialNames|brandInitialNames/);
    // Codex 구현 1R #2 — 새 값은 있는 값을 덮지 않는다 · 명단에서 빠진 번호의 값은 걷는다(★1109 R86 = 값이 있는 묶음 통째 · firstFilledRecord)
    expect(modal).toContain('next[p] = firstFilledRecord(prev[p], f);');
    expect(modal).toMatch(/useEffect\(\(\) => \{\s*setFields\(\(prev\) => \{\s*const keep = new Set\(phones\);[\s\S]*?\}, \[phones\]\);/);
    // 넘기는 자리마다 행 꼴(번호만 넘기는 자리 0 · ★1109 = 인계 행 CT recipientSeeds)
    for (const m of dash.matchAll(/setBrandInitialRecipients\(/g)) {
      const a = argsAt(dash, m.index! + 'setBrandInitialRecipients'.length);
      expect(a === '[]' || /^recipientSeeds\(/.test(a.trim()), a).toBe(true);
    }
  });
});

describe('B3 · R65(화면 쪽) — 줄 이름 = 받는 사람 실제 친구 · 캠페인 이름 = 고른 대상', () => {
  it('B3-a 대상 이름 표 셋 일치(서버 · 화면 · 서버 TARGETING_OPTIONS · 편집기 TARGETING_OPTIONS)', () => {
    expect(FRONT_NAMES).toEqual(BRAND_TARGETING_NAMES);
    for (const o of Object.values(TARGETING_OPTIONS)) expect(BRAND_TARGETING_NAMES[o.code]).toBe(o.label);
    const editor = readPkg('frontend/src/components/BrandMessageEditor.tsx');
    const opts = [...editor.matchAll(/\{ code: '([A-Z])', label: '([^']+)'/g)].map((m) => [m[1], m[2]]);
    expect(opts.length).toBe(3);
    for (const [code, label] of opts) expect(BRAND_TARGETING_NAMES[code]).toBe(label);
    expect(getCampaignChannelLabel('kakao_brand', 'LMS', 'M')).toBe('브랜드메시지(마수동 전체)');
  });
  it('B3-b 줄 이름을 부르는 자리마다 친구 값 · 그 줄 조회는 친구 칸 CT 를 거친다(기계 추출)', () => {
    const sites = callSites('getSendTypeLabel');
    expect(sites.length).toBeGreaterThanOrEqual(9);
    for (const s of sites) {
      const a = splitTop(s.args);
      expect(a.length, `${s.rel} (${s.args})`).toBe(4);
      expect(a[3], `${s.rel}`).toMatch(/\.friend_yn$/);
      const body = enclosing(s.code, s.at);
      // 줄 필드 상수를 SELECT 에 바로 쓰지 않는다(일반 · LIVE 재시도 · CSV 갈래 전부)
      expect(body, `${s.rel} 필드 상수 직접 사용`).not.toMatch(/SELECT \$\{(SMS_DETAIL_FIELDS|SMS_EXPORT_FIELDS|SEND_FIELDS)\}/);
      for (const m of body.matchAll(/\b(smsSelectAll|smsSelectPagedAll)\(/g)) {
        const fieldsArg = splitTop(argsAt(body, m.index! + m[1].length))[1] || '';
        expect(fieldsArg.startsWith('await withFriendYnField(') || /^[a-zA-Z]+$/.test(fieldsArg), `${s.rel} ${m[1]} 필드`).toBe(true);
      }
    }
    // 줄 조회 파일마다 친구 칸 CT 사용
    for (const rel of [...new Set(sites.map((s) => s.rel))].filter((r) => !r.endsWith('sms-result-map.ts'))) {
      expect(backend.find((f) => f.rel === rel)!.text, rel).toContain('withFriendYnField(');
    }
  });
  it("B3-b' 혼합 스키마 = 표마다 같은 별칭 · 같은 열 수 · 정렬 재작성", async () => {
    const f = await withFriendYnField('seqno as idx, dest_no');
    await smsSelectPagedAll(['SMSQ_SEND_12', 'SMSQ_SEND_1'], f, 'app_etc1 = ?', ['c'], 'seqno DESC', 10, 0);
    await smsSelectAll(['SMSQ_SEND_12', 'SMSQ_SEND_1'], f, 'app_etc1 = ?', ['c'], 'ORDER BY seqno DESC');
    expect(sqlSeen.length).toBe(2);
    for (const sql of sqlSeen) {
      expect(sql).toContain("IFNULL(k_friend_yn, '') AS friend_yn FROM SMSQ_SEND_12");
      expect(sql).toContain("'' AS friend_yn FROM SMSQ_SEND_1 ");
      expect(sql).not.toMatch(/k_friend_yn[^)]*FROM SMSQ_SEND_1 /);
      expect(sql).toMatch(/ORDER BY idx DESC/);
    }
  });
  it('B3-c 줄 이름 = 실제 친구(대체 행은 친구 값과 무관)', () => {
    expect(getSendTypeLabel('F', 0, 1800, 'Y')).toBe(billingTypeLabelOf('BRAND'));
    expect(getSendTypeLabel('F', 0, 1800, 'N')).toBe(billingTypeLabelOf('BRAND_NF'));
    expect(getSendTypeLabel('F', 0, 1800, '')).toBe('브랜드메시지');
    expect(getSendTypeLabel('F', 0, 1800, undefined)).toBe('브랜드메시지');
    expect(getSendTypeLabel('F', 0, 7830, 'Y')).toBe('대체 SMS');
    expect(getSendTypeLabel('S', 0, 6, 'Y')).toBe('SMS');
  });
  it('B3-d 관리 통계 내보내기 브랜드 칸 이름 = 청구 이름', () => {
    const admin = readPkg('backend/src/routes/admin.ts');
    expect(admin).toContain("const kakaoLabel = kakaoKey === 'alimtalk' ? '알림톡' : billingTypeLabelOf(kakaoKey);");
  });
});
