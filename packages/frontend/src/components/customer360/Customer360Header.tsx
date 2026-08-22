/**
 * Customer360Header — 고객 360 헤더 (★ 2026-08-22 v2). 훅 0, props만.
 *
 * 부모(고객 DB 조회) 헤더와 같은 띠(bg-gray-50 · border-b · 80px)에 내용만 이 창 규칙으로:
 *   이니셜 타일 + 이름 19px + 번호·매장 한 줄 / 우측 정렬 칩(등급 · 수신 상태) + 헤어라인 + 닫기.
 * 칩을 이름 옆에서 떼어 우측에 두는 이유: 이름 길이마다 칩 x좌표가 달라지면 "각"이 안 잡힌다.
 * 응답 전에는 fallback(목록 값)으로 실물을 그리고 칩 자리만 자리표시 — 이름이 없으면 "이름 없음" 대신 골격.
 */
import { X, User } from 'lucide-react';
import { CUI_PILL_BASE, CUI_PILL_DOT, CUI_PILL_TONE } from '../../utils/console-ui';
import {
  C360_AVATAR, C360_CLOSE, C360_HAIRLINE, C360_HEADER, C360_HEADER_RIGHT, C360_HEADER_SPLIT,
  C360_NAME, C360_NAME_SKELETON, C360_PILL_SKELETON, C360_SUB, C360_SUB_PHONE,
} from './c360-ui';
import type { TimelineCustomer } from './useCustomerTimeline';

interface Props {
  customer: TimelineCustomer | null;
  fallbackName?: string | null;
  fallbackPhone?: string | null;
  onClose: () => void;
}

const PHONE_FMT = (p: string | null | undefined) => {
  const v = String(p || '').replace(/[^0-9]/g, '');
  if (v.length === 11) return `${v.slice(0, 3)}-${v.slice(3, 7)}-${v.slice(7)}`;
  if (v.length === 10) return `${v.slice(0, 3)}-${v.slice(3, 6)}-${v.slice(6)}`;
  return p || '';
};

export default function Customer360Header({ customer, fallbackName, fallbackPhone, onClose }: Props) {
  const name = customer?.name ?? fallbackName ?? null;
  const phone = customer?.phone ?? fallbackPhone ?? null;
  const initial = name ? name.trim().charAt(0) : '';
  const storeText = customer
    ? customer.stores.length === 0 ? '' : customer.stores.length === 1 ? customer.stores[0] : `매장 ${customer.stores.length}곳`
    : '';

  return (
    <div className={C360_HEADER}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={C360_AVATAR} aria-hidden="true">
          {initial || <User className="w-5 h-5" strokeWidth={1.8} />}
        </div>
        <div className="min-w-0">
          {name ? <h3 className={C360_NAME}>{name}</h3> : <div className={C360_NAME_SKELETON} aria-label="이름 불러오는 중" />}
          <div className={C360_SUB}>
            {phone && <span className={C360_SUB_PHONE}>{PHONE_FMT(phone)}</span>}
            {phone && storeText && <span className={C360_HAIRLINE} aria-hidden="true" />}
            {storeText && <span className="truncate max-w-[220px]">{storeText}</span>}
          </div>
        </div>
      </div>

      <div className={C360_HEADER_RIGHT}>
        {customer ? (
          <>
            {customer.grade && (
              <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE.neutral}`}><i className={CUI_PILL_DOT} aria-hidden="true" />{customer.grade}</span>
            )}
            {customer.isUnsubscribed ? (
              <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE.rose}`}><i className={CUI_PILL_DOT} aria-hidden="true" />수신거부</span>
            ) : customer.smsOptIn ? (
              <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE.green}`}><i className={CUI_PILL_DOT} aria-hidden="true" />수신 동의</span>
            ) : (
              <span className={`${CUI_PILL_BASE} ${CUI_PILL_TONE.neutral}`}><i className={CUI_PILL_DOT} aria-hidden="true" />수신 미동의</span>
            )}
          </>
        ) : (
          <span className={C360_PILL_SKELETON} aria-hidden="true" />
        )}
        <span className={C360_HEADER_SPLIT} aria-hidden="true" />
        <button type="button" onClick={onClose} aria-label="닫기" className={C360_CLOSE}>
          <X className="w-[18px] h-[18px]" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
