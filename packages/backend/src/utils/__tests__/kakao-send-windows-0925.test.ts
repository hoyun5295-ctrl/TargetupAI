/**
 * 0925 알림톡·브랜드메시지 발송 창 개편(Harold 목업 v2 승인 · "발송에 지장 전혀 없도록") — 계약
 *
 * 잠그는 것
 *   1. 알림톡 창 — 보내는 값·검증 순서·적재 경로가 개편 전과 같다(화면만 바뀌었다)
 *   2. 브랜드 창 — 보내는 값(payload 투영)·보내기 조건·확인 창 경유가 그대로다
 *   3. 공용 부품 — 다른 화면이 쓰는 기본 모양은 그대로(선택값을 줄 때만 새 모양) · 로직은 한 벌(훅)
 *   4. 고르기 창 — 승인 템플릿만 · 변수 있는 브랜드 템플릿 막음 · 문서 몸통 포털 · 배경 클릭으로 안 닫힘
 *   5. 창 틀 — 공용 틀이 하던 일(포털 · 겹침 2000 · ESC)을 새 브랜드 창이 그대로 한다
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FRONT = resolve(__dirname, '../../../../frontend/src');
const read = (p: string) => readFileSync(resolve(FRONT, p), 'utf8').replace(/\r\n/g, '\n');
const between = (src: string, a: string, b: string) => {
  const i = src.indexOf(a);
  expect(i, `${a} 없음`).toBeGreaterThanOrEqual(0);
  const j = src.indexOf(b, i + a.length);
  expect(j, `${b} 없음`).toBeGreaterThan(i);
  return src.slice(i, j);
};

describe('1. 알림톡 창 — 보내는 값·검증·적재는 그대로', () => {
  const m = read('components/AlimtalkSendModal.tsx');
  const send = between(m, 'const handleSend = async () => {', '// ★ D218+ (2026-05-26)');

  it('검증 순서 — 수신자 → 템플릿 → 승인 → 예약 시각 → 대체발송 → 변수 → 적재', () => {
    const order = [
      "if (recipients.length === 0) {",
      'if (!kakaoSelectedTemplate) {',
      "if (!['approved', 'APPROVED', 'APR', 'A'].includes(kakaoSelectedTemplate.status)) {",
      'if (reserveEnabled) {',
      'const fallbackViolation = validateAlimtalkChannelState({',
      'const varCheck = validateAlimtalkVariables(kakaoSelectedTemplate?.content, kakaoTemplateVars, recipients);',
      'setSending(true);',
      "await fetch('/api/campaigns/direct-send/stage', {",
      "await fetch('/api/unsubscribes/check', {",
      'onSendConfirm({',
    ];
    let at = -1;
    for (const o of order) {
      const i = send.indexOf(o);
      expect(i, o).toBeGreaterThan(at);
      at = i;
    }
  });

  it('확인 창으로 넘기는 값이 모두 실린다(예약·분할은 이 창의 값)', () => {
    const payload = between(send, 'onSendConfirm({', '});');
    for (const k of [
      "type: reserveEnabled ? 'scheduled' : 'immediate',",
      'dateTime: reserveEnabled ? reserveDateTime : undefined,',
      'splitEnabled,', 'splitCount,',
      'count: recipients.length - unsubCount - dupCount,',
      "from: 'alimtalk',", 'stagingId,', 'recipients,',
      'selectedTemplate: kakaoSelectedTemplate,', 'variableMap: stagedVariableMap,',
      'fallback: alimtalkFallback,', 'nextContents: alimtalkNextContents,',
      "nextSubject: alimtalkNextSubject || '',", 'profileId: alimtalkProfileId,',
    ]) expect(payload, k).toContain(k);
  });

  it('보내기 버튼 — handleSend 한 곳 · 막히는 조건은 개편 전과 같다', () => {
    const foot = between(m, '<footer className="ds-modal__foot ks-foot">', '</footer>');
    expect(foot).toContain('onClick={handleSend}');
    expect(foot).toMatch(/disabled=\{\s*sending \|\|\s*recipients\.length === 0 \|\|\s*!kakaoSelectedTemplate \|\|\s*!\['approved', 'APPROVED', 'APR', 'A'\]\.includes\(kakaoSelectedTemplate\?\.status\)\s*\}/);
    expect((m.match(/onClick=\{handleSend\}/g) || []).length).toBe(1);
  });

  it('채널 로직 = 공용 훅 한 벌(기존 패널과 같은 입력) · 템플릿 고르기 = 공용 handleSelectTemplate', () => {
    expect(m).toMatch(/const ch = useAlimtalkChannel\(\{\s*senders: show \? alimtalkSenders : \[\],\s*templates: alimtalkTemplates,\s*customerFieldOptions: dynamicFieldOptions,\s*value: channelState,\s*onChange: handleChannelChange,\s*sampleRecipient: recipients\[0\] \|\| null,\s*\}\);/);
    expect(m).toContain('onPick={(t) => ch.handleSelectTemplate(t)}');
    expect(m).toContain('<AlimtalkFallbackEditor');
  });

  it('칸에 보이는 대체발송 안내는 보내기 검증과 같은 순서(대체문안 → 제목)', () => {
    const hint = between(m, 'const fallbackIssue = !ch.selectedTemplate', ': null;');
    expect(hint.indexOf('requiresNextContents')).toBeLessThan(hint.indexOf('requiresNextSubject'));
    const v = read('components/alimtalk/AlimtalkChannelPanel.tsx');
    const val = between(v, 'export function validateAlimtalkChannelState(', '\n}\n');
    expect(val.indexOf("(t === 'A' || t === 'B')")).toBeLessThan(val.indexOf("(t === 'L' || t === 'B')"));
  });

  it('겉틀에 흐림·변형 없음(안에서 뜨는 창이 갇히지 않게) · 직접발송과 같은 ds 틀', () => {
    const shell = between(m, '  return (\n    <div\n      className="ds-scope ds-backdrop"', '<div className="ds-modal">');
    expect(shell).not.toMatch(/backdrop-blur|transform|animation/);
  });
});

describe('2. 브랜드 창 — 보내는 값·보내기 조건·확인 창 경유는 그대로', () => {
  const e = read('components/BrandMessageEditor.tsx');
  const bm = read('components/BrandSendModal.tsx');

  it('payload 투영(모드별) · 이미지 유형에서만 이미지 · onSend 한 곳', () => {
    const hs = between(e, 'const handleSend = () => {', '\n  };\n');
    for (const k of [
      'mode,', 'bubbleType,', 'senderKey,', 'targeting,', 'isAd,', 'resendType,',
      'unsubscribePhone: showUnsub ? (effUnsub || undefined) : undefined,',
      "if (mode === 'free') {", 'data.templateCode = templateCode;',
      'if (imageUrl && selectedType.needImage) {', 'onSend(data);',
    ]) expect(hs, k).toContain(k);
  });

  it('보내기 버튼 — handleSend 한 곳 · canSend(발신 프로필 · 막힘 사유 · 본문/템플릿 코드) 그대로 + 수신자 0이면 막음', () => {
    expect(e).toContain("const canSend = !sending && !!senderKey && !blockReason\n    && (mode === 'template' ? !!templateCode : (selectedType.maxMsg === 0 || !!message.trim()));");
    expect(e).toContain('onClick={handleSend} disabled={!canSend || noRecipients || templateMismatch}');
    expect((e.match(/onClick=\{handleSend\}/g) || []).length).toBe(1);
  });

  it('보내기 전 막힘 사유는 발송 바 위 한 줄로 그대로 보인다', () => {
    expect(e).toContain('{!!senderKey && !!blockReason && (');
    expect(e).toContain('<div className="ks-blockbar" role="alert">{blockReason}</div>');
  });

  it('대체발송 입력칸 · 타겟팅 · 광고 표기 — 같은 상태를 쓴다(발송 바로 자리만 옮김)', () => {
    expect(e).toContain('<select value={resendType} onChange={(e) => setResendType(e.target.value)} className={FIELD}>');
    expect(e).toContain('onClick={() => { setTargeting(t.code); setFootPop(\'\'); }}');
    expect(e).toContain('onClick={() => setIsAd(!isAd)}');
  });

  it('등록 템플릿 고르기 — 코드 = template_key(발송 큐 k_template_code) · 발신 프로필도 그 템플릿 것 · 코드 직접 입력칸 유지', () => {
    expect(e).toContain('setTemplateCode(t.template_key);');
    expect(e).toContain('if (t.profile_key) setSenderKey(t.profile_key);');
    expect(e).toContain('placeholder="사전 등록한 템플릿 코드"');
  });
  it('Codex 1R — 템플릿 선택 = 코드 · 발신프로필 · 유형 한 묶음(고를 때 함께 · 어긋나면 풀고 · 어긋난 채 못 보냄)', () => {
    const pick = between(e, '<BrandTemplatePickerModal', '/>');
    expect(pick).toContain('if (code !== bubbleType) { setBubbleType(code); setButtons([]); setRich(initialRich(code)); }');
    const unbind = between(e, 'useEffect(() => {\n    if (!pickedTemplate || templateCode !== pickedTemplate.template_key) return;', '}, [senderKey, bubbleType]);');
    expect(unbind).toContain("setTemplateCode('');");
    expect(e).toContain("{!(mode === 'template' && pickedForPreview) && (");
  });
  it('Codex 6R — 이미지도 묶음(고르면 직접 넣은 이미지 비움 · 고른 동안 이미지 칸 숨김 · 남아 있으면 못 보냄)', () => {
    const pick = between(e, '<BrandTemplatePickerModal', '/>');
    expect(pick).toContain('clearImage();');
    expect(e).toContain("{selectedType.needImage && !(mode === 'template' && pickedForPreview) && (");
    const mm = between(e, 'const templateMismatch = ', ';');
    expect(mm).toContain('!!imageUrl');
    // 막다른 길 금지 — 자유형에서 넣은 이미지가 남아 돌아오면 이유 + 비우기 버튼
    expect(e).toContain('{pickedForPreview && !!imageUrl && (');
    expect(e).toContain('<button type="button" onClick={clearImage}');
  });

  it('확인 창을 거쳐서만 보낸다(바로 발송 금지 · 0815 계약)', () => {
    const editorUse = between(bm, '<BrandMessageEditor', 'recipientsPanel={recipientsPanel}');
    expect(editorUse).toContain('if (!canSend) return;');
    expect(editorUse).toContain('setPending(payload);');
    expect(bm).toContain('await onSend({ ...payload, phones: sendPhones });');
  });

  it('Codex 10R·11R — 확인 창을 연 순간의 명단을 떠 두고 건수·발송 모두 그 명단(화면 명단이 바뀌어도 확인한 명단으로)', () => {
    const editorUse = between(bm, '<BrandMessageEditor', 'recipientsPanel={recipientsPanel}');
    expect(editorUse.indexOf('setPendingPhones(phones.slice());')).toBeLessThan(editorUse.indexOf('setPending(payload);'));
    // Codex 12R — 확인을 기다리는 동안 새 보내기(Enter 재진입)는 떠 둔 명단을 바꾸지 못한다
    expect(editorUse.indexOf('if (pending) return;')).toBeGreaterThan(-1);
    expect(editorUse.indexOf('if (pending) return;')).toBeLessThan(editorUse.indexOf('setPendingPhones(phones.slice());'));
    // 10R 덧댐(확인 창 열 때 세대 올리기)은 떠 두기로 대체되어 사라졌다
    expect(editorUse).not.toContain('reqSeqRef.current++');
    const dlg = between(bm, '<ConfirmDialogShell', '</ConfirmDialogShell>');
    expect(dlg).toContain('await onSend({ ...payload, phones: sendPhones });');
    expect(dlg).toContain('const sendPhones = pendingPhones;');
    expect(dlg).toContain('confirmDisabled={pendingPhones.length === 0}');
    expect(dlg).toContain('<DialogHeadline label="발송 대상" value={pendingPhones.length}');
    // 확인 창 안에서 화면 명단(phones)을 읽지 않는다
    expect(dlg).not.toMatch(/\bphones\.length/);
    expect(dlg).not.toContain('...payload, phones }');
  });

  it('브랜드 — 타겟 추출은 명단 세대와 따로 센다(명단을 고쳐도 추출이 안 버려짐 · 새 추출은 앞 담기 무효 + 그 표시 내림)', () => {
    const run = between(bm, 'const runAiTarget = async () => {', 'const applyAiTarget = async () => {');
    expect(run).toContain('const seq = ++aiSeqRef.current;');
    expect(run).toContain('reqSeqRef.current++;');
    expect(run).toContain('setAiApplying(false);');
    expect(run).not.toMatch(/seq [!=]== reqSeqRef\.current/);
    expect((run.match(/seq [!=]== aiSeqRef\.current/g) || []).length).toBe(3);
    const setR = between(bm, 'const setRecipients = (list: string[]) => {', '};');
    expect(setR).not.toContain('aiSeqRef.current');
    const open = between(bm, 'if (!show) return;\n    reqSeqRef.current++;', 'setPhones(seeded);');
    expect(open).toContain('aiSeqRef.current++;');
  });

  it('수신자를 바꾸는 길은 setRecipients 하나(늦은 AI 응답 무효화) — 새 목록의 삭제도 그 길로', () => {
    const panel = between(bm, 'const recipientsPanel = (', '\n  );\n');
    expect(panel).not.toMatch(/\bsetPhones\(/);
    expect(panel).toContain('setRecipients(phones.filter((_, i) => !listSelected.has(i)))');
    expect(panel).toContain('setRecipients([]);');
  });

  it('옛 공용 틀이 하던 일 — 문서 몸통 포털 · 겹침 2000 · ESC 닫기 · 닫혀 있으면 그리지 않음', () => {
    expect(bm).toContain('return createPortal(');
    expect(bm).toContain('style={{ zIndex: 2000 }}');
    expect(bm).toContain("const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };");
    expect(bm).toContain('if (!show) return null;');
    expect(bm).not.toContain('<SendWorkspaceShell');
  });
});

describe('2-2. 브랜드 파일 읽기 — 읽는 동안 명단이 바뀌면 버린다(지운 번호 되살림 금지)', () => {
  it('세대를 읽기 전에 잡고, 달라졌으면 합치지 않는다', () => {
    const bm = read('components/BrandSendModal.tsx');
    const hf = between(bm, 'const handleFile = async (file: File | null) => {', 'const runAiTarget = async () => {');
    const iSeq = hf.indexOf('const seq = reqSeqRef.current;');
    const iRead = hf.indexOf('await file.text();');
    const iGuard = hf.indexOf('if (seq !== reqSeqRef.current) {');
    const iMerge = hf.indexOf('setRecipients([...phones, ...added]);');
    expect(iSeq).toBeGreaterThanOrEqual(0);
    expect(iRead).toBeGreaterThan(iSeq);
    expect(iGuard).toBeGreaterThan(iRead);
    expect(iMerge).toBeGreaterThan(iGuard);
  });
});

describe('3. 공용 부품 — 기본 모양 그대로 · 로직 한 벌', () => {
  const p = read('components/alimtalk/AlimtalkChannelPanel.tsx');
  const v = read('components/alimtalk/AlimtalkVariableMappingPanel.tsx');

  it('공용 패널 기본 모양 = 훅 + 원래 마크업(템플릿 목록 · 미리보기 토글 · 대체발송)', () => {
    const def = between(p, 'export default function AlimtalkChannelPanel({', '\nexport function convertButtonsToQTmsg');
    expect(def).toContain('} = useAlimtalkChannel({ senders, templates, customerFieldOptions, value, onChange, sampleRecipient });');
    expect(def).toContain('<div className="space-y-1.5 max-h-[240px] overflow-y-auto border border-gray-200 rounded-lg p-1.5 bg-gray-50">');
    expect(def).toContain("{...buildAlimtalkPreviewProps(selectedTemplate, previewMode === 'filled' ? renderPreview : undefined)}");
    expect(def).toContain('<AlimtalkFallbackEditor');
  });

  it('훅이 로직을 소유 — 자동 매핑 · 프로필 바꾸면 템플릿 리셋 · 대체문안 씨앗', () => {
    const hook = between(p, 'export function useAlimtalkChannel({', '\nexport function buildAlimtalkPreviewProps(');
    for (const k of ['const handleSelectTemplate = (t: AlimtalkTemplate | null) => {', 'const setProfileId = (id: string) => {', 'const setNextType = (t: AlimtalkNextType) => {', 'const renderPreview = (text: string | null | undefined): string => {']) {
      expect(hook, k).toContain(k);
    }
  });

  it('변수 채우기 — 기본(grid) 그대로 · rows 는 선택값일 때만 · 값 쓰기는 같은 setVariable', () => {
    expect(v).toContain("layout = 'grid',");
    expect(v).toContain("if (layout === 'rows') {");
    expect(v).toContain('<div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">');
    const rows = between(v, "if (layout === 'rows') {", '// ★ D162-4 (2026-05-15) 4차');
    expect(rows).toContain('setVariable(varKey, `@@${v}@@`)');
  });
});

describe('4. 고르기 창', () => {
  it('알림톡 — 승인 템플릿만 고를 수 있다(공용 판정 한 벌) · 포털 · ESC · 배경 클릭 닫힘 없음', () => {
    const t = read('components/alimtalk/AlimtalkTemplatePickerModal.tsx');
    expect(t).toContain('disabled={!ok}');
    expect(t).toContain('const ok = isApprovedAlimtalkTemplate(t);');
    expect(t).toContain('document.body,');
    expect(t).not.toMatch(/ks-picker-back[^>]*onClick/);
  });

  it('브랜드 등록 템플릿 — 변수 있는 템플릿 · 못 쓰는 발신프로필 템플릿은 고를 수 없다', () => {
    const t = read('components/brand-send/BrandTemplatePickerModal.tsx');
    expect(t).toContain('if (brandTemplateHasVariables(t)) return');
    expect(t).toContain("if (!BRAND_SPEC[t.chat_bubble_type]?.opened) return");
    expect(t).toContain("if (!t.profile_key || !profileKeys.includes(t.profile_key)) return");
    expect(t).toContain('disabled={!!block}');
    expect(t).toContain("fetch('/api/alimtalk/brand-templates', {");
  });

  it('등록 템플릿 받는 화면 — 실제 칸 이름(attachment · carousel)을 먼저 읽는다', () => {
    const t = read('components/brand-send/brandTemplatePreview.ts');
    expect(t).toContain('const att = t.attachment ?? t.attachment_json ?? {};');
    expect(t).toContain('const car = t.carousel ?? t.carousel_json ?? null;');
  });

  it('브랜드 유형 고르기 — 한 번 누르면 적용 · 발송이 열린 유형만(호출부 codes)', () => {
    const t = read('components/brand-send/BrandTypePickerModal.tsx');
    expect(t).toContain('onClick={() => onPick(code)}');
    expect(t).toContain('{codes.map((code) => {');
  });
});

describe('4-2. 수신자 목록 선택 = 보이는 목록(Codex 3R)', () => {
  for (const f of ['components/AlimtalkSendModal.tsx', 'components/BrandSendModal.tsx']) {
    it(`${f} — 머리 체크박스는 검색 결과 줄만 · 검색어를 바꾸면 선택을 비운다`, () => {
      const src = read(f);
      expect(src).toContain('checked={listAllVisibleChecked}');
      expect(src).toContain('disabled={listVisibleIdx.length === 0}');
      expect(src).toContain('new Set([...listSelected, ...listVisibleIdx])');
      expect(src).toMatch(/setListQuery\(e\.target\.value\); setListPage\(0\); setListSelected\(new Set\(\)\);/);
      expect(src).not.toMatch(/new Set\((recipients|phones)\.map\(\(_, i\) => i\)\)/);
    });
  }
});

describe('4-3. 직접발송도 같은 규칙(Harold "같은 문제면 같이")', () => {
  it('머리 체크박스는 검색 결과 줄만 · 검색어를 바꾸면 선택을 비운다', () => {
    const d = read('components/DirectSendPanel.tsx');
    expect(d).toContain('checked={filtered.length > 0 && filtered.every((r) => selectedRecipients.has(r.originalIdx))}');
    expect(d).toContain('disabled={filtered.length === 0}');
    expect(d).toContain('setDirectSearchQuery(e.target.value); setDirectPage(0); setSelectedRecipients(new Set());');
    expect(d).not.toContain('setSelectedRecipients(new Set(directRecipients.map((_, i) => i)))');
    expect(d).toContain('useEffect(() => { setSelectedRecipients(new Set()); }, [directRecipients]);');
  });
});

describe('5-0. 카카오 → 문자 발송 전환 명단 넘기기(Codex 8R·9R)', () => {
  const load = async () => (await import('../../../../frontend/src/utils/send-checks')).carryPhonesToDirectRecipients;

  it('번호 목록(브랜드) — 집합이 같으면 그대로(null) · 달라지면 있던 번호는 그 줄 · 새 번호는 번호만 · 빈 명단은 null', async () => {
    const carry = await load();
    const current = [{ phone: '010-0000-0001', name: '가' }, { phone: '01000000002', name: '나', extra1: 'x' }];
    expect(carry(['01000000001', '01000000002'], current)).toBeNull();
    expect(carry(['01000000002', '01000000003'], current)).toEqual([current[1], { phone: '01000000003' }]);
    expect(carry([], current)).toBeNull();
    expect(carry(['  '], current)).toBeNull();
  });

  it('번호 목록 — 같은 번호 여러 줄(주문A/주문B)은 들렀다 오기만 하면 그대로 · 번호가 바뀌면 순서대로 하나씩', async () => {
    const carry = await load();
    const rows = [
      { phone: '01000000009', order: 'A', callback: '0200000001' },
      { phone: '01000000009', order: 'B', callback: '0200000002' },
      { phone: '01000000005', order: 'C' },
    ];
    expect(carry(['01000000009', '01000000005'], rows)).toBeNull();
    expect(carry(['01000000009', '01000000009', '01000000007'], rows)).toEqual([rows[0], rows[1], { phone: '01000000007' }]);
    expect(rows).toHaveLength(3);
  });

  it('줄 자체(알림톡) — 같은 줄이면 그 줄(어느 중복 줄을 지웠는지 정확) · 새 줄은 번호만 · 아무것도 안 바뀌면 null', async () => {
    const carry = await load();
    const rows: any[] = [
      { phone: '01000000009', order: 'A' },
      { phone: '01000000009', order: 'B' },
      { phone: '01000000005', order: 'C' },
    ];
    expect(carry([rows[0], rows[1], rows[2]], rows)).toBeNull();
    // 주문A 줄만 지움 → 남은 줄은 정확히 주문B(번호로 추정하지 않는다)
    const out = carry([rows[1], rows[2]], rows)!;
    expect(out[0]).toBe(rows[1]);
    expect(out[1]).toBe(rows[2]);
    expect(out).toHaveLength(2);
  });

  it('알림톡이 새로 만든 명단(파일 머리글 칸 포함) — 문자 명단 줄과 번호로 짝짓고 · 새 줄은 번호만(다른 칸 유입 금지)', async () => {
    const carry = await load();
    const current = [{ phone: '01000000001', name: '가' }];
    const fileRows = [{ phone: '01000000001', 주문번호: 'Z1' }, { phone: '01000000003', 주문번호: 'Z3', callback: '0200000009' }];
    expect(carry(fileRows, current)).toEqual([current[0], { phone: '01000000003' }]);
    // 중복 있는 목록은 집합이 같아도 그대로 두지 않는다(수가 다르다)
    const dupRows = [{ phone: '01000000001' }, { phone: '01000000001' }];
    expect(carry(dupRows, current)).toEqual([current[0], { phone: '01000000001' }]);
  });

  it('대시보드 — 알림톡은 줄로 · 브랜드는 번호로 넘기고, null 이면 덮지 않는다', () => {
    const d = read('pages/Dashboard.tsx');
    expect(d).toContain('const carried = carryPhonesToDirectRecipients(rows ?? phones, directRecipients);');
    expect(d).toContain('const carried = carryPhonesToDirectRecipients(phones, directRecipients);');
    expect((d.match(/if \(carried\) \{\s*setDirectRecipients\(carried\);/g) || []).length).toBe(2);
    const m = read('components/AlimtalkSendModal.tsx');
    expect(m).toContain("recipients.map((r) => r.phone), recipients) : undefined}");
  });
});

describe('5. 머리 · 채널 전환', () => {
  it('전환 버튼은 호출부가 줄 때만 · 대시보드가 이 창을 닫고 그 창을 연다', () => {
    const h = read('components/kakao-send/KakaoSendHeader.tsx');
    expect(h).toContain('{onSwitch && others.map((to) => {');
    const d = read('pages/Dashboard.tsx');
    expect(d).toMatch(/onSwitchChannel=\{\(to, phones, rows\) => \{\s*setShowAlimtalkSend\(false\);/);
    expect(d).toMatch(/onSwitchChannel=\{\(to, phones\) => \{\s*setShowBrandSend\(false\);/);
  });
});

describe('7. 늦게 끝난 불러오기는 사람이 고친 명단을 덮지 않는다(주소록 · 직접발송 파일 매핑 · Harold "같은 문제면 같이")', () => {
  const ab = read('components/AddressBookModal.tsx');
  const dp = read('components/DirectSendPanel.tsx');

  it('주소록 — 불러오는 동안 가림막 + [불러오기 취소] · 닫기는 잠그지 않는다(응답이 안 끝나도 갇히지 않음 · Codex 12R)', () => {
    expect(ab).toContain('{(isUploading || listLoading) && (');
    expect(ab).toContain('onClick={cancelListLoad}');
    const cancel = between(ab, 'const cancelListLoad = () => {', '};');
    expect(cancel).toContain('loadSeqRef.current++;');
    expect(cancel).toContain('setListLoading(false);');
    // 닫기 잠금 조건에 불러오기를 넣지 않는다(업로드 잠금은 원래 그대로)
    expect(ab).not.toMatch(/disabled=\{[^}]*listLoading/);
    expect(ab).toContain('if (isUploading) return;');
  });

  it('주소록 — 두 불러오기 모두 세대 확인 뒤에만 명단을 쓴다 · 닫힘·언마운트에 세대를 올린다', () => {
    const multi = between(ab, 'const handleLoadMultipleGroups = async () => {', '// 모달 열릴 때 그룹 로드');
    expect(multi.indexOf('if (seq !== loadSeqRef.current) return;')).toBeLessThan(multi.indexOf('setDirectRecipients(allContacts);'));
    expect(multi).toContain('if (seq === loadSeqRef.current) setListLoading(false);');
    const single = between(ab, 'const seq = ++loadSeqRef.current;\n                            setListLoading(true);', '>불러오기</button>');
    expect(single.indexOf('if (seq !== loadSeqRef.current) return;')).toBeLessThan(single.indexOf('setDirectRecipients(data.contacts.map('));
    expect(ab).toContain('React.useEffect(() => () => { loadSeqRef.current++; }, []);');
    const hide = between(ab, 'if (!show) {', 'setLoaded(false);');
    expect(hide).toContain('loadSeqRef.current++;');
    // 명단에 쓰는 곳은 이 두 곳뿐
    expect((ab.match(/setDirectRecipients\(/g) || []).length).toBe(2);
  });

  it('직접발송 파일 매핑 — 닫기·취소 = 불러오기 취소(세대) · 창이 닫히면 늦은 결과를 쓰지 않는다 · 닫기는 잠그지 않는다', () => {
    const apply = between(dp, 'const handleMappingApply = async () => {', '// 파생값');
    expect(apply.indexOf('const seq = ++mappingSeqRef.current;')).toBeLessThan(apply.indexOf('await new Promise'));
    expect(apply.indexOf('if (seq !== mappingSeqRef.current) return;')).toBeLessThan(apply.indexOf('setDirectRecipients(mapped);'));
    expect(dp).toContain('useEffect(() => () => { mappingSeqRef.current++; }, []);');
    expect((dp.match(/<button onClick=\{closeMapping\}/g) || []).length).toBe(2);
    expect(dp).not.toContain('disabled={directMappingLoading}');
    const close = between(dp, 'const closeMapping = () => {', '};');
    expect(close).toContain('mappingSeqRef.current++;');
    expect(close).toContain('setDirectMappingLoading(false);');
  });
});

describe('8. 수신자 열 모양 — 0925 밤 Harold 스크린샷 퇴행 고정(탭 글자 세로 꺾임 · 브랜드 탭 칸 세로로 늘어남 · 업로드 버튼 아이콘 56px)', () => {
  const css = read('styles/direct-send.css');

  it('낮은 화면에서 줄이는 것은 업로드 칸의 큰 그림(직계 svg)뿐 — 버튼 안 아이콘은 건드리지 않는다', () => {
    expect(css).toContain('.ds-list-empty > .ds-dropzone > svg { width: 56px; height: 56px; }');
    expect(css).not.toMatch(/\.ds-dropzone svg\s*\{/);
  });

  it('카카오 창 탭 — 글자를 꺾지 않고(nowrap) · 기준 폭은 글자 폭(auto) · 브랜드 세로 열에서 늘지 않는다', () => {
    const tab = between(css, '.ks-recipients .ds-rtab {', '}');
    expect(tab).toContain('white-space: nowrap;');
    expect(tab).toContain('min-width: 0;');
    expect(tab).toContain('flex: 1 1 auto;');
    expect(css).toContain('.ks-recipients > .ds-rtab-group { flex: 0 0 auto; }');
    expect(css).toContain('.ks-recipients { container-type: inline-size; }');
    expect(css).toContain('@container (max-width: 420px) {');
  });

  it('좁은 열 — 합계는 한 줄로 줄지 않고 검색칸이 남는 폭을 쓴다 · [파일 선택]·드래그 안내는 꺾이지 않고 줄을 넘긴다', () => {
    expect(css).toContain('.ks-recipients .ds-count-wrap { flex: none; white-space: nowrap;');
    expect(css).toContain('.ks-recipients .ds-search-wrap { width: auto; flex: 1 1 auto; max-width: 260px; min-width: 0; }');
    for (const f of ['components/AlimtalkSendModal.tsx', 'components/BrandSendModal.tsx']) {
      const src = read(f);
      expect(src).toContain('<div className="flex items-center justify-center flex-wrap gap-x-2 gap-y-1 mt-1">');
      expect(src).toMatch(/ds-btn-sec px-4 pointer-events-none whitespace-nowrap/);
      expect(src).toContain('text-stone-400 whitespace-nowrap">또는 여기로 드래그');
    }
  });
});
