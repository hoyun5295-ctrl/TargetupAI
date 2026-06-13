import type { InstagramEmbedProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function InstagramEmbedEditor({ props, onUpdate }: EditorProps<InstagramEmbedProps>) {
  return (
    <>
      <Field label="Instagram 게시물 URL"><TextInput type="url" value={props.post_url} onChange={(v) => onUpdate({ post_url: v })} placeholder="https://www.instagram.com/p/..." /></Field>
    </>
  );
}
