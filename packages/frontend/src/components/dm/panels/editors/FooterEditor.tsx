import type { FooterProps } from '../../../../utils/dm-section-defaults';
import { Field, TextInput, TextArea, Toggle } from '../FormControls';
import type { EditorProps } from '../SectionPropsEditor';

export default function FooterEditor({ props, onUpdate }: EditorProps<FooterProps>) {
  return (
    <>
      <Field label="유의사항">
        <TextArea value={props.notes} onChange={(v) => onUpdate({ notes: v })} rows={3} placeholder="이 쿠폰은 타 할인과 중복 사용 불가..." />
      </Field>

      <Field label="고객센터 전화">
        <TextInput type="tel" value={props.cs_phone} onChange={(v) => onUpdate({ cs_phone: v })} placeholder="1588-0000" />
      </Field>

      <Field label="상담 시간">
        <TextInput value={props.cs_hours} onChange={(v) => onUpdate({ cs_hours: v })} placeholder="평일 10:00 ~ 18:00 (주말·공휴일 제외)" />
      </Field>

      <Field label="법정 안내" hint="사업자등록번호, 대표자명 등">
        <TextArea value={props.legal_text} onChange={(v) => onUpdate({ legal_text: v })} rows={3} placeholder="(주)브랜드 | 대표 홍길동 | 사업자 000-00-00000" />
      </Field>

      <Field label="수신거부 링크 표시" hint="KISA 가이드 준수 권장">
        <Toggle value={props.show_unsubscribe_link !== false} onChange={(v) => onUpdate({ show_unsubscribe_link: v })} labelOn="표시" labelOff="숨김" />
      </Field>
    </>
  );
}
