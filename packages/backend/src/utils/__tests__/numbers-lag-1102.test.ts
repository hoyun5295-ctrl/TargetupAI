/**
 * 엔진 재설계 E8 · E9 — 정확한 숫자 · 밀림이 보인다(★ 2026-11-02 · 설계서 docs/2026-11-01-journey-automarketing-engine-design.md)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isLinkPreviewAgent, isMobileUserAgent } from '../korean-ecommerce-domains';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

describe('E8-1 링크 미리보기 · 로봇 = 클릭 아님', () => {
  it('미리보기 · 검색 로봇 = 참', () => {
    for (const ua of [
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Mozilla/5.0 (compatible; kakaotalk-scrap/1.0; +https://devtalk.kakao.com/)',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Twitterbot/1.0',
      'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Mozilla/5.0 (compatible; Yeti/1.1; +http://naver.me/spd)',
      'TelegramBot (like TwitterBot)',
      'Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)',
    ]) expect(isLinkPreviewAgent(ua), ua).toBe(true);
  });
  it('사람 브라우저(카카오톡 · 네이버 앱 안 브라우저 · 단말 이름에 bot) = 거짓', () => {
    for (const ua of [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.0',
      'Mozilla/5.0 (Linux; Android 13; SM-S918N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 12.1.0)',
      'Mozilla/5.0 (Linux; Android 9; CUBOT X19 Build/PPR1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0 Mobile Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      '',
    ]) expect(isLinkPreviewAgent(ua), ua).toBe(false);
    expect(isMobileUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) KAKAOTALK')).toBe(true);
  });
  it('넘김 = 그대로 · 세기 전에 HEAD · 미리보기면 끝(클릭 수 · 클릭 사건 · A/B 보상 0)', () => {
    const r = read('../routes/short-url.ts');
    const redirect = r.indexOf('res.redirect(302, resolved.fullUrl);');
    const gate = r.indexOf("if (req.method === 'HEAD' || isLinkPreviewAgent(userAgent)) return;");
    expect(redirect).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(redirect);
    expect(gate).toBeLessThan(r.indexOf('void trackEvent(resolved.companyId'));
    expect(gate).toBeLessThan(r.indexOf('recordVariantClickConversion(resolved.variantId'));
  });
});

describe('E8-2 이메일 고유 오픈 = 잠금 키와 같은 소문자 비교', () => {
  it('첫 발생 확인 = lower(email) = lower($2)', () => {
    const e = read('email-channel.ts');
    expect(e).toContain("pg_advisory_xact_lock(hashtext($1))`, [`email-evt:${campaignId}:${String(email).toLowerCase()}:${eventType}`]");
    expect(e).toContain('AND lower(email) = lower($2) AND event_type = $3 LIMIT 1');
    expect(e).not.toContain('AND email = $2 AND event_type = $3 LIMIT 1');
  });
});

describe('E9 밀림 경보 = 원인 하나 · 회사 없음 · 1시간', () => {
  it('실행기 · 진입 감시 · 스팸 큐 · 한 번 보내기', () => {
    for (const [f, key] of [
      ['journey-executor.ts', 'journey-executor-lag'],
      ['journey-trigger-watcher.ts', 'journey-watcher-budget'],
      ['spam-test-queue.ts', 'spam-queue-lag'],
      ['journey-anchor-scheduler.ts', 'journey-one-shot-lag'],
    ] as const) {
      const src = read(f);
      expect(src, f).toMatch(new RegExp(`companyId: null, dedupKey: '${key}', cooldownMs: 60 \\* 60 \\* 1000`));
    }
    expect(read('journey-executor.ts')).toMatch(/if \(isWithinSendHours\(\)\) \{\s+await query\(/);
  });
});

describe('E1-4 AI 한줄로 서버 적재 = 보여 준 명단 = 나가는 명단', () => {
  it('commit = 서명이 올 때만 · 자기 제외(회신번호 · 중복 · 수신거부) 뒤 · 차감(캠페인 생성) 전에 대조 · 다르면 409', () => {
    const c = read('../routes/campaigns.ts');
    const start = c.indexOf("router.post('/direct-send/commit'");
    const body = c.slice(start, c.indexOf('router.post(', start + 10));
    const sig = body.indexOf("if (typeof signature === 'string' && signature) {");
    expect(sig).toBeGreaterThan(body.indexOf('await countStagingFiltered('));
    expect(sig).toBeGreaterThan(body.indexOf('planIndividualCallbackExclusion('));
    expect(sig).toBeLessThan(body.indexOf('await createDirectSendCampaign('));
    expect(body).toContain("code: 'RECIPIENTS_CHANGED'");
  });
  it('적재 경로 = 같은 조건 · 같은 게이트 · 중복 · 회신번호 제외를 적재 표에서 실제로 뺀다 · 입구 1만 거절 0', () => {
    const r = read('../routes/ai.ts');
    const st = r.slice(r.indexOf('if (req.body?.stage === true) {'), r.indexOf('const { sql, params } = buildSendableRecipientsSql(filterWhere'));
    expect(st).toContain('buildSendableStagingInsertSql(stagingId, baseParams, filterWhere, filterParams, storeFilter, recipientGates');
    expect(st).toContain('await dedupStagingRows(stagingId, companyId)');
    expect(st).toContain('planIndividualCallbackExclusion(');
    expect(st).toContain('stagingSendSignature(');
    expect(read('../services/ai-line.ts')).not.toContain("'TARGET_TOO_MANY'");
  });
});
