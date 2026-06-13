import type { GalleryProps, GalleryImage } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Select, Toggle, ImageUploader, MultiImageUploader } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';

export default function GalleryEditor({ props, onUpdate }: EditorProps<GalleryProps>) {
  const images = props.images || [];
  const setItem = (i: number, patch: Partial<GalleryImage>) =>
    onUpdate({ images: images.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  const move = (from: number, to: number) => { const a = [...images]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ images: a }); };
  return (
    <>
      <Field label="제목 (선택)"><TextInput value={props.title} onChange={(v) => onUpdate({ title: v })} placeholder="갤러리 제목" /></Field>
      <Field label="레이아웃">
        <Select
          value={props.layout || 'grid_2x2'}
          onChange={(v) => onUpdate({ layout: v as GalleryProps['layout'] })}
          options={[
            { value: 'grid_2x2', label: '2×2 그리드' },
            { value: 'grid_3x3', label: '3×3 그리드' },
            { value: 'list_1xN', label: '세로 1열' },
            { value: 'masonry', label: '벽돌형' },
          ]}
        />
      </Field>
      <Field label="이미지">
        <MultiImageUploader label="갤러리 이미지" onAdd={(urls) => onUpdate({ images: [...images, ...urls.map((url) => ({ url }))] })} />
        <RepeatableList
          items={images}
          addLabel="+ 이미지 추가"
          onAdd={() => onUpdate({ images: [...images, { url: '' }] })}
          onRemove={(i) => onUpdate({ images: images.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(it, i) => (
            <>
              <ImageUploader label="이미지" value={it.url} onChange={(url) => setItem(i, { url })} />
              <div style={{ height: 6 }} />
              <TextInput value={it.caption} onChange={(v) => setItem(i, { caption: v })} placeholder="캡션 (선택)" />
            </>
          )}
        />
      </Field>
      <Field label="확대 보기"><Toggle value={props.enable_zoom ?? true} onChange={(v) => onUpdate({ enable_zoom: v })} /></Field>
    </>
  );
}
