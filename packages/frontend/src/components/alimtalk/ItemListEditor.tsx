/**
 * 알림톡 ITEM_LIST 강조 유형 에디터
 *
 * D135+ (B8) 개선:
 *   - 상단에 "이미지 사용 / 헤더 사용 / 하이라이트 사용" 체크박스 3개
 *   - 이미지/헤더/하이라이트 중 1개 이상 필수 (validate는 상위 컴포넌트)
 *   - 헤더 체크 시 최대 16자 필수값 입력창
 *   - 하이라이트 체크 시 타이틀/설명 + 썸네일 이미지 (체크박스로 토글)
 *   - 용어 변경: 요약영역 → 아이템 요약 정보 / 요약제목 → 아이템 명(6자) / 요약설명 → 아이템 내용(14자)
 *
 * 구성:
 *   - templateImageName/Url (대표 이미지, 선택) — 기존 imageUrl/imageName 재활용
 *   - templateHeader (최대 16자, 선택)
 *   - templateItemHighlight { title, description, imageUrl? } (선택)
 *   - templateItem.list [{ title, description }, ...] (필수 1개 이상, 최대 10개)
 *   - templateItem.summary { title, description } (선택)
 */

import { useState } from 'react';
import KakaoChannelImageUpload from './KakaoChannelImageUpload';

export interface ItemHighlight {
  title: string;
  description: string;
  imageUrl?: string;
  imageName?: string;
}

export interface ItemListEntry {
  title: string;
  description: string;
}

export interface ItemSummary {
  title: string;
  description: string;
}

interface Props {
  /** ITEM_LIST 대표 이미지 (선택) — B8 신설 */
  imageUrl: string;
  imageName: string;
  onImageChange: (url: string, name: string) => void;

  header: string;
  onHeaderChange: (v: string) => void;

  highlight: ItemHighlight | null;
  onHighlightChange: (v: ItemHighlight | null) => void;

  list: ItemListEntry[];
  onListChange: (v: ItemListEntry[]) => void;

  summary: ItemSummary | null;
  onSummaryChange: (v: ItemSummary | null) => void;

  disabled?: boolean;
}

const IMAGE_SPEC_NOTE =
  '권장 800×400 (2:1) · 최소 500×250 · JPG/PNG · 최대 500KB';

export default function ItemListEditor({
  imageUrl, imageName, onImageChange,
  header, onHeaderChange,
  highlight, onHighlightChange,
  list, onListChange,
  summary, onSummaryChange,
  disabled,
}: Props) {
  const imageEnabled = !!imageUrl;
  const headerEnabled = header !== '' || false;
  const highlightEnabled = !!highlight;

  // ★ D139 #5 (0425): 체크 해제가 안 되던 버그 근본 수정.
  //   기존엔 imageToggleManual / headerToggleManual을 `!on` 시 false로 되돌리지 않아
  //   `imageSectionOpen = imageEnabled || imageToggleManual` 식이 영원히 true로 고정됐음.
  //   해제 시 manual sentinel도 false로 함께 내려야 체크박스 표시가 정상 토글된다.
  const [imageToggleManual, setImageToggleManual] = React.useState(false);
  const [headerToggleManual, setHeaderToggleManual] = React.useState(false);
  const imageSectionOpen = imageEnabled || imageToggleManual;
  const headerSectionOpen = headerEnabled || headerToggleManual;

  const toggleImage = (on: boolean) => {
    if (on) {
      if (!imageUrl) setImageToggleManual(true);
    } else {
      onImageChange('', '');
      setImageToggleManual(false); // ★ 해제 시 sentinel도 초기화
    }
  };
  const toggleHeader = (on: boolean) => {
    if (on) {
      if (!header) setHeaderToggleManual(true);
    } else {
      onHeaderChange('');
      setHeaderToggleManual(false); // ★ 해제 시 sentinel도 초기화
    }
  };

  const toggleHighlight = (on: boolean) => {
    if (on && !highlight) onHighlightChange({ title: '', description: '' });
    if (!on) onHighlightChange(null);
  };

  const addRow = () => {
    if (list.length >= 10) return;
    onListChange([...list, { title: '', description: '' }]);
  };
  // ★ D142+ D (2026-04-29) PDF 0428 알림톡 #1 [아이템리스트형]:
  //   "최소 2개 리스트 고정, 이후 추가 및 삭제 가능" — 직원 신고 정책.
  //   2개 이하일 때 삭제 차단 (실수로 1개로 줄이는 사고 방지).
  const removeRow = (i: number) => {
    if (list.length <= 2) return;
    onListChange(list.filter((_, idx) => idx !== i));
  };
  const patchRow = (i: number, p: Partial<ItemListEntry>) => {
    const next = list.slice();
    next[i] = { ...next[i], ...p };
    onListChange(next);
  };

  return (
    <div className="space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3.5">
      <p className="text-[13px] font-semibold text-neutral-900">아이템리스트 구성</p>
      <p className="text-[12px] text-neutral-500">
        ※ 이미지, 헤더, 하이라이트 중 <strong>1개 이상</strong>을 필수로 입력해야 합니다.
      </p>

      {/* ── 1. 이미지 사용 (B8 신설) ───────────────────────── */}
      <div className="space-y-2 rounded-lg bg-white p-2.5 border border-neutral-200">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={imageSectionOpen}
            disabled={disabled}
            onChange={(e) => toggleImage(e.target.checked)}
            className="w-[15px] h-[15px] accent-indigo-600 rounded cursor-pointer"
          />
          <span className="text-[13px] font-semibold text-neutral-900">이미지 사용</span>
          <span className="text-[12px] text-neutral-500">({IMAGE_SPEC_NOTE})</span>
        </label>
        {imageSectionOpen && (
          <KakaoChannelImageUpload
            uploadType="alimtalk_template"
            value={imageUrl}
            onChange={(url, name) => onImageChange(url, name)}
            disabled={disabled}
          />
        )}
      </div>

      {/* ── 2. 헤더 사용 ─────────────────────────────────── */}
      <div className="space-y-2 rounded-lg bg-white p-2.5 border border-neutral-200">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={headerSectionOpen}
            disabled={disabled}
            onChange={(e) => toggleHeader(e.target.checked)}
            className="w-[15px] h-[15px] accent-indigo-600 rounded cursor-pointer"
          />
          <span className="text-[13px] font-semibold text-neutral-900">헤더 사용</span>
          <span className="text-[12px] text-neutral-500">(최대 16자, 체크 시 필수)</span>
        </label>
        {headerSectionOpen && (
          <input
            value={header}
            onChange={(e) => onHeaderChange(e.target.value)}
            maxLength={16}
            disabled={disabled}
            placeholder="예: 주문 내역"
            className={`${KUI_INPUT} h-8 text-[13px]`}
          />
        )}
      </div>

      {/* ── 3. 하이라이트 영역 ────────────────────────────── */}
      <div className="space-y-2 rounded-lg bg-white p-2.5 border border-neutral-200">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={highlightEnabled}
            disabled={disabled}
            onChange={(e) => toggleHighlight(e.target.checked)}
            className="w-[15px] h-[15px] accent-indigo-600 rounded cursor-pointer"
          />
          <span className="text-[13px] font-semibold text-neutral-900">하이라이트 사용</span>
        </label>

        {highlight && (
          <div className="space-y-2 pl-6">
            <input
              value={highlight.title}
              disabled={disabled}
              onChange={(e) =>
                onHighlightChange({ ...highlight, title: e.target.value })
              }
              placeholder={
                highlight.imageUrl
                  ? '타이틀 (썸네일 추가 시 최대 21자)'
                  : '타이틀 (최대 30자)'
              }
              maxLength={highlight.imageUrl ? 21 : 30}
              className={`${KUI_INPUT} h-8 text-[13px]`}
            />
            <input
              value={highlight.description}
              disabled={disabled}
              onChange={(e) =>
                onHighlightChange({ ...highlight, description: e.target.value })
              }
              placeholder={
                highlight.imageUrl
                  ? '설명 (썸네일 추가 시 최대 13자)'
                  : '설명 (최대 19자)'
              }
              maxLength={highlight.imageUrl ? 13 : 19}
              className={`${KUI_INPUT} h-8 text-[13px]`}
            />
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                /* ★ D139 #6 (0425): `!!imageUrl`은 빈 문자열('')도 falsy라 체크 표시 사라지는 버그.
                   체크 ON 직후 imageUrl=''로 세팅되어 업로드 UI는 열리는데 체크박스 표시는 미반영됐었음.
                   undefined ≠ '' 으로 토글 상태 구분: undefined=꺼짐, '' 또는 URL=켜짐. */
                checked={highlight.imageUrl !== undefined}
                disabled={disabled}
                onChange={(e) => {
                  if (!e.target.checked) {
                    onHighlightChange({
                      ...highlight,
                      imageUrl: undefined,
                      imageName: undefined,
                    });
                  } else {
                    // 업로드 UI 노출 (실제 업로드 시 onChange가 url 세팅). '' 유지로 체크 표시 유지.
                    onHighlightChange({ ...highlight, imageUrl: '', imageName: '' });
                  }
                }}
                className="w-[15px] h-[15px] accent-indigo-600 rounded cursor-pointer"
              />
              <span className="text-[12px] font-semibold text-neutral-700">썸네일 이미지 사용</span>
              <span className="text-[12px] text-neutral-500">(108×108, JPG/PNG)</span>
            </label>
            {highlight.imageUrl !== undefined && (
              <>
                <p className="text-[12px] text-amber-700">
                  썸네일을 추가하면 타이틀은 21자, 설명은 13자까지 입력 가능합니다.
                </p>
                <KakaoChannelImageUpload
                  uploadType="alimtalk_highlight"
                  value={highlight.imageUrl}
                  onChange={(url, name) =>
                    onHighlightChange({ ...highlight, imageUrl: url, imageName: name })
                  }
                  disabled={disabled}
                />
              </>
            )}
          </div>
        )}
      </div>

      {/* ── 4. 아이템 목록 (필수, 최소 1개) ────────────────── */}
      <div className="space-y-2 rounded-lg bg-white p-2.5 border border-neutral-200">
        <div className="flex items-center justify-between">
          <label className="text-[13px] font-semibold text-neutral-900">
            {/* ★ D142+ D (2026-04-29): 최소 1개 → 2개 (PDF 0428 알림톡 [아이템리스트형] #1) */}
            아이템 목록 <span className="text-neutral-400">({list.length}/10, 최소 2개 필수)</span>
          </label>
          <button
            type="button"
            disabled={disabled || list.length >= 10}
            onClick={addRow}
            className="text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700 disabled:text-neutral-300"
          >
            + 아이템 추가
          </button>
        </div>
        {list.length < 2 && (
          <p className="text-[12.5px] font-semibold text-indigo-600">최소 2개 이상의 아이템을 추가하세요.</p>
        )}
        {list.map((item, i) => (
          <div key={i} className="flex gap-2 items-center">
            <span className="text-[12px] text-neutral-500 w-5 tabular-nums">{i + 1}</span>
            <input
              value={item.title}
              disabled={disabled}
              onChange={(e) => patchRow(i, { title: e.target.value })}
              placeholder="제목 (최대 6자)"
              maxLength={6}
              className={`${KUI_INPUT} h-8 text-[13px] w-28`}
            />
            <input
              value={item.description}
              disabled={disabled}
              onChange={(e) => patchRow(i, { description: e.target.value })}
              placeholder="설명 (최대 23자)"
              maxLength={23}
              className={`${KUI_INPUT} h-8 text-[13px] flex-1`}
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              disabled={disabled || list.length <= 2}
              title={list.length <= 2 ? '최소 2개 필수' : '아이템 삭제'}
              className="text-[13px] px-1 text-rose-500 hover:text-rose-700 disabled:text-neutral-300"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      {/* ── 5. 아이템 요약 정보 (선택) — B8 용어 변경 ───────── */}
      <div className="space-y-2 rounded-lg bg-white p-2.5 border border-neutral-200">
        <div className="flex items-center justify-between">
          <label className="text-[13px] font-semibold text-neutral-900">아이템 요약 정보</label>
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              onSummaryChange(summary ? null : { title: '', description: '' })
            }
            className="text-[12.5px] font-semibold text-indigo-600 hover:text-indigo-700"
          >
            {summary ? '사용 안 함' : '+ 사용'}
          </button>
        </div>

        {summary && (
          <>
            <input
              value={summary.title}
              disabled={disabled}
              onChange={(e) => onSummaryChange({ ...summary, title: e.target.value })}
              placeholder="아이템 명 (최대 6자)"
              maxLength={6}
              className={`${KUI_INPUT} h-8 text-[13px]`}
            />
            <input
              value={summary.description}
              disabled={disabled}
              onChange={(e) =>
                onSummaryChange({ ...summary, description: e.target.value })
              }
              placeholder="아이템 내용 (최대 14자, 화폐단위·숫자·쉼표·마침표·변수만)"
              maxLength={14}
              className={`${KUI_INPUT} h-8 text-[13px]`}
            />
          </>
        )}
      </div>
    </div>
  );
}

// React import (체크박스 수동 토글 state용)
import * as React from 'react';
import { KUI_INPUT } from '../../utils/kakao-ui';
