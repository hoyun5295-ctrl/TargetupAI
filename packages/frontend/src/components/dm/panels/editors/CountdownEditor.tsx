import type { CountdownProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Toggle, DateTimePicker } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function CountdownEditor({ props, onUpdate }: EditorProps<CountdownProps>) {
  return (
    <>
      <Field label="종료 일시" hint="현재 시각 기준 카운트다운됩니다">
        <DateTimePicker value={props.end_datetime} onChange={(v) => onUpdate({ end_datetime: v })} />
      </Field>

      <Field label="상단 문구">
        <TextInput value={props.urgency_text} onChange={(v) => onUpdate({ urgency_text: v })} placeholder="마감까지" />
      </Field>

      <Field label="표시 단위">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <UnitToggle label="일" value={props.show_days} onChange={(v) => onUpdate({ show_days: v })} />
          <UnitToggle label="시간" value={props.show_hours} onChange={(v) => onUpdate({ show_hours: v })} />
          <UnitToggle label="분" value={props.show_minutes} onChange={(v) => onUpdate({ show_minutes: v })} />
          <UnitToggle label="초" value={props.show_seconds} onChange={(v) => onUpdate({ show_seconds: v })} />
        </div>
      </Field>
    </>
  );
}

function UnitToggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span style={{ fontSize: 11, color: 'var(--dm-neutral-700)', minWidth: 20 }}>{label}</span>
      <Toggle value={value} onChange={onChange} labelOn="표시" labelOff="숨김" />
    </div>
  );
}
