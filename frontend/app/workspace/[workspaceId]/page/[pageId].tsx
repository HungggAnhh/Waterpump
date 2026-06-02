// frontend/app/workspace/[workspaceId]/page/[pageId].tsx
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
  Image,
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
  page_id: number;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  assigned_to: number | null;
  assignee_name?: string;
  assignee_avatar?: string;
  created_by: number | null;
  creator_name?: string;
  creator_avatar?: string;
  creator_role?: string;
  deadline: string | null;
  completed: boolean;
  created_at: string;
  updated_at?: string;
}

interface UserListItem {
  id: number;
  name: string;
  avatar: string | null;
  role?: string;
}

export default function PageTasksScreen() {
  const { workspaceId, pageId } = useLocalSearchParams();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useUser();
  const { socket } = useSocket();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [usersList, setUsersList] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageName, setPageName] = useState('Trình theo dõi nhiệm vụ');
  const [workspaceName, setWorkspaceName] = useState('Thư mục');

  // Filters (Tất cả nhiệm vụ / Nhiệm vụ của tôi)
  const [viewFilter, setViewFilter] = useState<'all' | 'my_tasks'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);

  // Form Fields (For create and edit)
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStatus, setFormStatus] = useState<'todo' | 'in_progress' | 'completed'>('todo');
  const [formPriority, setFormPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [formAssignedTo, setFormAssignedTo] = useState<string>('');
  const [formDeadline, setFormDeadline] = useState('');
  const [submittingTask, setSubmittingTask] = useState(false);

  // Quick Status Edit Dropdown State
  const [quickStatusTask, setQuickStatusTask] = useState<Task | null>(null);

  // Fetch tasks
  const fetchTasks = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tasks/pages/${pageId}/tasks`);
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

  // Fetch workspace and page name
  const fetchPageName = async () => {
    try {
      const wsRes = await fetch(`${API_BASE_URL}/tasks/workspaces`);
      const wsResult = await wsRes.json();
      if (wsResult.status === 'success') {
        const ws = wsResult.data.find((w: any) => w.id === parseInt(workspaceId as string));
        if (ws) {
          setWorkspaceName(ws.name);
        }
      }

      const res = await fetch(`${API_BASE_URL}/tasks/workspaces/${workspaceId}/pages`);
      const result = await res.json();
      if (result.status === 'success') {
        const page = result.data.find((p: any) => p.id === parseInt(pageId as string));
        if (page) {
          setPageName(page.name);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Fetch users for dropdown assignment
  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/users`);
      const result = await res.json();
      if (result.status === 'success') {
        setUsersList(result.data || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const getAssigneeOptions = () => {
    if (!user) return [];
    if (user.role === 'admin') {
      return usersList;
    } else {
      return usersList.filter(u => u.role === 'admin' || u.id === user.id);
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchPageName();
    fetchUsers();
  }, [pageId, user]);

  // Realtime Socket Sync
  useEffect(() => {
    if (!socket) return;

    const handleTaskCreated = (newTask: Task) => {
      if (newTask.page_id === parseInt(pageId as string)) {
        setTasks(prev => {
          if (prev.some(t => t.id === newTask.id)) return prev;
          // Filter for normal users
          if (user?.role !== 'admin' && newTask.assigned_to !== user?.id) {
            return prev;
          }
          return [...prev, newTask];
        });
      }
    };

    const handleTaskUpdated = (updatedTask: Task) => {
      if (updatedTask.page_id === parseInt(pageId as string)) {
        setTasks(prev => {
          if (user?.role !== 'admin' && updatedTask.assigned_to !== user?.id) {
            return prev.filter(t => t.id !== updatedTask.id);
          }
          return prev.map(t => t.id === updatedTask.id ? { ...t, ...updatedTask } : t);
        });

        setSelectedTask(prev => {
          if (prev && prev.id === updatedTask.id) {
            return { ...prev, ...updatedTask };
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
  }, [socket, pageId, user, selectedTask]);

  const handleOpenCreateModal = () => {
    setFormTitle('');
    setFormDesc('');
    setFormStatus('todo');
    setFormPriority('medium');
    setFormAssignedTo('');
    setFormDeadline('');
    setIsTaskModalOpen(true);
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
          page_id: parseInt(pageId as string),
          title: formTitle,
          description: formDesc,
          status: formStatus,
          priority: formPriority,
          assigned_to: formAssignedTo ? parseInt(formAssignedTo) : null,
          deadline: formDeadline ? new Date(formDeadline).toISOString() : null,
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
    setFormDeadline(task.deadline ? task.deadline.slice(0, 10) : '');
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
          deadline: formDeadline ? new Date(formDeadline).toISOString() : null,
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

  const isAdmin = user?.role === 'admin';

  // Apply Views Filter & Dropdown Status Filter
  const filteredTasks = tasks.filter(task => {
    // 1. My tasks filter
    if (viewFilter === 'my_tasks' && task.assigned_to !== user?.id) {
      return false;
    }
    // 2. Status dropdown filter
    if (statusFilter !== 'all' && task.status !== statusFilter) {
      return false;
    }
    return true;
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
      case 'low': return { bg: '#e2e8f0', text: '#475569' }; // Soft gray/slate
      case 'medium': return { bg: '#fef3c7', text: '#d97706' }; // Soft yellow
      case 'high': return { bg: '#fee2e2', text: '#dc2626' }; // Soft red
      default: return { bg: '#e2e8f0', text: '#475569' };
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`; // MM/DD/YYYY format matching Notion screenshot
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
      {/* 1. Breadcrumbs Header (Matches Phúc / Trình theo dõi nhiệm vụ) */}
      <View style={[styles.breadcrumbContainer, { borderColor: colors.border }]}>
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.6}>
            <Text style={[styles.breadcrumbParentText, { color: colors.tabIconDefault }]}>{workspaceName}</Text>
          </TouchableOpacity>
          <Text style={[styles.breadcrumbDivider, { color: colors.tabIconDefault }]}>/</Text>
          <View style={styles.breadcrumbCurrent}>
            <Ionicons name="checkmark-circle" size={15} color="#059669" style={{ marginRight: 5 }} />
            <Text style={[styles.breadcrumbCurrentText, { color: colors.text }]}>{pageName}</Text>
          </View>
        </View>

        {/* Small indicators */}
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
          <Text style={[styles.notionTitle, { color: colors.text }]}>{pageName}</Text>
        </View>
        <Text style={[styles.notionSubtitle, { color: colors.tabIconDefault }]}>
          Sắp xếp hợp lý công việc theo cách của bạn.
        </Text>
      </View>

      {/* 3. Notion-Style View Tabs */}
      <View style={[styles.notionTabsBar, { borderColor: colors.border }]}>
        <View style={styles.tabsLeft}>
          <TouchableOpacity
            style={[styles.tabBtn, viewFilter === 'all' && styles.tabBtnActive]}
            onPress={() => {
              setViewFilter('all');
              setStatusFilter('all');
            }}
          >
            <Ionicons name="star" size={14} color={viewFilter === 'all' ? colors.text : colors.tabIconDefault} style={{ marginRight: 5 }} />
            <Text style={[styles.tabBtnText, { color: viewFilter === 'all' ? colors.text : colors.tabIconDefault }]}>
              Tất cả nhiệm vụ
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, statusFilter !== 'all' && styles.tabBtnActive]}
            onPress={() => {
              // Cycle filter or trigger status options
              const next: Record<string, string> = { all: 'todo', todo: 'in_progress', in_progress: 'completed', completed: 'all' };
              setStatusFilter(next[statusFilter] || 'all');
            }}
          >
            <Ionicons name="arrow-forward-circle" size={14} color={statusFilter !== 'all' ? colors.text : colors.tabIconDefault} style={{ marginRight: 5 }} />
            <Text style={[styles.tabBtnText, { color: statusFilter !== 'all' ? colors.text : colors.tabIconDefault }]}>
              {statusFilter === 'all' ? 'Theo trạng thái' : `Lọc: ${getStatusText(statusFilter)}`}
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
              Nhiệm vụ của tôi
            </Text>
          </TouchableOpacity>
        </View>

        {/* Right New button (Mới) */}
        <View style={styles.tabsRight}>
          <Ionicons name="search-outline" size={16} color={colors.tabIconDefault} style={{ marginRight: 12 }} />
          <TouchableOpacity
            style={styles.notionNewBtn}
            onPress={handleOpenCreateModal}
            activeOpacity={0.8}
          >
            <Text style={styles.notionNewBtnText}>Mới</Text>
            <Ionicons name="chevron-down" size={12} color="#ffffff" style={{ marginLeft: 4 }} />
          </TouchableOpacity>
        </View>
      </View>

      {/* 4. Notion Grid Database Table */}
      {loading ? (
        <View style={styles.loaderContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.loaderText, { color: colors.tabIconDefault }]}>Đang tải cơ sở dữ liệu...</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} horizontal={true} showsHorizontalScrollIndicator={true}>
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
              <View style={[styles.colHeader, styles.colUser, { borderRightColor: colors.border }]}>
                <Ionicons name="person-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Người giao</Text>
              </View>
              <View style={[styles.colHeader, styles.colUser, { borderRightColor: colors.border }]}>
                <Ionicons name="people-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Người được giao</Text>
              </View>
              <View style={[styles.colHeader, styles.colDeadline, { borderRightColor: colors.border }]}>
                <Ionicons name="calendar-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Hạn chót</Text>
              </View>
              <View style={[styles.colHeader, styles.colPriority, { borderRightColor: colors.border }]}>
                <Ionicons name="options-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Mức độ</Text>
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
                    }
                  ]}
                >
                  {/* Column 1: Tên nhiệm vụ */}
                  <TouchableOpacity
                    style={[styles.colCell, styles.colTitle, { borderRightColor: colors.border }]}
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

                  {/* Column 2: Trạng thái (Matches pill background + solid dot on left) */}
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

                  {/* Column 2.5: Người giao */}
                  <View style={[styles.colCell, styles.colUser, { borderRightColor: colors.border }]}>
                    <View style={styles.assigneeContainer}>
                      {task.creator_avatar ? (
                        <Image source={{ uri: task.creator_avatar }} style={styles.assigneeAvatar} />
                      ) : (
                        <View style={[styles.assigneeAvatar, { backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }]}>
                          <Text style={{ fontSize: 10, color: colors.text, fontWeight: '700' }}>
                            {task.creator_name ? task.creator_name.charAt(0).toUpperCase() : '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={[styles.assigneeNameText, { color: colors.text }]} numberOfLines={1}>
                        {task.creator_name || 'Không xác định'}
                      </Text>
                    </View>
                  </View>

                  {/* Column 3: Người được giao */}
                  <View style={[styles.colCell, styles.colUser, { borderRightColor: colors.border }]}>
                    {task.assigned_to ? (
                      <View style={styles.assigneeContainer}>
                        <Image
                          source={{ uri: task.assignee_avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=50&h=50&q=80' }}
                          style={styles.assigneeAvatar}
                        />
                        <Text style={[styles.assigneeNameText, { color: colors.text }]} numberOfLines={1}>
                          {task.assignee_name} {task.assigned_to === user?.id ? '(Tôi)' : ''}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.notionPlaceholderText}></Text>
                    )}
                  </View>

                  {/* Column 4: Hạn chót (MM/DD/YYYY) */}
                  <View style={[styles.colCell, styles.colDeadline, { borderRightColor: colors.border }]}>
                    {task.deadline ? (
                      <Text style={[styles.deadlineText, { color: colors.text }]}>
                        {formatDate(task.deadline)}
                      </Text>
                    ) : (
                      <Text style={styles.notionPlaceholderText}></Text>
                    )}
                  </View>

                  {/* Column 5: Mức độ */}
                  <View style={[styles.colCell, styles.colPriority, { borderRightColor: colors.border }]}>
                    <View style={[styles.notionPriorityBadge, { backgroundColor: priorityColor.bg }]}>
                      <Text style={[styles.notionPriorityText, { color: priorityColor.text }]}>
                        {getPriorityText(task.priority)}
                      </Text>
                    </View>
                  </View>

                  {/* Column 6: Mô tả */}
                  <View style={[styles.colCell, styles.colDesc]}>
                    <Text style={[styles.descText, { color: colors.tabIconDefault }]} numberOfLines={1}>
                      {task.description || ''}
                    </Text>
                  </View>
                </View>
              );
            })}

            {/* Bottom Row: "+ nhiệm vụ mới" (Matches the first column button) */}
            <View style={[styles.tableRow, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.colCell, styles.colTitle, { flexDirection: 'row', alignItems: 'center', paddingVertical: 10 }]}
                onPress={handleOpenCreateModal}
                activeOpacity={0.6}
              >
                <Ionicons name="add" size={16} color={colors.tabIconDefault} style={{ marginRight: 6 }} />
                <Text style={{ color: colors.tabIconDefault, fontSize: 13.5, fontWeight: '500' }}>nhiệm vụ mới</Text>
              </TouchableOpacity>
              
              {/* Empty placeholders to fill border grids */}
              <View style={[styles.colCell, styles.colStatus, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colUser, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colUser, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colDeadline, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colPriority, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colDesc, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
            </View>
          </ScrollView>
        </ScrollView>
      )}

      {/* 5. Quick Status Change Modal / Popover */}
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

      {/* 6. Modal: Giao việc & Chỉnh sửa (Form Modal) */}
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

              {/* Title */}
              <Text style={[styles.formLabel, { color: colors.text }]}>Tên nhiệm vụ *</Text>
              <TextInput
                style={[
                  styles.formInput, 
                  { 
                    color: colors.text, 
                    borderColor: colors.border, 
                    backgroundColor: (!selectedTask || isAdmin) ? colors.background : colors.card,
                    opacity: (!selectedTask || isAdmin) ? 1 : 0.6
                  }
                ]}
                placeholder="Nhập tên nhiệm vụ..."
                placeholderTextColor={colors.tabIconDefault}
                value={formTitle}
                onChangeText={setFormTitle}
                editable={!selectedTask || isAdmin}
              />

              {/* Description */}
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

              {/* Dropdowns Row (Status & Priority) */}
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

              {/* Assignee Selection */}
              {(!selectedTask || isAdmin) && (
                <>
                  <Text style={[styles.formLabel, { color: colors.text }]}>Người được giao</Text>
                  <View style={[styles.pickerContainer, { borderColor: colors.border, backgroundColor: colors.background, marginBottom: 12 }]}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingVertical: 4 }}>
                      {isAdmin && (
                        <TouchableOpacity
                          style={[
                            styles.assigneeOption,
                            formAssignedTo === '' && { backgroundColor: colors.tint + '20', borderColor: colors.tint }
                          ]}
                          onPress={() => setFormAssignedTo('')}
                        >
                          <Text style={{ fontSize: 12, color: formAssignedTo === '' ? colors.tint : colors.text, fontWeight: '600' }}>Không gán</Text>
                        </TouchableOpacity>
                      )}
                      
                      {getAssigneeOptions().map(u => (
                        <TouchableOpacity
                          key={u.id}
                          style={[
                            styles.assigneeOption,
                            formAssignedTo === String(u.id) && { backgroundColor: colors.tint + '20', borderColor: colors.tint }
                          ]}
                          onPress={() => setFormAssignedTo(String(u.id))}
                        >
                          <Image source={{ uri: u.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=50&h=50&q=80' }} style={styles.optionAvatar} />
                          <Text style={{ fontSize: 12, color: formAssignedTo === String(u.id) ? colors.tint : colors.text, fontWeight: '600' }}>{u.name} {u.id === user?.id ? '(Tôi)' : ''}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </>
              )}

              {/* Deadline */}
              <Text style={[styles.formLabel, { color: colors.text }]}>Hạn chót (YYYY-MM-DD)</Text>
              <TextInput
                style={[styles.formInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                placeholder="Ví dụ: 2026-06-30"
                placeholderTextColor={colors.tabIconDefault}
                value={formDeadline}
                onChangeText={setFormDeadline}
              />

              {/* Form Buttons */}
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

      {/* 7. Modal: Chi tiết nhiệm vụ (View Detail Modal) */}
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
                {/* Title */}
                <Text style={[styles.detailTaskTitle, { color: colors.text }]}>
                  {selectedTask.title}
                </Text>

                {/* Status & Priority tags row */}
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

                {/* Description */}
                <Text style={[styles.detailLabel, { color: colors.tabIconDefault }]}>MÔ TẢ CHI TIẾT</Text>
                <Text style={[styles.detailDescText, { color: colors.text }]}>
                  {selectedTask.description || 'Không có mô tả chi tiết cho nhiệm vụ này.'}
                </Text>

                <View style={[styles.divider, { backgroundColor: colors.border }]} />

                {/* Meta Row 1: Assignor & Assignee */}
                <View style={[styles.detailMetaRow, { marginBottom: 12 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.detailLabel, { color: colors.tabIconDefault }]}>NGƯỜI GIAO VIỆC</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                      {selectedTask.creator_avatar ? (
                        <Image source={{ uri: selectedTask.creator_avatar }} style={{ width: 24, height: 24, borderRadius: 12, marginRight: 8 }} />
                      ) : (
                        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center', marginRight: 8 }}>
                          <Text style={{ fontSize: 12, color: colors.text, fontWeight: '700' }}>
                            {selectedTask.creator_name ? selectedTask.creator_name.charAt(0).toUpperCase() : '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                        {selectedTask.creator_name || 'Không xác định'}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flex: 1, paddingLeft: 8 }}>
                    <Text style={[styles.detailLabel, { color: colors.tabIconDefault }]}>NGƯỜI NHẬN VIỆC</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                      {selectedTask.assigned_to ? (
                        <>
                          <Image
                            source={{ uri: selectedTask.assignee_avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=50&h=50&q=80' }}
                            style={{ width: 24, height: 24, borderRadius: 12, marginRight: 8 }}
                          />
                          <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                            {selectedTask.assignee_name} {selectedTask.assigned_to === user?.id ? '(Tôi)' : ''}
                          </Text>
                        </>
                      ) : (
                        <Text style={{ color: colors.tabIconDefault, fontSize: 13, fontStyle: 'italic' }}>Chưa gán</Text>
                      )}
                    </View>
                  </View>
                </View>

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

            {/* Admin Controls on bottom of details */}
            {selectedTask && isAdmin && (
              <View style={styles.adminControls}>
                <TouchableOpacity
                  style={[styles.btnAdminDelete, { borderColor: colors.danger }]}
                  onPress={() => handleDeleteTask(selectedTask.id)}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.danger} />
                  <Text style={[styles.btnAdminDeleteText, { color: colors.danger }]}>Xóa nhiệm vụ</Text>
                </TouchableOpacity>

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
    display: Platform.OS === 'web' ? 'flex' : 'none', // Subtle web helper
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
    backgroundColor: '#0969da', // Notion default blue accent
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
  // Perfect Grid Lines Table Styles
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderTopWidth: 1,
    paddingVertical: 8,
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
  },
  colCell: {
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRightWidth: 1,
    minHeight: 44,
  },
  // Column Width Constants
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
  colDesc: {
    width: 250,
  },
  taskTitleText: {
    fontSize: 13.5,
    fontWeight: '700',
  },
  notionStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 12,
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
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
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
  // Quick Status change Card
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
  // Form element styling
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
  // Detail card
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
});
