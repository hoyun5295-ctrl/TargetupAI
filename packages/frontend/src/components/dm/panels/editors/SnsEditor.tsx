import type { SnsProps, SnsChannel } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Select } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

const SNS_OPTIONS: Array<{ value: SnsChannel['type']; label: string }> = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'kakao', label: '카카오' },
  { value: 'naver', label: 'Naver' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'twitter', label: 'X (Twitter)' },
];

export default function SnsEditor({ props, onUpdate }: EditorProps<SnsProps>) {
  const channels: SnsChannel[] = Array.isArray(props.channels) ? props.channels : [];

  const updateCh = (i: number, patch: Partial<SnsChannel>) => {
    const next = channels.slice();
    next[i] = { ...next[i], ...patch };
    onUpdate({ channels: next });
  };
  const addCh = () => {
    onUpdate({ channels: [...channels, { type: 'instagram', url: '' }] });
  };
  const removeCh = (i: number) => {
    onUpdate({ channels: channels.filter((_, idx) => idx !== i) });
  };

  return (
    <>
      <Field label="표시 방식">
        <Select
          value={props.layout || 'icons'}
          onChange={(v) => onUpdate({ layout: v as SnsProps['layout'] })}
          options={[
            { value: 'icons', label: '아이콘 (원형)' },
            { value: 'buttons', label: '버튼 (라벨 포함)' },
          ]}
        />
      </Field>

      {channels.map((ch, i) => (
        <div key={i} style={{ padding: 10, background: 'var(--dm-neutral-50)', borderRadius: 6, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--dm-neutral-700)' }}>채널 {i + 1}</span>
            <button
              onClick={() => removeCh(i)}
              style={{ fontSize: 10, color: 'var(--dm-error)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >삭제</button>
          </div>
          <Field label="플랫폼">
            <Select value={ch.type} onChange={(v) => updateCh(i, { type: v as SnsChannel['type'] })} options={SNS_OPTIONS} />
          </Field>
          <Field label="URL">
            <TextInput type="url" value={ch.url} onChange={(v) => updateCh(i, { url: v })} placeholder="https://instagram.com/..." />
          </Field>
          {props.layout === 'buttons' && (
            <Field label="핸들 (선택)" hint="예: brand_name (버튼에 @brand_name 표시)">
              <TextInput value={ch.handle} onChange={(v) => updateCh(i, { handle: v })} placeholder="brand" />
            </Field>
          )}
        </div>
      ))}

      <button
        onClick={addCh}
        style={{ width: '100%', height: 30, border: '1px dashed var(--dm-neutral-300)', borderRadius: 6, background: 'transparent', fontSize: 11, color: 'var(--dm-neutral-700)', cursor: 'pointer' }}
      >
        + 채널 추가
      </button>
    </>
  );
}
