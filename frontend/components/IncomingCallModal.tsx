// frontend/components/IncomingCallModal.tsx
import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Text, Image, TouchableOpacity, Modal, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CallUserInfo, CallType } from '../store/useCallStore';

interface IncomingCallModalProps {
  visible: boolean;
  callerInfo: CallUserInfo | null;
  callType: CallType | null;
  onAccept: () => void;
  onReject: () => void;
}

export const IncomingCallModal: React.FC<IncomingCallModalProps> = ({
  visible,
  callerInfo,
  callType,
  onAccept,
  onReject,
}) => {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      // Loop pulse animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [visible]);

  if (!visible || !callerInfo) return null;

  return (
    <Modal visible={visible} transparent={true} animationType="fade">
      <View style={styles.overlay}>
        {/* Ambient background blur simulation */}
        <View style={styles.blurBg} />

        <View style={styles.content}>
          <Text style={styles.subTitle}>
            CUỘC GỌI {callType === 'video' ? 'VIDEO' : 'THOẠI'} ĐẾN
          </Text>

          {/* Pulse Avatar Animation */}
          <View style={styles.avatarWrapper}>
            <Animated.View
              style={[
                styles.pulseCircle,
                {
                  transform: [{ scale: pulseAnim }],
                  opacity: pulseAnim.interpolate({
                    inputRange: [1, 1.25],
                    outputRange: [0.4, 0],
                  }),
                },
              ]}
            />
            <Image
              source={{
                uri: callerInfo.avatar || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80',
              }}
              style={styles.avatar}
            />
          </View>

          <Text style={styles.callerName}>{callerInfo.name}</Text>
          <Text style={styles.statusText}>Đang đổ chuông...</Text>

          {/* Action Buttons */}
          <View style={styles.buttonRow}>
            {/* Nút từ chối */}
            <TouchableOpacity style={[styles.actionBtn, styles.declineBtn]} onPress={onReject}>
              <Ionicons name="call" size={26} color="#fff" style={styles.declineIcon} />
            </TouchableOpacity>

            <View style={styles.spacing} />

            {/* Nút nghe máy */}
            <TouchableOpacity style={[styles.actionBtn, styles.acceptBtn]} onPress={onAccept}>
              <Ionicons name="call" size={26} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: '#090d16',
    justifyContent: 'center',
    alignItems: 'center',
  },
  blurBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#090d16',
    opacity: 0.95,
  },
  content: {
    alignItems: 'center',
    width: '100%',
  },
  subTitle: {
    color: '#3b82f6',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
    marginBottom: 40,
  },
  avatarWrapper: {
    width: 140,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 30,
  },
  pulseCircle: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: '#3b82f6',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#3b82f6',
  },
  callerName: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    marginBottom: 8,
  },
  statusText: {
    color: '#64748b',
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 80,
  },
  buttonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingHorizontal: 40,
  },
  actionBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 10,
    elevation: 5,
  },
  declineBtn: {
    backgroundColor: '#ef4444',
  },
  declineIcon: {
    transform: [{ rotate: '135deg' }],
  },
  acceptBtn: {
    backgroundColor: '#10b981',
  },
  spacing: {
    width: 60,
  },
});
