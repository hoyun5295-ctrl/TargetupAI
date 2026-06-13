import type { LimitedQuantityProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function LimitedQuantityEditor({ props, onUpdate }: EditorProps<LimitedQuantityProps>) {
  return (
    <>
      <Field label="제목"><TextInput value={props.title} onChange={(v) => onUpdate({ title: v })} placeholder="선착순 100명 한정 특가" /></Field>
      <Field label="설명 (선택)"><TextArea value={props.description} onChange={(v) => onUpdate({ description: v })} placeholder="이벤트 안내" rows={2} /></Field>
      <Field label="총 수량"><TextInput type="number" value={props.total_quantity} onChange={(v) => onUpdate({ total_quantity: v ? Number(v) : 0 })} placeholder="100" /></Field>
      <Field label="참여 링크 (선택)"><TextInput type="url" value={props.signup_url} onChange={(v) => onUpdate({ signup_url: v })} placeholder="https://..." /></Field>
    </>
  );
}
