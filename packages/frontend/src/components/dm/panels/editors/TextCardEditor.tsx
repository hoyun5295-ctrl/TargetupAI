import type { TextCardProps } from '../../../../utils/dm-section-defaults';
import { DM_FONT_SIZE_OPTIONS } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Select, ImageUploader, ColorOverride } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function TextCardEditor({ props, onUpdate }: EditorProps<TextCardProps>) {
  return (
    <>
      <Field label="태그 (선택)" hint="NEW / BEST 등 강조">
        <TextInput value={props.tag} onChange={(v) => onUpdate({ tag: v })} placeholder="NEW" />
      </Field>

      {/* ★ 2026-07-02 줄바꿈 지원 + 색상 직접 지정 */}
      <Field label="헤드라인" hint="줄바꿈 그대로 반영">
        <TextArea value={props.headline} onChange={(v) => onUpdate({ headline: v })} placeholder="이번 달 추천 상품" rows={2} />
      </Field>

      <Field label="헤드라인 색상">
        <ColorOverride value={props.headline_color} onChange={(v) => onUpdate({ headline_color: v })} />
      </Field>

      {/* ★ 2026-07-02(2) 폰트 크기 직접 선택 — 미선택 = 기본(자동) */}
      <Field label="헤드라인 크기">
        <Select
          value={props.headline_size ? String(props.headline_size) : ''}
          onChange={(v) => onUpdate({ headline_size: v ? Number(v) : undefined })}
          options={DM_FONT_SIZE_OPTIONS}
        />
      </Field>

      {/* ★ 2026-07-13 디자인 3.0 — 헤드라인 강조 (형광 마커/밑줄) */}
      <Field label="헤드라인 강조">
        <Select
          value={props.headline_emphasis || ''}
          onChange={(v) => onUpdate({ headline_emphasis: (v || undefined) as TextCardProps['headline_emphasis'] })}
          options={[
            { value: '', label: '없음' },
            { value: 'marker', label: '형광 마커' },
            { value: 'underline', label: '밑줄 스트로크' },
          ]}
        />
      </Field>

      <Field label="본문">
        <TextArea value={props.body} onChange={(v) => onUpdate({ body: v })} rows={5} placeholder="고객님을 위한 한 마디..." />
      </Field>

      <Field label="본문 색상">
        <ColorOverride value={props.body_color} onChange={(v) => onUpdate({ body_color: v })} />
      </Field>

      <Field label="본문 크기">
        <Select
          value={props.body_size ? String(props.body_size) : ''}
          onChange={(v) => onUpdate({ body_size: v ? Number(v) : undefined })}
          options={DM_FONT_SIZE_OPTIONS}
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
