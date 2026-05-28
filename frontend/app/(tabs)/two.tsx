// frontend/app/(tabs)/two.tsx
import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  ScrollView,
  Switch,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUser } from '../../context/UserContext';
import { endpoints, API_BASE_URL } from '@/constants/Config';
import * as ImagePicker from 'expo-image-picker';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user, logout, updateUserInContext } = useUser();
  
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [darkModeEnabled, setDarkModeEnabled] = useState(colorScheme === 'dark');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Modal cấp tài khoản mới cho Admin
  const [provisionModalVisible, setProvisionModalVisible] = useState(false);
  const [provName, setProvName] = useState('');
  const [provEmail, setProvEmail] = useState('');
  const [provPassword, setProvPassword] = useState('');
  const [provRole, setProvRole] = useState<'admin' | 'user'>('user');
  const [provisioning, setProvisioning] = useState(false);

  const handleUpdateAvatar = async () => {
    // 1. Yêu cầu quyền truy cập thư viện ảnh
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (permissionResult.granted === false) {
      Alert.alert("Quyền truy cập", "Bạn cần cấp quyền truy cập thư viện ảnh để thay đổi ảnh đại diện!");
      return;
    }

    // 2. Chọn hình ảnh từ thư viện
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return;
    }

    const pickedAsset = result.assets[0];
    const pickedUri = pickedAsset.uri;

    setUploadingAvatar(true);

    try {
      // 3. Chuẩn bị FormData tệp tin nhị phân
      const formData = new FormData();
      let fileExt = 'jpg';
      if (pickedAsset.mimeType) {
        const mimeParts = pickedAsset.mimeType.split('/');
        if (mimeParts.length > 1) {
          const rawExt = mimeParts[1].toLowerCase();
          if (rawExt === 'jpeg' || rawExt === 'jpg') fileExt = 'jpg';
          else if (rawExt === 'png') fileExt = 'png';
          else if (rawExt === 'gif') fileExt = 'gif';
          else fileExt = rawExt;
        }
      } else if (pickedAsset.fileName) {
        const nameParts = pickedAsset.fileName.split('.');
        if (nameParts.length > 1) {
          fileExt = nameParts.pop()?.toLowerCase() || fileExt;
        }
      }

      const fileName = `avatar_${user?.id || 'temp'}_${Date.now()}.${fileExt}`;
      const fileType = pickedAsset.mimeType || 'image/jpeg';

      if (Platform.OS === 'web') {
        const response = await fetch(pickedUri);
        const blob = await response.blob();
        formData.append('file', blob, fileName);
      } else {
        formData.append('file', {
          uri: pickedUri,
          name: fileName,
          type: fileType
        } as any);
      }

      // 4. Gọi API tải lên máy chủ Express
      const uploadResponse = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });

      const responseText = await uploadResponse.text();
      let uploadResult;
      try {
        uploadResult = JSON.parse(responseText);
      } catch (parseError) {
        console.error("❌ Lỗi phân tích JSON từ server:", responseText);
        Alert.alert("Lỗi phản hồi", "Máy chủ trả về phản hồi không hợp lệ. Vui lòng kiểm tra cấu hình server!");
        setUploadingAvatar(false);
        return;
      }

      if (uploadResponse.ok && uploadResult.status === 'success') {
        const newAvatarUrl = uploadResult.file_url;

        // 5. Gọi API cập nhật ảnh đại diện trong CSDL users
        const updateResponse = await fetch(endpoints.users, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'update_avatar',
            id: user?.id,
            avatar: newAvatarUrl
          })
        });

        const updateResult = await updateResponse.json();

        if (updateResponse.ok && updateResult.status === 'success') {
          // 6. Cập nhật thông tin trong context toàn cục
          if (user) {
            const updatedUser = { ...user, avatar: newAvatarUrl };
            await updateUserInContext(updatedUser);
            Alert.alert("Thành công", "Đã cập nhật ảnh đại diện thành công!");
          }
        } else {
          Alert.alert("Lỗi cập nhật", updateResult.message || "Không thể cập nhật ảnh đại diện vào CSDL.");
        }
      } else {
        Alert.alert("Lỗi tải lên", uploadResult.message || "Không thể tải tệp lên.");
      }
    } catch (error) {
      console.error("Lỗi khi thay đổi ảnh đại diện:", error);
      Alert.alert("Lỗi kết nối", "Không thể kết nối đến máy chủ. Vui lòng kiểm tra server!");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      const confirmLogout = window.confirm('Bạn có chắc chắn muốn đăng xuất khỏi tài khoản?');
      if (confirmLogout) {
        logout();
      }
    } else {
      Alert.alert('Đăng xuất', 'Bạn có chắc chắn muốn đăng xuất khỏi tài khoản?', [
        { text: 'Hủy', style: 'cancel' },
        { text: 'Đăng xuất', style: 'destructive', onPress: () => logout() }
      ]);
    }
  };

  const handleProvisionAccount = async () => {
    const email = provEmail.trim();
    const password = provPassword.trim();
    const name = provRole === 'admin' ? 'Admin' : provName.trim();

    if (!email || !password) {
      Alert.alert('Lỗi', 'Vui lòng điền đầy đủ Email và Mật khẩu!');
      return;
    }

    setProvisioning(true);
    try {
      const response = await fetch(endpoints.users, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name,
          email: email,
          password: password,
          role: provRole,
          avatar: provRole === 'admin'
            ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80'
            : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80',
          status: 'active',
        }),
      });

      const result = await response.json();

      if (response.ok && result.status === 'success') {
        Alert.alert('Cấp tài khoản thành công', `Đã tạo tài khoản cho thành viên ${provName} thành công!`);
        setProvisionModalVisible(false);
        // Reset Form
        setProvName('');
        setProvEmail('');
        setProvPassword('');
        setProvRole('user');
      } else {
        Alert.alert('Cấp tài khoản thất bại', result.message || 'Có lỗi xảy ra.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ để cấp tài khoản. Vui lòng kiểm tra server!');
    } finally {
      setProvisioning(false);
    }
  };

  const renderSettingItem = (icon: string, title: string, subtitle?: string, rightElement?: React.ReactNode, onPress?: () => void) => (
    <TouchableOpacity
      style={[styles.settingItem, { borderBottomColor: colors.border }]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.settingItemLeft}>
        <View style={[styles.iconWrapper, { backgroundColor: colors.tint + '12' }]}>
          <Ionicons name={icon as any} size={20} color={colors.tint} />
        </View>
        <View>
          <Text style={[styles.settingItemTitle, { color: colors.text }]}>{title}</Text>
          {subtitle && (
            <Text style={[styles.settingItemSubtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
          )}
        </View>
      </View>
      {rightElement ? rightElement : (
        <Ionicons name="chevron-forward" size={16} color="#c2c6d6" />
      )}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        
        {/* 1. Profile Card */}
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity 
            style={styles.avatarContainer} 
            onPress={handleUpdateAvatar}
            disabled={uploadingAvatar}
            activeOpacity={0.7}
          >
            <Image 
              source={{ uri: user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }} 
              style={styles.avatar} 
            />
            {uploadingAvatar ? (
              <View style={styles.avatarOverlay}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : (
              <View style={styles.avatarOverlay}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            )}
          </TouchableOpacity>
          <View style={styles.profileInfo}>
            <Text style={[styles.profileName, { color: colors.text }]}>{user?.name || 'Thành viên'}</Text>
            <Text style={[styles.profileRole, { color: colors.tint }]}>
              {user?.role === 'admin' ? '🔑 Quản trị viên (Admin)' : '👤 Nhân viên (User)'}
            </Text>
            <Text style={[styles.profileEmail, { color: colors.textSecondary }]}>{user?.email}</Text>
          </View>
          <View style={styles.statusBadge}>
            <View style={styles.statusDot} />
            <Text style={styles.statusText}>Active</Text>
          </View>
        </View>

        {/* 2. Account Settings Group */}
        <Text style={[styles.groupTitle, { color: colors.text }]}>Tài khoản</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {renderSettingItem('person-outline', 'Thông tin cá nhân', 'Thay đổi ảnh đại diện', null, handleUpdateAvatar)}
          {renderSettingItem('shield-checkmark-outline', 'Bảo mật tài khoản', 'Mật khẩu, xác thực 2 lớp', null, () => {})}
          {renderSettingItem('cloud-upload-outline', 'Quản lý tài liệu', 'Tệp tin đã tải lên hệ thống', null, () => {})}
        </View>

        {/* 2b. Admin-only Section */}
        {(user?.role === 'admin' || user?.role === 'Project Manager') && (
          <>
            <Text style={[styles.groupTitle, { color: colors.text, marginTop: 8 }]}>Quản lý hệ thống (Admin)</Text>
            <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {renderSettingItem(
                'person-add-outline',
                'Cấp tài khoản mới',
                'Tạo tài khoản thành viên cho nhân viên mới',
                null,
                () => setProvisionModalVisible(true)
              )}
            </View>
          </>
        )}

        {/* 3. System Settings Group */}
        <Text style={[styles.groupTitle, { color: colors.text }]}>Hệ thống</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {renderSettingItem(
            'notifications-outline',
            'Thông báo đẩy',
            'Báo tin nhắn mới, cập nhật task',
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ false: '#767577', true: colors.tint }}
            />
          )}
          {renderSettingItem(
            'moon-outline',
            'Giao diện tối (Dark mode)',
            'Chuyển đổi giao diện Sáng / Tối',
            <Switch
              value={darkModeEnabled}
              onValueChange={setDarkModeEnabled}
              trackColor={{ false: '#767577', true: colors.tint }}
            />
          )}
          {renderSettingItem('language-outline', 'Ngôn ngữ', 'Tiếng Việt (Vietnamese)', null, () => {})}
        </View>

        {/* 4. Support Group */}
        <Text style={[styles.groupTitle, { color: colors.text }]}>Hỗ trợ</Text>
        <View style={[styles.settingsGroup, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {renderSettingItem('help-circle-outline', 'Trung tâm trợ giúp', 'Hướng dẫn sử dụng TeamFlow', null, () => {})}
          {renderSettingItem('information-circle-outline', 'Giới thiệu phiên bản', 'Version 1.0.0 (Expo + PHP)', null, () => {})}
        </View>

        {/* 5. Logout Button */}
        <TouchableOpacity
          style={[styles.logoutBtn, { borderColor: colors.danger }]}
          onPress={handleLogout}
        >
          <Ionicons name="log-out-outline" size={20} color={colors.danger} style={{ marginRight: 8 }} />
          <Text style={[styles.logoutText, { color: colors.danger }]}>Đăng xuất</Text>
        </TouchableOpacity>

      </ScrollView>

      {/* 6. Admin Account Provisioning Form Modal (Notion styled) */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={provisionModalVisible}
        onRequestClose={() => setProvisionModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Cấp tài khoản mới</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>
                  Tạo tài khoản truy cập hệ thống ngay lập tức
                </Text>
              </View>
              <TouchableOpacity onPress={() => setProvisionModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

             <ScrollView contentContainerStyle={styles.formContainer}>
              {provRole === 'user' ? (
                <>
                  <Text style={styles.label}>Họ và tên (Mặc định: Chưa đặt tên)</Text>
                  <TextInput
                    style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                    placeholder="Nhập họ và tên hoặc để trống..."
                    placeholderTextColor="#a0aec0"
                    value={provName}
                    onChangeText={setProvName}
                  />
                </>
              ) : (
                <View style={{ backgroundColor: colors.background, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border, marginTop: 14 }}>
                  <Text style={{ fontSize: 13, color: colors.textSecondary, lineHeight: 18 }}>
                    💡 Vai trò **ADMIN** sẽ tự động gán tên hiển thị mặc định là **"Admin"**. Người dùng không cần cấu hình.
                  </Text>
                </View>
              )}

              <Text style={styles.label}>Địa chỉ Email *</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                placeholder="nhanvien@company.com"
                placeholderTextColor="#a0aec0"
                keyboardType="email-address"
                autoCapitalize="none"
                value={provEmail}
                onChangeText={setProvEmail}
              />

              <Text style={styles.label}>Mật khẩu truy cập *</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                placeholder="••••••"
                placeholderTextColor="#a0aec0"
                secureTextEntry
                autoCapitalize="none"
                value={provPassword}
                onChangeText={setProvPassword}
              />

              <Text style={styles.label}>Vai trò trên hệ thống</Text>
              <View style={styles.roleSelector}>
                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    provRole === 'user'
                      ? { backgroundColor: colors.tint, borderColor: colors.tint }
                      : { borderColor: colors.border }
                  ]}
                  onPress={() => setProvRole('user')}
                >
                  <Text style={{ color: provRole === 'user' ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>
                    USER (Nhân viên)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    provRole === 'admin'
                      ? { backgroundColor: colors.tint, borderColor: colors.tint }
                      : { borderColor: colors.border }
                  ]}
                  onPress={() => setProvRole('admin')}
                >
                  <Text style={{ color: provRole === 'admin' ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>
                    ADMIN (Quản trị viên)
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.tint }]}
                onPress={handleProvisionAccount}
                disabled={provisioning}
              >
                {provisioning ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Cấp tài khoản ngay</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 768,
    alignSelf: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 2,
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 16,
  },
  avatar: {
    width: 68,
    height: 68,
    borderRadius: 34,
  },
  avatarOverlay: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: '#3b82f6',
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 4,
  },
  profileRole: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 12,
  },
  statusBadge: {
    position: 'absolute',
    top: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ecfdf5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
    marginRight: 6,
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#065f46',
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#727785',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginLeft: 4,
  },
  settingsGroup: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.01,
    shadowRadius: 4,
    elevation: 1,
  },
  settingItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  settingItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  iconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingItemTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  settingItemSubtitle: {
    fontSize: 11,
    marginTop: 2,
  },
  logoutBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    marginTop: 8,
  },
  logoutText: {
    fontSize: 14,
    fontWeight: '700',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  formContainer: {
    paddingBottom: 40,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#727785',
    marginBottom: 8,
    marginTop: 16,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 15,
  },
  roleSelector: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  roleOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 28,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
