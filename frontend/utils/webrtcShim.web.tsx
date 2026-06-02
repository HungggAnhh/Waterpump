// frontend/utils/webrtcShim.web.tsx
import React from 'react';

// Web environment has native objects on window/navigator
const RTCPeerConnection = typeof window !== 'undefined' ? window.RTCPeerConnection : null;
const RTCIceCandidate = typeof window !== 'undefined' ? window.RTCIceCandidate : null;
const RTCSessionDescription = typeof window !== 'undefined' ? window.RTCSessionDescription : null;
const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;

// Dummy component that mirrors native RTCView but renders HTML5 <video> block
export const RTCView = ({ streamURL, style, objectFit, mirror }: any) => {
  const videoRef = React.useRef<HTMLVideoElement>(null);

  React.useEffect(() => {
    if (videoRef.current && streamURL) {
      if (streamURL instanceof MediaStream) {
        videoRef.current.srcObject = streamURL;
      } else if (typeof streamURL === 'string') {
        videoRef.current.src = streamURL;
      }
    }
  }, [streamURL]);

  return (
    <video
      ref={videoRef}
      style={{
        width: '100%',
        height: '100%',
        objectFit: objectFit || 'cover',
        transform: mirror ? 'scaleX(-1)' : 'none',
        backgroundColor: '#1e293b',
        borderRadius: 12,
        ...style,
      }}
      autoPlay
      playsInline
      muted={mirror} // local view is typically mirrored and muted to prevent local audio loop feedback
    />
  );
};

let audioObj: HTMLAudioElement | null = null;

export const playRingtone = () => {
  if (typeof window === 'undefined') return;
  try {
    console.log('🔌 [SHIM:WEB] Bắt đầu đổ chuông âm thanh');
    if (!audioObj) {
      // Soft calling bell sound
      audioObj = new Audio('https://assets.mixkit.co/active_storage/sfx/2568/2568-84.wav');
      audioObj.loop = true;
    }
    audioObj.play().catch((err) => {
      console.log('🔌 [SHIM:WEB] Trình duyệt chặn tự động phát âm thanh trước tương tác:', err.message);
    });
  } catch (e) {
    console.error('Lỗi khi phát nhạc chuông trên web:', e);
  }
};

export const stopRingtone = () => {
  if (typeof window === 'undefined') return;
  console.log('🔌 [SHIM:WEB] Tắt nhạc chuông âm thanh');
  if (audioObj) {
    audioObj.pause();
    audioObj.currentTime = 0;
    audioObj = null;
  }
};

export {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
};
