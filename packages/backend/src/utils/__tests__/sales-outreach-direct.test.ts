/**
 * sales-outreach-direct.test.ts — ★ 2026-09-23 AI 영업 직접 발송 판정 CT · 대기열 (설계 = docs/2026-09-23-outreach-direct-send-design.md)
 * 순수 함수 행동 테스트 + 렌더 대기열(127.0.0.1 임시 서버 · 크롬 0 · 외부 네트워크 0) + 불변식 소스 검사.
 */
import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { createSlotQueue } from '../outreach-slot-queue';
import { renderPageGuarded } from '../sales-outreach-render';
import { findContactPageLinks } from '../sales-outreach-media';
import {
  normalizeContactEmail, normalizeContactName, normalizeContactBasis,
  outreachHashSecret, outreachAddressHash, buildUnsubscribeToken, parseUnsubscribeToken, verifyUnsubscribeSig, unsubscribeUrlOf,
  classifyContactDomain, parseNaverStoreSlug, naverStoreUrlOf, directSubjectOf,
  computeDirectSendLock, evaluateDirectStage, directStageEnv, directDailyCap, pickAutoConfirmIndexes, autoSendBlockers, visionTwoItemsOk,
  pickPostReviewIndexes, kstDayStartIso, DIRECT_LOCK_MESSAGES, type DirectLockInput, type DirectStats,
} from '../sales-outreach-direct';

const SECRET = 'a'.repeat(64);
const JOB = '11111111-2222-4333-8444-555555555555';

describe('담당자 입력 정규화', () => {
  it('이메일 = 공백 제거 · 도메인 소문자 · 형식 불량 null', () => {
    expect(normalizeContactEmail('  Kim.Lee@Brand.CO.KR ')).toBe('Kim.Lee@brand.co.kr');
    expect(normalizeContactEmail('kim@')).toBeNull();
    expect(normalizeContactEmail('김 <kim@brand.co.kr>')).toBeNull();
    expect(normalizeContactEmail('a@b')).toBeNull();
    expect(normalizeContactEmail('')).toBeNull();
    expect(normalizeContactEmail(`${'a'.repeat(250)}@b.co`)).toBeNull();
  });
  it('담당자명 40자 · 근거 200자 · 비면 null', () => {
    expect(normalizeContactName('  김  담당 ')).toBe('김 담당');
    expect(normalizeContactName('')).toBeNull();
    expect(normalizeContactBasis(' 명함 ')).toBe('명함');
    expect(normalizeContactBasis(' ')).toBeNull();
    expect(normalizeContactBasis('x'.repeat(300))!.length).toBe(200);
  });
});

describe('해시 · 수신거부 토큰(불변 49)', () => {
  it('비밀값 32자 미만 = null', () => {
    expect(outreachHashSecret({ OUTREACH_HASH_SECRET: 'short' })).toBeNull();
    expect(outreachHashSecret({ OUTREACH_HASH_SECRET: SECRET })).toBe(SECRET);
    expect(outreachHashSecret({})).toBeNull();
  });
  it('주소 해시는 대소문자·공백 무관 · 비밀값이 다르면 다르다', () => {
    const h = outreachAddressHash('Kim@Brand.co.kr', SECRET);
    expect(h).toBe(outreachAddressHash(' kim@brand.co.kr ', SECRET));
    expect(h).not.toBe(outreachAddressHash('kim@brand.co.kr', 'b'.repeat(64)));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
  it('토큰 = 잡 id + 서명 · 검증 · 위조 거절', () => {
    const h = outreachAddressHash('kim@brand.co.kr', SECRET);
    const token = buildUnsubscribeToken(JOB, h, SECRET);
    const p = parseUnsubscribeToken(token)!;
    expect(p.jobId).toBe(JOB);
    expect(verifyUnsubscribeSig(p.jobId, p.sig, h, SECRET)).toBe(true);
    expect(verifyUnsubscribeSig(p.jobId, p.sig, outreachAddressHash('lee@brand.co.kr', SECRET), SECRET)).toBe(false);
    expect(verifyUnsubscribeSig(p.jobId, '0'.repeat(32), h, SECRET)).toBe(false);
    expect(parseUnsubscribeToken('x.y')).toBeNull();
    expect(parseUnsubscribeToken(`${JOB}.zz`)).toBeNull();
    expect(unsubscribeUrlOf('https://hanjul.ai/', token)).toBe(`https://hanjul.ai/api/outreach/u/${token}`);
  });
});

describe('도메인 3구분', () => {
  it('같음 · 무료메일 · 다른 회사 · 알 수 없음', () => {
    expect(classifyContactDomain('kim@brand.co.kr', 'https://www.brand.co.kr')).toBe('same');
    expect(classifyContactDomain('kim@mail.brand.co.kr', 'brand.co.kr')).toBe('same');
    expect(classifyContactDomain('kim@naver.com', 'https://www.brand.co.kr')).toBe('free');
    expect(classifyContactDomain('kim@gmail.com', 'https://www.brand.co.kr')).toBe('free');
    expect(classifyContactDomain('kim@agency.co.kr', 'https://www.brand.co.kr')).toBe('other');
    expect(classifyContactDomain('kim@other.co.kr', 'https://brand.co.kr')).toBe('other');
    expect(classifyContactDomain('kim', 'https://brand.co.kr')).toBe('unknown');
    expect(classifyContactDomain('kim@brand.co.kr', '')).toBe('unknown');
  });
});

describe('네이버 스토어 저장값(불변 50 · fetch 0)', () => {
  it('브랜드스토어·스마트스토어 → kind:slug · 소문자 · 예약어·형식 불량 거절', () => {
    expect(parseNaverStoreSlug('https://brand.naver.com/toun28')?.value).toBe('brand:toun28');
    expect(parseNaverStoreSlug('brand.naver.com/Toun28/products/123')?.value).toBe('brand:toun28');
    expect(parseNaverStoreSlug('https://m.smartstore.naver.com/my_shop')?.value).toBe('smartstore:my_shop');
    expect(parseNaverStoreSlug('https://brand.naver.com/main')).toBeNull();
    expect(parseNaverStoreSlug('https://brand.naver.com/')).toBeNull();
    expect(parseNaverStoreSlug('https://shopping.naver.com/toun28')).toBeNull();
    expect(parseNaverStoreSlug('https://evil.com/brand.naver.com/toun28')).toBeNull();
  });
  it('표시 주소는 코드 템플릿만', () => {
    expect(naverStoreUrlOf('brand:toun28')).toBe('https://brand.naver.com/toun28');
    expect(naverStoreUrlOf('smartstore:my_shop')).toBe('https://smartstore.naver.com/my_shop');
    expect(naverStoreUrlOf('brand:../x')).toBeNull();
    expect(naverStoreUrlOf(null)).toBeNull();
  });
});

describe('제목 접두(불변 47)', () => {
  it('(광고) 한 번만', () => {
    expect(directSubjectOf('아이소이 추석 기획전 모바일 DM 시안')).toBe('(광고) 아이소이 추석 기획전 모바일 DM 시안');
    expect(directSubjectOf('(광고) 이미 있음')).toBe('(광고) 이미 있음');
  });
});

describe('직접 발송 잠금', () => {
  const ok: DirectLockInput = {
    stage: 1, hashReady: true, contactEmail: 'kim@brand.co.kr', contactBasis: '명함', domainVerdict: 'same', domainAcked: false,
    suppressed: false, alreadySentCompany: false, todayAttempts: 0, dailyCap: 5, requireReview: true,
    reviewedAssetId: 'A2', latestAssetId: 'A2', unsubLinkOk: true,
  };
  const base = { locked: false, reasons: [] as any[] };
  it('전부 통과 = 잠금 0', () => {
    expect(computeDirectSendLock(base, ok)).toEqual({ locked: false, reasons: [] });
  });
  it('사유별 1개씩', () => {
    const cases: Array<[Partial<DirectLockInput>, string]> = [
      [{ stage: 0 }, 'DIRECT_DISABLED'],
      [{ hashReady: false }, 'HASH_SECRET_MISSING'],
      [{ contactEmail: 'bad' }, 'NO_CONTACT'],
      [{ contactBasis: ' ' }, 'NO_BASIS'],
      [{ domainVerdict: 'other' }, 'DOMAIN_MISMATCH'],
      [{ suppressed: true }, 'SUPPRESSED'],
      [{ alreadySentCompany: true }, 'ALREADY_SENT_COMPANY'],
      [{ todayAttempts: 5 }, 'DAILY_CAP'],
      [{ reviewedAssetId: 'A1' }, 'NOT_REVIEWED'],
      [{ unsubLinkOk: false }, 'UNSUB_LINK_STALE'],
    ];
    for (const [patch, reason] of cases) {
      const r = computeDirectSendLock(base, { ...ok, ...patch });
      expect(r.locked).toBe(true);
      expect(r.reasons).toEqual([reason]);
      expect(DIRECT_LOCK_MESSAGES[reason as keyof typeof DIRECT_LOCK_MESSAGES]).toBeTruthy();
    }
  });
  it('도메인 불일치는 해제되면 통과 · 무료메일은 잠그지 않는다(경고 축)', () => {
    expect(computeDirectSendLock(base, { ...ok, domainVerdict: 'other', domainAcked: true }).locked).toBe(false);
    expect(computeDirectSendLock(base, { ...ok, domainVerdict: 'free' }).locked).toBe(false);
  });
  it('자동(requireReview false)은 확인 잠금이 없다 · 자사 잠금은 그대로 싣는다', () => {
    expect(computeDirectSendLock(base, { ...ok, requireReview: false, reviewedAssetId: null }).locked).toBe(false);
    const r = computeDirectSendLock({ locked: true, reasons: ['PLACEHOLDER_REMAINS'] }, ok);
    expect(r.reasons).toEqual(['PLACEHOLDER_REMAINS']);
  });
});

describe('단계 판정(§6)', () => {
  const zero: DirectStats = { sentTotal: 0, hardBounceTotal: 0, wrongTotal: 0, unsubTotal: 0, recentEdited: 0, recentCount: 0, autoChanged: 0, autoCount: 0, autoStopped: false };
  it('결재값이 상한 · 데이터가 막으면 그 단계까지', () => {
    expect(evaluateDirectStage(0, zero).stage).toBe(0);
    expect(evaluateDirectStage(1, zero).stage).toBe(1);
    expect(evaluateDirectStage(3, zero).stage).toBe(1);
    expect(evaluateDirectStage(3, zero).blockers.join(' ')).toContain('0/30');
    expect(evaluateDirectStage(3, { ...zero, sentTotal: 30 }).stage).toBe(2);
    expect(evaluateDirectStage(2, { ...zero, sentTotal: 30, hardBounceTotal: 1 }).stage).toBe(1);
    expect(evaluateDirectStage(3, { ...zero, sentTotal: 100, recentCount: 50, recentEdited: 5 }).stage).toBe(3);
    expect(evaluateDirectStage(3, { ...zero, sentTotal: 100, recentCount: 50, recentEdited: 6 }).stage).toBe(2);
    expect(evaluateDirectStage(3, { ...zero, sentTotal: 100, unsubTotal: 1 }).stage).toBe(2);
    expect(evaluateDirectStage(3, { ...zero, sentTotal: 100, autoStopped: true }).stage).toBe(2);
    expect(evaluateDirectStage(3, { ...zero, sentTotal: 100, autoChanged: 1 }).stage).toBe(2);
    expect(evaluateDirectStage(3, { ...zero, sentTotal: 200, wrongTotal: 1 }).stage).toBe(1);
  });
  it('ENV 파싱', () => {
    expect(directStageEnv({})).toBe(0);
    expect(directStageEnv({ OUTREACH_DIRECT_STAGE: '2' })).toBe(2);
    expect(directStageEnv({ OUTREACH_DIRECT_STAGE: '9' })).toBe(3);
    expect(directStageEnv({ OUTREACH_DIRECT_STAGE: 'x' })).toBe(0);
    expect(directDailyCap({})).toBe(5);
    expect(directDailyCap({ OUTREACH_DIRECT_DAILY_CAP: '10' })).toBe(10);
    expect(directDailyCap({ OUTREACH_DIRECT_DAILY_CAP: '0' })).toBe(0);
    expect(directDailyCap({ OUTREACH_DIRECT_DAILY_CAP: 'x' })).toBe(5);
  });
});

describe('자동 확정 · 자동 발송 대상', () => {
  it('면허 있는 카드·크롤 후보만 순서대로 앞 3개 · 사람 입력 제외 · 0개면 빈 배열', () => {
    const c = [
      { benefitLicensed: false, origin: 'card' }, { benefitLicensed: true, origin: 'card' }, { benefitLicensed: true, origin: 'manual' },
      { benefitLicensed: true, origin: 'crawl' }, { benefitLicensed: true, origin: 'card' }, { benefitLicensed: true, origin: 'card' },
    ];
    expect(pickAutoConfirmIndexes(c)).toEqual([1, 3, 4]);
    expect(pickAutoConfirmIndexes([{ benefitLicensed: false, origin: 'card' }])).toEqual([]);
    expect(pickAutoConfirmIndexes(null)).toEqual([]);
  });
  it('자동 발송 건 조건', () => {
    const f = { lockReasons: [], domainVerdict: 'same' as const, datedLicense: true, manualEvent: false, visionOk: true, approved: true };
    expect(autoSendBlockers(f)).toEqual([]);
    expect(autoSendBlockers({ ...f, approved: false }).length).toBe(1);
    expect(autoSendBlockers({ ...f, domainVerdict: 'free' }).length).toBe(1);
    expect(autoSendBlockers({ ...f, datedLicense: false }).length).toBe(1);
    expect(autoSendBlockers({ ...f, manualEvent: true }).length).toBe(1);
    expect(autoSendBlockers({ ...f, visionOk: null })[0]).toContain('채점 없음');
    expect(autoSendBlockers({ ...f, lockReasons: ['DAILY_CAP'] })[0]).toContain('DAILY_CAP');
  });
  it('DM 채점 두 항목', () => {
    expect(visionTwoItemsOk(null)).toBeNull();
    expect(visionTwoItemsOk({ items: { text_clipping_zero: true, first_screen_has_headline: true } })).toBe(true);
    expect(visionTwoItemsOk({ items: { text_clipping_zero: true, first_screen_has_headline: false } })).toBe(false);
  });
  it('사후 확인 표본 = 10% 올림 · 최소 1 · 중복 0', () => {
    expect(pickPostReviewIndexes(0)).toEqual([]);
    expect(pickPostReviewIndexes(3, () => 0.5)).toHaveLength(1);
    expect(pickPostReviewIndexes(20, () => 0.3)).toHaveLength(2);
    const s = pickPostReviewIndexes(11, () => 0.9);
    expect(s).toHaveLength(2);
    expect(new Set(s).size).toBe(2);
  });
  it('KST 하루 경계', () => {
    expect(kstDayStartIso(new Date('2026-09-23T14:59:00Z'))).toBe('2026-09-22T15:00:00.000Z');
    expect(kstDayStartIso(new Date('2026-09-23T15:00:00Z'))).toBe('2026-09-23T15:00:00.000Z');
  });
});

describe('제휴·문의 페이지 링크(불변 44 · 주소 아님)', () => {
  it('같은 호스트의 제휴 → 문의 순 · 외부·로그인 제외 · 이메일 0', () => {
    const html = `<a href="/partnership">제휴 문의</a><a href="mailto:ceo@brand.co.kr">메일</a><a href="https://other.com/contact">문의</a><a href="/cs/qna">1:1 문의</a>`;
    const links = findContactPageLinks(html, 'https://www.brand.co.kr/');
    expect(links).toEqual(['https://www.brand.co.kr/partnership', 'https://www.brand.co.kr/cs/qna']);
    expect(links.join(' ')).not.toContain('@');
  });
});

describe('대기열(불변 51)', () => {
  it('겹친 두 작업은 도착 순서대로 · 넘길 때 새 요청이 끼어들지 않는다', async () => {
    const q = createSlotQueue();
    const log: string[] = [];
    const slow = (name: string, ms: number) => () => new Promise<string>((r) => { log.push(`${name}:start`); setTimeout(() => { log.push(`${name}:end`); r(name); }, ms); });
    const a = q.run(slow('a', 30), 1000);
    const b = q.run(slow('b', 5), 1000);
    const c = q.run(slow('c', 5), 1000);
    expect(q.busy).toBe(true);
    expect(q.waiting).toBe(2);
    const r = await Promise.all([a, b, c]);
    expect(r.map((x) => x.ok && x.value)).toEqual(['a', 'b', 'c']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
    expect(q.busy).toBe(false);
  });
  it('대기 상한 초과 = 실행하지 않고 wait_timeout · 예외는 그대로 던지고 자리는 반납', async () => {
    const q = createSlotQueue();
    let ran = false;
    const a = q.run(() => new Promise((r) => setTimeout(r, 60)), 1000);
    const b = await q.run(async () => { ran = true; }, 10);
    expect(b).toEqual({ ok: false, reason: 'wait_timeout' });
    expect(ran).toBe(false);
    await a;
    await expect(q.run(async () => { throw new Error('boom'); }, 10)).rejects.toThrow('boom');
    expect(q.busy).toBe(false);
  });
});

const servers: http.Server[] = [];
afterEach(async () => {
  while (servers.length) await new Promise<void>((r) => servers.pop()!.close(() => r()));
});
async function serve(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<string> {
  const s = http.createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

describe('렌더 대기열 — 이 프로세스의 겹친 요청은 409 로 떨어지지 않는다', () => {
  it('동시 요청 둘 = 워커가 한 번에 하나만 받는다(겹치면 409 인 가짜 워커로 검증)', async () => {
    let inFlight = 0;
    const base = await serve((req, res) => {
      if (inFlight > 0) { res.writeHead(409); res.end('{}'); return; }
      inFlight++;
      setTimeout(() => {
        inFlight--;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, finalUrl: 'https://x.co/', html: '<html></html>', text: '', meta: {} }));
      }, 40);
    });
    const [a, b] = await Promise.all([renderPageGuarded('https://x.co', { baseUrl: base }), renderPageGuarded('https://x.co', { baseUrl: base })]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
  it('대기 상한 초과 = busy(옛 계약)', async () => {
    const base = await serve((req, res) => {
      setTimeout(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, finalUrl: 'https://x.co/', html: '', text: '', meta: {} })); }, 80);
    });
    const first = renderPageGuarded('https://x.co', { baseUrl: base });
    const second = await renderPageGuarded('https://x.co', { baseUrl: base, queueWaitMs: 10 });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure.reason).toBe('busy');
    await first;
  });
});

describe('불변식(소스 검사)', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  it('크롤·재료·판정 코드에 이메일 주소를 읽어 내는 코드가 없다(불변 44)', () => {
    for (const f of ['sales-outreach-direct.ts', 'sales-outreach-media.ts', 'sales-outreach-extract.ts', 'sales-outreach-render.ts']) {
      const src = read(f);
      expect(src).not.toMatch(/mailto:\s*\(/i);
      expect(src).not.toMatch(/match\([^)]*@/);
    }
  });
  it('렌더 요청은 대기열 한 곳을 지난다(renderPageOnce 는 export 하지 않는다)', () => {
    const src = read('sales-outreach-render.ts');
    expect(src).toContain('renderSlot.run(() => renderPageOnce(url, opts)');
    expect(src).not.toMatch(/export (async )?function renderPageOnce/);
  });
  it('이미지 제작은 대기열 한 곳을 지난다(옛 in-flight 깃발 0)', () => {
    const src = read('sales-outreach-produce.ts');
    expect(src).toContain('imageSlot.run(() => produceOutreachImageExclusive(input)');
    expect(src).not.toContain('imageInFlight');
  });
});

// ===== 엑셀 양식(§10) · 작업대 줄(§12) =====
import { parseOutreachBulkRows, mapBulkHeader, buildOutreachTemplateXlsx, parseOutreachBulkXlsx, OUTREACH_BULK_HEADERS } from '../sales-outreach-bulk';
import { laneOf } from '../sales-outreach-direct-jobs';

describe('엑셀 머리줄 파서(옛 3열 호환 · 경고는 거절과 별도)', () => {
  it('새 양식 = 머리줄 이름으로 열을 찾는다 · 칸 형식 오류는 행 등록 + 경고 · 근거 공란 경고', () => {
    const r = parseOutreachBulkRows([
      [...OUTREACH_BULK_HEADERS],
      ['힐링뷰티', 'www.healingbeauty.co.kr', '', 'brand.naver.com/healing', 'MKT@HealingBeauty.co.kr', '김지은', '명함'],
      ['어반핏', 'urbanfit.kr', '', 'https://example.com/x', 'not-an-email', '', ''],
      ['모던리빙', 'www.modern.co.kr', '', '', 'a@modern.co.kr', '', ''],
    ]);
    expect(r.format).toBe('v2');
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({ companyName: '힐링뷰티', naverStore: 'brand:healing', contactEmail: 'MKT@healingbeauty.co.kr', contactName: '김지은', contactBasis: '명함' });
    expect(r.rows[1]).toMatchObject({ naverStore: null, contactEmail: null });
    expect(r.rejected).toHaveLength(0);
    expect(r.warnings.map((w) => w.line)).toEqual([3, 3, 4]);
    expect(r.warnings[2].reason).toContain('수신 근거');
  });
  it('열 순서가 달라도 · 별칭 머리줄도 읽는다', () => {
    expect(mapBulkHeader(['홈페이지', '회사명', '이메일', '근거'])).toEqual({ url: 0, name: 1, email: 2, basis: 3 });
    expect(mapBulkHeader(['A', 'B'])).toBeNull();
  });
  it('옛 3열 양식(머리줄 업체명·홈페이지·업종) = 머리줄로 같은 열을 찾는다 · 예시 영역 무시 · 머리줄 없는 표 = 위치(A~C)', () => {
    const want = [{ companyName: 'a사', homepageUrl: 'a.co.kr', industryCategory: null, naverStore: null, contactEmail: null, contactName: null, contactBasis: null }];
    const old = parseOutreachBulkRows([['업체명', '홈페이지', '업종 (선택)', '', '작성 예시 (이 영역은 지우지 않아도 됩니다 · 읽지 않습니다)'], ['a사', 'a.co.kr', '', '', '힐링뷰티']]);
    expect(old.rows).toEqual(want);
    const bare = parseOutreachBulkRows([['a사', 'a.co.kr', '']]);
    expect(bare.format).toBe('legacy');
    expect(bare.rows).toEqual(want);
  });
  it('홈페이지 칸에 네이버 스토어 주소 = 거절(스토어는 읽지 않으므로 홈페이지가 따로 필요)', () => {
    const r = parseOutreachBulkRows([[...OUTREACH_BULK_HEADERS], ['톤28', 'https://brand.naver.com/toun28', '', '', '', '', '']]);
    expect(r.rows).toHaveLength(0);
    expect(r.rejected[0].reason).toContain('네이버 스토어');
  });
  it('양식 파일 → 다시 읽으면 머리줄이 인식되고 예시 영역은 읽지 않는다(행 0)', async () => {
    const buf = await buildOutreachTemplateXlsx();
    const r = parseOutreachBulkXlsx(buf);
    expect(r.format).toBe('v2');
    expect(r.rows).toHaveLength(0);
    expect(r.rejected).toHaveLength(0);
  });
});

describe('작업대 줄 판정', () => {
  it('단계 · 확인 · 보류 · 사후 확인', () => {
    expect(laneOf({ stage: 'crawling', reviewed: false, hold: false, reviewFlag: null })).toBe('reading');
    expect(laneOf({ stage: 'awaiting_confirm', reviewed: false, hold: false, reviewFlag: null })).toBe('confirm');
    expect(laneOf({ stage: 'producing_dm', reviewed: false, hold: false, reviewFlag: null })).toBe('producing');
    expect(laneOf({ stage: 'ready', reviewed: false, hold: false, reviewFlag: null })).toBe('review');
    expect(laneOf({ stage: 'ready', reviewed: false, hold: true, reviewFlag: null })).toBe('hold');
    expect(laneOf({ stage: 'ready', reviewed: true, hold: false, reviewFlag: null })).toBe('send');
    expect(laneOf({ stage: 'sent', reviewed: true, hold: false, reviewFlag: 'pending' })).toBe('post_review');
    expect(laneOf({ stage: 'sent', reviewed: true, hold: false, reviewFlag: 'ok' })).toBe('sent');
    expect(laneOf({ stage: 'failed', reviewed: false, hold: false, reviewFlag: null })).toBe('failed');
  });
});
