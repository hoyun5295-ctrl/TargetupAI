import type { MapStoreLocatorProps, MapStore } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Toggle } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';

const genId = () => 'st-' + Math.random().toString(36).slice(2, 9);

export default function MapStoreLocatorEditor({ props, onUpdate }: EditorProps<MapStoreLocatorProps>) {
  const stores = props.stores || [];
  const setStore = (i: number, patch: Partial<MapStore>) =>
    onUpdate({ stores: stores.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  const move = (from: number, to: number) => { const a = [...stores]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ stores: a }); };
  return (
    <>
      <Field label="매장 목록">
        <RepeatableList
          items={stores}
          addLabel="+ 매장 추가"
          onAdd={() => onUpdate({ stores: [...stores, { id: genId(), name: '', address: '', lat: 0, lng: 0 }] })}
          onRemove={(i) => onUpdate({ stores: stores.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(s, i) => (
            <>
              <TextInput value={s.name} onChange={(v) => setStore(i, { name: v })} placeholder="매장명" />
              <div style={{ height: 6 }} />
              <TextInput value={s.address} onChange={(v) => setStore(i, { address: v })} placeholder="주소" />
              <div style={{ height: 6 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <TextInput value={s.phone} onChange={(v) => setStore(i, { phone: v })} placeholder="전화" />
                <TextInput value={s.hours} onChange={(v) => setStore(i, { hours: v })} placeholder="영업시간" />
              </div>
              <div style={{ height: 6 }} />
              <div style={{ display: 'flex', gap: 6 }}>
                <TextInput type="number" value={s.lat} onChange={(v) => setStore(i, { lat: v ? Number(v) : 0 })} placeholder="위도" />
                <TextInput type="number" value={s.lng} onChange={(v) => setStore(i, { lng: v ? Number(v) : 0 })} placeholder="경도" />
              </div>
            </>
          )}
        />
      </Field>
      <Field label="사용자 위치 사용"><Toggle value={props.enable_user_location ?? false} onChange={(v) => onUpdate({ enable_user_location: v })} /></Field>
    </>
  );
}
