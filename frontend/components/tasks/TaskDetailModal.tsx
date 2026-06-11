import { useState, useEffect } from 'react';
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
  Dimensions,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { API_BASE_URL } from '@/constants/Config';
import { useUser } from '@/context/UserContext';
import { useSocket } from '@/context/SocketContext';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { formatDateTime, formatConversationTime, getMessageDayLabel, formatMessageTime } from '../../utils/dateTime';

const { width: windowWidth, height: windowHeight } = Dimensions.get('window');
export let activeDetailTaskId: number | null = null;

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

interface Comment {
  id: number;
  task_id: number;
  user_id: number;
  comment: string;
  file_url: string | null;
  created_at: string;
  user_name: string;
  user_avatar: string | null;
  user_role?: string;
}

interface Attachment {
  id: number;
  task_id: number;
  uploaded_by: number;
  file_url: string;
  file_type: string | null;
  created_at: string;
  user_name?: string;
  user_avatar?: string | null;
}

interface Activity {
  id: number;
  task_id: number;
  user_id: number;
  action: string;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
  user_name?: string;
  user_avatar?: string | null;
  user_role?: string;
}

interface TaskDetailModalProps {
  visible: boolean;
  onClose: () => void;
  task: Task | null;
  onTaskUpdated: (updated: Task) => void;
  onTaskDeleted?: (taskId: number) => void;
  initialTab?: 'comments' | 'attachments' | 'activities' | 'reports';
}

export default function TaskDetailModal({
  visible,
  onClose,
  task: initialTask,
  onTaskUpdated,
  onTaskDeleted,
  initialTab,
}: TaskDetailModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user, token } = useUser();
  const { socket } = useSocket();

  const [task, setTask] = useState<Task | null>(initialTask);
  const [activeSubTab, setActiveSubTab] = useState<'comments' | 'attachments' | 'activities' | 'reports'>('comments');

  useEffect(() => {
    if (visible) {
      setActiveSubTab(initialTab || 'comments');
    }
  }, [visible, initialTab]);

  useEffect(() => {
    const isAdmin = user?.role === 'admin';
    if (visible && task && activeSubTab === 'reports') {
      const isCreator = task.created_by === user?.id;
      if (isAdmin || isCreator) {
        fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/reports/seen`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token || ''}`
          }
        })
          .then(res => res.json())
          .then(result => {
            if (result.status === 'success') {
              const updatedTask = { ...task, unseen_reports_count: 0 };
              setTask(updatedTask);
              onTaskUpdated(updatedTask);
            }
          })
          .catch(err => console.error("Error marking reports as seen:", err));
      }
    }
  }, [visible, activeSubTab, task?.id]);

  // Reports states
  interface Report {
    id: number;
    task_id: number;
    user_id: number;
    report_type: 'progress' | 'issue' | 'material_request' | 'completion';
    content: string;
    progress_percent: number;
    attachments: Array<{ url: string; type: string; name: string }>;
    daily_report_date: string;
    created_at: string;
    user_name: string;
    user_avatar: string | null;
    user_role?: string;
  }

  const [reports, setReports] = useState<Report[]>([]);
  const [loadingReports, setLoadingReports] = useState(false);
  const [isCreatingReport, setIsCreatingReport] = useState(false);

  // Report Form states
  const [newReportType, setNewReportType] = useState<'progress' | 'issue' | 'material_request' | 'completion'>('progress');
  const [newReportContent, setNewReportContent] = useState('');
  const [newReportProgress, setNewReportProgress] = useState(0);
  const [newReportAttachments, setNewReportAttachments] = useState<Array<{ url: string; type: string; name: string }>>([]);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [uploadingReportFile, setUploadingReportFile] = useState(false);
  const [expandedUsers, setExpandedUsers] = useState<{ [key: string]: boolean }>({});

  async function fetchReports(taskId: number) {
    try {
      setLoadingReports(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${taskId}/reports`, {
        headers: {
          'Authorization': `Bearer ${token || ''}`
        }
      });
      const result = await res.json();
      if (result.status === 'success') {
        setReports(result.data || []);
      }
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      setLoadingReports(false);
    }
  }

  const handleRemoveReportAttachment = (index: number) => {
    setNewReportAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const handlePickReportImage = async () => {
    try {
      console.log('--- Launching Image Picker ---');
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      console.log('Permission granted:', permissionResult.granted);
      if (!permissionResult.granted) {
        Alert.alert('Quyền truy cập bị từ chối', 'Bạn cần cấp quyền truy cập thư viện ảnh để tải lên ảnh báo cáo.');
        return;
      }

      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });

      console.log('ImagePicker result:', pickerResult);
      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        console.log('Image picking canceled.');
        return;
      }

      setUploadingReportFile(true);
      const pickedAsset = pickerResult.assets[0];
      const fileUri = pickedAsset.uri;
      const fileName = fileUri.split('/').pop() || `report_image_${Date.now()}.jpg`;
      const fileType = pickedAsset.mimeType || 'image/jpeg';

      console.log('Selected image metadata:', { name: fileName, type: fileType, uri: fileUri });

      const formData = new FormData();
      if (Platform.OS === 'web') {
        const response = await fetch(fileUri);
        const blob = await response.blob();
        formData.append('file', blob, fileName);
      } else {
        formData.append('file', {
          uri: fileUri,
          name: fileName,
          type: fileType,
        } as any);
      }

      console.log('Uploading image to:', `${API_BASE_URL}/upload`);
      const uploadRes = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      const uploadResult = await uploadRes.json();
      console.log('Upload API response:', uploadResult);

      const fileUrl = uploadResult.file_url || uploadResult.url;
      if (uploadResult.status === 'success' && fileUrl) {
        setNewReportAttachments(prev => {
          const next = [...prev, { url: fileUrl, type: fileType, name: fileName }];
          console.log('Updated newReportAttachments after image upload:', next);
          return next;
        });
      } else {
        Alert.alert('Lỗi', uploadResult.message || 'Lỗi tải ảnh lên server.');
      }
    } catch (err) {
      console.error('Error in handlePickReportImage:', err);
      Alert.alert('Lỗi', 'Lỗi tải tệp tin.');
    } finally {
      setUploadingReportFile(false);
    }
  };

  const handlePickReportFile = async () => {
    try {
      console.log('--- Launching Document Picker ---');
      const res = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      console.log('DocumentPicker result:', res);
      if (res.canceled || !res.assets || res.assets.length === 0) {
        console.log('Document picking canceled.');
        return;
      }

      setUploadingReportFile(true);
      const pickedAsset = res.assets[0];
      const fileUri = pickedAsset.uri;
      const fileName = pickedAsset.name || `report_${Date.now()}`;
      const fileType = pickedAsset.mimeType || 'application/octet-stream';

      console.log('Selected document metadata:', { name: fileName, type: fileType, uri: fileUri });

      const formData = new FormData();
      if (Platform.OS === 'web') {
        const response = await fetch(fileUri);
        const blob = await response.blob();
        formData.append('file', blob, fileName);
      } else {
        formData.append('file', {
          uri: fileUri,
          name: fileName,
          type: fileType,
        } as any);
      }

      console.log('Uploading document to:', `${API_BASE_URL}/upload`);
      const uploadRes = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      const uploadResult = await uploadRes.json();
      console.log('Upload API response:', uploadResult);

      const fileUrl = uploadResult.file_url || uploadResult.url;
      if (uploadResult.status === 'success' && fileUrl) {
        setNewReportAttachments(prev => {
          const next = [...prev, { url: fileUrl, type: fileType, name: fileName }];
          console.log('Updated newReportAttachments after file upload:', next);
          return next;
        });
      } else {
        Alert.alert('Lỗi', uploadResult.message || 'Lỗi tải tệp lên server.');
      }
    } catch (err) {
      console.error('Error in handlePickReportFile:', err);
      Alert.alert('Lỗi', 'Lỗi tải tệp tin.');
    } finally {
      setUploadingReportFile(false);
    }
  };

  const handlePickReportAttachment = () => {
    Alert.alert(
      'Đính kèm tệp tin',
      'Chọn phương thức tải lên:',
      [
        {
          text: '📷 Chọn từ thư viện ảnh',
          onPress: handlePickReportImage,
        },
        {
          text: '📁 Chọn tài liệu (PDF, Word, Excel, ...)',
          onPress: handlePickReportFile,
        },
        {
          text: 'Hủy',
          style: 'cancel',
        },
      ],
      { cancelable: true }
    );
  };

  const handleSubmitReport = async () => {
    if (!task) return;
    if (submittingReport) {
      console.log('Submit already in progress. Double click prevented.');
      return;
    }

    if (!newReportContent.trim()) {
      Alert.alert('Lỗi', 'Nội dung báo cáo không được để trống.');
      return;
    }

    if (newReportType !== 'completion' && (newReportProgress < 0 || newReportProgress > 100)) {
      Alert.alert('Lỗi', 'Tiến độ phải nằm trong khoảng từ 0% đến 100%.');
      return;
    }

    console.log('--- Submitting Task Report ---');
    console.log('Task ID:', task.id);
    console.log('newReportContent:', newReportContent);
    console.log('newReportProgress:', newReportProgress);
    console.log('newReportType:', newReportType);
    console.log('newReportAttachments:', newReportAttachments);

    try {
      setSubmittingReport(true);
      const payload = {
        report_type: newReportType,
        content: newReportContent.trim(),
        progress_percent: newReportType === 'completion' ? 100 : newReportProgress,
        attachments: newReportAttachments
      };

      const endpoint = `${API_BASE_URL}/tasks/tasks/${task.id}/reports`;
      console.log('Posting payload to endpoint:', endpoint, payload);

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`
        },
        body: JSON.stringify(payload)
      });

      console.log('API HTTP response status:', res.status);
      const result = await res.json();
      console.log('API JSON response body:', result);

      if (result.status === 'success') {
        Alert.alert('Thành công', 'Đã gửi báo cáo thành công');
        // Reset form
        setNewReportContent('');
        setNewReportProgress(0);
        setNewReportAttachments([]);
        setNewReportType('progress');
        setIsCreatingReport(false);
        
        // Refresh data
        fetchReports(task.id);
        fetchRecipients(task.id);
        fetchActivities(task.id);
        
        // Trigger parent update
        if (task && onTaskUpdated) {
          const refreshedTaskRes = await fetch(`${API_BASE_URL}/tasks?search=${encodeURIComponent(task.title)}`, {
            headers: {
              'Authorization': `Bearer ${token || ''}`
            }
          });
          const refreshedTaskResult = await refreshedTaskRes.json();
          if (refreshedTaskResult.status === 'success') {
            const updatedTaskItem = refreshedTaskResult.data.find((t: any) => t.id === task.id);
            if (updatedTaskItem) {
              onTaskUpdated(updatedTaskItem);
            }
          }
        }
      } else {
        Alert.alert('Thất bại', result.message || 'Không thể tạo báo cáo.');
      }
    } catch (err: any) {
      console.error('Error submitting report:', err);
      console.log('API Error response status:', err?.response?.status);
      console.log('API Error response data:', err?.response?.data);
      Alert.alert('Lỗi', 'Lỗi kết nối mạng hoặc lỗi máy chủ.');
    } finally {
      setSubmittingReport(false);
    }
  };

  const getGroupedReports = () => {
    const groups: { [dateKey: string]: { dateLabel: string; dateKey: string; userGroups: { [key: string]: { user_name: string; user_avatar: string | null; reports: Report[] } } } } = {};
    
    reports.forEach(r => {
      const dateKey = r.daily_report_date ? r.daily_report_date.split('T')[0] : 'Unknown';
      
      if (!groups[dateKey]) {
        const dateLabel = getMessageDayLabel(dateKey);
        groups[dateKey] = {
          dateLabel,
          dateKey,
          userGroups: {}
        };
      }
      
      const userName = r.user_name || 'Thành viên';
      if (!groups[dateKey].userGroups[userName]) {
        groups[dateKey].userGroups[userName] = {
          user_name: userName,
          user_avatar: r.user_avatar,
          reports: []
        };
      }
      
      groups[dateKey].userGroups[userName].reports.push(r);
    });
    
    return Object.values(groups).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  };

  // Comments state
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Attachments state
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploadingFile, setUploadingFile] = useState(false);

  // Activities state
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loadingActivities, setLoadingActivities] = useState(false);

  // Workflow states
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submittingReject, setSubmittingReject] = useState(false);

  const [isUrgeModalOpen, setIsUrgeModalOpen] = useState(false);
  const [submittingUrge, setSubmittingUrge] = useState(false);

  // Recipient Tracking states
  interface Recipient {
    id: number;
    name: string;
    avatar: string | null;
    viewed: boolean;
    first_viewed_at: string | null;
    last_viewed_at: string | null;
    status: 'not_viewed' | 'viewed' | 'in_progress' | 'waiting_approval' | 'revision_required' | 'completed';
    reports_count?: number;
    last_active_at?: string | null;
  }

  interface RecipientData {
    total: number;
    viewed: number;
    not_viewed: number;
    in_progress: number;
    waiting_approval: number;
    completed: number;
    users: Recipient[];
  }

  const [recipientsData, setRecipientsData] = useState<RecipientData | null>(null);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [isRecipientsDrawerOpen, setIsRecipientsDrawerOpen] = useState(false);
  const [urgeTarget, setUrgeTarget] = useState<'all' | 'not_viewed' | 'not_started' | 'not_reported' | 'waiting_approval'>('not_viewed');

  async function fetchRecipients(taskId: number) {
    try {
      setLoadingRecipients(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${taskId}/recipients`, {
        headers: {
          'Authorization': `Bearer ${token || ''}`
        }
      });
      const result = await res.json();
      if (result.success) {
        setRecipientsData(result.data);
      }
    } catch (err) {
      console.error('Error fetching recipients:', err);
    } finally {
      setLoadingRecipients(false);
    }
  }

  useEffect(() => {
    setTask(initialTask);
    if (initialTask) {
      fetchComments(initialTask.id);
      fetchAttachments(initialTask.id);
      fetchActivities(initialTask.id);
      fetchRecipients(initialTask.id);
      fetchReports(initialTask.id);
    }
  }, [initialTask]);

  // Log task view on modal open
  useEffect(() => {
    if (visible && task && user) {
      (async () => {
        try {
          await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/view`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token || ''}`
            },
            body: JSON.stringify({ user_id: user.id })
          });
        } catch (err) {
          console.error('Error logging task view:', err);
        }
      })();
    }
  }, [visible, task?.id]);

  // Set active taskId globally for voice notification filtering
  useEffect(() => {
    if (visible && task?.id) {
      activeDetailTaskId = task.id;
    } else {
      activeDetailTaskId = null;
    }
    return () => {
      activeDetailTaskId = null;
    };
  }, [visible, task?.id]);

  // Socket setup
  useEffect(() => {
    if (!socket || !task) return;

    const handleTaskUpdated = (updated: Task) => {
      if (updated.id === task.id) {
        setTask(prev => ({ ...prev, ...updated }));
        fetchActivities(task.id);
        fetchRecipients(task.id);
      }
    };

    const handleCommentCreated = (data: { taskId: number; comment: Comment }) => {
      if (data.taskId === task.id) {
        setComments(prev => {
          if (prev.some(c => c.id === data.comment.id)) return prev;
          return [...prev, data.comment];
        });
        fetchActivities(task.id);
      }
    };

    const handleAttachmentCreated = (data: { taskId: number; attachment: Attachment }) => {
      if (data.taskId === task.id) {
        setAttachments(prev => {
          if (prev.some(a => a.id === data.attachment.id)) return prev;
          return [...prev, data.attachment];
        });
        fetchActivities(task.id);
      }
    };

    const handleTaskViewed = (data: { taskId: number; userId: number }) => {
      if (data.taskId === task.id) {
        fetchRecipients(task.id);
        fetchActivities(task.id);
      }
    };

    const handleReportCreated = (data: { taskId: number; report: any; task_status?: string; approval_status?: string }) => {
      if (data.taskId === task.id) {
        setReports(prev => {
          if (prev.some(r => r.id === data.report.id)) return prev;
          return [data.report, ...prev];
        });
        fetchActivities(task.id);
        fetchRecipients(task.id);
        if (data.task_status) {
          setTask(prev => prev ? { ...prev, status: data.task_status as any, approval_status: data.approval_status as any } : null);
        }
      }
    };

    socket.on('task_updated', handleTaskUpdated);
    socket.on('task_comment_created', handleCommentCreated);
    socket.on('task_attachment_created', handleAttachmentCreated);
    socket.on('task_viewed', handleTaskViewed);
    socket.on('task_report_created', handleReportCreated);

    return () => {
      socket.off('task_updated', handleTaskUpdated);
      socket.off('task_comment_created', handleCommentCreated);
      socket.off('task_attachment_created', handleAttachmentCreated);
      socket.off('task_viewed', handleTaskViewed);
      socket.off('task_report_created', handleReportCreated);
    };
  }, [socket, task]);

  if (!task) return null;

  const isAdmin = user?.role === 'admin';

  // API Helpers
  async function fetchComments(taskId: number) {
    try {
      setLoadingComments(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${taskId}/comments`, {
        headers: {
          'Authorization': `Bearer ${token || ''}`
        }
      });
      const result = await res.json();
      if (result.status === 'success') {
        setComments(result.data || []);
      }
    } catch (err) {
      console.error('Error fetching comments:', err);
    } finally {
      setLoadingComments(false);
    }
  }

  async function fetchAttachments(taskId: number) {
    try {
      setLoadingAttachments(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${taskId}/attachments`, {
        headers: {
          'Authorization': `Bearer ${token || ''}`
        }
      });
      const result = await res.json();
      if (result.status === 'success') {
        setAttachments(result.data || []);
      }
    } catch (err) {
      console.error('Error fetching attachments:', err);
    } finally {
      setLoadingAttachments(false);
    }
  }

  async function fetchActivities(taskId: number) {
    try {
      setLoadingActivities(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${taskId}/activities`, {
        headers: {
          'Authorization': `Bearer ${token || ''}`
        }
      });
      const result = await res.json();
      if (result.status === 'success') {
        setActivities(result.data || []);
      }
    } catch (err) {
      console.error('Error fetching activities:', err);
    } finally {
      setLoadingActivities(false);
    }
  }

  // Workflow Handlers
  const handleStartTask = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`
        },
      });
      const result = await res.json();
      if (result.status === 'success') {
        const updated = result.data;
        const merged = { ...task, ...updated };
        setTask(merged);
        onTaskUpdated(merged);
      } else {
        alert(result.message || 'Lỗi khi bắt đầu thực hiện.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    }
  };

  const handleSubmitTask = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/submit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`
        },
      });
      const result = await res.json();
      if (result.status === 'success') {
        const updated = result.data;
        const merged = { ...task, ...updated };
        setTask(merged);
        onTaskUpdated(merged);
      } else {
        alert(result.message || 'Lỗi khi gửi duyệt.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    }
  };

  const handleApproveTask = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`
        },
      });
      const result = await res.json();
      if (result.status === 'success') {
        const updated = result.data;
        const merged = { ...task, ...updated };
        setTask(merged);
        onTaskUpdated(merged);
      } else {
        alert(result.message || 'Lỗi khi duyệt công việc.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    }
  };

  const handleRejectTask = async () => {
    if (!rejectReason.trim()) return;
    try {
      setSubmittingReject(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`
        },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        const updated = result.data;
        const merged = { ...task, ...updated };
        setTask(merged);
        onTaskUpdated(merged);
        setIsRejectModalOpen(false);
        setRejectReason('');
      } else {
        alert(result.message || 'Lỗi khi yêu cầu sửa lại.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    } finally {
      setSubmittingReject(false);
    }
  };

  const handleUrgeTask = async (interval: 'now' | 'hourly' | 'daily' | 'off') => {
    try {
      setSubmittingUrge(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/urge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`
        },
        body: JSON.stringify({ interval, target: urgeTarget }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        alert(result.message);
        if (result.data) {
          const updated = { ...task, reminder_interval: result.data.reminder_interval };
          setTask(updated);
          onTaskUpdated(updated);
        }
        setIsUrgeModalOpen(false);
      } else {
        alert(result.message || 'Lỗi khi đặt hối thúc.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi kết nối mạng.');
    } finally {
      setSubmittingUrge(false);
    }
  };

  const handleDeleteTask = () => {
    const doDelete = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token || ''}`
          }
        });
        const result = await res.json();
        if (result.status === 'success') {
          if (onTaskDeleted) {
            onTaskDeleted(task.id);
          }
          onClose();
        } else {
          alert(result.message || 'Lỗi khi xóa nhiệm vụ.');
        }
      } catch (err) {
        console.error(err);
        alert('Lỗi mạng.');
      }
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Bạn có chắc chắn muốn xóa nhiệm vụ này không?')) {
        doDelete();
      }
    } else {
      Alert.alert(
        'Xác nhận xóa',
        'Bạn có chắc chắn muốn xóa nhiệm vụ này không?',
        [
          { text: 'Hủy', style: 'cancel' },
          { text: 'Xóa', style: 'destructive', onPress: doDelete },
        ]
      );
    }
  };

  // Comments & Attachments Posting
  const handleSendComment = async () => {
    if (!commentInput.trim()) return;
    try {
      setSubmittingComment(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/comments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`
        },
        body: JSON.stringify({ comment: commentInput.trim() }),
      });
      const result = await res.json();
      if (result.status === 'success') {
        setCommentInput('');
        // Socket will update list, but manually adding here just in case Socket fails
        setComments(prev => {
          if (prev.some(c => c.id === result.data.id)) return prev;
          return [...prev, result.data];
        });
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi gửi bình luận.');
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleUploadFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      setUploadingFile(true);
      const pickedAsset = result.assets[0];
      const formData = new FormData();
      
      const fileName = pickedAsset.name || `upload_${Date.now()}`;
      const fileType = pickedAsset.mimeType || 'application/octet-stream';

      if (Platform.OS === 'web') {
        const response = await fetch(pickedAsset.uri);
        const blob = await response.blob();
        formData.append('file', blob, fileName);
      } else {
        formData.append('file', {
          uri: pickedAsset.uri,
          name: fileName,
          type: fileType,
        } as any);
      }

      // Upload file to Supabase via existing api
      const uploadRes = await fetch(`${API_BASE_URL}/upload`, {
        method: 'POST',
        body: formData,
      });
      const uploadResult = await uploadRes.json();

      if (uploadResult.status === 'success' && uploadResult.url) {
        // Link attachment to task
        const attachRes = await fetch(`${API_BASE_URL}/tasks/tasks/${task.id}/attachments`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token || ''}`
          },
          body: JSON.stringify({
            file_url: uploadResult.url,
            file_type: fileType,
          }),
        });
        const attachResult = await attachRes.json();
        if (attachResult.status === 'success') {
          // Socket will sync
          setAttachments(prev => {
            if (prev.some(a => a.id === attachResult.data.id)) return prev;
            return [...prev, attachResult.data];
          });
        }
      } else {
        alert(uploadResult.message || 'Lỗi tải tệp lên server.');
      }
    } catch (err) {
      console.error(err);
      alert('Lỗi tải tệp tin.');
    } finally {
      setUploadingFile(false);
    }
  };

  // UI Helpers
  const getStatusText = (status?: string) => {
    switch (status) {
      case 'pending': return 'Chưa bắt đầu';
      case 'in_progress': return 'Đang làm';
      case 'waiting_approval': return 'Chờ duyệt';
      case 'revision_required': return 'Làm lại';
      case 'completed': return 'Hoàn thành';
      default: return status || 'Chưa bắt đầu';
    }
  };

  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'pending': return { bg: '#f3f4f6', text: '#374151', dot: '#9ca3af' };
      case 'in_progress': return { bg: '#e0f2fe', text: '#0369a1', dot: '#38bdf8' };
      case 'waiting_approval': return { bg: '#fef3c7', text: '#b45309', dot: '#fbbf24' };
      case 'revision_required': return { bg: '#fee2e2', text: '#b91c1c', dot: '#f87171' };
      case 'completed': return { bg: '#d1fae5', text: '#065f46', dot: '#34d399' };
      default: return { bg: '#f3f4f6', text: '#374151', dot: '#9ca3af' };
    }
  };

  const getPriorityText = (priority?: string) => {
    switch (priority) {
      case 'low': return 'Thấp';
      case 'medium': return 'Trung bình';
      case 'high': return 'Cao';
      default: return 'Trung bình';
    }
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'low': return { bg: '#f3f4f6', text: '#374151' };
      case 'medium': return { bg: '#fef3c7', text: '#b45309' };
      case 'high': return { bg: '#fee2e2', text: '#b91c1c' };
      default: return { bg: '#f3f4f6', text: '#374151' };
    }
  };

  const getActivityIcon = (action: string) => {
    switch (action) {
      case 'created': return 'add-circle-outline';
      case 'assigned': return 'person-add-outline';
      case 'status_changed': return 'sync-outline';
      case 'priority_changed': return 'flag-outline';
      case 'reviewed': return 'shield-checkmark-outline';
      case 'file_attached': return 'document-attach-outline';
      case 'viewed': return 'eye-outline';
      case 'commented': return 'chatbubble-ellipses-outline';
      case 'progress_reported': return 'document-text-outline';
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
      case 'file_attached': return '#059669';
      case 'viewed': return '#ca8a04';
      case 'commented': return '#2563eb';
      case 'progress_reported': return '#4f46e5';
      default: return colors.tabIconDefault;
    }
  };

  const getActivityText = (act: Activity) => {
    const actor = act.user_name || 'Ai đó';
    const roleText = act.user_role === 'admin' ? '(Sếp)' : '';
    switch (act.action) {
      case 'created':
        return `${actor} ${roleText} đã giao việc: "${act.new_value}"`;
      case 'assigned':
        return `${actor} ${roleText} đã gán việc cho: ${act.new_value}`;
      case 'status_changed':
        return `${actor} ${roleText} đã chuyển trạng thái thành: "${getStatusText(act.new_value || '')}"`;
      case 'priority_changed':
        return `${actor} ${roleText} đã thay đổi mức độ thành: ${getPriorityText(act.new_value || '')}`;
      case 'title_changed':
        return `${actor} ${roleText} đã đổi tiêu đề thành: "${act.new_value}"`;
      case 'desc_changed':
        return `${actor} ${roleText} đã chỉnh sửa mô tả công việc`;
      case 'file_attached':
        return `${actor} ${roleText} đã đính kèm tệp tin: ${act.new_value}`;
      case 'reviewed':
        return act.new_value === 'true'
          ? `${actor} ${roleText} đã duyệt hoàn tất nhiệm vụ này ✔️`
          : `${actor} ${roleText} đã bỏ duyệt nhiệm vụ này`;
      case 'viewed':
        return `${actor} ${roleText} đã xem nhiệm vụ`;
      case 'commented':
        return `${actor} ${roleText} đã bình luận`;
      case 'progress_reported':
        let repLabel = 'báo cáo tiến độ';
        if (act.old_value === 'issue') repLabel = 'báo cáo sự cố ⚠️';
        if (act.old_value === 'material_request') repLabel = 'báo cáo thiếu vật tư 📦';
        if (act.old_value === 'completion') repLabel = 'báo cáo hoàn thành ✅';
        return `${actor} ${roleText} đã gửi ${repLabel}: ${act.new_value}`;
      default:
        return `${actor} ${roleText} đã chỉnh sửa nhiệm vụ`;
    }
  };



  const statusColor = getStatusColor(task.approval_status || task.status);
  const priorityColor = getPriorityColor(task.priority);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.detailCard, { backgroundColor: colors.card }]}>
          {/* Header */}
          <View style={[styles.detailHeader, { borderBottomColor: colors.border }]}>
            <View style={{ flex: 1 }}>
              {task.workspace_name && (
                <Text style={[styles.workspaceLabel, { color: colors.tint }]}>
                  📂 {task.workspace_name}
                </Text>
              )}
              <Text style={[styles.detailTitle, { color: colors.text }]} numberOfLines={1}>
                Chi tiết nhiệm vụ
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color={colors.tabIconDefault} />
            </TouchableOpacity>
          </View>

          {/* Scrollable details */}
          <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={true}>
            {/* Title */}
            <Text style={[styles.taskTitleText, { color: colors.text }]}>
              {task.title}
            </Text>

            {/* Badges row */}
            <View style={styles.badgesRow}>
              <View style={[styles.statusBadge, { backgroundColor: statusColor.bg }]}>
                <View style={[styles.statusDot, { backgroundColor: statusColor.dot }]} />
                <Text style={[styles.statusBadgeText, { color: statusColor.text }]}>
                  {getStatusText(task.approval_status || task.status)}
                </Text>
              </View>

              <View style={[styles.priorityBadge, { backgroundColor: priorityColor.bg }]}>
                <Text style={[styles.priorityBadgeText, { color: priorityColor.text }]}>
                  Ưu tiên: {getPriorityText(task.priority)}
                </Text>
              </View>
            </View>

            {/* Description */}
            <View style={styles.sectionBox}>
              <Text style={[styles.sectionTitle, { color: colors.tabIconDefault }]}>MÔ TẢ CHI TIẾT</Text>
              <Text style={[styles.descriptionText, { color: colors.text }]}>
                {task.description || 'Không có mô tả chi tiết cho nhiệm vụ này.'}
              </Text>
            </View>

            {/* Creators & Assignees */}
            <View style={styles.metaBox}>
              <View style={styles.metaItem}>
                <Text style={[styles.metaLabel, { color: colors.tabIconDefault }]}>NGƯỜI GIAO VIỆC</Text>
                <View style={styles.avatarRow}>
                  {task.creator_avatar ? (
                    <Image source={{ uri: task.creator_avatar }} style={styles.avatarImg} />
                  ) : (
                    <View style={[styles.avatarFallback, { backgroundColor: colors.border }]}>
                      <Text style={[styles.avatarFallbackText, { color: colors.text }]}>
                        {task.creator_name ? task.creator_name.charAt(0).toUpperCase() : '?'}
                      </Text>
                    </View>
                  )}
                  <Text style={[styles.metaValue, { color: colors.text }]}>
                    {task.creator_name || 'Hệ thống'}
                  </Text>
                </View>
              </View>

              <View style={styles.metaItem}>
                <Text style={[styles.metaLabel, { color: colors.tabIconDefault }]}>NGƯỜI NHẬN VIỆC</Text>
                <TouchableOpacity 
                  style={styles.avatarRow} 
                  onPress={() => setIsRecipientsDrawerOpen(true)}
                  activeOpacity={0.7}
                >
                  {task.assignees && task.assignees.length > 0 ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      {task.assignees.map((as, index) => (
                        <View key={as.user_id} style={{ marginLeft: index > 0 ? -10 : 0 }}>
                          {as.avatar ? (
                            <Image source={{ uri: as.avatar }} style={[styles.avatarImg, { borderWidth: 1, borderColor: colors.card }]} />
                          ) : (
                            <View style={[styles.avatarFallback, { backgroundColor: colors.border, borderWidth: 1, borderColor: colors.card }]}>
                              <Text style={[styles.avatarFallbackText, { color: colors.text }]}>
                                {as.name.charAt(0).toUpperCase()}
                              </Text>
                            </View>
                          )}
                        </View>
                      ))}
                      <Text style={[styles.metaValue, { color: colors.tint, marginLeft: 8, fontWeight: '700' }]}>
                        {task.assignees.length} người &gt;
                      </Text>
                    </View>
                  ) : (
                    <Text style={{ color: colors.tabIconDefault, fontSize: 13, fontStyle: 'italic' }}>
                      Chưa gán ai
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>

            {/* Recipient seen summary grid */}
            {recipientsData && (
              <View style={{ marginHorizontal: 16, marginBottom: 16, padding: 12, backgroundColor: colors.border + '15', borderRadius: 12, gap: 6 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>
                    Tiến độ người nhận ({recipientsData.total})
                  </Text>
                  <TouchableOpacity onPress={() => setIsRecipientsDrawerOpen(true)}>
                    <Text style={{ fontSize: 13, color: colors.tint, fontWeight: '700' }}>
                      Xem tất cả người nhận
                    </Text>
                  </TouchableOpacity>
                </View>
                
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 }}>
                  <Text style={{ fontSize: 12, color: colors.text }}>
                    👀 Đã xem: <Text style={{ fontWeight: 'bold' }}>{recipientsData.viewed}/{recipientsData.total}</Text>
                  </Text>
                  <Text style={{ fontSize: 12, color: '#16a34a' }}>
                    🟢 Đang làm: <Text style={{ fontWeight: 'bold' }}>{recipientsData.in_progress}</Text>
                  </Text>
                  <Text style={{ fontSize: 12, color: '#2563eb' }}>
                    🔵 Chờ duyệt: <Text style={{ fontWeight: 'bold' }}>{recipientsData.waiting_approval}</Text>
                  </Text>
                  <Text style={{ fontSize: 12, color: '#059669' }}>
                    ✅ Hoàn thành: <Text style={{ fontWeight: 'bold' }}>{recipientsData.completed}</Text>
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.tabIconDefault }}>
                    ⚪ Chưa xem: <Text style={{ fontWeight: 'bold' }}>{recipientsData.not_viewed}</Text>
                  </Text>
                </View>
              </View>
            )}

            {/* Timestamps */}
            <View style={styles.metaBox}>
              <View style={styles.metaItem}>
                <Text style={[styles.metaLabel, { color: colors.tabIconDefault }]}>THỜI GIAN GIAO</Text>
                <Text style={[styles.metaValue, { color: colors.text }]}>
                  {formatDateTime(task.created_at)}
                </Text>
              </View>

              <View style={styles.metaItem}>
                <Text style={[styles.metaLabel, { color: colors.tabIconDefault }]}>HẠN HOÀN THÀNH</Text>
                <Text style={[styles.metaValue, { color: task.deadline && new Date(task.deadline) < new Date() && (task.approval_status !== 'completed') ? '#ef4444' : colors.text }]}>
                  {task.deadline ? formatDateTime(task.deadline) : 'Không có hạn'}
                </Text>
              </View>
            </View>

            {/* Workflow Control Box */}
            <View style={styles.sectionBox}>
              <Text style={[styles.sectionTitle, { color: colors.tabIconDefault, marginBottom: 8 }]}>QUY TRÌNH PHÊ DUYỆT</Text>
              
              {/* PENDING / TODO STATE */}
              {(task.approval_status || task.status) === 'pending' && (
                <TouchableOpacity style={[styles.workflowBtn, { backgroundColor: colors.tint }]} onPress={handleStartTask}>
                  <Ionicons name="play-circle-outline" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.workflowBtnText}>Bắt đầu thực hiện</Text>
                </TouchableOpacity>
              )}

              {/* IN PROGRESS STATE */}
              {(task.approval_status || task.status) === 'in_progress' && (
                <TouchableOpacity style={[styles.workflowBtn, { backgroundColor: '#10b981' }]} onPress={handleSubmitTask}>
                  <Ionicons name="paper-plane-outline" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                  <Text style={styles.workflowBtnText}>Gửi duyệt hoàn thành</Text>
                </TouchableOpacity>
              )}

              {/* REVISION REQUIRED STATE */}
              {(task.approval_status || task.status) === 'revision_required' && (
                <View style={{ gap: 8 }}>
                  <View style={styles.revisionWarning}>
                    <Text style={styles.revisionTitle}>⚠️ Yêu cầu sửa lại</Text>
                    <Text style={styles.revisionReason}>{task.revision_note || 'Chưa ghi lý do chi tiết.'}</Text>
                  </View>
                  <TouchableOpacity style={[styles.workflowBtn, { backgroundColor: '#10b981' }]} onPress={handleSubmitTask}>
                    <Ionicons name="paper-plane-outline" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                    <Text style={styles.workflowBtnText}>Gửi duyệt lại</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* WAITING APPROVAL STATE */}
              {(task.approval_status || task.status) === 'waiting_approval' && (
                <View>
                  {isAdmin ? (
                    <View style={{ gap: 8 }}>
                      <TouchableOpacity style={[styles.workflowBtn, { backgroundColor: '#10b981' }]} onPress={handleApproveTask}>
                        <Ionicons name="checkmark-done-outline" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                        <Text style={styles.workflowBtnText}>✓ Phê duyệt hoàn thành</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.workflowBtn, { backgroundColor: '#ef4444' }]}
                        onPress={() => {
                          setRejectReason('');
                          setIsRejectModalOpen(true);
                        }}
                      >
                        <Ionicons name="refresh-outline" size={18} color="#ffffff" style={{ marginRight: 6 }} />
                        <Text style={styles.workflowBtnText}>↺ Yêu cầu sửa lại</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.waitingNotice}>
                      <Ionicons name="hourglass-outline" size={18} color="#15803d" style={{ marginRight: 8 }} />
                      <Text style={styles.waitingNoticeText}>Đang chờ quản trị viên duyệt...</Text>
                    </View>
                  )}
                </View>
              )}

              {/* COMPLETED STATE */}
              {(task.approval_status || task.status) === 'completed' && (
                <View style={styles.completedNotice}>
                  <Ionicons name="checkmark-done-circle" size={20} color="#15803d" style={{ marginRight: 8 }} />
                  <Text style={styles.completedNoticeText}>Đã hoàn thành xuất sắc!</Text>
                  {task.approved_at && (
                    <Text style={styles.completedSubText}>Được duyệt lúc {formatDateTime(task.approved_at)}</Text>
                  )}
                </View>
              )}
            </View>

            {/* Sub-tabs [Bình luận, File đính kèm, Nhật ký, Báo cáo] */}
            <View style={[styles.subTabsContainer, { borderBottomColor: colors.border }]}>
              <TouchableOpacity
                style={[styles.subTabItem, activeSubTab === 'comments' && { borderBottomColor: colors.tint }]}
                onPress={() => setActiveSubTab('comments')}
              >
                <Text style={[styles.subTabText, { color: activeSubTab === 'comments' ? colors.tint : colors.tabIconDefault }]}>
                  Bình luận ({comments.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.subTabItem, activeSubTab === 'attachments' && { borderBottomColor: colors.tint }]}
                onPress={() => setActiveSubTab('attachments')}
              >
                <Text style={[styles.subTabText, { color: activeSubTab === 'attachments' ? colors.tint : colors.tabIconDefault }]}>
                  Đính kèm ({attachments.length})
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.subTabItem, activeSubTab === 'activities' && { borderBottomColor: colors.tint }]}
                onPress={() => setActiveSubTab('activities')}
              >
                <Text style={[styles.subTabText, { color: activeSubTab === 'activities' ? colors.tint : colors.tabIconDefault }]}>
                  Nhật ký
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.subTabItem, activeSubTab === 'reports' && { borderBottomColor: colors.tint }]}
                onPress={() => setActiveSubTab('reports')}
              >
                <Text style={[styles.subTabText, { color: activeSubTab === 'reports' ? colors.tint : colors.tabIconDefault }]}>
                  Báo cáo ({reports.length})
                </Text>
              </TouchableOpacity>
            </View>

            {/* Sub-tab contents */}
            <View style={{ paddingVertical: 14, minHeight: 180 }}>
              {/* TAB 1: COMMENTS */}
              {activeSubTab === 'comments' && (
                <View>
                  {/* Comments Input */}
                  <View style={styles.commentInputRow}>
                    <TextInput
                      style={[styles.commentTextInput, { color: colors.text, borderColor: colors.border }]}
                      placeholder="Viết bình luận hoặc ý kiến của bạn..."
                      placeholderTextColor={colors.tabIconDefault}
                      value={commentInput}
                      onChangeText={setCommentInput}
                      multiline
                    />
                    <TouchableOpacity
                      style={[styles.commentSendBtn, { backgroundColor: colors.tint }]}
                      onPress={handleSendComment}
                      disabled={submittingComment || !commentInput.trim()}
                    >
                      {submittingComment ? (
                        <ActivityIndicator size="small" color="#ffffff" />
                      ) : (
                        <Ionicons name="send" size={16} color="#ffffff" />
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Comments List */}
                  {loadingComments ? (
                    <ActivityIndicator size="small" color={colors.tint} style={{ marginTop: 20 }} />
                  ) : comments.length === 0 ? (
                    <Text style={[styles.emptyTabMessage, { color: colors.tabIconDefault }]}>
                      Chưa có bình luận nào. Hãy bình luận ngay!
                    </Text>
                  ) : (
                    <View style={{ gap: 12, marginTop: 10 }}>
                      {comments.map(c => (
                        <View key={c.id} style={styles.commentCard}>
                          {c.user_avatar ? (
                            <Image source={{ uri: c.user_avatar }} style={styles.commentAvatar} />
                          ) : (
                            <View style={[styles.commentAvatarFallback, { backgroundColor: colors.border }]}>
                              <Text style={[styles.commentAvatarFallbackText, { color: colors.text }]}>
                                {c.user_name.charAt(0).toUpperCase()}
                              </Text>
                            </View>
                          )}
                          <View style={styles.commentRight}>
                            <View style={styles.commentHeaderRow}>
                              <Text style={[styles.commentAuthorName, { color: colors.text }]}>
                                {c.user_name} {c.user_role === 'admin' ? '👑' : ''}
                              </Text>
                              <Text style={[styles.commentTime, { color: colors.tabIconDefault }]}>
                                {formatDateTime(c.created_at)}
                              </Text>
                            </View>
                            <Text style={[styles.commentBody, { color: colors.text }]}>
                              {c.comment}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* TAB 2: ATTACHMENTS */}
              {activeSubTab === 'attachments' && (
                <View>
                  {/* Upload button */}
                  <TouchableOpacity
                    style={[styles.uploadButton, { borderColor: colors.tint }]}
                    onPress={handleUploadFile}
                    disabled={uploadingFile}
                  >
                    {uploadingFile ? (
                      <ActivityIndicator size="small" color={colors.tint} />
                    ) : (
                      <>
                        <Ionicons name="cloud-upload-outline" size={18} color={colors.tint} style={{ marginRight: 6 }} />
                        <Text style={{ color: colors.tint, fontWeight: '700', fontSize: 13 }}>Đính kèm tài liệu mới</Text>
                      </>
                    )}
                  </TouchableOpacity>

                  {/* Attachments List */}
                  {loadingAttachments ? (
                    <ActivityIndicator size="small" color={colors.tint} style={{ marginTop: 20 }} />
                  ) : attachments.length === 0 ? (
                    <Text style={[styles.emptyTabMessage, { color: colors.tabIconDefault }]}>
                      Chưa có tệp đính kèm nào cho nhiệm vụ này.
                    </Text>
                  ) : (
                    <View style={{ gap: 10, marginTop: 14 }}>
                      {attachments.map(att => {
                        const fileName = att.file_url.split('/').pop() || 'file_attachment';
                        const isImage = att.file_type && att.file_type.startsWith('image/');
                        return (
                          <View key={att.id} style={[styles.attachmentCard, { borderColor: colors.border }]}>
                            <Ionicons name={isImage ? 'image-outline' : 'document-text-outline'} size={24} color={colors.tint} style={{ marginRight: 10 }} />
                            <View style={{ flex: 1 }}>
                              <Text style={[styles.attachmentName, { color: colors.text }]} numberOfLines={1}>
                                {fileName}
                              </Text>
                              {att.user_name && (
                                <Text style={{ fontSize: 11, color: colors.tabIconDefault, marginTop: 2 }}>
                                  Bởi {att.user_name} • {formatDateTime(att.created_at)}
                                </Text>
                              )}
                            </View>
                            <TouchableOpacity
                              style={[styles.attachmentOpenBtn, { backgroundColor: colors.border }]}
                              onPress={() => Linking.openURL(att.file_url)}
                            >
                              <Ionicons name="open-outline" size={16} color={colors.text} />
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              )}

              {/* TAB 3: ACTIVITIES */}
              {activeSubTab === 'activities' && (
                <View>
                  {loadingActivities ? (
                    <ActivityIndicator size="small" color={colors.tint} style={{ marginTop: 20 }} />
                  ) : activities.length === 0 ? (
                    <Text style={[styles.emptyTabMessage, { color: colors.tabIconDefault }]}>
                      Không tìm thấy lịch sử hoạt động.
                    </Text>
                  ) : (
                    <View style={{ gap: 12, paddingLeft: 4 }}>
                      {activities.map(act => (
                        <View key={act.id} style={styles.activityRow}>
                          <View style={[styles.activityIconBox, { backgroundColor: getActivityIconColor(act.action) + '15' }]}>
                            <Ionicons name={getActivityIcon(act.action) as any} size={14} color={getActivityIconColor(act.action)} />
                          </View>
                          <View style={{ flex: 1, marginLeft: 10 }}>
                            <Text style={[styles.activityText, { color: colors.text }]}>
                              {getActivityText(act)}
                            </Text>
                            <Text style={{ fontSize: 11, color: colors.tabIconDefault, marginTop: 2 }}>
                              {formatDateTime(act.created_at)}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}

              {/* TAB 4: REPORTS */}
              {activeSubTab === 'reports' && (
                <View>
                  {/* Create Report Button / Form */}
                  {isCreatingReport ? (
                    <View style={{ padding: 14, backgroundColor: colors.border + '15', borderRadius: 12, marginBottom: 16 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 12 }}>
                        GỬI BÁO CÁO MỚI
                      </Text>
                      
                      {/* Report Type selector */}
                      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.tabIconDefault, marginBottom: 6 }}>
                        Loại báo cáo
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                        {(['progress', 'issue', 'material_request', 'completion'] as const).map(type => {
                          let label = 'Tiến độ';
                          let bg = '#eff6ff';
                          let text = '#1e40af';
                          if (type === 'issue') { label = 'Sự cố'; bg = '#fef2f2'; text = '#991b1b'; }
                          if (type === 'material_request') { label = 'Thiếu vật tư'; bg = '#fff7ed'; text = '#9a3412'; }
                          if (type === 'completion') { label = 'Hoàn thành'; bg = '#f0fdf4'; text = '#166534'; }
                          
                          const isSelected = newReportType === type;
                          return (
                            <TouchableOpacity
                              key={type}
                              style={{
                                paddingHorizontal: 10,
                                paddingVertical: 6,
                                borderRadius: 8,
                                backgroundColor: isSelected ? text : bg,
                                borderWidth: 1,
                                borderColor: text
                              }}
                              onPress={() => {
                                setNewReportType(type);
                                if (type === 'completion') setNewReportProgress(100);
                              }}
                            >
                              <Text style={{ fontSize: 11, fontWeight: '700', color: isSelected ? '#ffffff' : text }}>
                                {type === 'progress' ? '📝 ' : type === 'issue' ? '⚠️ ' : type === 'material_request' ? '📦 ' : '✅ '}
                                {label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>

                      {/* Progress slider / chips */}
                      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.tabIconDefault, marginBottom: 6 }}>
                        Tiến độ ({newReportType === 'completion' ? '100%' : `${newReportProgress}%`})
                      </Text>
                      {newReportType === 'completion' ? (
                        <Text style={{ fontSize: 13, color: '#16a34a', fontWeight: '700', marginBottom: 12 }}>
                          Tự động đặt 100% khi báo cáo hoàn thành
                        </Text>
                      ) : (
                        <View style={{ marginBottom: 12 }}>
                          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                            {[10, 25, 50, 75, 90, 100].map(pct => (
                              <TouchableOpacity
                                key={pct}
                                style={{
                                  paddingHorizontal: 8,
                                  paddingVertical: 4,
                                  borderRadius: 6,
                                  borderWidth: 1,
                                  borderColor: colors.border,
                                  backgroundColor: newReportProgress === pct ? colors.tint : colors.card
                                }}
                                onPress={() => setNewReportProgress(pct)}
                              >
                                <Text style={{ fontSize: 11, color: newReportProgress === pct ? '#ffffff' : colors.text, fontWeight: '600' }}>
                                  {pct}%
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          <TextInput
                            style={{
                              borderWidth: 1,
                              borderColor: colors.border,
                              borderRadius: 8,
                              padding: 6,
                              fontSize: 12,
                              color: colors.text,
                              backgroundColor: colors.card,
                              width: 80
                            }}
                            keyboardType="numeric"
                            value={String(newReportProgress)}
                            onChangeText={txt => {
                              const val = parseInt(txt.replace(/[^0-9]/g, '')) || 0;
                              setNewReportProgress(Math.min(100, Math.max(0, val)));
                            }}
                            placeholder="Nhập %"
                          />
                        </View>
                      )}

                      {/* Content Description */}
                      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.tabIconDefault, marginBottom: 6 }}>
                        Nội dung báo cáo
                      </Text>
                      <TextInput
                        style={{
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 8,
                          padding: 10,
                          fontSize: 13,
                          color: colors.text,
                          backgroundColor: colors.card,
                          minHeight: 60,
                          textAlignVertical: 'top',
                          marginBottom: 12
                        }}
                        multiline
                        placeholder="Mô tả cụ thể tiến độ hoặc vấn đề bạn gặp phải..."
                        placeholderTextColor={colors.tabIconDefault}
                        value={newReportContent}
                        onChangeText={setNewReportContent}
                      />

                      {/* Attachments picker */}
                      <Text style={{ fontSize: 12, fontWeight: '600', color: colors.tabIconDefault, marginBottom: 6 }}>
                        Đính kèm ảnh/file tài liệu
                      </Text>
                      <TouchableOpacity
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: colors.tint,
                          borderRadius: 8,
                          padding: 8,
                          backgroundColor: colors.card,
                          marginBottom: 10
                        }}
                        onPress={handlePickReportAttachment}
                        disabled={uploadingReportFile}
                      >
                        {uploadingReportFile ? (
                          <ActivityIndicator size="small" color={colors.tint} />
                        ) : (
                          <>
                            <Ionicons name="camera" size={16} color={colors.tint} style={{ marginRight: 6 }} />
                            <Text style={{ fontSize: 12, color: colors.tint, fontWeight: '700' }}>Tải lên ảnh hoặc file</Text>
                          </>
                        )}
                      </TouchableOpacity>

                      {/* Chosen attachments list */}
                      {newReportAttachments.length > 0 && (
                        <View style={{ gap: 6, marginBottom: 12 }}>
                          {newReportAttachments.map((att, idx) => (
                            <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 6, borderRadius: 8 }}>
                              <Text style={{ fontSize: 11, color: colors.text, flex: 1 }} numberOfLines={1}>
                                📎 {att.name}
                              </Text>
                              <TouchableOpacity onPress={() => handleRemoveReportAttachment(idx)}>
                                <Ionicons name="trash-outline" size={14} color="#dc2626" style={{ paddingHorizontal: 6 }} />
                              </TouchableOpacity>
                            </View>
                          ))}
                        </View>
                      )}

                      {/* Submit & Cancel */}
                      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10 }}>
                        <TouchableOpacity
                          style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.border }}
                          onPress={() => setIsCreatingReport(false)}
                        >
                          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.text }}>Hủy</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={{ 
                            paddingHorizontal: 12, 
                            paddingVertical: 8, 
                            borderRadius: 8, 
                            backgroundColor: submittingReport ? colors.border : colors.tint 
                          }}
                          onPress={handleSubmitReport}
                          disabled={submittingReport}
                        >
                          {submittingReport ? (
                            <ActivityIndicator size="small" color={colors.textSecondary} />
                          ) : (
                            <Text style={{ fontSize: 12, fontWeight: '700', color: '#ffffff' }}>Gửi báo cáo</Text>
                          )}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    (isAdmin || task.assignees?.some(a => a.user_id === user?.id) || task.assigned_to === user?.id) ? (
                      <TouchableOpacity
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: colors.tint,
                          borderRadius: 12,
                          padding: 10,
                          marginBottom: 16
                        }}
                        onPress={() => setIsCreatingReport(true)}
                      >
                        <Ionicons name="add" size={18} color="#ffffff" style={{ marginRight: 4 }} />
                        <Text style={{ color: '#ffffff', fontWeight: '700', fontSize: 13.5 }}>Gửi báo cáo tiến độ</Text>
                      </TouchableOpacity>
                    ) : null
                  )}

                  {/* Grouped Reports List */}
                  {loadingReports ? (
                    <ActivityIndicator size="small" color={colors.tint} style={{ marginTop: 20 }} />
                  ) : reports.length === 0 ? (
                    <Text style={[styles.emptyTabMessage, { color: colors.tabIconDefault }]}>
                      Chưa có báo cáo nào cho công việc này.
                    </Text>
                  ) : (
                    <View style={{ gap: 16 }}>
                      {getGroupedReports().map(dailyGroup => (
                        <View key={dailyGroup.dateKey} style={{ gap: 8 }}>
                          <Text style={{ fontSize: 13, fontWeight: '800', color: colors.tint }}>
                            📅 {dailyGroup.dateLabel}
                          </Text>
                          
                          <View style={{ gap: 8, paddingLeft: 8 }}>
                            {Object.values(dailyGroup.userGroups).map(userGroup => {
                              const collapseKey = `${dailyGroup.dateKey}_${userGroup.user_name}`;
                              const isExpanded = !!expandedUsers[collapseKey];
                              
                              return (
                                <View key={userGroup.user_name} style={{ backgroundColor: colors.card, borderLeftWidth: 3, borderLeftColor: colors.tint, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border }}>
                                  <TouchableOpacity
                                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                                    onPress={() => setExpandedUsers(prev => ({ ...prev, [collapseKey]: !isExpanded }))}
                                  >
                                    <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                                      {userGroup.user_avatar ? (
                                        <Image source={{ uri: userGroup.user_avatar }} style={{ width: 22, height: 22, borderRadius: 11, marginRight: 8 }} />
                                      ) : (
                                        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                                          <Text style={{ fontSize: 10, fontWeight: 'bold', color: colors.text }}>
                                            {userGroup.user_name.charAt(0).toUpperCase()}
                                          </Text>
                                        </View>
                                      )}
                                      <Text style={{ fontSize: 13, fontWeight: '700', color: colors.text }}>
                                        {userGroup.user_name}
                                      </Text>
                                    </View>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                      <Text style={{ fontSize: 12, color: colors.tabIconDefault, marginRight: 6 }}>
                                        {userGroup.reports.length} báo cáo
                                      </Text>
                                      <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={colors.tabIconDefault} />
                                    </View>
                                  </TouchableOpacity>

                                  {isExpanded && (
                                    <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 8, gap: 12 }}>
                                      {userGroup.reports.map(rep => {
                                        let typeLabel = 'Báo cáo tiến độ';
                                        let typeColor = '#2563eb';
                                        if (rep.report_type === 'issue') { typeLabel = 'Báo cáo sự cố'; typeColor = '#dc2626'; }
                                        if (rep.report_type === 'material_request') { typeLabel = 'Thiếu vật tư'; typeColor = '#ea580c'; }
                                        if (rep.report_type === 'completion') { typeLabel = 'Báo cáo hoàn thành'; typeColor = '#16a34a'; }

                                        return (
                                          <View key={rep.id} style={{ gap: 4 }}>
                                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                                <Text style={{ fontSize: 11, fontWeight: '800', color: typeColor, backgroundColor: typeColor + '15', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                                                  {typeLabel}
                                                </Text>
                                                <Text style={{ fontSize: 11, fontWeight: '700', color: '#16a34a' }}>
                                                  Hoàn thành {rep.progress_percent}%
                                                </Text>
                                              </View>
                                              <Text style={{ fontSize: 11, color: colors.tabIconDefault }}>
                                                {formatMessageTime(rep.created_at)}
                                              </Text>
                                            </View>
                                            
                                            <Text style={{ fontSize: 12.5, color: colors.text, marginTop: 2 }}>
                                              {rep.content}
                                            </Text>
                                            
                                            {/* Report Attachments rendering */}
                                            {Array.isArray(rep.attachments) && rep.attachments.length > 0 && (
                                              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                                                {rep.attachments.map((att, idx) => (
                                                  <TouchableOpacity
                                                    key={idx}
                                                    style={{
                                                      flexDirection: 'row',
                                                      alignItems: 'center',
                                                      backgroundColor: colors.border + '15',
                                                      padding: 4,
                                                      borderRadius: 6,
                                                      borderWidth: 1,
                                                      borderColor: colors.border
                                                    }}
                                                    onPress={() => Linking.openURL(att.url)}
                                                  >
                                                    <Ionicons name="paper-plane-outline" size={10} color={colors.tint} style={{ marginRight: 4 }} />
                                                    <Text style={{ fontSize: 10, color: colors.tint, maxWidth: 100 }} numberOfLines={1}>
                                                      {att.name || 'file'}
                                                    </Text>
                                                  </TouchableOpacity>
                                                ))}
                                              </View>
                                            )}
                                          </View>
                                        );
                                      })}
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                          </View>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              )}
            </View>
          </ScrollView>

          {/* Admin Control Bar */}
          {selectedTaskBar(isAdmin || (task.created_by !== null && task.created_by === user?.id), isAdmin, task, colors, handleUrgeTask, setIsUrgeModalOpen, handleDeleteTask)}
        </View>
      </View>

      {/* Reject Modal */}
      <Modal
        visible={isRejectModalOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsRejectModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.rejectCard, { backgroundColor: colors.card }]}>
            <Text style={[styles.rejectTitle, { color: colors.text }]}>Nhập lý do làm lại</Text>
            <TextInput
              style={[styles.rejectInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Yêu cầu cụ thể của sếp..."
              placeholderTextColor={colors.tabIconDefault}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              autoFocus
            />
            <View style={styles.rejectButtons}>
              <TouchableOpacity
                style={[styles.rejectCancelBtn, { borderColor: colors.border }]}
                onPress={() => setIsRejectModalOpen(false)}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rejectSubmitBtn, { backgroundColor: '#ef4444' }]}
                onPress={handleRejectTask}
                disabled={submittingReject || !rejectReason.trim()}
              >
                {submittingReject ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={{ color: '#ffffff', fontWeight: '700' }}>Xác nhận trả lại</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Urge Modal */}
      <Modal
        visible={isUrgeModalOpen}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setIsUrgeModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.urgeCard, { backgroundColor: colors.card }]}>
            <View style={styles.urgeHeader}>
              <Text style={[styles.urgeModalTitle, { color: colors.text }]}>⚡ Thiết lập hối thúc</Text>
              <TouchableOpacity onPress={() => setIsUrgeModalOpen(false)}>
                <Ionicons name="close" size={20} color={colors.tabIconDefault} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.urgeModalSubtitle, { color: colors.tabIconDefault }]}>
              Chọn đối tượng và phương thức để đôn đốc nhân viên hoàn thành nhiệm vụ này gấp.
            </Text>

            {/* Target selection Choices */}
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: colors.text, marginBottom: 8 }}>
                Chọn đối tượng hối thúc:
              </Text>
              <View style={{ gap: 6 }}>
                {[
                  { id: 'all', label: 'Hối thúc tất cả', count: recipientsData?.total || 0 },
                  { id: 'not_viewed', label: 'Hối thúc người chưa xem', count: recipientsData?.not_viewed || 0 },
                  { id: 'not_started', label: 'Hối thúc người chưa bắt đầu', count: recipientsData ? recipientsData.users.filter(u => u.status === 'not_viewed' || u.status === 'viewed').length : 0 },
                  { id: 'not_reported', label: 'Hối thúc người chưa báo cáo', count: recipientsData ? recipientsData.users.filter(u => !u.reports_count).length : 0 },
                  { id: 'waiting_approval', label: 'Hối thúc người chờ duyệt', count: recipientsData?.waiting_approval || 0 },
                ].map(opt => (
                  <TouchableOpacity
                    key={opt.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 8,
                      borderRadius: 8,
                      borderWidth: 1.5,
                      borderColor: urgeTarget === opt.id ? colors.tint : colors.border,
                      backgroundColor: urgeTarget === opt.id ? colors.tint + '10' : colors.card,
                    }}
                    onPress={() => setUrgeTarget(opt.id as any)}
                  >
                    <View style={{
                      height: 14,
                      width: 14,
                      borderRadius: 7,
                      borderWidth: 1.5,
                      borderColor: urgeTarget === opt.id ? colors.tint : colors.tabIconDefault,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 8
                    }}>
                      {urgeTarget === opt.id && (
                        <View style={{
                          height: 6,
                          width: 6,
                          borderRadius: 3,
                          backgroundColor: colors.tint,
                        }} />
                      )}
                    </View>
                    <Text style={{ fontSize: 12, color: colors.text, flex: 1, fontWeight: urgeTarget === opt.id ? '700' : '500' }}>
                      {opt.label}
                    </Text>
                    <View style={{ backgroundColor: colors.border + '50', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 6 }}>
                      <Text style={{ fontSize: 10, fontWeight: '700', color: colors.tabIconDefault }}>
                        {opt.count}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {submittingUrge ? (
              <ActivityIndicator size="large" color="#d97706" style={{ marginVertical: 20 }} />
            ) : (
              <View style={styles.urgeOptionsList}>
                <TouchableOpacity
                  style={[styles.urgeOptionBtn, { backgroundColor: '#fee2e2', borderColor: '#ef4444' }]}
                  onPress={() => handleUrgeTask('now')}
                >
                  <Ionicons name="flash" size={18} color="#dc2626" style={{ marginRight: 8 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#b91c1c' }}>Hối thúc ngay</Text>
                    <Text style={{ fontSize: 10.5, color: '#991b1b' }}>Gửi 1 thông báo đẩy khẩn cấp ngay</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.urgeOptionBtn, { backgroundColor: '#fef3c7', borderColor: '#f59e0b' }]}
                  onPress={() => handleUrgeTask('hourly')}
                >
                  <Ionicons name="alarm" size={18} color="#d97706" style={{ marginRight: 8 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#92400e' }}>Nhắc nhở mỗi giờ</Text>
                    <Text style={{ fontSize: 10.5, color: '#b45309' }}>Gửi thông báo đẩy lặp lại mỗi 60 phút</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.urgeOptionBtn, { backgroundColor: '#e0f2fe', borderColor: '#0284c7' }]}
                  onPress={() => handleUrgeTask('daily')}
                >
                  <Ionicons name="calendar" size={18} color="#0284c7" style={{ marginRight: 8 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: '#0369a1' }}>Nhắc nhở mỗi ngày</Text>
                    <Text style={{ fontSize: 10.5, color: '#0369a1' }}>Gửi thông báo đẩy lặp lại mỗi ngày</Text>
                  </View>
                </TouchableOpacity>

                {task.reminder_interval && (
                  <TouchableOpacity
                    style={[styles.urgeOptionBtn, { backgroundColor: '#f3f4f6', borderColor: '#9ca3af' }]}
                    onPress={() => handleUrgeTask('off')}
                  >
                    <Ionicons name="notifications-off-outline" size={18} color="#4b5563" style={{ marginRight: 8 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#374151' }}>Tắt hối thúc</Text>
                      <Text style={{ fontSize: 10.5, color: '#4b5563' }}>Dừng nhắc nhở công việc này</Text>
                    </View>
                  </TouchableOpacity>
                )}
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Recipients List Drawer / Modal */}
      <Modal
        visible={isRecipientsDrawerOpen}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsRecipientsDrawerOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.recipientsDrawer, { backgroundColor: colors.card }]}>
            <View style={styles.drawerHeader}>
              <Text style={[styles.drawerTitle, { color: colors.text }]}>
                Người nhận ({recipientsData?.total || 0})
              </Text>
              <TouchableOpacity onPress={() => setIsRecipientsDrawerOpen(false)}>
                <Ionicons name="close" size={24} color={colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              {recipientsData?.users.map(recipient => {
                let statusText = 'Chưa xem';
                let statusIcon = '⚪';
                let statusColor = colors.tabIconDefault;

                if (recipient.status === 'completed') {
                  statusText = 'Hoàn thành';
                  statusIcon = '✅';
                  statusColor = '#059669';
                } else if (recipient.status === 'waiting_approval') {
                  statusText = 'Chờ duyệt';
                  statusIcon = '🔵';
                  statusColor = '#2563eb';
                } else if (recipient.status === 'revision_required') {
                  statusText = 'Cần chỉnh sửa';
                  statusIcon = '🟠';
                  statusColor = '#ea580c';
                } else if (recipient.status === 'in_progress') {
                  statusText = 'Đang thực hiện';
                  statusIcon = '🟢';
                  statusColor = '#16a34a';
                } else if (recipient.status === 'viewed') {
                  statusText = 'Đã xem';
                  statusIcon = '🟡';
                  statusColor = '#ca8a04';
                }

                // Chứa custom typed reports count và last active time
                const typedRecipient = recipient as any;
                const reportsCount = typedRecipient.reports_count || 0;
                const lastActiveAt = typedRecipient.last_active_at;
                const isActive = !!lastActiveAt;
                
                return (
                  <View 
                    key={recipient.id} 
                    style={{ 
                      flexDirection: 'row', 
                      alignItems: 'center', 
                      paddingVertical: 12, 
                      borderBottomWidth: 1, 
                      borderBottomColor: colors.border 
                    }}
                  >
                    {recipient.avatar ? (
                      <Image source={{ uri: recipient.avatar }} style={{ width: 36, height: 36, borderRadius: 18, marginRight: 12 }} />
                    ) : (
                      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                        <Text style={{ fontSize: 14, fontWeight: 'bold', color: colors.text }}>
                          {recipient.name.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ fontSize: 12, marginRight: 4 }}>
                          {isActive ? '🟢' : '⚪'}
                        </Text>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: colors.text }}>
                          {recipient.name}
                        </Text>
                      </View>
                      
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 10, flexWrap: 'wrap' }}>
                        <Text style={{ fontSize: 12, color: colors.text }}>
                          📝 {reportsCount} báo cáo
                        </Text>
                        <Text style={{ fontSize: 12, color: colors.tabIconDefault }}>
                          🕒 {lastActiveAt ? `Hoạt động ${formatConversationTime(lastActiveAt)}` : 'Chưa hoạt động'}
                        </Text>
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: statusColor, marginRight: 8 }}>
                          Trạng thái: {statusIcon} {statusText}
                        </Text>
                        {recipient.last_viewed_at && (
                          <Text style={{ fontSize: 11, color: colors.tabIconDefault }}>
                            Xem: {formatDateTime(recipient.last_viewed_at)}
                          </Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </Modal>
  );
}

function selectedTaskBar(
  canUrge: boolean,
  isAdmin: boolean,
  task: Task,
  colors: any,
  handleUrgeTask: (interval: any) => void,
  setIsUrgeModalOpen: (open: boolean) => void,
  handleDeleteTask: () => void
) {
  if (!canUrge && !isAdmin) return null;

  return (
    <View style={[styles.adminBar, { borderTopColor: colors.border }]}>
      {!task.completed && canUrge && (
        <TouchableOpacity
          style={[styles.urgeTriggerBtn, { backgroundColor: '#fee2e2' }]}
          onPress={() => setIsUrgeModalOpen(true)}
        >
          <Ionicons name="flash-outline" size={16} color="#dc2626" />
          <Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 12.5, marginLeft: 4 }}>
            {task.reminder_interval ? 'Quản lý hối thúc' : 'Hối thúc khẩn'}
          </Text>
        </TouchableOpacity>
      )}

      {isAdmin && (
        <TouchableOpacity
          style={[styles.deleteBtn, { borderColor: '#ef4444' }]}
          onPress={handleDeleteTask}
        >
          <Ionicons name="trash-outline" size={16} color="#ef4444" />
          <Text style={{ color: '#ef4444', fontWeight: '700', fontSize: 12.5, marginLeft: 4 }}>
            Xóa task
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  detailCard: {
    width: '100%',
    maxWidth: 600,
    height: '90%',
    maxHeight: 700,
    borderRadius: 24,
    overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.15, shadowRadius: 16 },
      android: { elevation: 8 },
    }),
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  workspaceLabel: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  closeBtn: {
    padding: 6,
  },
  scrollContainer: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  taskTitleText: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 28,
    marginBottom: 10,
  },
  badgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  priorityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  priorityBadgeText: {
    fontSize: 12,
    fontWeight: '700',
  },
  sectionBox: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  descriptionText: {
    fontSize: 14,
    lineHeight: 22,
  },
  metaBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 12,
  },
  metaItem: {
    flex: 1,
  },
  metaLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 30,
  },
  avatarImg: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 8,
  },
  avatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  avatarFallbackText: {
    fontSize: 11,
    fontWeight: '700',
  },
  metaValue: {
    fontSize: 13,
    fontWeight: '600',
  },
  workflowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 16,
  },
  workflowBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  waitingNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f0fdf4',
    borderColor: '#16a34a',
    borderWidth: 0.5,
    borderRadius: 10,
    height: 40,
  },
  waitingNoticeText: {
    color: '#15803d',
    fontSize: 13,
    fontWeight: '700',
  },
  completedNotice: {
    backgroundColor: '#f0fdf4',
    borderColor: '#16a34a',
    borderWidth: 0.5,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  completedNoticeText: {
    color: '#15803d',
    fontSize: 13.5,
    fontWeight: '800',
  },
  completedSubText: {
    fontSize: 11,
    color: '#166534',
    marginTop: 4,
  },
  revisionWarning: {
    backgroundColor: '#fffbeb',
    borderColor: '#f59e0b',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  revisionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#b45309',
    marginBottom: 4,
  },
  revisionReason: {
    fontSize: 12.5,
    color: '#92400e',
    fontStyle: 'italic',
    lineHeight: 18,
  },
  subTabsContainer: {
    flexDirection: 'row',
    borderBottomWidth: 1.5,
    marginBottom: 8,
    marginTop: 10,
  },
  subTabItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    marginBottom: -1.5,
  },
  subTabText: {
    fontSize: 13,
    fontWeight: '700',
  },
  commentInputRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14,
  },
  commentTextInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    height: 40,
    textAlignVertical: 'top',
  },
  commentSendBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentCard: {
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 12,
    borderBottomWidth: 0.5,
    borderBottomColor: '#f3f4f6',
  },
  commentAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  commentAvatarFallback: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentAvatarFallbackText: {
    fontSize: 13,
    fontWeight: '700',
  },
  commentRight: {
    flex: 1,
  },
  commentHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  commentAuthorName: {
    fontSize: 12.5,
    fontWeight: '700',
  },
  commentTime: {
    fontSize: 11,
  },
  commentBody: {
    fontSize: 13,
    lineHeight: 18,
  },
  emptyTabMessage: {
    fontSize: 12.5,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 24,
  },
  uploadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderRadius: 10,
    height: 44,
    marginBottom: 10,
  },
  attachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
  },
  attachmentName: {
    fontSize: 13,
    fontWeight: '600',
  },
  attachmentOpenBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  activityIconBox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  activityText: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  adminBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  urgeTriggerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  rejectCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 18,
    padding: 16,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10 },
      android: { elevation: 6 },
    }),
  },
  rejectTitle: {
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 12,
  },
  rejectInput: {
    height: 80,
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    fontSize: 13,
    textAlignVertical: 'top',
    marginBottom: 16,
  },
  rejectButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  rejectCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  rejectSubmitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  urgeCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 18,
    padding: 16,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10 },
      android: { elevation: 6 },
    }),
  },
  urgeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  urgeModalTitle: {
    fontSize: 15,
    fontWeight: '800',
  },
  urgeModalSubtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
  },
  urgeOptionsList: {
    gap: 8,
  },
  urgeOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  recipientsDrawer: {
    width: '100%',
    maxWidth: 340,
    maxHeight: '80%',
    borderRadius: 18,
    padding: 16,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10 },
      android: { elevation: 6 },
    }),
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  drawerTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
});
