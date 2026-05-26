// frontend/app/(tabs)/tasks.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  ScrollView,
  Alert,
  Platform,
  FlatList,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { endpoints } from '@/constants/Config';
import { SafeAreaView } from 'react-native-safe-area-context';

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
}

export default function TasksScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];

  const [tasks, setTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Modal State (Tạo công việc mới)
  const [modalVisible, setModalVisible] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPriority, setNewPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [newDueDate, setNewDueDate] = useState('');
  const [newAssigneeId, setNewAssigneeId] = useState<string>('');
  const [creating, setCreating] = useState(false);

  // Trạng thái modal và công việc để cập nhật trạng thái nhanh (Notion-style)
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [selectedTaskForStatus, setSelectedTaskForStatus] = useState<Task | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [dropdownPosition, setDropdownPosition] = useState({ x: 0, y: 0 });

  // Hàm cập nhật trạng thái công việc trực tiếp từ ngoài danh sách
  const handleUpdateStatus = async (taskId: number, newStatus: 'todo' | 'in_progress' | 'completed') => {
    setUpdatingStatus(true);
    try {
      const response = await fetch(endpoints.tasks, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update_status',
          id: taskId,
          status: newStatus,
        }),
      });

      const result = await response.json();
      if (result.status === 'success') {
        // Cập nhật local state ngay lập tức để UI mượt mà
        setTasks(prevTasks =>
          prevTasks.map(t => (t.id === taskId ? { ...t, status: newStatus } : t))
        );
        setStatusModalVisible(false);
      } else {
        Alert.alert('Lỗi', result.message || 'Không thể cập nhật trạng thái');
      }
    } catch (error) {
      console.error(error);
      Alert.alert('Lỗi', 'Không thể kết nối đến máy chủ.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  // Hàm toggle nút sếp check để làm tối màu task
  const handleToggleBossCheck = async (taskId: number, currentBossChecked: number) => {
    const nextBossChecked = currentBossChecked === 1 ? 0 : 1;
    try {
      // Cập nhật local state trước để phản hồi UI cực nhanh (Optimistic UI)
      setTasks(prevTasks =>
        prevTasks.map(t => (t.id === taskId ? { ...t, boss_checked: nextBossChecked } : t))
      );

      const response = await fetch(endpoints.tasks, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'toggle_boss_check',
          id: taskId,
          boss_checked: nextBossChecked,
        }),
      });

      const result = await response.json();
      if (result.status !== 'success') {
        // Hoàn tác nếu có lỗi từ server
        setTasks(prevTasks =>
          prevTasks.map(t => (t.id === taskId ? { ...t, boss_checked: currentBossChecked } : t))
        );
        Alert.alert('Lỗi', result.message || 'Không thể cập nhật phê duyệt');
      }
    } catch (error) {
      console.error(error);
      // Hoàn tác nếu có lỗi kết nối
      setTasks(prevTasks =>
        prevTasks.map(t => (t.id === taskId ? { ...t, boss_checked: currentBossChecked } : t))
      );
      Alert.alert('Lỗi', 'Không thể kết nối đến máy chủ.');
    }
  };

  // Fetch Tasks
  const fetchTasks = async () => {
    try {
      const response = await fetch(endpoints.tasks);
      const result = await response.json();
      if (result.status === 'success') {
        setTasks(result.data);
      } else {
        console.error(result.message);
      }
    } catch (error) {
      console.error("Lỗi khi tải công việc:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  // Fetch Users for Dropdown
  const fetchUsers = async () => {
    try {
      const response = await fetch(endpoints.users);
      const result = await response.json();
      if (result.status === 'success') {
        setUsers(result.data);
      }
    } catch (error) {
      console.error("Lỗi khi tải thành viên:", error);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchUsers();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchTasks();
    fetchUsers();
  }, []);

  // Handle Add Task
  const handleCreateTask = async () => {
    if (!newTitle.trim()) {
      Alert.alert('Lỗi', 'Vui lòng nhập tiêu đề công việc!');
      return;
    }

    setCreating(true);
    try {
      const response = await fetch(endpoints.tasks, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle,
          description: newDesc,
          status: 'todo',
          priority: newPriority,
          due_date: newDueDate || new Date().toISOString().split('T')[0],
          assignee_id: newAssigneeId ? parseInt(newAssigneeId) : null,
          created_by: 1, // Demo mặc định PM tạo
        }),
      });

      const result = await response.json();

      if (result.status === 'success') {
        Alert.alert('Thành công', 'Công việc đã được phân công thành công!');
        setModalVisible(false);
        // Reset Form
        setNewTitle('');
        setNewDesc('');
        setNewPriority('medium');
        setNewDueDate('');
        setNewAssigneeId('');
        // Refresh List
        fetchTasks();
      } else {
        Alert.alert('Lỗi', result.message || 'Không thể tạo công việc');
      }
    } catch (error) {
      Alert.alert('Lỗi', 'Không thể kết nối đến máy chủ. Hãy kiểm tra kết nối mạng!');
      console.error(error);
    } finally {
      setCreating(false);
    }
  };

  // Local Search Filtering
  const filteredTasks = tasks.filter(task =>
    task.title.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'todo': return 'Chưa bắt đầu';
      case 'in_progress': return 'Đang thực hiện';
      case 'completed': return 'Hoàn tất';
      default: return '';
    }
  };

  const getStatusBgColor = (status: string) => {
    switch (status) {
      case 'todo': return '#e2e8f0'; // Gray slate
      case 'in_progress': return '#dbeafe'; // Soft blue
      case 'completed': return '#d1fae5'; // Soft green
      default: return '#f3f4f6';
    }
  };

  const getStatusTextColor = (status: string) => {
    switch (status) {
      case 'todo': return '#475569'; // Slate dark
      case 'in_progress': return '#1d4ed8'; // Blue dark
      case 'completed': return '#065f46'; // Green dark
      default: return '#4b5563';
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['bottom']}>
      {/* 1. Header (TeamFlow) */}
      <View style={[styles.headerRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.headerLeft}>
          <TouchableOpacity style={styles.menuBtn}>
            <Ionicons name="menu" size={24} color="#1d4ed8" />
          </TouchableOpacity>
          <Text style={[styles.brandText, { color: '#1d4ed8' }]}>TeamFlow</Text>
        </View>
        
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.bellBtn}>
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            <View style={styles.bellDot} />
          </TouchableOpacity>
          <Image
            source={{ uri: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&h=150&q=80' }}
            style={styles.profileAvatar}
          />
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.tint]} />
        }
      >
        {/* 2. Breadcrumbs */}
        <Text style={[styles.breadcrumbText, { color: colors.textSecondary }]}>
          Dự án Alpha <Text style={{ color: '#727785' }}>&gt;</Text> <Text style={{ fontWeight: 'bold', color: colors.text }}>Tasks</Text>
        </Text>

        {/* 3. Banner Image */}
        <View style={[styles.bannerWrapper, { borderColor: colors.border }]}>
          <Image
            source={{ uri: 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?auto=format&fit=crop&w=600&h=200&q=80' }}
            style={styles.bannerImage}
            resizeMode="cover"
          />
        </View>

        {/* 4. Section Title */}
        <Text style={[styles.sectionTitle, { color: colors.text }]}>Tasks</Text>

        {/* 5. Search, Filter, Sort Row */}
        <View style={styles.controlsRow}>
          <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="search" size={18} color="#a0aec0" style={{ marginRight: 8 }} />
            <TextInput
              style={[styles.searchInput, { color: colors.text }]}
              placeholder="Tìm kiếm task..."
              placeholderTextColor="#a0aec0"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </View>
          <TouchableOpacity style={[styles.controlBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="filter" size={20} color="#727785" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.controlBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="swap-vertical" size={20} color="#727785" />
          </TouchableOpacity>
        </View>

        {/* 6. Tasks Notion Table */}
        {loading ? (
          <ActivityIndicator size="large" color="#1d4ed8" style={{ marginTop: 40 }} />
        ) : (
          <View style={[styles.notionTable, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {/* Table Header */}
            <View style={[styles.tableHeader, { backgroundColor: colorScheme === 'dark' ? '#1e293b' : '#f8fafc', borderBottomColor: colors.border }]}>
              <Text style={[styles.tableHeaderCol1, { flex: 1.5 }]}>Aa TÊN CÔNG VIỆC</Text>
              <Text style={[styles.tableHeaderCol2, { flex: 1.0, textAlign: 'center' }]}>TRẠNG THÁI</Text>
              <Text style={[styles.tableHeaderCol3, { flex: 0.6, textAlign: 'center' }]}> CHECK</Text>
            </View>

            {/* Table Body (Filtered tasks render) */}
            {filteredTasks.length > 0 ? (
              filteredTasks.map((item) => {
                const isDimmed = item.boss_checked === 1;
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.tableRow,
                      { borderBottomColor: colors.border },
                      isDimmed && {
                        backgroundColor: colorScheme === 'dark' ? '#172554' : '#f8fafc', // Tối màu nền xanh nhẹ
                        opacity: 0.45,
                      }
                    ]}
                  >
                    {/* Cột 1: Tên công việc & icon */}
                    <View style={[styles.taskTitleCol, { flex: 1.5 }]}>
                      <Ionicons
                        name={isDimmed ? "checkmark-circle" : "document-text-outline"}
                        size={18}
                        color={isDimmed ? "#10b981" : "#64748b"}
                        style={{ marginRight: 8 }}
                      />
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            styles.taskTitleText,
                            { color: colors.text },
                            isDimmed && {
                              textDecorationLine: 'line-through',
                              color: colors.textSecondary,
                            }
                          ]}
                          numberOfLines={2}
                        >
                          {item.title}
                        </Text>
                        {item.description ? (
                          <Text
                            style={[
                              styles.taskDescSnippet,
                              { color: colors.textSecondary },
                              isDimmed && { textDecorationLine: 'line-through' }
                            ]}
                            numberOfLines={1}
                          >
                            {item.description}
                          </Text>
                        ) : null}
                      </View>
                    </View>

                    {/* Cột 2: Trạng thái (Clickable badge) */}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={[
                        styles.statusBadgeTouch,
                        { flex: 1.0, alignItems: 'center', justifyContent: 'center' }
                      ]}
                      onPress={(event) => {
                        const { pageX, pageY } = event.nativeEvent;
                        setSelectedTaskForStatus(item);
                        const dropdownWidth = 220;
                        const dropX = Math.max(16, pageX - dropdownWidth + 10);
                        const dropY = pageY + 12;
                        setDropdownPosition({ x: dropX, y: dropY });
                        setStatusModalVisible(true);
                      }}
                    >
                      <View style={[styles.statusBadge, { backgroundColor: getStatusBgColor(item.status) }]}>
                        <View style={[styles.statusDot, { backgroundColor: getStatusTextColor(item.status) }]} />
                        <Text style={[styles.statusBadgeText, { color: getStatusTextColor(item.status) }]}>
                          {getStatusLabel(item.status)}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    {/* Cột 3: Sếp check (Interactive checkbox) */}
                    <TouchableOpacity
                      activeOpacity={0.7}
                      style={[
                        styles.bossCheckTouch,
                        { flex: 0.6, alignItems: 'center', justifyContent: 'center' }
                      ]}
                      onPress={() => handleToggleBossCheck(item.id, item.boss_checked)}
                    >
                      <Ionicons
                        name={isDimmed ? "shield-checkmark" : "ellipse-outline"}
                        size={22}
                        color={isDimmed ? "#10b981" : "#cbd5e1"}
                      />
                    </TouchableOpacity>
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyTableRow}>
                <Text style={{ color: '#a0aec0', fontSize: 13 }}>Không có nhiệm vụ nào!</Text>
              </View>
            )}

            {/* Add New Row button */}
            <TouchableOpacity
              style={styles.addPageRow}
              onPress={() => setModalVisible(true)}
            >
              <Ionicons name="add" size={18} color="#727785" style={{ marginRight: 10 }} />
              <Text style={styles.addPageText}>+ Trang mới</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>

      {/* 7. Floating Action Button (FAB) */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: '#0058be' }]}
        onPress={() => setModalVisible(true)}
      >
        <Ionicons name="pencil" size={24} color="#fff" />
      </TouchableOpacity>

      {/* 8. Add Task Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.text }]}>Phân công việc mới</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.formContainer}>
              <Text style={styles.label}>Tiêu đề công việc *</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                placeholder="Nhập tên công việc..."
                placeholderTextColor="#a0aec0"
                value={newTitle}
                onChangeText={setNewTitle}
              />

              <Text style={styles.label}>Mô tả công việc</Text>
              <TextInput
                style={[styles.input, styles.textArea, { borderColor: colors.border, color: colors.text }]}
                placeholder="Nhập mô tả chi tiết nhiệm vụ..."
                placeholderTextColor="#a0aec0"
                multiline
                numberOfLines={3}
                value={newDesc}
                onChangeText={setNewDesc}
              />

              <Text style={styles.label}>Độ ưu tiên</Text>
              <View style={styles.prioritySelector}>
                {(['low', 'medium', 'high'] as const).map((p) => {
                  const getPriorityColor = (priority: string) => {
                    switch (priority) {
                      case 'high': return colors.danger;
                      case 'medium': return '#f59e0b';
                      case 'low': return '#3b82f6';
                      default: return '#727785';
                    }
                  };
                  return (
                    <TouchableOpacity
                      key={p}
                      onPress={() => setNewPriority(p)}
                      style={[
                        styles.priorityOption,
                        newPriority === p
                          ? { backgroundColor: getPriorityColor(p), borderColor: getPriorityColor(p) }
                          : { borderColor: colors.border }
                      ]}
                    >
                      <Text
                        style={[
                          styles.priorityOptionText,
                          newPriority === p ? { color: '#fff', fontWeight: 'bold' } : { color: colors.text }
                        ]}
                      >
                        {p.toUpperCase()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>Giao cho thành viên</Text>
              <View style={styles.userSelector}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <TouchableOpacity
                    onPress={() => setNewAssigneeId('')}
                    style={[
                      styles.userOption,
                      newAssigneeId === ''
                        ? { backgroundColor: colors.tint, borderColor: colors.tint }
                        : { borderColor: colors.border, backgroundColor: colors.background }
                    ]}
                  >
                    <Text style={{ color: newAssigneeId === '' ? '#fff' : colors.text }}>
                      Chưa giao
                    </Text>
                  </TouchableOpacity>
                  {users.map((u) => (
                    <TouchableOpacity
                      key={u.id}
                      onPress={() => setNewAssigneeId(u.id.toString())}
                      style={[
                        styles.userOption,
                        newAssigneeId === u.id.toString()
                          ? { backgroundColor: colors.tint, borderColor: colors.tint }
                          : { borderColor: colors.border, backgroundColor: colors.background }
                      ]}
                    >
                      <Text style={{ color: newAssigneeId === u.id.toString() ? '#fff' : colors.text }}>
                        {u.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>

              <Text style={styles.label}>Hạn chót (YYYY-MM-DD)</Text>
              <TextInput
                style={[styles.input, { borderColor: colors.border, color: colors.text }]}
                placeholder="Ví dụ: 2026-06-15"
                placeholderTextColor="#a0aec0"
                value={newDueDate}
                onChangeText={setNewDueDate}
              />

              <TouchableOpacity
                style={[styles.submitBtn, { backgroundColor: colors.tint }]}
                onPress={handleCreateTask}
                disabled={creating}
              >
                {creating ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitBtnText}>Phân công ngay</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 8b. Notion-style Dynamic Status Picker Popover Dropdown */}
      <Modal
        animationType="fade"
        transparent={true}
        visible={statusModalVisible}
        onRequestClose={() => setStatusModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.notionDropdownBackdrop}
          activeOpacity={1}
          onPress={() => setStatusModalVisible(false)}
        >
          <View
            style={[
              styles.notionDropdownCard,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                top: dropdownPosition.y,
                left: dropdownPosition.x,
              }
            ]}
            onStartShouldSetResponder={() => true}
          >
            {updatingStatus ? (
              <ActivityIndicator size="small" color={colors.tint} style={{ marginVertical: 20 }} />
            ) : (
              <View>
                {/* 1. Header: Trạng thái hiện tại kèm Cursor gõ chữ của Notion */}
                {(() => {
                  const getSelectedStatusBadgeDetails = () => {
                    if (!selectedTaskForStatus) return { label: '', bg: '#f1f5f9', text: '#475569', dot: '#475569' };
                    switch (selectedTaskForStatus.status) {
                      case 'todo':
                        return {
                          label: 'Chưa bắt đầu',
                          bg: colorScheme === 'dark' ? '#334155' : '#e3e2e0',
                          text: colorScheme === 'dark' ? '#e2e8f0' : '#37352f',
                          dot: colorScheme === 'dark' ? '#94a3b8' : '#787774',
                        };
                      case 'in_progress':
                        return {
                          label: 'Đang thực hiện',
                          bg: colorScheme === 'dark' ? '#1e3a8a' : '#e2ecf5',
                          text: colorScheme === 'dark' ? '#93c5fd' : '#1d62ac',
                          dot: colorScheme === 'dark' ? '#3b82f6' : '#2b76c2',
                        };
                      case 'completed':
                        return {
                          label: 'Hoàn tất',
                          bg: colorScheme === 'dark' ? '#064e3b' : '#e2f2e7',
                          text: colorScheme === 'dark' ? '#6ee7b7' : '#18794e',
                          dot: colorScheme === 'dark' ? '#10b981' : '#208b59',
                        };
                      default:
                        return { label: '', bg: '#f1f5f9', text: '#475569', dot: '#475569' };
                    }
                  };
                  const selectedBadge = getSelectedStatusBadgeDetails();

                  return (
                    <View style={[styles.notionInputRow, { borderBottomColor: colors.border }]}>
                      <View style={[styles.notionPill, { backgroundColor: selectedBadge.bg }]}>
                        <View style={[styles.notionDot, { backgroundColor: selectedBadge.dot }]} />
                        <Text style={[styles.notionPillText, { color: selectedBadge.text }]}>{selectedBadge.label}</Text>
                      </View>
                      <View style={styles.notionCursorContainer}>
                        <Text style={styles.notionCursor}>|</Text>
                      </View>
                      <TouchableOpacity 
                        style={{ marginLeft: 'auto', padding: 4 }}
                        onPress={() => setStatusModalVisible(false)}
                      >
                        <Ionicons name="close" size={18} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  );
                })()}

                {/* 2. Nhóm 1: Việc cần làm */}
                <View style={styles.notionGroup}>
                  <Text style={[styles.notionGroupHeader, { color: colorScheme === 'dark' ? '#94a3b8' : '#7a7a78' }]}>Việc cần làm</Text>
                  <TouchableOpacity
                    style={[
                      styles.notionOptionRow,
                      selectedTaskForStatus?.status === 'todo' && { backgroundColor: colorScheme === 'dark' ? '#334155' : '#f4f4f5' }
                    ]}
                    onPress={() => selectedTaskForStatus && handleUpdateStatus(selectedTaskForStatus.id, 'todo')}
                  >
                    <View style={[styles.notionPill, { backgroundColor: colorScheme === 'dark' ? '#334155' : '#e3e2e0' }]}>
                      <View style={[styles.notionDot, { backgroundColor: colorScheme === 'dark' ? '#94a3b8' : '#787774' }]} />
                      <Text style={[styles.notionPillText, { color: colorScheme === 'dark' ? '#e2e8f0' : '#37352f' }]}>Chưa bắt đầu</Text>
                    </View>
                    {selectedTaskForStatus?.status === 'todo' && (
                      <Ionicons name="checkmark" size={14} color={colors.tint} style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>
                </View>

                {/* 3. Nhóm 2: Đang thực hiện */}
                <View style={styles.notionGroup}>
                  <Text style={[styles.notionGroupHeader, { color: colorScheme === 'dark' ? '#94a3b8' : '#7a7a78' }]}>Đang thực hiện</Text>
                  <TouchableOpacity
                    style={[
                      styles.notionOptionRow,
                      selectedTaskForStatus?.status === 'in_progress' && { backgroundColor: colorScheme === 'dark' ? '#1e3a8a' : '#eff6ff' }
                    ]}
                    onPress={() => selectedTaskForStatus && handleUpdateStatus(selectedTaskForStatus.id, 'in_progress')}
                  >
                    <View style={[styles.notionPill, { backgroundColor: colorScheme === 'dark' ? '#1e3a8a' : '#e2ecf5' }]}>
                      <View style={[styles.notionDot, { backgroundColor: colorScheme === 'dark' ? '#3b82f6' : '#2b76c2' }]} />
                      <Text style={[styles.notionPillText, { color: colorScheme === 'dark' ? '#93c5fd' : '#1d62ac' }]}>Đang thực hiện</Text>
                    </View>
                    {selectedTaskForStatus?.status === 'in_progress' && (
                      <Ionicons name="checkmark" size={14} color={colors.tint} style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>
                </View>

                {/* 4. Nhóm 3: Hoàn tất */}
                <View style={styles.notionGroup}>
                  <Text style={[styles.notionGroupHeader, { color: colorScheme === 'dark' ? '#94a3b8' : '#7a7a78' }]}>Hoàn tất</Text>
                  <TouchableOpacity
                    style={[
                      styles.notionOptionRow,
                      selectedTaskForStatus?.status === 'completed' && { backgroundColor: colorScheme === 'dark' ? '#064e3b' : '#edf6f2' }
                    ]}
                    onPress={() => selectedTaskForStatus && handleUpdateStatus(selectedTaskForStatus.id, 'completed')}
                  >
                    <View style={[styles.notionPill, { backgroundColor: colorScheme === 'dark' ? '#064e3b' : '#e2f2e7' }]}>
                      <View style={[styles.notionDot, { backgroundColor: colorScheme === 'dark' ? '#10b981' : '#208b59' }]} />
                      <Text style={[styles.notionPillText, { color: colorScheme === 'dark' ? '#6ee7b7' : '#18794e' }]}>Hoàn tất</Text>
                    </View>
                    {selectedTaskForStatus?.status === 'completed' && (
                      <Ionicons name="checkmark" size={14} color={colors.tint} style={{ marginLeft: 'auto' }} />
                    )}
                  </TouchableOpacity>
                </View>

                {/* 5. Footer: Chỉnh sửa thuộc tính */}
                <View style={[styles.notionFooterDivider, { backgroundColor: colors.border }]} />
                <TouchableOpacity
                  activeOpacity={0.7}
                  style={styles.notionFooterRow}
                  onPress={() => {
                    setStatusModalVisible(false);
                    Alert.alert("Chỉnh sửa thuộc tính", "Tính năng tùy biến thẻ thuộc tính chỉ dành cho tài khoản quản trị.");
                  }}
                >
                  <Ionicons name="options-outline" size={16} color={colorScheme === 'dark' ? '#94a3b8' : '#7a7a78'} style={{ marginRight: 8 }} />
                  <Text style={[styles.notionFooterText, { color: colors.text, fontSize: 12 }]}>Chỉnh sửa thuộc tính</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </TouchableOpacity>
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
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuBtn: {
    padding: 2,
  },
  brandText: {
    fontSize: 20,
    fontWeight: '800',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  bellBtn: {
    padding: 4,
    position: 'relative',
  },
  bellDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#ef4444',
  },
  profileAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 80,
  },
  breadcrumbText: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 14,
  },
  bannerWrapper: {
    height: 120,
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: 20,
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 14,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    height: 44,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
  },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  notionTable: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.02,
    shadowRadius: 6,
    elevation: 2,
  },
  tableHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  tableHeaderCol1: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  tableHeaderCol2: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  tableHeaderCol3: {
    fontSize: 11,
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: 0.5,
  },
  tableRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  taskTitleCol: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  taskTitleText: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  taskDescSnippet: {
    fontSize: 11,
    marginTop: 2,
  },
  statusBadgeTouch: {
    paddingVertical: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    alignSelf: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  bossCheckTouch: {
    paddingVertical: 6,
  },
  // Notion Status Dropdown Picker Styles
  notionDropdownBackdrop: {
    flex: 1,
    backgroundColor: 'transparent', // Hoàn toàn trong suốt như Notion
  },
  notionDropdownCard: {
    position: 'absolute',
    width: 220,
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  statusModalContent: {
    padding: 12,
  },
  notionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1,
    marginBottom: 12,
    gap: 6,
  },
  notionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    alignSelf: 'flex-start',
  },
  notionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  notionPillText: {
    fontSize: 13,
    fontWeight: '600',
  },
  notionCursorContainer: {
    height: 20,
    justifyContent: 'center',
  },
  notionCursor: {
    fontSize: 16,
    color: '#8b8b89',
    fontWeight: '300',
    marginTop: -2,
  },
  notionGroup: {
    marginBottom: 14,
  },
  notionGroupHeader: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  notionOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  notionFooterDivider: {
    height: 1,
    marginVertical: 10,
  },
  notionFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  notionFooterText: {
    fontSize: 13,
    fontWeight: '500',
  },
  addPageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  addPageText: {
    fontSize: 14,
    color: '#727785',
    fontWeight: '600',
  },
  emptyTableRow: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    bottom: 24,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0058be',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 6,
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
    maxHeight: '85%',
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
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  prioritySelector: {
    flexDirection: 'row',
    gap: 10,
  },
  priorityOption: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  priorityOptionText: {
    fontSize: 12,
  },
  userSelector: {
    flexDirection: 'row',
    height: 44,
  },
  userOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitBtn: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 24,
  },
  submitBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});
