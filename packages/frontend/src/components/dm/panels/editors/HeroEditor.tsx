import type { HeroProps } from '../../../../utils/dm-section-defaults';
import { DM_FONT_SIZE_OPTIONS } from '../../../../utils/dm-section-defaults';
import { Field, TextArea, Select, Toggle, ImageUploader, ColorOverride } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function HeroEditor({ props, onUpdate }: EditorProps<HeroProps>) {
  return (
    <>
      <Field label="배경 이미지">
        <ImageUploader value={props.image_url} onChange={(url) => onUpdate({ image_url: url })} label="히어로 이미지" />
      </Field>

      {/* ★ 2026-07-02 줄바꿈 지원 — 입력한 줄바꿈이 결과물에 그대로 반영 */}
      <Field label="메인 헤드라인" hint="줄바꿈 그대로 반영 · 한 줄 18자 이내 권장">
        <TextArea value={props.headline} onChange={(v) => onUpdate({ headline: v })} placeholder="봄, 당신을 위한 특별한 제안" rows={2} />
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

      <Field label="서브 카피" hint="줄바꿈 그대로 반영">
        <TextArea value={props.sub_copy} onChange={(v) => onUpdate({ sub_copy: v })} placeholder="감성을 담은 한 줄 더" rows={2} />
      </Field>

      <Field label="서브 카피 색상">
        <ColorOverride value={props.sub_copy_color} onChange={(v) => onUpdate({ sub_copy_color: v })} />
      </Field>

      <Field label="서브 카피 크기">
        <Select
          value={props.sub_copy_size ? String(props.sub_copy_size) : ''}
          onChange={(v) => onUpdate({ sub_copy_size: v ? Number(v) : undefined })}
          options={DM_FONT_SIZE_OPTIONS}
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
