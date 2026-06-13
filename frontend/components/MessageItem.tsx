// frontend/components/MessageItem.tsx
import React from 'react';
import { StyleSheet, Text, View, Image, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Video, ResizeMode } from 'expo-av';
import VoiceMessage from './VoiceMessage';
import { formatMessageTime } from '../utils/dateTime';
import { isVideoFile } from '../store/useImageViewerStore';

export interface Message {
  id: number | string; // support string client-side optimistic IDs
  conversation_id: number;
  sender_id: number;
  sender_name: string;
  sender_avatar: string | null;
  message: string;
  type: 'text' | 'image' | 'file' | 'call' | 'task' | 'system' | 'voice';
  file_url: string | null;
  attachment_url?: string | null;
  attachment_duration?: number | null;
  attachment_mime_type?: string | null;
  original_attachment_url?: string | null;
  processing_status?: 'pending' | 'processing' | 'completed' | 'failed' | null;
  file_deleted_at?: string | null;
  file_deleted_reason?: string | null;
  created_at: string;
  raw_time?: string;
  reply_to?: number | null;
  reply_to_message?: {
    id: number;
    sender_name: string;
    message: string;
    type: 'text' | 'image' | 'file' | 'call' | 'task' | 'system' | 'voice';
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
  task_id?: number | null;
  task?: {
    id: number;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    deadline: string | null;
    completed: boolean;
    assignees?: Array<{
      user_id: number;
      name: string;
      avatar: string | null;
      status: string;
      started_at?: string | null;
      completed_at?: string | null;
    }>;
  } | null;
  status?: 'pending' | 'uploading' | 'sent' | 'failed';
  uploadProgress?: number;
  client_message_id?: string;
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
  readBy?: Array<{
    user_id: number;
    name: string;
    avatar?: string | null;
  }>;
  currentUserId?: number;
  onUpdateTaskStatus?: (taskId: number, status: string) => void;
  onResendVoice?: (clientMessageId: string) => void;
  onDeleteVoice?: (clientMessageId: string) => void;
}

const breakLongWords = (str: string): string => {
  if (!str) return str;
  return str.replace(/[^\s]{25,}/g, (match) => {
    let result = '';
    for (let i = 0; i < match.length; i += 20) {
      result += match.slice(i, i + 20) + '\u200B';
    }
    return result;
  });
};

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
        return breakLongWords(part);
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
  onRecallPress,
  readBy,
  currentUserId,
  onUpdateTaskStatus,
  onResendVoice,
  onDeleteVoice
}) => {
  if (item.type === 'system') {
    return (
      <View style={styles.systemMessageWrapper}>
        <View style={[styles.systemMessageContainer, { backgroundColor: colors.border + '35' }]}>
          <Text style={[styles.systemMessageText, { color: colors.textSecondary }]}>
            {item.message}
          </Text>
        </View>
      </View>
    );
  }

  const isMentioned = !!(!isMine && item.message && item.message.includes(`@${currentUserName}`));
  const [isHovered, setIsHovered] = React.useState(false);
  const usesInnerFooter = !item.deleted && !item.deleted_for_me && !item.recalled && item.type !== 'image' && item.type !== 'task' && item.type !== 'voice';

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

      <View style={[
        styles.messageContentWrapper,
        isMine ? styles.myMessageContentWrapper : styles.otherMessageContentWrapper
      ]}>
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
        {!usesInnerFooter && item.reply_to_message && (
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
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {item.reply_to_message.recalled 
                ? "Tin nhắn đã được thu hồi" 
                : item.reply_to_message.type === 'image' 
                  ? "📷 [Hình ảnh]" 
                  : item.reply_to_message.type === 'file' 
                    ? "📁 [Video]" 
                    : breakLongWords(item.reply_to_message.message)}
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
        ) : item.file_deleted_at ? (
          /* File auto-deleted fallback */
          <View
            style={[
              styles.messageBubble,
              { minWidth: 130 },
              isMine
                ? { backgroundColor: colors.tint, opacity: 0.8 }
                : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
            ]}
          >
            <Text style={{ color: isMine ? '#fff' : colors.textSecondary, fontStyle: 'italic', fontSize: 13, marginBottom: 4 }}>
              📁 File đã được hệ thống tự động xóa sau thời gian lưu trữ.
            </Text>
            <View style={styles.bubbleFooter}>
              <Text style={[styles.messageTimeInside, { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
                {formatMessageTime(item.created_at)}
              </Text>
              {isMine && (
                <View style={styles.statusContainer}>
                  <Ionicons name="checkmark-done" size={13} color={isMine ? 'rgba(255,255,255,0.9)' : colors.tint} />
                  <Text style={[styles.statusText, { color: isMine ? 'rgba(255,255,255,0.9)' : colors.textSecondary }]}>Đã gửi</Text>
                </View>
              )}
            </View>
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
            {item.message && item.message !== '[Ảnh chụp màn hình]' && item.message !== '[Ảnh từ clipboard]' && item.message !== '[Hình ảnh]' && item.message !== '[Video]' && (
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
        ) : item.type === 'file' && item.file_url && isVideoFile(item.file_url) ? (
          /* Video bubble */
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
            {Platform.OS === 'web' ? (
              <video
                src={item.file_url}
                style={styles.chatVideo as any}
                controls={false}
                muted
                preload="metadata"
              />
            ) : (
              <Video
                source={{ uri: item.file_url }}
                style={styles.chatVideo}
                resizeMode={ResizeMode.COVER}
                shouldPlay={false}
                isMuted={true}
              />
            )}
            <View style={styles.playIconOverlay}>
              <Ionicons name="play" size={32} color="#ffffff" />
            </View>
            {item.message && item.message !== '[Ảnh chụp màn hình]' && item.message !== '[Ảnh từ clipboard]' && item.message !== '[Hình ảnh]' && item.message !== '[Video]' && (
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
        ) : item.type === 'task' && item.task ? (
          /* Task Message Card */
          <TouchableOpacity
            activeOpacity={0.9}
            onLongPress={(event) => onLongPress && onLongPress(item, event)}
            style={[
              styles.taskCard,
              { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
              isHighlighted && { borderColor: '#f59e0b', borderWidth: 2 }
            ]}
          >
            {/* Header: Title & Priority */}
            <View style={styles.taskCardHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Ionicons name="clipboard-outline" size={18} color={colors.tint} />
                <Text style={[styles.taskCardTitle, { color: colors.text }]} numberOfLines={2}>
                  {item.task.title}
                </Text>
              </View>
              <View 
                style={[
                  styles.priorityBadge, 
                  item.task.priority === 'high' 
                    ? { backgroundColor: 'rgba(239, 68, 68, 0.12)' } 
                    : item.task.priority === 'medium' 
                      ? { backgroundColor: 'rgba(245, 158, 11, 0.12)' } 
                      : { backgroundColor: 'rgba(16, 185, 129, 0.12)' }
                ]}
              >
                <Text 
                  style={{ 
                    fontSize: 10.5, 
                    fontWeight: '700',
                    color: item.task.priority === 'high' 
                      ? '#ef4444' 
                      : item.task.priority === 'medium' 
                        ? '#d97706' 
                        : '#10b981' 
                  }}
                >
                  {item.task.priority === 'high' ? 'Cao' : item.task.priority === 'medium' ? 'Trung bình' : 'Thấp'}
                </Text>
              </View>
            </View>

            {/* Description */}
            {item.task.description && (
              <Text style={[styles.taskCardDesc, { color: colors.textSecondary }]}>
                {item.task.description}
              </Text>
            )}

            {/* Deadline */}
            {item.task.deadline && (
              <View style={styles.taskCardMetaRow}>
                <Ionicons name="calendar-outline" size={14} color={colors.textSecondary} />
                <Text style={[styles.taskCardMetaText, { color: colors.textSecondary }]}>
                  Hạn chót: {new Date(item.task.deadline).toLocaleDateString('vi-VN')}
                </Text>
              </View>
            )}

            {/* Summary Progress */}
            {(() => {
              const assignees = item.task.assignees || [];
              if (assignees.length === 0) return null;
              const total = assignees.length;
              const completedCount = assignees.filter((a: any) => a.status === 'completed').length;
              return (
                <View style={styles.progressSummaryContainer}>
                  <Text style={[styles.progressSummaryText, { color: colors.text }]}>
                    Tiến độ: {completedCount}/{total} hoàn thành
                  </Text>
                  <View style={[styles.progressBarBg, { backgroundColor: colors.border }]}>
                    <View 
                      style={[
                        styles.progressBarFill, 
                        { 
                          backgroundColor: completedCount === total ? '#10b981' : colors.tint,
                          width: `${(completedCount / total) * 100}%` 
                        }
                      ]} 
                    />
                  </View>
                </View>
              );
            })()}

            {/* Divider */}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />

            {/* Assignees List Board */}
            <View style={styles.assigneesBoard}>
              {item.task.assignees && item.task.assignees.map((assignee: any) => {
                const isCompleted = assignee.status === 'completed';
                const isInProgress = assignee.status === 'in_progress';
                return (
                  <View key={assignee.user_id} style={styles.assigneeRow}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      {assignee.avatar ? (
                        <Image source={{ uri: assignee.avatar }} style={styles.assigneeAvatar} />
                      ) : (
                        <View style={[styles.assigneeAvatarFallback, { backgroundColor: colors.border }]}>
                          <Text style={{ fontSize: 9, color: colors.text, fontWeight: '700' }}>
                            {assignee.name ? assignee.name.charAt(0).toUpperCase() : '?'}
                          </Text>
                        </View>
                      )}
                      <Text style={[styles.assigneeNameText, { color: colors.text }]} numberOfLines={1}>
                        {assignee.name} {assignee.user_id === currentUserId ? '(Tôi)' : ''}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Text 
                        style={{ 
                          fontSize: 12, 
                          color: isCompleted ? '#10b981' : isInProgress ? '#3b82f6' : '#6b7280',
                          fontWeight: '600'
                        }}
                      >
                        {isCompleted ? 'Hoàn thành' : isInProgress ? 'Đang làm' : 'Chưa bắt đầu'}
                      </Text>
                      <Text style={{ fontSize: 13 }}>
                        {isCompleted ? '✅' : isInProgress ? '🔄' : '⏳'}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>

            {/* Quick Action Button for current user */}
            {(() => {
              const assignees = item.task.assignees || [];
              const myAssignment = assignees.find((a: any) => a.user_id === currentUserId);
              if (!myAssignment) return null;

              let buttonText = 'Bắt đầu làm';
              let buttonColor = colors.tint;
              let nextStatus = 'in_progress';
              let iconName = 'play-circle-outline';

              if (myAssignment.status === 'in_progress') {
                buttonText = 'Hoàn thành';
                buttonColor = '#10b981';
                nextStatus = 'completed';
                iconName = 'checkmark-circle-outline';
              } else if (myAssignment.status === 'completed') {
                buttonText = 'Làm lại';
                buttonColor = '#6b7280';
                nextStatus = 'todo';
                iconName = 'refresh-outline';
              }

              return (
                <TouchableOpacity
                  style={[styles.taskQuickActionBtn, { backgroundColor: buttonColor }]}
                  onPress={() => onUpdateTaskStatus && onUpdateTaskStatus(item.task!.id, nextStatus)}
                >
                  <Ionicons name={iconName as any} size={15} color="#fff" />
                  <Text style={styles.taskQuickActionBtnText}>{buttonText}</Text>
                </TouchableOpacity>
              );
            })()}
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
              usesInnerFooter && { minWidth: 130 },
              isHighlighted
                ? { backgroundColor: '#fef3c7', borderColor: '#f59e0b', borderWidth: 2 }
                : isMine
                  ? { backgroundColor: colors.tint }
                  : isMentioned
                    ? { backgroundColor: '#fef3c7', borderColor: '#f59e0b', borderWidth: 1 }
                    : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 }
            ]}
          >
            {/* Reply Quote Bubble inside message bubble */}
            {usesInnerFooter && item.reply_to_message && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => onPressQuote && onPressQuote(item.reply_to_message!.id)}
                style={styles.quoteBubbleInside}
              >
                <View style={[styles.quoteBorderLineInside, { backgroundColor: colors.tint }]} />
                <View style={styles.quoteContentInside}>
                  <Text style={[styles.quoteSenderNameInside, { color: colors.tint }]} numberOfLines={1}>
                    {item.reply_to_message.sender_name}
                  </Text>
                  <Text 
                    style={styles.quoteTextInside}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {item.reply_to_message.recalled 
                      ? "Tin nhắn đã được thu hồi" 
                      : item.reply_to_message.type === 'image' 
                        ? "📷 [Hình ảnh]" 
                        : item.reply_to_message.type === 'file' 
                          ? "📁 [Video]" 
                          : breakLongWords(item.reply_to_message.message)}
                  </Text>
                </View>
              </TouchableOpacity>
            )}

            <View style={styles.messageContentBody}>
              {item.type === 'call' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 160, paddingVertical: 2 }}>
                  <Ionicons
                    name={item.message.includes('video') ? 'videocam' : 'call'}
                    size={20}
                    color={isMine ? '#fff' : colors.tint}
                    style={{ marginRight: 10 }}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 13, fontWeight: '700', color: isMine ? '#fff' : colors.text }}>
                      {item.message}
                    </Text>
                    <Text style={{ fontSize: 10, color: isMine ? 'rgba(255, 255, 255, 0.75)' : colors.textSecondary, marginTop: 2 }}>
                      Lịch sử cuộc gọi
                    </Text>
                  </View>
                </View>
              ) : item.type === 'voice' && item.attachment_url ? (
                (() => {
                  console.log('[VOICE_RENDER]', {
                    id: item.id,
                    client_message_id: item.client_message_id,
                    conversation_id: item.conversation_id,
                    attachment_url: item.attachment_url,
                    status: item.status,
                    pending: item.status === 'pending' || item.status === 'uploading',
                    created_at: item.created_at
                  });
                  return (
                    <VoiceMessage
                      messageId={item.id}
                      attachmentUrl={item.attachment_url}
                      attachmentMimeType={item.attachment_mime_type}
                      duration={item.attachment_duration || 0}
                      currentUserId={currentUserId}
                      isMine={isMine}
                      colors={colors}
                    />
                  );
                })()
              ) : item.type === 'file' && item.file_url ? (
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => onPressImage && onPressImage(item.file_url!)}
                  style={styles.videoAttachmentCard}
                >
                  <Ionicons name="play-circle-outline" size={32} color={(isMine && !isHighlighted) ? '#fff' : colors.tint} />
                  <View style={{ marginLeft: 8 }}>
                    <Text style={[styles.videoAttachmentText, { color: (isMine && !isHighlighted) ? '#fff' : colors.text }]}>
                      Tệp Đính Kèm Video
                    </Text>
                    <Text style={[styles.videoAttachmentSub, { color: (isMine && !isHighlighted) ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
                      Nhấn để phát video clip
                    </Text>
                  </View>
                </TouchableOpacity>
              ) : (
                renderMessageText(item.message, isMine, colors, isMentioned, isHighlighted)
              )}
            </View>

            {/* Footer inside the bubble */}
            {usesInnerFooter && (
              <View style={styles.bubbleFooter}>
                <Text style={[styles.messageTimeInside, { color: isMine ? 'rgba(255,255,255,0.7)' : colors.textSecondary }]}>
                  {formatMessageTime(item.created_at)}
                  {item.edited && !item.recalled && <Text style={styles.editedTextInside}> (đã sửa)</Text>}
                </Text>
                {isMine && (
                  <View style={styles.statusContainer}>
                    <Ionicons 
                      name={item.status === 'pending' || item.status === 'uploading' ? "time-outline" : (readBy && readBy.length > 0 ? "checkmark-done" : "checkmark")} 
                      size={13} 
                      color={isMine ? 'rgba(255,255,255,0.9)' : colors.tint} 
                    />
                    <Text style={[styles.statusText, { color: isMine ? 'rgba(255,255,255,0.9)' : colors.textSecondary }]}>
                      {item.status === 'pending' || item.status === 'uploading' ? 'Đang gửi' : (readBy && readBy.length > 0 ? 'Đã xem' : 'Đã gửi')}
                    </Text>
                  </View>
                )}
              </View>
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

        {!usesInnerFooter && (
          <View style={styles.messageMeta}>
            {item.type === 'voice' && item.status && item.status !== 'sent' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {item.status === 'uploading' && (
                  <Text style={[styles.messageTime, { color: colors.textSecondary }]}>
                    ⏳ Đang tải lên... {item.uploadProgress || 0}%
                  </Text>
                )}
                {item.status === 'pending' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[styles.messageTime, { color: '#f59e0b' }]}>
                      ⏳ Đang chờ gửi
                    </Text>
                    {onResendVoice && item.client_message_id && (
                      <TouchableOpacity onPress={() => onResendVoice(item.client_message_id!)}>
                        <Text style={{ fontSize: 10, color: colors.tint, fontWeight: '700' }}>Gửi lại</Text>
                      </TouchableOpacity>
                    )}
                    {onDeleteVoice && item.client_message_id && (
                      <TouchableOpacity onPress={() => onDeleteVoice(item.client_message_id!)}>
                        <Text style={{ fontSize: 10, color: '#ef4444', fontWeight: '700', marginLeft: 4 }}>Xóa</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
                {item.status === 'failed' && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Text style={[styles.messageTime, { color: '#ef4444' }]}>
                      ❌ Lỗi tải lên
                    </Text>
                    {onResendVoice && item.client_message_id && (
                      <TouchableOpacity onPress={() => onResendVoice(item.client_message_id!)}>
                        <Text style={{ fontSize: 10, color: colors.tint, fontWeight: '700' }}>Thử lại</Text>
                      </TouchableOpacity>
                    )}
                    {onDeleteVoice && item.client_message_id && (
                      <TouchableOpacity onPress={() => onDeleteVoice(item.client_message_id!)}>
                        <Text style={{ fontSize: 10, color: '#ef4444', fontWeight: '700', marginLeft: 4 }}>Xóa</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )}
              </View>
            ) : (
              <>
                <Text style={styles.messageTime}>
                  {formatMessageTime(item.created_at)}
                  {item.edited && !item.recalled && <Text style={styles.editedText}> (đã chỉnh sửa)</Text>}
                </Text>
                {isMine && !item.status && (
                  <Ionicons name="checkmark-done" size={14} color={colors.tint} style={{ marginLeft: 4 }} />
                )}
              </>
            )}
          </View>
        )}

        {/* Danh sách người đã đọc (Read receipts) */}
        {readBy && readBy.length > 0 && (
          <View style={[styles.readReceiptsContainer, isMine ? styles.myReadReceipts : styles.otherReadReceipts]}>
            <Ionicons name="checkmark-done" size={11} color={colors.textSecondary || '#727785'} style={{ marginRight: 4 }} />
            <Text style={[styles.readReceiptText, { color: colors.textSecondary || '#727785' }]}>
              {readBy.map(m => m.name).join(', ')} đã xem
            </Text>
          </View>
        )}
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

export const MessageItem = React.memo(MessageItemComponent, (prevProps, nextProps) => {
  // Memoize strictly to block unnecessary redraws
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.message === nextProps.item.message &&
    prevProps.item.status === nextProps.item.status &&
    prevProps.item.uploadProgress === nextProps.item.uploadProgress &&
    prevProps.item.edited === nextProps.item.edited &&
    prevProps.item.recalled === nextProps.item.recalled &&
    prevProps.item.deleted === nextProps.item.deleted &&
    prevProps.item.deleted_for_me === nextProps.item.deleted_for_me &&
    prevProps.item.forwarded === nextProps.item.forwarded &&
    prevProps.isHighlighted === nextProps.isHighlighted &&
    JSON.stringify(prevProps.item.reactions) === JSON.stringify(nextProps.item.reactions) &&
    prevProps.isMine === nextProps.isMine &&
    prevProps.colors.tint === nextProps.colors.tint &&
    prevProps.currentUserName === nextProps.currentUserName &&
    JSON.stringify(prevProps.readBy) === JSON.stringify(nextProps.readBy)
  );
});

const styles = StyleSheet.create({
  readReceiptsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    flexWrap: 'wrap',
    maxWidth: '100%',
  },
  myReadReceipts: {
    justifyContent: 'flex-end',
  },
  otherReadReceipts: {
    justifyContent: 'flex-start',
    marginLeft: 4,
  },
  readReceiptText: {
    fontSize: 11,
    fontWeight: '500',
    flexShrink: 1,
  },
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
    flexShrink: 1,
  },
  myMessageContentWrapper: {
    alignItems: 'flex-end',
  },
  otherMessageContentWrapper: {
    alignItems: 'flex-start',
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
    maxWidth: Platform.OS === 'web' ? 500 : '75%',
    minWidth: 60,
    flexShrink: 1,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    flexShrink: 1,
    flexWrap: 'wrap',
    ...(Platform.OS === 'web' ? { wordBreak: 'break-word' } as any : {}),
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
  chatVideo: {
    width: 240,
    height: 180,
    borderRadius: 16,
    backgroundColor: '#000000',
  },
  playIconOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 240,
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
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
    maxWidth: Platform.OS === 'web' ? 500 : '100%',
    width: '100%',
    overflow: 'hidden',
  },
  quoteSenderName: {
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 2,
  },
  quoteText: {
    fontSize: 12,
    flexShrink: 1,
    flexWrap: 'wrap',
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
  },
  systemMessageWrapper: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  systemMessageContainer: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    maxWidth: '85%',
  },
  systemMessageText: {
    fontSize: 12,
    textAlign: 'center',
    fontWeight: '600',
    lineHeight: 16,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  taskCard: {
    padding: 12,
    borderRadius: 12,
    marginBottom: 4,
    width: 280,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  taskCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  taskCardTitle: {
    fontSize: 14.5,
    fontWeight: '700',
  },
  priorityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
  },
  priorityText: {
    fontSize: 10,
    fontWeight: '700',
  },
  taskCardDesc: {
    fontSize: 12.5,
    marginBottom: 8,
    lineHeight: 16,
  },
  taskCardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  taskCardMetaText: {
    fontSize: 12,
  },
  progressSummaryContainer: {
    marginBottom: 10,
  },
  progressSummaryText: {
    fontSize: 12.5,
    fontWeight: '700',
    marginBottom: 4,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    width: '100%',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  divider: {
    height: 1,
    width: '100%',
    marginBottom: 8,
  },
  assigneesBoard: {
    gap: 6,
    marginBottom: 10,
  },
  assigneeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  assigneeAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  assigneeAvatarFallback: {
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  assigneeNameText: {
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  taskQuickActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
    marginTop: 4,
  },
  taskQuickActionBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  quoteBubbleInside: {
    flexDirection: 'row',
    backgroundColor: '#EAF3FF',
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 8,
    width: '100%',
  },
  quoteBorderLineInside: {
    width: 4,
  },
  quoteContentInside: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  quoteSenderNameInside: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  quoteTextInside: {
    fontSize: 12,
    color: '#4a5568',
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  messageContentBody: {
    width: '100%',
  },
  bubbleFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    width: '100%',
    gap: 16,
  },
  messageTimeInside: {
    fontSize: 10.5,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  statusText: {
    fontSize: 10.5,
    fontWeight: '600',
  },
  editedTextInside: {
    fontSize: 9.5,
    fontStyle: 'italic',
  },
});
