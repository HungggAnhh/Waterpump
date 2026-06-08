// frontend/context/SocketContext.tsx
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { Alert } from 'react-native';
import io, { Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/constants/Config';
import { useConversationStore } from '../store/useConversationStore';
import { useOnlineStore } from '../store/useOnlineStore';
import { useUser } from './UserContext';
import { useWebRTC } from '../hooks/useWebRTC';
import { useCallStore } from '../store/useCallStore';
import { IncomingCallModal } from '../components/IncomingCallModal';
import { CallScreen } from '../components/CallScreen';
import { playRingtone } from '../utils/webrtcShim';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
  startCall?: (target: { id: number; name: string; avatar?: string }, type: 'voice' | 'video', conversationId?: string) => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, updateUserInContext } = useUser();
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Khởi tạo WebRTC hook toàn cục
  const webrtc = useWebRTC(
    socketRef,
    user ? { id: Number(user.id), name: user.name, avatar: user.avatar || undefined } : { id: 0, name: 'Guest' }
  );

  // Dùng Ref để tránh stale closures khi gọi hàm của WebRTC hook trong socket listener
  const webrtcRef = useRef(webrtc);
  useEffect(() => {
    webrtcRef.current = webrtc;
  }, [webrtc]);

  useEffect(() => {
    if (!user) {
      // Nếu không có user, ngắt kết nối socket nếu đang mở
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
        setIsConnected(false);
      }
      return;
    }

    // 1. Phân tích Socket URL từ API_BASE_URL
    let socketUrl = API_BASE_URL;
    if (socketUrl.includes('onrender.com')) {
      socketUrl = socketUrl.replace(/\/api$/, '').replace(/\/$/, '');
    } else if (socketUrl.includes(':3000')) {
      socketUrl = socketUrl.replace(/\/api$/, '').replace(/\/$/, '');
    } else {
      socketUrl = socketUrl.replace('/app-assign-tasks/api', ':3000').replace('/api', ':3000');
    }

    console.log(`🔌 [GLOBAL_SOCKET] Đang khởi tạo kết nối tới: ${socketUrl}`);

    const socket = io(socketUrl, {
      transports: ['websocket'], // Chỉ định nghĩa duy nhất websocket để tăng tốc handshake
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log(`🟢 [GLOBAL_SOCKET:CONNECT] Kết nối thành công! socket.id: ${socket.id}`);
      setIsConnected(true);
      socket.emit('join', user);
    });

    // --- ĐĂNG KÝ BỘ LẮNG NGHE TOÀN CỤC CHO ZUSTAND STORE ---

    socket.on('user_updated', (updatedUser: any) => {
      console.log('📡 [SOCKET:USER_UPDATED] User updated event received:', updatedUser);
      if (user && updatedUser && Number(updatedUser.id) === Number(user.id)) {
        console.log('🔄 [SOCKET:USER_UPDATED] Current user avatar/info updated. Syncing context...');
        updateUserInContext({
          ...user,
          ...updatedUser,
        });
      }
    });

    socket.on('task_assigned_notification', (data: { task: any, message: string }) => {
      console.log('📡 [SOCKET:TASK_ASSIGNED] Received assignment notification:', data);
      Alert.alert('Nhiệm vụ mới 📋', data.message || 'Bạn vừa được giao nhiệm vụ mới');
    });

    socket.on('task_urged', (data: { task: any, message: string }) => {
      console.log('📡 [SOCKET:TASK_URGED] Received urge notification:', data);
      Alert.alert('Hối thúc công việc ⚡', data.message || 'Sếp đang hối thúc bạn thực hiện nhiệm vụ gấp');
    });

    socket.on('update_online_users', (onlineUsers: any[]) => {
      const onlineUserIds = onlineUsers.map(ou => ou.id);
      useOnlineStore.getState().setOnlineUsers(onlineUserIds);
    });

    socket.on('conversation_seen', (data: { conversation_id: number, message_id: number }) => {
      useConversationStore.getState().markAsSeen(String(data.conversation_id), data.message_id);
    });

    socket.on('receive_message', (msg: any) => {
      const activeConversationId = useConversationStore.getState().activeConversationId;
      useConversationStore.getState().receiveMessage(msg, activeConversationId, user.id);
      
      const hasConv = useConversationStore.getState().conversations.some(c => String(c.id) === String(msg.conversation_id));
      if (!hasConv) {
        fetch(`${API_BASE_URL}/conversations?user_id=${user.id}`)
          .then(res => res.json())
          .then(result => {
            if (result.status === 'success') {
              useConversationStore.getState().setConversations(result.data);
            }
          })
          .catch(e => console.error("Lỗi sync conversation:", e));
      }
    });

    socket.on('group_added_notify', () => {
      fetch(`${API_BASE_URL}/conversations?user_id=${user.id}`)
        .then(res => res.json())
        .then(result => {
          if (result.status === 'success') {
            useConversationStore.getState().setConversations(result.data);
          }
        })
        .catch(e => console.error("Lỗi sync group:", e));
    });

    socket.on('conversation_updated_name', (data: { conversation_id: string | number, name: string }) => {
      useConversationStore.getState().updateGroupName(String(data.conversation_id), data.name);
    });

    socket.on('creator_transferred', (data: { conversation_id: string | number, created_by: string | number }) => {
      useConversationStore.getState().transferCreator(String(data.conversation_id), data.created_by);
    });

    socket.on('group_deleted', (data: { conversation_id: string | number }) => {
      useConversationStore.getState().removeConversation(String(data.conversation_id));
    });

    socket.on('group_kicked', (data: { conversation_id: string | number }) => {
      useConversationStore.getState().removeConversation(String(data.conversation_id));
    });

    socket.on('conversation_deleted', (data: { conversation_id: string | number }) => {
      useConversationStore.getState().deleteConversation(String(data.conversation_id));
    });

    socket.on('conversation_restored', () => {
      fetch(`${API_BASE_URL}/conversations?user_id=${user.id}`)
        .then(res => res.json())
        .then(result => {
          if (result.status === 'success') {
            useConversationStore.getState().setConversations(result.data);
          }
        })
        .catch(e => console.error("Lỗi sync restore:", e));
    });

    // ─── SIGNALING VOICE & VIDEO CALL LISTENERS ───

    socket.on('incoming_call', ({ callerInfo, callType, conversationId }) => {
      console.log('📡 [SOCKET:INCOMING_CALL] Cuộc gọi đến từ:', callerInfo?.name, 'Kiểu:', callType, 'ConvID:', conversationId);
      useCallStore.getState().setIncoming(callerInfo, callType, conversationId);
      playRingtone();

      // Tự động đồng ý nhận cuộc gọi nếu có cờ autoAnswer=true trên URL
      if (typeof window !== 'undefined' && window.location) {
        const urlParams = new URLSearchParams(window.location.search);
        const redirectParam = urlParams.get('redirect');
        const hasAutoAnswer = urlParams.get('autoAnswer') === 'true' || 
                              (redirectParam && redirectParam.includes('autoAnswer=true')) ||
                              window.location.href.includes('autoAnswer=true');
        
        if (hasAutoAnswer) {
          console.log('🔌 [SocketContext] Phát hiện yêu cầu tự động trả lời cuộc gọi (autoAnswer=true)! Chấp nhận ngay...');
          setTimeout(() => {
            if (webrtcRef.current) {
              webrtcRef.current.acceptCall();
              // Dọn sạch cờ autoAnswer trên URL để tránh tự động trả lời lặp lại
              try {
                const newUrl = window.location.href
                  .replace(/([&?])autoAnswer=true&?/, '$1')
                  .replace(/redirect=[^&]+/, (m) => m.replace(/%26autoAnswer%3Dtrue|%3FautoAnswer%3Dtrue|([&?])autoAnswer=true&?/, '$1'));
                window.history.replaceState({}, '', newUrl);
              } catch (e) {
                console.error('Lỗi dọn dẹp URL autoAnswer:', e);
              }
            }
          }, 800);
        }
      }
    });

    socket.on('call_accepted', () => {
      console.log('📡 [SOCKET:CALL_ACCEPTED] Đối phương đã đồng ý cuộc gọi. Tiến hành khởi tạo Offer...');
      const targetId = useCallStore.getState().targetInfo?.id;
      if (targetId) {
        console.log('📡 [SOCKET:CALL_ACCEPTED] Bắt đầu gọi initiateOffer gửi tới targetId:', targetId);
        webrtcRef.current.initiateOffer(targetId);
      } else {
        console.error('📡 [SOCKET:CALL_ACCEPTED] Không tìm thấy targetId trong store!');
      }
    });

    socket.on('call_rejected', () => {
      console.log('📡 [SOCKET:CALL_REJECTED] Đối phương đã từ chối cuộc gọi');
      webrtcRef.current.handleHangUp(false);
      Alert.alert('Từ chối', 'Đối phương hiện không thể nghe máy.');
    });

    socket.on('offer', ({ offer }) => {
      console.log('📡 [SOCKET:OFFER] Nhận được SDP Offer từ đối phương. Tiến hành xử lý...');
      webrtcRef.current.handleOffer(offer);
    });

    socket.on('answer', ({ answer }) => {
      console.log('📡 [SOCKET:ANSWER] Nhận được SDP Answer từ đối phương. Tiến hành xử lý...');
      webrtcRef.current.handleAnswer(answer);
    });

    socket.on('ice_candidate', ({ candidate }) => {
      // console.log('📡 [SOCKET:ICE_CANDIDATE] Nhận được ICE Candidate từ đối phương.');
      webrtcRef.current.handleIceCandidate(candidate);
    });

    socket.on('call_ended', () => {
      console.log('📡 [SOCKET:CALL_ENDED] Đối phương đã cúp máy hoặc kết thúc cuộc gọi');
      webrtcRef.current.handleHangUp(false);
    });

    socket.on('user_offline', () => {
      console.log('📡 [SOCKET:USER_OFFLINE] Đối phương hiện ngoại tuyến');
      webrtcRef.current.handleHangUp(false);
      Alert.alert('Ngoại tuyến', 'Người dùng hiện không hoạt động.');
    });

    socket.on('call_ringing_offline', () => {
      console.log('📡 [SOCKET:CALL_RINGING_OFFLINE] Đối phương hiện đang ngoại tuyến. Đã gửi thông báo đẩy để đánh thức.');
      // Giữ màn hình calling đổ chuông bình thường để đợi đối phương mở máy qua thông báo đẩy
    });

    socket.on('disconnect', (reason) => {
      console.log(`🔴 [GLOBAL_SOCKET:DISCONNECT] Đã ngắt kết nối. Lý do: ${reason}. socket.id: ${socket.id}`);
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.log('⚠️ [GLOBAL_SOCKET:CONNECT_ERROR] Lỗi kết nối socket, đang tự động thử lại...', error.message);
    });

    socket.on('reconnect_attempt', (attemptNumber) => {
      console.log(`🔄 [GLOBAL_SOCKET:RECONNECT_ATTEMPT] Đang thử kết nối lại lần thứ ${attemptNumber}...`);
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log(`🟢 [GLOBAL_SOCKET:RECONNECT] Kết nối lại thành công sau ${attemptNumber} lần thử! socket.id: ${socket.id}`);
      setIsConnected(true);
      socket.emit('join', user);
    });

    return () => {
      console.log('🧹 [GLOBAL_SOCKET:CLEANUP] Dọn dẹp kết nối socket toàn cục');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
      socket.off('reconnect_attempt');
      socket.off('reconnect');
      socket.off('update_online_users');
      socket.off('user_updated');
      socket.off('task_assigned_notification');
      socket.off('task_urged');
      socket.off('conversation_seen');
      socket.off('receive_message');
      socket.off('group_added_notify');
      socket.off('conversation_updated_name');
      socket.off('creator_transferred');
      socket.off('group_deleted');
      socket.off('group_kicked');
      socket.off('conversation_deleted');
      socket.off('conversation_restored');
      
      // Dọn dẹp các sự kiện call
      socket.off('incoming_call');
      socket.off('call_accepted');
      socket.off('call_rejected');
      socket.off('offer');
      socket.off('answer');
      socket.off('ice_candidate');
      socket.off('call_ended');
      socket.off('user_offline');
      socket.off('call_ringing_offline');

      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected, startCall: webrtc.startCall }}>
      {children}
      <IncomingCallModal
        visible={webrtc.callState === 'incoming'}
        callerInfo={webrtc.callerInfo}
        callType={webrtc.callType}
        onAccept={webrtc.acceptCall}
        onReject={webrtc.rejectCall}
      />
      <CallScreen
        localStream={webrtc.localStream}
        remoteStream={webrtc.remoteStream}
        onHangUp={() => webrtc.handleHangUp(true)}
        onToggleMute={webrtc.toggleMute}
        onToggleVideo={webrtc.toggleVideo}
      />
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  return useContext(SocketContext);
};
