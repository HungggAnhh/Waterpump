import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface VoiceSettings {
  enabled: boolean;
  readMessages: boolean;
  readTaskAssigned: boolean;
  readTaskViewed: boolean;
  readTaskReports: boolean;
  readTaskCompleted: boolean;
  readTaskUrged: boolean;
  readOverdueTasks: boolean;
  onlyWhenHidden: boolean;
  monitoringMode: boolean;
}

const DEFAULT_SETTINGS: VoiceSettings = {
  enabled: true,
  readMessages: true,
  readTaskAssigned: true,
  readTaskViewed: true,
  readTaskReports: true,
  readTaskCompleted: true,
  readTaskUrged: true,
  readOverdueTasks: true,
  onlyWhenHidden: false,
  monitoringMode: false
};

interface VoiceSettingsContextType {
  settings: VoiceSettings;
  updateSettings: (newSettings: Partial<VoiceSettings>) => Promise<void>;
  loading: boolean;
}

const VoiceSettingsContext = createContext<VoiceSettingsContextType>({
  settings: DEFAULT_SETTINGS,
  updateSettings: async () => {},
  loading: true
});

const STORAGE_KEY = 'waterpump_voice_settings';

export const VoiceSettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<VoiceSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSettings() {
      try {
        let stored: string | null = null;
        if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
          stored = localStorage.getItem(STORAGE_KEY);
        } else {
          stored = await AsyncStorage.getItem(STORAGE_KEY);
        }

        if (stored) {
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
        }
      } catch (err) {
        console.warn('Error loading voice settings:', err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const updateSettings = async (newSettings: Partial<VoiceSettings>) => {
    try {
      const updated = { ...settings, ...newSettings };
      setSettings(updated);

      const jsonStr = JSON.stringify(updated);
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, jsonStr);
      } else {
        await AsyncStorage.setItem(STORAGE_KEY, jsonStr);
      }
    } catch (err) {
      console.warn('Error saving voice settings:', err);
    }
  };

  return (
    <VoiceSettingsContext.Provider value={{ settings, updateSettings, loading }}>
      {children}
    </VoiceSettingsContext.Provider>
  );
};

export const useVoiceSettings = () => useContext(VoiceSettingsContext);
