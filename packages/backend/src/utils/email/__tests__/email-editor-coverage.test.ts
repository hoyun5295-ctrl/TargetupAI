/**
 * 이메일 편집기 **전수** 커버리지 — "공용 편집기가 노출하는데 이메일 렌더러가 아예 안 읽는" 속성을 0으로 만든다.
 *
 * `email-editor-parity.test.ts`(행동 테스트: 값을 바꾸면 출력이 달라지는가)와 역할이 다르다.
 * 저쪽은 **원장에 등재된 것만** 밟으므로, 등재를 빠뜨린 섹션은 밟을 수단 자체가 없었다.
 * 그래서 히어로(08-27)·쿠폰(09-02)·리뷰(09-15)에 이어 2026-09-16에 6건이 한꺼번에 접수됐다.
 * 이 파일은 등재를 사람 손에서 뺀다 — **편집기 소스에서 속성을 직접 수집**해 렌더러 소비를 대조한다.
 *
 * 판정은 "그 섹션의 렌더 함수 본문 안에서 참조되는가"다. 파일 전체 grep은 다른 섹션이 같은 이름을
 * 쓰면 통과해 버린다(`map_url`·`email`이 실제로 그 착시에 있었다).
 * 소비가 정답이 아닌 속성은 `EMAIL_PROP_EXEMPT`에 **사유와 함께** 있어야 하고, 그 속성은
 * 이메일 편집기에서 컨트롤도 감춰야 한다(죽은 컨트롤 금지 = `EMAIL_HIDDEN_EDITOR_FIELDS`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EMAIL_EDITOR_FILES, EMAIL_RENDER_FUNCTIONS, EMAIL_PROP_EXEMPT,
  EMAIL_HIDDEN_EDITOR_FIELDS, EMAIL_ITEM_PROPS,
} from '../email-property-contract';
import { EMAIL_BLOCK_WHITELIST } from '../email-blocks';

const EDITOR_DIR = join(__dirname, '../../../../../frontend/src/components/dm/panels/editors');
const EMAIL_EDITOR_TSX = join(__dirname, '../../../../../frontend/src/components/email/EmailVisualEditor.tsx');
const RENDERER_TS = join(__dirname, '../email-section-renderer.ts');

const rendererSrc = readFileSync(RENDERER_TS, 'utf8');

/** 렌더 함수 본문만 잘라낸다(다음 최상위 `function`/`export function` 직전까지). */
function renderBody(fnName: string): string {
  const start = rendererSrc.indexOf(`function ${fnName}(`);
  if (start < 0) return '';
  const rest = rendererSrc.slice(start + 1);
  const nextIdx = rest.search(/\n(?:export )?function /);
  return nextIdx < 0 ? rest : rest.slice(0, nextIdx);
}

/** 공용 편집기가 최상위로 패치하는 속성명 전량(`onUpdate({ x: …`). */
function editorProps(file: string): string[] {
  const src = readFileSync(join(EDITOR_DIR, file), 'utf8');
  const out = new Set<string>();
  for (const m of src.matchAll(/onUpdate\(\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) out.add(m[1]);
  return [...out].sort();
}

const exemptKey = (section: string, prop: string) => `${section}.${prop}`;
const EXEMPT = new Set(EMAIL_PROP_EXEMPT.map((e) => exemptKey(e.section, e.prop)));

describe('이메일 편집기 커버리지 — 원장 자체의 빈틈', () => {
  it('이메일이 그리는 블록 전부가 편집기 파일·렌더 함수에 매핑돼 있다', () => {
    for (const type of EMAIL_BLOCK_WHITELIST) {
      expect(EMAIL_EDITOR_FILES[type], `${type} 편집기 파일 미등재 — 빠진 섹션은 대조 밖이 된다`).toBeTruthy();
      expect(EMAIL_RENDER_FUNCTIONS[type], `${type} 렌더 함수 미등재`).toBeTruthy();
    }
  });

  it('매핑한 렌더 함수가 실제로 존재한다(이름이 바뀌면 대조가 조용히 빈다)', () => {
    for (const [type, fn] of Object.entries(EMAIL_RENDER_FUNCTIONS)) {
      expect(renderBody(fn).length, `${type} → ${fn} 본문을 못 찾음`).toBeGreaterThan(0);
    }
  });

  it('면제 속성은 사유가 적혀 있고, 편집기에서 컨트롤도 감춘다', () => {
    for (const e of EMAIL_PROP_EXEMPT) {
      expect(e.why.length, `${exemptKey(e.section, e.prop)} 면제 사유 없음`).toBeGreaterThan(20);
      const hidden = EMAIL_HIDDEN_EDITOR_FIELDS[e.section] || [];
      expect(hidden, `${exemptKey(e.section, e.prop)} 는 안 읽히는데 컨트롤이 보인다 = 눌러도 안 바뀌는 칸`)
        .toContain(e.prop);
    }
  });
});

describe('이메일 렌더러 소비 — 공용 편집기 속성 전수', () => {
  for (const type of EMAIL_BLOCK_WHITELIST) {
    const file = EMAIL_EDITOR_FILES[type];
    const fn = EMAIL_RENDER_FUNCTIONS[type];
    if (!file || !fn) continue;

    it(`[${type}] ${file} 의 속성을 ${fn} 이 전부 읽거나 면제표에 있다`, () => {
      const body = renderBody(fn);
      const missing = editorProps(file).filter((prop) => {
        if (EXEMPT.has(exemptKey(type, prop))) return false;
        return !new RegExp(`\\bp\\.${prop}\\b`).test(body);
      });
      expect(missing, `${fn} 이 안 읽는 편집기 속성 — 화면에서는 "눌러도 안 바뀐다"로 보인다. 렌더러에 넣거나 EMAIL_PROP_EXEMPT 에 사유와 함께 등재한다`)
        .toEqual([]);
    });
  }

  it('배열 안쪽 항목 필드도 같은 대조를 받는다(최상위 수집에 안 잡히는 사각)', () => {
    const missing = EMAIL_ITEM_PROPS.filter(({ section, prop, via }) => {
      // `via`가 있으면 위임 함수 본문에서 센다(renderCta → renderButton 처럼 항목을 넘겨 그리는 경우).
      const body = renderBody(via || EMAIL_RENDER_FUNCTIONS[section] || '');
      return !new RegExp(`\\.${prop}\\b`).test(body);
    }).map(({ section, prop }) => exemptKey(section, prop));
    expect(missing, '배열 항목 필드 미소비 — SNS 핸들이 이 사각에서 죽어 있었다').toEqual([]);
  });

  it('위임 함수(via)가 실제로 존재한다 — 이름이 바뀌면 이 대조도 조용히 빈다', () => {
    for (const { via } of EMAIL_ITEM_PROPS) {
      if (!via) continue;
      expect(renderBody(via).length, `위임 함수 ${via} 본문을 못 찾음`).toBeGreaterThan(0);
    }
  });
});

describe('이메일 편집기가 감춰야 할 필드를 실제로 넘긴다', () => {
  const emailEditorSrc = readFileSync(EMAIL_EDITOR_TSX, 'utf8');
  const MIRROR_TS = join(__dirname, '../../../../../frontend/src/constants/email-editor-hidden-fields.ts');

  it('공용 패널 호출부가 숨김 목록을 실제로 넘긴다', () => {
    expect(emailEditorSrc, '목록을 넘기지 않으면 공용 패널은 전부 그린다(감춤은 선택 prop이라 조용히 무시된다)')
      .toMatch(/hiddenFields=\{emailHiddenFieldsFor\(/);
    expect(emailEditorSrc).toContain("from '../../constants/email-editor-hidden-fields'");
  });

  it('프론트 미러가 백엔드 원장과 값까지 같다(갈라지면 화면만 옛 목록으로 남는다)', () => {
    const mirror = readFileSync(MIRROR_TS, 'utf8');
    for (const [section, fields] of Object.entries(EMAIL_HIDDEN_EDITOR_FIELDS)) {
      const m = mirror.match(new RegExp(`${section}:\\s*\\[([^\\]]*)\\]`));
      expect(m, `미러에 ${section} 없음`).toBeTruthy();
      const mirrored = (m![1].match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, ''));
      expect(mirrored.sort(), `${section} 숨김 목록이 원장과 다르다`).toEqual([...fields].sort());
    }
    // 미러가 원장에 없는 섹션을 더 감추고 있어도 안 된다(화면에서만 사라진 컨트롤).
    const mirrorSections = (mirror.match(/^\s{2}([a-z_]+):\s*\[/gm) || []).map((s) => s.trim().replace(/:\s*\[$/, ''));
    expect(mirrorSections.sort(), '미러 섹션 목록이 원장과 다르다').toEqual(Object.keys(EMAIL_HIDDEN_EDITOR_FIELDS).sort());
  });

  it('공용 편집기가 hiddenFields 를 실제로 적용한다(받기만 하고 안 쓰면 그대로 보인다)', () => {
    for (const [section, fields] of Object.entries(EMAIL_HIDDEN_EDITOR_FIELDS)) {
      const file = EMAIL_EDITOR_FILES[section];
      if (!file) continue;
      const src = readFileSync(join(EDITOR_DIR, file), 'utf8');
      for (const f of fields) {
        expect(src, `${file} 가 ${f} 를 감추는 분기를 갖고 있지 않다`)
          .toMatch(new RegExp(`hidden\\??\\.?\\('${f}'\\)`));
      }
    }
  });
});
