import { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  TouchableOpacity,
  Modal,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { API_BASE_URL, endpoints } from '@/constants/Config';
import { useConversationStore, GroupMember } from '../store/useConversationStore';
import { useSocket } from '../context/SocketContext';
import { useUser } from '../context/UserContext';
import * as ImagePicker from 'expo-image-picker';

interface User {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  status: 'active' | 'inactive';
}

interface GroupInfoModalProps {
  visible: boolean;
  onClose: () => void;
  conversationId: string;
  currentUser: {
    id: number;
    name: string;
    avatar: string | null;
    role: string;
  };
  colors: {
    background: string;
    card: string;
    text: string;
    textSecondary: string;
    border: string;
    tint: string;
  };
  position?: { x: number; y: number } | null;
}

export function GroupInfoModal({
  visible,
  onClose,
  conversationId,
  currentUser,
  colors,
  position,
}: GroupInfoModalProps) {
  const { socket } = useSocket();
  const { token } = useUser();
  const conversations = useConversationStore((state) => state.conversations);
  
  const activeThread = useMemo(() => {
    return conversations.find((c) => String(c.id) === conversationId) || null;
  }, [conversations, conversationId]);

  const members = useMemo(() => {
    return activeThread?.members || [];
  }, [activeThread]);

  const createdBy = useMemo(() => {
    return activeThread?.createdBy;
  }, [activeThread]);

  // Permission Logic
  const canManage = useMemo(() => {
    if (!activeThread) return false;
    return (
      Number(createdBy) === Number(currentUser.id) ||
      currentUser.role === 'admin'
    );
  }, [activeThread, createdBy, currentUser]);

  // States
  const [isRenaming, setIsRenaming] = useState(false);
  const [newGroupName, setNewGroupName] = useState(activeThread?.name || '');

  // Group Avatar & Fullscreen Viewer States
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);
  const [viewerImageUrl, setViewerImageUrl] = useState('');
  const [viewerTitle, setViewerTitle] = useState('');
  const [viewerIsGroup, setViewerIsGroup] = useState(false);

  const handleViewGroupAvatar = () => {
    if (!activeThread?.avatar) return;
    setViewerImageUrl(activeThread.avatar);
    setViewerTitle('Ảnh nhóm');
    setViewerIsGroup(true);
    setViewerVisible(true);
  };

  const handleViewMemberAvatar = (avatarUrl: string | null | undefined, name: string) => {
    const defaultAvatar = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80';
    setViewerImageUrl(avatarUrl || defaultAvatar);
    setViewerTitle(name);
    setViewerIsGroup(false);
    setViewerVisible(true);
  };

  const handlePickAndUploadGroupAvatar = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          'Quyền truy cập',
          'Bạn cần cấp quyền truy cập thư viện ảnh để thay đổi ảnh đại diện nhóm!'
        );
        return;
      }

      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const pickedAsset = pickerResult.assets[0];

      if (pickedAsset.fileSize && pickedAsset.fileSize > 5 * 1024 * 1024) {
        Alert.alert('Tệp quá lớn', 'Ảnh đại diện tối đa là 5MB. Vui lòng chọn ảnh khác!');
        return;
      }

      setUploadingAvatar(true);
      setUploadProgress(0);

      const formData = new FormData();
      let fileExt = 'jpg';
      if (pickedAsset.mimeType) {
        const mimeParts = pickedAsset.mimeType.split('/');
        if (mimeParts.length > 1) {
          const rawExt = mimeParts[1].toLowerCase();
          if (rawExt === 'jpeg' || rawExt === 'jpg') fileExt = 'jpg';
          else if (rawExt === 'png') fileExt = 'png';
          else if (rawExt === 'webp') fileExt = 'webp';
          else fileExt = rawExt;
        }
      } else if (pickedAsset.fileName) {
        const nameParts = pickedAsset.fileName.split('.');
        if (nameParts.length > 1) {
          fileExt = nameParts.pop()?.toLowerCase() || fileExt;
        }
      }

      const fileName = `group_${conversationId}_${Date.now()}.${fileExt}`;
      const fileType = pickedAsset.mimeType || 'image/jpeg';

      if (Platform.OS === 'web') {
        const response = await fetch(pickedAsset.uri);
        const blob = await response.blob();
        formData.append('file', blob, fileName);
      } else {
        formData.append('file', {
          uri: pickedAsset.uri,
          name: fileName,
          type: fileType,
        } as any);
      }

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE_URL}/conversations/${conversationId}/avatar`);
      
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          setUploadProgress(percentComplete);
        }
      };

      xhr.onload = () => {
        setUploadingAvatar(false);
        try {
          const response = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300 && response.status === 'success') {
            const uploadedUrl = response.avatar;
            useConversationStore.getState().updateConversationAvatar(conversationId, uploadedUrl);
            setViewerImageUrl(uploadedUrl);
            Alert.alert('Thành công', 'Đã cập nhật ảnh đại diện nhóm thành công!');
          } else {
            Alert.alert('Lỗi cập nhật', response.message || 'Không thể cập nhật ảnh nhóm.');
          }
        } catch (err) {
          console.error(err);
          Alert.alert('Lỗi phản hồi', 'Máy chủ trả về kết quả không hợp lệ.');
        }
      };

      xhr.onerror = () => {
        setUploadingAvatar(false);
        Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
      };

      xhr.send(formData);
    } catch (err: any) {
      setUploadingAvatar(false);
      console.error('Group avatar upload error:', err);
      Alert.alert('Lỗi', 'Không thể đổi ảnh đại diện nhóm.');
    }
  };

  // Add Member Modal States
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);

  // Update rename field when group opens
  useEffect(() => {
    if (activeThread?.name) {
      setNewGroupName(activeThread.name);
    }
  }, [activeThread?.name]);

  // Debounced search logic for Add Members Modal
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Fetch Users for Add Member selection
  const fetchAllUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch(endpoints.users);
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        // Filter out current members
        const existingMemberIds = members.map((m) => Number(m.user_id || m.id));
        const filtered = result.data.filter(
          (u: User) => !existingMemberIds.includes(Number(u.id))
        );
        setAllUsers(filtered);
      }
    } catch (error) {
      console.error('Lỗi khi tải danh sách người dùng:', error);
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleOpenAddMember = () => {
    setSelectedUserIds([]);
    setSearchQuery('');
    setAddModalVisible(true);
    fetchAllUsers();
  };

  // Filtered users list based on debounced search
  const filteredUsers = useMemo(() => {
    if (!debouncedSearchQuery.trim()) return allUsers;
    const query = debouncedSearchQuery.toLowerCase();
    return allUsers.filter(
      (u) =>
        u.name.toLowerCase().includes(query) ||
        u.email.toLowerCase().includes(query)
    );
  }, [allUsers, debouncedSearchQuery]);

  const handleToggleSelectUser = (userId: number) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  // Optimistic Add Members
  const handleBatchAddMembers = async () => {
    if (selectedUserIds.length === 0) {
      Alert.alert('Thông báo', 'Vui lòng chọn ít nhất một người dùng.');
      return;
    }

    if (!activeThread) return;

    // Save original state for rollback
    const originalConversation = { ...activeThread };
    
    // Create optimistic member objects
    const selectedUsersObjects = selectedUserIds.map((uId) => {
      const matched = allUsers.find((u) => u.id === uId);
      return {
        user_id: uId,
        id: uId,
        name: matched?.name || 'Nhân viên',
        avatar: matched?.avatar || undefined,
        role: matched?.role || 'user',
        email: matched?.email || undefined,
      };
    });

    // Apply Optimistic Update
    selectedUsersObjects.forEach((m) => {
      useConversationStore.getState().addMemberToGroup(conversationId, m);
    });

    setAddModalVisible(false);

    try {
      const response = await fetch(`${API_BASE_URL}/conversations/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: parseInt(conversationId),
          user_ids: selectedUserIds,
          requester_id: currentUser.id,
        }),
      });

      const result = await response.json();
      if (!response.ok || result.status !== 'success') {
        // Rollback
        useConversationStore.getState().replaceConversation(originalConversation);
        Alert.alert('Thất bại', result.message || 'Không thể thêm thành viên.');
      } else {
        Alert.alert('Thành công', `Đã thêm ${selectedUserIds.length} thành viên.`);
      }
    } catch (error) {
      // Rollback
      useConversationStore.getState().replaceConversation(originalConversation);
      console.error('Lỗi khi thêm thành viên:', error);
      Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
    }
  };

  // Optimistic Remove Member
  const handleRemoveMember = (targetMember: GroupMember) => {
    if (!activeThread) return;
    const targetUserId = targetMember.user_id || targetMember.id;
    if (!targetUserId) return;

    if (Number(targetUserId) === Number(createdBy)) {
      Alert.alert('Lỗi', 'Không thể xóa Trưởng nhóm khỏi cuộc trò chuyện.');
      return;
    }

    if (Number(targetUserId) === Number(currentUser.id)) {
      Alert.alert('Lỗi', 'Không thể tự xóa mình. Vui lòng chọn rời nhóm nếu muốn.');
      return;
    }

    Alert.alert(
      'Xác nhận xóa',
      `Bạn có chắc muốn xóa thành viên "${targetMember.name}" khỏi nhóm?`,
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            const originalConversation = { ...activeThread };

            // Apply Optimistic Update
            useConversationStore.getState().removeMemberFromGroup(conversationId, Number(targetUserId));

            try {
              const response = await fetch(`${API_BASE_URL}/conversations/members/remove`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  conversation_id: parseInt(conversationId),
                  user_id: targetUserId,
                  requester_id: currentUser.id,
                }),
              });

              const result = await response.json();
              if (!response.ok || result.status !== 'success') {
                // Rollback
                useConversationStore.getState().replaceConversation(originalConversation);
                Alert.alert('Thất bại', result.message || 'Không thể xóa thành viên.');
              }
            } catch (error) {
              // Rollback
              useConversationStore.getState().replaceConversation(originalConversation);
              console.error('Lỗi khi xóa thành viên:', error);
              Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
            }
          },
        },
      ]
    );
  };

  // Group Renaming
  const handleRenameGroup = async () => {
    if (!newGroupName.trim()) {
      Alert.alert('Lỗi', 'Tên nhóm không được để trống.');
      return;
    }

    if (newGroupName.trim() === activeThread?.name) {
      setIsRenaming(false);
      return;
    }

    if (!activeThread) return;
    const originalConversation = { ...activeThread };

    // Apply Optimistic Update
    useConversationStore.getState().updateGroupName(conversationId, newGroupName.trim());

    setIsRenaming(false);

    try {
      const response = await fetch(`${API_BASE_URL}/conversations/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: parseInt(conversationId),
          name: newGroupName.trim(),
          requester_id: currentUser.id,
        }),
      });

      const result = await response.json();
      if (!response.ok || result.status !== 'success') {
        // Rollback
        useConversationStore.getState().replaceConversation(originalConversation);
        Alert.alert('Thất bại', result.message || 'Không thể đổi tên nhóm.');
      }
    } catch (error) {
      // Rollback
      useConversationStore.getState().replaceConversation(originalConversation);
      console.error('Lỗi khi đổi tên nhóm:', error);
      Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
    }
  };

  // Leave Group Flow
  const handleLeaveGroup = () => {
    if (!activeThread) return;

    const isCreator = Number(createdBy) === Number(currentUser.id);
    if (isCreator && members.length === 1) {
      Alert.alert('Cảnh báo', 'Bạn là thành viên duy nhất trong nhóm. Bạn có thể xóa nhóm hoặc thêm thành viên khác trước khi rời đi.');
      return;
    }

    Alert.alert(
      'Rời khỏi nhóm',
      'Bạn có chắc chắn muốn rời khỏi nhóm trò chuyện này không?',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Rời nhóm',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await fetch(`${API_BASE_URL}/conversations/leave`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  conversation_id: parseInt(conversationId),
                  user_id: currentUser.id,
                }),
              });

              const result = await response.json();
              if (response.ok && result.status === 'success') {
                // 1. Leave Socket Room locally
                if (socket) {
                  socket.emit('leave_room', {
                    conversation_id: parseInt(conversationId),
                    user_id: currentUser.id,
                  });
                }
                
                // 2. Remove locally
                useConversationStore.getState().removeConversation(conversationId);
                
                // 3. Eject on frontend
                onClose();
                Alert.alert('Thành công', 'Bạn đã rời khỏi nhóm.');
              } else {
                Alert.alert('Thất bại', result.message || 'Không thể rời nhóm.');
              }
            } catch (error) {
              console.error('Lỗi khi rời nhóm:', error);
              Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
            }
          },
        },
      ]
    );
  };

  if (!activeThread) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <SafeAreaView style={[
        styles.modalOverlay, 
        { 
          backgroundColor: (Platform.OS === 'web' && position) ? 'transparent' : 'rgba(0, 0, 0, 0.5)',
          justifyContent: (Platform.OS === 'web' && position) ? 'flex-start' : 'flex-end'
        }
      ]}>
        {(Platform.OS === 'web' && position) && (
          <TouchableOpacity 
            style={StyleSheet.absoluteFill} 
            activeOpacity={1} 
            onPress={onClose} 
          />
        )}
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: (Platform.OS === 'web' && position) ? 'flex-start' : 'flex-end' }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[
            styles.modalContainer, 
            { backgroundColor: colors.background },
            (Platform.OS === 'web' && position) ? {
              position: 'absolute',
              top: Math.max(10, position.y + 8),
              left: Math.min(Dimensions.get('window').width - 340, Math.max(10, position.x - 300)),
              width: 320,
              maxHeight: 500,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
              elevation: 5,
            } : {}
          ]}>
            {/* Header */}
            <View style={[styles.header, { borderBottomColor: colors.border }]}>
              <Text style={[styles.headerTitle, { color: colors.text }]}>Chi tiết nhóm</Text>
              <TouchableOpacity style={styles.closeButton} onPress={onClose}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.scrollContent}>
              {/* Group Avatar and Editable Name */}
              <View style={styles.avatarSection}>
                <View style={styles.groupAvatarWrapper}>
                  <TouchableOpacity onPress={handleViewGroupAvatar} activeOpacity={0.8}>
                    <Image source={{ uri: activeThread.avatar }} style={styles.groupAvatar} />
                  </TouchableOpacity>
                  {canManage && (
                    <TouchableOpacity
                      style={[styles.cameraIconContainer, { backgroundColor: colors.tint }]}
                      onPress={handlePickAndUploadGroupAvatar}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="camera" size={16} color="#ffffff" />
                    </TouchableOpacity>
                  )}
                  {uploadingAvatar && (
                    <View style={styles.avatarProgressOverlay}>
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text style={styles.progressText}>{uploadProgress}%</Text>
                    </View>
                  )}
                </View>
                
                {isRenaming ? (
                  <View style={styles.renameWrapper}>
                    <TextInput
                      style={[styles.renameInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                      value={newGroupName}
                      onChangeText={setNewGroupName}
                      autoFocus
                      placeholder="Tên nhóm mới"
                    />
                    <TouchableOpacity style={[styles.renameSaveBtn, { backgroundColor: colors.tint }]} onPress={handleRenameGroup}>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.renameCancelBtn} onPress={() => { setIsRenaming(false); setNewGroupName(activeThread.name); }}>
                      <Ionicons name="close" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.nameWrapper}>
                    <Text style={[styles.groupNameText, { color: colors.text }]}>{activeThread.name}</Text>
                    {canManage && (
                      <TouchableOpacity onPress={() => setIsRenaming(true)} style={styles.editIconBtn}>
                        <Ionicons name="pencil-outline" size={16} color={colors.tint} />
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                
                <Text style={[styles.memberCountText, { color: colors.textSecondary }]}>
                  {members.length} thành viên
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.quickActions}>
                {canManage && (
                  <TouchableOpacity
                    style={[styles.actionButton, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={handleOpenAddMember}
                  >
                    <Ionicons name="person-add" size={18} color={colors.tint} />
                    <Text style={[styles.actionButtonText, { color: colors.text }]}>Thêm thành viên</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.actionButton, styles.leaveBtn, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}
                  onPress={handleLeaveGroup}
                >
                  <Ionicons name="log-out" size={18} color="#ef4444" />
                  <Text style={[styles.actionButtonText, { color: '#ef4444' }]}>Rời khỏi nhóm</Text>
                </TouchableOpacity>
              </View>

              {/* Member list section */}
              <View style={styles.membersSection}>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Danh sách thành viên</Text>
                
                {members.map((member) => {
                  const targetUserId = member.user_id || member.id;
                  const isMemberCreator = Number(targetUserId) === Number(createdBy);
                  const isMemberAdmin = member.role === 'admin';
                  const showRemoveButton = canManage && !isMemberCreator && Number(targetUserId) !== Number(currentUser.id);

                  return (
                    <View key={String(targetUserId)} style={[styles.memberRow, { borderBottomColor: colors.border }]}>
                      <TouchableOpacity onPress={() => handleViewMemberAvatar(member.avatar, member.name)} activeOpacity={0.8}>
                        <Image
                          source={{ uri: member.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }}
                          style={styles.memberAvatar}
                        />
                      </TouchableOpacity>
                      <View style={styles.memberInfo}>
                        <Text style={[styles.memberName, { color: colors.text }]}>
                          {member.name} {Number(targetUserId) === Number(currentUser.id) && '(Bạn)'}
                        </Text>
                        <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 1 }}>{member.email || ''}</Text>
                      </View>

                      {/* Role badges */}
                      <View style={styles.badgesWrapper}>
                        {isMemberCreator && (
                          <View style={[styles.badge, styles.creatorBadge]}>
                            <Text style={styles.creatorBadgeText}>TRƯỞNG NHÓM</Text>
                          </View>
                        )}
                        {isMemberAdmin && !isMemberCreator && (
                          <View style={[styles.badge, styles.adminBadge]}>
                            <Text style={styles.adminBadgeText}>ADMIN</Text>
                          </View>
                        )}
                      </View>

                      {/* Remove Button */}
                      {showRemoveButton && (
                        <TouchableOpacity
                          style={styles.removeBtn}
                          onPress={() => handleRemoveMember(member)}
                        >
                          <Ionicons name="trash-outline" size={18} color="#ef4444" />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* ================== MODAL THÊM THÀNH VIÊN ================== */}
      <Modal
        visible={addModalVisible}
        animationType="slide"
        onRequestClose={() => setAddModalVisible(false)}
      >
        <SafeAreaView style={[styles.addModalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.addModalHeader, { borderBottomColor: colors.border }]}>
            <TouchableOpacity onPress={() => setAddModalVisible(false)} style={styles.addModalBackBtn}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.addModalTitle, { color: colors.text }]}>Thêm thành viên</Text>
            <TouchableOpacity onPress={handleBatchAddMembers} style={[styles.addSubmitBtn, { backgroundColor: colors.tint }]}>
              <Text style={styles.addSubmitText}>Thêm ({selectedUserIds.length})</Text>
            </TouchableOpacity>
          </View>

          {/* Search bar */}
          <View style={[styles.searchSection, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <Ionicons name="search" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Tìm kiếm nhân viên..."
              placeholderTextColor={colors.textSecondary}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {!!searchQuery && (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>

          {loadingUsers ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : filteredUsers.length > 0 ? (
            <FlatList
              data={filteredUsers}
              keyExtractor={(item) => item.id.toString()}
              contentContainerStyle={styles.usersList}
              renderItem={({ item }) => {
                const isSelected = selectedUserIds.includes(item.id);
                return (
                  <TouchableOpacity
                    style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                    onPress={() => handleToggleSelectUser(item.id)}
                  >
                    <Image source={{ uri: item.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }} style={styles.userAvatar} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.userName, { color: colors.text }]}>{item.name}</Text>
                      <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>{item.email}</Text>
                    </View>
                    <Ionicons
                      name={isSelected ? "checkbox" : "square-outline"}
                      size={24}
                      color={isSelected ? colors.tint : colors.textSecondary}
                    />
                  </TouchableOpacity>
                );
              }}
            />
          ) : (
            <View style={styles.centered}>
              <Ionicons name="people-outline" size={48} color={colors.textSecondary} />
              <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }}>Không tìm thấy nhân viên nào phù hợp.</Text>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* Full Screen Image Viewer Modal */}
      <Modal
        visible={viewerVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setViewerVisible(false)}
      >
        <View style={styles.viewerContainer}>
          {/* Header Row */}
          <View style={styles.viewerHeader}>
            <TouchableOpacity
              style={styles.viewerCloseBtn}
              onPress={() => setViewerVisible(false)}
            >
              <Ionicons name="close" size={26} color="#ffffff" />
            </TouchableOpacity>
            <Text style={styles.viewerTitle}>{viewerTitle}</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Main Image View */}
          <View style={styles.viewerImageWrapper}>
            <Image
              source={{ uri: viewerImageUrl }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          </View>

          {/* Bottom Edit Action (Only for Group avatar and if manager/admin) */}
          {viewerIsGroup && canManage && !uploadingAvatar && (
            <TouchableOpacity
              style={[styles.viewerEditBtn, { backgroundColor: colors.tint }]}
              onPress={() => {
                setViewerVisible(false);
                setTimeout(() => {
                  handlePickAndUploadGroupAvatar();
                }, 300);
              }}
            >
              <Ionicons name="camera-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
              <Text style={styles.viewerEditText}>Thay đổi ảnh</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    zIndex: 999,
  },
  modalContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  closeButton: {
    padding: 4,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  groupAvatar: {
    width: 90,
    height: 90,
    borderRadius: 45,
    marginBottom: 12,
  },
  nameWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 30,
    justifyContent: 'center',
  },
  groupNameText: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  editIconBtn: {
    padding: 6,
    marginLeft: 6,
  },
  renameWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginTop: 6,
    width: '100%',
    justifyContent: 'center',
  },
  renameInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    maxWidth: 240,
  },
  renameSaveBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  renameCancelBtn: {
    padding: 8,
    marginLeft: 4,
  },
  memberCountText: {
    fontSize: 13,
    marginTop: 6,
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 20,
    marginBottom: 20,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  leaveBtn: {
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '700',
  },
  membersSection: {
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 10,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
  },
  memberInfo: {
    flex: 1,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '700',
  },
  badgesWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 4,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  creatorBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  creatorBadgeText: {
    color: '#d97706',
    fontSize: 9,
    fontWeight: '800',
  },
  adminBadge: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  adminBadgeText: {
    color: '#2563eb',
    fontSize: 9,
    fontWeight: '800',
  },
  removeBtn: {
    padding: 8,
    marginLeft: 6,
  },
  // Add member modal
  addModalContainer: {
    flex: 1,
  },
  addModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  addModalBackBtn: {
    padding: 4,
  },
  addModalTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  addSubmitBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addSubmitText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  searchSection: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchInput: {
    flex: 1,
    height: 36,
    fontSize: 14,
    padding: 0,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  usersList: {
    padding: 16,
    gap: 12,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  userName: {
    fontSize: 14,
    fontWeight: '700',
  },
  groupAvatarWrapper: {
    position: 'relative',
    width: 90,
    height: 90,
    marginBottom: 12,
  },
  cameraIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
  },
  avatarProgressOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 45,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 2,
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
    paddingVertical: Platform.OS === 'ios' ? 50 : 20,
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    width: '100%',
    zIndex: 10,
  },
  viewerCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  viewerImageWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    padding: 10,
  },
  viewerImage: {
    width: '100%',
    height: '100%',
    maxHeight: 600,
  },
  viewerEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  viewerEditText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
