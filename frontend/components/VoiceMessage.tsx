import { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from '../hooks/useAudioPlayer';
import { API_BASE_URL } from '../constants/Config';

interface VoiceMessageProps {
  messageId: string | number;
  attachmentUrl: string;
  attachmentMimeType?: string | null;
  duration: number; // duration in seconds
  currentUserId?: number;
  isMine: boolean;
  colors: {
    tint: string;
    card: string;
    text: string;
    border: string;
    textSecondary: string;
  };
}

const WAVEFORM_BARS = [10, 16, 24, 14, 8, 18, 26, 20, 14, 10, 18, 24, 14, 8, 12];

export default function VoiceMessage({
  messageId,
  attachmentUrl,
  attachmentMimeType,
  duration,
  currentUserId,
  isMine,
  colors,
}: VoiceMessageProps) {
  const [isFetchingUrl, setIsFetchingUrl] = useState(false);
  const [containerWidth, setContainerWidth] = useState(1);

  const {
    isPlaying,
    position,
    duration: playerDuration,
    isLoading: isPlayerLoading,
    error,
    play,
    pause,
    seek,
  } = useAudioPlayer(messageId);

  // Fetch fresh signed URL from backend on demand
  const fetchSignedUrl = useCallback(async (): Promise<string | null> => {
    if (!currentUserId) return null;

    setIsFetchingUrl(true);
    console.log('[VOICE PLAYBACK REQUEST]', {
      attachment_url: attachmentUrl,
      user_id: currentUserId
    });

    try {
      const response = await fetch(`${API_BASE_URL}/upload/sign-read`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attachment_url: attachmentUrl,
          user_id: currentUserId,
          platform: Platform.OS,
        }),
      });
      const result = await response.json();
      if (result.status === 'success' && result.signedUrl) {
        return result.signedUrl;
      } else {
        console.error('Failed to get signed url:', result.message);
        return null;
      }
    } catch (err) {
      console.error('Error fetching signed URL:', err);
      return null;
    } finally {
      setIsFetchingUrl(false);
    }
  }, [attachmentUrl, currentUserId]);

  const handlePlayPause = async () => {
    // If it's local temporary file (e.g. pending/optimistic), play it directly!
    const isLocalFile = attachmentUrl.startsWith('file://') || attachmentUrl.startsWith('content://');
    
    if (isPlaying) {
      await pause();
    } else {
      if (isLocalFile) {
        console.log('[VOICE_PLAYBACK]', {
          messageId,
          mimeType: attachmentMimeType || 'audio/m4a',
          signedUrl: attachmentUrl,
          platform: Platform.OS
        });
        await play(attachmentUrl, attachmentMimeType || 'audio/m4a');
      } else {
        const url = await fetchSignedUrl();
        if (url) {
          console.log('[VOICE_PLAYBACK]', {
            messageId,
            mimeType: attachmentMimeType || 'audio/m4a',
            signedUrl: url,
            platform: Platform.OS
          });
          await play(url, attachmentMimeType || 'audio/m4a');
        }
      }
    }
  };

  const onLayout = (event: any) => {
    setContainerWidth(event.nativeEvent.layout.width || 1);
  };

  const handleWaveformSeek = async (evt: any) => {
    const touchX = evt.nativeEvent.locationX;
    const pct = Math.max(0, Math.min(1, touchX / containerWidth));
    const targetDuration = playerDuration > 0 ? playerDuration : duration * 1000;
    await seek(pct * targetDuration);
  };

  const formatTimeMs = (ms: number) => {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const currentProgressPct = playerDuration > 0 ? position / playerDuration : 0;
  const isAudioLoading = isFetchingUrl || isPlayerLoading;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[
          styles.playButton,
          { backgroundColor: isMine ? 'rgba(255,255,255,0.2)' : 'rgba(59,130,246,0.1)' },
        ]}
        onPress={handlePlayPause}
        disabled={isAudioLoading}
      >
        {isAudioLoading ? (
          <ActivityIndicator
            size="small"
            color={isMine ? '#fff' : colors.tint}
          />
        ) : (
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={isMine ? '#fff' : colors.tint}
          />
        )}
      </TouchableOpacity>

      {/* Waveform / Visualizer */}
      <View
        style={styles.waveformContainer}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        onResponderRelease={handleWaveformSeek}
      >
        {WAVEFORM_BARS.map((barHeight, idx) => {
          const barPct = idx / WAVEFORM_BARS.length;
          const isActive = currentProgressPct >= barPct;
          return (
            <View
              key={idx}
              style={[
                styles.waveformBar,
                {
                  height: barHeight,
                  backgroundColor: isActive
                    ? (isMine ? '#ffffff' : colors.tint)
                    : (isMine ? 'rgba(255, 255, 255, 0.4)' : 'rgba(100, 116, 139, 0.3)'),
                },
              ]}
            />
          );
        })}
      </View>

      <Text
        style={[
          styles.timeText,
          { color: isMine ? '#fff' : colors.textSecondary },
        ]}
      >
        {isPlaying
          ? `${formatTimeMs(position)} / ${formatTimeMs(playerDuration || duration * 1000)}`
          : formatSeconds(duration)}
      </Text>

      {error && (
        <Text style={[styles.errorText, { color: isMine ? '#fca5a5' : '#ef4444' }]}>
          {error}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    minWidth: 220,
    maxWidth: 280,
  },
  playButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  waveformContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 30,
    marginRight: 10,
  },
  waveformBar: {
    width: 3,
    borderRadius: 1.5,
  },
  timeText: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    minWidth: 35,
    textAlign: 'right',
  },
  errorText: {
    position: 'absolute',
    bottom: -12,
    left: 42,
    fontSize: 9,
  },
});
