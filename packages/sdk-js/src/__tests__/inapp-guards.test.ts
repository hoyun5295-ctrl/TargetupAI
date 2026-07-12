import { describe, it, expect } from 'vitest';
import { resolveSafeNavUrl, passesTriggerThresholds } from '../inapp';

/**
 * ★ 2026-07-12 인앱 강화 고정 테스트 (SoT: specs/2026-07-12-inapp-full-reinforcement-design.md)
 * - P0-2 resolveSafeNavUrl: action_url 스킴 화이트리스트 (javascript: 실행 차단)
 * - P0-1 passesTriggerThresholds: 트리거 임계값 검증 (임계 미달 skip / 충족 표시 / 미전달 통과)
 */

const BASE = 'https://mall.example.com/products/1';

describe('resolveSafeNavUrl (P0-2 스킴 화이트리스트)', () => {
  it('javascript:/data:/vbscript: 스킴 = 이동 차단(null)', () => {
    expect(resolveSafeNavUrl('javascript:alert(1)', BASE)).toBeNull();
    expect(resolveSafeNavUrl('JaVaScRiPt:alert(1)', BASE)).toBeNull();
    expect(resolveSafeNavUrl(' javascript:alert(1)', BASE)).toBeNull();
    // URL 파서는 제어문자(탭/개행)를 제거하고 정규화한다 — 원문 문자열 검사가 아니라 파싱 후 protocol 검사
    expect(resolveSafeNavUrl('java\tscript:alert(1)', BASE)).toBeNull();
    expect(resolveSafeNavUrl('data:text/html,<script>alert(1)</script>', BASE)).toBeNull();
    expect(resolveSafeNavUrl('vbscript:msgbox(1)', BASE)).toBeNull();
  });

  it('https/http 절대 URL = 통과', () => {
    expect(resolveSafeNavUrl('https://mall.example.com/sale', BASE)).toBe('https://mall.example.com/sale');
    expect(resolveSafeNavUrl('http://mall.example.com/sale', BASE)).toBe('http://mall.example.com/sale');
  });

  it('상대경로 = base 기준 해석 통과', () => {
    expect(resolveSafeNavUrl('/event/summer', BASE)).toBe('https://mall.example.com/event/summer');
    expect(resolveSafeNavUrl('detail?id=3', BASE)).toBe('https://mall.example.com/products/detail?id=3');
  });

  it('placeholder([...])·빈 값 = 이동 대상 아님(null)', () => {
    expect(resolveSafeNavUrl('[URL — 회사 admin 수정]', BASE)).toBeNull();
    expect(resolveSafeNavUrl('', BASE)).toBeNull();
    expect(resolveSafeNavUrl(null, BASE)).toBeNull();
    expect(resolveSafeNavUrl(undefined, BASE)).toBeNull();
  });
});

describe('passesTriggerThresholds (P0-1 트리거 임계값)', () => {
  it('임계 미달 = skip', () => {
    expect(passesTriggerThresholds({ event: 'scroll', scroll_percent: 70 }, 'scroll', { scrollPercent: 10 })).toBe(false);
    expect(passesTriggerThresholds({ event: 'time_on_page', time_on_page_seconds: 30 }, 'time_on_page', { timeOnPageSeconds: 10 })).toBe(false);
  });

  it('임계 충족 = 표시', () => {
    expect(passesTriggerThresholds({ event: 'scroll', scroll_percent: 70 }, 'scroll', { scrollPercent: 70 })).toBe(true);
    expect(passesTriggerThresholds({ event: 'scroll', scroll_percent: 70 }, 'scroll', { scrollPercent: 85 })).toBe(true);
    expect(passesTriggerThresholds({ event: 'time_on_page', time_on_page_seconds: 30 }, 'time_on_page', { timeOnPageSeconds: 30 })).toBe(true);
  });

  it('값 미전달(자사몰 직접 trigger 호출) = 통과 — 기존 동작 보존', () => {
    expect(passesTriggerThresholds({ event: 'scroll', scroll_percent: 70 }, 'scroll', {})).toBe(true);
    expect(passesTriggerThresholds({ event: 'time_on_page', time_on_page_seconds: 30 }, 'time_on_page', {})).toBe(true);
  });

  it('임계 미설정 기존 저장분 = 기본값(스크롤 50%·체류 10초)으로 동작', () => {
    expect(passesTriggerThresholds({ event: 'scroll' }, 'scroll', { scrollPercent: 40 })).toBe(false);
    expect(passesTriggerThresholds({ event: 'scroll' }, 'scroll', { scrollPercent: 50 })).toBe(true);
    expect(passesTriggerThresholds(undefined, 'time_on_page', { timeOnPageSeconds: 10 })).toBe(true);
  });

  it('cart_value 기존 동작 유지 — min 설정 + 값 미달/미전달 = 미매칭', () => {
    expect(passesTriggerThresholds({ event: 'cart_value', cart_value_min: 50000 }, 'cart_value', { cartValue: 30000 })).toBe(false);
    expect(passesTriggerThresholds({ event: 'cart_value', cart_value_min: 50000 }, 'cart_value', {})).toBe(false);
    expect(passesTriggerThresholds({ event: 'cart_value', cart_value_min: 50000 }, 'cart_value', { cartValue: 60000 })).toBe(true);
    expect(passesTriggerThresholds({ event: 'cart_value' }, 'cart_value', {})).toBe(true);
  });

  it('임계 개념 없는 트리거(page_load 등) = 통과', () => {
    expect(passesTriggerThresholds({ event: 'page_load' }, 'page_load', {})).toBe(true);
    expect(passesTriggerThresholds(undefined, 'exit_intent', {})).toBe(true);
  });
});
