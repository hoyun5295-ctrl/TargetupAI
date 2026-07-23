import type { CouponProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Select, DateTimePicker, ColorOverride } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function CouponEditor({ props, onUpdate }: EditorProps<CouponProps>) {
  return (
    <>
      <Field label="할인 타입">
        <Select
          value={props.discount_type || 'percent'}
          onChange={(v) => onUpdate({ discount_type: v as CouponProps['discount_type'] })}
          options={[
            { value: 'percent', label: '% 할인' },
            { value: 'amount', label: '금액 할인' },
            { value: 'free_shipping', label: '무료 배송' },
          ]}
        />
      </Field>

      <Field label="할인 라벨" hint="예: 20% 할인 / 5,000원 할인">
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

      <Field label="쿠폰코드 버튼 색" hint="'쿠폰코드' 알약 배경 — 미지정 = 기본 검정">
        <ColorOverride value={props.button_color} onChange={(v) => onUpdate({ button_color: v })} />
      </Field>

      <Field label="쿠폰코드 글씨색" hint="미지정 = 기본 흰색. (‘쿠폰 사용하기’ 연결 버튼 색은 ‘빠른 디자인 → 버튼 색’)">
        <ColorOverride value={props.code_text_color} onChange={(v) => onUpdate({ code_text_color: v })} />
      </Field>
    </>
  );
}
