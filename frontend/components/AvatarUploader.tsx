// frontend/components/AvatarUploader.tsx
import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  Text,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { API_BASE_URL } from '@/constants/Config';
import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';
import { useUser } from '../context/UserContext';

interface AvatarUploaderProps {
  targetUserId: number;
  currentAvatarUrl: string | null;
  size?: number;
  onUploadSuccess: (newAvatarUrl: string) => void;
}

export const AvatarUploader: React.FC<AvatarUploaderProps> = ({
  targetUserId,
  currentAvatarUrl,
  size = 80,
  onUploadSuccess,
}) => {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const { token } = useUser();
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);

  const defaultAvatar = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&h=150&q=80';
  const displayAvatar = currentAvatarUrl || defaultAvatar;

  const handlePickAndUploadImage = async () => {
    try {
      // 1. Request library permissions
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert(
          'Quyền truy cập',
          'Bạn cần cấp quyền truy cập thư viện ảnh để thay đổi ảnh đại diện!'
        );
        return;
      }

      // 2. Launch Image Picker with crop (1:1) and compression (quality: 0.5)
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1], // Crop to square (1:1)
        quality: 0.5,   // Compress image size
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        return;
      }

      const pickedAsset = pickerResult.assets[0];

      // 3. Size validation on the client side (5MB limit)
      if (pickedAsset.fileSize && pickedAsset.fileSize > 5 * 1024 * 1024) {
        Alert.alert('Tệp quá lớn', 'Ảnh đại diện tối đa là 5MB. Vui lòng chọn ảnh khác!');
        return;
      }

      setUploading(true);
      setProgress(0);

      // 4. Construct form data
      const formData = new FormData();
      let fileExt = 'jpg';
      if (pickedAsset.mimeType) {
        const mimeParts = pickedAsset.mimeType.split('/');
        if (mimeParts.length > 1) {
          const rawExt = mimeParts[1].toLowerCase();
          if (rawExt === 'jpeg' || rawExt === 'jpg') fileExt = 'jpg';
          else if (rawExt === 'png') fileExt = 'png';
          else if (rawExt === 'webp') fileExt = 'webp';
          else fileExt = rawExt;
        }
      } else if (pickedAsset.fileName) {
        const nameParts = pickedAsset.fileName.split('.');
        if (nameParts.length > 1) {
          fileExt = nameParts.pop()?.toLowerCase() || fileExt;
        }
      }

      const fileName = `avatar_${targetUserId}_${Date.now()}.${fileExt}`;
      const fileType = pickedAsset.mimeType || 'image/jpeg';

      if (Platform.OS === 'web') {
        const response = await fetch(pickedAsset.uri);
        const blob = await response.blob();
        formData.append('file', blob, fileName);
      } else {
        formData.append('file', {
          uri: pickedAsset.uri,
          name: fileName,
          type: fileType,
        } as any);
      }

      // 5. Upload using XMLHttpRequest to get real-time progress indicator
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE_URL}/users/${targetUserId}/avatar`);
      
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      // Track progress
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round((event.loaded / event.total) * 100);
          setProgress(percentComplete);
        }
      };

      xhr.onload = () => {
        setUploading(false);
        try {
          const response = JSON.parse(xhr.responseText || '{}');
          if (xhr.status >= 200 && xhr.status < 300 && response.status === 'success') {
            const uploadedUrl = response.data.avatar;
            onUploadSuccess(uploadedUrl);
            Alert.alert('Thành công', 'Đã cập nhật ảnh đại diện thành công!');
          } else {
            Alert.alert('Lỗi cập nhật', response.message || 'Không thể cập nhật ảnh đại diện.');
          }
        } catch (err) {
          console.error('XHR Response parse error:', xhr.responseText, err);
          Alert.alert('Lỗi phản hồi', 'Máy chủ trả về kết quả không hợp lệ.');
        }
      };

      xhr.onerror = () => {
        setUploading(false);
        Alert.alert('Lỗi kết nối', 'Không thể kết nối đến máy chủ. Vui lòng thử lại!');
      };

      xhr.send(formData);

    } catch (err: any) {
      setUploading(false);
      console.error('Avatar uploader error:', err);
      Alert.alert('Lỗi', 'Đã xảy ra lỗi bất ngờ khi thay đổi avatar.');
    }
  };

  const borderRadius = size / 2;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <View style={[styles.avatarWrapper, { width: size, height: size, borderRadius }]}>
        <TouchableOpacity
          onPress={() => setViewerVisible(true)}
          disabled={uploading}
          activeOpacity={0.8}
        >
          <Image
            source={{ uri: displayAvatar }}
            style={{ width: size, height: size, borderRadius }}
            resizeMode="cover"
          />
        </TouchableOpacity>

        {uploading && (
          <View style={[styles.overlay, { borderRadius, backgroundColor: 'rgba(0,0,0,0.6)' }]} pointerEvents="none">
            <ActivityIndicator size="small" color="#ffffff" />
            <Text style={styles.progressText}>{progress}%</Text>
          </View>
        )}

        {!uploading && (
          <TouchableOpacity
            style={[styles.cameraIconContainer, { backgroundColor: colors.tint }]}
            onPress={handlePickAndUploadImage}
            activeOpacity={0.7}
          >
            <Ionicons name="camera" size={size * 0.18} color="#ffffff" />
          </TouchableOpacity>
        )}
      </View>

      {/* Full Screen Image Viewer Modal */}
      <Modal
        visible={viewerVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setViewerVisible(false)}
      >
        <View style={styles.viewerContainer}>
          {/* Header Row */}
          <View style={styles.viewerHeader}>
            <TouchableOpacity
              style={styles.viewerCloseBtn}
              onPress={() => setViewerVisible(false)}
            >
              <Ionicons name="close" size={26} color="#ffffff" />
            </TouchableOpacity>
            <Text style={styles.viewerTitle}>Ảnh đại diện</Text>
            <View style={{ width: 40 }} />
          </View>

          {/* Main Image View */}
          <View style={styles.viewerImageWrapper}>
            <Image
              source={{ uri: displayAvatar }}
              style={styles.viewerImage}
              resizeMode="contain"
            />
          </View>

          {/* Bottom Edit Action */}
          {!uploading && (
            <TouchableOpacity
              style={[styles.viewerEditBtn, { backgroundColor: colors.tint }]}
              onPress={() => {
                setViewerVisible(false);
                setTimeout(() => {
                  handlePickAndUploadImage();
                }, 300);
              }}
            >
              <Ionicons name="camera-outline" size={20} color="#ffffff" style={{ marginRight: 8 }} />
              <Text style={styles.viewerEditText}>Thay đổi ảnh</Text>
            </TouchableOpacity>
          )}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarWrapper: {
    position: 'relative',
    overflow: 'visible',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  progressText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 2,
  },
  cameraIconContainer: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: '32%',
    height: '32%',
    borderRadius: 99,
    borderWidth: 1.5,
    borderColor: '#ffffff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
  },
  viewerContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'space-between',
    paddingVertical: Platform.OS === 'ios' ? 50 : 20,
  },
  viewerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    width: '100%',
    zIndex: 10,
  },
  viewerCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  viewerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  viewerImageWrapper: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    padding: 10,
  },
  viewerImage: {
    width: '100%',
    height: '100%',
    maxHeight: 600,
  },
  viewerEditBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  viewerEditText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
