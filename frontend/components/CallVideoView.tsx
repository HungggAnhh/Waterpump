// frontend/components/CallVideoView.tsx
import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { RTCView } from '../utils/webrtcShim';

interface CallVideoViewProps {
  stream: any; // MediaStream or compatible type
  mirror?: boolean;
}

export const CallVideoView: React.FC<CallVideoViewProps> = ({ stream, mirror }) => {
  if (!stream) {
    return (
      <View style={[styles.container, styles.fallback]}>
        <Text style={styles.fallbackText}>Đang kết nối camera...</Text>
      </View>
    );
  }

  // Under react-native-webrtc, RTCView takes streamURL = stream.toURL()
  const streamURL = typeof stream.toURL === 'function' ? stream.toURL() : stream;

  return (
    <View style={styles.container}>
      <RTCView
        streamURL={streamURL}
        style={styles.video}
        objectFit="cover"
        mirror={mirror}
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
  video: {
    flex: 1,
    width: '100%',
    height: '100%',
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
