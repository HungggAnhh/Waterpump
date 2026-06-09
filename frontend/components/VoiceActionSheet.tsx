import { useState, useRef, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Dimensions,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { useSpeechToText } from '../hooks/useSpeechToText';
import { voiceUploadWorker } from '../services/audio/voiceUploadWorker';

interface VoiceActionSheetProps {
  visible: boolean;
  onClose: () => void;
  onVoiceRecorded: (uri: string, duration: number) => void;
  onTranscript: (transcript: string) => void;
  onSttStart?: () => void;
  colors: {
    tint: string;
    card: string;
    text: string;
    border: string;
    textSecondary: string;
    background: string;
  };
}

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get('window');

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
    <View style={styles.waveformContainer}>
      {heights.map((h, i) => (
        <View
          key={i}
          style={[styles.waveformBar, { height: h }]}
        />
      ))}
    </View>
  );
};

export default function VoiceActionSheet({
  visible,
  onClose,
  onVoiceRecorded,
  onTranscript,
  onSttStart,
  colors,
}: VoiceActionSheetProps) {
  const [activeTab, setActiveTab] = useState<'voice' | 'stt'>('voice');
  const [swipeCancel, setSwipeCancel] = useState(false);
  const [isHandsFree, setIsHandsFree] = useState(false);
  
  const pressStartRef = useRef<number>(0);
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.4)).current;

  // Voice Recorder Hook
  const {
    isRecording,
    duration,
    startRecording,
    stopRecording,
    cancelRecording,
  } = useVoiceRecorder();

  // Speech to Text Hook
  const {
    isListening: isSttListening,
    isStarting: isSttStarting,
    isSupported: isSttSupported,
    startListening: startStt,
    stopListening: stopStt,
  } = useSpeechToText({
    onStart: () => {
      console.log('[STT] Speech Recognition session started.');
      if (onSttStart) {
        onSttStart();
      }
    },
    onTranscript: (text) => {
      console.log('[STT] Transcript received:', text);
      if (text && text.trim()) {
        onTranscript(text);
      }
    },
    onError: (err) => {
      console.error('[STT] Error event:', err);
      Alert.alert('Thông báo', err);
    },
  });

  // State refs to completely solve PanResponder stale closure bugs
  const stateRef = useRef({
    activeTab,
    isHandsFree,
    swipeCancel,
    duration,
    isRecording,
  });

  useEffect(() => {
    stateRef.current = {
      activeTab,
      isHandsFree,
      swipeCancel,
      duration,
      isRecording,
    };
  }, [activeTab, isHandsFree, swipeCancel, duration, isRecording]);

  const triggerHaptic = async () => {
    try {
      if (Platform.OS !== 'web') {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } catch (e) {}
  };

  // Reset tab and states when modal opens
  useEffect(() => {
    if (visible) {
      console.log('[VoicePanel] Panel opened. Resetting states.');
      setActiveTab('voice');
      setIsHandsFree(false);
      setSwipeCancel(false);
      
      Animated.parallel([
        Animated.timing(backdropAnim, {
          toValue: 0.4,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(slideAnim, {
          toValue: 0,
          duration: 250,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      console.log('[VoicePanel] Panel closed. Stopping active recording/listening sessions.');
      console.trace('[VoicePanel] Close stack trace');
      if (isRecording) {
        cancelRecording();
      }
      if (isSttListening) {
        stopStt();
      }
    }
  }, [visible]);

  // Pulse animation loop
  useEffect(() => {
    let animation: Animated.CompositeAnimation | null = null;
    if (isRecording || isSttListening) {
      animation = Animated.loop(
        Animated.parallel([
          Animated.timing(pulseScale, {
            toValue: 1.6,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    } else {
      pulseScale.setValue(1);
      pulseOpacity.setValue(0.4);
    }

    return () => {
      if (animation) animation.stop();
    };
  }, [isRecording, isSttListening]);

  const handleDismiss = () => {
    if (isRecording) {
      cancelRecording();
    }
    if (isSttListening) {
      stopStt();
    }
    Animated.parallel([
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onClose();
    });
  };

  const handleStartRecord = async () => {
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
    console.log('[VoiceRecorder] Starting recording session...');
    try {
      await startRecording();
    } catch (err) {
      console.error('[VoiceRecorder] Failed to start recording:', err);
    }
  };

  const handleReleaseRecord = async () => {
    const currentSwipeCancel = stateRef.current.swipeCancel;
    if (currentSwipeCancel) {
      console.log('[VoiceRecorder] Recording cancelled by user swipe gesture.');
      triggerHaptic();
      await cancelRecording();
    } else {
      console.log('[VoiceRecorder] Stopping recording and fetching URI...');
      const { uri, duration: finalDuration } = await stopRecording();
      const actualDuration = finalDuration > 0 ? finalDuration : stateRef.current.duration;
      console.log('[VoiceRecorder] stopRecording result:', { uri, finalDuration, actualDuration });
      
      if (uri) {
        console.log(
          '[VOICE_DEBUG] RECORD_RESULT',
          {
            uri,
            duration: actualDuration,
            mimeType: 'audio/m4a'
          }
        );
        if (actualDuration < 1) {
          console.warn('[VoiceRecorder] Recording duration too short (< 1s). Cancelling.');
          triggerHaptic();
          await cancelRecording();
        } else {
          console.log('[VoiceRecorder] Valid recording completed. Triggering callback.', { uri, actualDuration });
          onVoiceRecorded(uri, actualDuration);
          handleDismiss();
        }
      } else {
        console.error('[VoiceRecorder] stopRecording returned null URI');
        Alert.alert('Lỗi', 'Không thể trích xuất file ghi âm.');
      }
    }
    setSwipeCancel(false);
    setIsHandsFree(false);
  };

  const handleHandsFreeCancel = async () => {
    console.log('[VoiceRecorder] Hands-Free recording cancelled.');
    triggerHaptic();
    await cancelRecording();
    setIsHandsFree(false);
    setSwipeCancel(false);
    handleDismiss();
  };

  const handleHandsFreeSend = async () => {
    console.log('[VoiceRecorder] Hands-Free send triggered.');
    const { uri, duration: finalDuration } = await stopRecording();
    const actualDuration = finalDuration > 0 ? finalDuration : stateRef.current.duration;
    console.log('[VoiceRecorder] Hands-Free stopRecording result:', { uri, finalDuration, actualDuration });
    
    if (uri) {
      console.log(
        '[VOICE_DEBUG] RECORD_RESULT',
        {
          uri,
          duration: actualDuration,
          mimeType: 'audio/m4a'
        }
      );
      if (actualDuration < 1) {
        console.warn('[VoiceRecorder] Hands-Free duration too short. Cancelling.');
        triggerHaptic();
        await cancelRecording();
      } else {
        console.log('[VoiceRecorder] Hands-Free complete. Sending.');
        onVoiceRecorded(uri, actualDuration);
      }
    } else {
      console.error('[VoiceRecorder] Hands-Free stopRecording returned null URI');
      Alert.alert('Lỗi', 'Không thể trích xuất file ghi âm.');
    }
    setIsHandsFree(false);
    setSwipeCancel(false);
    handleDismiss();
  };

  // Keep callback refs fresh for PanResponder to execute latest logic
  const startRecordRef = useRef(handleStartRecord);
  const releaseRecordRef = useRef(handleReleaseRecord);
  const cancelRecordRef = useRef(cancelRecording);

  useEffect(() => {
    startRecordRef.current = handleStartRecord;
    releaseRecordRef.current = handleReleaseRecord;
    cancelRecordRef.current = cancelRecording;
  });

  const startTouchXRef = useRef<number | null>(null);

  const handleTouchStart = () => {
    console.log('[VOICE_TOUCH_GRANT]', {
      timestamp: Date.now(),
      isRecording: stateRef.current.isRecording,
      isHandsFree: stateRef.current.isHandsFree
    });
    if (stateRef.current.activeTab !== 'voice' || stateRef.current.isHandsFree) return;
    pressStartRef.current = Date.now();
    startTouchXRef.current = null;
    startRecordRef.current();
  };

  const handleTouchMove = (evt: any) => {
    if (stateRef.current.activeTab !== 'voice' || stateRef.current.isHandsFree) return;
    const touchX = evt.nativeEvent.pageX;
    const startX = startTouchXRef.current !== null ? startTouchXRef.current : touchX;
    if (startTouchXRef.current === null) {
      startTouchXRef.current = touchX;
    }
    const dx = touchX - startX;
    console.log('[VOICE_TOUCH_MOVE]', { dx });

    if (dx < -60) {
      setSwipeCancel(true);
    } else {
      setSwipeCancel(false);
    }
  };

  const handleTouchRelease = () => {
    const pressDuration = Date.now() - pressStartRef.current;
    console.log('[VOICE_TOUCH_RELEASE]', {
      timestamp: Date.now(),
      pressDuration,
      isRecording: stateRef.current.isRecording,
      isHandsFree: stateRef.current.isHandsFree
    });
    startTouchXRef.current = null;

    if (stateRef.current.activeTab !== 'voice' || stateRef.current.isHandsFree) return;
    if (pressDuration < 300) {
      console.log('[VoiceRecorder] Quick press detected. Switching to Hands-Free mode.');
      setIsHandsFree(true);
    } else {
      releaseRecordRef.current();
    }
  };

  const handleTouchTerminate = () => {
    console.log('[VOICE_TOUCH_TERMINATE]');
    console.log('[IS_RECORDING]', stateRef.current.isRecording);
    startTouchXRef.current = null;
    cancelRecordRef.current();
    setIsHandsFree(false);
    setSwipeCancel(false);
  };

  // Trigger for Tab 2 STT Press
  const handleSttPress = async () => {
    if (!isSttSupported) {
      console.warn('[STT] Speech recognition not supported on this device.');
      Alert.alert('Thông báo', 'Thiết bị hiện tại không hỗ trợ chuyển giọng nói thành văn bản.');
      return;
    }
    triggerHaptic();
    try {
      if (isSttListening) {
        console.log('[STT] Stopping Speech Recognition session...');
        await stopStt();
      } else {
        console.log('[STT] Starting Speech Recognition session...');
        await startStt();
      }
    } catch (err) {
      console.error('[STT] Error toggling STT:', err);
    }
  };

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const getTitle = () => {
    if (isRecording) {
      if (swipeCancel) return 'Buông tay để hủy ghi âm';
      return 'Đang ghi âm...';
    }
    if (isSttListening) {
      return '🎤 Đang nghe...';
    }
    return 'Bấm hoặc bấm giữ để ghi âm';
  };

  return (
    <Modal
      transparent
      visible={visible}
      onRequestClose={handleDismiss}
      animationType="none"
    >
      <View style={styles.modalOverlay}>
        <TouchableWithoutFeedback onPress={handleDismiss}>
          <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]} />
        </TouchableWithoutFeedback>

        <Animated.View
          style={[
            styles.sheetContainer,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {/* Handle bar */}
          <View style={styles.handleBar}>
            <View style={styles.handle} />
          </View>

          {/* Title Area */}
          <Text style={[styles.title, { color: colors.text }]}>{getTitle()}</Text>

          {/* Center Area: Animated elements and Microphone button */}
          <View style={styles.centerContainer}>
            {/* Waveform / Progress Info while Recording */}
            {isRecording && (
              <View style={styles.recordingStatusContainer}>
                <Waveform />
                <Text style={[styles.timerText, { color: colors.tint }]}>{formatTime(duration)}</Text>
                <Text style={[styles.sizeText, { color: colors.textSecondary }]}>
                  ({(duration * 0.016).toFixed(2)} MB)
                </Text>
              </View>
            )}

            {/* Hold/Cancel Status text */}
            {isRecording && !isHandsFree && (
              <Text style={[styles.cancelHint, { color: swipeCancel ? '#ef4444' : colors.textSecondary }]}>
                {swipeCancel ? '❌ Thả tay để hủy' : '← Vuốt trái để hủy'}
              </Text>
            )}

            {/* Pulse Rings behind Microphone */}
            {(isRecording || isSttListening) && (
              <Animated.View
                style={[
                  styles.pulseRing,
                  {
                    borderColor: activeTab === 'stt' ? '#22c55e' : colors.tint,
                    transform: [{ scale: pulseScale }],
                    opacity: pulseOpacity,
                  },
                ]}
              />
            )}

            {/* Main Interactive Button Layout */}
            <View style={styles.micLayout}>
              {/* Hands-Free: Cancel Button (Left) */}
              {isRecording && isHandsFree && (
                <TouchableOpacity
                  style={[styles.actionBtn, styles.cancelBtn]}
                  onPress={handleHandsFreeCancel}
                  activeOpacity={0.7}
                >
                  <Ionicons name="trash-outline" size={24} color="#ef4444" />
                </TouchableOpacity>
              )}

              {/* Central Large Microphone Button */}
              {activeTab === 'voice' ? (
                <View
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderGrant={handleTouchStart}
                  onResponderMove={handleTouchMove}
                  onResponderRelease={handleTouchRelease}
                  onResponderTerminate={handleTouchTerminate}
                  style={[
                    styles.bigMicCircle,
                    {
                      backgroundColor: colors.tint,
                      opacity: isRecording ? 0.7 : 1.0,
                    },
                  ]}
                >
                  <Ionicons name="mic" size={42} color="#fff" />
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.bigMicCircle, { backgroundColor: isSttListening ? '#22c55e' : colors.tint }]}
                  onPress={handleSttPress}
                  activeOpacity={0.8}
                >
                  <View style={styles.sttBtnContent}>
                    <Text style={styles.sttTextLabel}>[A]</Text>
                    <Ionicons name="mic" size={32} color="#fff" style={{ marginTop: -2 }} />
                  </View>
                </TouchableOpacity>
              )}

              {/* Hands-Free: Send Button (Right) */}
              {isRecording && isHandsFree && (
                <TouchableOpacity
                  style={[styles.actionBtn, { backgroundColor: colors.tint }]}
                  onPress={handleHandsFreeSend}
                  activeOpacity={0.7}
                >
                  <Ionicons name="checkmark" size={24} color="#fff" />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Segmented control tabs */}
          <View style={[styles.tabContainer, { backgroundColor: colors.background }]}>
            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'voice' && [
                  styles.activeTabButton,
                  { backgroundColor: colors.card },
                ],
              ]}
              onPress={() => {
                if (isRecording || isSttListening) return; // Prevent tab switching while active
                setActiveTab('voice');
              }}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === 'voice' ? colors.text : colors.textSecondary },
                  activeTab === 'voice' && styles.activeTabText,
                ]}
              >
                Gửi bản ghi âm
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.tabButton,
                activeTab === 'stt' && [
                  styles.activeTabButton,
                  { backgroundColor: colors.card },
                ],
              ]}
              onPress={() => {
                if (isRecording || isSttListening) return; // Prevent tab switching while active
                setActiveTab('stt');
              }}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.tabText,
                  { color: activeTab === 'stt' ? colors.text : colors.textSecondary },
                  activeTab === 'stt' && styles.activeTabText,
                ]}
              >
                Gửi dạng văn bản
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000',
  },
  sheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    paddingBottom: Platform.OS === 'ios' ? 40 : 26,
    paddingHorizontal: 20,
    alignItems: 'center',
    height: 380,
  },
  handleBar: {
    paddingVertical: 10,
    width: '100%',
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#cbd5e1',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  centerContainer: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  recordingStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    position: 'absolute',
    top: 5,
  },
  waveformContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2.5,
    paddingHorizontal: 8,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
    backgroundColor: '#ef4444',
  },
  timerText: {
    fontSize: 14,
    fontWeight: '700',
    marginHorizontal: 6,
    fontVariant: ['tabular-nums'],
  },
  sizeText: {
    fontSize: 12,
  },
  cancelHint: {
    fontSize: 13,
    position: 'absolute',
    top: 35,
  },
  pulseRing: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    borderWidth: 4,
  },
  micLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    gap: 36,
  },
  bigMicCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 5,
    zIndex: 10,
  },
  sttBtnContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sttTextLabel: {
    fontSize: 13,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.5,
  },
  actionBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  cancelBtn: {
    backgroundColor: '#f1f5f9',
  },
  tabContainer: {
    flexDirection: 'row',
    width: '85%',
    height: 44,
    borderRadius: 22,
    padding: 3,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    marginTop: 10,
  },
  tabButton: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 20,
  },
  activeTabButton: {
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
  },
  tabText: {
    fontSize: 13,
    fontWeight: '500',
  },
  activeTabText: {
    fontWeight: '700',
  },
});
