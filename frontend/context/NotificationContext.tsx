// frontend/context/NotificationContext.tsx
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Platform,
  Animated,
  Dimensions
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSocket } from './SocketContext';
import { useUser } from './UserContext';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useConversationStore } from '../store/useConversationStore';
import { API_BASE_URL } from '@/constants/Config';

export interface NotificationItem {
  id: string;
  title: string;
  body: string;
  type: 'message' | 'task_assigned' | 'task_urged' | 'comment' | 'task_approved' | 'task_rejected';
  createdAt: string;
  isRead: boolean;
  created_by?: number;
  data?: {
    taskId?: number;
    conversationId?: number;
    workspaceId?: number;
  };
}

interface NotificationContextType {
  notifications: NotificationItem[];
  unreadCount: number;
  unreadAssignedCount: number;
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  addNotification: (item: Omit<NotificationItem, 'id' | 'createdAt' | 'isRead'>) => void;
  markAsRead: (id: string) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  playNotificationSound: () => void;
  fetchUnreadAssignedCount: () => Promise<void>;
}

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

const STORAGE_KEY = '@waterpump_notifications_v1';
let lastSoundPlayTime = 0;
const rateLimitCache = new Map<string, number>();

// Web Audio API Synthesizer Fallback
function playWebAudioFallback() {
  if (typeof window === 'undefined') return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    
    const audioContext = new AudioContextClass();
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Microsoft Teams-like notification chime
    osc1.frequency.value = 880; // A5
    osc2.frequency.value = 1320; // E6 (fifth overtone)

    gainNode.gain.setValueAtTime(0.08, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.35);

    osc1.start();
    osc2.start();

    osc1.stop(audioContext.currentTime + 0.35);
    osc2.stop(audioContext.currentTime + 0.35);
  } catch (err) {
    console.warn("Web Audio API synthesis failed:", err);
  }
}

// play notification sound with rate limiter (1 second throttle)
export const playNotificationSound = () => {
  const now = Date.now();
  if (now - lastSoundPlayTime < 1000) return;
  lastSoundPlayTime = now;

  if (Platform.OS === 'web') {
    try {
      // Prioritize file playback, catch restrictions
      const audio = new Audio('/sounds/notification.wav');
      audio.volume = 0.5;
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          playWebAudioFallback();
        });
      }
    } catch (err) {
      playWebAudioFallback();
    }
  } else {
    // For Native or other platforms where Audio is unavailable
    playWebAudioFallback();
  }
};

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const { user } = useUser();
  const { socket } = useSocket();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [activePopup, setActivePopup] = useState<NotificationItem | null>(null);
  const [unreadAssignedCount, setUnreadAssignedCount] = useState(0);

  // Fetch count of unread tasks assigned to me
  const fetchUnreadAssignedCount = async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/stats`);
      const result = await res.json();
      if (result.status === 'success' && result.data && result.data.assigned_to_me) {
        setUnreadAssignedCount(result.data.assigned_to_me.unread_assigned_count || 0);
      }
    } catch (err) {
      console.error("Error fetching unread assigned count:", err);
    }
  };

  useEffect(() => {
    if (user) {
      fetchUnreadAssignedCount();
    } else {
      setUnreadAssignedCount(0);
    }
  }, [user]);

  const slideAnim = useRef(new Animated.Value(-100)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const popupTimerRef = useRef<any>(null);

  const { width: windowWidth } = Dimensions.get('window');

  // Load notifications from local storage on user change
  useEffect(() => {
    if (user) {
      AsyncStorage.getItem(`${STORAGE_KEY}_${user.id}`)
        .then(data => {
          if (data) {
            setNotifications(JSON.parse(data));
          } else {
            setNotifications([]);
          }
        })
        .catch(err => console.error("Error loading notifications:", err));
      
      // Request Desktop notifications permission on web
      if (Platform.OS === 'web' && 'Notification' in window) {
        if (Notification.permission === 'default') {
          Notification.requestPermission();
        }
      }
    } else {
      setNotifications([]);
    }
  }, [user]);

  // Save notifications to storage
  const saveNotifications = async (items: NotificationItem[]) => {
    if (!user) return;
    try {
      await AsyncStorage.setItem(`${STORAGE_KEY}_${user.id}`, JSON.stringify(items));
    } catch (err) {
      console.error("Error saving notifications:", err);
    }
  };

  // Drawer Toggle
  const openDrawer = () => setIsDrawerOpen(true);
  const closeDrawer = () => setIsDrawerOpen(false);

  // In-app Popup controls
  const showPopup = (item: NotificationItem) => {
    if (popupTimerRef.current) clearTimeout(popupTimerRef.current);
    setActivePopup(item);

    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 20,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      })
    ]).start();

    popupTimerRef.current = setTimeout(() => {
      hidePopup();
    }, 4500);
  };

  const hidePopup = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 250,
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 250,
        useNativeDriver: true,
      })
    ]).start(() => {
      setActivePopup(null);
    });
  };

  // Add notification with 100 limit, anti-spam, and filter-out self actions
  const addNotification = (item: Omit<NotificationItem, 'id' | 'createdAt' | 'isRead'>) => {
    if (!user) return;

    // 1. DO NOT show notification for own actions
    if (item.created_by && Number(item.created_by) === Number(user.id)) {
      console.log("[NOTIFY] Ignoring self-action event");
      return;
    }

    // 2. Anti-spam / Deduplication within 5 seconds
    const entityId = item.data?.taskId || item.data?.conversationId || 0;
    const dedupKey = `${item.type}_${entityId}`;
    const now = Date.now();
    const lastTime = rateLimitCache.get(dedupKey);
    if (lastTime && now - lastTime < 5000) {
      console.log(`[DEDUP] Suppressing duplicate notification for key: ${dedupKey}`);
      return;
    }
    rateLimitCache.set(dedupKey, now);

    const newNotify: NotificationItem = {
      ...item,
      id: Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString(),
      isRead: false
    };

    setNotifications(prev => {
      // 3. Keep maximum 100 notifications (Enterprise requirement)
      const updated = [newNotify, ...prev].slice(0, 100);
      saveNotifications(updated);
      return updated;
    });

    // 4. Trigger alert based on visibility
    const isTabHidden = Platform.OS === 'web' && document.hidden === true;
    
    // Play ting sound
    playNotificationSound();

    if (isTabHidden) {
      // Desktop alert
      if (Platform.OS === 'web' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(newNotify.title, {
          body: newNotify.body,
          icon: '/icon-192.png'
        });
      }
    } else {
      // Active tab -> check if we are in the active conversation chat
      const activeConvId = useConversationStore.getState().activeConversationId;
      if (item.type === 'message' && item.data?.conversationId && String(item.data.conversationId) === String(activeConvId)) {
        // Current chat page open -> ONLY play sound, DO NOT show popup alert
        return;
      }
      showPopup(newNotify);
    }
  };

  const markAsRead = (id: string) => {
    setNotifications(prev => {
      const updated = prev.map(n => n.id === id ? { ...n, isRead: true } : n);
      saveNotifications(updated);
      return updated;
    });
  };

  const markAllAsRead = () => {
    setNotifications(prev => {
      const updated = prev.map(n => ({ ...n, isRead: true }));
      saveNotifications(updated);
      return updated;
    });
  };

  const clearAll = () => {
    setNotifications([]);
    saveNotifications([]);
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  // Click handler with proper workspace & task detail loading redirects
  const handleNotificationClick = (item: NotificationItem) => {
    markAsRead(item.id);
    hidePopup();

    if (item.type === 'message' && item.data?.conversationId) {
      router.push(`/chat/${item.data.conversationId}` as any);
    } else if (item.data?.taskId) {
      if (item.data.workspaceId) {
        // Navigate directly to Workspace details with taskId query parameter to auto-scroll & open modal
        router.push(`/workspace/${item.data.workspaceId}?taskId=${item.data.taskId}` as any);
      } else {
        // Fallback to Tasks main tab
        router.push(`/tasks?taskId=${item.data.taskId}` as any);
      }
    }
  };

  // Socket integration (Safely register listeners on context mount)
  useEffect(() => {
    if (!socket || !user) return;

    // A. Tin nhắn mới
    const handleReceiveMessage = (msg: any) => {
      if (!msg || Number(msg.sender_id) === Number(user.id)) return;
      addNotification({
        title: `💬 Tin nhắn mới`,
        body: `${msg.sender_name || 'Đồng nghiệp'}:\n${msg.message || '[Hình ảnh]'}`,
        type: 'message',
        created_by: msg.sender_id,
        data: {
          conversationId: msg.conversation_id
        }
      });
    };

    // B. Được giao nhiệm vụ
    const handleTaskAssigned = (data: any) => {
      if (!data || !data.task) return;
      const creatorId = data.creator?.id || data.task.created_by;
      
      // Refresh count
      fetchUnreadAssignedCount();

      if (Number(creatorId) === Number(user.id)) return;
      
      const creatorName = data.creator?.name || 'Hệ thống';
      const taskTitle = data.task.title;
      const dueDate = data.task.deadline ? new Date(data.task.deadline).toLocaleDateString('vi-VN') : 'Không có';
      
      let priorityText = 'Thấp';
      if (data.task.priority === 'high') priorityText = 'Cao';
      else if (data.task.priority === 'medium') priorityText = 'Trung bình';

      const bodyText = `Người giao: ${creatorName}\nTiêu đề: ${taskTitle}\nHạn: ${dueDate}\nƯu tiên: ${priorityText}`;

      addNotification({
        title: `🎯 Bạn được giao nhiệm vụ mới`,
        body: bodyText,
        type: 'task_assigned',
        created_by: creatorId,
        data: {
          taskId: data.task.id,
          workspaceId: data.task.workspace_id
        }
      });
    };

    // C. Hối thúc nhiệm vụ
    const handleTaskUrged = (data: any) => {
      if (!data || !data.task) return;
      fetchUnreadAssignedCount();
      // Socket urges are emitted to recipient. Creator urged it.
      addNotification({
        title: `⚡ Hối thúc nhiệm vụ`,
        body: `Bạn đang được nhắc hoàn thành:\n${data.task.title}`,
        type: 'task_urged',
        created_by: data.task.created_by || undefined,
        data: {
          taskId: data.task.id,
          workspaceId: data.task.workspace_id
        }
      });
    };

    // D. Bình luận mới
    const handleCommentCreated = (data: any) => {
      if (!data || !data.comment || Number(data.comment.user_id) === Number(user.id)) return;
      // Broadcast globally. Check if task concerns user.
      addNotification({
        title: `💬 Bình luận mới`,
        body: `${data.comment.user_name || 'Đồng nghiệp'} vừa bình luận trong công việc`,
        type: 'comment',
        created_by: data.comment.user_id,
        data: {
          taskId: data.taskId
        }
      });
    };

    // E. Nhiệm vụ được duyệt
    const handleTaskApproved = (task: any) => {
      fetchUnreadAssignedCount();
      if (!task || Number(task.approved_by) === Number(user.id)) return;
      // Target assignee gets alert
      const isAssignee = task.assigned_to === user.id || task.assignees?.some((a: any) => a.user_id === user.id);
      if (!isAssignee) return;

      addNotification({
        title: `✅ Nhiệm vụ được duyệt`,
        body: task.title || 'Nhiệm vụ đã được duyệt hoàn thành',
        type: 'task_approved',
        created_by: task.approved_by,
        data: {
          taskId: task.id,
          workspaceId: task.workspace_id
        }
      });
    };

    // F. Nhiệm vụ bị trả lại sửa
    const handleTaskRejected = (task: any) => {
      fetchUnreadAssignedCount();
      if (!task || Number(task.created_by) === Number(user.id)) return; // Wait, rejected by admin
      const isAssignee = task.assigned_to === user.id || task.assignees?.some((a: any) => a.user_id === user.id);
      if (!isAssignee) return;

      addNotification({
        title: `🔴 Nhiệm vụ cần chỉnh sửa`,
        body: task.title || 'Nhiệm vụ bị yêu cầu sửa lại',
        type: 'task_rejected',
        created_by: task.approved_by || undefined,
        data: {
          taskId: task.id,
          workspaceId: task.workspace_id
        }
      });
    };

    const handleTaskChangeGlobal = () => {
      fetchUnreadAssignedCount();
    };

    socket.on('receive_message', handleReceiveMessage);
    socket.on('task_assigned', handleTaskAssigned);
    socket.on('task_assigned_notification', handleTaskAssigned);
    socket.on('task_urged', handleTaskUrged);
    socket.on('task_comment_created', handleCommentCreated);
    socket.on('task_approved', handleTaskApproved);
    socket.on('task_rejected', handleTaskRejected);
    
    socket.on('task_created', handleTaskChangeGlobal);
    socket.on('task_updated', handleTaskChangeGlobal);
    socket.on('task_deleted', handleTaskChangeGlobal);
    socket.on('task_completed', handleTaskChangeGlobal);
    socket.on('task_viewed', handleTaskChangeGlobal);

    return () => {
      socket.off('receive_message', handleReceiveMessage);
      socket.off('task_assigned', handleTaskAssigned);
      socket.off('task_assigned_notification', handleTaskAssigned);
      socket.off('task_urged', handleTaskUrged);
      socket.off('task_comment_created', handleCommentCreated);
      socket.off('task_approved', handleTaskApproved);
      socket.off('task_rejected', handleTaskRejected);
      
      socket.off('task_created', handleTaskChangeGlobal);
      socket.off('task_updated', handleTaskChangeGlobal);
      socket.off('task_deleted', handleTaskChangeGlobal);
      socket.off('task_completed', handleTaskChangeGlobal);
      socket.off('task_viewed', handleTaskChangeGlobal);
    };
  }, [socket, user]);

  // Helper values for icon & name in drawer
  const getNotificationIcon = (type: string): any => {
    switch (type) {
      case 'message': return 'chatbubble-ellipses-outline';
      case 'task_assigned': return 'pin-outline';
      case 'task_urged': return 'flash-outline';
      case 'comment': return 'chatbox-ellipses-outline';
      case 'task_approved': return 'checkmark-circle-outline';
      case 'task_rejected': return 'alert-circle-outline';
      default: return 'notifications-outline';
    }
  };

  const getNotificationTypeLabel = (type: string) => {
    switch (type) {
      case 'message': return 'Tin nhắn mới';
      case 'task_assigned': return 'Được giao nhiệm vụ';
      case 'task_urged': return 'Hối thúc nhiệm vụ';
      case 'comment': return 'Bình luận mới';
      case 'task_approved': return 'Nhiệm vụ được duyệt';
      case 'task_rejected': return 'Trả lại sửa';
      default: return 'Thông báo';
    }
  };

  const formatNotifyTime = (isoString: string) => {
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      if (diffMins < 1) return 'Vừa xong';
      if (diffMins < 60) return `${diffMins} phút trước`;
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours} giờ trước`;
      return new Date(isoString).toLocaleDateString('vi-VN');
    } catch {
      return '';
    }
  };

  return (
    <NotificationContext.Provider value={{
      notifications,
      unreadCount,
      unreadAssignedCount,
      isDrawerOpen,
      openDrawer,
      closeDrawer,
      addNotification,
      markAsRead,
      markAllAsRead,
      clearAll,
      playNotificationSound,
      fetchUnreadAssignedCount
    }}>
      {children}

      {/* 1. In-app Overlay alert popup (Teams / Discord style) */}
      {activePopup && (
        <Animated.View style={[
          styles.popupContainer,
          {
            transform: [{ translateY: slideAnim }],
            opacity: fadeAnim,
            backgroundColor: colorScheme === 'dark' ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            borderColor: colors.border,
          }
        ]}>
          <TouchableOpacity 
            style={styles.popupContent} 
            onPress={() => handleNotificationClick(activePopup)}
            activeOpacity={0.9}
          >
            <View style={[styles.popupIconBg, { backgroundColor: colors.tint + '20' }]}>
              <Ionicons 
                name={getNotificationIcon(activePopup.type)} 
                size={22} 
                color={colors.tint} 
              />
            </View>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={[styles.popupTitleText, { color: colors.text }]} numberOfLines={1}>
                {activePopup.title}
              </Text>
              <Text style={[styles.popupBodyText, { color: colors.textSecondary }]} numberOfLines={2}>
                {activePopup.body}
              </Text>
            </View>
            <TouchableOpacity onPress={hidePopup} style={styles.popupCloseBtn}>
              <Ionicons name="close" size={16} color={colors.tabIconDefault} />
            </TouchableOpacity>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* 2. Notification Center Sliding Drawer Modal */}
      <Modal
        visible={isDrawerOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={closeDrawer}
      >
        <View style={styles.drawerOverlay}>
          <TouchableOpacity style={styles.drawerBackdrop} activeOpacity={1} onPress={closeDrawer} />
          <View style={[styles.drawerPanel, { backgroundColor: colors.card, borderLeftColor: colors.border }]}>
            <View style={[styles.drawerHeader, { borderBottomColor: colors.border }]}>
              <Text style={[styles.drawerTitle, { color: colors.text }]}>🔔 Thông báo</Text>
              <TouchableOpacity onPress={closeDrawer} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>
            
            <View style={styles.drawerActions}>
              <TouchableOpacity onPress={markAllAsRead}>
                <Text style={{ color: colors.tint, fontSize: 12.5, fontWeight: '700' }}>Đọc tất cả</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={clearAll}>
                <Text style={{ color: '#ef4444', fontSize: 12.5, fontWeight: '700' }}>Xóa tất cả</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 40 }} style={{ flex: 1 }}>
              {notifications.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="notifications-off-outline" size={48} color={colors.tabIconDefault} style={{ marginBottom: 12 }} />
                  <Text style={{ color: colors.tabIconDefault, fontSize: 13, fontStyle: 'italic' }}>Không có thông báo nào</Text>
                </View>
              ) : (
                notifications.map(item => (
                  <TouchableOpacity
                    key={item.id}
                    style={[
                      styles.notifyCard,
                      { 
                        backgroundColor: colors.background,
                        borderColor: item.isRead ? colors.border : colors.tint + '30',
                        borderLeftColor: item.isRead ? colors.border : colors.tint,
                        borderLeftWidth: item.isRead ? 1 : 4,
                      }
                    ]}
                    onPress={() => handleNotificationClick(item)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4, justifyContent: 'space-between' }}>
                        <Text style={[styles.notifyTypeLabel, { color: colors.tint }]}>
                          {getNotificationTypeLabel(item.type)}
                        </Text>
                        <Text style={{ fontSize: 10, color: colors.tabIconDefault }}>
                          {formatNotifyTime(item.createdAt)}
                        </Text>
                      </View>
                      <Text style={[styles.notifyTitle, { color: colors.text, fontWeight: item.isRead ? '600' : '800' }]} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Text style={[styles.notifyBody, { color: colors.textSecondary }]} numberOfLines={2}>
                        {item.body}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </NotificationContext.Provider>
  );
};

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within a NotificationProvider');
  return context;
};

const styles = StyleSheet.create({
  popupContainer: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 20 : 50,
    right: 20,
    width: Math.min(Dimensions.get('window').width - 40, 360),
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    ...Platform.select({
      web: {
        // blur backdrop for glassmorphism
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.12)',
      },
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 6,
      }
    }),
    zIndex: 99999,
  },
  popupContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  popupIconBg: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  popupTitleText: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 2,
  },
  popupBodyText: {
    fontSize: 12,
    lineHeight: 16,
  },
  popupCloseBtn: {
    padding: 4,
    alignSelf: 'flex-start',
  },
  drawerOverlay: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.3)',
  },
  drawerBackdrop: {
    flex: 1,
  },
  drawerPanel: {
    width: 320,
    height: '100%',
    borderLeftWidth: 1,
    paddingTop: Platform.OS === 'ios' ? 44 : 20,
    paddingHorizontal: 16,
  },
  drawerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  drawerTitle: {
    fontSize: 15.5,
    fontWeight: '800',
  },
  drawerActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    marginBottom: 8,
  },
  notifyCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  notifyTypeLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  notifyTitle: {
    fontSize: 12.5,
    marginBottom: 2,
  },
  notifyBody: {
    fontSize: 11.5,
    lineHeight: 15,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
  }
});
