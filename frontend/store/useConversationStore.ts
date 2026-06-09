// frontend/store/useConversationStore.ts
import { create } from 'zustand';

export interface GroupMember {
  user_id: number;
  id?: number;
  name: string;
  avatar?: string;
  role?: string;
  email?: string;
  last_seen_message_id?: number | null;
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
  
  // Track active conversation ID globally
  activeConversationId: string | null;
  setActiveConversationId: (id: string | null) => void;
  
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

  // Real-time member read receipt logic
  updateMemberLastSeen: (conversationId: string, userId: number, messageId: number) => void;

  // New Group actions
  updateGroupName: (conversationId: string, newName: string) => void;
  addMemberToGroup: (conversationId: string, member: GroupMember) => void;
  removeMemberFromGroup: (conversationId: string, userId: number) => void;
  transferCreator: (conversationId: string, newCreatorId: string | number) => void;
  updateConversationAvatar: (conversationId: string, avatarUrl: string) => void;
  removeConversation: (conversationId: string) => void;
  replaceConversation: (updatedConversation: ChatThread) => void;
  updateLastMessage: (conversationId: string, messageId: number, newMessageText: string) => void;
  recallLastMessage: (conversationId: string, messageId: number) => void;
  deleteLastMessage: (conversationId: string, messageId: number) => void;
  deleteConversation: (conversationId: string) => void;
  restoreConversation: (conversation: ChatThread) => void;
}

export const useConversationStore = create<ConversationStore>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  setActiveConversationId: (id) => set({ activeConversationId: id }),

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
        members: existingConversation.members?.map((m) => {
          const mId = m.user_id || m.id;
          if (mId === msg.sender_id || (isActive && mId === currentUserId)) {
            return { ...m, last_seen_message_id: msg.id };
          }
          return m;
        }) || [],
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

  updateMemberLastSeen: (conversationId, userId, messageId) => {
    const convId = String(conversationId);
    console.log(`[CLIENT:STORE_UPDATE_MEMBER_SEEN] Updating member ${userId} last seen to ${messageId} in conv ${convId}`);
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (String(c.id) !== convId) return c;
        const currentMembers = c.members || [];
        
        // Cập nhật last_seen_message_id cho member tương ứng
        const updatedMembers = currentMembers.map((m) => {
          const mId = m.user_id || m.id;
          if (mId === userId) {
            return { ...m, last_seen_message_id: messageId };
          }
          return m;
        });

        // Nếu là direct chat và người kia đọc, ta có thể cập nhật lastSeenMessageId của thread nếu người kia là otherUser
        let updatedThread = { ...c, members: updatedMembers };
        if (c.type === 'direct' && c.otherUser && c.otherUser.user_id === userId) {
          updatedThread.lastSeenMessageId = messageId;
        }

        return updatedThread;
      }),
    }));
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
  updateConversationAvatar: (conversationId, avatarUrl) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.map((c) =>
        String(c.id) === convId ? { ...c, avatar: avatarUrl } : c
      ),
    }));
  },

  removeConversation: (conversationId) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.filter((c) => String(c.id) !== convId),
    }));
  },

  deleteConversation: (conversationId) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.filter((c) => String(c.id) !== convId),
    }));
  },

  restoreConversation: (conversation) => {
    const convId = String(conversation.id);
    set((state) => {
      const exists = state.conversations.some((c) => String(c.id) === convId);
      if (exists) return state;

      const newConversations = [conversation, ...state.conversations];
      const sorted = [...newConversations].sort((a, b) => {
        const timeA = new Date(a.rawTime || a.updated_at || 0).getTime();
        const timeB = new Date(b.rawTime || b.updated_at || 0).getTime();
        return timeB - timeA;
      });
      return { conversations: sorted };
    });
  },

  replaceConversation: (updatedConversation) => {
    const convId = String(updatedConversation.id);
    set((state) => ({
      conversations: state.conversations.map((c) =>
        String(c.id) === convId ? updatedConversation : c
      ),
    }));
  },

  updateLastMessage: (conversationId, messageId, newMessageText) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (String(c.id) !== convId) return c;
        if (c.lastMessageId === messageId) {
          return { ...c, lastMessage: newMessageText };
        }
        return c;
      }),
    }));
  },

  recallLastMessage: (conversationId, messageId) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (String(c.id) !== convId) return c;
        if (c.lastMessageId === messageId) {
          return { ...c, lastMessage: "Tin nhắn đã được thu hồi" };
        }
        return c;
      }),
    }));
  },

  deleteLastMessage: (conversationId, messageId) => {
    const convId = String(conversationId);
    set((state) => ({
      conversations: state.conversations.map((c) => {
        if (String(c.id) !== convId) return c;
        if (c.lastMessageId === messageId) {
          return { ...c, lastMessage: "Tin nhắn đã bị xóa" };
        }
        return c;
      }),
    }));
  },
}));
