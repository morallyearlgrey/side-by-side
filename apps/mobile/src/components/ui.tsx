import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Children, createContext, useContext, useRef, useState, type ComponentProps, type KeyboardEvent, type PropsWithChildren } from 'react';
import { ActivityIndicator, Animated, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';
import { useLunar } from './Lunar';

const ScreenScrollContext = createContext<Animated.Value | null>(null);
export const useScreenScroll = () => useContext(ScreenScrollContext);

export function Reveal({ children }: PropsWithChildren) {
  const scroll = useScreenScroll();
  const { height } = useWindowDimensions();
  const { reducedMotion } = useLunar();
  const [top, setTop] = useState<number | null>(null);
  const from = (top ?? 0) - height * .88;
  const to = (top ?? 0) - height * .55;
  return <Animated.View onLayout={event => setTop(event.nativeEvent.layout.y)} style={scroll && !reducedMotion && top !== null ? {
    opacity: scroll.interpolate({ inputRange: [from, to], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: scroll.interpolate({ inputRange: [from, to], outputRange: [22, 0], extrapolate: 'clamp' }) }],
  } : undefined}>{children}</Animated.View>;
}

export function Screen({ children, scroll = true, style }: PropsWithChildren<{ scroll?: boolean; style?: ViewStyle }>) {
  const position = useRef(new Animated.Value(0)).current;
  const { width } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= 1024;
  const contentStyle = [s.content, desktop && s.desktopContent, style];
  return <ScreenScrollContext.Provider value={scroll ? position : null}><SafeAreaView style={s.safe} edges={['top', 'left', 'right']}><LinearGradient pointerEvents="none" colors={['#453027', '#24181B', colors.background]} locations={[0, .28, 1]} start={{ x: 1, y: 0 }} end={{ x: .1, y: .85 }} style={StyleSheet.absoluteFill} /><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {scroll ? <Animated.ScrollView keyboardShouldPersistTaps="handled" scrollEventThrottle={32} onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: position } } }], { useNativeDriver: Platform.OS !== 'web' })} contentContainerStyle={contentStyle}>{Children.map(children, child => child ? <Reveal>{child}</Reveal> : child)}</Animated.ScrollView> : <View style={[contentStyle, s.flex]}>{children}</View>}
  </KeyboardAvoidingView></SafeAreaView></ScreenScrollContext.Provider>;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <View style={s.brand}><View style={s.mark}><View style={s.petal} /><View style={[s.petal, { transform: [{ rotate: '60deg' }] }]} /><View style={[s.petal, { transform: [{ rotate: '-60deg' }] }]} /></View><Text style={s.wordmark}>sidebyside<Text style={{ color: colors.violet }}>.</Text></Text>{!compact && <View style={{ flex: 1 }} />}</View>;
}
export function Heading({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: React.ReactNode }) {
  const { fontReady } = useLunar();
  return <View style={s.heading}>{!!eyebrow && <Text style={s.eyebrow}>{eyebrow}</Text>}<View style={s.row}><Text accessibilityRole="header" style={[s.title, { flex: 1 }, fontReady && { fontFamily: 'Michroma', fontWeight: '400' }]}>{title}</Text>{right}</View>{!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}</View>;
}
type PanelProps = PropsWithChildren<{ style?: ViewStyle; title?: string; subtitle?: string; defaultExpanded?: boolean }>;

function PanelContent({ title, subtitle, defaultExpanded = true, children }: PanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (!title) return <>{children}</>;
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={`${expanded ? 'Collapse' : 'Expand'} ${title}`}
      accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(value => !value)}
      style={({ pressed }) => [s.panelHeader, pressed && { opacity: .7 }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Text style={s.cardTitle}>{title}</Text>{!!subtitle && <Text style={s.small}>{subtitle}</Text>}</View>
      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={22} color={colors.violet} />
    </Pressable>
    {/* Keep form state when folded, but remove hidden controls from layout and accessibility. */}
    <View style={[s.panelBody, !expanded && { display: 'none' }]} accessibilityElementsHidden={!expanded}
      importantForAccessibility={expanded ? 'auto' : 'no-hide-descendants'}>{children}</View>
  </>;
}

export function Card({ style, ...props }: PanelProps) { return <View style={[s.card, style]}><PanelContent {...props} /></View>; }
export function Section({ style, ...props }: PanelProps) { return <View style={[s.section, style]}><PanelContent {...props} /></View>; }
export function Label({ children }: PropsWithChildren) { return <Text style={s.label}>{children}</Text>; }
export function Body({ children, muted = false }: PropsWithChildren<{ muted?: boolean }>) { return <Text style={[s.body, muted && { color: colors.muted }]}>{children}</Text>; }
export function Button({ title, onPress, loading, disabled, variant = 'primary', icon }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; icon?: ComponentProps<typeof Ionicons>['name'] }) {
  const quiet = variant === 'quiet'; const light = variant === 'secondary' || quiet;
  const [focused, setFocused] = useState(false);
  const foreground = variant === 'danger' ? colors.background : light ? colors.violetDark : colors.background;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }} disabled={disabled || loading} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} style={({ pressed }) => [s.button, Platform.OS === 'web' && { outlineColor: colors.focus }, light && { backgroundColor: quiet ? 'transparent' : colors.pale, borderColor: quiet ? 'transparent' : colors.line }, variant === 'danger' && { backgroundColor: colors.danger, borderColor: colors.danger }, focused && { borderColor: colors.focus }, (disabled || loading) && { opacity: .5 }, pressed && { opacity: .8 }]}>
    {loading ? <ActivityIndicator color={foreground} /> : <>{icon && <Ionicons name={icon} size={18} color={foreground} />}<Text style={[s.buttonText, { color: foreground }]}>{title}</Text></>}
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const [focused, setFocused] = useState(false);
  return <View style={{ gap: 9 }}><Label>{label}</Label><TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} selectionColor={colors.violet} {...props} onFocus={event => { setFocused(true); props.onFocus?.(event); }} onBlur={event => { setFocused(false); props.onBlur?.(event); }} style={[s.input, Platform.OS === 'web' && { outlineColor: colors.focus }, props.multiline && { minHeight: 116, textAlignVertical: 'top' }, props.style, focused && { borderColor: colors.focus }]} /></View>;
}
export function Toggle({ title, description, value, onValueChange, disabled }: { title: string; description?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  // React Native Web handles Enter on custom roles, but Space only on buttons.
  const keyboardProps = Platform.OS === 'web' ? { onKeyDown: (event: KeyboardEvent) => {
    if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      if (!disabled && !event.repeat) onValueChange(!value);
    }
  } } : {};
  return <Pressable {...keyboardProps} accessibilityRole="switch" accessibilityLabel={title} accessibilityHint={description}
    accessibilityState={{ checked: value, disabled: !!disabled }} aria-checked={value} aria-disabled={!!disabled} disabled={disabled}
    onPress={() => onValueChange(!value)} style={({ pressed }) => [s.row, s.toggle, disabled && { opacity: .55 }, pressed && { opacity: .7 }]}>
    <View style={{ flex: 1, minWidth: 0, gap: 5 }}><Label>{title}</Label>{description && <Text style={s.small}>{description}</Text>}</View>
    <View pointerEvents="none" aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Switch accessible={false} focusable={false} tabIndex={-1} value={value} disabled={disabled} trackColor={{ true: colors.actionBorder, false: colors.line }} />
    </View>
  </Pressable>;
}
export function Notice({ children, error = false }: PropsWithChildren<{ error?: boolean }>) {
  return <View accessibilityRole={error ? 'alert' : undefined} style={[s.notice, error && { backgroundColor: colors.blush }]}><Ionicons name={error ? 'alert-circle-outline' : 'information-circle-outline'} size={18} color={error ? colors.danger : colors.violet} /><Text style={[s.small, { flex: 1, color: error ? colors.danger : colors.violetDark }]}>{children}</Text></View>;
}
export function EmptyState({ icon = 'sparkles-outline', title, message, action }: { icon?: ComponentProps<typeof Ionicons>['name']; title: string; message: string; action?: React.ReactNode }) {
  return <View style={s.empty}><View style={s.emptyIcon}><Ionicons name={icon} size={26} color={colors.violet} /></View><Text style={[s.cardTitle, { textAlign: 'center' }]}>{title}</Text><Text style={[s.subtitle, { textAlign: 'center', maxWidth: 390 }]}>{message}</Text>{action}</View>;
}
export function Chips({ values }: { values: string[] }) { return <View style={s.chips}>{values.map((v, i) => <View style={[s.chip, { minHeight: 30, paddingVertical: 4 }]} key={`${v}-${i}`}><Text style={s.chipText}>{v}</Text></View>)}</View>; }
export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  content: { width: '100%', maxWidth: 700, alignSelf: 'center', padding: 20, paddingBottom: 132, gap: 24, flexGrow: 1 },
  desktopContent: { maxWidth: 1120, paddingHorizontal: 32, paddingTop: 28, gap: 30 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: colors.line }, wordmark: { fontSize: 20, fontWeight: '600', letterSpacing: 0, color: colors.ink },
  mark: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }, petal: { position: 'absolute', width: 8, height: 22, borderRadius: 8, backgroundColor: colors.violet },
  heading: { gap: 12, marginTop: 4, marginBottom: 4 }, eyebrow: { fontSize: 11, lineHeight: 17, fontWeight: '500', letterSpacing: 0, color: colors.violet, textTransform: 'uppercase' },
  title: { fontSize: 27, lineHeight: 38, fontWeight: '400', letterSpacing: -.5, color: colors.ink }, subtitle: { fontSize: 15, lineHeight: 24, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 }, card: { padding: 20, gap: 18, borderRadius: 22, borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(69,48,39,.42)' },
  panelHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52 }, panelBody: { gap: 18 },
  toggle: { minHeight: 56, paddingVertical: 6, borderRadius: 6 },
  section: { gap: 20, borderWidth: 1, borderColor: colors.line, borderRadius: 22, padding: 20, backgroundColor: 'rgba(69,48,39,.28)' },
  cardTitle: { fontSize: 19, lineHeight: 27, fontWeight: '500', color: colors.ink, letterSpacing: 0 }, label: { fontSize: 14, lineHeight: 21, color: colors.ink, fontWeight: '500' }, body: { fontSize: 16, lineHeight: 25, color: colors.ink }, small: { fontSize: 13, lineHeight: 20, color: colors.muted },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: 'rgba(22,19,22,.82)', borderRadius: 15, padding: 14, color: colors.ink, fontSize: 16, lineHeight: 24, minHeight: 52 },
  button: { borderRadius: 26, borderWidth: 1, borderColor: colors.actionBorder, backgroundColor: colors.action, minHeight: 52, paddingVertical: 13, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 }, buttonText: { fontSize: 14, lineHeight: 21, fontWeight: '500', color: colors.ink, flexShrink: 1, textAlign: 'center' },
  notice: { backgroundColor: colors.pale, borderLeftWidth: 2, borderLeftColor: colors.line, borderRadius: 4, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 13, borderTopWidth: 1, borderTopColor: colors.line }, emptyIcon: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { backgroundColor: colors.pale, borderWidth: 1, borderColor: colors.line, borderRadius: 6, minHeight: 44, justifyContent: 'center', maxWidth: '100%', paddingVertical: 10, paddingHorizontal: 12 }, chipText: { color: colors.violetDark, fontSize: 13, lineHeight: 19, flexShrink: 1 },
});
