import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  PanResponder,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';

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
}

export default function VoiceRecorder({
  onRecordingComplete,
  onRecordingStateChange,
  colors,
}: VoiceRecorderProps) {
  const [swipeCancel, setSwipeCancel] = useState(false);
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  const { width: screenWidth } = useWindowDimensions();
  
  const {
    isRecording,
    duration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceRecorder();

  // Notify parent of recording state
  useEffect(() => {
    if (onRecordingStateChange) {
      onRecordingStateChange(isRecording);
    }
  }, [isRecording, onRecordingStateChange]);

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
    setSwipeCancel(false);
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
      await cancelRecording();
    } else {
      const { uri, duration: finalDuration } = await stopRecording();
      if (uri) {
        if (finalDuration < 1) {
          console.log('[Analytics] voice_record_cancelled (duration < 1s)');
          await cancelRecording();
        } else {
          onRecordingComplete(uri, finalDuration);
        }
      }
    }
    setSwipeCancel(false);
  };

  // Configure PanResponder for hold-and-drag gesture
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        handleStart();
      },
      onPanResponderMove: (_, gestureState) => {
        // Swipe left dx < -60
        if (gestureState.dx < -60) {
          setSwipeCancel(true);
        } else {
          setSwipeCancel(false);
        }
      },
      onPanResponderRelease: () => {
        handleRelease();
      },
      onPanResponderTerminate: () => {
        cancelRecording();
        setSwipeCancel(false);
      },
    })
  ).current;

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      {/* Idle Mic Button */}
      <View {...panResponder.panHandlers}>
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
      </View>

      {/* Recording Overlay Panel: position absolute to overlay parent input bar */}
      {isRecording && (
        <View
          style={[
            styles.overlay,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              left: -screenWidth + 60,
              width: screenWidth - 70,
            },
          ]}
        >
          <View style={styles.leftGroup}>
            <Animated.View style={{ opacity: pulseAnim, marginRight: 6 }}>
              <Text style={styles.redDot}>🔴</Text>
            </Animated.View>
            <Text style={[styles.recText, { color: colors.text }]}>Đang ghi âm...</Text>
            <Text style={[styles.timerText, { color: colors.tint }]}>{formatTime(duration)}</Text>
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
  },
  micButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
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
});
