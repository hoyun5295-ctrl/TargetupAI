/**
 * C107 · 브랜드메시지 구조체크 — 계약 시험(★ 2026-11-05 설계서 docs/2026-11-05-brand-message-design.md §6)
 *
 * K1 = R1 넓힘(카카오 대체 판정 = K · F 한 곳 · 분리 대상 = isKakaoSplitChannel · 청구 식 WHEN 순서)
 * K2 = R1(수신거부 판정 한 벌 · /check = getUnsubscribedPhones)
 * K3 = R61 신설(광고 문자 표기 출구 = resolveBrandFallback 안 buildAdMessage · 부르는 자리 전부 isAd · opt080Number)
 * K4 = R31 넓힘(받는 사람 직접입력 창을 여는 화면 = planAppend(…dedupEnabled) + [중복제거] 단추)
 * K6 = R63 신설(문자로 나가는 대체 글 = 금칙어 판정 입력 · 대체 출구 · 알림톡 적재 자리마다 kakaoFallbackSpamItems)
 * 대상은 소스에서 기계로 뽑는다(손 등재 = 이유 붙은 면제 · 판정 자리 표만 · 낡은 줄 = 실패).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import {
  fallbackOf, tallyKakaoFallback, getSendTypeLabel, getCampaignChannelLabel, KAKAO_FALLBACK_PARENT_TYPES,
} from '../sms-result-map';
import { BILLING_MSG_TYPE_SQL } from '../send-usage-aggregation';
import { SUCCESS_CODES, PENDING_CODES, HANJUL_BAND_BASE as HANJUL_BAND_BASE_ALL } from '../sms-result-map';
const SUCCESS_CODES_ALL = [...SUCCESS_CODES, ...PENDING_CODES];
import { isKakaoSplitChannel, billingTypeLabelOf } from '../billing-types';
import { resolveBrandFallback } from '../brand-message';
import { BRAND_AUDIENCE_LABELS } from '../../../../frontend/src/utils/campaign-axis';
import { pickPhoneColumn, scorePhoneColumns as scoreFront, phonesFromColumn } from '../../../../frontend/src/utils/recipient-paste';
import { scorePhoneColumns as scoreBack, pickPhoneColumnStrict } from '../agency-send-form';

const PKG = join(__dirname, '..', '..', '..', '..');   // packages/
const walk = (d: string, out: string[] = []): string[] => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { if (!['__tests__', 'node_modules', 'dist'].includes(f)) walk(p, out); }
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) out.push(p);
  }
  return out;
};
const load = (dir: string) => walk(join(PKG, dir)).map((p) => ({ rel: relative(PKG, p).replace(/\\/g, '/'), text: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') }));
const backend = load('backend/src');
const frontend = load('frontend/src');
const read = (rel: string) => {
  const f = [...backend, ...frontend].find((x) => x.rel === rel);
  if (!f) throw new Error(`파일 없음 ${rel}`);
  return f.text;
};
/** 주석 줄(//, *, /*) 과 줄 끝 주석을 걷은 코드 줄 */
const codeLines = (text: string) => text.split('\n').map((l, i) => ({ n: i + 1, l: l.replace(/\s\/\/.*$/, '') }))
  .filter(({ l }) => !/^\s*(\/\/|\*|\/\*)/.test(l));

/** 위치를 감싼 최상위 함수 · 라우터 처리기(머리 = 이름 또는 router.메서드('주소')) */
const enclosing = (text: string, idx: number): { name: string; body: string } => {
  const heads = [...text.matchAll(/^(?:export )?(?:async )?function (\w+)|^router\.(\w+)\('([^']*)'/gm)]
    .map((m) => ({ at: m.index!, name: m[1] || `router.${m[2]}('${m[3]}')` }));
  const h = heads.filter((x) => x.at <= idx).pop() ?? { at: 0, name: '(파일 머리)' };
  const end = heads.find((x) => x.at > idx)?.at ?? text.length;
  return { name: h.name, body: text.slice(h.at, end) };
};
/** 여는 괄호 다음부터 짝 괄호까지 = 인자 글 */
const argsAt = (text: string, openIdx: number): string => {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
  }
  throw new Error('짝 괄호 없음');
};
/** 이름( 을 부르는 자리(정의 · 주석 줄 제외) */
const callSites = (files: typeof backend, name: string) => {
  const out: Array<{ rel: string; idx: number; fn: string; body: string; args: string }> = [];
  for (const f of files) {
    for (const m of f.text.matchAll(new RegExp(`(?<![\\w.])${name}\\(`, 'g'))) {
      const lineStart = f.text.lastIndexOf('\n', m.index!) + 1;
      const line = f.text.slice(lineStart, f.text.indexOf('\n', m.index!));
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      if (new RegExp(`function ${name}\\(`).test(line)) continue;
      const e = enclosing(f.text, m.index!);
      out.push({ rel: f.rel, idx: m.index!, fn: e.name, body: e.body, args: argsAt(f.text, m.index! + name.length) });
    }
  }
  return out;
};

describe('K1 · R1 넓힘 — 카카오 대체 판정 = K · F 한 곳', () => {
  it('① 대체 결과 코드 숫자(7830 · 7831)는 결과 CT(sms-result-map) 밖 코드 줄 0', () => {
    const hits = backend.filter((f) => f.rel !== 'backend/src/utils/sms-result-map.ts')
      .flatMap((f) => codeLines(f.text).filter(({ l }) => /\b783[01]\b/.test(l)).map(({ n, l }) => `${f.rel}:${n} ${l.trim()}`));
    expect(hits).toEqual([]);
  });

  it("① K 행 판정을 결과 코드와 함께 쓰는 SQL 줄(msg_type = 'K' … status_code) = 결과 CT 밖 0", () => {
    const hits = backend.filter((f) => f.rel !== 'backend/src/utils/sms-result-map.ts')
      .flatMap((f) => codeLines(f.text).filter(({ l }) => /msg_type\s*(=|IN)\s*\(?'K'/.test(l) && /status_code/.test(l)).map(({ n }) => `${f.rel}:${n}`));
    expect(hits).toEqual([]);
  });

  it('② 대체 분리 집계(aggregateKakaoFallbackByCampaign)에 넘기는 캠페인 = isKakaoSplitChannel 로 고른 것만(알림톡 글자 비교 0)', () => {
    const sites = callSites(backend, 'aggregateKakaoFallbackByCampaign');
    expect(sites.length).toBeGreaterThanOrEqual(3);
    for (const s of sites) {
      const f = backend.find((x) => x.rel === s.rel)!.text;
      const before = f.slice(Math.max(0, s.idx - 600), s.idx + s.args.length + 40);
      expect(before, `${s.rel} ${s.fn}`).toMatch(/isKakaoSplitChannel\(/);
    }
    const list = read('backend/src/utils/stats-aggregation.ts');
    expect(enclosing(list, list.indexOf('export async function loadKakaoFallbackForList')).body).toContain('isKakaoSplitChannel(c.send_channel)');
    for (const f of backend) {
      for (const { n, l } of codeLines(f.text)) {
        if (/\.filter\(/.test(l) && /send_channel\s*===\s*'alimtalk'/.test(l)) throw new Error(`분리 대상을 글자로 고름 ${f.rel}:${n}`);
      }
    }
    expect(isKakaoSplitChannel('alimtalk')).toBe(true);
    expect(isKakaoSplitChannel('kakao')).toBe(true);
    expect(isKakaoSplitChannel('both')).toBe(false);
    expect(isKakaoSplitChannel('sms')).toBe(false);
  });

  it('③ 청구 식 = 대체 WHEN(K · F + 7830 · 7831)이 브랜드(F) 갈래보다 먼저(첫 참 WHEN 에서 멈춘다)', () => {
    const iFb = BILLING_MSG_TYPE_SQL.indexOf("WHEN msg_type IN ('K', 'F') AND status_code = 7830");
    const iBrand = BILLING_MSG_TYPE_SQL.indexOf("WHEN msg_type = 'F' THEN");
    expect(iFb).toBeGreaterThan(-1);
    expect(iBrand).toBeGreaterThan(iFb);
  });

  it('④ 표 — F 행 대체 = 알림톡과 같은 판정 · 집계 · 라벨', () => {
    expect(KAKAO_FALLBACK_PARENT_TYPES).toEqual(['K', 'F']);
    expect(fallbackOf('F', null, 7830)).toBe('S');
    expect(fallbackOf('F', null, 7831)).toBe('L');
    expect(fallbackOf('F', null, 1800)).toBeNull();
    expect(fallbackOf('F', null, 9999)).toBeNull();
    expect(getSendTypeLabel('F', null, 7830)).toBe('대체 SMS');
    expect(getSendTypeLabel('F', null, 7831)).toBe('대체 LMS');
    expect(getSendTypeLabel('F', null, 1800)).toBe('브랜드메시지');
    const t = tallyKakaoFallback([
      { msg_type: 'F', status_code: 1800, cnt: 5 },
      { msg_type: 'F', status_code: 7830, cnt: 2 },
      { msg_type: 'F', status_code: 7831, cnt: 1 },
      { msg_type: 'F', status_code: 9999, cnt: 3 },
    ]);
    expect({ total: t.total, success: t.success, fail: t.fail }).toEqual({ total: 11, success: 5, fail: 6 });
    expect(t.fallback.SMS).toEqual({ total: 2, success: 2, fail: 0, pending: 0 });
    expect(t.fallback.LMS).toEqual({ total: 1, success: 1, fail: 0, pending: 0 });
  });

  it('④ 행 유형 라벨 = 결과 코드까지 넘긴다(부르는 자리 전부 인자 3개)', () => {
    const sites = callSites(backend, 'getSendTypeLabel');
    expect(sites.length).toBeGreaterThanOrEqual(8);
    for (const s of sites) {
      const n = s.args.split(',').length;
      expect(n, `${s.rel} ${s.fn} (${s.args})`).toBe(3);
    }
  });

  it('④ 브랜드 친구 · 비친구 이름 = 청구 유형 이름 하나(서버 라벨 = 화면 라벨)', () => {
    expect(BRAND_AUDIENCE_LABELS.friend).toBe(billingTypeLabelOf('BRAND'));
    expect(BRAND_AUDIENCE_LABELS.nonfriend).toBe(billingTypeLabelOf('BRAND_NF'));
    expect(getCampaignChannelLabel('kakao', 'LMS', 'I')).toBe(billingTypeLabelOf('BRAND'));
    for (const t of ['M', 'N', '', null]) expect(getCampaignChannelLabel('kakao', 'LMS', t)).toBe(billingTypeLabelOf('BRAND_NF'));
    expect(getCampaignChannelLabel('kakao', 'LMS')).toBe('브랜드메시지');
  });
});

describe('K2 · R1 — 수신거부 판정 한 벌', () => {
  it('/check 처리기 = getUnsubscribedPhones(발송과 같은 비교) · 원문 번호 비교 0', () => {
    const u = read('backend/src/routes/unsubscribes.ts');
    const at = u.indexOf("router.post('/check'");
    expect(at).toBeGreaterThan(-1);
    const body = enclosing(u, at).body;
    expect(body).toContain('getUnsubscribedPhones(');
    expect(codeLines(body).map(({ l }) => l).join('\n')).not.toMatch(/phone\s*=\s*ANY/);
  });
});

describe('K3 · R61 신설 — 광고 문자 표기 출구 한 곳', () => {
  it('대체 출구를 부르는 자리 전부 isAd · opt080Number 를 넘긴다', () => {
    const sites = callSites(backend, 'resolveBrandFallback');
    expect(sites.length).toBeGreaterThanOrEqual(5);
    for (const s of sites) {
      expect(s.args, `${s.rel} ${s.fn}`).toMatch(/\bisAd\s*:/);
      expect(s.args, `${s.rel} ${s.fn}`).toMatch(/\bopt080Number\b/);
    }
  });

  it('Codex 구현 1R #1 — 브랜드 대체 080 = 이 발송이 싣는 수신거부 번호(없을 때만 설정) · 화면 휴대폰 창도 같은 값', () => {
    const b = read('backend/src/utils/brand-message.ts');
    const helper = enclosing(b, b.indexOf('async function brandFallbackOpt080(')).body;
    expect(helper).toContain("return String(params.unsubscribePhone || '').trim() || await getOpt080Number(params.userId || null, params.companyId);");
    for (const fn of ['sendBrandMessage', 'sendBrandMessageTemplate']) {
      const body = enclosing(b, b.search(new RegExp(`^export async function ${fn}\\(`, 'm'))).body;
      expect(body, fn).toContain('opt080Number: await brandFallbackOpt080(params),');
    }
    const e = read('frontend/src/components/BrandMessageEditor.tsx');
    expect(e).toContain('const effUnsub = lockedUnsub || unsubPhone.trim();');
    expect(e).toContain("unsubscribePhone: showUnsub ? (effUnsub || undefined) : undefined,");
    expect(e).toMatch(/optOutNumber=\{showUnsub \? effUnsub : ''\}/);
  });

  it('출구 안 = 문자 직접발송과 같은 표기 CT(buildAdMessage · buildAdSubject) · 바이트 판정은 표기 뒤 글', () => {
    const b = read('backend/src/utils/brand-message.ts');
    const body = enclosing(b, b.indexOf('export function resolveBrandFallback(')).body;
    expect(body).toContain('buildAdMessage(');
    expect(body).toContain('buildAdSubject(');
    expect(body.indexOf('const bytes = eucKrByteLength(contents);')).toBeGreaterThan(body.indexOf('buildAdMessage('));
  });

  it('표 — 광고 SMS = (광고) 로 시작 · 무료거부 080 로 끝 · 표기 한 번 · 90바이트 넘으면 막음 · LMS 제목 (광고)', () => {
    const a = resolveBrandFallback({ resendType: 'SM', originalMessage: '오늘 할인', isAd: true, opt080Number: '0801112222' });
    expect(a).toEqual({ nextType: 'A', nextContents: '(광고)오늘 할인\n무료거부0801112222' });
    const again = resolveBrandFallback({ resendType: 'SM', originalMessage: '(광고)오늘 할인\n무료거부0801112222', isAd: true, opt080Number: '0801112222' });
    expect(((again as any).nextContents.match(/\(광고\)/g) || []).length).toBe(1);
    expect(((again as any).nextContents.match(/무료거부/g) || []).length).toBe(1);
    expect(() => resolveBrandFallback({ resendType: 'SM', originalMessage: '가'.repeat(44), isAd: true, opt080Number: '0801112222' })).toThrow(/90바이트/);
    expect(resolveBrandFallback({ resendType: 'SM', originalMessage: '가'.repeat(45), isAd: false, opt080Number: '' })).toEqual({ nextType: 'A', nextContents: '가'.repeat(45) });
    expect(() => resolveBrandFallback({ resendType: 'SM', originalMessage: '가'.repeat(46), isAd: false, opt080Number: '' })).toThrow(/90바이트/);
    const l = resolveBrandFallback({ resendType: 'LM', resendMessage: '본문', resendTitle: '제목', isAd: true, opt080Number: '' }) as any;
    expect(l.nextType).toBe('B');
    expect(l.titleStr).toBe('(광고) 제목');
    expect(l.nextContents.startsWith('(광고)')).toBe(true);
    expect(() => resolveBrandFallback({ resendType: 'LM', resendMessage: '본문', isAd: false, opt080Number: '' })).toThrow(/제목/);
    expect(resolveBrandFallback({ resendType: 'NO', originalMessage: 'x', isAd: true, opt080Number: '' })).toEqual({ nextType: 'N' });
  });
});

describe('K4 · R31 넓힘 — 받는 사람 직접입력 창을 여는 화면 = 같은 중복 규칙', () => {
  /** 면제 = 이유 줄(낡으면 실패) */
  const EXEMPT: Record<string, string> = {
    'frontend/src/components/DirectSendPanel.tsx': '문자 직접발송 = 전부 더하고 보낼 때 [중복제거](서버 dedupStagingRows) 로 뺀다(R31 원문 규칙)',
  };
  const openers = frontend.filter((f) => /<RecipientDirectInputModal\b/.test(f.text)).map((f) => f.rel);

  it('여는 화면 전수 = 면제 아니면 붙여넣기 planAppend(…, dedupEnabled) + 같은 상태의 [중복제거] 단추', () => {
    expect(openers.length).toBeGreaterThanOrEqual(3);
    for (const rel of openers) {
      if (EXEMPT[rel]) continue;
      const t = read(rel);
      // 창에 넘기는 처리 함수(previewPaste · onSubmitPaste)를 따라가 그 안의 더하기 판정을 본다(한 단계 안쪽 plan* 함수까지)
      const use = t.slice(t.indexOf('<RecipientDirectInputModal'), t.indexOf('/>', t.indexOf('<RecipientDirectInputModal')));
      const fnText = (name: string) => {
        const s = t.indexOf(`const ${name} = (`);
        if (s < 0) throw new Error(`${rel} 처리 함수 없음 ${name}`);
        return t.slice(s, t.indexOf('\n  };', s));
      };
      for (const prop of ['previewPaste', 'onSubmitPaste']) {
        const name = use.match(new RegExp(`${prop}=\\{(\\w+)\\}`))?.[1];
        expect(name, `${rel} ${prop}`).toBeTruthy();
        const own = fnText(name!);
        const inner = [...own.matchAll(/\b(plan\w*)\(text\)/g)].map((m) => fnText(m[1])).join('\n');
        expect(own + inner, `${rel} ${prop}=${name}`).toMatch(/planAppend\([^;]*,\s*dedupEnabled\)/);
      }
      expect(t, rel).toMatch(/checked=\{dedupEnabled\}\s*onChange=\{\(e\) => setDedupEnabled\(e\.target\.checked\)\}\s*\/>\s*<span>중복제거<\/span>/);
    }
    for (const rel of Object.keys(EXEMPT)) expect(openers, `낡은 면제 ${rel}`).toContain(rel);
  });

  it('Codex 구현 1R #3 · 2R — 번호 칸 판정 = 백엔드 CT 미러 하나(표 대조) · 바로 담기 = 엄격 규칙(0.9 · 격차 0.3) · 아니면 고르기 창', () => {
    const rows = (n: number, f: (i: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => f(i));
    const cases: Array<{ name: string; headers: string[]; data: Record<string, unknown>[]; column: string | null; candidates: string[] }> = [
      // 비상연락처 = 「없음」 49 + 휴대폰 1 → 후보 아님 · 고객 휴대폰 칸 = 바로 담기
      { name: '없음 칸', headers: ['휴대폰', '비상연락처'], data: rows(50, (i) => ({ 휴대폰: `0100000${String(1000 + i)}`, 비상연락처: i === 0 ? '01099990000' : '없음' })), column: '휴대폰', candidates: ['휴대폰'] },
      // 드문드문(10/50) = 분모가 표본 전체라 0.2 · 후보 아님 · 바로 담지 않음
      { name: '드문드문', headers: ['휴대폰', '매장'], data: rows(50, (i) => ({ 휴대폰: i < 10 ? `0100000${String(2000 + i)}` : '', 매장: '0212345678' })), column: null, candidates: [] },
      // 두 칸 다 휴대폰 = 사람이 고른다
      { name: '두 칸', headers: ['본인', '보호자'], data: rows(10, (i) => ({ 본인: `0100000${String(3000 + i)}`, 보호자: `0100000${String(4000 + i)}` })), column: null, candidates: ['본인', '보호자'] },
      // Codex 2R 재현 — 엑셀 숫자형 본인 번호(앞 0 유실) + 글자형 보호자 번호 = 둘 다 휴대폰(0 복원) → 바로 담지 않음
      { name: '숫자형 본인', headers: ['본인', '보호자'], data: rows(10, (i) => ({ 본인: 1012345000 + i, 보호자: `0109876${String(5000 + i)}` })), column: null, candidates: ['본인', '보호자'] },
      // 숫자형 본인 번호 하나뿐 = 0 복원으로 휴대폰 · 매장 전화는 아님 → 바로 담기
      { name: '숫자형 하나', headers: ['매장', '본인'], data: rows(10, (i) => ({ 매장: 212345678, 본인: 1012345000 + i })), column: '본인', candidates: ['본인'] },
    ];
    for (const c of cases) {
      expect(pickPhoneColumn(c.headers, c.data), c.name).toEqual({ column: c.column, candidates: c.candidates });
      // 같은 사실 = 같은 판정(백엔드 CT 와 표 대조)
      expect(scoreFront(c.headers, c.data), c.name).toEqual(scoreBack(c.headers, c.data as any));
      expect(pickPhoneColumn(c.headers, c.data).column, c.name).toBe(pickPhoneColumnStrict(c.headers, c.data as any));
    }
    // 머리 없는 파일의 첫 번호가 숫자형으로 머리가 된 경우도 0 을 살려 넣는다
    expect(phonesFromColumn('1012345678', [{ '1012345678': 1012345679 }])).toEqual(['01012345678', '01012345679']);
    // 판정 함수 하나 — 옛 숫자만 판정 정의 0
    expect(read('frontend/src/utils/recipient-paste.ts')).not.toMatch(/isMobileDigits|MOBILE_DIGITS_RE/);
  });

  it('Codex 구현 2R(범위 밖 → D-08) — [다른 칸 고르기] = 앞 칸 번호를 바꾼다(담기 전 명단 + 새 칸) · 그 뒤 명단이 바뀌었으면 단추를 감춘다', () => {
    const m = read('frontend/src/components/BrandSendModal.tsx');
    const pick = m.slice(m.indexOf('const pickColumn = (h: string) => {'), m.indexOf('const handleFile = async'));
    expect(pick).toContain('const replace = !!colPick.used && colPick.seq === reqSeqRef.current && !!colPick.base;');
    expect(pick).toContain('addFromColumn(h, colPick.rows, replace ? colPick.base! : phones);');
    const add = m.slice(m.indexOf('const addFromColumn = ('), m.indexOf('const pickColumn = ('));
    expect(add).toContain('const plan = planAppend(list, base, dedupEnabled);');
    expect(add).toContain('setRecipients([...base, ...plan.add]);');
    expect(m).toContain('{!isTarget && colPick && !colPick.open && colPick.used && colPick.seq === reqSeqRef.current && (');
    expect(m).toContain('onClick={() => pickColumn(h)}');
  });

  it('Codex 구현 1R #2 — 알림톡 창 표 불러오기 세대 = 열기 · 닫기 · 명단 바뀜 · 새 불러오기에서 오르고 파일 · 타겟추출 둘 다 검사', () => {
    const a = read('frontend/src/components/AlimtalkSendModal.tsx');
    expect(a).not.toContain('targetSeqRef');
    const up = a.slice(a.indexOf('const handleFileUpload = async (file: File) => {'), a.indexOf('const openMappingWith = ('));
    expect(up).toContain('const seq = ++importSeqRef.current;');
    expect(up.indexOf('if (seq !== importSeqRef.current) {')).toBeGreaterThan(up.indexOf('await res.json();'));
    expect(up.indexOf('openMappingWith(headers, allData);')).toBeGreaterThan(up.indexOf('if (seq !== importSeqRef.current) {'));
    const tg = a.slice(a.indexOf('const handleTargetExtracted = async'), a.indexOf('const applyMapping = () => {'));
    expect(tg).toContain('const seq = ++importSeqRef.current;');
    expect(tg.indexOf('openMappingWith(t.headers, t.data, t.mapping.phone);')).toBeGreaterThan(tg.indexOf('if (seq !== importSeqRef.current) return;'));
    // ★ Codex 구현 2R — 열린 칸 맞추기 창도 세대를 갖는다(열 때 세대 = 적용 때 세대 · 명단이 바뀌면 창을 닫는다)
    expect(a).toMatch(/useEffect\(\(\) => \{\s*importSeqRef\.current\+\+;\s*setTargetLoading\(false\);\s*setFileLoading\(false\);\s*setShowMapping\(false\);\s*\}, \[show, recipients\]\);/);
    expect(a.slice(a.indexOf('const openMappingWith = ('), a.indexOf('const openMappingWith = (') + 200)).toContain('mappingSeqRef.current = importSeqRef.current;');
    const apply = a.slice(a.indexOf('const applyMapping = () => {'), a.indexOf('\n  };\n', a.indexOf('const applyMapping = () => {')));
    expect(apply.indexOf('if (mappingSeqRef.current !== importSeqRef.current) {')).toBeGreaterThan(-1);
    expect(apply.indexOf('if (mappingSeqRef.current !== importSeqRef.current) {')).toBeLessThan(apply.indexOf('setRecipients('));
    // openMappingWith 를 부르는 자리 = 이 둘뿐(새 불러오기 길은 세대 검사부터)
    expect((a.match(/openMappingWith\(/g) || []).length).toBe(2);   // 부르기 2(정의 줄은 「= (」라 세지 않는다)
  });

  it('브랜드 전용 번호 읽기(9~11자리 · 늘 중복 빼기) 정의 0', () => {
    for (const f of frontend) {
      expect(f.text, f.rel).not.toMatch(/export function (checkBrandPaste|normalizeBrandPhones)\b/);
    }
  });
});

describe('K6 · R63 신설 — 문자로 나가는 대체 글 = 금칙어 판정 입력', () => {
  /**
   * 대체 출구(resolveBrandFallback) · 알림톡 적재(insertAlimtalkQueue)를 부르는 자리 → 그 글을 판정하는 자리(kakaoFallbackSpamItems 를 부르는 함수).
   * 키 = 파일 :: 감싼 함수(또는 router.메서드('주소')). 값 = 판정 자리(같은 자리면 같은 키). 새 부르는 자리 = 표에 없음 = 실패.
   */
  const CHECKER: Record<string, string> = {
    "backend/src/routes/campaigns.ts::router.post('/:id/send')": "backend/src/routes/campaigns.ts::router.post('/:id/send')",
    "backend/src/routes/campaigns.ts::router.post('/direct-send')": "backend/src/routes/campaigns.ts::router.post('/direct-send')",
    'backend/src/utils/brand-message.ts::sendBrandMessage': 'backend/src/utils/brand-message.ts::brandFallbackPreflight',
    'backend/src/utils/brand-message.ts::sendBrandMessageTemplate': 'backend/src/utils/brand-message.ts::brandFallbackPreflight',
    // 청크 처리기 = 커밋 코어(createDirectSendCampaign)가 만든 캠페인만 돈다 — 판정은 코어에서 한 번(차감 앞)
    'backend/src/utils/direct-send-processor.ts::processSendChunk': 'backend/src/utils/direct-send-core.ts::createDirectSendCampaign',
    'backend/src/utils/auto-campaign-worker.ts::executeAutoCampaign': 'backend/src/utils/auto-campaign-worker.ts::executeAutoCampaign',
  };
  const EXEMPT: Record<string, string> = {
    'backend/src/utils/system-alimtalk.ts::trySendAuthCodeAlimtalk': '한줄로가 보내는 인증번호 고정 문구(고객 입력 0 · 광고 아님) · 대체 = 같은 문구',
  };
  const keyOf = (s: { rel: string; fn: string }) => `${s.rel}::${s.fn}`;
  const sites = [...callSites(backend, 'resolveBrandFallback'), ...callSites(backend, 'insertAlimtalkQueue')];
  const fnBody = (key: string) => {
    const [rel, fn] = key.split('::');
    const t = read(rel);
    const at = fn.startsWith('router.')
      ? t.indexOf(fn.replace(/\)$/, ''))
      : t.search(new RegExp(`^(?:export )?(?:async )?function ${fn}\\(`, 'm'));
    if (at < 0) throw new Error(`판정 자리 없음 ${key}`);
    return enclosing(t, at).body;
  };

  it('부르는 자리 전수 = 판정 표 또는 이유 붙은 면제(새 자리 · 낡은 줄 = 실패)', () => {
    const keys = Array.from(new Set(sites.map(keyOf))).sort();
    expect(keys).toEqual(Object.keys({ ...CHECKER, ...EXEMPT }).sort());
  });

  it('판정 자리마다 kakaoFallbackSpamItems → checkSpamBlockBeforeCharge · 같은 자리면 차감 · 적재보다 앞', () => {
    for (const [site, checker] of Object.entries(CHECKER)) {
      const body = fnBody(checker);
      expect(body, checker).toContain('kakaoFallbackSpamItems(');
      expect(body, checker).toMatch(/checkSpamBlockBeforeCharge\(/);
      if (site === checker) {
        const iCheck = body.indexOf('kakaoFallbackSpamItems(');
        // 대체 출구(resolveBrandFallback)는 행을 메모리에 짓기만 한다 — 판정은 돈이 나가는 차감 · 실제 적재보다 앞이면 된다
        const iCommit = Math.min(...['prepaidDeduct(', 'insertBrandQueue(', 'bulkInsertSmsQueue(', 'insertAlimtalkQueue('].map((n) => body.indexOf(n)).filter((i) => i >= 0));
        expect(Number.isFinite(iCommit), `${site} 차감 · 적재 자리 없음`).toBe(true);
        expect(iCheck, `${site} 판정이 차감 · 적재 뒤`).toBeLessThan(iCommit);
      }
    }
  });

  it('Codex 구현 1R 권고 — 판정 결과가 실제로 막는다(blocked 갈래 = return · throw · 브랜드 = 사전 판정 결과로 바로 돌려줌)', () => {
    for (const checker of new Set(Object.values(CHECKER))) {
      const body = fnBody(checker);
      const re = /const (\w+) = await checkSpamBlockBeforeCharge\(/g;
      re.lastIndex = body.indexOf('kakaoFallbackSpamItems(');
      const hit = re.exec(body);
      expect(hit, checker).toBeTruthy();
      const v = hit![1];
      const tail = body.slice(hit!.index, hit!.index + 700);
      if (checker.endsWith('::brandFallbackPreflight')) expect(tail, checker).toContain(`return ${v}.blocked ? ${v}.notice : null;`);
      else {
        // blocked 갈래 = 그 if 의 중괄호 블록(또는 한 문장)만 — 뒤쪽 다른 return 을 잡지 않게
        const at = tail.indexOf(`if (${v}.blocked)`);
        expect(at, checker).toBeGreaterThan(-1);
        let s = at + `if (${v}.blocked)`.length;
        while (tail[s] === ' ') s++;
        let branch: string;
        if (tail[s] === '{') {
          let depth = 0, i = s;
          for (; i < tail.length; i++) { if (tail[i] === '{') depth++; else if (tail[i] === '}' && --depth === 0) break; }
          branch = tail.slice(s, i + 1);
        } else branch = tail.slice(s, tail.indexOf(';', s) + 1);
        expect(branch, checker).toMatch(/\b(return|throw)\b/);
      }
    }
    for (const fn of ['sendBrandMessage', 'sendBrandMessageTemplate']) {
      const body = fnBody(`backend/src/utils/brand-message.ts::${fn}`);
      expect(body, fn).toContain('if (fbReject) return { success: false, sentCount: 0, failCount: 0, error: fbReject };');
    }
  });

  it('브랜드 발송 함수 두 곳 = 대체 출구 뒤 · 차감 앞에 brandFallbackPreflight', () => {
    for (const fn of ['sendBrandMessage', 'sendBrandMessageTemplate']) {
      const body = fnBody(`backend/src/utils/brand-message.ts::${fn}`);
      const iFb = body.indexOf('fallback = resolveBrandFallback(');
      const iPre = body.indexOf('await brandFallbackPreflight(');
      const iDeduct = body.search(/prepaidDeduct\(|deductPrepaid\(|chargePrepaid\(/);
      expect(iFb, fn).toBeGreaterThan(-1);
      expect(iPre, fn).toBeGreaterThan(iFb);
      if (iDeduct >= 0) expect(iDeduct, fn).toBeGreaterThan(iPre);
    }
  });
});

describe('K5 · R62 신설 — 비토 실패 코드 대역(한줄로 라벨 = 생성 파일 · 규칙 = 게이트웨이 SQL)', () => {
  it('대역 키 ⊂ 20000 ~ 59999 · 결과 표 · 성공 · 대기 · 이상 코드와 겹침 0 · 키 = 표준 코드 이름에서 같은 규칙으로 다시 나온다', async () => {
    const { HANJUL_BAND_CODES } = await import('../result-code-hanjul-band.generated');
    const map = await import('../sms-result-map');
    const keys = Object.keys(HANJUL_BAND_CODES).map(Number);
    expect(keys.length).toBeGreaterThanOrEqual(200);
    const base = map.HANJUL_BAND_BASE as Record<string, number>;
    for (const k of keys) {
      const e = (HANJUL_BAND_CODES as any)[k];
      const m = String(e.standard).match(/^(KAKAO|LMSMMS|SMS|V)_?([0-9]{1,4})(?:_|$)/);
      expect(m, e.standard).toBeTruthy();
      expect(base[m![1]] + Number(m![2]), e.standard).toBe(k);
      expect(e.title.trim().length, e.standard).toBeGreaterThan(0);
      expect(map.STATUS_CODE_MAP[k], `결과 표와 겹침 ${k}`).toBeUndefined();
      expect(map.SUCCESS_CODES.includes(k) || map.PENDING_CODES.includes(k), String(k)).toBe(false);
      expect(k).toBeLessThan(map.ABNORMAL_STATUS_MIN);
      expect(map.getStatusType(k)).toBe('fail');
      expect(map.isFail(k)).toBe(true);
    }
    expect(Math.max(...Object.keys(map.STATUS_CODE_MAP).map(Number))).toBeLessThan(20000);
    expect(map.getStatusLabel(23018)).toBe('카카오: 메시지를 발송할 수 없음');
    expect(map.getStatusLabel(33000)).toBe('LMS: MMS 미지원 단말');
    // 생성 뒤 게이트웨이에 새로 생긴 코드 = 계열 기본 라벨 · 실패
    expect(map.getStatusLabel(27777)).toBe('카카오: 실패(코드 7777)');
    expect(map.getStatusType(47777)).toBe('fail');
    // 대역 밖 = 종전 그대로
    expect(map.getStatusLabel(60000)).toBe('코드 60000');
    expect(map.getStatusType(60000)).toBe('unknown');
    // 스팸 몰림 코드 목록은 결과 표에서만 뽑는다(대역을 섞지 않는다 · 추가 과제)
    expect(map.SPAM_BLOCK_STATUS_CODES.every((c: number) => c < 20000)).toBe(true);
  });

  it('규칙 글자 = 게이트웨이 SQL 과 같다(형제 저장소가 있을 때) · 생성 스크립트도 같은 글자', () => {
    const regex = "'^(KAKAO|LMSMMS|SMS|V)_?([0-9]{1,4})(?:_|$)'";
    const bases = "WHEN 'KAKAO' THEN 20000 WHEN 'LMSMMS' THEN 30000 WHEN 'SMS' THEN 40000 WHEN 'V' THEN 50000";
    const filter = "is_success = FALSE";
    const gen = readFileSync(join(PKG, 'backend', 'scripts', 'gen-result-code-hanjul-band.mjs'), 'utf8');
    for (const s of [regex, bases, filter, "status_class NOT IN ('pending', 'accepted')"]) expect(gen, s).toContain(s);
    const gwSql = join(PKG, '..', '..', 'bito-gateway', 'scripts', 'gw', 'customer-failure-codes-hanjul.sql');
    let sql = '';
    try { sql = readFileSync(gwSql, 'utf8'); } catch { /* 형제 저장소 없음(서버 · 다른 PC) = 이 대조만 건너뛴다 */ }
    if (sql) for (const s of [regex, bases, filter, "status_class NOT IN ('pending', 'accepted')"]) expect(sql, s).toContain(s);
    // ★1106 G0 실측(hanjul01 0708 매핑 69 실패 행) — G4 는 대역이 아닌 실패 매핑이 켜져 있으면 멈춘다(그 행이 대역보다 앞서 뽑힌다).
    //   대역 행만 남으면 한줄로 성공 · 대기 코드와 겹칠 수 없다 = 대역 하한이 그 코드들보다 크다(게이트웨이 Codex 1R #1 을 이 검사가 덮는다).
    if (sql) {
      // 면제 = 값(그 표준 코드의 대역 코드 · 유형 all · 범위 없음) · note 글자로 가르지 않는다(게이트웨이 Codex 4R)
      for (const s of ['src.is_success = FALSE', 'AND crm.customer_code = b.band::text', "AND crm.msg_type = 'all'", 'IF v_n > 0 THEN']) expect(sql, s).toContain(s);
      expect(sql).not.toContain("AND crm.note IS DISTINCT FROM 'C107");
      expect(sql).not.toContain('BTRIM(crm.customer_code) = b.band');   // 함수와 같이 원문 그대로 비교(Codex 5R)
    }
    expect(Math.min(...Object.values(HANJUL_BAND_BASE_ALL))).toBeGreaterThan(Math.max(...SUCCESS_CODES_ALL));
  });
});
