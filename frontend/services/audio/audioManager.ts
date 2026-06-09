import { AppState, AppStateStatus } from 'react-native';
import { VoicePlayer } from './player';

export class AudioManagerService {
  private player: VoicePlayer = new VoicePlayer();
  private activeMessageId: string | number | null = null;
  private lastCallback: ((status: any) => void) | null = null;
  private backgroundTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    AppState.addEventListener('change', this.handleAppStateChange);
  }

  private handleAppStateChange = (nextAppState: AppStateStatus) => {
    if (nextAppState === 'background') {
      // Start 5-minute memory protection timer
      this.backgroundTimer = setTimeout(() => {
        console.log('[AudioManager] App in background for 5 mins. Unloading all audio.');
        this.unloadAll();
      }, 5 * 60 * 1000);
    } else if (nextAppState === 'active') {
      if (this.backgroundTimer) {
        clearTimeout(this.backgroundTimer);
        this.backgroundTimer = null;
      }
    }
  };

  async play(
    messageId: string | number,
    sourceUrl: string,
    mimeType: string,
    onStatusUpdate: (status: any) => void
  ) {
    // Stop any active playing audio first
    if (this.activeMessageId !== null && this.activeMessageId !== messageId) {
      if (this.lastCallback) {
        // Notify the previous component that it has stopped
        this.lastCallback({ isLoaded: true, isPlaying: false, positionMillis: 0 });
      }
      await this.player.unload();
    }

    this.activeMessageId = messageId;
    this.lastCallback = onStatusUpdate;

    try {
      await this.player.loadAndPlay(messageId, sourceUrl, mimeType, (status) => {
        if (status.isLoaded && status.didJustFinish) {
          this.activeMessageId = null;
          this.lastCallback = null;
        }
        onStatusUpdate(status);
      });
    } catch (err) {
      console.error('Failed to play audio in AudioManager:', err);
      this.activeMessageId = null;
      this.lastCallback = null;
    }
  }

  async pause(messageId: string | number) {
    if (this.activeMessageId === messageId) {
      await this.player.pause();
    }
  }

  async resume(messageId: string | number) {
    if (this.activeMessageId === messageId) {
      await this.player.resume();
    }
  }

  async stop(messageId: string | number) {
    if (this.activeMessageId === messageId) {
      await this.player.stop();
      if (this.lastCallback) {
        this.lastCallback({ isLoaded: true, isPlaying: false, positionMillis: 0 });
      }
      this.activeMessageId = null;
      this.lastCallback = null;
    }
  }

  async seek(messageId: string | number, positionMs: number) {
    if (this.activeMessageId === messageId) {
      await this.player.seek(positionMs);
    }
  }

  async unload(messageId: string | number) {
    if (this.activeMessageId === messageId) {
      await this.player.unload();
      this.activeMessageId = null;
      this.lastCallback = null;
    }
  }

  async unloadAll() {
    if (this.lastCallback) {
      this.lastCallback({ isLoaded: true, isPlaying: false, positionMillis: 0 });
    }
    await this.player.unload();
    this.activeMessageId = null;
    this.lastCallback = null;
  }

  getActiveMessageId() {
    return this.activeMessageId;
  }
}

export const audioManager = new AudioManagerService();
export default audioManager;
