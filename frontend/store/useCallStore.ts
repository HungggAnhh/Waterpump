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
  conversationId: string | null;
  
  // Actions
  startCall: (target: CallUserInfo, type: CallType, conversationId?: string) => void;
  setIncoming: (caller: CallUserInfo, type: CallType, conversationId?: string) => void;
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
  conversationId: null,

  startCall: (target, type, conversationId) => set({
    callState: 'calling',
    callType: type,
    callerInfo: null, // Self is caller
    targetInfo: target,
    isMuted: false,
    isVideoOff: false,
    isMinimized: false,
    conversationId: conversationId || null,
  }),

  setIncoming: (caller, type, conversationId) => set({
    callState: 'incoming',
    callType: type,
    callerInfo: caller,
    targetInfo: null, // Self is target
    isMuted: false,
    isVideoOff: false,
    isMinimized: false,
    conversationId: conversationId || null,
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
    conversationId: null,
  }),
}));
