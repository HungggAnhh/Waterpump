// frontend/app/(tabs)/messages.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  Image,
  Modal,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TextInput,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { API_BASE_URL, endpoints } from '@/constants/Config';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUser } from '../../context/UserContext';
import { useConversationStore, ChatThread } from '../../store/useConversationStore';
import { useNotifications } from '../../context/NotificationContext';
import { useOnlineStore } from '../../store/useOnlineStore';
import { RelativeTime } from '../../components/RelativeTime';
import { useShallow } from 'zustand/shallow';

interface User {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  status: 'active' | 'inactive';
}

interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name: string;
  sender_avatar: string | null;
  message: string;
  type: 'text' | 'image' | 'file';
  file_url: string | null;
  created_at: string;
}

const isDefaultAvatar = (url: string | null | undefined): boolean => {
  if (!url) return true;
  return url.includes('unsplash.com');
};

const ConversationItem = React.memo(({ 
  item, 
  colors, 
  currentUser, 
  onPress, 
  onLongPress,
  onAvatarPress
}: { 
  item: ChatThread; 
  colors: any; 
  currentUser: any; 
  onPress: (item: ChatThread) => void; 
  onLongPress: (item: ChatThread) => void; 
  onAvatarPress: (item: ChatThread) => void;
}) => {
  // Subscribe specifically to this user's online status
  const isOnline = useOnlineStore(state => 
    item.type === 'direct' && item.otherUser 
      ? !!state.onlineUsers[item.otherUser.user_id] 
      : false
  );

  const displayAvatar = item.avatar || (item.type === 'group'
    ? 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?auto=format&fit=crop&w=150&h=150&q=80'
    : 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80');

  const hasAvatar = item.avatar && !isDefaultAvatar(item.avatar);

  return (
    <TouchableOpacity
      style={[styles.threadCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => onPress(item)}
      onLongPress={() => onLongPress(item)}
      delayLongPress={500}
    >
      <View style={styles.avatarWrapper}>
        {hasAvatar ? (
          <TouchableOpacity onPress={() => onAvatarPress(item)} activeOpacity={0.85}>
            <Image source={{ uri: displayAvatar }} style={styles.threadAvatar} />
          </TouchableOpacity>
        ) : (
          <Image source={{ uri: displayAvatar }} style={styles.threadAvatar} />
        )}
        {isOnline && (
          <View style={[styles.onlineIndicator, { borderColor: colors.card }]} />
        )}
      </View>

      <View style={styles.threadInfo}>
        <View style={styles.threadHeader}>
          <Text style={[
            styles.threadName, 
            { 
              color: colors.text,
              fontWeight: (item.unreadCount || 0) > 0 ? '800' : '500'
            }
          ]} numberOfLines={1}>
            {item.name}
          </Text>
          <RelativeTime
            rawTime={item.rawTime}
            style={[
              styles.threadTime,
              {
                color: (item.unreadCount || 0) > 0 ? colors.tint : '#a0aec0',
                fontWeight: (item.unreadCount || 0) > 0 ? '700' : '400'
              }
            ]}
          />
        </View>
        <View style={styles.threadBody}>
          <Text style={[
            styles.lastMsg,
            {
              color: (item.unreadCount || 0) > 0 && item.lastMessageSenderId !== currentUser.id
                ? colors.text
                : colors.textSecondary,
              fontWeight: (item.unreadCount || 0) > 0 && item.lastMessageSenderId !== currentUser.id
                ? '800'
                : '400',
            }
          ]} numberOfLines={1}>
            {item.lastMessage || 'Chưa có tin nhắn nào.'}
          </Text>
          {(item.unreadCount || 0) > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: colors.tint }]}>
              <Text style={styles.unreadText}>{item.unreadCount}</Text>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
});

// Full Screen Zoomable Avatar Preview Modal
interface AvatarPreviewModalProps {
  visible: boolean;
  imageUrl: string | null;
  title: string;
  onClose: () => void;
  colors: any;
}

const AvatarPreviewModal = ({ visible, imageUrl, title, onClose, colors }: AvatarPreviewModalProps) => {
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (visible) {
      setScale(1);
      setTranslateX(0);
      setTranslateY(0);
      setIsDragging(false);
    }
  }, [visible]);

  const lastTouchTimeRef = React.useRef(0);
  const initialTouchDistanceRef = React.useRef(0);
  const initialScaleRef = React.useRef(1);
  const touchStartRef = React.useRef({ x: 0, y: 0 });
  const touchStartPosRef = React.useRef({ x: 0, y: 0 });
  const touchStartTimeRef = React.useRef(0);

  if (!visible || !imageUrl) return null;

  const getDistance = (touches: any[]) => {
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const isTouchOnImage = (x: number, y: number) => {
    const { width: W, height: H } = Dimensions.get('window');
    const imageHeight = Math.min(H * 0.7, 500);
    const imageWidth = W * 0.9;
    
    const left = (W - imageWidth) / 2;
    const right = (W + imageWidth) / 2;
    const top = (H - imageHeight) / 2;
    const bottom = (H + imageHeight) / 2;
    
    return x >= left && x <= right && y >= top && y <= bottom;
  };

  const handleWheel = (e: any) => {
    if (Platform.OS === 'web') {
      const zoomSpeed = 0.15;
      const direction = e.deltaY < 0 ? 1 : -1;
      const newScale = Math.min(5, Math.max(1, scale + direction * zoomSpeed));
      setScale(newScale);
      if (newScale === 1) {
        setTranslateX(0);
        setTranslateY(0);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (Platform.OS === 'web' && scale > 1) {
      setIsDragging(true);
      touchStartRef.current = { x: e.clientX - translateX, y: e.clientY - translateY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (Platform.OS === 'web' && isDragging && scale > 1) {
      setTranslateX(e.clientX - touchStartRef.current.x);
      setTranslateY(e.clientY - touchStartRef.current.y);
    }
  };

  const handleMouseUp = () => {
    if (Platform.OS === 'web') {
      setIsDragging(false);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    if (Platform.OS === 'web' && e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleTouchStart = (e: any) => {
    const touches = e.nativeEvent.touches || [];
    if (touches.length === 1) {
      const pageX = touches[0].pageX;
      const pageY = touches[0].pageY;
      touchStartPosRef.current = { x: pageX, y: pageY };
      touchStartTimeRef.current = Date.now();

      const now = Date.now();
      if (now - lastTouchTimeRef.current < 300) {
        if (isTouchOnImage(pageX, pageY)) {
          const newScale = scale > 1 ? 1 : 2.5;
          setScale(newScale);
          setTranslateX(0);
          setTranslateY(0);
        }
      } else {
        setIsDragging(true);
        touchStartRef.current = { 
          x: pageX - translateX, 
          y: pageY - translateY 
        };
      }
      lastTouchTimeRef.current = now;
    } else if (touches.length === 2) {
      setIsDragging(false);
      initialTouchDistanceRef.current = getDistance(touches);
      initialScaleRef.current = scale;
    }
  };

  const handleTouchMove = (e: any) => {
    const touches = e.nativeEvent.touches || [];
    if (touches.length === 1 && scale > 1 && isDragging) {
      setTranslateX(touches[0].pageX - touchStartRef.current.x);
      setTranslateY(touches[0].pageY - touchStartRef.current.y);
    } else if (touches.length === 2) {
      const currentDistance = getDistance(touches);
      const initialDistance = initialTouchDistanceRef.current;
      if (initialDistance > 0 && currentDistance > 0) {
        const ratio = currentDistance / initialDistance;
        const newScale = Math.min(5, Math.max(1, initialScaleRef.current * ratio));
        setScale(newScale);
        if (newScale === 1) {
          setTranslateX(0);
          setTranslateY(0);
        }
      }
    }
  };

  const handleTouchEnd = (e: any) => {
    setIsDragging(false);
    initialTouchDistanceRef.current = 0;

    const changedTouches = e.nativeEvent.changedTouches || [];
    if (changedTouches.length === 1 && scale === 1) {
      const endX = changedTouches[0].pageX;
      const endY = changedTouches[0].pageY;
      const startX = touchStartPosRef.current.x;
      const startY = touchStartPosRef.current.y;
      
      const dx = endX - startX;
      const dy = endY - startY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const duration = Date.now() - touchStartTimeRef.current;

      if (distance < 15 && duration < 250) {
        if (!isTouchOnImage(endX, endY)) {
          onClose();
        }
      }
    }
  };

  return (
    <Modal
      visible={visible}
      transparent={true}
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.previewOverlay}>
        <TouchableOpacity 
          style={StyleSheet.absoluteFill} 
          activeOpacity={1} 
          onPress={onClose} 
        />

        <TouchableOpacity style={styles.previewCloseBtn} onPress={onClose} activeOpacity={0.7}>
          <Ionicons name="close" size={28} color="#ffffff" />
        </TouchableOpacity>

        <View 
          style={styles.previewImageContainer}
          {...(Platform.OS === 'web' ? {
            onWheel: handleWheel,
            onMouseDown: handleMouseDown,
            onMouseMove: handleMouseMove,
            onMouseUp: handleMouseUp,
            onMouseLeave: handleMouseUp,
            onClick: handleContainerClick
          } as any : {
            onTouchStart: handleTouchStart,
            onTouchMove: handleTouchMove,
            onTouchEnd: handleTouchEnd
          })}
        >
          <Image
            source={{ uri: imageUrl }}
            style={[
              styles.previewImage,
              {
                transform: [
                  { scale },
                  { translateX },
                  { translateY }
                ] as any
              }
            ]}
            resizeMode="contain"
          />
        </View>

        {scale === 1 && (
          <View style={styles.previewFooter}>
            <Text style={styles.previewFooterText}>{title}</Text>
          </View>
        )}
      </View>
    </Modal>
  );
};

export default function MessagesScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useUser();
  const { unreadCount, openDrawer } = useNotifications();

  const currentUser = user || {
    id: 1,
    name: 'Admin',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80',
    role: 'admin'
  };

  const threads = useConversationStore(useShallow(state => state.conversations));
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [selectedThreadForMenu, setSelectedThreadForMenu] = useState<ChatThread | null>(null);
  const [threadMenuVisible, setThreadMenuVisible] = useState(false);

  // Avatar Preview Modal States
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null);
  const [previewTitle, setPreviewTitle] = useState('');

  // Modal chọn user bắt đầu chat
  const [newChatModalVisible, setNewChatModalVisible] = useState(false);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // Group creation states (only for Admin)
  const [createGroupModalVisible, setCreateGroupModalVisible] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [loadingGroupUsers, setLoadingGroupUsers] = useState(false);
  const [groupUsersList, setGroupUsersList] = useState<User[]>([]);

  // 1. Tải danh sách các cuộc hội thoại từ API
  const fetchConversations = async (silent = false) => {
    if (!silent) setLoadingThreads(true);
    try {
      const response = await fetch(`${API_BASE_URL}/conversations?user_id=${currentUser.id}`);
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        useConversationStore.getState().setConversations(result.data);
      }
    } catch (error) {
      console.error("Lỗi khi tải danh sách hội thoại:", error);
    } finally {
      if (!silent) setLoadingThreads(false);
    }
  };

  // 2. Tải danh sách hội thoại ban đầu khi mount hoặc khi ID người dùng thay đổi
  useEffect(() => {
    fetchConversations();
  }, [currentUser.id]);

  // Custom Actions for Thread long press menu
  const handlePinThread = (thread: ChatThread) => {
    Alert.alert('Ghim cuộc trò chuyện', `Đã ghim cuộc trò chuyện với "${thread.name}" lên đầu.`);
  };

  const handleMuteThread = (thread: ChatThread) => {
    Alert.alert('Tắt thông báo', `Đã tắt thông báo cho cuộc trò chuyện với "${thread.name}".`);
  };

  // Long press -> Xóa cuộc trò chuyện
  const handleConfirmDeleteThread = (thread: ChatThread) => {
    Alert.alert(
      'Xóa cuộc trò chuyện',
      'Bạn có chắc muốn xóa cuộc trò chuyện này khỏi hộp thư của mình không?',
      [
        { text: 'Hủy', style: 'cancel' },
        {
          text: 'Xóa',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await fetch(`${API_BASE_URL}/conversations/${thread.id}?user_id=${currentUser.id}`, {
                method: 'DELETE'
              });
              const result = await response.json();
              if (response.ok && (result.success || result.status === 'success')) {
                useConversationStore.getState().deleteConversation(thread.id);
              } else {
                Alert.alert('Thất bại', result.message || 'Không thể xóa cuộc trò chuyện.');
              }
            } catch (error) {
              console.error("Lỗi khi xóa cuộc trò chuyện:", error);
              Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
            }
          }
        }
      ]
    );
  };

  // Click vào cuộc hội thoại -> Điều hướng ra chat chi tiết (Sử dụng useCallback)
  const handleSelectThread = useCallback((thread: ChatThread) => {
    router.push(`/chat/${thread.id}` as any);
  }, [router]);

  // Nhấn giữ cuộc hội thoại -> Hiển thị menu hành động (Sử dụng useCallback)
  const handleLongPressThread = useCallback((thread: ChatThread) => {
    setSelectedThreadForMenu(thread);
    setThreadMenuVisible(true);
  }, []);

  // Mở danh sách User mới để Chat
  const handleOpenNewChat = async () => {
    setNewChatModalVisible(true);
    setLoadingUsers(true);
    try {
      const response = await fetch(endpoints.users);
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        const filtered = result.data.filter((u: User) => u.id !== currentUser.id);
        setUsersList(filtered);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingUsers(false);
    }
  };

  // Chọn một nhân viên để tạo hoặc truy cập cuộc hội thoại
  const handleStartChatWithUser = async (targetUser: User) => {
    setNewChatModalVisible(false);
    try {
      const response = await fetch(`${API_BASE_URL}/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          recipient_id: targetUser.id
        })
      });
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        // Điều hướng ra phòng chat ngay lập tức
        router.push(`/chat/${result.conversation_id}` as any);
      } else {
        Alert.alert('Lỗi', 'Không thể khởi tạo cuộc hội thoại.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
    }
  };

  // Mở danh sách tạo nhóm mới (Chỉ dành cho Admin)
  const handleOpenCreateGroup = async () => {
    setNewGroupName('');
    setSelectedUserIds([]);
    setGroupSearchQuery('');
    setCreateGroupModalVisible(true);
    setLoadingGroupUsers(true);
    try {
      const response = await fetch(endpoints.users);
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        const filtered = result.data.filter((u: User) => u.id !== currentUser.id);
        setGroupUsersList(filtered);
      }
    } catch (error) {
      console.error(error);
    } finally {
      setLoadingGroupUsers(false);
    }
  };

  const handleToggleSelectGroupUser = (userId: number) => {
    setSelectedUserIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleCreateGroupSubmit = async () => {
    if (!newGroupName.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập tên nhóm.');
      return;
    }
    if (selectedUserIds.length === 0) {
      Alert.alert('Lỗi', 'Vui lòng chọn ít nhất một thành viên.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/conversations/group`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newGroupName.trim(),
          user_ids: selectedUserIds,
          creator_id: currentUser.id
        })
      });

      const contentType = response.headers.get('content-type');
      if (response.ok && contentType && contentType.includes('application/json')) {
        const result = await response.json();
        if (result.status === 'success') {
          setCreateGroupModalVisible(false);
          // Điều hướng ra phòng chat nhóm vừa tạo
          router.push(`/chat/${result.conversation_id}` as any);
        } else {
          Alert.alert('Lỗi', result.message || 'Không thể tạo nhóm.');
        }
      } else {
        const text = await response.text();
        console.warn('Backend Non-JSON response:', text);
        Alert.alert(
          'Lỗi kết nối Backend',
          `Yêu cầu thất bại (HTTP ${response.status}). Có thể bạn chưa commit & push mã nguồn backend mới lên Git để Render tự động cập nhật deploy. Hoặc hãy đổi API_BASE_URL trong Config.ts sang Local để chạy thử nghiệm.`
        );
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
    }
  };

  const handleAvatarPress = useCallback((thread: ChatThread) => {
    setPreviewImageUrl(thread.avatar);
    setPreviewTitle(thread.name);
    setPreviewVisible(true);
  }, []);

  const renderThreadItem = useCallback(({ item }: { item: ChatThread }) => (
    <ConversationItem
      item={item}
      colors={colors}
      currentUser={currentUser}
      onPress={handleSelectThread}
      onLongPress={handleLongPressThread}
      onAvatarPress={handleAvatarPress}
    />
  ), [colors, currentUser, handleSelectThread, handleLongPressThread, handleAvatarPress]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={styles.inboxHeader}>
        <Text style={[styles.inboxTitle, { color: colors.text }]}>Hộp thư của bạn</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <TouchableOpacity onPress={openDrawer} style={{ position: 'relative', padding: 6 }} activeOpacity={0.7}>
            <Ionicons name="notifications-outline" size={24} color={colors.text} />
            {unreadCount > 0 && (
              <View style={{
                position: 'absolute',
                top: 2,
                right: 2,
                backgroundColor: '#ef4444',
                borderRadius: 8,
                minWidth: 16,
                height: 16,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 4,
              }}>
                <Text style={{ color: '#ffffff', fontSize: 9, fontWeight: '800' }}>{unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>
          {currentUser.role === 'admin' && (
            <TouchableOpacity style={styles.newChatBtn} onPress={handleOpenCreateGroup}>
              <Ionicons name="people-circle-outline" size={24} color={colors.tint} />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.newChatBtn} onPress={handleOpenNewChat}>
            <Ionicons name="create-outline" size={22} color={colors.tint} />
          </TouchableOpacity>
        </View>
      </View>

      {loadingThreads ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : threads.length > 0 ? (
        <FlatList
          data={threads}
          keyExtractor={(item) => item.id}
          renderItem={renderThreadItem}
          contentContainerStyle={styles.threadsList}
        />
      ) : (
        <View style={styles.centered}>
          <Text style={{ fontSize: 40, marginBottom: 8 }}>📭</Text>
          <Text style={{ color: colors.textSecondary, marginBottom: 16, fontSize: 14, fontWeight: '700' }}>
            Chưa có cuộc trò chuyện nào
          </Text>
          <TouchableOpacity 
            style={{ 
              paddingVertical: 10, 
              paddingHorizontal: 20, 
              borderRadius: 20, 
              backgroundColor: colors.tint 
            }}
            onPress={handleOpenNewChat}
            activeOpacity={0.8}
          >
            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>
              Bắt đầu trò chuyện
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ================== MODAL CHỌN USER BẮT ĐẦU CHAT ================== */}
      <Modal
        visible={newChatModalVisible}
        animationType="slide"
        onRequestClose={() => setNewChatModalVisible(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Tin nhắn mới</Text>
            <TouchableOpacity onPress={() => setNewChatModalVisible(false)}>
              <Ionicons name="close" size={24} color={colors.text} />
            </TouchableOpacity>
          </View>

          {loadingUsers ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color={colors.tint} />
            </View>
          ) : (
            <FlatList
              data={usersList}
              keyExtractor={(item) => item.id.toString()}
              contentContainerStyle={{ padding: 16, gap: 12 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => handleStartChatWithUser(item)}
                >
                  <Image source={{ uri: item.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }} style={styles.userAvatar} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.userName, { color: colors.text }]}>{item.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>{item.role === 'admin' ? 'Quản trị viên' : 'Nhân viên'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color="#c2c6d6" />
                </TouchableOpacity>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>

      {/* ================== MODAL TẠO NHÓM MỚI (CHỈ DÀNH CHO ADMIN) ================== */}
      <Modal
        visible={createGroupModalVisible}
        animationType="slide"
        onRequestClose={() => setCreateGroupModalVisible(false)}
      >
        <SafeAreaView style={[styles.modalContainer, { backgroundColor: colors.background }]}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
              <TouchableOpacity onPress={() => setCreateGroupModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Tạo nhóm trò chuyện</Text>
              <TouchableOpacity
                onPress={handleCreateGroupSubmit}
                style={[styles.addSubmitBtn, { backgroundColor: colors.tint }]}
              >
                <Text style={styles.addSubmitText}>Tạo ({selectedUserIds.length})</Text>
              </TouchableOpacity>
            </View>

            {/* Group Name Input */}
            <View style={{ padding: 16 }}>
              <Text style={{ fontSize: 11, fontWeight: '800', color: colors.textSecondary, marginBottom: 8 }}>TÊN NHÓM</Text>
              <TextInput
                style={[styles.groupNameInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                placeholder="Nhập tên nhóm trò chuyện..."
                placeholderTextColor={colors.textSecondary}
                value={newGroupName}
                onChangeText={setNewGroupName}
                onSubmitEditing={handleCreateGroupSubmit}
              />
            </View>

            {/* Search members */}
            <View style={[styles.searchSection, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              <Ionicons name="search" size={18} color={colors.textSecondary} style={{ marginRight: 8 }} />
              <TextInput
                style={[styles.searchInput, { color: colors.text }]}
                placeholder="Tìm thành viên để thêm..."
                placeholderTextColor={colors.textSecondary}
                value={groupSearchQuery}
                onChangeText={setGroupSearchQuery}
              />
              {!!groupSearchQuery && (
                <TouchableOpacity onPress={() => setGroupSearchQuery('')}>
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )}
            </View>

            {loadingGroupUsers ? (
              <View style={styles.centered}>
                <ActivityIndicator size="large" color={colors.tint} />
              </View>
            ) : groupUsersList.filter(
                (u) =>
                  u.name.toLowerCase().includes(groupSearchQuery.toLowerCase()) ||
                  u.email.toLowerCase().includes(groupSearchQuery.toLowerCase())
              ).length > 0 ? (
              <FlatList
                data={groupUsersList.filter(
                  (u) =>
                    u.name.toLowerCase().includes(groupSearchQuery.toLowerCase()) ||
                    u.email.toLowerCase().includes(groupSearchQuery.toLowerCase())
                )}
                keyExtractor={(item) => item.id.toString()}
                contentContainerStyle={{ padding: 16, gap: 12 }}
                renderItem={({ item }) => {
                  const isSelected = selectedUserIds.includes(item.id);
                  return (
                    <TouchableOpacity
                      style={[styles.userCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                      onPress={() => handleToggleSelectGroupUser(item.id)}
                    >
                      <Image
                        source={{ uri: item.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }}
                        style={styles.userAvatar}
                      />
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
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ================== BOTTOM SHEET MENU CUỘC TRÒ CHUYỆN ================== */}
      <Modal
        visible={threadMenuVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setThreadMenuVisible(false)}
      >
        <TouchableOpacity 
          style={styles.sheetBackdrop} 
          activeOpacity={1} 
          onPress={() => setThreadMenuVisible(false)}
        >
          <View style={[styles.sheetContent, { backgroundColor: colors.card }]}>
            {/* Drag Handle Indicator */}
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

            {selectedThreadForMenu && (
              <View style={styles.sheetHeader}>
                <Image source={{ uri: selectedThreadForMenu.avatar }} style={styles.sheetAvatar} />
                <Text style={[styles.sheetTitle, { color: colors.text }]} numberOfLines={1}>
                  {selectedThreadForMenu.name}
                </Text>
              </View>
            )}

            <View style={[styles.sheetDivider, { backgroundColor: colors.border }]} />

            {/* Ghim Cuộc trò chuyện */}
            <TouchableOpacity 
              style={styles.sheetOption} 
              onPress={() => {
                setThreadMenuVisible(false);
                if (selectedThreadForMenu) handlePinThread(selectedThreadForMenu);
              }}
            >
              <View style={[styles.sheetIconWrapper, { backgroundColor: 'rgba(59, 130, 246, 0.1)' }]}>
                <Ionicons name="pin" size={20} color="#3b82f6" />
              </View>
              <Text style={[styles.sheetOptionText, { color: colors.text }]}>📌 Ghim cuộc trò chuyện</Text>
            </TouchableOpacity>

            {/* Tắt Thông báo */}
            <TouchableOpacity 
              style={styles.sheetOption} 
              onPress={() => {
                setThreadMenuVisible(false);
                if (selectedThreadForMenu) handleMuteThread(selectedThreadForMenu);
              }}
            >
              <View style={[styles.sheetIconWrapper, { backgroundColor: 'rgba(245, 158, 11, 0.1)' }]}>
                <Ionicons name="notifications-off" size={20} color="#f59e0b" />
              </View>
              <Text style={[styles.sheetOptionText, { color: colors.text }]}>🔕 Tắt thông báo</Text>
            </TouchableOpacity>

            {/* Xóa Cuộc trò chuyện */}
            <TouchableOpacity 
              style={[styles.sheetOption, styles.sheetOptionDelete]} 
              onPress={() => {
                setThreadMenuVisible(false);
                if (selectedThreadForMenu) handleConfirmDeleteThread(selectedThreadForMenu);
              }}
            >
              <View style={[styles.sheetIconWrapper, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
                <Ionicons name="trash" size={20} color="#ef4444" />
              </View>
              <Text style={[styles.sheetOptionText, { color: '#ef4444', fontWeight: '700' }]}>🗑️ Xóa cuộc trò chuyện</Text>
            </TouchableOpacity>

            {/* Nút Hủy */}
            <TouchableOpacity 
              style={[styles.sheetCancelBtn, { borderColor: colors.border }]} 
              onPress={() => setThreadMenuVisible(false)}
            >
              <Text style={[styles.sheetCancelText, { color: colors.textSecondary }]}>Hủy</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      <AvatarPreviewModal
        visible={previewVisible}
        imageUrl={previewImageUrl}
        title={previewTitle}
        onClose={() => setPreviewVisible(false)}
        colors={colors}
      />
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
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  inboxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
  },
  inboxTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  newChatBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  threadsList: {
    paddingHorizontal: 16,
    gap: 12,
  },
  threadCard: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 4,
    elevation: 1,
  },
  avatarWrapper: {
    position: 'relative',
    marginRight: 14,
  },
  threadAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  onlineIndicator: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#10b981',
    borderWidth: 2,
  },
  threadInfo: {
    flex: 1,
  },
  threadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  threadName: {
    fontSize: 15,
    fontWeight: '700',
  },
  threadTime: {
    fontSize: 11,
    color: '#a0aec0',
  },
  threadBody: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lastMsg: {
    fontSize: 13,
    flex: 1,
    paddingRight: 10,
  },
  unreadBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    marginLeft: 8,
  },
  unreadText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  // Modal styles
  modalContainer: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
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
  groupNameInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14,
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
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'flex-end',
  },
  sheetContent: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    maxHeight: '60%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 20,
  },
  sheetHandle: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
    alignSelf: 'center',
    marginBottom: 16,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  sheetAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    flex: 1,
  },
  sheetDivider: {
    height: 1,
    marginBottom: 16,
  },
  sheetOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 14,
  },
  sheetOptionDelete: {
    marginTop: 4,
  },
  sheetIconWrapper: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sheetOptionText: {
    fontSize: 15,
    fontWeight: '500',
  },
  sheetCancelBtn: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCancelText: {
    fontSize: 14,
    fontWeight: '600',
  },
  previewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  previewCloseBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 30,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1010,
  },
  previewImageContainer: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '90%',
    height: '70%',
    maxHeight: 500,
  },
  previewFooter: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 60 : 40,
    width: '100%',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  previewFooterText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
});
