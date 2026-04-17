import type { StoreInfoProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function StoreInfoEditor({ props, onUpdate }: EditorProps<StoreInfoProps>) {
  return (
    <>
      <Field label="전화번호" hint="탭하면 전화 연결">
        <TextInput type="tel" value={props.phone} onChange={(v) => onUpdate({ phone: v })} placeholder="02-1234-5678" />
      </Field>

      <Field label="홈페이지">
        <TextInput type="url" value={props.website} onChange={(v) => onUpdate({ website: v })} placeholder="https://..." />
      </Field>

      <Field label="이메일">
        <TextInput type="email" value={props.email} onChange={(v) => onUpdate({ email: v })} placeholder="hello@brand.com" />
      </Field>

      <Field label="주소">
        <TextArea value={props.address} onChange={(v) => onUpdate({ address: v })} rows={2} placeholder="서울시 강남구 ..." />
      </Field>

      <Field label="영업시간">
        <TextInput value={props.business_hours} onChange={(v) => onUpdate({ business_hours: v })} placeholder="평일 10:00 ~ 22:00" />
      </Field>

      <Field label="지도 링크 (카카오/네이버)">
        <TextInput type="url" value={props.map_url} onChange={(v) => onUpdate({ map_url: v })} placeholder="https://map.kakao.com/..." />
      </Field>
    </>
  );
}
