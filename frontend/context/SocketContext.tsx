// frontend/context/SocketContext.tsx
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/constants/Config';
import { useConversationStore } from '../store/useConversationStore';
import { useOnlineStore } from '../store/useOnlineStore';
import { useUser } from './UserContext';

interface SocketContextType {
  socket: Socket | null;
  isConnected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  isConnected: false,
});

export const SocketProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useUser();
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

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
      socket.off('conversation_seen');
      socket.off('receive_message');
      socket.off('group_added_notify');
      socket.off('conversation_updated_name');
      socket.off('creator_transferred');
      socket.off('group_deleted');
      socket.off('group_kicked');
      socket.off('conversation_deleted');
      socket.off('conversation_restored');
      socket.disconnect();
      socketRef.current = null;
      setIsConnected(false);
    };
  }, [user]);

  return (
    <SocketContext.Provider value={{ socket: socketRef.current, isConnected }}>
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  return useContext(SocketContext);
};
