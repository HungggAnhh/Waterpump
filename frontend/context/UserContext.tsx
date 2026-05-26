// frontend/context/UserContext.tsx
import React, { createContext, useState, useContext, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE_URL } from '@/constants/Config';

export interface User {
  id: number;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
  status: 'active' | 'inactive';
}

interface UserContextType {
  user: User | null;
  token: string | null;
  loading: boolean;
  login: (userData: User, userToken: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUserInContext: (updatedUser: User) => Promise<void>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

// Memory storage fallback phòng hờ khi ứng dụng chạy trên thiết bị không liên kết module native
const memoryStorage: Record<string, string> = {};

// Safe storage wrapper phòng tránh lỗi 'Native module is null' trên một số môi trường Expo Go
const safeStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await AsyncStorage.getItem(key);
    } catch (e) {
      console.warn(`[SafeStorage] getItem failed for ${key}, falling back:`, e);
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
      return memoryStorage[key] || null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      await AsyncStorage.setItem(key, value);
    } catch (e) {
      console.warn(`[SafeStorage] setItem failed for ${key}, falling back:`, e);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
      memoryStorage[key] = value;
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      await AsyncStorage.removeItem(key);
    } catch (e) {
      console.warn(`[SafeStorage] removeItem failed for ${key}, falling back:`, e);
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
      delete memoryStorage[key];
    }
  }
};

export const UserProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // 1. Kiểm tra phiên đăng nhập persistent khi khởi động App
  useEffect(() => {
    const checkPersistentLogin = async () => {
      try {
        const storedToken = await safeStorage.getItem('user_token');
        const storedUserJson = await safeStorage.getItem('user_data');

        if (storedToken && storedUserJson) {
          const parsedUser = JSON.parse(storedUserJson);
          
          // Gửi API kiểm tra token xem còn hợp lệ không (verify-token)
          const response = await fetch(`${API_BASE_URL}/auth/verify-token`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${storedToken}`
            }
          });

          const result = await response.json();

          if (response.ok && result.status === 'success') {
            // Token hợp lệ, cập nhật trạng thái vào State
            setUser(result.data);
            setToken(storedToken);
          } else {
            // Token đã hết hạn hoặc không hợp lệ -> xóa sạch phiên
            await safeStorage.removeItem('user_token');
            await safeStorage.removeItem('user_data');
          }
        }
      } catch (error) {
        console.error("Lỗi tự động đăng nhập:", error);
      } finally {
        setLoading(false);
      }
    };

    checkPersistentLogin();
  }, []);

  // 2. Tự động đính kèm token (Bearer Token) vào toàn bộ HTTP Requests của hệ thống (Global Fetch Interceptor)
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      try {
        const storedToken = await safeStorage.getItem('user_token');
        const isBackend = typeof input === 'string' && (
          input.includes('/api/') || 
          input.includes('app-assign-tasks') || 
          input.includes('localhost') || 
          input.includes('192.168.')
        );

        if (storedToken && isBackend) {
          init = init || {};
          const headers = new Headers(init.headers || {});
          if (!headers.has('Authorization')) {
            headers.set('Authorization', `Bearer ${storedToken}`);
          }
          init.headers = headers;
        }
      } catch (e) {
        console.error("Fetch interceptor error:", e);
      }
      return originalFetch(input, init);
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  // 3. Đăng nhập thành công -> Lưu dữ liệu persistent vào AsyncStorage
  const login = async (userData: User, userToken: string) => {
    try {
      await safeStorage.setItem('user_token', userToken);
      await safeStorage.setItem('user_data', JSON.stringify(userData));
      setUser(userData);
      setToken(userToken);
    } catch (error) {
      console.error("Lỗi khi lưu phiên đăng nhập:", error);
    }
  };

  // 4. Đăng xuất -> Xóa toàn bộ token & thông tin người dùng khỏi bộ nhớ vĩnh viễn
  const logout = async () => {
    try {
      await safeStorage.removeItem('user_token');
      await safeStorage.removeItem('user_data');
      setUser(null);
      setToken(null);
    } catch (error) {
      console.error("Lỗi khi xóa phiên đăng xuất:", error);
    }
  };

  // 5. Cập nhật thông tin User trong Context (ví dụ khi onboarding xong)
  const updateUserInContext = async (updatedUser: User) => {
    try {
      await safeStorage.setItem('user_data', JSON.stringify(updatedUser));
      setUser(updatedUser);
    } catch (error) {
      console.error("Lỗi cập nhật user data:", error);
    }
  };

  return (
    <UserContext.Provider value={{ user, token, loading, login, logout, updateUserInContext }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser phải được sử dụng bên trong UserProvider');
  }
  return context;
};
