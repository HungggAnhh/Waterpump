// frontend/components/MessageItem.tsx
import React from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name: string;
  sender_avatar: string | null;
  message: string;
  type: 'text' | 'image' | 'file';
  file_url: string | null;
  created_at: string;
  raw_time?: string;
  reply_to?: number | null;
  reply_to_message?: {
    id: number;
    sender_name: string;
    message: string;
    type: 'text' | 'image' | 'file';
    file_url: string | null;
    recalled?: boolean;
  } | null;
  edited?: boolean;
  edited_at?: string | null;
  recalled?: boolean;
  recalled_by?: number | null;
  recalled_at?: string | null;
  deleted?: boolean;
  deleted_for_me?: boolean;
  forwarded?: boolean;
  reactions?: Array<{
    user_id: number;
    user_name: string;
    reaction: string;
  }>;
}

interface MessageItemProps {
  item: Message;
  isMine: boolean;
  colors: any;
  onPressImage?: (url: string) => void;
  onLongPress?: (message: Message, event?: any) => void;
  onDoubleTap?: (message: Message) => void;
  onPressQuote?: (messageId: number) => void;
  onPressReactions?: (message: Message) => void;
  currentUserName: string;
  isHighlighted?: boolean;
  onRecallPress?: (message: Message) => void;
}

const renderMessageText = (text: string, isMine: boolean, colors: any, isMentioned: boolean, isHighlighted: boolean) => {
  if (!text) return null;
  
  const regex = /(@[A-Za-z0-9_À-ỹ]+(?:\s+[A-Za-z0-9_À-ỹ]+)*)/g;
  const parts = text.split(regex);
  
  return (
    <Text style={[
      styles.messageText, 
      { 
        color: (isMine && !isHighlighted) ? '#fff' : colors.text,
        fontWeight: (isMentioned || isHighlighted) ? '800' : '400'
      }
    ]}>
      {parts.map((part, index) => {
        if (part.startsWith('@')) {
          return (
            <Text 
              key={index} 
              style={{ 
                fontWeight: '900', 
                color: (isMine && !isHighlighted) ? '#ffe4e6' : colors.tint,
                backgroundColor: (isMine && !isHighlighted) ? 'rgba(255,255,255,0.25)' : 'rgba(59, 130, 246, 0.12)',
                borderRadius: 4,
                paddingHorizontal: 2,
              }}
            >
              {part}
            </Text>
          );
        }
        return part;
      })}
    </Text>
  );
};

const MessageItemComponent: React.FC<MessageItemProps> = ({ 
  item, 
  isMine, 
  colors, 
  onPressImage, 
  onLongPress, 
  onDoubleTap, 
  onPressQuote, 
  onPressReactions, 
  currentUserName,
  isHighlighted = false,
  onRecallPress
}) => {
  const isMentioned = !!(!isMine && item.message && item.message.includes(`@${currentUserName}`));
  const [isHovered, setIsHovered] = React.useState(false);

  // Double-tap detector
  const lastTapRef = React.useRef(0);
  const handleTap = () => {
    if (item.recalled) return;
    const now = Date.now();
    const DOUBLE_PRESS_DELAY = 300;
    if (now - lastTapRef.current < DOUBLE_PRESS_DELAY) {
      onDoubleTap && onDoubleTap(item);
    }
    lastTapRef.current = now;
  };

  // Group reactions for counter display
  const reactionSummary = React.useMemo(() => {
    if (!item.reactions || item.reactions.length === 0) return null;
    
    const counts: { [key: string]: number } = {};
    item.reactions.forEach(r => {
      counts[r.reaction] = (counts[r.reaction] || 0) + 1;
    });

    const uniqueIcons = Object.keys(counts);
    const totalCount = item.reactions.length;

    return {
      icons: uniqueIcons.slice(0, 3), // max 3 unique icons shown
      total: totalCount
    };
  }, [item.reactions]);

  return (
    <View 
      style={[styles.messageRow, isMine ? styles.myMessageRow : styles.otherMessageRow, { marginBottom: reactionSummary ? 12 : 2 }]}
      {...(Platform.OS === 'web' ? {
        onMouseEnter: () => setIsHovered(true),
        onMouseLeave: () => setIsHovered(false)
      } : {})}
    >
      {!isMine && item.sender_avatar && (
        <Image source={{ uri: item.sender_avatar }} style={styles.messageAvatar} />
      )}

      {/* 3-dots ellipsis button for hover state on Web/PC Desktop (left side of bubble for own messages) */}
      {isMine && isHovered && Platform.OS === 'web' && (
        <TouchableOpacity
          onPress={(event) => onLongPress && onLongPress(item, event)}
          style={styles.moreButtonLeft}
          activeOpacity={0.7}
        >
          <Ionicons name="ellipsis-vertical" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      )}

      <View style={styles.messageContentWrapper}>
        {/* Sender Name */}
        {!isMine && (
          <Text style={styles.messageSenderName}>{item.sender_name}</Text>
        )}

        {/* Forwarded Tag */}
        {item.forwarded && (
          <View style={styles.forwardedBadge}>
            <Ionicons name="share-social" size={12} color="#727785" />
            <Text style={styles.forwardedText}>Đã chuyển tiếp</Text>
          </View>
        )}

        {/* Reply Quote Bubble */}
        {item.reply_to_message && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => onPressQuote && onPressQuote(item.reply_to_message!.id)}
            style={[
              styles.quoteBubble,
              {
                backgroundColor: isMine ? 'rgba(255, 255, 255, 0.15)' : colors.border,
                borderLeftColor: isMine ? '#fff' : colors.tint,
              }
            ]}
          >
            <Text style={[styles.quoteSenderName, { color: isMine ? '#fff' : colors.tint }]} numberOfLines={1}>
              {item.reply_to_message.sender_name}
            </Text>
            <Text 
              style={[styles.quoteText, { color: isMine ? 'rgba(255, 255, 255, 0.85)' : colors.textSecondary }]}
              numberOfLines={1}
            >
              {item.reply_to_message.recalled 
                ? "Tin nhắn đã được thu hồi" 
                : item.reply_to_message.type === 'image' 
                  ? "📷 [Hình ảnh]" 
                  : item.reply_to_message.type === 'file' 
                    ? "📁 [Video]" 
                    : item.reply_to_message.message}
            </Text>
          </TouchableOpacity>
        )}
        
        {item.deleted || item.deleted_for_me ? (
          /* Deleted message bubble with recall button next to it */
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View
              style={[
                styles.messageBubble,
                { backgroundColor: colors.border, borderColor: colors.border, borderWidth: 1 }
              ]}
            >
              <Text style={{ color: colors.textSecondary, fontStyle: 'italic', fontSize: 13 }}>
                Tin nhắn đã bị xóa
              </Text>
            </View>
            {isMine && !item.recalled && (
              <TouchableOpacity
                onPress={() => onRecallPress && onRecallPress(item)}
                style={{
                  paddingVertical: 4,
                  paddingHorizontal: 8,
                  borderRadius: 12,
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  borderWidth: 1,
                  borderColor: '#ef4444',
                }}
                activeOpacity={0.7}
              >
                <Text style={{ color: '#ef4444', fontSize: 11, fontWeight: '700' }}>Thu hồi</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : item.recalled ? (
          /* Recalled message bubble */
          <View
            style={[
              styles.messageBubble,
              isMine
                ? { backgroundColor: colors.tint, opacity: 0.6 }
                : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
            ]}
          >
            <Text style={[styles.recalledText, { color: isMine ? '#fff' : '#a0aec0' }]}>
              Tin nhắn đã được thu hồi
            </Text>
          </View>
        ) : item.type === 'image' && item.file_url ? (
          /* Image bubble */
          <TouchableOpacity 
            onPress={() => {
              handleTap();
              onPressImage && onPressImage(item.file_url!);
            }} 
            onLongPress={() => onLongPress && onLongPress(item)}
            activeOpacity={0.9}
            style={[
              styles.imageMessageContainer,
              isHighlighted && { borderColor: '#f59e0b', borderWidth: 3 }
            ]}
          >
            <Image source={{ uri: item.file_url }} style={styles.chatImage} resizeMode="cover" />
            {item.message && item.message !== '[Ảnh chụp màn hình]' && item.message !== '[Hình ảnh]' && item.message !== '[Video]' && (
              <View style={[
                styles.messageBubble,
                isHighlighted
                  ? { backgroundColor: '#fef3c7', borderColor: '#f59e0b', borderWidth: 2, marginTop: 6 }
                  : isMine
                    ? { backgroundColor: colors.tint, marginTop: 6 }
                    : isMentioned
                      ? { backgroundColor: '#fef3c7', borderColor: '#f59e0b', borderWidth: 1, marginTop: 6 }
                      : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, marginTop: 6 }
              ]}>
                {renderMessageText(item.message, isMine, colors, isMentioned, isHighlighted)}
              </View>
            )}
          </TouchableOpacity>
        ) : (
          /* Text/File message bubble */
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={handleTap}
            onLongPress={() => onLongPress && onLongPress(item)}
            delayLongPress={400}
            style={[
              styles.messageBubble,
              isHighlighted
                ? { backgroundColor: '#fef3c7', borderColor: '#f59e0b', borderWidth: 2 }
                : isMine
                  ? { backgroundColor: colors.tint }
                  : isMentioned
                    ? { backgroundColor: '#fef3c7', borderColor: '#f59e0b', borderWidth: 1 }
                    : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
            ]}
          >
            {item.type === 'file' && item.file_url ? (
              <View style={styles.videoAttachmentCard}>
                <Ionicons name="play-circle-outline" size={32} color={(isMine && !isHighlighted) ? '#fff' : colors.tint} />
                <View style={{ marginLeft: 8 }}>
                  <Text style={[styles.videoAttachmentText, { color: (isMine && !isHighlighted) ? '#fff' : colors.text }]}>
                    Tệp Đính Kèm Video
                  </Text>
                  <Text style={[styles.videoAttachmentSub, { color: (isMine && !isHighlighted) ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
                    Nhấn để phát video clip
                  </Text>
                </View>
              </View>
            ) : (
              renderMessageText(item.message, isMine, colors, isMentioned, isHighlighted)
            )}
          </TouchableOpacity>
        )}

        {/* Cảm xúc (Reactions count & list) */}
        {reactionSummary && (
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => onPressReactions && onPressReactions(item)}
            style={[
              styles.reactionContainer,
              isMine ? styles.myReactionContainer : styles.otherReactionContainer,
              { backgroundColor: colors.card, borderColor: colors.border }
            ]}
          >
            <View style={styles.reactionIcons}>
              {reactionSummary.icons.map((icon, idx) => (
                <Text key={idx} style={styles.reactionIconText}>{icon}</Text>
              ))}
            </View>
            {reactionSummary.total > 1 && (
              <Text style={[styles.reactionCountText, { color: colors.textSecondary }]}>
                {reactionSummary.total}
              </Text>
            )}
          </TouchableOpacity>
        )}

        <View style={styles.messageMeta}>
          <Text style={styles.messageTime}>
            {formatMessageTime(item.created_at)}
            {item.edited && !item.recalled && <Text style={styles.editedText}> (đã chỉnh sửa)</Text>}
          </Text>
          {isMine && (
            <Ionicons name="checkmark-done" size={14} color={colors.tint} style={{ marginLeft: 4 }} />
          )}
        </View>
      </View>

      {/* 3-dots ellipsis button for hover state on Web/PC Desktop (right side of bubble for other's messages) */}
      {!isMine && isHovered && Platform.OS === 'web' && (
        <TouchableOpacity
          onPress={(event) => onLongPress && onLongPress(item, event)}
          style={styles.moreButtonRight}
          activeOpacity={0.7}
        >
          <Ionicons name="ellipsis-vertical" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
};

const formatMessageTime = (timeInput: string | Date | null | undefined): string => {
  if (!timeInput) return '';
  const date = typeof timeInput === 'string' ? new Date(timeInput) : timeInput;
  if (isNaN(date.getTime())) {
    return String(timeInput);
  }
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
};

export const MessageItem = React.memo(MessageItemComponent, (prevProps, nextProps) => {
  // Memoize strictly to block unnecessary redraws
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.message === nextProps.item.message &&
    prevProps.item.edited === nextProps.item.edited &&
    prevProps.item.recalled === nextProps.item.recalled &&
    prevProps.item.deleted === nextProps.item.deleted &&
    prevProps.item.deleted_for_me === nextProps.item.deleted_for_me &&
    prevProps.item.forwarded === nextProps.item.forwarded &&
    prevProps.isHighlighted === nextProps.isHighlighted &&
    JSON.stringify(prevProps.item.reactions) === JSON.stringify(nextProps.item.reactions) &&
    prevProps.isMine === nextProps.isMine &&
    prevProps.colors.tint === nextProps.colors.tint &&
    prevProps.currentUserName === nextProps.currentUserName
  );
});

const styles = StyleSheet.create({
  messageRow: {
    flexDirection: 'row',
    maxWidth: '85%',
    position: 'relative',
  },
  myMessageRow: {
    alignSelf: 'flex-end',
  },
  otherMessageRow: {
    alignSelf: 'flex-start',
  },
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8,
    alignSelf: 'flex-end',
  },
  messageContentWrapper: {
    gap: 4,
    position: 'relative',
  },
  messageSenderName: {
    fontSize: 10,
    color: '#727785',
    marginLeft: 4,
    fontWeight: '600',
  },
  messageBubble: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
  },
  messageMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: 2,
    paddingRight: 4,
  },
  messageTime: {
    fontSize: 10,
    color: '#a0aec0',
  },
  imageMessageContainer: {
    borderRadius: 16,
    overflow: 'hidden',
  },
  chatImage: {
    width: 240,
    height: 180,
    borderRadius: 16,
  },
  videoAttachmentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 4,
    minWidth: 160,
  },
  videoAttachmentText: {
    fontSize: 13,
    fontWeight: '700',
  },
  videoAttachmentSub: {
    fontSize: 10,
    marginTop: 2,
  },
  quoteBubble: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderLeftWidth: 3,
    borderRadius: 8,
    marginBottom: 4,
    maxWidth: 240,
  },
  quoteSenderName: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  quoteText: {
    fontSize: 12,
  },
  forwardedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 2,
    paddingLeft: 4,
  },
  forwardedText: {
    fontSize: 11,
    color: '#727785',
    fontStyle: 'italic',
  },
  recalledText: {
    fontSize: 13,
    fontStyle: 'italic',
  },
  reactionContainer: {
    position: 'absolute',
    bottom: -6,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    zIndex: 10,
  },
  myReactionContainer: {
    alignSelf: 'flex-end',
  },
  otherReactionContainer: {
    alignSelf: 'flex-start',
  },
  reactionIcons: {
    flexDirection: 'row',
  },
  reactionIconText: {
    fontSize: 12,
    marginHorizontal: 0.5,
  },
  reactionCountText: {
    fontSize: 10,
    marginLeft: 3,
    fontWeight: '600',
  },
  editedText: {
    fontSize: 9,
    fontStyle: 'italic',
    color: '#a0aec0',
  },
  moreButtonLeft: {
    alignSelf: 'center',
    marginRight: 8,
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(160, 174, 192, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  moreButtonRight: {
    alignSelf: 'center',
    marginLeft: 8,
    padding: 6,
    borderRadius: 16,
    backgroundColor: 'rgba(160, 174, 192, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  }
});
