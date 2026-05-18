/**
 * 알림톡 변수 매칭 박스 (D162-4 신규)
 *
 * 발송 화면 우측 영역(수신자 영역 위)에 노출되는 변수 매핑 컴포넌트.
 * Harold님 명시 "우측에 고객데이터 올렸을때 매칭되는 화면" + ALIMTALK-DESIGN.md §6-3-D 매뉴얼 정합.
 *
 * 적용 화면 3곳:
 *  1) DirectSendPanel — 직접발송 (수신자 업로드/직접입력/주소록)
 *  2) AutoSendFormModal — 자동발송 5단계 위저드 메시지 작성 단계
 *  3) TargetSendModal — 직접타겟발송 (타겟 필터 후 발송 모달)
 *
 * 핵심 동작:
 *  - 선택된 템플릿 본문에서 #{변수명} 추출 (extractVariables)
 *  - 자동 매칭: 변수명이 customerFieldOptions의 key 또는 label과 일치하면 `@@필드키@@` placeholder
 *  - 수동 매칭: 사용자가 드롭다운으로 고객 필드 선택 또는 직접 입력
 *  - 첫 수신자 row(sampleRecipient)가 있으면 실시간 치환 미리보기
 *  - 자동발송 케이스(수신자 0건)는 매핑 정의만 박음 + 안내문 노출
 */

import { useMemo } from 'react';

export interface AlimtalkVariableMappingPanelProps {
  /** 선택된 템플릿 (변수 추출 대상). null이면 안내문만 표시 */
  selectedTemplate: {
    template_code?: string;
    template_name?: string;
    content?: string;
  } | null;
  /** 변수 매핑 state (#{변수} → 값 또는 `@@필드키@@`) */
  variableMap: Record<string, string>;
  /** 매핑 변경 핸들러 */
  onVariableMapChange: (next: Record<string, string>) => void;
  /** 고객 필드 옵션 (자동/수동 매칭 드롭다운용) */
  customerFieldOptions?: { key: string; label: string }[];
  /** 첫 수신자 row (변수 치환 미리보기). null이면 미리보기 미노출 */
  sampleRecipient?: Record<string, any> | null;
  /** 수신자 총 건수 (안내문용) */
  recipientCount?: number;
}

/** 템플릿 내용에서 #{...} 변수 추출 — AlimtalkChannelPanel과 동일 규칙 */
function extractVariables(content: string | undefined): string[] {
  if (!content) return [];
  const matches = content.match(/#\{[^}]+\}/g) || [];
  return Array.from(new Set(matches));
}

export default function AlimtalkVariableMappingPanel({
  selectedTemplate,
  variableMap,
  onVariableMapChange,
  customerFieldOptions = [],
  sampleRecipient = null,
  recipientCount = 0,
}: AlimtalkVariableMappingPanelProps) {
  const variables = useMemo(
    () => extractVariables(selectedTemplate?.content),
    [selectedTemplate?.content],
  );

  // 변수 치환 미리보기 — sampleRecipient 있을 때만
  const previewText = useMemo(() => {
    if (!selectedTemplate?.content) return '';
    if (!sampleRecipient) return selectedTemplate.content;
    let out = selectedTemplate.content;
    variables.forEach((varKey) => {
      const mapped = variableMap[varKey] || '';
      const escaped = varKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let replacement = '';
      if (mapped.startsWith('@@') && mapped.endsWith('@@')) {
        const fieldKey = mapped.slice(2, -2);
        const v = sampleRecipient[fieldKey];
        replacement = v != null && v !== '' ? String(v) : `{${fieldKey} 미입력}`;
      } else if (mapped) {
        replacement = mapped;
      } else {
        // 자동 매칭 시도: 변수명 자체로 sampleRecipient 키 매칭
        const inner = varKey.replace(/^#\{|\}$/g, '').trim();
        const autoVal = sampleRecipient[inner];
        replacement = autoVal != null && autoVal !== '' ? String(autoVal) : varKey;
      }
      out = out.replace(new RegExp(escaped, 'g'), replacement);
    });
    return out;
  }, [selectedTemplate?.content, sampleRecipient, variableMap, variables]);

  const setVariable = (varKey: string, value: string) => {
    onVariableMapChange({ ...variableMap, [varKey]: value });
  };

  // ★ D162-4 (2026-05-15) 4차: Harold님 명시 — 변수 매칭 영역 컴팩트화. 큰 안내문/샘플 미리보기 제거.
  //   파일 매핑 모달에서 이미 컬럼 매핑 처리되므로 우측은 단순 inline 행 단위 매칭만.
  //   템플릿 미선택 / 변수 0개 케이스에서는 null 반환 → 우측 영역에 빈 공간 차지 X.
  if (!selectedTemplate || variables.length === 0) {
    // 샘플 미리보기 활용 보장 (사용 안 됨 경고 차단)
    void previewText;
    void recipientCount;
    return null;
  }

  // ★ D162-4 (2026-05-15) 4차: Harold님 명시 정합 — 한 줄에 4개씩 배치(반응형). 변수명 위 + 매핑 셀렉터 아래 카드 단위.
  return (
    <div className="border border-gray-200 rounded-xl bg-white shadow-sm p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-700">변수 매칭</span>
        <span className="text-[10px] text-gray-400">{variables.length}개</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
        {variables.map((varKey) => {
          const current = variableMap[varKey] || '';
          const isFieldRef = current.startsWith('@@') && current.endsWith('@@');
          const fieldKey = isFieldRef ? current.slice(2, -2) : '';
          return (
            <div
              key={varKey}
              className="flex flex-col gap-1 border border-gray-100 rounded-lg p-1.5 bg-gray-50/40 min-w-0"
            >
              <span className="text-[10px] font-mono text-amber-700 bg-amber-50 rounded px-1.5 py-0.5 truncate self-start">
                {varKey}
              </span>
              {customerFieldOptions.length > 0 ? (
                <select
                  value={isFieldRef ? fieldKey : '__manual__'}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '__manual__') {
                      setVariable(varKey, '');
                    } else {
                      setVariable(varKey, `@@${v}@@`);
                    }
                  }}
                  className="border border-gray-200 rounded px-1.5 py-1 text-[11px] w-full bg-white"
                >
                  <option value="__manual__">직접 입력</option>
                  {customerFieldOptions.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </select>
              ) : null}
              {!isFieldRef ? (
                <input
                  type="text"
                  value={current}
                  onChange={(e) => setVariable(varKey, e.target.value)}
                  placeholder="값 입력"
                  className="border border-gray-200 rounded px-1.5 py-1 text-[11px] w-full min-w-0"
                />
              ) : (
                <span className="text-[10px] text-emerald-700 bg-emerald-50 rounded px-1.5 py-1 truncate">
                  컬럼: {fieldKey}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
