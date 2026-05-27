// frontend/store/useConversationStore.ts
import { create } from 'zustand';

export interface GroupMember {
  user_id: number;
  id?: number;
  name: string;
  avatar?: string;
  role?: string;
  email?: string;
}

export interface ChatThread {
  id: string; // conversation_id
  name: string;
  avatar: string;
  lastMessage: string;
  time: string;
  unreadCount: number;
  online: boolean;
  type: 'direct' | 'group';
  otherUser?: {
    user_id: number;
    name: string;
    avatar: string;
    role: string;
    email: string;
  } | null;
  lastSeenMessageId?: number | null;
  lastMessageId?: number | null;
  lastMessageSenderId?: number | null;
  rawTime: string;
  updated_at?: string;
  createdBy?: string | number | null;
  members?: GroupMember[];
}

interface ConversationStore {
  // Preserves strict order physically in an array
  conversations: ChatThread[];
  
  // Set all conversations initially (e.g. after API fetch)
  setConversations: (threads: ChatThread[]) => void;
  
  // Real-time message receiver logic
  receiveMessage: (msg: {
    id: number;
    conversation_id: number;
    sender_id: number;
    message: string;
    created_at: string;
    raw_time?: string;
  }, activeConversationId: string | null, currentUserId: number) => void;
  
  // Real-time conversation seen logic
  markAsSeen: (conversationId: string, messageId: number) => void;
  
  // Update online status in real-time
  updateOnlineUsers: (onlineUserIds: number[]) => void;

  // New Group actions
  updateGroupName: (conversationId: string, newName: string) => void;
  addMemberToGroup: (conversationId: string, member: GroupMember) => void;
  removeMemberFromGroup: (conversationId: string, userId: number) => void;
  transferCreator: (conversationId: string, newCreatorId: string | number) => void;
  removeConversation: (conversationId: string) => void;
  replaceConversation: (updatedConversation: ChatThread) => void;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],

  setConversations: (threads) => {
    // Initial sort by database timestamp descending to prepare order
    const sorted = [...threads].sort((a, b) => {
      const safeGetTime = (timeVal: any): number => {
        if (!timeVal) return 0;
        const parsed = new Date(timeVal).getTime();
        if (!isNaN(parsed)) return parsed;
        if (typeof timeVal === 'string') {
          const cleaned = timeVal.replace(' ', 'T');
          const parsedCleaned = new Date(cleaned).getTime();
          if (!isNaN(parsedCleaned)) return parsedCleaned;
        }
        return 0;
      };

      const timeA = safeGetTime(a.rawTime || a.updated_at);
      const timeB = safeGetTime(b.rawTime || b.updated_at);
      return timeB - timeA;
    });

    set({ conversations: sorted });
  },

  receiveMessage: (msg, activeConversationId, currentUserId) => {
    const convId = String(msg.conversation_id);
    const isMsgMine = msg.sender_id === currentUserId;

    console.log(`[CLIENT:RECEIVE_MESSAGE] Processing received message ID ${msg.id} for conversation ${convId}. Active conversation is ${activeConversationId}`);

    set((state) => {
      const existingConversation = state.conversations.find(
        (c) => String(c.id) === convId
      );

      if (!existingConversation) {
        return state;
      }

      // Check if conversation is active to decide if it is unread
      const isActive = activeConversationId === convId;
      const isUnread = !isActive && !isMsgMine;
      const newUnreadCount = isUnread ? (existingConversation.unreadCount || 0) + 1 : 0;

      const updatedConversation: ChatThread = {
        ...existingConversation,
        lastMessage: msg.message || '[Hình ảnh]',
        time: msg.created_at,
        rawTime: msg.created_at,
        updated_at: msg.created_at,
        unreadCount: newUnreadCount,
        lastSeenMessageId: isActive ? msg.id : existingConversation.lastSeenMessageId,
        lastMessageId: msg.id,
        lastMessageSenderId: msg.sender_id,
      };

      // STEP 2: REMOVE OLD CONVERSATION FROM ARRAY
      const remaining = state.conversations.filter(
        (c) => String(c.id) !== convId
      );

      // STEP 2: PUT UPDATED CONVERSATION ON TOP
      const newArray = [updatedConversation, ...remaining];

      // STEP 7: DEBUG VERIFY LOGGING
      console.log("TOP_CONVERSATION", updatedConversation.id, updatedConversation.updated_at);
      console.log("ORDER", newArray.map((c) => c.id));

      return { conversations: newArray };
    });
  },

  markAsSeen: (conversationId, messageId) => {
    const convId = String(conversationId);
    const existing = get().conversations.find((c) => String(c.id) === convId);
    
    // Ngăn chặn vòng lặp cập nhật State nếu đã được xem và số tin nhắn chưa đọc đã là 0
    if (existing && existing.unreadCount === 0 && existing.lastSeenMessageId === messageId) {
      return;
    }

    console.log(`[CLIENT:CONVERSATION_SEEN] Marking conversation ${convId} seen at msg ${messageId}. Optimistic clearing of unread count.`);

    set((state) => {
      const newConvs = state.conversations.map((c) => {
        if (String(c.id) !== convId) return c;
        return {
          ...c,
          unreadCount: 0,
          lastSeenMessageId: messageId,
        };
      });
      return { conversations: newConvs };
    });
  },

  updateOnlineUsers: (onlineUserIds) => {
    set((state) => {
      const newConvs = state.conversations.map((c) => {
        if (c.type === 'direct' && c.otherUser) {
          const shouldBeOnline = onlineUserIds.includes(c.otherUser.user_id);
          if (c.online !== shouldBeOnline) {
            return { ...c, online: shouldBeOnline };
          }
        }
        return c;
      });
      return { conversations: newConvs };
    });
  },

  updateGroupName: (conversationId, newName) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.map((c) =>
        String(c.id) === convId ? { ...c, name: newName } : c
      ),
    }));
  },

  addMemberToGroup: (conversationId, member) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (String(c.id) !== convId) return c;
        const currentMembers = c.members || [];
        const exists = currentMembers.some(
          (m) => m.user_id === member.user_id || m.id === member.user_id || m.user_id === member.id || (member.id && m.id === member.id)
        );
        if (exists) return c;
        return {
          ...c,
          members: [...currentMembers, member],
        };
      }),
    }));
  },

  removeMemberFromGroup: (conversationId, userId) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (String(c.id) !== convId) return c;
        const currentMembers = c.members || [];
        return {
          ...c,
          members: currentMembers.filter(
            (m) => m.user_id !== userId && m.id !== userId
          ),
        };
      }),
    }));
  },

  transferCreator: (conversationId, newCreatorId) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.map((c) =>
        String(c.id) === convId ? { ...c, createdBy: String(newCreatorId) } : c
      ),
    }));
  },

  removeConversation: (conversationId) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.filter((c) => String(c.id) !== convId),
    }));
  },

  replaceConversation: (updatedConversation) => {
    const convId = String(updatedConversation.id);
    set((state) => ({
      conversations: state.conversations.map((c) =>
        String(c.id) === convId ? updatedConversation : c
      ),
    }));
  },
}));
