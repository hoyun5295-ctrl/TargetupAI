/**
 * 화면 토큰 불변식 — 소스 전수 스캔 (2026-08-17 신설)
 *
 * 기원: 마케팅 진단 화면을 새로 그리면서 앱 표준에 없는 값을 즉석에서 만들었고
 *   (`disabled:opacity-25` · `text-[10.5px] text-white/28`), 그 결과 다크 배경에서 글씨가
 *   배경에 묻혀 Harold가 화면을 하나씩 짚어 잡아야 했다. tsc는 색을 모르고 기존 계약 테스트는
 *   문구·값만 본다 — 그래서 사람 눈이 최종 검사가 됐다. **표준 밖 값을 만드는 것 자체를 막는다.**
 *
 * 이 파일이 잠그는 것 (전부 값 대조 — 오탐 0인 규칙만 둔다)
 *   1. 비활성 투명도는 앱 표준 집합 안의 값만 쓴다.
 *   2. Data source 캡션은 한 벌 클래스만 쓴다(카드·차트 공통 규약).
 *   3. 라이트 페이지에 인라인으로 놓이는 진단 히어로는 배경 알파를 쓰지 않는다.
 *
 * ⛔ **넣지 않은 규칙** — "라이트 표면 컴포넌트에 다크 전제 색 금지"는 정적으로 판별할 수 없다.
 *   `<main>` 안에 있어도 대부분 모달이고, `from-gray-50/60 to-white`처럼 라이트 배경에 어두운
 *   글씨를 쓰는 파일까지 함께 걸린다(실측: 후보 11 중 9가 오탐). 오탐이 쌓이는 테스트는 무시되므로
 *   그 축은 사람 눈(표면 전수 점검)이 맡는다. 규칙을 늘릴 때도 이 기준을 지킨다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { scanSources, SCAN_TIMEOUT_MS } from './source-scan';

const FRONT_SRC = resolve(__dirname, '../../../../frontend/src');

/** 앱 표준 비활성 투명도(2026-08-17 실측 분포: 40=247 · 50=171 · 30=105 · 60=4). */
const ALLOWED_DISABLED_OPACITY = new Set(['30', '40', '50', '60']);

/** Data source 캡션 한 벌 — 전 카드·차트 공통(LESSONS_FRONTEND 톤앤매너 매트릭스). */
const DATA_SOURCE_CAPTION_CLASS = 'text-[10px] italic text-white/30';

describe('화면 토큰 불변식 (frontend 전수 스캔)', () => {
  it('비활성 투명도는 앱 표준 값만 쓴다 — 표준 밖은 "안 보이는 글씨"가 된다', () => {
    const offenders: string[] = [];
    for (const { rel, src } of scanSources(FRONT_SRC)) {
      for (const m of src.matchAll(/disabled:opacity-(\d+)/g)) {
        if (!ALLOWED_DISABLED_OPACITY.has(m[1])) offenders.push(`${rel} (${m[0]})`);
      }
    }
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  /**
   * 값만 본다 — 클래스 순서는 파일마다 다르고 캡션이 prop·변수로 들어가는 형태도 있어
   * "한 벌 문자열 일치"는 오탐 135건이 났다(실측). 라이트 화면의 회색 캡션(text-slate-400 등)도 정상이다.
   * 그래서 **흰색 계열을 쓸 때의 명도와 크기**만 강제한다 — 실제로 어긋난 것만 걸린다.
   */
  it('Data source 캡션은 흰색 계열일 때 표준 명도·크기를 지킨다', () => {
    const offenders: string[] = [];
    for (const { rel, src } of scanSources(FRONT_SRC)) {
      for (const line of src.split('\n')) {
        if (!line.includes('Data source')) continue;
        for (const m of line.matchAll(/text-white\/(\d+)/g)) {
          if (m[1] !== '30') offenders.push(`${rel} :: ${m[0]} (표준 text-white/30)`);
        }
        for (const m of line.matchAll(/text-\[([\d.]+)px\]/g)) {
          if (m[1] !== '10') offenders.push(`${rel} :: ${m[0]} (표준 text-[10px])`);
        }
      }
    }
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  /**
   * 흰색 명도는 5단위 사다리(25·30·…·90)만 쓴다. 앱 전체가 이미 그 사다리 위에 있었고,
   * 벗어난 값은 진단 화면을 새로 그리며 만든 3개뿐이었다(실측 — /42 · /62 · /66).
   * 임의 값이 하나 생기면 "어디가 표준인지" 판단 근거가 사라지고 사람 눈이 최종 검사가 된다.
   */
  it('흰색 명도는 5단위 사다리 값만 쓴다', () => {
    const offenders: string[] = [];
    for (const { rel, src } of scanSources(FRONT_SRC)) {
      for (const m of src.matchAll(/text-white\/(\d+)/g)) {
        if (Number(m[1]) % 5 !== 0) offenders.push(`${rel} (${m[0]})`);
      }
    }
    expect(offenders).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  /**
   * 진단 히어로는 **라이트 대시보드에 인라인으로** 놓이는 유일한 진단 표면이다.
   * 알파 배경은 흰 배경에서 연해져 흰 글씨를 지운다(2026-08-17 Harold "저게 보이냐" 원인).
   * 파일을 지정한 계약이라 오탐이 없다 — 라이트 표면이 늘면 그때 이 목록에 더한다.
   */
  it('진단 히어로(라이트 표면)는 배경 알파를 쓰지 않는다', () => {
    const src = readFileSync(resolve(FRONT_SRC, 'components/marketing-diagnosis/DiagnosisHeroCard.tsx'), 'utf-8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');   // 주석의 사고 기록은 대상 아님
    const alphaStops: string[] = [];
    for (const m of code.matchAll(/bg-gradient-to-[a-z]+((?:\s+(?:from|via|to)-[a-z]+-\d+(?:\/\d+)?)+)/g)) {
      if (/\/\d+/.test(m[1])) alphaStops.push(m[0]);
    }
    expect(alphaStops).toEqual([]);
    // 흰 글씨가 놓이므로 배경은 어두운 계열이어야 한다(불투명 + 진한 색)
    expect(code).toContain('text-white');
    expect(code).toMatch(/from-(indigo|violet|slate|sky)-[6-9]00/);
  }, SCAN_TIMEOUT_MS);
});
