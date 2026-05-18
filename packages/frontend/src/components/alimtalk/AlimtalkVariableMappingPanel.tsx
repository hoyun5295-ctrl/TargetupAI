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

  if (!selectedTemplate) {
    return (
      <div className="border-2 border-dashed border-gray-200 rounded-2xl p-4 bg-gray-50/50">
        <p className="text-xs font-semibold text-gray-500 mb-1">변수 매칭</p>
        <p className="text-xs text-gray-400">
          좌측에서 알림톡 템플릿을 선택하면 변수 매칭 화면이 표시됩니다.
        </p>
      </div>
    );
  }

  if (variables.length === 0) {
    return (
      <div className="border-2 border-emerald-200 rounded-2xl p-4 bg-emerald-50/40">
        <p className="text-xs font-semibold text-emerald-700 mb-1">변수 매칭</p>
        <p className="text-xs text-emerald-600">
          선택한 템플릿에 치환 변수가 없습니다. 본문 그대로 발송됩니다.
        </p>
      </div>
    );
  }

  return (
    <div className="border-2 border-blue-200 rounded-2xl overflow-hidden bg-white shadow-sm">
      <div className="p-4 space-y-3">
        {/* 헤더 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔗</span>
            <span className="text-sm font-semibold text-blue-800">변수 매칭</span>
          </div>
          <span className="text-[10px] text-gray-400">{variables.length}개 변수</span>
        </div>

        <p className="text-[11px] text-gray-500 leading-relaxed">
          템플릿 변수(<span className="font-mono text-amber-700">{`#{변수명}`}</span>)에 사용할 값을 매핑합니다.
          고객 필드 선택 시 발송 대상자별 자동 치환되며, 직접 입력 시 모든 수신자에게 같은 값으로 발송됩니다.
        </p>

        {/* 매핑 행 */}
        <div className="space-y-2">
          {variables.map((varKey) => {
            const current = variableMap[varKey] || '';
            const isFieldRef = current.startsWith('@@') && current.endsWith('@@');
            const fieldKey = isFieldRef ? current.slice(2, -2) : '';
            const fieldLabel =
              customerFieldOptions.find((f) => f.key === fieldKey)?.label || fieldKey;
            return (
              <div
                key={varKey}
                className="grid grid-cols-[100px_1fr] gap-2 items-center"
              >
                <span className="text-[11px] font-mono text-amber-700 bg-amber-50 rounded px-2 py-1 truncate">
                  {varKey}
                </span>
                <div className="flex items-center gap-2">
                  {customerFieldOptions.length > 0 && (
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
                      className="border border-gray-200 rounded px-1.5 py-1 text-[11px] max-w-[130px] shrink-0"
                    >
                      <option value="__manual__">직접 입력</option>
                      {customerFieldOptions.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {isFieldRef ? (
                    <span className="flex-1 text-[11px] text-emerald-700 bg-emerald-50 rounded px-2 py-1 truncate">
                      고객 필드: {fieldLabel}
                    </span>
                  ) : (
                    <input
                      type="text"
                      value={current}
                      onChange={(e) => setVariable(varKey, e.target.value)}
                      placeholder="값 입력 (모든 수신자 동일)"
                      className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px]"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 샘플 미리보기 — sampleRecipient 있으면 첫 수신자 데이터로 치환된 결과 */}
        {sampleRecipient ? (
          <div className="border-t pt-3">
            <p className="text-[11px] font-semibold text-gray-600 mb-1">
              첫 수신자 치환 미리보기
              {recipientCount > 0 && (
                <span className="ml-1 text-gray-400">({recipientCount.toLocaleString()}명 중 1번째)</span>
              )}
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-[11px] text-gray-800 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
              {previewText}
            </div>
          </div>
        ) : (
          <div className="border-t pt-3">
            <p className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 rounded p-2 leading-relaxed">
              수신자 데이터를 업로드/입력하면 첫 수신자 기준 치환 미리보기를 확인할 수 있습니다.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
