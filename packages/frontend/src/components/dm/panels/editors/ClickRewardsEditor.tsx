import type { ClickRewardsProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, Select, Toggle } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function ClickRewardsEditor({ props, onUpdate }: EditorProps<ClickRewardsProps>) {
  return (
    <>
      <Field label="참여 유형">
        <Select
          value={props.reward_type || 'like'}
          onChange={(v) => onUpdate({ reward_type: v as ClickRewardsProps['reward_type'] })}
          options={[
            { value: 'like', label: '좋아요' },
            { value: 'share', label: '공유' },
            { value: 'scroll', label: '끝까지 보기' },
          ]}
        />
      </Field>
      <Field label="목표 횟수"><TextInput type="number" value={props.target_count} onChange={(v) => onUpdate({ target_count: v ? Number(v) : 0 })} placeholder="10" /></Field>
      <Field label="보상 설명" hint="회사가 직접 작성"><TextInput value={props.reward_description} onChange={(v) => onUpdate({ reward_description: v })} placeholder="[직접 작성해주세요]" /></Field>
      <Field label="진행률 표시"><Toggle value={props.show_progress ?? true} onChange={(v) => onUpdate({ show_progress: v })} /></Field>
    </>
  );
}
