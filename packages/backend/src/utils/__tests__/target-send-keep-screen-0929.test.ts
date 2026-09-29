/**
 * 직접 타겟 발송 창 = 보관본 · 직접발송과 같은 점검·발송 바 (★2026-09-29 한줄로 V2 R112 · 목업 승인 0929)
 *
 * Harold 0929: 목업 「좋아 이대로」 · 점검 줄 = 직접발송처럼(스팸 검사 · 맞춤법 검사) · 발송 바 = 직접발송처럼 ·
 *   담당자테스트 = 뺀다 · 메시지 칸 = 직접발송처럼 크게(왼쪽 열 560 · 본문 칸이 남는 높이를 채움).
 * 이 파일이 고정하는 것(화면 원문 계약):
 *   - 타겟 창은 명단 전체를 들지 않는다(보관본 CT · 검색·빼기 = 서버) · 발송 = 직접발송과 같은 집계·확정 길
 *   - 점검 판정·세 창 · 본문 칸 · 발송 바는 직접발송과 같은 공용 코드(창마다 두 벌 금지)
 *   - 브랜드메시지 창 AI 타겟추출은 옛 추출 그대로(keep 없음)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FRONT = resolve(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const front = (p: string) => readFileSync(resolve(FRONT, p), 'utf8').replace(/\r\n/g, '\n');

const target = front('components/TargetSendModal.tsx');
const panel = front('components/DirectSendPanel.tsx');
const dash = front('pages/Dashboard.tsx');
const filter = front('components/DirectTargetFilterModal.tsx');
const brand = front('components/BrandSendModal.tsx');
const ct = front('utils/target-extraction.ts');
const shell = front('components/shared/SendWorkspaceShell.tsx');

/** 주석을 뺀 코드(주석에 남긴 경위 문장은 검사하지 않는다) */
const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');
const targetCode = codeOnly(target);

const between = (src: string, a: string, b: string) => {
  const i = src.indexOf(a);
  expect(i, `시작 표지 없음: ${a}`).toBeGreaterThan(-1);
  const j = src.indexOf(b, i + a.length);
  expect(j, `끝 표지 없음: ${b}`).toBeGreaterThan(-1);
  return src.slice(i, j);
};

describe('타겟 창 = 직접발송과 같은 점검 · 본문 칸 · 발송 바', () => {
  it('공용 훅·부품을 쓴다(두 창이 한 벌)', () => {
    for (const src of [target, panel]) {
      expect(src).toContain("import { useSendPrecheck } from './direct-send/useSendPrecheck';");
      expect(src).toContain("import { useEditorFill } from './direct-send/useEditorFill';");
      expect(src).toContain("import SendBar from './direct-send/SendBar';");
      expect(src).toContain('{precheck.tiles}');
      expect(src).toContain('{precheck.modals}');
      expect(src).toContain('<SendBar');
    }
  });

  it('왼쪽 열 560(직접발송과 같다) · 발송 바는 창 맨 아래(footer) · 전송 버튼 색 = 창 색(인디고)', () => {
    // ★ 2026-09-29 차수 5 — 직접발송 본문 열과 같은 식(창 폭 55% · 최소 500 · 최대 560 = 1018 이상은 560 그대로)
    expect(target).toContain('asideWidth="min(560px, max(500px, 55%))"');
    expect(target).toContain('footer={footer}');
    expect(target).toContain('sendClassName="ks-send--indigo"');
    expect(shell).toContain('{footer && <div className="shrink-0">{footer}</div>}');
  });

  it('담당자테스트 없음(Harold 0929) · 옛 세 버튼 줄 없음', () => {
    expect(targetCode).not.toContain('담당자테스트');
    expect(target).not.toContain('handleTargetTestSend');
    expect(dash).not.toContain('const handleTargetTestSend');
    expect(target).not.toMatch(/<ShieldCheck[^>]*\/>스팸필터/);
  });

  it('발신번호는 발송 바 한 곳(작성 카드에 발신번호 선택 없음) · 미리보기는 도구 줄', () => {
    expect(target).not.toContain('<optgroup label="수신자별 회신번호 컬럼">');
    expect(target).toContain('className={PREVIEW_BTN}');
  });

  it('자동입력 변수 · 브랜드 링크 = 도구 줄 펼침 버튼(Harold 0929 · 메시지 칸을 넓힌다) · 미리보기 = byte 옆', () => {
    expect(target).toContain('setVarMenuOpen((o) => !o)');
    expect(target).toContain('className="ds-var-menu"');
    expect(target).toContain('setLinkMenuOpen((o) => !o)');
    expect(targetCode).not.toContain('<span className="text-[12px] font-medium text-slate-500">자동입력 변수</span>');
    const toolbar = between(target, '{/* 도구줄', '{/* MMS 이미지');
    expect(toolbar.indexOf('/{maxBytes}byte')).toBeLessThan(toolbar.indexOf('className={PREVIEW_BTN}'));
    expect(toolbar).toContain('<BrandLinkChips');
  });

  it('native dialog · 모델명 0', () => {
    for (const src of [target, ct, front('components/direct-send/SendBar.tsx'), front('components/direct-send/useSendPrecheck.tsx'), front('components/direct-send/useEditorFill.ts')]) {
      expect(src).not.toMatch(/\b(alert|confirm|prompt)\(/);
      expect(src).not.toMatch(/Claude|Anthropic|Opus|Sonnet|Haiku|GPT/);
    }
  });
});

describe('타겟 창은 명단 전체를 들지 않는다(보관본)', () => {
  it('수신자 = 보관본(건수·앞 15명·가장 긴 값) · 검색·빼기는 서버', () => {
    expect(target).not.toContain('targetRecipients');
    expect(target).toContain('searchTargetExtraction(extraction, searchDigits)');
    expect(target).toContain('removeFromTargetExtraction(extraction, phones)');
    expect(target).toContain('외 {restCount.toLocaleString()}명도 함께 발송됩니다');
    expect(targetCode).not.toContain('전체삭제');
  });

  it('최장 바이트 = 서버가 준 가장 긴 값 한 행(명단 전체 계산과 같은 값)', () => {
    expect(target).toContain('getMaxByteMessage(t, longestRowOf(extraction), targetVarMap)');
    expect(dash).toContain('getMaxByteMessage(targetMessage, longestRowOf(targetExtraction), targetVarMap)');
    expect(dash).toContain('targetRecipients={longestRowOf(targetExtraction)}'); // 단문 전환 창
  });

  it('추출 창 두 곳 = 보관본 CT(keep) · 브랜드메시지 창 AI 타겟추출 = 옛 추출 그대로', () => {
    expect(filter).not.toContain("fetch('/api/customers/extract'");
    expect((filter.match(/requestKeptExtraction\(/g) || []).length).toBe(2);
    expect(ct).toContain("post<any>('/api/customers/extract', { ...filterBody, keep: true })");
    expect(brand).toContain("fetch('/api/customers/extract', {");
    expect(brand).not.toContain('keep: true');
  });

  it('알림톡·브랜드메시지 카드 = 넘길 때만 보관본 전체 행', () => {
    const cards = between(dash, 'onAlimtalkOpen={async () => {', 'onBrandOpen={async () => {');
    expect(cards).toContain('fetchTargetExtractionRows(targetExtraction)');
    const brandCard = between(dash, 'onBrandOpen={async () => {', '/>');
    expect(brandCard).toContain('fetchTargetExtractionRows(targetExtraction)');
  });
});

describe('발송 = 직접발송과 같은 집계 · 확정 길', () => {
  const exec = between(dash, 'const executeTargetSend = async', '/** ★ 2026-09-29 R112 — 수신자별 회신번호 칸을 고르면');
  const confirm = between(dash, 'const confirmTargetSend = async', '// 직접타겟추출 발송 함수');

  it('확정 = /direct-send/commit · stagingId = 보관본 id · 명단을 본문에 싣지 않는다', () => {
    expect(exec).toContain("fetch('/api/campaigns/direct-send/commit'");
    expect(exec).toContain('stagingId: ext.extractionId,');
    expect(exec).not.toContain("fetch('/api/campaigns/direct-send',");
    expect(exec).not.toContain('recipients:');
    expect(exec).toContain("data.code === 'STAGING_EXPIRED'");
  });

  it('확인 창 전 집계 = /direct-send/count(이름 빈 인원 · 수신자별 회신번호 제외 요청)', () => {
    expect(confirm).toContain("fetch('/api/campaigns/direct-send/count'");
    expect(confirm).toContain('includeNameEmpty: hasNameVar, useIndividualCallback: individual,');
    expect(confirm).toContain("setCallbackConfirm({ ...data.callbackConfirm, show: true, sendType: 'target' });");
    expect(exec).toContain('(sendConfirm as any).nameEmptyCount');
  });

  it('회신번호 제외 확인 → 타겟은 발송 확인 창(서버가 이미 셌다 · 다시 보내지 않는다)', () => {
    const h = between(dash, 'const handleCallbackConfirmSend = async', '// MMS 이미지 (서버 업로드 방식)');
    expect(h).toContain('if (pendingTargetConfirm) setSendConfirm(pendingTargetConfirm);');
    expect(h).not.toContain('await executeTargetSend(true);');
  });

  it('타겟 창 전송 = 점검 경고 → 대시보드 집계(onRequestSend)', () => {
    const send = between(target, 'const handleSmsSend = async', 'const handleAlimtalkSend = async');
    expect(send.indexOf('precheck.decideSendWarn()')).toBeLessThan(send.indexOf('await onRequestSend()'));
    expect(target).toContain('onSendAnyway: () => { void onRequestSend(); },');
  });

  it('수신자별 회신번호 빈 인원 = 서버 보관본 값(모르면 보내지 않는다)', () => {
    const send = between(target, 'const handleSmsSend = async', 'const handleAlimtalkSend = async');
    expect(send).toContain('if (callbackMissing == null)');
    expect(send).toContain('if (callbackMissing > 0)');
    expect(dash).toContain('fillTargetExtractionCallback(ext, column)');
  });
});
