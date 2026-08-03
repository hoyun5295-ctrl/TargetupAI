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
import { SEND_TYPE_LABEL, SEND_TYPES, isSendTypeFilter } from './send-type-axis';
import { computeTypeComparison } from './multidim-comparison';
import { channelPlainLabel } from './campaign-list-csv';
import { mergeByChannelLabel } from './next-action-advisor';
import { CHANNEL_SOURCE_FIELD } from './performance-explainer';
import { getCompanyCosts } from '../config/defaults';
// 테스트 전용 import — 화면 CT의 **실제 값**을 비교한다(문자열 매칭은 주석만으로도 통과한다).
import * as frontAxis from '../../../frontend/src/utils/campaign-axis';

const read = (rel: string) => readFileSync(join(__dirname, rel), 'utf8');

/** 주석 제거 — 주석에 남은 값·컬럼명이 소스 스캔을 통과시키는 구멍을 막는다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/**
 * 캠페인 채널을 `message_type` 원값으로 화면에 찍는 곳을 찾는다.
 *
 * 알림톡·브랜드메시지는 `campaigns.message_type`이 전부 `'LMS'`다(카카오 구분은 `send_channel`).
 * 그래서 원값을 그대로 렌더하면 그 화면만 LMS로 보인다 — 2026-07-31에 발송결과·최근캠페인·캘린더·
 * 예약목록이 차례로 같은 부류로 드러났다.
 *
 * 판정 두 축:
 *   1) **JSX 표현식의 머리**가 그 접근이어야 한다. `{fmt(x.message_type)}`처럼 인자로 넘기는 것이나
 *      `{x.message_type === 'LMS' ? A : B}`처럼 규격을 판정해 다른 값을 그리는 것은 정당한 용도다.
 *   2) 그 변수가 **캠페인 객체**여야 한다. 템플릿·스팸테스트 결과도 같은 컬럼명을 쓰지만 그쪽의
 *      `message_type`은 문자 규격(SMS/LMS/MMS)이 맞는 표시다. 같은 파일에서 그 변수가
 *      `campaign_name`·`send_channel`·`send_type`으로도 쓰이는지로 가른다.
 *
 * ⚠ 정규식 스캔이라 **완전 차단은 아니다**(2026-07-31 적대검증 3R 수용 — AST 도입은 불수용).
 *   무엇을 잡고 무엇을 못 잡는지는 아래 fixture 테스트가 고정한다. 새 변형이 나오면 fixture부터 늘린다.
 */
export function findRawCampaignChannelRenders(rawSrc: string): string[] {
  const code = stripComments(rawSrc);
  const hits: string[] = [];
  const isCampaignVar = (v: string) =>
    new RegExp(`\\b${v}\\??\\.(campaign_name|send_channel|send_type)\\b`).test(code);

  // (가) 표현식 머리가 접근인 경우 — `{c.message_type}` `{c.message_type || '-'}` `{c.message_type?.toUpperCase()}`
  for (const m of code.matchAll(/\{\s*(\w+)\??\.message_type\b([^{}]*)\}/g)) {
    const [, v, tail] = m;
    if (/[!=]==/.test(tail)) continue; // 규격 판정 후 다른 값을 그리는 삼항 — 정당
    if (isCampaignVar(v)) hits.push(`${v}.message_type`);
  }
  // (나) 변환 함수·템플릿 리터럴로 감싼 경우 — `{String(c.message_type)}` / `{`${c.message_type}`}`
  for (const m of code.matchAll(/\{\s*(?:String\s*\(\s*|`[^`]*\$\{\s*)(\w+)\??\.message_type\b([^{}`]*)/g)) {
    if (/[!=]==/.test(m[2])) continue; // className 템플릿 안 규격 판정 — 값을 그리는 게 아니다
    if (isCampaignVar(m[1])) hits.push(`${m[1]}.message_type(변환)`);
  }
  // (다) 구조분해 후 맨이름 렌더 — `const { message_type } = c` 뒤의 `{message_type}`
  if (/\{[^{}]*\bmessage_type\b[^{}]*\}\s*=/.test(code) && /\{\s*message_type\s*\}/.test(code)) {
    if (/\b(campaign_name|send_channel|send_type)\b/.test(code)) hits.push('message_type(구조분해)');
  }
  return hits;
}

/** 소스 트리 순회 — 테스트 파일·빌드 산출물 제외. 여러 describe가 공유한다. */
function walkSrc(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walkSrc(p, out);
    } else if (/\.tsx?$/.test(name) && !name.endsWith('.test.ts')) {
      out.push(p);
    }
  }
  return out;
}

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
  it('backend src 전체에 IMC_BM 테이블을 읽고 쓰는 SQL이 없다', () => {
    const srcRoot = join(__dirname, '..');
    const offenders: string[] = [];
    for (const file of walkSrc(srcRoot)) {
      const text = readFileSync(file, 'utf8');
      // 주석 언급(폐기 기록)은 허용 — FROM/INSERT INTO/DELETE FROM/UPDATE 등 SQL 문맥만 잡는다.
      if (/(FROM|INTO|UPDATE|JOIN)\s+IMC_BM/i.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('화면 표시 축 — 채널·발송유형 판정이 한 곳이다 (2026-07-31)', () => {
  // 이번 결함의 부류 = "값을 늘렸는데 한쪽만 갱신". `kakao_brand`를 만들고 화면 판정을
  // 안 고쳐서 브랜드메시지가 화면마다 LMS로 나왔고, `auto`/`journey`를 만들고 라벨을
  // 안 고쳐서 자동발송·여정이 AI로 나왔다. 두 목록의 일치를 기계로 고정한다.
  //
  // ★ 소스 문자열 비교가 아니라 **실제 export된 값**을 비교한다(2026-07-31 적대검증 수용) —
  //   문자열 비교는 주석에 값이 남아 있기만 해도 통과해서 회귀를 못 잡는다.
  //   테스트에서만 프론트 파일을 import한다. 프론트 **빌드**는 여전히 백엔드를 모른다
  //   (2026-07-18 빌드 사고 이후 빌드 구조 무접촉 원칙).

  it('브랜드 채널 목록이 양쪽에서 정확히 같다', () => {
    expect([...frontAxis.BRAND_CAMPAIGN_CHANNELS].sort())
      .toEqual([...BRAND_CAMPAIGN_CHANNELS].sort());
  });

  it('브랜드 전용 판정이 양쪽에서 같은 답을 낸다 — both는 전량 브랜드가 아니다', () => {
    for (const v of ['kakao', 'kakao_brand', 'both', 'alimtalk', 'sms', '', null]) {
      expect(frontAxis.isBrandOnlyChannel({ send_channel: v as any })).toBe(isBrandOnlyChannel(v));
    }
  });

  it('발송유형 라벨 맵이 양쪽에서 정확히 같다 (키·값 양방향)', () => {
    expect(frontAxis.SEND_TYPE_LABEL).toEqual(SEND_TYPE_LABEL);
  });

  it('유형 필터 값 집합이 백엔드 SEND_TYPES와 같다 — 화면에만 필터가 늘면 서버가 무시한다', () => {
    const frontFilters = frontAxis.SEND_TYPE_FILTERS.filter((f) => f !== 'all');
    expect([...frontFilters].sort()).toEqual([...SEND_TYPES].sort());
    for (const f of frontFilters) expect(isSendTypeFilter(f)).toBe(true);
    expect(isSendTypeFilter('all')).toBe(false); // 'all'은 무필터라 SQL 조건이 되면 안 된다
  });

  it('모든 SEND_TYPES가 성과 분석에서 고유 라벨을 갖는다 — 하나라도 기타로 떨어지면 그 발송이 사라진다', () => {
    const labels = SEND_TYPES.map((t) => computeTypeComparison([{ sendType: t, sent: 1, success: 1 }])[0].label);
    expect(labels).not.toContain('기타');
    expect(new Set(labels).size).toBe(SEND_TYPES.length);
  });

  it('화면이 send_channel/send_type 리터럴로 직접 판정하지 않는다', () => {
    // 판정이 화면으로 새면 CT를 고쳐도 그 화면만 옛 기준으로 남는다 — 이번 결함이 정확히 그것이다.
    const frontRoot = join(__dirname, '../../../frontend/src');
    const offenders: string[] = [];
    for (const file of walkSrc(frontRoot)) {
      if (file.replace(/\\/g, '/').endsWith('/utils/campaign-axis.ts')) continue; // CT 자신은 예외
      const code = stripComments(readFileSync(file, 'utf8'));
      // 작은따옴표·큰따옴표·백틱 전부 — 따옴표만 바꿔도 통과하던 구멍을 막는다.
      if (/send_channel\s*===\s*['"`]/.test(code)) offenders.push(`${file} (send_channel 리터럴)`);
      if (/send_type\s*===\s*['"`](direct|ai|auto|journey|manual)['"`]/.test(code)) {
        offenders.push(`${file} (send_type 리터럴)`);
      }
    }
    expect(offenders).toEqual([]);
  }, 60_000); // frontend 전체 파일 스캔 — 트리가 자라며 기본 5초를 넘겨 pre-push를 간헐 차단(2026-08-03 실측 9.2초)

  it('검출기가 원값 렌더 변형을 잡고 정당한 용도는 통과시킨다 (fixture)', () => {
    // 검출기 자신을 먼저 고정한다 — 스캐너가 아무것도 못 잡으면 아래 전수 스캔은 항상 녹색이다.
    const campaign = 'const x = c.campaign_name;'; // 캠페인 변수로 인식시키는 최소 문맥
    const caught = [
      '<div>{c.message_type}</div>',
      "<div>{c.message_type || '-'}</div>",
      "<div>{c.message_type ?? '-'}</div>",                        // 널병합 폴백
      '<div>{c.message_type?.toUpperCase()}</div>',
      '<div>{String(c.message_type)}</div>',
      '<div>{`${c.message_type}`}</div>',
      'const { message_type } = c; <div>{message_type}</div>',      // 구조분해 후 맨이름 렌더
    ];
    for (const s of caught) {
      expect(findRawCampaignChannelRenders(campaign + s), s).not.toEqual([]);
    }
    const passed = [
      "<div>{c.message_type === 'LMS' ? '장문' : '단문'}</div>",   // 규격 판정 후 다른 값 렌더
      "<div className={`x ${c.message_type === 'LMS' ? 'a' : 'b'}`}>y</div>", // className 안 규격 판정
      '<div>{buildAdSubjectFront(s, c.message_type, a)}</div>',    // 포매터 인자로 전달
      '<div>{resolveChannelLabel(c)}</div>',                       // CT 사용 = 정답
      '<div>{t.message_type}</div>',                               // 템플릿(캠페인 필드 없음)
      "<div>{/* c.message_type 원값 금지 */}</div>",                // 주석 언급
    ];
    for (const s of passed) {
      expect(findRawCampaignChannelRenders(campaign + s), s).toEqual([]);
    }
    // 캠페인 필드가 없는 파일(템플릿 화면)의 구조분해는 통과해야 한다.
    expect(findRawCampaignChannelRenders('const { message_type } = t; <div>{message_type}</div>')).toEqual([]);
  });

  it('백엔드 채널 라벨도 CT 판정을 쓴다 — 엑셀·AI 프롬프트가 화면과 다른 이름을 쓰면 안 된다', () => {
    expect(channelPlainLabel('kakao', 'LMS')).toBe('브랜드메시지');
    expect(channelPlainLabel('kakao_brand', 'LMS')).toBe('브랜드메시지'); // 전용 발송이 빠지던 자리
    expect(channelPlainLabel('alimtalk', 'LMS')).toBe('알림톡');
    expect(channelPlainLabel('sms', 'LMS')).toBe('LMS');
    // 판정을 리터럴로 되돌리면 다음 채널값에서 또 갈라진다.
    expect(read('./campaign-list-csv.ts')).toContain('isBrandOnlyChannel');
  });

  it('채널 성과 집계가 kakao와 kakao_brand를 한 줄로 합친다', () => {
    // 라벨로 합치지 않으면 같은 브랜드메시지가 두 줄로 갈려 AI가 채널을 둘로 읽는다.
    const merged = mergeByChannelLabel([
      { send_channel: 'kakao', message_type: 'LMS', sent: '10', success: '9' },
      { send_channel: 'kakao_brand', message_type: 'LMS', sent: '5', success: '5' },
      { send_channel: 'sms', message_type: 'LMS', sent: '100', success: '90' },
    ]);
    expect(merged.map((m) => m.channel)).toEqual(['LMS', '브랜드메시지']); // 발송량 내림차순
    const brand = merged.find((m) => m.channel === '브랜드메시지')!;
    expect(brand.sent).toBe(15);
    expect(brand.success).toBe(14);
  });

  it('채널 요인의 데이터 출처가 두 컬럼을 명시한다 — 한 컬럼만으로는 재현이 안 된다', () => {
    expect(CHANNEL_SOURCE_FIELD).toContain('send_channel');
    expect(CHANNEL_SOURCE_FIELD).toContain('message_type');
    // 프롬프트 예시에 옛 한 컬럼 출처가 남으면 AI가 그대로 베낀다.
    expect(read('./performance-explainer.ts')).not.toContain('"campaigns.message_type + success_count"');
  });

  it('SQL이 축 컬럼에 다른 이름을 붙이지 않는다 — 별칭은 축 grep을 은폐한다', () => {
    // ★ 2026-07-31 적대검증 3R 기원. `c.send_type as campaign_type` 별칭 탓에 슈퍼관리자 화면의
    //   이분법이 send_type 전수 grep에 안 잡혔다. 축 이름은 SQL에서 화면까지 그대로 간다.
    const srcRoot = join(__dirname, '..');
    const offenders: string[] = [];
    for (const file of walkSrc(srcRoot)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      // `message_type AS channel`도 대상이다 — 알림톡·브랜드가 전부 'LMS'라 그건 채널이 아니고,
      // 그 이름 때문에 세 채널이 LMS 한 줄로 합쳐져 AI에 들어가고 있었다(0731 3R 발견 → 4R 정정).
      for (const m of code.matchAll(/\b(send_type|send_channel|message_type)\s+as\s+(\w+)/gi)) {
        if (m[1].toLowerCase() !== m[2].toLowerCase()) offenders.push(`${file} (${m[0]})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('화면이 캠페인 채널을 message_type 원값으로 찍지 않는다', () => {
    const frontRoot = join(__dirname, '../../../frontend/src');
    const offenders: string[] = [];
    for (const file of walkSrc(frontRoot)) {
      for (const hit of findRawCampaignChannelRenders(readFileSync(file, 'utf8'))) {
        offenders.push(`${file} (${hit})`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('브랜드 전용 발송 INSERT가 축 컬럼을 전부 남긴다 — 빠진 컬럼은 DEFAULT가 거짓값으로 채운다', () => {
    // 주석을 걷어내고 INSERT 문 자체만 본다(주석에 컬럼명을 적어두면 통과하던 구멍).
    const camp = stripComments(readFileSync(join(__dirname, '../routes/campaigns.ts'), 'utf8'));
    const at = camp.indexOf("'kakao_brand'");
    expect(at).toBeGreaterThan(0);
    const stmt = camp.slice(camp.lastIndexOf('INSERT INTO campaigns', at), camp.indexOf('RETURNING id', at));
    for (const col of [
      'send_type', 'callback_number', 'target_count', 'is_ad',
      'kakao_bubble_type', 'kakao_sender_key', 'kakao_targeting', 'kakao_resend_type',
    ]) {
      expect(stmt, `brand-send INSERT에 ${col} 누락`).toContain(col);
    }
    expect(stmt).toContain("'direct'");
  });

  it('여정 캠페인 INSERT가 send_type=journey를 남긴다', () => {
    const j = stripComments(read('./journey-step-campaign.ts'));
    const stmt = j.slice(j.indexOf('INSERT INTO campaigns'), j.indexOf('RETURNING id'));
    expect(stmt).toContain('send_type');
    expect(stmt).toContain("'journey'");
  });

  it('캠페인 목록 응답이 send_channel을 실어 보낸다 — 없으면 화면 CT가 message_type으로 폴백한다', () => {
    const camp = stripComments(readFileSync(join(__dirname, '../routes/campaigns.ts'), 'utf8'));
    // 목록 쿼리 고유 컬럼 조합을 앵커로 잡는다(다른 SELECT 상수에 걸리지 않게).
    const at = camp.indexOf('c.id, c.company_id, c.created_by, c.campaign_name');
    expect(at).toBeGreaterThan(0);
    const select = camp.slice(at, camp.indexOf('FROM campaigns c', at));
    expect(select).toContain('c.send_channel');
  });

  it('발송결과 요약이 브랜드 단가를 실어 보낸다 — 없으면 화면이 알림톡 단가로 계산한다', () => {
    const results = stripComments(readFileSync(join(__dirname, '../routes/results.ts'), 'utf8'));
    expect(results).toContain('cost_per_brand');
    expect(results).toContain('perBrand');
    expect(getCompanyCosts({ cost_per_brand: 0, unit_price_basis: 'vat_included' }).brand).toBe(0);
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
