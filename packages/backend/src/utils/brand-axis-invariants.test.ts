/**
 * 브랜드메시지 축 불변식 — 2026-07-29 신설 (Codex 적대검증 4건의 재발 차단)
 *
 * 이번 사고 부류는 전부 하나다: **같은 발송을 보는 두 지점이 서로 다른 기준을 쓴다.**
 *   · 일자 집계는 `BRAND`인데 상세 집계는 `KAKAO` → 축 대조가 발행을 422로 막는다
 *   · 집계 WHERE는 `kakao`/`both`인데 전용 발송은 `kakao_brand` → 그 발송이 통째로 0건
 *   · 유틸은 `brand`로 차감하는데 라우트는 `KAKAO`로 차감 → 계약과 다른 단가가 움직인다
 *
 * 런타임 테스트로는 안 잡힌다(DB·게이트웨이가 있어야 한다). 그래서 소스를 스캔한다 —
 * `unit-price-invariants.test.ts`와 같은 방식이고, 그 파일이 생긴 이유도 같다.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { BRAND_CAMPAIGN_CHANNELS, BRAND_CHANNEL_SQL_IN, isBrandOnlyChannel, resolveRefundAxes, BILLING_TYPES } from './billing-types';
import { MSG_TYPE_TO_USAGE_KEY } from './send-usage-aggregation';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

describe('브랜드 채널 판정 — 단일 기준', () => {
  it('전용 발송 채널(kakao_brand)이 집계 대상에 들어 있다', () => {
    // 빠지면 POST /brand-send 발송이 일자·상세 양쪽에서 0건이 된다.
    expect(BRAND_CAMPAIGN_CHANNELS).toContain('kakao_brand');
    expect(BRAND_CAMPAIGN_CHANNELS).toContain('kakao');
    expect(BRAND_CAMPAIGN_CHANNELS).toContain('both');
    for (const c of BRAND_CAMPAIGN_CHANNELS) expect(BRAND_CHANNEL_SQL_IN).toContain(`'${c}'`);
  });

  it('both는 전량 브랜드가 아니다 — 문자분은 message_type으로 차감된다', () => {
    expect(isBrandOnlyChannel('kakao')).toBe(true);
    expect(isBrandOnlyChannel('kakao_brand')).toBe(true);
    expect(isBrandOnlyChannel('both')).toBe(false);
    expect(isBrandOnlyChannel('sms')).toBe(false);
    expect(isBrandOnlyChannel(null)).toBe(false);
  });
});

describe('브랜드 SMSQ 합류 (2026-07-30 재구축) — 정산·환불 축', () => {
  it("SMSQ 'F'가 BRAND 청구 키로 변환된다 — 빠지면 브랜드 발송이 0원 청구", () => {
    expect(BILLING_TYPES.find((t) => t.key === 'BRAND')?.smsqCode).toBe('F');
    expect(MSG_TYPE_TO_USAGE_KEY.F).toBe('BRAND');
  });

  it('환불 축 판정 — 브랜드 전용=BRAND 단일 / both=문자+브랜드 분리 / 그 외=message_type 단일', () => {
    expect(resolveRefundAxes('kakao', 'LMS')).toEqual([{ type: 'BRAND', scope: 'all' }]);
    expect(resolveRefundAxes('kakao_brand', 'LMS')).toEqual([{ type: 'BRAND', scope: 'all' }]);
    expect(resolveRefundAxes('both', 'LMS')).toEqual([
      { type: 'LMS', scope: 'nonBrand' },
      { type: 'BRAND', scope: 'brand' },
    ]);
    expect(resolveRefundAxes('sms', 'SMS')).toEqual([{ type: 'SMS', scope: 'all' }]);
    expect(resolveRefundAxes('alimtalk', 'LMS')).toEqual([{ type: 'LMS', scope: 'all' }]);
  });
});

describe('차감 축 — 채널 리터럴 판정 금지 (0730 적대검증 critical 재발 차단)', () => {
  it('대량 직접발송 차감이 축 판정 CT를 쓴다 — 채널 리터럴로 KAKAO를 되살리면 브랜드가 알림톡 단가로 깎인다', () => {
    const core = read('./direct-send-core.ts');
    expect(core).toContain('resolveRefundAxes');
    expect(core).not.toMatch(/===\s*'kakao'\s*\?\s*'KAKAO'/);
  });

  it('워커 미적재 환불도 같은 축 CT를 쓴다', () => {
    const worker = read('./direct-send-worker.ts');
    expect(worker).toContain('resolveRefundAxes');
    expect(worker).not.toMatch(/===\s*'kakao'\s*\?\s*'KAKAO'/);
  });

  it('브랜드 전용 발송(CT-12)의 원장 키는 정규형 BRAND뿐이다 — 소문자는 후속 환불이 원장을 못 찾는다', () => {
    const bm = read('./brand-message.ts');
    expect(bm).not.toMatch(/prepaid(Deduct|Refund)\([^)]*'brand'/);
  });
});

describe('유령 테이블 참조 0건 (소스 스캔) — 재구축 회귀 차단', () => {
  // IMC_BM_* 테이블은 운영 MySQL에 실재한 적이 없다(1146). 참조가 되살아나면
  // 그 경로는 "차감은 되고 발송은 조용히 실패"로 돌아간다 — SQL 문자열 참조를 전수 차단한다.
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name === 'node_modules' || name === 'dist') continue;
        walk(p, out);
      } else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) {
        out.push(p);
      }
    }
    return out;
  };

  it('backend src 전체에 IMC_BM 테이블을 읽고 쓰는 SQL이 없다', () => {
    const srcRoot = join(__dirname, '..');
    const offenders: string[] = [];
    for (const file of walk(srcRoot)) {
      const text = readFileSync(file, 'utf8');
      // 주석 언급(폐기 기록)은 허용 — FROM/INSERT INTO/DELETE FROM/UPDATE 등 SQL 문맥만 잡는다.
      if (/(FROM|INTO|UPDATE|JOIN)\s+IMC_BM/i.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('차감·환불이 브랜드 축을 쓴다 (소스 스캔)', () => {
  it('브랜드 전용 유틸이 kakao로 차감하지 않는다', () => {
    const bm = read('./brand-message.ts');
    expect(bm).not.toMatch(/prepaid(Deduct|Refund)\([^)]*'kakao'/);
  });

  it('캠페인 라우트가 채널 리터럴로 차감 유형을 정하지 않는다', () => {
    const camp = read('../routes/campaigns.ts');
    // `sendChannel === 'kakao' ? 'KAKAO'` 같은 판정이 되살아나면 유틸과 라우트가 갈라진다.
    expect(camp).not.toMatch(/(sendChannel|directChannel)\s*===\s*'kakao'\s*\?/);
  });
});
