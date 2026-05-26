import React from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Message {
  id: number;
  conversation_id: number;
  sender_id: number;
  sender_name: string;
  sender_avatar: string | null;
  message: string;
  type: 'text' | 'image' | 'file';
  file_url: string | null;
  created_at: string;
}

interface MessageItemProps {
  item: Message;
  isMine: boolean;
  colors: any;
  onPressImage?: (url: string) => void;
}

const MessageItemComponent: React.FC<MessageItemProps> = ({ item, isMine, colors, onPressImage }) => {
  return (
    <View style={[styles.messageRow, isMine ? styles.myMessageRow : styles.otherMessageRow]}>
      {!isMine && item.sender_avatar && (
        <Image source={{ uri: item.sender_avatar }} style={styles.messageAvatar} />
      )}
      <View style={styles.messageContentWrapper}>
        {!isMine && (
          <Text style={styles.messageSenderName}>{item.sender_name}</Text>
        )}
        <View
          style={[
            styles.messageBubble,
            isMine
              ? { backgroundColor: colors.tint }
              : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
          ]}
        >
          {item.type === 'image' && item.file_url ? (
            <TouchableOpacity onPress={() => onPressImage && onPressImage(item.file_url!)} activeOpacity={0.9}>
              <Image source={{ uri: item.file_url }} style={styles.chatImage} resizeMode="cover" />
              {item.message && item.message !== '[Ảnh chụp màn hình]' && item.message !== '[Hình ảnh]' && item.message !== '[Video]' && (
                <Text style={[styles.imageCaption, { color: isMine ? '#fff' : colors.text }]}>
                  {item.message}
                </Text>
              )}
            </TouchableOpacity>
          ) : item.type === 'file' && item.file_url ? (
            <View style={styles.videoAttachmentCard}>
              <Ionicons name="play-circle-outline" size={32} color={isMine ? '#fff' : colors.tint} />
              <View style={{ marginLeft: 8 }}>
                <Text style={[styles.videoAttachmentText, { color: isMine ? '#fff' : colors.text }]}>
                  Tệp Đính Kèm Video
                </Text>
                <Text style={[styles.videoAttachmentSub, { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
                  Nhấn để phát video clip
                </Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.messageText, { color: isMine ? '#fff' : colors.text }]}>
              {item.message}
            </Text>
          )}
        </View>
        <View style={styles.messageMeta}>
          <Text style={styles.messageTime}>{item.created_at}</Text>
          {isMine && (
            <Ionicons name="checkmark-done" size={14} color={colors.tint} style={{ marginLeft: 4 }} />
          )}
        </View>
      </View>
    </View>
  );
};

// Hàm so sánh tuỳ chỉnh để chặn hoàn toàn re-render thừa
// Chỉ render lại khi id thay đổi hoặc nội dung tin nhắn thay đổi (rất hiếm trong chat)
export const MessageItem = React.memo(MessageItemComponent, (prevProps, nextProps) => {
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.message === nextProps.item.message &&
    prevProps.isMine === nextProps.isMine &&
    prevProps.colors.tint === nextProps.colors.tint
  );
});

const styles = StyleSheet.create({
  messageRow: {
    flexDirection: 'row',
    maxWidth: '80%',
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
  chatImage: {
    width: 200,
    height: 150,
    borderRadius: 12,
  },
  imageCaption: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 8,
    paddingHorizontal: 4,
    fontWeight: '500',
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
  }
});
