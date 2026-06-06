import { Audio } from 'expo-av';

export class VoiceRecorderService {
  private recording: Audio.Recording | null = null;

  async requestPermissions(): Promise<boolean> {
    try {
      const { status } = await Audio.getPermissionsAsync();
      if (status !== 'granted') {
        const { status: newStatus } = await Audio.requestPermissionsAsync();
        return newStatus === 'granted';
      }
      return true;
    } catch (err) {
      console.error('Error requesting mic permissions:', err);
      return false;
    }
  }

  async start(): Promise<void> {
    const hasPermission = await this.requestPermissions();
    if (!hasPermission) {
      throw new Error('Quyền sử dụng microphone bị từ chối.');
    }

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
  }

  async stop(): Promise<string | null> {
    if (!this.recording) return null;
    try {
      await this.recording.stopAndUnloadAsync();
      const uri = this.recording.getURI();
      
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: false,
        playThroughEarpieceAndroid: false,
      });

      return uri;
    } catch (err) {
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
    } catch (err) {
      console.error('Failed to cancel recording service:', err);
    } finally {
      this.recording = null;
    }
  }
}

export const recorderService = new VoiceRecorderService();
