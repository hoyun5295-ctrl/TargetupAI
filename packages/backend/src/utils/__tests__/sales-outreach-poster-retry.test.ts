// ★ 2026-09-09(5) 포스터 재시도 판정 — 스튜디오 일시 장애(503 과부하 · 429 한도 · 502)만 재시도, 세이프티·미준비·저장 실패는 즉시 포기
//   (톤28 실측 B-0909-3: 모델 503 1회에 포스터를 접어 히어로가 글자 없는 정물 배너로 떨어졌다)
import { describe, it, expect } from 'vitest';
import { isTransientStudioError, OUTREACH_POSTER_RETRY_DELAYS_MS } from '../sales-outreach-produce';
import { StudioError } from '../image-studio';

describe('isTransientStudioError', () => {
  it('503 과부하(GEN_FAILED 502 · RATE_LIMITED 429)는 재시도 대상', () => {
    expect(isTransientStudioError(new StudioError('GEN_FAILED', 502, true))).toBe(true);
    expect(isTransientStudioError(new StudioError('RATE_LIMITED', 429, true))).toBe(true);
    expect(isTransientStudioError(new StudioError('PY_SERVICE_DOWN', 503, true))).toBe(true);
  });
  it('미준비(키 없음 503)·세이프티 거부(400)·일반 Error 는 즉시 포기', () => {
    expect(isTransientStudioError(new StudioError('STUDIO_NOT_READY', 503, true))).toBe(false);
    expect(isTransientStudioError(new StudioError('SAFETY_BLOCKED', 400, true))).toBe(false);
    expect(isTransientStudioError(new Error('포스터 임시 저장에 실패했습니다.'))).toBe(false);
    expect(isTransientStudioError(null)).toBe(false);
  });
  it('재시도 간격은 2회(4초 · 10초) — 제작 단계 벽시계 안', () => {
    expect(OUTREACH_POSTER_RETRY_DELAYS_MS).toEqual([4_000, 10_000]);
  });
});
