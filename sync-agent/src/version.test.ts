/**
 * AGENT_VERSION 단일 진입점 테스트
 *
 * 배경(2026-06-11 인비토 첫 연동 실측): 버전 문자열이 5곳에 하드코딩(1.4.0/1.5.4 혼재)되고
 * 실행 배너/heartbeat가 config.enc 저장값을 보고해, 전달 파일명(1.5.4)과 실행 표시(v1.5.1)가
 * 어긋나도 식별할 수 없었다. 버전의 진실은 package.json 하나로 통일한다.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { AGENT_VERSION } from './version';

describe('AGENT_VERSION', () => {
  it('package.json version과 일치한다 (하드코딩 불일치 차단)', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
    ) as { version: string };
    expect(AGENT_VERSION).toBe(pkg.version);
  });

  it('semver 형식이다', () => {
    expect(AGENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
