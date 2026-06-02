// frontend/app/(tabs)/tasks.tsx
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
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useUser } from '@/context/UserContext';
import { useSocket } from '@/context/SocketContext';
import { API_BASE_URL } from '@/constants/Config';
import { router } from 'expo-router';

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

export default function WorkspaceScreen() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { user } = useUser();
  const { socket } = useSocket();

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [usersList, setUsersList] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states for creating Workspace
  const [isWorkspaceModalOpen, setIsWorkspaceModalOpen] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<number[]>([]);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);

  // Fetch workspaces list
  const fetchWorkspaces = async () => {
    try {
      setLoading(true);
      const wsResponse = await fetch(`${API_BASE_URL}/tasks/workspaces`);
      const wsResult = await wsResponse.json();
      
      if (wsResult.status === 'success') {
        setWorkspaces(wsResult.data || []);
      }
    } catch (err) {
      console.error('⚠️ [Tasks] Lỗi tải danh sách Trang:', err);
    } finally {
      setLoading(false);
    }
  };

  // Fetch users list for internal member selection
  const fetchUsers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/users`);
      const result = await res.json();
      if (result.status === 'success') {
        // Lọc bỏ chính người tạo (Admin) ra khỏi danh sách chọn vì họ mặc định được thêm làm chủ sở hữu trang
        const filtered = (result.data || []).filter((u: UserListItem) => u.id !== user?.id);
        setUsersList(filtered);
      }
    } catch (err) {
      console.error('⚠️ [Tasks] Lỗi tải danh sách User:', err);
    }
  };

  useEffect(() => {
    fetchWorkspaces();
    fetchUsers();
  }, [user]);

  // Bind Realtime Socket listeners
  useEffect(() => {
    if (!socket) return;

    const handleWorkspaceCreated = (newWs: Workspace) => {
      console.log('📡 [SOCKET] workspace_created:', newWs);
      setWorkspaces(prev => {
        if (prev.some(w => w.id === newWs.id)) return prev;
        return [...prev, newWs];
      });
    };

    const handleWorkspaceDeleted = (deletedWs: { id: number }) => {
      console.log('📡 [SOCKET] workspace_deleted:', deletedWs);
      setWorkspaces(prev => prev.filter(w => w.id !== deletedWs.id));
    };

    socket.on('workspace_created', handleWorkspaceCreated);
    socket.on('workspace_deleted', handleWorkspaceDeleted);

    const refreshTrigger = () => {
      // Re-fetch workspaces for non-admins when visibility updates
      if (user?.role !== 'admin') {
        fetchWorkspaces();
      }
    };
    socket.on('task_created', refreshTrigger);
    socket.on('task_updated', refreshTrigger);
    socket.on('task_deleted', refreshTrigger);

    return () => {
      socket.off('workspace_created', handleWorkspaceCreated);
      socket.off('workspace_deleted', handleWorkspaceDeleted);
      socket.off('task_created', refreshTrigger);
      socket.off('task_updated', refreshTrigger);
      socket.off('task_deleted', refreshTrigger);
    };
  }, [socket, user]);

  const handleToggleMember = (userId: number) => {
    setSelectedMembers(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId);
      } else {
        return [...prev, userId];
      }
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
        
        // Điều hướng trực tiếp sang bảng cơ sở dữ liệu vừa tạo!
        router.push(`/workspace/${newWs.id}` as any);
      } else {
        alert(result.message || 'Không thể tạo trang mới.');
      }
    } catch (err) {
      console.error(err);
      alert('Có lỗi mạng xảy ra.');
    } finally {
      setCreatingWorkspace(false);
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
        } else {
          alert(result.message || 'Lỗi khi xóa trang.');
        }
      } catch (err) {
        console.error(err);
        alert('Lỗi mạng.');
      }
    };

    const msg = `Bạn có chắc chắn muốn xóa trang "${name}" và toàn bộ công việc bên trong không? Hành động này không thể hoàn tác.`;

    if (Platform.OS === 'web') {
      if (window.confirm(msg)) {
        doDelete();
      }
    } else {
      Alert.alert(
        "Xác nhận xóa trang",
        msg,
        [
          { text: "Hủy", style: "cancel" },
          { text: "Xóa", style: "destructive", onPress: doDelete }
        ]
      );
    }
  };

  const isAdmin = user?.role === 'admin';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      {/* 1. Header */}
      <View style={[styles.header, { borderColor: colors.border }]}>
        <View style={styles.headerTitleRow}>
          <Ionicons name="folder-open-outline" size={24} color={colors.tint} style={{ marginRight: 8 }} />
          <Text style={[styles.headerTitle, { color: colors.text }]}>Công việc</Text>
        </View>
        
        {/* Admin only: Thêm trang */}
        {isAdmin && (
          <TouchableOpacity
            style={[styles.addWorkspaceBtn, { backgroundColor: colors.tint }]}
            onPress={() => setIsWorkspaceModalOpen(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color="#ffffff" style={{ marginRight: 2 }} />
            <Text style={styles.addWorkspaceBtnText}>Thêm trang</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* 2. Loading State */}
      {loading && workspaces.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
          <Text style={[styles.loadingText, { color: colors.tabIconDefault }]}>Đang tải không gian làm việc...</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          {workspaces.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={[styles.emptyIconBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="briefcase-outline" size={48} color={colors.tabIconDefault} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>Không có trang công việc nào</Text>
              <Text style={[styles.emptySubtitle, { color: colors.tabIconDefault }]}>
                {isAdmin
                  ? 'Bấm nút "+ Thêm trang" ở góc trên để tạo mới không gian quản lý công việc.'
                  : 'Không có nhiệm vụ nào được giao cho bạn hiện tại.'}
              </Text>
            </View>
          ) : (
            <View style={styles.listContainer}>
              {workspaces.map(ws => (
                <TouchableOpacity
                  key={ws.id}
                  style={[styles.workspaceItemCard, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => router.push(`/workspace/${ws.id}` as any)}
                  activeOpacity={0.7}
                >
                  <View style={styles.workspaceItemLeft}>
                    <Ionicons name="document-text" size={20} color="#059669" style={{ marginRight: 12 }} />
                    <Text style={[styles.workspaceName, { color: colors.text }]}>{ws.name}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    {isAdmin && (
                      <TouchableOpacity 
                        style={{ padding: 8, marginRight: 8 }}
                        onPress={(e) => {
                          e.stopPropagation(); // Prevents navigating to the workspace
                          handleDeleteWorkspace(ws.id, ws.name);
                        }}
                      >
                        <Ionicons name="trash-outline" size={18} color={colors.danger || '#ef4444'} />
                      </TouchableOpacity>
                    )}
                    <Ionicons name="chevron-forward" size={16} color={colors.tabIconDefault} />
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* 3. Modal: Thêm Trang và chọn người giao việc trong nội bộ (Workspace) */}
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
            
            {/* Page Name Input */}
            <Text style={[styles.inputLabel, { color: colors.text }]}>Tên trang *</Text>
            <TextInput
              style={[styles.textInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.background }]}
              placeholder="Ví dụ: PHÚC, PCB, BANNER..."
              placeholderTextColor={colors.tabIconDefault}
              value={newWorkspaceName}
              onChangeText={setNewWorkspaceName}
              autoFocus
            />

            {/* Internal Members Picker */}
            <Text style={[styles.inputLabel, { color: colors.text, marginBottom: 8 }]}>Chọn thành viên tham gia nội bộ</Text>
            {usersList.length === 0 ? (
              <Text style={[styles.emptyUsersText, { color: colors.tabIconDefault }]}>Không tìm thấy thành viên khác.</Text>
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.membersHorizontalScroll}>
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
                      <View style={styles.avatarWrapper}>
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

            {/* Buttons */}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.btnCancel, { borderColor: colors.border }]}
                onPress={() => {
                  setIsWorkspaceModalOpen(false);
                  setNewWorkspaceName('');
                  setSelectedMembers([]);
                }}
              >
                <Text style={[styles.btnCancelText, { color: colors.text }]}>Hủy</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btnSubmit, { backgroundColor: colors.tint }]}
                onPress={handleCreateWorkspace}
                disabled={creatingWorkspace || !newWorkspaceName.trim()}
              >
                {creatingWorkspace ? (
                  <ActivityIndicator size="small" color="#ffffff" />
                ) : (
                  <Text style={styles.btnSubmitText}>Tạo</Text>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  addWorkspaceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  addWorkspaceBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 13,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 100,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 30,
  },
  emptyIconBox: {
    width: 90,
    height: 90,
    borderRadius: 30,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  listContainer: {
    gap: 10,
  },
  workspaceItemCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.03,
        shadowRadius: 3,
      },
      android: {
        elevation: 1,
      },
    }),
  },
  workspaceItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  workspaceName: {
    fontSize: 15,
    fontWeight: '800',
    flex: 1,
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
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.15,
        shadowRadius: 12,
      },
      android: {
        elevation: 6,
      },
    }),
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
    fontWeight: '500',
    marginBottom: 16,
  },
  membersHorizontalScroll: {
    flexDirection: 'row',
    marginBottom: 20,
    paddingVertical: 4,
  },
  emptyUsersText: {
    fontSize: 12,
    fontStyle: 'italic',
    marginBottom: 20,
  },
  memberGridItem: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 8,
    borderWidth: 1.5,
    borderColor: 'transparent',
    borderRadius: 14,
    width: 74,
    marginRight: 8,
  },
  avatarWrapper: {
    position: 'relative',
    marginBottom: 6,
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
});
