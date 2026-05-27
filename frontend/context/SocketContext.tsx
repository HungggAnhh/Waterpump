// frontend/context/SocketContext.tsx
import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import io, { Socket } from 'socket.io-client';
import { API_BASE_URL } from '@/constants/Config';
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
      transports: ['polling', 'websocket'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('🟢 [GLOBAL_SOCKET] Đã kết nối Socket.IO thành công!');
      setIsConnected(true);
      socket.emit('join', user);
    });

    socket.on('disconnect', () => {
      console.log('🔴 [GLOBAL_SOCKET] Đã ngắt kết nối Socket.IO');
      setIsConnected(false);
    });

    socket.on('connect_error', (error) => {
      console.log('⚠️ [GLOBAL_SOCKET] Lỗi kết nối socket, đang tự động thử lại...', error);
    });

    return () => {
      console.log('🧹 [GLOBAL_SOCKET] Dọn dẹp kết nối socket toàn cục');
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
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
