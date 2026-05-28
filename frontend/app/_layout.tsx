import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import 'react-native-reanimated';
import { View, ActivityIndicator, Text } from 'react-native';

import { useColorScheme } from '@/components/useColorScheme';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

import { UserProvider, useUser } from '../context/UserContext';
import { SocketProvider } from '../context/SocketContext';
import LoginScreen from '../components/LoginScreen';
import NameOnboardingScreen from '../components/NameOnboardingScreen';
import { requestAndRegisterFCM } from '../utils/fcmHelper';

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return (
    <UserProvider>
      <RootLayoutContent />
    </UserProvider>
  );
}

function RootLayoutContent() {
  const { user, loading } = useUser();

  // Hiển thị màn hình Loading trong lúc khôi phục phiên đăng nhập từ AsyncStorage
  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' }}>
        <ActivityIndicator size="large" color="#1d4ed8" />
        <Text style={{ marginTop: 12, fontSize: 13, color: '#64748b', fontWeight: '500' }}>Đang kết nối hệ thống...</Text>
      </View>
    );
  }

  if (user === null) {
    return <LoginScreen />;
  }

  // Nếu user là nhân viên thường và chưa thiết lập tên hiển thị
  if (user.role === 'user' && (!user.name || user.name.trim() === '' || user.name === 'Chưa đặt tên')) {
    return <NameOnboardingScreen />;
  }

  return (
    <SocketProvider>
      <RootLayoutNav />
    </SocketProvider>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    // Tự động đăng ký Web Push Notifications cho PWA
    requestAndRegisterFCM();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="chat/[id]"
          options={{
            headerShown: false,
            presentation: 'card',
            animation: 'slide_from_right',
          }}
        />
      </Stack>
    </ThemeProvider>
  );
}
