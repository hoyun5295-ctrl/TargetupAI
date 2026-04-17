import type { CtaProps, CtaButton } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Select } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function CtaEditor({ props, onUpdate }: EditorProps<CtaProps>) {
  const buttons: CtaButton[] = Array.isArray(props.buttons) ? props.buttons : [];

  const updateBtn = (i: number, patch: Partial<CtaButton>) => {
    const next = buttons.slice();
    next[i] = { ...next[i], ...patch };
    onUpdate({ buttons: next });
  };
  const addBtn = () => {
    if (buttons.length >= 2) return;
    onUpdate({ buttons: [...buttons, { label: '자세히 보기', url: '', style: 'secondary' }] });
  };
  const removeBtn = (i: number) => {
    onUpdate({ buttons: buttons.filter((_, idx) => idx !== i) });
  };

  return (
    <>
      <Field label="버튼 배치">
        <Select
          value={props.layout || 'stack'}
          onChange={(v) => onUpdate({ layout: v as CtaProps['layout'] })}
          options={[
            { value: 'stack', label: '세로' },
            { value: 'row', label: '가로' },
          ]}
        />
      </Field>

      {buttons.map((b, i) => (
        <div key={i} style={{ padding: 10, background: 'var(--dm-neutral-50)', borderRadius: 6, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--dm-neutral-700)' }}>버튼 {i + 1}</span>
            <button
              onClick={() => removeBtn(i)}
              style={{ fontSize: 10, color: 'var(--dm-error)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >삭제</button>
          </div>
          <Field label="라벨"><TextInput value={b.label} onChange={(v) => updateBtn(i, { label: v })} placeholder="자세히 보기" /></Field>
          <Field label="URL"><TextInput type="url" value={b.url} onChange={(v) => updateBtn(i, { url: v })} placeholder="https://..." /></Field>
          <Field label="스타일">
            <Select
              value={b.style || 'primary'}
              onChange={(v) => updateBtn(i, { style: v as CtaButton['style'] })}
              options={[
                { value: 'primary', label: '기본 (채움)' },
                { value: 'secondary', label: '보조 (회색)' },
                { value: 'outline', label: '외곽선' },
              ]}
            />
          </Field>
        </div>
      ))}

      {buttons.length < 2 && (
        <button
          onClick={addBtn}
          style={{ width: '100%', height: 30, border: '1px dashed var(--dm-neutral-300)', borderRadius: 6, background: 'transparent', fontSize: 11, color: 'var(--dm-neutral-700)', cursor: 'pointer' }}
        >
          + 버튼 추가 (최대 2개)
        </button>
      )}
    </>
  );
}
