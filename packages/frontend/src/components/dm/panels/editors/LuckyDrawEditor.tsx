import type { LuckyDrawProps, LuckyDrawFormField } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Toggle, DateTimePicker } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';

const FIELD_LABELS: Record<LuckyDrawFormField['name'], string> = { name: '이름', phone: '전화번호', email: '이메일' };

export default function LuckyDrawEditor({ props, onUpdate }: EditorProps<LuckyDrawProps>) {
  const fields = props.form_fields || [];
  const prizes = props.prizes || [];
  const hasField = (n: LuckyDrawFormField['name']) => fields.some((f) => f.name === n);
  const toggleField = (n: LuckyDrawFormField['name']) =>
    onUpdate({ form_fields: hasField(n) ? fields.filter((f) => f.name !== n) : [...fields, { name: n, required: true }] });
  const setPrize = (i: number, patch: Partial<{ rank: number; name: string; count: number }>) =>
    onUpdate({ prizes: prizes.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });

  return (
    <>
      <Field label="제목"><TextInput value={props.title} onChange={(v) => onUpdate({ title: v })} placeholder="신규 가입 추첨 이벤트" /></Field>
      <Field label="설명 (선택)"><TextArea value={props.description} onChange={(v) => onUpdate({ description: v })} placeholder="이벤트 안내" rows={2} /></Field>

      <Field label="응모 입력 항목">
        {(['name', 'phone', 'email'] as LuckyDrawFormField['name'][]).map((n) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, width: 56 }}>{FIELD_LABELS[n]}</span>
            <Toggle value={hasField(n)} onChange={() => toggleField(n)} labelOn="수집" labelOff="미수집" />
          </div>
        ))}
      </Field>

      <Field label="추첨 마감일시"><DateTimePicker value={props.draw_at} onChange={(v) => onUpdate({ draw_at: v })} /></Field>

      <Field label="경품 등급" hint="마감 후 등급별 인원만큼 자동 추첨">
        <RepeatableList
          items={prizes}
          addLabel="+ 경품 등급 추가"
          onAdd={() => onUpdate({ prizes: [...prizes, { rank: prizes.length + 1, name: '', count: 1 }] })}
          onRemove={(i) => onUpdate({ prizes: prizes.filter((_, idx) => idx !== i) })}
          renderItem={(p, i) => (
            <>
              <div style={{ display: 'flex', gap: 6 }}>
                <TextInput type="number" value={p.rank} onChange={(v) => setPrize(i, { rank: v ? Number(v) : 1 })} placeholder="등급" />
                <TextInput type="number" value={p.count} onChange={(v) => setPrize(i, { count: v ? Number(v) : 1 })} placeholder="인원" />
              </div>
              <div style={{ height: 6 }} />
              <TextInput value={p.name} onChange={(v) => setPrize(i, { name: v })} placeholder="경품명 (예: 스타벅스 기프티콘)" />
            </>
          )}
        />
      </Field>

      <Field label="개인정보 동의 문구"><TextArea value={props.consent_text} onChange={(v) => onUpdate({ consent_text: v })} placeholder="개인정보 수집 및 마케팅 정보 수신 동의" rows={2} /></Field>
    </>
  );
}
