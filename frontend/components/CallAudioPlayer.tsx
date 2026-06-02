// frontend/components/CallAudioPlayer.tsx
import React from 'react';

interface CallAudioPlayerProps {
  stream: any;
}

export const CallAudioPlayer: React.FC<CallAudioPlayerProps> = () => {
  // Mobile platforms handle remote audio playback automatically via OS WebRTC audio tracks.
  return null;
};
