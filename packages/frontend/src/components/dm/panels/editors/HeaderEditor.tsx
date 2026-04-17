import type { HeaderProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Select, ImageUploader, DateTimePicker } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function HeaderEditor({ props, onUpdate }: EditorProps<HeaderProps>) {
  return (
    <>
      <Field label="형태">
        <Select
          value={props.variant || 'logo'}
          onChange={(v) => onUpdate({ variant: v as HeaderProps['variant'] })}
          options={[
            { value: 'logo', label: '로고 (브랜드 + 전화)' },
            { value: 'banner', label: '풀 배너 이미지' },
            { value: 'countdown', label: 'D-Day 카운트다운' },
            { value: 'coupon', label: '쿠폰 강조' },
          ]}
        />
      </Field>

      <Field label="브랜드명">
        <TextInput value={props.brand_name} onChange={(v) => onUpdate({ brand_name: v })} placeholder="브랜드명" />
      </Field>

      {(props.variant === 'logo' || !props.variant) && (
        <>
          <Field label="로고 이미지">
            <ImageUploader value={props.logo_url} onChange={(url) => onUpdate({ logo_url: url })} label="로고" />
          </Field>
          <Field label="대표 전화" hint="탭하면 전화 연결">
            <TextInput value={props.phone} onChange={(v) => onUpdate({ phone: v })} type="tel" placeholder="02-1234-5678" />
          </Field>
        </>
      )}

      {props.variant === 'banner' && (
        <Field label="배너 이미지">
          <ImageUploader value={props.banner_image_url} onChange={(url) => onUpdate({ banner_image_url: url })} label="배너" />
        </Field>
      )}

      {props.variant === 'countdown' && (
        <>
          <Field label="이벤트 제목">
            <TextInput value={props.event_title} onChange={(v) => onUpdate({ event_title: v })} placeholder="봄 신상 프로모션" />
          </Field>
          <Field label="이벤트 종료일">
            <DateTimePicker value={props.event_date} onChange={(v) => onUpdate({ event_date: v })} />
          </Field>
        </>
      )}

      {props.variant === 'coupon' && (
        <>
          <Field label="할인 라벨">
            <TextInput value={props.discount_label} onChange={(v) => onUpdate({ discount_label: v })} placeholder="전 품목 20% 할인" />
          </Field>
          <Field label="쿠폰 코드">
            <TextInput value={props.coupon_code} onChange={(v) => onUpdate({ coupon_code: v })} placeholder="SPRING20" />
          </Field>
        </>
      )}
    </>
  );
}
