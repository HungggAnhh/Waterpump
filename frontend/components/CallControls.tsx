// frontend/components/CallControls.tsx
import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface CallControlsProps {
  isMuted: boolean;
  isVideoOff: boolean;
  callType: 'voice' | 'video' | null;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onHangUp: () => void;
}

export const CallControls: React.FC<CallControlsProps> = ({
  isMuted,
  isVideoOff,
  callType,
  onToggleMute,
  onToggleVideo,
  onHangUp,
}) => {
  return (
    <View style={styles.container}>
      {/* Nút bật/tắt Mic */}
      <TouchableOpacity
        style={[styles.btn, isMuted && styles.btnActive]}
        onPress={onToggleMute}
        activeOpacity={0.7}
      >
        <Ionicons
          name={isMuted ? 'mic-off' : 'mic'}
          size={24}
          color={isMuted ? '#fff' : '#cbd5e1'}
        />
      </TouchableOpacity>

      {/* Nút Gác máy (Red Circle) */}
      <TouchableOpacity
        style={[styles.btn, styles.hangUpBtn]}
        onPress={onHangUp}
        activeOpacity={0.7}
      >
        <Ionicons name="call" size={26} style={styles.hangUpIcon} />
      </TouchableOpacity>

      {/* Nút bật/tắt Camera (Chỉ hiện khi cuộc gọi là Video Call) */}
      {callType === 'video' ? (
        <TouchableOpacity
          style={[styles.btn, isVideoOff && styles.btnActive]}
          onPress={onToggleVideo}
          activeOpacity={0.7}
        >
          <Ionicons
            name={isVideoOff ? 'videocam-off' : 'videocam'}
            size={24}
            color={isVideoOff ? '#fff' : '#cbd5e1'}
          />
        </TouchableOpacity>
      ) : (
        <View style={styles.btnPlaceholder} />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 32,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    width: '85%',
    alignSelf: 'center',
    position: 'absolute',
    bottom: 40,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 15,
    elevation: 8,
  },
  btn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  btnActive: {
    backgroundColor: '#ef4444',
    borderColor: '#ef4444',
  },
  hangUpBtn: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#dc2626',
    borderColor: '#dc2626',
  },
  hangUpIcon: {
    color: '#fff',
    transform: [{ rotate: '135deg' }],
  },
  btnPlaceholder: {
    width: 50,
    height: 50,
  },
});
