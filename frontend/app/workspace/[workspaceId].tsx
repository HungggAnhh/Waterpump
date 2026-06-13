import { useState, useEffect, useRef } from 'react';
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
  Alert,
  Clipboard,
  Share,
  useWindowDimensions
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useUser } from '@/context/UserContext';
import { useSocket } from '@/context/SocketContext';
import { API_BASE_URL } from '@/constants/Config';
import VoiceMicButton from '../../components/VoiceMicButton';
import TaskDetailModal from '@/components/tasks/TaskDetailModal';
import TaskViewsModal from '@/components/tasks/TaskViewsModal';
import { sortTasksStable } from '@/utils/taskSort';
import { useNotifications } from '@/context/NotificationContext';

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
  assignees?: Array<{
    user_id: number;
    status: string;
    started_at: string | null;
    completed_at: string | null;
    name: string;
    avatar: string | null;
  }>;
  created_by: number | null;
  creator_name?: string;
  creator_avatar?: string;
  creator_role?: string;
  deadline: string | null;
  completed: boolean;
  is_reviewed?: boolean;
  reminder_interval?: 'hourly' | 'daily' | null;
  last_reminded_at?: string | null;
  created_at: string;
  updated_at?: string;
  approval_status?: 'pending' | 'in_progress' | 'waiting_approval' | 'completed' | 'revision_required';
  approved_by?: number | null;
  approved_at?: string | null;
  revision_note?: string | null;
  revision_count?: number;
  total_assignees?: number;
  viewed_assignees_count?: number;
  completed_assignees_count?: number;
  total_reports_count?: number;
  unseen_reports_count?: number;
}



export default function PageTasksScreen() {
  const { width: windowWidth } = useWindowDimensions();
  const { workspaceId, taskId } = useLocalSearchParams();
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useUser();
  const { socket } = useSocket();
  const { unreadCount, unreadAssignedCount, openDrawer } = useNotifications();

  const [highlightedTaskId, setHighlightedTaskId] = useState<number | null>(null);
  const taskYRefs = useRef<{[key: number]: number}>({});

  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceName, setWorkspaceName] = useState('Trình theo dõi nhiệm vụ');

  // Filters (Tất cả nhiệm vụ / Nhiệm vụ của tôi)
  const [viewFilter, setViewFilter] = useState<'all' | 'my_tasks'>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Modals
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Views Modal states
  const [viewsModalVisible, setViewsModalVisible] = useState(false);
  const [viewsModalTaskId, setViewsModalTaskId] = useState<number | null>(null);
  const [viewsModalTaskTitle, setViewsModalTaskTitle] = useState<string | null>(null);

  const handleOpenViewsModal = (task: Task) => {
    setViewsModalTaskId(task.id);
    setViewsModalTaskTitle(task.title);
    setViewsModalVisible(true);
  };

  // Share Menu Popover State
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isUrgeModalOpen, setIsUrgeModalOpen] = useState(false);
  const [submittingUrge, setSubmittingUrge] = useState(false);

  // Task Activities/History
  const [activities, setActivities] = useState<any[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);

  // Enterprise Approval Workflow
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Form Fields (For create and edit)
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [isDescMicListening, setIsDescMicListening] = useState(false);
  const [formStatus, setFormStatus] = useState<'todo' | 'in_progress' | 'completed'>('todo');
  const [formPriority, setFormPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [formSelectedUsers, setFormSelectedUsers] = useState<number[]>([]);
  const [submittingTask, setSubmittingTask] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [assigneeSearchInput, setAssigneeSearchInput] = useState('');
  const [assigneeSearchQuery, setAssigneeSearchQuery] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const verticalScrollViewRef = useRef<ScrollView>(null);

  // Debounce search query 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setAssigneeSearchQuery(assigneeSearchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [assigneeSearchInput]);

  // Keyboard shortcut Ctrl + Enter to submit task modal
  useEffect(() => {
    if (Platform.OS !== 'web' || !isTaskModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        if (selectedTask) {
          handleUpdateTask();
        } else {
          handleCreateTask();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTaskModalOpen, selectedTask, formTitle, formDesc, formPriority, formSelectedUsers, formStatus]);

  // Users List for Assignment
  const [usersList, setUsersList] = useState<any[]>([]);

  // Quick Status Edit Dropdown State
  const [quickStatusTask, setQuickStatusTask] = useState<Task | null>(null);
  const [quickPriorityTask, setQuickPriorityTask] = useState<Task | null>(null);
  const [quickAssigneeTask, setQuickAssigneeTask] = useState<Task | null>(null);
  const [quickSelectedUsers, setQuickSelectedUsers] = useState<number[]>([]);
  const [workspaceMembers, setWorkspaceMembers] = useState<any[]>([]);

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

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/users`);
      const result = await res.json();
      if (result.status === 'success') {
        setUsersList(result.data || []);
      }
    } catch (err) {
      console.error('Lỗi tải danh sách User:', err);
    }
  };

  const fetchWorkspaceMembers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/workspaces/${workspaceId}/members`);
      const result = await res.json();
      if (result.status === 'success') {
        setWorkspaceMembers(result.data || []);
      }
    } catch (err) {
      console.error('Lỗi tải danh sách thành viên trang:', err);
    }
  };

  const getAssigneeOptions = () => {
    return workspaceMembers;
  };

  const fetchActivities = async (taskId: number) => {
    try {
      setLoadingActivities(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${taskId}/activities`);
      const result = await res.json();
      if (result.status === 'success') {
        setActivities(result.data || []);
      }
    } catch (err) {
      console.error('Lỗi lấy lịch sử hoạt động:', err);
    } finally {
      setLoadingActivities(false);
    }
  };

  useEffect(() => {
    if (selectedTask && isDetailModalOpen) {
      fetchActivities(selectedTask.id);
    } else {
      setActivities([]);
    }
  }, [selectedTask, isDetailModalOpen]);

  const handleStartTask = async (task: Task) => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        const updated = result.data;
        setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
        setSelectedTask(updated);
      } else {
        alert(result.message || 'Lỗi khi bắt đầu thực hiện.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    }
  };

  const handleSubmitTask = async (task: Task) => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        const updated = result.data;
        setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
        setSelectedTask(updated);
      } else {
        alert(result.message || 'Lỗi khi gửi duyệt.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    }
  };

  const handleApproveTask = async (task: Task) => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await res.json();
      if (result.status === 'success') {
        const updated = result.data;
        setTasks(prev => prev.map(t => t.id === task.id ? updated : t));
        setSelectedTask(updated);
      } else {
        alert(result.message || 'Lỗi khi duyệt công việc.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    }
  };

  const handleRejectTask = async () => {
    if (!selectedTask || !rejectReason.trim()) return;
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${selectedTask.id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectReason.trim() })
      });
      const result = await res.json();
      if (result.status === 'success') {
        const updated = result.data;
        setTasks(prev => prev.map(t => t.id === selectedTask.id ? updated : t));
        setSelectedTask(updated);
        setIsRejectModalOpen(false);
        setRejectReason('');
      } else {
        alert(result.message || 'Lỗi khi yêu cầu sửa lại.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    }
  };

  useEffect(() => {
    fetchTasks();
    fetchWorkspaceDetails();
    fetchUsers();
    fetchWorkspaceMembers();
  }, [workspaceId, user]);

  useEffect(() => {
    if (taskId && tasks.length > 0) {
      const targetId = parseInt(taskId as string);
      const targetTask = tasks.find(t => t.id === targetId);
      if (targetTask) {
        setSelectedTask(targetTask);
        setIsDetailModalOpen(true);
        setHighlightedTaskId(targetId);
        
        setTimeout(() => {
          const y = taskYRefs.current[targetId];
          if (y !== undefined) {
            verticalScrollViewRef.current?.scrollTo({ y: y - 20, animated: true });
          }
        }, 400);

        const timer = setTimeout(() => {
          setHighlightedTaskId(null);
        }, 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [taskId, tasks]);

  // Realtime Socket Sync
  useEffect(() => {
    if (!socket) return;

    const handleTaskCreated = (payload: any) => {
      const task = payload?.task ? payload.task : payload;
      if (task && task.workspace_id === parseInt(workspaceId as string)) {
        setTasks(prev => {
          if (prev.some(t => t.id === task.id)) return prev;
          return [...prev, task];
        });
      }
    };

    const handleTaskUpdated = (updatedTask: Task) => {
      setTasks(prev => {
        const existingTask = prev.find(t => t.id === updatedTask.id);
        const wsId = updatedTask.workspace_id || (existingTask ? existingTask.workspace_id : null);

        if (wsId === parseInt(workspaceId as string)) {
          const exists = prev.some(t => t.id === updatedTask.id);
          if (!exists) {
            if (!updatedTask.workspace_id) return prev;
            return [...prev, updatedTask];
          }
          return prev.map(t => {
            if (t.id === updatedTask.id) {
              if (updatedTask.assignees) {
                return { ...t, ...updatedTask, assignees: updatedTask.assignees };
              }
              if (!updatedTask.workspace_id && 'user_id' in updatedTask) {
                const userId = (updatedTask as any).user_id;
                const status = (updatedTask as any).status;
                const updatedAssignees = t.assignees?.map(a => {
                  if (a.user_id === userId) {
                    return { ...a, status };
                  }
                  return a;
                }) || [];
                return { ...t, assignees: updatedAssignees };
              }
              return { ...t, ...updatedTask };
            }
            return t;
          });
        } else {
          if (updatedTask.workspace_id) {
            return prev.filter(t => t.id !== updatedTask.id);
          }
          return prev;
        }
      });

      setSelectedTask(prev => {
        if (prev && prev.id === updatedTask.id) {
          fetchActivities(updatedTask.id);
          if (updatedTask.assignees) {
            return { ...prev, ...updatedTask, assignees: updatedTask.assignees };
          }
          if (!updatedTask.workspace_id && 'user_id' in updatedTask) {
            const userId = (updatedTask as any).user_id;
            const status = (updatedTask as any).status;
            const updatedAssignees = prev.assignees?.map(a => {
              if (a.user_id === userId) {
                return { ...a, status };
              }
              return a;
            }) || [];
            return { ...prev, assignees: updatedAssignees };
          }
          return { ...prev, ...updatedTask };
        }
        return prev;
      });
    };

    const handleAssignmentStatusUpdated = (data: { 
      task_id?: number; 
      taskId?: number; 
      user_id?: number; 
      status?: string; 
      completed_at?: string | null; 
      assignees?: any[];
    }) => {
      const targetTaskId = data.taskId || data.task_id;
      if (!targetTaskId) return;

      setTasks(prev => prev.map(t => {
        if (t.id === targetTaskId) {
          if (data.assignees) {
            return { ...t, assignees: data.assignees };
          }
          const updatedAssignees = t.assignees?.map(a => {
            if (a.user_id === data.user_id) {
              return { ...a, status: data.status!, completed_at: data.completed_at };
            }
            return a;
          }) || [];
          return { ...t, assignees: updatedAssignees };
        }
        return t;
      }));

      setSelectedTask(prev => {
        if (prev && prev.id === targetTaskId) {
          if (data.assignees) {
            return { ...prev, assignees: data.assignees };
          }
          const updatedAssignees = prev.assignees?.map(a => {
            if (a.user_id === data.user_id) {
              return { ...a, status: data.status!, completed_at: data.completed_at };
            }
            return a;
          }) || [];
          return { ...prev, assignees: updatedAssignees };
        }
        return prev;
      });
    };

    const handleTaskDeleted = (deleted: { id: number }) => {
      setTasks(prev => prev.filter(t => t.id !== deleted.id));
      if (selectedTask && selectedTask.id === deleted.id) {
        setIsDetailModalOpen(false);
        setSelectedTask(null);
      }
    };

    const handleTaskReportsSeen = (data: { taskId: number }) => {
      setTasks(prev => prev.map(t => t.id === data.taskId ? { ...t, unseen_reports_count: 0 } : t));
      setSelectedTask(prev => prev && prev.id === data.taskId ? { ...prev, unseen_reports_count: 0 } : prev);
    };

    socket.on('task_created', handleTaskCreated);
    socket.on('task_updated', handleTaskUpdated);
    socket.on('task_deleted', handleTaskDeleted);
    socket.on('assignment_status_updated', handleAssignmentStatusUpdated);
    socket.on('task_reports_seen', handleTaskReportsSeen);

    return () => {
      socket.off('task_created', handleTaskCreated);
      socket.off('task_updated', handleTaskUpdated);
      socket.off('task_deleted', handleTaskDeleted);
      socket.off('assignment_status_updated', handleAssignmentStatusUpdated);
      socket.off('task_reports_seen', handleTaskReportsSeen);
    };
  }, [socket, workspaceId, user, selectedTask]);

  const getShareUrl = () => {
    if (Platform.OS === 'web') {
      return `${window.location.origin}/workspace/${workspaceId}`;
    }
    return `https://waterpump.vercel.app/workspace/${workspaceId}`;
  };

  const handleCopyShareLink = () => {
    const shareUrl = getShareUrl();
    Clipboard.setString(shareUrl);
    if (Platform.OS === 'web') {
      alert('Đã sao chép liên kết chia sẻ vào khay nhớ tạm!');
    } else {
      Alert.alert('Sao chép thành công', 'Đã sao chép liên kết chia sẻ vào khay nhớ tạm!');
    }
  };

  const handleShare = async () => {
    try {
      const shareUrl = getShareUrl();
      const shareTitle = `Chia sẻ không gian làm việc "${workspaceName}"`;
      await Share.share({
        title: shareTitle,
        message: `${shareTitle}\n\n${shareUrl}`
      });
    } catch (error: any) {
      console.error('Lỗi chia sẻ:', error.message);
    }
  };

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
          assigned_to: 'all',
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



  const showToastMsg = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage(null);
    }, 3000);
  };

  const handleCreateTask = async () => {
    const trimmedTitle = formTitle.trim();
    if (!trimmedTitle) {
      setFormError("Vui lòng nhập tên nhiệm vụ.");
      return;
    }
    if (trimmedTitle.length < 3 || trimmedTitle.length > 255) {
      setFormError("Tên nhiệm vụ phải từ 3 đến 255 ký tự.");
      return;
    }
    if (formSelectedUsers.length === 0) {
      setFormError("Vui lòng chọn ít nhất một người nhận.");
      return;
    }

    try {
      setFormError(null);
      setSubmittingTask(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspace_id: parseInt(workspaceId as string),
          title: trimmedTitle,
          description: formDesc,
          status: 'todo', // Trạng thái mặc định: todo
          priority: formPriority,
          assigned_to: formSelectedUsers,
          deadline: null,
        }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        setIsTaskModalOpen(false);
        setFormTitle('');
        setFormDesc('');
        setFormPriority('medium');
        setFormSelectedUsers([]);
        setAssigneeSearchInput('');
        setFormError(null);
        showToastMsg("✅ Đã tạo nhiệm vụ thành công.");
        
        setTimeout(() => {
          verticalScrollViewRef.current?.scrollToEnd({ animated: true });
        }, 150);
      } else {
        setFormError(result.message || 'Lỗi khi tạo công việc.');
      }
    } catch (err) {
      console.error(err);
      setFormError("Không thể tạo nhiệm vụ. Vui lòng kiểm tra kết nối mạng.");
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
    const ids = task.assignees ? task.assignees.map((a: any) => a.user_id) : (task.assigned_to ? [task.assigned_to] : []);
    setFormSelectedUsers(ids);
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
          assigned_to: formSelectedUsers,
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

  const handleQuickAssigneeChange = async () => {
    if (!quickAssigneeTask) return;
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${quickAssigneeTask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assigned_to: quickSelectedUsers,
        }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        setQuickAssigneeTask(null);
      } else {
        alert(result.message || 'Lỗi cập nhật phân công.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && quickAssigneeTask) {
        handleQuickAssigneeChange();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [quickAssigneeTask, quickSelectedUsers]);

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
  const filteredTasks = sortTasksStable(
    tasks.filter(task => {
      if (viewFilter === 'my_tasks' && task.assigned_to !== user?.id) {
        return false;
      }
      const currentStatus = task.approval_status || task.status;
      if (statusFilter !== 'all' && currentStatus !== statusFilter) {
        return false;
      }
      return true;
    }).sort((a, b) => {
      if (a.is_reviewed && !b.is_reviewed) return 1;
      if (!a.is_reviewed && b.is_reviewed) return -1;
      return 0;
    })
  );

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
      case 'todo': 
        return 'Chờ thực hiện';
      case 'in_progress': 
        return 'Đang thực hiện';
      case 'waiting_approval': 
        return 'Chờ duyệt';
      case 'completed': 
        return 'Hoàn thành';
      case 'revision_required': 
        return 'Cần làm lại';
      default: 
        return status;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
      case 'todo': 
        return { bg: '#f1f5f9', text: '#475569', dot: '#64748b' };
      case 'in_progress': 
        return { bg: '#e0f2fe', text: '#0284c7', dot: '#0ea5e9' };
      case 'waiting_approval': 
        return { bg: '#fef3c7', text: '#d97706', dot: '#f59e0b' };
      case 'completed': 
        return { bg: '#d1fae5', text: '#059669', dot: '#10b981' };
      case 'revision_required': 
        return { bg: '#fee2e2', text: '#dc2626', dot: '#ef4444' };
      default: 
        return { bg: '#f1f5f9', text: '#475569', dot: '#64748b' };
    }
  };

  const getDynamicStatus = (task: any) => {
    const approval = task.approval_status;
    if (['waiting_approval', 'completed', 'revision_required'].includes(approval)) {
      let text = '';
      let statusKey = approval;
      if (approval === 'waiting_approval') {
        text = '⏳ Chờ duyệt';
      } else if (approval === 'completed') {
        text = '✅ Hoàn thành';
      } else if (approval === 'revision_required') {
        text = '🔄 Cần làm lại';
      }
      return { text, colorKey: statusKey, hasInProgress: false, assignees: [] };
    }

    const inProgressAssignees = (task.assignees || []).filter((a: any) => a.status === 'in_progress');
    if (inProgressAssignees.length === 0) {
      return { text: 'Chưa bắt đầu', colorKey: 'todo', hasInProgress: false, assignees: [] };
    } else if (inProgressAssignees.length <= 3) {
      const text = inProgressAssignees.map((a: any) => `${a.name} đang thực hiện`).join('\n');
      return { text, colorKey: 'in_progress', hasInProgress: true, assignees: inProgressAssignees };
    } else {
      const text = `🟢 ${inProgressAssignees.length} người đang thực hiện`;
      return { text, colorKey: 'in_progress', hasInProgress: true, assignees: inProgressAssignees };
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

  const getActivityText = (act: any) => {
    const actor = act.user_name || 'Ai đó';
    const roleText = act.user_role === 'admin' ? '(Sếp)' : '';
    switch (act.action) {
      case 'created':
        return `${actor} ${roleText} đã giao việc: "${act.new_value}"`;
      case 'assigned':
        return `${actor} ${roleText} đã gán việc cho: ${act.new_value}`;
      case 'status_changed':
        return `${actor} ${roleText} đã chuyển trạng thái thành: "${getStatusText(act.new_value)}"`;
      case 'priority_changed':
        return `${actor} ${roleText} đã thay đổi mức độ thành: ${getPriorityText(act.new_value)}`;
      case 'title_changed':
        return `${actor} ${roleText} đã đổi tiêu đề thành: "${act.new_value}"`;
      case 'desc_changed':
        return `${actor} ${roleText} đã chỉnh sửa mô tả công việc`;
      case 'reviewed':
        return act.new_value === 'true' 
          ? `${actor} ${roleText} đã duyệt hoàn tất nhiệm vụ này ✔️` 
          : `${actor} ${roleText} đã bỏ duyệt nhiệm vụ này`;
      default:
        return `${actor} ${roleText} đã chỉnh sửa nhiệm vụ`;
    }
  };

  const getActivityIcon = (action: string) => {
    switch (action) {
      case 'created': return 'add-circle-outline';
      case 'assigned': return 'person-add-outline';
      case 'status_changed': return 'swap-horizontal-outline';
      case 'priority_changed': return 'options-outline';
      case 'reviewed': return 'checkmark-done-circle-outline';
      default: return 'create-outline';
    }
  };

  const getActivityIconColor = (action: string) => {
    switch (action) {
      case 'created': return '#0969da';
      case 'assigned': return '#7c3aed';
      case 'status_changed': return '#0284c7';
      case 'priority_changed': return '#d97706';
      case 'reviewed': return '#10b981';
      default: return colors.tabIconDefault;
    }
  };

  const renderAssigneeStack = (task: Task) => {
    const assignees = task.assignees || [];
    const total = assignees.length > 0 ? assignees.length : (task.assigned_to ? 1 : 0);

    if (total === 0) {
      return (
        <Text style={{ color: colors.tabIconDefault, fontSize: 13, fontStyle: 'italic', paddingLeft: 8 }}>
          Chưa gán
        </Text>
      );
    }

    const isMobile = windowWidth < 768;

    if (isMobile) {
      return (
        <Text style={{ color: colors.text, fontSize: 13, paddingLeft: 8, fontWeight: '600' }}>
          👥 {total} người
        </Text>
      );
    }

    // Desktop/Tablet: Show stack + count text below
    let displayList: any[] = [];
    if (assignees.length > 0) {
      displayList = assignees;
    } else if (task.assigned_to) {
      displayList = [{
        user_id: task.assigned_to,
        name: task.assignee_name || 'Người nhận',
        avatar: task.assignee_avatar,
        avatar_url: task.assignee_avatar
      }];
    }

    const maxAvatars = 5;
    const avatarsToShow = displayList.slice(0, maxAvatars);
    const remaining = displayList.length - maxAvatars;

    return (
      <View style={{ alignItems: 'flex-start', paddingLeft: 8, paddingVertical: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
          {avatarsToShow.map((assignee, index) => {
            const avatarUri = assignee.avatar_url || assignee.avatar;
            const webTooltip = Platform.OS === 'web' ? { title: assignee.name } as any : {};
            return avatarUri ? (
              <Image
                key={assignee.user_id || index}
                source={{ uri: avatarUri }}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  borderWidth: 2,
                  borderColor: colors.card,
                  marginRight: -8,
                  zIndex: maxAvatars - index
                }}
                {...webTooltip}
              />
            ) : (
              <View
                key={assignee.user_id || index}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 14,
                  backgroundColor: colors.border,
                  justifyContent: 'center',
                  alignItems: 'center',
                  borderWidth: 2,
                  borderColor: colors.card,
                  marginRight: -8,
                  zIndex: maxAvatars - index
                }}
                {...webTooltip}
              >
                <Text style={{ fontSize: 9, color: colors.text, fontWeight: '700' }}>
                  {assignee.name ? assignee.name.charAt(0).toUpperCase() : '?'}
                </Text>
              </View>
            );
          })}
          {remaining > 0 && (
            <View
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: colors.border,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: 2,
                borderColor: colors.card,
                marginRight: -8,
                zIndex: 0
              }}
            >
              <Text style={{ fontSize: 9, color: colors.text, fontWeight: '700' }}>
                +{remaining}
              </Text>
            </View>
          )}
        </View>
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 2 }}>
          {total} người
        </Text>
      </View>
    );
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
          <TouchableOpacity onPress={openDrawer} style={{ flexDirection: 'row', alignItems: 'center', position: 'relative', padding: 6, marginRight: 12, justifyContent: 'center' }} activeOpacity={0.7}>
            {unreadAssignedCount > 0 && (
              <View style={{
                backgroundColor: '#2563eb',
                borderRadius: 8,
                minWidth: 18,
                height: 16,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 4,
                marginRight: 4,
              }}>
                <Text style={{ color: '#ffffff', fontSize: 8.5, fontWeight: '800' }}>🎯 {unreadAssignedCount}</Text>
              </View>
            )}
            <View style={{ position: 'relative' }}>
              <Ionicons name="notifications-outline" size={20} color={colors.text} />
              {unreadCount > 0 && (
                <View style={{
                  position: 'absolute',
                  top: -4,
                  right: -4,
                  backgroundColor: '#ef4444',
                  borderRadius: 8,
                  minWidth: 14,
                  height: 14,
                  alignItems: 'center',
                  justifyContent: 'center',
                  paddingHorizontal: 3,
                }}>
                  <Text style={{ color: '#ffffff', fontSize: 8, fontWeight: '800' }}>{unreadCount}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
          <Text style={[styles.lastEditedText, { color: colors.tabIconDefault }]}>Đã chỉnh sửa 3 phút trước</Text>
          <TouchableOpacity 
            style={[styles.shareBtn, { borderColor: colors.border, marginRight: 8 }]}
            onPress={handleCopyShareLink}
            activeOpacity={0.7}
          >
            <Ionicons name="copy-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
            <Text style={[styles.shareBtnText, { color: colors.text }]}>Sao chép</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.shareBtn, { borderColor: colors.border }]}
            onPress={handleShare}
            activeOpacity={0.7}
          >
            <Ionicons name="share-social-outline" size={14} color={colors.text} style={{ marginRight: 4 }} />
            <Text style={[styles.shareBtnText, { color: colors.text }]}>Chia sẻ</Text>
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
              const next: Record<string, string> = { all: 'pending', pending: 'in_progress', in_progress: 'waiting_approval', waiting_approval: 'revision_required', revision_required: 'completed', completed: 'all' };
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
          <ScrollView ref={verticalScrollViewRef} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
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
              <View style={[styles.colHeader, styles.colUser, { borderRightColor: colors.border }]}>
                <Ionicons name="person-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Người giao</Text>
              </View>
              <View style={[styles.colHeader, styles.colUser, { borderRightColor: colors.border }]}>
                <Ionicons name="people-outline" size={12} color={colors.tabIconDefault} style={{ marginRight: 5 }} />
                <Text style={[styles.colHeaderText, { color: colors.tabIconDefault }]}>Người nhận</Text>
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
              const statusColor = getStatusColor(task.approval_status || task.status);
              const priorityColor = getPriorityColor(task.priority);
              const isAssignedToMe = task.assigned_to === user?.id || task.assignees?.some(a => a.user_id === user?.id);
              const canEditStatus = isAdmin; // Chỉ Admin được đổi trực tiếp, User phải dùng workflow modal
              const canUrge = isAdmin || (task.created_by !== null && task.created_by === user?.id);
              const rowBg = task.id === highlightedTaskId 
                ? '#fef08a' 
                : colors.card;

              return (
                <View
                  key={task.id}
                  onLayout={e => {
                    taskYRefs.current[task.id] = e.nativeEvent.layout.y;
                  }}
                  style={[
                    styles.tableRow,
                    { 
                      backgroundColor: rowBg, 
                      borderBottomColor: task.id === highlightedTaskId ? '#eab308' : colors.border,
                      opacity: task.is_reviewed ? 0.4 : 1,
                      borderLeftWidth: 0,
                      borderLeftColor: 'transparent',
                      ...(task.id === highlightedTaskId && {
                        borderColor: '#eab308',
                        borderWidth: 1.5,
                      })
                    }
                  ]}
                >
                  <View style={[styles.colCell, styles.colTitle, { borderRightColor: colors.border }]}>
                    <TouchableOpacity
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}
                      onPress={() => {
                        setSelectedTask(task);
                        setIsDetailModalOpen(true);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.taskTitleText,
                          { color: colors.text, textDecorationLine: task.completed ? 'line-through' : 'none', flexShrink: 1 }
                        ]}
                        numberOfLines={1}
                      >
                        {task.title}
                      </Text>
                    </TouchableOpacity>
                    {task.total_assignees !== undefined && task.total_assignees > 0 && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.border + '30', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginLeft: 8, gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => handleOpenViewsModal(task)}
                          activeOpacity={0.6}
                        >
                          <Text style={{ fontSize: 10, color: colors.tabIconDefault, fontWeight: '600' }}>
                            👀 {task.viewed_assignees_count || 0}/{task.total_assignees}
                          </Text>
                        </TouchableOpacity>
                        <Text style={{ fontSize: 10, color: '#059669', fontWeight: '600' }}>
                          👥 {task.completed_assignees_count || 0}/{task.total_assignees} HT
                        </Text>
                        <Text style={{ fontSize: 10, color: colors.tint, fontWeight: '600' }}>
                          📝 {task.total_reports_count || 0} BC
                        </Text>
                      </View>
                    )}
                  </View>

                  {/* Column 2: Trạng thái */}
                  <View style={[styles.colCell, styles.colStatus, { borderRightColor: colors.border, paddingVertical: 6, alignItems: 'flex-start' }]}>
                    {(() => {
                      const approval = task.approval_status;
                      const isApprovalState = ['waiting_approval', 'completed', 'revision_required'].includes(approval || '');
                      
                      if (isApprovalState) {
                        let text = '';
                        let colorKey = approval;
                        if (approval === 'waiting_approval') text = '⏳ Chờ duyệt';
                        else if (approval === 'completed') text = '✅ Hoàn thành';
                        else if (approval === 'revision_required') text = '🔄 Cần làm lại';

                        const sColor = getStatusColor(colorKey || '');
                        return (
                          <TouchableOpacity
                            style={[styles.notionStatusBadge, { backgroundColor: sColor.bg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }]}
                            onPress={() => {
                              if (canEditStatus) {
                                setQuickStatusTask(task);
                              } else {
                                setSelectedTask(task);
                                setIsDetailModalOpen(true);
                              }
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.notionStatusText, { color: sColor.text, fontSize: 12, fontWeight: '700', lineHeight: 16 }]}>
                              {text}
                            </Text>
                          </TouchableOpacity>
                        );
                      }

                      // Dynamic Status based on in progress members
                      const inProgressAssignees = (task.assignees || []).filter((a: any) => a.status === 'in_progress');
                      const currentStatus = task.approval_status || task.status;
                      const isTaskInProgress = currentStatus === 'in_progress' || inProgressAssignees.length > 0;
                      const sColor = getStatusColor(isTaskInProgress ? 'in_progress' : 'todo');

                      if (!isTaskInProgress) {
                        return (
                          <TouchableOpacity
                            style={[styles.notionStatusBadge, { backgroundColor: sColor.bg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }]}
                            onPress={() => {
                              if (canEditStatus) {
                                setQuickStatusTask(task);
                              } else {
                                setSelectedTask(task);
                                setIsDetailModalOpen(true);
                              }
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={[styles.statusDot, { backgroundColor: sColor.dot }]} />
                            <Text style={[styles.notionStatusText, { color: sColor.text, fontSize: 12, fontWeight: '700', lineHeight: 16 }]}>
                              Chưa bắt đầu
                            </Text>
                          </TouchableOpacity>
                        );
                      }

                      // Render each member on a new line, each starting with 🟢
                      return (
                        <TouchableOpacity
                          style={{ width: '100%' }}
                          onPress={() => {
                            if (canEditStatus) {
                              setQuickStatusTask(task);
                            } else {
                              setSelectedTask(task);
                              setIsDetailModalOpen(true);
                            }
                          }}
                          activeOpacity={0.7}
                        >
                          <View style={{ gap: 4, width: '100%' }}>
                            {inProgressAssignees.length > 0 ? (
                              inProgressAssignees.map((a: any, idx: number) => (
                                <View 
                                  key={a.user_id || idx} 
                                  style={[
                                    styles.notionStatusBadge, 
                                    { 
                                      backgroundColor: sColor.bg, 
                                      paddingHorizontal: 10, 
                                      paddingVertical: 4, 
                                      borderRadius: 12 
                                    }
                                  ]}
                                >
                                  <Text style={[styles.notionStatusText, { color: sColor.text, fontSize: 11, fontWeight: '700', lineHeight: 14 }]} numberOfLines={1}>
                                    🟢 {a.name} đang thực hiện
                                  </Text>
                                </View>
                              ))
                            ) : (
                              <View 
                                style={[
                                  styles.notionStatusBadge, 
                                  { 
                                    backgroundColor: sColor.bg, 
                                    paddingHorizontal: 10, 
                                    paddingVertical: 4, 
                                    borderRadius: 12 
                                  }
                                ]}
                              >
                                <Text style={[styles.notionStatusText, { color: sColor.text, fontSize: 11, fontWeight: '700', lineHeight: 14 }]} numberOfLines={1}>
                                  🟢 Đang thực hiện
                                </Text>
                              </View>
                            )}
                          </View>
                        </TouchableOpacity>
                      );
                    })()}
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

                  {/* Column 3.1: Người giao */}
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

                  {/* Column 3.2: Người nhận */}
                  <View style={[styles.colCell, styles.colUser, { borderRightColor: colors.border }]}>
                    <TouchableOpacity
                      style={{ width: '100%', height: '100%', justifyContent: 'center' }}
                      onPress={() => {
                        if (isAdmin) {
                          setQuickAssigneeTask(task);
                          const ids = task.assignees ? task.assignees.map((a: any) => a.user_id) : (task.assigned_to ? [task.assigned_to] : []);
                          setQuickSelectedUsers(ids);
                        } else {
                          alert('Chỉ có Quản trị viên mới được phân công công việc.');
                        }
                      }}
                      activeOpacity={isAdmin ? 0.7 : 1}
                    >
                      {renderAssigneeStack(task)}
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
                    {!task.completed ? (
                      canUrge ? (
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
                    onPress={() => {
                      setFormTitle('');
                      setFormDesc('');
                      setFormStatus('todo');
                      setFormPriority('medium');
                      setFormSelectedUsers(workspaceMembers.map(m => m.id));
                      setSelectedTask(null);
                      setFormError(null);
                      setAssigneeSearchInput('');
                      setIsTaskModalOpen(true);
                    }}
                    activeOpacity={0.6}
                  >
                    <Ionicons name="add" size={16} color={colors.tabIconDefault} style={{ marginRight: 6 }} />
                    <Text style={{ color: colors.tabIconDefault, fontSize: 13.5, fontWeight: '500' }}>nhiệm vụ mới</Text>
                  </TouchableOpacity>
                )}
              </View>
              
              <View style={[styles.colCell, styles.colStatus, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colPriority, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colUser, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colUser, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colReviewed, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colUrge, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
              <View style={[styles.colCell, styles.colDesc, { borderLeftWidth: 1, borderLeftColor: colors.border }]} />
            </View>
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

      {/* 5.7. Quick Assignee Change Modal */}
      <Modal
        visible={quickAssigneeTask !== null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setQuickAssigneeTask(null)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setQuickAssigneeTask(null)}
        >
          <View style={[styles.quickStatusCard, { backgroundColor: colors.card, width: '100%', maxWidth: 320 }]} onStartShouldSetResponder={() => true}>
            <Text style={[styles.quickStatusTitle, { color: colors.text, marginBottom: 16 }]}>Người nhận việc</Text>
            
            <ScrollView style={{ maxHeight: 200, marginBottom: 16 }} nestedScrollEnabled>
              {workspaceMembers.map(m => {
                const isSelected = quickSelectedUsers.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 10,
                      paddingHorizontal: 8,
                      borderBottomWidth: 0.5,
                      borderBottomColor: colors.border,
                      justifyContent: 'space-between'
                    }}
                    onPress={() => {
                      if (isSelected) {
                        setQuickSelectedUsers(prev => prev.filter(id => id !== m.id));
                      } else {
                        setQuickSelectedUsers(prev => [...prev, m.id]);
                      }
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {m.avatar ? (
                        <Image source={{ uri: m.avatar }} style={{ width: 20, height: 20, borderRadius: 10 }} />
                      ) : (
                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }}>
                          <Text style={{ fontSize: 9, color: colors.text, fontWeight: '700' }}>
                            {m.name ? m.name.charAt(0).toUpperCase() : '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600' }}>
                        {m.name} {m.id === user?.id ? '(Tôi)' : ''}
                      </Text>
                    </View>
                    <Ionicons 
                      name={isSelected ? "checkbox" : "square-outline"} 
                      size={20} 
                      color={colors.tint} 
                    />
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <TouchableOpacity
                style={[styles.btnCancel, { borderColor: colors.border, height: 38 }]}
                onPress={() => setQuickAssigneeTask(null)}
              >
                <Text style={[styles.btnCancelText, { color: colors.text, fontSize: 13 }]}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnSubmit, { backgroundColor: colors.tint, height: 38 }]}
                onPress={handleQuickAssigneeChange}
              >
                <Text style={[styles.btnSubmitText, { fontSize: 13 }]}>Lưu</Text>
              </TouchableOpacity>
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
          <ScrollView 
            style={{ width: '100%', maxWidth: 450 }} 
            contentContainerStyle={{ justifyContent: 'center', flexGrow: 1, paddingVertical: 20 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={[styles.formCard, { backgroundColor: colors.card }]}>
              {/* Header with Title and Close Button */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text style={[styles.formTitle, { color: colors.text, marginBottom: 0, textAlign: 'left' }]}>
                  {selectedTask ? 'Chỉnh sửa nhiệm vụ' : 'Nhiệm vụ mới'}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    setIsTaskModalOpen(false);
                    setSelectedTask(null);
                  }}
                  style={{ padding: 4 }}
                >
                  <Ionicons name="close" size={22} color={colors.tabIconDefault} />
                </TouchableOpacity>
              </View>

              {/* Error message section */}
              {formError && (
                <View style={{ backgroundColor: '#fee2e2', padding: 10, borderRadius: 8, marginBottom: 14 }}>
                  <Text style={{ color: '#dc2626', fontSize: 12.5, fontWeight: '600' }}>{formError}</Text>
                </View>
              )}

              {/* Tên nhiệm vụ */}
              <Text style={[styles.formLabel, { color: colors.text }]}>Tên nhiệm vụ *</Text>
              <TextInput
                style={[
                  styles.formInput, 
                  { 
                    color: colors.text, 
                    borderColor: colors.border, 
                    backgroundColor: colors.background,
                  }
                ]}
                placeholder="Nhập tên nhiệm vụ (tối thiểu 3 ký tự)..."
                placeholderTextColor={colors.tabIconDefault}
                value={formTitle}
                onChangeText={setFormTitle}
                onSubmitEditing={selectedTask ? handleUpdateTask : handleCreateTask}
              />

              {/* Mô tả */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <Text style={[styles.formLabel, { color: colors.text, marginBottom: 0 }]}>Mô tả</Text>
                <VoiceMicButton
                  currentValue={formDesc}
                  onSpeechRecognized={setFormDesc}
                  onStateChange={setIsDescMicListening}
                  compact={false}
                />
              </View>
              <TextInput
                style={[styles.formInput, styles.formTextArea, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
                placeholder={isDescMicListening ? "🎤 Đang nghe..." : "Mô tả công việc chi tiết..."}
                placeholderTextColor={colors.tabIconDefault}
                value={formDesc}
                onChangeText={setFormDesc}
                multiline
                numberOfLines={3}
              />

              {/* Mức độ (Segmented Priority Buttons) */}
              <Text style={[styles.formLabel, { color: colors.text, marginBottom: 6 }]}>Mức độ</Text>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                {(['low', 'medium', 'high'] as const).map((p) => {
                  const isSelected = formPriority === p;
                  const pColor = getPriorityColor(p);
                  return (
                    <TouchableOpacity
                      key={p}
                      style={{
                        flex: 1,
                        paddingVertical: 8,
                        borderRadius: 8,
                        borderWidth: 1,
                        borderColor: isSelected ? pColor.text : colors.border,
                        backgroundColor: isSelected ? pColor.bg : colors.card,
                        alignItems: 'center',
                      }}
                      onPress={() => setFormPriority(p)}
                    >
                      <Text style={{ fontSize: 13, fontWeight: '700', color: isSelected ? pColor.text : colors.tabIconDefault }}>
                        {getPriorityText(p)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Người giao (Readonly) */}
              <Text style={[styles.formLabel, { color: colors.text }]}>Người giao</Text>
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: colors.background,
                padding: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: colors.border,
                marginBottom: 14,
                gap: 8
              }}>
                {selectedTask && selectedTask.creator_avatar ? (
                  <Image source={{ uri: selectedTask.creator_avatar }} style={{ width: 24, height: 24, borderRadius: 12 }} />
                ) : user?.avatar ? (
                  <Image source={{ uri: user.avatar }} style={{ width: 24, height: 24, borderRadius: 12 }} />
                ) : (
                  <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: 10, color: colors.text, fontWeight: '700' }}>
                      {selectedTask ? (selectedTask.creator_name ? selectedTask.creator_name.charAt(0).toUpperCase() : '?') : (user?.name ? user.name.charAt(0).toUpperCase() : '?')}
                    </Text>
                  </View>
                )}
                <Text style={{ fontSize: 13, color: colors.text, fontWeight: '600' }}>
                  {selectedTask ? (selectedTask.creator_name || 'Hệ thống') : (user?.name || 'Hệ thống')}
                </Text>
              </View>

              {/* Người nhận việc (Assignees Selection) */}
              <Text style={[styles.formLabel, { color: colors.text, marginBottom: 6 }]}>Người nhận việc *</Text>
              
              {/* Search Assignees */}
              <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.background, paddingHorizontal: 10, height: 38, marginBottom: 8 }}>
                <Ionicons name="search" size={16} color={colors.tabIconDefault} style={{ marginRight: 6 }} />
                <TextInput
                  style={{ flex: 1, fontSize: 13, color: colors.text, padding: 0 }}
                  placeholder="Tìm kiếm thành viên..."
                  placeholderTextColor={colors.tabIconDefault}
                  value={assigneeSearchInput}
                  onChangeText={setAssigneeSearchInput}
                />
                {assigneeSearchInput.length > 0 && (
                  <TouchableOpacity onPress={() => setAssigneeSearchInput('')}>
                    <Ionicons name="close-circle" size={16} color={colors.tabIconDefault} />
                  </TouchableOpacity>
                )}
              </View>

              {/* Select All Checkbox & Counter */}
              {getAssigneeOptions().length > 0 && (
                <TouchableOpacity
                  style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8, paddingVertical: 4, gap: 8 }}
                  onPress={() => {
                    const isAllSelected = getAssigneeOptions().every(u => formSelectedUsers.includes(u.id));
                    if (isAllSelected) {
                      setFormSelectedUsers([]);
                    } else {
                      setFormSelectedUsers(getAssigneeOptions().map(u => u.id));
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={getAssigneeOptions().every(u => formSelectedUsers.includes(u.id)) ? "checkbox" : "square-outline"}
                    size={20}
                    color={getAssigneeOptions().every(u => formSelectedUsers.includes(u.id)) ? colors.tint : colors.tabIconDefault}
                  />
                  <Text style={{ fontSize: 13, color: colors.text, fontWeight: '600' }}>
                    Tất cả thành viên
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.tabIconDefault, marginLeft: 'auto' }}>
                    Đã chọn {formSelectedUsers.length}/{getAssigneeOptions().length} thành viên
                  </Text>
                </TouchableOpacity>
              )}

              {/* Members List ScrollView */}
              <ScrollView style={{ maxHeight: 150, marginBottom: 14 }} nestedScrollEnabled={true}>
                {getAssigneeOptions()
                  .filter(u => {
                    const q = assigneeSearchQuery.toLowerCase().trim();
                    if (!q) return true;
                    return u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
                  })
                  .map((u) => {
                    const isSelected = formSelectedUsers.includes(u.id);
                    return (
                      <TouchableOpacity
                        key={u.id}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingVertical: 8,
                          paddingHorizontal: 8,
                          borderRadius: 8,
                          backgroundColor: isSelected ? colors.tint + '10' : 'transparent',
                          marginBottom: 4,
                          gap: 10
                        }}
                        onPress={() => {
                          if (isSelected) {
                            setFormSelectedUsers(prev => prev.filter(id => id !== u.id));
                          } else {
                            setFormSelectedUsers(prev => [...prev, u.id]);
                          }
                        }}
                      >
                        <Ionicons
                          name={isSelected ? "checkbox" : "square-outline"}
                          size={18}
                          color={isSelected ? colors.tint : colors.tabIconDefault}
                        />
                        {u.avatar ? (
                          <Image source={{ uri: u.avatar }} style={{ width: 24, height: 24, borderRadius: 12 }} />
                        ) : (
                          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.border, justifyContent: 'center', alignItems: 'center' }}>
                            <Text style={{ fontSize: 10, color: colors.text, fontWeight: '700' }}>
                              {u.name ? u.name.charAt(0).toUpperCase() : '?'}
                            </Text>
                          </View>
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 13, color: colors.text, fontWeight: isSelected ? '700' : '500' }}>
                            {u.name} {u.id === user?.id ? '(Tôi)' : ''}
                          </Text>
                          {u.email && (
                            <Text style={{ fontSize: 11, color: colors.tabIconDefault }}>
                              {u.email}
                            </Text>
                          )}
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                {getAssigneeOptions().length === 0 && (
                  <Text style={{ color: colors.tabIconDefault, fontSize: 12, fontStyle: 'italic', textAlign: 'center', marginTop: 10 }}>
                    Không tìm thấy thành viên phù hợp
                  </Text>
                )}
              </ScrollView>

              {/* Trạng thái (Only shown when editing a task) */}
              {selectedTask && (
                <View style={{ marginBottom: 14 }}>
                  <Text style={[styles.formLabel, { color: colors.text }]}>Trạng thái</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                    {(['todo', 'in_progress', 'completed'] as const).map((s) => {
                      const isSelected = formStatus === s;
                      const sColor = getStatusColor(s);
                      return (
                        <TouchableOpacity
                          key={s}
                          style={{
                            flex: 1,
                            paddingVertical: 8,
                            borderRadius: 8,
                            borderWidth: 1,
                            borderColor: isSelected ? sColor.dot : colors.border,
                            backgroundColor: isSelected ? sColor.bg : colors.card,
                            alignItems: 'center',
                          }}
                          onPress={() => setFormStatus(s)}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: isSelected ? sColor.text : colors.tabIconDefault }}>
                            {getStatusText(s)}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}

              {/* Form Buttons */}
              <View style={[styles.formButtons, { marginTop: 10 }]}>
                <TouchableOpacity
                  style={[styles.btnCancel, { borderColor: colors.border }]}
                  onPress={() => {
                    setIsTaskModalOpen(false);
                    setSelectedTask(null);
                  }}
                  disabled={submittingTask}
                >
                  <Text style={[styles.btnCancelText, { color: colors.text }]}>Hủy</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.btnSubmit, { backgroundColor: colors.tint }]}
                  onPress={selectedTask ? handleUpdateTask : handleCreateTask}
                  disabled={submittingTask || !formTitle.trim()}
                >
                  {submittingTask ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <ActivityIndicator size="small" color="#ffffff" />
                      <Text style={styles.btnSubmitText}>
                        {selectedTask ? 'Lưu thay đổi...' : 'Tạo nhiệm vụ...'}
                      </Text>
                    </View>
                  ) : (
                    <Text style={styles.btnSubmitText}>
                      {selectedTask ? 'Lưu thay đổi' : 'Tạo nhiệm vụ'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      {/* Urge Modal */}
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
              <ActivityIndicator size="large" color="#d97706" style={{ marginVertical: 20 }} />
            ) : (
              <View style={styles.urgeOptionsList}>
                <TouchableOpacity
                  style={[styles.urgeOptionBtn, { backgroundColor: '#fee2e2', borderColor: '#ef4444' }]}
                  onPress={() => handleUrgeTask('now')}
                >
                  <View style={styles.urgeOptionIconBox}>
                    <Ionicons name="flash" size={18} color="#dc2626" />
                  </View>
                  <View style={styles.urgeOptionTextBox}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#b91c1c' }}>Hối thúc ngay</Text>
                    <Text style={{ fontSize: 10.5, color: '#991b1b' }}>Gửi 1 thông báo đẩy khẩn cấp ngay</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.urgeOptionBtn, { backgroundColor: '#fef3c7', borderColor: '#f59e0b' }]}
                  onPress={() => handleUrgeTask('hourly')}
                >
                  <View style={styles.urgeOptionIconBox}>
                    <Ionicons name="alarm" size={18} color="#d97706" />
                  </View>
                  <View style={styles.urgeOptionTextBox}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#92400e' }}>Nhắc nhở mỗi giờ</Text>
                    <Text style={{ fontSize: 10.5, color: '#b45309' }}>Gửi thông báo đẩy lặp lại mỗi 60 phút</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.urgeOptionBtn, { backgroundColor: '#e0f2fe', borderColor: '#0284c7' }]}
                  onPress={() => handleUrgeTask('daily')}
                >
                  <View style={styles.urgeOptionIconBox}>
                    <Ionicons name="calendar" size={18} color="#0284c7" />
                  </View>
                  <View style={styles.urgeOptionTextBox}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0369a1' }}>Nhắc nhở mỗi ngày</Text>
                    <Text style={{ fontSize: 10.5, color: '#0369a1' }}>Gửi thông báo đẩy lặp lại mỗi ngày</Text>
                  </View>
                </TouchableOpacity>

                {selectedTask && selectedTask.reminder_interval && (
                  <TouchableOpacity
                    style={[styles.urgeOptionBtn, { backgroundColor: '#f3f4f6', borderColor: '#9ca3af' }]}
                    onPress={() => handleUrgeTask('off')}
                  >
                    <View style={styles.urgeOptionIconBox}>
                      <Ionicons name="notifications-off-outline" size={18} color="#4b5563" />
                    </View>
                    <View style={styles.urgeOptionTextBox}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#374151' }}>Tắt hối thúc</Text>
                      <Text style={{ fontSize: 10.5, color: '#4b5563' }}>Dừng nhắc nhở công việc này</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 7. Shared Task Detail Modal */}
      <TaskDetailModal
        visible={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedTask(null);
        }}
        task={selectedTask}
        onTaskUpdated={(updated) => {
          setTasks(prev => prev.map(t => t.id === updated.id ? { ...t, ...updated } : t));
          setSelectedTask(prev => prev ? { ...prev, ...updated } : updated);
        }}
        onTaskDeleted={(taskId) => {
          setTasks(prev => prev.filter(t => t.id !== taskId));
        }}
      />

      {/* Task Views Modal */}
      <TaskViewsModal
        visible={viewsModalVisible}
        onClose={() => setViewsModalVisible(false)}
        taskId={viewsModalTaskId}
        taskTitle={viewsModalTaskTitle}
      />

      {/* 8. Popover: Share Menu removed */}
      {toastMessage && (
        <View style={{
          position: 'absolute',
          bottom: 50,
          alignSelf: 'center',
          backgroundColor: '#10b981',
          paddingHorizontal: 20,
          paddingVertical: 10,
          borderRadius: 20,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.25,
          shadowRadius: 3.84,
          elevation: 5,
          zIndex: 9999
        }}>
          <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 13.5 }}>
            {toastMessage}
          </Text>
        </View>
      )}
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
    minWidth: 1070,
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
    minWidth: 1070,
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
    width: 220,
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
    maxWidth: '100%',
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
  workflowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: 8,
    width: '100%',
  },
  workflowBtnText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '700',
  },
  popoverBackdrop: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  sharePopoverCard: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 220,
    borderRadius: 12,
    borderWidth: 1,
    padding: 8,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
      },
      android: {
        elevation: 4,
      },
      web: {
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
      } as any
    })
  },
  popoverTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: '#a0aec0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  popoverOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 8,
  },
  popoverOptionText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
});
