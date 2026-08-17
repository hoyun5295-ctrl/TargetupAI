/**
 * 알림톡/브랜드메시지 버튼 에디터
 *
 * - 최대 5개
 * - 9종 타입: WL/AL/DS/BK/MD/BF/BC/AC/PD
 * - 타입별 필수 필드 동적 표시
 *
 * ALIMTALK-DESIGN.md §3, §5-2 참조.
 */

import { useMemo } from 'react';
import { KUI_INPUT } from '../../utils/kakao-ui';

export type ButtonLinkType =
  | 'WL' | 'AL' | 'DS' | 'BK' | 'MD' | 'BF' | 'BC' | 'AC' | 'PD';

export interface AlimtalkButton {
  type: ButtonLinkType;
  name: string;
  urlMobile?: string;
  urlPc?: string;
  schemeAndroid?: string;
  schemeIos?: string;
  chatExtra?: string;
  chatEvent?: string;
  bizFormId?: number;
  pluginId?: string;
  relayId?: string;
  oneclickId?: string;
  productId?: string;
  telNumber?: string;
  mapAddress?: string;
  mapCoordinates?: string;
  target?: 'out' | 'in';
}

interface Props {
  buttons: AlimtalkButton[];
  onChange: (buttons: AlimtalkButton[]) => void;
  disabled?: boolean;
  max?: number;
  /** 메시지 타입이 AD(채널추가형)인 경우 AC 버튼 자동 고정 */
  forceChannelAdd?: boolean;
  /**
   * ★ D152-4 Harold님 지시 (2026-05-12) — 직원 5/12 PDF #1:
   *   알림톡 메시지유형 (BA/EX/AD/MI). AC(채널추가) 버튼은 카카오 정책상
   *   AD(채널추가형) 또는 MI(복합형)에서만 사용 가능.
   *   BA(기본형)/EX(부가정보형)에서는 select 옵션에서 AC 미노출 → 직원 사고 차단.
   */
  messageType?: 'BA' | 'EX' | 'AD' | 'MI' | string;
}

const BUTTON_TYPES_ALL: { value: ButtonLinkType; label: string; hint: string }[] = [
  { value: 'WL', label: '웹링크',        hint: '모바일/PC URL' },
  { value: 'AL', label: '앱링크',        hint: '모바일/PC URL + Android/iOS scheme' },
  { value: 'DS', label: '배송조회',      hint: '택배사 연동' },
  { value: 'BK', label: '봇키워드',      hint: '봇 이벤트' },
  { value: 'MD', label: '메시지전달',    hint: 'chatExtra' },
  { value: 'BF', label: '비즈폼',        hint: 'bizFormId 필수' },
  { value: 'BC', label: '비즈콜',        hint: '전화번호' },
  { value: 'AC', label: '채널추가',      hint: '채널추가형/복합형 메시지유형 전용 (BA/EX 불가)' },
  { value: 'PD', label: '상품상세',      hint: 'productId' },
];

/**
 * ★ D152-4 Harold님 지시 (2026-05-12) — 직원 5/12 PDF #1:
 *   메시지유형별 사용 가능 버튼 옵션 동적 필터링.
 *   AC(채널추가) 버튼은 messageType이 'AD'(채널추가형) 또는 'MI'(복합형)일 때만 노출.
 *   BA(기본형)/EX(부가정보형)에서는 AC 옵션 자체를 select에서 숨김 → 직원이 잘못 선택 불가.
 */
function getAvailableButtonTypes(messageType?: string, forceChannelAdd?: boolean) {
  const canUseAC = forceChannelAdd || messageType === 'AD' || messageType === 'MI';
  if (canUseAC) return BUTTON_TYPES_ALL;
  return BUTTON_TYPES_ALL.filter((t) => t.value !== 'AC');
}

export default function ButtonEditor({
  buttons,
  onChange,
  disabled,
  max = 5,
  forceChannelAdd,
  messageType,
}: Props) {
  const availableTypes = getAvailableButtonTypes(messageType, forceChannelAdd);
  const addBtn = () => {
    if (buttons.length >= max) return;
    onChange([...buttons, { type: 'WL', name: '' }]);
  };

  const removeBtn = (idx: number) => {
    if (forceChannelAdd && buttons[idx]?.type === 'AC') return;
    onChange(buttons.filter((_, i) => i !== idx));
  };

  // ★ D135+ (B6): AC 타입 버튼은 IMC 정책상 name이 반드시 "채널 추가"여야 함.
  //   기존: forceChannelAdd(AD/MI 타입)일 때만 name 고정 → 기본형(BA)에서 사용자가 AC 수동 추가 시
  //         name 자유 편집 가능 → IMC가 `buttonList[i] AC 버튼명은 "채널 추가"로만 설정 가능` 에러 반환.
  //   수정: type 전환/추가와 관계없이 type='AC'면 항상 name='채널 추가' 강제. forceChannelAdd 무관.
  // ★ D151+ (PDF 0511 #1): type 전환 시 name 잔존 차단.
  //   AC→다른 type: 이전 '채널 추가' 텍스트 자동 클리어 (사용자가 빈 input에서 새 버튼명 입력).
  //   다른→AC: '채널 추가' 강제 (IMC 정책 유지).
  const updateBtn = (idx: number, patch: Partial<AlimtalkButton>) => {
    const next = buttons.slice();
    const prev = next[idx];
    const merged = { ...prev, ...patch };
    if (patch.type && patch.type !== prev?.type) {
      if (patch.type === 'AC') {
        merged.name = '채널 추가';
      } else if (prev?.type === 'AC') {
        merged.name = '';
      }
    } else if (merged.type === 'AC') {
      merged.name = '채널 추가';
    }
    next[idx] = merged;
    onChange(next);
  };

  const canAdd = !disabled && buttons.length < max;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[12.5px] font-semibold text-neutral-700">
          버튼 <span className="text-neutral-400">({buttons.length}/{max})</span>
        </label>
        <button
          type="button"
          disabled={!canAdd}
          onClick={addBtn}
          className="text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:text-neutral-300"
        >
          + 버튼 추가
        </button>
      </div>

      {buttons.length === 0 && (
        <p className="text-[12.5px] text-neutral-500">추가된 버튼이 없습니다.</p>
      )}

      {buttons.map((btn, idx) => (
        <ButtonRow
          key={idx}
          idx={idx}
          btn={btn}
          disabled={disabled}
          nameLocked={btn.type === 'AC'}
          removeLocked={!!(forceChannelAdd && btn.type === 'AC')}
          availableTypes={availableTypes}
          onPatch={(p) => updateBtn(idx, p)}
          onRemove={() => removeBtn(idx)}
        />
      ))}
    </div>
  );
}

function ButtonRow({
  idx,
  btn,
  disabled,
  nameLocked,
  removeLocked,
  availableTypes,
  onPatch,
  onRemove,
}: {
  idx: number;
  btn: AlimtalkButton;
  disabled?: boolean;
  /** type='AC'일 때 name 편집 잠금 (IMC 정책: AC 버튼명은 "채널 추가" 고정) */
  nameLocked?: boolean;
  /** AD/MI 타입에서 강제 삽입된 AC 버튼 → 타입/삭제 잠금 */
  removeLocked?: boolean;
  /** ★ D152-4: 메시지유형별 사용 가능 버튼 옵션 (BA/EX에서는 AC 제외) */
  availableTypes: typeof BUTTON_TYPES_ALL;
  onPatch: (p: Partial<AlimtalkButton>) => void;
  onRemove: () => void;
}) {
  // ★ D152-4: 기존 AC 버튼이 저장되어 있는데 messageType=BA/EX로 변경된 경우
  //   availableTypes에 AC가 없어도 select에는 현재 type 값이 보여야 함 (사용자 인지 가능)
  const typesForSelect = useMemo(() => {
    if (availableTypes.find((t) => t.value === btn.type)) return availableTypes;
    const currentType = BUTTON_TYPES_ALL.find((t) => t.value === btn.type);
    return currentType ? [...availableTypes, currentType] : availableTypes;
  }, [availableTypes, btn.type]);

  const hint = useMemo(
    () => BUTTON_TYPES_ALL.find((t) => t.value === btn.type)?.hint || '',
    [btn.type],
  );

  const typeLocked = disabled || removeLocked;

  return (
    <div className="mb-2 bg-neutral-50 border border-neutral-200 p-3 rounded-lg space-y-2">
      <div className="flex gap-2 items-center">
        <span className="text-[12px] text-neutral-500 w-6 tabular-nums">{idx + 1}.</span>
        <select
          value={btn.type}
          disabled={typeLocked}
          onChange={(e) => onPatch({ type: e.target.value as ButtonLinkType })}
          className={`${KUI_INPUT} h-8 text-[13px] w-24`}
        >
          {typesForSelect.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
        <input
          value={btn.name}
          disabled={disabled || nameLocked}
          readOnly={nameLocked}
          onChange={(e) => onPatch({ name: e.target.value })}
          placeholder="버튼명 (최대 14자)"
          maxLength={14}
          className={`${KUI_INPUT} h-8 text-[13px] flex-1`}
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled || removeLocked}
          className={`text-sm px-1 ${disabled || removeLocked ? 'text-gray-300 cursor-not-allowed' : 'text-red-400 hover:text-red-600'}`}
        >
          &times;
        </button>
      </div>

      {hint && <p className="text-[12px] text-neutral-500 ml-8">{hint}</p>}

      {btn.type === 'WL' && (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={btn.urlMobile || ''}
            onChange={(e) => onPatch({ urlMobile: e.target.value })}
            placeholder="모바일 URL"
            className={`${KUI_INPUT} h-8 text-[13px] w-auto`}
          />
          <input
            value={btn.urlPc || ''}
            onChange={(e) => onPatch({ urlPc: e.target.value })}
            placeholder="PC URL (선택)"
            className={`${KUI_INPUT} h-8 text-[13px] w-auto`}
          />
        </div>
      )}

      {btn.type === 'AL' && (
        <div className="space-y-1.5">
          <div className="grid grid-cols-2 gap-2">
            <input
              value={btn.urlMobile || ''}
              onChange={(e) => onPatch({ urlMobile: e.target.value })}
              placeholder="모바일 URL"
              className={`${KUI_INPUT} h-8 text-[13px] w-auto`}
            />
            <input
              value={btn.urlPc || ''}
              onChange={(e) => onPatch({ urlPc: e.target.value })}
              placeholder="PC URL (선택)"
              className={`${KUI_INPUT} h-8 text-[13px] w-auto`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={btn.schemeAndroid || ''}
              onChange={(e) => onPatch({ schemeAndroid: e.target.value })}
              placeholder="Android scheme"
              className={`${KUI_INPUT} h-8 text-[13px] w-auto`}
            />
            <input
              value={btn.schemeIos || ''}
              onChange={(e) => onPatch({ schemeIos: e.target.value })}
              placeholder="iOS scheme"
              className={`${KUI_INPUT} h-8 text-[13px] w-auto`}
            />
          </div>
        </div>
      )}

      {btn.type === 'MD' && (
        <input
          value={btn.chatExtra || ''}
          onChange={(e) => onPatch({ chatExtra: e.target.value })}
          placeholder="chatExtra (메시지 전달 파라미터)"
          className={`${KUI_INPUT} h-8 text-[13px]`}
        />
      )}

      {btn.type === 'BK' && (
        <input
          value={btn.chatEvent || ''}
          onChange={(e) => onPatch({ chatEvent: e.target.value })}
          placeholder="chatEvent (봇 이벤트 이름)"
          className={`${KUI_INPUT} h-8 text-[13px]`}
        />
      )}

      {btn.type === 'BF' && (
        <input
          type="number"
          value={btn.bizFormId ?? ''}
          onChange={(e) =>
            onPatch({ bizFormId: e.target.value ? Number(e.target.value) : undefined })
          }
          placeholder="bizFormId (비즈폼 ID)"
          className={`${KUI_INPUT} h-8 text-[13px]`}
        />
      )}

      {btn.type === 'BC' && (
        <input
          value={btn.telNumber || ''}
          onChange={(e) => onPatch({ telNumber: e.target.value })}
          placeholder="전화번호 (예: 021234567)"
          className={`${KUI_INPUT} h-8 text-[13px]`}
        />
      )}

      {btn.type === 'PD' && (
        <input
          value={btn.productId || ''}
          onChange={(e) => onPatch({ productId: e.target.value })}
          placeholder="productId (상품 ID)"
          className={`${KUI_INPUT} h-8 text-[13px]`}
        />
      )}

      {btn.type === 'AC' && (
        <p className="text-[12px] text-amber-700 ml-8">
          {removeLocked
            ? '채널추가형 메시지는 "채널 추가" 버튼이 필수입니다 (삭제 불가)'
            : '카카오 정책상 "채널 추가" 버튼의 버튼명은 수정할 수 없습니다'}
        </p>
      )}
    </div>
  );
}
