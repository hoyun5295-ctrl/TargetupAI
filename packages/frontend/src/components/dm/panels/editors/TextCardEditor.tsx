import type { TextCardProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Select, ImageUploader } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function TextCardEditor({ props, onUpdate }: EditorProps<TextCardProps>) {
  return (
    <>
      <Field label="태그 (선택)" hint="NEW / BEST 등 강조">
        <TextInput value={props.tag} onChange={(v) => onUpdate({ tag: v })} placeholder="NEW" />
      </Field>

      <Field label="헤드라인">
        <TextInput value={props.headline} onChange={(v) => onUpdate({ headline: v })} placeholder="이번 달 추천 상품" />
      </Field>

      <Field label="본문">
        <TextArea value={props.body} onChange={(v) => onUpdate({ body: v })} rows={5} placeholder="고객님을 위한 한 마디..." />
      </Field>

      <Field label="정렬">
        <Select
          value={props.align || 'left'}
          onChange={(v) => onUpdate({ align: v as TextCardProps['align'] })}
          options={[
            { value: 'left', label: '왼쪽' },
            { value: 'center', label: '가운데' },
          ]}
        />
      </Field>

      <Field label="이미지 (선택)">
        <ImageUploader value={props.image_url} onChange={(url) => onUpdate({ image_url: url })} />
      </Field>

      {props.image_url && (
        <Field label="이미지 위치">
          <Select
            value={props.image_position || 'top'}
            onChange={(v) => onUpdate({ image_position: v as TextCardProps['image_position'] })}
            options={[
              { value: 'top', label: '위' },
              { value: 'bottom', label: '아래' },
              { value: 'left', label: '왼쪽' },
              { value: 'right', label: '오른쪽' },
            ]}
          />
        </Field>
      )}
    </>
  );
}
