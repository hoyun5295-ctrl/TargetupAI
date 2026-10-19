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
          onAdd={() => onUpdate({ stores: [...stores, { id: genId(), name: '', address: '' }] })}
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
              {/* ★ 2026-10-19 B-1014-3⑦ 위도 · 경도 입력칸 제거 — 지도는 주소 글자만 그려 좌표를 어디도 안 읽었다(거리 정렬 도입 때 함께 재도입) */}
            </>
          )}
        />
      </Field>
      {/* ★ 2026-07-21 "사용자 위치 사용"(enable_user_location) 토글 제거 — 매장 좌표(lat/lng) 데이터 모델과 위치 기반 거리정렬(Geolocation)이 미구축이라 켜도 발송물 무변화였던 죽은 컨트롤(no_dead_controls). 좌표 스키마 + 거리정렬 신설 후 별도 기능으로 재도입. */}
    </>
  );
}
