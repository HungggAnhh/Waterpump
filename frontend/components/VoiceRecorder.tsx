import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Animated,
  useWindowDimensions,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { voiceUploadWorker } from '../services/audio/voiceUploadWorker';

interface VoiceRecorderProps {
  onRecordingComplete: (uri: string, duration: number) => void;
  onRecordingStateChange?: (isRecording: boolean) => void;
  colors: {
    tint: string;
    card: string;
    text: string;
    border: string;
    textSecondary: string;
  };
  variant?: 'compact' | 'full';
}

const Waveform = () => {
  const [heights, setHeights] = useState([8, 12, 6, 15, 10, 14, 8, 5]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setHeights(
        Array.from({ length: 8 }, () => Math.floor(Math.random() * 16) + 4)
      );
    }, 120);
    return () => clearInterval(interval);
  }, []);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8 }}>
      {heights.map((h, i) => (
        <View
          key={i}
          style={{
            width: 3,
            height: h,
            borderRadius: 1.5,
            backgroundColor: '#ef4444',
          }}
        />
      ))}
    </View>
  );
};

export default function VoiceRecorder({
  onRecordingComplete,
  onRecordingStateChange,
  colors,
  variant = 'compact',
}: VoiceRecorderProps) {
  const [swipeCancel, setSwipeCancel] = useState(false);
  const [isHandsFree, setIsHandsFree] = useState(false);
  const pressStartRef = useRef<number>(0);
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const { width: screenWidth } = useWindowDimensions();
  
  const {
    isRecording,
    duration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceRecorder();

  const triggerHaptic = async () => {
    try {
      if (Platform.OS !== 'web') {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {
      // Ignore haptics on web / unsupported
    }
  };

  // Notify parent of recording state
  useEffect(() => {
    if (onRecordingStateChange) {
      onRecordingStateChange(isRecording);
    }
  }, [isRecording, onRecordingStateChange]);

  // Reset hands-free state when recording stops
  useEffect(() => {
    if (!isRecording) {
      setIsHandsFree(false);
      setSwipeCancel(false);
    }
  }, [isRecording]);

  // Pulsing animation for the recording indicator
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isRecording) {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.4,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      pulseAnim.setValue(0.4);
    }

    return () => {
      if (animation) {
        animation.stop();
      }
    };
  }, [isRecording, pulseAnim]);

  const handleStart = async () => {
    // Check if the offline queue is full (> 50 pending voice messages)
    const pendingCount = voiceUploadWorker.getQueue().filter(q => q.status !== 'sent').length;
    if (pendingCount >= 50) {
      Alert.alert(
        'Không thể ghi âm',
        'Bạn đang có quá nhiều tin nhắn thoại chưa gửi. Vui lòng đợi hoặc xóa bớt tin nhắn chưa gửi.'
      );
      return;
    }

    setSwipeCancel(false);
    setIsHandsFree(false);
    triggerHaptic();
    console.log('[Analytics] voice_record_started');
    try {
      await startRecording();
    } catch (err) {
      console.error('Error starting voice recording:', err);
    }
  };

  const handleRelease = async () => {
    if (swipeCancel) {
      console.log('[Analytics] voice_record_cancelled (user swiped left)');
      triggerHaptic();
      await cancelRecording();
    } else {
      const { uri, duration: finalDuration } = await stopRecording();
      if (uri) {
        if (finalDuration < 1) {
          console.log('[Analytics] voice_record_cancelled (duration < 1s)');
          triggerHaptic();
          await cancelRecording();
        } else {
          onRecordingComplete(uri, finalDuration);
        }
      }
    }
    setSwipeCancel(false);
    setIsHandsFree(false);
  };

  const handleHandsFreeCancel = async () => {
    console.log('[Analytics] voice_record_cancelled (Hands-Free Cancel clicked)');
    triggerHaptic();
    await cancelRecording();
    setIsHandsFree(false);
    setSwipeCancel(false);
  };

  const handleHandsFreeSend = async () => {
    const { uri, duration: finalDuration } = await stopRecording();
    if (uri) {
      if (finalDuration < 1) {
        console.log('[Analytics] voice_record_cancelled (duration < 1s)');
        triggerHaptic();
        await cancelRecording();
      } else {
        onRecordingComplete(uri, finalDuration);
      }
    }
    setIsHandsFree(false);
    setSwipeCancel(false);
  };

  // Configure PanResponder for hold-and-drag gesture
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pressStartRef.current = Date.now();
        handleStart();
      },
      onPanResponderMove: (_, gestureState) => {
        // Only allow swipe cancel if not in hands-free mode
        if (isHandsFree) return;
        
        // Swipe left dx < -60
        if (gestureState.dx < -60) {
          setSwipeCancel(true);
        } else {
          setSwipeCancel(false);
        }
      },
      onPanResponderRelease: () => {
        const pressDuration = Date.now() - pressStartRef.current;
        if (pressDuration < 300) {
          // Enter hands free mode
          setIsHandsFree(true);
        } else {
          handleRelease();
        }
      },
      onPanResponderTerminate: () => {
        cancelRecording();
        setSwipeCancel(false);
        setIsHandsFree(false);
      },
    })
  ).current;

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={[styles.container, variant === 'full' && styles.fullWidthContainer]}>
      {/* Idle Mic Button */}
      <View {...panResponder.panHandlers} style={variant === 'full' ? styles.fullWidthTouch : null}>
        {variant === 'full' ? (
          <TouchableOpacity
            style={[
              styles.wideMicButton,
              { backgroundColor: colors.border + '40', borderColor: colors.border },
            ]}
            activeOpacity={0.7}
          >
            <Ionicons
              name="mic"
              size={18}
              color={colors.tint}
              style={{ marginRight: 6 }}
            />
            <Text style={[styles.wideMicText, { color: colors.text }]}>Nhấn và giữ để ghi âm</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[
              styles.micButton,
              { backgroundColor: isRecording ? '#ef4444' : 'transparent' },
            ]}
            activeOpacity={0.7}
          >
            <Ionicons
              name="mic"
              size={22}
              color={isRecording ? '#fff' : colors.textSecondary}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Hands-Free Recording Overlay */}
      {isRecording && isHandsFree && (
        <View
          style={[
            styles.overlay,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              left: variant === 'full' ? -50 : -screenWidth + 60,
              width: variant === 'full' ? screenWidth - 10 : screenWidth - 70,
            },
          ]}
        >
          {/* Hands-Free Cancel Button */}
          <TouchableOpacity
            style={[styles.handsFreeBtn, { backgroundColor: '#f1f5f9' }]}
            onPress={handleHandsFreeCancel}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={16} color="#ef4444" />
            <Text style={{ fontSize: 12, color: '#ef4444', fontWeight: '700', marginLeft: 4 }}>Hủy</Text>
          </TouchableOpacity>

          {/* Info Status */}
          <View style={styles.leftGroup}>
            <Animated.View style={{ opacity: pulseAnim, marginRight: 2 }}>
              <Text style={styles.redDot}>🔴</Text>
            </Animated.View>
            <Waveform />
            <Text style={[styles.timerText, { color: colors.tint }]}>{formatTime(duration)}</Text>
            <Text style={{ fontSize: 11, color: colors.textSecondary, marginLeft: 4 }}>
              ({(duration * 0.016).toFixed(2)} MB)
            </Text>
          </View>

          {/* Hands-Free Send Button */}
          <TouchableOpacity
            style={[styles.handsFreeBtn, { backgroundColor: colors.tint }]}
            onPress={handleHandsFreeSend}
            activeOpacity={0.7}
          >
            <Ionicons name="send" size={14} color="#fff" />
            <Text style={{ fontSize: 12, color: '#fff', fontWeight: '700', marginLeft: 4 }}>Gửi</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Traditional Hold-to-Record Overlay */}
      {isRecording && !isHandsFree && (
        <View
          style={[
            styles.overlay,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              left: variant === 'full' ? -50 : -screenWidth + 60,
              width: variant === 'full' ? screenWidth - 10 : screenWidth - 70,
            },
          ]}
        >
          <View style={styles.leftGroup}>
            <Animated.View style={{ opacity: pulseAnim, marginRight: 2 }}>
              <Text style={styles.redDot}>🔴</Text>
            </Animated.View>
            <Waveform />
            <Text style={[styles.timerText, { color: colors.tint, marginLeft: 4 }]}>{formatTime(duration)}</Text>
          </View>

          <Text
            style={[
              styles.cancelText,
              { color: swipeCancel ? '#ef4444' : colors.textSecondary },
            ]}
          >
            {swipeCancel ? '❌ Hủy ghi âm' : '← Vuốt trái để hủy'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'visible',
  },
  fullWidthContainer: {
    flex: 1,
    alignItems: 'stretch',
  },
  fullWidthTouch: {
    flex: 1,
  },
  micButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  wideMicButton: {
    flex: 1,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  wideMicText: {
    fontSize: 14,
    fontWeight: '600',
  },
  overlay: {
    position: 'absolute',
    right: -40,
    top: -10,
    bottom: -15,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    height: 60,
    zIndex: 9999,
  },
  leftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  redDot: {
    fontSize: 12,
  },
  recText: {
    fontSize: 14,
    fontWeight: '600',
    marginRight: 8,
  },
  timerText: {
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  cancelText: {
    fontSize: 13,
    fontWeight: '500',
  },
  handsFreeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
});
