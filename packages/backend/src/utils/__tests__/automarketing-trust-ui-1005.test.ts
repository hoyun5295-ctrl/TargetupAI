/**
 * 자동 마케팅 승인 창 · 화면 배선 (★ 2026-10-05 · docs/2026-10-05-automarketing-trust-design.md §5 · Harold 승인 목업)
 *   같은 창이 첫 주 승인(200) · 다음 승인 · 조건 확인(0)을 맡는다. 시작 버튼은 서버가 「시작 가능」이라 한 때만 켜진다.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const FE = join(__dirname, '..', '..', '..', '..', 'frontend', 'src');
const read = (...p: string[]) => readFileSync(join(FE, ...p), 'utf8');
const page = read('pages', 'ContinuousOperatorPage.tsx');
const modal = read('components', 'automarketing', 'OperatorPreviewModal.tsx');
const list = read('components', 'automarketing', 'OperatorsManageList.tsx');
const modules = read('constants', 'ai-operator-modules.ts');

describe('1. 한 줄 = 미리보기 · 문안 직접 쓰기', () => {
  it('한 줄 · 자세히 쓰기 = 미리보기(문안 분기를 함께 보낸다) · 200 확인 창으로 바로 가지 않는다', () => {
    const fn = page.slice(page.indexOf('const handleNaturalSubmit = '), page.indexOf('const requestPreview = '));
    expect(fn).toContain("requestPreview({ ...SMART_DEFAULTS, name: goal.slice(0, 40), objective: goal, copyStyle }, ownCopy ? 'fixed' : 'ai');");
    expect(fn).not.toContain('setPendingConfig');
    expect(page).toContain("...(o.explicit ? {} : { infer_schedule: true }),");
    expect(page).toContain('request_key: previewKeys.current.keyFor(keyName(config, copyMode, o)),');
    // 오늘의 추천 [시작]도 같은 승인 창(옛: 매일 기본값으로 바로 등록) · ★ 1024 AI 가 쓴 목표 = 읽은 조각 취급
    const brief = page.slice(page.indexOf('const handleBriefStart = '), page.indexOf('const handleBriefStart = ') + 1500);
    expect(brief).toContain("requestPreview({ ...SMART_DEFAULTS, name: rec.title.slice(0, 40), objective: rec.objective }, 'ai', { ai: true });");
    expect(brief).not.toContain('setPendingConfig');
    // ★ 1024 세부설정 새 시작도 같은 창(옛: 200 확인 창 → 바로 등록) · 화면의 POST /operator/continuous = 0(캘린더 전용)
    expect(page).toContain("void requestPreview(cfg, 'ai', { explicit: true });");
    expect(page).not.toMatch(/fetch\('\/api\/ai\/operator\/continuous', \{\s*method: 'POST'/);
    expect(page).not.toContain('CreditConfirmModal');
  });
  it('[문안 직접 쓰기] = 0크레딧 · 끄면 제안 받기 5크레딧(서버 단가 미러)', () => {
    expect(page).toContain("credit: ownCopy ? '0크레딧' : `${AI_GENERATE_COSTS['ai-operator-propose']}크레딧`,");
    expect(page).toContain('onClick={() => setOwnCopy((v) => !v)}');
  });
  it('예시 문구 = 매월(매주 + 상태 조건은 반복이라 막힌다)', () => {
    expect(modules).toContain("placeholder: '예: 매월 초에 90일 넘게 안 산 고객을 다시 불러와줘'");
    expect(modules).not.toContain('매주 월요일에 다시 불러와줘');
  });
});

describe('2. 창 편집 · 시작 · 다음 승인', () => {
  it('처음 시작 = 서버 보관본 편집 · 시작 = 창 바닥 한 곳(금액 · 잔액) → preview_id · 판 · 본 탭', () => {
    expect(page).toContain("fetch('/api/ai/operator/continuous/preview/update', {");
    expect(page).toContain('body: JSON.stringify({ preview_id: cur.data.previewId, revision: cur.data.revision, ...patch }),');
    expect(page).toContain("onStart={(vi) => (preview?.mode === 'renewal' ? approveRenewal() : startFromPreview(vi))}");
    expect(page).toContain('body: JSON.stringify({ preview_id: id, revision: preview?.data?.revision, variant_index: variantIndex }),');
    // 결과 모름 = 새로 시작하지 않고 확인만
    expect(page).toContain('setStartUnknown(true);');
    // 확인 = 처음 시작에 보낸 안 번호 그대로(Codex 1R · 고른 안을 버리지 않는다)
    expect(page).toContain('startVariant.current = variantIndex;');
    expect(page).toContain('onCheckStart={() => startFromPreview(startVariant.current)}');
  });
  it('다음 승인 = 승인 창(고른 칸으로 다시 세기) · 승인 = approve-window(차감 0 · 확인 창 없음)', () => {
    expect(page).toContain('fetch(`/api/ai/operator/continuous/${op.id}/approval-preview`, {');
    expect(page).toContain('fetch(`/api/ai/operator/continuous/${opId}/approve-window`, {');
    expect(page).toContain('onApprove={openRenewal}');
  });
  it('다음 승인도 서버 보관본 편집 · 승인 = 보관본 id + 판 번호(화면 초안으로 계약을 보내지 않는다 · Codex 2R)', () => {
    const edit = page.slice(page.indexOf('const editPreview = '), page.indexOf('const closePreview = '));
    expect(edit).not.toContain('approval-preview');
    expect(edit).toContain('if (res.status === 409 && data.current) applyServerData(data.current);');
    const appr = page.slice(page.indexOf('const approveRenewal = '), page.indexOf('const handleScenarioSelect = '));
    expect(appr).toContain('body: JSON.stringify({ preview_id: preview?.data?.previewId, revision: preview?.data?.revision }),');
    for (const gone of ['renewalDraft', 'contractDraft', 'applyCopyDraft', 'withoutContract']) expect(page).not.toContain(gone);
  });
});

describe('3. 승인 창 — 목업 그대로 · 시작은 서버 판정', () => {
  it('첫 줄 = 승인으로 무엇이 일어나는지 날짜로(매일 = 7일 · 그 밖 = 다음 회차 1회분)', () => {
    expect(modal).toContain('지금 승인하시면 <b>{dayLabel(d.window.startAt)}부터 {dayLabel(d.window.until)}까지 7일 동안</b>');
    expect(modal).toContain('라 이 승인은 다음 회차 1회분이고, 그다음 회차 전에 다시 여쭤요.');
  });
  it('시작 버튼 = 서버 ready · 고친 값이 적용되기 전엔 잠김 · 막힘이면 버튼 없음 · 유료 = 앰버 한 상수', () => {
    expect(modal).toContain('const canStart = !!d && d.ready && !busy && !starting && !thresholdDirty && !fixedDirty && benefitDraft == null && !whenOpen && !viaOpen;');
    expect(modal).toContain("{d && d.kind !== 'blocked' && (startUnknown ? (");
    expect(modal).toContain("className={mode === 'new' ? MK_BTN_PAY : MK_BTN_PRIMARY} onClick={() => onStart(messages.length > 0 ? Number(tab) : null)} disabled={!canStart}>");
    // ★ 1024 창 = 공용 껍데기 · 배경 · Esc 닫힘 0 · 창 자체 Esc 0
    expect(modal).toContain('disableDismiss>');
    expect(modal).not.toContain("addEventListener('keydown'");
    expect(modal).not.toContain('세부 설정에서 시작');
  });
  it('막힘 = 사유 그대로 · 넓히지 않는다는 말 · 짝 축 권하기 · 차감 0', () => {
    expect(modal).toContain('이대로는 시작할 수 없어요');
    expect(modal).toContain('대상을 임의로 넓혀서 보내지 않아요.');
    expect(modal).toContain('onClick={() => onAxis(d.audience.suggestKey!)}');
  });
  it('칸 고르기 = 값 있는 칸만(값 없는 칸은 눌리지 않음) · 근거 = 값 있는 고객 수 · 예시', () => {
    expect(modal).toContain('disabled={o.disabled}');
    expect(modal).toContain("값 있는 고객 0명 · 고를 수 없어요");
    expect(modal).toContain('값 있는 고객 ${o.fillCount.toLocaleString()}명');
  });
  it('0명인 날 = 「없음」 · 보내지 않고 차감 0 · 출처 줄 0(Harold 1020)', () => {
    expect(modal).toContain('대상 고객이 없는 날은 보내지 않고, 크레딧도 차감되지 않아요.');
    expect(modal).not.toContain('Data source');
  });
  it('모델명 0 · native dialog 0', () => {
    for (const src of [modal, page, list]) {
      expect(src).not.toMatch(/\b(Opus|Sonnet|Haiku|GPT|Claude|Anthropic)\b/);
      expect(src).not.toMatch(/\b(window\.)?(alert|confirm|prompt)\(/);
    }
  });
});

describe('4. 실행 중 목록 = 승인 상태', () => {
  it('조건 확인 필요(계약 없음) · ○월 ○일까지 승인 · 회차마다 승인 + 버튼', () => {
    expect(list).toContain("label: '조건 확인 필요', action: '조건 확인'");
    expect(list).toContain('label: `${d}까지 승인`');
    expect(list).toContain("label: '회차마다 승인'");
    expect(list).toContain('onClick={() => onApprove(op)}');
  });
});
