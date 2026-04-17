import type { HeroProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Select, Toggle, ImageUploader } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function HeroEditor({ props, onUpdate }: EditorProps<HeroProps>) {
  return (
    <>
      <Field label="배경 이미지">
        <ImageUploader value={props.image_url} onChange={(url) => onUpdate({ image_url: url })} label="히어로 이미지" />
      </Field>

      <Field label="메인 헤드라인" hint="18자 이내 권장">
        <TextInput value={props.headline} onChange={(v) => onUpdate({ headline: v })} placeholder="봄, 당신을 위한 특별한 제안" />
      </Field>

      <Field label="서브 카피">
        <TextArea value={props.sub_copy} onChange={(v) => onUpdate({ sub_copy: v })} placeholder="감성을 담은 한 줄 더" rows={2} />
      </Field>

      <Field label="정렬">
        <Select
          value={props.align || 'center'}
          onChange={(v) => onUpdate({ align: v as HeroProps['align'] })}
          options={[
            { value: 'left', label: '왼쪽' },
            { value: 'center', label: '가운데' },
            { value: 'right', label: '오른쪽' },
          ]}
        />
      </Field>

      <Field label="높이">
        <Select
          value={props.height || 'md'}
          onChange={(v) => onUpdate({ height: v as HeroProps['height'] })}
          options={[
            { value: 'sm', label: '작게 (200px)' },
            { value: 'md', label: '보통 (320px)' },
            { value: 'lg', label: '크게 (480px)' },
            { value: 'full', label: '전체 화면' },
          ]}
        />
      </Field>

      <Field label="하단 그라디언트 오버레이">
        <Toggle value={props.overlay_gradient !== false} onChange={(v) => onUpdate({ overlay_gradient: v })} labelOn="사용" labelOff="미사용" />
      </Field>
    </>
  );
}
