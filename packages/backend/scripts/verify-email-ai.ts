/**
 * Email AI/트래킹 순수 로직 검증 (DB/AI/SMTP 의존 0).
 * 실행: cd packages/backend && JWT_SECRET=test npx ts-node scripts/verify-email-ai.ts
 * 모든 단언 통과 시 exit 0, 하나라도 실패 시 exit 1.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-email-ai-secret';
process.env.PUBLIC_BASE_URL = 'https://app.hanjul.ai';

import {
  buildTrackingToken, verifyTrackingToken,
  wrapLinksForTracking, injectOpenPixel, applyTracking,
  UNSUB_URL_MARKER, buildUnsubscribeUrl,
} from '../src/utils/email-tracking';
import {
  hasUneditedPlaceholder, checkSubjectLength, countExternalLinks, binOpenHours, runEmailCodeChecks,
} from '../src/utils/email-ai';

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.error(`  FAIL  ${name}`); }
}

console.log('[1] 토큰 왕복 + 변조 거부');
{
  const tok = buildTrackingToken({ c: 'camp-1', e: 'a@b.com', u: 'https://shop.example.com/p?id=1' });
  const decoded = verifyTrackingToken(tok);
  ok('왕복 — campaignId 보존', decoded?.c === 'camp-1');
  ok('왕복 — email 보존', decoded?.e === 'a@b.com');
  ok('왕복 — url 보존', decoded?.u === 'https://shop.example.com/p?id=1');

  // payload 변조 (서명 불일치)
  const [p, s] = tok.split('.');
  const tampered = `${Buffer.from(JSON.stringify({ c: 'camp-1', e: 'evil@x.com' })).toString('base64url')}.${s}`;
  ok('변조 payload 거부', verifyTrackingToken(tampered) === null);
  ok('서명 제거 거부', verifyTrackingToken(p) === null);
  ok('빈 토큰 거부', verifyTrackingToken('') === null);
  ok('형식 오류 거부', verifyTrackingToken('garbage') === null);
}

console.log('[2] 링크 래핑 제외 규칙');
{
  const campaignId = 'c1';
  const email = 'u@e.com';
  const html = `
    <a href="https://shop.com/sale">세일</a>
    <a href="mailto:cs@shop.com">문의</a>
    <a href="tel:020000">전화</a>
    <a href="#top">위로</a>
    <a href="https://track.com/{{link}}">변수</a>
    <a href="/local/path">상대</a>`;
  const wrapped = wrapLinksForTracking(html, campaignId, email);
  ok('http 링크 래핑됨', wrapped.includes('/api/email/t/c/'));
  ok('mailto 제외', wrapped.includes('mailto:cs@shop.com'));
  ok('tel 제외', wrapped.includes('tel:020000'));
  ok('앵커 제외', wrapped.includes('href="#top"'));
  ok('변수 URL 제외', wrapped.includes('{{link}}'));
  ok('상대경로 제외', wrapped.includes('href="/local/path"'));
  // 이미 트래킹된 URL 이중 래핑 방지
  ok('이중 래핑 방지', wrapLinksForTracking(wrapped, campaignId, email).match(/\/api\/email\/t\/c\//g)?.length === 1);
}

console.log('[3] 오픈 픽셀 주입');
{
  const withBody = injectOpenPixel('<html><body><p>hi</p></body></html>', 'c1', 'u@e.com');
  ok('body 직전 주입', /<img[^>]+\/api\/email\/t\/o\/[^>]+><\/body>/.test(withBody));
  const noBody = injectOpenPixel('<p>hi</p>', 'c1', 'u@e.com');
  ok('body 없으면 말미 append', noBody.includes('/api/email/t/o/'));
}

console.log('[4] applyTracking 통합 — 수신거부 마커 치환');
{
  const html = `<body><a href="https://shop.com">상품</a><a href="${UNSUB_URL_MARKER}">수신거부</a></body>`;
  const out = applyTracking(html, 'c1', 'u@e.com');
  const unsubUrl = buildUnsubscribeUrl('c1', 'u@e.com');
  ok('수신거부 마커 → 개인 토큰 URL', out.includes(unsubUrl));
  ok('마커 잔존 0', !out.includes(UNSUB_URL_MARKER));
  ok('수신거부 URL은 클릭 트래킹 제외', !out.includes(`/t/c/`) || out.split('/api/email/t/c/').length === 2);
  ok('상품 링크는 클릭 트래킹', out.includes('/api/email/t/c/'));
  ok('픽셀 주입됨', out.includes('/api/email/t/o/'));
}

console.log('[5] placeholder 검출 (발송 차단)');
{
  ok('직접 입력 검출', hasUneditedPlaceholder('제목', '<p>[혜택을 직접 입력해주세요]</p>') === true);
  ok('작성해 검출', hasUneditedPlaceholder('[기간을 직접 작성해주세요]') === true);
  ok('정상 본문 통과', hasUneditedPlaceholder('여름 세일', '<p>20% 할인</p>') === false);
  ok('빈 값 통과', hasUneditedPlaceholder(null, undefined, '') === false);
}

console.log('[6] 제목 길이 + 링크 카운트');
{
  ok('40자 이하 정상', checkSubjectLength('짧은 제목').warn === false);
  ok('40자 초과 경고', checkSubjectLength('가'.repeat(41)).warn === true);
  ok('외부 링크 카운트', countExternalLinks('<a href="https://a.com">1</a><a href="https://b.com">2</a>') === 2);
  ok('mailto 미카운트', countExternalLinks('<a href="mailto:x@y.com">x</a>') === 0);
}

console.log('[7] 오픈 시간대 binning (실측 비중)');
{
  const binned = binOpenHours([{ hour: 9, cnt: 10 }, { hour: 14, cnt: 30 }, { hour: 20, cnt: 60 }]);
  ok('total 합산', binned.total === 100);
  ok('상위 1위 = 20시', binned.top[0].hour === 20 && binned.top[0].pct === 60);
  ok('내림차순 정렬', binned.top[0].cnt >= binned.top[1].cnt);
  const empty = binOpenHours([]);
  ok('빈 입력 total 0', empty.total === 0 && empty.top.length === 0);
}

console.log('[8] 기계 체크 (precheck 코드 영역)');
{
  const checks = runEmailCodeChecks({ subject: '여름 세일', htmlBody: '<a href="https://a.com">x</a>', textBody: '여름', isAd: true });
  const byKey = Object.fromEntries(checks.map((c) => [c.key, c]));
  ok('placeholder pass', byKey.placeholder.status === 'pass');
  ok('링크 pass', byKey.links.status === 'pass');
  ok('광고 표기 안내', byKey.ad_compliance.detail.includes('광고'));
  const bad = runEmailCodeChecks({ subject: '가'.repeat(50), htmlBody: '<p>[직접 입력해주세요]</p>', textBody: '', isAd: false });
  const badByKey = Object.fromEntries(bad.map((c) => [c.key, c]));
  ok('placeholder fail', badByKey.placeholder.status === 'fail');
  ok('제목 길이 warn', badByKey.subject_length.status === 'warn');
  ok('링크 없음 warn', badByKey.links.status === 'warn');
  ok('텍스트 본문 없음 warn', badByKey.text_body.status === 'warn');
}

console.log(`\n결과: ${pass} PASS / ${fail} FAIL`);
process.exit(fail === 0 ? 0 : 1);
