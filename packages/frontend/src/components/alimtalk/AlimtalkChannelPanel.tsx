/**
 * 알림톡 발송 공용 패널 (설계서 §6-3-D 기준)
 *
 * 자동발송(AutoSendFormModal) / 직접발송(DirectSendPanel) / 직접타겟발송(TargetSendModal)
 * 3군데에서 공통 import하여 사용하는 컨트롤타워 UI.
 *
 * 구성:
 *  1) 발신프로필 드롭다운 (승인된 것만)
 *  2) 템플릿 드롭다운 (해당 프로필 + 승인된 것만)
 *  3) 변수 매핑 (#{변수} ← 고객 필드 또는 수동값)
 *  4) 부달 발송 타입 (N/S/L/A/B) + A/B일 때 대체 문구
 *  5) 단가 표시 (15원/건)
 *  6) 카톡 말풍선 미리보기
 *
 * 백엔드 INSERT 스펙(QTmsg 매뉴얼):
 *  - msg_type = 'K'
 *  - k_template_code = template.template_code
 *  - k_next_type = 'N'/'S'/'L'/'A'/'B'
 *  - k_next_contents = A/B일 때 대체 문구
 *  - k_button_json = {"name1":"...","type1":"2","url1_1":"..."}
 *  - k_etc_json = {"senderkey":"...","title":"강조형 타이틀"}
 */

import { useEffect, useMemo, useState } from 'react';

export interface AlimtalkSenderProfile {
  id: string;
  profile_key: string;
  profile_name: string;
  yellow_id: string | null;
  approval_status: string | null;
  status: string;
}

export interface AlimtalkTemplate {
  id: string;
  template_code: string;
  template_name: string;
  profile_id: string;
  profile_key?: string | null;
  profile_name?: string | null;
  content: string;
  status: string;
  category?: string | null;
  message_type?: string;
  emphasize_type?: string;
  emphasize_title?: string | null;
  emphasize_subtitle?: string | null;
  buttons?: any[];
  security_flag?: boolean;
}

export type AlimtalkNextType = 'N' | 'S' | 'L' | 'A' | 'B';

export interface AlimtalkChannelState {
  profileId: string;
  templateCode: string;
  templateId: string;
  variableMap: Record<string, string>;    // #{name} → 실제값 또는 `@@필드키@@`
  nextType: AlimtalkNextType;
  nextContents: string;
}

interface Props {
  /** 승인된 발신프로필 목록 (호출부에서 필터 또는 전체 전달) */
  senders: AlimtalkSenderProfile[];
  /** 전체 템플릿 목록 (Panel 내부에서 profile + status 필터링) */
  templates: AlimtalkTemplate[];
  /** 고객 필드 목록 — 변수 자동 매핑 드롭다운용 (옵션) */
  customerFieldOptions?: { key: string; label: string }[];
  /** 현재 선택 상태 (제어 컴포넌트) */
  value: AlimtalkChannelState;
  onChange: (v: AlimtalkChannelState) => void;
  /** 템플릿 목록이 비었을 때 안내용 콜백 (선택) */
  onRequestTemplates?: () => void;
}

const EMPTY_STATE: AlimtalkChannelState = {
  profileId: '',
  templateCode: '',
  templateId: '',
  variableMap: {},
  nextType: 'L',
  nextContents: '',
};

export function createEmptyAlimtalkState(): AlimtalkChannelState {
  return { ...EMPTY_STATE, variableMap: {} };
}

const NEXT_TYPE_OPTIONS: { value: AlimtalkNextType; label: string; desc: string }[] = [
  { value: 'N', label: '대체 안함', desc: '실패 시 미발송 (에러)' },
  { value: 'S', label: 'SMS 대체', desc: '동일 문구 SMS 발송' },
  { value: 'L', label: 'LMS 대체', desc: '동일 문구 LMS 발송' },
  { value: 'A', label: 'A: SMS+문구', desc: '대체 문구로 SMS' },
  { value: 'B', label: 'B: LMS+문구', desc: '대체 문구로 LMS' },
];

const APPROVED_TEMPLATE_STATUSES = new Set(['APPROVED', 'APR', 'A', 'approved']);
const APPROVED_SENDER_STATUSES = new Set(['APPROVED']);

/** 템플릿 내용에서 #{...} 변수 추출 */
function extractVariables(content: string): string[] {
  const matches = content?.match(/#\{[^}]+\}/g) || [];
  return Array.from(new Set(matches));
}

export default function AlimtalkChannelPanel({
  senders,
  templates,
  customerFieldOptions = [],
  value,
  onChange,
  onRequestTemplates,
}: Props) {
  const [previewMode, setPreviewMode] = useState<'template' | 'filled'>('filled');

  // 승인된 발신프로필만
  const approvedSenders = useMemo(
    () =>
      senders.filter((s) =>
        APPROVED_SENDER_STATUSES.has((s.approval_status || '').toUpperCase()),
      ),
    [senders],
  );

  // 선택된 프로필 (없으면 첫 번째 자동 선택 유도)
  useEffect(() => {
    if (!value.profileId && approvedSenders.length === 1) {
      onChange({ ...value, profileId: approvedSenders[0].id });
    }
  }, [approvedSenders, value, onChange]);

  // 해당 프로필 + 승인 상태 템플릿만
  const visibleTemplates = useMemo(
    () =>
      templates.filter(
        (t) =>
          (!value.profileId || t.profile_id === value.profileId) &&
          APPROVED_TEMPLATE_STATUSES.has((t.status || '').toUpperCase()),
      ),
    [templates, value.profileId],
  );

  const selectedTemplate = useMemo(
    () => visibleTemplates.find((t) => t.template_code === value.templateCode) || null,
    [visibleTemplates, value.templateCode],
  );

  // 템플릿 변경 시 변수 맵 초기화
  const handleSelectTemplate = (t: AlimtalkTemplate | null) => {
    if (!t) {
      onChange({
        ...value,
        templateCode: '',
        templateId: '',
        variableMap: {},
      });
      return;
    }
    const vars = extractVariables(t.content);
    const next: Record<string, string> = {};
    vars.forEach((v) => {
      // 자동 매핑: #{name} → @@name@@ (고객 필드 자동 치환 placeholder)
      const inner = v.replace(/^#\{|\}$/g, '').trim();
      const fieldKey = customerFieldOptions.find(
        (f) => f.key === inner || f.label === inner,
      )?.key;
      next[v] = fieldKey ? `@@${fieldKey}@@` : value.variableMap[v] || '';
    });
    onChange({
      ...value,
      templateCode: t.template_code,
      templateId: t.id,
      variableMap: next,
    });
  };

  const setProfileId = (id: string) => {
    // 프로필 변경 시 템플릿 리셋 (다른 프로필의 템플릿과 섞이지 않도록)
    onChange({
      ...value,
      profileId: id,
      templateCode: '',
      templateId: '',
      variableMap: {},
    });
  };

  const setVariable = (k: string, v: string) => {
    onChange({ ...value, variableMap: { ...value.variableMap, [k]: v } });
  };

  const setNextType = (t: AlimtalkNextType) => {
    onChange({ ...value, nextType: t });
  };

  const setNextContents = (v: string) => {
    onChange({ ...value, nextContents: v });
  };

  const requiresNextContents = value.nextType === 'A' || value.nextType === 'B';

  // 미리보기 렌더: template content에서 변수 치환
  const renderPreview = (text: string | null | undefined): string => {
    if (!text) return '';
    let out = text;
    if (previewMode === 'filled') {
      Object.entries(value.variableMap).forEach(([k, v]) => {
        const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const replacement = v
          ? v.startsWith('@@') && v.endsWith('@@')
            ? `{${v.slice(2, -2)}}` // @@name@@ → {name} 시각 표시
            : v
          : k;
        out = out.replace(new RegExp(escaped, 'g'), replacement);
      });
    }
    return out;
  };

  return (
    <div className="border-2 border-blue-200 rounded-2xl overflow-hidden bg-white shadow-sm">
      <div className="p-4 space-y-4">
        {/* 헤더 */}
        <div className="flex items-center gap-2">
          <span className="text-lg">🔔</span>
          <span className="text-sm font-semibold text-blue-800">
            알림톡 (템플릿 기반)
          </span>
        </div>

        {/* 1) 발신프로필 드롭다운 */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            발신프로필 <span className="text-red-500">*</span>
          </label>
          {approvedSenders.length === 0 ? (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
              승인된 발신프로필이 없습니다. 슈퍼관리자 승인 후 사용 가능합니다.
            </p>
          ) : approvedSenders.length === 1 ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <strong>{approvedSenders[0].profile_name}</strong>
              {approvedSenders[0].yellow_id && (
                <span className="ml-1 text-emerald-600 font-mono">
                  {approvedSenders[0].yellow_id}
                </span>
              )}
            </div>
          ) : (
            <select
              value={value.profileId}
              onChange={(e) => setProfileId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="">선택</option>
              {approvedSenders.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.profile_name}
                  {s.yellow_id ? ` (${s.yellow_id})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* 2) 템플릿 목록 */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            템플릿 <span className="text-red-500">*</span>
          </label>
          {!value.profileId ? (
            <p className="text-xs text-gray-400 py-2">먼저 발신프로필을 선택해주세요.</p>
          ) : visibleTemplates.length === 0 ? (
            <div className="text-center py-6 border border-dashed rounded-lg bg-gray-50">
              <p className="text-sm text-gray-500">승인된 템플릿이 없습니다</p>
              {onRequestTemplates && (
                <button
                  type="button"
                  onClick={onRequestTemplates}
                  className="mt-2 text-xs text-blue-600 hover:underline"
                >
                  템플릿 등록/검수 바로가기
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-1.5 max-h-[240px] overflow-y-auto border border-gray-200 rounded-lg p-1.5 bg-gray-50">
              {visibleTemplates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => handleSelectTemplate(t)}
                  className={`w-full text-left p-2.5 rounded-lg border transition-colors text-xs ${
                    selectedTemplate?.id === t.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-blue-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-800">
                      {t.template_name}
                    </span>
                    <span className="text-[10px] text-green-700 bg-green-100 px-1.5 py-0.5 rounded">
                      승인
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-2">
                    {t.content}
                  </p>
                  {t.category && (
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      카테고리: {t.category}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 3) 변수 매핑 */}
        {selectedTemplate && Object.keys(value.variableMap).length > 0 && (
          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">
                변수 매핑
              </label>
              <span className="text-[10px] text-gray-400">
                고객 필드 자동 치환 또는 직접 입력
              </span>
            </div>
            <div className="space-y-1.5">
              {Object.keys(value.variableMap).map((varKey) => {
                const current = value.variableMap[varKey] || '';
                const isFieldRef =
                  current.startsWith('@@') && current.endsWith('@@');
                const fieldKey = isFieldRef ? current.slice(2, -2) : '';
                return (
                  <div key={varKey} className="flex items-center gap-2">
                    <span className="text-[11px] font-mono text-blue-700 w-24 shrink-0 truncate">
                      {varKey}
                    </span>
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
                        className="border border-gray-200 rounded px-1.5 py-1 text-[11px] max-w-[110px]"
                      >
                        <option value="__manual__">직접 입력</option>
                        {customerFieldOptions.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {!isFieldRef && (
                      <input
                        type="text"
                        value={current}
                        onChange={(e) => setVariable(varKey, e.target.value)}
                        placeholder="값 입력"
                        className="flex-1 border border-gray-200 rounded px-2 py-1 text-[11px]"
                      />
                    )}
                    {isFieldRef && (
                      <span className="flex-1 text-[11px] text-emerald-600 bg-emerald-50 rounded px-2 py-1">
                        고객 필드 자동 치환: {fieldKey}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 4) 부달 발송 */}
        {selectedTemplate && (
          <div className="border-t pt-3">
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              부달(대체) 발송
            </label>
            <p className="text-[11px] text-gray-400 mb-2">
              알림톡 전송 실패 시 자동 대체 발송 정책
            </p>
            <div className="grid grid-cols-5 gap-1">
              {NEXT_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setNextType(opt.value)}
                  title={opt.desc}
                  className={`py-1.5 text-[11px] font-medium rounded-lg border transition-colors ${
                    value.nextType === opt.value
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-gray-200 text-gray-600 hover:border-blue-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {requiresNextContents && (
              <div className="mt-2">
                <label className="block text-[11px] text-gray-500 mb-1">
                  대체 문구 {value.nextType === 'A' ? '(SMS)' : '(LMS)'}{' '}
                  <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={value.nextContents}
                  onChange={(e) => setNextContents(e.target.value)}
                  rows={3}
                  placeholder="알림톡 실패 시 이 문구로 대체 발송됩니다"
                  className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs resize-none"
                  maxLength={value.nextType === 'A' ? 90 : 2000}
                />
                <div className="text-right text-[10px] text-gray-400 mt-0.5">
                  {value.nextContents.length} /{' '}
                  {value.nextType === 'A' ? '90' : '2000'}자
                </div>
              </div>
            )}
          </div>
        )}

        {/* 5) 미리보기 */}
        {selectedTemplate && (
          <div className="border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-medium text-gray-600">
                미리보기
              </label>
              <div className="flex text-[10px] rounded-md border border-gray-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setPreviewMode('template')}
                  className={`px-2 py-0.5 ${
                    previewMode === 'template'
                      ? 'bg-gray-700 text-white'
                      : 'bg-white text-gray-500'
                  }`}
                >
                  원본
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode('filled')}
                  className={`px-2 py-0.5 ${
                    previewMode === 'filled'
                      ? 'bg-gray-700 text-white'
                      : 'bg-white text-gray-500'
                  }`}
                >
                  치환
                </button>
              </div>
            </div>
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 text-xs">
              {selectedTemplate.emphasize_type === 'TEXT' &&
                selectedTemplate.emphasize_title && (
                  <div className="font-bold text-sm text-gray-900 mb-2 pb-2 border-b border-yellow-200">
                    {renderPreview(selectedTemplate.emphasize_title)}
                  </div>
                )}
              <div className="whitespace-pre-wrap text-gray-700 leading-relaxed">
                {renderPreview(selectedTemplate.content)}
              </div>
              {Array.isArray(selectedTemplate.buttons) &&
                selectedTemplate.buttons.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-yellow-200 space-y-1.5">
                    {selectedTemplate.buttons.map((btn: any, i: number) => (
                      <div
                        key={i}
                        className="text-center text-xs bg-white border border-gray-200 rounded-lg py-1.5"
                      >
                        {btn.name || btn.buttonName || `버튼 ${i + 1}`}
                      </div>
                    ))}
                  </div>
                )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * 버튼 리스트(kakao_templates.buttons JSONB)를 QTmsg k_button_json 형식으로 변환
 *
 * 입력: [{ buttonName, buttonType, buttonUrlMobile, buttonUrlPc, ... }, ...]
 * 출력: {"name1":"...","type1":"2","url1_1":"...","url1_2":"...","name2":...}
 */
export function convertButtonsToQTmsg(buttons: any[] | null | undefined): string | null {
  if (!Array.isArray(buttons) || buttons.length === 0) return null;
  const TYPE_MAP: Record<string, string> = {
    DS: '1',       // 배송조회
    WL: '2',       // 웹링크
    AL: '3',       // 앱링크
    BK: '4',       // 봇키워드
    MD: '5',       // 메시지전달
    AC: '6',       // 채널추가
    BC: '4',       // 봇전환(봇키워드로 매핑)
    BF: '4',
    PD: '2',
  };
  const out: Record<string, string> = {};
  buttons.slice(0, 5).forEach((b, i) => {
    const n = i + 1;
    out[`name${n}`] =
      b.name || b.buttonName || b.label || `버튼${n}`;
    out[`type${n}`] = TYPE_MAP[b.type || b.buttonType] || '2';
    out[`url${n}_1`] =
      b.url1 || b.urlMobile || b.buttonUrlMobile || b.url || '';
    out[`url${n}_2`] = b.url2 || b.urlPc || b.buttonUrlPc || '';
  });
  return JSON.stringify(out);
}
