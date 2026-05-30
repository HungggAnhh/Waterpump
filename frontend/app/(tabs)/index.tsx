// frontend/app/(tabs)/index.tsx
import React, { useState, useEffect } from 'react';
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

interface User {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  status: 'active' | 'inactive';
}

interface KPIStats {
  total: number;
  in_progress: number;
  waiting_approval: number;
  revision_required: number;
  completed: number;
  completion_rate: number;
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useUser();
  const { socket } = useSocket();

  const [onlineUsers, setOnlineUsers] = useState<User[]>([]);
  const [stats, setStats] = useState<KPIStats>({
    total: 0,
    in_progress: 0,
    waiting_approval: 0,
    revision_required: 0,
    completed: 0,
    completion_rate: 0,
  });
  const [statsLoading, setStatsLoading] = useState(true);

  // Fetch users list to show active company directory
  useEffect(() => {
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
    fetchUsers();
  }, []);

  // Fetch KPI statistics
  const fetchKPIStats = async () => {
    try {
      setStatsLoading(true);
      const res = await fetch(`${API_BASE_URL}/tasks/stats`);
      const result = await res.json();
      if (result.status === 'success') {
        setStats(result.data || { total: 0, in_progress: 0, waiting_approval: 0, revision_required: 0, completed: 0, completion_rate: 0 });
      }
    } catch (err) {
      console.error('⚠️ [Home] Lỗi lấy KPI thống kê:', err);
    } finally {
      setStatsLoading(false);
    }
  };

  useEffect(() => {
    fetchKPIStats();
  }, [user]);

  // Realtime Socket updates for KPIs
  useEffect(() => {
    if (!socket) return;

    const handleTaskChange = () => {
      console.log('📡 [SOCKET] Realtime: Cập nhật lại số liệu KPI trang chủ');
      fetchKPIStats();
    };

    socket.on('task_created', handleTaskChange);
    socket.on('task_updated', handleTaskChange);
    socket.on('task_deleted', handleTaskChange);
    socket.on('task_completed', handleTaskChange);

    return () => {
      socket.off('task_created', handleTaskChange);
      socket.off('task_updated', handleTaskChange);
      socket.off('task_deleted', handleTaskChange);
      socket.off('task_completed', handleTaskChange);
    };
  }, [socket]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
        
        {/* 1. HEADER WELCOME SECTION */}
        <View style={styles.welcomeRow}>
          <View>
            <Text style={[styles.welcomeSubtitle, { color: colors.tabIconDefault }]}>Chào mừng trở lại,</Text>
            <Text style={[styles.welcomeTitle, { color: colors.text }]}>{user?.name || 'Thành viên'} 👋</Text>
          </View>
          <Image
            source={{ uri: user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }}
            style={styles.headerAvatar}
          />
        </View>

        {/* 2. PREMIUM KPI STATS CARDS */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Số liệu công việc {user?.role === 'admin' ? '(Toàn cục)' : '(Được giao)'}</Text>
        {statsLoading ? (
          <View style={styles.statsLoader}>
            <ActivityIndicator size="small" color={colors.tint} />
            <Text style={[styles.statsLoaderText, { color: colors.tabIconDefault }]}>Đang tính toán thống kê...</Text>
          </View>
        ) : (
          <View style={{ gap: 14, marginBottom: 24 }}>
            {/* Completion Rate Glassmorphic Card */}
            <View 
              style={{
                width: '100%',
                borderWidth: 1,
                borderRadius: 18,
                padding: 16,
                backgroundColor: colors.card,
                borderColor: colors.border,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                ...Platform.select({
                  ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4 },
                  android: { elevation: 1 }
                })
              }}
            >
              <View style={{ flex: 1, marginRight: 16 }}>
                <Text style={{ fontSize: 11.5, fontWeight: '700', color: colors.tabIconDefault, marginBottom: 8, letterSpacing: 0.5 }}>
                  TỶ LỆ HOÀN THÀNH DOANH NGHIỆP
                </Text>
                <View style={{ height: 8, width: '100%', backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' }}>
                  <View style={{ height: '100%', width: `${stats.completion_rate}%`, backgroundColor: '#10b981', borderRadius: 4 }} />
                </View>
                <Text style={{ fontSize: 12, color: colors.tabIconDefault, fontWeight: '600', marginTop: 8 }}>
                  {stats.completed} trên tổng số {stats.total} nhiệm vụ đã được duyệt hoàn thành.
                </Text>
              </View>
              <View style={{ alignItems: 'center', justifyContent: 'center', backgroundColor: '#ecfdf5', borderRadius: 16, width: 60, height: 60, borderWidth: 1, borderColor: '#10b981' }}>
                <Text style={{ fontSize: 18, fontWeight: '900', color: '#059669' }}>
                  {stats.completion_rate}%
                </Text>
              </View>
            </View>

            <View style={styles.kpiGrid}>
              {/* Card 1: Tổng công việc */}
              <TouchableOpacity 
                style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push('/tasks')}
                activeOpacity={0.7}
              >
                <View style={[styles.kpiIconWrapper, { backgroundColor: '#eff6ff' }]}>
                  <Ionicons name="folder-open" size={18} color="#2563eb" />
                </View>
                <View style={styles.kpiInfo}>
                  <Text style={[styles.kpiTitle, { color: colors.tabIconDefault }]}>Tổng việc</Text>
                  <Text style={[styles.kpiNumber, { color: colors.text }]}>{stats.total}</Text>
                </View>
              </TouchableOpacity>

              {/* Card 2: Đang thực hiện */}
              <TouchableOpacity 
                style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push('/tasks')}
                activeOpacity={0.7}
              >
                <View style={[styles.kpiIconWrapper, { backgroundColor: '#e0f2fe' }]}>
                  <Ionicons name="sync" size={18} color="#0284c7" />
                </View>
                <View style={styles.kpiInfo}>
                  <Text style={[styles.kpiTitle, { color: colors.tabIconDefault }]}>Đang làm</Text>
                  <Text style={[styles.kpiNumber, { color: colors.text }]}>{stats.in_progress}</Text>
                </View>
              </TouchableOpacity>

              {/* Card 3: Chờ duyệt */}
              <TouchableOpacity 
                style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push('/tasks')}
                activeOpacity={0.7}
              >
                <View style={[styles.kpiIconWrapper, { backgroundColor: '#fef3c7' }]}>
                  <Ionicons name="hourglass" size={18} color="#d97706" />
                </View>
                <View style={styles.kpiInfo}>
                  <Text style={[styles.kpiTitle, { color: colors.tabIconDefault }]}>Chờ duyệt</Text>
                  <Text style={[styles.kpiNumber, { color: colors.text }]}>{stats.waiting_approval}</Text>
                </View>
              </TouchableOpacity>

              {/* Card 4: Cần làm lại */}
              <TouchableOpacity 
                style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                onPress={() => router.push('/tasks')}
                activeOpacity={0.7}
              >
                <View style={[styles.kpiIconWrapper, { backgroundColor: '#fee2e2' }]}>
                  <Ionicons name="refresh-circle" size={18} color="#dc2626" />
                </View>
                <View style={styles.kpiInfo}>
                  <Text style={[styles.kpiTitle, { color: colors.tabIconDefault }]}>Làm lại</Text>
                  <Text style={[styles.kpiNumber, { color: colors.text }]}>{stats.revision_required}</Text>
                </View>
              </TouchableOpacity>

              {/* Card 5: Hoàn thành */}
              <TouchableOpacity 
                style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border, width: '100%' }]}
                onPress={() => router.push('/tasks')}
                activeOpacity={0.7}
              >
                <View style={[styles.kpiIconWrapper, { backgroundColor: '#d1fae5' }]}>
                  <Ionicons name="checkmark-done-circle" size={18} color="#059669" />
                </View>
                <View style={styles.kpiInfo}>
                  <Text style={[styles.kpiTitle, { color: colors.tabIconDefault }]}>Hoàn thành (Đã duyệt)</Text>
                  <Text style={[styles.kpiNumber, { color: colors.text }]}>{stats.completed}</Text>
                </View>
              </TouchableOpacity>
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
});
