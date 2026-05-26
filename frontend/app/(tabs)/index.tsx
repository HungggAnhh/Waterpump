// frontend/app/(tabs)/index.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { endpoints } from '@/constants/Config';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUser } from '../../context/UserContext';

interface Task {
  id: number;
  title: string;
  description: string;
  status: 'todo' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  due_date: string;
  created_at: string;
  assignee_name: string | null;
  assignee_avatar: string | null;
  assignee_role: string | null;
  boss_checked: number;
}

interface User {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  status: 'active' | 'inactive';
}

export default function HomeScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useUser();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Fetch Data
  const fetchData = async () => {
    try {
      const [tasksRes, usersRes] = await Promise.all([
        fetch(endpoints.tasks),
        fetch(endpoints.users)
      ]);
      
      const tasksResult = await tasksRes.json();
      const usersResult = await usersRes.json();
      
      if (tasksResult.status === 'success') {
        setTasks(tasksResult.data);
      }
      if (usersResult.status === 'success') {
        setUsers(usersResult.data);
      }
    } catch (error) {
      console.error("Lỗi khi tải dữ liệu trang chủ:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
  }, []);

  // Analytical Calculations
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter(t => t.status === 'completed').length;
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress').length;
  const todoTasks = tasks.filter(t => t.status === 'todo').length;
  
  // Urgent / High priority tasks that are not completed
  const urgentTasks = tasks.filter(t => t.priority === 'high' && t.status !== 'completed').slice(0, 3);
  
  // Tasks due today (mocking today's date to match seeded date 2026-05-28 or dynamically)
  const todayStr = new Date().toISOString().split('T')[0];
  const todayTasks = tasks.filter(t => t.due_date === todayStr || t.status === 'in_progress').slice(0, 2);

  const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      <ScrollView
        style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.tint]} />
      }
    >
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      ) : (
        <>
          {/* Header Chào mừng */}
          <View style={styles.welcomeRow}>
            <View>
              <Text style={[styles.welcomeSubtitle, { color: colors.textSecondary }]}>Chào buổi sáng,</Text>
              <Text style={[styles.welcomeTitle, { color: colors.text }]}>{user?.name || 'Thành viên'} 👋</Text>
            </View>
            <Image
              source={{ uri: user?.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80' }}
              style={styles.headerAvatar}
            />
          </View>

          {/* 1. Progress Ring Widget */}
          <View style={[styles.progressRingCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.progressTextContainer}>
              <Text style={[styles.progressCardTitle, { color: colors.text }]}>Hiệu suất nhóm</Text>
              <Text style={[styles.progressCardDesc, { color: colors.textSecondary }]}>
                Đã hoàn tất {completedTasks}/{totalTasks} nhiệm vụ được phân công.
              </Text>
              <TouchableOpacity
                style={{ ...styles.viewTasksBtn, backgroundColor: colors.tint + '15' }}
                onPress={() => router.push('/tasks')}
              >
                <Text style={[styles.viewTasksBtnText, { color: colors.tint }]}>Xem chi tiết</Text>
                <Ionicons name="arrow-forward-outline" size={14} color={colors.tint} />
              </TouchableOpacity>
            </View>
            
            {/* Visual Progress Circle using Styled CSS */}
            <View style={styles.progressCircleWrapper}>
              <View style={[styles.progressCircleOuter, { borderColor: colors.border }]}>
                <View style={[styles.progressCircleFill, { borderTopColor: colors.tint, borderRightColor: colors.tint }]} />
                <View style={[styles.progressCircleInner, { backgroundColor: colors.card }]}>
                  <Text style={[styles.progressCircleText, { color: colors.text }]}>{completionRate}%</Text>
                  <Text style={styles.progressCircleLabel}>Xong</Text>
                </View>
              </View>
            </View>
          </View>

          {/* 2. Analytical KPI Grid */}
          <Text style={[styles.sectionTitle, { color: colors.text }]}>Tổng quan chỉ số</Text>
          <View style={styles.kpiGrid}>
            <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.kpiIconWrapper, { backgroundColor: '#eff6ff' }]}>
                <Ionicons name="list" size={20} color="#3b82f6" />
              </View>
              <Text style={[styles.kpiValue, { color: colors.text }]}>{totalTasks}</Text>
              <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Tổng công việc</Text>
            </View>
            <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.kpiIconWrapper, { backgroundColor: '#fffbeb' }]}>
                <Ionicons name="time" size={20} color="#f59e0b" />
              </View>
              <Text style={[styles.kpiValue, { color: '#f59e0b' }]}>{inProgressTasks}</Text>
              <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Đang tiến hành</Text>
            </View>
            <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.kpiIconWrapper, { backgroundColor: '#ecfdf5' }]}>
                <Ionicons name="checkmark-done" size={20} color="#10b981" />
              </View>
              <Text style={[styles.kpiValue, { color: colors.success }]}>{completedTasks}</Text>
              <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Đã hoàn tất</Text>
            </View>
            <View style={[styles.kpiCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={[styles.kpiIconWrapper, { backgroundColor: '#fef2f2' }]}>
                <Ionicons name="alert-circle" size={20} color="#ef4444" />
              </View>
              <Text style={[styles.kpiValue, { color: colors.danger }]}>{todoTasks}</Text>
              <Text style={[styles.kpiLabel, { color: colors.textSecondary }]}>Đang cần làm</Text>
            </View>
          </View>

          {/* 3. Urgent Tasks Section */}
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Nhiệm vụ khẩn cấp 🔥</Text>
            {urgentTasks.length > 0 ? (
              <TouchableOpacity onPress={() => router.push('/tasks')}>
                <Text style={[styles.viewAllText, { color: colors.tint }]}>Tất cả</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          
          {urgentTasks.length > 0 ? (
            <View style={styles.urgentList}>
              {urgentTasks.map((item) => (
                <View key={item.id} style={[styles.urgentCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <View style={styles.urgentLeft}>
                    <View style={[styles.priorityBadge, { backgroundColor: colors.danger + '15' }]}>
                      <Text style={[styles.priorityText, { color: colors.danger }]}>URGENT</Text>
                    </View>
                    <Text style={[styles.urgentTitle, { color: colors.text }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={[styles.urgentAssignee, { color: colors.textSecondary }]}>
                      👤 {item.assignee_name || 'Chưa giao'} • Hạn chót: {item.due_date}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#c2c6d6" />
                </View>
              ))}
            </View>
          ) : (
            <View style={[styles.emptySectionCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Ionicons name="shield-checkmark" size={32} color={colors.success} />
              <Text style={[styles.emptySectionText, { color: colors.text }]}>Tuyệt vời! Không có việc gấp nào bị tồn đọng.</Text>
            </View>
          )}
        </>
      )}
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
    padding: 16,
    paddingBottom: 40,
  },
  centered: {
    paddingVertical: 100,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  welcomeSubtitle: {
    fontSize: 14,
    fontWeight: '500',
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
  progressRingCard: {
    flexDirection: 'row',
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  progressTextContainer: {
    flex: 1,
    paddingRight: 16,
  },
  progressCardTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  progressCardDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  viewTasksBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    alignSelf: 'flex-start',
    gap: 4,
  },
  viewTasksBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  progressCircleWrapper: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressCircleOuter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 6,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  progressCircleFill: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 6,
    borderColor: 'transparent',
    transform: [{ rotate: '45deg' }],
  },
  progressCircleInner: {
    width: 68,
    height: 68,
    borderRadius: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressCircleText: {
    fontSize: 16,
    fontWeight: '800',
  },
  progressCircleLabel: {
    fontSize: 9,
    color: '#727785',
    fontWeight: '600',
    marginTop: 1,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  viewAllText: {
    fontSize: 13,
    fontWeight: '600',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 12,
  },
  kpiCard: {
    flex: 1,
    minWidth: '45%',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 1,
  },
  kpiIconWrapper: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  kpiLabel: {
    fontSize: 11,
    marginTop: 2,
  },
  urgentList: {
    gap: 10,
  },
  urgentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.01,
    shadowRadius: 4,
    elevation: 1,
  },
  urgentLeft: {
    flex: 1,
    paddingRight: 16,
  },
  priorityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  priorityText: {
    fontSize: 9,
    fontWeight: '800',
  },
  urgentTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  urgentAssignee: {
    fontSize: 11,
  },
  emptySectionCard: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 24,
    gap: 10,
  },
  emptySectionText: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  activeTeamRow: {
    flexDirection: 'row',
    gap: 10,
  },
  memberBadge: {
    flex: 1,
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginBottom: 6,
  },
  memberAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
  },
  memberName: {
    fontSize: 11,
    fontWeight: '700',
  },
  memberRole: {
    fontSize: 9,
    color: '#727785',
    marginTop: 2,
  },
});
