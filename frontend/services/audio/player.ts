import { Audio, AVPlaybackStatus } from 'expo-av';
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

const CACHE_DIR = `${(FileSystem as any).cacheDirectory || ''}voice_cache/`;

export class VoicePlayer {
  private sound: Audio.Sound | null = null;
  private onStatusUpdateCallback: ((status: any) => void) | null = null;
  private messageId: string | number | null = null;

  private async ensureCacheDir() {
    if (Platform.OS === 'web') return;
    try {
      const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
      }
    } catch (err) {
      console.error('Error ensuring cache dir:', err);
    }
  }

  async getCachedUri(messageId: string | number, signedUrl: string): Promise<string> {
    if (Platform.OS === 'web') {
      return signedUrl;
    }

    try {
      await this.ensureCacheDir();
      const localUri = `${CACHE_DIR}${messageId}.m4a`;
      const fileInfo = await FileSystem.getInfoAsync(localUri);

      if (fileInfo.exists) {
        const now = Date.now();
        const mTime = (fileInfo as any).modificationTime ? (fileInfo as any).modificationTime * 1000 : now;
        // 7 Days TTL Check
        if (now - mTime < 7 * 24 * 60 * 60 * 1000) {
          return localUri;
        } else {
          await FileSystem.deleteAsync(localUri, { idempotent: true });
        }
      }

      console.log(`📥 Downloading voice message to local cache: ${localUri}`);
      const downloadResult = await FileSystem.downloadAsync(signedUrl, localUri);
      return downloadResult.uri;
    } catch (err) {
      console.error('Error caching audio download:', err);
      return signedUrl;
    }
  }

  static async cleanupOldCache() {
    if (Platform.OS === 'web') return;
    try {
      const dirInfo = await FileSystem.getInfoAsync(CACHE_DIR);
      if (!dirInfo.exists) return;

      const files = await FileSystem.readDirectoryAsync(CACHE_DIR);
      const now = Date.now();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;

      for (const file of files) {
        const filePath = `${CACHE_DIR}${file}`;
        const fileInfo = await FileSystem.getInfoAsync(filePath);
        const mTime = (fileInfo as any).modificationTime ? (fileInfo as any).modificationTime * 1000 : now;
        if (now - mTime > sevenDays) {
          await FileSystem.deleteAsync(filePath, { idempotent: true });
        }
      }
    } catch (err) {
      console.error('Failed to cleanup old voice caches:', err);
    }
  }

  async loadAndPlay(
    messageId: string | number,
    signedUrl: string,
    onStatusUpdate: (status: any) => void
  ) {
    this.messageId = messageId;
    this.onStatusUpdateCallback = onStatusUpdate;
    
    await this.unload();

    console.log(`[Analytics] voice_play_started: ${messageId}`);

    const uri = await this.getCachedUri(messageId, signedUrl);

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      playThroughEarpieceAndroid: false,
    });

    const { sound } = await Audio.Sound.createAsync(
      { uri },
      { shouldPlay: true },
      this.handlePlaybackStatusUpdate
    );

    this.sound = sound;
  }

  private handlePlaybackStatusUpdate = (status: AVPlaybackStatus) => {
    if (status.isLoaded && status.didJustFinish) {
      console.log(`[Analytics] voice_play_completed: ${this.messageId}`);
    }
    if (this.onStatusUpdateCallback) {
      this.onStatusUpdateCallback(status);
    }
  };

  async pause() {
    if (this.sound) {
      await this.sound.pauseAsync();
    }
  }

  async resume() {
    if (this.sound) {
      await this.sound.playAsync();
    }
  }

  async stop() {
    if (this.sound) {
      await this.sound.stopAsync();
    }
  }

  async seek(positionMs: number) {
    if (this.sound) {
      await this.sound.setPositionAsync(positionMs);
    }
  }

  async unload() {
    if (this.sound) {
      try {
        await this.sound.unloadAsync();
      } catch (err) {
        console.error('Failed to unload sound in player:', err);
      } finally {
        this.sound = null;
        this.messageId = null;
        this.onStatusUpdateCallback = null;
      }
    }
  }

  getMessageId() {
    return this.messageId;
  }
}
