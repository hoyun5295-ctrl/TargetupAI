/**
 * brand-fonts.ts — 브랜드 학습 "브랜드킷" 탭 서체 드롭다운 목록 (2026-07-21 통합).
 *
 * Harold 지시: 서체 그리드 나열 폐기 → 드롭다운, 한글/영문 각각 따로 선택.
 * value = 실제 CSS font-family 문자열(기존 brand_kit.font_family 저장 형식과 동일 = 렌더 하위호환).
 * 소스 = DM_FONT_CATALOG(큐레이션 12종) 단일 진실 파생 — 별도 목록 신설 금지.
 *
 * 렌더 규약(Phase 8): 최종 스택 = `${font_en}, ${font_ko}` (라틴은 영문 서체, 한글은 한글 서체가 처리).
 * 미설정 시 normalizeBrandKit이 font_family/font_display로 폴백(회귀 0).
 */
import { DM_FONT_CATALOG } from './dm-tokens';

export type FontOption = { value: string; label: string };

/** 한글용 서체 = 큐레이션 카탈로그 전부(전부 한글 primary). */
export const BRAND_FONT_KO_OPTIONS: ReadonlyArray<FontOption> = DM_FONT_CATALOG.map((f) => ({
  value: f.css,
  label: f.label,
}));

/** 영문용 서체 = "한글 서체와 동일"(기본·빈 값) + 웹세이프 라틴 폰트(한글 글리프 없음 = 시스템 폰트·로딩 불필요).
 *  ★ 2026-07-21 (Codex 지적) 한글겸용 폰트를 앞에 두면 한글까지 처리해 분리가 안 됨 → 라틴 전용 폰트만 제공.
 *  렌더 스택 = `${font_en}, ${font_ko}`: 라틴은 영문 폰트, 한글은 (영문 폰트에 없어) font_ko로 폴백. value엔 제네릭 미포함(제네릭이 font_ko 앞에 끼면 한글이 시스템 기본으로 샘). */
export const BRAND_FONT_EN_OPTIONS: ReadonlyArray<FontOption> = [
  { value: '', label: '한글 서체와 동일' },
  { value: 'Arial', label: 'Arial (산세리프)' },
  { value: '"Helvetica Neue", Helvetica', label: 'Helvetica' },
  { value: 'Georgia', label: 'Georgia (세리프)' },
  { value: '"Times New Roman"', label: 'Times New Roman (세리프)' },
  { value: 'Verdana', label: 'Verdana' },
  { value: '"Courier New"', label: 'Courier (고정폭)' },
];
