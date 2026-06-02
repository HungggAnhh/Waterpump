// frontend/components/CallAudioPlayer.web.tsx
import React, { useEffect, useRef } from 'react';

interface CallAudioPlayerProps {
  stream: MediaStream | null;
}

export const CallAudioPlayer: React.FC<CallAudioPlayerProps> = ({ stream }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && stream) {
      console.log('🔊 [CallAudioPlayer] Thiết lập remote audio stream cho Web');
      audioRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!stream) return null;

  return (
    <audio
      ref={audioRef}
      autoPlay
      playsInline
      style={{ display: 'none' }}
    />
  );
};
