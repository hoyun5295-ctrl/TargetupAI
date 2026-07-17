/**
 * email-tracking-wrap.test.ts — 클릭 추적 링크 래핑 회귀 고정 (2026-07-13)
 *
 * Codex 적대 리뷰 지적 정정 고정: 불릿프루프 버튼의 MSO VML(<v:roundrect href>)도
 * <a href>와 동일하게 추적 URL로 래핑돼야 한다(아웃룩 데스크탑 클릭 미집계 차단).
 */
import { describe, it, expect, beforeAll } from 'vitest';

// ★ 2026-07-17 flaky 정정 — 모듈 최초 동적 import(전이 의존 변환 비용 수 초, 부하 시 5,418ms 실측)가
//   개별 테스트 5초 타임아웃 안에서 결제돼 pre-push가 간헐 차단되던 근본. import를 훅으로 이동(30초).
//   EMAIL_TRACKING_SECRET을 import 전에 설정하는 순서는 보존. 검증 로직 무변경.
let wrapLinksForTracking: (html: string, sendId: string, email: string) => string;

beforeAll(async () => {
  process.env.EMAIL_TRACKING_SECRET = 'test-secret-for-wrap';
  ({ wrapLinksForTracking } = await import('../email-tracking'));
}, 30_000);

describe('wrapLinksForTracking — a + v:roundrect 동시 래핑', () => {
  it('<a href>와 <v:roundrect href> 둘 다 /api/email/t/c/ 추적 URL로 래핑', () => {
    const html = '<!--[if mso]><v:roundrect href="https://shop.example.com/a" arcsize="30%"><center>보기</center></v:roundrect><![endif]--><!--[if !mso]><!--><a href="https://shop.example.com/a">보기</a><!--<![endif]-->';
    const out = wrapLinksForTracking(html, '11111111-1111-1111-1111-111111111111', 'user@example.com');
    expect(out).not.toContain('href="https://shop.example.com/a"'); // 원본 직행 0
    const tracked = out.match(/\/api\/email\/t\/c\//g) || [];
    expect(tracked.length).toBe(2); // a + roundrect 둘 다
  });

  it('제외 규칙 유지 — mailto/변수/이미 추적 URL은 그대로 (roundrect 포함)', () => {
    const html = '<a href="mailto:cs@example.com">문의</a>'
      + '<a href="{{ customer.link }}">개인화</a>'
      + '<v:roundrect href="https://app.hanjul.ai/api/email/t/c/abc.def"><center>기추적</center></v:roundrect>';
    const out = wrapLinksForTracking(html, '11111111-1111-1111-1111-111111111111', 'user@example.com');
    expect(out).toContain('href="mailto:cs@example.com"');
    expect(out).toContain('href="{{ customer.link }}"');
    expect(out).toContain('href="https://app.hanjul.ai/api/email/t/c/abc.def"');
    expect((out.match(/\/api\/email\/t\/c\//g) || []).length).toBe(1); // 이중 래핑 0
  });
});

describe('isPrivateIp — DNS 해석 SSRF 가드 판정 (dm-brand-extractor)', () => {
  it('사설·예약·루프백·링크로컬·매핑 v6 = 차단, 공인 = 통과', async () => {
    const { isPrivateIp } = await import('../dm/dm-brand-extractor');
    for (const bad of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '169.254.169.254', '0.0.0.0', '100.64.0.1', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12::1', 'fe80::1', 'ff02::1', '::ffff:10.0.0.1', '::ffff:127.0.0.1']) {
      expect(isPrivateIp(bad), bad).toBe(true);
    }
    for (const ok of ['8.8.8.8', '211.233.1.10', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isPrivateIp(ok), ok).toBe(false);
    }
  });
});
