// frontend/components/ScreenshotPreviewModal.tsx
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TextInput,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

interface ScreenshotPreviewModalProps {
  visible: boolean;
  imagePath: string | null;
  onClose: () => void;
  onSend: (caption: string, base64Data: string) => void;
}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: () => boolean;
      captureScreen: (options?: { excludeSelf: boolean }) => void;
      onScreenshotCaptured: (callback: (filePath: string) => void) => void;
      readImageFile: (filePath: string) => Promise<string | null>;
    };
  }
}

export const ScreenshotPreviewModal: React.FC<ScreenshotPreviewModalProps> = ({
  visible,
  imagePath,
  onClose,
  onSend
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [loading, setLoading] = useState(true);
  const [base64Data, setBase64Data] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);

  // Khi modal hiện lên và có đường dẫn ảnh tạm -> Đọc file tạm lên Base64
  useEffect(() => {
    if (visible && imagePath) {
      setLoading(true);
      setCaption('');
      setSending(false);
      
      const loadCroppedImage = async () => {
        try {
          if (window.electronAPI && typeof window.electronAPI.readImageFile === 'function') {
            const data = await window.electronAPI.readImageFile(imagePath);
            if (data) {
              setBase64Data(data);
            }
          }
        } catch (err) {
          console.error('Lỗi khi đọc file ảnh chụp:', err);
        } finally {
          setLoading(false);
        }
      };

      loadCroppedImage();
    } else {
      setBase64Data(null);
    }
  }, [visible, imagePath]);

  const handleSend = () => {
    if (!base64Data) return;
    setSending(true);
    // Kích hoạt callback gửi ảnh ngầm
    onSend(caption.trim(), base64Data);
  };

  return (
    <Modal
      animationType="fade"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardView}
        >
          <View style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}>
            
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <View style={styles.headerLeft}>
                <Ionicons name="image-outline" size={20} color={colors.tint} />
                <Text style={[styles.title, { color: colors.text }]}>Chia sẻ ảnh chụp màn hình</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Vùng ảnh xem trước */}
            <View style={[styles.previewContainer, { backgroundColor: colorScheme === 'dark' ? '#0f172a' : '#f8fafc' }]}>
              {loading ? (
                <View style={styles.centered}>
                  <ActivityIndicator size="large" color={colors.tint} />
                  <Text style={{ marginTop: 10, fontSize: 13, color: colors.textSecondary }}>Đang nạp ảnh chụp...</Text>
                </View>
              ) : base64Data ? (
                <Image
                  source={{ uri: `data:image/jpeg;base64,${base64Data}` }}
                  style={styles.previewImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.centered}>
                  <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
                  <Text style={{ marginTop: 10, fontSize: 13, color: colors.textSecondary }}>Không thể tải hình ảnh.</Text>
                </View>
              )}
            </View>

            {/* Input chú thích (Caption) */}
            <View style={styles.inputWrapper}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Thêm chú thích tin nhắn (tùy chọn)</Text>
              <View style={[styles.inputContainer, { borderColor: colors.border, backgroundColor: colors.background }]}>
                <Ionicons name="chatbubble-ellipses-outline" size={18} color="#a0aec0" style={styles.inputIcon} />
                <TextInput
                  style={[styles.input, { color: colors.text }]}
                  placeholder="Nhập tin nhắn đi kèm ảnh..."
                  placeholderTextColor="#a0aec0"
                  value={caption}
                  onChangeText={setCaption}
                  maxLength={200}
                />
              </View>
            </View>

            {/* Nút bấm điều khiển */}
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.btn, styles.btnCancel, { borderColor: colors.border }]}
                onPress={onClose}
                disabled={sending}
              >
                <Text style={[styles.btnCancelText, { color: colors.text }]}>Hủy</Text>
              </TouchableOpacity>
              
              <TouchableOpacity
                style={[
                  styles.btn,
                  styles.btnSend,
                  { backgroundColor: colors.tint },
                  (!base64Data || sending) && { opacity: 0.6 }
                ]}
                onPress={handleSend}
                disabled={!base64Data || sending}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="paper-plane" size={16} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.btnSendText}>Gửi ngay</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>

          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  keyboardView: {
    width: '100%',
    maxWidth: 540,
    alignItems: 'center',
  },
  modalContent: {
    width: '100%',
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    elevation: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 15,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 4,
  },
  previewContainer: {
    width: '100%',
    height: 280,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.05)',
  },
  previewImage: {
    width: '90%',
    height: '90%',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  inputWrapper: {
    padding: 20,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 42,
  },
  inputIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    fontSize: 13,
    height: '100%',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  btn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  btnCancel: {
    borderWidth: 1,
  },
  btnCancelText: {
    fontSize: 13,
    fontWeight: '700',
  },
  btnSend: {
    minWidth: 100,
    shadowColor: '#2563eb',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 2,
  },
  btnSendText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
