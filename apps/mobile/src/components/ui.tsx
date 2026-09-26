import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, PropsWithChildren } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/lib/theme';

export function Screen({ children, scroll = true, style }: PropsWithChildren<{ scroll?: boolean; style?: ViewStyle }>) {
  return <SafeAreaView style={s.safe} edges={['top', 'left', 'right']}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.content, style]}>{children}</ScrollView> : <View style={[s.content, s.flex, style]}>{children}</View>}
  </KeyboardAvoidingView></SafeAreaView>;
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return <View style={s.brand}><View style={s.mark}><View style={s.petal} /><View style={[s.petal, { transform: [{ rotate: '60deg' }] }]} /><View style={[s.petal, { transform: [{ rotate: '-60deg' }] }]} /></View><Text style={s.wordmark}>sidebyside<Text style={{ color: colors.violet }}>.</Text></Text>{!compact && <View style={{ flex: 1 }} />}</View>;
}
export function Heading({ eyebrow, title, subtitle, right }: { eyebrow?: string; title: string; subtitle?: string; right?: React.ReactNode }) {
  return <View style={s.heading}>{!!eyebrow && <Text style={s.eyebrow}>{eyebrow}</Text>}<View style={s.row}><Text accessibilityRole="header" style={[s.title, { flex: 1 }]}>{title}</Text>{right}</View>{!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}</View>;
}
export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) { return <View style={[s.card, style]}>{children}</View>; }
export function Label({ children }: PropsWithChildren) { return <Text style={s.label}>{children}</Text>; }
export function Body({ children, muted = false }: PropsWithChildren<{ muted?: boolean }>) { return <Text style={[s.body, muted && { color: colors.muted }]}>{children}</Text>; }
export function Button({ title, onPress, loading, disabled, variant = 'primary', icon }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; icon?: ComponentProps<typeof Ionicons>['name'] }) {
  const quiet = variant === 'quiet'; const light = variant === 'secondary' || quiet;
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled || !!loading, busy: !!loading }} disabled={disabled || loading} onPress={onPress} style={({ pressed }) => [s.button, light && { backgroundColor: quiet ? 'transparent' : colors.lavender }, variant === 'danger' && { backgroundColor: colors.danger }, (disabled || loading) && { opacity: .5 }, pressed && { opacity: .75 }]}>
    {loading ? <ActivityIndicator color={light ? colors.violet : 'white'} /> : <>{icon && <Ionicons name={icon} size={18} color={light ? colors.violet : 'white'} />}<Text style={[s.buttonText, light && { color: colors.violet }]}>{title}</Text></>}
  </Pressable>;
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return <View style={{ gap: 8 }}><Label>{label}</Label><TextInput accessibilityLabel={label} placeholderTextColor="#9690A7" selectionColor={colors.violet} {...props} style={[s.input, props.multiline && { minHeight: 100, textAlignVertical: 'top' }, props.style]} /></View>;
}
export function Toggle({ title, description, value, onValueChange, disabled }: { title: string; description?: string; value: boolean; onValueChange: (v: boolean) => void; disabled?: boolean }) {
  return <View style={s.row}><View style={{ flex: 1, gap: 5 }}><Label>{title}</Label>{description && <Text style={s.small}>{description}</Text>}</View><Switch accessibilityLabel={title} value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ true: colors.violet, false: '#CBC6DB' }} /></View>;
}
export function Notice({ children, error = false }: PropsWithChildren<{ error?: boolean }>) {
  return <View accessibilityRole={error ? 'alert' : undefined} style={[s.notice, error && { backgroundColor: '#FAEDEF' }]}><Ionicons name={error ? 'alert-circle-outline' : 'information-circle-outline'} size={18} color={error ? colors.danger : colors.violet} /><Text style={[s.small, { flex: 1, color: error ? colors.danger : colors.violetDark }]}>{children}</Text></View>;
}
export function EmptyState({ icon = 'sparkles-outline', title, message, action }: { icon?: ComponentProps<typeof Ionicons>['name']; title: string; message: string; action?: React.ReactNode }) {
  return <Card style={s.empty}><View style={s.emptyIcon}><Ionicons name={icon} size={30} color={colors.violet} /></View><Text style={s.cardTitle}>{title}</Text><Text style={[s.subtitle, { textAlign: 'center' }]}>{message}</Text>{action}</Card>;
}
export function Chips({ values }: { values: string[] }) { return <View style={s.chips}>{values.map((v, i) => <View style={s.chip} key={`${v}-${i}`}><Text style={s.chipText}>{v}</Text></View>)}</View>; }
export const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background }, flex: { flex: 1 },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', padding: 24, paddingBottom: 40, gap: 22, flexGrow: 1 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 }, wordmark: { fontSize: 23, fontWeight: '700', letterSpacing: -1, color: colors.ink },
  mark: { width: 27, height: 27, alignItems: 'center', justifyContent: 'center' }, petal: { position: 'absolute', width: 10, height: 27, borderRadius: 8, backgroundColor: colors.violet },
  heading: { gap: 10, marginTop: 10 }, eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: colors.violet, textTransform: 'uppercase' },
  title: { fontSize: 38, lineHeight: 43, fontWeight: '600', letterSpacing: -1.7, color: colors.ink }, subtitle: { fontSize: 15, lineHeight: 23, color: colors.muted },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 }, card: { padding: 22, gap: 17, borderRadius: 24, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  cardTitle: { fontSize: 21, fontWeight: '600', color: colors.ink, letterSpacing: -.6 }, label: { fontSize: 14, color: colors.ink, fontWeight: '600' }, body: { fontSize: 16, lineHeight: 25, color: colors.ink }, small: { fontSize: 13, lineHeight: 20, color: colors.muted },
  input: { borderWidth: 1, borderColor: colors.line, backgroundColor: '#FCFBFF', borderRadius: 14, padding: 15, color: colors.ink, fontSize: 16, minHeight: 52 },
  button: { borderRadius: 16, backgroundColor: colors.violet, minHeight: 52, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }, buttonText: { fontSize: 15, fontWeight: '600', color: 'white' },
  notice: { backgroundColor: colors.pale, borderRadius: 14, padding: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  empty: { alignItems: 'center', paddingVertical: 34, gap: 13 }, emptyIcon: { width: 62, height: 62, borderRadius: 22, backgroundColor: colors.pale, alignItems: 'center', justifyContent: 'center', marginBottom: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, chip: { backgroundColor: colors.pale, borderRadius: 20, paddingVertical: 7, paddingHorizontal: 12 }, chipText: { color: colors.violetDark, fontSize: 12 },
});
