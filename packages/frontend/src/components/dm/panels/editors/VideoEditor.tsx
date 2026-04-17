import type { VideoProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Select, Toggle, ImageUploader } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function VideoEditor({ props, onUpdate }: EditorProps<VideoProps>) {
  return (
    <>
      <Field label="영상 타입">
        <Select
          value={props.video_type || 'youtube'}
          onChange={(v) => onUpdate({ video_type: v as VideoProps['video_type'] })}
          options={[
            { value: 'youtube', label: 'YouTube' },
            { value: 'direct', label: '직접 영상 (mp4 등)' },
          ]}
        />
      </Field>

      <Field label="영상 URL" hint={props.video_type === 'youtube' ? 'YouTube 링크 (watch/shortened 모두 지원)' : 'mp4/webm 등 직접 URL'}>
        <TextInput type="url" value={props.video_url} onChange={(v) => onUpdate({ video_url: v })} placeholder="https://..." />
      </Field>

      <Field label="썸네일 (직접 영상용)">
        <ImageUploader value={props.thumbnail_url} onChange={(url) => onUpdate({ thumbnail_url: url })} label="썸네일" />
      </Field>

      <Field label="캡션">
        <TextInput value={props.caption} onChange={(v) => onUpdate({ caption: v })} placeholder="영상 아래 설명 텍스트" />
      </Field>

      <Field label="자동 재생" hint="모바일은 음소거 상태에서만 자동재생">
        <Toggle value={props.autoplay === true} onChange={(v) => onUpdate({ autoplay: v })} />
      </Field>
    </>
  );
}
