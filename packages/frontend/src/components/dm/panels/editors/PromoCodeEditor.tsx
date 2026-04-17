import type { PromoCodeProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function PromoCodeEditor({ props, onUpdate }: EditorProps<PromoCodeProps>) {
  return (
    <>
      <Field label="코드" hint="대소문자 구분 없이 노출">
        <TextInput value={props.code} onChange={(v) => onUpdate({ code: v })} placeholder="SPRING20" />
      </Field>

      <Field label="상단 문구 (선택)">
        <TextInput value={props.description} onChange={(v) => onUpdate({ description: v })} placeholder="신규 가입 감사 쿠폰" />
      </Field>

      <Field label="사용 방법">
        <TextArea value={props.instructions} onChange={(v) => onUpdate({ instructions: v })} rows={2} placeholder="결제 시 쿠폰 코드 입력" />
      </Field>

      <Field label="버튼 연결 URL">
        <TextInput type="url" value={props.cta_url} onChange={(v) => onUpdate({ cta_url: v })} placeholder="https://..." />
      </Field>

      <Field label="버튼 라벨">
        <TextInput value={props.cta_label} onChange={(v) => onUpdate({ cta_label: v })} placeholder="지금 사용하기" />
      </Field>
    </>
  );
}
