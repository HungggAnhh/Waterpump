import { Audio } from 'expo-av';

export class VoiceRecorderService {
  private recording: Audio.Recording | null = null;

  async requestPermissions(): Promise<boolean> {
    try {
      const permissionStatus = await Audio.getPermissionsAsync();
      console.log('[MIC_PERMISSION]', permissionStatus);
      if (permissionStatus.status !== 'granted') {
        const newStatus = await Audio.requestPermissionsAsync();
        console.log('[MIC_PERMISSION_REQUESTED]', newStatus);
        return newStatus.status === 'granted';
      }
      return true;
    } catch (err) {
      console.error('Error requesting mic permissions:', err);
      return false;
    }
  }

  async start(): Promise<void> {
    console.log('[VOICE_START_RECORDING]', { timestamp: Date.now() });
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      const err = new Error('Quyền sử dụng microphone bị từ chối.');
      console.log('[VOICE_RECORDING_ERROR]', err.message);
      throw err;
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        playThroughEarpieceAndroid: false,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      this.recording = recording;
      console.log('[VOICE_RECORDING_CREATED]', { exists: !!recording });
    } catch (err: any) {
      console.log('[VOICE_RECORDING_ERROR]', err.message);
      throw err;
    }
  }

  async stop(): Promise<string | null> {
    console.log('[VOICE_RECORDING_STOP]', { exists: !!this.recording });
    if (!this.recording) return null;
    try {
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      console.log('[VOICE_RECORDING_URI]', uri);
      
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        playThroughEarpieceAndroid: false,
      });

      return uri;
    } catch (err: any) {
      console.log('[VOICE_RECORDING_ERROR]', err.message);
      console.error('Failed to stop recording service:', err);
      return null;
    } finally {
      this.recording = null;
    }
  }

  async cancel(): Promise<void> {
    if (!this.recording) return;
    try {
      await this.recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch (err: any) {
      console.log('[VOICE_RECORDING_ERROR]', err.message);
      console.error('Failed to cancel recording service:', err);
    } finally {
      this.recording = null;
    }
  }
}

export const recorderService = new VoiceRecorderService();
