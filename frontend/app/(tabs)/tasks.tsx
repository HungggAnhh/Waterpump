// frontend/app/(tabs)/tasks.tsx
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  FlatList,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUser } from '@/context/UserContext';
import { useSocket } from '@/context/SocketContext';
import { API_BASE_URL } from '@/constants/Config';
import { router, useLocalSearchParams } from 'expo-router';
import TaskDetailModal from '@/components/tasks/TaskDetailModal';
import { sortTasksStable } from '@/utils/taskSort';
import { useNotifications } from '@/context/NotificationContext';

const { width: windowWidth } = Dimensions.get('window');

interface Workspace {
  id: number;
  name: string;
  created_by: number | null;
  created_at: string;
}

interface UserListItem {
  id: number;
  name: string;
  avatar: string | null;
}

interface Task {
  id: number;
  workspace_id: number;
  workspace_name?: string;
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
}

interface KPIStats {
  total: number;
  pending: number;
  in_progress: number;
  waiting_approval: number;
  revision_required: number;
  completed: number;
}

// Memoized Task Card for the FlatList
const TaskItem = React.memo(({ 
  task, 
  colors, 
  onPress, 
  isHighlighted 
}: { 
  task: Task; 
  colors: any; 
  onPress: () => void; 
  isHighlighted: boolean;
}) => {
  const getStatusText = (status?: string) => {
    switch (status) {
      case 'pending': return 'Chưa làm';
      case 'in_progress': return 'Đang làm';
      case 'waiting_approval': return 'Chờ duyệt';
      case 'revision_required': return 'Làm lại';
      case 'completed': return 'Hoàn thành';
      default: return 'Chưa làm';
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'pending': return { bg: '#f3f4f6', text: '#374151' };
      case 'in_progress': return { bg: '#e0f2fe', text: '#0369a1' };
      case 'waiting_approval': return { bg: '#fef3c7', text: '#b45309' };
      case 'revision_required': return { bg: '#fee2e2', text: '#b91c1c' };
      case 'completed': return { bg: '#d1fae5', text: '#065f46' };
      default: return { bg: '#f3f4f6', text: '#374151' };
    }
  };

  const getPriorityText = (priority?: string) => {
    switch (priority) {
      case 'low': return 'Thấp';
      case 'medium': return 'T.Bình';
      case 'high': return 'Cao';
      default: return 'T.Bình';
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'low': return { bg: '#f3f4f6', text: '#4b5563' };
      case 'medium': return { bg: '#fffbeb', text: '#d97706' };
      case 'high': return { bg: '#fee2e2', text: '#dc2626' };
      default: return { bg: '#f3f4f6', text: '#4b5563' };
    }
  };

  const statusStyle = getStatusColor(task.approval_status || task.status);
  const priorityStyle = getPriorityColor(task.priority);

  return (
    <TouchableOpacity
      style={[
        styles.taskCardItem, 
        { 
          backgroundColor: isHighlighted ? '#fef08a' : colors.card, 
          borderColor: isHighlighted ? '#eab308' : colors.border,
          borderWidth: isHighlighted ? 1.5 : 1
        }
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.taskCardTitle, { color: colors.text }]} numberOfLines={1}>
          {task.title}
        </Text>
        <View style={styles.taskCardMetaRow}>
          {task.workspace_name && (
            <Text style={[styles.taskCardWorkspace, { color: colors.tint }]} numberOfLines={1}>
              📂 {task.workspace_name}
            </Text>
          )}
          {task.deadline && (
            <Text style={{ fontSize: 11, color: colors.tabIconDefault }}>
              📅 {new Date(task.deadline).toLocaleDateString('vi-VN')}
            </Text>
          )}
          {task.total_assignees !== undefined && task.total_assignees > 0 && (
            <Text style={{ fontSize: 11, color: colors.tabIconDefault, marginLeft: 8 }}>
              👀 {task.viewed_assignees_count || 0}/{task.total_assignees}
            </Text>
          )}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 6 }}>
        <View style={[styles.miniBadge, { backgroundColor: statusStyle.bg }]}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: statusStyle.text }}>
            {getStatusText(task.approval_status || task.status)}
          </Text>
        </View>
        <View style={[styles.miniBadge, { backgroundColor: priorityStyle.bg }]}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: priorityStyle.text }}>
            {getPriorityText(task.priority)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

export default function WorkspaceScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useUser();
  const { socket } = useSocket();
  const params = useLocalSearchParams<{ tab?: string; status?: string; taskId?: string }>();
  const { unreadCount, openDrawer } = useNotifications();

  // Tabs states
  const [activeTab, setActiveTab] = useState<'tasks' | 'summary'>('tasks');
  const [activeSubView, setActiveSubView] = useState<'my_tasks' | 'all_tasks' | 'workspaces'>('workspaces');

  // Original Workspaces states
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [usersList, setUsersList] = useState<UserListItem[]>([]);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);

  // Tab 1 Tasks list state
  const [tab1Tasks, setTab1Tasks] = useState<Task[]>([]);
  const [tab1Loading, setTab1Loading] = useState(false);
  const [searchQueryTab1, setSearchQueryTab1] = useState('');

  // Tab 2 Summary states
  const [expandedAccordions, setExpandedAccordions] = useState<{[key: string]: boolean}>({});
  const [accordionTasks, setAccordionTasks] = useState<{[key: string]: Task[]}>({});
  const [accordionLoading, setAccordionLoading] = useState<{[key: string]: boolean}>({});
  const [kpiStats, setKpiStats] = useState<KPIStats>({
    total: 0,
    pending: 0,
    in_progress: 0,
    waiting_approval: 0,
    revision_required: 0,
    completed: 0,
  });
  const [kpiLoading, setKpiLoading] = useState(true);
  const [allTasksForSearch, setAllTasksForSearch] = useState<Task[]>([]);

  // Advanced filters (Tab 2)
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] = useState<number | null>(null);
  const [selectedAssignee, setSelectedAssignee] = useState<number | null>(null);
  const [selectedCreator, setSelectedCreator] = useState<number | null>(null);
  const [selectedPriority, setSelectedPriority] = useState<string | null>(null);
  const [fromDate, setFromDate] = useState<string | null>(null);
  const [toDate, setToDate] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState<'all' | 'my_tasks' | 'assigned_to_me' | 'created_by_me' | 'overdue'>('all');

  // Detail Modal states
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  // Scroll and highlight states
  const [highlightedAccordion, setHighlightedAccordion] = useState<string | null>(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState<number | null>(null);
  const [pendingScrollTaskId, setPendingScrollTaskId] = useState<number | null>(null);

  // Original Workspaces Modal states
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [editWorkspaceName, setEditWorkspaceName] = useState('');
  const [editSelectedMembers, setEditSelectedMembers] = useState<number[]>([]);
  const [updatingWorkspace, setUpdatingWorkspace] = useState(false);

  // Refs
  const flatListRef = useRef<FlatList>(null);
  const scrollContainerRefTab2 = useRef<ScrollView>(null);
  const accordionYRefs = useRef<{[key: string]: number}>({});

  // Debounce search query
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  // Load URL query params
  useEffect(() => {
    if (params.tab === 'summary') {
      setActiveTab('summary');
      if (params.status) {
        let statusFilter = params.status;
        if (statusFilter === 'all') statusFilter = 'all';
        else if (statusFilter === 'not_started') statusFilter = 'not_started';
        else if (statusFilter === 'in_progress') statusFilter = 'in_progress';
        else if (statusFilter === 'waiting_approval') statusFilter = 'waiting_approval';
        else if (statusFilter === 'revision_required') statusFilter = 'revision_required';
        else if (statusFilter === 'completed') statusFilter = 'completed';

        // Expand accordion
        setExpandedAccordions(prev => ({ ...prev, [statusFilter]: true }));
        fetchAccordionTasks(statusFilter);

        // Scroll and highlight
        setTimeout(() => {
          const y = accordionYRefs.current[statusFilter];
          if (y !== undefined) {
            scrollContainerRefTab2.current?.scrollTo({ y, animated: true });
          }
          setHighlightedAccordion(statusFilter);
          setTimeout(() => {
            setHighlightedAccordion(null);
          }, 3000);
        }, 300);
      }
    }
  }, [params.tab, params.status]);

  // Handle taskId parameter redirect loading
  useEffect(() => {
    if (params.taskId) {
      setActiveTab('tasks');
      setActiveSubView('all_tasks');
    }
  }, [params.taskId]);

  useEffect(() => {
    if (params.taskId && tab1Tasks.length > 0) {
      const targetId = parseInt(params.taskId);
      const index = tab1Tasks.findIndex(t => t.id === targetId);
      if (index !== -1) {
        setHighlightedTaskId(targetId);
        const clickedTask = tab1Tasks[index];
        setSelectedTask(clickedTask);
        setIsDetailModalOpen(true);
        setActiveTab('tasks');
        setActiveSubView('all_tasks');

        setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
        }, 300);

        setTimeout(() => {
          setHighlightedTaskId(null);
        }, 3000);
      }
    }
  }, [params.taskId, tab1Tasks]);

  // Fetch workspaces & users list
  const fetchWorkspaces = async () => {
    try {
      setLoadingWorkspaces(true);
      const wsResponse = await fetch(`${API_BASE_URL}/tasks/workspaces`);
      const wsResult = await wsResponse.json();
      if (wsResult.status === 'success') {
        setWorkspaces(wsResult.data || []);
      }
    } catch (err) {
      console.error('Error loading workspaces:', err);
    } finally {
      setLoadingWorkspaces(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/users`);
      const result = await res.json();
      if (result.status === 'success') {
        const filtered = (result.data || []).filter((u: UserListItem) => u.id !== user?.id);
        setUsersList(filtered);
      }
    } catch (err) {
      console.error('Error loading users:', err);
    }
  };

  // Fetch Tab 1 Tasks list
  const fetchTab1Tasks = async () => {
    try {
      setTab1Loading(true);
      let url = `${API_BASE_URL}/tasks?`;
      if (activeSubView === 'my_tasks') {
        url += 'quick_filter=my_tasks';
      }
      if (searchQueryTab1.trim()) {
        url += `&search=${encodeURIComponent(searchQueryTab1.trim())}`;
      }
      const res = await fetch(url);
      const result = await res.json();
      if (result.status === 'success') {
        setTab1Tasks(sortTasksStable(result.data || []));
      }
    } catch (err) {
      console.error('Error loading Tab 1 tasks:', err);
    } finally {
      setTab1Loading(false);
    }
  };

  // Fetch Tab 2 Accordion tasks
  const fetchAccordionTasks = async (status: string) => {
    try {
      setAccordionLoading(prev => ({ ...prev, [status]: true }));
      let url = `${API_BASE_URL}/tasks?status=${status}`;
      if (debouncedSearch.trim()) url += `&search=${encodeURIComponent(debouncedSearch.trim())}`;
      if (selectedWorkspace) url += `&workspace_id=${selectedWorkspace}`;
      if (selectedAssignee) url += `&assignee_id=${selectedAssignee}`;
      if (selectedCreator) url += `&creator_id=${selectedCreator}`;
      if (selectedPriority) url += `&priority=${selectedPriority}`;
      if (fromDate) url += `&from_date=${fromDate}`;
      if (toDate) url += `&to_date=${toDate}`;
      if (quickFilter && quickFilter !== 'all') url += `&quick_filter=${quickFilter}`;

      const res = await fetch(url);
      const result = await res.json();
      if (result.status === 'success') {
        setAccordionTasks(prev => ({ ...prev, [status]: sortTasksStable(result.data || []) }));
      }
    } catch (err) {
      console.error(`Error loading tasks for status ${status}:`, err);
    } finally {
      setAccordionLoading(prev => ({ ...prev, [status]: false }));
    }
  };

  // Fetch Tab 2 KPI Stats
  const fetchKPIStats = async () => {
    try {
      setKpiLoading(true);
      const res = await fetch(`${API_BASE_URL}/tasks/stats`);
      const result = await res.json();
      if (result.status === 'success') {
        setKpiStats(result.data || { total: 0, pending: 0, in_progress: 0, waiting_approval: 0, revision_required: 0, completed: 0 });
      }
    } catch (err) {
      console.error('Error loading stats:', err);
    } finally {
      setKpiLoading(false);
    }
  };

  const fetchAllTasksForSearch = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks`);
      const result = await res.json();
      if (result.status === 'success') {
        setAllTasksForSearch(result.data || []);
      }
    } catch (err) {
      console.error('Error loading tasks for search:', err);
    }
  };

  const getTaskAccordionId = (task: Task): string => {
    const status = task.approval_status || task.status;
    if (status === 'waiting_approval') return 'waiting_approval';
    if (status === 'revision_required') return 'revision_required';
    if (status === 'completed') return 'completed';
    if (status === 'in_progress') return 'in_progress';
    return 'not_started';
  };

  const getTaskStatusLabel = (task: Task): string => {
    const status = task.approval_status || task.status;
    if (status === 'waiting_approval') return '🟡 Chờ duyệt';
    if (status === 'revision_required') return '🔴 Làm lại';
    if (status === 'completed') return '✅ Hoàn thành';
    if (status === 'in_progress') return '🟢 Đang thực hiện';
    return '⚪ Chưa bắt đầu';
  };

  const getSearchScore = (task: Task, query: string): number => {
    const title = (task.title || '').toLowerCase().trim();
    const desc = (task.description || '').toLowerCase().trim();
    const assigneeName = (task.assignee_name || '').toLowerCase().trim();
    const assigneesNames = (task.assignees || []).map(a => a.name.toLowerCase()).join(' ');
    const workspaceName = (task.workspace_name || '').toLowerCase().trim();
    const creatorName = (task.creator_name || '').toLowerCase().trim();

    if (title === query) return 100;
    if (title.startsWith(query)) return 80;
    if (title.includes(query)) return 60;
    if (desc.includes(query)) return 40;
    if (assigneeName.includes(query) || assigneesNames.includes(query)) return 20;
    if (workspaceName.includes(query) || creatorName.includes(query)) return 10;
    return 0;
  };

  const renderHighlightedText = (text: string, query: string, highlightStyle: any, defaultStyle: any) => {
    if (!query.trim() || !text) {
      return <Text style={defaultStyle}>{text}</Text>;
    }
    const escapedQuery = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(`(${escapedQuery})`, 'gi');
    const parts = text.split(regex);
    return (
      <Text style={defaultStyle}>
        {parts.map((part, index) => {
          const isMatch = part.toLowerCase() === query.toLowerCase();
          return (
            <Text key={index} style={isMatch ? highlightStyle : defaultStyle}>
              {isMatch ? `[${part}]` : part}
            </Text>
          );
        })}
      </Text>
    );
  };

  const filteredSearchResults = useMemo(() => {
    if (!debouncedSearch.trim()) return [];
    const query = debouncedSearch.toLowerCase().trim();
    
    const scoredTasks = allTasksForSearch
      .map(task => {
        const score = getSearchScore(task, query);
        return { task, score };
      })
      .filter(item => {
        const { task } = item;
        if (selectedWorkspace && task.workspace_id !== selectedWorkspace) return false;
        if (selectedPriority && task.priority !== selectedPriority) return false;
        if (quickFilter && quickFilter !== 'all') {
          if (quickFilter === 'my_tasks') {
            const isMine = task.assigned_to === user?.id || task.created_by === user?.id || task.assignees?.some(a => a.user_id === user?.id);
            if (!isMine) return false;
          } else if (quickFilter === 'assigned_to_me') {
            const isAssigned = task.assigned_to === user?.id || task.assignees?.some(a => a.user_id === user?.id);
            if (!isAssigned) return false;
          } else if (quickFilter === 'created_by_me') {
            if (task.created_by !== user?.id) return false;
          } else if (quickFilter === 'overdue') {
            const isOverdue = task.deadline && new Date(task.deadline).getTime() < Date.now() && !task.completed;
            if (!isOverdue) return false;
          }
        }
        return item.score > 0;
      });

    scoredTasks.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return (a.task.title || '').localeCompare(b.task.title || '');
    });
    
    return scoredTasks.map(item => item.task);
  }, [allTasksForSearch, debouncedSearch, selectedWorkspace, selectedPriority, quickFilter, user]);

  // Re-fetch when dependencies change
  useEffect(() => {
    fetchWorkspaces();
    fetchUsers();
  }, [user]);

  useEffect(() => {
    if (activeTab === 'tasks' && activeSubView !== 'workspaces') {
      fetchTab1Tasks();
    }
  }, [activeTab, activeSubView, searchQueryTab1]);

  useEffect(() => {
    if (activeTab === 'summary') {
      fetchKPIStats();
      fetchAllTasksForSearch();
      // Re-fetch all currently expanded accordions
      Object.keys(expandedAccordions).forEach(status => {
        if (expandedAccordions[status]) {
          fetchAccordionTasks(status);
        }
      });
    }
  }, [
    activeTab, 
    debouncedSearch, 
    selectedWorkspace, 
    selectedAssignee, 
    selectedCreator, 
    selectedPriority, 
    fromDate, 
    toDate, 
    quickFilter
  ]);

  // Realtime Socket Sync
  useEffect(() => {
    if (!socket) return;

    const handleTaskCreated = () => {
      if (activeTab === 'summary') {
        fetchKPIStats();
        fetchAllTasksForSearch();
        Object.keys(expandedAccordions).forEach(status => {
          if (expandedAccordions[status]) fetchAccordionTasks(status);
        });
      } else if (activeTab === 'tasks' && activeSubView !== 'workspaces') {
        fetchTab1Tasks();
      }
    };

    const handleTaskUpdated = () => {
      handleTaskCreated();
    };

    const handleTaskDeleted = () => {
      handleTaskCreated();
    };

    const handleWorkspaceChange = () => {
      fetchWorkspaces();
    };

    socket.on('task_created', handleTaskCreated);
    socket.on('task_updated', handleTaskUpdated);
    socket.on('task_deleted', handleTaskDeleted);
    socket.on('workspace_created', handleWorkspaceChange);
    socket.on('workspace_updated', handleWorkspaceChange);
    socket.on('workspace_deleted', handleWorkspaceChange);

    return () => {
      socket.off('task_created', handleTaskCreated);
      socket.off('task_updated', handleTaskUpdated);
      socket.off('task_deleted', handleTaskDeleted);
      socket.off('workspace_created', handleWorkspaceChange);
      socket.off('workspace_updated', handleWorkspaceChange);
      socket.off('workspace_deleted', handleWorkspaceChange);
    };
  }, [socket, activeTab, activeSubView, expandedAccordions]);

  // Pending scroll to task handler in Tab 1
  useEffect(() => {
    if (pendingScrollTaskId && tab1Tasks.length > 0 && activeTab === 'tasks') {
      const index = tab1Tasks.findIndex(t => t.id === pendingScrollTaskId);
      if (index !== -1) {
        setPendingScrollTaskId(null);
        setHighlightedTaskId(pendingScrollTaskId);
        const clickedTask = tab1Tasks[index];
        setSelectedTask(clickedTask);
        setIsDetailModalOpen(true);

        setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
        }, 200);

        setTimeout(() => {
          setHighlightedTaskId(null);
        }, 3000);
      } else if (activeSubView === 'my_tasks') {
        // Fallback to all tasks if not found in my_tasks
        setActiveSubView('all_tasks');
      }
    }
  }, [tab1Tasks, pendingScrollTaskId, activeTab, activeSubView]);

  // Workspace controls Handlers
  const handleToggleMember = (userId: number) => {
    setSelectedMembers(prev => {
      if (prev.includes(userId)) return prev.filter(id => id !== userId);
      return [...prev, userId];
    });
  };

  const handleToggleEditMember = (userId: number) => {
    setEditSelectedMembers(prev => {
      if (prev.includes(userId)) return prev.filter(id => id !== userId);
      return [...prev, userId];
    });
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    try {
      setCreatingWorkspace(true);
      const res = await fetch(`${API_BASE_URL}/tasks/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newWorkspaceName,
          members: selectedMembers,
        }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        const newWs = result.data;
        setIsWorkspaceModalOpen(false);
        setNewWorkspaceName('');
        setSelectedMembers([]);
        router.push(`/workspace/${newWs.id}` as any);
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi tạo trang mới.');
    } finally {
      setCreatingWorkspace(false);
    }
  };

  const handleOpenEditWorkspaceModal = async (ws: Workspace) => {
    setEditingWorkspace(ws);
    setEditWorkspaceName(ws.name);
    setEditSelectedMembers([]);
    setIsEditModalOpen(true);

    try {
      const res = await fetch(`${API_BASE_URL}/tasks/workspaces/${ws.id}/members`);
      const result = await res.json();
      if (result.status === 'success') {
        const memberIds = (result.data || []).map((m: any) => m.id).filter((id: number) => id !== user?.id);
        setEditSelectedMembers(memberIds);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleUpdateWorkspace = async () => {
    if (!editingWorkspace || !editWorkspaceName.trim()) return;
    try {
      setUpdatingWorkspace(true);
      const res = await fetch(`${API_BASE_URL}/tasks/workspaces/${editingWorkspace.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editWorkspaceName,
          members: editSelectedMembers,
        }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        setIsEditModalOpen(false);
        setEditingWorkspace(null);
        setEditWorkspaceName('');
        setEditSelectedMembers([]);
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi sửa trang.');
    } finally {
      setUpdatingWorkspace(false);
    }
  };

  const handleDeleteWorkspace = async (id: number, name: string) => {
    const doDelete = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/workspaces/${id}`, {
          method: 'DELETE',
        });
        const result = await res.json();
        if (result.status === 'success') {
          setWorkspaces(prev => prev.filter(w => w.id !== id));
        }
      } catch (err) {
        console.error(err);
        alert('Lỗi mạng.');
      }
    };

    const msg = `Bạn có chắc chắn muốn xóa trang "${name}" và toàn bộ công việc bên trong không?`;
    if (Platform.OS === 'web') {
      if (window.confirm(msg)) doDelete();
    } else {
      Alert.alert("Xác nhận xóa", msg, [
        { text: "Hủy", style: "cancel" },
        { text: "Xóa", style: "destructive", onPress: doDelete }
      ]);
    }
  };

  const handleToggleAccordion = useCallback((status: string) => {
    const willExpand = !expandedAccordions[status];
    setExpandedAccordions(prev => ({ ...prev, [status]: willExpand }));
    if (willExpand) {
      fetchAccordionTasks(status);
    }
  }, [expandedAccordions]);

  // Click task in Tab 2 flow
  const handleTaskClickFromSummary = useCallback((task: Task) => {
    const isMine = task.assigned_to === user?.id || task.created_by === user?.id || task.assignees?.some(a => a.user_id === user?.id);
    setActiveSubView(isMine ? 'my_tasks' : 'all_tasks');
    setPendingScrollTaskId(task.id);
    setActiveTab('tasks');
  }, [user]);

  const handleKPIPress = useCallback((status: string) => {
    setExpandedAccordions(prev => ({ ...prev, [status]: true }));
    fetchAccordionTasks(status);
    
    setTimeout(() => {
      const y = accordionYRefs.current[status];
      if (y !== undefined) {
        scrollContainerRefTab2.current?.scrollTo({ y, animated: true });
      }
      setHighlightedAccordion(status);
      setTimeout(() => {
        setHighlightedAccordion(null);
      }, 3000);
    }, 150);
  }, []);

  const handleSearchResultClick = (task: Task) => {
    const accordionId = getTaskAccordionId(task);
    
    // 1. Expand accordion
    setExpandedAccordions(prev => ({ ...prev, [accordionId]: true }));
    fetchAccordionTasks(accordionId);
    
    // 2. Clear search text so the results disappear and accordions show
    setSearchQuery('');
    
    // 3. Set highlight task ID & accordion ID
    setHighlightedTaskId(task.id);
    setHighlightedAccordion(accordionId);
    
    // 4. Scroll to accordion
    setTimeout(() => {
      const y = accordionYRefs.current[accordionId];
      if (y !== undefined) {
        scrollContainerRefTab2.current?.scrollTo({ y: y - 10, animated: true });
      }
      
      // Clear highlight after 3 seconds
      setTimeout(() => {
        setHighlightedTaskId(null);
        setHighlightedAccordion(null);
      }, 3000);
    }, 200);
  };

  const handleTaskUpdated = useCallback((updated: Task) => {
    // Refresh both views
    fetchKPIStats();
    fetchTab1Tasks();
    fetchAllTasksForSearch();
    Object.keys(expandedAccordions).forEach(status => {
      if (expandedAccordions[status]) fetchAccordionTasks(status);
    });
  }, [expandedAccordions]);

  const handleTaskDeleted = useCallback((taskId: number) => {
    handleTaskUpdated({} as Task);
  }, [handleTaskUpdated]);

  const isAdmin = user?.role === 'admin';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* Main Tabs Header */}
      <View style={[styles.mainTabsHeader, { borderBottomColor: colors.border }]}>
        <View style={{ flexDirection: 'row', flex: 1 }}>
          <TouchableOpacity 
            style={[styles.mainTabBtn, activeTab === 'tasks' && { borderBottomColor: colors.tint }]}
            onPress={() => setActiveTab('tasks')}
          >
            <Text style={[styles.mainTabBtnText, { color: activeTab === 'tasks' ? colors.tint : colors.tabIconDefault }]}>
              Công việc
            </Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.mainTabBtn, activeTab === 'summary' && { borderBottomColor: colors.tint }]}
            onPress={() => setActiveTab('summary')}
          >
            <Text style={[styles.mainTabBtnText, { color: activeTab === 'summary' ? colors.tint : colors.tabIconDefault }]}>
              Tổng hợp
            </Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={openDrawer} style={{ paddingHorizontal: 16, justifyContent: 'center', position: 'relative' }} activeOpacity={0.7}>
          <Ionicons name="notifications-outline" size={22} color={colors.text} />
          {unreadCount > 0 && (
            <View style={{
              position: 'absolute',
              top: 8,
              right: 8,
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
        </TouchableOpacity>
      </View>

      {/* TAB 1: CÔNG VIỆC */}
      {activeTab === 'tasks' && (
        <View style={{ flex: 1 }}>


          {/* Sub-view rendering */}
          {activeSubView === 'workspaces' ? (
            /* Original Workspaces list */
            <View style={{ flex: 1 }}>
              <View style={[styles.workspaceHeaderRow, { borderBottomColor: colors.border }]}>
                <Text style={[styles.workspaceSectionTitle, { color: colors.text }]}>Các không gian làm việc</Text>
                {isAdmin && (
                  <TouchableOpacity
                    style={[styles.addWorkspaceBtn, { backgroundColor: colors.tint }]}
                    onPress={() => setIsWorkspaceModalOpen(true)}
                  >
                    <Ionicons name="add" size={16} color="#ffffff" style={{ marginRight: 2 }} />
                    <Text style={styles.addWorkspaceBtnText}>Thêm trang</Text>
                  </TouchableOpacity>
                )}
              </View>

              {loadingWorkspaces ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : workspaces.length === 0 ? (
                <View style={styles.centerContainer}>
                  <Text style={{ color: colors.tabIconDefault, fontSize: 13.5 }}>Chưa có không gian làm việc nào.</Text>
                </View>
              ) : (
                <ScrollView contentContainerStyle={{ padding: 16 }}>
                  <View style={{ gap: 10 }}>
                    {workspaces.map(ws => (
                      <TouchableOpacity
                        key={ws.id}
                        style={[styles.workspaceCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => router.push(`/workspace/${ws.id}` as any)}
                        activeOpacity={0.7}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                          <Ionicons name="briefcase-outline" size={18} color={colors.tint} style={{ marginRight: 10 }} />
                          <Text style={[styles.workspaceNameText, { color: colors.text }]} numberOfLines={1}>
                            {ws.name}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {isAdmin && (
                            <>
                              <TouchableOpacity 
                                style={{ padding: 6, marginRight: 4 }}
                                onPress={(e) => { e.stopPropagation(); handleOpenEditWorkspaceModal(ws); }}
                              >
                                <Ionicons name="create-outline" size={18} color={colors.tint} />
                              </TouchableOpacity>
                              <TouchableOpacity 
                                style={{ padding: 6, marginRight: 8 }}
                                onPress={(e) => { e.stopPropagation(); handleDeleteWorkspace(ws.id, ws.name); }}
                              >
                                <Ionicons name="trash-outline" size={18} color="#ef4444" />
                              </TouchableOpacity>
                            </>
                          )}
                          <Ionicons name="chevron-forward" size={16} color={colors.tabIconDefault} />
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              )}
            </View>
          ) : (
            /* Tasks Lists (FlatList) */
            <View style={{ flex: 1 }}>
              {/* Simple Tab 1 Search */}
              <View style={styles.searchBarContainer}>
                <Ionicons name="search-outline" size={18} color={colors.tabIconDefault} style={{ marginRight: 8 }} />
                <TextInput
                  style={[styles.searchBarInput, { color: colors.text }]}
                  placeholder="Tìm kiếm nhiệm vụ..."
                  placeholderTextColor={colors.tabIconDefault}
                  value={searchQueryTab1}
                  onChangeText={setSearchQueryTab1}
                />
                {searchQueryTab1.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQueryTab1('')}>
                    <Ionicons name="close-circle" size={18} color={colors.tabIconDefault} />
                  </TouchableOpacity>
                )}
              </View>

              {tab1Loading ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : tab1Tasks.length === 0 ? (
                <View style={styles.centerContainer}>
                  <Ionicons name="file-tray-outline" size={48} color={colors.tabIconDefault} style={{ marginBottom: 12 }} />
                  <Text style={{ color: colors.tabIconDefault, fontSize: 13.5 }}>Không tìm thấy nhiệm vụ nào.</Text>
                </View>
              ) : (
                <FlatList
                  ref={flatListRef}
                  data={tab1Tasks}
                  keyExtractor={item => item.id.toString()}
                  getItemLayout={(data, index) => ({ length: 95, offset: 95 * index, index })}
                  onScrollToIndexFailed={(info) => {
                    const wait = new Promise(resolve => setTimeout(resolve, 50));
                    wait.then(() => {
                      flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
                    });
                  }}
                  contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
                  renderItem={({ item }) => (
                    <TaskItem
                      task={item}
                      colors={colors}
                      isHighlighted={item.id === highlightedTaskId}
                      onPress={() => {
                        setSelectedTask(item);
                        setIsDetailModalOpen(true);
                      }}
                    />
                  )}
                />
              )}
            </View>
          )}
        </View>
      )}

      {/* TAB 2: TỔNG HỢP */}
      {activeTab === 'summary' && (
        <ScrollView 
          ref={scrollContainerRefTab2} 
          style={{ flex: 1 }} 
          contentContainerStyle={{ paddingBottom: 100 }}
        >
          {/* KPI Statistics */}
          <Text style={[styles.sectionTitleHeader, { color: colors.text }]}>Thống kê nhanh</Text>
          {kpiLoading ? (
            <ActivityIndicator size="small" color={colors.tint} style={{ marginVertical: 14 }} />
          ) : (
            <View style={styles.kpiGridContainer}>
              <TouchableOpacity style={[styles.kpiBox, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleKPIPress('all')}>
                <Text style={[styles.kpiBoxLabel, { color: colors.tabIconDefault }]}>Tổng việc</Text>
                <Text style={[styles.kpiBoxVal, { color: '#2563eb' }]}>{kpiStats.total}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.kpiBox, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleKPIPress('not_started')}>
                <Text style={[styles.kpiBoxLabel, { color: colors.tabIconDefault }]}>Chưa làm</Text>
                <Text style={[styles.kpiBoxVal, { color: '#4b5563' }]}>{kpiStats.pending}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.kpiBox, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleKPIPress('in_progress')}>
                <Text style={[styles.kpiBoxLabel, { color: colors.tabIconDefault }]}>Đang làm</Text>
                <Text style={[styles.kpiBoxVal, { color: '#0284c7' }]}>{kpiStats.in_progress}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.kpiBox, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleKPIPress('waiting_approval')}>
                <Text style={[styles.kpiBoxLabel, { color: colors.tabIconDefault }]}>Chờ duyệt</Text>
                <Text style={[styles.kpiBoxVal, { color: '#d97706' }]}>{kpiStats.waiting_approval}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.kpiBox, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleKPIPress('revision_required')}>
                <Text style={[styles.kpiBoxLabel, { color: colors.tabIconDefault }]}>Làm lại</Text>
                <Text style={[styles.kpiBoxVal, { color: '#dc2626' }]}>{kpiStats.revision_required}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.kpiBox, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => handleKPIPress('completed')}>
                <Text style={[styles.kpiBoxLabel, { color: colors.tabIconDefault }]}>Hoàn thành</Text>
                <Text style={[styles.kpiBoxVal, { color: '#059669' }]}>{kpiStats.completed}</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Quick Filters */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.quickFilterBar} contentContainerStyle={{ gap: 8, paddingRight: 24 }}>
            <TouchableOpacity 
              style={[styles.quickFilterChip, quickFilter === 'all' && [styles.quickFilterChipActive, { backgroundColor: colors.tint }]]}
              onPress={() => setQuickFilter('all')}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: quickFilter === 'all' ? '#ffffff' : colors.text }}>Tất cả</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickFilterChip, quickFilter === 'my_tasks' && [styles.quickFilterChipActive, { backgroundColor: colors.tint }]]}
              onPress={() => setQuickFilter('my_tasks')}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: quickFilter === 'my_tasks' ? '#ffffff' : colors.text }}>Của tôi</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickFilterChip, quickFilter === 'assigned_to_me' && [styles.quickFilterChipActive, { backgroundColor: colors.tint }]]}
              onPress={() => setQuickFilter('assigned_to_me')}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: quickFilter === 'assigned_to_me' ? '#ffffff' : colors.text }}>Được giao</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickFilterChip, quickFilter === 'created_by_me' && [styles.quickFilterChipActive, { backgroundColor: colors.tint }]]}
              onPress={() => setQuickFilter('created_by_me')}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: quickFilter === 'created_by_me' ? '#ffffff' : colors.text }}>Tôi tạo</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.quickFilterChip, quickFilter === 'overdue' && [styles.quickFilterChipActive, { backgroundColor: colors.tint }]]}
              onPress={() => setQuickFilter('overdue')}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: quickFilter === 'overdue' ? '#ffffff' : colors.text }}>Quá hạn ⏳</Text>
            </TouchableOpacity>
          </ScrollView>

          {/* Advanced Filters */}
          <View style={styles.filtersBox}>
            <TextInput
              style={[styles.advancedSearchInput, { borderColor: colors.border, color: colors.text, backgroundColor: colors.card }]}
              placeholder="🔍 Tìm theo tiêu đề hoặc mô tả..."
              placeholderTextColor={colors.tabIconDefault}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />

            <View style={styles.filtersRow}>
              {/* Workspace filter */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <TouchableOpacity 
                  style={[styles.filterSelectBtn, !selectedWorkspace && { borderColor: colors.tint }]}
                  onPress={() => setSelectedWorkspace(null)}
                >
                  <Text style={{ fontSize: 11, color: !selectedWorkspace ? colors.tint : colors.text }}>Tất cả dự án</Text>
                </TouchableOpacity>
                {workspaces.map(ws => (
                  <TouchableOpacity
                    key={ws.id}
                    style={[styles.filterSelectBtn, selectedWorkspace === ws.id && { borderColor: colors.tint }]}
                    onPress={() => setSelectedWorkspace(ws.id)}
                  >
                    <Text style={{ fontSize: 11, color: selectedWorkspace === ws.id ? colors.tint : colors.text }}>
                      {ws.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {/* Priority filter */}
                <TouchableOpacity 
                  style={[styles.filterSelectBtn, !selectedPriority && { borderColor: colors.tint }]}
                  onPress={() => setSelectedPriority(null)}
                >
                  <Text style={{ fontSize: 11, color: !selectedPriority ? colors.tint : colors.text }}>Mức độ</Text>
                </TouchableOpacity>
                {['low', 'medium', 'high'].map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[styles.filterSelectBtn, selectedPriority === p && { borderColor: colors.tint }]}
                    onPress={() => setSelectedPriority(p)}
                  >
                    <Text style={{ fontSize: 11, color: selectedPriority === p ? colors.tint : colors.text }}>
                      {p === 'low' ? 'Thấp' : p === 'medium' ? 'Trung bình' : 'Cao'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>

          {/* Accordion Lists or Search Results */}
          {searchQuery.trim() !== '' ? (
            <View style={{ marginTop: 16 }}>
              <Text style={[styles.sectionTitleHeader, { color: colors.text }]}>
                🔍 Tìm thấy {filteredSearchResults.length} nhiệm vụ
              </Text>
              
              {filteredSearchResults.length === 0 ? (
                <View style={styles.centerContainerSearch}>
                  <Ionicons name="search-outline" size={48} color={colors.tabIconDefault} style={{ marginBottom: 12 }} />
                  <Text style={{ color: colors.tabIconDefault, fontSize: 13.5, fontStyle: 'italic' }}>
                    Không tìm thấy nhiệm vụ phù hợp
                  </Text>
                </View>
              ) : (
                <View style={{ paddingHorizontal: 16, gap: 10, marginBottom: 20 }}>
                  {filteredSearchResults.map((t: Task) => {
                    const statusLabel = getTaskStatusLabel(t);
                    return (
                      <TouchableOpacity
                        key={t.id}
                        style={[styles.searchResultCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                        onPress={() => handleSearchResultClick(t)}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1, gap: 6 }}>
                          {/* Title with Highlight */}
                          {renderHighlightedText(
                            t.title,
                            searchQuery,
                            { fontWeight: '800', color: colors.tint },
                            [styles.searchResultTitle, { color: colors.text }]
                          )}
                          
                          {/* Status Label */}
                          <Text style={[styles.searchResultStatus, { color: colors.text }]}>
                            {statusLabel}
                          </Text>
                          
                          {/* Metadata */}
                          <View style={{ gap: 4, marginTop: 4 }}>
                            <Text style={{ fontSize: 11.5, color: colors.textSecondary }}>
                              👤 {t.assignee_name || (t.assignees && t.assignees.length > 0 ? t.assignees.map((a: any) => a.name).join(', ') : 'Chưa gán')}
                            </Text>
                            {t.workspace_name && (
                              <Text style={{ fontSize: 11.5, color: colors.textSecondary }}>
                                📁 {t.workspace_name}
                              </Text>
                            )}
                            {t.deadline && (
                              <Text style={{ fontSize: 11.5, color: colors.textSecondary }}>
                                📅 {new Date(t.deadline).toLocaleDateString('vi-VN')}
                              </Text>
                            )}
                          </View>
                        </View>
                        
                        {/* Eye icon/detail trigger */}
                        <TouchableOpacity
                          style={styles.searchDetailBtn}
                          onPress={() => {
                            setSelectedTask(t);
                            setIsDetailModalOpen(true);
                          }}
                        >
                          <Ionicons name="eye-outline" size={20} color={colors.tint} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          ) : (
            <>
              <Text style={[styles.sectionTitleHeader, { color: colors.text, marginTop: 16 }]}>Trạng thái công việc</Text>
              <View style={{ paddingHorizontal: 16, gap: 12 }}>
                {[
                  { id: 'all', label: 'Tổng việc', icon: 'folder-open-outline', color: '#2563eb' },
                  { id: 'not_started', label: 'Chưa bắt đầu', icon: 'ellipse-outline', color: '#4b5563' },
                  { id: 'in_progress', label: 'Đang làm', icon: 'sync-outline', color: '#0284c7' },
                  { id: 'waiting_approval', label: 'Chờ duyệt', icon: 'hourglass-outline', color: '#d97706' },
                  { id: 'revision_required', label: 'Làm lại', icon: 'refresh-circle-outline', color: '#dc2626' },
                  { id: 'completed', label: 'Hoàn thành', icon: 'checkmark-done-circle-outline', color: '#059669' },
                ].map(accordion => {
                  const isExpanded = !!expandedAccordions[accordion.id];
                  const tasks = accordionTasks[accordion.id] || [];
                  const isLoading = !!accordionLoading[accordion.id];
                  const isHighlighted = highlightedAccordion === accordion.id;

                  return (
                    <View 
                      key={accordion.id}
                      onLayout={e => {
                        accordionYRefs.current[accordion.id] = e.nativeEvent.layout.y;
                      }}
                      style={[
                        styles.accordionBox, 
                        { 
                          backgroundColor: isHighlighted ? '#fffbeb' : colors.card,
                          borderColor: isHighlighted ? '#f59e0b' : colors.border,
                          borderWidth: isHighlighted ? 1.5 : 1
                        }
                      ]}
                    >
                      {/* Accordion Header */}
                      <TouchableOpacity
                        style={styles.accordionHeader}
                        onPress={() => handleToggleAccordion(accordion.id)}
                        activeOpacity={0.8}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Ionicons name={accordion.icon as any} size={18} color={accordion.color} style={{ marginRight: 8 }} />
                          <Text style={[styles.accordionTitleText, { color: colors.text }]}>
                            {accordion.label}
                          </Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          {isLoading && <ActivityIndicator size="small" color={colors.tint} style={{ marginRight: 10 }} />}
                          <Ionicons 
                            name={isExpanded ? 'chevron-down' : 'chevron-forward'} 
                            size={16} 
                            color={colors.tabIconDefault} 
                          />
                        </View>
                      </TouchableOpacity>

                      {/* Accordion Body (Lazy loaded) */}
                      {isExpanded && (
                        <View style={styles.accordionBody}>
                          {isLoading && tasks.length === 0 ? (
                            <View style={{ paddingVertical: 20 }}>
                              <ActivityIndicator size="small" color={colors.tint} />
                            </View>
                          ) : tasks.length === 0 ? (
                            <Text style={{ fontSize: 12.5, color: colors.tabIconDefault, fontStyle: 'italic', paddingVertical: 14, textAlign: 'center' }}>
                              Không tìm thấy nhiệm vụ nào ở trạng thái này.
                            </Text>
                          ) : (
                            <View style={{ gap: 8, marginTop: 8 }}>
                              {tasks.map(t => (
                                <TouchableOpacity
                                  key={t.id}
                                  style={[
                                    styles.accordionTaskCard, 
                                    { 
                                      borderColor: t.id === highlightedTaskId ? '#eab308' : colors.border,
                                      backgroundColor: t.id === highlightedTaskId ? '#fef08a' : colors.card,
                                      borderWidth: t.id === highlightedTaskId ? 1.5 : 1
                                    }
                                  ]}
                                  onPress={() => {
                                    setSelectedTask(t);
                                    setIsDetailModalOpen(true);
                                  }}
                                  activeOpacity={0.7}
                                >
                                  <View style={{ flex: 1 }}>
                                    <Text style={[styles.accordionTaskTitle, { color: colors.text }]} numberOfLines={1}>
                                      {t.title}
                                    </Text>
                                    <Text style={{ fontSize: 11, color: colors.tabIconDefault, marginTop: 2 }}>
                                      👤 Giao cho: {t.assignee_name || (t.assignees && t.assignees.length > 0 ? t.assignees.map(a => a.name).join(', ') : 'Chưa gán')}
                                    </Text>
                                  </View>
                                  <Ionicons name="arrow-forward-outline" size={16} color={colors.tabIconDefault} />
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </ScrollView>
      )}

      {/* Shared Task Detail Modal */}
      <TaskDetailModal
        visible={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedTask(null);
        }}
        task={selectedTask}
        onTaskUpdated={handleTaskUpdated}
        onTaskDeleted={handleTaskDeleted}
      />

      {/* Modal: Thêm Trang */}
      <Modal
        visible={isWorkspaceModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setIsWorkspaceModalOpen(false);
          setNewWorkspaceName('');
          setSelectedMembers([]);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Thêm trang mới</Text>
            
            <Text style={[styles.inputLabel, { color: colors.text }]}>Tên trang *</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Ví dụ: PHÚC, BANNER..."
              placeholderTextColor={colors.tabIconDefault}
              value={newWorkspaceName}
              onChangeText={setNewWorkspaceName}
              onSubmitEditing={handleCreateWorkspace}
              autoFocus
            />

            <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 8 }]}>Chọn thành viên tham gia</Text>
            {usersList.length === 0 ? (
              <Text style={{ fontStyle: 'italic', fontSize: 12, color: colors.tabIconDefault, marginBottom: 20 }}>Không tìm thấy thành viên khác.</Text>
            ) : (
              <ScrollView style={styles.membersGridScroll} contentContainerStyle={styles.membersGridContainer}>
                {usersList.map(u => {
                  const isSelected = selectedMembers.includes(u.id);
                  return (
                    <TouchableOpacity
                      key={u.id}
                      style={[
                        styles.memberGridItem,
                        isSelected && { borderColor: colors.tint, backgroundColor: colors.tint + '10' }
                      ]}
                      onPress={() => handleToggleMember(u.id)}
                      activeOpacity={0.6}
                    >
                      <View style={{ position: 'relative' }}>
                        <Image
                          source={{ uri: u.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=50&h=50&q=80' }}
                          style={styles.memberAvatar}
                        />
                        {isSelected && (
                          <View style={[styles.checkmarkCircle, { backgroundColor: colors.tint }]}>
                            <Ionicons name="checkmark" size={10} color="#ffffff" />
                          </View>
                        )}
                      </View>
                      <Text style={[styles.memberNameText, { color: colors.text }]} numberOfLines={1}>
                        {u.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.btnCancel, { borderColor: colors.border }]}
                onPress={() => {
                  setIsWorkspaceModalOpen(false);
                  setNewWorkspaceName('');
                  setSelectedMembers([]);
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>Hủy</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btnSubmit, { backgroundColor: colors.tint }]}
                onPress={handleCreateWorkspace}
                disabled={creatingWorkspace || !newWorkspaceName.trim()}
              >
                {creatingWorkspace ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 13.5 }}>
                    {selectedMembers.length >= 2 ? 'Tạo nhóm' : 'Tạo'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal: Sửa Trang */}
      <Modal
        visible={isEditModalOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => {
          setIsEditModalOpen(false);
          setEditingWorkspace(null);
          setEditWorkspaceName('');
          setEditSelectedMembers([]);
        }}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Chỉnh sửa trang</Text>
            
            <Text style={[styles.inputLabel, { color: colors.text }]}>Tên trang *</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Ví dụ: PHÚC, BANNER..."
              placeholderTextColor={colors.tabIconDefault}
              value={editWorkspaceName}
              onChangeText={setEditWorkspaceName}
              onSubmitEditing={handleUpdateWorkspace}
              autoFocus
            />

            <Text style={[styles.inputLabel, { color: colors.text, marginTop: 14, marginBottom: 8 }]}>Chọn thành viên tham gia</Text>
            {usersList.length === 0 ? (
              <Text style={{ fontStyle: 'italic', fontSize: 12, color: colors.tabIconDefault, marginBottom: 20 }}>Không tìm thấy thành viên khác.</Text>
            ) : (
              <ScrollView style={styles.membersGridScroll} contentContainerStyle={styles.membersGridContainer}>
                {usersList.map(u => {
                  const isSelected = editSelectedMembers.includes(u.id);
                  return (
                    <TouchableOpacity
                      key={u.id}
                      style={[
                        styles.memberGridItem,
                        isSelected && { borderColor: colors.tint, backgroundColor: colors.tint + '10' }
                      ]}
                      onPress={() => handleToggleEditMember(u.id)}
                      activeOpacity={0.6}
                    >
                      <View style={{ position: 'relative' }}>
                        <Image
                          source={{ uri: u.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=50&h=50&q=80' }}
                          style={styles.memberAvatar}
                        />
                        {isSelected && (
                          <View style={[styles.checkmarkCircle, { backgroundColor: colors.tint }]}>
                            <Ionicons name="checkmark" size={10} color="#ffffff" />
                          </View>
                        )}
                      </View>
                      <Text style={[styles.memberNameText, { color: colors.text }]} numberOfLines={1}>
                        {u.name}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.btnCancel, { borderColor: colors.border }]}
                onPress={() => {
                  setIsEditModalOpen(false);
                  setEditingWorkspace(null);
                  setEditWorkspaceName('');
                  setEditSelectedMembers([]);
                }}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 13.5 }}>Hủy</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btnSubmit, { backgroundColor: colors.tint }]}
                onPress={handleUpdateWorkspace}
                disabled={updatingWorkspace || !editWorkspaceName.trim()}
              >
                {updatingWorkspace ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 13.5 }}>Lưu</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
  mainTabsHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    height: 48,
  },
  mainTabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  mainTabBtnText: {
    fontSize: 15,
    fontWeight: '800',
  },
  subToggleBar: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  subToggleBtn: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subToggleBtnActive: {
    borderRadius: 0,
  },
  subToggleBtnText: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  workspaceHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  workspaceSectionTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  addWorkspaceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addWorkspaceBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  workspaceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  workspaceNameText: {
    fontSize: 14,
    fontWeight: '700',
    flex: 1,
  },
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 10,
    height: 38,
  },
  searchBarInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 80,
  },
  taskCardItem: {
    borderRadius: 14,
    padding: 12,
    marginBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  taskCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  taskCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  taskCardWorkspace: {
    fontSize: 11,
    fontWeight: '700',
  },
  miniBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  sectionTitleHeader: {
    fontSize: 13.5,
    fontWeight: '800',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  kpiGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: 16,
    justifyContent: 'space-between',
    gap: 8,
  },
  kpiBox: {
    width: '31%',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
  },
  kpiBoxLabel: {
    fontSize: 10.5,
    fontWeight: '700',
    marginBottom: 4,
    textAlign: 'center',
  },
  kpiBoxVal: {
    fontSize: 18,
    fontWeight: '900',
  },
  quickFilterBar: {
    marginTop: 14,
    paddingLeft: 16,
    height: 32,
  },
  quickFilterChip: {
    paddingHorizontal: 12,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#d1d5db',
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickFilterChipActive: {
    borderColor: 'transparent',
  },
  filtersBox: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 14,
  },
  advancedSearchInput: {
    height: 36,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 12.5,
    marginBottom: 10,
  },
  filtersRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterSelectBtn: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  accordionBox: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  accordionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  accordionTitleText: {
    fontSize: 14,
    fontWeight: '700',
  },
  accordionBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 0.5,
    borderTopColor: '#e5e7eb',
  },
  accordionTaskCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    backgroundColor: '#ffffff',
  },
  accordionTaskTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 16,
    textAlign: 'center',
  },
  inputLabel: {
    fontSize: 12.5,
    fontWeight: '700',
    marginBottom: 6,
  },
  textInput: {
    height: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 13.5,
    marginBottom: 16,
  },
  membersGridScroll: {
    maxHeight: 200,
    marginBottom: 20,
  },
  membersGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  memberGridItem: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: 14,
    width: '25%',
    marginBottom: 8,
  },
  memberAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
  },
  checkmarkCircle: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberNameText: {
    fontSize: 11,
    fontWeight: '700',
    textAlign: 'center',
    width: '100%',
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  btnCancel: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSubmit: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchResultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  searchResultTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  searchResultStatus: {
    fontSize: 12.5,
    fontWeight: '700',
    marginTop: 2,
  },
  searchDetailBtn: {
    padding: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerContainerSearch: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 40,
  },
});
