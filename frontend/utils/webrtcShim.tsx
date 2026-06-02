// frontend/utils/webrtcShim.tsx
import { Vibration } from 'react-native';
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  RTCView,
} from 'react-native-webrtc';

export const playRingtone = () => {
  console.log('🔌 [SHIM:NATIVE] Bắt đầu rung phản hồi cuộc gọi');
  // Rung nhấp nháy 800ms, tắt 1000ms
  Vibration.vibrate([0, 800, 1000], true);
};

export const stopRingtone = () => {
  console.log('🔌 [SHIM:NATIVE] Tắt rung phản hồi cuộc gọi');
  Vibration.cancel();
};

export {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  mediaDevices,
  RTCView,
};
