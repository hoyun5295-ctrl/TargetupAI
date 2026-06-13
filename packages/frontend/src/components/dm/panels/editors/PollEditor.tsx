import type { PollProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Toggle } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';

const genId = () => 'opt-' + Math.random().toString(36).slice(2, 9);

export default function PollEditor({ props, onUpdate }: EditorProps<PollProps>) {
  const options = props.options || [];
  const setItem = (i: number, label: string) =>
    onUpdate({ options: options.map((o, idx) => (idx === i ? { ...o, label } : o)) });
  const move = (from: number, to: number) => { const a = [...options]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ options: a }); };
  return (
    <>
      <Field label="질문"><TextInput value={props.question} onChange={(v) => onUpdate({ question: v })} placeholder="어떤 색상을 더 선호하시나요?" /></Field>
      <Field label="선택지">
        <RepeatableList
          items={options}
          addLabel="+ 선택지 추가"
          max={8}
          onAdd={() => onUpdate({ options: [...options, { id: genId(), label: '' }] })}
          onRemove={(i) => onUpdate({ options: options.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(o, i) => <TextInput value={o.label} onChange={(v) => setItem(i, v)} placeholder={`선택지 ${i + 1}`} />}
        />
      </Field>
      <Field label="복수 선택"><Toggle value={props.allow_multiple ?? false} onChange={(v) => onUpdate({ allow_multiple: v })} /></Field>
      <Field label="투표 후 결과 표시"><Toggle value={props.show_result_after_vote ?? true} onChange={(v) => onUpdate({ show_result_after_vote: v })} /></Field>
      <Field label="1인 1회 투표"><Toggle value={props.one_vote_per_user ?? true} onChange={(v) => onUpdate({ one_vote_per_user: v })} /></Field>
    </>
  );
}
