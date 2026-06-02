// frontend/store/useOnlineStore.ts
import { create } from 'zustand';

interface OnlineStore {
  onlineUsers: Record<number, boolean>;
  setOnlineUsers: (userIds: number[]) => void;
}

export const useOnlineStore = create<OnlineStore>((set) => ({
  onlineUsers: {},
  setOnlineUsers: (userIds) => {
    const userMap: Record<number, boolean> = {};
    userIds.forEach(id => {
      userMap[id] = true;
    });
    set({ onlineUsers: userMap });
  },
}));
