/**
 * ★ 2026-10-20 직접발송 「타겟추출」 칸 + 직접 타겟 추출 창 개편 (목업 docs/mockups/2026-10-20-direct-send-target-extract-mockup.html · Harold 승인)
 *
 * 접수: 직접발송 수신자 입력 3칸 → 4칸(타겟추출 추가) · 스타터 이상만 · 잠겨 있으면 요금제 안내 + 기능 설명 · 추출 창 새 디자인.
 * 처방 계약:
 *   ① 체크 단계가 없다 — 값이 있는 칸만 조건이다(utils/customerFilterBuild 한 곳이 판정).
 *   ② 담은 고객은 직접발송 명단으로 들어온다 — 직접발송 치환값은 이름 · 회신번호 · 기타1~3 뿐이라(Harold 1020) 파일등록과 같은 칸 맞추기 창에서 고객 항목을 고른다.
 *   ③ 직접발송 4칸 · 잠금 = 고객 DB 잠금(customer_db_enabled · 구독 잠금)과 같은 축 · 잠기면 안내 창('target-extract').
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  buildDynamicFiltersFromSelection, chosenFilterFields, conditionChipLabel, extractionFieldsMeta, extractionRowsToTable, fieldHasFilterValue,
} from '../../../../frontend/src/utils/customerFilterBuild';

const FIELDS = [
  { field_key: 'phone', display_name: '휴대폰번호', data_type: 'string', category: 'basic' },
  { field_key: 'name', display_name: '고객명', data_type: 'string', category: 'basic' },
  { field_key: 'gender', display_name: '성별', data_type: 'string', category: 'basic' },
  { field_key: 'age', display_name: '나이', data_type: 'number', category: 'basic' },
  { field_key: 'birth_date', display_name: '생일', data_type: 'date', category: 'basic' },
  { field_key: 'grade', display_name: '등급', data_type: 'string', category: 'membership' },
  { field_key: 'total_purchase_amount', display_name: '누적구매금액', data_type: 'number', category: 'purchase' },
  { field_key: 'last_purchase_date', display_name: '최근구매일', data_type: 'date', category: 'purchase' },
  { field_key: 'push_opt_in', display_name: '앱 푸시 동의', data_type: 'boolean', category: 'marketing' },
  { field_key: 'sms_opt_in', display_name: '문자 수신 동의', data_type: 'boolean', category: 'marketing' },
  { field_key: 'skin', display_name: '피부 타입', data_type: 'string', category: 'custom', is_custom: true },
];
const F = (k: string) => FIELDS.find((f) => f.field_key === k)!;

describe('① 값이 있는 칸만 조건이다', () => {
  it('빈 값 · 빈 배열 · 고른 연령대 없음 · 공백 글자 · 범위 둘 다 빈 숫자 = 조건 아님', () => {
    const v = { gender: [], age: { mode: 'preset', presets: [] }, skin: '  ', total_purchase_amount_min: '', name: '' };
    for (const k of ['gender', 'age', 'skin', 'total_purchase_amount', 'name', 'grade']) {
      expect(fieldHasFilterValue(k, v, F(k))).toBe(false);
    }
  });

  it('고른 값 · 연령 범위 한쪽 · 숫자 최소만 · 아니오(false) = 조건', () => {
    const v = {
      gender: ['F'], age: { mode: 'range', min: '20', max: '' }, total_purchase_amount_min: '100000', push_opt_in: 'false',
    };
    for (const k of ['gender', 'age', 'total_purchase_amount', 'push_opt_in']) {
      expect(fieldHasFilterValue(k, v, F(k))).toBe(true);
    }
  });

  it('고른 칸 → 서버 조건 = 옛 체크 + 값과 같은 모양(손으로 쓴 기대값)', () => {
    const v = {
      gender: ['F'], age: { mode: 'preset', presets: ['30', '40'] }, grade: ['VIP', 'GOLD'],
      total_purchase_amount_min: '1000000', last_purchase_date: '90', birth_date: 'month:10',
      push_opt_in: 'true', sms_opt_in: 'true', skin: ' 건성 ', name: '',
    };
    const chosen = chosenFilterFields(v, FIELDS);
    expect(chosen).toEqual(['gender', 'age', 'birth_date', 'grade', 'total_purchase_amount', 'last_purchase_date', 'push_opt_in', 'sms_opt_in', 'skin']);
    expect(buildDynamicFiltersFromSelection(chosen, v, FIELDS)).toEqual({
      dynamicFilters: {
        gender: { operator: 'eq', value: 'F' },
        age: { operator: 'between', value: [30, 49] },
        birth_date: { operator: 'birth_month', value: 10 },
        grade: { operator: 'in', value: ['VIP', 'GOLD'] },
        total_purchase_amount: { operator: 'gte', value: 1000000 },
        recent_purchase_date: { operator: 'days_within', value: 90 },
        push_opt_in: { operator: 'eq', value: true },
        skin: { operator: 'contains', value: '건성' },
      },
      smsOptIn: true,
    });
  });
});

describe('② 발송 창 항목 = 활성 항목 전체(번호 → 고른 칸 → 나머지 · 문자 수신 동의 제외)', () => {
  it('순서와 변수 이름', () => {
    const meta = extractionFieldsMeta(FIELDS, ['grade', 'gender']);
    expect(meta.map((m) => m.field_key)).toEqual(
      ['phone', 'grade', 'gender', 'name', 'age', 'birth_date', 'total_purchase_amount', 'last_purchase_date', 'push_opt_in', 'skin'],
    );
    expect(meta.find((m) => m.field_key === 'name')).toEqual({
      field_key: 'name', display_name: '고객명', variable: '%고객명%', data_type: 'string', category: 'basic',
    });
  });
});

describe('③ 고른 조건 칩 글', () => {
  const lab = (k: string, v: Record<string, any>) => conditionChipLabel(F(k), v, (_k, o) => (o === 'F' ? '여성' : o));
  it('칸 종류마다', () => {
    expect(lab('gender', { gender: ['F'] })).toBe('성별 여성');
    expect(lab('grade', { grade: ['VIP', 'GOLD', 'SILVER'] })).toBe('등급 VIP·GOLD 외 1');
    expect(lab('age', { age: { mode: 'preset', presets: ['40', '30'] } })).toBe('나이 30대·40대');
    expect(lab('age', { age: { mode: 'preset', presets: ['60'] } })).toBe('나이 60대 이상');
    expect(lab('age', { age: { mode: 'range', min: '20', max: '35' } })).toBe('나이 20~35세');
    expect(lab('age', { age: { mode: 'range', min: '', max: '35' } })).toBe('나이 35세 이하');
    expect(lab('total_purchase_amount', { total_purchase_amount_min: '1000000' })).toBe('누적구매금액 1,000,000 이상');
    expect(lab('total_purchase_amount', { total_purchase_amount_min: '100', total_purchase_amount_max: '500' })).toBe('누적구매금액 100~500');
    expect(lab('last_purchase_date', { last_purchase_date: '90' })).toBe('최근구매일 90일 이내');
    expect(lab('last_purchase_date', { last_purchase_date: '365' })).toBe('최근구매일 1년 이내');
    expect(lab('birth_date', { birth_date: 'month:3' })).toBe('생일 3월');
    expect(lab('push_opt_in', { push_opt_in: 'false' })).toBe('앱 푸시 동의 아니오');
    expect(lab('sms_opt_in', { sms_opt_in: 'true' })).toBe('문자 수신 동의한 고객만');
    expect(lab('skin', { skin: '건성' })).toBe('피부 타입 「건성」 포함');
    expect(lab('name', {})).toBeNull();
  });
});

describe('⑧ 담은 고객 → 직접발송 칸 맞추기(직접발송 치환값 = 이름 · 회신번호 · 기타1~3 · Harold 1020)', () => {
  const META = [
    { field_key: 'phone', display_name: '휴대폰번호', variable: '%휴대폰번호%', data_type: 'string', category: 'basic' },
    { field_key: 'name', display_name: '고객명', variable: '%고객명%', data_type: 'string', category: 'basic' },
    { field_key: 'grade', display_name: '등급', variable: '%등급%', data_type: 'string', category: 'membership' },
    { field_key: 'gender', display_name: '성별', variable: '%성별%', data_type: 'string', category: 'basic' },
    { field_key: 'total_purchase_amount', display_name: '누적구매금액', variable: '%누적구매금액%', data_type: 'number', category: 'purchase' },
    { field_key: 'skin', display_name: '등급', variable: '%등급%', data_type: 'string', category: 'custom' },
  ];
  it('머리글 = 항목 이름(겹치면 키를 붙임) · 행 = 화면 표기 값 · 번호는 원문 · 번호 · 이름 칸은 미리 맞춘다', () => {
    const t = extractionRowsToTable(
      [{ phone: '01000000001', name: '김서연', grade: 'VIP', gender: 'F', total_purchase_amount: 1200000, skin: '건성' }],
      META,
    );
    expect(t.headers).toEqual(['휴대폰번호', '고객명', '등급', '성별', '누적구매금액', '등급(skin)']);
    expect(t.data).toEqual([{ 휴대폰번호: '01000000001', 고객명: '김서연', 등급: 'VIP', 성별: '여성', 누적구매금액: '1,200,000', '등급(skin)': '건성' }]);
    expect(t.mapping).toEqual({ phone: '휴대폰번호', name: '고객명' });
  });
  it('머리글이 명단 내부 키(phone · name · extra1~3 · callback · _templateVars · originalIdx)나 앞 머리글과 겹치지 않는다(Codex 2R)', () => {
    const meta = [
      { field_key: 'phone', display_name: '휴대폰번호', variable: '', data_type: 'string', category: 'basic' },
      { field_key: 'custom_1', display_name: 'callback', variable: '', data_type: 'string', category: 'custom' },
      { field_key: 'custom_2', display_name: 'name', variable: '', data_type: 'string', category: 'custom' },
      { field_key: 'custom_3', display_name: '등급(custom_4)', variable: '', data_type: 'string', category: 'custom' },
      { field_key: 'custom_4', display_name: '등급', variable: '', data_type: 'string', category: 'custom' },
      { field_key: 'custom_5', display_name: '등급', variable: '', data_type: 'string', category: 'custom' },
    ];
    const t = extractionRowsToTable([{ phone: '01000000003', custom_1: '0200000000', custom_2: '가', custom_3: 'x', custom_4: 'y', custom_5: 'z' }], meta);
    expect(t.headers).toEqual(['휴대폰번호', 'callback(custom_1)', 'name(custom_2)', '등급(custom_4)', '등급', '등급(custom_5)']);
    expect(t.data[0]['callback(custom_1)']).toBe('0200000000');
    expect(t.data[0]['등급(custom_4)']).toBe('x');
  });
  it('이름 칸이 없는 회사 = 번호만 맞춘다 · 빈 값은 빈 글자(0은 지킨다)', () => {
    const t = extractionRowsToTable([{ phone: '01000000002', total_purchase_amount: 0, grade: null }], META.filter((m) => m.field_key !== 'name'));
    expect(t.mapping).toEqual({ phone: '휴대폰번호' });
    expect(t.data[0]['누적구매금액']).toBe('0');
    expect(t.data[0]['등급']).toBe('');
  });
});

const FE = path.resolve(__dirname, '../../../../frontend/src');
const read = (rel: string) => fs.readFileSync(path.join(FE, rel), 'utf8');
const PANEL = read('components/DirectSendPanel.tsx');
const DASH = read('pages/Dashboard.tsx');
const MODAL = read('components/DirectTargetFilterModal.tsx');
const CSS = read('styles/direct-send.css');
const INTROS = fs.readFileSync(path.resolve(__dirname, '../../content/plan-feature-intros.ts'), 'utf8');

describe('④ 직접발송 받는 사람 4칸', () => {
  it('직접입력 · 파일등록 · 주소록 · 타겟추출 순서 · 옛 3칸 탭은 이 창에서 빠졌다', () => {
    const labels = [...PANEL.matchAll(/<b>\{?([^<}]*?)\}?<\/b><small>/g)].map((m) => m[1]);
    expect(labels).toEqual(['직접입력', "directFileLoading ? '파일 분석중...' : '파일등록'", '주소록', "targetLoading ? '불러오는 중...' : '타겟추출'"]);
    expect(PANEL).not.toMatch(/className=[^>\n]*ds-rtab/);
  });
  it('잠겨도 숨기지 않는다 · 잠기면 대시보드가 고른 안내 · 아니면 이 창의 추출 창 · 잠김 글 = 최소 요금제부터', () => {
    expect(PANEL).toMatch(/onClick=\{\(\) => \{ if \(targetExtractLocked\) \{ onTargetExtractLocked\(\); return; \} beginRecipientSource\(\); setShowTargetExtract\(true\); \}\}/);
    expect(PANEL).toMatch(/targetExtractLocked \? `\$\{PLAN_FEATURE_MIN_PLAN\}부터`/);
  });
  it('빈 목록 칸은 이 창의 파일 입력을 연다(문서 전체 클래스 찾기 0)', () => {
    expect(PANEL).toMatch(/fileInputRef\.current\?\.click\(\)/);
    expect(PANEL).not.toMatch(/document\.querySelector<HTMLInputElement>\('\.ds-rtab/);
  });
  it('알림톡 · 브랜드메시지 창의 3칸 CSS(ds-rtab)는 그대로 · 4칸은 따로(ds-src)', () => {
    expect(CSS).toMatch(/\.ds-rtab \{/);
    expect(CSS).toMatch(/\.ds-src-grid \{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
    expect(CSS).toMatch(/\.ds-src-wrap \{ container-type: inline-size;/);
  });
});

describe('⑤ 담은 고객은 직접발송 명단으로(옛 직접 타겟 발송 창으로 넘기지 않는다 · 치환값 = 이름 · 회신번호 · 기타1~3)', () => {
  it('보관본 전체 행 → 칸 맞추기 창(파일등록과 같은 창 · 같은 적용 함수) · 번호 · 이름 미리 맞춤 · 늦은 응답 버림', () => {
    const fn = PANEL.slice(PANEL.indexOf('const handleTargetExtracted = async'));
    const body = fn.slice(0, fn.indexOf('\n  };'));
    expect(body).toMatch(/const seq = beginRecipientSource\(\);/);
    expect(body).toMatch(/await fetchTargetExtractionRows\(extraction\);\s*if \(seq !== mappingSeqRef\.current\) return;/);
    expect(body).toMatch(/const t = extractionRowsToTable\(r\.data\.recipients, meta\);[\s\S]*setDirectColumnMapping\(t\.mapping\);[\s\S]*setDirectInputMode\('target'\);\s*setDirectShowMapping\(true\);/);
  });
  it('불러오기 세대는 칸 맞추기 세대 하나다 — 새 방식을 누르면 열린 칸 맞추기 · 진행 중 등록 · 불러오던 결과를 버린다(Codex 2R 같은 부류 두 번 → 하나로)', () => {
    expect(PANEL).not.toMatch(/sourceSeqRef/);
    const begin = PANEL.slice(PANEL.indexOf('const beginRecipientSource = () => {'));
    expect(begin.slice(0, begin.indexOf('\n  };'))).toMatch(/closeMapping\(\);\s*setDirectFileLoading\(false\);\s*setTargetLoading\(false\);\s*return mappingSeqRef\.current;/);
    const file = PANEL.slice(PANEL.indexOf('const handleFileUpload = async'));
    expect(file.slice(0, file.indexOf('\n  };'))).toMatch(/const seq = beginRecipientSource\(\);[\s\S]*const data = await res\.json\(\);\s*if \(seq !== mappingSeqRef\.current\) return;/);
    // 직접입력 · 주소록 · 타겟추출(열 때) 모두 새 세대를 연다
    expect(PANEL).toMatch(/onClick=\{\(\) => \{ beginRecipientSource\(\); setDirectInputMode\('direct'\); setShowDirectInput\(true\); \}\}/);
    // 주소록 그룹 조회도 같은 세대 — 그사이 다른 방식을 누르거나 창이 닫히면 늦은 응답이 주소록 창을 열지 않는다(Codex 3R)
    expect(PANEL).toMatch(/const seq = beginRecipientSource\(\);[^\n]*\n\s*setDirectInputMode\('address'\);[\s\S]{0,300}const data = await res\.json\(\);\s*if \(seq !== mappingSeqRef\.current\) return;[^\n]*\n\s*if \(data\.success\) setAddressGroups/);
    expect(PANEL).toMatch(/onClick=\{\(\) => \{ if \(targetExtractLocked\) \{ onTargetExtractLocked\(\); return; \} beginRecipientSource\(\); setShowTargetExtract\(true\); \}\}/);
  });
  it('추출 창은 문서 맨 위로 · AI 숨김 사용자는 말로 고르기 없음', () => {
    expect(PANEL).toMatch(/\{showTargetExtract && createPortal\(\s*<DirectTargetFilterModal\s*show\s*onClose=\{\(\) => setShowTargetExtract\(false\)\}\s*onExtracted=\{\(ext, meta\) => \{ void handleTargetExtracted\(ext, meta\); \}\}\s*hideAi=\{hideAi\}/);
  });
  it('대시보드 = 잠김 판정 · 안내만(구독 잠금 → 잠금 창 · 아니면 target-extract 안내) · 옛 넘기기 코드 0', () => {
    const fn = DASH.slice(DASH.indexOf('const showTargetExtractLock = () => {'));
    expect(fn.slice(0, fn.indexOf('\n  };'))).toMatch(/if \(isSubscriptionLocked\) \{ setShowSubscriptionLock\(true\); return; \}\s*openPlanFeature\('target-extract'\);/);
    expect(DASH).toMatch(/targetExtractLocked=\{isCustomerDbLocked\}\s*onTargetExtractLocked=\{showTargetExtractLock\}\s*hideAi=\{hideAi\}/);
    expect(DASH).not.toMatch(/targetFromDirect|directDraftRef/);
  });
});

describe('⑥ 추출 창', () => {
  it('「대상 인원 조회」 버튼이 없고 고를 때마다 센다(모아서 · 늦은 응답 버림)', () => {
    expect(MODAL).not.toMatch(/'대상 인원 조회'|loadTargetCount/);
    expect(MODAL).toMatch(/const seq = \+\+countSeqRef\.current;[\s\S]{0,200}setTimeout\(async \(\) => \{[\s\S]{0,400}if \(seq !== countSeqRef\.current\) return;/);
    expect(MODAL).toMatch(/\}, \[show, fieldsLoaded, filterKey, countNonce\]\);/);
  });
  it('체크 상태가 없다 — 조건 = 값이 있는 칸(CT) · 넘기는 항목 = 활성 항목 전체(CT)', () => {
    expect(MODAL).not.toMatch(/selectedFields/);
    expect(MODAL).toMatch(/chosenFilterFields\(filterValues, enabledFields\)/);
    expect(MODAL).toMatch(/onExtracted\(r\.data, extractionFieldsMeta\(enabledFields, chosen\), undefined, extractedPhoneFields\)/);
  });
  it('직접발송 창(z 50) 위 · 알림 창은 그 위 · 고르기 모드는 AI 한줄로 확인 창(1600) 위', () => {
    expect(MODAL).toMatch(/const baseZ = pickMode \? 1600 : 60;/);
    expect(MODAL).toMatch(/style=\{\{ zIndex: baseZ \+ 10 \}\}/);
  });
  it('세대는 작업마다(말로 고르기 · 담기 · 집계) · 닫기 = 셋 다 올림 · 변환 중에는 담기 잠금(Codex 1R)', () => {
    const close = MODAL.slice(MODAL.indexOf('const handleClose = () => {'));
    expect(close.slice(0, close.indexOf('\n  };'))).toMatch(/aiSeqRef\.current\+\+;\s*extractSeqRef\.current\+\+;\s*countSeqRef\.current\+\+;/);
    expect((MODAL.match(/if \(seq !== aiSeqRef\.current\) return;/g) || []).length).toBe(1);
    expect((MODAL.match(/if \(seq !== extractSeqRef\.current\) return;/g) || []).length).toBe(2);
    expect(MODAL).toMatch(/: extracting \|\| aiNlGenerating \|\| \(inAi/);
  });
  it('새 변환을 시작하면 이전 결과를 먼저 비운다(실패해도 이전 고객군을 담지 않는다 · Codex 1R)', () => {
    expect(MODAL).toMatch(/const seq = \+\+aiSeqRef\.current;\s*setAiNlGenerating\(true\);\s*setAiNlError\(null\);[\s\S]{0,120}setAiNlResult\(null\);\s*setView\('manual'\);/);
  });
  it('말로 고르기 줄 = 고르기 모드 · AI 숨김 사용자에게 없다', () => {
    expect(MODAL).toMatch(/const showAiLine = !pickMode && !hideAi;/);
    expect(MODAL).toMatch(/\{showAiLine && \(/);
  });
});

describe('⑦ 안내 원장', () => {
  it('target-extract = 직접 타겟 추출 · 말로 고르기 1크레딧 · 옛 send-target 자리', () => {
    expect(INTROS).toMatch(/id: 'target-extract', title: '직접 타겟 추출'/);
    expect(INTROS).toMatch(/costs: \[\{ label: '말로 고르기', source: 'ai-segment-generator', credits: 1 \}\]/);
    expect(INTROS).not.toMatch(/id: 'send-target'/);
  });
});
