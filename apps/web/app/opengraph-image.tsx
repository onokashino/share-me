import { ImageResponse } from 'next/og';

// Runs on the Node runtime (the app is deployed as a standalone Node server).
export const runtime = 'nodejs';

export const alt = 'share·me — end-to-end encrypted file & text sharing';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background:
            'radial-gradient(circle at 50% 32%, #1c1207 0%, #0a0c10 58%)',
          color: '#ffffff',
          fontFamily: 'sans-serif',
        }}
      >
        <div
          style={{
            display: 'flex',
            width: 128,
            height: 128,
            borderRadius: 32,
            background: '#ff7a29',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <svg width="76" height="76" viewBox="0 0 24 24">
            <path
              d="M12 4.4l5.6 2.45v3.95c0 3.5-2.4 6.4-5.6 7.95-3.2-1.55-5.6-4.45-5.6-7.95V6.85L12 4.4z"
              fill="#2a1100"
            />
          </svg>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            marginTop: 46,
            fontSize: 108,
            fontWeight: 700,
            letterSpacing: -3,
          }}
        >
          <span>share</span>
          <span style={{ color: '#ff7a29', padding: '0 4px' }}>·</span>
          <span>me</span>
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 16,
            fontSize: 34,
            color: '#b9c0cc',
          }}
        >
          End-to-end encrypted file &amp; text sharing
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 34,
            fontSize: 21,
            letterSpacing: 4,
            color: '#ff7a29',
          }}
        >
          AES-256 · ZERO-KNOWLEDGE
        </div>
      </div>
    ),
    { ...size },
  );
}
