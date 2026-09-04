/**
 * CouponEditor — 쿠폰 편집 패널 (DM·이메일 공용).
 *
 * ★ 2026-09-04 임은지 접수 `cmtl45k4207zljnotyot1x338` — "할인 타입을 다르게 적용해도 화면에 달라지는 게 없다".
 *   맞다. `discount_type`(% 할인·금액 할인·무료 배송)은 **편집기만 쓰고 읽는 쪽이 한 곳도 없던 고아 속성**이었다
 *   (편집 캔버스 `CouponSection.tsx` · DM 발행 SSR `renderCoupon*` · 이메일 `renderCoupon` 전수 grep 0건).
 *   혜택 표현은 바로 아래 "할인 라벨" 자유 입력이 이미 전부 담고, 쿠폰의 시각 변형 축은 **구도**(기본·티켓·
 *   스포트라이트)가 소유한다. 타입에 시각을 또 주면 두 축이 같은 것을 다투고 라벨과 어긋난 표시가 생긴다.
 *   ⛔ 다시 넣지 말 것 — 넣는다면 세 렌더 면(캔버스·DM SSR·이메일)과 두 계약표에 함께 등재한다.
 *   선례 = dm-property-contract `DM_WIRED_ORPHAN_MARKERS` 주석의 제거된 죽은 컨트롤 2종(no_dead_controls).
 */
import type { CouponProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, DateTimePicker, ColorOverride } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function CouponEditor({ props, onUpdate }: EditorProps<CouponProps>) {
  return (
    <>
      <Field label="할인 라벨" hint="예: 20% 할인 / 5,000원 할인 / 무료 배송">
        <TextInput value={props.discount_label} onChange={(v) => onUpdate({ discount_label: v })} placeholder="20% 할인" />
      </Field>

      <Field label="쿠폰 코드">
        <TextInput value={props.coupon_code} onChange={(v) => onUpdate({ coupon_code: v })} placeholder="SPRING20" />
      </Field>

      <Field label="유효기간 종료일" hint="빠른 선택을 누르면 그날 23:59로 잡히고, 아래에서 미세 조정할 수 있어요">
        <DateTimePicker value={props.expire_date} onChange={(v) => onUpdate({ expire_date: v })} quickPresets />
      </Field>

      <Field label="최소 구매 금액">
        <TextInput type="number" value={props.min_purchase} onChange={(v) => onUpdate({ min_purchase: v ? Number(v) : undefined })} placeholder="30000" />
      </Field>

      <Field label="사용 조건">
        <TextArea value={props.usage_condition} onChange={(v) => onUpdate({ usage_condition: v })} placeholder="온라인 몰 한정 / 1회 사용" rows={2} />
      </Field>

      <Field label="연결 URL">
        <TextInput type="url" value={props.cta_url} onChange={(v) => onUpdate({ cta_url: v })} placeholder="https://..." />
      </Field>

      <Field label="할인 라벨 글씨색" hint="미지정 = 기본 브랜드색">
        <ColorOverride value={props.label_color} onChange={(v) => onUpdate({ label_color: v })} />
      </Field>

      <Field label="쿠폰 카드 배경색" hint="미지정 = 기본 흰색">
        <ColorOverride value={props.card_bg_color} onChange={(v) => onUpdate({ card_bg_color: v })} />
      </Field>

      <Field label="쿠폰코드 버튼 색" hint="'쿠폰코드' 알약 배경 (미지정 = 기본 검정)">
        <ColorOverride value={props.button_color} onChange={(v) => onUpdate({ button_color: v })} />
      </Field>

      <Field label="쿠폰코드 글씨색" hint="미지정 = 기본 흰색. (‘쿠폰 사용하기’ 연결 버튼 색은 ‘빠른 디자인 → 버튼 색’)">
        <ColorOverride value={props.code_text_color} onChange={(v) => onUpdate({ code_text_color: v })} />
      </Field>
    </>
  );
}
