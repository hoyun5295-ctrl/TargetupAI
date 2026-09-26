/**
 * 웹훅 중복 수신이 원래 행의 상태를 덮지 않는다 (★2026-09-26 한줄로 V2 R1-02 · 같은 모양 5곳)
 *
 * 같은 이벤트가 다시 오면 원래 전달 행을 `status='duplicate'`로 덮었다. 처리 실패로 재처리(cdp-webhook-retry-worker ·
 * status='failed'만 집는다)를 기다리던 행이 대상에서 빠져 그 주문·회원 이벤트가 영구 유실됐다.
 * 처방: 중복 표시는 원래 행이 이미 처리 완료(processed)일 때만 — 실패·처리 중 행은 그대로 둔다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROUTES = ['cafe24.ts', 'cdp.ts', 'imweb.ts', 'naver-commerce.ts', 'woocommerce.ts'];

describe('웹훅 중복 표시', () => {
  for (const f of ROUTES) {
    it(`${f} — 중복 표시는 처리 완료 행에만`, () => {
      const src = readFileSync(join(__dirname, '..', '..', 'routes', f), 'utf8');
      const i = src.indexOf("SET status = 'duplicate', processed_at = NOW()");
      expect(i).toBeGreaterThan(-1);
      const stmt = src.slice(i, src.indexOf('`', i));
      expect(stmt).toContain("AND status = 'processed'");
    });
  }
});
