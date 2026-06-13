import type { SlideshowProps, SlideshowSlide } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Toggle, ImageUploader, MultiImageUploader } from '../FormControls';
import { RepeatableList } from '../RepeatableList';
import type { EditorProps } from '../SectionPropsEditor';

export default function SlideshowEditor({ props, onUpdate }: EditorProps<SlideshowProps>) {
  const slides = props.slides || [];
  const setItem = (i: number, patch: Partial<SlideshowSlide>) =>
    onUpdate({ slides: slides.map((it, idx) => (idx === i ? { ...it, ...patch } : it)) });
  const move = (from: number, to: number) => { const a = [...slides]; const [m] = a.splice(from, 1); a.splice(to, 0, m); onUpdate({ slides: a }); };
  return (
    <>
      <Field label="슬라이드">
        <MultiImageUploader label="슬라이드 이미지" onAdd={(urls) => onUpdate({ slides: [...slides, ...urls.map((url) => ({ image_url: url }))] })} />
        <RepeatableList
          items={slides}
          addLabel="+ 슬라이드 추가"
          onAdd={() => onUpdate({ slides: [...slides, { image_url: '' }] })}
          onRemove={(i) => onUpdate({ slides: slides.filter((_, idx) => idx !== i) })}
          onMove={move}
          renderItem={(it, i) => (
            <>
              <ImageUploader label="슬라이드 이미지" value={it.image_url} onChange={(url) => setItem(i, { image_url: url })} />
              <div style={{ height: 6 }} />
              <TextInput value={it.caption} onChange={(v) => setItem(i, { caption: v })} placeholder="캡션 (선택)" />
            </>
          )}
        />
      </Field>
      <Field label="전환 간격 (밀리초)" hint="예: 4000 = 4초">
        <TextInput type="number" value={props.interval_ms} onChange={(v) => onUpdate({ interval_ms: v ? Number(v) : 4000 })} placeholder="4000" />
      </Field>
      <Field label="일시정지 버튼"><Toggle value={props.show_pause ?? true} onChange={(v) => onUpdate({ show_pause: v })} /></Field>
      <Field label="인디케이터"><Toggle value={props.show_indicator ?? true} onChange={(v) => onUpdate({ show_indicator: v })} /></Field>
    </>
  );
}
