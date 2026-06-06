// frontend/app/(tabs)/_layout.tsx
import { Link, Tabs } from 'expo-router';
import { Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Colors from '@/constants/Colors';
import { useColorScheme } from '@/components/useColorScheme';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const colors = Colors[colorScheme ?? 'light'];
  const insets = useSafeAreaInsets();

  // Chiều cao và padding dọc tối ưu hóa theo các insets an toàn
  const tabHeight = Platform.OS === 'ios' ? 60 + insets.bottom : 62 + insets.bottom;
  const paddingBottom = insets.bottom > 0 ? insets.bottom - 2 : 10;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.tint,
        tabBarInactiveTintColor: colors.tabIconDefault,
        tabBarLabelPosition: 'below-icon',
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          marginTop: 2,
          paddingBottom: 2,
        },
        tabBarIconStyle: {
          marginTop: 4,
        },
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: tabHeight,
          paddingBottom: paddingBottom,
          paddingTop: 6,
          ...Platform.select({
            ios: {
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.04,
              shadowRadius: 8,
            },
            android: {
              elevation: 8,
            },
          }),
        },
        headerStyle: {
          backgroundColor: colors.card,
          shadowColor: colors.border,
          elevation: 1,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        headerTitleStyle: {
          color: colors.text,
          fontWeight: '700',
          fontSize: 18,
        },
        headerShown: true,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trang chủ',
          tabBarLabel: 'Trang chủ',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "home" : "home-outline"}
              color={color}
              size={22}
            />
          ),
          headerRight: () => (
            <Link href="/modal" asChild>
              <Pressable style={{ marginRight: 15 }}>
                {({ pressed }) => (
                  <Ionicons
                    name="information-circle-outline"
                    size={24}
                    color={colors.text}
                    style={{ opacity: pressed ? 0.5 : 1 }}
                  />
                )}
              </Pressable>
            </Link>
          ),
        }}
      />
            <Tabs.Screen
        name="messages"
        options={{
          title: 'Trò chuyện',
          tabBarLabel: 'Tin nhắn',
          headerShown: false, // Ẩn header hệ thống để tránh trùng lặp với Inbox Header tự dựng
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "chatbubble-ellipses" : "chatbubble-ellipses-outline"}
              color={color}
              size={22}
            />
          ),
        }}
        
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Công việc',
          tabBarLabel: 'Công việc',
          headerShown: false, // Ẩn header hệ thống để tránh trùng lặp với Custom Header tự dựng
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "checkbox" : "checkbox-outline"}
              color={color}
              size={22}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="two"
        options={{
          title: 'Cài đặt',
          tabBarLabel: 'Cài đặt',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons
              name={focused ? "settings" : "settings-outline"}
              color={color}
              size={22}
            />
          ),
        }}
      />
    </Tabs>
  );
}
