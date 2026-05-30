// frontend/app/chat/[id].tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  ActivityIndicator,
  Alert,
  Keyboard,
  LayoutAnimation,
  UIManager,
  AppState,
  AppStateStatus,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { API_BASE_URL } from '@/constants/Config';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { MessageItem } from '../../components/MessageItem';
import * as ImagePicker from 'expo-image-picker';
import { EmojiPanel } from '../../components/EmojiPanel';
import { ScreenshotPreviewModal } from '../../components/ScreenshotPreviewModal';
import { useConversationStore } from '../../store/useConversationStore';
import { GroupInfoModal } from '../../components/GroupInfoModal';
import { useIsFocused } from '@react-navigation/native';

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
  raw_time?: string;
}

export default function ChatRoomScreen() {
  const { id } = useLocalSearchParams();
  const conversationId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { socket } = useSocket();

  const currentUser = user || {
    id: 1,
    name: 'Admin',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80',
    role: 'admin'
  };

  const conversations = useConversationStore(state => state.conversations);
  const activeThread = useMemo(() => {
    return conversations.find(c => String(c.id) === conversationId) || null;
  }, [conversations, conversationId]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);

  // Nhập tin nhắn & Typing
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [otherUserTyping, setOtherUserTyping] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Xem ảnh phóng to
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);

  // Emoji panel
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);

  // Screenshot share
  const [screenshotModalVisible, setScreenshotModalVisible] = useState(false);
  const [capturedImagePath, setCapturedImagePath] = useState<string | null>(null);
  const [infoModalVisible, setInfoModalVisible] = useState(false);

  // Mentions (@tag)
  const [showTagList, setShowTagList] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState('');

  const filteredMembersForTag = useMemo(() => {
    if (!activeThread?.members) return [];
    // Loại trừ bản thân người dùng khỏi danh sách tag để đỡ rối
    const allMembers = activeThread.members.filter(m => (m.user_id || m.id) !== currentUser.id);
    if (!tagSearchQuery.trim()) return allMembers;
    return allMembers.filter(m => 
      m.name.toLowerCase().includes(tagSearchQuery.toLowerCase())
    );
  }, [activeThread?.members, tagSearchQuery, currentUser.id]);

  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const typingTimeoutRef = useRef<any>(null);

  // Production-grade seen-message flow refs
  const lastSeenMessageIdRef = useRef<number | null>(null);

  const isFocused = useIsFocused();
  const isScreenFocusedRef = useRef(isFocused);
  const [appState, setAppState] = useState(AppState.currentState);
  const appStateRef = useRef(appState);

  // LayoutAnimation cho Android
  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  // Sync refs
  useEffect(() => {
    isScreenFocusedRef.current = isFocused;
  }, [isFocused]);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      setAppState(nextAppState);
    });
    return () => subscription.remove();
  }, []);

  // Keyboard listener để ẩn emoji panel khi bàn phím mở
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const showSub = Keyboard.addListener(showEvent, () => {
      if (showEmojiPanel) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setShowEmojiPanel(false);
      }
    });

    return () => showSub.remove();
  }, [showEmojiPanel]);

  // Tự động cuộn xuống cuối (tức offset = 0 trong FlatList inverted) khi bàn phím mở
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const showSub = Keyboard.addListener(showEvent, () => {
      flatListRef.current?.scrollToOffset({
        offset: 0,
        animated: true,
      });
    });

    return () => showSub.remove();
  }, []);

  // Hook tự động tải lại danh sách hội thoại nếu chưa có trong Zustand store
  useEffect(() => {
    if (!activeThread && conversationId && currentUser.id) {
      const fetchThreadInfo = async () => {
        try {
          const response = await fetch(`${API_BASE_URL}/conversations?user_id=${currentUser.id}`);
          const result = await response.json();
          if (response.ok && result.status === 'success') {
            useConversationStore.getState().setConversations(result.data);
          }
        } catch (error) {
          console.error("Lỗi khi tải thông tin hội thoại:", error);
        }
      };
      fetchThreadInfo();
    }
  }, [activeThread, conversationId, currentUser.id]);

  // Khởi tạo và đăng ký sự kiện Socket.IO dùng chung
  useEffect(() => {
    if (!socket || !conversationId) return;

    console.log(`🔌 [CHAT_ROOM] Joining room: room_${conversationId}`);
    socket.emit('join_room', {
      conversation_id: parseInt(conversationId),
      user_id: currentUser.id
    });

    // Nhận tin nhắn realtime
    const handleReceiveMessage = (msg: Message) => {
      if (String(msg.conversation_id) !== conversationId) return;

      console.log('📨 [CHAT_ROOM] Nhận tin nhắn realtime:', msg);
      
      setMessages((prev) => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [msg, ...prev];
      });

      // Tự động cuộn xuống
      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 100);
    };

    // Chỉ báo đang gõ
    const handleUserTyping = (data: { conversation_id: string, userId: number, userName: string, isTyping: boolean }) => {
      if (String(data.conversation_id) === conversationId && data.userId !== currentUser.id) {
        setOtherUserTyping(data.isTyping ? data.userName : null);
      }
    };

    const handleEjection = () => {
      console.log('🚪 [CHAT_ROOM] Kicked from room, executing safe ejection');
      // 1. leave socket room
      socket.emit('leave_room', {
        conversation_id: parseInt(conversationId),
        user_id: currentUser.id
      });
      // 2. clear local messages state
      setMessages([]);
      // 3. remove activeThread
      useConversationStore.getState().removeConversation(conversationId);
      
      // Show Alert/Toast
      Alert.alert('Thông báo', 'Bạn đã bị xóa khỏi nhóm trò chuyện này.');
      
      // 4. redirect safely
      router.replace('/(tabs)/messages');
    };

    const handleMemberAdded = (data: { conversation_id: string | number, user: any }) => {
      if (String(data.conversation_id) !== conversationId) return;
      console.log('👥 [CHAT_ROOM] Thành viên mới được thêm:', data.user);
      useConversationStore.getState().addMemberToGroup(conversationId, data.user);
    };

    const handleMemberRemoved = (data: { conversation_id: string | number, user_id: number }) => {
      if (String(data.conversation_id) !== conversationId) return;
      console.log('👥 [CHAT_ROOM] Thành viên bị xóa:', data.user_id);
      
      if (data.user_id === currentUser.id) {
        handleEjection();
        return;
      }
      
      useConversationStore.getState().removeMemberFromGroup(conversationId, data.user_id);
    };

    const handleGroupUpdated = (data: { conversation_id: string | number, name: string }) => {
      if (String(data.conversation_id) !== conversationId) return;
      console.log('👥 [CHAT_ROOM] Tên nhóm được cập nhật:', data.name);
      useConversationStore.getState().updateGroupName(conversationId, data.name);
    };

    const handleCreatorTransferred = (data: { conversation_id: string | number, created_by: string | number }) => {
      if (String(data.conversation_id) !== conversationId) return;
      console.log('👥 [CHAT_ROOM] Trưởng nhóm được chuyển nhượng:', data.created_by);
      useConversationStore.getState().transferCreator(conversationId, data.created_by);
    };

    const handleGroupKicked = (data: { conversation_id: string | number, message: string }) => {
      if (String(data.conversation_id) !== conversationId) return;
      console.log('👥 [CHAT_ROOM] Nhóm bị kick:', data);
      handleEjection();
    };

    socket.on('receive_message', handleReceiveMessage);
    socket.on('user_typing', handleUserTyping);
    socket.on('member_added', handleMemberAdded);
    socket.on('member_removed', handleMemberRemoved);
    socket.on('group_updated', handleGroupUpdated);
    socket.on('creator_transferred', handleCreatorTransferred);
    socket.on('group_kicked', handleGroupKicked);

    // Electron Quick Screenshot
    const electronInstance = (window as any).electronAPI;
    if (electronInstance && typeof electronInstance.onScreenshotCaptured === 'function') {
      electronInstance.onScreenshotCaptured((filePath: string) => {
        console.log('📸 Nhận screenshot từ Electron:', filePath);
        setCapturedImagePath(filePath);
        setScreenshotModalVisible(true);
      });
    }

    return () => {
      console.log(`🔌 [CHAT_ROOM] Leaving room: room_${conversationId}`);
      socket.emit('leave_room', {
        conversation_id: parseInt(conversationId),
        user_id: currentUser.id
      });
      socket.off('receive_message', handleReceiveMessage);
      socket.off('user_typing', handleUserTyping);
      socket.off('member_added', handleMemberAdded);
      socket.off('member_removed', handleMemberRemoved);
      socket.off('group_updated', handleGroupUpdated);
      socket.off('creator_transferred', handleCreatorTransferred);
      socket.off('group_kicked', handleGroupKicked);
    };
  }, [socket, conversationId, currentUser.id]);

  // Tải tin nhắn phân trang
  const fetchMessages = async (convId: string, pageNum: number, append = false) => {
    if (loadingMessages) return;
    setLoadingMessages(true);
    try {
      const response = await fetch(`${API_BASE_URL}/messages?conversation_id=${convId}&page=${pageNum}&limit=30`);
      const result = await response.json();
      
      if (response.ok && result.status === 'success') {
        if (append) {
          setMessages(prev => [...prev, ...result.data]);
        } else {
          setMessages(result.data);
        }
        setHasMoreMessages(result.has_more);
        setPage(pageNum);
      }
    } catch (error) {
      console.error("Lỗi khi tải lịch sử tin nhắn:", error);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (conversationId) {
      setPage(1);
      setHasMoreMessages(true);
      setMessages([]);
      setOtherUserTyping(null);
      setShowAttachMenu(false);
      setShowEmojiPanel(false);
      // Đặt lại ref tin nhắn đã xem cuối cùng khi đổi phòng chat
      lastSeenMessageIdRef.current = null;
      fetchMessages(conversationId, 1);
    }
  }, [conversationId]);

  // Xác định ID tin nhắn mới nhất để tối ưu dependencies cho useEffect seen flow
  const newestMessageId = useMemo(() => {
    return messages[0]?.id || activeThread?.lastMessageId || null;
  }, [messages[0]?.id, activeThread?.lastMessageId]);

  // Hook tự động mark seen khi xem tin nhắn (đảm bảo không lặp, không spam)
  useEffect(() => {
    if (!isFocused || appState !== 'active' || !conversationId || !newestMessageId) return;

    const targetMsgId = messages[0]?.id || activeThread?.lastMessageId;
    const targetSenderId = messages[0]?.sender_id || activeThread?.lastMessageSenderId;

    if (!targetMsgId) return;
    if (targetSenderId === currentUser.id) return;
    
    // Nếu tin nhắn này đã được đánh dấu đã xem trước đó thì bỏ qua để chặn vòng lặp vô hạn
    if (lastSeenMessageIdRef.current === targetMsgId) return;

    console.log(`[CLIENT:SEEN_MESSAGE_EMIT] Emitting seen_message for conversation ${conversationId}, message ${targetMsgId}`);
    
    if (socket) {
      socket.emit('seen_message', {
        conversation_id: parseInt(conversationId),
        message_id: targetMsgId,
        user_id: currentUser.id,
      });
      useConversationStore.getState().markAsSeen(conversationId, targetMsgId);
    }

    lastSeenMessageIdRef.current = targetMsgId;
  }, [newestMessageId, isFocused, appState, socket, currentUser.id, conversationId, activeThread?.lastMessageSenderId]);

  const handleBack = () => {
    router.back();
  };

  const handleLoadMoreMessages = () => {
    if (hasMoreMessages && !loadingMessages && conversationId) {
      fetchMessages(conversationId, page + 1, true);
    }
  };

  const handleSendMessage = () => {
    if (!inputMessage.trim() || !conversationId) return;

    if (socket) {
      socket.emit('send_message', {
        conversation_id: parseInt(conversationId),
        sender_id: currentUser.id,
        message: inputMessage.trim(),
        type: 'text'
      });

      socket.emit('stop_typing', {
        conversation_id: parseInt(conversationId),
        user_id: currentUser.id
      });
    }

    setInputMessage('');
    setIsTyping(false);
    setShowAttachMenu(false);

    inputRef.current?.focus();

    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 100);
  };

  const handleTriggerScreenshot = (excludeSelf: boolean = true) => {
    const electronInstance = (window as any).electronAPI;
    if (electronInstance && typeof electronInstance.captureScreen === 'function') {
      electronInstance.captureScreen({ excludeSelf });
    } else {
      Alert.alert("Chức năng Desktop", "Tính năng chụp màn hình nhanh chỉ khả dụng trên ứng dụng Desktop!");
    }
  };

  const handleSendScreenshot = async (caption: string, base64Data: string) => {
    try {
      setScreenshotModalVisible(false);
      setUploadingMedia(true);
      
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'image/jpeg' });
      
      const formData = new FormData();
      const fileName = `screenshot_${Date.now()}.jpg`;
      formData.append('file', blob, fileName);

      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (response.ok && result.status === 'success') {
        const fileUrl = result.file_url;
        
        if (socket) {
          socket.emit('send_message', {
            conversation_id: parseInt(conversationId),
            sender_id: currentUser.id,
            message: caption || '[Ảnh chụp màn hình]',
            type: 'image',
            file_url: fileUrl
          });
        }
        
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }, 150);
      } else {
        Alert.alert("Lỗi tải lên", result.message || "Không thể tải ảnh chụp lên.");
      }
    } catch (error) {
      console.error("Lỗi gửi ảnh chụp màn hình:", error);
      Alert.alert("Lỗi kết nối", "Không thể kết nối đến máy chủ.");
    } finally {
      setUploadingMedia(false);
    }
  };

  const handlePressImage = useCallback((url: string) => {
    setSelectedImage(url);
    setImageModalVisible(true);
  }, []);

  const handlePickMedia = async (mediaType: 'image' | 'video') => {
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (permissionResult.granted === false) {
      Alert.alert("Quyền truy cập", "Bạn cần cấp quyền truy cập thư viện ảnh để tải phương tiện lên!");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: mediaType === 'image' ? ['images'] : ['videos'],
      quality: 0.8,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets || result.assets.length === 0) {
      return;
    }

    const pickedAsset = result.assets[0];
    const pickedUri = pickedAsset.uri;
    const isVideo = pickedAsset.type === 'video' || mediaType === 'video';

    setUploadingMedia(true);

    try {
      const formData = new FormData();
      let fileExt = isVideo ? 'mp4' : 'jpg';
      if (pickedAsset.mimeType) {
        const mimeParts = pickedAsset.mimeType.split('/');
        if (mimeParts.length > 1) {
          const rawExt = mimeParts[1].toLowerCase();
          if (rawExt === 'jpeg' || rawExt === 'jpg') fileExt = 'jpg';
          else if (rawExt === 'png') fileExt = 'png';
          else if (rawExt === 'gif') fileExt = 'gif';
          else if (rawExt === 'mp4' || rawExt === 'mpeg' || rawExt === 'quicktime') fileExt = 'mp4';
          else if (rawExt === 'mov') fileExt = 'mov';
          else fileExt = rawExt;
        }
      }

      const fileName = `upload_${Date.now()}.${fileExt}`;
      const fileType = pickedAsset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg');

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

      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });

      const responseText = await response.text();
      let uploadResult = JSON.parse(responseText);

      if (response.ok && uploadResult.status === 'success') {
        const fileUrl = uploadResult.file_url;

        if (socket) {
          socket.emit('send_message', {
            conversation_id: parseInt(conversationId),
            sender_id: currentUser.id,
            message: isVideo ? '[Video]' : '[Hình ảnh]',
            type: isVideo ? 'file' : 'image',
            file_url: fileUrl
          });
        }
        
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }, 150);
      } else {
        Alert.alert("Lỗi tải lên", uploadResult.message || "Không thể tải tệp lên.");
      }
    } catch (error) {
      console.error("Lỗi khi tải ảnh/video:", error);
      Alert.alert("Lỗi kết nối", "Không thể kết nối đến máy chủ.");
    } finally {
      setUploadingMedia(false);
    }
  };

  const handleSelectMemberTag = (memberName: string) => {
    setInputMessage(prev => {
      const words = prev.split(/\s/);
      words.pop(); // Xóa cụm @... đang gõ dở
      const base = words.join(' ');
      const space = base ? ' ' : '';
      return `${base}${space}@${memberName} `;
    });
    setShowTagList(false);
    inputRef.current?.focus();
  };

  const handleTextChange = (text: string) => {
    setInputMessage(text);

    // Phát hiện gõ ký tự '@' để mở danh sách tag thành viên
    const lastWord = text.split(/\s/).pop() || '';
    if (lastWord.startsWith('@')) {
      setTagSearchQuery(lastWord.slice(1));
      setShowTagList(true);
    } else {
      setShowTagList(false);
    }

    if (socket && conversationId) {
      if (!isTyping) {
        setIsTyping(true);
        socket.emit('typing', {
          conversation_id: parseInt(conversationId),
          user_id: currentUser.id,
          user_name: currentUser.name
        });
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setIsTyping(false);
        socket.emit('stop_typing', {
          conversation_id: parseInt(conversationId),
          user_id: currentUser.id
        });
      }, 2000);
    }
  };

  const handlePickEmoji = useCallback((emoji: string) => {
    setInputMessage(prev => prev + emoji);
    setRecentEmojis(prev => {
      const filtered = prev.filter(e => e !== emoji);
      return [emoji, ...filtered].slice(0, 32);
    });
  }, []);

  const handleToggleEmoji = useCallback(() => {
    LayoutAnimation.configureNext({
      duration: 250,
      create: { type: 'easeInEaseOut', property: 'opacity' },
      update: { type: 'spring', springDamping: 0.75 },
      delete: { type: 'easeInEaseOut', property: 'opacity' },
    });
    if (showEmojiPanel) {
      setShowEmojiPanel(false);
    } else {
      Keyboard.dismiss();
      setShowAttachMenu(false);
      setShowEmojiPanel(true);
    }
  }, [showEmojiPanel]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        <View style={styles.container}>
          {/* Chat Header */}
          <View style={[styles.chatHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>

            <View style={styles.headerInfo}>
              <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
                {activeThread ? activeThread.name : 'Nhóm chat'}
              </Text>
              <Text style={styles.headerStatus}>
                {activeThread?.online ? '🟢 Đang hoạt động' : '⚪ Ngoại tuyến'}
              </Text>
            </View>

            {activeThread?.type === 'group' && (
              <TouchableOpacity style={styles.menuBtn} onPress={() => setInfoModalVisible(true)}>
                <Ionicons name="menu" size={26} color={colors.text} />
              </TouchableOpacity>
            )}
          </View>

          {/* Messages flatlist */}
          <FlatList
            ref={flatListRef}
            data={messages}
            extraData={messages}
            keyExtractor={(item) => item.id.toString()}
            style={{ flex: 1 }}
            contentContainerStyle={styles.messageStream}
            inverted
            initialNumToRender={20}
            windowSize={10}
            maxToRenderPerBatch={10}
            keyboardShouldPersistTaps="handled"
            removeClippedSubviews={Platform.OS === 'android'}
            onEndReached={handleLoadMoreMessages}
            onEndReachedThreshold={0.2}
            ListFooterComponent={() =>
              loadingMessages ? (
                <View style={{ paddingVertical: 12 }}>
                  <ActivityIndicator size="small" color={colors.tint} />
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <MessageItem
                item={item}
                isMine={item.sender_id === currentUser.id}
                colors={colors}
                onPressImage={handlePressImage}
                currentUserName={currentUser.name}
              />
            )}
          />

          {/* Typing indicator */}
          {otherUserTyping && (
            <View style={styles.typingContainer}>
              <Text style={styles.typingText}>{otherUserTyping} đang soạn tin nhắn...</Text>
            </View>
          )}

          {/* Floating Attachment Menu */}
          {showAttachMenu && (
            <View style={[styles.attachMenu, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <TouchableOpacity 
                style={styles.attachMenuItem} 
                onPress={() => {
                  setShowAttachMenu(false);
                  handlePickMedia('image');
                }}
              >
                <View style={[styles.attachMenuIcon, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                  <Ionicons name="image" size={18} color="#3b82f6" />
                </View>
                <Text style={[styles.attachMenuText, { color: colors.text }]}>Tải ảnh lên</Text>
              </TouchableOpacity>
              
              <TouchableOpacity 
                style={styles.attachMenuItem} 
                onPress={() => {
                  setShowAttachMenu(false);
                  handlePickMedia('video');
                }}
              >
                <View style={[styles.attachMenuIcon, { backgroundColor: 'rgba(239, 68, 68, 0.15)' }]}>
                  <Ionicons name="videocam" size={18} color="#ef4444" />
                </View>
                <Text style={[styles.attachMenuText, { color: colors.text }]}>Tải video lên</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Floating Tag list overlay */}
          {showTagList && filteredMembersForTag.length > 0 && (
            <View style={[styles.tagListContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <FlatList
                data={filteredMembersForTag}
                keyExtractor={(item) => String(item.user_id || item.id || '')}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.tagMemberItem, { borderBottomColor: colors.border }]}
                    onPress={() => handleSelectMemberTag(item.name)}
                  >
                    <Image
                      source={{ uri: item.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }}
                      style={styles.tagMemberAvatar}
                    />
                    <Text style={[styles.tagMemberName, { color: colors.text }]}>{item.name}</Text>
                    {item.email && (
                      <Text style={[styles.tagMemberEmail, { color: colors.textSecondary }]} numberOfLines={1}>
                        ({item.email})
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          {/* Input Bar */}
          <View style={[
            styles.inputBar, 
            { 
              backgroundColor: colors.card, 
              borderTopColor: colors.border,
              paddingBottom: showEmojiPanel ? 8 : (insets.bottom > 0 ? insets.bottom : 8),
              paddingTop: 10
            }
          ]}>
            <TouchableOpacity 
              style={styles.attachBtn} 
              onPress={() => setShowAttachMenu(!showAttachMenu)}
              disabled={uploadingMedia}
            >
              {uploadingMedia ? (
                <ActivityIndicator size="small" color={colors.tint} />
              ) : (
                <Ionicons name={showAttachMenu ? "close" : "add"} size={24} color={showAttachMenu ? colors.tint : colors.textSecondary} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.emojiBtn}
              onPress={handleToggleEmoji}
              activeOpacity={0.7}
            >
              <Ionicons
                name={showEmojiPanel ? 'happy' : 'happy-outline'}
                size={24}
                color={showEmojiPanel ? colors.tint : colors.textSecondary}
              />
            </TouchableOpacity>

            {!!((window as any).electronAPI && (window as any).electronAPI.isElectron()) && (
              <TouchableOpacity
                style={{ padding: 8, marginRight: 4 }}
                onPress={() => handleTriggerScreenshot(true)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="cut-outline"
                  size={22}
                  color={colors.textSecondary}
                />
              </TouchableOpacity>
            )}

            <TextInput
              ref={inputRef}
              style={[styles.input, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Nhập tin nhắn..."
              placeholderTextColor="#a0aec0"
              value={inputMessage}
              onChangeText={handleTextChange}
              onSubmitEditing={handleSendMessage}
              returnKeyType="send"
              blurOnSubmit={false}
              onFocus={() => {
                if (showEmojiPanel) {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setShowEmojiPanel(false);
                }
              }}
            />

            <TouchableOpacity style={[styles.sendBtn, { backgroundColor: colors.tint }]} onPress={handleSendMessage}>
              <Ionicons name="send" size={18} color="#fff" />
            </TouchableOpacity>
          </View>

          {/* Emoji Panel */}
          {showEmojiPanel && (
            <EmojiPanel
              height={300}
              onEmojiSelect={handlePickEmoji}
              recentEmojis={recentEmojis}
              colors={{
                card: colors.card,
                background: colors.background,
                text: colors.text,
                textSecondary: colors.textSecondary,
                border: colors.border,
                tint: colors.tint,
              }}
            />
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Full screen image viewer */}
      <Modal
        visible={imageModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setImageModalVisible(false)}
      >
        <TouchableOpacity 
          style={styles.imageViewerOverlay} 
          activeOpacity={1} 
          onPress={() => setImageModalVisible(false)}
        >
          <TouchableOpacity 
            style={styles.closeImageBtn} 
            onPress={() => setImageModalVisible(false)}
          >
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          {selectedImage && (
            <Image 
              source={{ uri: selectedImage }} 
              style={styles.fullScreenImage} 
              resizeMode="contain" 
            />
          )}
        </TouchableOpacity>
      </Modal>

      {/* Screenshot previewer */}
      <ScreenshotPreviewModal
        visible={screenshotModalVisible}
        imagePath={capturedImagePath}
        onClose={() => {
          setScreenshotModalVisible(false);
          setCapturedImagePath(null);
        }}
        onSend={handleSendScreenshot}
      />

      {/* Group Details Modal */}
      <GroupInfoModal
        visible={infoModalVisible}
        onClose={() => setInfoModalVisible(false)}
        conversationId={conversationId}
        currentUser={currentUser}
        colors={{
          background: colors.background,
          card: colors.card,
          text: colors.text,
          textSecondary: colors.textSecondary,
          border: colors.border,
          tint: colors.tint,
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    width: '100%',
    maxWidth: 768,
    alignSelf: 'center',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  backBtn: {
    padding: 6,
    marginRight: 6,
  },
  menuBtn: {
    padding: 6,
    marginLeft: 6,
  },
  headerInfo: {
    flex: 1,
    justifyContent: 'center',
  },
  headerName: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerStatus: {
    fontSize: 11,
    color: '#727785',
    marginTop: 2,
  },
  messageStream: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 14,
  },
  typingContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  typingText: {
    fontSize: 11,
    color: '#a0aec0',
    fontStyle: 'italic',
  },
  inputBar: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    alignItems: 'center',
    borderTopWidth: 1,
  },
  attachBtn: {
    padding: 8,
    marginRight: 6,
  },
  emojiBtn: {
    padding: 8,
    marginRight: 6,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 14,
    marginRight: 8,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachMenu: {
    position: 'absolute',
    bottom: 65,
    left: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    zIndex: 1000,
    flexDirection: 'row',
    gap: 6,
  },
  attachMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 8,
  },
  attachMenuIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  attachMenuText: {
    fontSize: 13,
    fontWeight: '700',
  },
  imageViewerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  closeImageBtn: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 20,
    right: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  fullScreenImage: {
    width: '100%',
    height: '90%',
  },
  tagListContainer: {
    position: 'absolute',
    bottom: 65, // Phía trên Input Bar một chút
    left: 12,
    right: 12,
    maxHeight: 200,
    borderRadius: 16,
    borderWidth: 1,
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
    zIndex: 1001,
  },
  tagMemberItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    gap: 10,
  },
  tagMemberAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  tagMemberName: {
    fontSize: 13,
    fontWeight: '700',
  },
  tagMemberEmail: {
    fontSize: 11,
    flex: 1,
  },
});
