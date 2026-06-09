import { Audio } from 'expo-av';

export class VoiceRecorderService {
  private recording: Audio.Recording | null = null;

  async requestPermissions(): Promise<boolean> {
    try {
      const permissionStatus = await Audio.getPermissionsAsync();
      console.log('[MIC_PERMISSION]', permissionStatus);
      if (permissionStatus.status !== 'granted') {
        const newStatus = await Audio.requestPermissionsAsync();
        console.log('[MIC_PERMISSION]', newStatus);
        return newStatus.status === 'granted';
      }
      return true;
    } catch (err) {
      console.error('Error requesting mic permissions:', err);
      return false;
    }
  }

  async start(): Promise<void> {
    console.log('[VOICE_RECORDING_START]');
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      const error = new Error('Quyền sử dụng microphone bị từ chối.');
      console.log('[VOICE_RECORDING_ERROR]', error);
      throw error;
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
      console.log('[VOICE_RECORDING_CREATED]', recording);
    } catch (error: any) {
      console.log('[VOICE_RECORDING_ERROR]', error);
      throw error;
    }
  }

  async stop(): Promise<string | null> {
    console.log('[VOICE_RECORDING_STOP]');
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
    } catch (error: any) {
      console.log('[VOICE_RECORDING_ERROR]', error);
      console.error('Failed to stop recording service:', error);
      return null;
    } finally {
      this.recording = null;
    }
  }

  async cancel(): Promise<void> {
    console.log('[VOICE_RECORDING_CANCEL]');
    if (!this.recording) return;
    try {
      await this.recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch (error: any) {
      console.log('[VOICE_RECORDING_ERROR]', error);
      console.error('Failed to cancel recording service:', error);
    } finally {
      this.recording = null;
    }
  }
}

export const recorderService = new VoiceRecorderService();

