import React, { useEffect } from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  View,
  StyleProp,
  ViewStyle,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSpeechToText } from '../hooks/useSpeechToText';

interface VoiceMicButtonProps {
  currentValue: string;
  onSpeechRecognized: (newValue: string) => void;
  onStateChange?: (isListening: boolean) => void;
  containerStyle?: StyleProp<ViewStyle>;
  compact?: boolean;
}

export default function VoiceMicButton({
  currentValue,
  onSpeechRecognized,
  onStateChange,
  containerStyle,
  compact = false,
}: VoiceMicButtonProps) {
  // Animating the red dot pulse
  const pulseAnim = React.useRef(new Animated.Value(0.4)).current;

  const handleTranscript = (transcript: string) => {
    const trimmedExisting = currentValue ? currentValue.trim() : '';
    const trimmedTranscript = transcript ? transcript.trim() : '';
    const newValue = trimmedExisting
      ? `${trimmedExisting} ${trimmedTranscript}`
      : trimmedTranscript;
    onSpeechRecognized(newValue);
  };

  const handleError = (errorMessage: string) => {
    Alert.alert('Thông báo', errorMessage);
  };

  const {
    isListening,
    isStarting,
    isSupported,
    startListening,
    stopListening,
  } = useSpeechToText({
    onTranscript: handleTranscript,
    onError: handleError,
  });

  // Call onStateChange when listening state changes
  useEffect(() => {
    if (onStateChange) {
      onStateChange(isListening);
    }
  }, [isListening, onStateChange]);

  // Pulse animation for the recording state
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isListening) {
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
  }, [isListening, pulseAnim]);

  const handlePress = async () => {
    if (!isSupported) {
      Alert.alert('Thông báo', 'Trình duyệt hiện tại không hỗ trợ nhận diện giọng nói.');
      return;
    }

    if (isListening) {
      await stopListening();
    } else {
      await startListening();
    }
  };

  if (isStarting) {
    return (
      <View style={[styles.loader, containerStyle]}>
        <ActivityIndicator size="small" color="#3b82f6" />
      </View>
    );
  }

  // Listening State UI: Pill shape with pulsing red indicator
  if (isListening) {
    return (
      <TouchableOpacity
        style={[styles.listeningButton, containerStyle]}
        onPress={handlePress}
        activeOpacity={0.8}
      >
        <Animated.View style={{ opacity: pulseAnim }}>
          <Text style={styles.redDot}>🔴</Text>
        </Animated.View>
        {!compact && <Text style={styles.listeningText}>Đang nghe...</Text>}
        <Ionicons name="mic" size={compact ? 16 : 18} color="#ef4444" />
      </TouchableOpacity>
    );
  }

  // Idle State UI: Simple microphone button
  return (
    <TouchableOpacity
      style={[styles.idleButton, containerStyle]}
      onPress={handlePress}
      activeOpacity={0.7}
    >
      <Ionicons name="mic-outline" size={compact ? 20 : 22} color="#64748b" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  loader: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  idleButton: {
    padding: 8,
    borderRadius: 20,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  listeningButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fca5a5',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  redDot: {
    fontSize: 10,
    textAlignVertical: 'center',
  },
  listeningText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '700',
  },
});
