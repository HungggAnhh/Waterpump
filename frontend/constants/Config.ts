// frontend/constants/Config.ts
import { Platform } from 'react-native';

/**
 * CẤU HÌNH API BACKEND PHP (XAMPP)
 * 
 * - Đã tự động phân giải IP mạng Wi-Fi cục bộ của máy tính bạn: 192.168.2.7
 * - Địa chỉ IP này hoạt động hoàn hảo trên cả:
 *   1. Thiết bị di động thật (Expo Go) kết nối cùng mạng Wi-Fi.
 *   2. Các trình giả lập (Android Emulator / iOS Simulator).
 *   3. Trình duyệt Web trên máy tính (localhost:8081).
 */

const COMPUTER_IP = '192.168.2.15'; // IP Wi-Fi cục bộ của bạn

const getBaseUrl = () => {
  // Tự động sử dụng backend Node.js cục bộ khi đang phát triển (development)
  if (__DEV__) {
    return Platform.OS === 'web'
      ? 'http://localhost:3000/api'
      : `http://${COMPUTER_IP}:3000/api`;
  }
  // Khi build production sẽ gọi thẳng về production Render
  return `https://waterpump-fvl3.onrender.com/api`;
};

export const API_BASE_URL = getBaseUrl();

export const endpoints = {
  tasks: `${API_BASE_URL}/tasks`,
  users: `${API_BASE_URL}/users`,
  workspaces: `${API_BASE_URL}/workspaces`,
  notifications: `${API_BASE_URL}/notifications`,
};

export default {
  API_BASE_URL,
  endpoints,
};
