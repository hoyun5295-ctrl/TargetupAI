import type { TabCardsProps, TabCardItem } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Select } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';

export default function TabCardsEditor({ props, onUpdate }: EditorProps<TabCardsProps>) {
  const tabs = props.tabs || [];
  const setItem = (i: number, patch: Partial<TabCardItem>) =>
    onUpdate({ tabs: tabs.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  const move = (from: number, to: number) => { const a = [...tabs]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ tabs: a }); };
  return (
    <>
      <Field label="탭">
        <RepeatableList
          items={tabs}
          addLabel="+ 탭 추가"
          onAdd={() => onUpdate({ tabs: [...tabs, { label: '탭', content_type: 'text', content: '' }] })}
          onRemove={(i) => onUpdate({ tabs: tabs.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(it, i) => (
            <>
              <TextInput value={it.label} onChange={(v) => setItem(i, { label: v })} placeholder="탭 이름" />
              <div style={{ height: 6 }} />
              <Select
                value={it.content_type}
                onChange={(v) => setItem(i, { content_type: v as TabCardItem['content_type'] })}
                options={[
                  { value: 'text', label: '텍스트' },
                  { value: 'image', label: '이미지 URL' },
                  { value: 'product_list', label: '상품 목록' },
                ]}
              />
              <div style={{ height: 6 }} />
              <TextArea value={it.content} onChange={(v) => setItem(i, { content: v })} placeholder="내용" rows={2} />
            </>
          )}
        />
      </Field>
    </>
  );
}
