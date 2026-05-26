// frontend/components/NameOnboardingScreen.tsx
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '@/context/UserContext';
import { API_BASE_URL } from '@/constants/Config';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

export default function NameOnboardingScreen() {
  const { user, updateUserInContext } = useUser();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!name.trim()) {
      Alert.alert('Thông báo', 'Vui lòng nhập họ và tên của bạn để tiếp tục!');
      return;
    }

    if (name.trim().length < 2) {
      Alert.alert('Thông báo', 'Họ và tên quá ngắn, vui lòng nhập đầy đủ!');
      return;
    }

    if (name.trim() === 'Chưa đặt tên' || name.trim() === 'Admin') {
      Alert.alert('Thông báo', 'Họ tên này không được phép sử dụng. Vui lòng chọn tên thật của bạn!');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_name',
          id: user?.id,
          name: name.trim(),
        }),
      });

      const result = await response.json();

      if (response.ok && result.status === 'success') {
        Alert.alert('Thành công', 'Họ tên hiển thị đã được cập nhật thành công!', [
          {
            text: 'Bắt đầu ngay',
            onPress: () => {
              if (user) {
                // Cập nhật thông tin name trong global context
                updateUserInContext({
                  ...user,
                  name: name.trim()
                });
              }
            }
          }
        ]);
      } else {
        Alert.alert('Lỗi cập nhật', result.message || 'Không thể lưu tên của bạn. Vui lòng thử lại!');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ. Vui lòng kiểm tra XAMPP và Wi-Fi!');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        
        {/* Notion-styled Welcome Card */}
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.iconCircle}>
            <Ionicons name="sparkles-outline" size={32} color={colors.tint} />
          </View>

          <Text style={[styles.title, { color: colors.text }]}>Chào mừng bạn! 👋</Text>
          
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            Tài khoản của bạn (<Text style={{ fontWeight: 'bold' }}>{user?.email}</Text>) đã hoạt động. Vui lòng nhập họ và tên của bạn để mọi người trong nhóm dễ dàng nhận diện và trao đổi công việc.
          </Text>

          {/* Input field */}
          <Text style={styles.label}>Họ và tên của bạn</Text>
          <View style={[styles.inputContainer, { borderColor: colors.border, backgroundColor: colors.background }]}>
            <Ionicons name="person-outline" size={20} color="#a0aec0" style={styles.inputIcon} />
            <TextInput
              style={[styles.input, { color: colors.text }]}
              placeholder="Ví dụ: Trần Văn B"
              placeholderTextColor="#a0aec0"
              autoCapitalize="words"
              value={name}
              onChangeText={setName}
              maxLength={50}
            />
          </View>

          {/* Submit button */}
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: colors.tint }, loading && { opacity: 0.8 }]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Text style={styles.submitBtnText}>Hoàn tất & Bắt đầu</Text>
                <Ionicons name="chevron-forward" size={18} color="#fff" style={{ marginLeft: 6 }} />
              </>
            )}
          </TouchableOpacity>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 24,
    maxWidth: 440,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 28,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.03,
    shadowRadius: 12,
    elevation: 3,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#eff6ff',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  description: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 24,
    paddingHorizontal: 14,
    height: 48,
    width: '100%',
  },
  inputIcon: {
    marginRight: 10,
  },
  input: {
    flex: 1,
    fontSize: 14,
    height: '100%',
  },
  submitBtn: {
    flexDirection: 'row',
    borderRadius: 12,
    height: 48,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#1d4ed8',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
