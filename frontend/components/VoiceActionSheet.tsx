import React, { useEffect, useRef } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface VoiceActionSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelectVoiceMessage: () => void;
  onSelectSpeechToText: () => void;
  speechSupported: boolean;
  colors: {
    tint: string;
    card: string;
    text: string;
    border: string;
    textSecondary: string;
    background: string;
  };
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export default function VoiceActionSheet({
  visible,
  onClose,
  onSelectVoiceMessage,
  onSelectSpeechToText,
  speechSupported,
  colors,
}: VoiceActionSheetProps) {
  const slideAnim = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(backdropAnim, {
          toValue: 0.5,
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
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  const handleDismiss = () => {
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

  const selectVoiceMessage = () => {
    Animated.parallel([
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onSelectVoiceMessage();
    });
  };

  const selectSpeechToText = () => {
    if (!speechSupported) return;
    Animated.parallel([
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: SCREEN_HEIGHT,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => {
      onSelectSpeechToText();
    });
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
          <Animated.View
            style={[
              styles.backdrop,
              {
                opacity: backdropAnim,
              },
            ]}
          />
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
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={styles.handle} />
            <Text style={[styles.title, { color: colors.text }]}>Bấm hoặc bấm giữ để ghi âm</Text>
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Chọn cách sử dụng giọng nói</Text>
          </View>

          {/* Options */}
          <View style={styles.optionsContainer}>
            {/* Option 1: Voice Message */}
            <TouchableOpacity
              style={[styles.optionRow, { borderBottomColor: colors.border }]}
              onPress={selectVoiceMessage}
              activeOpacity={0.7}
            >
              <View style={[styles.iconContainer, { backgroundColor: colors.tint + '15' }]}>
                <Ionicons name="mic" size={24} color={colors.tint} />
              </View>
              <View style={styles.optionTextContainer}>
                <Text style={[styles.optionTitle, { color: colors.text }]}>🎤 Gửi bản ghi âm</Text>
                <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>
                  Gửi file ghi âm như tin nhắn thoại
                </Text>
              </View>
            </TouchableOpacity>

            {/* Option 2: Speech to Text */}
            <TouchableOpacity
              style={[
                styles.optionRow,
                { borderBottomColor: colors.border },
                !speechSupported && styles.disabledOption,
              ]}
              onPress={selectSpeechToText}
              disabled={!speechSupported}
              activeOpacity={0.7}
            >
              <View
                style={[
                  styles.iconContainer,
                  { backgroundColor: speechSupported ? '#22c55e15' : colors.border },
                ]}
              >
                <Ionicons
                  name="document-text"
                  size={24}
                  color={speechSupported ? '#22c55e' : colors.textSecondary}
                />
              </View>
              <View style={styles.optionTextContainer}>
                <Text
                  style={[
                    styles.optionTitle,
                    { color: speechSupported ? colors.text : colors.textSecondary },
                  ]}
                >
                  📝 Gửi dạng văn bản
                </Text>
                <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>
                  {speechSupported
                    ? 'Chuyển giọng nói thành văn bản'
                    : 'Thiết bị hiện tại không hỗ trợ chuyển giọng nói thành văn bản.'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Cancel Button */}
          <TouchableOpacity
            style={[styles.cancelButton, { backgroundColor: colors.background }]}
            onPress={handleDismiss}
            activeOpacity={0.8}
          >
            <Text style={[styles.cancelText, { color: colors.text }]}>Hủy</Text>
          </TouchableOpacity>
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
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    paddingHorizontal: 20,
    maxHeight: SCREEN_HEIGHT * 0.7,
  },
  header: {
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 0.5,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#cbd5e1',
    marginBottom: 10,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
  },
  optionsContainer: {
    paddingVertical: 10,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 0.5,
  },
  iconContainer: {
    width: 46,
    height: 46,
    borderRadius: 23,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  optionDescription: {
    fontSize: 13,
  },
  disabledOption: {
    opacity: 0.6,
  },
  cancelButton: {
    marginTop: 12,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
