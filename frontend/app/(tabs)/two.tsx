// frontend/app/(tabs)/two.tsx
import React, { useState, useEffect } from 'react';
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
import { useSocket } from '../../context/SocketContext';
import { endpoints, API_BASE_URL } from '@/constants/Config';
import * as ImagePicker from 'expo-image-picker';

export default function SettingsScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user, logout, updateUserInContext } = useUser();
  const { socket } = useSocket();
  
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

  // State quản lý tài khoản dành cho Admin
  const [manageModalVisible, setManageModalVisible] = useState(false);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sửa thông tin tài khoản
  const [editingUser, setEditingUser] = useState<any | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
  const [editStatus, setEditStatus] = useState<'active' | 'inactive'>('active');
  const [updatingUser, setUpdatingUser] = useState(false);

  // Đặt lại mật khẩu (Reset Password)
  const [resettingUser, setResettingUser] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [submittingPassword, setSubmittingPassword] = useState(false);

  // Lấy danh sách tài khoản
  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch(endpoints.users);
      const result = await response.json();
      if (result.status === 'success') {
        setUsersList(result.data || []);
      }
    } catch (err) {
      console.error('❌ Lỗi tải danh sách người dùng:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Đồng bộ thời gian thực qua Socket.IO
  useEffect(() => {
    if (!socket) return;

    const handleUserSync = () => {
      console.log('📡 [SOCKET] Cập nhật lại danh sách tài khoản (Realtime)');
      fetchUsers();
    };

    socket.on('user_created', handleUserSync);
    socket.on('user_updated', handleUserSync);
    socket.on('user_deleted', handleUserSync);
    socket.on('user_role_changed', handleUserSync);
    socket.on('user_status_changed', handleUserSync);

    return () => {
      socket.off('user_created', handleUserSync);
      socket.off('user_updated', handleUserSync);
      socket.off('user_deleted', handleUserSync);
      socket.off('user_role_changed', handleUserSync);
      socket.off('user_status_changed', handleUserSync);
    };
  }, [socket]);

  const handleUpdateAvatar = async () => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (permissionResult.granted === false) {
      Alert.alert("Quyền truy cập", "Bạn cần cấp quyền truy cập thư viện ảnh để thay đổi ảnh đại diện!");
      return;
    }

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
        Alert.alert('Cấp tài khoản thành công', `Đã tạo tài khoản cho thành viên ${provName || name} thành công!`);
        setProvisionModalVisible(false);
        setProvName('');
        setProvEmail('');
        setProvPassword('');
        setProvRole('user');
        fetchUsers(); // Cập nhật danh sách
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

  // Cập nhật thông tin tài khoản (Chỉnh sửa)
  const handleUpdateUserInfo = async () => {
    if (!editingUser) return;
    const name = editName.trim();
    const email = editEmail.trim();

    if (!name || !email) {
      Alert.alert('Lỗi', 'Vui lòng điền đầy đủ Họ và tên và địa chỉ Email!');
      return;
    }

    setUpdatingUser(true);
    try {
      const response = await fetch(`${API_BASE_URL}/users/admin-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingUser.id,
          name,
          email,
          role: editRole,
          status: editStatus,
        }),
      });

      const result = await response.json();

      if (response.ok && result.status === 'success') {
        Alert.alert('Thành công', 'Đã cập nhật thông tin tài khoản thành công!');
        setEditingUser(null);
        fetchUsers();
      } else {
        Alert.alert('Thất bại', result.message || 'Có lỗi xảy ra.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ để lưu thông tin.');
    } finally {
      setUpdatingUser(false);
    }
  };

  // Khóa / Mở khóa tài khoản ngay lập tức
  const handleToggleStatus = async (targetUser: any) => {
    if (targetUser.id === 1) {
      Alert.alert('Lỗi bảo mật', 'Không được phép khóa tài khoản Super Admin.');
      return;
    }
    if (targetUser.id === user?.id) {
      Alert.alert('Lỗi bảo mật', 'Bạn không được tự khóa tài khoản của chính mình.');
      return;
    }

    const newStatus = targetUser.status === 'active' ? 'inactive' : 'active';
    const statusText = newStatus === 'active' ? 'mở khóa' : 'khóa';

    try {
      const response = await fetch(`${API_BASE_URL}/users/admin-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: targetUser.id,
          status: newStatus,
        }),
      });

      const result = await response.json();

      if (response.ok && result.status === 'success') {
        Alert.alert('Thành công', `Đã ${statusText} tài khoản người dùng thành công!`);
        fetchUsers();
      } else {
        Alert.alert('Thất bại', result.message || 'Có lỗi xảy ra.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
    }
  };

  // Reset mật khẩu mới
  const handleResetPassword = async () => {
    if (!resettingUser) return;
    const pwd = newPassword.trim();

    if (!pwd || pwd.length < 4) {
      Alert.alert('Lỗi', 'Vui lòng nhập mật khẩu mới có độ dài từ 4 ký tự trở lên!');
      return;
    }

    setSubmittingPassword(true);
    try {
      const response = await fetch(`${API_BASE_URL}/users/admin-reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: resettingUser.id,
          newPassword: pwd,
        }),
      });

      const result = await response.json();

      if (response.ok && result.status === 'success') {
        Alert.alert('Thành công', `Đã thay đổi mật khẩu thành viên thành công!`);
        setResettingUser(null);
        setNewPassword('');
      } else {
        Alert.alert('Thất bại', result.message || 'Có lỗi xảy ra.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
    } finally {
      setSubmittingPassword(false);
    }
  };

  // Xóa tài khoản
  const handleDeleteUser = async (targetUser: any) => {
    if (targetUser.id === 1) {
      Alert.alert('Lỗi bảo mật', 'Không thể xóa tài khoản Super Admin.');
      return;
    }
    if (targetUser.id === user?.id) {
      Alert.alert('Lỗi bảo mật', 'Bạn không thể tự xóa tài khoản của chính mình.');
      return;
    }

    const confirmDelete = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/users/admin-delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: targetUser.id }),
        });

        const result = await response.json();

        if (response.ok && result.status === 'success') {
          Alert.alert('Thành công', 'Đã xóa vĩnh viễn tài khoản thành công!');
          fetchUsers();
        } else {
          Alert.alert('Thất bại', result.message || 'Có lỗi xảy ra.');
        }
      } catch (error) {
        console.error(error);
        Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
      }
    };

    if (Platform.OS === 'web') {
      const isConfirmed = window.confirm(`⚠️ Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản "${targetUser.name}"? Hành động này không thể hoàn tác!`);
      if (isConfirmed) confirmDelete();
    } else {
      Alert.alert(
        '⚠️ Xác nhận xóa tài khoản',
        `Bạn có chắc chắn muốn xóa vĩnh viễn tài khoản "${targetUser.name}"? Hành động này không thể hoàn tác!`,
        [
          { text: 'Hủy', style: 'cancel' },
          { text: 'Xóa vĩnh viễn', style: 'destructive', onPress: confirmDelete }
        ]
      );
    }
  };

  const startEditUser = (targetUser: any) => {
    setEditingUser(targetUser);
    setEditName(targetUser.name);
    setEditEmail(targetUser.email);
    setEditRole(targetUser.role);
    setEditStatus(targetUser.status);
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
        <View style={{ flex: 1 }}>
          <Text style={[styles.settingItemTitle, { color: colors.text }]}>{title}</Text>
          {subtitle && (
            <Text style={[styles.settingItemSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>{subtitle}</Text>
          )}
        </View>
      </View>
      {rightElement ? rightElement : (
        <Ionicons name="chevron-forward" size={16} color="#c2c6d6" />
      )}
    </TouchableOpacity>
  );

  const filteredUsers = usersList.filter(u => 
    u.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchQuery.toLowerCase())
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
              {renderSettingItem(
                'people-outline',
                'Quản lý tài khoản',
                'Xem danh sách, sửa, reset mật khẩu, khóa, xóa tài khoản',
                null,
                () => {
                  fetchUsers();
                  setManageModalVisible(true);
                }
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

      {/* 6. Admin Account Provisioning Form Modal */}
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

            <ScrollView contentContainerStyle={styles.formContainer} showsVerticalScrollIndicator={false}>
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

      {/* 7. Modal Quản Lý Danh Sách Tài Khoản (Account Management Modal) */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={manageModalVisible}
        onRequestClose={() => setManageModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card, height: '90%' }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>👥 Quản lý tài khoản</Text>
                <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>
                  Quản trị viên xem, sửa thông tin, đặt lại mật khẩu và xóa thành viên
                </Text>
              </View>
              <TouchableOpacity onPress={() => setManageModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {/* Thanh tìm kiếm */}
            <View style={[styles.searchContainer, { borderColor: colors.border, backgroundColor: colors.background }]}>
              <Ionicons name="search-outline" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                style={{ flex: 1, color: colors.text, fontSize: 14, paddingVertical: 8 }}
                placeholder="Tìm kiếm theo họ tên hoặc email..."
                placeholderTextColor="#a0aec0"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
              {searchQuery !== '' && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {loadingUsers ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" color={colors.tint} />
                <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 13 }}>Đang tải danh sách thành viên...</Text>
              </View>
            ) : (
              <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
                {filteredUsers.length === 0 ? (
                  <View style={{ py: 40, alignItems: 'center' }}>
                    <Ionicons name="people-outline" size={48} color={colors.border} />
                    <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }}>Không tìm thấy tài khoản phù hợp</Text>
                  </View>
                ) : (
                  filteredUsers.map((item) => (
                    <View key={item.id} style={[styles.userListItem, { borderColor: colors.border }]}>
                      {/* Cột trái: Thông tin chính */}
                      <View style={styles.userListLeft}>
                        <Image
                          source={{ uri: item.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }}
                          style={styles.userListAvatar}
                        />
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <Text style={[styles.userListName, { color: colors.text }]}>{item.name}</Text>
                            
                            {/* Role Badge */}
                            <View style={[
                              styles.userRoleBadge,
                              { backgroundColor: item.role === 'admin' ? '#fee2e2' : '#e0f2fe' }
                            ]}>
                              <Text style={[
                                styles.userRoleBadgeText,
                                { color: item.role === 'admin' ? '#991b1b' : '#0369a1' }
                              ]}>
                                {item.role === 'admin' ? 'ADMIN' : 'USER'}
                              </Text>
                            </View>

                            {/* Status Badge */}
                            <View style={[
                              styles.userStatusBadge,
                              { backgroundColor: item.status === 'active' ? '#d1fae5' : '#f3f4f6' }
                            ]}>
                              <Text style={[
                                styles.userStatusBadgeText,
                                { color: item.status === 'active' ? '#065f46' : '#4b5563' }
                              ]}>
                                {item.status === 'active' ? 'Active' : 'Locked'}
                              </Text>
                            </View>
                          </View>
                          <Text style={{ fontSize: 12, color: colors.textSecondary, marginTop: 2 }}>{item.email}</Text>
                          <Text style={{ fontSize: 10, color: colors.textSecondary + 'aa', marginTop: 2 }}>Được tạo ngày: {new Date(item.created_at).toLocaleDateString('vi-VN')}</Text>
                        </View>
                      </View>

                      {/* Cột phải: Các nút thao tác nhanh */}
                      <View style={styles.userListActions}>
                        <TouchableOpacity
                          style={[styles.miniBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                          onPress={() => startEditUser(item)}
                          title="Chỉnh sửa thông tin"
                        >
                          <Ionicons name="create-outline" size={15} color={colors.tint} />
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.miniBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                          onPress={() => setResettingUser(item)}
                          title="Reset mật khẩu"
                        >
                          <Ionicons name="key-outline" size={15} color="#eab308" />
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[
                            styles.miniBtn,
                            { 
                              backgroundColor: colors.background, 
                              borderColor: colors.border,
                            }
                          ]}
                          onPress={() => handleToggleStatus(item)}
                          title={item.status === 'active' ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}
                        >
                          <Ionicons 
                            name={item.status === 'active' ? 'lock-closed-outline' : 'lock-open-outline'} 
                            size={15} 
                            color={item.status === 'active' ? '#f97316' : '#10b981'} 
                          />
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={[styles.miniBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                          onPress={() => handleDeleteUser(item)}
                          title="Xóa tài khoản"
                          disabled={item.id === user?.id || item.id === 1}
                          style={[
                            styles.miniBtn, 
                            { 
                              backgroundColor: colors.background, 
                              borderColor: colors.border, 
                              opacity: (item.id === user?.id || item.id === 1) ? 0.3 : 1 
                            }
                          ]}
                        >
                          <Ionicons name="trash-outline" size={15} color={colors.danger} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* 8. Sub-Modal Chỉnh Sửa Thông Tin (Edit User Modal) */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={editingUser !== null}
        onRequestClose={() => setEditingUser(null)}
      >
        <View style={styles.subModalOverlay}>
          <View style={[styles.subModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>✏️ Chỉnh sửa tài khoản</Text>
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4 }}>
                  Thay đổi chi tiết thông tin định danh của người dùng
                </Text>
              </View>
              <TouchableOpacity onPress={() => setEditingUser(null)}>
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.formContainer}>
              <Text style={styles.label}>Họ và tên *</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                value={editName}
                onChangeText={setEditName}
              />

              <Text style={styles.label}>Địa chỉ Email *</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                keyboardType="email-address"
                autoCapitalize="none"
                value={editEmail}
                onChangeText={setEditEmail}
                disabled={editingUser?.id === 1} // Không cho đổi email Super Admin
                style={[
                  styles.input, 
                  { 
                    borderColor: colors.border, 
                    color: colors.text, 
                    backgroundColor: editingUser?.id === 1 ? colors.background : colors.card,
                    opacity: editingUser?.id === 1 ? 0.6 : 1
                  }
                ]}
              />

              <Text style={styles.label}>Quyền tài khoản</Text>
              <View style={styles.roleSelector}>
                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    editRole === 'user'
                      ? { backgroundColor: colors.tint, borderColor: colors.tint }
                      : { borderColor: colors.border }
                  ]}
                  onPress={() => {
                    if (editingUser?.id === 1) return;
                    setEditRole('user');
                  }}
                  disabled={editingUser?.id === 1}
                  style={[
                    styles.roleOption,
                    editRole === 'user' ? { backgroundColor: colors.tint, borderColor: colors.tint } : { borderColor: colors.border },
                    { opacity: editingUser?.id === 1 ? 0.5 : 1 }
                  ]}
                >
                  <Text style={{ color: editRole === 'user' ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>
                    USER (Nhân viên)
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    editRole === 'admin'
                      ? { backgroundColor: colors.tint, borderColor: colors.tint }
                      : { borderColor: colors.border }
                  ]}
                  onPress={() => setEditRole('admin')}
                >
                  <Text style={{ color: editRole === 'admin' ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>
                    ADMIN (Quản trị viên)
                  </Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Trạng thái tài khoản</Text>
              <View style={styles.roleSelector}>
                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    editStatus === 'active'
                      ? { backgroundColor: '#10b981', borderColor: '#10b981' }
                      : { borderColor: colors.border }
                  ]}
                  onPress={() => setEditStatus('active')}
                >
                  <Text style={{ color: editStatus === 'active' ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>
                    HOẠT ĐỘNG
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.roleOption,
                    editStatus === 'inactive'
                      ? { backgroundColor: colors.danger, borderColor: colors.danger }
                      : { borderColor: colors.border }
                  ]}
                  onPress={() => {
                    if (editingUser?.id === 1 || editingUser?.id === user?.id) {
                      Alert.alert('Lỗi', 'Không thể tự khóa tài khoản của mình hoặc Super Admin!');
                      return;
                    }
                    setEditStatus('inactive');
                  }}
                  style={[
                    styles.roleOption,
                    editStatus === 'inactive' ? { backgroundColor: colors.danger, borderColor: colors.danger } : { borderColor: colors.border },
                    { opacity: (editingUser?.id === 1 || editingUser?.id === user?.id) ? 0.5 : 1 }
                  ]}
                >
                  <Text style={{ color: editStatus === 'inactive' ? '#fff' : colors.text, fontWeight: '700', fontSize: 13 }}>
                    ĐÃ KHÓA
                  </Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.tint, marginTop: 24 }]}
                onPress={handleUpdateUserInfo}
                disabled={updatingUser}
              >
                {updatingUser ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Lưu thay đổi</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 9. Sub-Modal Đặt lại Mật Khẩu (Reset Password Modal) */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={resettingUser !== null}
        onRequestClose={() => setResettingUser(null)}
      >
        <View style={styles.subModalOverlay}>
          <View style={[styles.subModalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>🔑 Đặt lại mật khẩu</Text>
                <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 4 }}>
                  Đặt mật khẩu mới cho tài khoản: {resettingUser?.name}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setResettingUser(null)}>
                <Ionicons name="close" size={20} color={colors.text} />
              </TouchableOpacity>
            </View>

            <View style={styles.formContainer}>
              <Text style={styles.label}>Mật khẩu mới *</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                placeholder="Nhập mật khẩu mới (ít nhất 4 ký tự)"
                placeholderTextColor="#a0aec0"
                secureTextEntry
                autoCapitalize="none"
                value={newPassword}
                onChangeText={setNewPassword}
              />

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: '#eab308', marginTop: 24 }]}
                onPress={handleResetPassword}
                disabled={submittingPassword}
              >
                {submittingPassword ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Xác nhận đổi mật khẩu</Text>
                )}
              </TouchableOpacity>
            </View>
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
    flex: 1,
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
    maxHeight: '90%',
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
  // Search bar
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 20,
  },
  // User list item
  userListItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  userListLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  userListAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  userListName: {
    fontSize: 14,
    fontWeight: '700',
  },
  userRoleBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  userRoleBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  userStatusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  userStatusBadgeText: {
    fontSize: 9,
    fontWeight: '800',
  },
  userListActions: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 12,
  },
  miniBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Sub-modal (Edit/Reset)
  subModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  subModalContent: {
    width: '100%',
    maxWidth: 500,
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
});
