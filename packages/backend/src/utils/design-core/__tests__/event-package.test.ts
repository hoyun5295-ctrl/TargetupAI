/**
 * ★ 디자인 4.0 M5 — 행사 템플릿 선택기 테스트 (2026-07-14)
 * 결정적 매칭 고정 + 빈 원문 우회 폴백 + 힌트 블록에 혜택 수치 미포함.
 */
import { describe, it, expect } from 'vitest';
import { selectGoldenTemplateForEvent, buildEventTemplateHintBlock } from '../event-package';

describe('selectGoldenTemplateForEvent — 결정적 매칭', () => {
  it('마감 신호 = deadline-sale (우선순위 1)', () => {
    expect(selectGoldenTemplateForEvent('이번 주말 마감! 여름 세일')!.template.id).toBe('deadline-sale');
    expect(selectGoldenTemplateForEvent('선착순 100명 한정')!.template.id).toBe('deadline-sale');
    expect(selectGoldenTemplateForEvent('7/20까지만 진행')!.matchedBy).toBe('deadline');
  });

  it('신상 신호 = new-arrival', () => {
    expect(selectGoldenTemplateForEvent('가을 신상품 입고 안내')!.template.id).toBe('new-arrival');
    expect(selectGoldenTemplateForEvent('뉴 컬렉션 공개')!.matchedBy).toBe('new_arrival');
  });

  it('마감+신상 동시 = 마감 우선(손실 회피가 행사 성격 지배)', () => {
    expect(selectGoldenTemplateForEvent('신상품 출시 기념 — 오늘만 특별가')!.template.id).toBe('deadline-sale');
  });

  it('무신호 = event-invite 기본', () => {
    const m = selectGoldenTemplateForEvent('본점 리뉴얼 오픈 행사에 초대합니다');
    expect(m!.template.id).toBe('event-invite');
    expect(m!.matchedBy).toBe('default_invite');
  });

  it('빈 원문 = null (선택기 우회 — 기존 경로 그대로)', () => {
    expect(selectGoldenTemplateForEvent('')).toBeNull();
    expect(selectGoldenTemplateForEvent('   ')).toBeNull();
    expect(selectGoldenTemplateForEvent(null)).toBeNull();
    expect(selectGoldenTemplateForEvent(undefined)).toBeNull();
  });
});

describe('buildEventTemplateHintBlock — 프롬프트 주입 블록', () => {
  it('스토리 순서 포함 + 원문 지배 원칙 문구 포함', () => {
    const block = buildEventTemplateHintBlock('이번 주말 마감 세일');
    expect(block).toContain('정예 템플릿 힌트');
    expect(block).toContain('마감 임박 세일');
    expect(block).toContain('행사 원문에 있는 내용만');
  });

  it('빈 원문 = 빈 문자열 (프롬프트 완전 무변)', () => {
    expect(buildEventTemplateHintBlock('')).toBe('');
    expect(buildEventTemplateHintBlock(undefined)).toBe('');
  });

  it('힌트 블록에 혜택 수치 미포함', () => {
    for (const t of ['마감 세일', '신상 출시', '오픈 행사']) {
      expect(/\d+\s*%|\d+\s*원|무료|증정/.test(buildEventTemplateHintBlock(t))).toBe(false);
    }
  });
});
