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

      {/* ★ 2026-07-13 디자인 3.0 이미지 스튜디오 — 오버레이 프리셋(선택 시 위 토글보다 우선)·초점·헤드라인 강조 */}
      <Field label="오버레이 프리셋" hint="선택 시 하단 그라디언트 설정보다 우선">
        <Select
          value={props.overlay || ''}
          onChange={(v) => onUpdate({ overlay: (v || undefined) as HeroProps['overlay'] })}
          options={[
            { value: '', label: '기본 (위 토글 따름)' },
            { value: 'none', label: '없음' },
            { value: 'soft', label: '소프트' },
            { value: 'strong', label: '강하게' },
            { value: 'brand', label: '브랜드 틴트' },
            { value: 'top', label: '상단 방향' },
          ]}
        />
      </Field>

      <Field label="이미지 맞춤" hint="문구가 들어간 완성 포스터는 '전체 보기'로 두면 잘리지 않아요">
        <Select
          value={props.image_fit || 'cover'}
          onChange={(v) => onUpdate({ image_fit: v as HeroProps['image_fit'] })}
          options={[
            { value: 'cover', label: '채우기 (꽉 차게 · 잘릴 수 있음)' },
            { value: 'contain', label: '전체 보기 (잘림 없음)' },
          ]}
        />
      </Field>

      <Field label="이미지 초점" hint="채우기일 때 세로로 긴 사진에서 보여줄 부분">
        <Select
          value={props.focus || 'center'}
          onChange={(v) => onUpdate({ focus: v as HeroProps['focus'] })}
          options={[
            { value: 'center', label: '중앙' },
            { value: 'top', label: '위쪽' },
            { value: 'bottom', label: '아래쪽' },
          ]}
        />
      </Field>

      <Field label="헤드라인 강조">
        <Select
          value={props.headline_emphasis || ''}
          onChange={(v) => onUpdate({ headline_emphasis: (v || undefined) as HeroProps['headline_emphasis'] })}
          options={[
            { value: '', label: '없음' },
            { value: 'marker', label: '형광 마커' },
            { value: 'underline', label: '밑줄 스트로크' },
          ]}
        />
      </Field>
    </>
  );
}
