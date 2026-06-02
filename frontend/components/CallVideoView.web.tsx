// frontend/components/CallVideoView.web.tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet } from 'react-native';

interface CallVideoViewProps {
  stream: MediaStream | null;
  mirror?: boolean;
}

export const CallVideoView: React.FC<CallVideoViewProps> = ({ stream, mirror }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  if (!stream) {
    return (
      <View style={[styles.container, styles.fallback]}>
        <Text style={styles.fallbackText}>Đang kết nối camera...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <video
        ref={videoRef}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: mirror ? 'scaleX(-1)' : 'none',
          backgroundColor: '#0f172a',
          borderRadius: 16,
        }}
        autoPlay
        playsInline
        muted={mirror} // Self view is typically muted to prevent feedback loop
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 16,
    overflow: 'hidden',
  },
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  fallbackText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '500',
  },
});
