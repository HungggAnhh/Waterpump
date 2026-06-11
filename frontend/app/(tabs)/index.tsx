// frontend/app/(tabs)/index.tsx
import { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  Image,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { endpoints, API_BASE_URL } from '@/constants/Config';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUser } from '../../context/UserContext';
import { useSocket } from '../../context/SocketContext';
import { useNotifications } from '../../context/NotificationContext';

interface User {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  status: 'active' | 'inactive';
  created_at: string;
}

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  assigned_to: number | null;
  creator_name?: string;
  deadline: string | null;
  completed: boolean;
  approval_status?: 'pending' | 'in_progress' | 'waiting_approval' | 'completed' | 'revision_required';
  created_at: string;
  workspace_id?: number;
}

interface KPIStats {
  total: number;
  pending: number;
  in_progress: number;
  waiting_approval: number;
  revision_required: number;
  completed: number;
  completion_rate: number;
  viewed?: number;
  total_assignments?: number;
  viewed_assignments?: number;
  reported_assignments?: number;
  unreported_assignments?: number;
  in_progress_assignments?: number;
  completed_assignments?: number;
  archived?: {
    total: number;
    this_month: number;
    this_week: number;
  };
  assigned_to_me?: {
    total: number;
    in_progress: number;
    overdue: number;
    due_soon: number;
    completed: number;
    unread_assigned_count: number;
  };
  created_by_me?: {
    total: number;
  };
  overdue?: number;
  user_completed?: number;
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useUser();
  const { socket } = useSocket();
  const { unreadCount, unreadAssignedCount, openDrawer } = useNotifications();

  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<KPIStats>({
    total: 0,
    pending: 0,
    in_progress: 0,
    waiting_approval: 0,
    revision_required: 0,
    completed: 0,
    completion_rate: 0,
    viewed: 0,
    total_assignments: 0,
    viewed_assignments: 0,
    reported_assignments: 0,
    unreported_assignments: 0,
    in_progress_assignments: 0,
    completed_assignments: 0,
    assigned_to_me: {
      total: 0,
      in_progress: 0,
      overdue: 0,
      due_soon: 0,
      completed: 0,
      unread_assigned_count: 0
    },
    created_by_me: {
      total: 0
    },
    overdue: 0,
    user_completed: 0
  });
  const [statsLoading, setStatsLoading] = useState(true);

  const [miniTasks, setMiniTasks] = useState<Task[]>([]);
  const [miniTasksLoading, setMiniTasksLoading] = useState(true);
  const [visibleMiniTasksCount, setVisibleMiniTasksCount] = useState(5);

  // Fetch users list to show active company directory
  const fetchUsers = async () => {
    try {
      const response = await fetch(endpoints.users);
      const result = await response.json();
      if (result.status === 'success') {
        setOnlineUsers(result.data || []);
      }
    } catch (err) {
      console.error('⚠️ [Home] Lỗi lấy danh sách thành viên:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Fetch KPI statistics
  const fetchKPIStats = async () => {
    try {
      setStatsLoading(true);
      const res = await fetch(`${API_BASE_URL}/tasks/stats`);
      const result = await res.json();
      if (result.status === 'success') {
        setStats(result.data || { 
          total: 0, pending: 0, in_progress: 0, waiting_approval: 0, revision_required: 0, completed: 0, completion_rate: 0, viewed: 0,
          assigned_to_me: { total: 0, in_progress: 0, overdue: 0, due_soon: 0, completed: 0, unread_assigned_count: 0 },
          created_by_me: { total: 0 },
          overdue: 0,
          user_completed: 0
        });
      }
    } catch (err) {
      console.error('⚠️ [Home] Lỗi lấy KPI thống kê:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  // Fetch Top 5 important tasks assigned to me
  const fetchMiniTasks = async () => {
    try {
      setMiniTasksLoading(true);
      const res = await fetch(`${API_BASE_URL}/tasks?quick_filter=assigned_to_me`);
      const result = await res.json();
      if (result.status === 'success') {
        const rawTasks = result.data || [];
        
        // Sắp xếp:
        // 1. Overdue: deadline < NOW() and not completed
        // 2. Due soon: deadline >= NOW() and <= NOW() + 3 days and not completed
        // 3. High priority: priority === 'high'
        // 4. Newest: created_at descending
        const sorted = [...rawTasks].sort((a, b) => {
          const isACompleted = a.completed || a.approval_status === 'completed';
          const isBCompleted = b.completed || b.approval_status === 'completed';
          
          const isAOverdue = a.deadline && new Date(a.deadline).getTime() < Date.now() && !isACompleted;
          const isBOverdue = b.deadline && new Date(b.deadline).getTime() < Date.now() && !isBCompleted;
          
          if (isAOverdue && !isBOverdue) return -1;
          if (!isAOverdue && isBOverdue) return 1;
          
          const threeDays = 3 * 24 * 60 * 60 * 1000;
          const isADueSoon = a.deadline && !isACompleted && (new Date(a.deadline).getTime() >= Date.now() && new Date(a.deadline).getTime() <= Date.now() + threeDays);
          const isBDueSoon = b.deadline && !isBCompleted && (new Date(b.deadline).getTime() >= Date.now() && new Date(b.deadline).getTime() <= Date.now() + threeDays);
          
          if (isADueSoon && !isBDueSoon) return -1;
          if (!isADueSoon && isBDueSoon) return 1;
          
          const aPriorityVal = a.priority === 'high' ? 3 : (a.priority === 'medium' ? 2 : 1);
          const bPriorityVal = b.priority === 'high' ? 3 : (b.priority === 'medium' ? 2 : 1);
          
          if (aPriorityVal !== bPriorityVal) return bPriorityVal - aPriorityVal;
          
          return new Date(b.assigned_at || b.created_at).getTime() - new Date(a.assigned_at || a.created_at).getTime();
        });
        
        setMiniTasks(sorted);
      }
    } catch (err) {
      console.error('⚠️ [Home] Lỗi lấy danh sách task rút gọn:', err);
    } finally {
      setMiniTasksLoading(false);
    }
  };

  useEffect(() => {
    fetchKPIStats();
    fetchMiniTasks();
  }, [user]);

  // Realtime Socket updates for KPIs, User Directory, and Mini Tasks
  useEffect(() => {
    if (!socket) return;

    const handleTaskChange = () => {
      console.log('📡 [SOCKET] Realtime: Cập nhật số liệu KPI & Task trang chủ');
      fetchKPIStats();
      fetchMiniTasks();
    };

    const handleUserChange = () => {
      console.log('📡 [SOCKET] Realtime: Cập nhật lại danh sách thành viên trang chủ');
      fetchUsers();
    };

    socket.on('task_created', handleTaskChange);
    socket.on('task_updated', handleTaskChange);
    socket.on('task_deleted', handleTaskChange);
    socket.on('task_completed', handleTaskChange);

    socket.on('user_created', handleUserChange);
    socket.on('user_updated', handleUserChange);
    socket.on('user_deleted', handleUserChange);
    socket.on('user_role_changed', handleUserChange);
    socket.on('user_status_changed', handleUserChange);

    return () => {
      socket.off('task_created', handleTaskChange);
      socket.off('task_updated', handleTaskChange);
      socket.off('task_deleted', handleTaskChange);
      socket.off('task_completed', handleTaskChange);

      socket.off('user_created', handleUserChange);
      socket.off('user_updated', handleUserChange);
      socket.off('user_deleted', handleUserChange);
      socket.off('user_role_changed', handleUserChange);
      socket.off('user_status_changed', handleUserChange);
    };
  }, [socket]);

  // Tính toán nhanh số liệu tài khoản hệ thống cho Admin
  const totalAccounts = onlineUsers.length;
  const adminCount = onlineUsers.filter(u => u.role === 'admin').length;
  const userCount = onlineUsers.filter(u => u.role === 'user').length;
  const activeCount = onlineUsers.filter(u => u.status === 'active').length;
  const lockedCount = onlineUsers.filter(u => u.status === 'inactive').length;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        
        {/* 1. HEADER WELCOME SECTION */}
        <View style={styles.welcomeRow}>
          <View>
            <Text style={[styles.welcomeSubtitle, { color: colors.tabIconDefault }]}>Chào mừng trở lại,</Text>
            <Text style={[styles.welcomeTitle, { color: colors.text }]}>{user?.name || 'Thành viên'} 👋</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <TouchableOpacity onPress={openDrawer} style={{ flexDirection: 'row', alignItems: 'center', position: 'relative', padding: 6 }} activeOpacity={0.7}>
              {unreadAssignedCount > 0 && (
                <View style={{
                  backgroundColor: '#2563eb',
                  borderRadius: 8,
                  minWidth: 18,
                  height: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 4,
                  marginRight: 2,
                }}>
                  <Text style={{ color: '#ffffff', fontSize: 8.5, fontWeight: '800' }}>🎯 {unreadAssignedCount}</Text>
                </View>
              )}
              <View style={{ position: 'relative' }}>
                <Ionicons name="notifications-outline" size={24} color={colors.text} />
                {unreadCount > 0 && (
                  <View style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
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
              </View>
            </TouchableOpacity>
            <Image
              source={{ uri: user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }}
              style={styles.headerAvatar}
            />
          </View>
        </View>

        {/* WIDGET: VIỆC GIAO CHO TÔI */}
        <View style={[styles.widgetContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.widgetHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[styles.widgetTitle, { color: colors.text }]}>🎯 Việc giao cho tôi</Text>
              {stats.assigned_to_me && stats.assigned_to_me.unread_assigned_count > 0 && (
                <View style={styles.unreadBadge}>
                  <Text style={styles.unreadBadgeText}>
                    {stats.assigned_to_me.unread_assigned_count} mới
                  </Text>
                </View>
              )}
            </View>
            <TouchableOpacity 
              onPress={() => router.push({ pathname: '/tasks', params: { tab: 'summary', filter: 'assigned_to_me' } })}
              activeOpacity={0.6}
            >
              <Text style={{ fontSize: 13, fontWeight: '700', color: colors.tint }}>Xem tất cả</Text>
            </TouchableOpacity>
          </View>
          
          {(() => {
            const assignedTotal = stats.assigned_to_me?.total || 0;
            const assignedCompleted = stats.assigned_to_me?.completed || 0;
            const assignedRate = assignedTotal > 0 ? Math.round((assignedCompleted / assignedTotal) * 100) : 0;
            
            return (
              <View 
                style={{
                  borderWidth: 1,
                  borderRadius: 14,
                  padding: 12,
                  backgroundColor: colors.background,
                  borderColor: colors.border,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                  marginHorizontal: 12
                }}
              >
                <View style={{ flex: 1, marginRight: 16 }}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: colors.tabIconDefault, marginBottom: 6, letterSpacing: 0.5 }}>
                    TỶ LỆ HOÀN THÀNH NHIỆM VỤ ĐƯỢC GIAO
                  </Text>
                  <View style={{ height: 6, width: '100%', backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' }}>
                    <View style={{ height: '100%', width: `${assignedRate}%`, backgroundColor: '#10b981', borderRadius: 3 }} />
                  </View>
                  <Text style={{ fontSize: 11, color: colors.tabIconDefault, fontWeight: '600', marginTop: 6 }}>
                    {assignedCompleted} trên tổng số {assignedTotal} nhiệm vụ đã hoàn thành.
                  </Text>
                </View>
                <View style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#ecfdf5', borderRadius: 10, width: 44, height: 44, borderWidth: 1, borderColor: '#10b981' }}>
                  <Text style={{ fontSize: 14, fontWeight: '900', color: '#059669' }}>
                    {assignedRate}%
                  </Text>
                </View>
              </View>
            );
          })()}

          <View style={styles.widgetGrid}>
            {/* 1. Tổng việc */}
            <TouchableOpacity 
              style={[styles.widgetItem, { backgroundColor: colors.background }]} 
              onPress={() => router.push({ pathname: '/tasks', params: { tab: 'summary', filter: 'assigned_to_me' } })}
              activeOpacity={0.7}
            >
              <View style={[styles.widgetIconBg, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="briefcase" size={16} color="#2563EB" />
              </View>
              <Text style={[styles.widgetItemLabel, { color: colors.tabIconDefault }]}>Tổng việc</Text>
              <Text style={[styles.widgetItemValue, { color: colors.text }]}>
                {stats.assigned_to_me?.total || 0}
              </Text>
            </TouchableOpacity>

            {/* 2. Đang thực hiện */}
            <TouchableOpacity 
              style={[styles.widgetItem, { backgroundColor: colors.background }]} 
              onPress={() => router.push({ pathname: '/tasks', params: { tab: 'summary', filter: 'assigned_to_me', status: 'in_progress' } })}
              activeOpacity={0.7}
            >
              <View style={[styles.widgetIconBg, { backgroundColor: '#EFF6FF' }]}>
                <Ionicons name="sync" size={16} color="#2563EB" />
              </View>
              <Text style={[styles.widgetItemLabel, { color: colors.tabIconDefault }]}>Đang làm</Text>
              <Text style={[styles.widgetItemValue, { color: '#2563EB' }]}>
                {stats.assigned_to_me?.in_progress || 0}
              </Text>
            </TouchableOpacity>

            {/* 3. Quá hạn */}
            <TouchableOpacity 
              style={[styles.widgetItem, { backgroundColor: colors.background }]} 
              onPress={() => router.push({ pathname: '/tasks', params: { tab: 'summary', filter: 'overdue' } })}
              activeOpacity={0.7}
            >
              <View style={[styles.widgetIconBg, { backgroundColor: '#FEF2F2' }]}>
                <Ionicons name="time" size={16} color="#EF4444" />
              </View>
              <Text style={[styles.widgetItemLabel, { color: colors.tabIconDefault }]}>Quá hạn</Text>
              <Text style={[styles.widgetItemValue, { color: '#EF4444' }]}>
                {stats.assigned_to_me?.overdue || 0}
              </Text>
            </TouchableOpacity>

            {/* 4. Sắp đến hạn */}
            <TouchableOpacity 
              style={[styles.widgetItem, { backgroundColor: colors.background }]} 
              onPress={() => router.push({ pathname: '/tasks', params: { tab: 'summary', filter: 'due_soon' } })}
              activeOpacity={0.7}
            >
              <View style={[styles.widgetIconBg, { backgroundColor: '#FFFBEB' }]}>
                <Ionicons name="alert-circle" size={16} color="#D97706" />
              </View>
              <Text style={[styles.widgetItemLabel, { color: colors.tabIconDefault }]}>Sắp đến hạn</Text>
              <Text style={[styles.widgetItemValue, { color: '#D97706' }]}>
                {stats.assigned_to_me?.due_soon || 0}
              </Text>
            </TouchableOpacity>

            {/* 5. Hoàn thành */}
            <TouchableOpacity 
              style={[styles.widgetItem, { backgroundColor: colors.background }]} 
              onPress={() => router.push({ pathname: '/tasks', params: { tab: 'summary', filter: 'completed' } })}
              activeOpacity={0.7}
            >
              <View style={[styles.widgetIconBg, { backgroundColor: '#ECFDF5' }]}>
                <Ionicons name="checkmark-done-circle" size={16} color="#10B981" />
              </View>
              <Text style={[styles.widgetItemLabel, { color: colors.tabIconDefault }]}>Hoàn thành</Text>
              <Text style={[styles.widgetItemValue, { color: '#10B981' }]}>
                {stats.assigned_to_me?.completed || 0}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ARCHIVED TASKS KPI – Admin only */}
        {user?.role === 'admin' && (stats.archived?.total ?? 0) > 0 && (
          <TouchableOpacity
            style={[
              styles.widgetContainer,
              {
                backgroundColor: colors.card,
                borderColor: '#f59e0b',
                borderWidth: 1.5,
                marginTop: 0,
                flexDirection: 'row',
                alignItems: 'center',
                padding: 14,
                gap: 14,
              }
            ]}
            onPress={() => router.push({ pathname: '/tasks', params: { tab: 'summary', archived_only: 'true' } })}
            activeOpacity={0.75}
          >
            <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#FEF3C7', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 22 }}>📦</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 12, fontWeight: '700', color: '#92400e', letterSpacing: 0.3 }}>NHIỆM VỤ LƯU TRỮ</Text>
              <Text style={{ fontSize: 22, fontWeight: '800', color: '#d97706', lineHeight: 28 }}>
                {stats.archived?.total || 0}
              </Text>
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 2 }}>
                <Text style={{ fontSize: 11, color: '#92400e', fontWeight: '600' }}>
                  Tuần này: {stats.archived?.this_week || 0}
                </Text>
                <Text style={{ fontSize: 11, color: '#92400e', fontWeight: '600' }}>
                  Tháng này: {stats.archived?.this_month || 0}
                </Text>
              </View>
            </View>
            <View style={{ alignItems: 'center' }}>
              <Ionicons name="chevron-forward" size={18} color="#d97706" />
            </View>
          </TouchableOpacity>
        )}

        {/* MINI TASK PREVIEW SECTION */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>🔥 Nhiệm vụ cần xử lý ngay</Text>
        {miniTasksLoading ? (
          <View style={styles.statsLoader}>
            <ActivityIndicator size="small" color={colors.tint} />
            <Text style={[styles.statsLoaderText, { color: colors.tabIconDefault }]}>Đang tải nhiệm vụ quan trọng...</Text>
          </View>
        ) : miniTasks.length === 0 ? (
          <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border, alignItems: 'center', padding: 20 }]}>
            <Ionicons name="checkmark-done" size={32} color="#10b981" style={{ marginBottom: 8 }} />
            <Text style={{ fontSize: 13.5, fontWeight: '700', color: colors.text }}>Tuyệt vời! Bạn đã hoàn thành tất cả nhiệm vụ.</Text>
          </View>
        ) : (
          <View style={{ marginBottom: 24 }}>
            <View style={{ gap: 10 }}>
              {miniTasks.slice(0, visibleMiniTasksCount).map(task => {
                const isCompleted = task.completed || task.approval_status === 'completed';
                const isOverdue = task.deadline && new Date(task.deadline).getTime() < Date.now() && !isCompleted;
                const threeDays = 3 * 24 * 60 * 60 * 1000;
                const isDueSoon = task.deadline && !isCompleted && (new Date(task.deadline).getTime() >= Date.now() && new Date(task.deadline).getTime() <= Date.now() + threeDays);
                
                let statusLabel = 'Chưa làm';
                let statusColor = '#475569';
                let statusBg = '#f1f5f9';
                if (task.approval_status === 'in_progress' || task.status === 'in_progress') {
                  statusLabel = 'Đang làm';
                  statusColor = '#0284c7';
                  statusBg = '#e0f2fe';
                } else if (task.approval_status === 'waiting_approval') {
                  statusLabel = 'Chờ duyệt';
                  statusColor = '#d97706';
                  statusBg = '#fef3c7';
                } else if (task.approval_status === 'revision_required') {
                  statusLabel = 'Làm lại';
                  statusColor = '#dc2626';
                  statusBg = '#fee2e2';
                } else if (isCompleted) {
                  statusLabel = 'Hoàn thành';
                  statusColor = '#059669';
                  statusBg = '#d1fae5';
                }

                let priorityLabel = '🟢 Thấp';
                if (task.priority === 'high') priorityLabel = '🔴 Cao';
                else if (task.priority === 'medium') priorityLabel = '🟡 T.Bình';

                return (
                  <TouchableOpacity
                    key={task.id}
                    style={[
                      styles.miniTaskCard, 
                      { 
                        backgroundColor: colors.card, 
                        borderColor: isOverdue ? '#ef4444' : (isDueSoon ? '#f59e0b' : colors.border),
                        borderLeftColor: isOverdue ? '#ef4444' : (isDueSoon ? '#f59e0b' : '#2563EB'),
                        borderLeftWidth: 4
                      }
                    ]}
                    onPress={() => router.push({ pathname: '/tasks', params: { taskId: task.id.toString() } })}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, marginRight: 12 }}>
                      <Text style={[styles.miniTaskTitle, { color: colors.text }]} numberOfLines={1}>
                        {task.title}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                        {task.creator_name && (
                          <Text style={{ fontSize: 11, color: colors.tabIconDefault }}>
                            👤 Giao: {task.creator_name}
                          </Text>
                        )}
                        {task.deadline && (
                          <Text style={{ fontSize: 11, fontWeight: '600', color: isOverdue ? '#ef4444' : (isDueSoon ? '#d97706' : colors.tabIconDefault) }}>
                            📅 Hạn: {new Date(task.deadline).toLocaleDateString('vi-VN')}
                          </Text>
                        )}
                      </View>
                    </View>
                    <View style={{ alignItems: 'flex-end', gap: 6 }}>
                      <View style={[styles.miniTaskBadge, { backgroundColor: statusBg }]}>
                        <Text style={{ fontSize: 9.5, fontWeight: '700', color: statusColor }}>{statusLabel}</Text>
                      </View>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: colors.tabIconDefault }}>{priorityLabel}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {miniTasks.length > 5 && (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
                {miniTasks.length > visibleMiniTasksCount ? (
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: 14,
                      ...Platform.select({
                        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.02, shadowRadius: 2 },
                        android: { elevation: 1 }
                      })
                    }}
                    onPress={() => setVisibleMiniTasksCount(prev => prev + 5)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="chevron-down" size={16} color={colors.tint} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.tint }}>
                        Xem tiếp ({miniTasks.length - visibleMiniTasksCount} nhiệm vụ khác)
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={{
                      flex: 1,
                      paddingVertical: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                      borderWidth: 1,
                      borderRadius: 14,
                      ...Platform.select({
                        ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.02, shadowRadius: 2 },
                        android: { elevation: 1 }
                      })
                    }}
                    onPress={() => setVisibleMiniTasksCount(5)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="chevron-up" size={16} color={colors.tabIconDefault} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.tabIconDefault }}>
                        Thu gọn danh sách
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        )}

        {/* Admin-only: Realtime User Account Stats card */}
        {user?.role === 'admin' && (
          <View 
            style={{
              width: '100%',
              borderWidth: 1,
              borderRadius: 18,
              padding: 16,
              backgroundColor: colors.card,
              borderColor: colors.border,
              marginBottom: 16,
              ...Platform.select({
                ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4 },
                android: { elevation: 1 }
              })
            }}
          >
            <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.tint, marginBottom: 12, letterSpacing: 0.5 }}>
              📊 THỐNG KÊ TÀI KHOẢN HỆ THỐNG (ADMIN)
            </Text>
            
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 10 }}>
              {/* Tổng số tài khoản */}
              <View style={{ width: '47%', padding: 10, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#eff6ff', justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="people" size={14} color="#2563eb" />
                </View>
                <View>
                  <Text style={{ fontSize: 10, color: colors.tabIconDefault, fontWeight: '700' }}>Tổng tài khoản</Text>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 2 }}>{totalAccounts}</Text>
                </View>
              </View>

              {/* Hoạt động */}
              <View style={{ width: '47%', padding: 10, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#ecfdf5', justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="checkmark-circle" size={14} color="#10b981" />
                </View>
                <View>
                  <Text style={{ fontSize: 10, color: colors.tabIconDefault, fontWeight: '700' }}>Hoạt động</Text>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: colors.text, marginTop: 2 }}>{activeCount}</Text>
                </View>
              </View>

              {/* Admins */}
              <View style={{ width: '31%', padding: 8, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                <Ionicons name="key" size={14} color="#dc2626" style={{ marginBottom: 4 }} />
                <Text style={{ fontSize: 9, color: colors.tabIconDefault, fontWeight: '700' }}>Admin</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 2 }}>{adminCount}</Text>
              </View>

              {/* Users */}
              <View style={{ width: '31%', padding: 8, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                <Ionicons name="person" size={14} color="#0284c7" style={{ marginBottom: 4 }} />
                <Text style={{ fontSize: 9, color: colors.tabIconDefault, fontWeight: '700' }}>User</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 2 }}>{userCount}</Text>
              </View>

              {/* Bị khóa */}
              <View style={{ width: '31%', padding: 8, backgroundColor: colors.background, borderRadius: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}>
                <Ionicons name="lock-closed" size={14} color="#4b5563" style={{ marginBottom: 4 }} />
                <Text style={{ fontSize: 9, color: colors.tabIconDefault, fontWeight: '700' }}>Bị khóa</Text>
                <Text style={{ fontSize: 13, fontWeight: '800', color: colors.text, marginTop: 2 }}>{lockedCount}</Text>
              </View>
            </View>
          </View>
        )}

        {/* 3. PREMIUM AMBIENT SYSTEM STATUS CARD */}
        <View style={[styles.statusCard, { backgroundColor: colors.card, borderColor: colors.border, marginTop: 10 }]}>
          <View style={styles.statusHeader}>
            <View style={styles.greenDot} />
            <Text style={[styles.statusTitle, { color: colors.text }]}>Trạng thái Hệ thống</Text>
          </View>
          <Text style={[styles.statusDesc, { color: colors.tabIconDefault }]}>
            Tất cả các dịch vụ (Cơ sở dữ liệu Supabase, Socket Realtime, API Gateway) đang hoạt động ổn định và an toàn.
          </Text>
          <View style={styles.badgeRow}>
            <View style={[styles.statusBadge, { backgroundColor: '#ecfdf5' }]}>
              <Text style={styles.statusBadgeText}>Mượt mà ⚡</Text>
            </View>
            <Text style={[styles.pingText, { color: colors.tabIconDefault }]}>Ping: 12ms</Text>
          </View>
        </View>

        {/* 4. QUICK CHANNELS & ACTIONS */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Truy cập nhanh</Text>
        <View style={styles.actionGrid}>
          {/* Action 1: Trò chuyện */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push('/messages')}
          >
            <View style={[styles.iconWrapper, { backgroundColor: '#eff6ff' }]}>
              <Ionicons name="chatbubble-ellipses" size={24} color="#2563eb" />
            </View>
            <Text style={[styles.actionTitle, { color: colors.text }]}>Phòng Trò chuyện</Text>
            <Text style={[styles.actionDesc, { color: colors.tabIconDefault }]} numberOfLines={1}>
              Nhắn tin trực tiếp & thảo luận nhóm realtime
            </Text>
          </TouchableOpacity>

          {/* Action 2: Cài đặt */}
          <TouchableOpacity
            style={[styles.actionCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => router.push('/two')}
          >
            <View style={[styles.iconWrapper, { backgroundColor: '#f1f5f9' }]}>
              <Ionicons name="settings" size={24} color="#64748b" />
            </View>
            <Text style={[styles.actionTitle, { color: colors.text }]}>Cấu hình Tài khoản</Text>
            <Text style={[styles.actionDesc, { color: colors.tabIconDefault }]} numberOfLines={1}>
              Thay đổi ảnh đại diện, mật khẩu và thông báo
            </Text>
          </TouchableOpacity>
        </View>

        {/* 5. COMPANY DIRECTORY LISTING */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Thành viên Đội ngũ ({onlineUsers.length})</Text>
        <View style={styles.directoryList}>
          {onlineUsers.map(member => (
            <View key={member.id} style={[styles.directoryItem, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Image
                source={{ uri: member.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }}
                style={styles.memberAvatar}
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.memberName, { color: colors.text }]}>{member.name}</Text>
                <Text style={[styles.memberRole, { color: colors.tabIconDefault }]}>
                  {member.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
                </Text>
              </View>
              <View style={[styles.roleBadge, { backgroundColor: colors.border }]}>
                <Text style={[styles.roleBadgeText, { color: colors.text }]}>PWA</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
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
  content: {
    padding: 20,
    paddingBottom: 100,
  },
  welcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  welcomeSubtitle: {
    fontSize: 13,
    fontWeight: '600',
  },
  welcomeTitle: {
    fontSize: 22,
    fontWeight: '800',
    marginTop: 2,
  },
  headerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  statsLoader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    marginBottom: 24,
  },
  statsLoaderText: {
    fontSize: 13,
    marginLeft: 8,
    fontWeight: '500',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 24,
  },
  kpiCard: {
    width: '48%',
    borderWidth: 1,
    borderRadius: 16,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.03,
        shadowRadius: 4,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  kpiIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  kpiInfo: {
    flex: 1,
  },
  kpiTitle: {
    fontSize: 11,
    fontWeight: '700',
  },
  kpiNumber: {
    fontSize: 18,
    fontWeight: '800',
    marginTop: 1,
  },
  statusCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 28,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 8,
  },
  statusTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  statusDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  badgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusBadgeText: {
    color: '#065f46',
    fontSize: 11,
    fontWeight: 'bold',
  },
  pingText: {
    fontSize: 12,
    fontWeight: '600',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 14,
  },
  actionGrid: {
    marginBottom: 28,
  },
  actionCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  iconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  actionTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 4,
  },
  actionDesc: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  directoryList: {
    gap: 8,
  },
  directoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderRadius: 14,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  memberName: {
    fontSize: 14,
    fontWeight: '700',
  },
  memberRole: {
    fontSize: 12,
    fontWeight: '500',
    marginTop: 1,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  roleBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  widgetContainer: {
    borderWidth: 1,
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
  },
  widgetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  widgetTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  unreadBadge: {
    backgroundColor: '#EF4444',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  unreadBadgeText: {
    color: '#FFFFFF',
    fontSize: 9.5,
    fontWeight: '800',
  },
  widgetGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  widgetItem: {
    flex: 1,
    minWidth: 80,
    padding: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  widgetIconBg: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  widgetItemLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 2,
    textAlign: 'center',
  },
  widgetItemValue: {
    fontSize: 15,
    fontWeight: '800',
  },
  miniTaskCard: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.02, shadowRadius: 2 },
      android: { elevation: 1 }
    })
  },
  miniTaskTitle: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  miniTaskBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2.5,
    borderRadius: 6,
  },
});
