import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { API_BASE_URL } from '../../constants/Config';

const QUEUE_KEY = 'pending_voice_messages';
const BACKOFF_DELAYS = [1000, 2000, 5000, 10000, 30000];

export interface PendingVoice {
  localId: string;
  roomId: number;
  localUri: string;
  duration: number;
  createdAt: string;
  uploadProgress: number;
  status: 'pending' | 'uploading' | 'sent' | 'failed';
  fileSize?: number;
  client_message_id: string;
  userId: number;
  retryCount?: number;
  mimeType?: string;
}

function getExtensionFromMimeType(mimeType: string): string {
  const map: { [key: string]: string } = {
    'audio/webm': 'webm',
    'audio/webm;codecs=opus': 'webm',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/aac': 'aac',
    'audio/x-aac': 'aac',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/3gpp': '3gp',
    'audio/3gp': '3gp',
  };
  const cleanMime = mimeType.split(';')[0].toLowerCase().trim();
  return map[cleanMime] || 'm4a';
}

type QueueListener = (queue: PendingVoice[]) => void;

class VoiceUploadWorker {
  private queue: PendingVoice[] = [];
  private isProcessing = false;
  private socket: any = null;
  private listeners: Set<QueueListener> = new Set();
  private retryTimers: { [key: string]: ReturnType<typeof setTimeout> } = {};

  constructor() {
    this.loadQueueFromStorage().then(() => {
      this.cleanupOldQueueItems();
    });
  }

  setSocket(socket: any) {
    this.socket = socket;
    if (socket) {
      // Re-trigger queue processing when socket connects/reconnects
      this.processQueue();
    }
  }

  addListener(listener: QueueListener): () => void {
    this.listeners.add(listener);
    listener(this.queue);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners() {
    const currentQueue = [...this.queue];
    this.listeners.forEach((listener) => listener(currentQueue));
  }

  async loadQueueFromStorage() {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return;
    }
    try {
      const stored = await AsyncStorage.getItem(QUEUE_KEY);
      if (stored) {
        this.queue = JSON.parse(stored);
        this.notifyListeners();
      }
    } catch (err) {
      console.error('Failed to load voice upload queue:', err);
    }
  }

  private async saveQueueToStorage() {
    if (Platform.OS === 'web' && typeof window === 'undefined') {
      return;
    }
    try {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
      this.notifyListeners();
    } catch (err) {
      console.error('Failed to save voice upload queue:', err);
    }
  }

  async addToQueue(item: Omit<PendingVoice, 'uploadProgress' | 'status' | 'retryCount'>) {
    console.log(
      '[VOICE_DEBUG] QUEUE_ADD',
      {
        uri: item.localUri,
        duration: item.duration
      }
    );
    // Check if file size
    let fileSize = 0;
    if (Platform.OS !== 'web') {
      try {
        const fileInfo = await FileSystem.getInfoAsync(item.localUri);
        if (fileInfo.exists) {
          fileSize = fileInfo.size;
        }
      } catch (err) {
        console.error('Error getting file size:', err);
      }
    }

    let mimeType = 'audio/m4a';
    if (Platform.OS === 'web') {
      try {
        const audioResponse = await fetch(item.localUri);
        const audioBlob = await audioResponse.blob();
        mimeType = audioBlob.type || 'audio/webm';
      } catch (err) {
        console.error('Error fetching blob type in addToQueue:', err);
        mimeType = 'audio/webm'; // fallback for Web
      }
    } else {
      const fileExt = item.localUri.split('.').pop()?.toLowerCase() || 'm4a';
      if (fileExt === 'm4a') mimeType = 'audio/m4a';
      else if (fileExt === 'mp4') mimeType = 'audio/mp4';
      else if (fileExt === 'aac') mimeType = 'audio/aac';
      else if (fileExt === '3gp' || fileExt === '3gpp') mimeType = 'audio/3gpp';
      else if (fileExt === 'wav') mimeType = 'audio/wav';
      else if (fileExt === 'ogg') mimeType = 'audio/ogg';
      else if (fileExt === 'webm') mimeType = 'audio/webm';
      else mimeType = 'audio/m4a';
    }

    const newItem: PendingVoice = {
      ...item,
      uploadProgress: 0,
      status: 'pending',
      fileSize,
      retryCount: 0,
      mimeType,
    };

    // Remove if already exists to avoid duplicates
    this.queue = this.queue.filter(q => q.client_message_id !== item.client_message_id);
    this.queue.push(newItem);
    await this.saveQueueToStorage();
    
    // Start processing
    this.processQueue();
  }

  async processQueue() {
    if (this.isProcessing) return;
    
    const nextItem = this.queue.find(item => item.status === 'pending' || item.status === 'failed');
    if (!nextItem) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    await this.uploadItem(nextItem);
    this.isProcessing = false;

    // Recurse to process the rest of the queue
    this.processQueue();
  }

  private async uploadItem(item: PendingVoice) {
    console.log(
      '[VOICE_DEBUG] UPLOAD_START',
      {
        uri: item.localUri
      }
    );
    console.log(`[UploadWorker] Processing voice message: ${item.client_message_id}`);
    
    // Update status to uploading
    this.updateItemStatus(item.client_message_id, 'uploading', 0);
    await this.saveQueueToStorage();

    // Verify local file exists (Upload Resume Protection)
    if (Platform.OS !== 'web') {
      try {
        const fileInfo = await FileSystem.getInfoAsync(item.localUri);
        if (!fileInfo.exists) {
          console.error(`[UploadWorker] File does not exist at localUri: ${item.localUri}`);
          this.updateItemStatus(item.client_message_id, 'failed', 0);
          await this.saveQueueToStorage();
          return;
        }
      } catch (err) {
        console.error('Failed to check file existence:', err);
        this.updateItemStatus(item.client_message_id, 'failed', 0);
        await this.saveQueueToStorage();
        return;
      }
    }

    try {
      const mimeType = item.mimeType || 'audio/m4a';
      let audioBlob: any = null;

      if (Platform.OS === 'web') {
        const audioResponse = await fetch(item.localUri);
        audioBlob = await audioResponse.blob();
      }

      const ext = getExtensionFromMimeType(mimeType);
      const fileName = `chat-voice/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, '0')}/voice_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

      console.log('[VOICE_UPLOAD]', {
        fileName,
        mimeType,
        size: item.fileSize || audioBlob?.size || 0,
        extension: ext
      });

      // 1. Get Signed URL from Backend
      const signResponse = await fetch(`${API_BASE_URL}/upload/sign-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName,
          contentType: mimeType,
          user_id: item.userId,
        }),
      });

      if (!signResponse.ok) {
        throw new Error(`Server returned status ${signResponse.status}`);
      }

      const signResult = await signResponse.json();
      if (signResult.status !== 'success' || !signResult.signedUrl) {
        throw new Error(signResult.message || 'Lỗi lấy URL tải lên.');
      }

      const signedUrl = signResult.signedUrl;
      console.log(
        '[VOICE_DEBUG] SIGNED_UPLOAD_URL',
        signedUrl
      );

      let uploadStatus = 0;

      if (Platform.OS === 'web') {
        console.log('[VOICE_MIME_DEBUG]', {
          platform: Platform.OS,
          ext,
          mimeType
        });

        // 3. PUT binary directly to Supabase Storage
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', signedUrl, true);
        xhr.setRequestHeader('Content-Type', mimeType);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = Math.round((event.loaded / event.total) * 100);
            this.updateItemProgress(item.client_message_id, percent);
          }
        };

        const uploadPromise = new Promise<{ status: number; text: string }>((resolve, reject) => {
          xhr.onload = () => {
            resolve({ status: xhr.status, text: xhr.responseText });
          };
          xhr.onerror = () => {
            reject(new Error('Lỗi kết nối mạng khi upload.'));
          };
        });

        xhr.send(audioBlob);
        const uploadRes = await uploadPromise;
        uploadStatus = uploadRes.status;
        console.log(
          '[VOICE_DEBUG] UPLOAD_RESPONSE',
          {
            status: uploadRes.status,
            body: uploadRes.text
          }
        );
      } else {
        // On native platforms (iOS/Android), use FileSystem.createUploadTask
        // which does not suffer from fetch local file failures
        console.log(`[UploadWorker] Starting native binary upload via Expo FileSystem...`);
        console.log('[VOICE_MIME_DEBUG]', {
          platform: Platform.OS,
          ext,
          mimeType
        });
        const uploadTask = FileSystem.createUploadTask(
          signedUrl,
          item.localUri,
          {
            headers: {
              'Content-Type': mimeType,
            },
            httpMethod: 'PUT',
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
          },
          (data) => {
            const percent = Math.round((data.totalBytesSent / data.totalBytesExpectedToSend) * 100);
            this.updateItemProgress(item.client_message_id, percent);
          }
        );

        const uploadRes = await uploadTask.uploadAsync();
        if (!uploadRes) {
          throw new Error('Native upload returned empty response.');
        }
        uploadStatus = uploadRes.status;
        console.log(
          '[VOICE_DEBUG] UPLOAD_RESPONSE',
          {
            status: uploadRes.status,
            body: uploadRes.body
          }
        );
        console.log(`[UploadWorker] Native upload completed with status: ${uploadStatus}`);
      }

      if (uploadStatus < 200 || uploadStatus >= 300) {
        throw new Error('Upload HTTP error code: ' + uploadStatus);
      }

      // 4. Construct attachment private URL
      const match = signedUrl.match(/^(https?:\/\/[^\/]+)/);
      const host = match ? match[1] : '';
      const attachmentUrl = `${host}/storage/v1/object/private/media/${fileName}`;

      const payload = {
        conversation_id: item.roomId,
        sender_id: item.userId,
        message: '[Tin nhắn thoại]',
        type: 'voice',
        attachment_url: attachmentUrl,
        attachment_duration: item.duration,
        attachment_mime_type: mimeType,
        client_message_id: item.client_message_id,
      };

      console.log('[VOICE_UPLOAD_DEBUG]', {
        signedUrl,
        uploadStatus,
        attachmentUrl,
        mimeType,
        ext,
        payload
      });

      // 5. Send message via Socket
      if (this.socket && this.socket.connected) {
        console.log(
          '[VOICE_DEBUG] SOCKET_SEND_VOICE',
          payload
        );
        this.socket.emit('send_message', payload);

        // Mark as sent
        this.updateItemStatus(item.client_message_id, 'sent', 100);
        await this.saveQueueToStorage();
        console.log(`[UploadWorker] Sent voice message successfully: ${item.client_message_id}`);
      } else {
        throw new Error('Socket is disconnected, waiting for socket to reconnect...');
      }
    } catch (err: any) {
      console.error(`[UploadWorker] Failed to upload ${item.client_message_id}:`, err.message);
      this.updateItemStatus(item.client_message_id, 'failed', 0);
      await this.saveQueueToStorage();
      this.scheduleRetry(item);
    }
  }

  private scheduleRetry(item: PendingVoice) {
    const retries = item.retryCount || 0;
    if (retries >= 5) {
      console.warn(`[UploadWorker] Max retries (5) reached for: ${item.client_message_id}`);
      return;
    }

    if (this.retryTimers[item.client_message_id]) {
      clearTimeout(this.retryTimers[item.client_message_id]);
    }

    const delay = BACKOFF_DELAYS[retries];
    console.log(`[UploadWorker] Scheduling retry #${retries + 1} in ${delay}ms for: ${item.client_message_id}`);
    
    this.retryTimers[item.client_message_id] = setTimeout(() => {
      // Reset status back to pending to trigger processQueue
      this.queue = this.queue.map(q => {
        if (q.client_message_id === item.client_message_id) {
          return { ...q, status: 'pending', retryCount: retries + 1 };
        }
        return q;
      });
      this.saveQueueToStorage().then(() => {
        this.processQueue();
      });
    }, delay);
  }

  async removeItem(clientMessageId: string) {
    if (this.retryTimers[clientMessageId]) {
      clearTimeout(this.retryTimers[clientMessageId]);
      delete this.retryTimers[clientMessageId];
    }
    
    const item = this.queue.find(q => q.client_message_id === clientMessageId);
    if (item && Platform.OS !== 'web') {
      // Try unlinking local file to save space
      try {
        await FileSystem.deleteAsync(item.localUri, { idempotent: true });
      } catch (err) {
        console.error('Failed to delete pending local file:', err);
      }
    }

    this.queue = this.queue.filter(q => q.client_message_id !== clientMessageId);
    await this.saveQueueToStorage();
  }

  private updateItemStatus(clientMessageId: string, status: PendingVoice['status'], progress: number) {
    this.queue = this.queue.map(q => {
      if (q.client_message_id === clientMessageId) {
        return { ...q, status, uploadProgress: progress };
      }
      return q;
    });
    this.notifyListeners();
  }

  private updateItemProgress(clientMessageId: string, progress: number) {
    this.queue = this.queue.map(q => {
      if (q.client_message_id === clientMessageId) {
        return { ...q, uploadProgress: progress };
      }
      return q;
    });
    this.notifyListeners();
  }

  private async cleanupOldQueueItems() {
    const now = Date.now();
    const oneDay = 24 * 60 * 60 * 1000;
    const sevenDays = 7 * oneDay;
    
    let hasChanges = false;
    const cleanedQueue: PendingVoice[] = [];

    for (const item of this.queue) {
      const age = now - new Date(item.createdAt).getTime();
      
      if (item.status === 'sent' && age > oneDay) {
        hasChanges = true;
        // Delete local temp file
        if (Platform.OS !== 'web') {
          try {
            await FileSystem.deleteAsync(item.localUri, { idempotent: true });
          } catch (e) {}
        }
        continue;
      }
      
      if (item.status === 'failed' && age > sevenDays) {
        hasChanges = true;
        if (Platform.OS !== 'web') {
          try {
            await FileSystem.deleteAsync(item.localUri, { idempotent: true });
          } catch (e) {}
        }
        continue;
      }

      cleanedQueue.push(item);
    }

    if (hasChanges) {
      this.queue = cleanedQueue;
      await this.saveQueueToStorage();
    }
  }

  getQueue() {
    return this.queue;
  }
}

export const voiceUploadWorker = new VoiceUploadWorker();
export default voiceUploadWorker;
