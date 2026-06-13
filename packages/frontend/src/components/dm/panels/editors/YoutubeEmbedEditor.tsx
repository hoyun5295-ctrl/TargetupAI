import type { YoutubeEmbedProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Toggle } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function YoutubeEmbedEditor({ props, onUpdate }: EditorProps<YoutubeEmbedProps>) {
  return (
    <>
      <Field label="YouTube URL" hint="youtu.be/... 또는 youtube.com/watch?v=..."><TextInput type="url" value={props.video_url} onChange={(v) => onUpdate({ video_url: v })} placeholder="https://youtu.be/..." /></Field>
      <Field label="자동 재생"><Toggle value={props.auto_play ?? false} onChange={(v) => onUpdate({ auto_play: v })} /></Field>
    </>
  );
}
