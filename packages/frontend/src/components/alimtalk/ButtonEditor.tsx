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
}

const BUTTON_TYPES: { value: ButtonLinkType; label: string; hint: string }[] = [
  { value: 'WL', label: '웹링크',        hint: '모바일/PC URL' },
  { value: 'AL', label: '앱링크',        hint: '모바일/PC URL + Android/iOS scheme' },
  { value: 'DS', label: '배송조회',      hint: '택배사 연동' },
  { value: 'BK', label: '봇키워드',      hint: '봇 이벤트' },
  { value: 'MD', label: '메시지전달',    hint: 'chatExtra' },
  { value: 'BF', label: '비즈폼',        hint: 'bizFormId 필수' },
  { value: 'BC', label: '비즈콜',        hint: '전화번호' },
  { value: 'AC', label: '채널추가',      hint: '변수 불가' },
  { value: 'PD', label: '상품상세',      hint: 'productId' },
];

export default function ButtonEditor({
  buttons,
  onChange,
  disabled,
  max = 5,
  forceChannelAdd,
}: Props) {
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
  const updateBtn = (idx: number, patch: Partial<AlimtalkButton>) => {
    const next = buttons.slice();
    const merged = { ...next[idx], ...patch };
    if (merged.type === 'AC') merged.name = '채널 추가';
    next[idx] = merged;
    onChange(next);
  };

  const canAdd = !disabled && buttons.length < max;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs font-medium text-gray-600">
          버튼 <span className="text-gray-400">({buttons.length}/{max})</span>
        </label>
        <button
          type="button"
          disabled={!canAdd}
          onClick={addBtn}
          className="text-xs text-amber-600 hover:text-amber-700 disabled:text-gray-300"
        >
          + 버튼 추가
        </button>
      </div>

      {buttons.length === 0 && (
        <p className="text-xs text-gray-400">추가된 버튼이 없습니다.</p>
      )}

      {buttons.map((btn, idx) => (
        <ButtonRow
          key={idx}
          idx={idx}
          btn={btn}
          disabled={disabled}
          nameLocked={btn.type === 'AC'}
          removeLocked={!!(forceChannelAdd && btn.type === 'AC')}
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
  onPatch: (p: Partial<AlimtalkButton>) => void;
  onRemove: () => void;
}) {
  const hint = useMemo(
    () => BUTTON_TYPES.find((t) => t.value === btn.type)?.hint || '',
    [btn.type],
  );

  const typeLocked = disabled || removeLocked;

  return (
    <div className="mb-2 bg-gray-50 p-2 rounded-lg space-y-1.5">
      <div className="flex gap-2 items-center">
        <span className="text-[11px] text-gray-400 w-6">{idx + 1}.</span>
        <select
          value={btn.type}
          disabled={typeLocked}
          onChange={(e) => onPatch({ type: e.target.value as ButtonLinkType })}
          className="border border-gray-300 rounded px-2 py-1 text-xs w-24 disabled:bg-gray-200"
        >
          {BUTTON_TYPES.map((t) => (
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
          className="border border-gray-300 rounded px-2 py-1 text-xs flex-1 disabled:bg-gray-200"
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

      {hint && <p className="text-[11px] text-gray-400 ml-8">{hint}</p>}

      {btn.type === 'WL' && (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={btn.urlMobile || ''}
            onChange={(e) => onPatch({ urlMobile: e.target.value })}
            placeholder="모바일 URL"
            className="border border-gray-300 rounded px-2 py-1 text-xs"
          />
          <input
            value={btn.urlPc || ''}
            onChange={(e) => onPatch({ urlPc: e.target.value })}
            placeholder="PC URL (선택)"
            className="border border-gray-300 rounded px-2 py-1 text-xs"
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
              className="border border-gray-300 rounded px-2 py-1 text-xs"
            />
            <input
              value={btn.urlPc || ''}
              onChange={(e) => onPatch({ urlPc: e.target.value })}
              placeholder="PC URL (선택)"
              className="border border-gray-300 rounded px-2 py-1 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={btn.schemeAndroid || ''}
              onChange={(e) => onPatch({ schemeAndroid: e.target.value })}
              placeholder="Android scheme"
              className="border border-gray-300 rounded px-2 py-1 text-xs"
            />
            <input
              value={btn.schemeIos || ''}
              onChange={(e) => onPatch({ schemeIos: e.target.value })}
              placeholder="iOS scheme"
              className="border border-gray-300 rounded px-2 py-1 text-xs"
            />
          </div>
        </div>
      )}

      {btn.type === 'MD' && (
        <input
          value={btn.chatExtra || ''}
          onChange={(e) => onPatch({ chatExtra: e.target.value })}
          placeholder="chatExtra (메시지 전달 파라미터)"
          className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
        />
      )}

      {btn.type === 'BK' && (
        <input
          value={btn.chatEvent || ''}
          onChange={(e) => onPatch({ chatEvent: e.target.value })}
          placeholder="chatEvent (봇 이벤트 이름)"
          className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
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
          className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
        />
      )}

      {btn.type === 'BC' && (
        <input
          value={btn.telNumber || ''}
          onChange={(e) => onPatch({ telNumber: e.target.value })}
          placeholder="전화번호 (예: 021234567)"
          className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
        />
      )}

      {btn.type === 'PD' && (
        <input
          value={btn.productId || ''}
          onChange={(e) => onPatch({ productId: e.target.value })}
          placeholder="productId (상품 ID)"
          className="border border-gray-300 rounded px-2 py-1 text-xs w-full"
        />
      )}

      {btn.type === 'AC' && (
        <p className="text-[11px] text-amber-600 ml-8">
          {removeLocked
            ? '채널추가형 메시지는 "채널 추가" 버튼이 필수입니다 (삭제 불가)'
            : '카카오 정책상 "채널 추가" 버튼의 버튼명은 수정할 수 없습니다'}
        </p>
      )}
    </div>
  );
}
