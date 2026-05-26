// frontend/components/EmojiPanel.tsx
// Messenger-style emoji panel — inline, NOT a modal. Slide-up từ dưới màn hình.
import React, { useState, useMemo, useCallback, memo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Dimensions,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── Emoji data ──────────────────────────────────────────────────────────────
const CATEGORIES: {
  key: string;
  icon: string;
  label: string;
  emojis: string[];
}[] = [
  {
    key: 'smileys',
    icon: 'happy-outline',
    label: 'Biểu cảm',
    emojis: [
      '😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇',
      '🥰','😍','🤩','😘','😗','😚','😙','😋','😛','😜','🤪','😝','🤑',
      '🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬',
      '🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🤧','🥵',
      '🥶','🥴','😵','🤯','🤠','🥳','😎','🤓','🧐','😕','😟','🙁','☹️',
      '😮','😯','😲','😳','🥺','😦','😧','😨','😰','😥','😢','😭','😱',
      '😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿',
      '💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖',
    ],
  },
  {
    key: 'gestures',
    icon: 'hand-left-outline',
    label: 'Cử chỉ',
    emojis: [
      '👋','🤚','🖐','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙',
      '👈','👉','👆','☝️','👇','👍','👎','✊','👊','🤛','🤜','👏','🙌',
      '👐','🤲','🤝','🙏','✍️','💪','🦾','🦵','🦶','👀','👁','👅','👄',
      '💋','🧠','🫀','🫁','🦷','🦴','👶','🧒','👦','👧','🧑','👱','👨',
      '🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇',
      '🤦','🤷','💆','💇','🚶','🧍','🧎','🏃','💃','🕺','🧖',
    ],
  },
  {
    key: 'animals',
    icon: 'paw-outline',
    label: 'Động vật',
    emojis: [
      '🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷',
      '🐸','🐵','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴',
      '🦄','🐝','🐛','🦋','🐌','🐞','🐜','🪲','🦟','🦗','🕷','🦂','🐢',
      '🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋',
      '🦈','🐊','🐅','🐆','🦓','🦍','🦧','🦣','🐘','🦛','🦏','🐪','🐫',
      '🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐑','🦙','🐐','🦌','🐕',
      '🐩','🦮','🐈','🐓','🦃','🦤','🦚','🦜','🦢','🦩','🕊','🐇','🦝',
      '🦨','🦡','🦫','🦦','🦥','🐁','🐀','🐿','🦔',
    ],
  },
  {
    key: 'food',
    icon: 'fast-food-outline',
    label: 'Đồ ăn',
    emojis: [
      '🍎','🍊','🍋','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝',
      '🍅','🍆','🥑','🫒','🥦','🥬','🥒','🌶','🫑','🧄','🧅','🥔','🌽',
      '🥕','🧆','🥙','🥗','🌯','🫔','🥫','🍱','🍘','🍙','🍚','🍛','🍜',
      '🍝','🍞','🥐','🥖','🫓','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓',
      '🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫕','🍣','🍤','🥟','🦪','🍦',
      '🍧','🍨','🍰','🎂','🧁','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜',
      '🍯','🧃','🥤','☕','🍵','🧋','🍺','🍻','🥂','🍾',
    ],
  },
  {
    key: 'activities',
    icon: 'football-outline',
    label: 'Hoạt động',
    emojis: [
      '⚽','🏀','🏈','⚾','🥎','🏐','🏉','🎾','🥏','🎱','🪀','🏓','🏸',
      '🏒','🥊','🥋','🎽','🛹','🛷','⛸','🥅','⛳','🎿','🛼','🤿','🎯',
      '🎣','🎽','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎵','🎶','🥁','🎷',
      '🎺','🎸','🎻','🪕','🎲','♟','🎳','🎰','🎮','🕹','🎠','🎡','🎢',
    ],
  },
  {
    key: 'travel',
    icon: 'airplane-outline',
    label: 'Du lịch',
    emojis: [
      '🚗','🚕','🚙','🚌','🚎','🏎','🚓','🚑','🚒','🚐','🛻','🚚','🚛',
      '🚜','🛵','🏍','🛺','🚲','🛴','🛹','🚏','⛽','🚦','🚥','🗺','🗿',
      '🗽','🗼','🏰','🏯','🏟','🎡','🎢','🎠','⛲','⛺','🏕','🌁','🌃',
      '🏙','🌄','🌅','🌆','🌇','🌉','🌌','🌠','✈️','🛩','🚁','🛸','🚀',
      '🛶','⛵','🚤','🛥','🛳','⛴','🚢','⚓',
    ],
  },
  {
    key: 'objects',
    icon: 'cube-outline',
    label: 'Đồ vật',
    emojis: [
      '💡','🔦','🕯','🧱','💎','🔑','🗝','🔓','🔒','🪝','🔧','🔨','⚒',
      '🛠','🔩','🪛','💣','🪤','⚔️','🛡','🧲','⚗️','🔭','🔬','🩺','💊',
      '🩹','🩻','🌡','🔋','💻','⌨️','🖥','🖨','📱','📺','📷','📸','🎥',
      '📞','☎️','📡','🔊','📢','📣','🔔','🔕','🎵','🎶','🎙','🧭','⏱',
      '⏰','🕰','💰','💵','💶','💷','💸','💳','🏧','💴',
    ],
  },
  {
    key: 'symbols',
    icon: 'heart-outline',
    label: 'Ký hiệu',
    emojis: [
      '❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞',
      '💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉','☸️','✡️','⭐',
      '🌟','✨','⚡','🌈','❄️','🌊','🎉','🎊','🎀','🎁','🎗','🎫','🎟',
      '✅','❎','⛔','🚫','💯','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪',
      '🟤','🔺','🔻','🔷','🔶','🔹','🔸','🔲','🔳','▪️','▫️','🆕','🆓',
      '🆙','🆗','🆒','🔝','🔛','‼️','⁉️','🔁','🔂','▶️','⏸','⏹','⏺',
      '🔀','🔃','🔄','⏫','⏬','⬆️','⬇️','⬅️','➡️',
    ],
  },
];

// ─── Types ───────────────────────────────────────────────────────────────────
export interface EmojiPanelProps {
  /** Chiều cao của panel (px). Truyền từ ngoài để sync với keyboard height. */
  height?: number;
  /** Callback khi chọn emoji */
  onEmojiSelect: (emoji: string) => void;
  /** Danh sách emoji gần đây */
  recentEmojis?: string[];
  /** Theme colors từ app */
  colors: {
    card: string;
    background: string;
    text: string;
    textSecondary?: string;
    border: string;
    tint: string;
  };
}

// ─── Single emoji cell (memo để tránh re-render) ─────────────────────────────
const EmojiCell = memo(({ emoji, onPress }: { emoji: string; onPress: (e: string) => void }) => (
  <TouchableOpacity
    style={styles.emojiCell}
    onPress={() => onPress(emoji)}
    activeOpacity={0.55}
    hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
  >
    <Text style={styles.emojiText}>{emoji}</Text>
  </TouchableOpacity>
));

// ─── Main EmojiPanel ─────────────────────────────────────────────────────────
export const EmojiPanel: React.FC<EmojiPanelProps> = ({
  height = 300,
  onEmojiSelect,
  recentEmojis = [],
  colors,
}) => {
  const [activeCategory, setActiveCategory] = useState('smileys');
  const [searchQuery, setSearchQuery] = useState('');

  // Build full category list (thêm "Recent" nếu có emoji gần đây)
  const categories = useMemo(() => {
    const base = recentEmojis.length > 0
      ? [{ key: 'recent', icon: 'time-outline', label: 'Gần đây', emojis: recentEmojis }, ...CATEGORIES]
      : CATEGORIES;
    return base;
  }, [recentEmojis]);

  // Emoji hiển thị: search → all; không search → category
  const displayedEmojis = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      return CATEGORIES.flatMap(c => c.emojis);
    }
    return categories.find(c => c.key === activeCategory)?.emojis ?? [];
  }, [activeCategory, searchQuery, categories]);

  const handleCategoryPress = useCallback((key: string) => {
    setActiveCategory(key);
    setSearchQuery('');
  }, []);

  const renderEmoji = useCallback(
    ({ item }: { item: string }) => (
      <EmojiCell emoji={item} onPress={onEmojiSelect} />
    ),
    [onEmojiSelect],
  );

  // Panel height breakdown:
  // - Search bar: 46px
  // - Category tabs: 48px
  // - Emoji grid: remainder
  const gridHeight = height - 46 - 48 - (Platform.OS === 'android' ? 8 : 0);

  return (
    <View style={[styles.container, { height, backgroundColor: colors.card, borderTopColor: colors.border }]}>
      {/* ── Search bar ── */}
      <View style={[styles.searchRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
        <Ionicons name="search-outline" size={15} color="#a0aec0" />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Tìm biểu cảm…"
          placeholderTextColor="#a0aec0"
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={15} color="#a0aec0" />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Emoji grid ── */}
      <FlatList
        data={displayedEmojis}
        renderItem={renderEmoji}
        keyExtractor={(item, idx) => `${item}-${idx}`}
        numColumns={8}
        style={{ height: gridHeight }}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        removeClippedSubviews
        initialNumToRender={48}
        maxToRenderPerBatch={32}
        windowSize={3}
        getItemLayout={(_, index) => ({
          length: CELL_SIZE,
          offset: CELL_SIZE * Math.floor(index / 8),
          index,
        })}
      />

      {/* ── Category tabs ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.tabBar, { backgroundColor: colors.card, borderTopColor: colors.border }]}
        contentContainerStyle={styles.tabBarContent}
        keyboardShouldPersistTaps="always"
      >
        {categories.map(cat => {
          const isActive = activeCategory === cat.key;
          return (
            <TouchableOpacity
              key={cat.key}
              style={[
                styles.tab,
                isActive && { backgroundColor: colors.tint + '22' },
              ]}
              onPress={() => handleCategoryPress(cat.key)}
              activeOpacity={0.6}
            >
              <Ionicons
                name={cat.icon as any}
                size={20}
                color={isActive ? colors.tint : '#a0aec0'}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const CELL_SIZE = Math.floor(SCREEN_WIDTH / 8);

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    overflow: 'hidden',
  },

  // Search
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
    height: 38,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
    includeFontPadding: false,
  },

  // Grid
  grid: {
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  emojiCell: {
    width: CELL_SIZE,
    height: CELL_SIZE,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emojiText: {
    fontSize: Platform.OS === 'ios' ? 26 : 24,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },

  // Category tabs
  tabBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: 48,
  },
  tabBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  tab: {
    width: 42,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    marginHorizontal: 2,
  },
});
