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

const COMPUTER_IP = '192.168.2.7'; // IP Wi-Fi cục bộ của bạn

const getBaseUrl = () => {
  // Trên trình duyệt Web, có thể gọi trực tiếp localhost ở cổng 3000
  if (Platform.OS === 'web') {
    return `http://localhost:3000/api`;
  }
  // Trên các thiết bị di động (thật + giả lập), dùng IP Wi-Fi của máy tính ở cổng 3000
  return `http://${COMPUTER_IP}:3000/api`;
};

export const API_BASE_URL = getBaseUrl();

export const endpoints = {
  tasks: `${API_BASE_URL}/tasks`,
  users: `${API_BASE_URL}/users`,
};

export default {
  API_BASE_URL,
  endpoints,
};
