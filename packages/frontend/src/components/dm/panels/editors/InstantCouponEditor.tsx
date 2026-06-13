import type { InstantCouponProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, DateTimePicker } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function InstantCouponEditor({ props, onUpdate }: EditorProps<InstantCouponProps>) {
  return (
    <>
      <Field label="쿠폰 라벨" hint="회사가 직접 작성"><TextInput value={props.coupon_label} onChange={(v) => onUpdate({ coupon_label: v })} placeholder="[직접 작성해주세요]" /></Field>
      <Field label="할인 설명" hint="회사가 직접 작성"><TextInput value={props.discount_description} onChange={(v) => onUpdate({ discount_description: v })} placeholder="[직접 작성해주세요]" /></Field>
      <Field label="만료일시 (선택)"><DateTimePicker value={props.expires_at} onChange={(v) => onUpdate({ expires_at: v })} /></Field>
      <Field label="사용 조건 (선택)"><TextArea value={props.conditions} onChange={(v) => onUpdate({ conditions: v })} placeholder="1회 사용 / 온라인 한정" rows={2} /></Field>
      <Field label="사용 안내 (선택)"><TextArea value={props.usage_instructions} onChange={(v) => onUpdate({ usage_instructions: v })} placeholder="결제 시 쿠폰 코드 입력" rows={2} /></Field>
    </>
  );
}
