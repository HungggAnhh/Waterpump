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
  Clipboard,
  ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { API_BASE_URL } from '@/constants/Config';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { MessageItem, Message } from '../../components/MessageItem';
import { EmojiPanel } from '../../components/EmojiPanel';
import { ScreenshotPreviewModal } from '../../components/ScreenshotPreviewModal';
import { useConversationStore, ChatThread } from '../../store/useConversationStore';
import { useOnlineStore } from '../../store/useOnlineStore';
import { GroupInfoModal } from '../../components/GroupInfoModal';
import { useIsFocused } from '@react-navigation/native';
import { useShallow } from 'zustand/shallow';

export default function ChatRoomScreen() {
  const { id } = useLocalSearchParams();
  const conversationId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : '';
  const router = useRouter();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const { socket, startCall } = useSocket();

  const currentUser = user || {
    id: 1,
    name: 'Admin',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80',
    role: 'admin'
  };

  const conversations = useConversationStore(useShallow(state => state.conversations));
  const activeThread = useMemo(() => {
    return conversations.find(c => String(c.id) === conversationId) || null;
  }, [conversations, conversationId]);

  const isOnline = useOnlineStore(state => 
    activeThread?.type === 'direct' && activeThread?.otherUser 
      ? !!state.onlineUsers[activeThread.otherUser.user_id] 
      : false
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [page, setPage] = useState(1);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);

  // Input & Typing
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [otherUserTyping, setOtherUserTyping] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Image viewer
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);

  // Emoji panel
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);

  // Screenshot share
  const [screenshotModalVisible, setScreenshotModalVisible] = useState(false);
  const [capturedImagePath, setCapturedImagePath] = useState<string | null>(null);
  const [infoModalVisible, setInfoModalVisible] = useState(false); // Group details modal

  // Mentions (@tag)
  const [showTagList, setShowTagList] = useState(false);
  const [tagSearchQuery, setTagSearchQuery] = useState('');

  // --- NEW ADVANCED CHAT ACTIONS STATES ---
  // Highlight flash
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null);

  // Pinned Banner
  const [pinnedMessages, setPinnedMessages] = useState<any[]>([]);

  // Replying/Edit
  const [replyingToMessage, setReplyingToMessage] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);

  // Long press bottom sheet action menu
  const [actionMenuVisible, setActionMenuVisible] = useState(false);
  const [selectedMenuMessage, setSelectedMenuMessage] = useState<Message | null>(null);
  const [menuPosition, setMenuPosition] = useState<{ x: number, y: number } | null>(null);
  const [headerMenuPosition, setHeaderMenuPosition] = useState<{ x: number, y: number } | null>(null);

  // Forward Modal
  const [forwardModalVisible, setForwardModalVisible] = useState(false);
  const [selectedForwardMessage, setSelectedForwardMessage] = useState<Message | null>(null);
  const [forwardSearchQuery, setForwardSearchQuery] = useState('');

  // Message Info Modal
  const [messageInfoVisible, setMessageInfoVisible] = useState(false);
  const [selectedInfoMessage, setSelectedInfoMessage] = useState<Message | null>(null);

  // Reactions detailed viewer modal
  const [reactionsViewerVisible, setReactionsViewerVisible] = useState(false);
  const [selectedReactionsMessage, setSelectedReactionsMessage] = useState<Message | null>(null);

  const filteredMembersForTag = useMemo(() => {
    if (!activeThread?.members) return [];
    const allMembers = activeThread.members.filter(m => (m.user_id || m.id) !== currentUser.id);
    if (!tagSearchQuery.trim()) return allMembers;
    return allMembers.filter(m => 
      m.name.toLowerCase().includes(tagSearchQuery.toLowerCase())
    );
  }, [activeThread?.members, tagSearchQuery, currentUser.id]);

  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);
  const typingTimeoutRef = useRef<any>(null);

  // Seen flow
  const lastSeenMessageIdRef = useRef<number | null>(null);

  const isFocused = useIsFocused();
  const isScreenFocusedRef = useRef(isFocused);
  const [appState, setAppState] = useState(AppState.currentState);
  const appStateRef = useRef(appState);

  // LayoutAnimation Android
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

  // Keyboard listener to hide emoji panel
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

  // Auto scroll FlatList on keyboard open
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

  // Auto fetch conversations from store
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

  // Load Pinned Messages
  const fetchPinnedMessages = async () => {
    if (!conversationId) return;
    try {
      const response = await fetch(`${API_BASE_URL}/messages/conversations/${conversationId}/pinned`);
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        setPinnedMessages(result.data);
      }
    } catch (error) {
      console.error("Lỗi tải tin nhắn ghim:", error);
    }
  };

  useEffect(() => {
    if (conversationId) {
      fetchPinnedMessages();
    }
  }, [conversationId]);

  // Setup Socket Events
  useEffect(() => {
    if (!socket || !conversationId) return;

    console.log(`🔌 [CHAT_ROOM:MOUNT] Registering socket events. conversationId: ${conversationId}`);
    
    const joinRoomPayload = {
      conversation_id: parseInt(conversationId),
      user_id: currentUser.id
    };
    socket.emit('join_room', joinRoomPayload);

    const handleSocketReconnect = () => {
      socket.emit('join_room', joinRoomPayload);
    };
    socket.on('connect', handleSocketReconnect);

    // --- SOCKET.IO EVENTS TỰ ĐỘNG ĐỒNG BỘ REALTIME ---
    
    // 1. Nhận tin nhắn mới
    const handleReceiveMessage = (msg: Message) => {
      if (String(msg.conversation_id) !== conversationId) return;

      setMessages((prev) => {
        if (prev.some(m => m.id === msg.id)) return prev;
        return [msg, ...prev];
      });

      setTimeout(() => {
        flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
      }, 100);
    };

    // 2. Nhận cảm xúc (Reactions) added/removed
    const handleReactionUpdated = (data: { message_id: number, conversation_id: number, reactions: any[] }) => {
      if (String(data.conversation_id) !== conversationId) return;
      setMessages((prev) => 
        prev.map(m => m.id === data.message_id ? { ...m, reactions: data.reactions } : m)
      );
    };

    // 3. Chỉnh sửa tin nhắn (Edit)
    const handleMessageEdited = (data: { id: number, conversation_id: number, message: string, edited: boolean }) => {
      if (String(data.conversation_id) !== conversationId) return;
      setMessages((prev) => 
        prev.map(m => m.id === data.id ? { ...m, message: data.message, edited: true } : m)
      );
      useConversationStore.getState().updateLastMessage(conversationId, data.id, data.message);
    };

    // 4. Thu hồi tin nhắn (Recall)
    const handleMessageRecalled = (data: { id: number, conversation_id: number }) => {
      if (String(data.conversation_id) !== conversationId) return;
      setMessages((prev) => 
        prev.map(m => m.id === data.id ? { ...m, message: "Tin nhắn đã được thu hồi", recalled: true } : m)
      );
      useConversationStore.getState().recallLastMessage(conversationId, data.id);
      
      // Đồng thời cập nhật list ghim nếu tin bị thu hồi
      fetchPinnedMessages();
    };

    // 5. Xóa tin nhắn với tất cả (Delete For Everyone)
    const handleMessageDeleted = (data: { id: number, conversation_id: number }) => {
      if (String(data.conversation_id) !== conversationId) return;
      setMessages((prev) => prev.map(m => m.id === data.id ? { ...m, deleted: true } : m));
      useConversationStore.getState().deleteLastMessage(conversationId, data.id);
      
      // Cập nhật list ghim
      fetchPinnedMessages();
    };

    // 6. Xóa chỉ mình tôi (Delete For Me)
    const handleMessageDeletedForMe = (data: { id: number, conversation_id: number }) => {
      if (String(data.conversation_id) !== conversationId) return;
      setMessages((prev) => prev.map(m => m.id === data.id ? { ...m, deleted_for_me: true } : m));
    };

    // 7. Ghim / Bỏ ghim tin nhắn
    const handleMessagePinned = (data: { conversation_id: number }) => {
      if (String(data.conversation_id) !== conversationId) return;
      fetchPinnedMessages();
    };

    // Typing Indicators
    const handleUserTyping = (data: { conversation_id: string, userId: number, userName: string, isTyping: boolean }) => {
      if (String(data.conversation_id) === conversationId && data.userId !== currentUser.id) {
        setOtherUserTyping(data.isTyping ? data.userName : null);
      }
    };

    const handleEjection = () => {
      socket.emit('leave_room', joinRoomPayload);
      setMessages([]);
      useConversationStore.getState().removeConversation(conversationId);
      Alert.alert('Thông báo', 'Bạn đã bị xóa khỏi nhóm trò chuyện này.');
      router.replace('/(tabs)/messages');
    };

    const handleMemberAdded = (data: { conversation_id: string | number, user: any }) => {
      if (String(data.conversation_id) !== conversationId) return;
      useConversationStore.getState().addMemberToGroup(conversationId, data.user);
    };

    const handleMemberRemoved = (data: { conversation_id: string | number, user_id: number }) => {
      if (String(data.conversation_id) !== conversationId) return;
      if (data.user_id === currentUser.id) {
        handleEjection();
        return;
      }
      useConversationStore.getState().removeMemberFromGroup(conversationId, data.user_id);
    };

    const handleGroupUpdated = (data: { conversation_id: string | number, name: string }) => {
      if (String(data.conversation_id) !== conversationId) return;
      useConversationStore.getState().updateGroupName(conversationId, data.name);
    };

    socket.on('receive_message', handleReceiveMessage);
    socket.on('reaction_added', handleReactionUpdated);
    socket.on('reaction_removed', handleReactionUpdated);
    socket.on('message_edited', handleMessageEdited);
    socket.on('message_recalled', handleMessageRecalled);
    socket.on('message_deleted', handleMessageDeleted);
    socket.on('message_deleted_for_me', handleMessageDeletedForMe);
    socket.on('message_pinned', handleMessagePinned);
    socket.on('message_unpinned', handleMessagePinned);
    socket.on('user_typing', handleUserTyping);
    socket.on('member_added', handleMemberAdded);
    socket.on('member_removed', handleMemberRemoved);
    socket.on('group_updated', handleGroupUpdated);

    return () => {
      socket.emit('leave_room', joinRoomPayload);
      socket.off('connect', handleSocketReconnect);
      socket.off('receive_message', handleReceiveMessage);
      socket.off('reaction_added', handleReactionUpdated);
      socket.off('reaction_removed', handleReactionUpdated);
      socket.off('message_edited', handleMessageEdited);
      socket.off('message_recalled', handleMessageRecalled);
      socket.off('message_deleted', handleMessageDeleted);
      socket.off('message_deleted_for_me', handleMessageDeletedForMe);
      socket.off('message_pinned', handleMessagePinned);
      socket.off('message_unpinned', handleMessagePinned);
      socket.off('user_typing', handleUserTyping);
      socket.off('member_added', handleMemberAdded);
      socket.off('member_removed', handleMemberRemoved);
      socket.off('group_updated', handleGroupUpdated);
    };
  }, [socket, conversationId, currentUser.id]);

  // Load Messages History
  const fetchMessages = async (convId: string, beforeId: number | null, append = false) => {
    if (loadingMessages) return;
    setLoadingMessages(true);
    try {
      const beforeParam = beforeId ? `&before=${beforeId}` : '';
      const response = await fetch(`${API_BASE_URL}/messages?conversation_id=${convId}&user_id=${currentUser.id}${beforeParam}&limit=30`);
      const result = await response.json();
      
      if (response.ok && result.status === 'success') {
        if (append) {
          setMessages(prev => [...prev, ...result.data]);
        } else {
          setMessages(result.data);
        }
        setHasMoreMessages(result.has_more);
      }
    } catch (error) {
      console.error("Lỗi khi tải lịch sử tin nhắn:", error);
    } finally {
      setLoadingMessages(false);
    }
  };

  useEffect(() => {
    if (conversationId) {
      useConversationStore.getState().setActiveConversationId(conversationId);
      setHasMoreMessages(true);
      setMessages([]);
      setOtherUserTyping(null);
      setShowAttachMenu(false);
      setShowEmojiPanel(false);
      setReplyingToMessage(null);
      setEditingMessage(null);
      lastSeenMessageIdRef.current = null;
      fetchMessages(conversationId, null);
    }
    return () => {
      useConversationStore.getState().setActiveConversationId(null);
    };
  }, [conversationId]);

  const newestMessageId = useMemo(() => {
    return messages[0]?.id || activeThread?.lastMessageId || null;
  }, [messages[0]?.id, activeThread?.lastMessageId]);

  // Automatic mark as seen
  useEffect(() => {
    if (!isFocused || appState !== 'active' || !conversationId || !newestMessageId) return;

    const targetMsgId = messages[0]?.id || activeThread?.lastMessageId;
    const targetSenderId = messages[0]?.sender_id || activeThread?.lastMessageSenderId;

    if (!targetMsgId || targetSenderId === currentUser.id) return;
    if (lastSeenMessageIdRef.current === targetMsgId) return;

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

  const handleConfirmDeleteCurrentConversation = () => {
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
              const response = await fetch(`${API_BASE_URL}/conversations/${conversationId}?user_id=${currentUser.id}`, {
                method: 'DELETE'
              });
              const result = await response.json();
              if (response.ok && (result.success || result.status === 'success')) {
                useConversationStore.getState().deleteConversation(conversationId);
                router.replace('/(tabs)/messages');
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

  const handleLoadMoreMessages = () => {
    if (hasMoreMessages && !loadingMessages && conversationId && messages.length > 0) {
      const oldestMessageId = messages[messages.length - 1].id;
      fetchMessages(conversationId, oldestMessageId, true);
    }
  };

  // --- ACTIONS LOGIC (POST / EDIT / DELETE / RECALL / PIN / FORWARD) ---

  const handleSendMessage = () => {
    if (!inputMessage.trim() || !conversationId) return;

    if (editingMessage) {
      // Đang ở chế độ chỉnh sửa (Edit Message)
      handleEditMessageSubmit();
      return;
    }

    if (socket) {
      const payload: any = {
        conversation_id: parseInt(conversationId),
        sender_id: currentUser.id,
        message: inputMessage.trim(),
        type: 'text'
      };

      if (replyingToMessage) {
        payload.reply_to = replyingToMessage.id;
      }

      socket.emit('send_message', payload);
      socket.emit('stop_typing', {
        conversation_id: parseInt(conversationId),
        user_id: currentUser.id
      });
    }

    setInputMessage('');
    setReplyingToMessage(null);
    setIsTyping(false);
    setShowAttachMenu(false);
    inputRef.current?.focus();

    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 100);
  };

  // Double Tap Thả Tim nhanh
  const handleDoubleTapMessage = useCallback(async (message: Message) => {
    try {
      const response = await fetch(`${API_BASE_URL}/messages/${message.id}/reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          reaction: '❤️'
        })
      });
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        // Cập nhật local state optimistic
        setMessages(prev => prev.map(m => m.id === message.id ? { ...m, reactions: result.data.reactions } : m));
      }
    } catch (error) {
      console.error("Lỗi thả tim nhanh:", error);
    }
  }, [currentUser.id]);

  // Thả cảm xúc từ Action Menu
  const handleAddReaction = async (message: Message, reactionSymbol: string) => {
    setActionMenuVisible(false);
    try {
      const response = await fetch(`${API_BASE_URL}/messages/${message.id}/reaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          reaction: reactionSymbol
        })
      });
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        setMessages(prev => prev.map(m => m.id === message.id ? { ...m, reactions: result.data.reactions } : m));
      }
    } catch (error) {
      console.error("Lỗi thả cảm xúc:", error);
    }
  };

  // Kích hoạt Reply Quote
  const handleTriggerReply = (message: Message) => {
    setActionMenuVisible(false);
    setEditingMessage(null);
    setReplyingToMessage(message);
    inputRef.current?.focus();
  };

  // Kích hoạt Chỉnh sửa tin nhắn (Edit Mode)
  const handleTriggerEdit = (message: Message) => {
    setActionMenuVisible(false);
    setReplyingToMessage(null);
    setEditingMessage(message);
    setInputMessage(message.message);
    inputRef.current?.focus();
  };

  const handleEditMessageSubmit = async () => {
    if (!editingMessage || !inputMessage.trim()) return;
    const msgId = editingMessage.id;
    const newText = inputMessage.trim();

    // Reset input immediately (optimistic UI flow)
    setInputMessage('');
    setEditingMessage(null);

    try {
      const response = await fetch(`${API_BASE_URL}/messages/${msgId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          message: newText
        })
      });
      const result = await response.json();
      if (!response.ok || result.status !== 'success') {
        Alert.alert("Lỗi", result.message || "Không thể chỉnh sửa tin nhắn.");
        // Rollback on fail
        fetchMessages(conversationId, 1);
      }
    } catch (error) {
      console.error("Lỗi chỉnh sửa tin nhắn:", error);
      Alert.alert("Lỗi kết nối", "Không thể chỉnh sửa tin nhắn.");
      fetchMessages(conversationId, 1);
    }
  };

  // Sao chép tin nhắn
  const handleCopyMessage = (message: Message) => {
    setActionMenuVisible(false);
    Clipboard.setString(message.message);
    Alert.alert("Thông báo", "Đã sao chép tin nhắn vào bộ nhớ tạm.");
  };

  // Ghim tin nhắn
  const handlePinMessage = async (message: Message) => {
    setActionMenuVisible(false);
    try {
      const response = await fetch(`${API_BASE_URL}/messages/${message.id}/pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: currentUser.id,
          conversation_id: parseInt(conversationId)
        })
      });
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        fetchPinnedMessages();
        Alert.alert("Thông báo", "Đã ghim tin nhắn này.");
      } else {
        Alert.alert("Thất bại", result.message || "Không thể ghim tin nhắn.");
      }
    } catch (error) {
      console.error("Lỗi ghim tin nhắn:", error);
    }
  };

  const handleUnpinMessage = async (messageId: number) => {
    try {
      const response = await fetch(`${API_BASE_URL}/messages/${messageId}/pin?conversation_id=${conversationId}`, {
        method: 'DELETE'
      });
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        fetchPinnedMessages();
        Alert.alert("Thông báo", "Đã bỏ ghim tin nhắn.");
      }
    } catch (error) {
      console.error("Lỗi bỏ ghim:", error);
    }
  };

  // Thu hồi tin nhắn (Recall)
  const handleRecallMessage = useCallback(async (message: Message) => {
    setActionMenuVisible(false);
    try {
      const response = await fetch(`${API_BASE_URL}/messages/${message.id}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUser.id })
      });
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        setMessages(prev => 
          prev.map(m => m.id === message.id ? { ...m, message: "Tin nhắn đã được thu hồi", recalled: true } : m)
        );
        useConversationStore.getState().recallLastMessage(conversationId, message.id);
        fetchPinnedMessages();
      }
    } catch (error) {
      console.error("Lỗi thu hồi tin nhắn:", error);
    }
  }, [currentUser.id, conversationId]);

  // Xóa với tất cả (Delete For Everyone)
  const handleDeleteForEveryone = async (message: Message) => {
    setActionMenuVisible(false);
    // Mark as deleted for everyone locally
    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, deleted: true } : m));
    
    try {
      const response = await fetch(`${API_BASE_URL}/messages/${message.id}/everyone`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUser.id })
      });
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        useConversationStore.getState().deleteLastMessage(conversationId, message.id);
        fetchPinnedMessages();
      } else {
        // Rollback on fail
        fetchMessages(conversationId, 1);
      }
    } catch (error) {
      console.error("Lỗi xóa với tất cả:", error);
      fetchMessages(conversationId, 1);
    }
  };

  // Xóa chỉ mình tôi (Delete For Me)
  const handleDeleteForMe = async (message: Message) => {
    setActionMenuVisible(false);
    // Mark as deleted for me locally
    setMessages(prev => prev.map(m => m.id === message.id ? { ...m, deleted_for_me: true } : m));
    
    try {
      const response = await fetch(`${API_BASE_URL}/messages/${message.id}/me`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: currentUser.id })
      });
      const result = await response.json();
      if (!response.ok || result.status !== 'success') {
        // Rollback on fail
        fetchMessages(conversationId, 1);
      }
    } catch (error) {
      console.error("Lỗi xóa chỉ mình tôi:", error);
      fetchMessages(conversationId, 1);
    }
  };

  // Quote scroll to index & flash highlight
  const handlePressQuote = useCallback((parentId: number) => {
    const idx = messages.findIndex(m => m.id === parentId);
    if (idx !== -1) {
      flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      setHighlightedMessageId(parentId);
      setTimeout(() => setHighlightedMessageId(null), 2000);
    } else {
      Alert.alert("Thông báo", "Tin nhắn gốc nằm quá xa hoặc đã quá cũ.");
    }
  }, [messages]);

  // Chia sẻ / Chuyển tiếp (Forward)
  const handleTriggerForward = (message: Message) => {
    setActionMenuVisible(false);
    setSelectedForwardMessage(message);
    setForwardModalVisible(true);
    setForwardSearchQuery('');
  };

  const handleForwardMessageTo = async (thread: ChatThread) => {
    if (!selectedForwardMessage) return;
    setForwardModalVisible(false);
    
    const textToForward = selectedForwardMessage.message;
    const mediaType = selectedForwardMessage.type;
    const mediaUrl = selectedForwardMessage.file_url;

    try {
      // Gửi qua HTTP API hoặc socket
      if (socket) {
        socket.emit('send_message', {
          conversation_id: parseInt(thread.id),
          sender_id: currentUser.id,
          message: textToForward,
          type: mediaType,
          file_url: mediaUrl,
          forwarded: true // gắn cờ đã chuyển tiếp
        });
        
        Alert.alert("Thành công", `Đã chuyển tiếp tin nhắn tới ${thread.name}`);
      }
    } catch (error) {
      console.error("Lỗi chuyển tiếp tin nhắn:", error);
    }
  };

  // Lọc luồng chat cho Forward modal
  const filteredThreadsForForward = useMemo(() => {
    if (!forwardSearchQuery.trim()) return conversations;
    return conversations.filter(c => 
      c.name.toLowerCase().includes(forwardSearchQuery.toLowerCase())
    );
  }, [conversations, forwardSearchQuery]);

  // Xem Thông tin chi tiết tin nhắn
  const handleTriggerInfo = (message: Message) => {
    setActionMenuVisible(false);
    setSelectedInfoMessage(message);
    setMessageInfoVisible(true);
  };

  // Xem chi tiết Reactions list
  const handlePressReactions = useCallback((message: Message) => {
    setSelectedReactionsMessage(message);
    setReactionsViewerVisible(true);
  }, []);

  // --- HẾT PHẦN LOGIC NÂNG CAO ---

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
    const ImagePicker = require('expo-image-picker');
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
      words.pop();
      const base = words.join(' ');
      const space = base ? ' ' : '';
      return `${base}${space}@${memberName} `;
    });
    setShowTagList(false);
    inputRef.current?.focus();
  };

  const handleTextChange = (text: string) => {
    setInputMessage(text);

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

  const handleOpenActionMenu = useCallback((msg: Message, event?: any) => {
    setSelectedMenuMessage(msg);
    setActionMenuVisible(true);
    if (Platform.OS === 'web' && event && event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      setMenuPosition({ x: rect.left, y: rect.bottom });
    }
  }, []);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]} edges={['top', 'left', 'right']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
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
                {activeThread?.type === 'group'
                  ? `${activeThread.members?.length || 0} thành viên`
                  : (isOnline ? '🟢 Đang hoạt động' : '⚪ Ngoại tuyến')}
              </Text>
            </View>

            {activeThread && activeThread.type === 'direct' && activeThread.otherUser && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <TouchableOpacity 
                  style={{ padding: 8, marginRight: 4 }} 
                  onPress={() => {
                    if (!isOnline) {
                      Alert.alert("Ngoại tuyến", "Người dùng này hiện không trực tuyến.");
                      return;
                    }
                    if (startCall) {
                      startCall(
                        {
                          id: Number(activeThread.otherUser!.user_id),
                          name: activeThread.otherUser!.name,
                          avatar: activeThread.otherUser!.avatar
                        },
                        'voice',
                        conversationId
                      );
                    }
                  }}
                >
                  <Ionicons name="call" size={20} color={colors.tint} />
                </TouchableOpacity>
                <TouchableOpacity 
                  style={{ padding: 8, marginRight: 8 }} 
                  onPress={() => {
                    if (!isOnline) {
                      Alert.alert("Ngoại tuyến", "Người dùng này hiện không trực tuyến.");
                      return;
                    }
                    if (startCall) {
                      startCall(
                        {
                          id: Number(activeThread.otherUser!.user_id),
                          name: activeThread.otherUser!.name,
                          avatar: activeThread.otherUser!.avatar
                        },
                        'video',
                        conversationId
                      );
                    }
                  }}
                >
                  <Ionicons name="videocam" size={22} color={colors.tint} />
                </TouchableOpacity>
              </View>
            )}

            {activeThread && (
              <TouchableOpacity 
                style={styles.menuBtn} 
                onPress={(event) => {
                  if (activeThread.type === 'group') {
                    if (Platform.OS === 'web' && event && event.currentTarget) {
                      const rect = (event.currentTarget as any).getBoundingClientRect();
                      setHeaderMenuPosition({ x: rect.left, y: rect.bottom });
                    }
                    setInfoModalVisible(true);
                  } else {
                    handleConfirmDeleteCurrentConversation();
                  }
                }}
              >
                <Ionicons 
                  name={activeThread.type === 'group' ? "menu" : "trash-outline"} 
                  size={activeThread.type === 'group' ? 26 : 22} 
                  color={colors.text} 
                />
              </TouchableOpacity>
            )}
          </View>

          {/* Banner ghim tin nhắn (Pinned Messages Banner) */}
          {pinnedMessages.length > 0 && (
            <View style={[styles.pinnedBanner, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              <View style={styles.pinnedBannerInfo}>
                <Ionicons name="pin" size={16} color={colors.tint} style={{ marginRight: 8 }} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.pinnedBannerTitle, { color: colors.text }]} numberOfLines={1}>
                    Tin nhắn đã ghim ({pinnedMessages.length})
                  </Text>
                  <Text style={[styles.pinnedBannerContent, { color: colors.textSecondary }]} numberOfLines={1}>
                    {pinnedMessages[0].pinned_by_name}: {pinnedMessages[0].message}
                  </Text>
                </View>
              </View>
              <View style={styles.pinnedBannerActions}>
                <TouchableOpacity 
                  onPress={() => handlePressQuote(pinnedMessages[0].message_id)} 
                  style={styles.pinnedBannerBtn}
                >
                  <Text style={[styles.pinnedBannerBtnText, { color: colors.tint }]}>Đi tới</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={() => handleUnpinMessage(pinnedMessages[0].message_id)} 
                  style={{ padding: 4 }}
                >
                  <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Messages flatlist */}
          <FlatList
            ref={flatListRef}
            data={messages}
            extraData={[messages, highlightedMessageId]}
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
                onLongPress={handleOpenActionMenu}
                onDoubleTap={handleDoubleTapMessage}
                onPressQuote={handlePressQuote}
                onPressReactions={handlePressReactions}
                currentUserName={currentUser.name}
                isHighlighted={item.id === highlightedMessageId}
                onRecallPress={handleRecallMessage}
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

          {/* Reply Quote Preview Bar */}
          {replyingToMessage && (
            <View style={[styles.replyPreviewBar, { backgroundColor: colors.card, borderTopColor: colors.border, borderTopWidth: 1 }]}>
              <View style={[styles.replyIndicator, { backgroundColor: colors.tint }]} />
              <View style={{ flex: 1, paddingLeft: 8 }}>
                <Text style={[styles.replySenderText, { color: colors.tint }]}>
                  Đang trả lời {replyingToMessage.sender_name}
                </Text>
                <Text style={[styles.replyMessageText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {replyingToMessage.type === 'image' 
                    ? "📷 [Hình ảnh]" 
                    : replyingToMessage.type === 'file' 
                      ? "📁 [Video]" 
                      : replyingToMessage.message}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setReplyingToMessage(null)} style={{ padding: 6 }}>
                <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          )}

          {/* Edit Message Indicator Bar */}
          {editingMessage && (
            <View style={[styles.replyPreviewBar, { backgroundColor: colors.card, borderTopColor: colors.border, borderTopWidth: 1 }]}>
              <View style={[styles.replyIndicator, { backgroundColor: '#f59e0b' }]} />
              <View style={{ flex: 1, paddingLeft: 8 }}>
                <Text style={[styles.replySenderText, { color: '#f59e0b' }]}>
                  Đang chỉnh sửa tin nhắn
                </Text>
                <Text style={[styles.replyMessageText, { color: colors.textSecondary }]} numberOfLines={1}>
                  {editingMessage.message}
                </Text>
              </View>
              <TouchableOpacity 
                onPress={() => {
                  setEditingMessage(null);
                  setInputMessage('');
                }} 
                style={{ padding: 6 }}
              >
                <Ionicons name="close-circle" size={20} color={colors.textSecondary} />
              </TouchableOpacity>
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
              placeholder={editingMessage ? "Chỉnh sửa tin nhắn..." : "Nhập tin nhắn..."}
              placeholderTextColor="#a0aec0"
              value={inputMessage}
              onChangeText={handleTextChange}
              onSubmitEditing={handleSendMessage}
              returnKeyType={editingMessage ? "done" : "send"}
              blurOnSubmit={false}
              onFocus={() => {
                if (showEmojiPanel) {
                  LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                  setShowEmojiPanel(false);
                }
              }}
            />

            <TouchableOpacity style={[styles.sendBtn, { backgroundColor: editingMessage ? '#f59e0b' : colors.tint }]} onPress={handleSendMessage}>
              <Ionicons name={editingMessage ? "checkmark" : "send"} size={18} color="#fff" />
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
        onClose={() => {
          setInfoModalVisible(false);
          setHeaderMenuPosition(null);
        }}
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
        position={headerMenuPosition}
      />

      {/* --- NEW PREMIUM MESSENGER INTERACTION MODALS --- */}

      {/* 1. LongPress Premium Action Menu Bottom Sheet */}
      <Modal
        visible={actionMenuVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setActionMenuVisible(false)}
      >
        <TouchableOpacity 
          style={[
            styles.modalBackdrop,
            Platform.OS === 'web' ? {
              backgroundColor: 'transparent',
              justifyContent: 'flex-start',
            } : {}
          ]} 
          activeOpacity={1} 
          onPress={() => setActionMenuVisible(false)}
        >
          {(Platform.OS === 'web' && menuPosition) && (
            <TouchableOpacity 
              style={StyleSheet.absoluteFill} 
              activeOpacity={1} 
              onPress={() => setActionMenuVisible(false)} 
            />
          )}
          <View style={[
            styles.bottomSheetContainer, 
            { backgroundColor: colors.card },
            (Platform.OS === 'web' && menuPosition) ? {
              position: 'absolute',
              top: Math.min((typeof window !== 'undefined' ? window.innerHeight : 800) - 300, Math.max(10, menuPosition.y - 50)),
              left: Math.min((typeof window !== 'undefined' ? window.innerWidth : 600) - 190, Math.max(10, menuPosition.x - 170)),
            } : {}
          ]}>
            {Platform.OS !== 'web' && <View style={styles.sheetHeaderIndicator} />}

            {selectedMenuMessage && (
              <>
                {/* Reactions Floating Bar */}
                <View style={[styles.sheetReactionsBar, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  {['👍', '❤️', '😂', '😮', '😢', '😡'].map((emoji) => (
                    <TouchableOpacity
                      key={emoji}
                      style={styles.sheetReactionEmojiBtn}
                      onPress={() => handleAddReaction(selectedMenuMessage, emoji)}
                    >
                      <Text style={styles.sheetReactionEmoji}>{emoji}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Vertical Interactive Menu Items */}
                <View style={styles.sheetMenuOptions}>
                  {/* Trả lời (Reply) */}
                  <TouchableOpacity style={styles.sheetOptionRow} onPress={() => handleTriggerReply(selectedMenuMessage)}>
                    <Ionicons name="arrow-undo-outline" size={Platform.OS === 'web' ? 16 : 20} color={colors.text} />
                    <Text style={[styles.sheetOptionText, { color: colors.text }]}>Trả lời</Text>
                  </TouchableOpacity>

                  {/* Chuyển tiếp (Forward) */}
                  <TouchableOpacity style={styles.sheetOptionRow} onPress={() => handleTriggerForward(selectedMenuMessage)}>
                    <Ionicons name="share-social-outline" size={Platform.OS === 'web' ? 16 : 20} color={colors.text} />
                    <Text style={[styles.sheetOptionText, { color: colors.text }]}>Chia sẻ</Text>
                  </TouchableOpacity>

                  {/* Sao chép (Copy) */}
                  <TouchableOpacity style={styles.sheetOptionRow} onPress={() => handleCopyMessage(selectedMenuMessage)}>
                    <Ionicons name="copy-outline" size={Platform.OS === 'web' ? 16 : 20} color={colors.text} />
                    <Text style={[styles.sheetOptionText, { color: colors.text }]}>Copy tin nhắn</Text>
                  </TouchableOpacity>

                  {Platform.OS === 'web' && <View style={[styles.divider, { backgroundColor: colors.border }]} />}

                  {/* Ghim tin nhắn (Pin) */}
                  <TouchableOpacity style={styles.sheetOptionRow} onPress={() => handlePinMessage(selectedMenuMessage)}>
                    <Ionicons name="pin-outline" size={Platform.OS === 'web' ? 16 : 20} color={colors.text} />
                    <Text style={[styles.sheetOptionText, { color: colors.text }]}>Ghim tin nhắn</Text>
                  </TouchableOpacity>

                  {/* Chỉnh sửa (Edit) - Only own message */}
                  {selectedMenuMessage.sender_id === currentUser.id && (
                    <TouchableOpacity style={styles.sheetOptionRow} onPress={() => handleTriggerEdit(selectedMenuMessage)}>
                      <Ionicons name="pencil-outline" size={Platform.OS === 'web' ? 16 : 20} color="#f59e0b" />
                      <Text style={[styles.sheetOptionText, { color: '#f59e0b' }]}>Chỉnh sửa</Text>
                    </TouchableOpacity>
                  )}

                  {/* Thu hồi (Recall) - Only own message */}
                  {selectedMenuMessage.sender_id === currentUser.id && (
                    <TouchableOpacity style={styles.sheetOptionRow} onPress={() => handleRecallMessage(selectedMenuMessage)}>
                      <Ionicons name="refresh-outline" size={Platform.OS === 'web' ? 16 : 20} color={colors.tint} />
                      <Text style={[styles.sheetOptionText, { color: colors.tint }]}>Thu hồi tin nhắn</Text>
                    </TouchableOpacity>
                  )}

                  {Platform.OS === 'web' && <View style={[styles.divider, { backgroundColor: colors.border }]} />}

                  {/* Thông tin tin nhắn (Info Modal) */}
                  <TouchableOpacity style={styles.sheetOptionRow} onPress={() => handleTriggerInfo(selectedMenuMessage)}>
                    <Ionicons name="information-circle-outline" size={Platform.OS === 'web' ? 16 : 20} color={colors.text} />
                    <Text style={[styles.sheetOptionText, { color: colors.text }]}>Xem chi tiết</Text>
                  </TouchableOpacity>

                  {/* Xóa với tất cả (Delete For Everyone) - Own or Admin */}
                  {(selectedMenuMessage.sender_id === currentUser.id || currentUser.role === 'admin') && (
                    <TouchableOpacity style={styles.sheetOptionRow} onPress={() => handleDeleteForEveryone(selectedMenuMessage)}>
                      <Ionicons name="trash-outline" size={Platform.OS === 'web' ? 16 : 20} color="#ef4444" />
                      <Text style={[styles.sheetOptionText, { color: '#ef4444' }]}>Xóa với tất cả</Text>
                    </TouchableOpacity>
                  )}

                  {/* Xóa chỉ mình tôi (Delete For Me) */}
                  <TouchableOpacity style={styles.sheetOptionRow} onPress={() => handleDeleteForMe(selectedMenuMessage)}>
                    <Ionicons name="eye-off-outline" size={Platform.OS === 'web' ? 16 : 20} color="#ef4444" />
                    <Text style={[styles.sheetOptionText, { color: '#ef4444' }]}>Xóa chỉ ở phía tôi</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 2. Forward / Share Message Modal */}
      <Modal
        visible={forwardModalVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setForwardModalVisible(false)}
      >
        <View style={styles.modalCenterOverlay}>
          <View style={[styles.forwardDialog, { backgroundColor: colors.card }]}>
            <View style={styles.forwardHeader}>
              <Text style={[styles.forwardTitle, { color: colors.text }]}>Chuyển tiếp tin nhắn</Text>
              <TouchableOpacity onPress={() => setForwardModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <TextInput
              style={[styles.forwardSearchInput, { backgroundColor: colors.background, color: colors.text, borderColor: colors.border }]}
              placeholder="Tìm kiếm cuộc trò chuyện..."
              placeholderTextColor="#a0aec0"
              value={forwardSearchQuery}
              onChangeText={setForwardSearchQuery}
            />

            <FlatList
              data={filteredThreadsForForward}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 300 }}
              renderItem={({ item }) => (
                <View style={[styles.forwardRow, { borderBottomColor: colors.border }]}>
                  <Image source={{ uri: item.avatar }} style={styles.forwardAvatar} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={[styles.forwardName, { color: colors.text }]}>{item.name}</Text>
                    <Text style={{ fontSize: 11, color: colors.textSecondary }}>
                      {item.type === 'group' ? 'Group Chat' : 'Direct Message'}
                    </Text>
                  </View>
                  <TouchableOpacity 
                    onPress={() => handleForwardMessageTo(item)}
                    style={[styles.forwardSendBtn, { backgroundColor: colors.tint }]}
                  >
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Gửi</Text>
                  </TouchableOpacity>
                </View>
              )}
            />
          </View>
        </View>
      </Modal>

      {/* 3. Detailed Message Information Modal */}
      <Modal
        visible={messageInfoVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMessageInfoVisible(false)}
      >
        <View style={styles.modalCenterOverlay}>
          <View style={[styles.infoDialog, { backgroundColor: colors.card }]}>
            <View style={styles.forwardHeader}>
              <Text style={[styles.forwardTitle, { color: colors.text }]}>Chi tiết tin nhắn</Text>
              <TouchableOpacity onPress={() => setMessageInfoVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {selectedInfoMessage && (
              <ScrollView style={{ padding: 12 }}>
                {/* Message preview bubble */}
                <View style={[styles.infoMsgPreview, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={{ fontSize: 11, color: colors.tint, fontWeight: '700', marginBottom: 4 }}>
                    {selectedInfoMessage.sender_name}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.text }}>{selectedInfoMessage.message}</Text>
                </View>

                {/* Details list */}
                <View style={styles.infoDetailsList}>
                  <View style={styles.infoDetailRow}>
                    <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Thời gian gửi:</Text>
                    <Text style={[styles.infoVal, { color: colors.text }]}>
                      {new Date(selectedInfoMessage.raw_time || selectedInfoMessage.created_at).toLocaleString()}
                    </Text>
                  </View>

                  <View style={styles.infoDetailRow}>
                    <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Đã chỉnh sửa:</Text>
                    <Text style={[styles.infoVal, { color: selectedInfoMessage.edited ? '#f59e0b' : colors.text }]}>
                      {selectedInfoMessage.edited ? 'Có (đã chỉnh sửa)' : 'Không'}
                    </Text>
                  </View>

                  <View style={styles.infoDetailRow}>
                    <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Trạng thái thu hồi:</Text>
                    <Text style={[styles.infoVal, { color: selectedInfoMessage.recalled ? colors.tint : colors.text }]}>
                      {selectedInfoMessage.recalled ? 'Đã thu hồi' : 'Bình thường'}
                    </Text>
                  </View>

                  <View style={styles.infoDetailRow}>
                    <Text style={[styles.infoLabel, { color: colors.textSecondary }]}>Đã chuyển tiếp:</Text>
                    <Text style={[styles.infoVal, { color: colors.text }]}>
                      {selectedInfoMessage.forwarded ? 'Có' : 'Không'}
                    </Text>
                  </View>

                  <View style={{ marginTop: 12 }}>
                    <Text style={[styles.infoSectionTitle, { color: colors.tint }]}>Cảm xúc nhận được ({selectedInfoMessage.reactions?.length || 0})</Text>
                    {(!selectedInfoMessage.reactions || selectedInfoMessage.reactions.length === 0) ? (
                      <Text style={{ fontStyle: 'italic', fontSize: 12, color: colors.textSecondary, marginTop: 4 }}>Chưa có ai thả cảm xúc.</Text>
                    ) : (
                      selectedInfoMessage.reactions.map((react, index) => (
                        <View key={index} style={styles.infoReactRow}>
                          <Text style={{ fontSize: 13, color: colors.text, flex: 1 }}>{react.user_name}</Text>
                          <Text style={{ fontSize: 16 }}>{react.reaction}</Text>
                        </View>
                      ))
                    )}
                  </View>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* 4. Reactions Viewer Detailed Popup */}
      <Modal
        visible={reactionsViewerVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setReactionsViewerVisible(false)}
      >
        <TouchableOpacity 
          style={styles.modalCenterOverlay}
          activeOpacity={1}
          onPress={() => setReactionsViewerVisible(false)}
        >
          <View style={[styles.reactionsViewerDialog, { backgroundColor: colors.card }]}>
            <View style={styles.forwardHeader}>
              <Text style={[styles.forwardTitle, { color: colors.text }]}>Biểu cảm tin nhắn</Text>
              <TouchableOpacity onPress={() => setReactionsViewerVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            {selectedReactionsMessage && (
              <FlatList
                data={selectedReactionsMessage.reactions}
                keyExtractor={(item, index) => index.toString()}
                renderItem={({ item }) => (
                  <View style={styles.reactViewerRow}>
                    <Text style={[styles.reactViewerName, { color: colors.text }]}>{item.user_name}</Text>
                    <Text style={{ fontSize: 20 }}>{item.reaction}</Text>
                  </View>
                )}
              />
            )}
          </View>
        </TouchableOpacity>
      </Modal>
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
  pinnedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    justifyContent: 'space-between',
  },
  pinnedBannerInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pinnedBannerTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  pinnedBannerContent: {
    fontSize: 11,
    marginTop: 1,
  },
  pinnedBannerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pinnedBannerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
  },
  pinnedBannerBtnText: {
    fontSize: 11,
    fontWeight: '700',
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
    bottom: 65,
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
  replyPreviewBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  replyIndicator: {
    width: 4,
    height: '100%',
    borderRadius: 2,
  },
  replySenderText: {
    fontSize: 11,
    fontWeight: '700',
  },
  replyMessageText: {
    fontSize: 12,
    marginTop: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
  },
  bottomSheetContainer: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    paddingHorizontal: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 24,
    alignItems: 'center',
    ...(Platform.OS === 'web' ? {
      borderRadius: 10,
      width: 170,
      alignSelf: 'center',
      marginBottom: 'auto',
      marginTop: 'auto',
      shadowOpacity: 0.15,
      shadowRadius: 10,
      elevation: 5,
      paddingHorizontal: 4,
      paddingTop: 4,
      paddingBottom: 4,
      alignItems: 'stretch',
    } : {})
  },
  sheetHeaderIndicator: {
    width: 40,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#cbd5e1',
    marginBottom: 16,
  },
  sheetReactionsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    paddingVertical: Platform.OS === 'web' ? 4 : 12,
    paddingHorizontal: Platform.OS === 'web' ? 6 : 16,
    borderRadius: 30,
    borderWidth: 1,
    marginBottom: Platform.OS === 'web' ? 4 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  sheetReactionEmojiBtn: {
    padding: Platform.OS === 'web' ? 2 : 4,
    transform: [{ scale: Platform.OS === 'web' ? 0.8 : 1.15 }],
  },
  sheetReactionEmoji: {
    fontSize: Platform.OS === 'web' ? 16 : 26,
  },
  sheetMenuOptions: {
    width: '100%',
    gap: 2,
  },
  sheetOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Platform.OS === 'web' ? 4 : 14,
    paddingHorizontal: Platform.OS === 'web' ? 6 : 12,
    borderRadius: Platform.OS === 'web' ? 6 : 12,
    gap: Platform.OS === 'web' ? 8 : 14,
  },
  sheetOptionText: {
    fontSize: Platform.OS === 'web' ? 11 : 14,
    fontWeight: Platform.OS === 'web' ? '500' : '600',
  },
  modalCenterOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  forwardDialog: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  forwardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  forwardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  forwardSearchInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  forwardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  forwardAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  forwardName: {
    fontSize: 14,
    fontWeight: '700',
  },
  forwardSendBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
  infoDialog: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 20,
    padding: 16,
    maxHeight: '80%',
  },
  infoMsgPreview: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  infoDetailsList: {
    gap: 12,
  },
  infoDetailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#e2e8f0',
  },
  infoLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
  infoVal: {
    fontSize: 13,
    fontWeight: '700',
  },
  infoSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 6,
  },
  infoReactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f1f5f9',
  },
  reactionsViewerDialog: {
    width: '100%',
    maxWidth: 320,
    maxHeight: 280,
    borderRadius: 20,
    padding: 16,
  },
  reactViewerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f1f5f9',
  },
  reactViewerName: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: 0.5,
    width: '100%',
    marginVertical: 4,
  }
});
