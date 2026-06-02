// frontend/components/CallScreen.tsx
import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Text, Image, TouchableOpacity, SafeAreaView, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCallStore } from '../store/useCallStore';
import { CallVideoView } from './CallVideoView';
import { CallControls } from './CallControls';
import { CallAudioPlayer } from './CallAudioPlayer';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface CallScreenProps {
  localStream: any;
  remoteStream: any;
  onHangUp: () => void;
  onToggleMute: () => void;
  onToggleVideo: () => void;
}

export const CallScreen: React.FC<CallScreenProps> = ({
  localStream,
  remoteStream,
  onHangUp,
  onToggleMute,
  onToggleVideo,
}) => {
  const {
    callState,
    callType,
    targetInfo,
    callerInfo,
    isMuted,
    isVideoOff,
    isMinimized,
    toggleMinimize,
  } = useCallStore();

  const [duration, setDuration] = useState(0);

  // Tính toán thời gian gọi điện
  useEffect(() => {
    let timer: any = null;
    if (callState === 'connected') {
      timer = setInterval(() => {
        setDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setDuration(0);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [callState]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  if (callState === 'idle' || callState === 'incoming') return null;

  // Lấy thông tin đối phương (nếu mình gọi thì là targetInfo, nếu nhận cuộc gọi thì là callerInfo)
  const peerInfo = targetInfo || callerInfo;
  if (!peerInfo) return null;

  const audioPlayer = callType === 'voice' && <CallAudioPlayer stream={remoteStream} />;

  // ──── CHẾ ĐỘ THU NHỎ (MINIMIZED PIP WINDOW) ────
  if (isMinimized) {
    return (
      <>
        {audioPlayer}
        <TouchableOpacity
          style={styles.minimizedContainer}
          onPress={toggleMinimize}
          activeOpacity={0.9}
        >
          {callType === 'video' && remoteStream ? (
            <View style={styles.minimizedVideoWrapper}>
              <CallVideoView stream={remoteStream} />
              <View style={styles.minimizedOverlayIndicator}>
                <Ionicons name="videocam" size={12} color="#fff" />
              </View>
            </View>
          ) : (
            <View style={styles.minimizedAudioWrapper}>
              <Image
                source={{
                  uri: peerInfo.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80',
                }}
                style={styles.minimizedAvatar}
              />
              <View style={styles.minimizedAudioPulse}>
                <ActivityIndicator size="small" color="#3b82f6" />
              </View>
            </View>
          )}
        </TouchableOpacity>
      </>
    );
  }

  // ──── CHẾ ĐỘ TOÀN MÀN HÌNH (FULLSCREEN MODE) ────
  return (
    <SafeAreaView style={styles.fullscreenContainer}>
      {audioPlayer}
      {/* 1. Thanh công cụ đầu màn hình */}
      <View style={styles.topHeader}>
        <TouchableOpacity style={styles.headerBtn} onPress={toggleMinimize}>
          <Ionicons name="chevron-down-outline" size={26} color="#fff" />
        </TouchableOpacity>
        
        {callState === 'connected' && (
          <View style={styles.timerBadge}>
            <View style={styles.pulseDot} />
            <Text style={styles.timerText}>{formatTime(duration)}</Text>
          </View>
        )}
        
        <View style={styles.headerBtnPlaceholder} />
      </View>

      {/* 2. Phần nội dung chính tùy thuộc vào State */}
      {callState === 'calling' ? (
        // MÀN HÌNH ĐANG QUAY SỐ (CALLING DIALER STATE)
        <View style={styles.middleContent}>
          <View style={styles.dialerAvatarWrapper}>
            <Image
              source={{
                uri: peerInfo.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80',
              }}
              style={styles.dialerAvatar}
            />
            <ActivityIndicator
              size="large"
              color="#3b82f6"
              style={styles.dialerLoader}
            />
          </View>
          <Text style={styles.dialerName}>{peerInfo.name}</Text>
          <Text style={styles.dialerStatus}>Đang kết nối...</Text>
        </View>
      ) : (
        // MÀN HÌNH ĐÃ KẾT NỐI (CONNECTED ACTIVE STATE)
        <View style={styles.activeCallContainer}>
          {callType === 'voice' ? (
            // CONNECTED VOICE CALL VIEW
            <View style={styles.voiceCallWrapper}>
              <Image
                source={{
                  uri: peerInfo.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80',
                }}
                style={styles.voiceAvatar}
              />
              <Text style={styles.voiceName}>{peerInfo.name}</Text>
              <Text style={styles.voiceStatus}>Cuộc gọi thoại đang chạy</Text>
            </View>
          ) : (
            // CONNECTED VIDEO CALL PIP VIEW
            <View style={styles.videoCallWrapper}>
              {/* Remote stream (Toàn màn hình phía sau) */}
              <View style={styles.remoteVideoContainer}>
                <CallVideoView stream={remoteStream} />
              </View>

              {/* Local stream (Thẻ PIP góc trên cùng bên phải) */}
              {!isVideoOff && (
                <View style={styles.localVideoContainer}>
                  <CallVideoView stream={localStream} mirror={true} />
                </View>
              )}
            </View>
          )}
        </View>
      )}

      {/* 3. Thanh công cụ Controls ở cuối */}
      <CallControls
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        callType={callType}
        onToggleMute={onToggleMute}
        onToggleVideo={onToggleVideo}
        onHangUp={onHangUp}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  // ─── STYLES FULLSCREEN ───
  fullscreenContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#090d16',
    zIndex: 999,
  },
  topHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    height: 60,
    zIndex: 1000,
  },
  headerBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerBtnPlaceholder: {
    width: 40,
  },
  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
    marginRight: 6,
  },
  timerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    fontFamily: 'SpaceMono',
  },
  middleContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  dialerAvatarWrapper: {
    width: 150,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  dialerAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  dialerLoader: {
    position: 'absolute',
    transform: [{ scale: 2.2 }],
  },
  dialerName: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  dialerStatus: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '500',
  },
  activeCallContainer: {
    flex: 1,
  },
  voiceCallWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  voiceAvatar: {
    width: 140,
    height: 140,
    borderRadius: 70,
    marginBottom: 20,
    borderWidth: 3,
    borderColor: '#3b82f6',
  },
  voiceName: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 8,
  },
  voiceStatus: {
    color: '#64748b',
    fontSize: 14,
    fontWeight: '500',
  },
  videoCallWrapper: {
    flex: 1,
  },
  remoteVideoContainer: {
    flex: 1,
  },
  localVideoContainer: {
    position: 'absolute',
    top: 20,
    right: 20,
    width: 110,
    height: 160,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.25)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
    zIndex: 1001,
  },

  // ─── STYLES PIP THU NHỎ ───
  minimizedContainer: {
    position: 'absolute',
    top: 80,
    right: 16,
    width: 110,
    height: 160,
    borderRadius: 16,
    backgroundColor: '#1e293b',
    borderWidth: 2,
    borderColor: '#3b82f6',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    zIndex: 9999,
  },
  minimizedVideoWrapper: {
    flex: 1,
  },
  minimizedOverlayIndicator: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 3,
  },
  minimizedAudioWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f172a',
  },
  minimizedAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: '#3b82f6',
  },
  minimizedAudioPulse: {
    position: 'absolute',
    bottom: 12,
  },
});
