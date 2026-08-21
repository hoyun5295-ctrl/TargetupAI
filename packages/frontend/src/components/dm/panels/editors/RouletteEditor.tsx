import type { RouletteProps, RouletteSegment } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Toggle } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';

const genId = () => 's-' + Math.random().toString(36).slice(2, 9);

export default function RouletteEditor({ props, onUpdate }: EditorProps<RouletteProps>) {
  const segments = props.segments || [];
  const setSeg = (i: number, patch: Partial<RouletteSegment>) =>
    onUpdate({ segments: segments.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const move = (from: number, to: number) => { const a = [...segments]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ segments: a }); };
  const sumPct = Math.round(segments.reduce((acc, s) => acc + (s.probability || 0), 0) * 100);

  return (
    <>
      <Field label="룰렛 칸" hint="재고>0 + 경품명 = 당첨 칸, 나머지는 꽝">
        <RepeatableList
          items={segments}
          addLabel="+ 칸 추가"
          max={12}
          onAdd={() => onUpdate({ segments: [...segments, { id: genId(), label: '꽝', probability: 0 }] })}
          onRemove={(i) => onUpdate({ segments: segments.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(s, i) => (
            <>
              <TextInput value={s.label} onChange={(v) => setSeg(i, { label: v })} placeholder="칸 이름 (예: 1등 / 꽝)" />
              <div style={{ height: 6 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <TextInput type="number" value={Math.round((s.probability || 0) * 100)} onChange={(v) => setSeg(i, { probability: v ? Number(v) / 100 : 0 })} placeholder="당첨 확률 %" />
                <TextInput type="number" value={s.prize_count} onChange={(v) => setSeg(i, { prize_count: v ? Number(v) : undefined })} placeholder="재고(0=꽝)" />
              </div>
              <div style={{ height: 6 }} />
              <TextInput value={s.reward_description} onChange={(v) => setSeg(i, { reward_description: v })} placeholder="경품명 (재고>0일 때)" />
            </>
          )}
        />
      </Field>
      <div style={{ fontSize: 11, fontWeight: 700, color: sumPct === 100 ? 'var(--dm-neutral-600)' : '#d97706', marginBottom: 10 }}>
        확률 합계: {sumPct}%{sumPct !== 100 ? ' (100%를 권장합니다)' : ''}
      </div>
      <Field label="1인 1회 한정"><Toggle value={props.one_spin_per_user ?? true} onChange={(v) => onUpdate({ one_spin_per_user: v })} /></Field>
    </>
  );
}
