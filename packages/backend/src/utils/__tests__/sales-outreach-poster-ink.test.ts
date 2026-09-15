import { describe, it, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
import {
  posterInkFor, POSTER_INK_LIGHT_BELOW, POSTER_INK_ZONE, measurePosterInkZone, buildPosterTypography,
} from '../sales-outreach-produce';

/**
 * ★ 2026-09-15 B-0915-4 포스터 헤드라인 글자색이 `#111111` 고정이라 모델이 어두운 배경을 그리면 브랜드명이 안 보인다(시세이도 실측).
 *   계약: 합성 직전 글자 띠(포스터 = 상단 30% · 배너 = 하단 45%) 평균 밝기를 실측해 어두우면 흰 글자 + 그림자, 밝으면 현행 그대로(바이트 동일).
 *   경계 120 = 검은 글자와 흰 글자의 WCAG 대비가 뒤집히는 상대휘도 0.19 ≈ sRGB 118.
 */
const texts = { label: '기획전', title: '시세이도', subtitle: '얼티뮨 세럼', dropped: [] };

describe('posterInkFor (순수 · 경계)', () => {
  it('경계 아래 = light · 경계 이상 = dark · 측정 실패(null·NaN) = dark(현행)', () => {
    expect(POSTER_INK_LIGHT_BELOW).toBe(120);
    expect(posterInkFor(0)).toBe('light');
    expect(posterInkFor(119.9)).toBe('light');
    expect(posterInkFor(120)).toBe('dark');
    expect(posterInkFor(255)).toBe('dark');
    expect(posterInkFor(null)).toBe('dark');
    expect(posterInkFor(undefined)).toBe('dark');
    expect(posterInkFor(Number.NaN)).toBe('dark');
  });
  it('글자 띠 = 포스터 상단 30% · 배너 하단 45%(타이포 y 와 같은 구역)', () => {
    expect(POSTER_INK_ZONE.top).toEqual({ from: 0, to: 0.3 });
    expect(POSTER_INK_ZONE.bottom).toEqual({ from: 0.55, to: 1 });
  });
});

describe('buildPosterTypography ink', () => {
  it('light = 제목 흰색 · 부제 밝은 회색 · shadow 효과 · 배지는 그대로(브랜드색 바탕 흰 글자)', () => {
    const t = buildPosterTypography(texts, { brandColor: '#4f46e5', zone: 'top', fontPath: null, ink: 'light' }) as any[];
    expect(t.map((x) => x.text)).toEqual(['기획전', '시세이도', '얼티뮨 세럼']);
    expect(t[0].role).toBe('badge'); expect(t[0].color).toBe('#ffffff'); expect(t[0].badgeColor).toBe('#4f46e5'); expect(t[0].effect).toBeUndefined();
    expect(t[1].color).toBe('#ffffff'); expect(t[1].effect).toBe('shadow');
    expect(t[2].color).toBe('#f1f5f9'); expect(t[2].effect).toBe('shadow');
  });
  it('dark = 현행(#111111 · #333333 · 효과 없음) · ink 생략 = dark 와 동일(무회귀)', () => {
    const dark = buildPosterTypography(texts, { brandColor: '#4f46e5', zone: 'top', fontPath: null, ink: 'dark' }) as any[];
    const omitted = buildPosterTypography(texts, { brandColor: '#4f46e5', zone: 'top', fontPath: null }) as any[];
    expect(omitted).toEqual(dark);
    expect(dark[1].color).toBe('#111111'); expect(dark[2].color).toBe('#333333');
    for (const x of dark) expect(x.effect).toBeUndefined();
    // 위치·크기는 ink 와 무관
    const light = buildPosterTypography(texts, { brandColor: '#4f46e5', zone: 'top', fontPath: null, ink: 'light' }) as any[];
    expect(light.map((x) => [x.size, x.x, x.y])).toEqual(dark.map((x) => [x.size, x.x, x.y]));
  });
  it('배너(bottom) 구역도 같은 규칙', () => {
    const t = buildPosterTypography({ label: null, title: '브랜드', subtitle: null, dropped: [] }, { brandColor: null, zone: 'bottom', fontPath: null, ink: 'light' }) as any[];
    expect(t).toHaveLength(1);
    expect(t[0].color).toBe('#ffffff'); expect(t[0].effect).toBe('shadow'); expect(t[0].y).toBeGreaterThanOrEqual(0.6);
  });
});

describe('measurePosterInkZone (sharp 실측)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'poster-ink-'));
  const make = async (name: string, top: { r: number; g: number; b: number }, bottom: { r: number; g: number; b: number }) => {
    // 위 절반 top 색 · 아래 절반 bottom 색 (96×128 · 3:4)
    const w = 96, h = 128;
    const topImg = await sharp({ create: { width: w, height: h / 2, channels: 3, background: top } }).png().toBuffer();
    const botImg = await sharp({ create: { width: w, height: h / 2, channels: 3, background: bottom } }).png().toBuffer();
    const out = path.join(dir, name);
    await sharp({ create: { width: w, height: h, channels: 3, background: { r: 0, g: 0, b: 0 } } })
      .composite([{ input: topImg, top: 0, left: 0 }, { input: botImg, top: h / 2, left: 0 }])
      .jpeg({ quality: 90 }).toFile(out);
    return out;
  };
  it('어두운 상단(진갈색) → 평균 120 미만 · 밝은 상단(연회색) → 120 이상 · 띠는 구역만 본다', async () => {
    const dark = await make('dark.jpg', { r: 60, g: 40, b: 30 }, { r: 250, g: 250, b: 250 });
    const light = await make('light.jpg', { r: 235, g: 235, b: 235 }, { r: 20, g: 20, b: 20 });
    const d = await measurePosterInkZone(dark, 'top');
    const l = await measurePosterInkZone(light, 'top');
    expect(d).not.toBeNull(); expect(l).not.toBeNull();
    expect(d as number).toBeLessThan(POSTER_INK_LIGHT_BELOW);
    expect(l as number).toBeGreaterThanOrEqual(POSTER_INK_LIGHT_BELOW);
    // bottom 구역은 아래 절반을 본다 → 위와 반대
    expect(await measurePosterInkZone(dark, 'bottom') as number).toBeGreaterThanOrEqual(POSTER_INK_LIGHT_BELOW);
    expect(await measurePosterInkZone(light, 'bottom') as number).toBeLessThan(POSTER_INK_LIGHT_BELOW);
  });
  it('알파 채널 PNG 배경도 알파를 빼고 잰다(알파 255 가 평균을 밝게 끌지 않는다)', async () => {
    const out = path.join(dir, 'dark-alpha.png');
    await sharp({ create: { width: 96, height: 128, channels: 4, background: { r: 40, g: 30, b: 25, alpha: 1 } } }).png().toFile(out);
    const m = await measurePosterInkZone(out, 'top');
    expect(m).not.toBeNull();
    expect(m as number).toBeLessThan(POSTER_INK_LIGHT_BELOW);
  });
  it('파일이 없으면 null(현행 색으로 폴백 · 던지지 않는다)', async () => {
    expect(await measurePosterInkZone(path.join(dir, 'missing.jpg'), 'top')).toBeNull();
  });
});
