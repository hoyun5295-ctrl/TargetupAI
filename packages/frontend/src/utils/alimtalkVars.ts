/**
 * 알림톡 템플릿 변수 발송 전 검증 (2026-06-01 #3-2)
 *
 * 알림톡 본문 #{변수}가 모두 채워졌는지 발송 직전 확인한다.
 *  - 빈 값(미지정): 매핑이 비어 있으면 깨진 알림톡 → 차단(unfilled).
 *  - `@@필드키@@`: 일부 수신자에 해당 필드 데이터가 없으면 빈 값 발송 → 차단(no_data).
 *  - 직접 입력 값(빈 값 아님): 정상.
 * 자동매핑(#3-1)은 그대로 두고, 본 검증으로 깨진 발송만 막는다(설계 확정).
 */

export type AlimtalkVarIssueKind = 'unfilled' | 'no_data';

export interface AlimtalkVarIssue {
  variable: string;        // #{name} 형태 원본 변수
  field?: string;          // @@field@@ 의 field (no_data 시)
  missingCount: number;    // 데이터가 없는 수신자 수
  kind: AlimtalkVarIssueKind;
}

export interface AlimtalkVarValidation {
  ok: boolean;
  issues: AlimtalkVarIssue[];
}

/** 템플릿 본문에서 #{...} 변수 추출 (중복 제거). */
export function extractAlimtalkVariables(content: string | null | undefined): string[] {
  if (!content) return [];
  const matches = content.match(/#\{[^}]+\}/g) || [];
  return Array.from(new Set(matches));
}

export function validateAlimtalkVariables(
  templateContent: string | null | undefined,
  variableMap: Record<string, string>,
  recipients: Array<Record<string, any>>,
): AlimtalkVarValidation {
  const issues: AlimtalkVarIssue[] = [];
  const list = Array.isArray(recipients) ? recipients : [];
  const map = variableMap || {};
  // ★ 검증 기준은 variableMap이 아니라 "템플릿 본문에 실제로 있는 변수" 전체.
  //   매핑이 비어(예: {}) 변수가 통째로 누락돼도 unfilled로 잡아 깨진 발송을 막는다.
  for (const variable of extractAlimtalkVariables(templateContent)) {
    const val = String(map[variable] ?? '').trim();
    if (val === '') {
      // 미지정 — 매핑/값이 비어 있거나 variableMap에 아예 없음
      issues.push({ variable, missingCount: list.length, kind: 'unfilled' });
      continue;
    }
    if (val.startsWith('@@') && val.endsWith('@@')) {
      // @@field@@ — 수신자별 데이터 존재 확인 (backend 치환 로직과 동일 키 기준)
      const field = val.slice(2, -2);
      const missingCount = list.filter((r) => {
        const v = r?.[field];
        return v == null || String(v).trim() === '';
      }).length;
      if (missingCount > 0) {
        issues.push({ variable, field, missingCount, kind: 'no_data' });
      }
    }
    // 그 외 = 직접 입력 값(빈 값 아님) → 정상
  }
  return { ok: issues.length === 0, issues };
}
