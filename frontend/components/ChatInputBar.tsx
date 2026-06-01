import React, { useState, useRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  View,
  TextInput,
  TouchableOpacity,
  Image,
  Text,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ChatInputBarProps {
  onSendMessage: (text: string) => void;
  onSelectMedia: () => void;
  screenshotUri: string | null;
  onClearScreenshot: () => void;
}

export default function ChatInputBar({
  onSendMessage,
  onSelectMedia,
  screenshotUri,
  onClearScreenshot
}: ChatInputBarProps) {
  const [text, setText] = useState('');
  const [inputHeight, setInputHeight] = useState(40);
  const textInputRef = useRef<TextInput>(null);

  const handleSend = () => {
    if (!text.trim() && !screenshotUri) return;
    onSendMessage(text.trim());
    setText('');
    setInputHeight(40); // Reset vertical space
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0} // Accounts for header height
      style={styles.keyboardContainer}
    >
      <View style={styles.inputOuterWrapper}>
        
        {/* Dynamic Image Attachment Overlay (Capped at 70% Max Width) */}
        {screenshotUri && (
          <View style={styles.thumbnailContainer}>
            <View style={styles.imageWrapper}>
              <Image source={{ uri: screenshotUri }} style={styles.mediaThumbnail} resizeMode="cover" />
              <TouchableOpacity style={styles.clearBtn} onPress={onClearScreenshot}>
                <Ionicons name="close-circle" size={20} color="#ef4444" />
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Dynamic Typing & Control bar */}
        <View style={styles.inputInnerBar}>
          <TouchableOpacity style={styles.mediaBtn} onPress={onSelectMedia}>
            <Ionicons name="image-outline" size={22} color="#64748b" />
          </TouchableOpacity>

          <TextInput
            ref={textInputRef}
            style={[styles.textInput, { height: Math.min(100, Math.max(40, inputHeight)) }]}
            placeholder="Viết tin nhắn..."
            placeholderTextColor="#94a3b8"
            value={text}
            onChangeText={setText}
            multiline
            onContentSizeChange={(e) => setInputHeight(e.nativeEvent.contentSize.height)}
            blurOnSubmit={false}
          />

          <TouchableOpacity 
            style={[styles.sendBtn, (!text.trim() && !screenshotUri) && styles.sendBtnDisabled]} 
            onPress={handleSend}
            disabled={!text.trim() && !screenshotUri}
          >
            <Ionicons name="send" size={16} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardContainer: {
    width: '100%',
  },
  inputOuterWrapper: {
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  thumbnailContainer: {
    flexDirection: 'row',
    marginBottom: 8,
    alignItems: 'flex-end',
  },
  imageWrapper: {
    position: 'relative',
    maxWidth: '70%', // Force limit to max 70% of screen width
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: '#cbd5e1',
  },
  mediaThumbnail: {
    width: 220,
    height: 140,
    borderRadius: 10,
  },
  clearBtn: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  inputInnerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mediaBtn: {
    padding: 6,
    justifyContent: 'center',
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: '#f1f5f9',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: '#0f172a',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    textAlignVertical: 'center',
  },
  sendBtn: {
    backgroundColor: '#3b82f6',
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendBtnDisabled: {
    backgroundColor: '#94a3b8',
    opacity: 0.6,
  }
});
