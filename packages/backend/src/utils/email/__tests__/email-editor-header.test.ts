import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 이메일 편집기 헤더 — "열면 닫을 수 없는 화면"이 다시 나오지 않게 구조를 고정한다.
 *
 * ★ 2026-08-28 임은지 접수 `cmtcic3gr03wdjnotwmk8ofk0` — 생성 중인 캠페인에서 닫기 버튼이 보이지 않아
 *   새로고침·뒤로가기로 빠져나와야 했다.
 * [근본] 헤더 버튼이 전부 `shrink-0`인데 캠페인 이름·제목 입력에는 `min-w-0`이 없었다. flex 아이템의
 *   min-width 기본값이 auto라 input은 자기 콘텐츠 폭 아래로 줄지 않는다. 그래서 툴바 총 폭이 모달
 *   (`max-w-6xl`)을 넘고, 부모의 `overflow-hidden`에 마지막 자식인 닫기 버튼부터 잘렸다.
 *   완성 저장을 마친 캠페인은 버튼이 [임시저장]+[완성 저장 · 50] 둘에서 [저장] 하나로 줄어 폭이 남아
 *   닫기가 보였다 = 접수자가 관찰한 차이와 정확히 일치한다.
 * [게이트] "닫기 버튼이 소스에 있다"만 보면 이 형태를 못 잡는다(있는데 잘렸다). 줄어드는 쪽과
 *   줄지 않는 쪽이 갈려 있는지, 닫기가 줄지 않는 쪽에 있는지, 키보드 탈출구가 살아 있는지까지 밟는다.
 */

function read(cands: string[]): string {
  const p = cands.find((x) => fs.existsSync(x)) || '';
  return p ? fs.readFileSync(p, 'utf8') : '';
}

/** 소스에서 [시작 마커, 끝 마커) 구간을 자른다. */
function slice(src: string, from: string, to: string): string {
  const a = src.indexOf(from);
  if (a === -1) return '';
  const b = src.indexOf(to, a + from.length);
  return src.slice(a, b === -1 ? undefined : b);
}

const editor = read([
  path.resolve(process.cwd(), '../frontend/src/components/email/EmailVisualEditor.tsx'),
  path.resolve(process.cwd(), 'packages/frontend/src/components/email/EmailVisualEditor.tsx'),
]);

const header = slice(editor, '{/* 헤더', '<div className="flex-1 flex min-h-0">');

describe('이메일 편집기 헤더 — 닫기 버튼은 어떤 폭에서도 밀려나지 않는다', () => {
  it('편집기 소스와 헤더 구간을 읽었다 (경로가 바뀌면 아래 계약이 조용히 통과한다)', () => {
    expect(editor, 'EmailVisualEditor.tsx를 못 읽었다').not.toBe('');
    expect(header, '헤더 구간을 못 잘랐다 — 마커가 바뀌었는지 확인').not.toBe('');
  });

  it('입력 묶음이 줄어드는 쪽이다 (flex-1 + min-w-0)', () => {
    expect(header, '입력 묶음에 min-w-0이 없으면 input이 축소되지 않아 툴바가 모달 폭을 넘는다')
      .toMatch(/flex-1 min-w-0 flex items-center/);
  });

  it('캠페인 이름·제목 입력 각각에 min-w-0이 있다', () => {
    expect(header, '캠페인 이름 입력이 축소되지 않는다').toMatch(/w-40 min-w-0/);
    expect(header, '이메일 제목 입력이 축소되지 않는다').toMatch(/flex-1 min-w-0 bg-transparent/);
  });

  it('액션 묶음은 줄지 않는 쪽이고, 닫기 버튼이 그 안에 있다', () => {
    const groupAt = header.indexOf('flex items-center gap-2 shrink-0');
    expect(groupAt, '액션 묶음(shrink-0)이 없다 — 버튼이 개별로 흩어지면 다시 잘린다').toBeGreaterThan(-1);
    const closeAt = header.indexOf('aria-label="닫기"');
    expect(closeAt, '헤더에 닫기 버튼이 없다').toBeGreaterThan(-1);
    expect(closeAt, '닫기 버튼이 액션 묶음 밖에 있다').toBeGreaterThan(groupAt);
  });

  it('좁은 폭에서는 버튼 라벨을 접어 폭을 번다 (lg 미만 = 아이콘만)', () => {
    expect(header, 'md 임계로는 1024~1152px 구간에서 툴바가 다시 넘친다').not.toMatch(/hidden md:inline/);
    expect((header.match(/hidden lg:inline/g) || []).length, '라벨 접기가 사라졌다').toBeGreaterThanOrEqual(5);
  });
});

describe('이메일 편집기 ESC 닫기 — 잘려도 빠져나올 수 있다', () => {
  it('ESC 키 처리가 있다', () => {
    expect(editor, 'ESC 핸들러가 없으면 닫기 버튼이 유일한 탈출구가 된다').toMatch(/e\.key !== 'Escape'/);
    expect(editor).toMatch(/addEventListener\('keydown'/);
    expect(editor, 'keydown 리스너를 걷지 않으면 편집기를 닫았다 열 때마다 쌓인다').toMatch(/removeEventListener\('keydown'/);
  });

  it('한글 입력 조합 취소로 눌린 ESC는 무시한다 (isComposing)', () => {
    expect(editor, 'IME 조합 중 ESC까지 받으면 한글 입력 도중 편집기가 닫힌다').toMatch(/e\.isComposing/);
  });

  it('편집 내용이 있으면 즉시 닫지 않고 되묻는다', () => {
    expect(editor).toMatch(/const isDirty = \(\)/);
    expect(editor, 'ESC가 dirty 판정 없이 바로 onClose를 부른다').toMatch(/if \(!isDirty\(\)\) \{ onClose\(\); return; \}/);
  });

  it('dirty 판정 대상 = 저장 본문에 실리는 값 전부 (하나라도 빠지면 편집분이 말없이 사라진다)', () => {
    const snapshot = slice(editor, 'const isDirty = ()', ';');
    for (const field of ['name', 'subject', 'isAd', 'sections', 'design']) {
      expect(snapshot, `${field}가 dirty 판정에서 빠졌다 — 그 값만 고치고 ESC를 누르면 되묻지 않는다`).toContain(field);
    }
  });

  it('되묻기는 커스텀 모달이다 (native dialog 금지)', () => {
    expect(editor).toMatch(/setConfirmState\(\{[\s\S]{0,400}저장하지 않고 닫기/);
    expect(editor, 'native confirm·alert·prompt는 이 프로젝트에서 금지').not.toMatch(/[^.\w](?:confirm|alert|prompt)\s*\(/);
  });
});
