import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Image,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { API_BASE_URL } from '@/constants/Config';
import { useUser } from '@/context/UserContext';
import { formatConversationTime } from '../../utils/dateTime';

const { width: windowWidth, height: windowHeight } = Dimensions.get('window');

interface TaskViewsModalProps {
  visible: boolean;
  onClose: () => void;
  taskId: number | null;
  taskTitle: string | null;
}

interface Recipient {
  id: number;
  name: string;
  avatar: string | null;
  viewed: boolean;
  first_viewed_at: string | null;
  last_viewed_at: string | null;
  status: string;
}

export default function TaskViewsModal({ visible, onClose, taskId, taskTitle }: TaskViewsModalProps) {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { token } = useUser();
  const [loading, setLoading] = useState(false);
  const [viewedUsers, setViewedUsers] = useState<Recipient[]>([]);
  const [notViewedUsers, setNotViewedUsers] = useState<Recipient[]>([]);

  useEffect(() => {
    if (visible && taskId) {
      fetchViewers();
    } else {
      setViewedUsers([]);
      setNotViewedUsers([]);
    }
  }, [visible, taskId]);

  async function fetchViewers() {
    try {
      setLoading(true);
      const res = await fetch(`${API_BASE_URL}/tasks/tasks/${taskId}/recipients`, {
        headers: {
          'Authorization': `Bearer ${token || ''}`
        }
      });
      const result = await res.json();
      if (result.success && result.data && result.data.users) {
        const usersList: Recipient[] = result.data.users;
        const viewed = usersList.filter(u => u.viewed);
        const notViewed = usersList.filter(u => !u.viewed);
        setViewedUsers(viewed);
        setNotViewedUsers(notViewed);
      }
    } catch (err) {
      console.error('Error fetching viewers list:', err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <TouchableOpacity 
        style={styles.modalOverlay} 
        activeOpacity={1} 
        onPress={onClose}
      >
        <TouchableOpacity 
          style={[styles.modalContent, { backgroundColor: colors.card, borderColor: colors.border }]}
          activeOpacity={1}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={{ flex: 1, marginRight: 8 }}>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                👀 Trạng thái xem
              </Text>
              <Text style={[styles.subtitle, { color: colors.tabIconDefault }]} numberOfLines={1}>
                {taskTitle || 'Chi tiết công việc'}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={colors.text} />
            </TouchableOpacity>
          </View>

          {/* Body */}
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={colors.tint} />
              <Text style={[styles.loadingText, { color: colors.tabIconDefault }]}>
                Đang tải thông tin...
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
              {/* SECTION: ĐÃ XEM */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: '#059669' }]}>
                  ĐÃ XEM ({viewedUsers.length})
                </Text>
                {viewedUsers.length === 0 ? (
                  <Text style={[styles.emptyText, { color: colors.tabIconDefault }]}>
                    Chưa có ai xem công việc này
                  </Text>
                ) : (
                  viewedUsers.map(u => (
                    <View key={u.id} style={styles.userRow}>
                      {u.avatar ? (
                        <Image source={{ uri: u.avatar }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatarFallback, { backgroundColor: colors.border }]}>
                          <Text style={[styles.avatarFallbackText, { color: colors.text }]}>
                            {u.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.userName, { color: colors.text }]}>
                          🟢 {u.name}
                        </Text>
                        {u.last_viewed_at && (
                          <Text style={[styles.viewTime, { color: colors.tabIconDefault }]}>
                            🕒 Xem {formatConversationTime(u.last_viewed_at)}
                          </Text>
                        )}
                      </View>
                    </View>
                  ))
                )}
              </View>

              {/* Divider */}
              <View style={[styles.divider, { backgroundColor: colors.border }]} />

              {/* SECTION: CHƯA XEM */}
              <View style={styles.section}>
                <Text style={[styles.sectionTitle, { color: colors.tabIconDefault }]}>
                  CHƯA XEM ({notViewedUsers.length})
                </Text>
                {notViewedUsers.length === 0 ? (
                  <Text style={[styles.emptyText, { color: colors.tabIconDefault }]}>
                    Tất cả thành viên đã xem
                  </Text>
                ) : (
                  notViewedUsers.map(u => (
                    <View key={u.id} style={styles.userRow}>
                      {u.avatar ? (
                        <Image source={{ uri: u.avatar }} style={styles.avatar} />
                      ) : (
                        <View style={[styles.avatarFallback, { backgroundColor: colors.border }]}>
                          <Text style={[styles.avatarFallbackText, { color: colors.text }]}>
                            {u.name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.userName, { color: colors.text }]}>
                          ⚪ {u.name}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </ScrollView>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    width: Math.min(340, windowWidth * 0.85),
    maxHeight: windowHeight * 0.65,
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.05)',
  },
  title: {
    fontSize: 14,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 11.5,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  loadingContainer: {
    padding: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    fontSize: 12,
    marginTop: 8,
  },
  scrollContainer: {
    paddingTop: 12,
    paddingBottom: 8,
  },
  section: {
    marginVertical: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 11.5,
    fontStyle: 'italic',
    paddingLeft: 4,
    marginBottom: 8,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 6,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    marginRight: 10,
  },
  avatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarFallbackText: {
    fontSize: 10,
    fontWeight: 'bold',
  },
  userName: {
    fontSize: 13,
    fontWeight: '600',
  },
  viewTime: {
    fontSize: 10,
    marginTop: 1,
    paddingLeft: 18,
  },
  divider: {
    height: 1,
    marginVertical: 10,
  },
});
