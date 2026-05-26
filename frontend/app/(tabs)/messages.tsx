// frontend/app/(tabs)/messages.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { API_BASE_URL, endpoints } from '@/constants/Config';
import io from 'socket.io-client';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUser } from '../../context/UserContext';
import { MessageItem } from '../../components/MessageItem';
import * as ImagePicker from 'expo-image-picker';
import { EmojiPanel } from '../../components/EmojiPanel';
import { ScreenshotPreviewModal } from '../../components/ScreenshotPreviewModal';


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

interface ChatThread {
  id: string; // conversation_id
  name: string;
  avatar: string;
  lastMessage: string;
  time: string;
  unreadCount: number;
  online: boolean;
  type: 'direct' | 'group';
  otherUser?: {
    user_id: number;
    name: string;
    avatar: string;
    role: string;
    email: string;
  } | null;
}

interface User {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  status: 'active' | 'inactive';
}

export default function MessagesScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useUser();

  const currentUser = user || {
    id: 1,
    name: 'Admin',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80',
    role: 'admin'
  };

  // State quản lý luồng
  const [activeThread, setActiveThread] = useState<ChatThread | null>(null);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  
  // Phân trang tin nhắn
  const [page, setPage] = useState(1);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(true);

  // Nhập tin nhắn & Typing
  const [inputMessage, setInputMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [otherUserTyping, setOtherUserTyping] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);

  // Xem ảnh phóng to toàn màn hình
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);

  // Emoji panel — Messenger-style slide-up (KHÔNG dùng modal)
  const [showEmojiPanel, setShowEmojiPanel] = useState(false);
  const [recentEmojis, setRecentEmojis] = useState<string[]>([]);

  // Modal chọn user bắt đầu chat
  const [newChatModalVisible, setNewChatModalVisible] = useState(false);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  
  // Cấu hình Chụp màn hình (Screenshot Quick Share)
  const [screenshotModalVisible, setScreenshotModalVisible] = useState(false);
  const [capturedImagePath, setCapturedImagePath] = useState<string | null>(null);
  const socketRef = useRef<any>(null);
  const typingTimeoutRef = useRef<any>(null);
  const activeThreadRef = useRef<ChatThread | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const inputRef = useRef<TextInput>(null);

  // Bật LayoutAnimation trên Android (cần thiết cho slide animation mượt)
  useEffect(() => {
    if (Platform.OS === 'android') {
      UIManager.setLayoutAnimationEnabledExperimental?.(true);
    }
  }, []);

  // Lắng nghe sự kiện bàn phím: khi bàn phím mở → đóng emoji panel
  useEffect(() => {
    const event = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(event, () => {
      if (showEmojiPanel) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setShowEmojiPanel(false);
      }
    });
    return () => sub.remove();
  }, [showEmojiPanel]);

  // Đồng bộ activeThreadRef với activeThread state để giải quyết vấn đề Stale Closure trong các callbacks của Socket
  useEffect(() => {
    activeThreadRef.current = activeThread;
  }, [activeThread]);

  // 1. Tải danh sách các cuộc hội thoại từ API
  const fetchConversations = async (silent = false) => {
    if (!silent) setLoadingThreads(true);
    try {
      const response = await fetch(`${API_BASE_URL}/conversations?user_id=${currentUser.id}`);
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        setThreads(result.data);
      }
    } catch (error) {
      console.error("Lỗi khi tải danh sách hội thoại:", error);
    } finally {
      if (!silent) setLoadingThreads(false);
    }
  };

  // 2. Khởi tạo kết nối Socket.IO & Đăng ký sự kiện
  useEffect(() => {
    let socketUrl = API_BASE_URL;
    if (socketUrl.includes('onrender.com')) {
      // Trên môi trường Render production, Socket.IO chạy cùng cổng với HTTP
      socketUrl = socketUrl.replace(/\/api$/, '').replace(/\/$/, '');
    } else if (socketUrl.includes(':3000')) {
      // Nếu API_BASE_URL đã ở cổng 3000, chỉ cần loại bỏ hậu tố /api
      socketUrl = socketUrl.replace(/\/api$/, '').replace(/\/$/, '');
    } else {
      socketUrl = socketUrl.replace('/app-assign-tasks/api', ':3000').replace('/api', ':3000');
    }
    console.log(`🔌 Đang kết nối Socket.IO Client tới: ${socketUrl}`);

    socketRef.current = io(socketUrl, {
      transports: ['polling', 'websocket'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });

    const socket = socketRef.current;

    socket.on('connect', () => {
      console.log('🟢 Đã kết nối Socket.IO thành công!');
      // Đăng ký trạng thái trực tuyến
      socket.emit('join', currentUser);

      // Nếu đang mở một phòng chat, hãy tự động rejoin room đó trên socket server để tiếp tục nhận chỉ báo gõ chữ, v.v.
      const currentActive = activeThreadRef.current;
      if (currentActive) {
        socket.emit('join_room', {
          conversation_id: currentActive.id,
          user_id: currentUser.id
        });
      }
    });

    // Cập nhật danh sách người dùng Online realtime
    socket.on('update_online_users', (onlineUsers: any[]) => {
      setThreads(prevThreads => 
        prevThreads.map(thread => {
          if (thread.type === 'direct' && thread.otherUser) {
            const isOnline = onlineUsers.some(ou => ou.id === thread.otherUser?.user_id);
            return { ...thread, online: isOnline };
          }
          return thread;
        })
      );
    });

    // Nhận tin nhắn realtime (Đã sửa lỗi không cập nhật UI bằng cách dùng activeThreadRef)
    socket.on('receive_message', (msg: Message) => {
      console.log('📨 Nhận tin nhắn mới realtime qua socket:', msg);
      
      const currentActive = activeThreadRef.current;
      
      // Nếu đang mở đúng phòng chat đó thì cập nhật trực tiếp mảng messages
      if (currentActive && String(currentActive.id) === String(msg.conversation_id)) {
        setMessages((prev) => {
          // Tránh trùng lặp tin nhắn
          if (prev.some(m => m.id === msg.id)) return prev;
          return [msg, ...prev];
        });

        // Tự động cuộn FlatList xuống cuối (index 0) cho tin nhắn mới nhất
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }, 100);

        // Gửi sự kiện đã đọc (seen) tin nhắn lên server
        socket.emit('seen_message', {
          conversation_id: msg.conversation_id,
          user_id: currentUser.id,
          message_id: msg.id
        });
      } else {
        // Nếu tin nhắn mới không thuộc phòng chat đang mở: Tăng số lượng tin nhắn chưa đọc (unread count)
        setThreads((prevThreads) => 
          prevThreads.map((t) => {
            if (String(t.id) === String(msg.conversation_id)) {
              return {
                ...t,
                lastMessage: msg.message,
                time: msg.created_at,
                unreadCount: (t.unreadCount || 0) + 1
              };
            }
            return t;
          })
        );
      }

      // Cập nhật lại danh sách cuộc trò chuyện ở inbox một cách âm thầm
      fetchConversations(true);
    });

    // Chỉ báo đang gõ chữ (Typing Indicator)
    socket.on('user_typing', (data: { conversation_id: string, userId: number, userName: string, isTyping: boolean }) => {
      const currentActive = activeThreadRef.current;
      if (currentActive && String(currentActive.id) === String(data.conversation_id) && data.userId !== currentUser.id) {
        setOtherUserTyping(data.isTyping ? data.userName : null);
      }
    });



    socket.on('connect_error', () => {
      console.log('⚠️ Kết nối socket lỗi, đang tự động kết nối lại...');
    });

    // Tích hợp lắng nghe ảnh chụp màn hình từ Electron IPC
    if (window.electronAPI && typeof window.electronAPI.onScreenshotCaptured === 'function') {
      window.electronAPI.onScreenshotCaptured((filePath) => {
        console.log('📸 Nhận đường dẫn ảnh chụp màn hình từ Electron:', filePath);
        setCapturedImagePath(filePath);
        setScreenshotModalVisible(true);
      });
    }

    fetchConversations();

    // Hủy đăng ký tất cả các sự kiện để dọn dẹp sạch sẽ tránh trùng lặp listeners/rò rỉ bộ nhớ
    return () => {
      if (socket) {
        socket.off('connect');
        socket.off('update_online_users');
        socket.off('receive_message');
        socket.off('user_typing');
        socket.off('connect_error');
        socket.disconnect();
      }
    };
  }, []);

  // 3. Tải tin nhắn trong cuộc trò chuyện (Có phân trang)
  const fetchMessages = async (conversationId: string, pageNum: number, append = false) => {
    if (loadingMessages) return;
    setLoadingMessages(true);
    try {
      const response = await fetch(`${API_BASE_URL}/messages?conversation_id=${conversationId}&page=${pageNum}&limit=30`);
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

  // Click vào cuộc hội thoại
  const handleSelectThread = (thread: ChatThread) => {
    setActiveThread(thread);
    setPage(1);
    setHasMoreMessages(true);
    setMessages([]);
    setOtherUserTyping(null);
    setShowAttachMenu(false);

    // Xóa số tin nhắn chưa đọc của cuộc hội thoại này trên UI
    setThreads(prevThreads =>
      prevThreads.map(t => String(t.id) === String(thread.id) ? { ...t, unreadCount: 0 } : t)
    );

    // Join room trên socket
    if (socketRef.current) {
      socketRef.current.emit('join_room', {
        conversation_id: thread.id,
        user_id: currentUser.id
      });
    }

    fetchMessages(thread.id, 1);
  };

  // Quay lại hòm thư chính
  const handleBackToInbox = () => {
    if (activeThread && socketRef.current) {
      socketRef.current.emit('leave_room', {
        conversation_id: activeThread.id,
        user_id: currentUser.id
      });
    }
    setActiveThread(null);
    setShowAttachMenu(false);
    setShowEmojiPanel(false);
    fetchConversations(true);
  };

  // Cuộn lên đầu flatlist (đọc tin nhắn cũ hơn)
  const handleLoadMoreMessages = () => {
    if (hasMoreMessages && !loadingMessages && activeThread) {
      fetchMessages(activeThread.id, page + 1, true);
    }
  };

  // Gửi tin nhắn qua Socket
  const handleSendMessage = () => {
    if (!inputMessage.trim() || !activeThread) return;

    if (socketRef.current) {
      socketRef.current.emit('send_message', {
        conversation_id: activeThread.id,
        sender_id: currentUser.id,
        message: inputMessage.trim(),
        type: 'text'
      });

      // Stop typing immediately
      socketRef.current.emit('stop_typing', {
        conversation_id: activeThread.id,
        user_id: currentUser.id
      });
    }

    setInputMessage('');
    setIsTyping(false);
    setShowAttachMenu(false);

    // Giữ focus cho TextInput để bàn phím không bị ẩn đi trên điện thoại (Keyboard persistence)
    inputRef.current?.focus();

    // Cuộn mượt xuống dưới cùng (vị trí tin nhắn mới gửi)
    setTimeout(() => {
      flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
    }, 100);
  };

  // Trực tiếp kích hoạt Electron chụp màn hình
  const handleTriggerScreenshot = (excludeSelf: boolean = true) => {
    if (window.electronAPI && typeof window.electronAPI.captureScreen === 'function') {
      window.electronAPI.captureScreen({ excludeSelf });
    } else {
      Alert.alert("Chức năng Desktop", "Tính năng chụp màn hình nhanh chỉ khả dụng trên ứng dụng Desktop!");
    }
  };

  // Upload và gửi tin nhắn ảnh vừa crop realtime (Upload ngầm background async)
  const handleSendScreenshot = async (caption: string, base64Data: string) => {
    try {
      setScreenshotModalVisible(false);
      setUploadingMedia(true);
      
      // 1. Chuyển đổi base64 thành Blob nhị phân để upload
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

      // 2. Upload ngầm lên máy chủ Node Express (Async Background Upload)
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (response.ok && result.status === 'success') {
        const fileUrl = result.file_url;
        
        // 3. Phát tin nhắn qua socket.io
        if (socketRef.current) {
          socketRef.current.emit('send_message', {
            conversation_id: activeThread?.id,
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

  // Click xem ảnh phóng to toàn màn hình
  const handlePressImage = useCallback((url: string) => {
    setSelectedImage(url);
    setImageModalVisible(true);
  }, []);

  // Chọn ảnh/video và tải lên server
  const handlePickMedia = async (mediaType: 'image' | 'video') => {
    // 1. Yêu cầu quyền truy cập thư viện ảnh/video
    const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (permissionResult.granted === false) {
      Alert.alert("Quyền truy cập", "Bạn cần cấp quyền truy cập thư viện ảnh để tải phương tiện lên!");
      return;
    }

    // 2. Mở thư viện tệp tin
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
      // 3. Chuẩn bị FormData tệp tin nhị phân
      const formData = new FormData();
      // Xác định extension an toàn và chuẩn xác (tránh lỗi parse blob url trên Web)
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
      } else if (pickedAsset.fileName) {
        const nameParts = pickedAsset.fileName.split('.');
        if (nameParts.length > 1) {
          fileExt = nameParts.pop()?.toLowerCase() || fileExt;
        }
      } else if (pickedUri.includes('.')) {
        const possibleExt = pickedUri.split('.').pop()?.split('?')[0].split('#')[0].toLowerCase();
        if (possibleExt && possibleExt.length <= 5 && /^[a-z0-9]+$/.test(possibleExt)) {
          fileExt = possibleExt;
        }
      }

      const fileName = `upload_${Date.now()}.${fileExt}`;
      const fileType = pickedAsset.mimeType || (isVideo ? 'video/mp4' : 'image/jpeg');

      // Tạo tệp tin tương thích hoàn hảo giữa môi trường Web và Mobile Native
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
      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });

      const responseText = await response.text();
      let uploadResult;
      try {
        uploadResult = JSON.parse(responseText);
      } catch (parseError) {
        console.error("❌ Lỗi phân tích JSON từ server. Phản hồi thực tế là:", responseText);
        Alert.alert("Lỗi phản hồi", "Máy chủ trả về phản hồi không hợp lệ. Vui lòng xem log console hoặc kiểm tra cấu hình server!");
        setUploadingMedia(false);
        return;
      }

      if (response.ok && uploadResult.status === 'success') {
        const fileUrl = uploadResult.file_url;

        // 5. Phát tin nhắn đính kèm tệp tin qua Socket
        if (socketRef.current) {
          socketRef.current.emit('send_message', {
            conversation_id: activeThread?.id,
            sender_id: currentUser.id,
            message: isVideo ? '[Video]' : '[Hình ảnh]',
            type: isVideo ? 'file' : 'image', // type trong MySQL: 'text', 'image', 'file'
            file_url: fileUrl
          });
        }
        
        // Cuộn mượt FlatList xuống vị trí tin nhắn mới
        setTimeout(() => {
          flatListRef.current?.scrollToOffset({ offset: 0, animated: true });
        }, 150);
      } else {
        Alert.alert("Lỗi tải lên", uploadResult.message || "Không thể tải tệp lên.");
      }
    } catch (error) {
      console.error("Lỗi khi tải ảnh/video:", error);
      Alert.alert("Lỗi kết nối", "Không thể kết nối đến máy chủ. Vui lòng kiểm tra server!");
    } finally {
      setUploadingMedia(false);
    }
  };

  // Xử lý typing indicator
  const handleTextChange = (text: string) => {
    setInputMessage(text);

    if (socketRef.current && activeThread) {
      if (!isTyping) {
        setIsTyping(true);
        socketRef.current.emit('typing', {
          conversation_id: activeThread.id,
          user_id: currentUser.id,
          user_name: currentUser.name
        });
      }

      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setIsTyping(false);
        socketRef.current.emit('stop_typing', {
          conversation_id: activeThread.id,
          user_id: currentUser.id
        });
      }, 2000);
    }
  };

  // Chọn emoji: append vào input, KHÔNG đóng panel, cập nhật recent
  const handlePickEmoji = useCallback((emoji: string) => {
    setInputMessage(prev => prev + emoji);
    setRecentEmojis(prev => {
      const filtered = prev.filter(e => e !== emoji);
      return [emoji, ...filtered].slice(0, 32);
    });
  }, []);

  // Toggle emoji panel — Messenger style:
  // - Mở: dismiss keyboard → slide panel lên
  // - Đóng: ẩn panel, optionally focus input
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

  // Mở danh sách User mới để Chat
  const handleOpenNewChat = async () => {
    setNewChatModalVisible(true);
    setLoadingUsers(true);
    try {
      const response = await fetch(endpoints.users);
      const result = await response.json();
      if (response.ok && result.status === 'success') {
        // Lọc không cho hiển thị chính mình trong danh sách chọn
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
        // Tạo đối tượng ChatThread giả để mở ngay phòng chat
        const newThread: ChatThread = {
          id: result.conversation_id,
          name: targetUser.name,
          avatar: targetUser.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80',
          lastMessage: '',
          time: '',
          unreadCount: 0,
          online: false,
          type: 'direct',
          otherUser: {
            user_id: targetUser.id,
            name: targetUser.name,
            avatar: targetUser.avatar || '',
            role: targetUser.role,
            email: targetUser.email
          }
        };
        
        handleSelectThread(newThread);
      } else {
        Alert.alert('Lỗi', 'Không thể khởi tạo cuộc hội thoại.');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ.');
    }
  };



  const renderThreadItem = ({ item }: { item: ChatThread }) => (
    <TouchableOpacity
      style={[styles.threadCard, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={() => handleSelectThread(item)}
    >
      <View style={styles.avatarWrapper}>
        <Image source={{ uri: item.avatar }} style={styles.threadAvatar} />
        {item.online && (
          <View style={[styles.onlineIndicator, { borderColor: colors.card }]} />
        )}
      </View>

      <View style={styles.threadInfo}>
        <View style={styles.threadHeader}>
          <Text style={[
            styles.threadName, 
            { 
              color: colors.text,
              fontWeight: (item.unreadCount || 0) > 0 ? '800' : '700'
            }
          ]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[
            styles.threadTime,
            {
              color: (item.unreadCount || 0) > 0 ? colors.tint : '#a0aec0',
              fontWeight: (item.unreadCount || 0) > 0 ? '700' : '400'
            }
          ]}>{item.time}</Text>
        </View>
        <View style={styles.threadBody}>
          <Text style={[
            styles.lastMsg, 
            { 
              color: (item.unreadCount || 0) > 0 ? colors.text : colors.textSecondary,
              fontWeight: (item.unreadCount || 0) > 0 ? '700' : '400' 
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

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      {activeThread ? (
        // ================== CHI TIẾT PHÒNG CHAT (Messenger Style) ==================
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}
        >
          {/* Chat Header */}
          <View style={[styles.chatHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <TouchableOpacity style={styles.backBtn} onPress={handleBackToInbox}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </TouchableOpacity>

            <View style={styles.headerInfo}>
              <Text style={[styles.headerName, { color: colors.text }]} numberOfLines={1}>
                {activeThread.name}
              </Text>
              <Text style={styles.headerStatus}>
                {activeThread.online ? '🟢 Đang hoạt động' : '⚪ Ngoại tuyến'}
              </Text>
            </View>


          </View>

          {/* Messages stream (FlatList inverted, hiệu năng tối ưu production) */}
          <FlatList
            ref={flatListRef}
            data={messages}
            extraData={messages}
            keyExtractor={(item) => item.id.toString()}
            contentContainerStyle={styles.messageStream}
            inverted
            initialNumToRender={15}
            windowSize={5}
            maxToRenderPerBatch={10}
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
              />
            )}
          />

          {/* Typing Indicator bottom overlay */}
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

          {/* Input Bar */}
          <View style={[styles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
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

            {!!(window.electronAPI && window.electronAPI.isElectron()) && (
              <TouchableOpacity
                style={{ padding: 8, marginRight: 4 }}
                onPress={() => handleTriggerScreenshot(true)} // Mặc định chụp ẩn cửa sổ app
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
              blurOnSubmit={false} // Ngăn bàn phím tự động ẩn khi người dùng nhấn Enter/Submit trên bàn phím ảo
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

          {/* ── Emoji Panel — Messenger-style slide-up (KHÔNG dùng modal) ──
               Panel nằm BÊN TRONG KeyboardAvoidingView, phía dưới Input Bar.
               Khi hiện: keyboard dismiss, panel chiếm 300px từ dưới, FlatList thu nhỏ.
               Khi ẩn: panel collapse về 0, FlatList mở rộng lại.
               LayoutAnimation đảm bảo transition mượt không giật layout. */}
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
        </KeyboardAvoidingView>
      ) : (
        // ================== HÒM THƯ / DANH SÁCH CHAT ==================
        <>
          <View style={styles.inboxHeader}>
            <Text style={[styles.inboxTitle, { color: colors.text }]}>Hộp thư của bạn</Text>
            <TouchableOpacity style={styles.newChatBtn} onPress={handleOpenNewChat}>
              <Ionicons name="create-outline" size={22} color={colors.tint} />
            </TouchableOpacity>
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
              <Ionicons name="chatbubbles-outline" size={48} color="#cbd5e1" />
              <Text style={{ color: colors.textSecondary, marginTop: 12, fontSize: 14 }}>Chưa có cuộc trò chuyện nào.</Text>
            </View>
          )}
        </>
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



      {/* ================== FULL SCREEN IMAGE VIEWER MODAL ================== */}
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

      {/* ================== SCREENSHOT QUICK SHARE PREVIEW MODAL ================== */}
      <ScreenshotPreviewModal
        visible={screenshotModalVisible}
        imagePath={capturedImagePath}
        onClose={() => {
          setScreenshotModalVisible(false);
          setCapturedImagePath(null);
        }}
        onSend={handleSendScreenshot}
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
  // Chat window styles
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
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionIcon: {
    padding: 8,
  },
  messageStream: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
  },
  messageRow: {
    flexDirection: 'row',
    maxWidth: '80%',
  },
  myMessageRow: {
    alignSelf: 'flex-end',
  },
  otherMessageRow: {
    alignSelf: 'flex-start',
  },
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    alignSelf: 'flex-end',
  },
  messageContentWrapper: {
    gap: 4,
  },
  messageSenderName: {
    fontSize: 10,
    color: '#727785',
    marginLeft: 4,
    fontWeight: '600',
  },
  messageBubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    paddingRight: 4,
  },
  messageTime: {
    fontSize: 10,
    color: '#a0aec0',
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
    paddingVertical: 10,
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
  // Modal chọn user
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
  // Call Overlay
  callingOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  callingContent: {
    alignItems: 'center',
    gap: 20,
    width: '80%',
  },
  callingAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#3b82f6',
  },
  callingName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  callingStatus: {
    color: '#3b82f6',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
  },
  callTimer: {
    color: '#94a3b8',
    fontSize: 16,
    fontWeight: '600',
  },
  callControls: {
    marginTop: 60,
  },
  hangupBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callControlsRow: {
    flexDirection: 'row',
    gap: 30,
    marginTop: 50,
    justifyContent: 'center',
    alignItems: 'center',
  },
  callBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  callBtnText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
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
});
