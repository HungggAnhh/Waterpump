// frontend/store/useCallStore.ts
import { create } from 'zustand';

export type CallState = 'idle' | 'calling' | 'incoming' | 'connected';
export type CallType = 'voice' | 'video';

export interface CallUserInfo {
  id: number;
  name: string;
  avatar?: string;
}

interface CallStore {
  callState: CallState;
  callType: CallType | null;
  callerInfo: CallUserInfo | null;
  targetInfo: CallUserInfo | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isMinimized: boolean;
  
  // Actions
  startCall: (target: CallUserInfo, type: CallType) => void;
  setIncoming: (caller: CallUserInfo, type: CallType) => void;
  setConnected: () => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleMinimize: () => void;
  setMinimized: (minimized: boolean) => void;
  setMuted: (muted: boolean) => void;
  setVideoOff: (videoOff: boolean) => void;
  resetCall: () => void;
}

export const useCallStore = create<CallStore>((set) => ({
  callState: 'idle',
  callType: null,
  callerInfo: null,
  targetInfo: null,
  isMuted: false,
  isVideoOff: false,
  isMinimized: false,

  startCall: (target, type) => set({
    callState: 'calling',
    callType: type,
    callerInfo: null, // Self is caller, will set callerInfo when receiving if needed, or leave null
    targetInfo: target,
    isMuted: false,
    isVideoOff: false,
    isMinimized: false,
  }),

  setIncoming: (caller, type) => set({
    callState: 'incoming',
    callType: type,
    callerInfo: caller,
    targetInfo: null, // Self is target
    isMuted: false,
    isVideoOff: false,
    isMinimized: false,
  }),

  setConnected: () => set({
    callState: 'connected',
  }),

  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
  toggleVideo: () => set((state) => ({ isVideoOff: !state.isVideoOff })),
  toggleMinimize: () => set((state) => ({ isMinimized: !state.isMinimized })),
  setMinimized: (minimized) => set({ isMinimized: minimized }),
  setMuted: (muted) => set({ isMuted: muted }),
  setVideoOff: (videoOff) => set({ isVideoOff: videoOff }),

  resetCall: () => set({
    callState: 'idle',
    callType: null,
    callerInfo: null,
    targetInfo: null,
    isMuted: false,
    isVideoOff: false,
    isMinimized: false,
  }),
}));
