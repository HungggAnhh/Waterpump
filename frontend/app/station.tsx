// frontend/app/station.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useSocket } from '../context/SocketContext';
import { voiceNotification } from '../services/voiceNotification';
import { useUser } from '../context/UserContext';

interface AnnouncementHistoryItem {
  id: string;
  text: string;
  timestamp: Date;
}

interface SpeechItem {
  id: string;
  text: string;
  priority: number; // 1: task, 2: message
}

const VOLUME_STORAGE_KEY = '@station_volume_level';
const MUTED_STORAGE_KEY = '@station_muted_state';

export default function StationScreen() {
  const { socket, isConnected } = useSocket();
  const { logout } = useUser();

  // Clock state
  const [currentTime, setCurrentTime] = useState('');

  // UI state
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);

  // Lists & Queues
  const [announcements, setAnnouncements] = useState<AnnouncementHistoryItem[]>([]);
  const [pendingSpeech, setPendingSpeech] = useState<SpeechItem[]>([]);

  // Ref trackers
  const eventBuffer = useRef<{
    hasGroupTask: boolean;
    hasPersonalTask: boolean;
    hasGroupMessage: boolean;
    hasPersonalMessage: boolean;
    taskAssignees: Set<string>;
    messageReceivers: Set<string>;
    groupName: string;
    timer: any;
  }>({
    hasGroupTask: false,
    hasPersonalTask: false,
    hasGroupMessage: false,
    hasPersonalMessage: false,
    taskAssignees: new Set(),
    messageReceivers: new Set(),
    groupName: '',
    timer: null,
  });

  const isSpeakingRef = useRef(false);
  const pendingSpeechRef = useRef<SpeechItem[]>([]);

  // Sync ref with state
  useEffect(() => {
    pendingSpeechRef.current = pendingSpeech;
  }, [pendingSpeech]);

  // Load persisted volume settings
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const storedVol = await AsyncStorage.getItem(VOLUME_STORAGE_KEY);
        const storedMute = await AsyncStorage.getItem(MUTED_STORAGE_KEY);

        if (storedVol !== null) {
          const parsedVol = parseFloat(storedVol);
          setVolume(parsedVol);
          voiceNotification.volume = isMuted ? 0.0 : parsedVol;
        }
        if (storedMute !== null) {
          const parsedMute = storedMute === 'true';
          setIsMuted(parsedMute);
          voiceNotification.volume = parsedMute ? 0.0 : (storedVol ? parseFloat(storedVol) : 1.0);
        }
      } catch (err) {
        console.warn('Failed to load station volume settings:', err);
      }
    };
    loadSettings();
  }, []);

  // Update digital clock every second
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hrs = String(now.getHours()).padStart(2, '0');
      const mins = String(now.getMinutes()).padStart(2, '0');
      const secs = String(now.getSeconds()).padStart(2, '0');
      setCurrentTime(`${hrs}:${mins}:${secs}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Listen to fullscreen changes (web browsers)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Priority Speech Queue Processor
  const speakNext = () => {
    if (isSpeakingRef.current) return;
    if (pendingSpeechRef.current.length === 0) return;

    // Sort: Priority 1 (task) first, then Priority 2 (message)
    const sorted = [...pendingSpeechRef.current].sort((a, b) => a.priority - b.priority);
    const nextItem = sorted[0];

    // Remove from queue
    setPendingSpeech(prev => prev.filter(item => item.id !== nextItem.id));

    if (!('speechSynthesis' in window)) {
      console.warn('Speech synthesis not supported on this browser.');
      return;
    }

    isSpeakingRef.current = true;
    const utterance = new SpeechSynthesisUtterance(nextItem.text);
    utterance.lang = 'vi-VN';
    utterance.volume = isMuted ? 0.0 : volume;

    const voices = window.speechSynthesis.getVoices();
    const viVoice = voices.find(v => v.lang === 'vi-VN' || v.lang.includes('vi'));
    if (viVoice) {
      utterance.voice = viVoice;
    }

    const handleEnd = () => {
      isSpeakingRef.current = false;
      // Triggers next announcement in queue after 1 second delay
      setTimeout(speakNext, 1000);
    };

    utterance.onend = handleEnd;
    utterance.onerror = handleEnd;

    try {
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('Speech error:', err);
      isSpeakingRef.current = false;
      setTimeout(speakNext, 500);
    }
  };

  // Run queue processor when pendingSpeech changes
  useEffect(() => {
    if (pendingSpeech.length > 0) {
      speakNext();
    }
  }, [pendingSpeech]);

  // Socket event listeners
  useEffect(() => {
    if (!socket) return;

    const processBufferedEvents = () => {
      const buf = eventBuffer.current;
      
      let text = '';
      let priority = 1;

      const formatNames = (namesSet: Set<string>) => {
        const names = Array.from(namesSet);
        if (names.length === 0) return '';
        if (names.length === 1) return names[0];
        if (names.length === 2) return `${names[0]} và ${names[1]}`;
        return `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}`;
      };

      if (buf.hasPersonalTask) {
        const namesStr = formatNames(buf.taskAssignees);

        text = namesStr
          ? `Admin vừa giao nhiệm vụ cho ${namesStr}.`
          : 'Admin vừa giao nhiệm vụ mới.';

        priority = 1;

      } else if (buf.hasGroupTask) {

        const groupName = buf.groupName || '';

        text = groupName
          ? `Admin vừa giao nhiệm vụ cho nhóm ${groupName}.`
          : 'Admin vừa giao nhiệm vụ cho một nhóm.';

        priority = 1;

      } else if (buf.hasPersonalMessage) {

        const namesStr = formatNames(buf.messageReceivers);

        text = namesStr
          ? `Admin vừa gửi tin nhắn cho ${namesStr}.`
          : 'Admin vừa gửi tin nhắn mới.';

        priority = 2;

      } else if (buf.hasGroupMessage) {

        const groupName = buf.groupName || '';

        text = groupName
          ? `Admin vừa gửi tin nhắn cho nhóm ${groupName}.`
          : 'Admin vừa gửi tin nhắn trong một nhóm.';

        priority = 2;
      }

      // Reset buffer
      eventBuffer.current = {
        hasGroupTask: false,
        hasPersonalTask: false,
        hasGroupMessage: false,
        hasPersonalMessage: false,
        taskAssignees: new Set(),
        messageReceivers: new Set(),
        groupName: '',
        timer: null
      };

      if (!text) return;

      // Update UI logs
      setAnnouncements(prev => [{
        id: `announcement_${Date.now()}_${Math.random()}`,
        text,
        timestamp: new Date()
      }, ...prev].slice(0, 100));

      // Add to speech queue
      setPendingSpeech(prev => [...prev, {
        id: `speech_${Date.now()}_${Math.random()}`,
        text,
        priority
      }]);
    };

    const handleTaskAssigned = (data: {
      adminName: string;
      assigneeNames?: string[];
      isGroup: boolean;
      groupName?: string;
      timestamp: string;
    }) => {
      console.log('📡 [STATION] received station_task_assigned:', data);
      
      if (eventBuffer.current.timer) {
        clearTimeout(eventBuffer.current.timer);
      }

      if (data.isGroup) {
        eventBuffer.current.hasGroupTask = true;
      } else {
        eventBuffer.current.hasPersonalTask = true;
      }

      if (data.assigneeNames && Array.isArray(data.assigneeNames)) {
        data.assigneeNames.forEach(name => {
          if (name) eventBuffer.current.taskAssignees.add(name);
        });
      }

      if (data.groupName) {
        eventBuffer.current.groupName = data.groupName;
      }

      eventBuffer.current.timer = setTimeout(processBufferedEvents, 3000);
    };

    const handleDirectMessage = (data: {
      adminName: string;
      receiverNames?: string[];
      isGroup: boolean;
      groupName?: string;
      timestamp: string;
    }) => {
      console.log('📡 [STATION] received station_direct_message:', data);
      
      if (eventBuffer.current.timer) {
        clearTimeout(eventBuffer.current.timer);
      }

      if (data.isGroup) {
        eventBuffer.current.hasGroupMessage = true;
      } else {
        eventBuffer.current.hasPersonalMessage = true;
      }

      if (data.receiverNames && Array.isArray(data.receiverNames)) {
        data.receiverNames.forEach(name => {
          if (name) eventBuffer.current.messageReceivers.add(name);
        });
      }

      if (data.groupName) {
        eventBuffer.current.groupName = data.groupName;
      }

      eventBuffer.current.timer = setTimeout(processBufferedEvents, 3000);
    };

    socket.on('station_task_assigned', handleTaskAssigned);
    socket.on('station_direct_message', handleDirectMessage);

    return () => {
      socket.off('station_task_assigned', handleTaskAssigned);
      socket.off('station_direct_message', handleDirectMessage);
      if (eventBuffer.current.timer) {
        clearTimeout(eventBuffer.current.timer);
      }
    };
  }, [socket]);

  // Volume Handlers
  const handleVolumeUp = async () => {
    const newVol = Math.min(1.0, volume + 0.1);
    const rounded = Math.round(newVol * 10) / 10;
    setVolume(rounded);
    voiceNotification.volume = isMuted ? 0.0 : rounded;
    await AsyncStorage.setItem(VOLUME_STORAGE_KEY, String(rounded));
  };

  const handleVolumeDown = async () => {
    const newVol = Math.max(0.0, volume - 0.1);
    const rounded = Math.round(newVol * 10) / 10;
    setVolume(rounded);
    voiceNotification.volume = isMuted ? 0.0 : rounded;
    await AsyncStorage.setItem(VOLUME_STORAGE_KEY, String(rounded));
  };

  const handleToggleMute = async () => {
    const newMute = !isMuted;
    setIsMuted(newMute);
    voiceNotification.volume = newMute ? 0.0 : volume;
    await AsyncStorage.setItem(MUTED_STORAGE_KEY, String(newMute));
  };

  // Test Speech Synthesis
  const handleTestVoice = () => {
    const testText = 'Hệ thống âm thanh trạm thông báo đang hoạt động bình thường.';
    if (!('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(testText);
    utterance.lang = 'vi-VN';
    utterance.volume = isMuted ? 0.0 : volume;
    const voices = window.speechSynthesis.getVoices();
    const viVoice = voices.find(v => v.lang === 'vi-VN' || v.lang.includes('vi'));
    if (viVoice) {
      utterance.voice = viVoice;
    }
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  // Toggle Fullscreen
  const toggleFullscreen = () => {
    if (Platform.OS !== 'web') return;
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(err => {
        console.warn('Fullscreen request failed:', err);
      });
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(err => {
        console.warn('Exit fullscreen failed:', err);
      });
    }
  };

  const handleLogout = () => {
    if (Platform.OS === 'web') {
      const confirmLogout = window.confirm('Bạn có chắc chắn muốn đăng xuất khỏi tài khoản?');
      if (confirmLogout) {
        logout();
      }
    } else {
      Alert.alert(
        'Đăng xuất 🔴',
        'Bạn có chắc chắn muốn đăng xuất khỏi tài khoản?',
        [
          { text: 'Hủy', style: 'cancel' },
          { text: 'Đăng xuất', style: 'destructive', onPress: () => logout() }
        ]
      );
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header Card */}
      <View style={styles.header}>
        <View style={styles.statusIndicator}>
          <View style={[styles.statusDot, { backgroundColor: isConnected ? '#10b981' : '#ef4444' }]} />
          <Text style={styles.statusText}>{isConnected ? 'Connected' : 'Disconnected'}</Text>
        </View>
        
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          {Platform.OS === 'web' && (
            <TouchableOpacity onPress={toggleFullscreen} style={styles.fullscreenBtn} activeOpacity={0.8}>
              <Ionicons name={isFullscreen ? 'contract' : 'expand'} size={22} color="#94a3b8" />
              <Text style={styles.fullscreenBtnText}>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity onPress={handleLogout} style={styles.logoutBtnHeader} activeOpacity={0.8}>
            <Ionicons name="log-out-outline" size={22} color="#ef4444" />
            <Text style={styles.logoutBtnHeaderText}>Đăng xuất</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Glowing Large Clock */}
      <View style={styles.clockContainer}>
        <Ionicons name="time-outline" size={36} color="#38bdf8" style={styles.clockIcon} />
        <Text style={styles.clockText}>{currentTime || '00:00:00'}</Text>
        <Text style={styles.clockSubText}>TEAMFLOW ANNOUNCEMENT STATION</Text>
      </View>

      {/* Scrollable Live Announcements Log */}
      <View style={styles.logContainer}>
        <View style={styles.logHeader}>
          <Ionicons name="volume-high-outline" size={20} color="#38bdf8" />
          <Text style={styles.logTitle}>Lịch sử thông báo giọng nói (Tối đa 100)</Text>
        </View>
        <ScrollView style={styles.logScrollView} contentContainerStyle={styles.logScrollContent}>
          {announcements.length === 0 ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="small" color="#64748b" style={{ marginBottom: 12 }} />
              <Text style={styles.emptyText}>Chưa có thông báo nào được ghi nhận.</Text>
              <Text style={styles.emptySubText}>Đang lắng nghe sự kiện từ Ban Quản trị...</Text>
            </View>
          ) : (
            announcements.map((item, idx) => (
              <View key={item.id} style={[styles.logItem, idx === 0 && styles.logItemLatest]}>
                <Text style={styles.logTime}>
                  {item.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                </Text>
                <Text style={[styles.logText, idx === 0 && styles.logTextLatest]}>
                  {item.text}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      {/* Bottom Audio Control Toolbar */}
      <View style={styles.controlBar}>
        <TouchableOpacity onPress={handleToggleMute} style={[styles.controlBtn, isMuted && styles.controlBtnActive]} activeOpacity={0.8}>
          <Ionicons name={isMuted ? 'volume-mute' : 'volume-medium'} size={20} color={isMuted ? '#ef4444' : '#fff'} />
          <Text style={[styles.controlBtnText, isMuted && { color: '#ef4444' }]}>{isMuted ? 'Muted' : 'Mute'}</Text>
        </TouchableOpacity>

        <View style={styles.volumeAdjuster}>
          <TouchableOpacity onPress={handleVolumeDown} style={styles.volAdjustBtn} activeOpacity={0.8}>
            <Ionicons name="remove" size={18} color="#fff" />
          </TouchableOpacity>
          <View style={styles.volProgressBg}>
            <View style={[styles.volProgressFill, { width: `${volume * 100}%` }]} />
          </View>
          <TouchableOpacity onPress={handleVolumeUp} style={styles.volAdjustBtn} activeOpacity={0.8}>
            <Ionicons name="add" size={18} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.volPctText}>{Math.round(volume * 100)}%</Text>
        </View>

        <TouchableOpacity onPress={handleTestVoice} style={styles.testBtn} activeOpacity={0.8}>
          <Ionicons name="play-circle-outline" size={20} color="#38bdf8" style={{ marginRight: 6 }} />
          <Text style={styles.testBtnText}>Test Voice</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    padding: 24,
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  fullscreenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
  },
  fullscreenBtnText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600',
  },
  logoutBtnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
  },
  logoutBtnHeaderText: {
    color: '#ef4444',
    fontSize: 12,
    fontWeight: '600',
  },
  clockContainer: {
    alignItems: 'center',
    marginVertical: 12,
  },
  clockIcon: {
    marginBottom: 6,
  },
  clockText: {
    color: '#f8fafc',
    fontSize: 72,
    fontWeight: '700',
    letterSpacing: 2,
    fontVariant: ['tabular-nums'],
    textShadowColor: 'rgba(56, 189, 248, 0.4)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 15,
  },
  clockSubText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 3,
    marginTop: 4,
  },
  logContainer: {
    flex: 1,
    backgroundColor: 'rgba(30, 41, 59, 0.6)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#334155',
    marginVertical: 16,
    overflow: 'hidden',
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    gap: 8,
  },
  logTitle: {
    color: '#e2e8f0',
    fontSize: 14,
    fontWeight: '700',
  },
  logScrollView: {
    flex: 1,
  },
  logScrollContent: {
    padding: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubText: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
  },
  logItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(51, 65, 85, 0.4)',
    gap: 16,
  },
  logItemLatest: {
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderRadius: 8,
    paddingHorizontal: 8,
    borderBottomColor: 'transparent',
  },
  logTime: {
    color: '#64748b',
    fontSize: 12,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    width: 60,
    marginTop: 2,
  },
  logText: {
    color: '#cbd5e1',
    fontSize: 14,
    flex: 1,
    lineHeight: 20,
  },
  logTextLatest: {
    color: '#f8fafc',
    fontWeight: '600',
  },
  controlBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    gap: 16,
  },
  controlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    gap: 6,
  },
  controlBtnActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderWidth: 1,
    borderColor: '#ef4444',
  },
  controlBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  volumeAdjuster: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  volAdjustBtn: {
    backgroundColor: '#334155',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  volProgressBg: {
    flex: 1,
    height: 6,
    backgroundColor: '#475569',
    borderRadius: 3,
    overflow: 'hidden',
  },
  volProgressFill: {
    height: '100%',
    backgroundColor: '#38bdf8',
  },
  volPctText: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '700',
    width: 36,
    textAlign: 'right',
  },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#38bdf8',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  testBtnText: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
  },
});
