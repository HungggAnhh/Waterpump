// frontend/app/workspace/[workspaceId].tsx
import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Modal,
  ActivityIndicator,
  Platform,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useUser } from '@/context/UserContext';
import { useSocket } from '@/context/SocketContext';
import { API_BASE_URL } from '@/constants/Config';

interface Task {
  id: number;
  workspace_id: number;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  assigned_to: number | null;
  assignee_name?: string;
  assignee_avatar?: string;
  created_by: number | null;
  deadline: string | null;
  completed: boolean;
  is_reviewed?: boolean;
  reminder_interval?: 'hourly' | 'daily' | null;
  last_reminded_at?: string | null;
  created_at: string;
  updated_at?: string;
}



export default function PageTasksScreen() {
  const { workspaceId } = useLocalSearchParams();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useUser();
  const { socket } = useSocket();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceName, setWorkspaceName] = useState('Trình theo dõi nhiệm vụ');

  // Filters (Tất cả nhiệm vụ / Nhiệm vụ của tôi)
  const [viewFilter, setViewFilter] = useState<'all' | 'my_tasks'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isUrgeModalOpen, setIsUrgeModalOpen] = useState(false);
  const [submittingUrge, setSubmittingUrge] = useState(false);

  // Form Fields (For create and edit)
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStatus, setFormStatus] = useState<'todo' | 'in_progress' | 'completed'>('todo');
  const [formPriority, setFormPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [formAssignedTo, setFormAssignedTo] = useState<string>('');
  const [submittingTask, setSubmittingTask] = useState(false);

  // Quick Status Edit Dropdown State
  const [quickStatusTask, setQuickStatusTask] = useState<Task | null>(null);
  const [quickPriorityTask, setQuickPriorityTask] = useState<Task | null>(null);

  // Inline Add Task State
  const [isInlineAdding, setIsInlineAdding] = useState(false);
  const [inlineTitle, setInlineTitle] = useState('');

  // Fetch tasks directly belonging to workspaceId
  const fetchTasks = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tasks/workspaces/${workspaceId}/tasks`);
      const result = await res.json();
      if (result.status === 'success') {
        setTasks(result.data || []);
      }
    } catch (err) {
      console.error('Lỗi lấy danh sách task:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch workspace details
  const fetchWorkspaceDetails = async () => {
    try {
      const wsRes = await fetch(`${API_BASE_URL}/tasks/workspaces`);
      const wsResult = await wsRes.json();
      if (wsResult.status === 'success') {
        const ws = wsResult.data.find((w: any) => w.id === parseInt(workspaceId as string));
        if (ws) {
          setWorkspaceName(ws.name);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchWorkspaceDetails();
  }, [workspaceId, user]);

  // Realtime Socket Sync
  useEffect(() => {
    if (!socket) return;

    const handleTaskCreated = (newTask: Task) => {
      if (newTask.workspace_id === parseInt(workspaceId as string)) {
        setTasks(prev => {
          if (prev.some(t => t.id === newTask.id)) return prev;
          return [...prev, newTask];
        });
      }
    };

    const handleTaskUpdated = (updatedTask: Task) => {
      if (updatedTask.workspace_id === parseInt(workspaceId as string)) {
        setTasks(prev => {
          const exists = prev.some(t => t.id === updatedTask.id);
          if (!exists) {
            return [...prev, updatedTask];
          }
          return prev.map(t => t.id === updatedTask.id ? updatedTask : t);
        });

        setSelectedTask(prev => {
          if (prev && prev.id === updatedTask.id) {
            return updatedTask;
          }
          return prev;
        });
      } else {
        setTasks(prev => prev.filter(t => t.id !== updatedTask.id));
      }
    };

    const handleTaskDeleted = (deleted: { id: number }) => {
      setTasks(prev => prev.filter(t => t.id !== deleted.id));
      if (selectedTask && selectedTask.id === deleted.id) {
        setIsDetailModalOpen(false);
        setSelectedTask(null);
      }
    };

    socket.on('task_created', handleTaskCreated);
    socket.on('task_updated', handleTaskUpdated);
    socket.on('task_deleted', handleTaskDeleted);

    return () => {
      socket.off('task_created', handleTaskCreated);
      socket.off('task_updated', handleTaskUpdated);
      socket.off('task_deleted', handleTaskDeleted);
    };
  }, [socket, workspaceId, user, selectedTask]);

  const handleCreateTaskInline = async () => {
    if (!inlineTitle.trim()) {
      setIsInlineAdding(false);
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: parseInt(workspaceId as string),
          title: inlineTitle,
          status: 'todo', // default Chưa bắt đầu
          priority: 'low', // default Bình thường
          description: null,
          assigned_to: null,
        }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        setInlineTitle('');
        setIsInlineAdding(false);
      } else {
        alert(result.message || 'Lỗi khi tạo công việc.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    }
  };



  const handleCreateTask = async () => {
    if (!formTitle.trim()) return;
    try {
      setSubmittingTask(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: parseInt(workspaceId as string),
          title: formTitle,
          description: formDesc,
          status: formStatus,
          priority: formPriority,
          assigned_to: formAssignedTo ? parseInt(formAssignedTo) : null,
          deadline: null,
        }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        setIsTaskModalOpen(false);
      } else {
        alert(result.message || 'Lỗi khi tạo công việc.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    } finally {
      setSubmittingTask(false);
    }
  };

  const handleOpenEditModal = (task: Task) => {
    setSelectedTask(task);
    setFormTitle(task.title);
    setFormDesc(task.description || '');
    setFormStatus(task.status);
    setFormPriority(task.priority);
    setFormAssignedTo(task.assigned_to ? String(task.assigned_to) : '');
    setIsDetailModalOpen(false);
    setIsTaskModalOpen(true);
  };

  const handleUpdateTask = async () => {
    if (!selectedTask || !formTitle.trim()) return;
    try {
      setSubmittingTask(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${selectedTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: formTitle,
          description: formDesc,
          status: formStatus,
          priority: formPriority,
          assigned_to: formAssignedTo ? parseInt(formAssignedTo) : null,
          deadline: null,
        }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        setIsTaskModalOpen(false);
        setSelectedTask(null);
      } else {
        alert(result.message || 'Lỗi cập nhật.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    } finally {
      setSubmittingTask(false);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    if (!confirm('Bạn có chắc chắn muốn xóa nhiệm vụ này?')) return;
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${taskId}`, {
        method: 'DELETE',
      });
      const result = await res.json();
      if (result.status === 'success') {
        setIsDetailModalOpen(false);
        setSelectedTask(null);
      } else {
        alert(result.message || 'Lỗi khi xóa.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi mạng.');
    }
  };

  const handleUrgeTask = async (interval: 'now' | 'hourly' | 'daily' | 'off') => {
    if (!selectedTask) return;
    try {
      setSubmittingUrge(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${selectedTask.id}/urge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        alert(result.message);
        setIsUrgeModalOpen(false);
        const updatedInterval = (interval === 'off' || interval === 'now') ? null : interval;
        setTasks(prev => prev.map(t => t.id === selectedTask.id ? { ...t, reminder_interval: updatedInterval } : t));
        setSelectedTask(prev => prev ? { ...prev, reminder_interval: updatedInterval } : null);
      } else {
        alert(result.message || 'Lỗi khi gửi yêu cầu hối thúc.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    } finally {
      setSubmittingUrge(false);
    }
  };

  const handleQuickStatusChange = async (task: Task, newStatus: 'todo' | 'in_progress' | 'completed') => {
    try {
      setQuickStatusTask(null);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          completed: newStatus === 'completed',
        }),
      });
      const result = await res.json();
      if (result.status !== 'success') {
        alert(result.message || 'Không thể cập nhật trạng thái.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi mạng.');
    }
  };

  const handleReviewTask = (task: Task, targetValue: boolean) => {
    const doReview = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_reviewed: targetValue })
        });
        const result = await res.json();
        if (result.status !== 'success') {
          alert('Lỗi cập nhật: ' + result.message);
        }
      } catch (err) {
        console.error(err);
        alert('Lỗi mạng.');
      }
    };

    const msg = targetValue 
      ? 'Bạn có chắc chắn muốn đánh dấu nhiệm vụ này đã được sếp duyệt?'
      : 'Bạn có chắc chắn muốn bỏ đánh dấu duyệt?';

    if (Platform.OS === 'web') {
      if (window.confirm(msg)) {
        doReview();
      }
    } else {
      Alert.alert(
        "Xác nhận",
        msg,
        [
          { text: "Hủy", style: "cancel" },
          { text: "Đồng ý", onPress: doReview }
        ]
      );
    }
  };

  const handleQuickPriorityChange = async (task: Task, newPriority: 'low' | 'medium' | 'high') => {
    try {
      setQuickPriorityTask(null);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          priority: newPriority,
        }),
      });
      const result = await res.json();
      if (result.status !== 'success') {
        alert(result.message || 'Không thể cập nhật mức độ.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi mạng.');
    }
  };

  const isAdmin = user?.role === 'admin';

  // Apply Filters
  const filteredTasks = tasks.filter(task => {
    if (viewFilter === 'my_tasks' && task.assigned_to !== user?.id) {
      return false;
    }
    if (statusFilter !== 'all' && task.status !== statusFilter) {
      return false;
    }
    return true;
  }).sort((a, b) => {
    if (a.is_reviewed && !b.is_reviewed) return 1;
    if (!a.is_reviewed && b.is_reviewed) return -1;
    return 0;
  });

  const getStatusText = (status: string) => {
    switch (status) {
      case 'todo': return 'Chưa bắt đầu';
      case 'in_progress': return 'Đang thực hiện';
      case 'completed': return 'Hoàn tất';
      default: return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'todo': return { bg: '#f1f5f9', text: '#64748b', dot: '#94a3b8' }; // Gray
      case 'in_progress': return { bg: '#e0f2fe', text: '#0284c7', dot: '#0ea5e9' }; // Blue
      case 'completed': return { bg: '#d1fae5', text: '#059669', dot: '#10b981' }; // Green
      default: return { bg: '#f1f5f9', text: '#64748b', dot: '#94a3b8' };
    }
  };

  const getPriorityText = (priority: string) => {
    switch (priority) {
      case 'low': return 'Thấp';
      case 'medium': return 'Trung bình';
      case 'high': return 'Cao';
      default: return priority;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'low': return { bg: '#e2e8f0', text: '#475569' }; // Thấp
      case 'medium': return { bg: '#fef3c7', text: '#d97706' }; // Trung bình
      case 'high': return { bg: '#fee2e2', text: '#dc2626' }; // Cao
      default: return { bg: '#e2e8f0', text: '#475569' };
    }
  };



  const formatDateTime = (dateStr: string | null | undefined) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${day}/${month}/${year} ${hours}:${minutes}`;
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* 1. Breadcrumbs Header */}
      <View style={[styles.breadcrumbContainer, { borderColor: colors.border }]}>
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.6}>
            <Text style={[styles.breadcrumbParentText, { color: colors.tabIconDefault }]}>Công việc</Text>
          </TouchableOpacity>
          <Text style={[styles.breadcrumbDivider, { color: colors.tabIconDefault }]}>/</Text>
          <View style={styles.breadcrumbCurrent}>
            <Ionicons name="checkmark-circle" size={15} color="#059669" style={{ marginRight: 5 }} />
            <Text style={[styles.breadcrumbCurrentText, { color: colors.text }]}>{workspaceName}</Text>
          </View>
        </View>

        <View style={styles.headerRightMenu}>
          <Text style={[styles.lastEditedText, { color: colors.tabIconDefault }]}>Đã chỉnh sửa 3 phút trước</Text>
          <TouchableOpacity style={[styles.shareBtn, { borderColor: colors.border }]}>
            <Text style={[styles.shareBtnText, { color: colors.text }]}>Chia sẻ</Text>
            <Ionicons name="chevron-down" size={12} color={colors.text} style={{ marginLeft: 4 }} />
          </TouchableOpacity>
          <Ionicons name="ellipsis-horizontal" size={18} color={colors.tabIconDefault} style={{ marginLeft: 10 }} />
        </View>
      </View>

      {/* 2. Notion-Style Title & Subtitle */}
      <View style={styles.notionTitleSection}>
        <View style={styles.notionTitleRow}>
          <Ionicons name="checkmark-circle" size={32} color="#059669" style={{ marginRight: 12 }} />
          <Text style={[styles.notionTitle, { color: colors.text }]}>{workspaceName}</Text>
        </View>
        <Text style={[styles.notionSubtitle, { color: colors.tabIconDefault }]}>
          Sắp xếp hợp lý công việc theo cách của bạn.
        </Text>
      </View>

      {/* 3. Notion-Style View Tabs */}
      <View style={[styles.notionTabsBar, { borderColor: colors.border }]}>
        <ScrollView 
          horizontal 
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ 
            flexDirection: 'row', 
            alignItems: 'center', 
            gap: 8,
            paddingRight: 16,
          }}
        >
          <TouchableOpacity
            style={[styles.tabBtn, viewFilter === 'all' && styles.tabBtnActive]}
            onPress={() => {
              setViewFilter('all');
              setStatusFilter('all');
            }}
          >
            <Ionicons name="star" size={14} color={viewFilter === 'all' ? colors.text : colors.tabIconDefault} style={{ marginRight: 5 }} />
            <Text style={[styles.tabBtnText, { color: viewFilter === 'all' ? colors.text : colors.tabIconDefault }]}>
              Tất cả
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, statusFilter !== 'all' && styles.tabBtnActive]}
            onPress={() => {
              const next: Record<string, string> = { all: 'todo', todo: 'in_progress', in_progress: 'completed', completed: 'all' };
              setStatusFilter(next[statusFilter] || 'all');
            }}
          >
            <Ionicons name="arrow-forward-circle" size={14} color={statusFilter !== 'all' ? colors.text : colors.tabIconDefault} style={{ marginRight: 5 }} />
            <Text style={[styles.tabBtnText, { color: statusFilter !== 'all' ? colors.text : colors.tabIconDefault }]}>
              {statusFilter === 'all' ? 'Trạng thái' : getStatusText(statusFilter)}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, viewFilter === 'my_tasks' && styles.tabBtnActive]}
            onPress={() => {
              setViewFilter('my_tasks');
              setStatusFilter('all');
            }}
          >
            <Ionicons name="person" size={14} color={viewFilter === 'my_tasks' ? colors.text : colors.tabIconDefault} style={{ marginRight: 5 }} />
            <Text style={[styles.tabBtnText, { color: viewFilter === 'my_tasks' ? colors.text : colors.tabIconDefault }]}>
              Của tôi
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* 4. Notion Grid Table */}
      {loading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.loaderText, { color: colors.tabIconDefault }]}>Đang tải cơ sở dữ liệu...</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} horizontal={true} showsHorizontalScrollIndicator={true} contentContainerStyle={{ minWidth: '100%' }}>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
            {/* Table Header Row */}
            <View style={[styles.tableHeader, { backgroundColor: colors.background, borderBottomColor: colors.border, borderTopColor: colors.border }]}>
              <View style={[styles.colHeader, styles.colTitle, { borderRightColor: colors.border }]}>
                <Ionicons name="text-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Tên nhiệm vụ</Text>
              </View>
              <View style={[styles.colHeader, styles.colStatus, { borderRightColor: colors.border }]}>
                <Ionicons name="ellipse-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Trạng thái</Text>
              </View>
              <View style={[styles.colHeader, styles.colPriority, { borderRightColor: colors.border }]}>
                <Ionicons name="options-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Mức độ</Text>
              </View>
              <View style={[styles.colHeader, styles.colReviewed, { borderRightColor: colors.border }]}>
                <Ionicons name="checkmark-done-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Duyệt</Text>
              </View>
              <View style={[styles.colHeader, styles.colUrge, { borderRightColor: colors.border }]}>
                <Ionicons name="thunderstorm-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Hối thúc</Text>
              </View>
              <View style={[styles.colHeader, styles.colDesc]}>
                <Ionicons name="menu-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Mô tả</Text>
              </View>
            </View>

            {/* Table Body Rows */}
            {filteredTasks.map(task => {
              const statusColor = getStatusColor(task.status);
              const priorityColor = getPriorityColor(task.priority);
              const isAssignedToMe = task.assigned_to === user?.id;
              const canEditStatus = isAdmin || isAssignedToMe;

              return (
                <View
                  key={task.id}
                  style={[
                    styles.tableRow,
                    { 
                      backgroundColor: colors.card, 
                      borderBottomColor: colors.border,
                      opacity: task.is_reviewed ? 0.4 : 1,
                    }
                  ]}
                >
                  <View style={[styles.colCell, styles.colTitle, { borderRightColor: colors.border }]}>
                    <TouchableOpacity
                      style={{ flex: 1 }}
                      onPress={() => {
                        setSelectedTask(task);
                        setIsDetailModalOpen(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.taskTitleText,
                          { color: colors.text, textDecorationLine: task.completed ? 'line-through' : 'none' }
                        ]}
                        numberOfLines={1}
                      >
                        {task.title}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Column 2: Trạng thái */}
                  <View style={[styles.colCell, styles.colStatus, { borderRightColor: colors.border }]}>
                    <TouchableOpacity
                      style={[styles.notionStatusBadge, { backgroundColor: statusColor.bg }]}
                      onPress={() => {
                        if (canEditStatus) {
                          setQuickStatusTask(task);
                        } else {
                          alert('Bạn chỉ có quyền cập nhật trạng thái nhiệm vụ của mình.');
                        }
                      }}
                      activeOpacity={canEditStatus ? 0.7 : 1}
                    >
                      <View style={[styles.statusDot, { backgroundColor: statusColor.dot }]} />
                      <Text style={[styles.notionStatusText, { color: statusColor.text }]}>
                        {getStatusText(task.status)}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Column 3: Mức độ */}
                  <View style={[styles.colCell, styles.colPriority, { borderRightColor: colors.border }]}>
                    <TouchableOpacity
                      style={[styles.notionPriorityBadge, { backgroundColor: priorityColor.bg }]}
                      onPress={() => {
                        if (canEditStatus) {
                          setQuickPriorityTask(task);
                        } else {
                          alert('Bạn chỉ có quyền cập nhật mức độ công việc của mình.');
                        }
                      }}
                      activeOpacity={canEditStatus ? 0.7 : 1}
                    >
                      <Text style={[styles.notionPriorityText, { color: priorityColor.text }]}>
                        {getPriorityText(task.priority)}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* Column 4: Duyệt */}
                  <View style={[styles.colCell, styles.colReviewed, { borderRightColor: colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                    {isAdmin ? (
                      <TouchableOpacity 
                        onPress={() => handleReviewTask(task, !task.is_reviewed)}
                        style={{ padding: 4 }}
                      >
                        <Ionicons 
                          name={task.is_reviewed ? "checkbox" : "square-outline"} 
                          size={24} 
                          color={task.is_reviewed ? "#10b981" : colors.tabIconDefault} 
                        />
                      </TouchableOpacity>
                    ) : (
                      <View style={{ padding: 4 }}>
                        <Ionicons 
                          name={task.is_reviewed ? "checkbox" : "square-outline"} 
                          size={24} 
                          color={task.is_reviewed ? "#10b981" : colors.tabIconDefault} 
                        />
                      </View>
                    )}
                  </View>

                  {/* Column 4.5: Hối thúc */}
                  <View style={[styles.colCell, styles.colUrge, { borderRightColor: colors.border, alignItems: 'center', justifyContent: 'center' }]}>
                    {task.priority?.toLowerCase() === 'high' && !task.completed ? (
                      isAdmin ? (
                        <TouchableOpacity
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            backgroundColor: task.reminder_interval ? '#fef3c7' : 'transparent',
                            borderColor: task.reminder_interval ? '#f59e0b' : colors.border,
                            borderWidth: task.reminder_interval ? 1 : 0.5,
                            borderRadius: 6,
                            paddingHorizontal: 8,
                            paddingVertical: 3,
                          }}
                          onPress={() => {
                            setSelectedTask(task);
                            setIsUrgeModalOpen(true);
                          }}
                          activeOpacity={0.7}
                        >
                          <Ionicons 
                            name="flash" 
                            size={14} 
                            color={task.reminder_interval ? '#d97706' : colors.tabIconDefault} 
                            style={{ marginRight: task.reminder_interval ? 4 : 0 }}
                          />
                          {task.reminder_interval && (
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400e' }}>
                              {task.reminder_interval === 'hourly' ? '1 giờ' : '1 ngày'}
                            </Text>
                          )}
                        </TouchableOpacity>
                      ) : (
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons 
                            name="flash" 
                            size={14} 
                            color={task.reminder_interval ? '#d97706' : colors.tabIconDefault} 
                          />
                          {task.reminder_interval && (
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#92400e', marginLeft: 4 }}>
                              {task.reminder_interval === 'hourly' ? 'Mỗi giờ' : 'Mỗi ngày'}
                            </Text>
                          )}
                        </View>
                      )
                    ) : (
                      <Text style={{ color: colors.tabIconDefault, fontSize: 12 }}>—</Text>
                    )}
                  </View>

                  {/* Column 5: Mô tả */}
                  <View style={[styles.colCell, styles.colDesc]}>
                    <Text style={[styles.descText, { color: colors.tabIconDefault }]} numberOfLines={1}>
                      {task.description || ''}
                    </Text>
                  </View>
                </View>
              );
            })}

            {/* Bottom Row: "+ nhiệm vụ mới" */}
            {isAdmin && (
              <View style={[styles.tableRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
                <View style={[styles.colCell, styles.colTitle]}>
                  {isInlineAdding ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', width: '100%' }}>
                      <TextInput
                        style={{
                          flex: 1,
                          fontSize: 13.5,
                          fontWeight: '700',
                          color: colors.text,
                          paddingVertical: 2,
                          paddingHorizontal: 6,
                          borderWidth: 1,
                          borderColor: colors.tint,
                          borderRadius: 4,
                          backgroundColor: colors.background,
                        }}
                        autoFocus
                        placeholder="Nhập tên nhiệm vụ..."
                        placeholderTextColor={colors.tabIconDefault}
                        value={inlineTitle}
                        onChangeText={setInlineTitle}
                        onSubmitEditing={handleCreateTaskInline}
                      />
                      <TouchableOpacity onPress={handleCreateTaskInline} style={{ padding: 4, marginLeft: 4 }}>
                        <Ionicons name="checkmark-circle" size={20} color="#10b981" />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => { setIsInlineAdding(false); setInlineTitle(''); }} style={{ padding: 4 }}>
                        <Ionicons name="close-circle" size={20} color="#ef4444" />
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', width: '100%', paddingVertical: 4 }}
                      onPress={() => setIsInlineAdding(true)}
                      activeOpacity={0.6}
                    >
                      <Ionicons name="add" size={16} color={colors.tabIconDefault} style={{ marginRight: 6 }} />
                      <Text style={{ color: colors.tabIconDefault, fontSize: 13.5, fontWeight: '500' }}>nhiệm vụ mới</Text>
                    </TouchableOpacity>
                  )}
                </View>
                
                <View style={[styles.colCell, styles.colStatus, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
                <View style={[styles.colCell, styles.colPriority, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
                <View style={[styles.colCell, styles.colReviewed, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
                <View style={[styles.colCell, styles.colUrge, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
                <View style={[styles.colCell, styles.colDesc, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              </View>
            )}
          </ScrollView>
        </ScrollView>
      )}

      {/* 5. Quick Status Change Modal */}
      <Modal
        visible={quickStatusTask !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setQuickStatusTask(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setQuickStatusTask(null)}
        >
          <View style={[styles.quickStatusCard, { backgroundColor: colors.card }]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.quickStatusTitle, { color: colors.text }]}>Trạng thái</Text>
            
            <View style={styles.quickStatusOptions}>
              {(['todo', 'in_progress', 'completed'] as const).map(s => {
                const sColor = getStatusColor(s);
                const isSelected = quickStatusTask?.status === s;
                return (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.quickStatusBtn,
                      { backgroundColor: sColor.bg },
                      isSelected && { borderWidth: 1.5, borderColor: sColor.text }
                    ]}
                    onPress={() => quickStatusTask && handleQuickStatusChange(quickStatusTask, s)}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={[styles.statusDot, { backgroundColor: sColor.dot, marginRight: 8 }]} />
                      <Text style={[styles.quickStatusText, { color: sColor.text, fontWeight: '700' }]}>
                        {getStatusText(s)}
                      </Text>
                    </View>
                    {isSelected && <Ionicons name="checkmark" size={16} color={sColor.text} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 5.5. Quick Priority Change Modal */}
      <Modal
        visible={quickPriorityTask !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setQuickPriorityTask(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setQuickPriorityTask(null)}
        >
          <View style={[styles.quickStatusCard, { backgroundColor: colors.card }]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.quickStatusTitle, { color: colors.text }]}>Mức độ</Text>
            
            <View style={styles.quickStatusOptions}>
              {(['low', 'medium', 'high'] as const).map(p => {
                const pColor = getPriorityColor(p);
                const isSelected = quickPriorityTask?.priority === p;
                return (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.quickStatusBtn,
                      { backgroundColor: pColor.bg },
                      isSelected && { borderWidth: 1.5, borderColor: pColor.text }
                    ]}
                    onPress={() => quickPriorityTask && handleQuickPriorityChange(quickPriorityTask, p)}
                  >
                    <Text style={[styles.quickStatusText, { color: pColor.text, fontWeight: '700' }]}>
                      {getPriorityText(p)}
                    </Text>
                    {isSelected && <Ionicons name="checkmark" size={16} color={pColor.text} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 6. Modal: Giao việc & Chỉnh sửa */}
      <Modal
        visible={isTaskModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setIsTaskModalOpen(false);
          setSelectedTask(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <ScrollView style={{ width: '100%', maxWidth: 360 }} contentContainerStyle={{ justifyContent: 'center', flexGrow: 1 }}>
            <View style={[styles.formCard, { backgroundColor: colors.card }]}>
              <Text style={[styles.formTitle, { color: colors.text }]}>
                {selectedTask ? 'Chỉnh sửa nhiệm vụ' : 'Nhiệm vụ mới'}
              </Text>

              <Text style={[styles.formLabel, { color: colors.text }]}>Tên nhiệm vụ *</Text>
              <TextInput
                style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: isAdmin ? colors.background : colors.card, opacity: isAdmin ? 1 : 0.6 }]}
                placeholder="Nhập tên nhiệm vụ..."
                placeholderTextColor={colors.tabIconDefault}
                value={formTitle}
                onChangeText={setFormTitle}
                editable={isAdmin}
              />

              <Text style={[styles.formLabel, { color: colors.text }]}>Mô tả</Text>
              <TextInput
                style={[styles.formInput, styles.formTextArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                placeholder="Mô tả công việc chi tiết..."
                placeholderTextColor={colors.tabIconDefault}
                value={formDesc}
                onChangeText={setFormDesc}
                multiline
                numberOfLines={3}
              />

              <View style={styles.formRow}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={[styles.formLabel, { color: colors.text }]}>Trạng thái</Text>
                  <View style={[styles.pickerContainer, { borderColor: colors.border, backgroundColor: colors.background }]}>
                    <TouchableOpacity
                      style={styles.pickerTrigger}
                      onPress={() => {
                        const next: Record<string, 'todo' | 'in_progress' | 'completed'> = { todo: 'in_progress', in_progress: 'completed', completed: 'todo' };
                        setFormStatus(next[formStatus]);
                      }}
                    >
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                        {getStatusText(formStatus)}
                      </Text>
                      <Ionicons name="swap-vertical" size={14} color={colors.tabIconDefault} />
                    </TouchableOpacity>
                  </View>
                </View>

                <View style={{ flex: 1, marginLeft: 8 }}>
                  <Text style={[styles.formLabel, { color: colors.text }]}>Mức độ</Text>
                  <View style={[styles.pickerContainer, { borderColor: colors.border, backgroundColor: colors.background }]}>
                    <TouchableOpacity
                      style={styles.pickerTrigger}
                      onPress={() => {
                        const next: Record<string, 'low' | 'medium' | 'high'> = { low: 'medium', medium: 'high', high: 'low' };
                        setFormPriority(next[formPriority]);
                      }}
                    >
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                        {getPriorityText(formPriority)}
                      </Text>
                      <Ionicons name="swap-vertical" size={14} color={colors.tabIconDefault} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>


              <View style={styles.formButtons}>
                <TouchableOpacity
                  style={[styles.btnCancel, { borderColor: colors.border }]}
                  onPress={() => {
                    setIsTaskModalOpen(false);
                    setSelectedTask(null);
                  }}
                >
                  <Text style={[styles.btnCancelText, { color: colors.text }]}>Hủy</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btnSubmit, { backgroundColor: colors.tint }]}
                  onPress={selectedTask ? handleUpdateTask : handleCreateTask}
                  disabled={submittingTask || !formTitle.trim()}
                >
                  {submittingTask ? (
                    <ActivityIndicator size="small" color="#ffffff" />
                  ) : (
                    <Text style={styles.btnSubmitText}>Lưu</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* 7. Modal: Chi tiết nhiệm vụ */}
      <Modal
        visible={isDetailModalOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => {
          setIsDetailModalOpen(false);
          setSelectedTask(null);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.detailCard, { backgroundColor: colors.card }]}>
            <View style={styles.detailHeader}>
              <Text style={[styles.detailTitle, { color: colors.text }]}>Chi tiết nhiệm vụ</Text>
              <TouchableOpacity
                onPress={() => {
                  setIsDetailModalOpen(false);
                  setSelectedTask(null);
                }}
              >
                <Ionicons name="close" size={24} color={colors.tabIconDefault} />
              </TouchableOpacity>
            </View>

            {selectedTask && (
              <ScrollView style={{ maxHeight: 300 }}>
                <Text style={[styles.detailTaskTitle, { color: colors.text }]}>
                  {selectedTask.title}
                </Text>

                <View style={styles.detailBadgeRow}>
                  <View style={[styles.notionStatusBadge, { backgroundColor: getStatusColor(selectedTask.status).bg }]}>
                    <View style={[styles.statusDot, { backgroundColor: getStatusColor(selectedTask.status).dot }]} />
                    <Text style={[styles.notionStatusText, { color: getStatusColor(selectedTask.status).text }]}>
                      {getStatusText(selectedTask.status)}
                    </Text>
                  </View>

                  <View style={[styles.notionPriorityBadge, { backgroundColor: getPriorityColor(selectedTask.priority).bg }]}>
                    <Text style={[styles.notionPriorityText, { color: getPriorityColor(selectedTask.priority).text }]}>
                      {getPriorityText(selectedTask.priority)}
                    </Text>
                  </View>
                </View>

                <Text style={[styles.detailLabel, { color: colors.tabIconDefault }]}>MÔ TẢ CHI TIẾT</Text>
                <Text style={[styles.detailDescText, { color: colors.text }]}>
                  {selectedTask.description || 'Không có mô tả chi tiết cho nhiệm vụ này.'}
                </Text>

                {isAdmin && selectedTask.priority?.toLowerCase() === 'high' && !selectedTask.completed && (
                  <TouchableOpacity
                    style={{ 
                      backgroundColor: '#d97706', 
                      marginVertical: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'center',
                      height: 40,
                      borderRadius: 8,
                      gap: 6
                    }}
                    onPress={() => setIsUrgeModalOpen(true)}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="thunderstorm-outline" size={18} color="#ffffff" />
                    <Text style={{ color: '#ffffff', fontSize: 13, fontWeight: '700' }}>
                      {selectedTask.reminder_interval ? '⚡ Quản lý hối thúc' : '⚡ Hối thúc công việc'}
                    </Text>
                  </TouchableOpacity>
                )}

                <View style={[styles.divider, { backgroundColor: colors.border }]} />


                {/* Active Reminder Interval if set */}
                {selectedTask.reminder_interval && (
                  <View style={{ marginBottom: 14 }}>
                    <Text style={[styles.detailLabel, { color: colors.tabIconDefault }]}>LỊCH NHẮC HẸN</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                      <Ionicons name="alarm-outline" size={16} color="#d97706" style={{ marginRight: 6 }} />
                      <Text style={{ color: '#d97706', fontSize: 13, fontWeight: '700' }}>
                        Nhắc nhở hối thúc: {selectedTask.reminder_interval === 'hourly' ? 'Mỗi giờ' : 'Mỗi ngày'}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Meta Row 2: Timestamps */}
                <View style={styles.detailMetaRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.detailLabel, { color: colors.tabIconDefault }]}>THỜI GIAN GIAO</Text>
                    <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '600', marginTop: 4 }}>
                      {formatDateTime(selectedTask.created_at)}
                    </Text>
                  </View>

                  <View style={{ flex: 1, paddingLeft: 8 }}>
                    <Text style={[styles.detailLabel, { color: colors.tabIconDefault }]}>THỜI GIAN CẬP NHẬT</Text>
                    <Text style={{ color: colors.text, fontSize: 12.5, fontWeight: '600', marginTop: 4 }}>
                      {formatDateTime(selectedTask.updated_at || selectedTask.created_at)}
                    </Text>
                  </View>
                </View>
              </ScrollView>
            )}


            {selectedTask && (isAdmin || selectedTask.assigned_to === user?.id) && (
              <View style={styles.adminControls}>
                {isAdmin && (
                  <TouchableOpacity
                    style={[styles.btnAdminDelete, { borderColor: colors.danger }]}
                    onPress={() => handleDeleteTask(selectedTask.id)}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.danger} />
                    <Text style={[styles.btnAdminDeleteText, { color: colors.danger }]}>Xóa nhiệm vụ</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.btnAdminEdit, { backgroundColor: colors.tint }]}
                  onPress={() => handleOpenEditModal(selectedTask)}
                >
                  <Ionicons name="create-outline" size={16} color="#ffffff" />
                  <Text style={styles.btnAdminEditText}>Chỉnh sửa</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* 7.5. Modal: Hối thúc công việc */}
      <Modal
        visible={isUrgeModalOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsUrgeModalOpen(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setIsUrgeModalOpen(false)}
        >
          <View style={[styles.urgeModalCard, { backgroundColor: colors.card }]} onStartShouldSetResponder={() => true}>
            <View style={styles.urgeModalHeader}>
              <Text style={[styles.urgeModalTitle, { color: colors.text }]}>⚡ Thiết lập hối thúc</Text>
              <TouchableOpacity onPress={() => setIsUrgeModalOpen(false)}>
                <Ionicons name="close" size={20} color={colors.tabIconDefault} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.urgeModalSubtitle, { color: colors.tabIconDefault }]}>
              Chọn phương thức để đôn đốc nhân viên hoàn thành nhiệm vụ này gấp.
            </Text>

            {submittingUrge ? (
              <View style={{ padding: 20, alignItems: 'center' }}>
                <ActivityIndicator size="large" color="#d97706" />
                <Text style={{ marginTop: 10, color: colors.tabIconDefault, fontSize: 12 }}>Đang gửi yêu cầu...</Text>
              </View>
            ) : (
              <View style={styles.urgeOptionsList}>
                {/* 1. Hối thúc ngay lập tức */}
                <TouchableOpacity
                  style={[styles.urgeOptionBtn, { backgroundColor: '#fee2e2', borderColor: '#ef4444' }]}
                  onPress={() => handleUrgeTask('now')}
                >
                  <View style={styles.urgeOptionIconBox}>
                    <Ionicons name="flash" size={20} color="#dc2626" />
                  </View>
                  <View style={styles.urgeOptionTextBox}>
                    <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 2, color: '#b91c1c' }}>Hối thúc ngay</Text>
                    <Text style={{ fontSize: 10.5, fontWeight: '500', color: '#991b1b' }}>Gửi 1 thông báo đẩy khẩn cấp ngay lập tức</Text>
                  </View>
                </TouchableOpacity>

                {/* 2. Nhắc nhở mỗi giờ */}
                <TouchableOpacity
                  style={[
                    styles.urgeOptionBtn, 
                    { backgroundColor: '#fef3c7', borderColor: '#f59e0b' },
                    selectedTask?.reminder_interval === 'hourly' && { borderWidth: 2 }
                  ]}
                  onPress={() => handleUrgeTask('hourly')}
                >
                  <View style={styles.urgeOptionIconBox}>
                    <Ionicons name="alarm" size={20} color="#d97706" />
                  </View>
                  <View style={styles.urgeOptionTextBox}>
                    <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 2, color: '#92400e' }}>Nhắc nhở mỗi giờ</Text>
                    <Text style={{ fontSize: 10.5, fontWeight: '500', color: '#b45309' }}>Thông báo đẩy lặp lại sau mỗi 60 phút</Text>
                  </View>
                  {selectedTask?.reminder_interval === 'hourly' && (
                    <Ionicons name="checkmark-circle" size={20} color="#d97706" style={{ marginLeft: 'auto' }} />
                  )}
                </TouchableOpacity>

                {/* 3. Nhắc nhở mỗi ngày */}
                <TouchableOpacity
                  style={[
                    styles.urgeOptionBtn, 
                    { backgroundColor: '#ecfdf5', borderColor: '#10b981' },
                    selectedTask?.reminder_interval === 'daily' && { borderWidth: 2 }
                  ]}
                  onPress={() => handleUrgeTask('daily')}
                >
                  <View style={styles.urgeOptionIconBox}>
                    <Ionicons name="calendar" size={20} color="#059669" />
                  </View>
                  <View style={styles.urgeOptionTextBox}>
                    <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 2, color: '#065f46' }}>Nhắc nhở mỗi ngày</Text>
                    <Text style={{ fontSize: 10.5, fontWeight: '500', color: '#047857' }}>Thông báo đẩy lặp lại mỗi 24 giờ</Text>
                  </View>
                  {selectedTask?.reminder_interval === 'daily' && (
                    <Ionicons name="checkmark-circle" size={20} color="#059669" style={{ marginLeft: 'auto' }} />
                  )}
                </TouchableOpacity>

                {/* 4. Tắt nhắc nhở */}
                {selectedTask?.reminder_interval && (
                  <TouchableOpacity
                    style={[styles.urgeOptionBtn, { backgroundColor: '#f1f5f9', borderColor: '#94a3b8' }]}
                    onPress={() => handleUrgeTask('off')}
                  >
                    <View style={styles.urgeOptionIconBox}>
                      <Ionicons name="notifications-off" size={20} color="#475569" />
                    </View>
                    <View style={styles.urgeOptionTextBox}>
                      <Text style={{ fontSize: 13, fontWeight: '700', marginBottom: 2, color: '#334155' }}>Tắt nhắc nhở</Text>
                      <Text style={{ fontSize: 10.5, fontWeight: '500', color: '#475569' }}>Ngừng gửi nhắc nhở tự động cho task này</Text>
                    </View>
                  </TouchableOpacity>
                )}
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
  },
  breadcrumbContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 0.5,
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  breadcrumbParentText: {
    fontSize: 13,
    fontWeight: '500',
  },
  breadcrumbDivider: {
    marginHorizontal: 6,
    fontSize: 13,
  },
  breadcrumbCurrent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  breadcrumbCurrentText: {
    fontSize: 13,
    fontWeight: '600',
  },
  headerRightMenu: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lastEditedText: {
    fontSize: 11,
    marginRight: 10,
    display: Platform.OS === 'web' ? 'flex' : 'none',
  },
  shareBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 0.5,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  shareBtnText: {
    fontSize: 11.5,
    fontWeight: '500',
  },
  notionTitleSection: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
  },
  notionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  notionTitle: {
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  notionSubtitle: {
    fontSize: 14,
    fontWeight: '500',
    paddingLeft: 44,
  },
  notionTabsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 0.5,
  },
  tabsLeft: {
    flexDirection: 'row',
    gap: 8,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  tabBtnActive: {
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },
  tabBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tabsRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  notionNewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0969da',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  notionNewBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  loaderContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    marginTop: 12,
    fontSize: 13.5,
  },
  emptyContent: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 40,
  },
  emptyIconBox: {
    width: 70,
    height: 70,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 6,
  },
  emptyDesc: {
    fontSize: 12.5,
    textAlign: 'center',
    lineHeight: 18,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderTopWidth: 1,
    paddingVertical: 8,
    width: '100%',
    minWidth: 750,
  },
  colHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    borderRightWidth: 1,
  },
  colHeaderText: {
    fontSize: 12.5,
    fontWeight: '600',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    alignItems: 'center',
    width: '100%',
    minWidth: 750,
  },
colCell: {
    flexDirection: 'row',     // Thêm dòng này để các phần tử nằm ngang hàng
    alignItems: 'center',     // Thêm dòng này để căn giữa tuyệt đối theo chiều dọc
    paddingHorizontal: 12,
    paddingVertical: 6,       // Giảm bớt padding dọc giúp hàng gọn gàng, không bị quá cao
    borderRightWidth: 1,
    minHeight: 40,
  },
  colTitle: {
    width: 220,
  },
  colStatus: {
    width: 140,
  },
  colUser: {
    width: 160,
  },
  colDeadline: {
    width: 110,
  },
  colPriority: {
    width: 110,
  },
  colReviewed: {
    width: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colUrge: {
    width: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colDesc: {
    flex: 1,
    minWidth: 180,
  },
  taskTitleText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  notionStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  notionStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  assigneeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  assigneeAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginRight: 8,
  },
  assigneeNameText: {
    fontSize: 13,
    fontWeight: '600',
  },
  notionPlaceholderText: {
    color: 'transparent',
  },
  deadlineText: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  notionPriorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  notionPriorityText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  descText: {
    fontSize: 12.5,
    fontWeight: '500',
  },
  quickStatusCard: {
    width: 200,
    borderRadius: 14,
    padding: 12,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
      },
      android: {
        elevation: 4,
      },
    }),
  },
  quickStatusTitle: {
    fontSize: 13.5,
    fontWeight: '800',
    marginBottom: 8,
    paddingLeft: 4,
  },
  quickStatusOptions: {
    gap: 6,
  },
  quickStatusBtn: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  quickStatusText: {
    fontSize: 12.5,
  },
  formCard: {
    borderRadius: 18,
    padding: 20,
    margin: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  formTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
  },
  formLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    marginBottom: 6,
  },
  formInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 14,
  },
  formTextArea: {
    height: 70,
    paddingTop: 8,
    textAlignVertical: 'top',
  },
  formRow: {
    flexDirection: 'row',
    marginBottom: 14,
  },
  pickerContainer: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 42,
    justifyContent: 'center',
  },
  pickerTrigger: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  assigneeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
    marginRight: 6,
  },
  optionAvatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    marginRight: 4,
  },
  formButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 10,
  },
  btnCancel: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancelText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  btnSubmit: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSubmitText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  detailCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 20,
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  detailHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  detailTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  detailTaskTitle: {
    fontSize: 17,
    fontWeight: '800',
    marginBottom: 10,
    lineHeight: 22,
  },
  detailBadgeRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  detailLabel: {
    fontSize: 10.5,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  detailDescText: {
    fontSize: 13.5,
    lineHeight: 20,
    fontWeight: '500',
    marginBottom: 16,
  },
  divider: {
    height: 1,
    width: '100%',
    marginVertical: 14,
  },
  detailMetaRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  adminControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    marginTop: 10,
  },
  btnAdminDelete: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  btnAdminDeleteText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  btnAdminEdit: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  btnAdminEditText: {
    color: '#ffffff',
    fontSize: 12.5,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  urgeModalCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 20,
    padding: 16,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.15,
        shadowRadius: 16,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  urgeModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  urgeModalTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  urgeModalSubtitle: {
    fontSize: 12,
    lineHeight: 16,
    marginBottom: 16,
  },
  urgeOptionsList: {
    gap: 10,
  },
  urgeOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  urgeOptionIconBox: {
    marginRight: 12,
  },
  urgeOptionTextBox: {
    flex: 1,
  },
});
