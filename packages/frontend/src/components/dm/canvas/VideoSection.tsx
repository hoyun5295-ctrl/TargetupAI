/**
 * VideoSection — 영상 (YouTube embed 또는 direct video)
 */
import type { VideoProps } from '../../../utils/dm-section-defaults';

function youtubeEmbedUrl(url: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?rel=0&playsinline=1`;
  if (url.includes('youtube.com/embed/')) return url;
  return null;
}

export default function VideoSection({ props }: { props: VideoProps }) {
  const embed = props.video_type === 'youtube' ? youtubeEmbedUrl(props.video_url) : null;

  return (
    <div className="dm-section dm-video" style={{ padding: 0, background: 'var(--dm-neutral-900)' }}>
      {embed ? (
        <div style={{ position: 'relative', paddingBottom: '56.25%', height: 0, overflow: 'hidden' }}>
          <iframe
            src={embed}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', border: 0 }}
            allowFullScreen
            loading="lazy"
            title="video"
          />
        </div>
      ) : props.video_url ? (
        <video
          src={props.video_url}
          {...(props.autoplay ? { autoPlay: true, muted: true, playsInline: true } : { controls: true, playsInline: true })}
          poster={props.thumbnail_url}
          style={{ width: '100%', display: 'block' }}
        />
      ) : null}
      {props.caption && (
        <div className="dm-text-small" style={{ padding: 'var(--dm-sp-3) var(--dm-sp-5)', color: 'var(--dm-neutral-600)', background: 'var(--dm-bg)' }}>
          {props.caption}
        </div>
      )}
    </div>
  );
}
