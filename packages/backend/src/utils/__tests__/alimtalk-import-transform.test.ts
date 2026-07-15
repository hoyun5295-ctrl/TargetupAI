/**
 * alimtalk-import-transform.test.ts — Track B 이관(import) 역변환 계약 (2026-07-15)
 *
 * 계약: IMC 목록 raw(snake_case — 2026-07-15 probe 실측)를 DB 규약(camelCase)으로 역변환해 저장해야
 * 발송 CT(alimtalk-emphasize toAttachmentLink — camelCase만 읽음)가 대표링크를 발송에 동봉한다.
 * snake 그대로 저장 = 대표링크 미동봉 = 7300(D234+ 축). 이 왕복을 테스트로 고정한다.
 * DB import 0 — 순수 함수만.
 */
import { describe, it, expect } from 'vitest';
import {
  fromImcButton,
  fromImcButtons,
  fromImcRepresentLink,
  extractAlimtalkVariables,
} from '../alimtalk-api';
import { toAttachmentLink } from '../alimtalk-emphasize';

describe('fromImcButton — IMC snake_case → DB camelCase', () => {
  it('probe 실측 형태(url_mobile) 변환', () => {
    // 2026-07-15 probe sample 그대로
    const b = {
      name: '요금납부',
      type: 'WL',
      url_mobile: 'https://www.giro.or.kr/open/linkpay.do?T=#{tid}',
    };
    expect(fromImcButton(b)).toEqual({
      name: '요금납부',
      type: 'WL',
      urlMobile: 'https://www.giro.or.kr/open/linkpay.do?T=#{tid}',
    });
  });

  it('이미 camelCase면 그대로 (idempotent)', () => {
    const b = { name: 'A', type: 'WL', urlMobile: 'https://m.example.com', urlPc: 'https://example.com' };
    expect(fromImcButton(b)).toEqual(b);
  });

  it('snake·camel 동시 존재 시 camel 우선', () => {
    const b = { name: 'A', type: 'WL', url_mobile: 'https://old.example.com', urlMobile: 'https://new.example.com' };
    expect(fromImcButton(b).urlMobile).toBe('https://new.example.com');
  });

  it('빈 문자열·null 값 키는 제외', () => {
    const b = { name: 'A', type: 'WL', url_mobile: '', url_pc: null, scheme_ios: undefined };
    expect(fromImcButton(b)).toEqual({ name: 'A', type: 'WL' });
  });
});

describe('fromImcButtons — 배열 안전', () => {
  it('null/undefined/비배열 → []', () => {
    expect(fromImcButtons(null)).toEqual([]);
    expect(fromImcButtons(undefined)).toEqual([]);
    expect(fromImcButtons('x')).toEqual([]);
  });

  it('배열 전건 변환', () => {
    const out = fromImcButtons([
      { name: 'A', type: 'WL', url_mobile: 'https://a.example.com' },
      { name: 'B', type: 'BK' },
    ]);
    expect(out).toEqual([
      { name: 'A', type: 'WL', urlMobile: 'https://a.example.com' },
      { name: 'B', type: 'BK' },
    ]);
  });
});

describe('fromImcRepresentLink + 발송 CT 왕복 (7300 축 고정)', () => {
  it('IMC snake → camel 변환', () => {
    expect(
      fromImcRepresentLink({ url_mobile: 'https://m.example.com', scheme_ios: 'app://x' }),
    ).toEqual({ urlMobile: 'https://m.example.com', schemeIos: 'app://x' });
  });

  it('null/빈 객체/값 전무 → null (컬럼 null 저장)', () => {
    expect(fromImcRepresentLink(null)).toBeNull();
    expect(fromImcRepresentLink({})).toBeNull();
    expect(fromImcRepresentLink({ url_mobile: '', url_pc: null })).toBeNull();
  });

  it('★ 왕복: IMC snake → fromImcRepresentLink → toAttachmentLink → snake 복원 (발송 동봉 보장)', () => {
    const imcRaw = {
      url_mobile: 'https://m.example.com/p/1',
      url_pc: 'https://example.com/p/1',
      scheme_android: 'app://p/1',
    };
    const stored = fromImcRepresentLink(imcRaw); // DB 저장값 (camel)
    const sent = toAttachmentLink(stored); // 발송 CT가 읽어 k_etc_json attachment_link 생성
    expect(sent).toEqual({
      url_mobile: 'https://m.example.com/p/1',
      url_pc: 'https://example.com/p/1',
      scheme_android: 'app://p/1',
    });
  });

  it('★ 반례 고정: snake 그대로 저장하면 발송 CT가 못 읽는다 (역변환이 없으면 대표링크 유실)', () => {
    const snakeStoredWrong = { url_mobile: 'https://m.example.com' } as any;
    expect(toAttachmentLink(snakeStoredWrong)).toBeUndefined();
  });
});

describe('extractAlimtalkVariables — #{...} 전체 토큰 (frontend extractVariables 동일 규칙)', () => {
  it('unique + 전체 토큰 형식', () => {
    const content = '▶ #{발송처} 안내\n#{고객상호명}님, 총 #{총금액}원\n문의: #{발송처}';
    expect(extractAlimtalkVariables(content)).toEqual(['#{발송처}', '#{고객상호명}', '#{총금액}']);
  });

  it('빈 본문/null → []', () => {
    expect(extractAlimtalkVariables('')).toEqual([]);
    expect(extractAlimtalkVariables(null)).toEqual([]);
    expect(extractAlimtalkVariables(undefined)).toEqual([]);
  });

  it('변수 없음 → []', () => {
    expect(extractAlimtalkVariables('변수 없는 본문')).toEqual([]);
  });
});
